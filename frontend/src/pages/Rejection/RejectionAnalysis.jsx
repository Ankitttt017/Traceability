import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Flame, Layers, ListFilter, Loader2, Sparkles, X } from "lucide-react";
import { ChartDownloadProvider } from "../../components/charts/chartDownload";
import MgmtStyles from "../../components/mgmt/MgmtStyles";
import { dashboardApi } from "../../api/services";
import MasterRecipeModal from "./components/MasterRecipeModal";
import RejectionKpiStrip from "./RejectionKpiStrip";
import RootCauseTab from "./RootCauseTab";
import DieShotTab from "./mgmt/DieShotTab";
import HeatMapTab from "./HeatMapTab";
import TelemetryTab from "./TelemetryTab";
import ScrapRecordsTab from "./ScrapRecordsTab";
import HeaderBar from "./mgmt/HeaderBar";
import StationOverviewTab from "./mgmt/tabs/StationOverviewTab";
import useRejectionData from "./mgmt/useRejectionData";
import { exportRejectionExcel } from "./mgmt/exportExcel";
import { presetRange, rangeLabel } from "./mgmt/periods";
import { buildDieRows, computeKpis, enrichRows, stationCategoryCounts } from "./mgmt/derive";
import { decisiveRows } from "./mgmt/deriveTabs";
import "./RejectionAnalysis.css";

/* ═══════════════════════════════════════════════════════════════════════════
   Rejection & Quality Intelligence — Oil Pan K-12 (OPK12)
   Layout of the pushed page (header → KPI strip → tabs), today's colour rules (components/mgmt/mgmtTheme.js):
     Station Overview · Die Performance · Root Cause Analysis · Process Monitoring (SPC) · Scrap Records ·
     Defect Location Map
   Data: useRejectionData — the KPI strip and Station Overview load first (shot analytics, summary, Pareto, daily
   trend); every other set is requested by the tab that needs it, through one queue (≤ 3 requests in flight,
   cancelled on a filter change). No part-name filter on the rejection queries (customer-QR-only parts carry no part
   name); only the DCM shot analytics is asked for part OPK12.
   ═══════════════════════════════════════════════════════════════════════════ */

const TABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "die_analysis", label: "Die Performance", icon: Layers },
  { id: "ml_analysis", label: "Root Cause Analysis", icon: Sparkles },
  { id: "telemetry", label: "Process Monitoring (SPC)", icon: Activity },
  { id: "records", label: "Scrap Records", icon: ListFilter },
  { id: "heat_map", label: "Defect Location Map", icon: Flame },
];
/** Data sets each tab asks for when it opens (Station Overview asks for its own). */
const TAB_NEEDS = {
  ml_analysis: ["ml", "rows"],
  telemetry: ["ml", "rows"],
  records: ["rows"],
  heat_map: ["rows", "config"],
};
/** Section ids of deep links → their tab (old tab ids included). */
const SECTION_TAB = {
  "ra-gates": "overview", "ra-flow": "overview", "ra-station-output": "overview", "ra-trend": "overview", "ra-mix": "overview",
  "ra-die": "die_analysis", "ra-rootcause": "ml_analysis", "ra-process": "telemetry", "ra-records": "records", "ra-location": "heat_map",
};
const OLD_TAB = { gates: "overview", trace: "overview", reasons: "overview", rootcause: "ml_analysis", location: "heat_map", log: "records" };

const EMPTY = [];
const EMPTY_ML = { features: [], topAnomalies: [] };
const NG_SET = new Set(["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"]);
const isNgRow = (r) => NG_SET.has(String(r.status || r.overall_status || "").trim().toUpperCase())
  || !!r.isDefective || !!r.rejection_reason || !!r.ng_reason || !!r.rejectionReason || !!r.ngReason;

