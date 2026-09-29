// ============================================================
//  Dashboard.jsx — IndusTrace Premium Redesign
//  Color Theme: Navy / Steel / Amber / Linen
//  Clean professional language — no jargon
//  Supports: Dark + Light via [data-theme] on <html>
// ============================================================
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { io } from "socket.io-client";
import { SOCKET_OPTIONS, SOCKET_URL } from "../constants/network";
import {
  RefreshCw,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Cpu,
  Activity,
  History,
  Clock,
  BellRing,
  X,
  Shield,
  Zap,
  Target,
  Layers,
  TrendingUp,
  BarChart3,
  Settings2,
  ChevronDown,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Circle,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
  AreaChart,
  Area,
  ComposedChart,
  ResponsiveContainer,
} from "recharts";
import {
  dashboardApi,
  machineApi,
  rejectionConfigApi,
  reportApi,
  shiftApi,
} from "../api/services";
import ChartTooltip from "../components/charts/ChartTooltip";
import SafeChart from "../components/charts/SafeChart";
import { CHART_COLORS } from "../constants/chartTheme";
import { useLanguage } from "../context/LanguageContext";

// —— Design tokens —————————————————————————————————————————————————————————————
const DS = `
  @keyframes dbSpin    { to { transform:rotate(360deg) } }
  @keyframes dbFadeIn  { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes dbPulse   { 0%,100%{opacity:1} 50%{opacity:.45} }
  @keyframes dbPing    { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(2.2);opacity:0} }
  @keyframes dbShimmer { 100% { transform: translateX(100%); } }
  :root{
    --db-navy:  26,50,99;
    --db-steel: 84,119,146;
    --db-amber: 250,185,91;
    --db-linen: 232,226,219;
    --db-ok:    34,197,94;
    --db-ng:    239,68,68;
    --db-wip:   249,115,22;
    --db-idle:  148,163,184;
    --font-db:  "Inter", "Sora", "Outfit", system-ui, sans-serif;
  }
  .db-font { font-family: var(--font-db); }
  [data-theme="light"]{
    --db-bg-base:    248,246,243;
    --db-bg-card:    255,255,255;
    --db-bg-surf:    240,236,230;
    --db-bg-input:   255,255,255;
    --db-txt-pri:    26,50,99;
    --db-txt-sec:    84,119,146;
    --db-txt-muted:  140,160,180;
    --db-bdr:        84,119,146;
    --db-bop:        0.14;
  }
  [data-theme="dark"]{
    --db-bg-base:    10,18,36;
    --db-bg-card:    20,34,62;
    --db-bg-surf:    16,26,50;
    --db-bg-input:   14,22,44;
    --db-txt-pri:    232,226,219;
    --db-txt-sec:    120,160,190;
    --db-txt-muted:  84,119,146;
    --db-bdr:        84,119,146;
    --db-bop:        0.18;
  }
  .db-filter-input {
    width: 100%;
    height: 36px;
    min-width: 0;
    border-radius: 8px;
    border: 1px solid rgba(var(--db-bdr), 0.2);
    background: rgb(var(--db-bg-input));
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--db-txt-pri));
    outline: none;
    transition: all 0.15s ease;
  }
  .db-filter-input:focus {
    border-color: rgba(var(--db-steel), 0.5);
    box-shadow: 0 0 0 3px rgba(var(--db-steel), 0.08);
  }
  .db-filter-input::placeholder {
    color: rgba(var(--db-txt-muted), 0.6);
    font-weight: 400;
  }
  .db-date-picker-container {
    position: relative;
  }
  .db-date-picker-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    background: rgb(var(--db-bg-card));
    border: 1px solid rgba(var(--db-bdr), 0.2);
    border-radius: 12px;
    box-shadow: 0 12px 48px rgba(var(--db-navy), 0.15), 0 2px 8px rgba(var(--db-navy), 0.06);
    padding: 16px;
    z-index: 5000;
    min-width: 280px;
    max-width: 340px;
    animation: dbFadeIn 0.2s ease;
  }
  .db-date-picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .db-date-picker-header button {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid rgba(var(--db-bdr), 0.1);
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgb(var(--db-txt-sec));
    transition: all 0.15s ease;
  }
  .db-date-picker-header button:hover {
    background: rgba(var(--db-steel), 0.08);
    border-color: rgba(var(--db-steel), 0.2);
  }
  .db-date-picker-header span {
    font-size: 13px;
    font-weight: 700;
    color: rgb(var(--db-txt-pri));
  }
  .db-date-picker-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 3px;
  }
  .db-date-picker-weekday {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(var(--db-txt-muted), 0.7);
    padding: 4px 0;
    text-align: center;
  }
  .db-date-picker-day {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--db-txt-pri));
    cursor: pointer;
    transition: all 0.12s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .db-date-picker-day:hover { background: rgba(var(--db-steel), 0.08); }
  .db-date-picker-day.today { border: 2px solid rgba(var(--db-amber), 0.4); }
  .db-date-picker-day.range-start,
  .db-date-picker-day.range-end,
  .db-date-picker-day.selected {
    background: linear-gradient(135deg, rgb(var(--db-navy)), rgb(var(--db-steel)));
    color: rgb(var(--db-linen));
    box-shadow: 0 2px 8px rgba(var(--db-navy), 0.25);
  }
  .db-date-picker-day.range-start {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .db-date-picker-day.range-end {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .db-date-picker-day.range-middle {
    background: rgba(var(--db-steel), 0.12);
    border-radius: 0;
  }
  .db-date-picker-footer {
    display: flex;
    gap: 6px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(var(--db-bdr), 0.08);
  }
  .db-date-picker-footer button {
    flex: 1;
    height: 30px;
    border-radius: 6px;
    border: none;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .db-date-picker-footer .clear-btn {
    background: rgba(var(--db-ng), 0.06);
    color: rgb(var(--db-ng));
    border: 1px solid rgba(var(--db-ng), 0.1);
  }
  .db-date-picker-footer .apply-btn {
    background: linear-gradient(135deg, rgb(var(--db-navy)), rgb(var(--db-steel)));
    color: rgb(var(--db-linen));
  }
  .db-filter-preset {
    height: 36px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid rgba(var(--db-bdr), 0.14);
    background: rgba(var(--db-steel), 0.05);
    color: rgb(var(--db-txt-sec));
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .db-filter-preset:hover,
  .db-filter-preset.active {
    border-color: rgba(var(--db-navy), 0.35);
    background: rgba(var(--db-navy), 0.08);
    color: rgb(var(--db-navy));
  }
  @media (max-width: 1200px){
    .db-tablet-grid-2 { grid-template-columns: 1fr !important; }
    .db-tablet-cards { grid-template-columns: repeat(auto-fill,minmax(300px,1fr)) !important; }
    .db-tablet-oeeoa { grid-template-columns: repeat(auto-fill,minmax(320px,1fr)) !important; }
    .db-tablet-pad { padding: 16px !important; }
    .db-tablet-chart-compact { height: 190px !important; }
  }
  @media (max-width: 900px){
    .db-tablet-cards { grid-template-columns: 1fr !important; }
    .db-tablet-oeeoa { grid-template-columns: 1fr !important; }
  }
`;

let _dsInjected = false;
function injectDS() {
  if (_dsInjected || typeof document === "undefined") return;
  _dsInjected = true;
  const el = document.createElement("style");
  el.textContent = DS;
  document.head.appendChild(el);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme", "dark");
}

// —— Color helpers —————————————————————————————————————————————————————————————
const C = {
  navy: (o = 1) => `rgba(var(--db-navy),${o})`,
  steel: (o = 1) => `rgba(var(--db-steel),${o})`,
  amber: (o = 1) => `rgba(var(--db-amber),${o})`,
  linen: (o = 1) => `rgba(var(--db-linen),${o})`,
  ok: (o = 1) => `rgba(var(--db-ok),${o})`,
  ng: (o = 1) => `rgba(var(--db-ng),${o})`,
  wip: (o = 1) => `rgba(var(--db-wip),${o})`,
  idle: (o = 1) => `rgba(var(--db-idle),${o})`,
  bg: (v = "card") => `rgb(var(--db-bg-${v}))`,
  txt: (v = "pri") => `rgb(var(--db-txt-${v}))`,
  bdr: (o) => `rgba(var(--db-bdr),${o || "var(--db-bop)"})`,
};

const SHADOW = `0 2px 12px rgba(var(--db-navy),.08),0 1px 3px rgba(var(--db-navy),.05)`;
const SHADOW_MD = `0 4px 20px rgba(var(--db-navy),.12),0 2px 6px rgba(var(--db-navy),.06)`;

function normalizeRejectionType(reason = "") {
  const r = String(reason || "")
    .trim()
    .toUpperCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!r) return "MR - Machining Rejection";

  if (r.includes("LEAK") || r.includes("OP150")) {
    return "LT - Leak Test Rejection";
  }

  if (
    r.includes("DUPLICATE") ||
    r.includes("FORMAT") ||
    r.includes("QR") ||
    r.includes("SCAN") ||
    r.includes("ALREADY COMPLETED") ||
    r.includes("VALIDATION") ||
    r.includes("MANUAL REJECT")
  ) {
    return "MR - Machining Rejection";
  }

  if (
    r.includes("CRAM") ||
    r.includes("CHAMFER") ||
    r.includes("ROUGHNESS") ||
    r.includes("PROFILE") ||
    r.includes("POSITION") ||
    r.includes("DIMENSION") ||
    r.includes("DIA") ||
    r.includes("DIAMETER") ||
    r.includes("HEIGHT") ||
    r.includes("WIDTH") ||
    r.includes("LENGTH") ||
    r.includes("RUNOUT") ||
    r.includes("CONCENTRICITY")
  ) {
    return "CRAM - Cram Defects";
  }

  if (
    r.includes(" CAST") ||
    r.startsWith("CAST") ||
    r.includes("POROSITY") ||
    r.includes("BLOW HOLE") ||
    r.includes("LEAK") ||
    r.includes("SHRINKAGE") ||
    r.includes("CRACK") ||
    r.includes("FLASH") ||
    r.includes("BURR") ||
    r.includes("COLD SHUT") ||
    r.includes("PIN HOLE") ||
    r.includes("SAND")
  ) {
    return "CR - Casting Defects";
  }

  if (/(^|\s)CR(\s|$)/.test(r)) return "CR - Casting Defects";
  return "MR - Machining Rejection";
}

function rejectionCategoryCode(value = "") {
  const normalized = normalizeRejectionType(value);
  if (normalized.startsWith("CRAM")) return "CRAM";
  if (normalized.startsWith("CR -")) return "CR";
  return "MR";
}

function rejectionCategoryLabel(value = "") {
  const code = rejectionCategoryCode(value);
  if (code === "CR") return "CR - Casting Rejection";
  if (code === "CRAM") return "CRAM - Cram Rejection";
  return "MR - Machining Rejection";
}

function localDateTimeToIso(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function getCurrentDashboardProductionRange(anchor = new Date()) {
  const start = new Date(anchor);
  start.setHours(6, 0, 0, 0);
  if (anchor < start) start.setDate(start.getDate() - 1);
  const end = new Date(anchor);
  return { start: start.toISOString(), end: end.toISOString() };
}

function uniqueStages(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const token = String(row || "").trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function normalizeAnalysisToken(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/^ZONE[\s_-]*/, "")
    .replace(/\s+/g, " ");
}

function isPlcCommonError(value = "") {
  const r = String(value || "").trim().toUpperCase();
  if (!r) return false;
  return (
    r.includes("PLC_COMM") ||
    r.includes("COMM_ERROR") ||
    r.includes("PLC_COMMUNICATION") ||
    r.includes("PLC_TIMEOUT") ||
    r.includes("TIMEOUT") ||
    r.includes("RESET_REQUIRED_AFTER_PLC_COMM_ERROR")
  );
}

function shortChartLabel(value = "", maxLength = 18) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalizeDashboardShiftCode(value = "") {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, "_");
  if (!raw) return "UNASSIGNED";
  const parts = raw.split("_").filter(Boolean);
  if (
    raw === "A" ||
    raw === "SHIFT_A" ||
    raw === "A_SHIFT" ||
    (parts.includes("SHIFT") && parts.includes("A"))
  )
    return "SHIFT_A";
  if (
    raw === "B" ||
    raw === "SHIFT_B" ||
    raw === "B_SHIFT" ||
    (parts.includes("SHIFT") && parts.includes("B"))
  )
    return "SHIFT_B";
  if (
    raw === "C" ||
    raw === "SHIFT_C" ||
    raw === "C_SHIFT" ||
    (parts.includes("SHIFT") && parts.includes("C"))
  )
    return "SHIFT_C";
  if (
    raw === "S1" ||
    raw === "SHIFT_S1" ||
    raw === "S1_SHIFT" ||
    raw === "SHIFT_1"
  )
    return "SHIFT_S1";
  if (
    raw === "S2" ||
    raw === "SHIFT_S2" ||
    raw === "S2_SHIFT" ||
    raw === "SHIFT_2"
  )
    return "SHIFT_S2";
  if (
    raw === "S3" ||
    raw === "SHIFT_S3" ||
    raw === "S3_SHIFT" ||
    raw === "SHIFT_3"
  )
    return "SHIFT_S3";
  return raw;
}

function getDashboardShiftLabel(code = "") {
  const normalized = normalizeDashboardShiftCode(code);
  if (normalized === "SHIFT_A") return "Shift A";
  if (normalized === "SHIFT_B") return "Shift B";
  if (normalized === "SHIFT_C") return "Shift C";
  return String(normalized || "Unassigned")
    .replace(/^SHIFT_/, "")
    .replace(/_/g, " ");
}

function getDashboardShiftSeconds(value = "") {
  const [hours, minutes, seconds = 0] = String(value || "")
    .split(":")
    .map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 3600 + minutes * 60 + (Number.isFinite(seconds) ? seconds : 0);
}

function resolveDashboardShiftCodeForDate(dateValue, shifts = []) {
  const rawDateValue = String(dateValue || "").trim();
  const ts =
    rawDateValue && !rawDateValue.includes("T")
      ? new Date(rawDateValue.replace(" ", "T"))
      : new Date(dateValue || 0);
  if (Number.isNaN(ts.getTime())) return "UNASSIGNED";
  const second = ts.getHours() * 3600 + ts.getMinutes() * 60 + ts.getSeconds();
  const matches = [];
  for (const shift of shifts || []) {
    const code = normalizeDashboardShiftCode(
      shift?.shiftCode || shift?.shift_code,
    );
    const start = getDashboardShiftSeconds(
      shift?.startTime || shift?.start_time,
    );
    const end = getDashboardShiftSeconds(shift?.endTime || shift?.end_time);
    if (!code || code === "UNASSIGNED" || start === null || end === null) continue;
    const inShift =
      start === end
        ? true
        : start < end
          ? second >= start && second <= end
          : second >= start || second <= end;
    if (inShift) {
      const duration =
        start === end
          ? 24 * 3600
          : start < end
            ? end - start
            : 24 * 3600 - start + end;
      matches.push({ code, start, duration });
    }
  }
  if (matches.length) {
    matches.sort((a, b) => b.start - a.start || a.duration - b.duration);
    return matches[0].code;
  }
  return "UNASSIGNED";
}

function normalizeDashboardStationResult(value, reason = "", row = null) {
  const status = String(value || "")
    .trim()
    .toUpperCase();
  const normalizedReason = String(reason || "")
    .trim()
    .toUpperCase();
  const bypassStatus = Boolean(
    row?.bypassStatus || row?.is_bypassed || row?.isBypassed,
  );
  const bypassReason = String(row?.bypassReason || row?.bypass_reason || "")
    .trim()
    .toUpperCase();
  if (
    bypassStatus ||
    [
      "MACHINE_BYPASS_AUTO_OK",
      "STATION_BYPASS_AUTO_OK",
      "STATION_OPERATION_DISABLED_AUTO_OK",
    ].includes(bypassReason)
  )
    return "OK";
  if (
    normalizedReason === "NG_SHOT_STATUS" &&
    ["BLOCK", "INTERLOCKED"].includes(status)
  )
    return "NG";
  if (
    ["OK", "PASS", "PASSED", "COMPLETED", "ENDED_OK", "COMPLETED_OK"].includes(
      status,
    )
  )
    return "OK";
  if (
    [
      "NG",
      "FAIL",
      "FAILED",
      "ENDED_NG",
      "COMPLETED_NG",
      "INTERLOCKED",
      "REJECTED",
    ].includes(status)
  )
    return "NG";
  if (["IN_PROGRESS", "WIP", "RUNNING", "PENDING"].includes(status))
    return "IN_PROGRESS";
  return status ? "IN_PROGRESS" : "";
}

function normalizeDashboardLeakResult(reading = {}) {
  const status = String(
    reading?.result ||
    reading?.Result ||
    reading?.rawResult ||
    reading?.Raw_Result ||
    "",
  )
    .trim()
    .toUpperCase();
  if (["OK", "PASS", "PASSED", "GOOD"].includes(status)) return "OK";
  if (status === "19279") return "OK";
  if (
    [
      "NG",
      "NOK",
      "NOT_OK",
      "NOT OK",
      "FAIL",
      "FAILED",
      "REJECT",
      "REJECTED",
    ].includes(status)
  )
    return "NG";
  if (/^\d+$/.test(status) && Number(status) > 0) return "NG";
  return "IN_PROGRESS";
}

function getDashboardStatusPriority(value) {
  if (value === "NG") return 4;
  if (value === "OK") return 3;
  if (value === "IN_PROGRESS") return 2;
  return value ? 1 : 0;
}

function getDashboardOperationPriority(value) {
  if (value === "OK") return 3;
  if (value === "NG") return 2;
  if (value === "IN_PROGRESS") return 1;
  return 0;
}

function isFinalInspectionOperation(rowOrOperation = {}) {
  const operation =
    typeof rowOrOperation === "string"
      ? rowOrOperation
      : rowOrOperation.operationNo ||
      rowOrOperation.stationNo ||
      rowOrOperation.operation_no ||
      rowOrOperation.station_no ||
      "";
  const machineName =
    typeof rowOrOperation === "string"
      ? ""
      : rowOrOperation.machineName ||
      rowOrOperation.machine_name ||
      rowOrOperation?.Machine?.machine_name ||
      "";
  const op = String(operation || "").trim().toUpperCase();
  const machine = String(machineName || "").trim().toUpperCase();
  return (
    op === "OP160" ||
    machine.includes("FINAL INSPECTION") ||
    machine.includes("FINAL_INSPECTION")
  );
}

const EMPTY_SUMMARY = {
  machines: { total: 0, active: 0, inactive: 0 },
  parts: { inProgress: 0, completed: 0, ng: 0, interlocked: 0, rework: 0 },
  quality: { ok: 0, ng: 0 },
  recentScans: [],
  availableShifts: [],
};
const EMPTY_REPORT = {
  machineWise: [],
  machineCards: [],
  stationCards: [],
  hourlyProduction: [],
  shiftProduction: {
    SHIFT_A: { total: 0, ok: 0, ng: 0 },
    SHIFT_B: { total: 0, ok: 0, ng: 0 },
    SHIFT_C: { total: 0, ok: 0, ng: 0 },
  },
  interlockHistory: [],
  reworkCount: 0,
  partJourney: [],
  partsList: [],
};

// —— OEE Radial Gauge ——————————————————————————————————————————————————————————
const OeeGauge = ({ value = 0, size = 88, stroke = 9 }) => {
  const pct = Math.min(100, Math.max(0, value));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const color = pct >= 85 ? C.ok() : pct >= 60 ? C.amber() : C.ng();
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={C.bdr(0.25)}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={circ - (pct / 100) * circ}
          strokeLinecap="round"
          style={{
            transition: "stroke-dashoffset 1s ease",
            filter: `drop-shadow(0 0 6px ${color}88)`,
          }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: size > 70 ? 14 : 11,
            fontWeight: 800,
            color,
            fontFamily: "'DM Mono',monospace",
          }}
        >
          {pct}%
        </span>
      </div>
    </div>
  );
};

// —— Status Badge ——————————————————————————————————————————————————————————————
const Badge = ({ variant = "idle", label }) => {
  const map = {
    ok: { fg: C.ok(), bg: C.ok(0.1), bdr: C.ok(0.25) },
    ng: { fg: C.ng(), bg: C.ng(0.1), bdr: C.ng(0.25) },
    wip: { fg: C.wip(), bg: C.wip(0.1), bdr: C.wip(0.25) },
    idle: { fg: C.idle(), bg: C.idle(0.08), bdr: C.idle(0.2) },
  };
  const s = map[variant] || map.idle;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 10px",
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        color: s.fg,
        background: s.bg,
        border: `1px solid ${s.bdr}`,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: s.fg,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
};

