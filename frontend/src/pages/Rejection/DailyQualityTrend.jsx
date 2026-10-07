import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Layers, ChevronRight, CalendarDays, CalendarRange, ArrowLeft } from "lucide-react";
import { dashboardApi } from "../../api/services";
import EChart from "../../components/charts/EChart";
import { Head } from "./components/DailyCardParts";
import { parseRowDefect } from "./rejectionConstants";
import {
  OUTCOME, INK, OTHER, FONT_FAMILY, ACCENT, LEGEND, SHIFT, DEFECT_CATEGORY,
  ECHART_TOOLTIP, tooltipHtml, baseOption, valueAxis, categoryAxis, axisLabel, axisName, accent,
  shiftKey, fmtInt, fmtPct, CARD_CSS,
} from "./chartTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   Production output (final OK vs NG) and scrap by defect category — drill-down by period

   Levels: Monthly → Daily (production day 06:00 → 06:00) → Hourly (one production day, 24 plant-time hours with
   the Shift Management bands drawn underneath). Clicking a bar opens the next level; the breadcrumb goes back.

   Day rule (server side, same as every total on the page): the deciding time is the part's first scan; with a
   station filter that station's latest scan; with leak test the leak result time. OK = final pass and not NG,
   NG = any station NG or leak NG, in process = the rest. NG parts are split by station / category from the NG
   records already loaded, each placed in the server's day (or hour) for that part, so splits add up.
   ═══════════════════════════════════════════════════════════════════════════ */

