import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import {
  CheckCircle2, Gauge, Factory, XCircle, Hourglass, Workflow, Activity, Grid3x3, Sigma, Users, AlertTriangle,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Play, Pause, Layers,
  RotateCcw, BarChart3, PieChart as PieIcon, Target, Camera, Grid, Eye,
  Maximize2, Minimize2, Copy, Check, X, Plus, Cpu, MapPin,
  FileSpreadsheet, Search, Download,
} from "lucide-react";
import {
  ComposedChart, BarChart, PieChart, Pie, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList, ReferenceLine,
} from "recharts";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import { dashboardApi } from "../../api/services";
import SafeChart from "../../components/charts/SafeChart";
import StationSpeedometer from "./components/StationSpeedometer";
import RejectionAnalysisSkeleton from "./components/RejectionAnalysisSkeleton";
import {
  formatResultTimestamp, looksLikeCustomerQr, fmtNum,
  extractShotFromPartId, extractShotDateTimeFromPartId,
  cleanZoneCode, cleanSubZoneCode, normalizeCode, canonicalizeReason,
  normalizeDefectKey, isReasonMatch, normalizeDefectCategory,
  parseRowDefect, isRecordMatchingStation, resolveDefectLocation, getFullImageUrl, boxStyle, buildViewLocations,
} from "./rejectionConstants";
import CadStage from "./components/CadStage";
import {
  OUTCOME, DEFECT_CATEGORY_LABEL, SHIFT, STATUS, INK, OTHER, CATEGORICAL, FONT_FAMILY,
  RECHARTS_TOOLTIP, RECHARTS_AXIS, RECHARTS_GRID, CARD_CSS, SEQ_SCRAP, ACCENT, LEGEND,
  ECHART_TOOLTIP, tooltipHtml, baseOption, axisLabel, accent, seqColor,
  makeColorMap, shiftKey, categoryColor, withAlpha, fmtInt, fmtPct,
} from "./chartTheme";
import EChart from "../../components/charts/EChart";
import { useDailyQualityCards } from "./DailyQualityTrend";
import InfoTip from "./components/InfoTip";

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */
const SHIFT_ORDER = ["A", "B", "C", "Unassigned"];
const shiftLabel = (k) => (k === "Unassigned" ? "Unassigned" : `Shift ${k}`);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** % with an explicit denominator; null (→ "—") when the denominator is 0. */
const pctOf = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);
/** Scrap rate of an inspection station = NG ÷ (OK + NG) inspected there. */
const gateRate = (g) => pctOf(num(g?.ngCount), num(g?.okCount) + num(g?.ngCount)) ?? 0;
/** Station state bands (same limits as the gauge): ≤2.5% pass · 2.5–5% watch · >5% alert. */
const gateStatus = (rate) => (rate > 5
  ? { label: "ALERT", color: STATUS.critical }
  : rate >= 2.5 ? { label: "WATCH", color: STATUS.warning } : { label: "PASS", color: STATUS.good });
const catLabel = (c) => DEFECT_CATEGORY_LABEL[String(c || "").toUpperCase()] || c;
const truncate = (s, n) => (s && String(s).length > n ? `${String(s).slice(0, n - 1)}…` : s);
const AXIS_LABEL_STYLE = { fill: INK.body, fontSize: 11, fontWeight: 600, fontFamily: FONT_FAMILY };
const NOT_RECORDED = "Not recorded";
const NOT_RECORDED_KEY = "NOT RECORDED"; // upper-case form used by the gate drill-down category keys
/** Record category matches the drill-down category; a blank category matches "NOT RECORDED". */
const categoryMatches = (recordCat, wanted) =>
  (String(recordCat || "").toUpperCase() || NOT_RECORDED_KEY) === String(wanted || "").toUpperCase();

/* ── Station identity (colour follows the station code, never its rank) ─────────────────────────
   The three OP150 leak-test machines run in parallel, so they share one hue family (violet shades). */
const STATION_COLOR = {
  // no green: green means OK on every chart of this page
  OP100: "#5b6b8c", OP110: "#e87ba4", OP120: "#2a78d6", OP130: "#eb6834", OP140: "#eda100",
  OP150: "#4a3aa7", "LEAK-1": "#4a3aa7", "LEAK-2": "#7a6dd0", "LEAK-3": "#a59be3", OP160: "#b8338f",
};
const isLeakCode = (c) => { const u = String(c || "").toUpperCase(); return u === "OP150" || u.startsWith("LEAK"); };
/** Leak machine number from "Leak-Test-01", "Leak Test-03 (OP150)", "Leak-Test-1" … → "1" | "3" | null. */
const leakNo = (code) => { const m = String(code || "").toUpperCase().match(/LEAK[\s_-]*TEST[\s_-]*0*(\d)/); return m ? m[1] : null; };
const stationColor = (code) => {
  const n = leakNo(code);
  if (n) return STATION_COLOR[`LEAK-${n}`] || STATION_COLOR.OP150;
  return STATION_COLOR[String(code || "").toUpperCase()] || OTHER;
};
const opNumber = (code) => (isLeakCode(code) ? 150 : Number(String(code || "").match(/OP\s*(\d+)/i)?.[1]) || 999);
/** Station name without the repeated op code: "Casting PDi + OP120" → "Casting PDi". */
const stationShortName = (name, code) => String(name || code || "")
  .replace(/\s*\+\s*OP\d+/i, "").replace(/\s*\(OP\d+\)/i, "").trim() || code;

/**
 * Station that rejected an NG record, as one of `stationCodes` (the station columns on screen).
 * ngGate is authoritative ("OP120", or "OP130, OP150" when two gates flagged it → the first gate, which is
 * where the station counts book it). Leak records ("OP150") go to their machine via ngStation when the
 * machines are shown separately.
 */
const recordStationKey = (r, stationCodes) => {
  const gates = String(r?.ngGate || r?.ng_gate || "").toUpperCase().split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!gates.length) return null;
  const first = gates[0];
  if (first === "OP150" || first.includes("LEAK")) {
    if (stationCodes.includes("OP150")) return "OP150";
    const n = leakNo(r.ngStation || r.ng_station || first);
    return (n && stationCodes.find((c) => leakNo(c) === n)) || "OP150";
  }
  return stationCodes.find((c) => String(c).toUpperCase() === first) || first;
};