const PAGE_CSS = `
.ra-page{display:flex;flex-direction:column;gap:14px;padding-bottom:24px}
/* KPI strip frozen under the top of the scrolling main area on every tab */
.ra-sticky{position:sticky;top:-16px;z-index:40;margin:0 -8px;padding:8px 8px 6px;background:color-mix(in srgb,var(--app-bg-base,#f1f5f9) 86%,transparent);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
@media (min-width:768px){.ra-sticky{top:-24px;padding-top:12px}}
.ra-tabpanel{display:flex;flex-direction:column;gap:16px;min-width:0}
.ra-tabs-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ra-tabs-row .mg-tabs{max-width:100%}
.ra-busy{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#64748b}
.ra-loc{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(240px,1fr);gap:20px;align-items:start}
@media (max-width:1000px){.ra-loc{grid-template-columns:1fr}}
.ra-mini-title{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin:4px 0 8px}
.ra-hot{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ra-hot li{position:relative;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#fff}
.ra-hot button{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px 12px;border:none;background:transparent;text-align:left;cursor:pointer;font:inherit}
.ra-hot button:hover{background:#f8fafc}
.ra-hot-rank{width:22px;height:22px;border-radius:50%;background:#0f2a4a;color:#fff;font-size:11.5px;font-weight:700;display:grid;place-items:center;flex-shrink:0}
.ra-hot-name{display:block;font-size:13.5px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ra-hot-view{display:block;font-size:11.5px;color:#64748b}
.ra-hot-val{display:flex;flex-direction:column;align-items:flex-end;font-size:11px;color:#64748b;white-space:nowrap}
.ra-hot-val b{font-size:17px;color:#0f172a}
.ra-hot-bar{position:absolute;left:0;bottom:0;height:3px}
.ra-heat-scale{display:flex;align-items:center;gap:3px;margin-top:8px;font-size:11px;color:#64748b}
.ra-heat-scale i{display:inline-block;width:20px;height:8px;border-radius:2px}
.ra-heat-scale span{margin:0 5px}
.ra-toast{position:fixed;right:20px;bottom:20px;z-index:3000;display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;background:#0f2a4a;color:#fff;font-size:13px;box-shadow:0 12px 30px rgba(15,23,42,.25)}
.ra-toast.error{background:#991b1b}
/* filter context note */
.ra-filter-note{display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-radius:10px;background:#eef3f9;border:1px solid #c9d6e6;color:#1e3a5f;font-size:12.5px;line-height:1.45}
.ra-filter-note>span{flex:1;min-width:0}
.ra-filter-note b{color:#0f2a4a}
.ra-busy.err{color:#991b1b}
.ra-kpis{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));align-items:stretch}
@media (min-width:1100px){.ra-kpis{grid-template-columns:repeat(6,minmax(0,1fr))}}
.ra-kpis .mg-kpi:first-child{grid-column:span 2}
@media (max-width:640px){.ra-kpis .mg-kpi:first-child{grid-column:1/-1}}
.ra-icon-btn{display:inline-grid;place-items:center;width:30px;height:30px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;cursor:pointer;flex-shrink:0}
.ra-icon-btn:hover{background:#f8fafc}
.ra-dot{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0}
/* station gauge carousel */
.ra-car{margin-top:4px}
.ra-car-row{display:flex;align-items:center;gap:8px}
.ra-car-track{flex:1;min-width:0;display:grid;gap:12px}
.ra-car-nav{flex-shrink:0;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;border:1px solid #cbd5e1;background:#fff;color:#0f2a4a;cursor:pointer}
.ra-car-nav:disabled{opacity:.35;cursor:default}
.ra-car-nav:not(:disabled):hover{background:#f1f5f9}
.ra-car-dots{display:flex;justify-content:center;gap:6px;margin-top:8px}
.ra-car-dots button{width:8px;height:8px;border-radius:50%;border:none;padding:0;background:#cbd5e1;cursor:pointer}
.ra-car-dots button.on{background:#0f2a4a;width:20px;border-radius:4px}
.ra-gauge{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;padding:10px 8px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;cursor:pointer;font:inherit;text-align:center;transition:border-color .15s,box-shadow .15s;overflow:hidden}
.ra-gauge:hover{border-color:#94a3b8;box-shadow:0 6px 16px -10px rgba(15,23,42,.35)}
.ra-gauge.on{border-color:#0f2a4a;box-shadow:0 0 0 2px #0f2a4a inset}
.ra-gauge:focus-visible,.ra-car-nav:focus-visible,.mg-donut-pick:focus-visible{outline:2px solid #3b5b82;outline-offset:2px}
.ra-gauge-head{display:flex;justify-content:space-between;align-items:center;gap:6px;width:100%}
.ra-gauge-head b{font-size:13px;font-weight:800;letter-spacing:.04em;color:#0f2a4a}
.ra-gauge-fpy{font-size:11px;font-weight:700;color:#475569;font-variant-numeric:tabular-nums}
.ra-gauge-name{width:100%;font-size:11.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ra-gauge-nums{display:flex;justify-content:center;gap:10px;font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums;flex-wrap:wrap}
.ra-gauge-nums i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
/* pictorial panel */
.ra-pict{margin-top:14px;padding:14px;border:1px solid #cbd5e1;border-radius:12px;background:#fbfcfe}
.ra-pict-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.ra-pict-title{display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:#0f172a}
.ra-pict-sub{font-size:12.5px;color:#64748b;margin-top:2px}
.ra-map-note{margin:8px 0 0;font-size:11.5px;color:#64748b;line-height:1.45}
.ra-cad-reason{font-weight:800}
/* in process between stations */
.ra-wip{margin-top:16px;padding-top:12px;border-top:1px solid #f1f5f9}
.ra-wip-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.ra-wip-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:8px}
.ra-wip-list li{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;padding:8px 10px;border:1px solid #e2e8f0;border-left:3px solid #94a3b8;border-radius:10px;background:#fff;min-width:0}
.ra-wip-list li.zero{opacity:.65}
.ra-wip-pair{display:inline-flex;align-items:center;gap:2px;font-size:12px;font-weight:700;color:#0f2a4a;width:100%}
.ra-wip-list b{font-size:18px;color:#0f172a}
.ra-wip-unit{font-size:11.5px;color:#64748b}
/* station output */
.ra-time-head,.ra-station-head{display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;margin:4px 0 2px}
.ra-station-head{margin-top:18px;padding-top:12px;border-top:1px solid #f1f5f9;justify-content:space-between}
.ra-drill-sub{margin:6px 0 4px;font-size:12.5px;color:#475569}
.ra-drill-sub b{color:#0f172a}
/* reason list */
.ra-rlist{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px 12px;min-width:0}
.ra-rlist-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px}
.ra-rlist-title{display:flex;align-items:center;gap:5px;font-size:13.5px;font-weight:700;color:#0f172a}
.ra-rlist-sub{font-size:11.5px;color:#64748b}
.ra-rlist-cats{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
.ra-rlist-cats span{border:1px solid;border-radius:999px;padding:1px 8px;font-size:11.5px;font-weight:600;background:#fff}
.ra-rlist-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;max-height:360px;overflow-y:auto}
.ra-rlist-rows li{display:grid;grid-template-columns:9px minmax(0,1fr) auto 46px;align-items:center;gap:8px;font-size:12.5px;color:#334155}
.ra-rlist-dot{width:9px;height:9px;border-radius:50%}
.ra-rlist-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ra-rlist-bar{display:block;height:3px;border-radius:2px;background:#f1f5f9;margin-top:2px;overflow:hidden}
.ra-rlist-bar i{display:block;height:100%;border-radius:2px}
.ra-rlist-rows b{color:#0f172a;font-size:12.5px}
.ra-rlist-pc{text-align:right;color:#64748b;font-size:11.5px}
.ra-rlist-foot{margin-top:8px;padding-top:6px;border-top:1px solid #f1f5f9;font-size:11.5px;color:#64748b}
/* rejections per day + drill panel */
.ra-trend-wrap{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
.ra-trend-wrap.with-list{grid-template-columns:minmax(0,2fr) minmax(280px,1fr)}
@media (max-width:1100px){.ra-trend-wrap.with-list{grid-template-columns:minmax(0,1fr)}}
.ra-day-head{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px;color:#0f172a;margin-bottom:6px}
.ra-day-stats{display:grid;grid-template-columns:1fr;gap:4px}
.ra-day-stats span{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#475569}
.ra-day-stats span b{margin-left:auto;font-size:14px;color:#0f172a}
.ra-day-stats i{display:inline-block;width:9px;height:9px;border-radius:2px}
.ra-seg button .ra-dot{margin-right:2px}
/* category donut + Pareto */
.ra-mix{display:grid;grid-template-columns:minmax(240px,1fr) minmax(0,1.6fr);gap:20px;align-items:start}
@media (max-width:1000px){.ra-mix{grid-template-columns:1fr}}
.ra-pareto-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:4px}
.mg-donut-legend li:has(> .mg-donut-pick){display:block}
.mg-donut-pick{display:grid;grid-template-columns:11px minmax(0,1fr) auto 38px;align-items:center;gap:8px;width:calc(100% + 12px);margin:0 -6px;padding:3px 6px;border:none;border-radius:6px;background:transparent;font:inherit;font-size:12px;color:inherit;text-align:left;cursor:pointer}
.mg-donut-pick:hover{background:#f1f5f9}
.mg-donut-legend li.on .mg-donut-pick{background:#e2e8f0;font-weight:700}
`;

