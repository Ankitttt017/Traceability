import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dashboardApi, rejectionConfigApi } from "../../../api/services";
import { PART } from "./derive";

/* ═══════════════════════════════════════════════════════════════════════════
   Progressive data loading for the Rejection Analysis page.
   • at most 3 requests in flight (a small queue); a filter change aborts everything still pending
   • eager (KPI strip + first tab): shot analytics + summary + Pareto → daily trend
   • everything else is requested by the tab / section that needs it (ensure): NG records, shift scrap, the CAD view
     config, part-level process analysis; parameterised sets use "key|arg" (e.g. "hour|2026-10-07", "station|OP130")
   • no part-name filter: many traced parts carry no part name (customer-QR-only parts) although the whole line runs
     OPK12 — the Dashboard does not filter either, so both pages show the same figures for the same period
     (only the DCM shot analytics is asked for part OPK12, as on the Dashboard)
   • results are tagged with the query they belong to, so a late answer for old filters is never shown
   ═══════════════════════════════════════════════════════════════════════════ */
const MAX_IN_FLIGHT = 3;
const REQ = { timeout: 60000, suppressGlobalError: true };
const REQ_HEAVY = { timeout: 90000, suppressGlobalError: true };

export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < max && queue.length) {
      const job = queue.shift();
      active += 1;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => { active -= 1; next(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

export const isAbort = (err) => err?.name === "CanceledError" || err?.name === "AbortError" || err?.code === "ERR_CANCELED";

export const LABELS = {
  shot: "DCM shot data",
  summary: "Production summary",
  pareto: "Rejection reasons",
  trend: "Daily trend",
  rows: "NG part records",
  shift: "Shift data",
  config: "Part views (defect map)",
  ml: "Part-level process analysis",
  hour: "Hourly trend",
  station: "Station trend",
  sum: "Station figures for the selected month / day",
};

const EAGER = ["shot", "summary", "pareto", "trend"];
const isParam = (key) => key.includes("|");
const baseKey = (key) => key.split("|")[0];

/**
 * filters: { datePreset, dateFrom, dateTo, machineName?, dieName? } (category / reason / zone are applied in the page)
 * The DCM shot analytics takes dates only (no machine / die filter).
 * returns { get(key) → { status: "loading"|"done"|"error", data, error }, ensure(key), reload, errors, lastUpdated, query, singleDay }
 */
export default function useRejectionData(filters) {
  const [nonce, setNonce] = useState(0);
  const [store, setStore] = useState({});
  const [limiter] = useState(() => createLimiter(MAX_IN_FLIGHT));
  const requested = useRef(new Map()); // tag → token of the request that owns it
  const wanted = useRef(new Set());
  const ctrlRef = useRef(null);
  const qkRef = useRef("");

  const singleDay = !!filters.dateFrom && filters.dateFrom === filters.dateTo;

  const query = useMemo(() => {
    const q = { limit: 5000, noCache: "1" };
    if (filters.datePreset) q.datePreset = filters.datePreset;
    if (filters.dateFrom) q.dateFrom = filters.dateFrom;
    if (filters.dateTo) q.dateTo = filters.dateTo;
    // server-side page filters (see rejFilters.js) — never partName: customer-QR-only parts carry no part name
    if (filters.machineName) q.machineName = filters.machineName;
    if (filters.dieName) q.dieName = filters.dieName;
    return q;
  }, [filters.datePreset, filters.dateFrom, filters.dateTo, filters.machineName, filters.dieName]);

  const qk = useMemo(() => `${JSON.stringify(query)}#${nonce}`, [query, nonce]);

  /** Fetch one data set for the current query (once per query). */
  const load = useCallback((key, forQk, fn, abortable = true) => {
    const tag = `${forQk}|${key}`;
    if (requested.current.has(tag)) return;
    const token = {};
    requested.current.set(tag, token);
    const ctrl = abortable ? ctrlRef.current : null;
    limiter(() => {
      if (ctrl?.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return fn(ctrl?.signal);
    })
      .then((data) => {
        if (forQk !== "static" && qkRef.current !== forQk) return;
        setStore((s) => ({ ...s, [key]: { qk: forQk, status: "done", data, at: Date.now() } }));
      })
      .catch((err) => {
        if (requested.current.get(tag) === token) requested.current.delete(tag); // allow a retry (also after an abort)
        if (isAbort(err) || (forQk !== "static" && qkRef.current !== forQk)) return;
        setStore((s) => ({ ...s, [key]: { qk: forQk, status: "error", error: err?.message || "Request failed", at: Date.now() } }));
      });
  }, [limiter]);

  const fetchers = useMemo(() => {
    const ts = () => ({ _ts: Date.now() });
    return {
      shot: (signal) => dashboardApi.shotAnalytics(
        { dateFrom: query.dateFrom, dateTo: query.dateTo, part: PART.code, ...ts() },
        { ...REQ, signal },
      ),
      summary: (signal) => dashboardApi.rejectionSummary({ ...query, ...ts() }, { ...REQ, signal }),
      pareto: (signal) => dashboardApi.rejectionPareto({ ...query, ...ts() }, { ...REQ, signal }),
      trend: (signal) => {
        if (singleDay) {
          const q = { ...query, granularity: "hour", ...ts() };
          delete q.datePreset;
          return dashboardApi.rejectionDaily(q, { ...REQ, signal });
        }
        return dashboardApi.rejectionDaily({ ...query, granularity: "day", ...ts() }, { ...REQ, signal });
      },
      rows: (signal) => dashboardApi.rejectionRows({ ...query, status: "NG", page: 1, pageSize: 10000, ...ts() }, { ...REQ_HEAVY, signal }),
      shift: (signal) => dashboardApi.rejectionShiftScrap({ ...query, ...ts() }, { ...REQ, signal }),
      config: (signal) => rejectionConfigApi.operatorConfig({ partName: PART.name }, { ...REQ, signal }),
      ml: (signal) => dashboardApi.rejectionMlInsights({ ...query, ...ts() }, { ...REQ_HEAVY, signal }),
      // one production day hour by hour (drill-down of the trend)
      hour: (signal, day) => {
        const q = { ...query, dateFrom: day, dateTo: day, granularity: "hour", ...ts() };
        delete q.datePreset;
        return dashboardApi.rejectionDaily(q, { ...REQ, signal });
      },
      // one station's own output per production day (that station's scan time decides the day)
      station: (signal, code) => dashboardApi.rejectionDaily({ ...query, granularity: "day", qualityGate: code, ...ts() }, { ...REQ, signal }),
      // station OK / NG (by station scan time) for a part of the period: "sum|<from>|<to>"
      sum: (signal, range) => {
        const [from, to] = String(range).split("|");
        return dashboardApi.rejectionSummary({ ...query, datePreset: "custom", dateFrom: from, dateTo: to || from, ...ts() }, { ...REQ, signal });
      },
    };
  }, [query, singleDay]);

  const fetcherFor = useCallback((key) => {
    const [b, ...rest] = key.split("|");
    const fn = fetchers[b];
    return fn ? (signal) => fn(signal, rest.join("|")) : null;
  }, [fetchers]);

  // Eager: KPI strip + first tab (the queue keeps ≤ 3 in flight). Lazy sets a tab has already asked for are
  // reloaded for the new filters too; parameterised sets ("hour|…") only when they are asked for under the new filters.
  useEffect(() => {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    ctrlRef.current = ctrl;
    qkRef.current = qk;
    const reqMap = requested.current;
    const want = wanted.current;
    const keys = [...new Set([...EAGER, ...[...want].filter((k) => k !== "config")])];
    keys.forEach((k) => { const fn = fetcherFor(k); if (fn) load(k, qk, fn); });
    keys.filter(isParam).forEach((k) => want.delete(k));
    return () => {
      ctrl?.abort();
      keys.forEach((k) => reqMap.delete(`${qk}|${k}`));
    };
  }, [qk, load, fetcherFor]);

  /**
   * Lazy sets: requested by a tab / section when it opens. The CAD config does not depend on filters.
   * A child's effect can run before this hook's effect has switched to new filters — then the key waits in
   * `wanted` and the effect above loads it.
   */
  const ensure = useCallback((key) => {
    if (key === "config") { wanted.current.add(key); load("config", "static", fetchers.config, false); return; }
    const fn = fetcherFor(key);
    if (!fn) return;
    // an aborted controller means the effect below is about to restart for these filters (e.g. React StrictMode
    // re-running effects): queue the key for it instead of starting a request that is cancelled at once
    if (qkRef.current === qk && !ctrlRef.current?.signal.aborted) {
      if (!isParam(key)) wanted.current.add(key);
      load(key, qk, fn);
    } else {
      wanted.current.add(key);
    }
  }, [load, fetchers, fetcherFor, qk]);

  const get = useCallback((key) => {
    const e = store[key];
    const want = key === "config" ? "static" : qk;
    // not answered yet for these filters (queued, in flight or not asked for yet) → loading
    if (!e || e.qk !== want) return { status: "loading", data: null };
    return e;
  }, [store, qk]);

  const errors = useMemo(
    () => Object.entries(store)
      .filter(([k, e]) => e.status === "error" && e.qk === (k === "config" ? "static" : qk))
      .map(([k, e]) => `${LABELS[baseKey(k)] || k}: ${e.error}`),
    [store, qk],
  );
  const lastUpdated = store.summary?.qk === qk && store.summary.status === "done" ? store.summary.at : null;

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  /** Run a one-off request through the same queue (keeps the page at ≤ 3 requests in flight). */
  const run = useCallback((fn) => limiter(fn), [limiter]);

  return { get, ensure, reload, run, errors, lastUpdated, query, singleDay };
}
