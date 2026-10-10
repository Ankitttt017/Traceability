import React, { useEffect, useMemo, useRef, useState } from "react";
import { Zap, Download, Search, Waves, Gauge, GitBranch, Layers, ShieldAlert, Loader2, HelpCircle, Database } from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import EChart from "../../components/charts/EChart";
import useInView from "../../components/mgmt/useInView";
import RejectionTable from "./RejectionTable";
import {
  formatResultTimestamp, extractShotFromPartId, ALL_45_PARAMETERS, parseRowDefect,
} from "./rejectionConstants";
import {
  OUTCOME, CATEGORICAL, OTHER, DIVERGING, DEFECT_CATEGORY, STATUS, INK, FONT_FAMILY,
  ECHART_TOOLTIP, LEGEND, SEQ_SCRAP, ACCENT, CARD_CSS, accent, withAlpha,
  baseOption, valueAxis, categoryAxis, axisLabel, tooltipHtml,
} from "./chartTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */
const NG_STATUS = new Set(["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"]);
const OK_STATUS = new Set(["OK", "PASSED", "ENDED_OK", "COMPLETED_OK"]);
const MIN_PER_CLASS = 2;      // OK and NG readings needed to keep a parameter at all
const MIN_RANK_PER_CLASS = 5; // OK and NG readings needed to rank a parameter as a driver
const MAX_DRIVERS = 12;
// Direction of the NG shift (not an outcome, so not green / red): higher in NG = orange, lower in NG = blue
const HIGHER = CATEGORICAL[1];
const LOWER = DIVERGING.low;
const LIMIT_C = STATUS.warning;

/* ═══════════════════════════════════════════════════════════════════════════
   STATS HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */
/** true when the part has DCM shot data: its PlcCycleReadings record (shot cycle time) is on the row. */
const hasShotData = (r) => Number(r?.plc_cycle_time ?? r?.plcCycleTime) > 0;
const idOf = (r) => String(r?.partId || r?.part_id || r?.customerQrCode || r?.customer_qr || r?.id || "");

// PlcCycleReadings value for a parameter, trying its column aliases; null when not recorded
const readParam = (r, p) => {
  for (const k of [p.key, ...(p.altKeys || [])]) {
    const raw = r?.[k];
    if (raw === null || raw === undefined || raw === "" || raw === "-") continue;
    const v = Number(raw);
    if (Number.isFinite(v)) return v;
  }
  return null;
};

const hashStr = (s) => { let h = 0; const t = String(s); for (let i = 0; i < t.length; i++) { h = (h << 5) - h + t.charCodeAt(i); h |= 0; } return Math.abs(h); };
const sampleEvenly = (a, max) => (a.length <= max ? a : a.filter((_, i) => i % Math.ceil(a.length / max) === 0));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const quantile = (sorted, q) => { if (!sorted.length) return 0; const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo); };
const r2 = (v) => Number(Number(v).toFixed(2));
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const signed = (v, d = 2) => `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}`;
const fmtP = (p) => (!Number.isFinite(p) ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));

// ROC AUC = P(score_pos > score_neg) via Mann–Whitney with tie-averaged ranks
const aucScore = (neg, pos) => {
  if (!neg.length || !pos.length) return NaN;
  const all = [...neg.map((v) => [v, 0]), ...pos.map((v) => [v, 1])].sort((a, b) => a[0] - b[0]);
  let rs = 0, i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k][1]) rs += avg;
    i = j + 1;
  }
  const n1 = pos.length, n0 = neg.length;
  return (rs - (n1 * (n1 + 1)) / 2) / (n1 * n0);
};

// Gaussian KDE (Silverman bandwidth), density normalised per class
const kde = (vals, grid) => {
  const n = vals.length;
  const sd = std(vals);
  if (n < 3 || !(sd > 0)) return grid.map(() => 0);
  const h = 1.06 * sd * Math.pow(n, -0.2);
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  return grid.map((g) => { let s = 0; for (let i = 0; i < n; i++) { const u = (g - vals[i]) / h; s += Math.exp(-0.5 * u * u); } return s * norm; });
};

// Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7)
const normCdf = (x) => {
  const u = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * u);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-u * u);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
};

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
// L2-regularised logistic regression (batch gradient descent); sw = per-sample weights (plant OK/NG mix)
const trainLogReg = (X, y, { epochs = 300, lr = 0.3, l2 = 0.02, sw }) => {
  const n = X.length, d = X[0].length;
  const w = new Array(d).fill(0);
  const wp = y.reduce((s, v, i) => s + (v ? sw[i] : 0), 0), wt = sw.reduce((s, v) => s + v, 0);
  let b = Math.log(Math.max(1e-6, wp) / Math.max(1e-6, wt - wp));
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const err = (sigmoid(z) - y[i]) * sw[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= (lr * gb) / n;
  }
  return { w, b };
};