export default function RejectionAnalysis() {
  const location = useLocation();
  // the header has ONE filter: the period (no machine / die / category / reason / zone dropdowns any more)
  const [filters, setFilters] = useState(() => {
    const p = location.state?.period;
    if (p?.dateFrom && p?.dateTo) return { datePreset: p.datePreset || "custom", dateFrom: p.dateFrom, dateTo: p.dateTo };
    // 7 days by default: opens in ~3 s; 30 / 90 days (7–12 s) stay one click away
    return { datePreset: "last7", ...presetRange("last7") };
  });
  const jumpTo = location.state?.section;
  const [tab, setTab] = useState(() => {
    const t = SECTION_TAB[jumpTo] || OLD_TAB[location.state?.tab] || location.state?.tab;
    return TABS.some((x) => x.id === t) ? t : "overview";
  });
  useEffect(() => {
    if (!jumpTo) return undefined;
    const t = setTimeout(() => document.getElementById(jumpTo)?.scrollIntoView({ behavior: "smooth", block: "start" }), 700);
    return () => clearTimeout(t);
  }, [jumpTo]);

  const data = useRejectionData(filters);
  const { get, ensure } = data;
  const shotQ = get("shot");
  const summaryQ = get("summary");
  const paretoQ = get("pareto");
  const trendQ = get("trend");
  const rowsQ = get("rows");
  const mlQ = get("ml");
  const configQ = get("config");

  const shot = shotQ.data || null;
  const summaryRes = summaryQ.data || null;
  const summary = useMemo(() => summaryRes?.summary || {}, [summaryRes]);
  const ngRecords = useMemo(() => (Array.isArray(rowsQ.data?.rows) ? rowsQ.data.rows : null), [rowsQ.data]);
  /* ONE NG source for every widget: the decisive NG scan per part per gate (rejection-pareto ngRecords — the
     Historical page / plant sheet rule; leak NG as Historical counts it). The NG part rows only add details. */
  const decisive = Array.isArray(paretoQ.data?.ngRecords) ? paretoQ.data.ngRecords : null;
  const enriched = useMemo(() => (decisive ? enrichRows(decisiveRows(decisive, ngRecords)) : null), [decisive, ngRecords]);
  const gateNg = paretoQ.data?.gateShiftNg || null;
  const gates = useMemo(() => {
    const list = summaryRes?.qualityGates || EMPTY;
    if (!gateNg) return list;
    const norm = (c) => String(c || "").toUpperCase().replace(/[\s_-]/g, "");
    const byCode = Object.fromEntries(Object.entries(gateNg).map(([c, v]) => [norm(c), v.total]));
    const leakSum = Object.entries(byCode).filter(([c]) => c.startsWith("LEAK")).reduce((a, [, v]) => a + v, 0);
    return list.map((g) => {
      const c = norm(g.code);
      const ng = c === "OP150" ? leakSum : byCode[c] || 0;
      return { ...g, ngCount: ng, inspected: (Number(g.okCount) || 0) + ng };
    });
  }, [summaryRes, gateNg]);

  const catCounts = useMemo(() => stationCategoryCounts(enriched, paretoQ.data?.categoryPareto), [enriched, paretoQ.data]);
  // OK / NG / In progress = the summary totals (parts passed Final, NG parts, parts cast in the period still open) —
  // the same figures as the Dashboard and the Historical page. Station rejection counts (decisive scans) are separate.
  const k = useMemo(() => ({
    ...computeKpis({ shot, summary: summaryRes?.summary || null, catCounts }),
    stationRejections: decisive ? decisive.length : null,
  }), [shot, summaryRes, catCounts, decisive]);

  /* process data (Root Cause / SPC) */
  const mlInsights = mlQ.data?.mlInsights || EMPTY_ML;
  const mlAnalysis = mlQ.data?.analysis || mlQ.data?.mlInsights?.analysis || null;
  const mlRows = useMemo(() => {
    const d = mlQ.data;
    if (Array.isArray(d?.telemetryRows) && d.telemetryRows.length) return d.telemetryRows;
    return Array.isArray(d?.rows) ? d.rows : EMPTY;
  }, [mlQ.data]);
  const rejectedRows = useMemo(() => mlRows.filter(isNgRow), [mlRows]);
  /* every NG record known (NG part records first, process rows fill empty fields) */
  const allRejectionRecords = useMemo(() => {
    const map = new Map();
    const add = (r) => {
      const key = r?.id || r?.partId || r?.part_id || r?.rowKey;
      if (!key) return;
      const cur = map.get(key);
      if (!cur) { map.set(key, r); return; }
      const next = { ...cur };
      Object.entries(r).forEach(([f, v]) => { if ((next[f] === undefined || next[f] === null || next[f] === "") && v !== undefined) next[f] = v; });
      map.set(key, next);
    };
    (enriched || EMPTY).forEach(add);
    rejectedRows.forEach(add);
    return Array.from(map.values());
  }, [enriched, rejectedRows]);

  const loadingShot = shotQ.status === "loading";
  const loadingSummary = summaryQ.status === "loading";
  const rowsLoading = rowsQ.status === "loading";
  const mlLoading = mlQ.status === "loading";
  const anyLoading = [shotQ, summaryQ, paretoQ, trendQ].some((x) => x.status === "loading");
  const tabBusy = (TAB_NEEDS[tab] || []).some((key) => get(key).status === "loading");
  const tabErrors = (TAB_NEEDS[tab] || []).filter((key) => get(key).status === "error");

  /* period */
  const onPreset = useCallback((p) => setFilters({ datePreset: p, ...presetRange(p) }), []);
  const onCustom = useCallback((from, to) => setFilters({ datePreset: "custom", dateFrom: from, dateTo: to }), []);

  // a tab asks for its data the first time it is shown (and again for a new period)
  useEffect(() => { (TAB_NEEDS[tab] || []).forEach((key) => ensure(key)); }, [tab, ensure]);

  /* tabs: arrow keys move between tabs */
  const tabRefs = useRef({});
  const onTabKey = useCallback((e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setTab(TABS[n].id);
    tabRefs.current[TABS[n].id]?.focus();
  }, [tab]);

  /* export: summary sheet + every NG record of the period */
  const [exp, setExp] = useState({ state: "idle", msg: "" });
  useEffect(() => {
    if (exp.state !== "success" && exp.state !== "error") return undefined;
    const t = setTimeout(() => setExp({ state: "idle", msg: "" }), 3500);
    return () => clearTimeout(t);
  }, [exp.state]);
  const onExport = useCallback(async () => {
    setExp({ state: "loading", msg: "Preparing Excel…" });
    try {
      let rows = enriched;
      if (!rows) {
        const res = await data.run(() => dashboardApi.rejectionRows({ ...data.query, status: "NG", page: 1, pageSize: 10000, _ts: Date.now() }, { timeout: 90000, suppressGlobalError: true }));
        rows = enrichRows(res?.rows || []);
      }
      const count = await exportRejectionExcel({
        k, gates,
        dies: buildDieRows({ shot, dieStats: summaryRes?.dieStats }),
        shifts: null,
        enriched: rows,
        periodText: rangeLabel(filters.dateFrom, filters.dateTo),
        shiftText: "All shifts",
      });
      setExp({ state: "success", msg: `Exported summary + ${count.toLocaleString()} NG records` });
    } catch (err) {
      console.error("[REJECTION] export failed:", err);
      setExp({ state: "error", msg: "Export failed — please retry." });
    }
  }, [enriched, data, k, gates, shot, summaryRes, filters]);

  const [showRecipe, setShowRecipe] = useState(false);
  const [hideErrors, setHideErrors] = useState("");
  const errorKey = data.errors.join("|");

  const tabCount = {
    overview: gates.length || null,
    die_analysis: shot?.byDie?.filter((d) => d.die).length || null,
    records: k.totalNg || null,
  };

  return (
    <ChartDownloadProvider>
      <MgmtStyles />
      <style>{PAGE_CSS}</style>
      <div className="mg-root ra-page">
        <HeaderBar
          title="Rejection Analysis"
          filters={filters}
          onPreset={onPreset}
          onCustom={onCustom}
          lastUpdated={data.lastUpdated}
          loading={anyLoading}
          onRefresh={data.reload}
          onExport={onExport}
          exportState={exp.state}
          machine={k.machine}
        />

        {data.errors.length > 0 && hideErrors !== errorKey && (
          <div className="ra-banner" role="alert">
            <span style={{ display: "flex", gap: 8 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span><b>Some data could not be loaded:</b> {data.errors.join(" · ")}.{" "}
                <button type="button" onClick={data.reload} style={{ textDecoration: "underline", fontWeight: 700 }}>Retry</button>
              </span>
            </span>
            <button type="button" onClick={() => setHideErrors(errorKey)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        )}

        <div className="ra-sticky">
          <RejectionKpiStrip
            k={k}
            trendData={trendQ.data}
            shot={shot}
            singleDay={data.singleDay}
            loadingShot={loadingShot}
            loadingSummary={loadingSummary}
          />
        </div>

        <div className="ra-tabs-row">
          <div className="mg-tabs" role="tablist" aria-label="Rejection analysis views" onKeyDown={onTabKey}>
            {TABS.map((t) => {
              const active = tab === t.id;
              const TIcon = t.icon;
              const count = tabCount[t.id];
              return (
                <button
                  key={t.id}
                  ref={(el) => { tabRefs.current[t.id] = el; }}
                  type="button"
                  role="tab"
                  id={`ra-tab-${t.id}`}
                  aria-selected={active}
                  aria-controls={`ra-panel-${t.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(t.id)}
                >
                  <TIcon size={14} aria-hidden="true" />
                  {t.label}
                  {count ? <span className="ra-seg-count">{count.toLocaleString("en-IN")}</span> : null}
                </button>
              );
            })}
          </div>
          {tabBusy && <span className="ra-busy" role="status"><Loader2 size={13} className="ra-spin" /> Loading data for this tab…</span>}
          {!tabBusy && tabErrors.length > 0 && (
            <span className="ra-busy err" role="alert"><AlertTriangle size={13} /> Some data for this tab could not be loaded · <button type="button" className="mg-link" onClick={data.reload}>Retry</button></span>
          )}
        </div>

        <div className="ra-tabpanel" role="tabpanel" id={`ra-panel-${tab}`} aria-labelledby={`ra-tab-${tab}`}>
          {tab === "overview" && (
            <StationOverviewTab
              key={`${filters.dateFrom}|${filters.dateTo}`}
              filters={filters}
              singleDay={data.singleDay}
              gates={gates}
              pareto={paretoQ.data}
              enriched={enriched}
              rowsLoading={rowsLoading}
              summaryLoading={loadingSummary}
              trendData={trendQ.data}
              trendLoading={trendQ.status === "loading"}
              shot={shot}
              k={k}
              config={configQ.data}
              configLoading={configQ.status === "loading"}
              ensure={ensure}
            />
          )}

          {tab === "die_analysis" && (
            <DieShotTab
              shot={shot}
              shotLoading={loadingShot}
              dieStats={summaryRes?.dieStats || EMPTY}
              dieDaily={summaryRes?.dieDaily || EMPTY}
              summary={summary}
            />
          )}

          {tab === "ml_analysis" && (
            <RootCauseTab
              mlInsights={mlInsights}
              summary={summary}
              pareto={paretoQ.data?.pareto || EMPTY}
              rows={mlRows}
              recordsRows={EMPTY}
              allRejectionRecords={allRejectionRecords}
              rejectedRows={rejectedRows}
              filters={filters}
              analysis={mlAnalysis}
              loading={mlLoading}
            />
          )}

          {tab === "telemetry" && (
            <TelemetryTab
              rows={mlRows}
              recordsRows={EMPTY}
              allRejectionRecords={allRejectionRecords}
              mlInsights={mlInsights}
              onOpenRecipeModal={() => setShowRecipe(true)}
              analysis={mlAnalysis}
              loading={mlLoading}
            />
          )}

          {tab === "records" && (
            <ScrapRecordsTab
              recordsRows={ngRecords || EMPTY}
              recordsTotal={ngRecords?.length || 0}
              recordsLoading={rowsLoading}
              loading={loadingSummary}
              summary={summary}
              rows={mlRows}
              rejectedRows={rejectedRows}
              filters={filters}
              stationLabels={summaryRes?.stationLabels || {}}
            />
          )}

          {tab === "heat_map" && (
            <HeatMapTab
              allRejectionRecords={enriched || EMPTY}
              rejectionConfig={configQ.status === "done" ? configQ.data : null}
              loading={rowsLoading}
              configLoading={configQ.status === "loading"}
              error={rowsQ.status === "error" ? rowsQ.error : null}
              onRetry={data.reload}
            />
          )}
        </div>
      </div>

      <MasterRecipeModal isOpen={showRecipe} onClose={() => setShowRecipe(false)} mlInsights={mlInsights} />

      {exp.msg && (
        <div className={`ra-toast ${exp.state === "error" ? "error" : ""}`} role="status">
          {exp.state === "success" ? <CheckCircle2 size={15} /> : exp.state === "error" ? <X size={15} /> : null}
          {exp.msg}
        </div>
      )}
    </ChartDownloadProvider>
  );
}