// —— KPI Card ——————————————————————————————————————————————————————————————————
const DashboardSkeleton = () => {
  const skeletonBase = {
    position: "relative",
    overflow: "hidden",
    background: C.bdr(0.18),
  };
  const Skel = ({ style }) => (
    <div
      className="db-skeleton-shimmer"
      style={{ ...skeletonBase, borderRadius: 8, ...style }}
    />
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        animation: "dbFadeIn 0.25s ease",
      }}
    >
      <style>{`
        .db-skeleton-shimmer::after {
          content: "";
          position: absolute;
          inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.38), transparent);
          animation: dbShimmer 1.35s infinite;
        }
      `}</style>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 5 }).map((_, idx) => (
          <div
            key={idx}
            style={{
              background: C.bg("card"),
              border: `1px solid ${C.bdr()}`,
              borderRadius: 14,
              padding: "16px 18px",
              boxShadow: SHADOW,
            }}
          >
            <Skel style={{ width: "58%", height: 12, marginBottom: 16 }} />
            <Skel style={{ width: "42%", height: 30, marginBottom: 10 }} />
            <Skel style={{ width: "72%", height: 10 }} />
          </div>
        ))}
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}
        className="db-tablet-grid-2"
      >
        <div
          style={{
            background: C.bg("card"),
            border: `1px solid ${C.bdr()}`,
            borderRadius: 14,
            padding: 18,
            boxShadow: SHADOW,
          }}
        >
          <Skel style={{ width: 180, height: 12, marginBottom: 18 }} />
          <Skel style={{ width: "100%", height: 260 }} />
        </div>
        <div
          style={{
            background: C.bg("card"),
            border: `1px solid ${C.bdr()}`,
            borderRadius: 14,
            padding: 18,
            boxShadow: SHADOW,
          }}
        >
          <Skel style={{ width: 150, height: 12, marginBottom: 18 }} />
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skel
              key={idx}
              style={{
                width: `${92 - idx * 7}%`,
                height: 28,
                marginBottom: 10,
              }}
            />
          ))}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 6 }).map((_, idx) => (
          <div
            key={idx}
            style={{
              background: C.bg("card"),
              border: `1px solid ${C.bdr()}`,
              borderRadius: 14,
              padding: 16,
              boxShadow: SHADOW,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <Skel style={{ width: 54, height: 54, borderRadius: "50%" }} />
              <div style={{ flex: 1 }}>
                <Skel style={{ width: "70%", height: 14, marginBottom: 8 }} />
                <Skel style={{ width: "48%", height: 10 }} />
              </div>
            </div>
            <Skel style={{ width: "100%", height: 46 }} />
          </div>
        ))}
      </div>
    </div>
  );
};

function tone(color, alpha = 0.1) {
  const raw = String(color || C.steel()).trim();
  if (raw.startsWith("rgba(")) return raw.replace(/,\s*[\d.]+\)$/, `,${alpha})`);
  if (raw.startsWith("rgb(")) return raw.replace(/^rgb\((.*)\)$/, `rgba($1,${alpha})`);
  if (raw.startsWith("#") && raw.length === 7) {
    const n = Number.parseInt(raw.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return raw;
}

const KpiCard = ({ label, value, icon: Icon, accent, sub, subValue, subtitle }) => {
  const accentColor = accent || C.steel();
  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${tone(accentColor, 0.05)}, ${C.bg("card")} 45%)`,
        border: `1px solid ${tone(accentColor, 0.2)}`,
        borderRadius: 14,
        padding: "16px 18px",
        boxShadow: `0 4px 14px ${C.navy(0.06)}, 0 1px 3px ${C.navy(0.04)}`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        position: "relative",
        overflow: "hidden",
        transition: "all 0.2s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: tone(accentColor, 0.12),
            border: `1px solid ${tone(accentColor, 0.25)}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: `0 2px 8px ${tone(accentColor, 0.15)}`,
          }}
        >
          <Icon size={17} color={accentColor} strokeWidth={2.4} />
        </div>
        {subValue && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: accentColor,
              background: tone(accentColor, 0.08),
              border: `1px solid ${tone(accentColor, 0.2)}`,
              padding: "3px 8px",
              borderRadius: 6,
            }}
          >
            {subValue}
          </span>
        )}
      </div>

      <div>
        <p
          style={{
            fontSize: 10,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: C.txt("muted"),
            lineHeight: 1.2,
            margin: "0 0 4px",
          }}
        >
          {label}
        </p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontSize: 26,
              fontWeight: 900,
              color: C.txt("pri"),
              lineHeight: 1,
              fontFamily: "'DM Mono',monospace",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {typeof value === 'number' ? value.toLocaleString() : value}
          </span>
          {subtitle && (
            <span style={{ fontSize: 11, fontWeight: 600, color: C.txt("sec") }}>
              {subtitle}
            </span>
          )}
        </div>
      </div>
      {sub && <p style={{ fontSize: 11, color: C.txt("muted"), margin: 0 }}>{sub}</p>}
    </div>
  );
};