const CATS = ["CR", "CRAM", "MR"];
const UNCAT = "Not categorised";
const SHIFT_KEYS = ["A", "B", "C", "Unassigned"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pctOf = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);
const parseDay = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLabel = (k) => { const d = parseDay(k); return d ? `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}` : k; };
const monthLabel = (k) => { const [y, m] = String(k).split("-"); return `${MONTHS[Number(m) - 1]} ${y}`; };
const longDay = (k) => parseDay(k)?.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) || k;
const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
const hms = (sec) => `${String(Math.floor(sec / 3600) % 24).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;
const emptyBucket = (key, label) => ({ key, label, produced: 0, ok: 0, ng: 0, wip: 0, shifts: {}, st: {}, cat: {} });
const addTo = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const shiftLabel = (s) => (s === "Unassigned" ? "Unassigned" : `Shift ${s}`);

const INFO = {
  output: {
    title: "Production output — final OK vs NG",
    what: "Each bar is one period: green = parts that passed final inspection, red = rejected parts stacked on top; the dashed line is the NG % of completed parts. Click a month to open its days, and a day to open its 24 hours (06:00 → 06:00) with the shift bands underneath.",
    formula: ["Production day D = D 06:00:00 → D+1 06:00:00 (IST)", "NG % = NG ÷ (OK + NG) × 100", "FPY = OK ÷ (OK + NG) × 100", "Produced = OK + NG + in process"],
    note: "A part is placed by its first scan (by the station scan with a station filter, by the leak result with leak test). Parts still in process are not in OK or NG.",
  },
  station: {
    title: "NG by station",
    what: "Rejected parts per period, stacked by the station that rejected them; the label on top is the total NG and the labels inside are each station's count. Use it to see which station drives a bad day or hour. Click a bar to drill down.",
    formula: ["Station share = station NG ÷ period NG × 100", "Rejecting station = the first station that flagged the part NG"],
  },
  category: {
    title: "Scrap by defect category",
    what: "Rejected parts per period split into CR (casting rejection), CRAM (casting rejection found after machining, incl. leak test) and MR (machining rejection). The label on top is the total NG and its NG %; the table lists final passed, NG and each category with its % of checked parts.",
    formula: ["Category % = category NG ÷ (Final passed + NG) × 100", "NG % = NG ÷ (Final passed + NG) × 100", "Share of NG = category NG ÷ NG × 100"],
    note: "Leak-test rejects count as CRAM. NG parts without a loaded record show as \"Not categorised\".",
  },
};

const CSS = `
.dqt-crumb{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:12px;color:${INK.muted};margin:0 4px 10px}
.dqt-crumb button{border:none;background:none;padding:0;color:${ACCENT.process};font-weight:600;cursor:pointer;font-size:12px}
.dqt-crumb b{color:${INK.primary};font-weight:700}
.dqt-back{display:inline-flex;align-items:center;gap:5px;border:1px solid ${INK.border} !important;background:#fff !important;border-radius:8px;padding:3px 9px !important;color:${INK.secondary} !important;margin-right:6px}
.dqt-kpis{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 4px 10px;font-size:12px;color:${INK.body};font-variant-numeric:tabular-nums}
.dqt-kpis b{color:${INK.primary};font-weight:700}
.dqt-shiftstrip{position:relative;height:30px;margin:2px 0 4px}
.dqt-shiftstrip div{position:absolute;top:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:6px;font-size:11px;line-height:1.2;color:${INK.primary};font-variant-numeric:tabular-nums;overflow:hidden;white-space:nowrap}
.dqt-shiftstrip div b{font-weight:700}
.dqt-shiftstrip div span{font-size:10px;color:${INK.secondary}}
.dqt-table-wrap{overflow-x:auto;margin:10px 4px 0;max-height:360px;overflow-y:auto}
.dqt-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
.dqt-table th{position:sticky;top:0;background:#fff;font-size:11px;font-weight:600;color:${INK.muted};text-transform:uppercase;letter-spacing:.05em;text-align:right;padding:7px 9px;border-bottom:1px solid ${INK.border};white-space:nowrap}
.dqt-table td{padding:6px 9px;text-align:right;border-bottom:1px solid ${INK.grid};color:${INK.secondary};white-space:nowrap}
.dqt-table th:first-child,.dqt-table td:first-child{text-align:left}
.dqt-table td em{font-style:normal;color:${INK.muted};margin-left:4px;font-size:11px}
.dqt-table tbody tr.clickable{cursor:pointer}
.dqt-table tbody tr.clickable:hover td{background:${INK.surfaceAlt}}
.dqt-table tfoot td{font-weight:700;color:${INK.primary};border-top:1px solid ${INK.border};border-bottom:none;position:sticky;bottom:0;background:#fff}
.dqt-toggle{margin:10px 4px 0;border:1px solid ${INK.border};background:#fff;border-radius:8px;padding:6px 11px;font-size:12px;font-weight:600;color:${INK.secondary};cursor:pointer}
.dqt-toggle:hover{background:${INK.surfaceAlt}}
.dqt-note{margin:8px 4px 0;font-size:11.5px;color:${INK.muted}}
`;

/* Used outside the Rejection page (e.g. the Dashboard): the card brings the few page styles it relies on */
const STANDALONE_CSS = `
.dqt-standalone .rej-header-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dqt-standalone .rej-tab-group{display:flex;gap:4px;background:#f1f5f9;padding:4px;border-radius:10px;border:1px solid #e2e8f0;flex-wrap:wrap}
.dqt-standalone .rej-tab-pill{padding:6px 14px;font-size:11.5px;font-weight:700;border-radius:8px;border:none;background:transparent;color:#475569;cursor:pointer;white-space:nowrap}
.dqt-standalone .rej-tab-pill:hover{color:#0f172a;background:rgba(0,0,0,.04)}
.dqt-standalone .rej-tab-pill.active{background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;box-shadow:0 3px 10px rgba(37,99,235,.3)}
.dqt-standalone .qg-empty{display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;color:#64748b;font-size:12.5px}
.dqt-standalone .qg-scroll{overflow-x:auto;overflow-y:hidden}
`;

/* Bucket a server response (rows per period × shift) and spread the NG records over the same periods. */
function aggregate(rows, ngParts, ngRecs, stationOf, keyOfRow, keyOfPart, labelOf) {
  const out = {};
  (rows || []).forEach((r) => {
    const k = keyOfRow(r);
    if (k == null) return;
    const b = out[k] || (out[k] = emptyBucket(k, labelOf(k)));
    const sk = shiftKey(r.shift);
    const s = b.shifts[sk] || (b.shifts[sk] = { produced: 0, ok: 0, ng: 0, wip: 0 });
    ["produced", "ok", "ng", "wip"].forEach((f) => { b[f] += r[f]; s[f] += r[f]; });
  });
  const where = new Map();
  (ngParts || []).forEach((p) => {
    const k = keyOfPart(p);
    if (k == null) return;
    const [id, pid, qr] = p;
    if (id != null) where.set(`id:${id}`, k);
    if (pid) where.set(`k:${pid}`, k);
    if (qr) where.set(`k:${qr}`, k);
  });
  let matched = 0;
  const seen = new Set();
  (ngRecs || []).forEach((r) => {
    const k = where.get(`id:${r.id}`) ?? where.get(`k:${r.part_id || r.partId}`) ?? where.get(`k:${r.customer_qr || r.customerQrCode}`);
    if (k == null || !out[k]) return;
    const uid = r.id ?? `${r.part_id}|${r.customer_qr}`;
    if (seen.has(uid)) return;
    seen.add(uid);
    matched += 1;
    const p = parseRowDefect(r);
    addTo(out[k].st, (stationOf && stationOf(r)) || "Not recorded");
    addTo(out[k].cat, CATS.includes(p.category) ? p.category : UNCAT);
  });
  Object.values(out).forEach((b) => {
    const catSum = Object.values(b.cat).reduce((a, n) => a + n, 0);
    if (b.ng > catSum) addTo(b.cat, UNCAT, b.ng - catSum);
  });
  return { out, matched, ngTotal: Object.values(out).reduce((a, b) => a + b.ng, 0) };
}

/** Builds the two drill-down cards from one data load; the page places them where it wants. */
export function useDailyQualityCards({
  filters = {}, ngRecs = [], stationOf, stationLabelOf = (c) => c, stationColor = () => OTHER, stationOrder = [],
  title = "Production output — final OK vs NG",
  standalone = false,
}) {
  const [data, setData] = useState(null);
  const [hourData, setHourData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hourLoading, setHourLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(null); // "day" | "month" (null = automatic)
  const [month, setMonth] = useState(null); // "YYYY-MM" opened from the monthly view
  const [day, setDay] = useState(null); // "YYYY-MM-DD" opened to hours
  const [view, setView] = useState("output"); // "output" | "station"
  const [showTable, setShowTable] = useState(false);
  const hasRecords = (ngRecs || []).length > 0;

  const baseQuery = useMemo(() => {
    const q = {};
    ["datePreset", "dateFrom", "dateTo", "shiftCode", "machineName", "qualityGate", "partName", "partCategory", "dieName"]
      .forEach((k) => { if (filters[k]) q[k] = filters[k]; });
    if (filters.datePreset === "all") q.allTime = "1";
    if (filters.status && filters.status !== "ALL") q.status = filters.status;
    return q;
  }, [filters]);

  /* ── Period totals (one row per production day × shift) ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      setMonth(null);
      setDay(null);
      try {
        const res = await dashboardApi.rejectionDaily({ ...baseQuery, noCache: "1", _ts: Date.now() }, { timeout: 30000, suppressGlobalError: true });
        if (!cancelled) setData(res?.success ? res : null);
      } catch (err) {
        if (!cancelled) { setData(null); setError(err?.message || "Could not load totals"); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [baseQuery]);

  /* ── Hours of one production day (only when a day is opened) ── */
  useEffect(() => {
    if (!day) return undefined;
    let cancelled = false;
    (async () => {
      setHourLoading(true);
      try {
        const q = { ...baseQuery, dateFrom: day, dateTo: day, granularity: "hour", noCache: "1", _ts: Date.now() };
        delete q.datePreset; delete q.allTime;
        const res = await dashboardApi.rejectionDaily(q, { timeout: 30000, suppressGlobalError: true });
        if (!cancelled) setHourData(res?.success ? res : null);
      } catch {
        if (!cancelled) setHourData(null);
      } finally {
        if (!cancelled) setHourLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [day, baseQuery]);

  const dayStartHour = Math.round((data?.dayRule?.dayStart ?? 21600) / 3600);
  const shiftDefs = data?.shiftDefs || [];

  /* ── Daily buckets ── */
  const daily = useMemo(() => {
    if (!data?.days?.length) return null;
    const agg = aggregate(data.days, data.ngParts, ngRecs, stationOf, (r) => r.day, (p) => p[3], dayLabel);
    return { ...agg, keys: Object.keys(agg.out).sort() };
  }, [data, ngRecs, stationOf]);

  /* ── Hourly buckets for the opened day (24 hours from the day start) ── */
  const hourly = useMemo(() => {
    if (!day || !hourData?.days) return null;
    const agg = aggregate(hourData.days, hourData.ngParts, ngRecs, stationOf, (r) => r.hour, (p) => p[5], (h) => hh(h));
    const order = Array.from({ length: 24 }, (_, i) => (dayStartHour + i) % 24);
    return { ...agg, list: order.map((h) => ({ ...(agg.out[h] || emptyBucket(h, hh(h))), isHour: true })) };
  }, [day, hourData, ngRecs, stationOf, dayStartHour]);

  const autoMode = daily && daily.keys.length > 45 ? "month" : "day";
  const effMode = mode || autoMode;
  const level = day ? "hour" : effMode === "month" && !month ? "month" : "day";

  /* ── Buckets for the current level ── */
  const buckets = useMemo(() => {
    if (level === "hour") return hourly?.list || [];
    if (!daily) return [];
    const { out: days, keys } = daily;
    if (level === "month") {
      const out = {};
      keys.forEach((k) => {
        const m = k.slice(0, 7);
        const b = out[m] || (out[m] = { ...emptyBucket(m, monthLabel(m)), isMonth: true, d1: k, d2: k });
        if (k < b.d1) b.d1 = k;
        if (k > b.d2) b.d2 = k;
        b.range = `${dayLabel(b.d1)} – ${dayLabel(b.d2)}`;
        const d = days[k];
        ["produced", "ok", "ng", "wip"].forEach((f) => { b[f] += d[f]; });
        Object.entries(d.shifts).forEach(([sk, s]) => {
          const t = b.shifts[sk] || (b.shifts[sk] = { produced: 0, ok: 0, ng: 0, wip: 0 });
          ["produced", "ok", "ng", "wip"].forEach((x) => { t[x] += s[x]; });
        });
        ["st", "cat"].forEach((f) => Object.entries(d[f]).forEach(([k2, n]) => addTo(b[f], k2, n)));
      });
      return Object.keys(out).sort().map((m) => out[m]);
    }
    const inRange = month ? keys.filter((k) => k.startsWith(month)) : keys;
    if (!inRange.length) return [];
    const list = [];
    const end = parseDay(inRange[inRange.length - 1]);
    for (let d = parseDay(inRange[0]); d <= end && list.length < 1000; d.setDate(d.getDate() + 1)) {
      const k = dayKey(d);
      list.push(days[k] || emptyBucket(k, dayLabel(k)));
    }
    return list;
  }, [level, hourly, daily, month]);

  const totals = useMemo(() => buckets.reduce((t, b) => ({
    produced: t.produced + b.produced, ok: t.ok + b.ok, ng: t.ng + b.ng, wip: t.wip + b.wip,
    cat: Object.fromEntries([...CATS, UNCAT].map((c) => [c, (t.cat[c] || 0) + (b.cat[c] || 0)])),
  }), { produced: 0, ok: 0, ng: 0, wip: 0, cat: {} }), [buckets]);

  const stations = useMemo(() => {
    const present = new Set(buckets.flatMap((b) => Object.keys(b.st)));
    return [...stationOrder.filter((c) => present.has(c)), ...[...present].filter((c) => !stationOrder.includes(c))];
  }, [buckets, stationOrder]);

  const many = buckets.length > 31;
  const labelsOn = buckets.length <= 31;

  /* ── Click: month → its days; day → its hours ── */
  // ECharts binds click handlers once, so the handler reads the current buckets through a ref
  const clickRef = useRef(() => {});
  useEffect(() => {
    clickRef.current = (p) => {
      const b = buckets[p?.dataIndex];
      if (!b || b.isHour) return;
      if (b.isMonth) { setMonth(b.key); return; }
      if (b.produced > 0) { setHourData(null); setDay(b.key); }
    };
  }, [buckets]);
  const onEvents = useMemo(() => ({ click: (p) => clickRef.current(p) }), []);

  const titleOf = (b) => (b.isMonth ? `${b.label} (${b.range})` : b.isHour ? `${longDay(day)} · ${b.label} – ${hh(b.key + 1)}` : longDay(b.key));
  const clickHint = (b) => (b.isMonth ? "Click to open the days of this month." : b.isHour ? "" : b.produced > 0 ? "Click to open this day hour by hour." : "");
  const xLabels = buckets.map((b) => (b.isMonth ? `${b.label}\n${b.range}` : b.label));
  const axisPointer = { type: "shadow", shadowStyle: { color: "rgba(15,23,42,0.05)" } };

  /* Tooltip of the OK vs NG view: the output of the period only (stations are in the "NG by station" view) */
  const richTip = (b) => {
    const done = b.ok + b.ng;
    return tooltipHtml({
      title: titleOf(b),
      rows: [
        { label: "Produced", value: fmtInt(b.produced) },
        { label: "Final OK", value: fmtInt(b.ok), color: OUTCOME.ok },
        { label: "NG", value: `${fmtInt(b.ng)} · ${fmtPct(pctOf(b.ng, done), 2)}`, color: OUTCOME.ng },
        { label: "In process", value: fmtInt(b.wip), color: OUTCOME.wip },
        { label: "First-pass yield", value: fmtPct(pctOf(b.ok, done), 2) },
      ],
      note: clickHint(b),
    });
  };

  /* ── Chart 1: final OK vs NG — one bar per period ── */
  const outputOption = useMemo(() => {
    if (!buckets.length) return null;
    const ngPct = buckets.map((b) => { const v = pctOf(b.ng, b.ok + b.ng); return v == null ? null : Number(v.toFixed(2)); });
    const maxPct = Math.max(1, ...ngPct.filter((v) => v != null));
    const maxDone = Math.max(1, ...buckets.map((b) => b.ok + b.ng));
    return baseOption({
      grid: { left: 58, right: 54, top: 64, bottom: many ? 74 : 40 },
      legend: { ...LEGEND, left: 0, right: "auto", data: ["Final OK", "NG", "NG %"] },
      tooltip: { ...ECHART_TOOLTIP, trigger: "axis", axisPointer, formatter: (ps) => { const b = buckets[(Array.isArray(ps) ? ps[0] : ps)?.dataIndex]; return b ? richTip(b) : ""; } },
      xAxis: categoryAxis(xLabels, { axisLabel: axisLabel({ hideOverlap: true, lineHeight: 14, fontSize: 11, color: INK.secondary }) }),
      yAxis: [
        valueAxis({ ...axisName("Parts", 40), minInterval: 1 }),
        valueAxis({ ...axisName("NG %", 40), position: "right", min: 0, max: Math.ceil(maxPct * 1.25), splitLine: { show: false }, axisLabel: axisLabel({ formatter: (v) => `${v}%` }) }),
      ],
      dataZoom: many ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 10 }] : undefined,
      series: [
        {
          type: "bar", name: "Final OK", stack: "out", barMaxWidth: 36, cursor: level === "hour" ? "default" : "pointer", itemStyle: { color: OUTCOME.ok },
          label: { show: labelsOn, position: "inside", fontSize: 10.5, fontWeight: 700, color: "#ffffff", fontFamily: FONT_FAMILY, formatter: (p) => (p.value > 0 && p.value >= maxDone * 0.12 ? fmtInt(p.value) : "") },
          labelLayout: { hideOverlap: true },
          data: buckets.map((b) => b.ok),
        },
        {
          type: "bar", name: "NG", stack: "out", barMaxWidth: 36, barMinHeight: 2, cursor: level === "hour" ? "default" : "pointer",
          itemStyle: { color: OUTCOME.ng, borderRadius: [3, 3, 0, 0] },
          label: {
            show: labelsOn, position: "top", distance: 4, fontFamily: FONT_FAMILY, lineHeight: 14,
            formatter: (p) => { const b = buckets[p.dataIndex]; return b && b.ok + b.ng > 0 ? `{t|${fmtInt(b.ok + b.ng)}}\n{n|NG ${fmtInt(b.ng)}}` : ""; },
            rich: { t: { fontSize: 11, fontWeight: 700, color: INK.primary, fontFamily: FONT_FAMILY }, n: { fontSize: 10.5, fontWeight: 700, color: OUTCOME.ng, fontFamily: FONT_FAMILY } },
          },
          data: buckets.map((b) => b.ng),
        },
        { type: "line", name: "NG %", yAxisIndex: 1, data: ngPct, z: 5, symbol: "circle", symbolSize: 5, connectNulls: false, lineStyle: { color: INK.primary, width: 1.6, type: "dashed", opacity: 0.75 }, itemStyle: { color: INK.primary } },
      ],
    });
  }, [buckets, many, labelsOn, level, xLabels.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Chart 1b: NG by station — segment counts inside, total on top ── */
  const stationOption = useMemo(() => {
    if (!buckets.length || !stations.length) return null;
    const maxNg = Math.max(1, ...buckets.map((b) => b.ng));
    return baseOption({
      grid: { left: 58, right: 18, top: 56, bottom: many ? 74 : 40 },
      legend: { ...LEGEND, left: 0, right: "auto", data: stations.map(stationLabelOf), textStyle: { fontSize: 11.5, color: INK.secondary, fontFamily: FONT_FAMILY } },
      tooltip: { ...ECHART_TOOLTIP, trigger: "axis", axisPointer, formatter: (ps) => {
        const b = buckets[(Array.isArray(ps) ? ps[0] : ps)?.dataIndex];
        if (!b) return "";
        return tooltipHtml({
          title: titleOf(b),
          subtitle: `${fmtInt(b.ng)} NG of ${fmtInt(b.ok + b.ng)} completed · NG ${fmtPct(pctOf(b.ng, b.ok + b.ng), 2)}`,
          rows: stations.filter((c) => b.st[c]).sort((x, y) => b.st[y] - b.st[x]).map((c) => ({ label: stationLabelOf(c), value: `${fmtInt(b.st[c])} · ${fmtPct(pctOf(b.st[c], b.ng), 0)}`, color: stationColor(c) })),
          note: clickHint(b),
        });
      } },
      xAxis: categoryAxis(xLabels, { axisLabel: axisLabel({ hideOverlap: true, lineHeight: 14, fontSize: 11, color: INK.secondary }) }),
      yAxis: valueAxis({ ...axisName("NG parts", 40), minInterval: 1 }),
      dataZoom: many ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 10 }] : undefined,
      series: [
        ...stations.map((c) => ({
          type: "bar", name: stationLabelOf(c), stack: "ng", barMaxWidth: 36, cursor: level === "hour" ? "default" : "pointer",
          itemStyle: { color: stationColor(c) }, emphasis: { focus: "series" },
          label: { show: labelsOn, position: "inside", fontSize: 10.5, fontWeight: 700, color: "#ffffff", fontFamily: FONT_FAMILY, formatter: (p) => (p.value > 0 && p.value >= maxNg * 0.1 ? fmtInt(p.value) : "") },
          labelLayout: { hideOverlap: true },
          data: buckets.map((b) => b.st[c] || 0),
        })),
        {
          type: "bar", name: "Total", stack: "ng", silent: true, tooltip: { show: false }, itemStyle: { color: "transparent" },
          label: { show: true, position: "top", distance: 4, fontSize: 11, fontWeight: 700, color: OUTCOME.ng, fontFamily: FONT_FAMILY, formatter: (p) => (buckets[p.dataIndex]?.ng ? `NG ${fmtInt(buckets[p.dataIndex].ng)}` : "") },
          data: buckets.map(() => 0),
        },
      ],
    });
  }, [buckets, stations, many, labelsOn, level, stationLabelOf, stationColor, xLabels.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Chart 2: NG by defect category ── */
  const catKeys = useMemo(() => [...CATS, ...(totals.cat[UNCAT] ? [UNCAT] : [])], [totals]);
  const catColor = (c) => (c === UNCAT ? OTHER : DEFECT_CATEGORY[c]);
  const categoryOption = useMemo(() => {
    if (!buckets.length || !totals.ng) return null;
    const maxNg = Math.max(1, ...buckets.map((b) => b.ng));
    return baseOption({
      grid: { left: 58, right: 18, top: 64, bottom: many ? 74 : 40 },
      legend: { ...LEGEND, left: 0, right: "auto", data: catKeys },
      tooltip: { ...ECHART_TOOLTIP, trigger: "axis", axisPointer, formatter: (ps) => {
        const b = buckets[(Array.isArray(ps) ? ps[0] : ps)?.dataIndex];
        if (!b) return "";
        const done = b.ok + b.ng;
        return tooltipHtml({
          title: titleOf(b),
          rows: [
            { label: "Final passed", value: fmtInt(b.ok), color: OUTCOME.ok },
            { label: "Total NG", value: `${fmtInt(b.ng)} · ${fmtPct(pctOf(b.ng, done), 2)}`, color: OUTCOME.ng },
            ...catKeys.filter((c) => b.cat[c]).map((c) => ({ label: c, color: catColor(c), value: `${fmtInt(b.cat[c])} · ${fmtPct(pctOf(b.cat[c], done), 2)} of checked · ${fmtPct(pctOf(b.cat[c], b.ng), 0)} of NG` })),
          ],
          note: clickHint(b) || "% of checked = category NG ÷ (Final passed + NG).",
        });
      } },
      xAxis: categoryAxis(xLabels, { axisLabel: axisLabel({ hideOverlap: true, lineHeight: 14, fontSize: 11, color: INK.secondary }) }),
      yAxis: valueAxis({ ...axisName("NG parts", 40), minInterval: 1 }),
      dataZoom: many ? [{ type: "inside" }, { type: "slider", height: 18, bottom: 10 }] : undefined,
      series: [
        ...catKeys.map((c) => ({
          type: "bar", name: c, stack: "cat", barMaxWidth: 36, cursor: level === "hour" ? "default" : "pointer",
          itemStyle: { color: catColor(c) }, emphasis: { focus: "series" },
          label: { show: labelsOn, position: "inside", fontSize: 10.5, fontWeight: 700, color: "#ffffff", fontFamily: FONT_FAMILY, formatter: (p) => (p.value > 0 && p.value >= maxNg * 0.09 ? fmtInt(p.value) : "") },
          labelLayout: { hideOverlap: true },
          data: buckets.map((b) => b.cat[c] || 0),
        })),
        {
          type: "bar", name: "Total NG", stack: "cat", silent: true, tooltip: { show: false }, itemStyle: { color: "transparent" },
          label: {
            show: true, position: "top", distance: 4, fontFamily: FONT_FAMILY, lineHeight: 14,
            formatter: (p) => { const b = buckets[p.dataIndex]; if (!b?.ng) return ""; const pc = pctOf(b.ng, b.ok + b.ng); return labelsOn && pc != null ? `{t|${fmtInt(b.ng)}}\n{p|${pc.toFixed(1)}%}` : `{t|${fmtInt(b.ng)}}`; },
            rich: { t: { fontSize: 11, fontWeight: 700, color: INK.primary, fontFamily: FONT_FAMILY }, p: { fontSize: 10, fontWeight: 600, color: INK.muted, fontFamily: FONT_FAMILY } },
          },
          data: buckets.map(() => 0),
        },
      ],
    });
  }, [buckets, totals, catKeys, many, labelsOn, level, xLabels.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Shift bands under the hourly chart (exact Shift Management times, aligned with the bars) ── */
  const shiftStrip = (gridLeft, gridRight) => {
    if (level !== "hour" || !shiftDefs.length) return null;
    const start = dayStartHour * 3600;
    const parts = shiftDefs.map((s) => {
      const from = ((s.start - start) % 86400 + 86400) % 86400;
      const len = ((s.end - s.start + 86400) % 86400) + 1;
      return { ...s, from, len, key: shiftKey(s.code) };
    }).sort((a, b) => a.from - b.from);
    return (
      <div className="dqt-shiftstrip" style={{ marginLeft: gridLeft, marginRight: gridRight }} aria-label="Shift timings">
        {parts.map((p) => (
          <div key={p.code} style={{ left: `${(p.from / 86400) * 100}%`, width: `calc(${(Math.min(p.len, 86400 - p.from) / 86400) * 100}% - 3px)`, background: `${SHIFT[p.key] || OTHER}1f`, borderTop: `3px solid ${SHIFT[p.key] || OTHER}` }}>
            <b>{p.name || shiftLabel(p.key)}</b>
            <span>{hms(p.start)} – {hms(p.end + 1)}</span>
          </div>
        ))}
      </div>
    );
  };

  /* ── Header controls, breadcrumb, period summary ── */
  const periodButtons = (
    <div className="rej-tab-group">
      <button type="button" className={`rej-tab-pill ${effMode === "day" && !day ? "active" : ""}`} onClick={() => { setMode("day"); setDay(null); }} title="One bar per production day (06:00 → 06:00)">
        <CalendarDays size={14} style={{ marginRight: 5, verticalAlign: -2 }} />Daily
      </button>
      <button type="button" className={`rej-tab-pill ${effMode === "month" && !day ? "active" : ""}`} onClick={() => { setMode("month"); setMonth(null); setDay(null); }} title="One bar per month · click a month to open its days">
        <CalendarRange size={14} style={{ marginRight: 5, verticalAlign: -2 }} />Monthly
      </button>
    </div>
  );
  const crumb = (month || day) && (
    <div className="dqt-crumb">
      <button type="button" className="dqt-back" onClick={() => (day ? setDay(null) : setMonth(null))}><ArrowLeft size={12} /> Back</button>
      {effMode === "month" && <><button type="button" onClick={() => { setMonth(null); setDay(null); }}>All months</button><ChevronRight size={12} /></>}
      {month && (day ? <><button type="button" onClick={() => setDay(null)}>{monthLabel(month)}</button><ChevronRight size={12} /></> : <b>{monthLabel(month)}</b>)}
      {!month && day && <><button type="button" onClick={() => setDay(null)}>All days</button><ChevronRight size={12} /></>}
      {day && <b>{longDay(day)} · hour by hour (06:00 → 06:00)</b>}
    </div>
  );
  const done = totals.ok + totals.ng;
  // period summary only when drilled in (the page's key figures already show the whole selection)
  const kpis = (month || day) && buckets.length > 0 && (
    <div className="dqt-kpis">
      <span>Produced <b>{fmtInt(totals.produced)}</b></span>
      <span>Final OK <b style={{ color: OUTCOME.ok }}>{fmtInt(totals.ok)}</b></span>
      <span>NG <b style={{ color: OUTCOME.ng }}>{fmtInt(totals.ng)}</b></span>
      <span>In process <b>{fmtInt(totals.wip)}</b></span>
      <span>NG % <b>{fmtPct(pctOf(totals.ng, done), 2)}</b></span>
      <span>FPY <b>{fmtPct(pctOf(totals.ok, done), 2)}</b></span>
    </div>
  );
  const levelWord = level === "hour" ? "Hourly" : level === "month" ? "Monthly" : "Daily";
  const body = (content, emptyText) => {
    if ((loading && !daily) || (level === "hour" && hourLoading && !hourly)) return <div className="qg-empty" style={{ minHeight: 260 }}>Loading…</div>;
    if (error && !daily) return <div className="qg-empty" style={{ minHeight: 260 }}>Could not load totals ({error}).</div>;
    if (!buckets.length) return <div className="qg-empty" style={{ minHeight: 260 }}>{emptyText}</div>;
    return content;
  };
  const chartMinWidth = (per) => Math.max(560, Math.min(buckets.length, 31) * per);

  /* ─── CARD 1: PRODUCTION OUTPUT (OK vs NG / NG by station) ─── */
  const showStation = view === "station" && hasRecords;
  const outputCard = (
    <div className={`ra-card${standalone ? " dqt-standalone" : ""}`} data-accent style={accent(ACCENT.ng)}>
      <style>{standalone ? CARD_CSS + CSS + STANDALONE_CSS : CSS}</style>
      <Head
        icon={BarChart3}
        title={showStation ? `${levelWord} NG by station` : `${levelWord} ${title.replace(/^Production output/, "output")}`}
        sub={showStation
          ? "NG parts stacked by the station that rejected them · inside = station count · top = total NG · click a bar to drill down"
          : `Green = final OK, red = NG · top label = total and NG · dashed line = NG % · ${level === "month" ? "click a month for its days" : level === "day" ? "click a day for its hours" : "shift bands below"}`}
        info={showStation ? INFO.station : INFO.output}
      >
        {hasRecords && (
          <div className="rej-tab-group">
            <button type="button" className={`rej-tab-pill ${view === "output" ? "active" : ""}`} onClick={() => setView("output")}>OK vs NG</button>
            <button type="button" className={`rej-tab-pill ${view === "station" ? "active" : ""}`} onClick={() => setView("station")}>NG by station</button>
          </div>
        )}
        {periodButtons}
      </Head>
      <div className="ra-card-body">
        {body(
          <>
            {crumb}
            {kpis}
            <div className="qg-scroll">
              <div style={{ minWidth: chartMinWidth(34) }}>
                <EChart option={showStation ? stationOption : outputOption} onEvents={onEvents} style={{ height: 380, minHeight: 380 }} />
                {shiftStrip(58, showStation ? 18 : 54)}
              </div>
            </div>
          </>,
          "No parts for the selected period.",
        )}
      </div>
    </div>
  );

  /* ─── CARD 2: SCRAP BY DEFECT CATEGORY ─── */
  const firstColHead = level === "hour" ? "Hour" : level === "month" ? "Month" : "Production day";
  const rowLabel = (b) => (b.isMonth ? `${b.label} (${b.range})` : b.isHour ? `${b.label} – ${hh(b.key + 1)}` : `${b.label} ${parseDay(b.key)?.getFullYear() || ""}`);
  const openRow = (b) => { if (b.isMonth) setMonth(b.key); else if (!b.isHour && b.produced > 0) { setHourData(null); setDay(b.key); } };
  const categoryCard = (
    <div className="ra-card" data-accent style={accent(ACCENT.model)}>
      <Head icon={Layers} title={`${levelWord} scrap by defect category`} sub="NG parts by category (CR / CRAM / MR) · inside = parts · top = total NG and NG % of checked · leak test counted as CRAM" info={INFO.category}>
        {periodButtons}
      </Head>
      <div className="ra-card-body">
        {body(
          <>
            {crumb}
            {categoryOption ? (
              <div className="qg-scroll">
                <div style={{ minWidth: chartMinWidth(38) }}>
                  <EChart option={categoryOption} onEvents={onEvents} style={{ height: 360, minHeight: 360 }} />
                  {shiftStrip(58, 18)}
                </div>
              </div>
            ) : <div className="qg-empty" style={{ minHeight: 120 }}>No NG parts in this period.</div>}
            <button type="button" className="dqt-toggle" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
              {showTable ? "Hide" : "Show"} {firstColHead.toLowerCase()}-wise table ({buckets.filter((b) => b.produced > 0).length} rows · final passed, NG and CR / CRAM / MR with %)
            </button>
            {showTable && (
              <div className="dqt-table-wrap">
                <table className="dqt-table">
                  <thead>
                    <tr>
                      <th>{firstColHead}</th><th>Final passed</th><th>Total NG</th><th>NG %</th>
                      {catKeys.map((c) => <th key={c} style={{ color: catColor(c) }}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.filter((b) => b.produced > 0).map((b) => {
                      const dn = b.ok + b.ng;
                      return (
                        <tr key={b.key} className={b.isHour ? "" : "clickable"} onClick={() => openRow(b)}>
                          <td>{rowLabel(b)}</td>
                          <td style={{ color: OUTCOME.ok }}>{fmtInt(b.ok)}</td>
                          <td style={{ color: OUTCOME.ng }}>{fmtInt(b.ng)}</td>
                          <td>{fmtPct(pctOf(b.ng, dn), 2)}</td>
                          {catKeys.map((c) => <td key={c}>{fmtInt(b.cat[c] || 0)}<em>{fmtPct(pctOf(b.cat[c] || 0, dn), 2)}</em></td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td><td>{fmtInt(totals.ok)}</td><td>{fmtInt(totals.ng)}</td><td>{fmtPct(pctOf(totals.ng, done), 2)}</td>
                      {catKeys.map((c) => <td key={c}>{fmtInt(totals.cat[c] || 0)}<em>{fmtPct(pctOf(totals.cat[c] || 0, done), 2)}</em></td>)}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {daily && daily.matched < daily.ngTotal && (
              <div className="dqt-note">{fmtInt(daily.ngTotal - daily.matched)} of {fmtInt(daily.ngTotal)} NG parts have no loaded NG record, so their category shows as &ldquo;{UNCAT}&rdquo;.</div>
            )}
          </>,
          "No parts for the selected period.",
        )}
      </div>
    </div>
  );

  return { outputCard, categoryCard };
}