// true below the given width (phones) — used to shrink chart label gutters
const useNarrow = (px = 640) => {
  const q = `(max-width:${px}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [q]);
  return narrow;
};

/* ═══════════════════════════════════════════════════════════════════════════
   UI PIECES
   ═══════════════════════════════════════════════════════════════════════════ */
const Card = ({ color, icon, title, sub, actions, children, className = "", bodyClass = "ra-card-body" }) => (
  <section className={`ra-card ${className}`} data-accent style={accent(color)}>
    <div className="ra-card-head">
      <div className="rc-head-l">
        <span className="ra-icon">{icon}</span>
        <div style={{ minWidth: 0 }}>
          <h3 className="ra-card-title">{title}</h3>
          {sub && <p className="ra-card-sub">{sub}</p>}
        </div>
      </div>
      {actions && <div className="rc-actions">{actions}</div>}
    </div>
    <div className={bodyClass}>{children}</div>
  </section>
);

const Kpi = ({ label, value, color }) => (
  <div className="ra-kpi" data-accent style={accent(color)}>
    <div className="ra-kpi-label">{label}</div>
    <div className="ra-kpi-value rc-kpi-value" title={typeof value === "string" ? value : undefined}>{value}</div>
  </div>
);

const Empty = ({ children }) => <div className="rc-empty">{children}</div>;
const Loading = ({ children = "Loading process data…" }) => (
  <div className="rc-empty" role="status"><Loader2 size={18} className="rc-spin" /> {children}</div>
);

/* ═══════════════════════════════════════════════════════════════════════════
   PARAMETER GRID — every PLC parameter side by side (no dropdown): OK vs NG distribution per parameter,
   with the set limits, the NG shift and an association label. Parameters without enough readings are shown
   with the reason instead of being dropped.
   ═══════════════════════════════════════════════════════════════════════════ */
const MIN_TILE_PER_CLASS = 5;
const realSpread = (sd, m) => Number.isFinite(sd) && sd > 1e-9 * Math.max(1, Math.abs(m || 0));
const ASSOC = {
  strong: { label: "Associated with NG", color: OUTCOME.ng },
  weak: { label: "Weak association", color: STATUS.warning },
  none: { label: "No clear association", color: INK.muted },
  insufficient: { label: "Insufficient data", color: INK.faint },
  constant: { label: "No variation", color: INK.faint },
  empty: { label: "No readings", color: INK.faint },
};

/** One entry per catalogue parameter (all 45), from the labelled pool. */
const buildParamGrid = (pool, limitMap) => ALL_45_PARAMETERS.map((p) => {
  const ok = [], ng = [];
  let invalid = 0;
  pool.forEach(({ r, ng: isNg }) => {
    const v = readParam(r, p);
    if (v === null) {
      // a value was sent but is not a usable number (text / NaN) — counted, not plotted
      const raw = [p.key, ...(p.altKeys || [])].map((k) => r?.[k]).find((x) => x !== null && x !== undefined && x !== "" && x !== "-");
      if (raw !== undefined) invalid += 1;
      return;
    }
    if (v <= 0) { invalid += 1; return; } // 0 / negative = no reading from the PLC
    (isNg ? ng : ok).push(v);
  });
  const base = { key: p.key, label: p.label, unit: p.unit || "", group: p.category || "", ok, ng, invalid, lim: limitMap[p.key] || null };
  if (!ok.length && !ng.length) return { ...base, status: "empty" };
  if (ok.length < MIN_TILE_PER_CLASS || ng.length < MIN_TILE_PER_CLASS) return { ...base, status: "insufficient" };
  const okMean = mean(ok), ngMean = mean(ng), okStd = std(ok), ngStd = std(ng);
  // float noise (σ ≈ 1e-12 on a constant reading) is no variation, not an infinite shift
  if (!realSpread(okStd, okMean) && !realSpread(ngStd, ngMean)) return { ...base, status: "constant", okMean, ngMean };
  const pooled = std([...ok, ...ng]);
  const sd = realSpread(okStd, okMean) ? okStd : realSpread(pooled, okMean) ? pooled : null;
  if (!sd) return { ...base, status: "constant", okMean, ngMean };
  const shift = (ngMean - okMean) / sd;
  const se = Math.sqrt(okStd ** 2 / ok.length + ngStd ** 2 / ng.length);
  const pval = se > 0 ? 2 * (1 - normCdf(Math.abs((ngMean - okMean) / se))) : NaN;
  const sig = Number.isFinite(pval) && pval < 0.05;
  const status = sig && Math.abs(shift) >= 0.5 ? "strong" : sig ? "weak" : "none";
  return { ...base, status, okMean, ngMean, okStd, shift, pval };
});

const ORDER = { strong: 0, weak: 1, none: 2, constant: 3, insufficient: 4, empty: 5 };
const sortGrid = (list) => [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status]
  || Math.abs(b.shift || 0) - Math.abs(a.shift || 0)
  || (b.ok.length + b.ng.length) - (a.ok.length + a.ng.length));

/** Mini OK-vs-NG density chart of one parameter (rendered once the tile scrolls into view). */
function ParamTile({ item, focused, tileRef }) {
  const [ref, seen] = useInView();
  const option = useMemo(() => {
    if (!seen || !["strong", "weak", "none", "constant"].includes(item.status)) return null;
    const okV = sampleEvenly(item.ok, 1500), ngV = sampleEvenly(item.ng, 1500);
    const sorted = [...okV, ...ngV].sort((a, b) => a - b);
    let lo = quantile(sorted, 0.01), hi = quantile(sorted, 0.99);
    if (!(hi > lo)) { lo = sorted[0] * 0.95; hi = sorted[sorted.length - 1] * 1.05 || lo + 1; }
    if (!(hi > lo)) return null;
    const grid = Array.from({ length: 60 }, (_, i) => lo + ((hi - lo) * i) / 59);
    const dOk = kde(okV, grid), dNg = kde(ngV, grid);
    const span = hi - lo;
    const lims = item.lim ? [["LSL", item.lim.lsl], ["USL", item.lim.usl]].filter(([, x]) => x != null && x >= lo - span * 0.25 && x <= hi + span * 0.25) : [];
    const xMin = Math.min(lo, ...lims.map(([, x]) => x)), xMax = Math.max(hi, ...lims.map(([, x]) => x));
    const unit = item.unit ? ` ${item.unit}` : "";
    return {
      ...baseOption(),
      animation: false,
      grid: { left: 6, right: 10, top: 8, bottom: 4, containLabel: true },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis",
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex;
          if (i === undefined) return "";
          const tot = dOk[i] + dNg[i];
          return tooltipHtml({
            title: `${item.label}: ${r2(grid[i])}${unit}`,
            rows: [
              { label: `OK parts (n=${item.ok.length.toLocaleString()})`, value: `${(tot ? (dOk[i] / tot) * 100 : 0).toFixed(0)}% of density`, color: OUTCOME.ok },
              { label: `NG parts (n=${item.ng.length.toLocaleString()})`, value: `${(tot ? (dNg[i] / tot) * 100 : 0).toFixed(0)}% of density`, color: OUTCOME.ng },
              { label: "OK mean / NG mean", value: `${r2(item.okMean)} / ${r2(item.ngMean)}${unit}`, strong: false },
              item.lim ? { label: "Set limits (LSL – USL)", value: `${item.lim.text}${unit}`, strong: false } : null,
            ],
            note: "Curves = share of OK and of NG parts at each reading (each curve sums to 1).",
          });
        },
      },
      xAxis: valueAxis({
        min: r2(xMin), max: r2(xMax), splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: INK.axis } },
        axisLabel: axisLabel({ fontSize: 9.5, hideOverlap: true, formatter: (v) => String(Number(Number(v).toFixed(Math.abs(v) < 10 ? 2 : 0))) }),
      }),
      yAxis: valueAxis({ show: false }),
      series: [
        {
          name: "OK", type: "line", smooth: true, showSymbol: false, data: grid.map((g, i) => [g, dOk[i]]),
          lineStyle: { color: OUTCOME.ok, width: 1.6 }, areaStyle: { color: withAlpha(OUTCOME.ok, 0.14) }, color: OUTCOME.ok,
          markLine: lims.length ? { silent: true, symbol: "none", lineStyle: { color: LIMIT_C, type: "dashed", width: 1.2 }, label: { color: INK.secondary, fontSize: 9, fontWeight: 600, formatter: (p) => p.name }, data: lims.map(([n, x]) => ({ name: n, xAxis: x })) } : undefined,
        },
        {
          name: "NG", type: "line", smooth: true, showSymbol: false, data: grid.map((g, i) => [g, dNg[i]]),
          lineStyle: { color: OUTCOME.ng, width: 1.6 }, areaStyle: { color: withAlpha(OUTCOME.ng, 0.12) }, color: OUTCOME.ng,
        },
      ],
    };
  }, [seen, item]);
  const a = ASSOC[item.status];
  const unit = item.unit ? ` ${item.unit}` : "";
  const setRefs = (el) => { ref.current = el; if (tileRef) tileRef(el); };
  return (
    <article ref={setRefs} className={`rc-tile ${focused ? "focus" : ""}`} style={{ "--tile-c": a.color }} aria-label={`${item.label}: ${a.label}`}>
      <header>
        <div style={{ minWidth: 0 }}>
          <h4 title={`${item.label}${unit}`}>{item.label}{item.unit ? <span> ({item.unit})</span> : null}</h4>
          <span className="rc-tile-tag">{a.label}</span>
        </div>
        {Number.isFinite(item.shift) && (
          <div className="rc-tile-shift" title="NG mean minus OK mean, in standard deviations of the OK parts">
            <b style={{ color: item.shift >= 0 ? HIGHER : LOWER }}>{signed(item.shift, 1)}σ</b>
            <span>p {fmtP(item.pval)}</span>
          </div>
        )}
      </header>
      <div className="rc-tile-body">
        {option ? <EChart option={option} style={{ height: 120, minHeight: 0 }} />
          : item.status === "empty" ? <div className="rc-tile-msg">No readings in this period{item.invalid ? ` (${item.invalid} zero / invalid values ignored)` : ""}</div>
            : item.status === "insufficient" ? <div className="rc-tile-msg">Insufficient data (n &lt; {MIN_TILE_PER_CLASS} per class)<br />OK n={item.ok.length} · NG n={item.ng.length}</div>
              : <div className="rc-tile-msg rc-skel" aria-hidden="true" />}
      </div>
      <footer>
        <span><i style={{ background: OUTCOME.ok }} />OK {item.okMean != null ? r2(item.okMean) : "—"} <em>n={item.ok.length.toLocaleString()}</em></span>
        <span><i style={{ background: OUTCOME.ng }} />NG {item.ngMean != null ? r2(item.ngMean) : "—"} <em>n={item.ng.length.toLocaleString()}</em></span>
        {item.lim ? <span className="lim">Limits {item.lim.text}</span> : <span className="lim muted">No set limits</span>}
        {item.invalid > 0 && <span className="lim muted" title="Zero, negative or non-numeric readings are treated as 'no reading'">{item.invalid} invalid</span>}
      </footer>
    </article>
  );
}

const GRID_FILTERS = [
  { id: "all", label: "All parameters" },
  { id: "assoc", label: "Associated with NG" },
  { id: "data", label: "With enough data" },
  { id: "gaps", label: "Insufficient / no data" },
];

function ParamGrid({ items, focusKey, waiting }) {
  const [show, setShow] = useState("assoc");
  const tiles = useRef({});
  useEffect(() => {
    if (focusKey && tiles.current[focusKey]) tiles.current[focusKey].scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusKey]);
  const counts = useMemo(() => ({
    all: items.length,
    assoc: items.filter((x) => x.status === "strong" || x.status === "weak").length,
    data: items.filter((x) => ["strong", "weak", "none", "constant"].includes(x.status)).length,
    gaps: items.filter((x) => x.status === "insufficient" || x.status === "empty").length,
  }), [items]);
  const list = items.filter((x) => (show === "assoc" ? x.status === "strong" || x.status === "weak"
    : show === "data" ? ["strong", "weak", "none", "constant"].includes(x.status)
      : show === "gaps" ? x.status === "insufficient" || x.status === "empty" : true));
  // the focused parameter stays visible whatever the filter
  const shown = focusKey && !list.some((x) => x.key === focusKey) ? [items.find((x) => x.key === focusKey), ...list].filter(Boolean) : list;
  if (waiting) return <Loading />;
  return (
    <>
      <div className="rc-grid-bar">
        <div className="rc-seg" role="group" aria-label="Show parameters">
          {GRID_FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={show === f.id} className={show === f.id ? "on" : ""} onClick={() => setShow(f.id)}>
              {f.label} <span>{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="ra-legend rc-legend" style={{ padding: 0 }}>
          <span><i style={{ background: OUTCOME.ok }} />OK parts</span>
          <span><i style={{ background: OUTCOME.ng }} />NG parts</span>
          <span><i style={{ background: "transparent", borderTop: `2px dashed ${LIMIT_C}`, height: 0, borderRadius: 0 }} />Set limits</span>
        </div>
      </div>
      {!shown.length ? <Empty>No parameters in this group.</Empty> : (
        <div className="rc-grid">
          {shown.map((it) => <ParamTile key={it.key} item={it} focused={focusKey === it.key} tileRef={(el) => { tiles.current[it.key] = el; }} />)}
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN — wording: the statistics show ASSOCIATION with NG (correlation), not a confirmed cause
   ═══════════════════════════════════════════════════════════════════════════ */
export default function RootCauseTab({
  mlInsights = { features: [], topAnomalies: [] },
  rows = [],
  recordsRows = [],
  allRejectionRecords = [],
  rejectedRows = [],
  okRecords = [],
  summary = {},
  analysis = null,
  loading = false,
}) {
  const [focusRaw, setFocusKey] = useState(""); // a parameter key, or "label:<name>" from a click on the chart axis
  const [outlierSearch, setOutlierSearch] = useState("");
  const narrow = useNarrow();

  const mlFeatures = useMemo(() => mlInsights?.features || [], [mlInsights]);
  // The parent loads telemetry + ML insights lazily when this tab opens
  const waiting = !mlFeatures.length && !(rows || []).length;

  /* ── 1. Labelled sample pool (one entry per part, outcome known) ─────── */
  // ONLY parts with DCM shot data are analysed (process parameters + shot cycle time come from the part's shot);
  // parts without a shot record are counted as excluded
  const { pool, excludedNg, excludedOk } = useMemo(() => {
    const ngIds = new Set();
    [allRejectionRecords, rejectedRows].forEach((l) => (l || []).forEach((r) => { const id = idOf(r); if (id) ngIds.add(id); }));
    const seen = new Set();
    const shotById = new Map();
    [rows, allRejectionRecords, rejectedRows, okRecords, recordsRows].forEach((l) => (l || []).forEach((r) => { const id = idOf(r); if (id && hasShotData(r) && !shotById.has(id)) shotById.set(id, r); }));
    const out = [];
    let exNg = 0, exOk = 0;
    [allRejectionRecords, rejectedRows, okRecords, rows, recordsRows].forEach((list) => (list || []).forEach((r) => {
      const id = idOf(r);
      if (id) { if (seen.has(id)) return; seen.add(id); }
      const st = String(r.status || r.overall_status || "").trim().toUpperCase();
      const ng = (id && ngIds.has(id)) || NG_STATUS.has(st) || (r.ngGate && r.ngGate !== "-");
      if (!ng && !OK_STATUS.has(st)) return; // unknown outcome → excluded
      const shotRow = hasShotData(r) ? r : (id ? shotById.get(id) : null);
      if (!shotRow) { if (ng) exNg += 1; else exOk += 1; return; }
      out.push({ r: shotRow === r ? r : { ...shotRow, ...r, ...Object.fromEntries(Object.entries(shotRow).filter(([, v]) => v != null && v !== "")) }, id: id || `row-${out.length}`, ng: !!ng });
    }));
    return { pool: out, excludedNg: exNg, excludedOk: exOk };
  }, [rows, recordsRows, allRejectionRecords, rejectedRows, okRecords]);

  const counts = useMemo(() => {
    const ng = pool.filter((p) => p.ng).length;
    return { total: pool.length, ng, ok: pool.length - ng };
  }, [pool]);

  // The sample holds every NG part but only a slice of OK parts, so each class is re-weighted to the
  // plant mix from the summary (NG / (OK + NG)) to keep rates plant-accurate.
  const popRate = useMemo(() => {
    const ng = Number(summary?.totalNG), ok = Number(summary?.totalOK);
    return ng > 0 && ok > 0 ? ng / (ng + ok) : null;
  }, [summary]);
  const classW = useMemo(() => {
    if (!popRate || !counts.ng || !counts.ok) return { ng: 1, ok: 1 };
    return { ng: popRate / (counts.ng / counts.total), ok: (1 - popRate) / (counts.ok / counts.total) };
  }, [popRate, counts]);

  /* ── 2. Per-parameter OK vs NG statistics (readings ≤ 0 = no reading) ── */
  const { stats, maps } = useMemo(() => {
    const list = [], mapsOut = {};
    ALL_45_PARAMETERS.forEach((p) => {
      const ok = [], ng = [], m = new Map();
      pool.forEach(({ r, id, ng: isNg }) => {
        const v = readParam(r, p);
        if (v === null || v <= 0) return;
        m.set(id, v);
        (isNg ? ng : ok).push({ v, id });
      });
      if (ok.length < MIN_PER_CLASS || ng.length < MIN_PER_CLASS) return;
      const okVals = ok.map((x) => x.v), ngVals = ng.map((x) => x.v);
      const okStd = std(okVals);
      if (!realSpread(okStd, mean(okVals))) return;
      const auc = aucScore(sampleEvenly(okVals, 4000), sampleEvenly(ngVals, 4000));
      list.push({
        key: p.key, def: p, label: p.label, unit: p.unit || "", ok, ng,
        okMean: mean(okVals), okStd, ngMean: mean(ngVals), ngStd: std(ngVals), allMean: mean([...okVals, ...ngVals]),
        shift: (mean(ngVals) - mean(okVals)) / okStd,
        auc, sep: Math.max(auc, 1 - auc),
      });
      mapsOut[p.key] = m;
    });
    list.sort((a, b) => b.sep - a.sep);
    return { stats: list, maps: mapsOut };
  }, [pool]);

  /* ── 3. Share of scrap explained by the PLC parameters ──────────────────
     One plant-weighted logistic model on every well-covered parameter.
     explained = Nagelkerke R² on a 30% hold-out (in-sample when the hold-out is too small);
     per-parameter share = log-likelihood lost when that parameter is held at its mean, scaled to the total. */
  const influence = useMemo(() => {
    if (counts.ng < 5 || counts.ok < 5) return null;
    const feats = stats.filter((st) => st.ok.length >= 5 && st.ng.length >= 5 && st.ok.length + st.ng.length >= 0.3 * pool.length);
    if (feats.length < 2) return null;
    const rowsAll = sampleEvenly(pool, 4000);
    const sd = feats.map((ft) => std([...ft.ok, ...ft.ng].map((x) => x.v)) || 1);
    const X = rowsAll.map(({ id }) => feats.map((ft, j) => {
      const v = maps[ft.key]?.get(id);
      return v === undefined ? 0 : (v - ft.allMean) / sd[j];
    }));
    const y = rowsAll.map((p) => (p.ng ? 1 : 0));
    const sw = y.map((v) => (v ? classW.ng : classW.ok));
    const wsum = (idx) => idx.reduce((a, i) => a + sw[i], 0);
    const prevOf = (idx) => idx.reduce((a, i) => a + (y[i] ? sw[i] : 0), 0) / (wsum(idx) || 1);
    const logLik = (w, b, idx) => idx.reduce((a, i) => {
      let z = b;
      for (let j = 0; j < w.length; j++) z += w[j] * X[i][j];
      const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(z)));
      return a + sw[i] * (y[i] ? Math.log(p) : Math.log(1 - p));
    }, 0);
    const nullLogLik = (idx, prev) => idx.reduce((a, i) => a + sw[i] * (y[i] ? Math.log(prev) : Math.log(1 - prev)), 0);
    const nagelkerke = (ll1, ll0, n) => {
      const cs = 1 - Math.exp((2 / n) * (ll0 - ll1));
      const max = 1 - Math.exp((2 / n) * ll0);
      return max > 0 ? Math.min(1, Math.max(0, cs / max)) : 0;
    };
    const fit = (idx) => trainLogReg(idx.map((i) => X[i]), idx.map((i) => y[i]), { sw: idx.map((i) => sw[i]) });

    const all = rowsAll.map((_, i) => i);
    const tr = [], te = [];
    all.forEach((i) => (hashStr(rowsAll[i].id) % 10 < 7 ? tr : te).push(i));
    const trNg = tr.filter((i) => y[i]).length, teNg = te.filter((i) => y[i]).length;
    let r2Holdout = null;
    if (te.length >= 30 && teNg >= 5 && trNg >= 5 && tr.length - trNg >= 5) {
      const m = fit(tr);
      r2Holdout = nagelkerke(logLik(m.w, m.b, te), nullLogLik(te, prevOf(tr)), wsum(te));
    }
    const full = fit(all);
    const llFull = logLik(full.w, full.b, all);
    const explained = r2Holdout ?? nagelkerke(llFull, nullLogLik(all, prevOf(all)), wsum(all));
    const contrib = feats.map((_, j) => {
      const w2 = full.w.slice();
      w2[j] = 0;
      return Math.max(0, llFull - logLik(w2, full.b, all));
    });
    const totC = contrib.reduce((a, c) => a + c, 0) || 1;
    const share = Object.fromEntries(feats.map((ft, j) => [ft.key, (contrib[j] / totC) * explained * 100]));
    return { explained, holdout: r2Holdout !== null, share, nFeats: feats.length };
  }, [stats, maps, pool, counts, classW]);

  /* ── 4. Ranked drivers: NG mean shift in σ of good parts + Welch test ── */
  const drivers = useMemo(() => {
    const eligible = stats.filter((s) => s.ok.length >= MIN_RANK_PER_CLASS && s.ng.length >= MIN_RANK_PER_CLASS);
    return (eligible.length ? eligible : stats).map((s) => {
      const se = Math.sqrt(s.okStd ** 2 / s.ok.length + s.ngStd ** 2 / s.ng.length);
      const pval = se > 0 ? 2 * (1 - normCdf(Math.abs((s.ngMean - s.okMean) / se))) : NaN;
      return { ...s, pval, sig: Number.isFinite(pval) && pval < 0.05, share: influence?.share[s.key] ?? null };
    }).sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift)).slice(0, MAX_DRIVERS);
  }, [stats, influence]);


  const focusKey = focusRaw.startsWith("label:") ? (drivers.find((d) => d.label === focusRaw.slice(6))?.key || "") : focusRaw;

  /* ── 5. Set limits from the analysis service (9999 = not set) ────────── */
  const limitMap = useMemo(() => {
    const m = {};
    mlFeatures.forEach((f) => {
      // a side is "not set" when missing, 0 or a placeholder (999.9 / 9999 …); one-sided limits are kept (same rule as SPC)
      const side = (x) => { if (x === "" || x == null) return null; const n = Number(x); return Number.isFinite(n) && n !== 0 && Math.abs(n) < 9999 && !/^9{3,}(\.9+)?$/.test(String(Math.abs(n))) ? n : null; };
      const lsl = side(f.setLowerLimit ?? f.lsl), usl = side(f.setUpperLimit ?? f.usl);
      if ((lsl != null || usl != null) && !(lsl != null && usl != null && usl <= lsl)) m[f.key] = { lsl, usl, text: lsl != null && usl != null ? `${lsl} – ${usl}` : lsl != null ? `≥ ${lsl}` : `≤ ${usl}` };
    });
    return m;
  }, [mlFeatures]);

  /* ── 6. Every parameter for the comparison grid (no selection needed) ─── */
  const gridItems = useMemo(() => sortGrid(buildParamGrid(pool, limitMap)), [pool, limitMap]);

  /* ── 8b. "Why are parts rejected?" — every top reason with the process parameters its NG parts ran off ── */
  const whyRows = useMemo(() => {
    const reasonById = new Map();
    const allByReason = {};
    [allRejectionRecords, rejectedRows].forEach((l) => (l || []).forEach((r) => {
      const id = idOf(r);
      const pd = parseRowDefect(r);
      if (!pd.reason || pd.reason === "Defect") return;
      if (id && !reasonById.has(id)) { reasonById.set(id, pd.reason); allByReason[pd.reason] = (allByReason[pd.reason] || 0) + 1; }
    }));
    if (!reasonById.size) return null;
    const cnt = {};
    pool.forEach((pp) => { if (pp.ng) { const rs = reasonById.get(pp.id); if (rs) cnt[rs] = (cnt[rs] || 0) + 1; } });
    const totalNg = Object.values(allByReason).reduce((a, v) => a + v, 0) || 1;
    return Object.entries(allByReason).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, all]) => {
      const n = cnt[reason] || 0;
      const links = stats.map((st) => {
        const vals = st.ng.filter((x) => reasonById.get(x.id) === reason).map((x) => x.v);
        if (vals.length < 3) return null;
        const mu = mean(vals);
        const z = (mu - st.okMean) / st.okStd;
        const se = st.okStd / Math.sqrt(vals.length);
        const pv = se > 0 ? 2 * (1 - normCdf(Math.abs((mu - st.okMean) / se))) : NaN;
        return { key: st.key, label: st.label, unit: st.unit, z, mu, okMean: st.okMean, n: vals.length, pv, sig: Number.isFinite(pv) && pv < 0.05 };
      }).filter((x) => x && Math.abs(x.z) >= 0.5 && x.sig).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 3);
      const top = links[0] ? Math.abs(links[0].z) : 0;
      const verdict = n < 3 ? "few" : top >= 1 ? "strong" : top >= 0.5 ? "possible" : "none";
      const cat = parseRowDefect({ ngReason: reason }).category || "";
      return { reason, all, share: (all / totalNg) * 100, n, links, verdict, cat };
    });
  }, [allRejectionRecords, rejectedRows, pool, stats]);

  /* ═════════ CHART OPTIONS ═════════ */

  const driverOption = useMemo(() => {
    if (!drivers.length) return null;
    const lim = Math.max(1, Math.ceil(Math.max(...drivers.map((d) => Math.abs(d.shift))) * 1.25 * 2) / 2);
    return {
      ...baseOption(),
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (p) => {
          const d = drivers[p.dataIndex];
          if (!d) return "";
          const lim2 = limitMap[d.key];
          return tooltipHtml({
            title: `${d.label}${d.unit ? ` (${d.unit})` : ""}`,
            subtitle: d.shift >= 0 ? "NG parts ran higher than OK parts (association, not proof of cause)" : "NG parts ran lower than OK parts (association, not proof of cause)",
            rows: [
              { label: "OK mean", value: `${r2(d.okMean)} ${d.unit}`, color: OUTCOME.ok },
              { label: "NG mean", value: `${r2(d.ngMean)} ${d.unit}`, color: OUTCOME.ng },
              { label: "Shift (σ of OK)", value: `${signed(d.shift)}σ` },
              { label: "Separation (AUC)", value: d.sep.toFixed(2) },
              { label: "p-value", value: fmtP(d.pval) },
              d.share !== null ? { label: "Share of explained scrap", value: `${d.share.toFixed(1)}%` } : null,
              lim2 ? { label: "Set limits", value: lim2.text } : null,
              { label: "Readings OK / NG", value: `${d.ok.length.toLocaleString()} / ${d.ng.length.toLocaleString()}`, strong: false },
            ],
            note: "Click to find this parameter in the comparison grid.",
          });
        },
      },
      grid: { left: 64, right: 16, top: 26, bottom: 8, containLabel: true },
      yAxis: valueAxis({
        min: -lim, max: lim,
        name: "NG shift vs OK mean (σ)", nameTextStyle: { color: INK.muted, fontSize: 11, align: "left" },
        axisLabel: axisLabel({ formatter: (v) => (v > 0 ? `+${v}` : `${v}`) }),
      }),
      xAxis: categoryAxis(drivers.map((d) => d.label), {
        axisLine: { show: false }, axisTick: { show: false }, triggerEvent: true,
        axisLabel: axisLabel({ fontSize: 11, color: INK.secondary, width: narrow ? 70 : 110, overflow: "truncate", interval: 0, rotate: 35 }),
      }),
      series: [{
        type: "bar", barMaxWidth: 34, cursor: "pointer",
        data: drivers.map((d) => ({
          value: r2(d.shift), key: d.key,
          itemStyle: {
            color: d.shift >= 0 ? HIGHER : LOWER, opacity: d.sig ? 1 : 0.35,
            borderRadius: d.shift >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3],
            borderColor: d.key === focusKey ? INK.primary : "transparent", borderWidth: d.key === focusKey ? 1.5 : 0,
          },
          label: { position: d.shift >= 0 ? "top" : "bottom" },
        })),
        label: { show: true, fontSize: 10.5, color: INK.body, fontFamily: FONT_FAMILY, formatter: (p) => `${signed(p.value, 1)}σ` },
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: INK.faint, width: 1 }, data: [{ yAxis: 0 }] },
      }],
    };
  }, [drivers, limitMap, focusKey, narrow]);

  const driverEvents = useMemo(() => ({
    click: (p) => {
      if (p?.data?.key) setFocusKey(p.data.key);
      else if (p?.componentType === "xAxis") setFocusKey(`label:${p.value}`);
    },
  }), []);

  /* ── Anomalies (from the analysis service, else worst-deviating NG parts) ── */
  const outlierRows = useMemo(() => {
    const term = outlierSearch.toLowerCase().trim();
    let sourceList = mlInsights?.topAnomalies || [];
    if (!sourceList.length) {
      const seen = new Set();
      sourceList = [...(allRejectionRecords || []), ...(rejectedRows || [])].filter((r) => {
        const id = idOf(r);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, 200).map((r, idx) => {
        let worstParam = "—", worstDev = 0, worstLimits = "—";
        stats.forEach((s) => {
          const val = readParam(r, s.def);
          if (val !== null && val > 0 && s.okStd > 0) {
            const dev = Math.abs((val - s.okMean) / s.okStd);
            if (dev > worstDev) {
              worstDev = dev;
              worstParam = `${s.label} (${val} ${s.unit}, ${dev.toFixed(1)}σ)`;
              worstLimits = limitMap[s.key] ? limitMap[s.key].text : "Not set";
            }
          }
        });
        return {
          rowKey: `outlier-${idx}`,
          shotNumber: r.shotNumber || r.shot_number || extractShotFromPartId(r.partId || r.part_id || r.id),
          status: "NG",
          createdAtRaw: r.createdAtRaw || r.createdAt || r.shot_datetime || r.timestamp,
          partId: r.partId || r.part_id || r.id,
          customerQrCode: r.customerQrCode || r.customer_qr || r.qr_code,
          machineName: r.machineName || r.machine_name || r.machineCode || "",
          worstDeviatingParam: worstParam,
          worstParamLimits: worstLimits,
          anomalyScore: worstDev > 0 ? worstDev.toFixed(2) : null,
        };
      });
    }
    const recById = new Map();
    (allRejectionRecords || []).forEach((rec) => {
      [rec.partId, rec.part_id, rec.customerQrCode, rec.customer_qr].forEach((k) => { const key = String(k || "").trim(); if (key && !recById.has(key)) recById.set(key, rec); });
    });
    const mapped = sourceList.map((part, idx) => {
      const rec = recById.get(String(part.partId || part.part_id || "").trim()) || recById.get(String(part.customerQrCode || part.customer_qr || "").trim()) || part;
      const pd = parseRowDefect(rec);
      return {
        id: part.rowKey || part.id || `o-${idx}`,
        shot_number: part.shotNumber || part.shot_number || extractShotFromPartId(part.partId) || "—",
        shot_status: part.shot_status || (part.status === "NG" ? "NG" : "OK"),
        shot_datetime: part.createdAtRaw ? formatResultTimestamp(part.createdAtRaw) : part.shot_datetime ? formatResultTimestamp(part.shot_datetime) : part.createdAt || "—",
        barcode: part.traceabilityPartId || part.partId || part.part_id || "",
        customerCode: part.customerQrCode || part.customer_qr || "",
        machine_name: part.machineName || part.machine_name || "",
        rejection_category: pd.category || "—",
        ngReason: pd.reason && pd.reason !== "Defect" ? pd.reason : "—",
        rejection_zone: (!pd.inferred && pd.zone) || "—",
        worstDeviatingParam: part.worstDeviatingParam || "—",
        recipe_limits: part.worstParamLimits || "—",
        anomalyScore: part.anomalyScore ? `${part.anomalyScore} σ` : "—",
      };
    });
    return term ? mapped.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(term))) : mapped;
  }, [mlInsights, outlierSearch, allRejectionRecords, rejectedRows, stats, limitMap]);

  const outlierColumns = useMemo(() => [
    { key: "shot_number", label: "Shot #", width: 90 }, { key: "shot_datetime", label: "Recorded", width: 160, renderAsText: true },
    { key: "barcode", label: "Part serial", width: 170 }, { key: "shot_status", label: "Status", width: 80 },
    { key: "machine_name", label: "Machine", width: 120 }, { key: "rejection_category", label: "Category", width: 100 },
    { key: "ngReason", label: "Defect", width: 170 }, { key: "rejection_zone", label: "Zone", width: 100 },
    { key: "worstDeviatingParam", label: "Primary excursion", width: 240 }, { key: "recipe_limits", label: "Set limits", width: 130 },
    { key: "anomalyScore", label: "Z-score", width: 90 },
  ], []);

  const exportOutliers = async () => {
    if (!outlierRows.length) return;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Anomalies", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = outlierColumns.map((c) => ({ header: c.label, key: c.key, width: Math.round(c.width / 7) }));
    const hr = sheet.getRow(1);
    hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    outlierRows.forEach((d) => sheet.addRow(d));
    saveAs(new Blob([await wb.xlsx.writeBuffer()]), `Root_cause_anomalies_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const topDriver = drivers[0];
  const nSig = drivers.filter((d) => d.sig).length;
  const chart = (opt, h, events) => <EChart option={opt} onEvents={events} style={{ height: h, minHeight: 0, width: "100%" }} />;
  const noParamData = waiting ? <Loading /> : <Empty>Not enough PLC readings for both OK and NG parts in this selection.</Empty>;

  /* ═════════ RENDER ═════════ */
  return (
    <div className="rc-root">
      <style>{CARD_CSS}{`
        .rc-root{display:flex;flex-direction:column;gap:16px;min-width:0;font-family:${FONT_FAMILY}}
        .rc-root *{box-sizing:border-box}
        .rc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
        .rc-kpi-value{font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rc-head-l{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 220px}
        .rc-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:100%}
        .rc-empty{display:flex;align-items:center;justify-content:center;gap:8px;min-height:180px;padding:24px;text-align:center;color:${INK.muted};font-size:13px}
        .rc-spin{animation:rc-spin 1s linear infinite;color:${ACCENT.process}}
        @keyframes rc-spin{to{transform:rotate(360deg)}}
        .rc-select{max-width:100%;min-width:0;padding:6px 10px;border:1px solid ${INK.axis};border-radius:8px;background:#fff;font-size:12px;font-weight:600;color:${INK.secondary}}
        .rc-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;border:1px solid ${INK.axis};background:#fff;font-size:12px;font-weight:600;color:${INK.secondary};cursor:pointer}
        .rc-btn:hover{background:${INK.surfaceAlt}}.rc-btn:disabled{opacity:.5;cursor:default}
        .rc-search{display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid ${INK.axis};border-radius:8px;background:#fff;min-width:0}
        .rc-search input{border:0;outline:0;font-size:12px;width:150px;min-width:0;background:transparent}
        .rc-legend{padding:0 4px 8px}
        .rc-stats{display:flex;flex-wrap:wrap;gap:6px 16px;padding:0 4px 6px;font-size:12px;color:${INK.body}}
        .rc-stats b{color:${INK.primary};font-variant-numeric:tabular-nums;font-weight:600}
        .rc-scroll{overflow-x:auto;overflow-y:hidden}
        .rc-scroll>div{min-width:440px}
        .rc-table{width:100%;border-collapse:collapse;font-size:12px}
        .rc-table th{text-align:left;font-size:10.5px;font-weight:600;color:${INK.muted};text-transform:uppercase;letter-spacing:.05em;padding:8px;border-bottom:1px solid ${INK.border};background:${INK.surfaceAlt};position:sticky;top:0}
        .rc-table td{padding:8px;border-bottom:1px solid ${INK.grid};color:${INK.secondary};vertical-align:middle}
        .rc-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .rc-table tr.tail td{color:${INK.faint}}
        .rc-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
        .rc-cat{display:inline-block;padding:0 7px;border:1px solid;border-radius:999px;font-size:10.5px;font-weight:600;margin-right:6px}
        .rc-bar{display:inline-block;width:44px;height:6px;border-radius:3px;background:${INK.grid};margin-right:8px;vertical-align:1px;overflow:hidden}
        .rc-bar i{display:block;height:100%;border-radius:3px;background:${OUTCOME.ng}}
        .rc-causes{max-height:420px;overflow:auto}
        .rc-cov{display:grid;grid-template-columns:minmax(0,1.3fr) repeat(3,minmax(0,1fr));gap:0;border:1px solid ${INK.border};border-radius:14px;background:#fff;overflow:hidden}
        .rc-cov>div{padding:12px 16px;min-width:0}
        .rc-cov>div+div{border-left:1px solid ${INK.grid}}
        .rc-cov h4{margin:0 0 4px;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:${INK.primary}}
        .rc-cov p{margin:0;font-size:12px;color:${INK.muted};line-height:1.45}
        .rc-cov small{display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${INK.muted}}
        .rc-cov b{display:block;font-size:22px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.2}
        .rc-cov span{font-size:11.5px;color:${INK.muted};font-variant-numeric:tabular-nums}
        @media(max-width:900px){.rc-cov{grid-template-columns:repeat(2,minmax(0,1fr))}.rc-cov>div:nth-child(3){border-left:none}.rc-cov>div:nth-child(n+3){border-top:1px solid ${INK.grid}}}
        .rc-why td{vertical-align:top}
        .rc-why-info{display:flex;align-items:center;gap:8px;margin:0 2px 10px;padding:8px 12px;border-radius:10px;background:#eef3f9;border:1px solid #c9d6e6;font-size:12.5px;color:#1e3a5f}
        .rc-why2{display:flex;flex-direction:column;gap:8px}
        .rc-why-row{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr) auto;gap:10px 16px;align-items:center;padding:10px 12px;border:1px solid ${INK.border};border-left:4px solid var(--v);border-radius:12px;background:#fff}
        .rc-why-row:hover{box-shadow:0 6px 16px -12px rgba(15,23,42,.4)}
        @media(max-width:1000px){.rc-why-row{grid-template-columns:1fr}}
        .rc-why-main{display:flex;flex-direction:column;gap:5px;min-width:0}
        .rc-why-name{display:flex;align-items:center;gap:4px;min-width:0}
        .rc-why-name b{font-size:13.5px;color:${INK.primary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rc-why-count{display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
        .rc-why-count b{font-size:14px;color:${INK.primary}}
        .rc-why-count em{font-style:normal;font-size:11.5px;color:${INK.muted}}
        .rc-why-bar{flex:1;height:6px;border-radius:3px;background:${INK.grid};overflow:hidden;max-width:150px}
        .rc-why-bar i{display:block;height:100%;border-radius:3px}
        .rc-why-shot{font-size:11px;color:${INK.faint}}
        .rc-why-params{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
        .rc-pchip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 6px;border-radius:999px;border:1px solid color-mix(in srgb,var(--c) 40%,#fff);background:color-mix(in srgb,var(--c) 7%,#fff);font:inherit;font-size:12px;cursor:pointer;color:${INK.primary}}
        .rc-pchip:hover{border-color:var(--c)}
        .rc-pchip .dir{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--c);color:#fff;font-weight:800;font-size:11px}
        .rc-pchip .nm{font-weight:600}
        .rc-pchip b{color:var(--c);font-variant-numeric:tabular-nums}
        .rc-pchip .sig{color:${OUTCOME.ng};font-weight:800;letter-spacing:-1px}
        .rc-pchip .vals{color:${INK.muted};font-size:11px;font-variant-numeric:tabular-nums}
        .rc-why-none{font-size:12px;color:${INK.faint}}
        .rc-verdict{border:1px solid}
        .rc-why-legend{font-size:11px;color:${INK.muted};padding:2px 4px}
        .rc-link{display:inline-flex;align-items:center;gap:5px;margin:0 6px 4px 0;padding:2px 8px;border-radius:999px;border:1px solid;font-size:11.5px;font-weight:600;white-space:nowrap;cursor:pointer;background:#fff}
        .rc-verdict{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap}
        .rc-grid-bar{display:flex;justify-content:space-between;align-items:center;gap:8px 16px;flex-wrap:wrap;padding:0 4px 10px}
        .rc-seg{display:inline-flex;flex-wrap:wrap;gap:3px;padding:3px;border-radius:10px;background:${INK.grid}}
        .rc-seg button{border:none;background:transparent;border-radius:7px;padding:5px 10px;font:inherit;font-size:12px;font-weight:600;color:${INK.body};cursor:pointer;white-space:nowrap}
        .rc-seg button span{opacity:.65;font-weight:700;margin-left:2px}
        .rc-seg button.on{background:#0f2a4a;color:#fff}
        .rc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
        .rc-tile{display:flex;flex-direction:column;gap:4px;border:1px solid ${INK.border};border-top:3px solid var(--tile-c);border-radius:12px;background:#fff;padding:9px 10px 8px;min-width:0;scroll-margin:120px}
        .rc-tile.focus{box-shadow:0 0 0 2px #0f2a4a}
        .rc-tile header{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
        .rc-tile h4{margin:0;font-size:12.5px;font-weight:700;color:${INK.primary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rc-tile h4 span{font-weight:500;color:${INK.muted}}
        .rc-tile-tag{display:inline-block;margin-top:2px;font-size:10.5px;font-weight:700;color:var(--tile-c);text-transform:uppercase;letter-spacing:.04em}
        .rc-tile-shift{display:flex;flex-direction:column;align-items:flex-end;line-height:1.15;flex-shrink:0}
        .rc-tile-shift b{font-size:14px;font-variant-numeric:tabular-nums}
        .rc-tile-shift span{font-size:10.5px;color:${INK.muted};white-space:nowrap}
        .rc-tile-body{height:120px}
        .rc-tile-msg{height:100%;display:grid;place-items:center;text-align:center;font-size:12px;color:${INK.muted};background:${INK.surfaceAlt};border-radius:8px;padding:8px;line-height:1.5}
        .rc-skel{background:linear-gradient(90deg,${INK.grid} 25%,${INK.surfaceAlt} 50%,${INK.grid} 75%);background-size:200% 100%;animation:rc-shimmer 1.4s ease-in-out infinite}
        @keyframes rc-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .rc-tile footer{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11px;color:${INK.body};font-variant-numeric:tabular-nums}
        .rc-tile footer i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
        .rc-tile footer em{font-style:normal;color:${INK.faint}}
        .rc-tile footer .lim{color:${INK.secondary}}
        .rc-tile footer .muted{color:${INK.faint}}
        @media(max-width:640px){
          .rc-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
          .rc-kpi-value{font-size:17px}
          .rc-hide-sm{display:none}
          .rc-search input{width:110px}
          .ra-card-body{padding:4px 8px 12px}
          .ra-card-head{padding:12px 12px 8px}
        }
      `}</style>

      {/* ── Analysed parts (DCM shot data only) ── */}
      <section className="rc-cov" aria-label="Parts analysed">
        <div>
          <h4><Database size={15} color={ACCENT.process} />Analysis uses parts with DCM shot data only</h4>
          <p>Process parameters and the cycle time come from the part's own shot record (PlcCycleReadings — cycle time of that shot, not the laser-marking log). Parts without shot details are excluded.</p>
        </div>
        <div>
          <small>Analysed — OK parts</small>
          <b style={{ color: OUTCOME.ok }}>{waiting ? "—" : counts.ok.toLocaleString()}</b>
          <span>{analysis?.population ? `sample of ${analysis.population.okWithShot.toLocaleString()} OK with shot data` : "with shot data"}</span>
        </div>
        <div>
          <small>Analysed — NG parts</small>
          <b style={{ color: OUTCOME.ng }}>{waiting ? "—" : counts.ng.toLocaleString()}</b>
          <span>{analysis?.population ? `rejected at a station (incl. still on the line) · ${analysis.population.ngWithShot.toLocaleString()} finished NG have shot data` : "with shot data"}</span>
        </div>
        <div>
          <small>Excluded — no shot data</small>
          <b style={{ color: ACCENT.warning }}>{analysis?.population ? (analysis.population.okExcluded + analysis.population.ngExcluded).toLocaleString() : (excludedNg + excludedOk).toLocaleString()}</b>
          <span>{analysis?.population ? `${analysis.population.okExcluded.toLocaleString()} OK · ${analysis.population.ngExcluded.toLocaleString()} NG of ${(analysis.population.okTotal + analysis.population.ngTotal).toLocaleString()} finished parts` : `${excludedNg.toLocaleString()} NG records without a shot record`}</span>
        </div>
      </section>

      {/* ── What is the reason of rejection? reason ↔ process parameters ── */}
      <Card color={ACCENT.ng} icon={<HelpCircle size={16} />} title="Why are parts rejected? — reason ↔ process parameters"
        sub="Top rejection reasons with the process parameters their NG parts ran off (vs OK parts, in σ of OK parts; only significant shifts, p < 0.05). Association, not proof of cause — confirm with a trial. Click a parameter to see it below.">
        <div className="rc-why-info">
          <Database size={14} aria-hidden="true" />
          <span>Analysis uses parts with DCM shot data only — <b style={{ color: OUTCOME.ok }}>{counts.ok.toLocaleString()} OK</b> / <b style={{ color: OUTCOME.ng }}>{counts.ng.toLocaleString()} NG</b> analysed,
            {" "}<b>{(analysis?.population ? analysis.population.okExcluded + analysis.population.ngExcluded : excludedNg + excludedOk).toLocaleString()}</b> excluded (no shot record)</span>
        </div>
        {!whyRows ? (waiting ? <Loading /> : <Empty>No rejection reasons in this selection.</Empty>) : (
          <div className="rc-why2">
            {whyRows.map((w) => {
              const V = { strong: ["Process-related", OUTCOME.ng], possible: ["Possibly process-related", STATUS.warning], none: ["Not process-related", INK.muted], few: ["Too few shot records", INK.faint] }[w.verdict];
              const maxShare = whyRows[0]?.share || 1;
              return (
                <div key={w.reason} className="rc-why-row" style={{ "--v": V[1] }}>
                  <div className="rc-why-main">
                    <div className="rc-why-name">
                      {w.cat && <span className="rc-cat" style={{ color: DEFECT_CATEGORY[w.cat] || INK.body, borderColor: DEFECT_CATEGORY[w.cat] || INK.border }}>{w.cat}</span>}
                      <b title={w.reason}>{w.reason}</b>
                    </div>
                    <div className="rc-why-count">
                      <span className="rc-why-bar"><i style={{ width: `${(w.share / maxShare) * 100}%`, background: DEFECT_CATEGORY[w.cat] || OUTCOME.ng }} /></span>
                      <b>{w.all.toLocaleString()}</b><em>{w.share.toFixed(1)}%</em>
                    </div>
                    <span className="rc-why-shot" title="NG parts of this reason that have DCM shot data (analysed)">{w.n.toLocaleString()} with shot data</span>
                  </div>
                  <div className="rc-why-params">
                    {w.links.length ? w.links.map((l) => {
                      const up = l.z >= 0;
                      const col = up ? HIGHER : LOWER;
                      const stars = Number.isFinite(l.pv) ? (l.pv < 0.001 ? "***" : l.pv < 0.01 ? "**" : "*") : "";
                      return (
                        <button type="button" key={l.key} className="rc-pchip" style={{ "--c": col }} onClick={() => setFocusKey(l.key)}
                          title={`${l.label}: NG parts with ${w.reason} ${r2(l.mu)} vs OK ${r2(l.okMean)} ${l.unit} (n=${l.n}, p ${fmtP(l.pv)})`}>
                          <span className="dir">{up ? "↑" : "↓"}</span>
                          <span className="nm">{l.label}</span>
                          <b>{signed(l.z, 1)}σ</b>
                          <span className="sig" title="Significance: * p<0.05 · ** p<0.01 · *** p<0.001">{stars}</span>
                          <span className="vals">{r2(l.mu)} vs {r2(l.okMean)}{l.unit ? ` ${l.unit}` : ""}</span>
                        </button>
                      );
                    }) : <span className="rc-why-none">No process parameter clearly different from OK parts</span>}
                  </div>
                  <span className="rc-verdict" style={{ color: V[1], background: withAlpha(V[1], 0.1), borderColor: withAlpha(V[1], 0.35) }}>{V[0]}</span>
                </div>
              );
            })}
            <div className="rc-why-legend">↑ / ↓ = NG parts ran higher / lower than OK parts · σ = shift in standard deviations of OK parts · * p &lt; 0.05 · ** p &lt; 0.01 · *** p &lt; 0.001 · association, not proof of cause</div>
          </div>
        )}
      </Card>

      {/* ── 1. Ranked process drivers ── */}
      <Card color={ACCENT.process} icon={<Zap size={16} />} title="Top process drivers of NG"
        sub={drivers.length ? `NG mean vs OK mean in σ of OK parts · ${nSig} of ${drivers.length} significant (p < 0.05)${influence ? ` · process parameters explain about ${pct(influence.explained, 0)} of the NG variation` : ""}${topDriver ? ` · strongest: ${topDriver.label}` : ""} · association, not proof — verify with a trial · click a bar to see its distribution below` : "NG mean vs OK mean, in σ of good parts"}>
        {!driverOption ? noParamData : (
          <>
            <div className="ra-legend rc-legend">
              <span><i style={{ background: HIGHER }} />Higher in NG</span>
              <span><i style={{ background: LOWER }} />Lower in NG</span>
              <span><i style={{ background: withAlpha(INK.muted, 0.35) }} />Faded = not significant</span>
            </div>
            {chart(driverOption, 380, driverEvents)}
          </>
        )}
      </Card>

      {/* ── 2. Every parameter side by side ── */}
      <Card color={ACCENT.process} icon={<Waves size={16} />} title="OK vs NG distribution of the drivers"
        sub={`Parameters associated with NG (switch to see all ${ALL_45_PARAMETERS.length}) · green = OK parts, red = NG parts · dashed = set limits · ${counts.ok.toLocaleString()} OK and ${counts.ng.toLocaleString()} NG parts`}>
        <ParamGrid items={gridItems} focusKey={focusKey} waiting={waiting && loading} />
      </Card>

      {/* ── 4. Anomalies ── */}
      <Card color={ACCENT.ng} icon={<ShieldAlert size={16} />} title="NG parts with the largest process excursion"
        sub={`${outlierRows.length.toLocaleString()} NG parts with their largest parameter excursion`}
        actions={<>
          <div className="rc-search"><Search size={14} color={INK.faint} /><input aria-label="Search anomalies" placeholder="Search…" value={outlierSearch} onChange={(e) => setOutlierSearch(e.target.value)} /></div>
          <button type="button" className="rc-btn" onClick={exportOutliers} disabled={!outlierRows.length}><Download size={14} /> Export</button>
        </>}>
        <RejectionTable columns={outlierColumns} rows={outlierRows} loading={loading} defaultPageSize={25} pageSizeOptions={[25, 50, 100, 250]} />
      </Card>
    </div>
  );
}