// —— Machine KPI Card ——————————————————————————————————————————————————————————
const MachineCard = ({
  row,
  plcOnline = null,
  scannerOnline = null,
  nowMs = 0,
  t,
}) => {
  const acc = Number(row.accuracy || 0);
  const color = acc >= 85 ? C.ok() : acc >= 60 ? C.amber() : C.ng();
  const ngValue = Number(row.ngCount || row.failedCount || 0);
  const okValue = Number(row.okCount || row.goodCount || 0);
  const processedValue =
    Number(row.actualProduction || row.processedCount || 0) ||
    okValue + ngValue;
  const lastScan = row.lastScanTime ? new Date(row.lastScanTime) : null;
  const msAgo = lastScan && nowMs ? nowMs - lastScan.getTime() : null;
  const targetValue = Number(row.targetProduction ?? row.targetQty ?? 0);
  const cycleSeconds = Number(row.cycleTime ?? row.cycle_time ?? 0);
  const loadingSeconds = Number(row.loadingTime ?? row.loading_time ?? 0);
  const targetTitle =
    targetValue > 0
      ? `Target uses shift available time / (cycle time ${cycleSeconds || 0}s + loading time ${loadingSeconds || 0}s)`
      : "Target requires cycle time + loading time or daily target setup";
  const scanColor =
    msAgo === null
      ? C.txt("muted")
      : msAgo > 600000
        ? C.ng()
        : msAgo > 300000
          ? C.amber()
          : C.ok();

  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${tone(color, 0.035)}, ${C.bg("card")} 38%)`,
        border: `1px solid ${tone(color, 0.2)}`,
        borderRadius: 12,
        padding: "20px 20px 16px",
        minHeight: 268,
        boxShadow: SHADOW,
        position: "relative",
        overflow: "hidden",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = tone(color, 0.38);
        e.currentTarget.style.boxShadow = SHADOW_MD;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = tone(color, 0.2);
        e.currentTarget.style.boxShadow = SHADOW;
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "0 0 auto 0",
          height: 3,
          background: `linear-gradient(90deg, ${color}, ${tone(color, 0.28)})`,
        }}
      />
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 16,
        }}
      >
        <div
          title="Quality % = Passed / (Passed + NG)"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <OeeGauge value={acc} size={66} stroke={7} />
          <span
            style={{
              fontSize: 9,
              fontWeight: 900,
              color,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Quality %
          </span>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p
            style={{
              fontSize: 16,
              fontWeight: 850,
              color: C.txt("pri"),
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: 3,
            }}
          >
            {row.machineName || "Machine"}
          </p>
          <p
            style={{
              fontSize: 12,
              color: C.txt("muted"),
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.lineName || "-"} / {row.stationNo || "-"}
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {[
          {
            label: t("dashboard.passed", "Passed"),
            value: okValue,
            color: C.ok(),
            title: "Passed parts at this machine",
          },
          {
            label: t("dashboard.ng", "NG"),
            value: ngValue,
            color: C.ng(),
            title:
              String(row.stationNo || row.station_no || "").toUpperCase() ===
                "OP150"
                ? "Leak Test NG count from leak machine result"
                : "Machine NG count",
          },
          {
            label: t("dashboard.target", "Target"),
            value: targetValue,
            color: C.txt("muted"),
            title: targetTitle,
          },
          {
            label: "Achieved",
            value: `${row.achievementPct || 0}%`,
            color: color,
            title: `Achieved = ${processedValue} processed / ${targetValue || 0} target`,
          },
        ].map((s, i) => (
          (() => {
            const statColor = s.color === C.txt("muted") ? C.steel() : s.color;
            return (
              <div
                key={i}
                style={{
                  background: `linear-gradient(180deg, ${tone(statColor, 0.085)}, ${C.bg("surf")})`,
                  border: `1px solid ${tone(statColor, 0.2)}`,
                  borderRadius: 10,
                  padding: "11px 6px 9px",
                  textAlign: "center",
                  boxShadow: `0 4px 12px ${tone(statColor, 0.07)}, inset 0 1px 0 rgba(255,255,255,0.74)`,
                  minWidth: 0,
                }}
                title={s.title || ""}
              >
                <p
                  style={{
                    fontSize: 17,
                    fontWeight: 900,
                    color:
                      s.color === C.txt("muted") ? C.txt("pri") : statColor,
                    fontFamily: "'DM Mono',monospace",
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.value}
                </p>
                <p
                  style={{
                    fontSize: 10.5,
                    fontWeight: 850,
                    color: C.txt("muted"),
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginTop: 5,
                    lineHeight: 1.15,
                  }}
                >
                  {s.label}
                </p>
              </div>
            );
          })()
        ))}
      </div>
      {(cycleSeconds > 0 || loadingSeconds > 0) && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          <Badge variant="idle" label={`CT ${cycleSeconds || 0}s`} />
          <Badge variant="idle" label={`Load ${loadingSeconds || 0}s`} />
          <Badge
            variant="idle"
            label={`Eff ${cycleSeconds + loadingSeconds}s`}
          />
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 10,
          borderTop: `1px solid ${C.bdr()}`,
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <Clock size={10} color={C.txt("muted")} />
          <span
            style={{
              fontSize: 11,
              color: scanColor,
              fontFamily: "'DM Mono',monospace",
            }}
          >
            {lastScan ? lastScan.toLocaleTimeString() : "No scan"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <span
            title={
              plcOnline === null
                ? t(
                  "dashboard.plcStatusUnknown",
                  "PLC status unknown / not assigned",
                )
                : plcOnline
                  ? t("dashboard.plcOnline", "PLC online")
                  : t("dashboard.plcOffline", "PLC offline")
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
              color:
                plcOnline === null
                  ? C.txt("muted")
                  : plcOnline
                    ? C.ok()
                    : C.ng(),
            }}
          >
            {plcOnline ? (
              <Wifi size={11} color={C.ok()} />
            ) : (
              <WifiOff
                size={11}
                color={plcOnline === null ? C.steel() : C.ng()}
              />
            )}
            PLC
          </span>
          <span
            title={
              scannerOnline === null
                ? t(
                  "dashboard.scannerStatusUnknown",
                  "Scanner status unknown / not assigned",
                )
                : scannerOnline
                  ? t("dashboard.scannerOnline", "Scanner online")
                  : t("dashboard.scannerOffline", "Scanner offline")
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
              color:
                scannerOnline === null
                  ? C.txt("muted")
                  : scannerOnline
                    ? C.ok()
                    : C.ng(),
            }}
          >
            {scannerOnline ? (
              <Wifi size={11} color={C.ok()} />
            ) : (
              <WifiOff
                size={11}
                color={scannerOnline === null ? C.steel() : C.ng()}
              />
            )}
            SCN
          </span>
          <span
            title={t(
              "dashboard.downtimeHelp",
              "Duration-based downtime from production log gaps",
            )}
            style={{ fontSize: 11, fontWeight: 700, color: C.steel() }}
          >
            DT Min {Math.round(Number(row.downtimeMinutes || 0))}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.ng(0.85) }}>
            RW {row.reworkCount || 0}
          </span>
        </div>
      </div>
    </div>
  );
};

// —— Section header ————————————————————————————————————————————————————————————
const SectionHead = ({ title, right }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
      flexWrap: "wrap",
      gap: 8,
    }}
  >
    <p
      style={{
        fontSize: 11,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.09em",
        color: C.txt("muted"),
      }}
    >
      {title}
    </p>
    {right}
  </div>
);

const ChartModeToggle = ({ mode, onChange }) => {
  const btn = (id, Icon) => (
    <button
      key={id}
      onClick={() => onChange(id)}
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        border: `1px solid ${C.bdr()}`,
        background: mode === id ? C.navy(0.12) : "transparent",
        color: mode === id ? C.navy() : C.txt("muted"),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
      title={`${id} view`}
    >
      <Icon size={13} />
    </button>
  );
  return (
    <div style={{ display: "inline-flex", gap: 6 }}>
      {btn("bar", BarChart3)}
      {btn("line", Activity)}
      {btn("area", Layers)}
    </div>
  );
};

// —— Chart tooltip theme ———————————————————————————————————————————————————————
const TooltipStyle = {
  contentStyle: {
    background: C.bg("card"),
    border: `1px solid ${C.bdr()}`,
    borderRadius: 10,
    fontSize: 12,
    color: C.txt("pri"),
    boxShadow: SHADOW_MD,
    maxWidth: 220,
    whiteSpace: "normal",
    wordBreak: "break-word",
  },
  labelStyle: { color: C.txt("sec"), fontWeight: 700 },
  itemStyle: { color: C.txt("pri") },
  wrapperStyle: { zIndex: 9999, pointerEvents: "none" },
  allowEscapeViewBox: { x: true, y: true },
};

const CenterTooltipStyle = {
  ...TooltipStyle,
  position: { x: 72, y: 54 },
  wrapperStyle: { zIndex: 20000, pointerEvents: "none" },
};

const RejectionPieTooltip = ({ active, payload, total = 0 }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const value = Number(row.value || 0);
  const safeTotal = Number(total || 0);
  const percentage =
    safeTotal > 0 ? ((value / safeTotal) * 100).toFixed(1) : "0.0";
  return (
    <div
      style={{
        background: C.bg("card"),
        border: `1px solid ${C.bdr()}`,
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: SHADOW_MD,
        minWidth: 170,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: row.color,
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 900, color: C.txt("pri") }}>
          {row.name}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 18,
          fontSize: 11,
          color: C.txt("sec"),
        }}
      >
        <span>Rejections</span>
        <strong style={{ color: C.txt("pri") }}>{value}</strong>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 18,
          fontSize: 11,
          color: C.txt("sec"),
          marginTop: 3,
        }}
      >
        <span>Share</span>
        <strong style={{ color: row.color }}>{percentage}%</strong>
      </div>
    </div>
  );
};

const getPresetRange = (preset) => {
  const now = new Date();
  let end = new Date(now);
  const start = new Date(now);
  start.setHours(6, 0, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  if (preset === "today") {
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  } else if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  } else if (preset === "last7") {
    start.setDate(start.getDate() - 7);
  } else if (preset === "last30") {
    start.setDate(start.getDate() - 30);
  } else {
    return { start: "", end: "" };
  }
  return { start: start.toISOString(), end: end.toISOString() };
};

const DashboardDateRangePicker = ({
  startDate,
  endDate,
  onApply,
  onClear,
  label = "Select Date Range",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedStart, setSelectedStart] = useState(
    startDate ? new Date(startDate) : null,
  );
  const [selectedEnd, setSelectedEnd] = useState(
    endDate ? new Date(endDate) : null,
  );
  const [tempStart, setTempStart] = useState(selectedStart);
  const [tempEnd, setTempEnd] = useState(selectedEnd);
  const pickerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target))
        setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const nextStart = startDate ? new Date(startDate) : null;
    const nextEnd = endDate ? new Date(endDate) : null;
    setSelectedStart(nextStart);
    setSelectedEnd(nextEnd);
    setTempStart(nextStart);
    setTempEnd(nextEnd);
  }, [startDate, endDate]);

  const formatDateDisplay = (date) =>
    date
      ? date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      : "";

  const handleDayClick = (day) => {
    const clickedDate = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day,
    );
    clickedDate.setHours(0, 0, 0, 0);
    if (!tempStart || (tempStart && tempEnd)) {
      setTempStart(clickedDate);
      setTempEnd(null);
    } else if (clickedDate < tempStart) {
      setTempStart(clickedDate);
      setTempEnd(tempStart);
    } else {
      setTempEnd(clickedDate);
    }
  };

  const handleApply = () => {
    if (!tempStart) return;
    const start = new Date(tempStart);
    const end = new Date(tempEnd || tempStart);
    start.setHours(6, 0, 0, 0);
    end.setHours(6, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    setSelectedStart(start);
    setSelectedEnd(end);
    onApply(start, end);
    setIsOpen(false);
  };

  const handleClear = () => {
    setTempStart(null);
    setTempEnd(null);
    setSelectedStart(null);
    setSelectedEnd(null);
    onClear();
    setIsOpen(false);
  };

  const daysInMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0,
  ).getDate();
  const firstDay = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1,
  ).getDay();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
    <div key={`weekday-${day}`} className="db-date-picker-weekday">
      {day}
    </div>
  ));
  for (let index = 0; index < firstDay; index += 1)
    days.push(<div key={`empty-${index}`} />);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      day,
    );
    date.setHours(0, 0, 0, 0);
    const isToday = date.getTime() === today.getTime();
    const isStart = tempStart && date.getTime() === tempStart.getTime();
    const isEnd = tempEnd && date.getTime() === tempEnd.getTime();
    const isInRange =
      tempStart && tempEnd && date > tempStart && date < tempEnd;
    let className = "db-date-picker-day";
    if (isToday) className += " today";
    if (isStart) className += " range-start selected";
    if (isEnd) className += " range-end selected";
    if (isInRange) className += " range-middle";
    days.push(
      <button
        key={`day-${day}`}
        className={className}
        onClick={() => handleDayClick(day)}
      >
        {day}
      </button>,
    );
  }

  const dateRangeText =
    selectedStart && selectedEnd
      ? `${formatDateDisplay(selectedStart)} - ${formatDateDisplay(new Date(selectedEnd.getTime() - 1))}`
      : selectedStart
        ? formatDateDisplay(selectedStart)
        : label;

  return (
    <div className="db-date-picker-container" ref={pickerRef}>
      <button
        onClick={() => setIsOpen((value) => !value)}
        className="db-filter-input"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        <span
          style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}
        >
          <Calendar
            size={14}
            color={C.txt("muted")}
            style={{ flexShrink: 0 }}
          />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: selectedStart ? C.txt("pri") : C.txt("muted"),
            }}
          >
            {dateRangeText}
          </span>
        </span>
        <ChevronDown
          size={14}
          color={C.txt("muted")}
          style={{
            flexShrink: 0,
            transform: isOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.2s ease",
          }}
        />
      </button>
      {isOpen && (
        <div className="db-date-picker-dropdown">
          <div className="db-date-picker-header">
            <button
              onClick={() =>
                setCurrentMonth(
                  new Date(
                    currentMonth.getFullYear(),
                    currentMonth.getMonth() - 1,
                    1,
                  ),
                )
              }
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {currentMonth.toLocaleString("default", {
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              onClick={() =>
                setCurrentMonth(
                  new Date(
                    currentMonth.getFullYear(),
                    currentMonth.getMonth() + 1,
                    1,
                  ),
                )
              }
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="db-date-picker-grid">{days}</div>
          <div className="db-date-picker-footer">
            <button className="clear-btn" onClick={handleClear}>
              Clear
            </button>
            <button className="apply-btn" onClick={handleApply}>
              Apply Range
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ==============================================================================
//  DASHBOARD
// ==============================================================================
const Dashboard = () => {
  injectDS();
  const { t } = useLanguage();

  const [machines, setMachines] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [report, setReport] = useState(EMPTY_REPORT);
  const [reportMetrics, setReportMetrics] = useState(null);
  const lastStableReportMetricsRef = useRef(null);
  const [shiftManagerShifts, setShiftManagerShifts] = useState([]);
  const [oeeData, setOeeData] = useState([]);
  const [trendsData, setTrendsData] = useState([]);
  const [activePreset, setActivePreset] = useState("today");
  const [showAllGates, setShowAllGates] = useState(false);
  const [selectedStationFilter, setSelectedStationFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [showFilters, setShowFilters] = useState(false);
  const [plcMap, setPlcMap] = useState({});
  const [nowMs, setNowMs] = useState(Date.now());
  const [filters, setFilters] = useState(() => {
    const range = getCurrentDashboardProductionRange();
    return {
      dateFrom: range.start,
      dateTo: range.end,
      plantId: "",
      lineId: "",
      lineName: "",
      machineId: "",
      partId: "",
      status: "",
      shiftCode: "",
    };
  });
  const [isLiveProductionRange, setIsLiveProductionRange] = useState(true);
  const [chartModeRejectTrend, setChartModeRejectTrend] = useState("area");
  const [rejectionConfigParts, setRejectionConfigParts] = useState([]);
  const [heatMapPart, setHeatMapPart] = useState("");
  const [heatMapConfig, setHeatMapConfig] = useState(null);
  const [heatMapViewId, setHeatMapViewId] = useState("");
  const [heatMapSelection, setHeatMapSelection] = useState(null);
  const [rejectionFilters, setRejectionFilters] = useState({
    category: "",
    view: "",
    zone: "",
    reason: "",
  });
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const lastRefreshAtRef = useRef(0);
  const latestLoadDataRef = useRef(null);

  // ---- Compute isMultiDayRange early ----
  const isMultiDayRange = useMemo(() => {
    if (filters.dateFrom && filters.dateTo) {
      const fromMs = new Date(filters.dateFrom).getTime();
      const toMs = new Date(filters.dateTo).getTime();
      if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
        return toMs - fromMs > 36 * 60 * 60 * 1000;
      }
    }
    return false;
  }, [filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    if (activeTab !== "rejection") return;
    let active = true;
    rejectionConfigApi
      .parts()
      .then((partsResult) => {
        if (!active) return;
        const parts = partsResult?.parts || [];
        setRejectionConfigParts(parts);
        setHeatMapPart((current) =>
          current && parts.includes(current) ? current : parts[0] || "",
        );
      })
      .catch((error) =>
        console.warn("Rejection parts load failed", error?.message || error),
      );
    return () => {
      active = false;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "rejection" || !heatMapPart) {
      setHeatMapConfig(null);
      setHeatMapViewId("");
      return;
    }
    let active = true;
    rejectionConfigApi
      .operatorConfig({ partName: heatMapPart })
      .then((configResult) => {
        if (!active) return;
        setHeatMapConfig(configResult || null);
        setHeatMapViewId((current) =>
          (configResult?.views || []).some(
            (view) => String(view.id) === String(current),
          )
            ? current
            : String(configResult?.views?.[0]?.id || ""),
        );
      })
      .catch((error) => {
        if (!active) return;
        setHeatMapConfig(null);
        setHeatMapViewId("");
        console.warn(
          "Rejection heat map config load failed",
          error?.message || error,
        );
      });
    return () => {
      active = false;
    };
  }, [activeTab, heatMapPart]);

  useEffect(() => {
    if (!rejectionFilters.view || !heatMapConfig?.views?.length) return;
    const matched = heatMapConfig.views.find(
      (view) =>
        String(view.name || "").toUpperCase() ===
        String(rejectionFilters.view).toUpperCase(),
    );
    if (matched) setHeatMapViewId(String(matched.id));
  }, [rejectionFilters.view, heatMapConfig]);

  const effectiveFilters = useMemo(() => {
    if (!isLiveProductionRange) return filters;
    const range = getCurrentDashboardProductionRange();
    return {
      ...filters,
      dateFrom: range.start,
      dateTo: range.end,
    };
  }, [filters, isLiveProductionRange, nowMs]);

  const query = useMemo(() => {
    const isAll = activePreset === "all";
    const dateFrom = isAll ? undefined : localDateTimeToIso(effectiveFilters.dateFrom);
    const dateTo = isAll ? undefined : localDateTimeToIso(effectiveFilters.dateTo);
    return {
      dateFrom,
      dateTo,
      datePreset: isAll ? "all" : undefined,
      allTime: isAll ? "1" : undefined,
    };
  }, [effectiveFilters, activePreset]);

  const selectedQualityGate = useMemo(() => {
    if (!filters.machineId) return null;
    return (
      (machines || []).find(
        (row) =>
          String(row.id || row.machineId || "") === String(filters.machineId),
      ) || null
    );
  }, [filters.machineId, machines]);

  const reportMetricsQuery = useMemo(() => {
    const selectedOperation = String(
      selectedQualityGate?.operationNo ||
      selectedQualityGate?.operation_no ||
      selectedQualityGate?.stationNo ||
      selectedQualityGate?.station_no ||
      "",
    )
      .trim()
      .toUpperCase();
    if (!selectedOperation) return query;
    return {
      ...query,
      station: selectedOperation,
      operationNo: selectedOperation,
      stationNo: selectedOperation,
    };
  }, [query, selectedQualityGate]);

  const loadData = useCallback(async (showLoading = false) => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      if (showLoading) setLoading(true);
      return;
    }
    refreshInFlightRef.current = true;
    const requestTs = Date.now();
    const liveRange = isLiveProductionRange
      ? getCurrentDashboardProductionRange(new Date(requestTs))
      : null;
    const requestQuery = liveRange
      ? { ...query, dateFrom: liveRange.start, dateTo: liveRange.end }
      : query;
    const requestReportMetricsQuery = liveRange
      ? { ...reportMetricsQuery, dateFrom: liveRange.start, dateTo: liveRange.end }
      : reportMetricsQuery;
    const freshQuery = { ...requestQuery, noCache: "1", _ts: requestTs };
    const freshReportMetricsQuery = { ...requestReportMetricsQuery, noCache: "1", _ts: requestTs };
    try {
      setNowMs(requestTs);
      setLoading(showLoading || !lastStableReportMetricsRef.current);
      const reportMetricsPromise = reportApi.getData(
        {
          ...freshReportMetricsQuery,
          fast: "1",
          includePlcSummary: "0",
          includePlcReadings: "0",
          includeLeaktest: "1",
          page: 1,
          pageSize: 10,
        },
        { timeout: 60000, suppressGlobalError: true },
      );
      reportMetricsPromise
        .then((value) => {
          const nextMetrics = value?.metrics || null;
          if (nextMetrics) {
            lastStableReportMetricsRef.current = nextMetrics;
            setReportMetrics(nextMetrics);
          }
        })
        .catch(() => {
          if (lastStableReportMetricsRef.current) {
            setReportMetrics(lastStableReportMetricsRef.current);
          }
        });
      const [
        machinesResult,
        summaryResult,
        trendsResult,
        reportResult,
        oeeResult,
        reportMetricsResult,
        shiftsResult,
      ] = await Promise.allSettled([
        machines.length
          ? Promise.resolve(machines)
          : machineApi.list({ timeout: 20000, suppressGlobalError: true, params: { noCache: "1", _ts: requestTs } }),
        dashboardApi.summary(freshQuery, {
          timeout: 25000,
          suppressGlobalError: true,
        }),
        dashboardApi.trends(freshQuery, {
          timeout: 25000,
          suppressGlobalError: true,
        }),
        dashboardApi.report(
          { ...freshQuery, light: "1" },
          { timeout: 45000, suppressGlobalError: true },
        ),
        dashboardApi.oee({ timeout: 20000, suppressGlobalError: true, params: { ...freshQuery, noCache: "1", _ts: requestTs } }),
        reportMetricsPromise,
        shiftApi.list(undefined, { timeout: 20000, suppressGlobalError: true, params: { noCache: "1", _ts: requestTs } }),
      ]);

      if (machinesResult.status === "fulfilled") {
        setMachines(machinesResult.value || []);
      }
      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value || EMPTY_SUMMARY);
      }
      if (trendsResult.status === "fulfilled") {
        setTrendsData(trendsResult.value || []);
      }
      if (reportResult.status === "fulfilled") {
        setReport(reportResult.value || EMPTY_REPORT);
      }
      if (oeeResult.status === "fulfilled" && oeeResult.value) {
        setOeeData(oeeResult.value?.oee || []);
      }
      if (reportMetricsResult.status === "fulfilled") {
        const nextMetrics = reportMetricsResult.value?.metrics || null;
        if (nextMetrics) lastStableReportMetricsRef.current = nextMetrics;
        setReportMetrics(nextMetrics || lastStableReportMetricsRef.current || null);
      } else if (lastStableReportMetricsRef.current) {
        setReportMetrics(lastStableReportMetricsRef.current);
      }
      if (shiftsResult.status === "fulfilled") {
        setShiftManagerShifts(
          (shiftsResult.value || []).filter((row) => row?.isActive !== false),
        );
      }

      const failures = [
        machinesResult.status === "rejected" ? machinesResult.reason : null,
        summaryResult.status === "rejected" ? summaryResult.reason : null,
        trendsResult.status === "rejected" ? trendsResult.reason : null,
        reportResult.status === "rejected" ? reportResult.reason : null,
        oeeResult.status === "rejected" ? oeeResult.reason : null,
        reportMetricsResult.status === "rejected"
          ? reportMetricsResult.reason
          : null,
        shiftsResult.status === "rejected" ? shiftsResult.reason : null,
      ].filter(Boolean);

      if (
        machinesResult.status === "rejected" &&
        summaryResult.status === "rejected" &&
        reportResult.status === "rejected" &&
        oeeResult.status === "rejected" &&
        reportMetricsResult.status === "rejected"
      ) {
        console.error("Dashboard load error", failures[0]);
      }
    } catch (e) {
      console.error("Dashboard load error", e);
    } finally {
      setLoading(false);
      refreshInFlightRef.current = false;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        latestLoadDataRef.current?.();
      }
    }
  }, [query, reportMetricsQuery, machines, isLiveProductionRange]);

  useEffect(() => {
    latestLoadDataRef.current = loadData;
  }, [loadData]);

  const scheduleRefresh = useCallback(
    (cooldownMs = 300) => {
      const elapsed = Date.now() - lastRefreshAtRef.current;
      const delay = Math.max(0, cooldownMs - elapsed);
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        lastRefreshAtRef.current = Date.now();
        loadData();
      }, delay);
    },
    [loadData],
  );

  useEffect(() => {
    scheduleRefresh(0);
    const t = setInterval(() => scheduleRefresh(500), 30000);
    return () => {
      clearInterval(t);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [scheduleRefresh]);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let disposed = false;
    let sock = null;
    const connectTimer = setTimeout(() => {
      if (disposed) return;
      sock = io(SOCKET_URL, {
        ...SOCKET_OPTIONS,
        reconnection: true,
        reconnectionAttempts: Infinity,
      });
      sock.on("dashboard_refresh", () => scheduleRefresh(350));
      sock.on("plc_connection_event", (d) => {
        if (d.machineId)
          setPlcMap((p) => ({
            ...p,
            [d.machineId]: d.state === "COMPLETED" || d.state === "CLOSED",
          }));
      });
    }, 0);
    return () => {
      disposed = true;
      clearTimeout(connectTimer);
      if (sock) {
        sock.off();
        sock.disconnect();
      }
    };
  }, [scheduleRefresh]);

  const lineContextLabel = useMemo(() => {
    const selectedMachineId = Number(filters.machineId || 0);
    if (selectedMachineId) {
      const machine = machines.find(
        (row) => Number(row.id) === selectedMachineId,
      );
      return machine?.lineName ? `Line: ${machine.lineName}` : "Line: -";
    }
    if (filters.lineName) {
      return `Line: ${filters.lineName}`;
    }
    const lines = [
      ...new Set(
        (machines || [])
          .map((row) => String(row.lineName || "").trim())
          .filter(Boolean),
      ),
    ];
    if (lines.length === 0) return "Line: All";
    if (lines.length === 1) return `Line: ${lines[0]}`;
    return `Line: All (${lines.length})`;
  }, [filters.machineId, filters.lineName, machines]);

  const dashboardLineOptions = useMemo(
    () =>
      [
        ...new Set(
          (machines || [])
            .map((row) => String(row.lineName || row.line_name || "").trim())
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [machines],
  );

  const dashboardParts = useMemo(() => {
    const grouped = new Map();
    const rows = Array.isArray(report.partsList) ? report.partsList : [];
    rows.forEach((row, index) => {
      const partId = String(
        row?.partId ||
        row?.part_id ||
        row?.traceabilityPartId ||
        row?.customerQrCode ||
        "",
      ).trim();
      if (!partId) return;
      const machineName = String(row?.machineName || "").trim();
      const stationNo = String(
        row?.stationNo ||
        row?.station_no ||
        row?.operationNo ||
        row?.operation_no ||
        "",
      ).trim();
      const normalizedStatus = normalizeDashboardStationResult(
        row?.result || row?.status || row?.statusLabel || row?.industrialResult,
        row?.interlockReason || row?.reason,
        row,
      );
      const createdAtMs = new Date(row?.createdAt || 0).getTime() || 0;

      if (!grouped.has(partId)) {
        grouped.set(partId, {
          id: partId,
          partId,
          createdAt: row?.createdAt || null,
          latestCreatedAt: row?.createdAt || null,
          latestRawStatus: String(
            row?.status ||
            row?.statusLabel ||
            row?.result ||
            row?.industrialResult ||
            "",
          )
            .trim()
            .toUpperCase(),
          latestReason: row?.interlockReason || row?.reason || "",
          latestRejectionCategory: row?.rejectionCategory || "",
          latestRejectionView: row?.rejectionView || "",
          latestRejectionZone: row?.rejectionZone || "",
          latestRejectionReason: row?.rejectionReason || "",
          customerQrCode: row?.customerQrCode || row?.customer_qr || null,
          partName: row?.partName || null,
          stationTimeline: [],
          __sourceIndex: index,
        });
      }

      const entry = grouped.get(partId);
      if (createdAtMs > (new Date(entry.latestCreatedAt || 0).getTime() || 0)) {
        entry.latestCreatedAt = row?.createdAt || entry.latestCreatedAt;
        entry.latestRawStatus = String(
          row?.status ||
          row?.statusLabel ||
          row?.result ||
          row?.industrialResult ||
          "",
        )
          .trim()
          .toUpperCase();
        entry.latestReason = row?.interlockReason || row?.reason || "";
        entry.latestRejectionCategory =
          row?.rejectionCategory || entry.latestRejectionCategory || "";
        entry.latestRejectionView =
          row?.rejectionView || entry.latestRejectionView || "";
        entry.latestRejectionZone =
          row?.rejectionZone || entry.latestRejectionZone || "";
        entry.latestRejectionReason =
          row?.rejectionReason || entry.latestRejectionReason || "";
      }
      if (
        !entry.createdAt ||
        createdAtMs <
        (new Date(entry.createdAt || 0).getTime() || Number.MAX_SAFE_INTEGER)
      ) {
        entry.createdAt = row?.createdAt || entry.createdAt;
      }

      const stationKey = `${machineName}__${stationNo}`;
      const stage = {
        stationKey,
        machineName,
        stationNo,
        normalizedStatus,
        result:
          row?.result ||
          row?.status ||
          row?.statusLabel ||
          row?.industrialResult ||
          "",
        reason: row?.interlockReason || row?.reason || "",
        rejectionCategory: row?.rejectionCategory || "",
        rejectionView: row?.rejectionView || "",
        rejectionZone: row?.rejectionZone || "",
        rejectionReason: row?.rejectionReason || "",
        createdAt: row?.createdAt || null,
      };
      const existingIndex = entry.stationTimeline.findIndex(
        (item) => item.stationKey === stationKey,
      );
      if (existingIndex === -1) {
        entry.stationTimeline.push(stage);
      } else {
        const existing = entry.stationTimeline[existingIndex];
        const nextPriority = getDashboardStatusPriority(normalizedStatus);
        const existingPriority = getDashboardStatusPriority(
          existing.normalizedStatus,
        );
        const existingTs = new Date(existing.createdAt || 0).getTime() || 0;
        if (
          nextPriority > existingPriority ||
          (nextPriority === existingPriority && createdAtMs >= existingTs)
        ) {
          entry.stationTimeline[existingIndex] = {
            ...stage,
            rejectionCategory:
              stage.rejectionCategory || existing.rejectionCategory || "",
            rejectionView: stage.rejectionView || existing.rejectionView || "",
            rejectionZone: stage.rejectionZone || existing.rejectionZone || "",
            rejectionReason:
              stage.rejectionReason || existing.rejectionReason || "",
            reason: stage.reason || existing.reason || "",
          };
        }
      }
    });

    const requiredOperations = Array.from(
      new Set(
        (machines || [])
          .map((machine) =>
            String(
              machine.operationNo ||
              machine.operation_no ||
              machine.stationNo ||
              machine.station_no ||
              "",
            )
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean),
      ),
    );

    return Array.from(grouped.values()).map((entry) => {
      const operationResults = new Map();
      entry.stationTimeline.forEach((stage) => {
        const operationKey = String(stage.stationNo || "")
          .trim()
          .toUpperCase();
        const current = operationResults.get(operationKey);
        if (
          !current ||
          getDashboardOperationPriority(stage.normalizedStatus) >
          getDashboardOperationPriority(current)
        ) {
          operationResults.set(operationKey, stage.normalizedStatus);
        }
      });

      const statuses = requiredOperations
        .map((operation) => operationResults.get(operation))
        .filter(Boolean);
      const hasFinalInspectionOk = entry.stationTimeline.some(
        (stage) =>
          stage.normalizedStatus === "OK" &&
          isFinalInspectionOperation(stage),
      );
      const finalStatus = statuses.some((status) => status === "NG")
        ? "FAILED"
        : hasFinalInspectionOk
          ? "PASSED"
          : "IN_PROGRESS";
      const latestReason = String(entry.latestReason || "").trim();
      const normalizedLatestReason = latestReason.toUpperCase();
      const blocked =
        finalStatus !== "PASSED" &&
        finalStatus !== "FAILED" &&
        ([
          "INTERLOCKED",
          "BLOCKED",
          "PLC_COMM_ERROR",
          "COMM_ERROR",
          "TIMEOUT",
          "PLC_TIMEOUT",
        ].includes(
          String(entry.latestRawStatus || "")
            .trim()
            .toUpperCase(),
        ) ||
          (latestReason &&
            normalizedLatestReason !==
            "RECOVERY_PENDING_AFTER_BACKEND_RESTART"));
      const failureStage = entry.stationTimeline.find(
        (stage) =>
          stage.normalizedStatus === "NG" && String(stage.reason || "").trim(),
      );
      const structuredStage = entry.stationTimeline.find(
        (stage) =>
          stage.normalizedStatus === "NG" &&
          (stage.rejectionCategory ||
            stage.rejectionView ||
            stage.rejectionZone ||
            stage.rejectionReason),
      );

      return {
        ...entry,
        finalStatus,
        blocked,
        rejectionReason:
          failureStage?.reason ||
          (normalizedLatestReason === "RECOVERY_PENDING_AFTER_BACKEND_RESTART"
            ? ""
            : latestReason),
        rejectionCategory:
          structuredStage?.rejectionCategory ||
          entry.latestRejectionCategory ||
          "",
        rejectionView:
          structuredStage?.rejectionView || entry.latestRejectionView || "",
        rejectionZone:
          structuredStage?.rejectionZone || entry.latestRejectionZone || "",
        rejectionReasonOnly:
          structuredStage?.rejectionReason || entry.latestRejectionReason || "",
      };
    });
  }, [machines, report.partsList]);

  const dashboardPartCountsFromJourney = useMemo(() => {
    return dashboardParts.reduce(
      (acc, part) => {
        if (part.finalStatus === "PASSED") acc.passed += 1;
        else if (part.finalStatus === "FAILED") acc.failed += 1;
        else {
          if (part.blocked) acc.blocked += 1;
          acc.inProgress += 1;
        }
        return acc;
      },
      { passed: 0, failed: 0, blocked: 0, inProgress: 0 },
    );
  }, [dashboardParts]);

  const reportTraceabilityCounts = useMemo(() => {
    if (reportMetrics && typeof reportMetrics === "object") {
      const passed = Number(reportMetrics.totalOK || 0);
      const failed = Number(reportMetrics.totalNG || 0);
      const inProgress = Number(reportMetrics.inProgress || 0);
      const visibleNgCount = Array.isArray(report.partsList)
        ? report.partsList.filter((row) => {
          const status = String(row?.result || row?.status || row?.statusLabel || row?.industrialResult || "").toUpperCase();
          const reason = String(row?.interlock_reason || row?.reason || "").trim();
          if (isPlcCommonError(reason)) return false;
          return status === "NG" || status === "FAILED";
        }).length
        : 0;
      const resolvedFailed = failed > 0 ? failed : visibleNgCount;
      return {
        passed,
        failed: resolvedFailed,
        blocked:
          Number(reportMetrics.validationRejects || 0) > resolvedFailed
            ? Number(reportMetrics.validationRejects || 0) - resolvedFailed
            : 0,
        inProgress,
        total: Number(
          reportMetrics.traceabilityProduction ??
          reportMetrics.totalProduction ??
          passed + resolvedFailed + inProgress,
        ),
      };
    }
    const counts = report?.traceabilityCounts;
    if (!counts || typeof counts !== "object") return null;
    return {
      passed: Number(counts.passed || 0),
      failed: Number(counts.failed || 0),
      blocked: Number(counts.blocked || 0),
      inProgress: Number(counts.inProgress || 0) + Number(counts.blocked || 0),
      total: Number(
        counts.total ||
        counts.totalProduction ||
        counts.traceabilityProduction ||
        0,
      ),
    };
  }, [report?.traceabilityCounts, reportMetrics]);

  const dashboardPartCounts = useMemo(() => {
    if (summary?.summary) {
      const s = summary.summary;
      return {
        total: Number(s.totalParts || 0),
        passed: Number(s.totalOK || 0),
        failed: Number(s.totalNG || 0),
        inProgress: Number(s.totalInProgress || 0),
        scrapRate: Number(s.scrapRate || 0),
        okRate: Number(s.okRate || 100),
      };
    }
    return reportTraceabilityCounts || dashboardPartCountsFromJourney;
  }, [summary, reportTraceabilityCounts, dashboardPartCountsFromJourney]);

  const dashboardTotalProduction = Number(
    dashboardPartCounts.total ??
    (Number(dashboardPartCounts.passed || 0) +
      Number(dashboardPartCounts.failed || 0) +
      Number(dashboardPartCounts.inProgress || 0)),
  ) || 0;

  const stationQualityGates = useMemo(() => {
    if (Array.isArray(summary?.qualityGates) && summary.qualityGates.length > 0) {
      return summary.qualityGates;
    }
    return [];
  }, [summary]);

  const primaryQualityGates = useMemo(() => {
    if (!stationQualityGates || !stationQualityGates.length) return [];
    const leakSubStations = stationQualityGates.filter((g) =>
      ["Leak-Test-01", "Leak-Test-02", "Leak Test-03", "Leak-Test-03"].includes(g.code)
    );
    const mainCodes = ["OP100", "OP110", "OP120", "OP130", "OP140", "OP150", "OP160"];
    return mainCodes.map((code) => {
      const found = stationQualityGates.find((g) => g.code === code);
      if (found) {
        if (code === "OP150") {
          return {
            ...found,
            subStations: leakSubStations,
          };
        }
        return found;
      }
      return {
        code,
        name: code,
        okCount: 0,
        ngCount: 0,
        inspected: 0,
        scrapRate: 0,
        okRate: 100,
        subStations: code === "OP150" ? leakSubStations : undefined,
      };
    });
  }, [stationQualityGates]);

  const lineOeeData = useMemo(() => {
    if (summary?.lineOee) {
      return summary.lineOee;
    }
    return {
      oee: 0,
      oa: 0,
      availability: 0,
      performance: 0,
      quality: 0,
      target: 0,
      actual: 0,
      status: "Attention Needed",
    };
  }, [summary]);

  const dashboardMachineCards = useMemo(() => {
    const machineCountsFromParts = new Map();
    const addMachinePartStatus = ({
      machineId,
      partId,
      normalizedStatus,
      createdAt,
    }) => {
      const numericMachineId = Number(machineId || 0);
      const normalizedPartId = String(partId || "").trim();
      if (!numericMachineId || !normalizedPartId) return;

      const createdAtMs = new Date(createdAt || 0).getTime() || 0;
      if (!machineCountsFromParts.has(numericMachineId)) {
        machineCountsFromParts.set(numericMachineId, new Map());
      }

      const byPart = machineCountsFromParts.get(numericMachineId);
      const existing = byPart.get(normalizedPartId);
      const existingTs = existing
        ? new Date(existing.createdAt || 0).getTime() || 0
        : -1;
      const nextPriority = getDashboardStatusPriority(normalizedStatus);
      const existingPriority = existing
        ? getDashboardStatusPriority(existing.normalizedStatus)
        : -1;

      if (
        !existing ||
        createdAtMs > existingTs ||
        (createdAtMs === existingTs && nextPriority >= existingPriority)
      ) {
        byPart.set(normalizedPartId, {
          normalizedStatus,
          createdAt: createdAt || null,
        });
      }
    };

    (report.partsList || []).forEach((row) => {
      const partId = String(
        row?.partId ||
        row?.part_id ||
        row?.traceabilityPartId ||
        row?.customerQrCode ||
        "",
      ).trim();
      if (!partId) return;
      const leakReadings = Array.isArray(row?.leakTestReadings)
        ? row.leakTestReadings
        : [];
      if (leakReadings.length > 0) {
        leakReadings.forEach((reading) => {
          addMachinePartStatus({
            machineId: reading?.matchedMachineId,
            partId,
            normalizedStatus: normalizeDashboardLeakResult(reading),
            createdAt:
              reading?.cycleEndTime ||
              reading?.Cycle_End_Time ||
              row?.createdAt ||
              row?.createdAtRaw,
          });
        });
      }

      const normalizedStatus = normalizeDashboardStationResult(
        row?.result || row?.status || row?.statusLabel || row?.industrialResult,
        row?.interlockReason || row?.reason,
        row,
      );
      addMachinePartStatus({
        machineId: row?.machineId || row?.machine_id,
        partId,
        normalizedStatus,
        createdAt: row?.createdAt || row?.createdAtRaw,
      });
    });

    const machineCountSummary = new Map();
    machineCountsFromParts.forEach((partMap, machineId) => {
      const summary = { ok: 0, ng: 0, inProgress: 0 };
      partMap.forEach((entry) => {
        if (entry.normalizedStatus === "OK") summary.ok += 1;
        else if (entry.normalizedStatus === "NG") summary.ng += 1;
        else if (entry.normalizedStatus === "IN_PROGRESS")
          summary.inProgress += 1;
      });
      machineCountSummary.set(machineId, summary);
    });

    return (report.machineCards || []).map((row) => {
      const machineId = Number(row.machineId || row.machine_id || 0);
      const derived = machineCountSummary.get(machineId);
      if (!derived) {
        const plannedMinutes = Number(row.plannedProductionMinutes || 0);
        const effectiveCycleSeconds =
          Number(row.cycleTime ?? row.cycle_time ?? 0) +
          Number(row.loadingTime ?? row.loading_time ?? 0);
        const target =
          Number(row.targetProduction ?? row.targetQty ?? 0) ||
          (effectiveCycleSeconds > 0 && plannedMinutes > 0
            ? Math.floor((plannedMinutes * 60) / effectiveCycleSeconds)
            : 0);
        return {
          ...row,
          targetProduction: target,
          targetQty: target,
          interlockedCount: 0,
          achievementPct:
            target > 0
              ? Number(
                (
                  (Number(row.actualProduction || row.processedCount || 0) /
                    target) *
                  100
                ).toFixed(2),
              )
              : Number(row.achievementPct || 0),
        };
      }

      const processedCount = Number(derived.ok || 0) + Number(derived.ng || 0);
      const derivedQuality =
        processedCount > 0
          ? Number(
            ((Number(derived.ok || 0) / processedCount) * 100).toFixed(2),
          )
          : 0;
      const downtimeMinutes = Number(row.downtimeMinutes || 0);
      const plannedMinutes = Number(row.plannedProductionMinutes || 0);
      const effectiveCycleSeconds =
        Number(row.cycleTime ?? row.cycle_time ?? 0) +
        Number(row.loadingTime ?? row.loading_time ?? 0);
      const target =
        Number(row.targetProduction ?? row.targetQty ?? 0) ||
        (effectiveCycleSeconds > 0 && plannedMinutes > 0
          ? Math.floor((plannedMinutes * 60) / effectiveCycleSeconds)
          : 0);
      const derivedOa =
        processedCount > 0
          ? Number(row.oa || 0) ||
          (plannedMinutes > 0
            ? Number(
              (
                (Math.max(plannedMinutes - downtimeMinutes, 0) /
                  plannedMinutes) *
                100
              ).toFixed(2),
            )
            : 100)
          : 0;
      const derivedOee =
        processedCount > 0 ? Number(row.oee || 0) || derivedQuality : 0;

      return {
        ...row,
        okCount: Number(derived.ok || 0),
        ngCount: Number(derived.ng || 0),
        inProgressCount: Number(derived.inProgress || 0),
        interlockedCount: 0,
        processedCount,
        actualProduction: processedCount,
        targetProduction: target,
        targetQty: target,
        accuracy: derivedQuality,
        quality: derivedQuality,
        oa: derivedOa,
        oee: derivedOee,
        achievementPct:
          target > 0
            ? Number(((processedCount / target) * 100).toFixed(2))
            : Number(row.achievementPct || 0),
      };
    });
  }, [report.machineCards, report.partsList]);

  const efficiency = useMemo(() => {
    if (summary?.summary && summary.summary.okRate !== undefined) {
      return Number(summary.summary.okRate || 0);
    }
    if (
      reportMetrics &&
      (reportMetrics.totalOK !== undefined ||
        reportMetrics.totalNG !== undefined)
    ) {
      const ok = Number(reportMetrics.totalOK || 0);
      const ng = Number(reportMetrics.totalNG || 0);
      const totalFinal = ok + ng;
      return totalFinal > 0 ? Number(((ok / totalFinal) * 100).toFixed(2)) : 0;
    }
    const ok = Number(dashboardPartCounts.passed || 0);
    const ng = Number(dashboardPartCounts.failed || 0);
    const t = ok + ng;
    return t > 0 ? Number(((ok / t) * 100).toFixed(2)) : 100;
  }, [summary, dashboardPartCounts, reportMetrics]);

  // Pie data
  const pieData = useMemo(
    () => [
      {
        name: t("dashboard.pass", "Pass"),
        value: Number(dashboardPartCounts.passed || 0),
      },
      {
        name: t("dashboard.fail", "Fail"),
        value: Number(dashboardPartCounts.failed || 0),
      },
      {
        name: t("dashboard.inProgress", "In Progress"),
        value: Number(dashboardPartCounts.inProgress || 0),
      },
    ],
    [dashboardPartCounts, t],
  );

  const dashboardShifts = useMemo(() => {
    const rows = [
      ...(shiftManagerShifts || []).filter(Boolean),
      ...(report.availableShifts || []).filter(Boolean),
      ...(summary.availableShifts || []).filter(Boolean),
    ];
    const seen = new Set();
    const normalized = rows
      .map((shift) => {
        const code = normalizeDashboardShiftCode(
          shift?.shiftCode || shift?.shift_code,
        );
        const startTime = shift?.startTime || shift?.start_time;
        const endTime = shift?.endTime || shift?.end_time;
        if (
          !code ||
          code === "UNASSIGNED" ||
          !startTime ||
          !endTime ||
          seen.has(code)
        )
          return null;
        seen.add(code);
        return {
          ...shift,
          shiftCode: code,
          shiftName:
            shift?.shiftName ||
            shift?.shift_name ||
            getDashboardShiftLabel(code),
          startTime,
          endTime,
        };
      })
      .filter(Boolean);
    return normalized.length
      ? normalized.sort(
        (a, b) =>
          (getDashboardShiftSeconds(a.startTime) ?? 0) -
          (getDashboardShiftSeconds(b.startTime) ?? 0),
      )
      : ["SHIFT_A", "SHIFT_B", "SHIFT_C"].map((code) => ({
        shiftCode: code,
        shiftName: getDashboardShiftLabel(code),
        startTime: "",
        endTime: "",
      }));
  }, [report.availableShifts, shiftManagerShifts, summary.availableShifts]);

  // Shift bar data follows Shift Management and keeps configured shifts visible.
  const shiftData = useMemo(() => {
    const shiftLabelByCode = dashboardShifts.reduce((acc, shift) => {
      acc[normalizeDashboardShiftCode(shift.shiftCode || shift.shift_code)] =
        shift.shiftName ||
        shift.shift_name ||
        getDashboardShiftLabel(shift.shiftCode || shift.shift_code);
      return acc;
    }, {});
    const shiftOrder = dashboardShifts
      .map((shift) =>
        normalizeDashboardShiftCode(shift.shiftCode || shift.shift_code),
      )
      .filter(Boolean);

    const toShiftRows = (normalizedMap) => {
      return shiftOrder.map((code) => {
        const row = normalizedMap[code] || {};
        const ok = Number(row.ok || 0);
        const ng = Number(row.ng || 0);
        const inProgress = Number(row.inProgress || 0);
        const total = Number(row.total || 0);

        return {
          code,
          name: shiftLabelByCode[code] || getDashboardShiftLabel(code),
          actual: total || ok + ng + inProgress,
          ok,
          ng,
          inProgress,
          target: Number(row.target || 0),
          oee: Number(row.oee || 0),
          oa: Number(row.oa || 0),
        };
      });
    };

    const reconcileShiftRows = (rows) => {
      if (filters?.datePreset === "today" || !filters?.datePreset) {
        const now = new Date();
        const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        const elapsedSince6AM = currentSeconds >= 21600 ? currentSeconds - 21600 : currentSeconds + (24 * 3600 - 21600);
        
        return rows.map(row => {
          const shiftDef = dashboardShifts.find(s => normalizeDashboardShiftCode(s.shiftCode || s.shift_code) === row.code);
          if (shiftDef) {
            const startSec = getDashboardShiftSeconds(shiftDef.startTime || shiftDef.start_time);
            if (startSec !== null) {
              const shiftStartElapsed = startSec >= 21600 ? startSec - 21600 : startSec + (24 * 3600 - 21600);
              if (shiftStartElapsed > elapsedSince6AM) {
                return { ...row, actual: 0, ok: 0, ng: 0, inProgress: 0, target: 0, oa: 0, oee: 0 };
              }
            }
          }
          return row;
        });
      }
      return rows;
    };

    // Try to get data directly from RICO_IOT ProductionReports summary
    if (
      summary?.shiftProduction &&
      typeof summary.shiftProduction === "object" &&
      Object.keys(summary.shiftProduction).length > 0
    ) {
      const sp = summary.shiftProduction;
      const normalizedMap = {};
      ["A", "B", "C"].forEach((code) => {
        const item = sp[code] || sp[`SHIFT_${code}`] || {};
        normalizedMap[code] = {
          total: Number(item.total || 0),
          ok: Number(item.ok || 0),
          ng: Number(item.ng || 0),
          inProgress: 0,
          target: 0,
        };
      });
      return reconcileShiftRows(toShiftRows(normalizedMap));
    }

    // Try to get data from reportMetrics
    if (
      reportMetrics?.byShift &&
      typeof reportMetrics.byShift === "object" &&
      Object.keys(reportMetrics.byShift).length > 0
    ) {
      const normalizedMap = Object.entries(reportMetrics.byShift).reduce(
        (acc, [key, row]) => {
          const code = normalizeDashboardShiftCode(
            row?.shiftCode || row?.shift_code || key,
          );
          if (!acc[code])
            acc[code] = { total: 0, ok: 0, ng: 0, inProgress: 0, target: 0 };
          acc[code].total += Number(
            row?.total || row?.totalProduction || row?.actualProduction || 0,
          );
          acc[code].ok += Number(row?.ok || row?.totalOK || row?.passed || 0);
          acc[code].ng += Number(row?.ng || row?.totalNG || row?.failed || 0);
          acc[code].inProgress += Number(
            row?.inProgress || row?.wip || row?.active || 0,
          );
          acc[code].target += Number(
            row?.target || row?.targetProduction || row?.targetQty || 0,
          );
          return acc;
        },
        {},
      );
      return reconcileShiftRows(toShiftRows(normalizedMap));
    }

    // Try from dashboardParts
    const shiftRowsFromParts = (dashboardParts || []).reduce((acc, part) => {
      const shiftTime =
        part?.finalStatus === "PASSED" || part?.finalStatus === "FAILED"
          ? part?.latestCreatedAt || part?.createdAt
          : part?.latestCreatedAt || part?.createdAt;
      const code = resolveDashboardShiftCodeForDate(
        shiftTime,
        dashboardShifts,
      );
      if (code === "UNASSIGNED") return acc;
      if (!acc[code])
        acc[code] = { total: 0, ok: 0, ng: 0, inProgress: 0, target: 0 };
      acc[code].total += 1;
      if (part?.finalStatus === "PASSED") acc[code].ok += 1;
      else if (part?.finalStatus === "FAILED") acc[code].ng += 1;
      else acc[code].inProgress += 1;
      return acc;
    }, {});
    if (Object.keys(shiftRowsFromParts).length > 0)
      return reconcileShiftRows(toShiftRows(shiftRowsFromParts));

    // Try from report.shiftProduction
    if (
      report.shiftProduction &&
      Object.keys(report.shiftProduction || {}).length > 0
    ) {
      const normalizedMap = Object.entries(report.shiftProduction || {}).reduce(
        (acc, [key, row]) => {
          const code = normalizeDashboardShiftCode(
            row?.shiftCode || row?.shift_code || key,
          );
          if (!acc[code])
            acc[code] = { total: 0, ok: 0, ng: 0, inProgress: 0, target: 0 };
          acc[code].total += Number(row?.total || 0);
          acc[code].ok += Number(row?.ok || row?.totalOK || row?.passed || 0);
          acc[code].ng += Number(row?.ng || row?.totalNG || row?.failed || 0);
          acc[code].inProgress += Number(
            row?.inProgress || row?.wip || row?.active || 0,
          );
          return acc;
        },
        {},
      );
      return reconcileShiftRows(toShiftRows(normalizedMap));
    }

    // Try from shiftWiseMetrics
    const shiftRowsFromMetrics = (report.shiftWiseMetrics || []).reduce(
      (acc, row) => {
        const code = normalizeDashboardShiftCode(
          row?.shiftCode || row?.shift_code,
        );
        if (!code || code === "UNASSIGNED") return acc;
        if (!acc[code])
          acc[code] = { total: 0, ok: 0, ng: 0, inProgress: 0, target: 0 };
        acc[code].total += Number(
          row?.actualProduction || row?.actual || row?.total || 0,
        );
        acc[code].target += Number(row?.targetProduction || row?.target || 0);
        return acc;
      },
      {},
    );
    if (Object.keys(shiftRowsFromMetrics).length > 0)
      return reconcileShiftRows(toShiftRows(shiftRowsFromMetrics));

    // Try from partsList
    const shiftRowsFromStationRows = (report.partsList || []).reduce(
      (acc, row) => {
        const scanTime =
          row?.createdAt ||
          row?.createdAtRaw ||
          row?.firstScanAt ||
          row?.latestCreatedAt;
        const code = resolveDashboardShiftCodeForDate(
          scanTime,
          dashboardShifts,
        );
        if (code === "UNASSIGNED") return acc;
        if (!acc[code])
          acc[code] = { total: 0, ok: 0, ng: 0, inProgress: 0, target: 0 };
        const normalizedStatus = normalizeDashboardStationResult(
          row?.result ||
          row?.status ||
          row?.statusLabel ||
          row?.industrialResult,
          row?.interlockReason || row?.reason,
          row,
        );
        acc[code].total += 1;
        if (normalizedStatus === "OK") acc[code].ok += 1;
        else if (normalizedStatus === "NG") acc[code].ng += 1;
        else acc[code].inProgress += 1;
        return acc;
      },
      {},
    );
    if (Object.keys(shiftRowsFromStationRows).length > 0)
      return reconcileShiftRows(toShiftRows(shiftRowsFromStationRows));

    // Try from hourlyProduction
    const shiftRowsFromHourly = (report.hourlyProduction || []).reduce(
      (acc, row) => {
        const hourValue = row?.hour || row?.time || row?.bucket;
        const code = resolveDashboardShiftCodeForDate(
          hourValue,
          dashboardShifts,
        );
        if (code === "UNASSIGNED") return acc;
        if (!acc[code])
          acc[code] = { total: 0, ok: 0, ng: 0, inProgress: 0, target: 0 };
        acc[code].total += Number(row?.total || 0);
        acc[code].ok += Number(row?.ok || row?.pass || row?.passed || 0);
        acc[code].ng += Number(row?.ng || row?.fail || row?.failed || 0);
        acc[code].inProgress += Number(row?.inProgress || row?.wip || 0);
        return acc;
      },
      {},
    );
    if (Object.keys(shiftRowsFromHourly).length > 0)
      return reconcileShiftRows(toShiftRows(shiftRowsFromHourly));

    return reconcileShiftRows(toShiftRows({}));
  }, [
    dashboardParts,
    dashboardShifts,
    report.hourlyProduction,
    report.partsList,
    report.shiftProduction,
    report.shiftWiseMetrics,
    reportMetrics,
    summary.shiftProduction,
  ]);

  const hasFilters = Object.values(filters).some(Boolean);
  const rejectionAnalysisRows = useMemo(() => {
    return dashboardParts
      .filter((part) => part.finalStatus === "FAILED")
      .map((part) => ({
        partId: part.partId || "-",
        reason: String(part.rejectionReason || "").trim(),
        category: String(part.rejectionCategory || "").trim(),
        view: String(part.rejectionView || "").trim(),
        zone: String(part.rejectionZone || "").trim(),
        rejectionReasonOnly: String(part.rejectionReasonOnly || "").trim(),
        result: "NG",
        createdAt: part.latestCreatedAt || part.createdAt || null,
      }))
      .filter((part) => part.reason);
  }, [dashboardParts]);

  const rejectionFilterOptions = useMemo(() => {
    const matches = (row, ignoredKey) =>
      Object.entries(rejectionFilters).every(([key, value]) => {
        if (key === ignoredKey || !value) return true;
        const rowValue =
          key === "reason" ? row.rejectionReasonOnly || row.reason : row[key];
        return (
          String(rowValue || "").toUpperCase() === String(value).toUpperCase()
        );
      });
    const values = (key) =>
      Array.from(
        new Set(
          rejectionAnalysisRows
            .filter((row) => matches(row, key))
            .map((row) =>
              String(
                key === "reason"
                  ? row.rejectionReasonOnly || row.reason
                  : row[key] || "",
              ).trim(),
            )
            .filter(Boolean),
        ),
      ).sort();
    const merge = (recorded, configured) =>
      Array.from(new Set([...recorded, ...configured].filter(Boolean))).sort();
    const categoryOptions = Array.from(
      new Map(
        [
          ...values("category"),
          ...(heatMapConfig?.categories || []).map(
            (row) => row.label || row.name,
          ),
        ]
          .filter(Boolean)
          .map((value) => [
            rejectionCategoryCode(value),
            rejectionCategoryLabel(value),
          ]),
      ).values(),
    );
    return {
      category: categoryOptions,
      view: merge(
        values("view"),
        (heatMapConfig?.views || []).map((row) => row.name),
      ),
      zone: merge(
        values("zone"),
        (heatMapConfig?.views || []).flatMap((view) =>
          (view.zones || []).map((zone) => zone.name || zone.code),
        ),
      ),
      reason: merge(
        values("reason"),
        (heatMapConfig?.categories || []).flatMap((category) =>
          (category.reasons || []).map((reason) => reason.name || reason),
        ),
      ),
    };
  }, [rejectionAnalysisRows, rejectionFilters, heatMapConfig]);

  const filteredRejectionRows = useMemo(
    () =>
      rejectionAnalysisRows.filter((row) => {
        const reason = String(row.rejectionReasonOnly || row.reason || "");
        const categoryFilter = rejectionCategoryCode(rejectionFilters.category);
        const rowCategory = rejectionCategoryCode(
          `${row.category} ${row.rejectionReasonOnly || row.reason}`,
        );
        return (
          (!rejectionFilters.category || rowCategory === categoryFilter) &&
          (!rejectionFilters.view ||
            normalizeAnalysisToken(row.view) ===
            normalizeAnalysisToken(rejectionFilters.view)) &&
          (!rejectionFilters.zone ||
            normalizeAnalysisToken(row.zone) ===
            normalizeAnalysisToken(rejectionFilters.zone)) &&
          (!rejectionFilters.reason ||
            normalizeAnalysisToken(reason) ===
            normalizeAnalysisToken(rejectionFilters.reason))
        );
      }),
    [rejectionAnalysisRows, rejectionFilters],
  );

  const rejectionZoneWise = useMemo(() => {
    const grouped = filteredRejectionRows.reduce((acc, row) => {
      const key = [row.view || "View", row.zone || "Zone"].join(" / ");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filteredRejectionRows]);

  const heatMapView = useMemo(
    () =>
      (heatMapConfig?.views || []).find(
        (view) => String(view.id) === String(heatMapViewId),
      ) ||
      heatMapConfig?.views?.[0] ||
      null,
    [heatMapConfig, heatMapViewId],
  );
  const heatMapZoneCounts = useMemo(() => {
    const counts = {};
    filteredRejectionRows
      .filter(
        (row) =>
          !heatMapView?.name ||
          normalizeAnalysisToken(row.view) ===
          normalizeAnalysisToken(heatMapView.name),
      )
      .forEach((row) => {
        const key = normalizeAnalysisToken(row.zone);
        if (key) counts[key] = (counts[key] || 0) + 1;
      });
    return counts;
  }, [filteredRejectionRows, heatMapView]);
  const heatMapSubZoneCounts = useMemo(() => {
    const counts = {};
    (heatMapConfig?.mappings || []).forEach((mapping) => {
      if (!mapping.subZoneId) return;
      const key = String(mapping.subZoneId);
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [heatMapConfig]);
  const heatMapMax = useMemo(
    () => Math.max(1, ...Object.values(heatMapZoneCounts).map(Number)),
    [heatMapZoneCounts],
  );

  const rejectionPieData = useMemo(() => {
    const grouped = filteredRejectionRows.reduce((acc, row) => {
      const k = normalizeRejectionType(
        `${row.category || ""} ${row.rejectionReasonOnly || row.reason || row.interlock_reason || ""}`,
      );
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    const rows = [
      {
        name: "CR - Casting Rejection",
        value: grouped["CR - Casting Defects"] || 0,
        color: C.ng(),
      },
      {
        name: "CRAM - Cram Rejection",
        value: grouped["CRAM - Cram Defects"] || 0,
        color: C.amber(),
      },
      {
        name: "MR - Machining Rejection",
        value: grouped["MR - Machining Rejection"] || 0,
        color: C.steel(),
      },
    ];
    const total = rows.reduce((sum, row) => sum + Number(row.value || 0), 0);
    return rows.map((row) => ({ ...row, total }));
  }, [filteredRejectionRows]);

  const rejectionTopReasons = useMemo(() => {
    const maxRejects = Number(
      dashboardPartCounts.failed || reportTraceabilityCounts?.failed || reportMetrics?.totalNG || 0,
    );
    const grouped = filteredRejectionRows.reduce((acc, row) => {
      const reason = String(
        row.rejectionReasonOnly || row.reason || row.interlock_reason || "",
      ).trim();
      if (!reason) return acc;
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
    let remaining = maxRejects > 0 ? maxRejects : Infinity;
    return Object.entries(grouped)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .map((row) => {
        const count = Math.min(Number(row.count || 0), remaining);
        remaining -= count;
        return { ...row, count };
      })
      .filter((row) => Number(row.count || 0) > 0)
      .slice(0, 6);
  }, [dashboardPartCounts.failed, filteredRejectionRows, reportMetrics]);

  const rejectionParetoData = useMemo(() => {
    if (Array.isArray(summary?.topDefects) && summary.topDefects.length > 0) {
      const total = summary.topDefects.reduce(
        (sum, row) => sum + Number(row.count || 0),
        0,
      );
      let cumulative = 0;
      return summary.topDefects.map((row) => {
        cumulative += Number(row.count || 0);
        return {
          reason: row.reason || "Defect",
          count: Number(row.count || 0),
          cumulative: total ? Math.round((cumulative / total) * 100) : 0,
        };
      });
    }
    const total = rejectionTopReasons.reduce(
      (sum, row) => sum + Number(row.count || 0),
      0,
    );
    let cumulative = 0;
    return rejectionTopReasons.map((row) => {
      cumulative += Number(row.count || 0);
      return {
        reason: row.reason,
        count: row.count,
        cumulative: total ? Math.round((cumulative / total) * 100) : 0,
      };
    });
  }, [summary?.topDefects, rejectionTopReasons]);

  const rejectionKpis = useMemo(() => {
    const total = filteredRejectionRows.length;
    const uniqueParts = new Set(
      filteredRejectionRows.map((row) => row.partId).filter(Boolean),
    ).size;
    const topReason = rejectionTopReasons[0] || null;
    const topZone = rejectionZoneWise[0] || null;
    return { total, uniqueParts, topReason, topZone };
  }, [filteredRejectionRows, rejectionTopReasons, rejectionZoneWise]);

  const rejectionTrend = useMemo(() => {
    const rows = filteredRejectionRows.map((row) => {
      const ts = new Date(row.timestamp || row.createdAt || Date.now());
      const slot = `${String(ts.getHours()).padStart(2, "0")}:00`;
      return {
        slot,
        category: normalizeRejectionType(
          `${row.category || ""} ${row.rejectionReasonOnly || row.reason || row.interlock_reason || ""}`,
        ),
      };
    });
    const bucket = rows.reduce((acc, row) => {
      if (!acc[row.slot])
        acc[row.slot] = { slot: row.slot, total: 0, cr: 0, cram: 0, mr: 0 };
      acc[row.slot].total += 1;
      if (row.category === "CR - Casting Defects") acc[row.slot].cr += 1;
      else if (row.category === "CRAM - Cram Defects") acc[row.slot].cram += 1;
      else acc[row.slot].mr += 1;
      return acc;
    }, {});
    return Object.values(bucket).sort((a, b) =>
      String(a.slot).localeCompare(String(b.slot)),
    );
  }, [filteredRejectionRows]);

  const productionTrendData = useMemo(() => {
    if (Array.isArray(trendsData) && trendsData.length > 0) {
      return trendsData.map((row) => ({
        hour: row.displayHour || (row.hour ? String(row.hour).slice(-5) : ""),
        date: row.hour || "",
        ok: Number(row.ok || 0),
        ng: Number(row.ng || 0),
        total: Number(row.total || 0),
      }));
    }

    const sourceRows = Array.isArray(dashboardParts) ? dashboardParts : [];
    if (!sourceRows.length) {
      return (Array.isArray(report.hourlyProduction) ? report.hourlyProduction : []).map(
        (row) => ({
          hour: row?.hour || row?.time || row?.slot || row?.bucket || "",
          ok: Number(row?.ok || row?.pass || row?.passed || 0),
          ng: Number(row?.ng || row?.fail || row?.failed || 0),
          total: Number(
            row?.total ||
            Number(row?.ok || row?.pass || row?.passed || 0) +
            Number(row?.ng || row?.fail || row?.failed || 0),
          ),
        }),
      );
    }

    const bucketMap = new Map();
    const ensureBucket = (key, label) => {
      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          key,
          date: label,
          hour: label,
          ok: 0,
          ng: 0,
          total: 0,
        });
      }
      return bucketMap.get(key);
    };

    sourceRows.forEach((row) => {
      const ts = new Date(row.latestCreatedAt || row.createdAt || Date.now());
      if (!Number.isFinite(ts.getTime())) return;

      const key = isMultiDayRange
        ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`
        : `${String(ts.getHours()).padStart(2, "0")}:00`;
      const bucket = ensureBucket(key, key);
      if (row.finalStatus === "PASSED") bucket.ok += 1;
      else if (row.finalStatus === "FAILED") bucket.ng += 1;
      bucket.total += 1;
    });

    if (!isMultiDayRange) {
      return Array.from({ length: 24 }, (_, index) => {
        const hour = `${String(index).padStart(2, "0")}:00`;
        const existing = bucketMap.get(hour);
        return {
          hour,
          date: hour,
          ok: Number(existing?.ok || 0),
          ng: Number(existing?.ng || 0),
          total: Number(existing?.total || 0),
        };
      });
    }

    return Array.from(bucketMap.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [trendsData, dashboardParts, isMultiDayRange, report.hourlyProduction]);

  const rejectionTrendData = useMemo(() => {
    if (!isMultiDayRange) return rejectionTrend;
    const rows = filteredRejectionRows.map((row) => {
      const ts = new Date(row.createdAt || Date.now());
      const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
      return {
        key,
        category: normalizeRejectionType(
          `${row.category || ""} ${row.rejectionReasonOnly || row.reason || row.interlock_reason || ""}`,
        ),
      };
    });
    const bucket = rows.reduce((acc, row) => {
      if (!acc[row.key])
        acc[row.key] = { date: row.key, total: 0, cr: 0, cram: 0, mr: 0 };
      acc[row.key].total += 1;
      if (row.category === "CR - Casting Defects") acc[row.key].cr += 1;
      else if (row.category === "CRAM - Cram Defects") acc[row.key].cram += 1;
      else acc[row.key].mr += 1;
      return acc;
    }, {});
    return Object.values(bucket).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );
  }, [isMultiDayRange, rejectionTrend, filteredRejectionRows]);

  const analysisMachineRows = useMemo(() => {
    const filteredCards = Array.isArray(dashboardMachineCards)
      ? dashboardMachineCards
      : [];
    if (filteredCards.length > 0) return filteredCards;
    return Array.isArray(oeeData) ? oeeData : [];
  }, [dashboardMachineCards, oeeData]);
  const isInitialDashboardLoading =
    loading &&
    Number(summary?.machines?.total || 0) === 0 &&
    !report.machineCards?.length &&
    !report.stationCards?.length &&
    !report.hourlyProduction?.length;

  // —— Tabs config ——
  const TABS = [
    {
      id: "overview",
      label: t("dashboard.overviewTab", "Overview"),
      icon: BarChart3,
    },
    {
      id: "machines",
      label: t("dashboard.machineKpisTab", "Machine KPIs"),
      icon: Cpu,
    },
    {
      id: "oee",
      label: t("dashboard.oeeAnalysisTab", "OEE Analysis"),
      icon: Activity,
    },
    {
      id: "oa",
      label: t("dashboard.oaAnalysisTab", "OA Analysis"),
      icon: Target,
    },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        paddingBottom: 32,
        animation: "dbFadeIn 0.3s ease",
      }}
    >
      {/* —— Page Header ————————————————————————————————————————————————————————— */}
      <div
        style={{
          background: C.bg("card"),
          border: `1px solid ${C.bdr()}`,
          borderRadius: 16,
          padding: "18px 20px",
          boxShadow: SHADOW,
          overflow: "visible",
          position: "relative",
          zIndex: 30,
        }}
      >
        <div
          style={{
            height: 3,
            background: `linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`,
            margin: "-18px -20px 16px",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 13,
                background: `linear-gradient(135deg,${C.navy()},${C.steel(0.8)})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: `0 4px 14px ${C.navy(0.35)}`,
              }}
            >
              <BarChart3 size={22} color={C.linen()} />
            </div>
            <div>
              <h1
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: C.txt("pri"),
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                  fontFamily: "var(--font-outfit)",
                }}
              >
                {t("dashboard.pageTitle", "Dashboard Overview")}
              </h1>
              <p
                style={{
                  marginTop: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  color: C.navy(),
                  background: C.navy(0.08),
                  border: `1px solid ${C.navy(0.2)}`,
                  letterSpacing: "0.03em",
                }}
              >
                {lineContextLabel}
              </p>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {/* Quick Preset Pills */}
            <div
              style={{
                display: "inline-flex",
                background: C.bg("surf"),
                padding: 3,
                borderRadius: 9,
                border: `1px solid ${C.bdr()}`,
              }}
            >
              {[
                { id: "today", label: "Today" },
                { id: "yesterday", label: "Yesterday" },
                { id: "last7", label: "7 Days" },
                { id: "last30", label: "30 Days" },
                { id: "all", label: "All Time" },
              ].map((preset) => {
                const isActive = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      setActivePreset(preset.id);
                      if (preset.id === "all") {
                        setFilters((prev) => ({
                          ...prev,
                          dateFrom: "",
                          dateTo: "",
                        }));
                        setIsLiveProductionRange(false);
                      } else {
                        const range = getPresetRange(preset.id);
                        setFilters((prev) => ({
                          ...prev,
                          dateFrom: range.start,
                          dateTo: range.end,
                        }));
                        setIsLiveProductionRange(preset.id === "today");
                      }
                    }}
                    style={{
                      height: 32,
                      padding: "0 12px",
                      borderRadius: 7,
                      fontSize: 11,
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                      background: isActive ? C.navy() : "transparent",
                      color: isActive ? C.linen() : C.txt("sec"),
                      transition: "all 0.15s",
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Date Range Picker (ONLY filter on the page) */}
            <div style={{ minWidth: 240 }}>
              <DashboardDateRangePicker
                startDate={filters.dateFrom}
                endDate={filters.dateTo}
                onApply={(start, end) => {
                  const currentRange = getCurrentDashboardProductionRange();
                  const cappedEnd = new Date(end);
                  if (
                    new Date(start).toDateString() ===
                    new Date(currentRange.start).toDateString() &&
                    cappedEnd > new Date(currentRange.end)
                  ) {
                    cappedEnd.setTime(new Date(currentRange.end).getTime());
                  }
                  setActivePreset("custom");
                  setFilters((prev) => ({
                    ...prev,
                    dateFrom: start.toISOString(),
                    dateTo: cappedEnd.toISOString(),
                  }));
                  setIsLiveProductionRange(false);
                }}
                onClear={() => {
                  const range = getCurrentDashboardProductionRange();
                  setActivePreset("today");
                  setFilters((prev) => ({
                    ...prev,
                    dateFrom: range.start,
                    dateTo: range.end,
                  }));
                  setIsLiveProductionRange(true);
                }}
              />
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => loadData(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 38,
                padding: "0 14px",
                borderRadius: 9,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                background: "transparent",
                border: `1px solid ${C.bdr()}`,
                color: C.txt("sec"),
                transition: "all 0.15s",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <RefreshCw
                size={13}
                style={{
                  animation: loading ? "dbSpin 0.9s linear infinite" : "none",
                }}
              />
              {loading
                ? t("dashboard.updating", "Updating...")
                : t("dashboard.refresh", "Refresh")}
            </button>
          </div>
        </div>
      </div>

      {/* —— KPI Row —————————————————————————————————————————————————————————————— */}
      {isInitialDashboardLoading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: 14,
            }}
          >
            <KpiCard
              label={t("dashboard.totalProduction", "Total Production")}
              value={dashboardTotalProduction}
              icon={Activity}
              accent={C.navy()}
              subValue="Scanned Parts"
              subtitle="parts"
              sub={t("dashboard.partsTrackedPeriod", "Parts tracked this period")}
            />
            <KpiCard
              label={t("dashboard.completedPass", "Passed (OK)")}
              value={dashboardPartCounts.passed || 0}
              icon={CheckCircle2}
              accent={C.ok()}
              subValue="Quality OK"
              subtitle={`${dashboardPartCounts.okRate ?? efficiency}% yield`}
              sub={t("dashboard.totalOkPeriod", "Total OK parts")}
            />
            <KpiCard
              label={t("dashboard.failedNg", "Failed (NG)")}
              value={dashboardPartCounts.failed || 0}
              icon={XCircle}
              accent={C.ng()}
              subValue="Quality NG"
              subtitle={`${dashboardPartCounts.scrapRate ?? 0}% scrap`}
              sub={t("dashboard.requiresAttention", "Requires attention")}
            />
            <KpiCard
              label={t("dashboard.inProgress", "In Progress")}
              value={dashboardPartCounts.inProgress || 0}
              icon={Clock}
              accent={C.wip()}
              subValue="Active WIP"
              subtitle="in transit"
              sub={t("dashboard.partsBeingProcessed", "Parts being processed")}
            />
            <KpiCard
              label={t("dashboard.qualityRate", "Quality Rate")}
              value={`${efficiency}%`}
              icon={TrendingUp}
              accent={
                efficiency >= 85
                  ? C.ok()
                  : efficiency >= 60
                    ? C.amber()
                    : C.ng()
              }
              subValue="Line Yield"
              subtitle={efficiency >= 85 ? "Optimal" : "Attention"}
              sub={t("dashboard.overallQualityRate", "Overall quality rate")}
            />
          </div>

          {/* —— Tabs ————————————————————————————————————————————————————————————————————— */}
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "6px",
              background: C.bg("card"),
              border: `1px solid ${C.bdr()}`,
              borderRadius: 12,
              width: "fit-content",
              overflowX: "auto",
              maxWidth: "100%",
            }}
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              const TIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    height: 36,
                    padding: "0 16px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    background: active ? C.navy() : "transparent",
                    border: "none",
                    color: active ? C.linen() : C.txt("muted"),
                    boxShadow: active ? `0 2px 8px ${C.navy(0.3)}` : "none",
                    transition: "all 0.15s",
                  }}
                >
                  <TIcon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* —— TAB: Overview ———————————————————————————————————————————————————————————— */}
          {activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* —— Line OEE & OA Executive Summary —— */}
              <div
                style={{
                  background: C.bg("card"),
                  border: `1px solid ${C.bdr()}`,
                  borderRadius: 16,
                  padding: 22,
                  boxShadow: SHADOW_MD,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 4,
                    background: `linear-gradient(90deg, ${C.ok()}, ${C.navy()}, ${C.amber()}, ${C.steel()})`,
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 12,
                    marginBottom: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: C.navy(0.12),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.navy(),
                      }}
                    >
                      <Target size={20} />
                    </div>
                    <div>
                      <h2
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          color: C.txt("pri"),
                          letterSpacing: "-0.01em",
                          margin: 0,
                        }}
                      >
                        {t("dashboard.lineOeeOaOverview", "Line OEE & OA Performance Overview")}
                      </h2>
                      <p style={{ fontSize: 11, color: C.txt("muted"), margin: "2px 0 0" }}>
                        {t("dashboard.lineOeeSub", "Real-time Overall Equipment Effectiveness (OEE) and Operational Availability (OA) for active production line")}
                      </p>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 12px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background: lineOeeData.oee >= 85 ? C.ok(0.12) : lineOeeData.oee >= 70 ? C.amber(0.12) : C.ng(0.12),
                        color: lineOeeData.oee >= 85 ? C.ok() : lineOeeData.oee >= 70 ? C.amber() : C.ng(),
                        border: `1px solid ${lineOeeData.oee >= 85 ? C.ok(0.25) : lineOeeData.oee >= 70 ? C.amber(0.25) : C.ng(0.25)}`,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: lineOeeData.oee >= 85 ? C.ok() : lineOeeData.oee >= 70 ? C.amber() : C.ng(),
                        }}
                      />
                      {lineOeeData.status || "Optimal"}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 16,
                  }}
                >
                  {/* Line OEE Dial Card */}
                  <div
                    style={{
                      background: C.bg("surf"),
                      border: `1px solid ${C.bdr()}`,
                      borderRadius: 14,
                      padding: "16px 18px",
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        width: 100,
                        height: 100,
                        borderRadius: "50%",
                        background: `conic-gradient(${C.ok()} ${lineOeeData.oee * 3.6}deg, ${C.bdr(0.2)} 0deg)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 6,
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          borderRadius: "50%",
                          background: C.bg("surf"),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 24,
                            fontWeight: 800,
                            color: C.txt("pri"),
                            fontFamily: "'DM Mono',monospace",
                          }}
                        >
                          {lineOeeData.oee}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.txt("muted"), margin: 0 }}>
                        {t("dashboard.lineOee", "Line OEE")}
                      </p>
                      <h3 style={{ fontSize: 22, fontWeight: 800, color: C.txt("pri"), margin: "4px 0 2px", fontFamily: "'DM Mono',monospace" }}>
                        {lineOeeData.oee}%
                      </h3>
                      <p style={{ fontSize: 10, color: C.txt("sec"), margin: 0 }}>
                        {lineOeeData.oee >= 85 ? "World Class (≥85%)" : lineOeeData.oee >= 70 ? "Optimal Operating" : "Attention Needed"}
                      </p>
                    </div>
                  </div>

                  {/* Line OA Dial Card */}
                  <div
                    style={{
                      background: C.bg("surf"),
                      border: `1px solid ${C.bdr()}`,
                      borderRadius: 14,
                      padding: "16px 18px",
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        width: 100,
                        height: 100,
                        borderRadius: "50%",
                        background: `conic-gradient(${C.navy()} ${lineOeeData.oa * 3.6}deg, ${C.bdr(0.2)} 0deg)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 6,
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          borderRadius: "50%",
                          background: C.bg("surf"),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 24,
                            fontWeight: 800,
                            color: C.txt("pri"),
                            fontFamily: "'DM Mono',monospace",
                          }}
                        >
                          {lineOeeData.oa}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.txt("muted"), margin: 0 }}>
                        {t("dashboard.lineOa", "Line OA")}
                      </p>
                      <h3 style={{ fontSize: 22, fontWeight: 800, color: C.txt("pri"), margin: "4px 0 2px", fontFamily: "'DM Mono',monospace" }}>
                        {lineOeeData.oa}%
                      </h3>
                      <p style={{ fontSize: 10, color: C.txt("sec"), margin: 0 }}>
                        Operational Availability
                      </p>
                    </div>
                  </div>

                  {/* 3 Pillars Breakdown */}
                  <div
                    style={{
                      background: C.bg("surf"),
                      border: `1px solid ${C.bdr()}`,
                      borderRadius: 14,
                      padding: "14px 18px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: C.txt("muted"), textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        OEE 3-Pillars
                      </span>
                      <span style={{ fontSize: 10, color: C.txt("sec") }}>A × P × Q</span>
                    </div>

                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, marginBottom: 3 }}>
                        <span style={{ color: C.txt("sec") }}>Availability (A)</span>
                        <span style={{ color: C.txt("pri"), fontFamily: "'DM Mono',monospace" }}>{lineOeeData.availability}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: C.bdr(0.2), overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, lineOeeData.availability)}%`, height: "100%", background: C.navy(), borderRadius: 3 }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, marginBottom: 3 }}>
                        <span style={{ color: C.txt("sec") }}>Performance (P)</span>
                        <span style={{ color: C.txt("pri"), fontFamily: "'DM Mono',monospace" }}>{lineOeeData.performance}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: C.bdr(0.2), overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, lineOeeData.performance)}%`, height: "100%", background: C.amber(), borderRadius: 3 }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, marginBottom: 3 }}>
                        <span style={{ color: C.txt("sec") }}>Quality (Q)</span>
                        <span style={{ color: C.txt("pri"), fontFamily: "'DM Mono',monospace" }}>{lineOeeData.quality}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: C.bdr(0.2), overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, lineOeeData.quality)}%`, height: "100%", background: C.ok(), borderRadius: 3 }} />
                      </div>
                    </div>
                  </div>

                  {/* Production Target vs Actual Achievement */}
                  <div
                    style={{
                      background: C.bg("surf"),
                      border: `1px solid ${C.bdr()}`,
                      borderRadius: 14,
                      padding: "16px 18px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.txt("muted"), margin: 0 }}>
                          Target vs Actual
                        </p>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 22, fontWeight: 800, color: C.txt("pri"), fontFamily: "'DM Mono',monospace" }}>
                            {dashboardPartCounts.passed + dashboardPartCounts.failed || lineOeeData.actual || 0}
                          </span>
                          <span style={{ fontSize: 13, color: C.txt("muted"), fontFamily: "'DM Mono',monospace" }}>
                            / {lineOeeData.target || 0}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          background: C.navy(0.1),
                          color: C.navy(),
                          fontSize: 11,
                          fontWeight: 800,
                          fontFamily: "'DM Mono',monospace",
                        }}
                      >
                        {lineOeeData.target > 0
                          ? `${Math.min(100, Math.round(((dashboardPartCounts.passed + dashboardPartCounts.failed || lineOeeData.actual || 0) / lineOeeData.target) * 100))}%`
                          : "100%"}
                      </div>
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <div style={{ height: 8, borderRadius: 4, background: C.bdr(0.2), overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.min(100, lineOeeData.target > 0 ? (((dashboardPartCounts.passed + dashboardPartCounts.failed || lineOeeData.actual || 0) / lineOeeData.target) * 100) : 100)}%`,
                            height: "100%",
                            background: `linear-gradient(90deg, ${C.navy()}, ${C.ok()})`,
                            borderRadius: 4,
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.txt("muted"), marginTop: 5 }}>
                        <span>Total Inspected Parts</span>
                        <span>Target Scheduled</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* —— Station Quality Gates & Process Flow (As in Rejection Analysis) —— */}
              <div
                style={{
                  background: C.bg("card"),
                  border: `1px solid ${C.bdr()}`,
                  borderRadius: 16,
                  padding: 22,
                  boxShadow: SHADOW_MD,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: C.ok(0.12),
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.ok(),
                      }}
                    >
                      <Layers size={20} />
                    </div>
                    <div>
                      <h2
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          color: C.txt("pri"),
                          letterSpacing: "-0.01em",
                          margin: 0,
                        }}
                      >
                        {t("dashboard.stationQualityGates", "Station Quality Gates & Process Flow")}
                      </h2>
                      <p style={{ fontSize: 11, color: C.txt("muted"), margin: "2px 0 0" }}>
                        {t("dashboard.stationQualityGatesSub", "Real-time OK vs NG parts throughput across all manufacturing & inspection operations (OP100 – OP160)")}
                      </p>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {/* View Toggle */}
                    <button
                      type="button"
                      onClick={() => setShowAllGates((prev) => !prev)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        height: 32,
                        padding: "0 12px",
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                        background: showAllGates ? C.navy() : C.bg("surf"),
                        color: showAllGates ? C.linen() : C.txt("sec"),
                        border: `1px solid ${C.bdr()}`,
                        transition: "all 0.15s",
                      }}
                    >
                      <Cpu size={12} />
                      {showAllGates ? "Show Primary (7 Gates)" : "Show All (10 Gates)"}
                    </button>

                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 12px",
                        borderRadius: 8,
                        background: C.bg("surf"),
                        border: `1px solid ${C.bdr()}`,
                        fontSize: 11,
                        fontWeight: 700,
                        color: C.txt("sec"),
                      }}
                    >
                      <span>Line Scrap: <strong style={{ color: dashboardPartCounts.scrapRate > 2 ? C.ng() : C.ok() }}>{dashboardPartCounts.scrapRate}%</strong></span>
                    </div>
                  </div>
                </div>

                {/* Station Cards Grid */}
                {((showAllGates ? stationQualityGates : primaryQualityGates) || []).length > 0 ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {(showAllGates ? stationQualityGates : primaryQualityGates).map((gate) => {
                      const isDanger = gate.scrapRate > 5;
                      const isWarning = gate.scrapRate >= 2 && gate.scrapRate <= 5;
                      const statusColor = isDanger ? C.ng() : isWarning ? C.amber() : C.ok();
                      const statusLabel = isDanger ? "CRITICAL" : isWarning ? "WATCH" : "OPTIMAL";
                      const isOp150 = gate.code === "OP150";

                      return (
                        <div
                          key={gate.code}
                          style={{
                            background: C.bg("surf"),
                            border: `1px solid ${isDanger ? C.ng(0.4) : isWarning ? C.amber(0.35) : C.bdr()}`,
                            borderRadius: 12,
                            padding: "14px 16px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: 10,
                            position: "relative",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {/* Card Header */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 800,
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                  background: C.navy(0.12),
                                  color: C.navy(),
                                  border: `1px solid ${C.navy(0.2)}`,
                                  fontFamily: "'DM Mono',monospace",
                                }}
                              >
                                {gate.code}
                              </span>
                              <div>
                                <h4 style={{ fontSize: 13, fontWeight: 700, color: C.txt("pri"), margin: 0, lineHeight: 1.2 }}>
                                  {gate.name}
                                </h4>
                                <span style={{ fontSize: 10, color: C.txt("muted") }}>
                                  {gate.inspected?.toLocaleString()} inspected
                                </span>
                              </div>
                            </div>

                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 800,
                                padding: "2px 7px",
                                borderRadius: 4,
                                background: statusColor === C.ok() ? C.ok(0.12) : statusColor === C.amber() ? C.amber(0.12) : C.ng(0.12),
                                color: statusColor,
                                border: `1px solid ${statusColor}`,
                                letterSpacing: "0.05em",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          {/* Dual OK / NG Progress Bar */}
                          <div>
                            <div
                              style={{
                                display: "flex",
                                height: 6,
                                borderRadius: 3,
                                overflow: "hidden",
                                background: C.bdr(0.2),
                              }}
                            >
                              <div
                                style={{
                                  width: `${Math.max(0, Math.min(100, gate.okRate || 0))}%`,
                                  height: "100%",
                                  background: C.ok(),
                                  transition: "width 0.3s ease",
                                }}
                                title={`OK: ${gate.okRate}%`}
                              />
                              <div
                                style={{
                                  width: `${Math.max(0, Math.min(100, gate.scrapRate || 0))}%`,
                                  height: "100%",
                                  background: C.ng(),
                                  transition: "width 0.3s ease",
                                }}
                                title={`NG: ${gate.scrapRate}%`}
                              />
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, fontSize: 11 }}>
                              <span style={{ color: C.ok(), fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <CheckCircle2 size={12} />
                                OK: {gate.okCount?.toLocaleString()} ({gate.okRate}%)
                              </span>
                              <span style={{ color: C.ng(), fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <XCircle size={12} />
                                NG: {gate.ngCount?.toLocaleString()} ({gate.scrapRate}%)
                              </span>
                            </div>
                          </div>

                          {/* Sub-Station Chips for OP150 Leak Testing */}
                          {isOp150 && gate.subStations && gate.subStations.length > 0 && (
                            <div
                              style={{
                                borderTop: `1px dashed ${C.bdr(0.2)}`,
                                paddingTop: 8,
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                              }}
                            >
                              <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: C.txt("muted") }}>
                                Leak Sub-Stations
                              </span>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {gate.subStations.map((sub) => (
                                  <div
                                    key={sub.code}
                                    style={{
                                      fontSize: 10,
                                      padding: "3px 6px",
                                      borderRadius: 5,
                                      background: sub.scrapRate > 3 ? C.ng(0.08) : C.bg("card"),
                                      border: `1px solid ${sub.scrapRate > 3 ? C.ng(0.25) : C.bdr()}`,
                                      color: C.txt("pri"),
                                      fontWeight: 600,
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 4,
                                    }}
                                  >
                                    <strong style={{ color: C.navy(), fontFamily: "'DM Mono',monospace" }}>
                                      {sub.code.replace("Leak-Test-", "LT").replace("Leak Test-", "LT")}
                                    </strong>
                                    <span>{sub.okCount} OK</span>
                                    <span style={{ color: C.ng() }}>/ {sub.ngCount} NG</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: C.txt("muted"), textAlign: "center", padding: "20px 0" }}>
                    No quality gate data recorded for this period.
                  </p>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "300px 1fr",
                  gap: 16,
                  flexWrap: "wrap",
                }}
                className="db-grid-responsive"
              >
                <style>{`@media(max-width:900px){.db-grid-responsive{grid-template-columns:1fr!important}}`}</style>

                <div
                  style={{
                    background: C.bg("card"),
                    border: `1px solid ${C.bdr()}`,
                    borderRadius: 14,
                    padding: 20,
                    boxShadow: SHADOW,
                  }}
                >
                  <SectionHead
                    title={t("dashboard.passFailSplit", "Pass / Fail Split")}
                  />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: 160,
                        height: 160,
                        minWidth: 1,
                        minHeight: 1,
                      }}
                    >
                      <SafeChart height={160}>
                        {({ width, height }) => (
                          <PieChart width={width} height={height}>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={75}
                              paddingAngle={3}
                              dataKey="value"
                              strokeWidth={0}
                              labelLine={false}
                            >
                              {pieData.map((entry, index) => (
                                <Cell
                                  key={entry.name}
                                  fill={
                                    [C.ok(), C.ng(), C.wip()][index] ||
                                    C.steel()
                                  }
                                />
                              ))}
                            </Pie>
                            <Tooltip {...TooltipStyle} />
                          </PieChart>
                        )}
                      </SafeChart>
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <p
                          style={{
                            fontSize: 22,
                            fontWeight: 800,
                            color: C.txt("pri"),
                            fontFamily: "'DM Mono',monospace",
                            lineHeight: 1,
                          }}
                        >
                          {efficiency}%
                        </p>
                        <p
                          style={{
                            fontSize: 10,
                            color: C.txt("muted"),
                            marginTop: 2,
                          }}
                        >
                          {t("dashboard.qualityRate", "Quality Rate")}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 6,
                    }}
                  >
                    {[
                      {
                        label: t("dashboard.pass", "Pass"),
                        value: dashboardPartCounts.passed || 0,
                        color: C.ok(),
                      },
                      {
                        label: t("dashboard.fail", "Fail"),
                        value: dashboardPartCounts.failed || 0,
                        color: C.ng(),
                      },
                      {
                        label: t("dashboard.inProgress", "In Progress"),
                        value: dashboardPartCounts.inProgress || 0,
                        color: C.wip(),
                      },
                    ].map((s) => (
                      <div
                        key={s.label}
                        style={{
                          background: C.bg("surf"),
                          border: `1px solid ${C.bdr()}`,
                          borderRadius: 10,
                          padding: "10px 8px",
                          textAlign: "center",
                        }}
                      >
                        <p
                          style={{
                            fontSize: 20,
                            fontWeight: 800,
                            color: s.color,
                            fontFamily: "'DM Mono',monospace",
                            lineHeight: 1,
                          }}
                        >
                          {s.value}
                        </p>
                        <p
                          style={{
                            fontSize: 9,
                            color: C.txt("muted"),
                            marginTop: 4,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                          }}
                        >
                          {s.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    background: C.bg("card"),
                    border: `1px solid ${C.bdr()}`,
                    borderRadius: 14,
                    padding: 20,
                    boxShadow: SHADOW,
                  }}
                >
                  <SectionHead
                    title={
                      isMultiDayRange
                        ? t("dashboard.productionTrend", "Production Trend")
                        : t("dashboard.hourlyProduction", "Hourly Production")
                    }
                    right={
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: C.ok(),
                            animation: "dbPing 1.6s ease-out infinite",
                            opacity: 0.7,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            color: C.ok(),
                            fontWeight: 700,
                          }}
                        >
                          {t("dashboard.live", "Live")}
                        </span>
                      </div>
                    }
                  />
                  <SafeChart
                    height={220}
                    style={{
                      overflow: "visible",
                      position: "relative",
                      zIndex: 20,
                    }}
                  >
                    {({ width, height }) => (
                      <BarChart
                        width={width}
                        height={height}
                        data={productionTrendData}
                        margin={{ top: 10, right: 10, bottom: 0, left: -10 }}
                      >
                        <CartesianGrid
                          stroke={C.bdr(0.12)}
                          strokeDasharray="3 4"
                          vertical={false}
                        />
                        <XAxis
                          dataKey={isMultiDayRange ? "date" : "hour"}
                          tickFormatter={(h) => {
                            const str = String(h || "");
                            if (isMultiDayRange) return str.length > 5 ? str.slice(5) : str;
                            return str.includes(":") ? str : `${str.padStart(2, "0")}:00`;
                          }}
                          tick={{
                            fontSize: 11,
                            fill: C.txt("sec"),
                            fontFamily: "'DM Mono',monospace",
                          }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: C.txt("sec") }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          {...TooltipStyle}
                          labelFormatter={(h) => {
                            const str = String(h || "");
                            if (isMultiDayRange) return str;
                            return str.includes(":") ? str : `${str.padStart(2, "0")}:00`;
                          }}
                          contentStyle={{
                            ...TooltipStyle.contentStyle,
                            padding: "12px 16px",
                            borderRadius: 12,
                          }}
                        />
                        <Bar
                          dataKey="ok"
                          name="Passed"
                          fill={C.ok()}
                          radius={[4, 4, 0, 0]}
                          barSize={20}
                        />
                        <Bar
                          dataKey="ng"
                          name="NG"
                          fill={C.ng()}
                          radius={[4, 4, 0, 0]}
                          barSize={20}
                        />
                      </BarChart>
                    )}
                  </SafeChart>
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      marginTop: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    {[
                      { color: C.ok(), label: t("dashboard.pass", "Pass") },
                      { color: C.ng(), label: t("dashboard.fail", "Fail") },
                    ].map((l) => (
                      <div
                        key={l.label}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 2.5,
                            borderRadius: 2,
                            background: l.color,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            color: C.txt("muted"),
                            fontWeight: 600,
                          }}
                        >
                          {l.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
                className="db-grid-2"
              >
                <style>{`@media(max-width:800px){.db-grid-2{grid-template-columns:1fr!important}}`}</style>

                <div style={{
                  background: C.bg("card"),
                  border: `1px solid ${C.bdr()}`,
                  borderRadius: 14,
                  padding: 20,
                  boxShadow: SHADOW
                }}>
                  <SectionHead title={t("dashboard.productionByShift", "Production by Shift")} />
                  {shiftData.length > 0 ? (
                    <SafeChart height={220} style={{ overflow: "visible", position: "relative", zIndex: 2 }}>
                      {({ width, height }) => (
                        <BarChart
                          width={width}
                          height={height}
                          data={shiftData}
                          margin={{ top: 10, right: 10, bottom: 0, left: -10 }}
                        >
                          <CartesianGrid stroke={C.bdr(0.12)} strokeDasharray="3 4" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.txt("sec") }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: C.txt("sec") }} axisLine={false} tickLine={false} />
                          <Tooltip
                            {...TooltipStyle}
                            contentStyle={{
                              ...TooltipStyle.contentStyle,
                              padding: "12px 16px",
                              borderRadius: 12,
                            }}
                          />
                          <Bar dataKey="ok" name="Passed" fill={C.ok()} radius={[4, 4, 0, 0]} barSize={28} />
                          <Bar dataKey="ng" name="NG" fill={C.ng()} radius={[4, 4, 0, 0]} barSize={28} />
                        </BarChart>
                      )}
                    </SafeChart>
                  ) : (
                    <p style={{ fontSize: 12, color: C.txt("muted"), textAlign: "center", padding: "20px 0" }}>
                      No shift data available for this period.
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      marginTop: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    {[
                      { color: C.ok(), label: t("dashboard.pass", "Pass") },
                      { color: C.ng(), label: t("dashboard.fail", "Fail") },
                    ].map((l) => (
                      <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 18, height: 2.5, borderRadius: 2, background: l.color }} />
                        <span style={{ fontSize: 11, color: C.txt("muted"), fontWeight: 600 }}>{l.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    background: C.bg("card"),
                    border: `1px solid ${C.bdr()}`,
                    borderRadius: 14,
                    padding: 20,
                    boxShadow: SHADOW,
                  }}
                >
                  <SectionHead title="Rejection Pareto" />
                  {rejectionParetoData.length > 0 ? (
                    <SafeChart
                      height={220}
                      style={{
                        overflow: "visible",
                        position: "relative",
                        zIndex: 2,
                      }}
                    >
                      {({ width, height }) => (
                        <ComposedChart
                          width={width}
                          height={height}
                          data={rejectionParetoData}
                          margin={{ top: 12, right: 12, left: -10, bottom: 20 }}
                        >
                          <defs>
                            <linearGradient id="paretoGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={C.ng()} stopOpacity={0.9} />
                              <stop offset="95%" stopColor={C.ng()} stopOpacity={0.4} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            stroke={C.bdr(0.12)}
                            strokeDasharray="3 4"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="reason"
                            tickFormatter={(reason) => String(reason).length > 8 ? String(reason).slice(0, 8) + '...' : reason}
                            tick={{
                              fontSize: 11,
                              fill: C.txt("sec"),
                              fontFamily: "'DM Mono',monospace",
                            }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            yAxisId="left"
                            tick={{ fontSize: 11, fill: C.txt("sec") }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            domain={[0, 100]}
                            tickFormatter={(v) => `${v}%`}
                            tick={{ fontSize: 11, fill: C.txt("sec"), fontWeight: 600 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            {...TooltipStyle}
                            contentStyle={{
                              ...TooltipStyle.contentStyle,
                              padding: "12px 16px",
                              borderRadius: 12,
                            }}
                            formatter={(value, name) => [
                              name === "cumulative" ? `${value}%` : value,
                              name === "cumulative" ? "Cumulative Impact" : "Rejects Count",
                            ]}
                            labelFormatter={(label) => `Reason: ${label}`}
                          />
                          <Bar
                            yAxisId="left"
                            dataKey="count"
                            name="count"
                            fill="url(#paretoGrad)"
                            radius={[6, 6, 0, 0]}
                            barSize={32}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="cumulative"
                            name="cumulative"
                            stroke={C.amber()}
                            strokeWidth={3}
                            dot={{ r: 4, fill: C.amber(), stroke: "#fff", strokeWidth: 2 }}
                            activeDot={{ r: 6, fill: C.amber(), stroke: "#fff", strokeWidth: 2 }}
                          />
                        </ComposedChart>
                      )}
                    </SafeChart>
                  ) : (
                    <p
                      style={{
                        fontSize: 12,
                        color: C.txt("muted"),
                        textAlign: "center",
                        padding: "24px 0",
                      }}
                    >
                      {t(
                        "dashboard.noRejectsFound",
                        "No rejects found in this period.",
                      )}
                    </p>
                  )}
                </div>
              </div>

              {/* —— Live Recent Production Scans Stream Table —— */}
              <div
                style={{
                  background: C.bg("card"),
                  border: `1px solid ${C.bdr()}`,
                  borderRadius: 14,
                  padding: 20,
                  boxShadow: SHADOW,
                }}
              >
                <SectionHead
                  title={t("dashboard.recentScansTitle", "Live Recent Production Scans Stream")}
                  right={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: C.ok(),
                          animation: "dbPing 1.6s ease-out infinite",
                        }}
                      />
                      <span style={{ fontSize: 11, color: C.ok(), fontWeight: 700 }}>
                        {summary.recentScans?.length || 0} Parts Streamed
                      </span>
                    </div>
                  }
                />
                <p style={{ fontSize: 11, color: C.txt("muted"), margin: "-8px 0 14px" }}>
                  Direct stream from RICO_IOT Production Reports across all quality gates (OP100 – OP160)
                </p>

                {summary.recentScans && summary.recentScans.length > 0 ? (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr
                          style={{
                            borderBottom: `1px solid ${C.bdr()}`,
                            color: C.txt("muted"),
                            textAlign: "left",
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            fontWeight: 800,
                          }}
                        >
                          <th style={{ padding: "8px 10px" }}>Part ID / QR</th>
                          <th style={{ padding: "8px 10px" }}>Scan Time</th>
                          <th style={{ padding: "8px 10px" }}>Shift</th>
                          <th style={{ padding: "8px 10px" }}>Quality Gates Flow (OP100-OP160)</th>
                          <th style={{ padding: "8px 10px" }}>Cycle Time</th>
                          <th style={{ padding: "8px 10px" }}>Status</th>
                          <th style={{ padding: "8px 10px" }}>Rejection Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.recentScans.map((scan, idx) => {
                          const isPass = ["OK", "PASSED"].includes(String(scan.overallStatus || scan.result || "").toUpperCase());
                          const scanTime = scan.timestamp ? new Date(scan.timestamp) : null;
                          const formattedTime = scanTime && !isNaN(scanTime.getTime())
                            ? `${scanTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                            : "-";
                          const stationList = [
                            { code: "100", status: scan.op100 },
                            { code: "110", status: scan.op110 },
                            { code: "120", status: scan.op120 },
                            { code: "130", status: scan.op130 },
                            { code: "140", status: scan.op140 },
                            { code: "150", status: scan.op150 },
                            { code: "160", status: scan.op160 },
                          ];

                          return (
                            <tr
                              key={scan.id || scan.partId || idx}
                              style={{
                                borderBottom: `1px solid ${C.bdr(0.08)}`,
                                transition: "background 0.1s",
                              }}
                            >
                              <td style={{ padding: "10px", fontWeight: 700, fontFamily: "'DM Mono',monospace", color: C.txt("pri") }}>
                                {scan.partId || scan.customerQr || "-"}
                              </td>
                              <td style={{ padding: "10px", color: C.txt("sec"), whiteSpace: "nowrap" }}>
                                {formattedTime}
                              </td>
                              <td style={{ padding: "10px" }}>
                                <span
                                  style={{
                                    padding: "2px 8px",
                                    borderRadius: 6,
                                    fontSize: 10,
                                    fontWeight: 800,
                                    background: C.bg("surf"),
                                    border: `1px solid ${C.bdr()}`,
                                    color: C.navy(),
                                  }}
                                >
                                  Shift {scan.shiftCode || "A"}
                                </span>
                              </td>
                              <td style={{ padding: "10px" }}>
                                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                                  {stationList.map((st) => {
                                    const stUpper = String(st.status || "").toUpperCase();
                                    const isOk = ["OK", "PASSED", "ENDED_OK", "COMPLETED_OK"].includes(stUpper);
                                    const isNg = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(stUpper);
                                    const bg = isOk ? C.ok(0.15) : isNg ? C.ng(0.18) : C.bdr(0.12);
                                    const color = isOk ? C.ok() : isNg ? C.ng() : C.txt("muted");
                                    return (
                                      <span
                                        key={st.code}
                                        title={`OP${st.code}: ${st.status || 'Pending/Skipped'}`}
                                        style={{
                                          fontSize: 9,
                                          fontWeight: 800,
                                          padding: "1px 5px",
                                          borderRadius: 4,
                                          background: bg,
                                          color: color,
                                          border: `1px solid ${isOk ? C.ok(0.3) : isNg ? C.ng(0.3) : 'transparent'}`,
                                          fontFamily: "'DM Mono',monospace",
                                        }}
                                      >
                                        {st.code}
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                              <td style={{ padding: "10px", fontFamily: "'DM Mono',monospace", color: C.txt("sec") }}>
                                {scan.cycleTime ? `${Number(scan.cycleTime).toFixed(1)}s` : "-"}
                              </td>
                              <td style={{ padding: "10px" }}>
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    padding: "2px 8px",
                                    borderRadius: 999,
                                    fontSize: 10,
                                    fontWeight: 800,
                                    background: isPass ? C.ok(0.12) : C.ng(0.12),
                                    color: isPass ? C.ok() : C.ng(),
                                    border: `1px solid ${isPass ? C.ok(0.25) : C.ng(0.25)}`,
                                  }}
                                >
                                  {isPass ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                                  {isPass ? "PASS" : "FAIL"}
                                </span>
                              </td>
                              <td style={{ padding: "10px", fontSize: 11, color: isPass ? C.txt("muted") : C.ng(), fontWeight: isPass ? 400 : 700 }}>
                                {scan.rejectionReason || (isPass ? "-" : "Quality defect detected")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: C.txt("muted"), textAlign: "center", padding: "24px 0" }}>
                    No live scans available for this period.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* —— TAB: Machines ——————————————————————————————————————————————————————————— */}
          {activeTab === "machines" && (
            <div
              className="db-tablet-cards"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(380px,1fr))",
                gap: 18,
              }}
            >
              {dashboardMachineCards.map((row) => (
                <MachineCard
                  key={row.machineId}
                  row={row}
                  plcOnline={
                    row.plcConnected ??
                    (Object.prototype.hasOwnProperty.call(plcMap, row.machineId)
                      ? plcMap[row.machineId]
                      : null)
                  }
                  scannerOnline={row.scannerConnected ?? null}
                  nowMs={nowMs}
                  t={t}
                />
              ))}
            </div>
          )}

          {activeTab === "oee" && (
            <div
              className="db-tablet-oeeoa"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(420px,1fr))",
                gap: 18,
              }}
            >
              {analysisMachineRows.map((row, idx) => {
                const oee = Number(row?.oee ?? row?.OEE ?? 0);
                const availability = Number(
                  row?.availability ?? row?.Availability ?? 0,
                );
                const performance = Number(
                  row?.performance ?? row?.Performance ?? 0,
                );
                const quality = Number(row?.quality ?? row?.Quality ?? 0);
                const machineName =
                  row?.machineName || row?.machine_name || `Machine ${idx + 1}`;
                const stationName =
                  row?.stationNo ||
                  row?.station ||
                  row?.operationNo ||
                  row?.operation_no ||
                  "-";
                const oeeClamped = Math.max(0, Math.min(100, oee));
                const makePie = (value) => {
                  const v = Math.max(0, Math.min(100, Number(value || 0)));
                  return [
                    { name: "Effective", value: v },
                    { name: "Loss", value: 100 - v },
                  ];
                };
                return (
                  <div
                    key={`${machineName}-${stationName}-${idx}`}
                    className="db-tablet-pad"
                    style={{
                      background: C.bg("card"),
                      border: `1px solid ${C.bdr()}`,
                      borderRadius: 14,
                      padding: 20,
                      boxShadow: SHADOW,
                      minHeight: 360,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <p
                          style={{
                            fontSize: 16,
                            fontWeight: 850,
                            color: C.txt("pri"),
                            margin: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {machineName}
                        </p>
                        <p
                          style={{
                            fontSize: 12,
                            fontWeight: 750,
                            color: C.txt("muted"),
                            marginTop: 4,
                          }}
                        >
                          Station {stationName}
                        </p>
                      </div>
                      <Badge
                        variant={oee >= 85 ? "ok" : oee >= 60 ? "wip" : "ng"}
                        label={`OEE ${Math.round(oee)}%`}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        marginBottom: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 150,
                          height: 150,
                          position: "relative",
                        }}
                      >
                        <PieChart width={150} height={150}>
                          <Pie
                            data={makePie(oeeClamped)}
                            dataKey="value"
                            innerRadius={44}
                            outerRadius={70}
                            startAngle={90}
                            endAngle={-270}
                            strokeWidth={0}
                          >
                            <Cell
                              fill={
                                oeeClamped >= 85
                                  ? C.ok()
                                  : oeeClamped >= 60
                                    ? C.amber()
                                    : C.ng()
                              }
                            />
                            <Cell fill={C.bdr(0.18)} />
                          </Pie>
                          <Tooltip
                            {...CenterTooltipStyle}
                            position={{ x: 18, y: 54 }}
                          />
                        </PieChart>
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 24,
                              fontWeight: 850,
                              color: C.txt("pri"),
                              fontFamily: "'DM Mono',monospace",
                            }}
                          >
                            {Math.round(oeeClamped)}%
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              color: C.txt("muted"),
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          >
                            Overall OEE
                          </span>
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3,1fr)",
                        gap: 8,
                      }}
                    >
                      {[
                        {
                          label: "Availability",
                          value: availability,
                          color: C.steel(),
                        },
                        {
                          label: "Performance",
                          value: performance,
                          color: C.amber(),
                        },
                        { label: "Quality", value: quality, color: C.ok() },
                      ].map((m) => (
                        <div
                          key={m.label}
                          style={{
                            background: C.bg("surf"),
                            border: `1px solid ${C.bdr()}`,
                            borderRadius: 9,
                            padding: "8px 6px",
                            textAlign: "center",
                          }}
                        >
                          <div
                            style={{
                              width: 66,
                              height: 66,
                              margin: "0 auto 6px",
                            }}
                          >
                            <PieChart width={66} height={66}>
                              <Pie
                                data={makePie(m.value)}
                                dataKey="value"
                                innerRadius={18}
                                outerRadius={30}
                                startAngle={90}
                                endAngle={-270}
                                strokeWidth={0}
                              >
                                <Cell fill={m.color} />
                                <Cell fill={C.bdr(0.16)} />
                              </Pie>
                              <Tooltip
                                {...CenterTooltipStyle}
                                position={{ x: 0, y: 18 }}
                              />
                            </PieChart>
                          </div>
                          <p
                            style={{
                              fontSize: 16,
                              fontWeight: 850,
                              color: C.txt("pri"),
                              margin: 0,
                              fontFamily: "'DM Mono',monospace",
                            }}
                          >
                            {Math.round(m.value)}%
                          </p>
                          <p
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              color: C.txt("muted"),
                              marginTop: 4,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {m.label}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {activeTab === "oa" && (
            <div
              className="db-tablet-oeeoa"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(420px,1fr))",
                gap: 18,
              }}
            >
              {analysisMachineRows.map((row, idx) => {
                const oa = Number(row?.oa ?? row?.OA ?? 0);
                const machineName =
                  row?.machineName || row?.machine_name || `Machine ${idx + 1}`;
                const stationName =
                  row?.stationNo ||
                  row?.station ||
                  row?.operationNo ||
                  row?.operation_no ||
                  "-";
                const oaClamped = Math.max(0, Math.min(100, oa));
                const makePie = (value) => {
                  const v = Math.max(0, Math.min(100, Number(value || 0)));
                  return [
                    { name: "Effective", value: v },
                    { name: "Loss", value: 100 - v },
                  ];
                };
                return (
                  <div
                    key={`${machineName}-${stationName}-oa-${idx}`}
                    className="db-tablet-pad"
                    style={{
                      background: C.bg("card"),
                      border: `1px solid ${C.bdr()}`,
                      borderRadius: 14,
                      padding: 20,
                      boxShadow: SHADOW,
                      minHeight: 300,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <p
                          style={{
                            fontSize: 16,
                            fontWeight: 850,
                            color: C.txt("pri"),
                            margin: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {machineName}
                        </p>
                        <p
                          style={{
                            fontSize: 12,
                            fontWeight: 750,
                            color: C.txt("muted"),
                            marginTop: 4,
                          }}
                        >
                          Station {stationName}
                        </p>
                      </div>
                      <Badge
                        variant={oa >= 85 ? "ok" : oa >= 60 ? "wip" : "ng"}
                        label={`OA ${Math.round(oa)}%`}
                      />
                    </div>
                    <SafeChart height={180}>
                      {({ width, height }) => (
                        <PieChart width={width} height={height}>
                          <Pie
                            data={makePie(oaClamped)}
                            dataKey="value"
                            innerRadius={50}
                            outerRadius={72}
                            startAngle={90}
                            endAngle={-270}
                            strokeWidth={0}
                          >
                            <Cell
                              fill={
                                oaClamped >= 85
                                  ? C.ok()
                                  : oaClamped >= 60
                                    ? C.amber()
                                    : C.ng()
                              }
                            />
                            <Cell fill={C.bdr(0.18)} />
                          </Pie>
                          <Tooltip {...CenterTooltipStyle} />
                        </PieChart>
                      )}
                    </SafeChart>
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <Badge
                        variant={oa >= 85 ? "ok" : oa >= 60 ? "wip" : "ng"}
                        label={
                          oa >= 85 ? "Healthy" : oa >= 60 ? "Watch" : "Critical"
                        }
                      />
                      <Badge
                        variant="idle"
                        label={`${t("dashboard.downtime", "Downtime")} ${Math.round(Number(row?.downtimeMinutes || 0))}m`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "rejection" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "320px 1fr",
                gap: 16,
              }}
              className="db-grid-responsive"
            >
              <style>{`@media(max-width:900px){.db-grid-responsive{grid-template-columns:1fr!important}}`}</style>
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                    gap: 10,
                  }}
                >
                  {[
                    {
                      label: "Filtered Rejects",
                      value: rejectionKpis.total,
                      color: C.ng(),
                    },
                    {
                      label: "Affected Parts",
                      value: rejectionKpis.uniqueParts,
                      color: C.steel(),
                    },
                    {
                      label: "Top Reason",
                      value: rejectionKpis.topReason?.reason || "-",
                      sub: rejectionKpis.topReason?.count || 0,
                      color: C.navy(),
                    },
                    {
                      label: "Hot Zone",
                      value: rejectionKpis.topZone?.name || "-",
                      sub: rejectionKpis.topZone?.count || 0,
                      color: C.ok(),
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        background: C.bg("card"),
                        border: `1px solid ${C.bdr()}`,
                        borderRadius: 10,
                        padding: "12px 14px",
                        boxShadow: SHADOW,
                        minWidth: 0,
                      }}
                    >
                      <p
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: ".07em",
                          color: C.txt("muted"),
                          margin: 0,
                        }}
                      >
                        {item.label}
                      </p>
                      <p
                        style={{
                          fontSize: typeof item.value === "number" ? 24 : 13,
                          fontWeight: 900,
                          color: item.color,
                          marginTop: 5,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={String(item.value)}
                      >
                        {item.value}
                      </p>
                      {item.sub !== undefined && (
                        <p
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            color: C.txt("sec"),
                            marginTop: 2,
                          }}
                        >
                          {item.sub} rejects
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
                    gap: 8,
                    background: C.bg("card"),
                    border: `1px solid ${C.bdr()}`,
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <select
                    value={heatMapPart}
                    onChange={(event) => setHeatMapPart(event.target.value)}
                    style={{
                      width: "100%",
                      background: C.bg("input"),
                      border: `1px solid ${C.bdr()}`,
                      borderRadius: 8,
                      padding: "9px 10px",
                      color: C.txt("pri"),
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    <option value="" disabled>
                      Select Configured Part
                    </option>
                    {rejectionConfigParts.map((part) => (
                      <option key={part} value={part}>
                        {part}
                      </option>
                    ))}
                  </select>
                  {[
                    ["category", "Category", rejectionFilterOptions.category],
                    ["view", "View", rejectionFilterOptions.view],
                    ["zone", "Zone", rejectionFilterOptions.zone],
                    ["reason", "Reason", rejectionFilterOptions.reason],
                  ].map(([key, label, options]) => (
                    <select
                      key={key}
                      value={rejectionFilters[key]}
                      onChange={(event) =>
                        setRejectionFilters((prev) => ({
                          ...prev,
                          [key]: event.target.value,
                        }))
                      }
                      style={{
                        width: "100%",
                        background: C.bg("input"),
                        border: `1px solid ${C.bdr()}`,
                        borderRadius: 8,
                        padding: "9px 10px",
                        color: C.txt("pri"),
                        fontSize: 11,
                        fontWeight: 800,
                      }}
                    >
                      <option value="">All {label}s</option>
                      {options.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  ))}
                  <button
                    onClick={() =>
                      setRejectionFilters({
                        category: "",
                        view: "",
                        zone: "",
                        reason: "",
                      })
                    }
                    style={{
                      border: `1px solid ${C.bdr()}`,
                      borderRadius: 8,
                      background: C.bg("surf"),
                      color: C.txt("pri"),
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Clear Analysis Filters
                  </button>
                </div>
              </div>
              <div
                style={{
                  background: C.bg("card"),
                  border: `1px solid ${C.bdr()}`,
                  borderRadius: 14,
                  padding: 20,
                  boxShadow: SHADOW,
                }}
              >
                <SectionHead
                  title={t(
                    "dashboard.rejectionDistribution",
                    "Rejection Distribution",
                  )}
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    marginBottom: 12,
                  }}
                >
                  <SafeChart
                    height={220}
                    style={{
                      overflow: "visible",
                      position: "relative",
                      zIndex: 20,
                    }}
                  >
                    {({ width, height }) => (
                      <PieChart
                        width={width}
                        height={height}
                        style={{ overflow: "visible" }}
                      >
                        <Pie
                          data={rejectionPieData}
                          dataKey="value"
                          cx="50%"
                          cy="50%"
                          outerRadius={96}
                          paddingAngle={1}
                          labelLine={false}
                          label={false}
                        >
                          {rejectionPieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={
                            <RejectionPieTooltip
                              total={rejectionPieData.reduce(
                                (sum, row) => sum + Number(row.value || 0),
                                0,
                              )}
                            />
                          }
                          wrapperStyle={{
                            zIndex: 99999,
                            pointerEvents: "none",
                          }}
                          allowEscapeViewBox={{ x: true, y: true }}
                        />
                      </PieChart>
                    )}
                  </SafeChart>
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {rejectionPieData.map((row) => {
                    const total = rejectionPieData.reduce(
                      (s, e) => s + Number(e.value || 0),
                      0,
                    );
                    const pct =
                      total > 0
                        ? Math.round((Number(row.value || 0) / total) * 100)
                        : 0;
                    return (
                      <div
                        key={row.name}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 10px",
                          borderRadius: 9,
                          background: C.bg("surf"),
                          border: `1px solid ${C.bdr()}`,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: row.color,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: C.txt("pri"),
                            }}
                          >
                            {row.name}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            color: C.txt("sec"),
                            fontFamily: "'DM Mono',monospace",
                          }}
                        >
                          {row.value} ({pct}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateRows: "260px auto",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    background: C.bg("card"),
                    border: `1px solid ${C.bdr()}`,
                    borderRadius: 14,
                    padding: 20,
                    boxShadow: SHADOW,
                  }}
                >
                  <SectionHead
                    title={
                      isMultiDayRange
                        ? t(
                          "dashboard.rejectionTrendByDay",
                          "Rejection Trend by Day",
                        )
                        : t(
                          "dashboard.rejectionTrendByHour",
                          "Rejection Trend by Hour",
                        )
                    }
                    right={
                      <ChartModeToggle
                        mode={chartModeRejectTrend}
                        onChange={setChartModeRejectTrend}
                      />
                    }
                  />
                  <SafeChart
                    height={215}
                    style={{
                      overflow: "visible",
                      position: "relative",
                      zIndex: 3,
                    }}
                  >
                    {({ width, height }) => (
                      <>
                        {chartModeRejectTrend === "area" && (
                          <AreaChart
                            width={width}
                            height={height}
                            data={rejectionTrendData}
                            margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
                          >
                            <CartesianGrid
                              stroke={C.bdr(0.12)}
                              strokeDasharray="3 4"
                              vertical={false}
                            />
                            <XAxis
                              dataKey={isMultiDayRange ? "date" : "slot"}
                              tickFormatter={(v) =>
                                isMultiDayRange ? String(v).slice(5) : v
                              }
                              tick={{
                                fontSize: 10,
                                fill: C.txt("sec"),
                                fontFamily: "'DM Mono',monospace",
                              }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: C.txt("sec") }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              {...TooltipStyle}
                              formatter={(value, name) => [
                                `${value} rejection${Number(value) === 1 ? "" : "s"}`,
                                name,
                              ]}
                            />
                            <Legend
                              wrapperStyle={{ fontSize: 11 }}
                            />
                            <Area
                              name="CR"
                              type="monotone"
                              dataKey="cr"
                              stackId="1"
                              stroke={C.ng()}
                              fill={C.ng(0.35)}
                            />
                            <Area
                              name="CRAM"
                              type="monotone"
                              dataKey="cram"
                              stackId="1"
                              stroke={C.amber()}
                              fill={C.amber(0.35)}
                            />
                            <Area
                              name="MR"
                              type="monotone"
                              dataKey="mr"
                              stackId="1"
                              stroke={C.steel()}
                              fill={C.steel(0.35)}
                            />
                          </AreaChart>
                        )}
                        {chartModeRejectTrend === "line" && (
                          <LineChart
                            width={width}
                            height={height}
                            data={rejectionTrendData}
                            margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
                          >
                            <CartesianGrid
                              stroke={C.bdr(0.12)}
                              strokeDasharray="3 4"
                              vertical={false}
                            />
                            <XAxis
                              dataKey={isMultiDayRange ? "date" : "slot"}
                              tickFormatter={(v) =>
                                isMultiDayRange ? String(v).slice(5) : v
                              }
                              tick={{
                                fontSize: 10,
                                fill: C.txt("sec"),
                                fontFamily: "'DM Mono',monospace",
                              }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: C.txt("sec") }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              {...TooltipStyle}
                              formatter={(value, name) => [
                                `${value} rejection${Number(value) === 1 ? "" : "s"}`,
                                name,
                              ]}
                            />
                            <Legend
                              wrapperStyle={{ fontSize: 11 }}
                            />
                            <Line
                              name="CR"
                              type="monotone"
                              dataKey="cr"
                              stroke={C.ng()}
                              strokeWidth={3}
                              dot={{ r: 3 }}
                              activeDot={{ r: 6 }}
                            />
                            <Line
                              name="CRAM"
                              type="monotone"
                              dataKey="cram"
                              stroke={C.amber()}
                              strokeWidth={3}
                              dot={{ r: 3 }}
                              activeDot={{ r: 6 }}
                            />
                            <Line
                              name="MR"
                              type="monotone"
                              dataKey="mr"
                              stroke={C.steel()}
                              strokeWidth={3}
                              dot={{ r: 3 }}
                              activeDot={{ r: 6 }}
                            />
                          </LineChart>
                        )}
                        {chartModeRejectTrend === "bar" && (
                          <BarChart
                            width={width}
                            height={height}
                            data={rejectionTrendData}
                            margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
                          >
                            <CartesianGrid
                              stroke={C.bdr(0.12)}
                              strokeDasharray="3 4"
                              vertical={false}
                            />
                            <XAxis
                              dataKey={isMultiDayRange ? "date" : "slot"}
                              tickFormatter={(v) =>
                                isMultiDayRange ? String(v).slice(5) : v
                              }
                              tick={{
                                fontSize: 10,
                                fill: C.txt("sec"),
                                fontFamily: "'DM Mono',monospace",
                              }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: C.txt("sec") }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              {...TooltipStyle}
                              formatter={(value, name) => [
                                `${value} rejection${Number(value) === 1 ? "" : "s"}`,
                                name,
                              ]}
                            />
                            <Legend
                              wrapperStyle={{ fontSize: 11 }}
                            />
                            <Bar
                              name="CR"
                              dataKey="cr"
                              fill={C.ng()}
                              radius={[3, 3, 0, 0]}
                            />
                            <Bar
                              name="CRAM"
                              dataKey="cram"
                              fill={C.amber()}
                              radius={[3, 3, 0, 0]}
                            />
                            <Bar
                              name="MR"
                              dataKey="mr"
                              fill={C.steel()}
                              radius={[3, 3, 0, 0]}
                            />
                          </BarChart>
                        )}
                      </>
                    )}
                  </SafeChart>
                </div>

                <div
                  style={{
                    background: C.bg("card"),
                    border: `1px solid ${C.bdr()}`,
                    borderRadius: 14,
                    padding: 20,
                    boxShadow: SHADOW,
                  }}
                >
                  <SectionHead
                    title={t(
                      "dashboard.topRejectionReasons",
                      "Top Rejection Reasons",
                    )}
                  />
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {rejectionTopReasons.map((row, i) => (
                      <div
                        key={i}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          alignItems: "center",
                          padding: "10px 12px",
                          background: C.bg("surf"),
                          borderRadius: 10,
                          border: `1px solid ${C.bdr()}`,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: C.txt("pri"),
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {row.reason}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 800,
                            color: C.txt("sec"),
                            fontFamily: "'DM Mono',monospace",
                          }}
                        >
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div
                style={{
                  gridColumn: "1 / -1",
                  background: C.bg("card"),
                  border: `1px solid ${C.bdr()}`,
                  borderRadius: 14,
                  padding: 20,
                  boxShadow: SHADOW,
                }}
              >
                <SectionHead
                  title="Zone Heat Map"
                  right={
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <select
                        value={heatMapViewId}
                        onChange={(event) =>
                          setHeatMapViewId(event.target.value)
                        }
                        style={{
                          background: C.bg("input"),
                          border: `1px solid ${C.bdr()}`,
                          borderRadius: 8,
                          padding: "7px 10px",
                          color: C.txt("pri"),
                          fontSize: 11,
                          fontWeight: 800,
                        }}
                      >
                        {(heatMapConfig?.views || []).map((view) => (
                          <option key={view.id} value={view.id}>
                            {view.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  }
                />
                {!heatMapView ? (
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: C.txt("sec"),
                    }}
                  >
                    No configured part view available.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(280px,1fr) 190px",
                      gap: 18,
                      alignItems: "center",
                    }}
                    className="db-grid-responsive"
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        maxWidth: 900,
                        margin: "0 auto",
                        aspectRatio: "900 / 520",
                        overflow: "hidden",
                        borderRadius: 10,
                        border: `1px solid ${C.bdr()}`,
                        background: C.bg("surf"),
                      }}
                    >
                      {heatMapView.imageUrl ? (
                        <img
                          src={heatMapView.imageUrl}
                          alt={heatMapView.name}
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "fill",
                            display: "block",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "grid",
                            placeItems: "center",
                            color: C.txt("sec"),
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          No part image configured for this view
                        </div>
                      )}
                      <svg
                        viewBox="0 0 900 520"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          zIndex: 1,
                          pointerEvents: "none",
                          mixBlendMode: "screen",
                        }}
                      >
                        <defs>
                          <filter
                            id={`heat-blur-${heatMapView.id}`}
                            x="-40%"
                            y="-40%"
                            width="180%"
                            height="180%"
                          >
                            <feGaussianBlur stdDeviation="34" />
                          </filter>
                          <clipPath id={`part-clip-${heatMapView.id}`}>
                            <path d="M140 125 C200 85 320 80 420 100 C520 120 625 90 745 115 C790 125 830 165 840 220 L860 350 C868 410 815 455 750 465 L230 485 C155 485 108 430 115 365 L128 215 C132 175 108 150 140 125Z" />
                          </clipPath>
                        </defs>
                        <g
                          clipPath={`url(#part-clip-${heatMapView.id})`}
                          filter={`url(#heat-blur-${heatMapView.id})`}
                          opacity=".9"
                        >
                          {(heatMapView.zones || []).map((zone) => {
                            const key = normalizeAnalysisToken(
                              zone.code || zone.name,
                            );
                            const count = Number(heatMapZoneCounts[key] || 0);
                            if (count <= 0) return null;
                            const intensity = count / heatMapMax;
                            const color =
                              intensity > 0.66
                                ? "#ef4444"
                                : intensity > 0.33
                                  ? "#f97316"
                                  : "#facc15";
                            const cx =
                              (Number(zone.xPercent || 0) +
                                Number(zone.widthPercent || 0) / 2) *
                              9;
                            const cy =
                              (Number(zone.yPercent || 0) +
                                Number(zone.heightPercent || 0) / 2) *
                              5.2;
                            const rx = Math.max(
                              95,
                              Number(zone.widthPercent || 10) * 9 * 0.9,
                            );
                            const ry = Math.max(
                              75,
                              Number(zone.heightPercent || 10) * 5.2 * 1.1,
                            );
                            return (
                              <ellipse
                                key={`heat-${zone.id}`}
                                cx={cx}
                                cy={cy}
                                rx={rx}
                                ry={ry}
                                fill={color}
                                fillOpacity={0.75 + 0.2 * intensity}
                              />
                            );
                          })}
                        </g>
                      </svg>
                      {(heatMapView.zones || []).map((zone) => (
                        <div
                          key={`division-${zone.id}`}
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            left: `${Math.max(0, Number(zone.xPercent || 0))}%`,
                            top: `${Math.max(0, Number(zone.yPercent || 0))}%`,
                            width: `${Math.max(1, Math.min(100 - Number(zone.xPercent || 0), Number(zone.widthPercent || 10)))}%`,
                            height: `${Math.max(1, Math.min(100 - Number(zone.yPercent || 0), Number(zone.heightPercent || 10)))}%`,
                            border: "2px dashed rgba(220,38,38,.95)",
                            boxSizing: "border-box",
                            pointerEvents: "none",
                            zIndex: 2,
                          }}
                        />
                      ))}
                      {(heatMapView.zones || []).map((zone) => {
                        const shortKey = normalizeAnalysisToken(
                          zone.code || zone.name,
                        );
                        const count = Number(heatMapZoneCounts[shortKey] || 0);
                        const intensity = count / heatMapMax;
                        const borderColor =
                          count === 0
                            ? "rgba(100,116,139,.65)"
                            : intensity > 0.66
                              ? "rgba(185,28,28,.95)"
                              : intensity > 0.33
                                ? "rgba(234,88,12,.95)"
                                : "rgba(202,138,4,.95)";
                        const centerX = Math.max(
                          2,
                          Math.min(
                            98,
                            Number(zone.xPercent || 0) +
                            Number(zone.widthPercent || 0) / 2,
                          ),
                        );
                        const centerY = Math.max(
                          2,
                          Math.min(
                            98,
                            Number(zone.yPercent || 0) +
                            Number(zone.heightPercent || 0) / 2,
                          ),
                        );
                        return (
                          <div
                            key={zone.id}
                            title={`${zone.name || zone.code}: ${count} rejection${count === 1 ? "" : "s"}`}
                            style={{
                              position: "absolute",
                              left: `${centerX}%`,
                              top: `${centerY}%`,
                              transform: "translate(-50%,-50%)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              transition: "all .2s ease",
                              zIndex: 3,
                            }}
                          >
                            <span
                              style={{
                                minWidth: 46,
                                height: 34,
                                padding: "0 9px",
                                borderRadius: 10,
                                background: "rgba(255,244,150,.95)",
                                border: `2px solid ${borderColor}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 12,
                                fontWeight: 900,
                                color: "#0f172a",
                                boxShadow: "0 3px 12px rgba(15,23,42,.28)",
                              }}
                            >
                              {zone.code || zone.name} · {count}
                            </span>
                          </div>
                        );
                      })}
                      {(heatMapView.zones || []).flatMap((zone) =>
                        (zone.subZones || []).map((subZone) => {
                          const zoneX = Number(zone.xPercent || 0);
                          const zoneY = Number(zone.yPercent || 0);
                          const zoneW = Number(zone.widthPercent || 10);
                          const zoneH = Number(zone.heightPercent || 10);
                          const left =
                            zoneX +
                            (zoneW * Number(subZone.xPercent || 0)) / 100;
                          const top =
                            zoneY +
                            (zoneH * Number(subZone.yPercent || 0)) / 100;
                          const width = Math.max(
                            1,
                            (zoneW * Number(subZone.widthPercent || 10)) / 100,
                          );
                          const height = Math.max(
                            1,
                            (zoneH * Number(subZone.heightPercent || 10)) / 100,
                          );
                          const count = Number(
                            heatMapSubZoneCounts[String(subZone.id)] || 0,
                          );
                          const selected =
                            heatMapSelection?.type === "subZone" &&
                            Number(heatMapSelection.id) === Number(subZone.id);
                          return (
                            <button
                              key={`sub-zone-${subZone.id}`}
                              type="button"
                              title={`${zone.name || zone.code} / ${subZone.name || subZone.code}: ${count} mapped reason${count === 1 ? "" : "s"}`}
                              onClick={() =>
                                setHeatMapSelection({
                                  type: "subZone",
                                  id: subZone.id,
                                  zone: zone.name || zone.code,
                                  name: subZone.name || subZone.code,
                                  count,
                                })
                              }
                              style={{
                                position: "absolute",
                                left: `${left}%`,
                                top: `${top}%`,
                                width: `${width}%`,
                                height: `${height}%`,
                                border: selected
                                  ? "2px solid #0891b2"
                                  : "1px solid rgba(14,165,233,.85)",
                                background: count
                                  ? "rgba(14,165,233,.24)"
                                  : "rgba(255,255,255,.08)",
                                color: "#0f172a",
                                zIndex: selected ? 7 : 4,
                                cursor: "pointer",
                                boxShadow: selected
                                  ? "0 0 0 3px rgba(14,165,233,.25)"
                                  : "none",
                              }}
                            >
                              <span
                                style={{
                                  position: "absolute",
                                  left: "50%",
                                  top: "50%",
                                  transform: "translate(-50%,-50%)",
                                  borderRadius: 7,
                                  background: "rgba(255,255,255,.92)",
                                  border: "1px solid rgba(14,165,233,.8)",
                                  padding: "2px 5px",
                                  fontSize: 9,
                                  fontWeight: 900,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {subZone.code || subZone.name}
                              </span>
                            </button>
                          );
                        }),
                      )}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {heatMapSelection && (
                        <div
                          style={{
                            padding: "10px",
                            borderRadius: 8,
                            background: "rgba(14,165,233,.08)",
                            border: "1px solid rgba(14,165,233,.35)",
                          }}
                        >
                          <p
                            style={{
                              margin: 0,
                              fontSize: 10,
                              fontWeight: 900,
                              textTransform: "uppercase",
                              color: C.txt("sec"),
                            }}
                          >
                            Selected Sub Zone
                          </p>
                          <p
                            style={{
                              margin: "4px 0 0",
                              fontSize: 12,
                              fontWeight: 900,
                              color: C.txt("pri"),
                            }}
                          >
                            {heatMapSelection.zone} / {heatMapSelection.name}
                          </p>
                          <p
                            style={{
                              margin: "2px 0 0",
                              fontSize: 11,
                              fontWeight: 800,
                              color: C.txt("sec"),
                            }}
                          >
                            {heatMapSelection.count} mapped reasons
                          </p>
                        </div>
                      )}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "9px 10px",
                          borderRadius: 8,
                          background: C.bg("surf"),
                          border: `1px solid ${C.bdr()}`,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 900,
                            color: C.txt("sec"),
                            textTransform: "uppercase",
                            letterSpacing: ".06em",
                          }}
                        >
                          Heat Intensity
                        </span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          {["#facc15", "#f97316", "#ef4444"].map((color) => (
                            <span
                              key={color}
                              style={{
                                width: 18,
                                height: 8,
                                borderRadius: 99,
                                background: color,
                              }}
                            />
                          ))}
                        </div>
                      </div>
                      {(heatMapView.zones || []).map((zone) => {
                        const key = normalizeAnalysisToken(
                          zone.code || zone.name,
                        );
                        const count = Number(heatMapZoneCounts[key] || 0);
                        return (
                          <div
                            key={zone.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              padding: "9px 10px",
                              borderRadius: 8,
                              background: C.bg("surf"),
                              border: `1px solid ${C.bdr()}`,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 800,
                                color: C.txt("pri"),
                              }}
                            >
                              {zone.name || zone.code}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 900,
                                color: count ? C.ng() : C.txt("sec"),
                              }}
                            >
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div
                style={{
                  gridColumn: "1 / -1",
                  background: C.bg("card"),
                  border: `1px solid ${C.bdr()}`,
                  borderRadius: 14,
                  padding: 20,
                  boxShadow: SHADOW,
                }}
              >
                <SectionHead title="Rejection Pareto Analysis" />
                {rejectionParetoData.length === 0 ? (
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: C.txt("sec"),
                    }}
                  >
                    No rejection reasons for the selected filters.
                  </p>
                ) : (
                  <SafeChart
                    height={260}
                    style={{
                      overflow: "visible",
                      position: "relative",
                      zIndex: 2,
                    }}
                  >
                    {({ width, height }) => (
                      <ComposedChart
                        width={width}
                        height={height}
                        data={rejectionParetoData}
                        margin={{ top: 12, right: 12, left: -10, bottom: 45 }}
                      >
                        <defs>
                          <linearGradient id="paretoGradTab" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={C.ng()} stopOpacity={0.9} />
                            <stop offset="95%" stopColor={C.ng()} stopOpacity={0.4} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          stroke={C.bdr(0.12)}
                          strokeDasharray="3 4"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="reason"
                          tickFormatter={(value) => shortChartLabel(value)}
                          interval={0}
                          angle={-20}
                          textAnchor="end"
                          height={58}
                          tick={{ fontSize: 10, fill: C.txt("sec"), fontFamily: "'DM Mono',monospace" }}
                        />
                        <YAxis
                          yAxisId="count"
                          tick={{ fontSize: 10, fill: C.txt("sec") }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          yAxisId="pct"
                          orientation="right"
                          domain={[0, 100]}
                          tickFormatter={(value) => `${value}%`}
                          tick={{ fontSize: 10, fill: C.txt("sec"), fontWeight: 600 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          {...TooltipStyle}
                          contentStyle={{
                            ...TooltipStyle.contentStyle,
                            padding: "12px 16px",
                            borderRadius: 12,
                          }}
                          formatter={(value, name) => [
                            name === "cumulative" ? `${value}%` : value,
                            name === "cumulative" ? "Cumulative Impact" : "Rejects Count",
                          ]}
                          labelFormatter={(label) => `Reason: ${label}`}
                        />
                        <Bar
                          yAxisId="count"
                          dataKey="count"
                          name="count"
                          fill="url(#paretoGradTab)"
                          radius={[6, 6, 0, 0]}
                          barSize={34}
                        />
                        <Line
                          yAxisId="pct"
                          type="monotone"
                          dataKey="cumulative"
                          name="cumulative"
                          stroke={C.amber()}
                          strokeWidth={3}
                          dot={{ r: 4, fill: C.amber(), stroke: "#fff", strokeWidth: 2 }}
                          activeDot={{ r: 6, fill: C.amber(), stroke: "#fff", strokeWidth: 2 }}
                        />
                      </ComposedChart>
                    )}
                  </SafeChart>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;
