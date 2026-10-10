import React, { useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { ChevronLeft, ChevronRight, Factory, MousePointerClick, Tags, X } from "lucide-react";
import EChart from "../../../../components/charts/EChart";
import SectionCard from "../../../../components/mgmt/SectionCard";
import { SkeletonBlock } from "../../../../components/mgmt/Skeleton";
import EmptyState from "../../../../components/mgmt/EmptyState";
import {
  CATEGORY_COLOR, CATEGORY_NAME, FONT, OUTCOME_COLOR, SLATE, STATUS_COLOR, TARGETS, TOOLTIP, WARMUP_COLOR, alpha, fmtInt, fmtPct, pctOf, statusLowerBetter, tipHtml,
} from "../../../../components/mgmt/mgmtTheme";
import { shiftLetter, stationName } from "../derive";

/* ═══════════════════════════════════════════════════════════════════════════
   Sunbursts — the drill-down happens IN the chart: click a sector to zoom into it, click the centre to go back.
     Quality gate: station → CR / MR / CRAM → defect reason (station rejections, decisive NG scan)
     Shift:        shift A / B / C → OK / NG → (NG) CR / MR / CRAM
   Next to the quality-gate sunburst: "Top rejection causes — vital few 80 %" (station × category × defect).
   ═══════════════════════════════════════════════════════════════════════════ */
export const SUN_CSS = `
.ra-sun-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:18px;align-items:start}
@media (max-width:1180px){.ra-sun-grid{grid-template-columns:1fr}}
.ra-sun-hint{display:flex;justify-content:center;gap:6px;font-size:11.5px;color:#64748b;margin-top:-4px}
.ra-vital-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.ra-vital-head b{font-size:14px;color:#0f172a}
.ra-vital-head span{font-size:12px;color:#64748b}
.ra-vital{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
.ra-vital th{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;text-align:left;padding:7px 8px;border-bottom:1px solid #e2e8f0;white-space:nowrap}
.ra-vital th.r,.ra-vital td.r{text-align:right}
.ra-vital td{padding:7px 8px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:middle}
.ra-vital tr.tail td{color:#94a3b8}
.ra-vital tr.cut td{border-bottom:2px dashed #94a3b8}
.ra-vital-st{display:inline-flex;align-items:center;gap:6px;font-weight:700;color:#0f2a4a;white-space:nowrap}
.ra-vital-st i{width:8px;height:8px;border-radius:2px;background:#3b5b82}
.ra-vital-chip{display:inline-block;padding:1px 7px;border-radius:999px;border:1px solid;font-size:10.5px;font-weight:800;background:#fff}
.ra-vital-bar{display:flex;align-items:center;gap:8px;min-width:120px}
.ra-vital-bar span{flex:1;height:7px;border-radius:4px;background:#f1f5f9;overflow:hidden}
.ra-vital-bar span i{display:block;height:100%;border-radius:4px}
.ra-vital-filter{display:inline-flex;align-items:center;gap:6px;margin:0 0 8px;padding:3px 6px 3px 10px;border-radius:999px;background:#eef3f9;border:1px solid #c9d6e6;font-size:12px;font-weight:700;color:#0f2a4a}
.ra-vital-filter button{display:grid;place-items:center;width:20px;height:20px;border:none;border-radius:50%;background:#fff;color:#0f2a4a;cursor:pointer}
.ra-vital-slider{overflow:hidden;width:100%}
.ra-vital-track{display:flex;transition:transform .45s cubic-bezier(.4,0,.2,1)}
@media (prefers-reduced-motion:reduce){.ra-vital-track{transition:none}}
.ra-vital-page{flex:0 0 100%;min-width:0}
.ra-vital-nav{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:10px}
.ra-vital-nav>button{display:grid;place-items:center;width:30px;height:30px;border:1px solid #cbd5e1;border-radius:50%;background:#fff;color:#0f2a4a;cursor:pointer}
.ra-vital-nav>button:disabled{opacity:.35;cursor:default}
.ra-vital-dots{display:flex;gap:6px}
.ra-vital-dots button{width:8px;height:8px;border-radius:4px;border:none;padding:0;background:#cbd5e1;cursor:pointer;transition:width .2s}
.ra-vital-dots button.on{background:#0f2a4a;width:22px}
.ra-vital-pager{display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:#64748b}
.ra-vital-pager button{display:grid;place-items:center;width:28px;height:28px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f2a4a;cursor:pointer}
.ra-vital-pager button:disabled{opacity:.35;cursor:default}
.ra-shift-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;font-variant-numeric:tabular-nums}
.ra-shift-table th{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;text-align:right;padding:8px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap}
.ra-shift-table th:first-child,.ra-shift-table td:first-child{text-align:left}
.ra-shift-table th.grp{text-align:center;border-bottom:none;padding-bottom:0;color:#94a3b8}
.ra-shift-table td{padding:11px 10px;text-align:right;border-bottom:1px solid #f1f5f9;color:#334155}
.ra-shift-table tbody tr td{transition:background .15s,opacity .15s}
.ra-shift-table tbody tr.hl td{background:#eef3f9}
.ra-shift-table tbody tr.hl td:first-child{box-shadow:inset 3px 0 0 #0f2a4a}
.ra-shift-table tbody tr.dim td{opacity:.4}
.ra-shift-table tfoot td{font-weight:800;color:#0f172a;border-top:1px solid #e2e8f0;border-bottom:none;background:#f8fafc}
.ra-shift-name{display:inline-flex;align-items:center;gap:8px;font-weight:800;color:#0f2a4a}
.ra-shift-name i{width:12px;height:12px;border-radius:4px}
.ra-shift-pct{display:inline-block;min-width:58px;padding:2px 8px;border-radius:999px;font-weight:800;text-align:center}
.ra-shift-cat{font-weight:700}
.ra-shift-mini{display:flex;height:5px;border-radius:3px;overflow:hidden;gap:1px;background:#f1f5f9;margin-top:5px;min-width:90px}
.ra-shift-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.ra-shift-tile{border:1px solid #e2e8f0;border-top:4px solid var(--c);border-radius:12px;padding:10px 12px;background:#fff}
.ra-shift-tile h5{margin:0 0 6px;font-size:13px;font-weight:800;color:#0f2a4a;display:flex;justify-content:space-between;align-items:center}
.ra-shift-tile h5 em{font-style:normal;font-size:12px;font-weight:800;padding:1px 8px;border-radius:999px}
.ra-shift-tile p{margin:2px 0 0;font-size:12px;color:#475569;display:flex;justify-content:space-between}
.ra-shift-tile p b{font-variant-numeric:tabular-nums}
.ra-shift-cats{display:flex;height:6px;border-radius:3px;overflow:hidden;gap:1px;margin-top:8px;background:#f1f5f9}
`;

/* ring fills: strong colours (white text) only on the inner ring; light, hue-true tints (dark text) outside */
const LIGHT = { CR: "#93c5fd", MR: "#c4b5fd", CRAM: "#fdba74", OTHER: "#cbd5e1", WARMUP: "#5eead4" }; // reason ring
const PALE = { CR: "#dbeafe", MR: "#ede9fe", CRAM: "#ffedd5", OTHER: "#e2e8f0", WARMUP: "#ccfbf1" };  // outer ring
const DARK_TEXT = "#1e293b";
const STATION_SHADE = ["#0f2a4a", "#1e3a5f", "#2b4a73", "#3b5b82", "#4a6d97", "#5b7fa8", "#7393b8", "#8aa6c6", "#a3bad5"];
const SHIFT_COLOR = { A: "#0f2a4a", B: "#3b5b82", C: "#7393b8", "—": SLATE[400] };
const CATS = ["CR", "MR", "CRAM", "OTHER"];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const gateOf = (r) => (r._op === "OP150" ? r._leak || "OP150" : r._op);
const gateName = (g) => (g.startsWith("LT-") ? `OP150 Leak test ${g}` : stationName(g));
const ORDER = ["OP100", "OP110", "OP120", "OP130", "OP140", "LT-1", "LT-2", "LT-3", "OP150", "OP160"];
const rank = (g) => { const i = ORDER.indexOf(g); return i < 0 ? 99 : i; };
/** Short sector label (the full name stays in the tooltip). */
const SHORT = { "pressure leakage fail (op150)": "Leak fail", "pressure leakage fail": "Leak fail", "body leak fail": "Body leak", "blow hole": "Blow hole", "non-filling": "Non-fill", "face unclean": "Unclean", "chip-off m8": "Chip-off M8", "black mark": "Black mark", "not classified": "n/c" };
const shortLabel = (name) => {
  const k = String(name || "").trim().toLowerCase();
  if (SHORT[k]) return SHORT[k];
  const t = String(name || "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
  return t.length > 11 ? `${t.slice(0, 10)}…` : t;
};
/** Biggest reasons of a category; the tail (under 5 % of the category, beyond 6 reasons) folded into one "Other". */
const foldReasons = (entries, color) => {
  const tot = entries.reduce((a, [, v]) => a + v, 0) || 1;
  const keep = entries.filter(([, v], i) => i < 6 && v / tot >= 0.05);
  const rest = entries.slice(keep.length);
  const out = keep.map(([reason, v]) => ({ name: reason, short: shortLabel(reason), value: v, itemStyle: { color } }));
  if (rest.length) {
    out.push({
      name: `Other (${rest.length} reasons)`, short: "Other", value: rest.reduce((a, [, v]) => a + v, 0), itemStyle: { color: SLATE[300] },
      extra: [{ label: "Includes", value: rest.slice(0, 5).map(([r, v]) => `${r} ${v}`).join(", ") + (rest.length > 5 ? " …" : ""), bold: false }],
    });
  }
  return out;
};

/** Tooltip with count, share of the parent sector and of the whole chart. */
const sunTip = (unit) => (p) => {
  const path = p.treePathInfo || [];
  const total = path[0]?.value || 0;
  const parent = path.length > 2 ? path[path.length - 2] : null;
  return tipHtml({
    title: path.slice(1).map((x) => x.name).join(" › ") || p.name,
    rows: [
      { label: unit, value: fmtInt(p.value), color: p.color },
      parent ? { label: `Share of ${parent.name}`, value: fmtPct(pctOf(p.value, parent.value), 1) } : null,
      { label: "Share of all", value: fmtPct(pctOf(p.value, total), 1) },
      ...(p.data?.extra || []),
    ],
    note: p.data?.children?.length ? "Click to zoom in · click the centre to go back." : undefined,
  });
};

const sunOption = (data, unit, centre) => ({
  textStyle: { fontFamily: FONT },
  tooltip: { ...TOOLTIP, trigger: "item", formatter: sunTip(unit) },
  series: [{
    type: "sunburst", data, radius: [0, "96%"], sort: null, nodeClick: "rootToNode", animationDurationUpdate: 500,
    itemStyle: { borderColor: "#fff", borderWidth: 1.5, borderRadius: 3 },
    emphasis: { focus: "ancestor" },
    label: {
      fontFamily: FONT, fontSize: 11, color: "#fff", fontWeight: 700, minAngle: 14, overflow: "truncate",
      formatter: (p) => `${p.data?.short || p.name}\n${fmtInt(p.value)}`,
    },
    levels: [
      {
        r0: 0, r: "12%", itemStyle: { color: "#f8fafc", borderColor: SLATE[200] },
        label: { color: SLATE[900], fontSize: 12.5, rotate: 0, formatter: (p) => ((p.treePathInfo || []).length > 1 ? `{t|${fmtInt(p.value)}}
{s|◀ ${p.name}}` : centre(p)) },
      },
      { r0: "12%", r: "40%", label: { rotate: 0, fontSize: 11.5, minAngle: 22 } },
      { r0: "40%", r: "66%", label: { rotate: "tangential", minAngle: 16 } },
      { r0: "66%", r: "96%", label: { rotate: "tangential", fontSize: 10.5, fontWeight: 700, color: SLATE[900], minAngle: 26, width: 70, overflow: "truncate" } },
    ],
  }],
});

/* ── Quality gate sunburst + vital few ─────────────────────────────────── */
const NG_SHOT_DEFECT = "NG shot (parameter out of limit)";
const WARM_DEFECT = "Warm-up shots";
const CAT_COLOR = { ...CATEGORY_COLOR, WARMUP: WARMUP_COLOR };
const catName = (c) => (c === "OTHER" ? "Not classified" : c === "WARMUP" ? "Warm-up" : c);
const catShortName = (c) => (c === "OTHER" ? "n/c" : c === "WARMUP" ? "Warm-up" : c);
const catKeyOf = (n) => (n === "Not classified" ? "OTHER" : n === "Warm-up" ? "WARMUP" : n);
const CAT_ORDER = ["CR", "MR", "CRAM", "OTHER", "WARMUP"];

export function GateSunburstCard({ enriched, rowsLoading, shot }) {
  const [mode, setMode] = useState("category"); // category › reason › station (default)  |  station › category › defect
  const [filter, setFilter] = useState([]); // path of the zoomed sector (in the order of the mode)
  const [page, setPage] = useState(0);
  const [chartKey, setChartKey] = useState(0);

  /* every rejection as station | category | defect (+ OP100 NG shots and warm-up shots from the shot data) */
  const triples = useMemo(() => {
    if (!enriched) return null;
    const m = new Map();
    const add = (st, cat, def, n = 1) => { const k = `${st}|${cat}|${def}`; m.set(k, (m.get(k) || 0) + n); };
    enriched.forEach((r) => add(gateOf(r), r._cat, r._reason));
    const t = shot?.totals;
    if (t && num(t.ng) > 0) add("OP100", "CR", NG_SHOT_DEFECT, num(t.ng));
    if (t && num(t.warmUp) > 0) add("OP100", "WARMUP", WARM_DEFECT, num(t.warmUp));
    return [...m.entries()].map(([k, n]) => { const [st, cat, def] = k.split("|"); return { st, cat, def, n }; });
  }, [enriched, shot]);
  const total = triples ? triples.reduce((a, x) => a + x.n, 0) : 0;
  const topParams = useMemo(() => (shot?.parameters || []).filter((p) => p.ngOutOfLimit > 0).sort((a, b) => b.ngOutOfLimit - a.ngOutOfLimit).slice(0, 4)
    .map((p) => `${p.label} ${p.ngOutOfLimit}`).join(", "), [shot]);

  const tree = useMemo(() => {
    if (!triples) return null;
    const stations = [...new Set(triples.map((x) => x.st))].sort((a, b) => rank(a) - rank(b));
    const shade = Object.fromEntries(stations.map((s, i) => [s, STATION_SHADE[i % STATION_SHADE.length]]));
    const stNode = (st, children) => ({ name: st, short: st, itemStyle: { color: shade[st] }, extra: [{ label: "Station", value: st === "OP100" ? "OP100 Die casting (DCM shots)" : gateName(st), bold: false }], children });
    const catNode = (c, children) => ({ name: catName(c), short: catShortName(c), itemStyle: { color: CAT_COLOR[c] }, extra: CATEGORY_NAME[c] ? [{ label: "Category", value: CATEGORY_NAME[c], bold: false }] : c === "WARMUP" ? [{ label: "Category", value: "Planned start-up shots (not scrap)", bold: false }] : [], children });
    const leaves = (list, c) => {
      const entries = [...list.reduce((m, x) => m.set(x.def, (m.get(x.def) || 0) + x.n), new Map()).entries()].sort((a, b) => b[1] - a[1]);
      return foldReasons(entries, mode === "station" ? PALE[c] : LIGHT[c]).map((l) => (l.name === NG_SHOT_DEFECT && topParams
        ? { ...l, short: "NG shot", extra: [{ label: "Parameters out of limit", value: topParams, bold: false }] }
        : l.name === WARM_DEFECT ? { ...l, short: "Warm-up" } : l));
    };
    if (mode === "station") {
      return stations.map((st) => {
        const inSt = triples.filter((x) => x.st === st);
        return stNode(st, CAT_ORDER.filter((c) => inSt.some((x) => x.cat === c)).map((c) => catNode(c, leaves(inSt.filter((x) => x.cat === c), c))));
      });
    }
    return CAT_ORDER.filter((c) => triples.some((x) => x.cat === c)).map((c) => {
      const inC = triples.filter((x) => x.cat === c);
      // reasons of the category (biggest first, the tail folded into "Other"), then the stations of each reason
      return catNode(c, leaves(inC, c).map((r) => {
        const isOther = /^Other \(/.test(r.name);
        const ofReason = isOther ? inC.filter((x) => !leaves(inC, c).some((l) => l.name === x.def)) : inC.filter((x) => x.def === r.name);
        const bySt = [...ofReason.reduce((m, x) => m.set(x.st, (m.get(x.st) || 0) + x.n), new Map()).entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
        return {
          ...r, value: undefined, itemStyle: { color: /^Other \(/.test(r.name) ? "#cbd5e1" : LIGHT[c] },
          children: bySt.map(([st, n]) => ({ name: st, short: st, value: n, itemStyle: { color: PALE[c] } })),
        };
      }));
    });
  }, [triples, mode, topParams]);

  const option = useMemo(() => {
    if (!tree) return null;
    const o = sunOption(tree, "Count", () => `{t|${fmtInt(total)}}\n{s|rejections}`);
    o.series[0].levels[0].label.rich = { t: { fontSize: 18, fontWeight: 800, color: SLATE[900], fontFamily: FONT }, s: { fontSize: 10.5, color: SLATE[500], fontFamily: FONT } };
    // sector labels: "name" + "n · x %" (share of everything), shown only where the sector is big enough to read
    o.series[0].label.formatter = (p) => `{n|${p.data?.short || p.name}}\n{v|${fmtInt(p.value)} · ${fmtPct(pctOf(p.value, total), 0)}}`;
    o.series[0].label.rich = { n: { fontWeight: 800, fontSize: 11.5, fontFamily: FONT, lineHeight: 14 }, v: { fontWeight: 600, fontSize: 10.5, fontFamily: FONT, lineHeight: 13 } };
    o.series[0].levels[1] = { r0: "12%", r: "38%", label: { rotate: 0, minAngle: 18, color: "#fff" } };
    // station mode: middle ring = category (strong, white text); category mode: middle ring = reason (light, dark text)
    o.series[0].levels[2] = { r0: "38%", r: "68%", label: { rotate: "tangential", minAngle: 14, color: mode === "station" ? "#fff" : DARK_TEXT, width: 90, overflow: "truncate" } };
    o.series[0].levels[3] = { r0: "68%", r: "96%", label: { rotate: "tangential", minAngle: 18, color: DARK_TEXT, width: 70, overflow: "truncate" } };
    return o;
  }, [tree, total, mode]);

  const events = useMemo(() => ({
    click: (p) => {
      const path = (p.treePathInfo || []).slice(1).map((x) => x.name);
      if (!path.length) { setFilter([]); setPage(0); return; }
      setPage(0);
      // clicking the current centre goes one level up (that is what the chart does)
      setFilter((cur) => (cur.length && cur.join("|") === path.join("|") ? path.slice(0, -1) : (p.data?.children?.length ? path : cur)));
    },
  }), []);
  const resetFilter = () => { setFilter([]); setPage(0); setChartKey((k) => k + 1); };
  const switchMode = (m) => { if (m !== mode) { setMode(m); resetFilter(); } };

  const vital = useMemo(() => {
    if (!triples?.length) return null;
    const [a, b, c] = filter;
    // station mode: [station, category, defect] · category mode: [category, defect, station]
    const [fSt, fCat, fDef] = mode === "station" ? [a, b, c] : [c, a, b];
    const list = triples.filter((x) => (!fSt || x.st === fSt) && (!fCat || x.cat === catKeyOf(fCat)) && (!fDef || /^Other \(/.test(fDef) || x.def === fDef))
      .sort((x, y) => y.n - x.n);
    const scopeTotal = list.reduce((s, x) => s + x.n, 0);
    let cum = 0;
    const rows = list.map((x) => {
      const before = cum;
      cum += x.n;
      return { ...x, share: pctOf(x.n, scopeTotal), cum: pctOf(cum, scopeTotal), vital: pctOf(before, scopeTotal) < 80 };
    });
    return { rows, vitalCount: rows.filter((r) => r.vital).length, scopeTotal };
  }, [triples, filter, mode]);
  const PAGE = 10;
  const pageRows = vital ? Array.from({ length: Math.max(1, Math.ceil(vital.rows.length / PAGE)) }, (_, i) => vital.rows.slice(i * PAGE, i * PAGE + PAGE)) : [];
  const pg = Math.min(page, Math.max(0, pageRows.length - 1));

  return (
    <SectionCard
      id="ra-gate-sun"
      title={mode === "station" ? "Where scrap comes from — station › category › defect" : "Where scrap comes from — category › reason › station"}
      subtitle="Click a sector to zoom into it (the table follows), click the centre to go back. OP100 includes the DCM NG shots (CR) and the warm-up shots (teal). Right: the few combinations that make up 80 %."
      info={{
        what: "Station rejections of the period (decisive NG scan per part per station; leak test per machine, CRAM) plus, at OP100, the die-casting machine's NG shots (a process parameter out of limit, counted as CR) and its warm-up shots (planned start-up shots, shown in teal — not scrap).",
        formula: ["Sector label = count · share of everything shown", "Vital few = biggest combinations until the cumulative share passes 80 %"],
      }}
      actions={(
        <div className="ra-seg ra-seg-sm" role="group" aria-label="Order of the rings">
          <button type="button" className={mode === "category" ? "on" : ""} aria-pressed={mode === "category"} onClick={() => switchMode("category")} title="Category › reason › station"><Tags size={13} aria-hidden="true" />By category</button>
          <button type="button" className={mode === "station" ? "on" : ""} aria-pressed={mode === "station"} onClick={() => switchMode("station")} title="Station › category › defect"><Factory size={13} aria-hidden="true" />By station</button>
        </div>
      )}
    >
      {rowsLoading && !enriched ? <SkeletonBlock lines={6} height={380} />
        : !total ? <EmptyState title="No rejections in this period" />
          : (
            <div className="ra-sun-grid">
              <div style={{ minWidth: 0 }}>
                <EChart key={`${chartKey}-${mode}`} option={option} onEvents={events} style={{ height: 500, minHeight: 500 }} />
                <div className="ra-sun-hint"><MousePointerClick size={13} aria-hidden="true" />Click a sector to zoom · centre = back</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="ra-vital-head">
                  <b>Top rejection causes — vital few 80 %</b>
                  <span>{vital.vitalCount} of {vital.rows.length} combinations = 80 % of {fmtInt(vital.scopeTotal)}</span>
                </div>
                {filter.length > 0 && (
                  <span className="ra-vital-filter">Filtered: {filter.join(" › ")}<button type="button" onClick={resetFilter} aria-label="Clear the filter"><X size={12} /></button></span>
                )}
                <div className="ra-vital-slider">
                  <div className="ra-vital-track" style={{ transform: `translateX(-${pg * 100}%)` }}>
                    {pageRows.map((rows, pi) => (
                      <div className="ra-vital-page" key={pi} aria-hidden={pi !== pg}>
                        <table className="ra-vital">
                          <thead><tr><th>Station</th><th>Cat.</th><th>Defect</th><th className="r">Count</th><th>Share</th><th className="r">Cum.</th></tr></thead>
                          <tbody>
                            {rows.map((r, i, arr) => (
                              <tr key={`${r.st}-${r.cat}-${r.def}`} className={`${r.vital ? "" : "tail"} ${r.vital && arr[i + 1] && !arr[i + 1].vital ? "cut" : ""}`}>
                                <td><span className="ra-vital-st"><i />{r.st}</span></td>
                                <td><span className="ra-vital-chip" style={{ color: CAT_COLOR[r.cat], borderColor: alpha(CAT_COLOR[r.cat], 0.5) }}>{catShortName(r.cat)}</span></td>
                                <td style={{ fontWeight: 600, color: r.vital ? "#0f172a" : undefined }}>{r.def}</td>
                                <td className="r" style={{ fontWeight: 700 }}>{fmtInt(r.n)}</td>
                                <td><span className="ra-vital-bar"><span><i style={{ width: `${(r.n / vital.rows[0].n) * 100}%`, background: r.cat === "WARMUP" ? WARMUP_COLOR : r.vital ? OUTCOME_COLOR.ng : SLATE[300] }} /></span>{fmtPct(r.share, 1)}</span></td>
                                <td className="r">{fmtPct(r.cum, 1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>
                {pageRows.length > 1 && (
                  <div className="ra-vital-nav">
                    <button type="button" onClick={() => setPage(Math.max(0, pg - 1))} disabled={pg === 0} aria-label="Previous rows"><ChevronLeft size={15} /></button>
                    <span className="ra-vital-dots" role="tablist" aria-label="Rows">
                      {pageRows.map((_, i) => <button key={i} type="button" role="tab" aria-selected={i === pg} aria-label={`Rows ${i * PAGE + 1}–${Math.min(vital.rows.length, i * PAGE + PAGE)}`} className={i === pg ? "on" : ""} onClick={() => setPage(i)} />)}
                    </span>
                    <button type="button" onClick={() => setPage(Math.min(pageRows.length - 1, pg + 1))} disabled={pg >= pageRows.length - 1} aria-label="Next rows"><ChevronRight size={15} /></button>
                  </div>
                )}
              </div>
            </div>
          )}
    </SectionCard>
  );
}

/* ── Shift sunburst ────────────────────────────────────────────────────── */
export function ShiftSunburstCard({ trendData, trendLoading, enriched, rowsLoading }) {
  const shifts = useMemo(() => {
    const m = Object.fromEntries(["A", "B", "C"].map((s) => [s, { key: s, ok: 0, ng: 0, wip: 0, rej: 0, cats: { CR: 0, MR: 0, CRAM: 0, OTHER: 0 } }]));
    (trendData?.days || []).forEach((r) => { const s = shiftLetter(r.shift); if (s) { m[s].ok += num(r.ok); m[s].ng += num(r.ng); m[s].wip += num(r.wip); } });
    (enriched || []).forEach((r) => { const s = r._shift || shiftLetter(r.shiftCode || r.shift_code); if (s && m[s]) { m[s].rej += 1; m[s].cats[r._cat] += 1; } });
    return ["A", "B", "C"].map((s) => m[s]);
  }, [trendData, enriched]);
  const total = shifts.reduce((a, s) => a + s.ok + s.ng, 0);
  // hover sync, both ways: any sector or table row highlights the whole shift (shift, OK / NG, CR / MR / CRAM)
  // via ECharts' highlight on the shift node (focus "descendant" dims the other shifts) plus the table row
  const [rowHover, setRowHover] = useState(null);
  const [chartHover, setChartHover] = useState(null);
  const chartWrap = useRef(null);
  const shiftEvents = useMemo(() => {
    const act = (type, name) => {
      const el = chartWrap.current?.querySelector("[_echarts_instance_]");
      const c = el && echarts.getInstanceByDom(el);
      if (c && name) c.dispatchAction({ type, seriesIndex: 0, name });
    };
    return {
      act,
      mouseover: (p) => { const top = (p.treePathInfo || [])[1]?.name; if (!top) return; setChartHover(String(top).replace("Shift ", "")); act("highlight", top); },
      mouseout: (p) => { const top = (p.treePathInfo || [])[1]?.name; setChartHover(null); act("downplay", top); },
      globalout: () => setChartHover(null),
    };
  }, []);
  const hoverRow = (key, on) => { setRowHover(on ? key : null); shiftEvents.act(on ? "highlight" : "downplay", `Shift ${key}`); };
  const option = useMemo(() => {
    if (!total) return null;
    const data = shifts.filter((s) => s.ok + s.ng > 0).map((s) => ({
      name: `Shift ${s.key}`, itemStyle: { color: SHIFT_COLOR[s.key] },
      extra: [{ label: "NG %", value: fmtPct(pctOf(s.ng, s.ok + s.ng), 2) }],
      children: [
        { name: "OK", itemStyle: { color: OUTCOME_COLOR.ok }, children: [{ name: "OK ", short: "", value: s.ok, itemStyle: { color: "#bbf7d0" }, label: { show: false } }] },
        {
          // NG parts split by the category shares of the shift's station rejections
          name: "NG", itemStyle: { color: OUTCOME_COLOR.ng },
          children: (() => {
            const cs = CATS.filter((c) => s.cats[c]);
            if (!s.ng) return [];
            if (!s.rej) return [{ name: "NG ", short: "", value: s.ng, itemStyle: { color: "#fecaca" } }];
            let left = s.ng;
            return cs.map((c, i) => {
              const v = i === cs.length - 1 ? left : Math.round((s.cats[c] / s.rej) * s.ng);
              left -= v;
              return { name: c === "OTHER" ? "Not classified" : c, short: c === "OTHER" ? "n/c" : c, value: Math.max(0, v), itemStyle: { color: LIGHT[c] }, extra: [{ label: "Station rejections", value: fmtInt(s.cats[c]), bold: false }] };
            });
          })(),
        },
      ],
    }));
    const o = sunOption(data, "Parts", () => `{t|${fmtInt(total)}}\n{s|OK + NG}`);
    o.series[0].levels[0].label.rich = { t: { fontSize: 18, fontWeight: 800, color: SLATE[900], fontFamily: FONT }, s: { fontSize: 10.5, color: SLATE[500], fontFamily: FONT } };
    // same ring radii for every branch: shift 12–40 %, OK / NG 40–66 %, outer 66–96 % (OK continues pale green)
    o.series[0].levels[1] = { r0: "12%", r: "40%", label: { rotate: 0, minAngle: 18, color: "#fff" } };
    o.series[0].levels[2] = { r0: "40%", r: "66%", label: { rotate: "tangential", minAngle: 12, color: "#fff" } };
    o.series[0].levels[3] = { r0: "66%", r: "96%", label: { rotate: "tangential", fontSize: 10.5, fontWeight: 800, color: DARK_TEXT, minAngle: 10 } };
    // a highlighted shift node keeps itself and everything under it; the other shifts are dimmed
    o.series[0].emphasis = { focus: "descendant" };
    o.series[0].blur = { itemStyle: { opacity: 0.18 }, label: { opacity: 0.25 } };
    return o;
  }, [shifts, total]);

  return (
    <SectionCard
      id="ra-shift-sun"
      title="Shifts — OK vs NG and NG by category"
      subtitle="Inner ring shift, middle OK / NG, outer NG by CR / MR / CRAM. Click a shift to zoom in, the centre to go back. Right: the break-up per shift."
      info={{
        what: "OK, NG and In progress per shift — the Dashboard / Historical figures (rejection-daily). CR / MR / CRAM = station rejections of the shift by the decisive NG scan; the NG ring is split in the same proportion.",
        formula: ["Shift NG % = NG ÷ (OK + NG)", `Status vs target ${TARGETS.scrapPct}%: green ≤ target, amber ≤ ${TARGETS.scrapPct + TARGETS.amberBandPp}%, red above`],
      }}
      actions={<span className="mg-hint"><MousePointerClick size={13} aria-hidden="true" />Click a sector</span>}
    >
      {(trendLoading && !trendData) || (rowsLoading && !enriched) ? <SkeletonBlock lines={6} height={380} />
        : !option ? <EmptyState title="No finished parts in this period" />
          : (
            <div className="ra-sun-grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
              <div ref={chartWrap}><EChart option={option} onEvents={shiftEvents} style={{ height: 400, minHeight: 400 }} /></div>
              <div style={{ minWidth: 0, overflowX: "auto", alignSelf: "center" }}>
                <table className="ra-shift-table">
                  <thead>
                    <tr><th /><th colSpan={4} className="grp">Parts</th><th colSpan={3} className="grp">Station rejections</th></tr>
                    <tr><th>Shift</th><th>OK</th><th>NG</th><th>In progress</th><th>NG %</th><th>CR</th><th>MR</th><th>CRAM</th></tr>
                  </thead>
                  <tbody>
                    {shifts.map((s) => {
                      const p = pctOf(s.ng, s.ok + s.ng);
                      const c = STATUS_COLOR[statusLowerBetter(p, TARGETS.scrapPct)];
                      return (
                        <tr key={s.key} className={(chartHover || rowHover) ? ((chartHover || rowHover) === s.key ? "hl" : "dim") : ""}
                          onMouseEnter={() => hoverRow(s.key, true)} onMouseLeave={() => hoverRow(s.key, false)}>
                          <td><span className="ra-shift-name"><i style={{ background: SHIFT_COLOR[s.key] }} />Shift {s.key}</span></td>
                          <td style={{ color: OUTCOME_COLOR.ok, fontWeight: 800 }}>{fmtInt(s.ok)}</td>
                          <td style={{ color: OUTCOME_COLOR.ng, fontWeight: 800 }}>{fmtInt(s.ng)}</td>
                          <td style={{ color: SLATE[600], fontWeight: 700 }}>{fmtInt(s.wip)}</td>
                          <td><span className="ra-shift-pct" style={{ color: c, background: alpha(c, 0.12) }}>{fmtPct(p, 2)}</span></td>
                          {["CR", "MR", "CRAM"].map((k) => <td key={k} className="ra-shift-cat" style={{ color: CATEGORY_COLOR[k] }}>{fmtInt(s.cats[k])}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {(() => {
                      const t = shifts.reduce((a, s) => ({ ok: a.ok + s.ok, ng: a.ng + s.ng, wip: a.wip + s.wip, CR: a.CR + s.cats.CR, MR: a.MR + s.cats.MR, CRAM: a.CRAM + s.cats.CRAM }), { ok: 0, ng: 0, wip: 0, CR: 0, MR: 0, CRAM: 0 });
                      return (
                        <tr>
                          <td>All shifts</td><td>{fmtInt(t.ok)}</td><td>{fmtInt(t.ng)}</td><td>{fmtInt(t.wip)}</td><td>{fmtPct(pctOf(t.ng, t.ok + t.ng), 2)}</td>
                          <td>{fmtInt(t.CR)}</td><td>{fmtInt(t.MR)}</td><td>{fmtInt(t.CRAM)}</td>
                        </tr>
                      );
                    })()}
                  </tfoot>
                </table>
                <div style={{ marginTop: 8, fontSize: 11.5, color: SLATE[500] }}>OK / NG / In progress = Dashboard figures. CR / MR / CRAM count station rejections (a part can be rejected at more than one station).</div>
              </div>
            </div>
          )}
    </SectionCard>
  );
}
