import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  AlertTriangle,
  Clock,
  Filter,
  RefreshCw,
  Target,
  XCircle,
  TrendingUp,
  TrendingDown,
  Activity,
  Calendar,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  Cog,
  ClipboardCheck,
  AlertCircle,
  X,
  Grid,
  MapPin,
  BarChart3 as BarChartIcon,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  FileSpreadsheet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dashboardApi, machineApi, rejectionConfigApi, shiftApi } from "../api/services";
import SafeChart from "../components/charts/SafeChart";
import { toDatetimeLocal } from "../utils/time";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

const SYSTEM_RECOVERY_REASONS = new Set(["RECOVERY_PENDING_AFTER_BACKEND_RESTART"]);

// ── Design Tokens ──────────────────────────────────────────────────────────
const C = {
  navy: "#1a3263",
  steel: "#547792",
  amber: "#fab95b",
  danger: "#ef4444",
  ok: "#22c55e",
  bg: "var(--app-bg-base)",
  card: "var(--app-bg-card)",
  surf: "var(--app-bg-surface)",
  text: "var(--app-text-main)",
  muted: "var(--app-text-muted)",
  border: "var(--app-border)",
  gold: "#d4a017",
  purple: "#8b5cf6",
  teal: "#14b8a6",
  white: "#ffffff",
  slate: "#f1f5f9",
};

const CHART_COLORS = ["#ef4444", "#f97316", "#fab95b", "#547792", "#14b8a6", "#8b5cf6", "#d4a017", "#1a3263"];

// ── Animation Keyframes ──────────────────────────────────────────────────
const DS = `
  @keyframes fadeSlideUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes countUp {
    from { opacity: 0; transform: scale(0.8); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(26,50,99,0.15); }
    50% { box-shadow: 0 0 20px 4px rgba(26,50,99,0.06); }
  }
  @keyframes datePop {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }
  .rej-analysis-container {
    animation: fadeSlideUp 0.4s ease;
  }
  .rej-gradient-bar {
    height: 3px;
    background: linear-gradient(90deg, ${C.navy}, ${C.steel}, ${C.amber}, ${C.danger}, ${C.navy});
    background-size: 200% 100%;
    animation: shimmer 3s ease-in-out infinite;
  }
  .rej-card {
    background: var(--app-bg-card);
    border: 1px solid var(--app-border);
    border-radius: 14px;
    box-shadow: 0 2px 12px rgba(26,50,99,0.06);
    transition: all 0.25s ease;
  }
  .rej-card:hover {
    box-shadow: 0 4px 24px rgba(26,50,99,0.10);
  }
  .rej-heat-zone {
    position: absolute;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 800;
    transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    cursor: pointer;
    border: 2px solid transparent;
    color: #fff;
    text-shadow: 0 1px 4px rgba(0,0,0,0.4);
    gap: 2px;
    padding: 4px;
  }
  .rej-heat-zone:hover {
    transform: scale(1.08);
    z-index: 20;
    box-shadow: 0 8px 30px rgba(0,0,0,0.35);
    border-color: #fff;
  }
  .rej-heat-zone.active {
    transform: scale(1.1);
    z-index: 25;
    box-shadow: 0 0 0 3px #fff, 0 8px 40px rgba(0,0,0,0.4);
    border-color: #fff;
  }
  .rej-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 99px;
    font-size: 10px;
    font-weight: 700;
    background: rgba(84,119,146,0.08);
    border: 1px solid rgba(84,119,146,0.15);
    color: #547792;
    transition: all 0.15s ease;
  }
  .rej-filter-chip:hover {
    background: rgba(84,119,146,0.15);
    border-color: rgba(84,119,146,0.3);
  }
  .rej-filter-chip .remove {
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.15s ease;
    margin-left: 2px;
  }
  .rej-filter-chip .remove:hover {
    opacity: 1;
    color: ${C.danger};
  }
  .rej-filter-chip.date-chip {
    background: rgba(250,185,91,0.12);
    border-color: rgba(250,185,91,0.25);
    color: ${C.amber};
  }
  .rej-preset-btn {
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid ${C.border};
    background: transparent;
    color: ${C.muted};
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .rej-preset-btn:hover {
    border-color: ${C.steel};
    background: ${C.slate};
  }
  .rej-preset-btn.active {
    border-color: ${C.navy};
    background: ${C.navy};
    color: ${C.white};
    font-weight: 800;
  }
  .rej-filter-select {
    width: 100%;
    min-height: 38px;
    border-radius: 10px;
    border: 1px solid ${C.border};
    background: ${C.white};
    color: ${C.text};
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    outline: none;
    transition: all 0.15s ease;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .rej-filter-select:focus {
    border-color: ${C.steel};
    box-shadow: 0 0 0 3px rgba(84,119,146,0.1);
  }
  .rej-filter-input {
    width: 100%;
    min-height: 38px;
    border-radius: 10px;
    border: 1px solid ${C.border};
    background: ${C.white};
    color: ${C.text};
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    outline: none;
    transition: all 0.15s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .rej-filter-input:focus {
    border-color: ${C.steel};
    box-shadow: 0 0 0 3px rgba(84,119,146,0.1);
  }
  .rej-filter-input::placeholder {
    color: rgba(84,119,146,0.5);
    font-weight: 400;
  }
  .date-picker-container {
    position: relative;
    width: 100%;
  }
  .date-picker-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    background: ${C.white};
    border: 1px solid ${C.border};
    border-radius: 12px;
    box-shadow: 0 12px 48px rgba(26,50,99,0.15), 0 2px 8px rgba(26,50,99,0.06);
    padding: 16px;
    z-index: 1000;
    min-width: 280px;
    max-width: 340px;
    animation: datePop 0.2s ease;
  }
  .date-picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .date-picker-header button {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid ${C.border};
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${C.steel};
    transition: all 0.15s ease;
  }
  .date-picker-header button:hover {
    background: ${C.slate};
    border-color: ${C.steel};
  }
  .date-picker-header span {
    font-size: 13px;
    font-weight: 700;
    color: ${C.navy};
  }
  .date-picker-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 3px;
  }
  .date-picker-weekday {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: ${C.muted};
    opacity: 0.7;
    padding: 4px 0;
    text-align: center;
  }
  .date-picker-day {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: ${C.text};
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .date-picker-day:hover {
    background: rgba(84,119,146,0.08);
  }
  .date-picker-day.range-start,
  .date-picker-day.range-end {
    background: linear-gradient(135deg, ${C.navy}, ${C.steel});
    color: ${C.white};
    box-shadow: 0 2px 8px rgba(26,50,99,0.25);
    font-weight: 800;
  }
  .date-picker-day.range-start {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .date-picker-day.range-end {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .date-picker-day.range-middle {
    background: rgba(84,119,146,0.12);
    color: ${C.steel};
    border-radius: 0;
  }
  .date-picker-day.today {
    border: 2px solid rgba(250,185,91,0.55);
  }
  .date-picker-day.today.range-start,
  .date-picker-day.today.range-end {
    border-color: rgba(255,255,255,0.35);
  }
  .date-picker-footer {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(84,119,146,0.12);
  }
  .date-picker-footer button {
    flex: 1;
    height: 32px;
    border-radius: 7px;
    font-size: 10px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .date-picker-footer .clear-btn {
    border: 1px solid rgba(239,68,68,0.16);
    background: rgba(239,68,68,0.06);
    color: ${C.danger};
  }
  .date-picker-footer .clear-btn:hover {
    background: rgba(239,68,68,0.12);
  }
  .date-picker-footer .apply-btn {
    border: none;
    background: linear-gradient(135deg, ${C.navy}, ${C.steel});
    color: ${C.white};
    box-shadow: 0 2px 8px rgba(26,50,99,0.25);
  }
  .date-picker-footer .apply-btn:hover {
    opacity: 0.92;
  }
  .rej-date-row {
    display: grid;
    grid-template-columns: minmax(240px, 340px) 1fr;
    gap: 12px;
    margin-bottom: 12px;
    align-items: center;
  }
  .rej-btn-clear {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 38px;
    padding: 0 16px;
    border-radius: 10px;
    border: 1px solid rgba(239,68,68,0.25);
    background: rgba(239,68,68,0.05);
    color: ${C.danger};
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .rej-btn-clear:hover {
    background: rgba(239,68,68,0.12);
    border-color: rgba(239,68,68,0.4);
  }
  .rej-chart-shell {
    display: grid;
    grid-template-columns: 1fr;
    gap: 14px;
    align-items: stretch;
  }
  .rej-chart-shell.has-drilldown {
    grid-template-columns: minmax(0, 1.45fr) minmax(260px, 0.55fr);
  }
  .rej-drilldown-panel {
    border: 1px solid rgba(84,119,146,0.16);
    background: rgba(84,119,146,0.045);
    border-radius: 10px;
    padding: 10px;
    min-width: 0;
  }
  .rej-drilldown-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .rej-drilldown-title {
    margin: 0;
    font-size: 11px;
    font-weight: 900;
    color: ${C.navy};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .rej-drilldown-subtitle {
    margin: 2px 0 0;
    font-size: 10px;
    font-weight: 700;
    color: ${C.muted};
  }
  .rej-mini-clear {
    border: 1px solid rgba(239,68,68,0.18);
    background: rgba(239,68,68,0.06);
    color: ${C.danger};
    border-radius: 7px;
    min-height: 26px;
    padding: 0 8px;
    font-size: 9px;
    font-weight: 900;
    cursor: pointer;
  }
  .rej-slim-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(84,119,146,0.35) transparent;
  }
  .rej-slim-scrollbar::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .rej-slim-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .rej-slim-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(84,119,146,0.28);
    border-radius: 99px;
  }
  @media (max-width: 768px) {
    .rej-date-row {
      grid-template-columns: 1fr;
    }
    .rej-chart-shell.has-drilldown {
      grid-template-columns: 1fr;
    }
    .rej-heat-zone {
      font-size: 7px;
      padding: 2px;
    }
    .rej-heat-zone .zone-label {
      display: none;
    }
    .rej-heat-zone .zone-count {
      font-size: 10px;
    }
    .rej-filters-grid {
      grid-template-columns: 1fr 1fr !important;
    }
  }
  @media (max-width: 480px) {
    .rej-heat-zone {
      border-width: 1px;
    }
    .rej-heat-zone .zone-count {
      font-size: 8px;
    }
    .rej-filters-grid {
      grid-template-columns: 1fr !important;
    }
  }
`;