/** Themed Recharts tooltip body (same look as tooltipHtml for ECharts). */
function TipCard({ title, subtitle, rows = [], note }) {
  return (
    <div style={{ ...RECHARTS_TOOLTIP.contentStyle, minWidth: 190, maxWidth: 380 }}>
      {(title || subtitle) && (
        <div style={{ paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid #e2e8f0" }}>
          {title && <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{title}</div>}
          {subtitle && <div style={{ color: "#64748b", fontSize: 11.5, marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,auto) auto", alignItems: "center", gap: "6px 22px" }}>
        {rows.filter(Boolean).map((r) => (
          <Fragment key={r.label}>
            <span style={{ display: "flex", alignItems: "center", color: "#475569", fontSize: 12 }}>
              {r.color && <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: r.color, marginRight: 8, flexShrink: 0 }} />}
              {r.label}
            </span>
            <span style={{ textAlign: "right", color: r.strong === false ? "#475569" : "#0f172a", fontWeight: r.strong === false ? 500 : 700, fontSize: 12.5, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{r.value}</span>
          </Fragment>
        ))}
      </div>
      {note && <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.45, marginTop: 9, paddingTop: 7, borderTop: "1px solid #e2e8f0", maxWidth: 320, whiteSpace: "normal" }}>{note}</div>}
    </div>
  );
}

/* ── What each chart shows and the formula behind it (the (i) next to every heading) ── */
const INFO = {
  pipeline: {
    what: "Every inspection station in process order with its scrap rate. Click a station to open its defect map and parts.",
    formula: ["Scrap rate = NG ÷ (OK + NG) inspected at the station × 100", "PASS ≤ 2.5% · WATCH 2.5–5% · ALERT > 5%", "Defect PPM = NG ÷ inspected × 1,000,000"],
  },
  flow: {
    what: "Parts entering each step in process order: green = passed (OK), red = NG removed at that step, label above = total inspected. The three leak-test machines run in parallel and count as one OP150 step.",
    formula: ["Entering = OK + NG inspected at the step", "FPY = OK ÷ (OK + NG) × 100", "Rolled yield = FPY₁ × FPY₂ × … up to this step", "RTY = Π FPYᵢ over all steps"],
    note: "The shaded band between bars is the flow to the next step; a gap means parts passed but have not reached the next step yet.",
  },
  stations: {
    what: "Parts passed and rejected at each station. Click a station for its defect categories, then a category for its reasons.",
    formula: ["Inspected = OK + NG at the station", "Scrap rate = NG ÷ inspected × 100", "Category share = category NG ÷ station NG × 100"],
  },
  ci: {
    what: "Each station's NG rate with its 95% confidence interval. A station is significantly worse (red) or better (green) than the plant only when its whole interval sits above or below the average line.",
    formula: ["p̂ = NG ÷ (OK + NG), n = OK + NG", "Wilson centre = (p̂ + z²/2n) ÷ (1 + z²/n)", "Half-width = z·√(p̂(1−p̂)/n + z²/4n²) ÷ (1 + z²/n), z = 1.96", "Plant average = Σ NG ÷ Σ inspected"],
  },
  matrix: {
    what: "Which station catches each defect reason (top 10 reasons, the rest folded). Darker cells = more NG parts.",
    formula: ["Cell = NG parts with that reason rejected at that station", "Row total = all stations for the reason · column total = all reasons at the station"],
  },
  shiftOutput: {
    what: "Parts produced per shift, split into final OK, NG and still in process.",
    formula: ["Produced = OK + NG + in process", "OK % = OK ÷ (OK + NG) × 100", "NG % = NG ÷ (OK + NG) × 100"],
    note: "Shifts follow Shift Management: A 06:00:00–14:29:59, B 14:30:00–22:59:59, C 23:00:00–05:59:59.",
  },
  shiftDonut: {
    what: "Each shift's share of all NG parts, with its NG rate compared with the plant.",
    formula: ["Share = shift NG ÷ all NG × 100", "Shift NG rate = NG ÷ (OK + NG) in the shift × 100", "Δ vs plant = shift NG rate − plant NG rate (pp)"],
  },
  categoryDonut: {
    what: "NG parts by defect category (inner ring) and the top reasons inside each category (outer ring). CR = casting rejection, CRAM = casting rejection after machining (includes leak test), MR = machining rejection.",
    formula: ["Category share = category NG ÷ all NG × 100", "Reason share = reason NG ÷ all NG × 100"],
    note: "Reasons under 1.5% of all NG or beyond a category's top 5 are folded into \"Other\".",
  },
  pareto: {
    what: "Rejection reasons (or categories / zones) ranked by NG parts. The red bars are the vital few that make up the first 80% of NG. Click a bar to show it on the defect map.",
    formula: ["Share = item NG ÷ all NG × 100", "Cumulative % = running sum of shares, largest first", "Vital few = items until cumulative ≥ 80%"],
  },
};

/** Card header in the shared design system. */
function CardHead({ title, sub, icon: Icon, info, children }) {
  return (
    <div className="ra-card-head">
      <div style={{ minWidth: 0, flex: "1 1 260px", display: "flex", gap: 10, alignItems: "flex-start" }}>
        {Icon && <span className="ra-icon" aria-hidden="true"><Icon size={16} /></span>}
        <div style={{ minWidth: 0 }}>
          <h3 className="ra-card-title" style={{ display: "flex", alignItems: "center" }}>{title}<InfoTip info={info} /></h3>
          {sub && <p className="ra-card-sub">{sub}</p>}
        </div>
      </div>
      {children && <div className="rej-header-actions">{children}</div>}
    </div>
  );
}

function StatusBadge({ rate }) {
  const s = gateStatus(rate);
  return (
    <span className="qg-status" style={{ color: s.color === STATUS.warning ? "#8a5a00" : s.color, background: withAlpha(s.color, 0.12), borderColor: withAlpha(s.color, 0.45) }}>
      {s.label}
    </span>
  );
}

function Empty({ children, height = 200 }) {
  return <div className="qg-empty" style={{ minHeight: height }}>{children}</div>;
}

/* Tab-local styles: tone down the shared rej-* classes used here (no 800/900 weights, glows or pulses). */
const QG_CSS = `
.qg-root{display:flex;flex-direction:column;gap:16px;font-family:${FONT_FAMILY}}
.qg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px}
.qg-kpis .ra-kpi-value{font-size:21px}
.qg-empty{display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;color:${INK.muted};font-size:12.5px}
.qg-status{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.04em;padding:1px 7px;border-radius:999px;border:1px solid}
.qg-table-wrap{overflow-x:auto;margin:4px 4px 0}
.qg-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
.qg-table th{font-size:11px;font-weight:600;color:${INK.muted};text-transform:uppercase;letter-spacing:.05em;text-align:right;padding:7px 10px;border-bottom:1px solid ${INK.border};white-space:nowrap}
.qg-table td{padding:7px 10px;text-align:right;border-bottom:1px solid ${INK.grid};color:${INK.secondary};white-space:nowrap}
.qg-table th:first-child,.qg-table td:first-child{text-align:left}
.qg-table tfoot td{font-weight:700;color:${INK.primary};border-top:1px solid ${INK.border};border-bottom:none}
.qg-swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:7px;vertical-align:-1px}
.qg-list{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.qg-list-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border-radius:8px;background:${INK.surfaceAlt};border:1px solid ${INK.grid};font-size:12px;color:${INK.secondary}}
.qg-list-row b{font-weight:600;color:${INK.primary}}
.qg-list-row .num{font-variant-numeric:tabular-nums;white-space:nowrap}
.qg-donut-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none}
.qg-donut-center .l{font-size:11px;font-weight:600;color:${INK.muted};text-transform:uppercase;letter-spacing:.06em}
.qg-donut-center .v{font-size:21px;font-weight:700;color:${INK.primary};font-variant-numeric:tabular-nums}
.qg-donut-center .s{font-size:11.5px;color:${INK.muted}}
.qg-root .rej-kpi-value,.qg-root .rej-card-title,.qg-root .rej-gate-code,.qg-root .rej-gate-op-tag,.qg-root .rej-gate-badge-status,
.qg-root .rej-gate-stats,.qg-root .rej-parallel-label,.qg-root .rej-wire-title,.qg-root .rej-wire-arrow,.qg-root .rej-wire-count,
.qg-root .rej-station-drawer-title,.qg-root .rej-station-tag,.qg-root .rej-station-speedo-header .title,.qg-root .rej-station-mini-kpi .kpi-formula-tag,
.qg-root .rej-station-mini-kpi .val,.qg-root .rej-station-reason-row .pct-tag,.qg-root .rej-studio-title,.qg-root .rej-studio-tag,
.qg-root .rej-studio-angle-tab .count-pill,.qg-root .rej-viewport-title,.qg-root .rej-viewport-status-badge,.qg-root .rej-intel-card-label,
.qg-root .rej-intel-card-val,.qg-root .rej-param-box-val,.qg-root .rej-context-table th,.qg-root .rej-status-pill,.qg-root .rej-breadcrumb-active,
.qg-root .rej-quick-focus-label{font-weight:700}
.qg-root .rej-gate-stats,.qg-root .rej-station-mini-kpi .val,.qg-root .rej-wire-count{font-variant-numeric:tabular-nums}
.qg-root .rej-station-mini-kpi .val{font-size:20px}
.qg-root .rej-station-mini-kpi .label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
.qg-root .rej-wire-dot{animation:none}
.qg-root .rej-studio-angle-tab .count-pill.danger,.qg-root .rej-viewport-status-badge.info{box-shadow:none}
.qg-root .rej-gate-card.active{box-shadow:0 0 0 2px ${withAlpha(CATEGORICAL[0], 0.35)}}
.qg-root .reason-bar-fill{background:${OUTCOME.ng}}
.qg-root .rej-station-drawer,.qg-root .rej-studio-container{border-radius:14px}
@media(max-width:1100px){.qg-root .qg-split{grid-template-columns:1fr !important}}
.qg-kpis .ra-kpi-top .ra-icon{width:26px;height:26px;border-radius:8px}
.qg-formula{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:2px 4px 10px;padding:9px 12px;border-radius:10px;background:${INK.surfaceAlt};border:1px solid ${INK.grid};font-size:12px;color:${INK.body};font-variant-numeric:tabular-nums}
.qg-formula b{color:${INK.primary};font-weight:700}
.qg-formula .eq{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;color:${INK.secondary}}
.qg-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin:10px 4px 0}
.qg-step{border:1px solid ${INK.border};border-top:3px solid var(--accent);border-radius:10px;padding:7px 9px;font-size:11.5px;color:${INK.body};font-variant-numeric:tabular-nums;min-width:0}
.qg-step .c{font-weight:700;color:${INK.primary};font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qg-step .r{display:flex;justify-content:space-between;gap:6px}
.qg-step .r span:last-child{font-weight:600;color:${INK.secondary}}
.qg-warn{display:flex;gap:8px;align-items:flex-start;margin:10px 4px 0;padding:8px 11px;border-radius:9px;font-size:11.5px;line-height:1.45;color:#7a4b00;background:${withAlpha(STATUS.warning, 0.12)};border:1px solid ${withAlpha(STATUS.warning, 0.4)}}
.qg-scroll{overflow-x:auto;overflow-y:hidden}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function QualityGatesTab({
  loading = false,
  summary = {},
  qualityGates = [],
  stationLabels = {},
  rejectionConfig = null,
  qualityGateDrillDown = {},
  pareto = [],
  categoryParetoData = [],
  zoneParetoData = [],
  shiftScrap = [],
  rows = [],
  recordsRows = [],
  allRejectionRecords = [],
  rejectedRows = [],
  filters = {},
}) {
  /* ── State ──────────────────────────────────────────────────────────────── */
  const [isOp150Grouped, setIsOp150Grouped] = useState(false);
  const [drillDownLevel, setDrillDownLevel] = useState(0);
  const [drillDownGate, setDrillDownGate] = useState(null);
  const [drillDownCategory, setDrillDownCategory] = useState(null);
  const [drillDownReason, setDrillDownReason] = useState(null);
  const [drillDownSelectedView, setDrillDownSelectedView] = useState("all");
  const [showPartIdTable, setShowPartIdTable] = useState(true);
  const [isPictorialExpanded, setIsPictorialExpanded] = useState(true);
  const [isPartsLogExpanded, setIsPartsLogExpanded] = useState(true);
  const [partIdSearch, setPartIdSearch] = useState("");

  const [paretoView, setParetoView] = useState("reason");
  const [paretoDrill, setParetoDrill] = useState(null); // { view, key } — Pareto bar opened to "rejected at which station"
  const [paretoChartMode, setParetoChartMode] = useState("pareto");
  /* shiftChartMode removed — now always showing side-by-side donuts */
  const [selectedParetoItem, setSelectedParetoItem] = useState(null);
  const [paretoSelectedView, setParetoSelectedView] = useState("all");
  const [paretoPartSearch, setParetoPartSearch] = useState("");

  const [isStationPictorialOpen, setIsStationPictorialOpen] = useState(false);
  const [stationActiveAngle, setStationActiveAngle] = useState("all");

  const [isStudioVisible, setIsStudioVisible] = useState(false);
  const [studioActiveAngle, setStudioActiveAngle] = useState("all");
  const [studioFullscreen, setStudioFullscreen] = useState(false);
  const [contextLogViewMode, setContextLogViewMode] = useState("defect");
  const [contextLogSearch, setContextLogSearch] = useState("");
  const [contextLogPage, setContextLogPage] = useState(1);
  const [contextLogPageSize, setContextLogPageSize] = useState(10);
  const [isContextLogExpanded, setIsContextLogExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const [gateDrillDownParts, setGateDrillDownParts] = useState([]);
  const [gateDrillDownLoading, setGateDrillDownLoading] = useState(false);
  const [paretoDrillDownParts, setParetoDrillDownParts] = useState([]);
  const [paretoDrillDownLoading, setParetoDrillDownLoading] = useState(false);

  const pipelineCarouselRef = useRef(null);
  const [isCarouselHovered, setIsCarouselHovered] = useState(false);
  const [isCarouselPlaying, setIsCarouselPlaying] = useState(false); // auto-scroll is opt-in (no motion by default)
  const studioRef = useRef(null);

  /* ── Auto-scroll pipeline carousel ──────────────────────────────────────── */
  useEffect(() => {
    const el = pipelineCarouselRef.current;
    if (!el || !isCarouselPlaying || isCarouselHovered || !qualityGates?.length) return;
    let animId, isRewinding = false, pauseUntil = 0;
    const scrollStep = (ts) => {
      if (el && !isCarouselHovered && isCarouselPlaying) {
        const maxScroll = el.scrollWidth - el.clientWidth;
        if (maxScroll > 10) {
          if (ts < pauseUntil) { /* hold */ }
          else if (isRewinding) {
            el.scrollTo({ left: 0, behavior: "smooth" });
            isRewinding = false;
            pauseUntil = ts + 1800;
          } else if (el.scrollLeft >= maxScroll - 2) {
            pauseUntil = ts + 2200;
            isRewinding = true;
          } else {
            el.scrollLeft += 0.65;
          }
        }
      }
      animId = requestAnimationFrame(scrollStep);
    };
    animId = requestAnimationFrame(scrollStep);
    return () => cancelAnimationFrame(animId);
  }, [isCarouselPlaying, isCarouselHovered, qualityGates]);

  const scrollPipeline = useCallback((dir) => {
    const el = pipelineCarouselRef.current;
    if (el) el.scrollBy({ left: dir === "left" ? -220 : 220, behavior: "smooth" });
  }, []);

  const copyToClipboard = useCallback((text, id) => {
    if (!text) return;
    try {
      navigator.clipboard.writeText(String(text));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch { /* silent */ }
  }, []);

  /* ── Fetch gate drill-down parts ────────────────────────────────────────── */
  useEffect(() => {
    if (!drillDownGate) { setGateDrillDownParts([]); return; }
    let isCancelled = false;
    (async () => {
      setGateDrillDownLoading(true);
      try {
        const query = { qualityGate: drillDownGate, status: "NG", pageSize: 500, noCache: "1", _ts: Date.now() };
        if (drillDownCategory) query.category = drillDownCategory;
        if (drillDownReason) query.reason = drillDownReason;
        if (filters.datePreset) query.datePreset = filters.datePreset;
        if (filters.datePreset === "all") query.allTime = "1";
        if (filters.dateFrom) query.dateFrom = filters.dateFrom;
        if (filters.dateTo) query.dateTo = filters.dateTo;
        if (filters.shiftCode) query.shiftCode = filters.shiftCode;
        if (filters.machineName) query.machineName = filters.machineName;
        if (filters.partName) query.partName = filters.partName;
        if (filters.partCategory) query.partCategory = filters.partCategory;
        if (filters.dieName) query.dieName = filters.dieName;
        const res = await dashboardApi.rejectionRows(query, { timeout: 30000, suppressGlobalError: true });
        if (!isCancelled && Array.isArray(res?.rows)) setGateDrillDownParts(res.rows);
      } catch (err) {
        console.warn("[REJECTION UI] Gate drilldown fetch failed:", err);
      } finally {
        if (!isCancelled) setGateDrillDownLoading(false);
      }
    })();
    return () => { isCancelled = true; };
  }, [drillDownGate, drillDownCategory, drillDownReason, filters]);

  /* ── Pareto computations ───────────────────────────────────────────────── */
  const cleanPareto = useMemo(() => {
    const map = {};
    const normKeyToCanon = {};
    if (pareto?.length) {
      pareto.forEach((p) => {
        const raw = p.reason;
        if (!raw || String(raw).toLowerCase().includes("unspecified")) return;
        const canon = canonicalizeReason(raw);
        const norm = normalizeDefectKey(canon);
        if (!normKeyToCanon[norm]) normKeyToCanon[norm] = canon;
        const t = normKeyToCanon[norm];
        map[t] = (map[t] || 0) + (Number(p.count) || 0);
      });
    } else if (rejectedRows.length) {
      rejectedRows.forEach((r) => {
        const p = parseRowDefect(r);
        const reason = p.reason || r.rejection_reason || r.ng_reason || NOT_RECORDED;
        const qty = Number(r.quantity || r.scrap_quantity || 1);
        if (reason && reason !== "-" && !reason.toLowerCase().includes("unspecified")) {
          const canon = canonicalizeReason(reason);
          const norm = normalizeDefectKey(canon);
          if (!normKeyToCanon[norm]) normKeyToCanon[norm] = canon;
          const t = normKeyToCanon[norm];
          map[t] = (map[t] || 0) + qty;
        }
      });
    }
    const list = Object.entries(map).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
    const total = list.reduce((s, c) => s + (Number(c.count) || 0), 0) || 1;
    let cum = 0;
    return list.map((it) => {
      const c = Number(it.count) || 0;
      cum += c;
      return {
        ...it, count: c,
        percentage: Number(((c / total) * 100).toFixed(1)),
        cumulativePercentage: Number(((cum / total) * 100).toFixed(1)),
      };
    });
  }, [pareto, rejectedRows]);

  const categoryPareto = useMemo(() => {
    // A missing category is shown as "Not recorded" — never silently folded into CR.
    // Shares are always recomputed here so every view uses the same denominator.
    const map = {};
    if (categoryParetoData?.length) {
      categoryParetoData
        .filter((c) => c.category && !String(c.category).toLowerCase().includes("unspecified"))
        .forEach((c) => {
          const cat = c.category === "-" ? NOT_RECORDED : String(c.category).toUpperCase();
          map[cat] = (map[cat] || 0) + num(c.count);
        });
    } else {
      rejectedRows.forEach((r) => {
        const p = parseRowDefect(r);
        const qty = Number(r.quantity || r.scrap_quantity || 1);
        const raw = p.category || r.category || r.rejection_category || "";
        if (String(raw).toLowerCase().includes("unspecified")) return;
        const cat = raw && raw !== "-" ? String(raw).toUpperCase() : NOT_RECORDED;
        map[cat] = (map[cat] || 0) + qty;
      });
    }
    const sorted = Object.entries(map).map(([category, count]) => ({ category, count })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, c) => s + c.count, 0) || 1;
    let cum = 0;
    return sorted.map((it) => {
      cum += it.count;
      return {
        ...it,
        percentage: Number(((it.count / total) * 100).toFixed(1)),
        cumulativePercentage: Number(((cum / total) * 100).toFixed(1)),
      };
    });
  }, [categoryParetoData, rejectedRows]);

  const zoneBreakdown = useMemo(() => {
    const formatZoneLabel = (z) => {
      const s = String(z || "").trim();
      if (!s || s === "-" || s.toLowerCase().includes("unspecified")) return "Zone General";
      if (s.toLowerCase().includes("leak") || s.toLowerCase().includes("150")) return "Leak Test";
      return s;
    };
    if (zoneParetoData?.length) {
      const merged = {};
      zoneParetoData
        .filter((z) => z.zone && !String(z.zone).toLowerCase().includes("unspecified"))
        .forEach((z) => {
          const lbl = formatZoneLabel(z.zone);
          merged[lbl] = (merged[lbl] || 0) + (Number(z.count) || 0);
        });
      const sorted = Object.entries(merged).map(([zone, count]) => ({ zone, count })).sort((a, b) => b.count - a.count);
      const total = sorted.reduce((s, c) => s + c.count, 0) || 1;
      let cum = 0;
      return sorted.map((it) => {
        cum += it.count;
        return {
          ...it,
          percentage: Number(((it.count / total) * 100).toFixed(1)),
          cumulativePercentage: Number(((cum / total) * 100).toFixed(1)),
        };
      });
    }
    const map = {};
    rejectedRows.forEach((r) => {
      const p = parseRowDefect(r);
      const qty = Number(r.quantity || r.scrap_quantity || 1);
      const zone = p.zone || r.rejectionZone || r.rejection_zone || "";
      const lbl = formatZoneLabel(zone);
      map[lbl] = (map[lbl] || 0) + qty;
    });
    const sorted = Object.entries(map).map(([zone, count]) => ({ zone, count })).sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, c) => s + c.count, 0) || 1;
    let cum = 0;
    return sorted.map((it) => {
      cum += it.count;
      return {
        ...it,
        percentage: Number(((it.count / total) * 100).toFixed(1)),
        cumulativePercentage: Number(((cum / total) * 100).toFixed(1)),
      };
    });
  }, [zoneParetoData, rejectedRows]);

  const activeParetoKey = useMemo(() => {
    if (selectedParetoItem) {
      return selectedParetoItem.reason || selectedParetoItem.category ||
             selectedParetoItem.zone || selectedParetoItem.name || "";
    }
    if (paretoView === "reason" && cleanPareto.length) return cleanPareto[0].reason;
    if (paretoView === "category" && categoryPareto.length) return categoryPareto[0].category;
    if (paretoView === "zone" && zoneBreakdown.length) return zoneBreakdown[0].zone;
    return "";
  }, [selectedParetoItem, paretoView, cleanPareto, categoryPareto, zoneBreakdown]);

  useEffect(() => {
    if (!activeParetoKey) { setParetoDrillDownParts([]); return; }
    let isCancelled = false;
    (async () => {
      setParetoDrillDownLoading(true);
      try {
        const query = { status: "NG", pageSize: 500, noCache: "1", _ts: Date.now() };
        if (paretoView === "reason") query.reason = activeParetoKey;
        else if (paretoView === "category") query.category = activeParetoKey;
        else if (paretoView === "zone") query.zone = activeParetoKey;
        if (filters.datePreset) query.datePreset = filters.datePreset;
        if (filters.datePreset === "all") query.allTime = "1";
        if (filters.dateFrom) query.dateFrom = filters.dateFrom;
        if (filters.dateTo) query.dateTo = filters.dateTo;
        if (filters.shiftCode) query.shiftCode = filters.shiftCode;
        if (filters.machineName) query.machineName = filters.machineName;
        if (filters.partName) query.partName = filters.partName;
        if (filters.partCategory) query.partCategory = filters.partCategory;
        if (filters.dieName) query.dieName = filters.dieName;
        if (filters.qualityGate) query.qualityGate = filters.qualityGate;
        const res = await dashboardApi.rejectionRows(query, { timeout: 30000, suppressGlobalError: true });
        if (!isCancelled && Array.isArray(res?.rows)) setParetoDrillDownParts(res.rows);
      } catch (err) {
        console.warn("[REJECTION UI] Pareto drilldown fetch failed:", err);
      } finally {
        if (!isCancelled) setParetoDrillDownLoading(false);
      }
    })();
    return () => { isCancelled = true; };
  }, [activeParetoKey, paretoView, filters]);

  const activeParetoStats = useMemo(() => {
    const list = paretoView === "reason" ? cleanPareto : paretoView === "category" ? categoryPareto : zoneBreakdown;
    const keyProp = paretoView === "reason" ? "reason" : paretoView === "category" ? "category" : "zone";
    return list.find((it) => it[keyProp] === activeParetoKey) || list[0] || null;
  }, [paretoView, cleanPareto, categoryPareto, zoneBreakdown, activeParetoKey]);

  /** Does an NG record belong to a Pareto item (reason / category / zone)? */
  const matchesParetoItem = useCallback((r, view, key) => {
    const p = parseRowDefect(r);
    if (view === "reason") {
      return isReasonMatch(p.reason, key) || isReasonMatch(r.rejection_reason, key) || isReasonMatch(r.ng_reason, key) || isReasonMatch(r.parts_interlock_reason, key);
    }
    if (view === "category") return normalizeDefectKey(p.category || r.rejection_category || r.category) === normalizeDefectKey(key);
    const rZone = cleanZoneCode(p.zone || r.rejection_zone || r.rejectionZone);
    return rZone === cleanZoneCode(key) || String(p.zone || "").toUpperCase().includes(String(key).trim().toUpperCase());
  }, []);

  const paretoMatchingRecords = useMemo(() => {
    if (!activeParetoKey) return [];
    const keyUpper = String(activeParetoKey).trim().toUpperCase();
    return (allRejectionRecords || []).filter((r) => {
      const p = parseRowDefect(r);
      if (paretoView === "reason") {
        return isReasonMatch(p.reason, activeParetoKey) ||
               isReasonMatch(r.rejection_reason, activeParetoKey) ||
               isReasonMatch(r.ng_reason, activeParetoKey) ||
               isReasonMatch(r.parts_interlock_reason, activeParetoKey);
      }
      if (paretoView === "category") {
        const catNorm = normalizeDefectKey(p.category || r.rejection_category || r.category);
        return catNorm === normalizeDefectKey(activeParetoKey);
      }
      if (paretoView === "zone") {
        const rZone = cleanZoneCode(p.zone || r.rejection_zone || r.rejectionZone);
        const tZone = cleanZoneCode(activeParetoKey);
        return rZone === tZone || String(p.zone || "").toUpperCase().includes(keyUpper);
      }
      return false;
    });
  }, [allRejectionRecords, paretoView, activeParetoKey]);

  /* ── Pareto pictorial ──────────────────────────────────────────────────── */
  const paretoPictorialViewData = useMemo(() => {
    if (!rejectionConfig?.views?.length) return [];
    return buildViewLocations(paretoMatchingRecords, rejectionConfig.views).views;
  }, [rejectionConfig, paretoMatchingRecords]);

  /* ── Pareto summary ────────────────────────────────────────────────────── */
  const paretoSummary = useMemo(() => {
    const totalMatching = Number(activeParetoStats?.count ?? paretoMatchingRecords.length);
    const totalAll = Number(summary?.totalNG || (allRejectionRecords || []).length || 1);
    const percentageOfAll = activeParetoStats?.percentage ?? Number(((totalMatching / (totalAll || 1)) * 100).toFixed(1));

    let primaryViewName = "All Views";
    let maxViewCount = 0;
    (paretoPictorialViewData || []).forEach((v) => {
      if (v.totalDefects > maxViewCount) { maxViewCount = v.totalDefects; primaryViewName = v.name; }
    });

    const zoneCountMap = {}, subZoneCountMap = {}, machineCountMap = {}, gateCountMap = {};
    let sumPress = 0, countPress = 0, sumTemp = 0, countTemp = 0;
    let sumBiscuit = 0, countBiscuit = 0, sumCycle = 0, countCycle = 0;

    paretoMatchingRecords.forEach((r) => {
      const p = parseRowDefect(r);
      const z = p.zone ? cleanZoneCode(p.zone) : "";
      const sz = p.subZone ? cleanSubZoneCode(p.subZone) : "";
      if (z) zoneCountMap[z] = (zoneCountMap[z] || 0) + 1;
      if (z && sz) {
        const k = `${z} › ${sz}`;
        subZoneCountMap[k] = (subZoneCountMap[k] || 0) + 1;
      }
      const m = r.machineName || r.machine_name;
      if (m) machineCountMap[m] = (machineCountMap[m] || 0) + 1;
      const g = r.ngGate || r.ng_gate || r.operation_no;
      if (g) gateCountMap[g] = (gateCountMap[g] || 0) + 1;
      const press = Number(r.metalPressure ?? r.metal_pressure);
      if (Number.isFinite(press) && press > 0) { sumPress += press; countPress++; }
      const temp = Number(r.metalTemp ?? r.furnace_metal_temp);
      if (Number.isFinite(temp) && temp > 0) { sumTemp += temp; countTemp++; }
      const bisc = Number(r.biscuitThickness ?? r.biscuit_thickness);
      if (Number.isFinite(bisc) && bisc > 0) { sumBiscuit += bisc; countBiscuit++; }
      const cyc = Number(r.cycleTime ?? r.plc_cycle_time);
      if (Number.isFinite(cyc) && cyc > 0) { sumCycle += cyc; countCycle++; }
    });

    const sortedSubZones = Object.entries(subZoneCountMap).sort((a, b) => b[1] - a[1]);
    const topHotspotSubZone = sortedSubZones[0] ? `${sortedSubZones[0][0]} (${sortedSubZones[0][1]} rejects)` : "Distributed across part";
    const sortedMachines = Object.entries(machineCountMap).sort((a, b) => b[1] - a[1]);
    const topMachine = sortedMachines[0] ? `${sortedMachines[0][0]} (${sortedMachines[0][1]} rejects)` : "Multiple Machines";
    const sortedGates = Object.entries(gateCountMap).sort((a, b) => b[1] - a[1]);
    const topGate = sortedGates[0] ? sortedGates[0][0] : "Multiple Gates";

    return {
      totalMatching, percentageOfAll,
      primaryViewName, primaryViewCount: maxViewCount,
      primaryViewPercentage: totalMatching > 0 ? Number(((maxViewCount / totalMatching) * 100).toFixed(1)) : 0,
      topHotspotSubZone, topMachine, topGate,
      avgPress: countPress > 0 ? (sumPress / countPress).toFixed(1) : null,
      avgTemp: countTemp > 0 ? (sumTemp / countTemp).toFixed(0) : null,
      avgBiscuit: countBiscuit > 0 ? (sumBiscuit / countBiscuit).toFixed(1) : null,
      avgCycle: countCycle > 0 ? (sumCycle / countCycle).toFixed(1) : null,
    };
  }, [paretoMatchingRecords, allRejectionRecords, paretoPictorialViewData]);

  const filteredParetoParts = useMemo(() => {
    let list = paretoMatchingRecords;
    if (paretoSelectedView && paretoSelectedView !== "all") {
      const normSel = normalizeCode(paretoSelectedView);
      list = list.filter((r) => {
        const p = parseRowDefect(r);
        const rV = normalizeCode(p.view);
        let viewMatch = rV && (normSel.includes(rV) || rV.includes(normSel));
        if (!viewMatch && rejectionConfig?.views) {
          const mv = rejectionConfig.views.find((v) => normalizeCode(v.name) === normSel || normalizeCode(v.code) === normSel);
          if (mv) {
            const zClean = cleanZoneCode(p.zone);
            viewMatch = zClean && (mv.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean);
          }
        }
        return viewMatch;
      });
    }
    if (!paretoPartSearch.trim()) return list;
    const term = paretoPartSearch.trim().toLowerCase();
    return list.filter((r) => {
      const pId = String(r.partId || r.part_id || "").toLowerCase();
      const qr = String(r.customerQrCode || r.customer_qr || "").toLowerCase();
      const mName = String(r.machineName || r.machine_name || "").toLowerCase();
      const p = parseRowDefect(r);
      return pId.includes(term) || qr.includes(term) || mName.includes(term) ||
             p.reason.toLowerCase().includes(term) ||
             p.zone.toLowerCase().includes(term) ||
             p.subZone.toLowerCase().includes(term);
    });
  }, [paretoMatchingRecords, paretoSelectedView, paretoPartSearch, rejectionConfig]);

  /* ── Excel Export (Pareto) ──────────────────────────────────────────────── */
  const exportParetoPartsExcel = async () => {
    if (!filteredParetoParts.length) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`Pareto_${String(activeParetoKey).slice(0, 20)}`);
    sheet.columns = [
      { header: "Part ID", key: "partId", width: 24 },
      { header: "Customer QR Code", key: "customerQrCode", width: 34 },
      { header: "Casting Shot #", key: "shotNo", width: 14 },
      { header: "Machine Name", key: "machineName", width: 18 },
      { header: "Quality Gate", key: "ngGate", width: 16 },
      { header: "Rejection Date / Time", key: "timestamp", width: 22 },
      { header: "Category", key: "category", width: 12 },
      { header: "Defect Reason", key: "reason", width: 24 },
      { header: "View", key: "view", width: 16 },
      { header: "Zone", key: "zone", width: 16 },
      { header: "Sub Zone", key: "subZone", width: 16 },
      { header: "Furnace Temp (°C)", key: "metalTemp", width: 18 },
      { header: "Metal Pressure (bar)", key: "metalPressure", width: 20 },
      { header: "Biscuit Thickness (mm)", key: "biscuitThickness", width: 22 },
      { header: "Cycle Time (s)", key: "cycleTime", width: 16 },
      { header: "V1 Speed (m/s)", key: "v1Speed", width: 16 },
      { header: "V2 Speed (m/s)", key: "v2Speed", width: 16 },
      { header: "V3 Speed (m/s)", key: "v3Speed", width: 16 },
      { header: "V4 Speed (m/s)", key: "v4Speed", width: 16 },
      { header: "Intensification Time (s)", key: "intensificationTime", width: 22 },
      { header: "Curing Time (s)", key: "curingTime", width: 16 },
      { header: "Pouring Time (s)", key: "pouringTime", width: 16 },
      { header: "Die Close Time (s)", key: "dieCloseTime", width: 18 },
      { header: "Die Open Time (s)", key: "dieOpenTime", width: 18 },
      { header: "Spray Time (s)", key: "sprayTime", width: 16 },
      { header: "Clamp Tonnage (kN)", key: "clampTonnage", width: 18 },
      { header: "Leak Body Value", key: "leakBodyValue", width: 16 },
    ];
    const hr = sheet.getRow(1);
    hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3263" } };
    filteredParetoParts.forEach((r) => {
      const p = parseRowDefect(r);
      const shot = r.partId && r.partId !== "-" && !r.partId.startsWith("R437")
        ? r.partId.split("_")[1] || r.shotNo || "—"
        : r.shotNo || "—";
      sheet.addRow({
        partId: r.partId || r.part_id || "—",
        customerQrCode: r.customerQrCode || r.customer_qr || "—",
        shotNo: shot,
        machineName: r.machineName || r.machine_name || "—",
        ngGate: r.ngGate || r.ng_gate || r.operation_no || "—",
        timestamp: r.timestamp || r.createdAt || r.first_scan_at || "—",
        category: p.category || "—", reason: p.reason || "—",
        view: p.view || "—", zone: p.zone || "—", subZone: p.subZone || "—",
        metalTemp: r.metalTemp ?? r.furnace_metal_temp ?? "—",
        metalPressure: r.metalPressure ?? r.metal_pressure ?? "—",
        biscuitThickness: r.biscuitThickness ?? r.biscuit_thickness ?? "—",
        cycleTime: r.cycleTime ?? r.plc_cycle_time ?? "—",
        v1Speed: r.v1Speed ?? r.v1_speed ?? "—",
        v2Speed: r.v2Speed ?? r.v2_speed ?? "—",
        v3Speed: r.v3Speed ?? r.v3_speed ?? "—",
        v4Speed: r.v4Speed ?? r.v4_speed ?? "—",
        intensificationTime: r.intensificationTime ?? r.intensification_time ?? "—",
        curingTime: r.curingTime ?? r.curing_time ?? "—",
        pouringTime: r.pouringTime ?? r.pouring_time ?? "—",
        dieCloseTime: r.dieCloseTime ?? r.die_close_time ?? "—",
        dieOpenTime: r.dieOpenTime ?? r.die_open_time ?? "—",
        sprayTime: r.sprayTime ?? r.spray_time ?? "—",
        clampTonnage: r.clampTonnage ?? r.clamp_tonnage ?? "—",
        leakBodyValue: r.leakBodyValue ?? r.leak_body_value ?? "—",
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Pareto_Parts_${String(activeParetoKey).replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  /* ── Processed Quality Gates (OP150 grouping) ───────────────────────────── */
  const processedQualityGates = useMemo(() => {
    if (!qualityGates?.length) return [];
    if (!isOp150Grouped) {
      return qualityGates.map((g) => {
        let shortLabel = g.code;
        let displayName = g.name || g.code;
        if (["Leak-Test-01", "Leak-Test-1", "Leak Test-01"].includes(g.code)) { shortLabel = "Leak-Test-1"; displayName = "Leak-Test-1 (OP150)"; }
        else if (["Leak-Test-02", "Leak-Test-2", "Leak Test-02"].includes(g.code)) { shortLabel = "Leak-Test-2"; displayName = "Leak-Test-2 (OP150)"; }
        else if (["Leak Test-03", "Leak-Test-03", "Leak-Test-3"].includes(g.code)) { shortLabel = "Leak-Test-3"; displayName = "Leak-Test-3 (OP150)"; }
        return { ...g, shortLabel, displayName, name: displayName };
      });
    }
    const leakGates = qualityGates.filter((g) => g.code === "OP150" || g.code.toLowerCase().startsWith("leak"));
    if (leakGates.length <= 1) return qualityGates;
    const totalOk = leakGates.reduce((s, g) => s + (g.okCount || 0), 0);
    const totalNg = leakGates.reduce((s, g) => s + (g.ngCount || 0), 0);
    const totalInsp = totalOk + totalNg;
    const scrapRate = totalInsp > 0 ? Number(((totalNg / totalInsp) * 100).toFixed(2)) : 0;
    const combined = {
      code: "OP150", shortLabel: "OP150 (Total)",
      name: "Leak Test OP150 (Total)", fullName: "OP150 Leak Testing (All 3 Stations)",
      displayName: "Leak Test OP150 (Total)", isGrouped: true, subStations: leakGates,
      okCount: totalOk, ngCount: totalNg, inspected: totalInsp, scrapRate,
    };
    const result = [];
    let added = false;
    qualityGates.forEach((g) => {
      const isLeak = g.code === "OP150" || g.code.toLowerCase().startsWith("leak");
      if (!isLeak) result.push(g);
      else if (!added) { result.push(combined); added = true; }
    });
    return result;
  }, [qualityGates, isOp150Grouped]);

  const qualityGateChartData = useMemo(() => {
    const isLeak = (c) => {
      const u = String(c || "").toUpperCase();
      return u === "OP150" || u.startsWith("LEAK");
    };
    const leakGates = processedQualityGates.filter((g) => isLeak(g.code));
    const totalLeakOk = leakGates.reduce((s, g) => s + (g.okCount || 0), 0);
    const totalLeakNg = leakGates.reduce((s, g) => s + (g.ngCount || 0), 0);
    const totalLeakInsp = totalLeakOk + totalLeakNg;

    return processedQualityGates.map((g, idx) => {
      let shortLabel = g.shortLabel || g.code;
      if (g.code === "OP150") shortLabel = "OP150 (Total)";
      const nextGate = processedQualityGates[idx + 1];
      const isCurLeak = isLeak(g.code);
      const isNextLeak = nextGate ? isLeak(nextGate.code) : false;
      let inProgress = 0;
      if (!isCurLeak && isNextLeak) inProgress = Math.max(0, (g.okCount || 0) - totalLeakInsp);
      else if (isCurLeak && isNextLeak) inProgress = 0;
      else if (isCurLeak && nextGate && !isNextLeak) inProgress = Math.max(0, totalLeakOk - ((nextGate.okCount || 0) + (nextGate.ngCount || 0)));
      else if (nextGate) inProgress = Math.max(0, (g.okCount || 0) - ((nextGate.okCount || 0) + (nextGate.ngCount || 0)));
      const OK = Math.max(0, num(g.okCount));
      const NG = Math.max(0, num(g.ngCount));
      const rate = pctOf(NG, OK + NG);
      return {
        code: g.code, name: shortLabel,
        fullName: g.displayName || g.fullName || g.name || g.code,
        isGrouped: g.isGrouped, subStations: g.subStations,
        OK, NG,
        inspected: OK + NG,
        inProgress: Math.max(0, inProgress),
        // Recomputed from the counts (NG ÷ inspected at this station) — not taken from the server field.
        scrapRate: rate ?? 0,
        scrapLabel: rate == null ? "" : fmtPct(rate),
      };
    });
  }, [processedQualityGates]);

  /* ── Drill-down data ────────────────────────────────────────────────────── */
  const drillDownCategoryData = useMemo(() => {
    if (!drillDownGate) return [];
    if (qualityGateDrillDown?.[drillDownGate]?.categories?.length > 0) return qualityGateDrillDown[drillDownGate].categories;
    const gateOp = drillDownGate.toLowerCase();
    const statusKey = `${gateOp}_status`;
    const catMap = {};
    rows.forEach((r) => {
      const isLeakM = ["leak-test-01", "leak-test-02", "leak test-03"].includes(gateOp);
      const mName = String(r.machine_name || "").toLowerCase();
      const matchesMachine = isLeakM && (
        (gateOp === "leak-test-01" && mName.includes("01")) ||
        (gateOp === "leak-test-02" && mName.includes("02")) ||
        (gateOp === "leak test-03" && (mName.includes("03") || mName.includes("leak test-03")))
      );
      const gateStatus = String(r[statusKey] || "").trim().toUpperCase();
      const overall = String(r.overall_status || r.status || "").trim().toUpperCase();
      const isLeakNG = (drillDownGate === "OP150" || matchesMachine) && (
        ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus) ||
        (mName.includes("leak") && ["NG", "FAILED"].includes(overall)) ||
        (String(r.rejection_reason || r.ng_reason || "").toLowerCase().includes("leak") && ["NG", "FAILED"].includes(overall))
      );
      const isGateNG = isLeakNG || ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus);
      if (!isGateNG) return;
      const srcText = String(r.ng_reason || r.rejection_reason || "");
      const catMatch = srcText.match(/Category:\s*([^|\n]+)/i);
      let cat = (r.rejection_category || (catMatch ? catMatch[1].trim() : "")).trim().toUpperCase();
      if (!cat || ["-", "GENERAL", "NULL", "UNDEFINED"].includes(cat)) cat = NOT_RECORDED_KEY;
      catMap[cat] = (catMap[cat] || 0) + 1;
    });
    const sorted = Object.entries(catMap).map(([category, count]) => ({ category, count: Math.max(0, count) })).sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, c) => s + c.count, 0) || 1;
    return sorted.map((it) => ({ ...it, percentage: Number(((it.count / total) * 100).toFixed(1)) }));
  }, [drillDownGate, qualityGateDrillDown, rows]);

  const drillDownReasonData = useMemo(() => {
    if (!drillDownGate || !drillDownCategory) return [];
    if (qualityGateDrillDown?.[drillDownGate]?.reasons?.[drillDownCategory]?.length > 0) {
      const canonMap = {};
      qualityGateDrillDown[drillDownGate].reasons[drillDownCategory].forEach((item) => {
        const c = canonicalizeReason(item.reason);
        canonMap[c] = (canonMap[c] || 0) + (Number(item.count) || 0);
      });
      const total = Object.values(canonMap).reduce((s, v) => s + v, 0) || 1;
      return Object.entries(canonMap)
        .map(([reason, count]) => ({ reason, count: Math.max(0, count), percentage: Number(((count / total) * 100).toFixed(1)) }))
        .sort((a, b) => b.count - a.count);
    }
    const gateOp = drillDownGate.toLowerCase();
    const statusKey = `${gateOp}_status`;
    const reasonMap = {};
    rows.forEach((r) => {
      const isLeakM = ["leak-test-01", "leak-test-02", "leak test-03"].includes(gateOp);
      const mName = String(r.machine_name || "").toLowerCase();
      const matchesMachine = isLeakM && (
        (gateOp === "leak-test-01" && mName.includes("01")) ||
        (gateOp === "leak-test-02" && mName.includes("02")) ||
        (gateOp === "leak test-03" && (mName.includes("03") || mName.includes("leak test-03")))
      );
      const gateStatus = String(r[statusKey] || "").trim().toUpperCase();
      const overall = String(r.overall_status || r.status || "").trim().toUpperCase();
      const isLeakNG = (drillDownGate === "OP150" || matchesMachine) && (
        ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus) ||
        (mName.includes("leak") && ["NG", "FAILED"].includes(overall)) ||
        (String(r.rejection_reason || r.ng_reason || "").toLowerCase().includes("leak") && ["NG", "FAILED"].includes(overall))
      );
      const isGateNG = isLeakNG || ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus);
      if (!isGateNG) return;
      const srcText = String(r.ng_reason || r.rejection_reason || "");
      const catMatch = srcText.match(/Category:\s*([^|\n]+)/i);
      let cat = (r.rejection_category || (catMatch ? catMatch[1].trim() : "")).trim().toUpperCase();
      if (!cat || ["-", "GENERAL", "NULL", "UNDEFINED"].includes(cat)) cat = NOT_RECORDED_KEY;
      if (cat !== drillDownCategory) return;
      const reasonMatch = srcText.match(/Reason:\s*([^|\n]+)/i);
      const rawReason = (r.rejection_reason || (reasonMatch ? reasonMatch[1].trim() : "") || NOT_RECORDED).trim();
      if (!rawReason || rawReason === "-") return;
      const reason = canonicalizeReason(rawReason);
      const qty = Number(r.quantity || r.scrap_quantity || 1); reasonMap[reason] = (reasonMap[reason] || 0) + qty;
    });
    const sorted = Object.entries(reasonMap).map(([reason, count]) => ({ reason, count: Math.max(0, count) })).sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, c) => s + c.count, 0) || 1;
    return sorted.map((it) => ({ ...it, percentage: Number(((it.count / total) * 100).toFixed(1)) }));
  }, [drillDownGate, drillDownCategory, qualityGateDrillDown, rows]);

  const activeGateReason = useMemo(() => {
    if (drillDownReason === "ALL") return null;
    if (drillDownReason) return drillDownReason;
    if (drillDownLevel === 2 && drillDownReasonData.length > 0) return drillDownReasonData[0].reason;
    return null;
  }, [drillDownReason, drillDownLevel, drillDownReasonData]);

  const drillDownMatchingParts = useMemo(() => {
    if (!drillDownGate) return [];
    return allRejectionRecords.filter((r) => {
      if (!isRecordMatchingStation(r, drillDownGate)) return false;
      const pDefect = parseRowDefect(r);
      if (drillDownCategory && !categoryMatches(pDefect.category, drillDownCategory)) return false;
      if (activeGateReason) {
        if (!isReasonMatch(pDefect.reason, activeGateReason) &&
            !isReasonMatch(r.rejection_reason, activeGateReason) &&
            !isReasonMatch(r.ng_reason, activeGateReason)) return false;
      }
      if (drillDownSelectedView && drillDownSelectedView !== "all") {
        const normV = normalizeCode(pDefect.view);
        const normSel = normalizeCode(drillDownSelectedView);
        let viewMatch = normV && normSel && (normV.includes(normSel) || normSel.includes(normV));
        if (!viewMatch && rejectionConfig?.views) {
          const mv = rejectionConfig.views.find((v) => normalizeCode(v.name) === normSel || normalizeCode(v.code) === normSel);
          if (mv) {
            const zClean = cleanZoneCode(pDefect.zone);
            viewMatch = (mv.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean);
          }
        }
        if (!viewMatch) return false;
      }
      return true;
    });
  }, [drillDownGate, drillDownCategory, activeGateReason, drillDownSelectedView, allRejectionRecords, rejectionConfig]);

  const filteredDrillDownParts = useMemo(() => {
    if (!partIdSearch.trim()) return drillDownMatchingParts;
    const term = partIdSearch.toLowerCase().trim();
    return drillDownMatchingParts.filter((r) => {
      const pId = String(r.partId || r.part_id || "").toLowerCase();
      const qr = String(r.customerQrCode || r.customer_qr || "").toLowerCase();
      const shot = String(r.shotNumber || r.shot_number || "").toLowerCase();
      const p = parseRowDefect(r);
      return pId.includes(term) || qr.includes(term) || shot.includes(term) ||
             p.reason.toLowerCase().includes(term) || p.category.toLowerCase().includes(term) ||
             p.view.toLowerCase().includes(term) || p.zone.toLowerCase().includes(term) ||
             p.subZone.toLowerCase().includes(term);
    });
  }, [drillDownMatchingParts, partIdSearch]);

  const pictorialViewData = useMemo(() => {
    if (!rejectionConfig?.views?.length) return [];
    const matching = allRejectionRecords.filter((r) => {
      if (drillDownGate && !isRecordMatchingStation(r, drillDownGate)) return false;
      const p = parseRowDefect(r);
      if (drillDownCategory && !categoryMatches(p.category, drillDownCategory)) return false;
      if (activeGateReason &&
          !isReasonMatch(p.reason, activeGateReason) &&
          !isReasonMatch(r.rejection_reason, activeGateReason) &&
          !isReasonMatch(r.ng_reason, activeGateReason)) return false;
      return true;
    });
    return buildViewLocations(matching, rejectionConfig.views).views;
  }, [rejectionConfig, allRejectionRecords, drillDownGate, drillDownCategory, activeGateReason]);

  /* ── Active Studio Data ─────────────────────────────────────────────────── */
  const activeStudioData = useMemo(() => {
    const isParetoActive = Boolean(selectedParetoItem && activeParetoKey);
    const isGateActive = Boolean(drillDownGate);
    // With nothing selected the map shows the top Pareto item (that is what paretoPictorialViewData holds),
    // so it is labelled as such rather than as "overall scrap".
    let title = activeParetoKey || "All NG parts";
    let tag = activeParetoKey
      ? `Top ${paretoView === "reason" ? "reason" : paretoView === "category" ? "category" : "zone"}`
      : "All defects";
    let count = activeParetoKey
      ? Number(activeParetoStats?.count ?? paretoMatchingRecords.length)
      : Number(summary?.totalNG || allRejectionRecords?.length || 0);
    let viewData = paretoPictorialViewData;
    let partsPool = activeParetoKey ? paretoMatchingRecords : (allRejectionRecords || []);
    let studioSummary = activeParetoKey ? paretoSummary : { ...paretoSummary, percentageOfAll: count > 0 ? 100 : null };

    if (isParetoActive) {
      title = activeParetoKey;
      tag = paretoView === "reason" ? "DEFECT REASON" : paretoView === "category" ? "CATEGORY" : "ZONE";
      count = Number(activeParetoStats?.count ?? paretoMatchingRecords.length);
      viewData = paretoPictorialViewData;
      partsPool = filteredParetoParts.length > 0 ? filteredParetoParts : paretoMatchingRecords;
      studioSummary = { ...paretoSummary, totalMatching: count, percentageOfAll: activeParetoStats?.percentage ?? paretoSummary.percentageOfAll };
    } else if (isGateActive) {
      const parts = [drillDownGate];
      if (drillDownCategory) parts.push(drillDownCategory);
      if (activeGateReason) parts.push(activeGateReason);
      title = parts.join(" › ");
      tag = "QUALITY GATE";
      const gateFound = processedQualityGates.find((g) => g.code === drillDownGate) || qualityGates.find((g) => g.code === drillDownGate);
      count = typeof gateFound?.ngCount === "number" ? gateFound.ngCount : (filteredDrillDownParts.length > 0 ? filteredDrillDownParts.length : drillDownMatchingParts.length);
      viewData = pictorialViewData;
      partsPool = filteredDrillDownParts.length > 0 ? filteredDrillDownParts : drillDownMatchingParts;
      studioSummary = {
        totalMatching: count,
        percentageOfAll: Number(((count / (summary?.totalNG || allRejectionRecords?.length || 1)) * 100).toFixed(1)),
        ...(() => {
          const located = (pictorialViewData || []).reduce((s2, v) => s2 + v.totalDefects, 0);
          const top = [...(pictorialViewData || [])].sort((x, y) => y.totalDefects - x.totalDefects)[0];
          const subs = (pictorialViewData || []).flatMap((v) => v.zones.flatMap((z) => z.subZones.map((sz) => ({ label: `${v.name} · ${z.name || z.code} › ${sz.code || sz.name}`, n: sz.count }))));
          const topSub = subs.sort((x, y) => y.n - x.n)[0];
          return {
            primaryViewName: top?.totalDefects ? top.name : "—",
            primaryViewCount: top?.totalDefects || 0,
            primaryViewPercentage: located > 0 && top ? Number(((top.totalDefects / located) * 100).toFixed(1)) : 0,
            topHotspotSubZone: topSub?.n ? `${topSub.label} (${topSub.n})` : "No sub-zone recorded",
          };
        })(),
        topMachine: drillDownGate, topGate: drillDownGate,
        avgPress: paretoSummary.avgPress, avgTemp: paretoSummary.avgTemp,
        avgBiscuit: paretoSummary.avgBiscuit, avgCycle: paretoSummary.avgCycle,
      };
    }
    return { isParetoActive, isGateActive, title, tag, count, viewData: viewData || [], partsPool, summary: studioSummary };
  }, [selectedParetoItem, activeParetoKey, paretoView, activeParetoStats, paretoMatchingRecords, filteredParetoParts, paretoSummary, paretoPictorialViewData, drillDownGate, drillDownCategory, activeGateReason, processedQualityGates, qualityGates, filteredDrillDownParts, drillDownMatchingParts, pictorialViewData, summary?.totalNG, allRejectionRecords]);

  const currentStudioView = useMemo(() => {
    const list = activeStudioData.viewData || [];
    if (!list.length) return null;
    if (studioActiveAngle === "all") {
      const hot = list.find((v) => v.totalDefects > 0);
      return hot || list[0];
    }
    return list.find((v) => v.name === studioActiveAngle || v.code === studioActiveAngle) || list[0];
  }, [activeStudioData.viewData, studioActiveAngle]);

  /* ── Station Context ────────────────────────────────────────────────────── */
  const activeStationCode = drillDownGate || summary.topHotspotStation || (qualityGates[0]?.code) || "OP120";

  const activeStationGate = useMemo(() => {
    if (!activeStationCode) return processedQualityGates[0] || qualityGates[0];
    let found = processedQualityGates.find((g) =>
      g.code === activeStationCode || g.shortLabel === activeStationCode || g.displayName === activeStationCode);
    if (!found) found = qualityGates.find((g) => g.code === activeStationCode);

    const sNorm = String(activeStationCode).toUpperCase().replace(/[-_ ]?0+/g, "-");
    if (!found && (sNorm.includes("LEAK") || sNorm.includes("150"))) {
      if (sNorm.includes("150") || sNorm === "LEAK" || sNorm === "LEAK-TEST") {
        const leakGates = qualityGates.filter((g) => {
          const gn = String(g.code).toUpperCase().replace(/[-_ ]?0+/g, "-");
          return gn.includes("LEAK") || gn.includes("150");
        });
        const totOk = leakGates.reduce((s, g) => s + (g.okCount || 0), 0);
        const totNg = leakGates.reduce((s, g) => s + (g.ngCount || 0), 0);
        const totInsp = totOk + totNg;
        found = {
          code: "OP150", shortLabel: "OP150",
          name: "Leak Test OP150 (Total)", displayName: "Leak Test OP150 (Total)",
          okCount: totOk, ngCount: totNg, inspected: totInsp,
          scrapRate: totInsp > 0 ? Number(((totNg / totInsp) * 100).toFixed(2)) : 0,
          subStations: leakGates, isGrouped: true,
        };
      } else {
        found = qualityGates.find((g) => {
          const gn = String(g.code).toUpperCase().replace(/[-_ ]?0+/g, "-");
          return gn === sNorm ||
                 (sNorm.includes("1") && gn.includes("1")) ||
                 (sNorm.includes("2") && gn.includes("2")) ||
                 (sNorm.includes("3") && gn.includes("3"));
        });
      }
    }
    return found || processedQualityGates[0] || qualityGates[0] || {
      code: activeStationCode, name: stationLabels[activeStationCode] || activeStationCode,
      okCount: 0, ngCount: 0, scrapRate: 0,
    };
  }, [processedQualityGates, qualityGates, activeStationCode, stationLabels]);

  const isLeakStation = activeStationCode === "OP150" ||
    String(activeStationCode).toUpperCase().includes("LEAK") ||
    String(activeStationGate?.code || "").toUpperCase().includes("LEAK") ||
    activeStationGate?.code === "OP150";

  // Top defects at the selected station — counted from real records only (no synthetic splits).
  // Share = parts with that reason ÷ NG parts found at the station (a leak part can fail >1 channel,
  // so leak shares may add up to more than 100%).
  const stationTopReasons = useMemo(() => {
    if (!activeStationCode || !activeStationGate || (activeStationGate.ngCount || 0) === 0) return [];
    const reasonMap = {};
    let partsSeen = 0;
    const add = (k, q) => { reasonMap[k] = (reasonMap[k] || 0) + q; };
    if (isLeakStation) {
      allRejectionRecords.forEach((r) => {
        if (!isRecordMatchingStation(r, activeStationCode)) return;
        let parsedLd = null;
        if (r.leak_data) {
          try { parsedLd = typeof r.leak_data === "object" ? r.leak_data : JSON.parse(r.leak_data); } catch { /* unparsable leak_data */ }
        }
        const bVal = Number(r.leak_body_leak_value ?? parsedLd?.Body_Leak_Value ?? parsedLd?.bodyLeakValue);
        const g1Val = Number(r.leak_gall_1 ?? parsedLd?.Gall_1 ?? parsedLd?.gall1);
        const g2Val = Number(r.leak_gall_2 ?? parsedLd?.Gall_2 ?? parsedLd?.gall2);
        const cTime = Number(r.leak_cycle_time ?? parsedLd?.Cycle_Time ?? parsedLd?.cycleTime);
        const qty = Number(r.quantity || r.scrap_quantity || 1);
        partsSeen += qty;
        let paramFound = false;
        if (!isNaN(bVal) && Math.abs(bVal) > 0.05) { add("Body leak (reading above 0.05)", qty); paramFound = true; }
        if (!isNaN(g1Val) && Math.abs(g1Val) > 0.05) { add("Oil gallery 1 leak (Gall_1)", qty); paramFound = true; }
        if (!isNaN(g2Val) && Math.abs(g2Val) > 0.05) { add("Oil gallery 2 leak (Gall_2)", qty); paramFound = true; }
        if (!paramFound) {
          const rr = r.rejection_reason || r.ng_reason;
          if (rr && String(rr).toLowerCase().includes("leak")) add(canonicalizeReason(rr), qty);
          else if (cTime > 0 && cTime < 30) add("Leak NG – short test cycle (< 30 s)", qty);
          else add("Leak NG – no reading recorded", qty);
        }
      });
    } else {
      const serverReasons = qualityGateDrillDown?.[activeStationCode]?.topReasons;
      if (serverReasons?.length) {
        const tot = serverReasons.reduce((s, it) => s + num(it.count), 0);
        return serverReasons.slice(0, 5).map((it) => ({
          ...it, count: num(it.count),
          percentage: Number.isFinite(Number(it.percentage)) ? Number(it.percentage) : Number((pctOf(num(it.count), tot) ?? 0).toFixed(1)),
        }));
      }
      allRejectionRecords.forEach((r) => {
        if (!isRecordMatchingStation(r, activeStationCode)) return;
        const p = parseRowDefect(r);
        const qty = Number(r.quantity || r.scrap_quantity || 1);
        partsSeen += qty;
        const reason = canonicalizeReason(p.reason || r.rejection_reason || r.ng_reason || NOT_RECORDED);
        add(reason && reason !== "-" ? reason : NOT_RECORDED, qty);
      });
    }
    return Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count, percentage: Number((pctOf(count, partsSeen) ?? 0).toFixed(1)) }))
      .sort((a, b) => b.count - a.count).slice(0, 5);
  }, [activeStationCode, allRejectionRecords, isLeakStation, activeStationGate, qualityGateDrillDown]);

  // Exact per-record localization on the configured CAD views (no scaling to the gate total, no substring matching).
  const { stationViewList, stationLocalization } = useMemo(() => {
    const views = rejectionConfig?.views || [];
    const isSensorStation = activeStationCode === "OP150" || String(activeStationCode).toUpperCase().startsWith("LEAK");
    const recs = isSensorStation ? [] : allRejectionRecords.filter((r) => isRecordMatchingStation(r, activeStationCode));
    const { views: list, stats } = buildViewLocations(recs, views);
    return { stationViewList: list.map((v) => ({ ...v, isSensorTest: isSensorStation })), stationLocalization: stats };
  }, [activeStationCode, rejectionConfig, allRejectionRecords]);

  // Zone / sub-zone overlays. Red = zone recorded at inspection; amber dashed = inferred from defect type.
  const renderZoneHeat = (zones) => {
        const maxC = Math.max(1, ...zones.map((z) => z.count || 0));
        const heat = (c, inferredOnly) => {
          const t = Math.sqrt(c / maxC);
          return inferredOnly
            ? { borderColor: "#f59e0b", borderStyle: "dashed", borderWidth: 2, background: `rgba(245,158,11,${0.12 + t * 0.25})` }
            : { borderColor: "#ef4444", borderStyle: "solid", borderWidth: 2, background: `rgba(239,68,68,${0.14 + t * 0.36})`, boxShadow: "0 0 12px rgba(239,68,68,.45)" };
        };
        return zones.map((zone) => {
          const hot = zone.count > 0;
          const inferredOnly = hot && zone.inferredCount === zone.count;
          return (
            <Fragment key={zone.id || zone.code}>
              <div className="cad-zone" style={{ ...boxStyle(zone), ...(hot ? heat(zone.count, inferredOnly) : {}) }}
                title={`Zone ${zone.name || zone.code}: ${zone.count} NG${zone.inferredCount ? ` (${zone.inferredCount} inferred from defect type)` : ""}`}>
                <span className="cad-tag">
                  {zone.name || zone.code}
                  {hot && <span className={`cad-count ${inferredOnly ? "inferred" : ""}`}>{zone.count}</span>}
                </span>
              </div>
              {(zone.subZones || []).map((sz) => {
                const sHot = sz.count > 0;
                const sInf = sHot && sz.inferredCount === sz.count;
                return (
                  <div key={`station-sub-${sz.id || sz.code}`} className="cad-sub"
                    style={{ ...boxStyle(sz, 5, 5), ...(sHot ? heat(sz.count, sInf) : {}) }}
                    title={`Zone ${zone.name || zone.code} › Sub-zone ${sz.name || sz.code}: ${sz.count} NG`}>
                    {sHot && <span className="cad-tag">{sz.code || sz.name}<span className={`cad-count ${sInf ? "inferred" : ""}`}>{sz.count}</span></span>}
                  </div>
                );
              })}
            </Fragment>
          );
        });
      };

  const stationCurrentView = useMemo(() => {
    if (!stationViewList?.length) return null;
    if (stationActiveAngle === "all") {
      const hot = stationViewList.find((v) => v.totalDefects > 0);
      return hot || stationViewList[0];
    }
    return stationViewList.find((v) => v.name === stationActiveAngle || v.code === stationActiveAngle) || stationViewList[0];
  }, [stationViewList, stationActiveAngle]);

  const filteredContextParts = useMemo(() => {
    let list = activeStudioData.partsPool || [];
    if (studioActiveAngle !== "all" && currentStudioView) {
      const selNorm = normalizeCode(currentStudioView.name || currentStudioView.code);
      const angleFiltered = list.filter((r) => {
        const p = parseRowDefect(r);
        const rV = normalizeCode(p.view);
        if (rV && (selNorm.includes(rV) || rV.includes(selNorm))) return true;
        const zClean = cleanZoneCode(p.zone);
        if (zClean && (currentStudioView.zones || []).some((z) => {
          const cfgClean = cleanZoneCode(z.code || z.name);
          return cfgClean === zClean || cfgClean.includes(zClean) || zClean.includes(cfgClean);
        })) return true;
        return false;
      });
      if (angleFiltered.length > 0) {
        list = angleFiltered;
      }
    }
    if (contextLogSearch.trim()) {
      const q = contextLogSearch.trim().toLowerCase();
      list = list.filter((r) => {
        const pDefect = parseRowDefect(r);
        return String(r.partId || r.part_id || "").toLowerCase().includes(q) ||
               String(r.customerQrCode || r.customer_qr || "").toLowerCase().includes(q) ||
               String(r.shotNumber || r.shot_number || "").toLowerCase().includes(q) ||
               String(r.machineName || r.machine_name || "").toLowerCase().includes(q) ||
               String(pDefect.reason || "").toLowerCase().includes(q) ||
               String(pDefect.category || "").toLowerCase().includes(q) ||
               String(pDefect.zone || "").toLowerCase().includes(q) ||
               String(pDefect.subZone || "").toLowerCase().includes(q);
      });
    }
    return list;
  }, [activeStudioData.partsPool, studioActiveAngle, currentStudioView, contextLogSearch]);

  const exportContextPartsExcel = useCallback(() => {
    if (!filteredContextParts.length) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Scrap Parts");
    ws.columns = [
      { header: "Part Serial No", key: "partId", width: 24 },
      { header: "Shot #", key: "shotNumber", width: 12 },
      { header: "Customer QR", key: "customerQrCode", width: 30 },
      { header: "Status", key: "status", width: 10 },
      { header: "Inspection Angle", key: "view", width: 16 },
      { header: "Category", key: "category", width: 14 },
      { header: "Defect Reason", key: "reason", width: 24 },
      { header: "Zone", key: "zone", width: 16 },
      { header: "Sub Zone", key: "subZone", width: 16 },
      { header: "Machine", key: "machineName", width: 16 },
      { header: "Shift", key: "shiftCode", width: 8 },
      { header: "Metal Pressure (bar)", key: "metalPressure", width: 18 },
      { header: "Furnace Temp (°C)", key: "furnaceTemp", width: 18 },
      { header: "Biscuit (mm)", key: "biscuitThickness", width: 14 },
      { header: "Cycle Time (s)", key: "cycleTime", width: 14 },
      { header: "V1 Speed (m/s)", key: "v1Speed", width: 14 },
      { header: "Intensification (ms)", key: "intensificationTime", width: 18 },
      { header: "Recorded Timestamp", key: "createdAt", width: 22 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3263" } };
    filteredContextParts.forEach((p) => {
      const pDefect = parseRowDefect(p);
      ws.addRow({
        partId: p.partId || p.part_id || "-",
        shotNumber: p.shotNumber || p.shot_number || "-",
        customerQrCode: p.customerQrCode || p.customer_qr || "-",
        status: p.status || p.overall_status || "NG",
        view: pDefect.view || "-", category: pDefect.category || "-", reason: pDefect.reason || "-",
        zone: pDefect.zone || "-", subZone: pDefect.subZone || "-",
        machineName: p.machineName || p.machine_name || "-",
        shiftCode: p.shiftCode || p.shift_code || "—",
        metalPressure: fmtNum(p.metalPressure || p.metal_pressure) || "-",
        furnaceTemp: fmtNum(p.metalTemp || p.furnace_metal_temp) || "-",
        biscuitThickness: fmtNum(p.biscuitThickness || p.biscuit_thickness) || "-",
        cycleTime: fmtNum(p.cycleTime || p.cycle_time || p.plc_cycle_time) || "-",
        v1Speed: fmtNum(p.v1Speed || p.v1_speed) || "-",
        intensificationTime: fmtNum(p.intensificationTime || p.intensification_time) || "-",
        createdAt: formatResultTimestamp(p.createdAt || p.final_scan_at),
      });
    });
    wb.xlsx.writeBuffer().then((buf) => {
      saveAs(new Blob([buf]), `Scrap_Parts_${activeStudioData.title.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`);
    });
  }, [filteredContextParts, activeStudioData.title]);

  // NG across all stations (the page KPI strip is RejectionKpiStrip, shown above the tabs)
  const totalGateNgSum = useMemo(() => {
    return processedQualityGates.reduce((sum, g) => sum + (Number(g.ngCount) || 0), 0);
  }, [processedQualityGates]);

  /* ── Handlers ───────────────────────────────────────────────────────────── */
  const handleGateBarClick = useCallback((data) => {
    const code = data?.code || data?.payload?.code || (data?.activePayload && data.activePayload[0]?.payload?.code);
    if (code) {
      setDrillDownGate(code);
      setDrillDownCategory(null);
      setDrillDownReason(null);
      setDrillDownLevel(1);
      setShowPartIdTable(true);
      setIsPictorialExpanded(true);
      setIsPartsLogExpanded(true);
      setIsStudioVisible(true);
      setIsContextLogExpanded(true);
    }
  }, []);

  const handleCategoryBarClick = useCallback((data) => {
    const cat = data?.category || data?.payload?.category || (data?.activePayload && data.activePayload[0]?.payload?.category);
    if (cat) {
      setDrillDownCategory(cat);
      setDrillDownReason(null);
      setDrillDownLevel(2);
      setShowPartIdTable(true);
      setIsPictorialExpanded(true);
      setIsPartsLogExpanded(true);
      setIsStudioVisible(true);
      setIsContextLogExpanded(true);
    }
  }, []);

  const handleReasonBarClick = useCallback((data) => {
    const r = data?.reason || data?.payload?.reason || (data?.activePayload && data.activePayload[0]?.payload?.reason);
    if (r) {
      setDrillDownReason(r);
      setShowPartIdTable(true);
      setIsPictorialExpanded(true);
      setIsPartsLogExpanded(true);
      setIsStudioVisible(true);
      setIsContextLogExpanded(true);
    }
  }, []);

  const handleDrillDownBack = useCallback(() => {
    setDrillDownSelectedView("all");
    if (drillDownLevel === 2) {
      if (drillDownReason) setDrillDownReason(null);
      else { setDrillDownCategory(null); setDrillDownLevel(1); }
    } else if (drillDownLevel === 1) {
      setDrillDownGate(null);
      setDrillDownCategory(null);
      setDrillDownReason(null);
      setDrillDownLevel(0);
      setShowPartIdTable(false);
    }
  }, [drillDownLevel, drillDownReason]);

  const handleDrillDownReset = useCallback(() => {
    setDrillDownGate(null);
    setDrillDownCategory(null);
    setDrillDownReason(null);
    setDrillDownLevel(0);
    setDrillDownSelectedView("all");
    setShowPartIdTable(false);
  }, []);

  /* ── Shift data ────────────────────────────────────────────────────────── */
  // Rows {shift, total, scrap, ok}. "UNASSIGNED" (no shift recorded) is kept and shown as "Unassigned".
  // Rates use completed parts only: OK % = OK ÷ (OK + NG), NG % = NG ÷ (OK + NG). The server's
  // scrapRate divides by total incl. in-process parts, so it is recomputed here and not used.
  const { shiftRows, shiftTotals } = useMemo(() => {
    const byKey = {};
    (shiftScrap || []).forEach((s) => {
      const key = shiftKey(s.shift || s.shift_code);
      const r = byKey[key] || (byKey[key] = { key, label: shiftLabel(key), color: SHIFT[key], total: 0, ok: 0, ng: 0 });
      r.total += num(s.total);
      r.ok += num(s.ok);
      r.ng += num(s.scrap);
    });
    const rowsOut = SHIFT_ORDER.map((k) => byKey[k]).filter((r) => r && (r.total > 0 || r.ok > 0 || r.ng > 0)).map((r) => {
      const completed = r.ok + r.ng;
      return {
        ...r,
        total: Math.max(r.total, completed),
        wip: Math.max(0, r.total - r.ok - r.ng),
        completed,
        okPct: pctOf(r.ok, completed),
        ngPct: pctOf(r.ng, completed),
      };
    });
    const totals = rowsOut.reduce((t, r) => ({
      total: t.total + r.total, ok: t.ok + r.ok, ng: t.ng + r.ng, wip: t.wip + r.wip,
    }), { total: 0, ok: 0, ng: 0, wip: 0 });
    totals.completed = totals.ok + totals.ng;
    totals.okPct = pctOf(totals.ok, totals.completed);
    totals.ngPct = pctOf(totals.ng, totals.completed);
    return { shiftRows: rowsOut, shiftTotals: totals };
  }, [shiftScrap]);

  /* ═════════════════════════════════════════════════════════════════════════
     ADVANCED STATION ANALYTICS
     ═════════════════════════════════════════════════════════════════════════ */

  /* ── Process flow yield (serial flow; the parallel leak machines = one OP150 step) ── */
  // Per step: entering = OK + NG inspected there · NG removed = NG · FPY = OK ÷ (OK + NG).
  // RTY = Π FPYᵢ over every step with inspections (a step with no NG has FPY = 100 %).
  const flow = useMemo(() => {
    const order = [];
    let leak = null;
    [...(qualityGates || [])]
      .sort((a, b) => opNumber(a.code) - opNumber(b.code))
      .forEach((g) => {
        const ok = Math.max(0, num(g.okCount)), ng = Math.max(0, num(g.ngCount));
        if (isLeakCode(g.code)) {
          if (!leak) {
            leak = { code: "OP150", short: "Leak test", name: "OP150 Leak test", ok: 0, ng: 0, subs: [] };
            order.push(leak);
          }
          leak.ok += ok; leak.ng += ng;
          leak.subs.push({ code: g.code, ok, ng });
        } else {
          order.push({ code: g.code, short: stationShortName(g.name, g.code), name: g.name || g.code, ok, ng, subs: [] });
        }
      });
    if (leak && leak.subs.length > 1) leak.name = `OP150 Leak test (${leak.subs.length} machines in parallel)`;
    let cum = 1;
    const steps = order.map((s, i) => {
      const entering = s.ok + s.ng;
      const fpy = entering > 0 ? s.ok / entering : null;
      if (fpy != null) cum *= fpy;
      const next = order[i + 1];
      const nextIn = next ? next.ok + next.ng : null;
      return { ...s, entering, fpy, cumYield: cum, nextIn, gap: next ? s.ok - nextIn : null };
    });
    const totalNg = steps.reduce((s, x) => s + x.ng, 0);
    return { steps, rty: steps.some((s) => s.fpy != null) ? cum : null, totalNg };
  }, [qualityGates]);

  /* ── Station columns (follow the leak-test grouping toggle) ── */
  const stationCols = useMemo(() => processedQualityGates.map((g) => ({
    code: g.code,
    label: g.isGrouped ? "OP150 (leak)" : (g.shortLabel || g.code),
    name: g.displayName || g.name || g.code,
    ok: Math.max(0, num(g.okCount)),
    ng: Math.max(0, num(g.ngCount)),
  })), [processedQualityGates]);
  const stationLabelOf = useCallback((code) => stationCols.find((s) => s.code === code)?.label || code, [stationCols]);

  /* ── NG records, de-duplicated, each booked to the station that rejected it ── */
  const ngRecs = useMemo(() => {
    const seen = new Set();
    const out = [];
    (allRejectionRecords || []).forEach((r) => {
      const id = r?.id ?? r?.partId ?? r?.part_id ?? r?.rowKey;
      if (id != null) { if (seen.has(id)) return; seen.add(id); }
      out.push(r);
    });
    return out;
  }, [allRejectionRecords]);
  const ngByStation = useMemo(() => {
    const codes = stationCols.map((s) => s.code);
    return ngRecs.map((r) => ({ r, st: recordStationKey(r, codes) })).filter((x) => x.st);
  }, [ngRecs, stationCols]);

  const stationOrder = useMemo(() => stationCols.map((s) => s.code), [stationCols]);
  // Station chart rows + the process-flow figures: FPY of the station and rolled yield up to it
  // (the parallel leak machines are one OP150 step in the flow)
  const gateChartRows = useMemo(() => qualityGateChartData.map((d) => {
    const step = flow.steps.find((st) => st.code === (isLeakCode(d.code) ? "OP150" : String(d.code || "").toUpperCase()));
    return {
      ...d,
      fpy: d.inspected > 0 ? (d.OK / d.inspected) * 100 : null,
      rolled: step && step.cumYield != null ? Number((step.cumYield * 100).toFixed(2)) : null,
    };
  }), [qualityGateChartData, flow]);
  const rolledMin = useMemo(() => {
    const v = gateChartRows.map((d) => d.rolled).filter((x) => x != null);
    return v.length ? Math.max(0, Math.floor(Math.min(...v) - 2)) : 80;
  }, [gateChartRows]);
  const stationOfRecord = useCallback((r) => recordStationKey(r, stationOrder), [stationOrder]);
  const dailyCards = useDailyQualityCards({ filters, ngRecs, stationOf: stationOfRecord, stationLabelOf, stationColor, stationOrder });

  /* ── Pareto drill-down: the stations that rejected the selected reason / category / zone ── */
  const paretoStationSplit = useMemo(() => {
    if (!paretoDrill || paretoDrill.view !== paretoView) return null;
    const counts = {};
    let total = 0;
    ngByStation.forEach(({ r, st }) => {
      if (!matchesParetoItem(r, paretoDrill.view, paretoDrill.key)) return;
      counts[st] = (counts[st] || 0) + 1;
      total += 1;
    });
    const rows = Object.keys(counts)
      .sort((a, b) => opNumber(a) - opNumber(b) || String(a).localeCompare(String(b)))
      .map((code) => ({ code, label: stationLabelOf(code), count: counts[code], pct: pctOf(counts[code], total) ?? 0 }));
    return { key: paretoDrill.key, rows, total };
  }, [paretoDrill, paretoView, ngByStation, matchesParetoItem, stationLabelOf]);

  /* ── Station × defect matrix (top 10 reasons; everything else folded into one row) ── */
  const defectMatrix = useMemo(() => {
    const cell = {}, rowTot = {}, colTot = {};
    ngByStation.forEach(({ r, st }) => {
      const reason = parseRowDefect(r).reason || NOT_RECORDED;
      const k = `${reason}\u0000${st}`;
      cell[k] = (cell[k] || 0) + 1;
      rowTot[reason] = (rowTot[reason] || 0) + 1;
      colTot[st] = (colTot[st] || 0) + 1;
    });
    const reasons = Object.keys(rowTot).sort((a, b) => rowTot[b] - rowTot[a]);
    if (!reasons.length) return null;
    const top = reasons.slice(0, 10);
    const rest = reasons.slice(10);
    const stations = [
      ...stationCols.map((s) => s.code).filter((c) => colTot[c] > 0),
      ...Object.keys(colTot).filter((c) => !stationCols.some((s) => s.code === c)),
    ];
    const rowsOut = top.map((reason) => ({ reason, cells: stations.map((st) => cell[`${reason}\u0000${st}`] || 0), total: rowTot[reason] }));
    if (rest.length) {
      rowsOut.push({
        reason: `All other reasons (${rest.length})`, isOther: true,
        cells: stations.map((st) => rest.reduce((s, reason) => s + (cell[`${reason}\u0000${st}`] || 0), 0)),
        total: rest.reduce((s, reason) => s + rowTot[reason], 0),
      });
    }
    return { rows: rowsOut, stations, colTot: stations.map((st) => colTot[st] || 0), grand: ngByStation.length };
  }, [ngByStation, stationCols]);

  /* ── Category → reason nested donut ── */

  /* ── ECharts options (memoised so hover re-renders don't restart animations) ── */
  const matrixOption = useMemo(() => {
    if (!defectMatrix) return null;
    const { rows: mRows, stations, colTot, grand } = defectMatrix;
    const xCats = [...stations.map(stationLabelOf), "Total"];
    const yCats = [...mRows.map((r) => r.reason), "Total"];
    const maxCell = Math.max(1, ...mRows.flatMap((r) => r.cells));
    const TOTAL_BG = "#eef2f7";
    const data = [];
    mRows.forEach((r, yi) => {
      r.cells.forEach((v, xi) => {
        const col = seqColor(v, maxCell, SEQ_SCRAP);
        const bucket = col ? SEQ_SCRAP.indexOf(col) : 9;
        data.push({ value: [xi, yi, v, bucket], label: { color: bucket >= 4 && bucket < 9 ? "#ffffff" : v > 0 ? INK.primary : INK.faint } });
      });
      data.push({ value: [stations.length, yi, r.total, 7], label: { color: INK.primary, fontWeight: 700 } });
    });
    colTot.forEach((v, xi) => data.push({ value: [xi, mRows.length, v, 7], label: { color: INK.primary, fontWeight: 700 } }));
    data.push({ value: [stations.length, mRows.length, grand, 8], label: { color: INK.primary, fontWeight: 700 } });
    return baseOption({
      grid: { left: 196, right: 12, top: 36, bottom: 8 },
      // Heatmap needs a visualMap: map the pre-computed colour bucket (dimension 3) to the cell colour.
      visualMap: {
        type: "piecewise", show: false, dimension: 3, seriesIndex: 0,
        pieces: [...SEQ_SCRAP.map((c, i) => ({ value: i, color: c })), { value: 7, color: TOTAL_BG }, { value: 8, color: INK.border }, { value: 9, color: "#f8fafc" }],
      },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (p) => {
          const [xi, yi, v] = p.value;
          const isColTot = xi === stations.length, isRowTot = yi === mRows.length;
          const reason = yCats[yi], st = xCats[xi];
          if (isColTot && isRowTot) return tooltipHtml({ title: "All NG parts with a recorded station", rows: [{ label: "NG parts", value: fmtInt(v) }] });
          if (isColTot) return tooltipHtml({ title: reason, subtitle: "All stations", rows: [{ label: "NG parts", value: fmtInt(v) }, { label: "Share of all NG", value: fmtPct(pctOf(v, grand)) }] });
          if (isRowTot) return tooltipHtml({ title: st, subtitle: "All reasons", rows: [{ label: "NG parts", value: fmtInt(v), color: stationColor(stations[xi]) }, { label: "Share of all NG", value: fmtPct(pctOf(v, grand)) }] });
          return tooltipHtml({
            title: reason, subtitle: `at ${st}`,
            rows: [
              { label: "NG parts", value: fmtInt(v), color: seqColor(v, maxCell, SEQ_SCRAP) || INK.faint },
              { label: `Share of ${st} NG`, value: fmtPct(pctOf(v, colTot[xi])) },
              { label: "Share of this reason's NG", value: fmtPct(pctOf(v, mRows[yi].total)) },
              { label: "Share of all NG", value: fmtPct(pctOf(v, grand)) },
            ],
          });
        },
      },
      xAxis: {
        type: "category", data: xCats, position: "top", splitArea: { show: false },
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: axisLabel({ interval: 0, fontWeight: 600, color: INK.secondary, formatter: (v) => truncate(v, 14) }),
      },
      yAxis: {
        type: "category", data: yCats, inverse: true,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: axisLabel({ width: 180, overflow: "truncate", color: INK.secondary, fontSize: 11.5 }),
      },
      series: [{
        type: "heatmap", data,
        label: { show: true, fontSize: 11.5, fontWeight: 600, fontFamily: FONT_FAMILY, formatter: (p) => (p.value[2] > 0 ? fmtInt(p.value[2]) : "·") },
        itemStyle: { borderColor: "#ffffff", borderWidth: 2, borderRadius: 4 },
        emphasis: { itemStyle: { borderColor: INK.primary, borderWidth: 2 } },
      }],
    });
  }, [defectMatrix, stationLabelOf]);



  if (loading) return <RejectionAnalysisSkeleton />;

  /* ── One colour per defect reason, fixed by the plant-wide Pareto order ─ */
  const reasonColor = makeColorMap(cleanPareto.map((p) => p.reason));
  const zoneColor = makeColorMap(zoneBreakdown.map((z) => z.zone));
  const paretoKey = paretoView === "reason" ? "reason" : paretoView === "category" ? "category" : "zone";
  const paretoList = paretoView === "reason" ? cleanPareto : paretoView === "category" ? categoryPareto : zoneBreakdown;
  const paretoItemColor = (k) => (paretoView === "reason" ? reasonColor(k) : paretoView === "category" ? categoryColor(k) : zoneColor(k));
  const paretoItemLabel = (k) => (paretoView === "category" ? catLabel(k) : k);
  const paretoNoun = paretoView === "reason" ? "reason" : paretoView === "category" ? "category" : "zone";
  const paretoTotal = paretoList.reduce((s, d) => s + num(d.count), 0);
  // Vital few: every item whose bar starts below the 80% cumulative line.
  const paretoChartData = paretoList.slice(0, 18).map((d) => {
    const pct = num(d.percentage);
    const cum = num(d.cumulativePercentage);
    return { ...d, pct, cum, vital: cum - pct < 80 };
  });
  const focusParetoItem = (item) => {
    setSelectedParetoItem(item);
    setParetoSelectedView("all");
    setIsStudioVisible(true);
    setTimeout(() => studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  /* ═════════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="qg-root">
      <style>{CARD_CSS + QG_CSS}</style>

      {/* ─── STATION PIPELINE ────────────────────────────────────────────── */}
      <div className="ra-card" data-accent style={accent(ACCENT.process)}>
        <div className="ra-card-head">
          <div style={{ minWidth: 0, flex: "1 1 260px", paddingLeft: 42, position: "relative" }}>
            <span className="ra-icon" aria-hidden="true" style={{ position: "absolute", left: 0, top: 0 }}><Gauge size={16} /></span>
            <h3 className="ra-card-title" style={{ display: "flex", alignItems: "center" }}>Scrap rate at each station<InfoTip info={INFO.pipeline} /></h3>
            <p className="ra-card-sub">Stations in process order · gauge = NG ÷ parts inspected there · click a station for its defect map</p>
          </div>
          <div className="rej-header-actions">
            <div className="rej-carousel-controls">
              <button onClick={() => scrollPipeline("left")} className="rej-carousel-nav-btn" title="Scroll Left" aria-label="Scroll left">
                <ChevronLeft size={15} />
              </button>
              <button
                onClick={() => setIsCarouselPlaying((p) => !p)}
                className={`rej-carousel-play-btn ${isCarouselPlaying ? (isCarouselHovered ? "hovered" : "active") : "paused"}`}
                aria-label="Toggle auto scroll"
              >
                {isCarouselPlaying ? (
                  isCarouselHovered ? <Pause size={12} color="#d97706" /> : <Play size={12} color="#16a34a" />
                ) : (
                  <Play size={12} color="#64748b" />
                )}
              </button>
              <button onClick={() => scrollPipeline("right")} className="rej-carousel-nav-btn" title="Scroll Right" aria-label="Scroll right">
                <ChevronRight size={15} />
              </button>
            </div>

            <span style={{ fontSize: 12, color: INK.muted }}>{processedQualityGates.length} stations</span>

            <div style={{ display: "flex", alignItems: "center", gap: 8, background: INK.surfaceAlt, padding: "5px 8px 5px 12px", borderRadius: 20, border: `1px solid ${INK.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: INK.body }}>
                {isOp150Grouped ? "Leak test: combined" : "Leak test: per machine"}
              </span>
              <button
                onClick={() => setIsOp150Grouped((prev) => !prev)}
                aria-pressed={isOp150Grouped}
                title={isOp150Grouped ? "Show Leak-Test-1/2/3 separately" : "Combine all leak test machines into OP150"}
                style={{
                  width: 36, height: 20, borderRadius: 20,
                  background: isOp150Grouped ? CATEGORICAL[0] : INK.axis,
                  position: "relative", cursor: "pointer", border: "none",
                  transition: "all 0.2s ease", padding: 0
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: "50%", background: "#fff",
                  position: "absolute", top: 2, left: isOp150Grouped ? 18 : 2,
                  transition: "all 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
                }} />
              </button>
            </div>

            {drillDownGate && (
              <button onClick={handleDrillDownReset} className="rej-icon-btn rej-icon-btn-danger" title="Clear station filter">
                <RotateCcw size={14} />
              </button>
            )}

            <button
              onClick={() => setIsStationPictorialOpen((prev) => !prev)}
              className={`rej-icon-btn ${isStationPictorialOpen ? "active" : ""}`}
              title={isStationPictorialOpen ? "Hide Station Pictorial" : "Show Station Pictorial"}
            >
              <Layers size={15} />
            </button>
          </div>
        </div>

        <div
          ref={pipelineCarouselRef}
          className={`rej-quality-pipeline ${isCarouselHovered ? "hovered" : ""}`}
          onMouseEnter={() => setIsCarouselHovered(true)}
          onMouseLeave={() => setIsCarouselHovered(false)}
        >
          {(() => {
            const isLeakCode = (c) => {
              const u = String(c || "").toUpperCase();
              return u === "OP150" || u.startsWith("LEAK");
            };
            const leakGates = processedQualityGates.filter((g) => isLeakCode(g.code));
            const totalLeakOk = leakGates.reduce((s, g) => s + (g.okCount || 0), 0);
            const totalLeakNg = leakGates.reduce((s, g) => s + (g.ngCount || 0), 0);
            const totalLeakInsp = totalLeakOk + totalLeakNg;

            return processedQualityGates.map((gate, gIdx) => {
              const isGateSel = activeStationCode === gate.code ||
                (gate.isGrouped && ["Leak-Test-01", "Leak-Test-02", "Leak Test-03", "OP150", "Leak-Test-1", "Leak-Test-2", "Leak-Test-3"].includes(activeStationCode)) ||
                (activeStationCode === "Leak-Test-01" && gate.code === "Leak-Test-1") ||
                (activeStationCode === "Leak-Test-1" && gate.code === "Leak-Test-01");
              const rate = gateRate(gate);
              const nextGate = processedQualityGates[gIdx + 1];
              const isCurLeak = isLeakCode(gate.code);
              const isNextLeak = nextGate ? isLeakCode(nextGate.code) : false;
              const isParallel = isCurLeak && isNextLeak;

              let inProgressCount = 0;
              if (!isCurLeak && isNextLeak) inProgressCount = Math.max(0, (gate.okCount || 0) - totalLeakInsp);
              else if (isCurLeak && isNextLeak) inProgressCount = 0;
              else if (isCurLeak && nextGate && !isNextLeak) inProgressCount = Math.max(0, totalLeakOk - ((nextGate.okCount || 0) + (nextGate.ngCount || 0)));
              else if (nextGate) inProgressCount = Math.max(0, (gate.okCount || 0) - ((nextGate.okCount || 0) + (nextGate.ngCount || 0)));

              const displayCode = gate.shortLabel || gate.code;

              return (
                <Fragment key={gate.code}>
                  <div
                    className={`rej-gate-card ${isGateSel ? "active" : ""}`}
                    onClick={() => {
                      handleGateBarClick({ code: gate.code, name: displayCode, fullName: gate.name });
                      setIsStationPictorialOpen(true);
                    }}
                    title={`Click to inspect station ${displayCode}`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleGateBarClick({ code: gate.code });
                        setIsStationPictorialOpen(true);
                      }
                    }}
                  >
                    <div className="rej-gate-header">
                      <span className="rej-gate-code">
                        {displayCode}
                        {isCurLeak && !gate.isGrouped && <span className="rej-gate-op-tag">OP150</span>}
                      </span>
                      <StatusBadge rate={rate} />
                    </div>

                    <div className="rej-gate-name" title={gate.name}>{gate.name}</div>

                    <div className="rej-gate-speedo-container">
                      <StationSpeedometer value={rate} size="compact" label="SCRAP" responsive />
                    </div>

                    <div className="rej-gate-stats">
                      <span className="stat-ok" title="Parts passed at this station" style={{ color: OUTCOME.ok }}>
                        <span className="qg-swatch" style={{ background: OUTCOME.ok, marginRight: 4 }} />OK {fmtInt(gate.okCount)}
                      </span>
                      <span className="stat-ng" title="Parts rejected at this station" style={{ color: OUTCOME.ng }}>
                        <span className="qg-swatch" style={{ background: OUTCOME.ng, marginRight: 4 }} />NG {fmtInt(gate.ngCount)}
                      </span>
                    </div>

                    {gate.isGrouped && gate.subStations?.length > 0 && (
                      <div className="rej-gate-sub-badges">
                        {gate.subStations.map((sub) => (
                          <span key={sub.code} className="rej-gate-sub-badge" title={`${sub.code}: ${sub.okCount || 0} OK / ${sub.ngCount || 0} NG`}>
                            {sub.code.replace("Leak-Test-", "LT").replace("Leak Test-", "LT")}: {sub.ngCount || 0} NG
                          </span>
                        ))}
                      </div>
                    )}

                    {isGateSel && isStationPictorialOpen && <div className="rej-gate-active-arrow" />}
                  </div>

                  {nextGate && (
                    isParallel ? (
                      <div className="rej-pipeline-connector parallel" title={`Parallel: ${displayCode} + ${nextGate.shortLabel || nextGate.code}`}>
                        <div className="rej-parallel-connector-wrap">
                          <div className="rej-parallel-track" />
                          <div className="rej-parallel-badge" title="Leak test machines run in parallel — no queue between them">
                            <Plus size={16} strokeWidth={2.5} />
                          </div>
                          <span className="rej-parallel-label">Parallel</span>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="rej-pipeline-connector"
                        title={inProgressCount > 0
                          ? `${inProgressCount.toLocaleString()} parts passed ${displayCode} and are waiting for ${nextGate.shortLabel || nextGate.code}`
                          : `${displayCode} → ${nextGate.shortLabel || nextGate.code}`}
                      >
                        <svg width="60" height="64" viewBox="0 0 60 64" style={{ display: "block", overflow: "visible" }} aria-hidden="true">
                          <line x1="4" y1="32" x2="52" y2="32" stroke={INK.axis} strokeWidth="2" strokeLinecap="round" />
                          <polygon points="50,27 57,32 50,37" fill={INK.faint} />
                        </svg>
                        {inProgressCount > 0 && (
                          <div className="rej-wire-badge" style={{ background: INK.surface, borderColor: INK.border }}
                            title="Passed this station but no OK/NG result at the next station yet: parts on their way, plus parts whose scan at the next station started and never recorded a result (e.g. OP110 laser marking left IN_PROGRESS).">
                            <div className="rej-wire-header">
                              <span className="rej-wire-title" style={{ color: INK.muted }}>No result yet</span>
                            </div>
                            <div className="rej-wire-count" style={{ color: INK.secondary }}>{fmtInt(inProgressCount)}</div>
                          </div>
                        )}
                      </div>
                    )
                  )}
                </Fragment>
              );
            });
          })()}
        </div>

        {isStationPictorialOpen && activeStationGate && (
          <div className="rej-station-drawer">
            <div className="rej-station-drawer-header">
              <div className="rej-station-drawer-identity">
                <div className="rej-station-drawer-code-badge">
                  <Gauge size={16} color="#ffffff" />
                  <span>{activeStationGate.code}</span>
                </div>
                <div>
                  <h4 className="rej-station-drawer-title">
                    <span>{activeStationGate.name}</span>
                    <span className="rej-station-tag">Defect map</span>
                  </h4>
                  <p className="rej-station-drawer-subtitle">
                    Where rejects at {activeStationGate.code} were found on the casting
                  </p>
                </div>
              </div>

              <div className="rej-station-drawer-actions">
                <div className="rej-station-angle-pills">
                  {!isLeakStation ? (
                    <>
                      <button
                        onClick={() => setStationActiveAngle("all")}
                        className={`rej-station-angle-btn ${stationActiveAngle === "all" ? "active" : ""}`}
                      >
                        <Grid size={12} /><span>Busiest view</span>
                        <span className="count-pill primary">{fmtInt(activeStationGate.ngCount || 0)}</span>
                      </button>
                      {(stationViewList || []).map((v) => {
                        const isSel = stationActiveAngle === v.name || stationActiveAngle === v.code;
                        return (
                          <button
                            key={v.id || v.code}
                            onClick={() => setStationActiveAngle(v.name)}
                            className={`rej-station-angle-btn ${isSel ? "active" : ""}`}
                          >
                            <Camera size={12} /><span>{v.name}</span>
                            <span className={`count-pill ${v.totalDefects > 0 ? "danger" : "muted"}`}>{v.totalDefects}</span>
                          </button>
                        );
                      })}
                    </>
                  ) : (
                    <button className="rej-station-angle-btn active" style={{ cursor: "default" }}>
                      <Gauge size={12} />
                      <span>Leak test (sensor)</span>
                      <span className="count-pill primary">{fmtInt(activeStationGate.ngCount || 0)}</span>
                    </button>
                  )}
                </div>

                <button onClick={() => setIsStationPictorialOpen(false)} className="rej-icon-btn rej-icon-btn-close" title="Close Station CAD Pictorial View">
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="rej-station-drawer-body">
              <div className="rej-station-cad-col">
                <div className="rej-viewport-topbar">
                  <div className="rej-viewport-title">
                    <Camera size={14} color="#60a5fa" />
                    <span>{stationCurrentView?.name || "Inspection Angle"}</span>
                    {isLeakStation ? (
                      <span className="rej-viewport-status-badge info">
                        Pressure-decay sensor · {fmtInt(activeStationGate.ngCount || 0)} leak NG
                      </span>
                    ) : (activeStationGate?.ngCount || 0) === 0 ? (
                      <span className="rej-viewport-status-badge ok">No rejects at this station</span>
                    ) : stationCurrentView?.totalDefects > 0 ? (
                      <span className="rej-viewport-status-badge danger">
                        {fmtInt(stationCurrentView.totalDefects)} NG on this view
                      </span>
                    ) : (
                      <span className="rej-viewport-status-badge ok">No NG located on this view</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    View {Math.max(1, (stationViewList || []).findIndex((v) => v.name === stationCurrentView?.name) + 1)} of {stationViewList?.length || 0}
                  </span>
                </div>

                <div className="rej-viewport-canvas" style={{ flexDirection: "column", gap: 10 }}>
                  {isLeakStation && (
                    <div className="rej-sensor-viewport-banner" style={{ position: "static" }}>
                      <Cpu size={14} color="#60a5fa" />
                      <span>Leak test — detected by pressure-decay sensor, no visual location</span>
                    </div>
                  )}
                  {!isLeakStation && (activeStationGate?.ngCount || 0) === 0 && (
                    <div className="rej-pass-viewport-banner" style={{ position: "static" }}>
                      <CheckCircle2 size={15} color={OUTCOME.ok} />
                      <span>No rejects at this station in the selected period</span>
                    </div>
                  )}
                  {!stationViewList.length ? (
                    <div className="rej-viewport-empty" style={{ minHeight: 220 }}>
                      <Camera size={32} color="#475569" style={{ marginBottom: 8 }} />
                      <div>No CAD views configured for this part (Rejection Configuration → View Setup)</div>
                    </div>
                  ) : (
                    <div style={{ width: "100%", maxWidth: 760, margin: "0 auto" }}>
                      <CadStage imageUrl={stationCurrentView?.imageUrl} alt={stationCurrentView?.name} dark>
                        {!isLeakStation && renderZoneHeat(stationCurrentView?.zones || [])}
                      </CadStage>
                      {!isLeakStation && stationLocalization.records > 0 && (
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
                          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "rgba(239,68,68,.6)", border: "1.5px solid #ef4444", marginRight: 5, verticalAlign: -1 }} />Recorded zone</span>
                          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "rgba(245,158,11,.35)", border: "1.5px dashed #f59e0b", marginRight: 5, verticalAlign: -1 }} />Inferred from defect type (zone not entered)</span>
                          <span style={{ marginLeft: "auto" }}>
                            {fmtInt(stationLocalization.localized)} of {fmtInt(stationLocalization.records)} NG records placed on a zone
                            {stationLocalization.unlocalized > 0 && ` · ${fmtInt(stationLocalization.unlocalized)} without zone`}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="rej-station-intel-col">
                <div className="rej-station-speedo-card">
                  <div className="rej-station-speedo-header">
                    <span className="title">Station scrap rate</span>
                    <span className="spec-info">Pass ≤ 2.5% · Watch 2.5–5% · Alert &gt; 5%</span>
                  </div>
                  <div className="rej-station-featured-speedo-wrap">
                    <StationSpeedometer value={gateRate(activeStationGate)} size="featured" label={`${activeStationGate.code} SCRAP`} responsive />
                  </div>
                  <div style={{ textAlign: "center", fontSize: 11.5, color: INK.muted }}>NG ÷ parts inspected at this station</div>
                </div>

                <div className="rej-station-kpi-grid">
                  {(() => {
                    const ok = num(activeStationGate.okCount);
                    const ng = num(activeStationGate.ngCount);
                    const insp = ok + ng;
                    const ppm = insp > 0 ? Math.round((ng / insp) * 1000000) : null;
                    return (
                      <>
                        <div className="rej-station-mini-kpi">
                          <span className="label">Inspected</span>
                          <span className="val">{fmtInt(insp)}</span>
                          <span className="kpi-subtext">OK + NG at this station</span>
                        </div>
                        <div className="rej-station-mini-kpi">
                          <span className="label">Passed (OK)</span>
                          <span className="val" style={{ color: OUTCOME.ok }}>{fmtInt(ok)}</span>
                          <span className="kpi-subtext">{fmtPct(pctOf(ok, insp))} yield</span>
                        </div>
                        <div className="rej-station-mini-kpi">
                          <span className="label">Rejected (NG)</span>
                          <span className="val" style={{ color: OUTCOME.ng }}>{fmtInt(ng)}</span>
                          <span className="kpi-subtext">{fmtPct(pctOf(ng, insp))} of inspected</span>
                        </div>
                        <div className="rej-station-mini-kpi ppm" title="Defect PPM = NG ÷ inspected × 1,000,000">
                          <div className="kpi-top">
                            <span className="label">Defect PPM</span>
                          </div>
                          <span className="val">{ppm == null ? "—" : ppm.toLocaleString()}</span>
                          <span className="kpi-subtext">Defective parts per million</span>
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="rej-station-reasons-card">
                  <div className="rej-station-reasons-header">
                    <span className="title">
                      {isLeakStation
                        ? "Leak NG by test channel"
                        : "Top defects at this station"}
                    </span>
                    <span className="subtitle">
                      {stationTopReasons.length ? "Share of NG parts at this station" : ""}
                    </span>
                  </div>

                  {isLeakStation && (
                    <div className="rej-station-spm-notice">
                      <Cpu size={13} style={{ flexShrink: 0, color: "#2563eb" }} />
                      <span>
                        Automated station: rejects come from the pressure-decay sensor reading, not from a visual defect entry.
                      </span>
                    </div>
                  )}
                  <div className="rej-station-reasons-list">
                    {stationTopReasons.length > 0 ? (
                      stationTopReasons.map((item, idx) => (
                        <div
                          key={idx}
                          className="rej-station-reason-row"
                          onClick={() => {
                            handleReasonBarClick({ reason: item.reason });
                            document.querySelector(".rej-studio-container")?.scrollIntoView({ behavior: "smooth" });
                          }}
                          title={`Click to focus on ${item.reason}`}
                        >
                          <div className="row-info">
                            <span className="rank">#{idx + 1}</span>
                            <span className="reason-name">
                              <span className="qg-swatch" style={{ background: reasonColor(item.reason) }} />{item.reason}
                            </span>
                            <span className="count-tag">{fmtInt(item.count)} pcs</span>
                            <span className="pct-tag">{fmtPct(item.percentage)}</span>
                          </div>
                          <div className="reason-bar-track">
                            <div className="reason-bar-fill" style={{ width: `${Math.min(100, num(item.percentage))}%`, background: reasonColor(item.reason) }} />
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rej-station-reasons-empty">
                        {num(activeStationGate.ngCount) > 0 ? (
                          <span>
                            {fmtInt(activeStationGate.ngCount)} NG at {activeStationGate.code}, but no defect reason or sensor reading
                            was recorded for them in the loaded records.
                          </span>
                        ) : (
                          <>
                            <CheckCircle2 size={16} color={OUTCOME.ok} />
                            <span>No rejects at {activeStationGate.code} in the selected period.</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── STATION OK / NG COMPARISON + CATEGORY / REASON DRILL-DOWN ──── */}
      <div className="ra-card" data-accent style={accent(ACCENT.process)}>
        <div className="ra-card-head">
          <div style={{ minWidth: 0, flex: "1 1 260px", paddingLeft: 42, position: "relative" }}>
            <span className="ra-icon" aria-hidden="true" style={{ position: "absolute", left: 0, top: 0 }}><BarChart3 size={16} /></span>
            <h3 className="ra-card-title" style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
              {drillDownLevel === 0 && "Parts passed and rejected at each station"}
              {drillDownLevel === 1 && `${drillDownGate} — rejects by defect category`}
              {drillDownLevel === 2 && `${drillDownGate} › ${catLabel(drillDownCategory)} — rejects by reason`}
              <InfoTip info={INFO.stations} />
            </h3>
            {/* <p className="ra-card-sub">
              {drillDownLevel === 0 && "Stations in process order · bars = parts inspected (OK + NG) · dashed line = rolled yield · click a station for its defect categories"}
              {drillDownLevel === 1 && "NG parts at this station by category · click a category to see its reasons"}
              {drillDownLevel === 2 && "NG parts in this category by reason · click a bar to show it on the defect map"}
            </p> */}
          </div>
          {drillDownLevel > 0 && (
            <div className="rej-header-actions">
              <div className="rej-drilldown-breadcrumb">
                <button onClick={handleDrillDownReset} className="rej-breadcrumb-link">All stations</button>
                <ChevronRight size={12} color={INK.faint} />
                <span
                  className={drillDownLevel === 1 ? "rej-breadcrumb-active" : "rej-breadcrumb-link"}
                  onClick={drillDownLevel === 2 ? handleDrillDownBack : undefined}
                  style={drillDownLevel === 2 ? { cursor: "pointer" } : {}}
                >
                  {drillDownGate}
                </span>
                {drillDownLevel === 2 && (
                  <>
                    <ChevronRight size={12} color={INK.faint} />
                    <span className="rej-breadcrumb-active">{drillDownCategory}</span>
                  </>
                )}
              </div>
              <button onClick={handleDrillDownBack} className="rej-drilldown-back-btn">← Back</button>
            </div>
          )}
        </div>

        {drillDownLevel === 0 && (
          <div className="ra-card-body">
            <div className="ra-legend" style={{ padding: "0 4px 6px" }}>
              <span><i style={{ background: OUTCOME.ok }} />OK</span>
              <span><i style={{ background: OUTCOME.ng }} />NG</span>
              <span><i style={{ background: ACCENT.process, height: 3, borderRadius: 2 }} />Rolled yield</span>
              <span><i style={{ background: OUTCOME.wip }} />No result yet</span>
            </div>
            {qualityGateChartData.length === 0 ? (
              <Empty height={260}>No station results for the selected period.</Empty>
            ) : (
              <div className="rej-chart-scroll-wrapper">
                <div style={{ height: 420, minWidth: qualityGateChartData.length > 8 ? qualityGateChartData.length * 110 : "100%" }}>
                  <SafeChart height={420}>
                    {({ width, height }) => (
                      <ComposedChart width={width} height={height} data={gateChartRows} barGap={4} barCategoryGap="22%"
                        margin={{ top: 44, right: 8, left: 12, bottom: 28 }}>
                        <CartesianGrid {...RECHARTS_GRID} />
                        <XAxis dataKey="name" interval={0} {...RECHARTS_AXIS} height={40}
                          label={{ value: "Inspection station (process order)", position: "insideBottom", offset: -16, style: AXIS_LABEL_STYLE }} />
                        <YAxis yAxisId="parts" {...RECHARTS_AXIS} axisLine={false} width={64} tickFormatter={(v) => fmtInt(v)}
                          domain={[0, (max) => Math.ceil((max || 10) * 1.15)]}
                          label={{ value: "Parts", angle: -90, position: "insideLeft", offset: 0, style: AXIS_LABEL_STYLE }} />
                        <YAxis yAxisId="yield" orientation="right" {...RECHARTS_AXIS} axisLine={false} width={48} domain={[rolledMin, 100]}
                          tickFormatter={(v) => `${v}%`} />
                        <Tooltip
                          cursor={RECHARTS_TOOLTIP.cursor}
                          content={({ payload }) => {
                            const d = payload?.[0]?.payload;
                            if (!d) return null;
                            return (
                              <TipCard
                                title={d.fullName}
                                subtitle="Click to see defect categories"
                                rows={[
                                  { label: "Inspected (OK + NG)", value: fmtInt(d.inspected) },
                                  { label: "OK", value: `${fmtInt(d.OK)} · ${fmtPct(pctOf(d.OK, d.inspected))}`, color: OUTCOME.ok },
                                  { label: "NG", value: `${fmtInt(d.NG)} · ${fmtPct(pctOf(d.NG, d.inspected))}`, color: OUTCOME.ng },
                                  { label: "First-pass yield here", value: fmtPct(d.fpy, 2) },
                                  d.rolled != null && { label: "Rolled yield up to here", value: `${d.rolled.toFixed(2)}%`, color: ACCENT.process },
                                  { label: "Share of all station NG", value: fmtPct(pctOf(d.NG, totalGateNgSum)) },
                                  d.inProgress > 0 && { label: "No result yet at next station", value: fmtInt(d.inProgress), color: OUTCOME.wip },
                                  { label: "Status", value: `${gateStatus(d.scrapRate).label} (limits 2.5% / 5%)`, strong: false },
                                ]}
                              />
                            );
                          }}
                        />
                        <Bar yAxisId="parts" dataKey="OK" name="OK" stackId="insp" fill={OUTCOME.ok} cursor="pointer" maxBarSize={48} onClick={handleGateBarClick}>
                          {/* OK count inside the green part when it is tall enough */}
                          <LabelList dataKey="OK" content={({ x, y, width: w, height: h, value }) => (
                            value > 0 && h >= 22 ? (
                              <text x={x + w / 2} y={y + h / 2} dy={4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#ffffff" style={{ fontVariantNumeric: "tabular-nums" }}>
                                {value >= 10000 ? `${(value / 1000).toFixed(1)}k` : fmtInt(value)}
                              </text>
                            ) : null
                          )} />
                        </Bar>
                        <Bar yAxisId="parts" dataKey="NG" name="NG" stackId="insp" fill={OUTCOME.ng} radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={48} onClick={handleGateBarClick}>
                          {/* above the bar: total inspected, then NG count and scrap rate */}
                          <LabelList dataKey="NG" content={({ x, y, width: w, index }) => {
                            const d = gateChartRows[index];
                            if (!d || !d.inspected) return null;
                            return (
                              <g style={{ fontVariantNumeric: "tabular-nums" }}>
                                <text x={x + w / 2} y={y - 20} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK.primary}>{fmtInt(d.inspected)}</text>
                                <text x={x + w / 2} y={y - 6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={OUTCOME.ng}>NG {fmtInt(d.NG)} · {d.scrapLabel}</text>
                              </g>
                            );
                          }} />
                        </Bar>
                        <Bar yAxisId="parts" dataKey="inProgress" name="No result yet" fill={OUTCOME.wip} radius={[4, 4, 0, 0]} maxBarSize={28}>
                          <LabelList dataKey="inProgress" position="top" style={{ fontSize: 10.5, fontWeight: 600, fill: INK.secondary }}
                            formatter={(v) => (v > 0 ? fmtInt(v) : "")} />
                        </Bar>
                        <Line yAxisId="yield" dataKey="rolled" name="Rolled yield %" type="monotone" stroke={ACCENT.process} strokeWidth={2}
                          strokeDasharray="5 4" dot={{ r: 3.5, fill: ACCENT.process, strokeWidth: 0 }} isAnimationActive={false} connectNulls />
                      </ComposedChart>
                    )}
                  </SafeChart>
                </div>
              </div>
            )}
          </div>
        )}

        {drillDownLevel === 1 && (
          <div className="ra-card-body">
            {drillDownCategoryData.length === 0 ? (
              <Empty height={240}>No categorised rejects recorded for {drillDownGate} in the selected period.</Empty>
            ) : (
              <div className="rej-chart-scroll-wrapper">
                <div style={{ height: 340, minWidth: drillDownCategoryData.length > 6 ? drillDownCategoryData.length * 130 : "100%" }}>
                  <SafeChart height={340}>
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={drillDownCategoryData} margin={{ top: 26, right: 16, left: 12, bottom: 28 }}>
                        <CartesianGrid {...RECHARTS_GRID} />
                        <XAxis dataKey="category" interval={0} {...RECHARTS_AXIS} height={40}
                          label={{ value: "Defect category", position: "insideBottom", offset: -16, style: AXIS_LABEL_STYLE }} />
                        <YAxis {...RECHARTS_AXIS} axisLine={false} width={56} allowDecimals={false}
                          domain={[0, (max) => Math.ceil((max || 10) * 1.15)]}
                          label={{ value: "NG parts", angle: -90, position: "insideLeft", offset: 0, style: AXIS_LABEL_STYLE }} />
                        <Tooltip
                          cursor={RECHARTS_TOOLTIP.cursor}
                          content={({ payload }) => {
                            const d = payload?.[0]?.payload;
                            if (!d) return null;
                            return (
                              <TipCard
                                title={catLabel(d.category)}
                                subtitle={`${drillDownGate} · click to see reasons`}
                                rows={[
                                  { label: "NG parts", value: fmtInt(d.count), color: categoryColor(d.category) },
                                  { label: "Share of station NG", value: fmtPct(d.percentage) },
                                ]}
                              />
                            );
                          }}
                        />
                        <Bar dataKey="count" name="NG parts" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={64} onClick={handleCategoryBarClick}>
                          {drillDownCategoryData.map((d) => (
                            <Cell key={d.category} fill={categoryColor(d.category)} />
                          ))}
                          <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 600, fill: INK.secondary }}
                            formatter={(v) => (v > 0 ? fmtInt(v) : "")} />
                        </Bar>
                      </BarChart>
                    )}
                  </SafeChart>
                </div>
              </div>
            )}
          </div>
        )}

        {drillDownLevel === 2 && (
          <div className="ra-card-body">
            {drillDownReasonData.length === 0 ? (
              <Empty height={240}>No defect reasons recorded for {drillDownGate} › {drillDownCategory}.</Empty>
            ) : (
              <div className="rej-chart-scroll-wrapper">
                <div style={{ height: 360, minWidth: drillDownReasonData.length > 5 ? drillDownReasonData.length * 140 : "100%" }}>
                  <SafeChart height={360}>
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={drillDownReasonData} margin={{ top: 26, right: 16, left: 12, bottom: 36 }}>
                        <CartesianGrid {...RECHARTS_GRID} />
                        <XAxis dataKey="reason" interval={0} {...RECHARTS_AXIS} height={44}
                          tickFormatter={(val) => truncate(val, 16)}
                          label={{ value: "Defect reason", position: "insideBottom", offset: -20, style: AXIS_LABEL_STYLE }} />
                        <YAxis {...RECHARTS_AXIS} axisLine={false} width={56} allowDecimals={false}
                          domain={[0, (max) => Math.ceil((max || 10) * 1.15)]}
                          label={{ value: "NG parts", angle: -90, position: "insideLeft", offset: 0, style: AXIS_LABEL_STYLE }} />
                        <Tooltip
                          cursor={RECHARTS_TOOLTIP.cursor}
                          content={({ payload }) => {
                            const d = payload?.[0]?.payload;
                            if (!d) return null;
                            return (
                              <TipCard
                                title={d.reason}
                                subtitle={`${drillDownGate} › ${catLabel(drillDownCategory)}`}
                                rows={[
                                  { label: "NG parts", value: fmtInt(d.count), color: reasonColor(d.reason) },
                                  { label: "Share of category NG", value: fmtPct(d.percentage) },
                                ]}
                                note="Click to show this reason on the defect map"
                              />
                            );
                          }}
                        />
                        <Bar dataKey="count" name="NG parts" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={56} onClick={handleReasonBarClick}>
                          {drillDownReasonData.map((d) => (
                            <Cell key={d.reason} fill={reasonColor(d.reason)} />
                          ))}
                          <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 600, fill: INK.secondary }}
                            formatter={(v) => (v > 0 ? fmtInt(v) : "")} />
                        </Bar>
                      </BarChart>
                    )}
                  </SafeChart>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="ra-note">
          Scrap rate = NG ÷ parts inspected at that station (OK + NG). Stations are rated Pass ≤ 2.5%, Watch 2.5–5%, Alert &gt; 5%.
        </div>
      </div>

      {/* daily final OK vs NG with drill-down (month → day → OK by shift / NG detail) */}
      {dailyCards.outputCard}

      {/* daily NG by defect category (CR / CRAM / MR) */}
      {dailyCards.categoryCard}

      {/* ─── PARETO ──────────────────────────────────────────────────────── */}
      <div className="ra-card" data-accent style={accent(ACCENT.ng)}>
        <div className="ra-card-head">
          <div style={{ minWidth: 0, flex: "1 1 260px", paddingLeft: 42, position: "relative" }}>
            <span className="ra-icon" aria-hidden="true" style={{ position: "absolute", left: 0, top: 0 }}><BarChart3 size={16} /></span>
            <h3 className="ra-card-title" style={{ display: "flex", alignItems: "center" }}>Top rejection {paretoView === "reason" ? "reasons" : paretoView === "category" ? "categories" : "zones"} (Pareto)<InfoTip info={INFO.pareto} /></h3>
            <p className="ra-card-sub">
              {paretoChartMode === "pareto"
                ? `Bars = share of all NG parts · line = cumulative share · dark red = first 80% of NG, light red = the rest · click a bar for its stations`
                : `Share of all NG parts by ${paretoNoun} · click a slice or row to map it on the casting`}
            </p>
          </div>
          <div className="rej-header-actions">
            <div className="rej-tab-group">
              {[{ key: "reason", label: "By reason" }, { key: "category", label: "By category" }, { key: "zone", label: "By zone" }].map((tab) => (
                <button
                  key={tab.key}
                  className={`rej-tab-pill ${paretoView === tab.key ? "active" : ""}`}
                  onClick={() => setParetoView(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="rej-tab-group">
              <button
                className={`rej-tab-pill ${paretoChartMode === "pareto" ? "active" : ""}`}
                onClick={() => setParetoChartMode("pareto")}
                title="Pareto: bars and cumulative line"
                aria-label="Pareto chart"
              >
                <BarChart3 size={16} />
              </button>
              <button
                className={`rej-tab-pill ${paretoChartMode === "pie" ? "active" : ""}`}
                onClick={() => setParetoChartMode("pie")}
                title="Donut: share of NG"
                aria-label="Donut chart"
              >
                <PieIcon size={16} />
              </button>
            </div>
            <button
              onClick={() => {
                setIsStudioVisible((prev) => !prev);
                if (!isStudioVisible) {
                  setTimeout(() => studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
                }
              }}
              className={`rej-icon-btn ${isStudioVisible ? "active" : ""}`}
              title={isStudioVisible ? "Hide defect map" : "Show defect map"}
            >
              <Target size={15} />
            </button>
          </div>
        </div>

        {paretoList.length === 0 ? (
          <div className="ra-card-body"><Empty height={260}>No rejects with a recorded {paretoNoun} in the selected period.</Empty></div>
        ) : paretoChartMode === "pie" ? (
          <div className="ra-card-body qg-split" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "center" }}>
            {(() => {
              const top = paretoList.slice(0, 8);
              const rest = paretoList.slice(8);
              const restCount = rest.reduce((s, d) => s + num(d.count), 0);
              const chartData = restCount > 0
                ? [...top, { [paretoKey]: `Other (${rest.length})`, count: restCount, isOther: true, percentage: Number((pctOf(restCount, paretoTotal) ?? 0).toFixed(1)) }]
                : top;
              const colorFor = (d) => (d.isOther ? OTHER : paretoItemColor(d[paretoKey]));
              return (
                <>
                  <div style={{ height: 320, position: "relative" }}>
                    <SafeChart height={320}>
                      {({ width, height }) => (
                        <PieChart width={width} height={height}>
                          <Tooltip
                            content={({ payload }) => {
                              const d = payload?.[0]?.payload;
                              if (!d) return null;
                              return (
                                <TipCard
                                  title={paretoItemLabel(d[paretoKey])}
                                  rows={[
                                    { label: "NG parts", value: fmtInt(d.count), color: colorFor(d) },
                                    { label: "Share of all NG", value: fmtPct(pctOf(num(d.count), paretoTotal)) },
                                    !d.isOther && { label: "Cumulative share", value: fmtPct(d.cumulativePercentage) },
                                  ]}
                                  note={d.isOther ? "Smaller items grouped together" : "Click to show on the defect map"}
                                />
                              );
                            }}
                          />
                          <Pie
                            data={chartData}
                            dataKey="count"
                            nameKey={paretoKey}
                            cx="50%" cy="50%" innerRadius={74} outerRadius={120} paddingAngle={1.5}
                            cursor="pointer"
                            onClick={(entry) => {
                              const d = entry?.payload || entry;
                              if (d && !d.isOther) focusParetoItem(d);
                            }}
                          >
                            {chartData.map((entry) => {
                              const isSelected = !entry.isOther && activeParetoKey && entry[paretoKey] === activeParetoKey;
                              return (
                                <Cell key={entry[paretoKey]} fill={colorFor(entry)}
                                  stroke={isSelected ? INK.primary : "#ffffff"} strokeWidth={isSelected ? 3 : 2} />
                              );
                            })}
                          </Pie>
                        </PieChart>
                      )}
                    </SafeChart>
                    <div className="qg-donut-center">
                      <div className="l">NG parts</div>
                      <div className="v">{fmtInt(paretoTotal)}</div>
                      <div className="s">{paretoList.length} {paretoNoun === "category" ? (paretoList.length === 1 ? "category" : "categories") : `${paretoNoun}s`}</div>
                    </div>
                  </div>

                  <div className="qg-list" style={{ maxHeight: 320, overflowY: "auto", paddingRight: 4, marginTop: 0 }}>
                    {paretoList.slice(0, 12).map((item, idx) => {
                      const val = item[paretoKey];
                      const isSelected = val === activeParetoKey;
                      return (
                        <div
                          key={val}
                          className="qg-list-row"
                          role="button"
                          tabIndex={0}
                          onClick={() => focusParetoItem(item)}
                          onKeyDown={(e) => { if (e.key === "Enter") focusParetoItem(item); }}
                          style={{ cursor: "pointer", borderColor: isSelected ? INK.primary : undefined, background: isSelected ? INK.surface : undefined }}
                        >
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span className="qg-swatch" style={{ background: idx < 8 ? paretoItemColor(val) : OTHER }} />
                            <b>{paretoItemLabel(val)}</b>
                          </span>
                          <span className="num">
                            <b>{fmtInt(item.count)}</b> · {fmtPct(item.percentage)} <span style={{ color: INK.muted }}>(cum. {fmtPct(item.cumulativePercentage)})</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
        ) : paretoStationSplit ? (
          <div className="ra-card-body">
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, margin: "0 4px 10px", fontSize: 12, color: INK.muted }}>
              <button type="button" className="rej-tab-pill" onClick={() => setParetoDrill(null)}>← Back to Pareto</button>
              <span>All {paretoNoun === "category" ? "categories" : `${paretoNoun}s`}</span>
              <ChevronRight size={12} />
              <b style={{ color: INK.primary }}>{paretoItemLabel(paretoStationSplit.key)}</b>
              <span>· {fmtInt(paretoStationSplit.total)} NG parts · rejected at {paretoStationSplit.rows.length} station{paretoStationSplit.rows.length === 1 ? "" : "s"}</span>
              <button type="button" className="rej-tab-pill" style={{ marginLeft: "auto" }}
                onClick={() => { const it = paretoList.find((x) => x[paretoKey] === paretoStationSplit.key); if (it) focusParetoItem(it); }}>
                <Target size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Show on defect map
              </button>
            </div>
            {!paretoStationSplit.rows.length ? (
              <Empty height={240}>No NG records with a recorded station for this {paretoNoun}.</Empty>
            ) : (
              <div style={{ height: 340 }}>
                <SafeChart height={340}>
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={paretoStationSplit.rows} margin={{ top: 30, right: 16, left: 12, bottom: 28 }} barCategoryGap="28%">
                      <CartesianGrid {...RECHARTS_GRID} />
                      <XAxis dataKey="label" interval={0} {...RECHARTS_AXIS} height={40}
                        label={{ value: "Station that rejected the part", position: "insideBottom", offset: -16, style: AXIS_LABEL_STYLE }} />
                      <YAxis {...RECHARTS_AXIS} axisLine={false} width={56} allowDecimals={false} domain={[0, (max) => Math.ceil((max || 5) * 1.18)]}
                        label={{ value: "NG parts", angle: -90, position: "insideLeft", offset: 0, style: AXIS_LABEL_STYLE }} />
                      <Tooltip cursor={RECHARTS_TOOLTIP.cursor} content={({ payload }) => {
                        const d = payload?.[0]?.payload;
                        if (!d) return null;
                        return (
                          <TipCard title={d.label} subtitle={paretoItemLabel(paretoStationSplit.key)}
                            rows={[
                              { label: "NG parts", value: fmtInt(d.count), color: stationColor(d.code) },
                              { label: `Share of this ${paretoNoun}`, value: fmtPct(d.pct) },
                            ]} />
                        );
                      }} />
                      <Bar dataKey="count" name="NG parts" radius={[4, 4, 0, 0]} maxBarSize={64}>
                        {paretoStationSplit.rows.map((d) => <Cell key={d.code} fill={stationColor(d.code)} />)}
                        <LabelList dataKey="count" content={({ x, y, width: w, index }) => {
                          const d = paretoStationSplit.rows[index];
                          if (!d) return null;
                          return (
                            <g style={{ fontVariantNumeric: "tabular-nums" }}>
                              <text x={x + w / 2} y={y - 18} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={INK.primary}>{fmtInt(d.count)}</text>
                              <text x={x + w / 2} y={y - 5} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={INK.muted}>{fmtPct(d.pct)}</text>
                            </g>
                          );
                        }} />
                      </Bar>
                    </BarChart>
                  )}
                </SafeChart>
              </div>
            )}
          </div>
        ) : (
          <div className="ra-card-body">
            <div className="ra-legend" style={{ padding: "0 4px 6px" }}>
              <span><i style={{ background: OUTCOME.ng }} />Share of NG — within first 80%</span>
              <span><i style={{ background: "#f87171" }} />Share of NG — remaining</span>
              <span><i style={{ background: INK.primary, height: 2, verticalAlign: 3 }} />Cumulative share</span>
              <span><i style={{ background: "transparent", borderTop: `2px dashed ${INK.muted}`, height: 0, verticalAlign: 3 }} />80% line</span>
            </div>
            <div className="rej-chart-scroll-wrapper">
              <div style={{ height: 370, minWidth: paretoChartData.length > 8 ? paretoChartData.length * 96 : "100%" }}>
                <SafeChart height={370}>
                  {({ width, height }) => (
                    <ComposedChart
                      width={width}
                      height={height}
                      data={paretoChartData}
                      margin={{ top: 20, right: 20, left: 12, bottom: 40 }}
                      onClick={(state) => {
                        const d = state?.activePayload?.[0]?.payload;
                        if (d) setParetoDrill({ view: paretoView, key: d[paretoKey] });
                      }}
                    >
                      <CartesianGrid {...RECHARTS_GRID} />
                      <XAxis dataKey={paretoKey} interval={0} {...RECHARTS_AXIS} height={48}
                        tickFormatter={(val) => truncate(val, 16)}
                        label={{ value: paretoView === "reason" ? "Defect reason" : paretoView === "category" ? "Defect category" : "Zone on casting", position: "insideBottom", offset: -22, style: AXIS_LABEL_STYLE }} />
                      <YAxis {...RECHARTS_AXIS} axisLine={false} width={56} domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]}
                        tickFormatter={(v) => `${v}%`}
                        label={{ value: "Share of NG parts (%)", angle: -90, position: "insideLeft", offset: 0, style: { ...AXIS_LABEL_STYLE, textAnchor: "middle" } }} />
                      <Tooltip
                        cursor={RECHARTS_TOOLTIP.cursor}
                        content={({ payload }) => {
                          const d = payload?.[0]?.payload;
                          if (!d) return null;
                          return (
                            <TipCard
                              title={paretoItemLabel(d[paretoKey])}
                              subtitle={d.vital ? "Within the first 80% of NG" : "Outside the first 80% of NG"}
                              rows={[
                                { label: "NG parts", value: fmtInt(d.count), color: d.vital ? OUTCOME.ng : "#f87171" },
                                { label: "Share of all NG", value: fmtPct(d.pct) },
                                { label: "Cumulative share", value: fmtPct(d.cum), color: INK.primary },
                                { label: "All NG parts", value: fmtInt(paretoTotal), strong: false },
                              ]}
                              note="Click to see which stations rejected it"
                            />
                          );
                        }}
                      />
                      <ReferenceLine y={80} stroke={INK.muted} strokeDasharray="4 4"
                        label={{ value: "80%", position: "right", fill: INK.muted, fontSize: 10.5 }} />
                      <Bar dataKey="pct" name="Share of NG" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={52}
                        onClick={(entry) => { const d = entry?.payload || entry; if (d) setParetoDrill({ view: paretoView, key: d[paretoKey] }); }}>
                        {paretoChartData.map((entry) => {
                          const isSelected = activeParetoKey && entry[paretoKey] === activeParetoKey;
                          return (
                            <Cell
                              key={entry[paretoKey]}
                              fill={entry.vital ? OUTCOME.ng : "#f87171"}
                              stroke={isSelected ? INK.primary : "none"}
                              strokeWidth={isSelected ? 2 : 0}
                            />
                          );
                        })}
                        <LabelList dataKey="count" position="top" style={{ fontSize: 10.5, fontWeight: 600, fill: INK.secondary }}
                          formatter={(v) => (v > 0 ? fmtInt(v) : "")} />
                      </Bar>
                      <Line type="linear" dataKey="cum" name="Cumulative share" stroke={INK.primary} strokeWidth={2}
                        dot={{ r: 3, fill: INK.primary, strokeWidth: 0 }} activeDot={{ r: 5, stroke: "#ffffff", strokeWidth: 2, fill: INK.primary }}
                        isAnimationActive={false} />
                    </ComposedChart>
                  )}
                </SafeChart>
              </div>
            </div>
            {paretoList.length > paretoChartData.length && (
              <div style={{ fontSize: 11.5, color: INK.muted, padding: "2px 6px" }}>
                Showing the top {paretoChartData.length} of {paretoList.length}; shares are of all {fmtInt(paretoTotal)} NG parts · click a bar to see which stations rejected it.
              </div>
            )}
          </div>
        )}

        {/* Quick Focus Pills */}
        {(() => {
          const topItems = paretoList.slice(0, 10);
          if (!topItems.length) return null;
          return (
            <div className="rej-quick-focus-bar">
              <span className="rej-quick-focus-label">Show on defect map:</span>
              {topItems.map((item) => {
                const val = item[paretoKey];
                const isSelected = val === activeParetoKey;
                return (
                  <button
                    key={val}
                    onClick={() => focusParetoItem(item)}
                    className={`rej-quick-focus-pill ${isSelected ? "active" : ""}`}
                  >
                    <span className="qg-swatch" style={{ background: paretoItemColor(val), marginRight: 0 }} />
                    <span>{val}</span>
                    <span className="count-chip">{fmtInt(item.count)}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Unified Defect Localization Studio */}
        {isStudioVisible && (
          <div ref={studioRef} className={`rej-studio-container ${studioFullscreen ? "fullscreen" : ""}`}>
            <div className="rej-studio-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                <Eye size={17} color={INK.body} />
                <h4 className="rej-studio-title" style={{ margin: 0, minWidth: 0, fontSize: 14.5 }}>
                  Defect map:{" "}
                  <span style={{ color: activeStudioData.isGateActive ? CATEGORICAL[0] : OUTCOME.ng }}>{activeStudioData.title}</span>
                </h4>
                <span className="rej-studio-tag">
                  {activeStudioData.tag} · {fmtInt(activeStudioData.count)} NG parts ({fmtPct(activeStudioData.summary?.percentageOfAll)} of all NG)
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {(activeStudioData.isParetoActive || activeStudioData.isGateActive) && (
                  <button
                    onClick={() => {
                      setSelectedParetoItem(null);
                      setParetoSelectedView("all");
                      handleDrillDownReset();
                      setStudioActiveAngle("all");
                    }}
                    className="rej-icon-btn"
                    title="Clear defect filter & view overall shop scrap"
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
                <button
                  onClick={() => setStudioFullscreen((prev) => !prev)}
                  className="rej-icon-btn"
                  title={studioFullscreen ? "Exit Fullscreen" : "Fullscreen Viewport"}
                >
                  {studioFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
                <button onClick={() => setIsStudioVisible(false)} className="rej-icon-btn rej-icon-btn-close" title="Close">
                  <X size={15} />
                </button>
              </div>
            </div>

            <div className="rej-studio-angle-bar">
              <button
                onClick={() => setStudioActiveAngle("all")}
                className={`rej-studio-angle-tab ${studioActiveAngle === "all" ? "active" : ""}`}
              >
                <Grid size={13} /><span>Busiest view</span>
                <span className="count-pill primary">{activeStudioData.count}</span>
              </button>
              {(activeStudioData.viewData || []).map((v) => {
                const isSel = studioActiveAngle === v.name || studioActiveAngle === v.code;
                return (
                  <button
                    key={v.id || v.code}
                    onClick={() => setStudioActiveAngle(isSel ? "all" : v.name)}
                    className={`rej-studio-angle-tab ${isSel ? "active" : ""}`}
                  >
                    <Camera size={13} /><span>{v.name}</span>
                    <span className={`count-pill ${v.totalDefects > 0 ? "danger" : "muted"}`}>{v.totalDefects}</span>
                  </button>
                );
              })}
            </div>

            <div className="rej-studio-stage">
              <div className="rej-studio-viewport">
                <div className="rej-viewport-topbar">
                  <div className="rej-viewport-title">
                    <Camera size={14} color="#60a5fa" />
                    <span>{currentStudioView?.name || "Inspection Angle"}</span>
                    {(drillDownGate && (drillDownGate === "OP150" || String(drillDownGate).toLowerCase().startsWith("leak"))) ? (
                      <span className="rej-viewport-status-badge info">Pressure-decay sensor (no visual location)</span>
                    ) : currentStudioView?.totalDefects > 0 ? (
                      <span className="rej-viewport-status-badge danger">{fmtInt(currentStudioView.totalDefects)} NG located on this view</span>
                    ) : (
                      <span className="rej-viewport-status-badge ok">No NG located on this view</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>
                    View {Math.max(1, (activeStudioData.viewData || []).findIndex((v) => v.name === currentStudioView?.name) + 1)} of {activeStudioData.viewData?.length || 0}
                  </span>
                </div>

                <div className="rej-viewport-canvas" style={{ flexDirection: "column", gap: 10 }}>
                  {Boolean(drillDownGate && (drillDownGate === "OP150" || String(drillDownGate).toLowerCase().startsWith("leak"))) && (
                    <div className="rej-sensor-viewport-banner" style={{ position: "static" }}>
                      <Cpu size={14} color="#60a5fa" />
                      <span>Leak test — detected by pressure-decay sensor, no visual location</span>
                    </div>
                  )}
                  <div style={{ width: "100%", maxWidth: 760, margin: "0 auto" }}>
                    <CadStage imageUrl={currentStudioView?.imageUrl} alt={currentStudioView?.name} dark>
                      {Boolean(!drillDownGate || (!drillDownGate.startsWith("Leak") && drillDownGate !== "OP150")) &&
                        renderZoneHeat(currentStudioView?.zones || [])}
                    </CadStage>
                  </div>
                </div>

                <div className="rej-viewport-bottombar">
                  {((drillDownGate && (drillDownGate === "OP150" || drillDownGate.toLowerCase().startsWith("leak"))) ||
                    (activeGateReason && activeGateReason.toLowerCase().includes("leak"))) ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className="rej-badge rej-badge-warning" style={{ fontSize: 10.5, padding: "2px 8px", fontWeight: 600 }}>
                        Pressure-decay leak test (whole part)
                      </span>
                      <span style={{ fontSize: 11, color: INK.muted }}>
                        Sensor-based inspection · no surface zone to show
                      </span>
                    </div>
                  ) : (
                    <>
                      <span style={{ fontWeight: 600, color: INK.faint, fontSize: 11 }}>Zones with NG:</span>
                      {currentStudioView?.activeSubZonesList?.length > 0 ? (
                        <div className="rej-viewport-zone-tags">
                          {currentStudioView.activeSubZonesList.map((str, idx) => {
                            const cleanLabel = str.replace(/ZONE\s*[-_]?\w+\s*[›>]\s*(?:SUB\s*ZONE\s*)?/i, "");
                            return <span key={idx} className="rej-viewport-tag" title={str}>{cleanLabel}</span>;
                          })}
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: OUTCOME.ok, fontWeight: 600 }}>
                          No NG located on this view
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="rej-studio-intel-sidebar">
                <div className="rej-intel-card primary">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div className="rej-intel-card-label" style={{ marginBottom: 0 }}>
                      <Target size={14} color={INK.body} />
                      <span style={{ fontWeight: 700 }}>Selected defect</span>
                    </div>
                    <span className="rej-studio-tag" style={{ fontSize: 10, padding: "1px 7px" }}>
                      {fmtInt(activeStudioData.count)} parts ({fmtPct(activeStudioData.summary?.percentageOfAll)})
                    </span>
                  </div>
                  <div className="rej-intel-card-val text-blue-700" style={{ fontSize: 15, margin: "6px 0 4px 0" }}>
                    {activeStudioData.title}
                  </div>
                  <div className="rej-hotspot-line">
                    <MapPin size={13} color="#dc2626" style={{ flexShrink: 0 }} />
                    <span>
                      Most NG on: <strong style={{ color: OUTCOME.ng }}>{activeStudioData.summary?.primaryViewName || "—"}</strong>
                      {" › "}<strong>{activeStudioData.summary?.topHotspotSubZone || "—"}</strong>
                    </span>
                  </div>
                </div>

                <div className="rej-intel-card">
                  <div className="rej-intel-card-label">
                    <Gauge size={14} color={INK.body} />
                    <span>Average process readings of these NG parts</span>
                  </div>
                  <div className="rej-intel-param-grid">
                    <div className="rej-intel-param-box">
                      <span className="rej-param-box-lbl">Pressure</span>
                      <strong className="rej-param-box-val">{activeStudioData.summary?.avgPress ? `${activeStudioData.summary.avgPress} bar` : "—"}</strong>
                    </div>
                    <div className="rej-intel-param-box">
                      <span className="rej-param-box-lbl">Furnace</span>
                      <strong className="rej-param-box-val">{activeStudioData.summary?.avgTemp ? `${activeStudioData.summary.avgTemp} °C` : "—"}</strong>
                    </div>
                    <div className="rej-intel-param-box">
                      <span className="rej-param-box-lbl">Biscuit</span>
                      <strong className="rej-param-box-val">{activeStudioData.summary?.avgBiscuit ? `${activeStudioData.summary.avgBiscuit} mm` : "—"}</strong>
                    </div>
                    <div className="rej-intel-param-box">
                      <span className="rej-param-box-lbl">Cycle</span>
                      <strong className="rej-param-box-val">{activeStudioData.summary?.avgCycle ? `${activeStudioData.summary.avgCycle} s` : "—"}</strong>
                    </div>
                  </div>
                  <div className="rej-telemetry-note">
                    <div>
                      Most NG from: <strong>{activeStudioData.summary?.topMachine || "—"}</strong>
                      {" · "}averages over the NG parts that have a reading.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rej-context-log-card">
              <div className="rej-context-log-header">
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <FileSpreadsheet size={16} color={INK.body} />
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: INK.primary }}>
                      Rejected parts <span style={{ fontWeight: 400, color: INK.muted, fontSize: 12 }}>({fmtInt(filteredContextParts.length)})</span>
                    </span>
                  </div>
                  <div className="rej-context-viewmode-pills">
                    <button onClick={() => setContextLogViewMode("defect")}
                      className={`rej-context-mode-btn ${contextLogViewMode === "defect" ? "active" : ""}`}>
                      Defect &amp; station
                    </button>
                    <button onClick={() => setContextLogViewMode("telemetry")}
                      className={`rej-context-mode-btn ${contextLogViewMode === "telemetry" ? "active" : ""}`}>
                      Process readings
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div className="rej-context-search">
                    <Search size={13} color="#94a3b8" />
                    <input
                      type="text"
                      placeholder="Search serial, QR, machine, reason…"
                      value={contextLogSearch}
                      onChange={(e) => { setContextLogSearch(e.target.value); setContextLogPage(1); }}
                    />
                  </div>
                  <button onClick={exportContextPartsExcel} disabled={!filteredContextParts.length}
                    className="rej-icon-btn" title="Export filtered parts to Excel (.xlsx)">
                    <Download size={14} />
                  </button>
                  <button onClick={() => setIsContextLogExpanded((prev) => !prev)}
                    className="rej-icon-btn" title={isContextLogExpanded ? "Hide" : "Show"}>
                    {isContextLogExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>

              {isContextLogExpanded && (
                <>
                  <div className="rej-context-table-wrapper">
                    <table className="rej-context-table">
                      <thead>
                        <tr>
                          <th style={{ width: 45 }}>#</th>
                          <th style={{ minWidth: 160 }}>Part serial no.</th>
                          <th style={{ width: 85 }}>Shot no.</th>
                         
                          <th style={{ minWidth: 160 }}>Customer QR</th>
                          <th style={{ width: 75 }}>Result</th>
                          {contextLogViewMode === "defect" ? (
                            <>
                              <th style={{ minWidth: 100 }}>View</th>
                              <th style={{ width: 85 }}>Category</th>
                              <th style={{ minWidth: 130 }}>Defect reason</th>
                              <th style={{ minWidth: 90 }}>Zone</th>
                              <th style={{ minWidth: 90 }}>Sub-zone</th>
                              <th style={{ minWidth: 100 }}>Machine</th>
                              <th style={{ width: 60 }}>Shift</th>
                              <th style={{ minWidth: 130 }}>Recorded at</th>
                            </>
                          ) : (
                            <>
                              <th style={{ minWidth: 90 }}>Cycle time</th>
                              <th style={{ minWidth: 90 }}>Metal pressure</th>
                              <th style={{ minWidth: 90 }}>Furnace temp</th>
                              <th style={{ minWidth: 90 }}>Biscuit</th>
                              <th style={{ minWidth: 80 }}>V1 speed</th>
                              <th style={{ minWidth: 80 }}>V2 speed</th>
                              <th style={{ minWidth: 90 }}>Intensification</th>
                              <th style={{ minWidth: 130 }}>Recorded at</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredContextParts.length === 0 ? (
                          <tr>
                            <td colSpan={14} style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontStyle: "italic" }}>
                              {paretoDrillDownLoading ? "Loading parts..." : "No scrap records matching current filters."}
                            </td>
                          </tr>
                        ) : (
                          filteredContextParts
                            .slice((contextLogPage - 1) * contextLogPageSize, contextLogPage * contextLogPageSize)
                            .map((r, idx) => {
                              const pDefect = parseRowDefect(r);
                              const isNg = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"]
                                .includes(String(r.status || r.overall_status || "").trim().toUpperCase());
                              const rowIdx = (contextLogPage - 1) * contextLogPageSize + idx + 1;
                              const partSerial = r.partId || r.part_id || "";
                              const custQr = r.customerQrCode || r.customer_qr || "";
                              return (
                                <tr key={r.rowKey || r.id || idx}>
                                  <td style={{ color: "#94a3b8", fontSize: 11, textAlign: "center" }}>{rowIdx}</td>
                                  <td>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                      <span className="rej-mono-serial">{partSerial || "—"}</span>
                                      {partSerial && (
                                        <button
                                          onClick={() => copyToClipboard(partSerial, `part-${partSerial}-${idx}`)}
                                          className="rej-copy-btn" title="Copy Part Serial"
                                        >
                                          {copiedId === `part-${partSerial}-${idx}`
                                            ? <Check size={11} color="#16a34a" />
                                            : <Copy size={11} />}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ fontWeight: 600, color: INK.secondary, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                                    {r.shotNumber || r.shot_number || "—"}
                                  </td>
                                 
                                  <td>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }} title={custQr}>
                                      <span className="rej-mono-qr">
                                        {custQr ? (custQr.length > 25 ? `${custQr.slice(0, 24)}…` : custQr) : "—"}
                                      </span>
                                      {custQr && (
                                        <button
                                          onClick={() => copyToClipboard(custQr, `qr-${custQr}-${idx}`)}
                                          className="rej-copy-btn" title="Copy Customer QR"
                                        >
                                          {copiedId === `qr-${custQr}-${idx}`
                                            ? <Check size={11} color="#16a34a" />
                                            : <Copy size={11} />}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    <span className="qg-status" style={isNg
                                      ? { color: OUTCOME.ng, background: withAlpha(OUTCOME.ng, 0.1), borderColor: withAlpha(OUTCOME.ng, 0.4) }
                                      : { color: "#12805a", background: withAlpha(OUTCOME.ok, 0.1), borderColor: withAlpha(OUTCOME.ok, 0.4) }}>
                                      {isNg ? "NG" : "OK"}
                                    </span>
                                  </td>
                                  {contextLogViewMode === "defect" ? (
                                    <>
                                      <td style={{ fontWeight: 600, color: INK.secondary }}>{pDefect.view || "—"}</td>
                                      <td style={{ color: "#64748b" }}>{pDefect.category || "—"}</td>
                                      <td style={{ fontWeight: 600, color: INK.primary }}>
                                        {pDefect.reason && <span className="qg-swatch" style={{ background: reasonColor(canonicalizeReason(pDefect.reason)) }} />}
                                        {pDefect.reason || "—"}
                                      </td>
                                      <td style={{ color: "#334155" }}>{pDefect.zone || "—"}</td>
                                      <td style={{ color: "#334155" }}>{pDefect.subZone || "—"}</td>
                                      <td style={{ color: "#334155" }}>{r.machineName || r.machine_name || "—"}</td>
                                      <td style={{ color: "#334155" }}>{r.shiftCode || r.shift_code || "—"}</td>
                                      <td style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap" }}>
                                        {formatResultTimestamp(r.createdAt || r.final_scan_at || r.timestamp) || "—"}
                                      </td>
                                    </>
                                  ) : (
                                    <>
                                      <td>{fmtNum(r.cycleTime || r.cycle_time || r.plc_cycle_time) ? `${fmtNum(r.cycleTime || r.cycle_time || r.plc_cycle_time)} s` : "—"}</td>
                                      <td>{fmtNum(r.metalPressure || r.metal_pressure) ? `${fmtNum(r.metalPressure || r.metal_pressure)} bar` : "—"}</td>
                                      <td>{fmtNum(r.metalTemp || r.furnace_metal_temp) ? `${fmtNum(r.metalTemp || r.furnace_metal_temp)} °C` : "—"}</td>
                                      <td>{fmtNum(r.biscuitThickness || r.biscuit_thickness) ? `${fmtNum(r.biscuitThickness || r.biscuit_thickness)} mm` : "—"}</td>
                                      <td>{fmtNum(r.v1Speed || r.v1_speed) ? `${fmtNum(r.v1Speed || r.v1_speed)} m/s` : "—"}</td>
                                      <td>{fmtNum(r.v2Speed || r.v2_speed) ? `${fmtNum(r.v2Speed || r.v2_speed)} m/s` : "—"}</td>
                                      <td>{fmtNum(r.intensificationTime || r.intensification_time) ? `${fmtNum(r.intensificationTime || r.intensification_time)} ms` : "—"}</td>
                                      <td style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap" }}>
                                        {formatResultTimestamp(r.createdAt || r.final_scan_at || r.timestamp) || "—"}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {filteredContextParts.length > 0 && (
                    <div className="rej-context-pagination">
                      <div style={{ fontSize: 11, color: "#64748b" }}>
                        Showing {Math.min((contextLogPage - 1) * contextLogPageSize + 1, filteredContextParts.length)} to{" "}
                        {Math.min(contextLogPage * contextLogPageSize, filteredContextParts.length)} of{" "}
                        {filteredContextParts.length.toLocaleString()}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#475569" }}>
                          <span>Rows:</span>
                          <select
                            value={contextLogPageSize}
                            onChange={(e) => { setContextLogPageSize(Number(e.target.value)); setContextLogPage(1); }}
                            style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 11 }}
                          >
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                          </select>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button
                            disabled={contextLogPage <= 1}
                            onClick={() => setContextLogPage((p) => Math.max(1, p - 1))}
                            className="rej-page-arrow-btn"
                          >‹</button>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "0 6px", color: INK.secondary, fontVariantNumeric: "tabular-nums" }}>
                            {contextLogPage}/{Math.ceil(filteredContextParts.length / contextLogPageSize) || 1}
                          </span>
                          <button
                            disabled={contextLogPage >= Math.ceil(filteredContextParts.length / contextLogPageSize)}
                            onClick={() => setContextLogPage((p) => p + 1)}
                            className="rej-page-arrow-btn"
                          >›</button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── STATION × DEFECT MATRIX ─────────────────────────────────────── */}
      <div className="ra-card" data-accent style={accent(ACCENT.location)}>
        <CardHead
          icon={Grid3x3}
          title="Where each defect is caught: station × defect"
          info={INFO.matrix}
          sub="NG parts by defect reason (top 10, rest folded) and the station that rejected them · darker = more · totals in grey"
        />
        <div className="ra-card-body">
          {!matrixOption ? (
            <Empty height={260}>No NG records with a recorded station for the selected period.</Empty>
          ) : (
            <div className="qg-scroll">
              <div style={{ minWidth: 196 + (defectMatrix.stations.length + 1) * 74 }}>
                <EChart option={matrixOption} style={{ height: (defectMatrix.rows.length + 1) * 32 + 50, minHeight: 220 }} />
              </div>
            </div>
          )}
        </div>
        {/* <div className="ra-note">
          Cell = NG parts with that reason rejected at that station (one record = one part) · row total = all stations for the reason ·
          column total = all reasons at the station · colour: sequential scrap ramp, square-root scaled to the largest cell.
          Reasons are normalised (e.g. spelling variants merged) the same way as the Pareto.
        </div> */}
      </div>

      {/* ─── SHIFT-WISE OUTPUT ───────────────────────────────────────────── */}
      <div className="ra-card" data-accent style={accent(ACCENT.process)}>
        <CardHead
          icon={Users}
          title="Shift-wise output"
          info={INFO.shiftOutput}
          sub="Parts produced per shift, split into final OK, NG and still in process · OK % and NG % are of completed parts (OK + NG)"
        />
        <div className="ra-card-body">
          {shiftRows.length === 0 ? (
            <Empty height={220}>No shift data for the selected period.</Empty>
          ) : (
            <>
              <div className="ra-legend" style={{ padding: "0 4px 6px" }}>
                <span><i style={{ background: OUTCOME.ok }} />OK (final pass)</span>
                <span><i style={{ background: OUTCOME.ng }} />NG (rejected)</span>
                <span><i style={{ background: OUTCOME.wip }} />In process</span>
              </div>
              <div style={{ height: Math.max(170, shiftRows.length * 58 + 60) }}>
                <SafeChart height={Math.max(170, shiftRows.length * 58 + 60)}>
                  {({ width, height }) => {
                    const segLabel = (fill) => (props) => {
                      const { x, y, width: w, height: h, value } = props;
                      if (!(value > 0) || w < 34) return null;
                      return (
                        <text x={x + w / 2} y={y + h / 2} dy={4} textAnchor="middle" fontSize={11} fontWeight={600}
                          fill={fill} style={{ fontVariantNumeric: "tabular-nums" }}>
                          {fmtInt(value)}
                        </text>
                      );
                    };
                    return (
                      <BarChart width={width} height={height} data={shiftRows} layout="vertical" barCategoryGap="28%"
                        margin={{ top: 4, right: 70, left: 8, bottom: 26 }}>
                        <CartesianGrid stroke={INK.grid} horizontal={false} />
                        <XAxis type="number" {...RECHARTS_AXIS} tickFormatter={(v) => fmtInt(v)} allowDecimals={false}
                          label={{ value: "Parts produced", position: "insideBottom", offset: -14, style: AXIS_LABEL_STYLE }} />
                        <YAxis type="category" dataKey="label" {...RECHARTS_AXIS} width={84} />
                        <Tooltip
                          cursor={RECHARTS_TOOLTIP.cursor}
                          content={({ payload }) => {
                            const d = payload?.[0]?.payload;
                            if (!d) return null;
                            return (
                              <TipCard
                                title={d.label}
                                subtitle={d.key === "Unassigned" ? "Parts with no shift recorded" : `${fmtInt(d.total)} parts produced`}
                                rows={[
                                  { label: "Produced", value: fmtInt(d.total) },
                                  { label: "OK", value: fmtInt(d.ok), color: OUTCOME.ok },
                                  { label: "NG", value: fmtInt(d.ng), color: OUTCOME.ng },
                                  { label: "In process", value: fmtInt(d.wip), color: OUTCOME.wip },
                                  { label: "OK % (of completed)", value: fmtPct(d.okPct) },
                                  { label: "NG % (of completed)", value: fmtPct(d.ngPct) },
                                  { label: "Share of plant OK", value: fmtPct(pctOf(d.ok, shiftTotals.ok)) },
                                  { label: "Share of plant NG", value: fmtPct(pctOf(d.ng, shiftTotals.ng)) },
                                ]}
                                note="Completed = OK + NG; in-process parts are excluded from OK % and NG %."
                              />
                            );
                          }}
                        />
                        <Bar dataKey="ok" name="OK" stackId="s" fill={OUTCOME.ok} label={segLabel("#ffffff")} />
                        <Bar dataKey="ng" name="NG" stackId="s" fill={OUTCOME.ng} label={segLabel("#ffffff")} />
                        <Bar dataKey="wip" name="In process" stackId="s" fill={OUTCOME.wip} radius={[0, 4, 4, 0]} label={segLabel(INK.primary)}>
                          <LabelList dataKey="total" position="right" style={{ fontSize: 11, fontWeight: 600, fill: INK.secondary }}
                            formatter={(v) => fmtInt(v)} />
                        </Bar>
                      </BarChart>
                    );
                  }}
                </SafeChart>
              </div>
              <div className="qg-table-wrap">
                <table className="qg-table">
                  <thead>
                    <tr>
                      <th>Shift</th><th>Produced</th><th>OK</th><th>NG</th><th>In process</th><th>OK %</th><th>NG %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftRows.map((r) => (
                      <tr key={r.key}>
                        <td><span className="qg-swatch" style={{ background: r.color }} />{r.label}</td>
                        <td>{fmtInt(r.total)}</td>
                        <td style={{ color: OUTCOME.ok }}>{fmtInt(r.ok)}</td>
                        <td style={{ color: OUTCOME.ng }}>{fmtInt(r.ng)}</td>
                        <td>{fmtInt(r.wip)}</td>
                        <td>{fmtPct(r.okPct)}</td>
                        <td>{fmtPct(r.ngPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>All shifts</td>
                      <td>{fmtInt(shiftTotals.total)}</td>
                      <td>{fmtInt(shiftTotals.ok)}</td>
                      <td>{fmtInt(shiftTotals.ng)}</td>
                      <td>{fmtInt(shiftTotals.wip)}</td>
                      <td>{fmtPct(shiftTotals.okPct)}</td>
                      <td>{fmtPct(shiftTotals.ngPct)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
        {/* <div className="ra-note">
          OK % = OK ÷ (OK + NG) and NG % = NG ÷ (OK + NG) — first-pass yield of completed parts. &ldquo;Unassigned&rdquo; = parts with no shift recorded.
        </div> */}
      </div>

    </div>
  );
}