// ── Inject Styles ──────────────────────────────────────────────────────────
let _dsInjected = false;
function injectStyles() {
  if (_dsInjected || typeof document === "undefined") return;
  _dsInjected = true;
  const el = document.createElement("style");
  el.textContent = DS;
  document.head.appendChild(el);
}

// ── Helper Functions ──────────────────────────────────────────────────────
function normalizeToken(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function isSystemRecoveryReason(value = "") {
  return SYSTEM_RECOVERY_REASONS.has(normalizeToken(value));
}

function getDisplayReason(row = {}) {
  const reason = String(row.rejectionReasonOnly || row.reason || "").trim();
  return isSystemRecoveryReason(reason) ? "" : reason;
}

function normalizeZoneKey(value = "") {
  return normalizeToken(value)
    .replace(/^ZONE[\s_-]*/i, "")
    .replace(/^Z[\s_-]*/i, "")
    .replace(/[^A-Z0-9]/g, "");
}

function readLabeledValue(text, label) {
  const match = String(text || "").match(new RegExp(`(?:^|\\|)\\s*${label}\\s*:\\s*([^|]+)`, "i"));
  return match ? match[1].trim() : "";
}

function splitRejectionZone(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return { zone: "", subZone: "" };

  const parts = raw.split(/\s*(?:\/|\||>|\u2192)\s*/).map((part) => part.trim()).filter(Boolean);
  let zone = "";
  let subZone = "";

  parts.forEach((part, index) => {
    const subMatch = part.match(/^sub\s*zone\s*[:\-]?\s*(.+)$/i);
    if (subMatch) {
      subZone = subMatch[1].trim();
      return;
    }

    const zoneMatch = part.match(/^zone\s*[:\-]?\s*(.+)$/i);
    if (zoneMatch) {
      zone = zoneMatch[1].trim();
      return;
    }

    if (!zone) zone = part;
    else if (!subZone && index > 0) subZone = part;
  });

  return { zone: zone || raw, subZone };
}

function resolveRejectionDetails(row = {}) {
  const reasonText = String(row.reason || row.interlock_reason || "").trim();
  const zoneParts = splitRejectionZone(
    row.rejectionZone || row.rejection_zone || row.zone || readLabeledValue(reasonText, "Zone")
  );

  return {
    category: String(row.rejectionCategory || row.rejection_category || row.category || readLabeledValue(reasonText, "Category") || "").trim(),
    view: String(row.rejectionView || row.rejection_view || row.view || readLabeledValue(reasonText, "View") || "").trim(),
    zone: zoneParts.zone,
    subZone: String(row.rejectionSubZone || row.rejection_sub_zone || readLabeledValue(reasonText, "Sub Zone") || zoneParts.subZone || "").trim(),
    reason: String(row.rejectionReason || row.rejection_reason || getDisplayReason(row) || readLabeledValue(reasonText, "Reason") || "").trim(),
  };
}

function getRejectionRowKey(row = {}) {
  if (row.id) return `id:${row.id}`;
  return [
    row.partId || row.part_id || "",
    row.customerQrCode || row.customer_qr_code || "",
    row.createdAt || row.created_at || "",
    row.machineName || row.stationNo || "",
    row.view || "",
    row.zone || "",
    getDisplayReason(row) || "",
  ].map((value) => String(value || "").trim().toUpperCase()).join("|");
}

function dedupeRejectionRows(list = []) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((row) => {
    const key = getRejectionRowKey(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRejectionType(row = {}) {
  const raw = `${row.category || ""} ${getDisplayReason(row)}`;
  const r = normalizeToken(raw).replace(/[_-]+/g, " ");
  if (r.includes("CRAM") || r.includes("CHAMFER") || r.includes("DIMENSION") || r.includes("PROFILE")) {
    return { type: "CRAM", label: "CRAM - Cram Rejection", icon: "📐", color: C.amber };
  }
  if (/(^|\s)CR(\s|$)/.test(r) || r.includes("CAST") || r.includes("LEAK") || r.includes("POROSITY") || r.includes("CRACK")) {
    return { type: "CR", label: "CR - Casting Rejection", icon: "🔥", color: C.danger };
  }
  return { type: "MR", label: "MR - Machining Rejection", icon: "⚙️", color: C.steel };
}

function shortLabel(value = "", max = 18) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function getSeverityLevel(count, max) {
  const ratio = count / max;
  if (ratio > 0.8) return { level: "Critical", color: C.danger, icon: "🚨", bg: `${C.danger}30` };
  if (ratio > 0.5) return { level: "High", color: "#f97316", icon: "⚠️", bg: "#f9731630" };
  if (ratio > 0.3) return { level: "Medium", color: C.amber, icon: "⚡", bg: `${C.amber}30` };
  return { level: "Low", color: C.ok, icon: "✅", bg: `${C.ok}30` };
}

// ── Custom Date Range Picker ──────────────────────────────────────────────
function getMesDayRange(anchor = new Date()) {
  const start = new Date(anchor);
  start.setHours(6, 0, 0, 0);
  if (anchor < start) start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function getProductionDateRange(startDate, endDate = startDate) {
  const start = new Date(startDate);
  const end = new Date(endDate || startDate);
  start.setHours(6, 0, 0, 0);
  end.setHours(6, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function buildInitialFilters() {
  const range = getMesDayRange();
  return {
    dateFrom: toDatetimeLocal(range.start),
    dateTo: toDatetimeLocal(range.end),
    datePreset: "today",
    machineId: "",
    lineName: "",
    partId: "",
    shiftCode: "",
    category: "",
    view: "",
    zone: "",
    reason: "",
    configPart: "",
  };
}

const DateRangePicker = ({ startDate, endDate, onApply, onClear, label = "Select Date Range" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedStart, setSelectedStart] = useState(startDate ? new Date(startDate) : null);
  const [selectedEnd, setSelectedEnd] = useState(endDate ? new Date(endDate) : null);
  const [tempStart, setTempStart] = useState(startDate ? new Date(startDate) : null);
  const [tempEnd, setTempEnd] = useState(endDate ? new Date(endDate) : null);
  const pickerRef = useRef(null);

  useEffect(() => {
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    setSelectedStart(start);
    setSelectedEnd(end);
    setTempStart(start);
    setTempEnd(end);
    if (start) setCurrentMonth(new Date(start.getFullYear(), start.getMonth(), 1));
  }, [startDate, endDate]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatDateDisplay = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const handleDayClick = (day, month, year) => {
    const clickedDate = new Date(year, month, day);
    clickedDate.setHours(0, 0, 0, 0);

    if (!tempStart || (tempStart && tempEnd)) {
      setTempStart(clickedDate);
      setTempEnd(null);
    } else if (tempStart && !tempEnd) {
      if (clickedDate < tempStart) {
        setTempStart(clickedDate);
        setTempEnd(tempStart);
      } else {
        setTempEnd(clickedDate);
      }
    }
  };

  const handleApply = () => {
    if (tempStart) {
      const end = tempEnd || tempStart;
      const formattedStart = new Date(tempStart);
      formattedStart.setHours(0, 0, 0, 0);
      const formattedEnd = new Date(end);
      formattedEnd.setHours(23, 59, 59, 999);
      setSelectedStart(formattedStart);
      setSelectedEnd(formattedEnd);
      onApply(formattedStart, formattedEnd);
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    setSelectedStart(null);
    setSelectedEnd(null);
    setTempStart(null);
    setTempEnd(null);
    onClear();
    setIsOpen(false);
  };

  const handleMonthChange = (delta) => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1));
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = [];
    const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    weekdays.forEach((day) => {
      days.push(
        <div key={`weekday-${day}`} className="date-picker-weekday">
          {day}
        </div>
      );
    });

    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      date.setHours(0, 0, 0, 0);
      const isToday = date.getTime() === today.getTime();
      const isStart = tempStart && date.getTime() === tempStart.getTime();
      const isEnd = tempEnd && date.getTime() === tempEnd.getTime();
      const isInRange = tempStart && tempEnd && date > tempStart && date < tempEnd;

      days.push(
        <button
          key={`day-${day}`}
          type="button"
          onClick={() => handleDayClick(day, month, year)}
          className={[
            "date-picker-day",
            isToday ? "today" : "",
            isStart ? "range-start" : "",
            isEnd ? "range-end" : "",
            isInRange ? "range-middle" : "",
          ].filter(Boolean).join(" ")}
        >
          {day}
        </button>
      );
    }

    return days;
  };

  const getDateRangeText = () => {
    if (selectedStart && selectedEnd) {
      return `${formatDateDisplay(selectedStart)} - ${formatDateDisplay(selectedEnd)}`;
    }
    if (selectedStart) {
      return formatDateDisplay(selectedStart);
    }
    return label;
  };

  const hasSelection = selectedStart !== null;

  return (
    <div className="date-picker-container" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="rej-filter-input"
        style={{
          border: `1px solid ${hasSelection ? C.navy : C.border}`,
          fontWeight: hasSelection ? 700 : 600,
          color: hasSelection ? C.navy : C.muted,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: 'pointer',
          boxShadow: hasSelection ? `0 0 0 2px ${C.navy}20` : '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <span style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          overflow: 'hidden',
        }}>
          <Calendar size={14} style={{ 
            color: hasSelection ? C.navy : C.muted,
            flexShrink: 0,
          }} />
          <span style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: hasSelection ? C.navy : C.muted,
          }}>
            {getDateRangeText()}
          </span>
        </span>
        <ChevronDown size={14} style={{
          color: C.muted,
          flexShrink: 0,
          transform: isOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s ease',
        }} />
      </button>

      {isOpen && (
        <div className="date-picker-dropdown">
          <div className="date-picker-header">
            <button
              type="button"
              onClick={() => handleMonthChange(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
            <button
              type="button"
              onClick={() => handleMonthChange(1)}
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="date-picker-grid">
            {renderCalendar()}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 10,
            color: C.muted,
            marginTop: 12,
            padding: '0 4px',
          }}>
            <span>
              {tempStart ? `Start: ${formatDateDisplay(tempStart)}` : 'Select start date'}
            </span>
            <span>
              {tempEnd ? `End: ${formatDateDisplay(tempEnd)}` : tempStart ? 'Select end date' : ''}
            </span>
          </div>

          <div className="date-picker-footer">
            <button
              type="button"
              onClick={handleClear}
              className="clear-btn"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="apply-btn"
            >
              Apply Range
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Reusable Components ──────────────────────────────────────────────────
const Card = ({ children, style, className = "", noHover = false }) => (
  <div className={`rej-card ${className}`} style={{
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    boxShadow: "0 2px 12px rgba(15,23,42,.06)",
    transition: noHover ? "none" : "all 0.25s ease",
    ...style,
  }}>
    {children}
  </div>
);

const SectionHead = ({ title, subtitle, icon: Icon, right, accentColor = C.navy }) => (
  <div style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: `2px solid ${accentColor}22`,
    flexWrap: "wrap",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {Icon && (
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `${accentColor}15`,
          border: `1px solid ${accentColor}30`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Icon size={15} color={accentColor} />
        </div>
      )}
      <div>
        <h3 style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 900,
          color: C.muted,
          textTransform: "uppercase",
          letterSpacing: ".08em",
        }}>{title}</h3>
        {subtitle && (
          <p style={{
            margin: "2px 0 0",
            fontSize: 10,
            color: C.muted,
            fontWeight: 600,
          }}>{subtitle}</p>
        )}
      </div>
    </div>
    {right}
  </div>
);

const Kpi = ({ label, value, sub, icon: Icon, color, trend }) => (
  <Card 
    style={{
      padding: "16px 18px",
      borderLeft: `4px solid ${color}`,
      transition: "all 0.2s ease",
    }}
    noHover
  >
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      alignItems: "flex-start",
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 900,
          color: C.muted,
          textTransform: "uppercase",
          letterSpacing: ".06em",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          {label}
          {trend !== undefined && (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 9,
              color: trend >= 0 ? C.ok : C.danger,
              fontWeight: 800,
            }}>
              {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {Math.abs(trend)}%
            </span>
          )}
        </p>
        <p style={{
          margin: "6px 0 0",
          fontSize: typeof value === "number" ? 28 : 15,
          fontWeight: 950,
          color,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          animation: "countUp 0.3s ease",
        }} title={String(value)}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {sub !== undefined && (
          <p style={{
            margin: "3px 0 0",
            fontSize: 11,
            fontWeight: 700,
            color: C.muted,
          }}>{sub}</p>
        )}
      </div>
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        background: `${color}15`,
        border: `1px solid ${color}30`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}>
        <Icon size={20} color={color} />
      </div>
    </div>
  </Card>
);

const StatusBadge = ({ status, value }) => {
  const configs = {
    Critical: { color: C.danger, bg: `${C.danger}15`, icon: "🚨" },
    High: { color: "#f97316", bg: "#f9731615", icon: "⚠️" },
    Medium: { color: C.amber, bg: `${C.amber}15`, icon: "⚡" },
    Low: { color: C.ok, bg: `${C.ok}15`, icon: "✅" },
  };
  const config = configs[status] || configs.Low;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 10px",
      borderRadius: 99,
      fontSize: 9,
      fontWeight: 800,
      color: config.color,
      background: config.bg,
      border: `1px solid ${config.color}30`,
    }}>
      <span>{config.icon}</span> {status} {value !== undefined && `(${value})`}
    </span>
  );
};

function Empty({ text }) {
  return <p style={{ margin: 0, color: C.muted, fontSize: 12, fontWeight: 700 }}>{text}</p>;
}

// ── Main Component ──────────────────────────────────────────────────────
export default function RejectionAnalysis() {
  injectStyles();
  
  const [rows, setRows] = useState([]);
  const [machines, setMachines] = useState([]);
  const [availableShifts, setAvailableShifts] = useState([]);
  const [configuredParts, setConfiguredParts] = useState([]);
  const [heatMapConfig, setHeatMapConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chartMode, setChartMode] = useState("bar");
  const [heatMapZoom, setHeatMapZoom] = useState(1);
  const [showHeatMapDetails, setShowHeatMapDetails] = useState(true);
  const [selectedZone, setSelectedZone] = useState(null);
  const [selectedParetoReason, setSelectedParetoReason] = useState("");
  const [selectedHourSlot, setSelectedHourSlot] = useState("");
  const [filters, setFilters] = useState(buildInitialFilters);

  // ── Query ─────────────────────────────────────────────────────────────
  const query = useMemo(() => {
    return {
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      machineId: filters.machineId || undefined,
      lineName: filters.lineName || undefined,
      partId: filters.partId || undefined,
      shiftCode: filters.shiftCode || undefined,
      category: filters.category || undefined,
      view: filters.view || undefined,
      zone: filters.zone || undefined,
      reason: filters.reason || undefined,
    };
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.machineId,
    filters.lineName,
    filters.partId,
    filters.shiftCode,
    filters.category,
    filters.view,
    filters.zone,
    filters.reason,
  ]);

  // ── Data Loading ─────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const analysis = await dashboardApi.rejectionAnalysis(query, { timeout: 45000, suppressGlobalError: true });
      setRows((Array.isArray(analysis?.rows) ? analysis.rows : []).filter((row) => !isSystemRecoveryReason(row.reason)));
      setConfiguredParts(analysis?.configuredParts || []);
      setFilters((current) => {
        const firstConfiguredPart = analysis?.configuredParts?.[0] || "";
        if (current.configPart || !firstConfiguredPart) return current;
        return { ...current, configPart: firstConfiguredPart };
      });
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      machineApi.list({ timeout: 20000, suppressGlobalError: true }),
      shiftApi.list(undefined, { timeout: 20000, suppressGlobalError: true }),
    ])
      .then(([machineResult, shiftResult]) => {
        if (!active) return;
        setMachines(machineResult.status === "fulfilled" ? (machineResult.value || []) : []);
        setAvailableShifts(
          shiftResult.status === "fulfilled" && Array.isArray(shiftResult.value)
            ? shiftResult.value.filter((row) => row?.isActive !== false)
            : []
        );
      })
      .catch(() => {
        if (!active) return;
        setMachines([]);
        setAvailableShifts([]);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!filters.configPart) {
      setHeatMapConfig(null);
      return;
    }
    let active = true;
    rejectionConfigApi.operatorConfig({ partName: filters.configPart })
      .then((config) => { if (active) setHeatMapConfig(config || null); })
      .catch(() => { if (active) setHeatMapConfig(null); });
    return () => { active = false; };
  }, [filters.configPart]);

  // ── Computed Data ─────────────────────────────────────────────────────
  const lineOptions = useMemo(() => 
    Array.from(new Set((machines || []).map((m) => m.lineName || m.line_name).filter(Boolean))).sort(), 
    [machines]
  );

  const analysisRows = useMemo(() => dedupeRejectionRows(rows), [rows]);

  const filterOptions = useMemo(() => {
    const values = (key) => Array.from(new Set(
      analysisRows.map((row) => String(key === "reason" ? getDisplayReason(row) : row[key] || "").trim())
        .filter(Boolean)
    )).sort();
    return {
      category: values("category"),
      view: values("view"),
      zone: values("zone"),
      reason: values("reason"),
      shift: availableShifts.length
        ? availableShifts
            .map((row) => ({
              code: String(row.shiftCode || row.shift_code || "").trim(),
              label: String(row.shiftName || row.shift_name || row.shiftCode || row.shift_code || "").trim(),
            }))
            .filter((row) => row.code)
        : Array.from(new Set(analysisRows.map((row) => row.shiftCode).filter(Boolean))).sort()
            .map((code) => ({ code, label: code })),
    };
  }, [analysisRows, availableShifts]);

  // ── Chart Data ──────────────────────────────────────────────────────
  const pieData = useMemo(() => {
    const grouped = analysisRows.reduce((acc, row) => {
      const type = normalizeRejectionType(row);
      acc[type.label] = (acc[type.label] || 0) + 1;
      return acc;
    }, {});
    return [
      { name: "CR - Casting", value: grouped["CR - Casting Rejection"] || 0, color: C.danger, icon: "🔥" },
      { name: "CRAM - Cram", value: grouped["CRAM - Cram Rejection"] || 0, color: C.amber, icon: "📐" },
      { name: "MR - Machining", value: grouped["MR - Machining Rejection"] || 0, color: C.steel, icon: "⚙️" },
    ];
  }, [analysisRows]);

  const topReasons = useMemo(() => {
    const grouped = analysisRows.reduce((acc, row) => {
      const reason = getDisplayReason(row) || "NG";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [analysisRows]);

  const paretoData = useMemo(() => {
    const grouped = analysisRows.reduce((acc, row) => {
      const reason = getDisplayReason(row) || "NG";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
    const total = Math.max(1, Object.values(grouped).reduce((sum, count) => sum + Number(count || 0), 0));
    let cumulative = 0;
    return Object.entries(grouped)
      .map(([reason, count]) => ({ reason, count: Number(count || 0) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((row) => {
        cumulative += row.count;
        return {
          ...row,
          label: shortLabel(row.reason, 16),
          cumulativePercent: Number(((cumulative / total) * 100).toFixed(1)),
        };
      });
  }, [analysisRows]);

  const selectedParetoLocations = useMemo(() => {
    if (!selectedParetoReason) return [];
    const grouped = analysisRows.reduce((acc, row) => {
      const details = resolveRejectionDetails(row);
      const reason = details.reason || "NG";
      if (reason !== selectedParetoReason) return acc;
      const view = details.view || "View";
      const zone = details.zone || "Zone";
      const subZone = details.subZone || "Sub Zone";
      const key = `${view} / ${zone} / ${subZone}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([location, count]) => ({ location, label: shortLabel(location, 28), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [analysisRows, selectedParetoReason]);

  const zoneWise = useMemo(() => {
    const grouped = analysisRows.reduce((acc, row) => {
      const key = [row.view || "View", row.zone || "Zone"].join(" / ");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [analysisRows]);

  const trendData = useMemo(() => {
    const bucket = analysisRows.reduce((acc, row) => {
      const ts = new Date(row.createdAt || Date.now());
      const key = `${String(ts.getHours()).padStart(2, "0")}:00`;
      if (!acc[key]) acc[key] = { slot: key, cr: 0, cram: 0, mr: 0, total: 0 };
      const type = normalizeRejectionType(row);
      if (type.type === "CRAM") acc[key].cram += 1;
      else if (type.type === "CR") acc[key].cr += 1;
      else acc[key].mr += 1;
      acc[key].total += 1;
      return acc;
    }, {});
    return Object.values(bucket).sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
  }, [analysisRows]);

  const selectedHourRows = useMemo(() => (
    selectedHourSlot
      ? analysisRows.filter((row) => {
          const ts = new Date(row.createdAt || Date.now());
          return `${String(ts.getHours()).padStart(2, "0")}:00` === selectedHourSlot;
        })
      : []
  ), [analysisRows, selectedHourSlot]);

  const selectedHourReasonData = useMemo(() => {
    const grouped = selectedHourRows.reduce((acc, row) => {
      const reason = getDisplayReason(row) || "NG";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([reason, count]) => ({ reason, label: shortLabel(reason, 18), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [selectedHourRows]);

  const selectedHourLocationData = useMemo(() => {
    const grouped = selectedHourRows.reduce((acc, row) => {
      const details = resolveRejectionDetails(row);
      const key = `${details.zone || "Zone"} / ${details.subZone || "Sub Zone"}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([location, count]) => ({ location, label: shortLabel(location, 20), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [selectedHourRows]);

  const shiftAnalysis = useMemo(() => {
    const grouped = {
      A: { total: 0, cr: 0, cram: 0, mr: 0 },
      B: { total: 0, cr: 0, cram: 0, mr: 0 },
      C: { total: 0, cr: 0, cram: 0, mr: 0 },
    };
    analysisRows.forEach((row) => {
      const normalizedShift = String(row.shiftCode || "").trim().toUpperCase();
      const shift = normalizedShift.includes("A") ? "A" : normalizedShift.includes("B") ? "B" : normalizedShift.includes("C") ? "C" : "";
      if (!shift) return;
      grouped[shift].total += 1;
      const type = normalizeRejectionType(row);
      if (type.type === "CRAM") grouped[shift].cram += 1;
      else if (type.type === "CR") grouped[shift].cr += 1;
      else grouped[shift].mr += 1;
    });
    return ["A", "B", "C"].map((shift) => ({ shift, ...grouped[shift] }));
  }, [analysisRows]);

  const machinePerformance = useMemo(() => {
    const grouped = analysisRows.reduce((acc, row) => {
      const machine = row.machineName || row.stationNo || "Unknown";
      if (!acc[machine]) acc[machine] = { total: 0, reasons: {} };
      acc[machine].total += 1;
      const reason = getDisplayReason(row) || "NG";
      acc[machine].reasons[reason] = (acc[machine].reasons[reason] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([machine, data]) => ({
        machine,
        total: data.total,
        topReason: Object.entries(data.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] || "-",
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [analysisRows]);

  // ── Heat Map Data ──────────────────────────────────────────────────
  const heatViews = Array.isArray(heatMapConfig?.views) ? heatMapConfig.views : [];
  const heatView = useMemo(() => {
    if (!heatViews.length) return null;
    const selectedView = normalizeToken(filters.view);
    if (selectedView) {
      const matched = heatViews.find((view) => (
        normalizeToken(view.code) === selectedView ||
        normalizeToken(view.name) === selectedView ||
        normalizeToken(view.label) === selectedView
      ));
      if (matched) return matched;
    }
    const rowViewCounts = analysisRows.reduce((acc, row) => {
      const key = normalizeToken(row.view);
      if (key) acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const mostUsedRowView = Object.entries(rowViewCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    if (mostUsedRowView) {
      const matched = heatViews.find((view) => (
        normalizeToken(view.code) === mostUsedRowView ||
        normalizeToken(view.name) === mostUsedRowView ||
        normalizeToken(view.label) === mostUsedRowView
      ));
      if (matched) return matched;
    }
    return heatViews[0] || null;
  }, [heatViews, filters.view, analysisRows]);

  useEffect(() => {
    setSelectedZone(null);
    setHeatMapZoom(1);
  }, [heatView?.id, filters.configPart]);

  const heatCounts = useMemo(() => {
    return analysisRows.reduce((acc, row) => {
      const details = resolveRejectionDetails(row);
      const key = normalizeZoneKey(details.zone);
      if (key) acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [analysisRows]);
  const heatSubZoneCounts = useMemo(() => {
    return analysisRows.reduce((acc, row) => {
      const details = resolveRejectionDetails(row);
      const key = normalizeZoneKey(details.subZone);
      if (key) acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [analysisRows]);
  const heatMax = Math.max(
    1,
    ...Object.values(heatCounts).map(Number),
    ...Object.values(heatSubZoneCounts).map(Number)
  );

  const heatZonesWithData = useMemo(() => {
    if (!heatView?.zones) return [];
    return heatView.zones.map((zone) => {
      const zoneKeys = [
        normalizeZoneKey(zone.code),
        normalizeZoneKey(zone.name),
        normalizeZoneKey(`${zone.code || ""} ${zone.name || ""}`),
      ].filter(Boolean);
      const count = zoneKeys.reduce((sum, key, index, list) => (
        list.indexOf(key) === index ? sum + Number(heatCounts[key] || 0) : sum
      ), 0);
      const subZones = (zone.subZones || []).map((subZone) => {
        const subZoneKeys = [
          normalizeZoneKey(subZone.code),
          normalizeZoneKey(subZone.name),
          normalizeZoneKey(`${subZone.code || ""} ${subZone.name || ""}`),
        ].filter(Boolean);
        const subZoneCount = subZoneKeys.reduce((sum, key, index, list) => (
          list.indexOf(key) === index ? sum + Number(heatSubZoneCounts[key] || 0) : sum
        ), 0);
        return {
          ...subZone,
          id: `sub-${subZone.id}`,
          parentZoneId: zone.id,
          code: subZone.code || subZone.name,
          name: subZone.name || subZone.code,
          count: subZoneCount,
          severity: getSeverityLevel(subZoneCount, heatMax),
        };
      });
      const severity = getSeverityLevel(count, heatMax);
      return { ...zone, key: zoneKeys[0] || String(zone.id), count, severity, subZones };
    }).sort((a, b) => b.count - a.count);
  }, [heatView, heatCounts, heatSubZoneCounts, heatMax]);

  const heatMapMarkers = useMemo(() => (
    heatZonesWithData.flatMap((zone) => {
      const activeSubZones = (zone.subZones || []).filter((subZone) => Number(subZone.count || 0) > 0);
      return activeSubZones.length ? activeSubZones : [zone];
    }).filter((zone) => Number(zone.count || 0) > 0)
  ), [heatZonesWithData]);

  // ── KPIs ────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = analysisRows.length;
    const uniqueParts = new Set(analysisRows.map((row) => row.partId).filter(Boolean)).size;
    const topReason = topReasons[0];
    const topZone = zoneWise[0];
    const severity = getSeverityLevel(total, Math.max(1, total * 1.2));
    
    return {
      total,
      uniqueParts,
      topReason,
      topZone,
      severity,
    };
  }, [analysisRows, topReasons, zoneWise]);

  // ── Handlers ──────────────────────────────────────────────────────
  const handleDateRangeApply = (start, end) => {
    const range = getProductionDateRange(start, end);
    setFilters((prev) => ({
      ...prev,
      dateFrom: toDatetimeLocal(range.start),
      dateTo: toDatetimeLocal(range.end),
      datePreset: "",
    }));
  };

  const handleDateRangeClear = () => {
    setFilters((prev) => ({
      ...buildInitialFilters(),
      configPart: prev.configPart,
    }));
  };

  useEffect(() => {
    setSelectedParetoReason("");
    setSelectedHourSlot("");
  }, [analysisRows]);

  const handleParetoClick = useCallback((payload) => {
    const reason = payload?.payload?.reason || payload?.reason || "";
    if (!reason) return;
    setSelectedParetoReason((current) => current === reason ? "" : reason);
  }, []);

  const handleHourClick = useCallback((payload) => {
    const slot = payload?.payload?.slot || payload?.slot || "";
    if (!slot) return;
    setSelectedHourSlot((current) => current === slot ? "" : slot);
  }, []);

  const handlePreset = (key) => {
    const now = new Date();
    const mesRange = getMesDayRange(now);
    const from = new Date(mesRange.start);
    const to = new Date(mesRange.end);

    switch(key) {
      case 'today':
        break;
      case 'yesterday':
        from.setDate(from.getDate() - 1);
        to.setDate(to.getDate() - 1);
        break;
      case 'last7':
        from.setDate(from.getDate() - 7);
        break;
      case 'last30':
        from.setDate(from.getDate() - 30);
        break;
      case 'last90':
        from.setDate(from.getDate() - 90);
        break;
      default:
        return;
    }

    setFilters((prev) => ({
      ...prev,
      dateFrom: toDatetimeLocal(from),
      dateTo: toDatetimeLocal(to),
      datePreset: key,
    }));
  };

  const removeFilter = (key) => {
    setFilters((prev) => ({ ...prev, [key]: "" }));
  };

  // ── Excel Export ─────────────────────────────────────────────────────
  const downloadExcel = useCallback(async () => {
    if (!analysisRows.length) {
      alert("No data to export");
      return;
    }

    const headers = [
      "Sr No",
      "Rejection Time",
      "Part ID",
      "Customer QR",
      "Quality Gate",
      "Line",
      "Category",
      "View",
      "Zone",
      "Sub Zone",
      "Reason",
      "Remark",
    ];

    const data = analysisRows.map((row, index) => {
      const details = resolveRejectionDetails(row);
      return [
        index + 1,
        row.createdAt ? new Date(row.createdAt).toLocaleString("en-IN") : "",
        row.partId || "",
        row.customerQrCode || "",
        row.machineName || row.stationNo || "",
        row.lineName || "",
        details.category || "",
        details.view || "",
        details.zone || "",
        details.subZone || "",
        details.reason || "",
        row.remark || "",
      ];
    });

    const filterSummary = [
      filters.dateFrom && filters.dateTo
        ? `Date: ${new Date(filters.dateFrom).toLocaleString("en-IN")} - ${new Date(filters.dateTo).toLocaleString("en-IN")}`
        : "Date: All",
      filters.machineId ? `Quality Gate: ${filters.machineId}` : "Quality Gate: All",
      filters.lineName ? `Line: ${filters.lineName}` : "Line: All",
      filters.partId ? `Part/QR: ${filters.partId}` : "Part/QR: All",
      filters.shiftCode ? `Shift: ${filters.shiftCode}` : "Shift: All",
      filters.category ? `Category: ${filters.category}` : "Category: All",
      filters.view ? `View: ${filters.view}` : "View: All",
      filters.zone ? `Zone: ${filters.zone}` : "Zone: All",
      filters.reason ? `Reason: ${filters.reason}` : "Reason: All",
    ].join(" | ");

    const generatedAt = new Date().toLocaleString("en-IN");

    const wb = new ExcelJS.Workbook();
    wb.creator = "Traceability";
    wb.created = new Date();
    const ws = wb.addWorksheet("Rejection Analysis", {
      views: [{ state: "frozen", ySplit: 6 }],
      properties: { defaultRowHeight: 18 },
    });

    ws.mergeCells(1, 1, 1, headers.length);
    ws.mergeCells(2, 1, 2, headers.length);
    ws.mergeCells(3, 1, 3, headers.length);
    ws.mergeCells(4, 1, 4, headers.length);

    ws.getCell("A1").value = "Rejection Analysis";
    ws.getCell("A2").value = `Generated At: ${generatedAt}`;
    ws.getCell("A3").value = `Total Rejection Records: ${analysisRows.length}`;
    ws.getCell("A4").value = filterSummary;

    ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    ws.getCell("A1").alignment = { horizontal: "center" };
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3263" } };
    ["A2", "A3", "A4"].forEach((cellId) => {
      const cell = ws.getCell(cellId);
      cell.font = { bold: true, size: 10, color: { argb: "FF1A3263" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });

    ws.addRow([]);
    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3263" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FF547792" } },
        left: { style: "thin", color: { argb: "FF547792" } },
        bottom: { style: "thin", color: { argb: "FF547792" } },
        right: { style: "thin", color: { argb: "FF547792" } },
      };
    });

    data.forEach((rowData, rowIndex) => {
      const row = ws.addRow(rowData);
      row.eachCell((cell) => {
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: rowIndex % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC" },
        };
      });
    });

    ws.columns = [
      { width: 8 },
      { width: 22 },
      { width: 24 },
      { width: 34 },
      { width: 22 },
      { width: 16 },
      { width: 18 },
      { width: 16 },
      { width: 14 },
      { width: 16 },
      { width: 28 },
      { width: 30 },
    ];
    ws.autoFilter = { from: "A6", to: { row: Math.max(6, ws.rowCount), column: headers.length } };

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const buffer = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `rejection-analysis-${stamp}.xlsx`);
  }, [analysisRows, filters]);

  // ── Render ──────────────────────────────────────────────────────────
  const activeFilters = Object.entries(filters).filter(([key, value]) => {
    if (['dateFrom', 'dateTo', 'datePreset', 'configPart'].includes(key)) return false;
    return value && String(value).trim();
  });

  return (
    <div className="rej-analysis-container" style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: 32 }}>
      
      {/* ── Header ── */}
      <Card style={{ padding: "18px 22px", overflow: "hidden" }}>
        <div className="rej-gradient-bar" />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "center", paddingTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: `linear-gradient(135deg, ${C.danger}, ${C.danger}cc)`,
              display: "grid",
              placeItems: "center",
              boxShadow: `0 4px 16px ${C.danger}40`,
            }}>
              <AlertTriangle size={22} color="#fff" />
            </div>
            <div>
              <h1 style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 950,
                color: C.text,
                letterSpacing: "-0.02em",
              }}>
                🔬 Rejection Analysis Dashboard
              </h1>
              <p style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: C.muted,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}>
                <span>📊 Quality rejection drilldown by reason, zone, station, and shift</span>
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: C.muted }} />
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Activity size={12} color={C.ok} />
                  {kpis.total} rejects
                </span>
                <StatusBadge status={kpis.severity.level} />
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={loadData}
              disabled={loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                background: C.surf,
                color: C.text,
                padding: "10px 16px",
                fontWeight: 850,
                fontSize: 12,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> 
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </Card>

      {/* ── Professional Filters ── */}
      <Card style={{ padding: 16 }}>
        {/* Date Range Row */}
        <div className="rej-date-row">
          <DateRangePicker
            startDate={filters.dateFrom}
            endDate={filters.dateTo}
            onApply={handleDateRangeApply}
            onClear={handleDateRangeClear}
            label="📅 Select Date Range"
          />
          
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {['today', 'yesterday', 'last7', 'last30', 'last90'].map((key) => (
              <button
                key={key}
                onClick={() => handlePreset(key)}
                className={`rej-preset-btn ${filters.datePreset === key ? 'active' : ''}`}
              >
                {key === 'today' ? '📅 Today' : 
                 key === 'yesterday' ? '📅 Yesterday' :
                 key === 'last7' ? '📅 7D' :
                 key === 'last30' ? '📅 30D' :
                 '📅 90D'}
              </button>
            ))}
          </div>
        </div>

        {/* Main Filters Grid */}
        <div className="rej-filters-grid" style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", 
          gap: 10 
        }}>
          <select 
            value={filters.machineId} 
            onChange={(e) => setFilters((p) => ({ ...p, machineId: e.target.value }))}
            className="rej-filter-select"
          >
            <option value="">🏭 All Quality Gates</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.machineName || m.machine_name}</option>)}
          </select>
          
          <select 
            value={filters.lineName} 
            onChange={(e) => setFilters((p) => ({ ...p, lineName: e.target.value }))}
            className="rej-filter-select"
          >
            <option value="">🔧 All Lines</option>
            {lineOptions.map((line) => <option key={line} value={line}>{line}</option>)}
          </select>
          
          <input 
            value={filters.partId} 
            onChange={(e) => setFilters((p) => ({ ...p, partId: e.target.value }))}
            placeholder="🔍 Part ID / QR"
            className="rej-filter-input"
          />
          
          <select 
            value={filters.shiftCode} 
            onChange={(e) => setFilters((p) => ({ ...p, shiftCode: e.target.value }))}
            className="rej-filter-select"
          >
            <option value="">🕐 All Shifts</option>
            {filterOptions.shift.map((shift) => (
              <option key={shift.code} value={shift.code}>{shift.label || shift.code}</option>
            ))}
          </select>
          
          <select 
            value={filters.category} 
            onChange={(e) => setFilters((p) => ({ ...p, category: e.target.value }))}
            className="rej-filter-select"
          >
            <option value="">📂 All Categories</option>
            {filterOptions.category.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          
          <select 
            value={filters.view} 
            onChange={(e) => setFilters((p) => ({ ...p, view: e.target.value }))}
            className="rej-filter-select"
          >
            <option value="">👁️ All Views</option>
            {filterOptions.view.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          
          <select 
            value={filters.zone} 
            onChange={(e) => setFilters((p) => ({ ...p, zone: e.target.value }))}
            className="rej-filter-select"
          >
            <option value="">📍 All Zones</option>
            {filterOptions.zone.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          
          <select 
            value={filters.reason} 
            onChange={(e) => setFilters((p) => ({ ...p, reason: e.target.value }))}
            className="rej-filter-select"
          >
            <option value="">❓ All Reasons</option>
            {filterOptions.reason.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          
          <button 
            onClick={() => setFilters((p) => ({ 
              ...buildInitialFilters(),
              configPart: p.configPart,
              category: "", view: "", zone: "", reason: "", 
              machineId: "", lineName: "", partId: "", shiftCode: "",
            }))}
            className="rej-btn-clear"
          >
            <X size={14} /> Clear All
          </button>
        </div>

        {/* Active Filters Chips */}
        {(activeFilters.length > 0 || (filters.dateFrom && filters.dateTo)) && (
          <div style={{ 
            display: "flex", 
            flexWrap: "wrap", 
            gap: 6, 
            marginTop: 14, 
            paddingTop: 14, 
            borderTop: `1px solid ${C.border}40` 
          }}>
            {activeFilters.map(([key, value]) => (
              <span key={key} className="rej-filter-chip">
                <span style={{ opacity: 0.6, fontWeight: 600 }}>{key}:</span> 
                <span style={{ fontWeight: 600 }}>{String(value).slice(0, 30)}</span>
                <span className="remove" onClick={() => removeFilter(key)}>✕</span>
              </span>
            ))}
            {filters.dateFrom && filters.dateTo && (
              <span className="rej-filter-chip date-chip">
                <Calendar size={11} /> 
                {new Date(filters.dateFrom).toLocaleDateString()} → {new Date(filters.dateTo).toLocaleDateString()}
                <span className="remove" onClick={() => {
                  setFilters((p) => ({ ...buildInitialFilters(), configPart: p.configPart }));
                }}>✕</span>
              </span>
            )}
            <span style={{ 
              fontSize: 9, 
              color: C.muted, 
              fontWeight: 600,
              marginLeft: "auto",
              padding: "4px 8px",
            }}>
              {activeFilters.length + (filters.dateFrom && filters.dateTo ? 1 : 0)} active filters
            </span>
          </div>
        )}
      </Card>

      {/* ── KPI Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
        <Kpi 
          label="Total Rejects" 
          value={kpis.total} 
          icon={XCircle} 
          color={C.danger} 
          sub={`${kpis.severity.level} severity`}
        />
        <Kpi 
          label="Affected Parts" 
          value={kpis.uniqueParts} 
          icon={Target} 
          color={C.steel}
          sub={`${Math.round((kpis.uniqueParts / Math.max(1, kpis.total)) * 100)}% reject rate`}
        />
        <Kpi 
          label="Top Reason" 
          value={kpis.topReason?.reason || "-"} 
          icon={AlertTriangle} 
          color={C.navy}
          sub={`${kpis.topReason?.count || 0} occurrences`}
        />
        <Kpi 
          label="Hot Zone" 
          value={shortLabel(kpis.topZone?.name || "-", 20)} 
          icon={MapPin} 
          color={C.amber}
          sub={`${kpis.topZone?.count || 0} rejects`}
        />
      </div>

      {/* ── Charts Row 1 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 400px) 1fr", gap: 16 }} className="rej-grid">
        <style>{`@media(max-width:980px){.rej-grid{grid-template-columns:1fr!important}}`}</style>
        
        {/* ── Pie Chart ── */}
        <Card style={{ padding: 18 }}>
          <SectionHead 
            title="Rejection Distribution" 
            subtitle="By rejection type" 
            icon={PieChartIcon} 
            accentColor={C.amber}
          />
          <SafeChart height={260}>
            {({ width, height }) => (
              <PieChart width={width} height={height}>
                <Pie 
                  data={pieData} 
                  dataKey="value" 
                  cx="50%" 
                  cy="50%" 
                  outerRadius={90}
                  innerRadius={50}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={true}
                >
                  {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            )}
          </SafeChart>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", marginTop: 8 }}>
            {pieData.map((row) => (
              <div key={row.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: C.text }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: row.color }} />
                <span>{row.icon} {row.name.replace(/ - .*/, "")}</span>
                <strong style={{ color: row.color }}>{row.value}</strong>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Trend Chart ── */}
        <Card style={{ padding: 18 }}>
          <SectionHead 
            title="Hourly Rejection Trend" 
            subtitle={selectedHourSlot ? `${selectedHourSlot} selected - reason and zone detail shown` : "Click any bar to inspect reason and zone detail"}
            icon={LineChartIcon}
            accentColor={C.navy}
            right={
              <select 
                value={chartMode} 
                onChange={(e) => setChartMode(e.target.value)}
                className="rej-filter-select"
                style={{ width: 120, padding: "6px 10px", fontSize: 11 }}
              >
                <option value="area">📊 Area</option>
                <option value="bar">📊 Bar</option>
                <option value="composed">📊 Composed</option>
              </select>
            }
          />
          <div className={`rej-chart-shell ${selectedHourSlot ? "has-drilldown" : ""}`}>
            <SafeChart height={selectedHourSlot ? 320 : 280}>
              {({ width, height }) => {
                if (chartMode === "composed") {
                  return (
                    <ComposedChart width={width} height={height} data={trendData}>
                      <CartesianGrid strokeDasharray="3 4" vertical={false} stroke={`${C.border}60`} />
                      <XAxis dataKey="slot" tick={{ fontSize: 9, fontWeight: 700 }} />
                      <YAxis tick={{ fontSize: 9, fontWeight: 700 }} />
                      <Tooltip />
                      <Bar dataKey="cr" name="CR" stackId="a" fill={C.danger} onClick={handleHourClick} cursor="pointer" />
                      <Bar dataKey="cram" name="CRAM" stackId="a" fill={C.amber} onClick={handleHourClick} cursor="pointer" />
                      <Bar dataKey="mr" name="MR" stackId="a" fill={C.steel} onClick={handleHourClick} cursor="pointer" />
                      <Line type="monotone" dataKey="total" stroke={C.navy} strokeWidth={2} dot={false} />
                    </ComposedChart>
                  );
                }
                if (chartMode === "bar") {
                  return (
                    <RechartsBarChart width={width} height={height} data={trendData}>
                      <CartesianGrid strokeDasharray="3 4" vertical={false} stroke={`${C.border}60`} />
                      <XAxis dataKey="slot" tick={{ fontSize: 9, fontWeight: 700 }} />
                      <YAxis tick={{ fontSize: 9, fontWeight: 700 }} />
                      <Tooltip />
                      <Bar dataKey="cr" name="CR" stackId="a" fill={C.danger} radius={[4, 4, 0, 0]} onClick={handleHourClick} cursor="pointer" />
                      <Bar dataKey="cram" name="CRAM" stackId="a" fill={C.amber} radius={[4, 4, 0, 0]} onClick={handleHourClick} cursor="pointer" />
                      <Bar dataKey="mr" name="MR" stackId="a" fill={C.steel} radius={[4, 4, 0, 0]} onClick={handleHourClick} cursor="pointer" />
                    </RechartsBarChart>
                  );
                }
                return (
                  <AreaChart width={width} height={height} data={trendData}>
                    <CartesianGrid strokeDasharray="3 4" vertical={false} stroke={`${C.border}60`} />
                    <XAxis dataKey="slot" tick={{ fontSize: 9, fontWeight: 700 }} />
                    <YAxis tick={{ fontSize: 9, fontWeight: 700 }} />
                    <Tooltip />
                    <Area dataKey="cr" name="CR" stackId="a" stroke={C.danger} fill={C.danger} fillOpacity={0.3} />
                    <Area dataKey="cram" name="CRAM" stackId="a" stroke={C.amber} fill={C.amber} fillOpacity={0.3} />
                    <Area dataKey="mr" name="MR" stackId="a" stroke={C.steel} fill={C.steel} fillOpacity={0.3} />
                  </AreaChart>
                );
              }}
            </SafeChart>
            {selectedHourSlot && (
              <div className="rej-drilldown-panel">
                <div className="rej-drilldown-head">
                  <div>
                    <p className="rej-drilldown-title">{selectedHourSlot} Details</p>
                    <p className="rej-drilldown-subtitle">Reason + zone split</p>
                  </div>
                  <button className="rej-mini-clear" onClick={() => setSelectedHourSlot("")}>Clear</button>
                </div>
                <SafeChart height={145}>
                  {({ width, height }) => (
                    <RechartsBarChart width={width} height={height} data={selectedHourReasonData}>
                      <CartesianGrid strokeDasharray="3 4" vertical={false} stroke={`${C.border}60`} />
                      <XAxis dataKey="label" tick={{ fontSize: 8, fontWeight: 800 }} />
                      <YAxis tick={{ fontSize: 8, fontWeight: 800 }} width={26} />
                      <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.reason || ""} />
                      <Bar dataKey="count" name="Reason Count" radius={[4, 4, 0, 0]}>
                        {selectedHourReasonData.map((entry, index) => (
                          <Cell key={entry.reason} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </RechartsBarChart>
                  )}
                </SafeChart>
                <SafeChart height={145}>
                  {({ width, height }) => (
                    <RechartsBarChart width={width} height={height} data={selectedHourLocationData}>
                      <CartesianGrid strokeDasharray="3 4" vertical={false} stroke={`${C.border}60`} />
                      <XAxis dataKey="label" tick={{ fontSize: 8, fontWeight: 800 }} />
                      <YAxis tick={{ fontSize: 8, fontWeight: 800 }} width={26} />
                      <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.location || ""} />
                      <Bar dataKey="count" name="Zone/Sub Zone" radius={[4, 4, 0, 0]}>
                        {selectedHourLocationData.map((entry, index) => (
                          <Cell key={entry.location} fill={CHART_COLORS[(index + 3) % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </RechartsBarChart>
                  )}
                </SafeChart>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Pareto Analysis */}
      <Card style={{ padding: 18 }}>
        <SectionHead 
          title="Pareto Rejection Analysis" 
          subtitle={selectedParetoReason ? `${shortLabel(selectedParetoReason, 32)} selected - source detail shown` : "Click any reason bar to inspect zone and sub-zone source"}
          icon={BarChartIcon}
          accentColor={C.danger}
        />
        <div className={`rej-chart-shell ${selectedParetoReason ? "has-drilldown" : ""}`}>
          <SafeChart height={selectedParetoReason ? 330 : 310}>
            {({ width, height }) => (
              <ComposedChart width={width} height={height} data={paretoData} margin={{ top: 10, right: 26, left: 0, bottom: 34 }}>
                <CartesianGrid strokeDasharray="3 4" vertical={false} stroke={`${C.border}60`} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fontWeight: 800 }} interval={0} angle={-18} textAnchor="end" height={54} />
                <YAxis yAxisId="count" tick={{ fontSize: 9, fontWeight: 800 }} />
                <YAxis yAxisId="percent" orientation="right" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 9, fontWeight: 800 }} />
                <Tooltip
                  formatter={(value, name) => name === "Cumulative %" ? [`${value}%`, name] : [value, name]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.reason || ""}
                />
                <Bar yAxisId="count" dataKey="count" name="Reject Count" fill={C.danger} radius={[5, 5, 0, 0]} onClick={handleParetoClick} cursor="pointer" />
                <Line
                  yAxisId="percent"
                  type="monotone"
                  dataKey="cumulativePercent"
                  name="Cumulative %"
                  stroke={C.navy}
                  strokeWidth={3}
                  dot={{ r: 3, strokeWidth: 2, fill: C.white }}
                />
              </ComposedChart>
            )}
          </SafeChart>
          {selectedParetoReason && (
            <div className="rej-drilldown-panel">
              <div className="rej-drilldown-head">
                <div>
                  <p className="rej-drilldown-title">{shortLabel(selectedParetoReason, 26)}</p>
                  <p className="rej-drilldown-subtitle">Zone/Sub-zone source</p>
                </div>
                <button className="rej-mini-clear" onClick={() => setSelectedParetoReason("")}>Clear</button>
              </div>
              <SafeChart height={286}>
                {({ width, height }) => (
                  <RechartsBarChart width={width} height={height} data={selectedParetoLocations} layout="vertical" margin={{ top: 6, right: 14, left: 78, bottom: 6 }}>
                    <CartesianGrid strokeDasharray="3 4" horizontal={false} stroke={`${C.border}60`} />
                    <XAxis type="number" tick={{ fontSize: 8, fontWeight: 800 }} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 8, fontWeight: 800 }} width={76} />
                    <Tooltip labelFormatter={(_, payload) => payload?.[0]?.payload?.location || ""} />
                    <Bar dataKey="count" name="Reject Count" radius={[0, 5, 5, 0]}>
                      {selectedParetoLocations.map((entry, index) => (
                        <Cell key={entry.location} fill={CHART_COLORS[(index + 2) % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </RechartsBarChart>
                )}
              </SafeChart>
            </div>
          )}
        </div>
      </Card>

      {/* ── Charts Row 2 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="rej-grid">
        {/* ── Shift Analysis ── */}
        <Card style={{ padding: 18 }}>
          <SectionHead 
            title="Shift Performance Analysis" 
            subtitle="Rejection by shift"
            icon={Clock}
            accentColor={C.purple}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shiftAnalysis.map((shift) => {
              const total = shift.total || 0;
              const maxTotal = Math.max(1, ...shiftAnalysis.map(s => s.total));
              return (
                <div key={shift.shift}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>
                    <span>🕐 {shift.shift}</span>
                    <span style={{ color: C.danger }}>{total} rejects</span>
                  </div>
                  <div style={{ display: "flex", gap: 3, height: 20, borderRadius: 6, overflow: "hidden", background: `${C.border}40` }}>
                    <div style={{ 
                      width: `${(shift.cr / Math.max(1, total)) * 100}%`, 
                      background: C.danger,
                      transition: "width 0.5s ease",
                    }} title={`CR: ${shift.cr}`} />
                    <div style={{ 
                      width: `${(shift.cram / Math.max(1, total)) * 100}%`, 
                      background: C.amber,
                      transition: "width 0.5s ease",
                    }} title={`CRAM: ${shift.cram}`} />
                    <div style={{ 
                      width: `${(shift.mr / Math.max(1, total)) * 100}%`, 
                      background: C.steel,
                      transition: "width 0.5s ease",
                    }} title={`MR: ${shift.mr}`} />
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 9, color: C.muted, marginTop: 3 }}>
                    <span>🔥 {shift.cr || 0}</span>
                    <span>📐 {shift.cram || 0}</span>
                    <span>⚙️ {shift.mr || 0}</span>
                  </div>
                </div>
              );
            })}
            {!shiftAnalysis.length && <Empty text="No shift data available" />}
          </div>
        </Card>

        {/* ── Top Reasons ── */}
        <Card style={{ padding: 18 }}>
          <SectionHead 
            title="Top Rejection Reasons" 
            subtitle="Most frequent quality issues"
            icon={AlertCircle}
            accentColor={C.danger}
          />
          <div className="rej-slim-scrollbar" style={{ maxHeight: 300, overflowY: "auto" }}>
            {topReasons.map((row, idx) => {
              const pct = (row.count / Math.max(1, kpis.total)) * 100;
              const severity = getSeverityLevel(row.count, topReasons[0]?.count || 1);
              return (
                <div key={row.reason} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderBottom: `1px solid ${C.border}30`,
                  transition: "background 0.15s ease",
                }}>
                  <span style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: `${severity.color}20`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 900,
                    color: severity.color,
                    flexShrink: 0,
                  }}>{idx + 1}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: C.text }}>{shortLabel(row.reason, 35)}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 60,
                      height: 6,
                      borderRadius: 3,
                      background: `${C.border}30`,
                      overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: severity.color,
                        borderRadius: 3,
                        transition: "width 0.5s ease",
                      }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: severity.color, minWidth: 30 }}>
                      {row.count}
                    </span>
                  </div>
                </div>
              );
            })}
            {!topReasons.length && <Empty text="No rejection reasons found" />}
          </div>
        </Card>
      </div>

      {/* ── Zone Heat Map ── */}
      <Card style={{ padding: 18 }}>
        <SectionHead 
          title="📍 Zone Heat Map" 
          subtitle="Visual rejection density by zone"
          icon={MapPin}
          accentColor={C.gold}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <select 
                value={filters.configPart} 
                onChange={(e) => setFilters((p) => ({ ...p, configPart: e.target.value, view: "", zone: "" }))}
                className="rej-filter-select"
                style={{ width: 180 }}
              >
                <option value="">Select Part</option>
                {configuredParts.map((part) => <option key={part} value={part}>{part}</option>)}
              </select>
              <select
                value={filters.view}
                onChange={(e) => setFilters((p) => ({ ...p, view: e.target.value, zone: "" }))}
                className="rej-filter-select"
                style={{ width: 180 }}
                disabled={!heatViews.length}
              >
                <option value="">All Views</option>
                {heatViews.map((view) => (
                  <option key={view.id || view.code || view.name} value={view.name || view.code}>
                    {view.name || view.code}
                  </option>
                ))}
              </select>
              <button 
                onClick={() => setShowHeatMapDetails(!showHeatMapDetails)}
                className="rej-filter-select"
                style={{ width: 34, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                title="Toggle details"
              >
                {showHeatMapDetails ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button 
                onClick={() => setHeatMapZoom(Math.min(2, heatMapZoom + 0.1))}
                className="rej-filter-select"
                style={{ width: 34, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                title="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
              <button 
                onClick={() => setHeatMapZoom(Math.max(0.5, heatMapZoom - 0.1))}
                className="rej-filter-select"
                style={{ width: 34, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                title="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <button 
                onClick={() => setHeatMapZoom(1)}
                className="rej-filter-select"
                style={{ width: 34, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800 }}
                title="Reset zoom"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          }
        />
        
        {!heatView ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <Grid size={32} color={C.muted} style={{ marginBottom: 12 }} />
            <Empty text="No configured part view available. Please select a part with a zone map." />
          </div>
        ) : (
          <div className="rej-slim-scrollbar" style={{ position: "relative", overflow: "auto", padding: heatMapZoom === 1 ? 0 : 12 }}>
            <div style={{
              position: "relative",
              width: `${Math.round(heatMapZoom * 100)}%`,
              maxWidth: Math.round(1100 * heatMapZoom),
              margin: "0 auto",
              aspectRatio: "1100 / 640",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              overflow: "hidden",
              background: C.surf,
              filter: "none",
              transition: "width 0.2s ease, max-width 0.2s ease",
            }}>
              {/* Background Image */}
              {heatView.imageUrl && (
                <img 
                  src={heatView.imageUrl} 
                  alt={heatView.name} 
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    opacity: 1,
                    filter: "none",
                    transform: "none",
                    imageRendering: "auto",
                  }} 
                />
              )}

              {/* Zone Overlays */}
              {heatMapMarkers.map((zone) => {
                const count = zone.count || 0;
                const intensity = count / heatMax;
                const color = count ? (
                  intensity > 0.8 ? C.danger :
                  intensity > 0.5 ? "#f97316" :
                  intensity > 0.25 ? C.amber :
                  C.ok
                ) : `${C.border}40`;
                
                const isSelected = selectedZone === zone.id;
                const severity = getSeverityLevel(count, heatMax);
                const bgOpacity = Math.min(230, 150 + (intensity * 80));

                return (
                  <div
                    key={zone.id}
                    className={`rej-heat-zone ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedZone(isSelected ? null : zone.id)}
                    style={{
                      left: `${zone.xPercent || 0}%`,
                      top: `${zone.yPercent || 0}%`,
                      width: `${zone.widthPercent || 12}%`,
                      height: `${zone.heightPercent || 12}%`,
                      background: count > 0 ? `${color}${bgOpacity.toString(16).padStart(2, '0')}` : 'transparent',
                      borderColor: isSelected ? '#fff' : color,
                      borderWidth: isSelected ? '3px' : '2px',
                      boxShadow: isSelected
                        ? `0 0 0 3px ${color}80, 0 8px 34px rgba(0,0,0,0.45)`
                        : `0 4px 18px ${color}70, inset 0 0 0 1px rgba(255,255,255,0.35)`,
                      transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                      zIndex: isSelected ? 25 : (count > 0 ? 10 : 1),
                      fontSize: count > 5 ? 13 : count > 2 ? 12 : 11,
                      color: '#fff',
                      textShadow: `0 2px 6px rgba(0,0,0,0.75)`,
                      fontWeight: 900,
                      minWidth: '20px',
                      minHeight: '20px',
                    }}
                  >
                    {showHeatMapDetails ? (
                      <>
                        <span className="zone-label" style={{
                          fontSize: 'inherit',
                          lineHeight: 1.05,
                          fontWeight: 950,
                          letterSpacing: "0.02em",
                        }}>
                          {zone.code || zone.name}
                        </span>
                        <span className="zone-count" style={{
                          fontSize: count > 5 ? 17 : 15,
                          fontWeight: 900,
                          background: `${color}e6`,
                          border: "1px solid rgba(255,255,255,0.45)",
                          padding: '2px 8px',
                          borderRadius: 6,
                        }}>
                          {count}
                        </span>
                        {count > 5 && (
                          <span style={{
                            fontSize: 7,
                            opacity: 0.8,
                            fontWeight: 700,
                            marginTop: -2,
                          }}>{severity.icon}</span>
                        )}
                      </>
                    ) : (
                      count > 0 && (
                        <span style={{
                          fontSize: count > 10 ? 22 : count > 5 ? 18 : 16,
                          fontWeight: 900,
                          background: `${color}e6`,
                          border: "1px solid rgba(255,255,255,0.45)",
                          padding: '3px 10px',
                          borderRadius: 6,
                          textShadow: '0 2px 6px rgba(0,0,0,0.75)',
                        }}>
                          {count}
                        </span>
                      )
                    )}
                  </div>
                );
              })}

            </div>

            {/* Zone Details Panel */}
            {selectedZone && (
              <div style={{
                marginTop: 14,
                padding: 16,
                background: `${C.card}`,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                display: "grid",
                gridTemplateColumns: "auto 1fr auto",
                gap: 16,
                alignItems: "center",
                animation: "fadeSlideUp 0.25s ease",
              }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: `${C.gold}20`,
                  border: `1px solid ${C.gold}40`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <MapPin size={20} color={C.gold} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
                    {heatMapMarkers.find(z => z.id === selectedZone)?.name || "Zone Details"}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, display: "flex", gap: 16, flexWrap: "wrap", marginTop: 2 }}>
                    <span>📍 Code: {heatMapMarkers.find(z => z.id === selectedZone)?.code || "-"}</span>
                    <span>🔢 Rejects: <strong style={{ color: C.danger }}>{heatMapMarkers.find(z => z.id === selectedZone)?.count || 0}</strong></span>
                    <StatusBadge 
                      status={heatMapMarkers.find(z => z.id === selectedZone)?.severity?.level || "Low"} 
                    />
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedZone(null)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                    background: "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: C.muted,
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = `${C.danger}10`}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Machine Performance ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="rej-grid">
        <Card style={{ padding: 18 }}>
          <SectionHead 
            title="🏭 Machine Performance" 
            subtitle="Rejects by quality gate"
            icon={Cog}
            accentColor={C.steel}
          />
          {machinePerformance.map((machine, idx) => {
            const pct = (machine.total / Math.max(1, kpis.total)) * 100;
            return (
              <div key={machine.machine} style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 0",
                borderBottom: `1px solid ${C.border}20`,
              }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 800,
                  color: C.muted,
                  width: 24,
                }}>#{idx + 1}</span>
                <span style={{
                  flex: 1,
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.text,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>{shortLabel(machine.machine, 25)}</span>
                <div style={{
                  width: 80,
                  height: 6,
                  borderRadius: 3,
                  background: `${C.border}30`,
                  overflow: "hidden",
                }}>
                  <div style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: `linear-gradient(90deg, ${C.steel}, ${C.danger})`,
                    borderRadius: 3,
                    transition: "width 0.5s ease",
                  }} />
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: C.danger,
                  minWidth: 30,
                  textAlign: "right",
                }}>{machine.total}</span>
              </div>
            );
          })}
          {!machinePerformance.length && <Empty text="No machine performance data" />}
        </Card>

        {/* ── Zone Summary ── */}
        <Card style={{ padding: 18 }}>
          <SectionHead 
            title="📍 Zone Summary" 
            subtitle="Rejection concentration by zone"
            icon={Target}
            accentColor={C.amber}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {zoneWise.map((row, idx) => {
              const maxCount = zoneWise[0]?.count || 1;
              const pct = (row.count / maxCount) * 100;
              const severity = getSeverityLevel(row.count, maxCount);
              return (
                <div key={row.name} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px",
                  borderRadius: 6,
                  background: idx % 2 === 0 ? C.surf : "transparent",
                  transition: "background 0.15s ease",
                }}>
                  <span style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: `${severity.color}20`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontWeight: 900,
                    color: severity.color,
                    flexShrink: 0,
                  }}>{idx + 1}</span>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: C.text }}>
                    {shortLabel(row.name, 30)}
                  </span>
                  <div style={{
                    width: 50,
                    height: 5,
                    borderRadius: 2,
                    background: `${C.border}30`,
                    overflow: "hidden",
                  }}>
                    <div style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: severity.color,
                      borderRadius: 2,
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: severity.color,
                    minWidth: 25,
                    textAlign: "right",
                  }}>{row.count}</span>
                </div>
              );
            })}
            {!zoneWise.length && <Empty text="No zone data available" />}
          </div>
        </Card>
      </div>

      {/* ── Detailed Rejection Table ── */}
      <Card style={{ overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <SectionHead 
            title="📋 Rejected Parts Details" 
            subtitle={`${analysisRows.length} records found`}
            icon={ClipboardCheck}
            accentColor={C.steel}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={downloadExcel}
              disabled={!analysisRows.length}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 16px",
                borderRadius: 8,
                border: `1px solid ${!analysisRows.length ? C.border : C.ok}`,
                background: !analysisRows.length ? C.surf : `${C.ok}10`,
                color: !analysisRows.length ? C.muted : C.ok,
                fontSize: 10,
                fontWeight: 700,
                cursor: !analysisRows.length ? "not-allowed" : "pointer",
                transition: "all 0.15s ease",
                opacity: analysisRows.length ? 1 : 0.55,
              }}
              onMouseEnter={(e) => {
                if (analysisRows.length) {
                  e.currentTarget.style.background = `${C.ok}20`;
                  e.currentTarget.style.borderColor = C.ok;
                }
              }}
              onMouseLeave={(e) => {
                if (analysisRows.length) {
                  e.currentTarget.style.background = `${C.ok}10`;
                  e.currentTarget.style.borderColor = C.ok;
                }
              }}
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
          </div>
        </div>
        <div className="rej-slim-scrollbar" style={{ overflow: "auto", maxHeight: 520 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
            <thead>
              <tr style={{ background: C.navy }}>
                {["🕐 Time", "🔹 Part ID", "🔲 Customer QR", "🏭 Quality Gate", "📏 Line",
                  "📂 Category", "👁️ View", "📍 Zone", "Sub Zone", "❓ Reason", "📝 Remark"].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysisRows.map((row) => {
                const type = normalizeRejectionType(row);
                const details = resolveRejectionDetails(row);
                return (
                  <tr key={getRejectionRowKey(row)} style={{ transition: "background 0.1s ease" }}>
                    <td style={td}>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "-"}</td>
                    <td style={tdMono}>{row.partId || "-"}</td>
                    <td style={tdMono}>{row.customerQrCode || "-"}</td>
                    <td style={td}>{row.machineName || row.stationNo || "-"}</td>
                    <td style={td}>{row.lineName || "-"}</td>
                    <td style={td}>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: `${type.color}20`,
                        color: type.color,
                        fontWeight: 700,
                        fontSize: 10,
                      }}>
                        {type.icon} {type.type}
                      </span>
                    </td>
                    <td style={td}>{details.view || "-"}</td>
                    <td style={td}>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: details.zone ? `${C.gold}20` : 'transparent',
                        color: details.zone ? C.gold : C.muted,
                        fontWeight: details.zone ? 700 : 400,
                        fontSize: 10,
                      }}>
                        {details.zone ? `📍 ${details.zone}` : "-"}
                      </span>
                    </td>
                    <td style={td}>{details.subZone || "-"}</td>
                    <td style={{ ...td, maxWidth: 200, whiteSpace: "normal", wordBreak: "break-word" }}>
                      {details.reason || "-"}
                    </td>
                    <td style={td}>{row.remark || "-"}</td>
                  </tr>
                );
              })}
              {!analysisRows.length && (
                <tr>
                  <td colSpan={11} style={{ ...td, textAlign: "center", padding: 40 }}>
                    <Empty text={loading ? "⏳ Loading rejection data..." : "📭 No rejections found for selected filters."} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const th = {
  position: "sticky",
  top: 0,
  background: C.navy,
  color: "#fff",
  padding: "12px 14px",
  textAlign: "left",
  fontSize: 10,
  fontWeight: 900,
  whiteSpace: "nowrap",
  letterSpacing: ".04em",
};

const td = {
  borderTop: `1px solid ${C.border}40`,
  padding: "10px 14px",
  fontSize: 11,
  color: C.text,
  whiteSpace: "nowrap",
};

const tdMono = {
  ...td,
  fontFamily: "'DM Mono', Consolas, monospace",
};
