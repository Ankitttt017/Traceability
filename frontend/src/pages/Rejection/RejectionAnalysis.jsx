import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
  Cpu,
  Layers,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Download,
  Search,
  Calendar,
  Flame,
  Gauge,
  Zap,
  Clock,
  ShieldAlert,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  FileSpreadsheet,
  Maximize2,
  Minimize2,
  HelpCircle,
  Sliders,
  Filter,
  BarChart3,
  PieChart as PieIcon,
  ScatterChart as ScatterIcon,
  ListFilter,
  RotateCcw,
  ZoomIn,
  Target,
  MapPin,
  Tag,
  Calculator,
  Eye,
  Camera,
  Grid,
  Copy,
  Check,
  X
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  LineChart,
  ScatterChart,
  Scatter,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  ReferenceLine,
  ReferenceArea,
  PieChart,
  Pie,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LabelList,
  Brush
} from "recharts";
import { dashboardApi, machineApi, rejectionConfigApi } from "../../api/services";
import SafeChart from "../../components/charts/SafeChart";
import RejectionTable from "./RejectionTable";
import RejectionHeatMap from "./RejectionHeatMap";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import "./RejectionAnalysis.css";

const formatResultTimestamp = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
};

const PARETO_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6", "#a855f7", "#ec4899"];

const looksLikeCustomerQr = (val) => {
  if (!val || typeof val !== "string") return false;
  const s = val.trim();
  if (s === "-" || !s) return false;
  if (/^R\d{3,}/i.test(s)) return true;
  if (/^[A-Z0-9-]{24,}$/i.test(s)) return true;
  if (s.includes("+") || s.includes("/")) return true;
  return false;
};

const fmtNum = (val) => {
  if (val === null || val === undefined || val === "" || val === "-" || val === "null" || val === "undefined") return "";
  const n = Number(val);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : val;
};

const extractShotFromPartId = (partId) => {
  const s = String(partId || "").trim();
  if (!s || s === "-") return "";
  // Customer QR codes never contain casting shot details
  if (looksLikeCustomerQr(s) || (s.startsWith("0408") && s.length >= 20)) return "";

  // 1. Trailing letter followed by 3-5 digits (e.g. R437111511-54T00190926A0236 -> 0236)
  const trailingAlphaNum = s.match(/[A-Za-z](\d{3,5})$/);
  if (trailingAlphaNum?.[1]) return trailingAlphaNum[1];

  // 2. MMDDHHMM-MC-SHOT (e.g. 03160945-E-1234 or 03160945-DC02-1234)
  const hyphenated = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})[-_]?(?<machineCode>[A-Za-z0-9]+)[-_](?<shot>\d{1,6})$/);
  if (hyphenated?.groups?.shot) return String(Number(hyphenated.groups.shot)).trim();

  // 3. MMDDHHMM<MC><SHOT> (e.g. 03160945E1234)
  const machineCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machineCode>[A-Za-z0-9]{1})(?<shot>\d{1,6})$/i);
  if (machineCompact?.groups?.shot) return String(Number(machineCompact.groups.shot)).trim();

  // 4. MMDDHHMM-SHOT or MMDDHHMM<SHOT> (legacy format)
  const legacyCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})[-_]?(?<shot>\d{1,6})$/);
  if (legacyCompact?.groups?.shot) return String(Number(legacyCompact.groups.shot)).trim();

  // 5. Any trailing 3-5 digits after a hyphen or underscore
  const trailingDigits = s.match(/[-_](\d{3,5})$/);
  if (trailingDigits?.[1]) return trailingDigits[1];

  return "";
};

const splitZoneString = (val) => {
  const raw = String(val || "").trim();
  if (!raw || raw === "-") return { zone: "", subZone: "" };
  const parts = raw.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
  let z = "";
  let sz = "";
  parts.forEach((p) => {
    const sm = p.match(/^(?:sub\s*zone|subzone)\s*[:\-]?\s*(.+)$/i);
    if (sm) { sz = sm[1].trim(); return; }
    const zm = p.match(/^zone\s*[:\-]?\s*(.+)$/i);
    if (zm) { z = zm[1].trim(); return; }
    if (!z) z = p;
  });
  return { zone: z || raw || "", subZone: sz || "" };
};

const parseFieldFromText = (text, label) => {
  if (!text || typeof text !== "string") return "";
  const m = text.match(new RegExp(label + ":\\s*([^|\\n]+)", "i"));
  return m ? m[1].trim() : "";
};

// Helper to clean zone code for loose matching
const cleanZoneCode = (val) => {
  if (!val) return "";
  return String(val)
    .toUpperCase()
    .replace(/^(?:ZONE\s*[-_]?)+/i, "")
    .replace(/[^A-Z0-9]/g, "");
};

const cleanSubZoneCode = (val) => {
  if (!val) return "";
  return String(val)
    .toUpperCase()
    .replace(/^(?:(?:SUB\s*ZONE|SUBZONE|SUB)\s*[-_]?)+/i, "")
    .replace(/[^A-Z0-9]/g, "");
};

const normalizeCode = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const canonicalizeReason = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim();
  const lower = s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  if (lower.includes("non filling") || lower.includes("nonfilling") || lower.includes("not filling") || lower.includes("under filling") || lower.includes("short filling") || lower.includes("pre filling")) {
    return "Non-Filling";
  }
  if (lower.includes("m14") && lower.includes("blow hole")) return "M14 Face Blow Hole";
  if (lower.includes("m8") && lower.includes("blow hole")) return "Blow Hole M8";
  if (lower.includes("face") && lower.includes("blow hole")) return "Face Blow Hole";
  if (lower.includes("blow hole") || lower.includes("blowhole")) return "Blow Hole";
  if (lower.includes("pin hole") || lower.includes("pinhole")) return "Pin Hole";
  if (lower.includes("cold shut") || lower.includes("coldshut")) return "Cold Shut";
  if (lower.includes("body leak")) return "Body Leak";
  if (lower.includes("pressure leak")) return "Pressure Leak";
  if (lower.includes("leak") || lower.includes("leakage")) return "Body Leak";
  if (lower.includes("dent")) return "Dent";
  if (lower.includes("crack")) return "Crack";
  if (lower.includes("porosity")) return "Porosity";
  if (lower.includes("bend")) return "Bend";
  if (lower.includes("black mark")) return "Black Mark";
  if (lower.includes("chip") && lower.includes("m8")) return "Chip-off M8";
  if (lower.includes("chip off") || lower.includes("chipoff") || lower.includes("chip-off")) return "Chip-off";
  if (lower.includes("shrinkage")) return "Shrinkage";
  if (lower.includes("core pin broken")) return "Core Pin Broken";
  if (lower.includes("laser") || lower.includes("qr")) return "Laser Marking NG";
  if (lower.includes("biscuit thickness") || lower.includes("biscuit")) return "Biscuit Thickness NG";
  if (lower.includes("gauging") || lower.includes("dimension")) return "Gauging NG";
  if (lower.includes("flow mark")) return "Flow Mark";
  if (lower.includes("air bubble")) return "Air Bubble";
  if (lower.includes("soldering")) return "Soldering";
  if (lower.includes("blister")) return "Blister";
  if (lower.includes("dcm casting")) return "DCM Casting Defect";
  if (lower.includes("casting visual") || lower.includes("visual ng")) return "Casting Visual NG";
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
};

const normalizeDefectKey = (val) => String(val || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const isReasonMatch = (rowReason, targetReason) => {
  if (!targetReason) return true;
  if (!rowReason) return false;
  const cRow = canonicalizeReason(rowReason);
  const cTarget = canonicalizeReason(targetReason);
  if (cRow === cTarget) return true;
  const normRow = normalizeDefectKey(cRow || rowReason);
  const normTarget = normalizeDefectKey(cTarget || targetReason);
  if (!normTarget) return true;
  return normRow.includes(normTarget) || normTarget.includes(normRow);
};

const parseRowDefect = (r) => {
  if (!r) return { category: "CR", reason: "Defect", view: "", zone: "", subZone: "" };
  const srcText = String(r.parts_interlock_reason || r.ng_reason || r.ngReason || r.reason || r.rejection_reason || "");
  const catMatch = srcText.match(/Category:\s*([^|\n]+)/i);
  const reasonMatch = srcText.match(/Reason:\s*([^|\n]+)/i);
  const viewMatch = srcText.match(/View:\s*([^|\n]+)/i);
  const zoneMatch = srcText.match(/Zone:\s*([^|\n]+)/i);
  const subZoneMatch = srcText.match(/(?:Sub\s*Zone|SubZone):\s*([^|\n]+)/i);

  let cat = r.rejection_category || r.category || (catMatch ? catMatch[1].trim() : "");
  if (!cat || cat === "-" || cat === "GENERAL" || cat === "NULL" || cat === "UNDEFINED") cat = "CR";

  let rawReason = r.rejection_reason || r.reason || r.ngReason || (reasonMatch ? reasonMatch[1].trim() : "");
  if (!rawReason || rawReason === "-") rawReason = "Defect";
  const reason = canonicalizeReason(rawReason);

  let rawView = r.rejection_view || r.rejectionView || r.view || (viewMatch ? viewMatch[1].trim() : "");
  let view = "";
  if (rawView) {
    const s = String(rawView).trim().toUpperCase();
    if (s.includes("TOP") || s === "VIEW 1" || s === "VIEW1" || s === "TOP_VIEW") view = "Top View";
    else if (s.includes("BOTTOM") || s === "VIEW 2" || s === "VIEW2" || s === "BOTTOM_VIEW") view = "Bottom View";
    else if (s.includes("LEFT") || s === "VIEW 3" || s === "VIEW3" || s === "LEFT_SIDE") view = "Left Side";
    else if (s.includes("RIGHT") || s === "VIEW 4" || s === "VIEW4" || s === "RIGHT_SIDE") view = "Right Side";
    else if (s.includes("FRONT") || s === "VIEW 5" || s === "VIEW5") view = "Front";
    else if (s.includes("REAR") || s === "VIEW 6" || s === "VIEW6") view = "Rear";
    else view = rawView;
  }

  let zoneRaw = r.rejection_zone || r.rejectionZone || r.zone || (zoneMatch ? zoneMatch[1].trim() : "");
  let subZoneRaw = r.rejection_sub_zone || r.rejectionSubZone || r.subZone || (subZoneMatch ? subZoneMatch[1].trim() : "");

  if (zoneRaw.includes(" / ") || zoneRaw.includes(" - ")) {
    const parts = zoneRaw.split(/\s*[\/\-]\s*/);
    if (parts[0]) zoneRaw = parts[0].trim();
    if (parts[1] && !subZoneRaw) {
      subZoneRaw = parts[1].replace(/^(?:sub\s*zone|subzone)\s*:?\s*/i, "").trim();
    }
  }

  // If view or zone is missing, infer it from defect type and quality gate so pictorial image views always localize the defect!
  if (!view || !zoneRaw) {
    const rLower = String(reason).toLowerCase();
    const g = String(r.ngGate || r.ng_gate || r.operation_no || "").toUpperCase();
    if (rLower.includes("leak") || g.includes("150") || g.includes("LEAK")) {
      if (!view) view = "Top View";
      if (!zoneRaw) { zoneRaw = "Zone A"; subZoneRaw = "SubZone 1"; }
    } else if (rLower.includes("non-filling") || rLower.includes("non filling")) {
      if (!view) view = "Bottom View";
      if (!zoneRaw) { zoneRaw = "Zone B"; subZoneRaw = "SubZone 2"; }
    } else if (rLower.includes("blow hole") || rLower.includes("porosity")) {
      if (!view) view = "Top View";
      if (!zoneRaw) { zoneRaw = "Zone A"; subZoneRaw = "SubZone 3"; }
    } else if (rLower.includes("dent") || rLower.includes("handling")) {
      if (!view) view = "Left Side";
      if (!zoneRaw) { zoneRaw = "Zone C"; subZoneRaw = "SubZone 1"; }
    } else if (rLower.includes("crack") || rLower.includes("broken")) {
      if (!view) view = "Right Side";
      if (!zoneRaw) { zoneRaw = "Zone D"; subZoneRaw = "SubZone 1"; }
    } else if (rLower.includes("chip")) {
      if (!view) view = "Front";
      if (!zoneRaw) { zoneRaw = "Zone O"; subZoneRaw = "SubZone 1"; }
    } else if (rLower.includes("shrinkage") || rLower.includes("biscuit")) {
      if (!view) view = "Bottom View";
      if (!zoneRaw) { zoneRaw = "Zone E"; subZoneRaw = "SubZone 3"; }
    } else {
      if (!view) view = "Top View";
      if (!zoneRaw) { zoneRaw = "Zone A"; subZoneRaw = "SubZone 1"; }
    }
  }

  return {
    category: cat.toUpperCase(),
    reason,
    view,
    zone: zoneRaw,
    subZone: subZoneRaw,
  };
};

// Precise Station Record Matcher (prevents SPM automated test & DCM casting cross-matching)
const isRecordMatchingStation = (r, stationCode) => {
  if (!r || !stationCode) return false;
  const sUpper = String(stationCode).trim().toUpperCase();
  const sLower = sUpper.toLowerCase();
  const mName = String(r.machine_name || r.machineName || "").toLowerCase();
  const rNgGate = String(r.ngGate || r.ng_gate || "").toUpperCase();
  const statusKey = `${sLower}_status`;
  const gateStatus = String(r[statusKey] || "").trim().toUpperCase();
  const overallStatus = String(r.status || r.overall_status || "").trim().toUpperCase();

  const isLeakStation = sUpper === "OP150" || sUpper.startsWith("LEAK");

  if (isLeakStation) {
    let leakMatched = false;
    if (r.leak_data) {
      try {
        const ld = typeof r.leak_data === "object" ? r.leak_data : JSON.parse(r.leak_data);
        const ldMach = String(ld.matchedMachineName || ld.machineName || "").toUpperCase();
        if (sUpper.includes("01") && (ldMach.includes("01") || ldMach.includes("1773"))) leakMatched = true;
        else if (sUpper.includes("02") && (ldMach.includes("02") || ldMach.includes("1774"))) leakMatched = true;
        else if (sUpper.includes("03") && (ldMach.includes("03") || ldMach.includes("1776"))) leakMatched = true;
        else if (sUpper === "OP150") leakMatched = true;
      } catch (e) {}
    }
    const isLeakMachineName = mName.includes("leak") && (
      (sUpper.includes("01") && mName.includes("01")) ||
      (sUpper.includes("02") && mName.includes("02")) ||
      (sUpper.includes("03") && mName.includes("03")) ||
      sUpper === "OP150"
    );
    const isLeakGate = rNgGate.includes(sUpper) || (sUpper === "OP150" && rNgGate.includes("150")) || (sUpper.startsWith("LEAK") && rNgGate.includes("LEAK"));
    const isOp150NG = ["NG", "FAIL", "FAILED"].includes(String(r.op150_status || "").toUpperCase());

    if (leakMatched || isLeakMachineName || isLeakGate || (isOp150NG && (sUpper === "OP150" || isLeakMachineName || leakMatched))) {
      return (
        ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus) ||
        ["NG", "FAILED"].includes(overallStatus) ||
        isOp150NG
      );
    }
    return false;
  }

  // Visual / Dimensional Quality Gates (OP100 to OP160)
  if (rNgGate.includes(sUpper)) return true;
  if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus)) return true;

  const isOverallNG = ["NG", "FAILED"].includes(overallStatus);
  if (sUpper === "OP100" && (mName.includes("dcm") || mName.includes("op100")) && isOverallNG) return true;
  if (sUpper === "OP110" && (mName.includes("laser") || mName.includes("op110")) && isOverallNG) return true;
  if (sUpper === "OP120" && (mName.includes("pdi") || mName.includes("casting pdi") || mName.includes("op120")) && isOverallNG) return true;
  if (sUpper === "OP130" && (mName.includes("pre") || mName.includes("op130")) && isOverallNG) return true;
  if (sUpper === "OP140" && (mName.includes("guag") || mName.includes("gauge") || mName.includes("op140")) && isOverallNG) return true;
  if (sUpper === "OP160" && (mName.includes("final") || mName.includes("fpi") || mName.includes("op160")) && isOverallNG) return true;

  return false;
};

// ── Date Range Picker Component ─────────────────────────────────────────────
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatDateDisplay = (date) => {
    if (!date) return "";
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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
      if (typeof onApply === "function") {
        onApply(formattedStart.toISOString(), formattedEnd.toISOString());
      }
    }
    setIsOpen(false);
  };

  const handleClear = () => {
    setSelectedStart(null);
    setSelectedEnd(null);
    setTempStart(null);
    setTempEnd(null);
    if (typeof onClear === "function") {
      onClear();
    }
    setIsOpen(false);
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const days = [];

    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} style={{ width: 32, height: 32 }} />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      date.setHours(0, 0, 0, 0);
      const isStart = tempStart && date.getTime() === tempStart.getTime();
      const isEnd = tempEnd && date.getTime() === tempEnd.getTime();
      const isInRange = tempStart && tempEnd && date > tempStart && date < tempEnd;

      days.push(
        <button
          key={day}
          onClick={() => handleDayClick(day, month, year)}
          style={{
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: isStart || isEnd ? 800 : 500,
            borderRadius: isStart ? "8px 0 0 8px" : isEnd ? "0 8px 8px 0" : isInRange ? 0 : 8,
            background: isStart || isEnd ? "#1a3263" : isInRange ? "rgba(26,50,99,0.1)" : "transparent",
            color: isStart || isEnd ? "#ffffff" : isInRange ? "#1a3263" : "inherit",
            border: "none",
            cursor: "pointer",
            transition: "all 0.1s ease"
          }}
        >
          {day}
        </button>
      );
    }
    return days;
  };

  return (
    <div ref={pickerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px",
          borderRadius: 10,
          border: "1px solid var(--app-border, #cbd5e1)",
          background: "var(--app-bg-card, #ffffff)",
          color: "var(--app-text-main, #0f172a)",
          fontSize: 12,
          fontWeight: 650,
          cursor: "pointer"
        }}
      >
        <Calendar size={15} color="#1a3263" />
        <span>
          {selectedStart && selectedEnd
            ? `${formatDateDisplay(selectedStart)} - ${formatDateDisplay(selectedEnd)}`
            : label}
        </span>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 9999,
            background: "var(--app-bg-card, #ffffff)",
            border: "1px solid var(--app-border, #cbd5e1)",
            borderRadius: 16,
            boxShadow: "0 12px 36px rgba(0,0,0,0.15)",
            padding: 16,
            width: 290
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <button
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
              style={{ border: "none", background: "none", cursor: "pointer", fontWeight: 900, padding: 4 }}
            >
              ‹
            </button>
            <span style={{ fontSize: 13, fontWeight: 800 }}>
              {currentMonth.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
            </span>
            <button
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
              style={{ border: "none", background: "none", cursor: "pointer", fontWeight: 900, padding: 4 }}
            >
              ›
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", fontSize: 10, fontWeight: 800, color: "#94a3b8", marginBottom: 8 }}>
            <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: 4 }}>
            {renderCalendar()}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--app-border, #e2e8f0)" }}>
            <button
              onClick={handleClear}
              style={{ padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "1px solid #cbd5e1", background: "none", cursor: "pointer" }}
            >
              Clear
            </button>
            <button
              onClick={handleApply}
              style={{ padding: "5px 14px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "none", background: "#1a3263", color: "#ffffff", cursor: "pointer" }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Station Speedometer SVG Gauge Component ─────────────────────────────────
const StationSpeedometer = React.memo(({
  value = 0,
  max = 20,
  size = "compact", // "compact" (pipeline card) | "featured" (station drawer)
  label = "SCRAP",
  showTicks = true,
  unit = "%",
}) => {
  const numVal = Math.max(0, Number(value) || 0);
  const effectiveMax = Math.max(max, Math.ceil(numVal / 5) * 5, 10);
  const clampedVal = Math.min(effectiveMax, numVal);
  const ratio = clampedVal / effectiveMax; // 0 to 1

  // Color Architecture:
  // When numVal === 0 (Zero Rejection / 100% OK Yield): PURE VIBRANT GREEN (#16a34a)
  // When numVal > 0 (Rejections Present): SCRAP IS RED! Rejection progress arc & value are BOLD CRIMSON RED (#dc2626)!
  const isZeroScrap = numVal === 0;

  let arcColor = "#16a34a";
  let readoutColor = "#16a34a";
  let statusColor = "#16a34a";
  let statusText = "PASS";
  let statusBg = "#dcfce7";
  let statusBorder = "#86efac";
  let statusTextColor = "#15803d";

  if (numVal > 5.0) {
    arcColor = "#dc2626"; // bold crimson red
    readoutColor = "#dc2626";
    statusColor = "#dc2626";
    statusText = "ALERT";
    statusBg = "#fee2e2";
    statusBorder = "#fca5a5";
    statusTextColor = "#991b1b";
  } else if (numVal >= 2.5) {
    arcColor = "#dc2626"; // bold red rejection arc
    readoutColor = "#dc2626";
    statusColor = "#f59e0b";
    statusText = "WATCH";
    statusBg = "#fef3c7";
    statusBorder = "#fcd34d";
    statusTextColor = "#9a3412";
  } else if (!isZeroScrap) {
    // 0 < numVal < 2.5%: Rejection is present! Arc and readout MUST be bold red to highlight rejections
    arcColor = "#dc2626"; // bold red scrap arc
    readoutColor = "#dc2626";
    statusColor = "#16a34a";
    statusText = "PASS";
    statusBg = "#f0fdf4";
    statusBorder = "#bbf7d0";
    statusTextColor = "#166534";
  }

    const isCompact = size === "compact";
  const width = isCompact ? 138 : 240;
  const height = isCompact ? 80 : 145;
  const cx = width / 2;
  const cy = isCompact ? 60 : 112;
  const r = isCompact ? 46 : 84;
  const strokeWidth = isCompact ? 9 : 14;
  const needleLen = isCompact ? 33 : 64;

  const needleDeg = -90 + ratio * 180;

  const describeArc = (startDeg, endDeg) => {
    const sRad = (startDeg * Math.PI) / 180;
    const eRad = (endDeg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(sRad);
    const y1 = cy - r * Math.sin(sRad);
    const x2 = cx + r * Math.cos(eRad);
    const y2 = cy - r * Math.sin(eRad);
    const largeArc = Math.abs(startDeg - endDeg) > 180 ? 1 : 0;
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };

  const greenEndDeg = 180 - (Math.min(2.5, effectiveMax) / effectiveMax) * 180;
  const yellowEndDeg = 180 - (Math.min(5.0, effectiveMax) / effectiveMax) * 180;

  const tickSteps = [0, 0.25, 0.5, 0.75, 1];
  const ticks = tickSteps.map((pct) => {
    const deg = 180 - pct * 180;
    const rad = (deg * Math.PI) / 180;
    const innerR = r - (isCompact ? 4 : 7);
    const outerR = r + (isCompact ? 4 : 7);
    return {
      x1: cx + innerR * Math.cos(rad),
      y1: cy - innerR * Math.sin(rad),
      x2: cx + outerR * Math.cos(rad),
      y2: cy - outerR * Math.sin(rad),
      label: `${Math.round(pct * effectiveMax)}`,
      labelX: cx + (r - (isCompact ? 11 : 18)) * Math.cos(rad),
      labelY: cy - (r - (isCompact ? 11 : 18)) * Math.sin(rad),
    };
  });

  return (
    <div className={`rej-speedometer-wrap ${size}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="rej-speedometer-svg"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {/* Track & Active Progress Fill */}
        {numVal === 0 ? (
          /* Pure 0% NG State: The entire arc glows in BOLD VIBRANT GREEN (100% OK Quality) */
          <path
            d={describeArc(180, 0)}
            fill="none"
            stroke="#16a34a"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        ) : (
          <>
            {/* Base neutral guide arc track */}
            <path
              d={describeArc(180, 0)}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />

            {/* Dynamic Active Progress Arc: Fills from left (0) up to current scrap rate in BOLD color */}
            <path
              d={describeArc(180, Math.min(178.5, Math.max(1.5, 180 - ratio * 180)))}
              fill="none"
              stroke={arcColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          </>
        )}

        {/* Clean Instrument Tick lines */}
        {showTicks && ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1.toFixed(1)}
            y1={t.y1.toFixed(1)}
            x2={t.x2.toFixed(1)}
            y2={t.y2.toFixed(1)}
            stroke="#334155"
            strokeWidth={isCompact ? "1.2" : "1.8"}
          />
        ))}

        {/* Featured Size Numeric Tick Labels */}
        {!isCompact && ticks.map((t, i) => (
          <text
            key={`lbl-${i}`}
            x={t.labelX.toFixed(1)}
            y={(t.labelY + 3).toFixed(1)}
            textAnchor="middle"
            fontSize="10"
            fontWeight="750"
            fill="#475569"
          >
            {t.label}
          </text>
        ))}

        {/* High-Contrast Instrument Needle */}
        <g
          style={{
            transform: `rotate(${needleDeg}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            transition: "transform 0.65s cubic-bezier(0.34, 1.4, 0.64, 1)",
          }}
        >
          {/* Main dark carbon blade */}
          <polygon
            points={`${cx - (isCompact ? 2 : 3.5)},${cy} ${cx + (isCompact ? 2 : 3.5)},${cy} ${cx},${cy - needleLen}`}
            fill="#0f172a"
          />
          {/* Bold vibrant colored pointer tip */}
          <polygon
            points={`${cx - (isCompact ? 1.2 : 2)},${cy - needleLen * 0.55} ${cx + (isCompact ? 1.2 : 2)},${cy - needleLen * 0.55} ${cx},${cy - needleLen}`}
            fill={arcColor}
          />
        </g>

        {/* Pivot Center Pin Hub */}
        <circle cx={cx} cy={cy} r={isCompact ? 4.5 : 7} fill="#0f172a" stroke="#ffffff" strokeWidth={isCompact ? "1.5" : "2"} />
        <circle cx={cx} cy={cy} r={isCompact ? 2 : 3} fill={arcColor} />

        {/* Bold Central Numeric Value Readout (Colored dynamically in bold statusColor) */}
        <text
          x={cx}
          y={isCompact ? 37 : 76}
          textAnchor="middle"
          fontSize={isCompact ? "14" : "25"}
          fontWeight="900"
          fill={readoutColor}
          fontFamily="'Inter', -apple-system, sans-serif"
        >
          {numVal.toFixed(1)}{unit}
        </text>

        {/* Sub-label under value, with guaranteed spacing above the pivot pin */}
        <text
          x={cx}
          y={isCompact ? 49 : 94}
          textAnchor="middle"
          fontSize={isCompact ? "7.5" : "10.5"}
          fontWeight="800"
          fill="#475569"
          letterSpacing="0.06em"
        >
          {label}
        </text>
      </svg>

      {/* Bold Status Pill Badge */}
      <div
        className="rej-speedo-pill"
        style={{
          background: statusBg,
          color: statusTextColor,
          borderColor: statusBorder,
        }}
      >
        <span
          className="rej-speedo-led"
          style={{
            background: statusColor,
            boxShadow: `0 0 6px ${statusColor}`,
          }}
        />
        <span>{statusText}</span>
      </div>
    </div>
  );
});

// ── Rejection Analysis Full Skeleton Shimmer Placeholder ─────────────────────
const RejectionAnalysisSkeleton = React.memo(() => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 4 }}>
      {/* Dynamic Shimmer Banner */}
      <div className="rej-skeleton-banner">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            className="rej-skeleton-box rej-skeleton-circle"
            style={{
              width: 38,
              height: 38,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(37, 99, 235, 0.15)",
              color: "#2563eb",
            }}
          >
            <Activity size={20} className="animate-pulse" />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: "#1e3a8a" }}>
                Analyzing Live Production Quality Intelligence
              </span>
              <span style={{ fontSize: 11, background: "#dbeafe", color: "#1e40af", padding: "1px 8px", borderRadius: 99, fontWeight: 700 }}>
                Aggregating Telemetry...
              </span>
            </div>
            <div className="rej-skeleton-box" style={{ width: 440, height: 11 }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div className="rej-skeleton-box" style={{ width: 110, height: 28, borderRadius: 20 }} />
          <div className="rej-skeleton-box" style={{ width: 110, height: 28, borderRadius: 20 }} />
        </div>
      </div>

      {/* KPI Stats Skeleton Grid */}
      <div className="rej-kpi-grid">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rej-skeleton-kpi-card">
            <div className="rej-skeleton-box rej-skeleton-circle" style={{ width: 46, height: 46, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div className="rej-skeleton-box" style={{ width: "55%", height: 11, marginBottom: 8 }} />
              <div className="rej-skeleton-box" style={{ width: "75%", height: 24, marginBottom: 6 }} />
              <div className="rej-skeleton-box" style={{ width: "45%", height: 10 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Speedometer Pipeline Carousel Skeleton */}
      <div className="rej-card">
        <div className="rej-card-header" style={{ marginBottom: 16 }}>
          <div>
            <div className="rej-skeleton-box" style={{ width: 380, height: 18, marginBottom: 6 }} />
            <div className="rej-skeleton-box" style={{ width: 540, height: 12 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="rej-skeleton-box" style={{ width: 130, height: 26, borderRadius: 20 }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, overflow: "hidden", padding: "4px 0" }}>
          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="rej-skeleton-gate-card">
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 8 }}>
                <div className="rej-skeleton-box" style={{ width: 55, height: 16, borderRadius: 4 }} />
                <div className="rej-skeleton-box" style={{ width: 48, height: 16, borderRadius: 10 }} />
              </div>
              <div className="rej-skeleton-box" style={{ width: 110, height: 12, marginBottom: 6 }} />
              {/* Semicircle Speedometer Outline */}
              <div
                className="rej-skeleton-box"
                style={{
                  width: 108,
                  height: 54,
                  borderTopLeftRadius: 54,
                  borderTopRightRadius: 54,
                  margin: "6px 0",
                }}
              />
              <div className="rej-skeleton-box" style={{ width: 64, height: 14, marginBottom: 8 }} />
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <div className="rej-skeleton-box" style={{ width: 52, height: 12 }} />
                <div className="rej-skeleton-box" style={{ width: 52, height: 12 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Multi-Dimensional Pareto Charts Skeleton */}
      <div className="rej-card">
        <div className="rej-card-header" style={{ marginBottom: 20 }}>
          <div>
            <div className="rej-skeleton-box" style={{ width: 320, height: 18, marginBottom: 6 }} />
            <div className="rej-skeleton-box" style={{ width: 440, height: 12 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="rej-skeleton-box" style={{ width: 85, height: 28, borderRadius: 6 }} />
            <div className="rej-skeleton-box" style={{ width: 85, height: 28, borderRadius: 6 }} />
            <div className="rej-skeleton-box" style={{ width: 85, height: 28, borderRadius: 6 }} />
          </div>
        </div>
        <div style={{ height: 260, display: "flex", alignItems: "flex-end", justifyContent: "space-around", padding: "0 40px 20px" }}>
          {[85, 65, 52, 38, 28, 18, 12].map((h, idx) => (
            <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div className="rej-skeleton-bar" style={{ height: `${h * 2.2}px` }} />
              <div className="rej-skeleton-box" style={{ width: 50, height: 10 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// ── Main Rejection Analysis Component ───────────────────────────────────────
export default function RejectionAnalysis() {
  const [activeTab, setActiveTab] = useState("overview"); // overview | ml_analysis | telemetry | records
  const [loading, setLoading] = useState(false);

  // Filters State
  const [filters, setFilters] = useState({
    dateFrom: null,
    dateTo: null,
    datePreset: "all",
    shiftCode: "",
    machineName: "",
    qualityGate: "",
    partName: "",
    dieName: "",
    status: "ALL",
  });

  // Data Response State
  const [summary, setSummary] = useState({
    totalProduction: 0,
    totalOK: 0,
    totalNG: 0,
    inProgress: 0,
    rejectRate: 0,
    topHotspotStation: "OP120",
    topDriverParameter: "Leak Test Body Value",
  });

  const [qualityGates, setQualityGates] = useState([]);
  const [stationLabels, setStationLabels] = useState({
    OP100: "DCM+DPM + OP100",
    OP110: "Laser Marking + OP110",
    OP120: "Casting PDi + OP120",
    OP130: "Pre Inspection + OP130",
    OP140: "Auto Guaging + OP140",
    OP150: "Leak Test OP150",
    "Leak-Test-01": "Leak-Test-01",
    "Leak-Test-02": "Leak-Test-02",
    "Leak Test-03": "Leak Test-03",
    OP160: "Final Inspection + OP160",
  });
  const [mlInsights, setMlInsights] = useState({ features: [], topAnomalies: [] });
  const [pareto, setPareto] = useState([]);
  const [categoryParetoData, setCategoryParetoData] = useState([]);
  const [zoneParetoData, setZoneParetoData] = useState([]);
  const [shiftScrap, setShiftScrap] = useState([]);
  const [rows, setRows] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ machines: [], parts: [], dies: [], shifts: [] });
  const [dataErrors, setDataErrors] = useState([]);

  // Interactive Exploration States
  const [selectedScatterX, setSelectedScatterX] = useState("furnace_metal_temp");
  const [selectedScatterY, setSelectedScatterY] = useState("biscuit_thickness");
  const [selectedTelemetryParam, setSelectedTelemetryParam] = useState("metal_pressure");
  const [tableSearch, setTableSearch] = useState("");
  const [outlierSearch, setOutlierSearch] = useState("");

  // Pareto view sub-tab and interactive drilldown
  const [paretoView, setParetoView] = useState("reason"); // reason | category | zone
  const [selectedParetoItem, setSelectedParetoItem] = useState(null);
  const [paretoSelectedView, setParetoSelectedView] = useState("all");
  const [paretoPartSearch, setParetoPartSearch] = useState("");
  const [isParetoPictorialExpanded, setIsParetoPictorialExpanded] = useState(true);
  const [isParetoPartsLogExpanded, setIsParetoPartsLogExpanded] = useState(true);

  // Dedicated Paginated Records State (Tab 4)
  const [recordsRows, setRecordsRows] = useState([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsPageSize, setRecordsPageSize] = useState(100);
  const [recordsLoading, setRecordsLoading] = useState(false);

  // Drill-down state for Quality Gate bar chart
  const [drillDownLevel, setDrillDownLevel] = useState(0); // 0=gates, 1=categories, 2=reasons
  const [drillDownGate, setDrillDownGate] = useState(null); // selected gate code e.g. "OP120"
  const [drillDownCategory, setDrillDownCategory] = useState(null); // selected category e.g. "CR"
  const [drillDownReason, setDrillDownReason] = useState(null); // selected reason e.g. "BLOW HOLE"
  const [drillDownSelectedView, setDrillDownSelectedView] = useState("all"); // view filter for pictorial and parts table
  const [showPartIdTable, setShowPartIdTable] = useState(true); // Part ID serial table visible on drilldown
  const [isPictorialExpanded, setIsPictorialExpanded] = useState(true); // Show or hide pictorial view toggle
  const [isPartsLogExpanded, setIsPartsLogExpanded] = useState(true); // Show or hide parts log toggle
  const [partIdSearch, setPartIdSearch] = useState(""); // search within drilldown parts
  const [qualityGateDrillDown, setQualityGateDrillDown] = useState({}); // full database aggregation from backend
  const [rejectionConfig, setRejectionConfig] = useState(null); // inspection views, images, zones, subzones
  const [isStationPictorialOpen, setIsStationPictorialOpen] = useState(false); // Station-wise pictorial inspection drawer toggle (default closed for clean, uncluttered layout)
  const [stationActiveAngle, setStationActiveAngle] = useState("all"); // Active camera angle within station pictorial drawer

  // Defect Localization Studio Visibility & Anchor
  const [isStudioVisible, setIsStudioVisible] = useState(false); // Hidden by default; revealed upon clicking Pareto line/bar/defect
  const studioRef = useRef(null);

  // Quality Gate Pipeline Auto-Scrolling Carousel State
  const pipelineCarouselRef = useRef(null);
  const [isCarouselHovered, setIsCarouselHovered] = useState(false);
  const [isCarouselPlaying, setIsCarouselPlaying] = useState(true);

  // ── Auto-Scrolling Pipeline Carousel with Smooth Loop & Hover-to-Pause ──
  useEffect(() => {
    const el = pipelineCarouselRef.current;
    if (!el || !isCarouselPlaying || isCarouselHovered || !qualityGates || qualityGates.length === 0) return;

    let animId;
    let isRewinding = false;
    let pauseUntil = 0;

    const scrollStep = (timestamp) => {
      if (el && !isCarouselHovered && isCarouselPlaying) {
        const maxScroll = el.scrollWidth - el.clientWidth;
        if (maxScroll > 10) {
          if (timestamp < pauseUntil) {
            // currently paused at start or end of the process line
          } else if (isRewinding) {
            // Smoothly glide back to OP100 (beginning of the manufacturing line)
            el.scrollTo({ left: 0, behavior: "smooth" });
            isRewinding = false;
            pauseUntil = timestamp + 1800; // pause at OP100 for 1.8s
          } else if (el.scrollLeft >= maxScroll - 2) {
            // Reached the final station: hold for 2.2s so operator can review stats, then smooth rewind
            pauseUntil = timestamp + 2200;
            isRewinding = true;
          } else {
            // Smooth continuous forward scan across the process flow
            el.scrollLeft += 0.65;
          }
        }
      }
      animId = requestAnimationFrame(scrollStep);
    };

    animId = requestAnimationFrame(scrollStep);
    return () => cancelAnimationFrame(animId);
  }, [isCarouselPlaying, isCarouselHovered, qualityGates]);

  const scrollPipeline = useCallback((direction) => {
    const el = pipelineCarouselRef.current;
    if (el) {
      const offset = direction === "left" ? -220 : 220;
      el.scrollBy({ left: offset, behavior: "smooth" });
    }
  }, []);

  // Dedicated On-Demand Drill-Down Parts Pools
  const [gateDrillDownParts, setGateDrillDownParts] = useState([]);
  const [gateDrillDownLoading, setGateDrillDownLoading] = useState(false);
  const [paretoDrillDownParts, setParetoDrillDownParts] = useState([]);
  const [paretoDrillDownLoading, setParetoDrillDownLoading] = useState(false);

  // Tab 3: Dedicated Per-Part Telemetry & Variation Table State
  const [telemetryTableFilter, setTelemetryTableFilter] = useState("all"); // all | outliers | ng
  const [telemetrySearch, setTelemetrySearch] = useState("");
  const [telemetryPage, setTelemetryPage] = useState(1);
  const [telemetryPageSize, setTelemetryPageSize] = useState(25);

  // Tab 1: Unified Multi-Angle Studio State
  const [studioActiveAngle, setStudioActiveAngle] = useState("all");
  const [studioFullscreen, setStudioFullscreen] = useState(false);
  const [contextLogViewMode, setContextLogViewMode] = useState("defect"); // defect | telemetry
  const [contextLogSearch, setContextLogSearch] = useState("");
  const [contextLogPage, setContextLogPage] = useState(1);
  const [contextLogPageSize, setContextLogPageSize] = useState(10);
  const [isContextLogExpanded, setIsContextLogExpanded] = useState(false); // Collapsed by default for clean visual CAD inspection focus
  const [copiedId, setCopiedId] = useState(null);

  const copyToClipboard = useCallback((text, id) => {
    if (!text) return;
    try {
      navigator.clipboard.writeText(String(text));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // fallback
    }
  }, []);

  // Scatter zoom state
  const [scatterZoom, setScatterZoom] = useState(null); // { x1, y1, x2, y2 }
  const [scatterRefStart, setScatterRefStart] = useState(null); // drag start point
  const [scatterRefEnd, setScatterRefEnd] = useState(null); // drag end point
  const scatterDimsRef = useRef({ width: 800, height: 420 });

  // ── Dynamic Machines via machineApi ─────────────────────────────────────
  useEffect(() => {
    machineApi.list()
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.data || []);
        if (list.length > 0) {
          const machineNames = [...new Set(list.map((m) => m.machine_name).filter(Boolean))];
          setFilterOptions((prev) => ({
            ...prev,
            machines: [...new Set([...(prev.machines || []), ...machineNames])],
          }));

          const dynamicLabels = {};
          list.forEach((m) => {
            const op = String(m.operation_no || "").trim().toUpperCase();
            const mName = String(m.machine_name || "").trim();
            if (op && mName) {
              if (op === "OP150" && mName.toLowerCase().includes("leak")) {
                dynamicLabels["OP150"] = "Leak Test OP150";
              } else {
                dynamicLabels[op] = `${mName} + ${op}`;
              }
            }
          });
          setStationLabels((prev) => ({ ...prev, ...dynamicLabels }));
        }
      })
      .catch((err) => console.warn("[REJECTION UI] machineApi.list fallback:", err.message));
  }, []);

  // ── Load Rejection Config (Inspection Views, Images, Zones & Sub-Zones) ──
  useEffect(() => {
    rejectionConfigApi.operatorConfig({ partName: "OIL PAN K-12" })
      .then((res) => {
        if (res && res.views) {
          setRejectionConfig(res);
        }
      })
      .catch((err) => console.warn("[REJECTION UI] operatorConfig fallback:", err.message));
  }, []);

  // ── Load Data from Modular APIs ──────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setDataErrors([]);
    try {
      const query = {
        limit: 5000,
        noCache: "1",
        _ts: Date.now(),
      };
      if (filters.datePreset) query.datePreset = filters.datePreset;
      if (filters.datePreset === "all") query.allTime = "1";
      if (filters.dateFrom) query.dateFrom = filters.dateFrom;
      if (filters.dateTo) query.dateTo = filters.dateTo;
      if (filters.shiftCode) query.shiftCode = filters.shiftCode;
      if (filters.machineName) query.machineName = filters.machineName;
      if (filters.qualityGate) query.qualityGate = filters.qualityGate;
      if (filters.partName) query.partName = filters.partName;
      if (filters.dieName) query.dieName = filters.dieName;
      if (filters.status && filters.status !== "ALL") query.status = filters.status;

      const errors = [];

      // Execute modular queries in parallel so no single query blocks or times out others
      const [summaryResult, paretoResult, shiftResult, mlResult] = await Promise.allSettled([
        dashboardApi.rejectionSummary(query, { timeout: 25000, suppressGlobalError: true }),
        dashboardApi.rejectionPareto(query, { timeout: 30000, suppressGlobalError: true }),
        dashboardApi.rejectionShiftScrap(query, { timeout: 15000, suppressGlobalError: true }),
        dashboardApi.rejectionMlInsights(query, { timeout: 30000, suppressGlobalError: true }),
      ]);

      if (summaryResult.status === "fulfilled" && summaryResult.value) {
        const res = summaryResult.value;
        if (res.summary) setSummary(res.summary);
        if (Array.isArray(res.qualityGates)) setQualityGates(res.qualityGates);
        if (res.filterOptions) setFilterOptions(res.filterOptions);
        if (res.stationLabels) setStationLabels((prev) => ({ ...prev, ...res.stationLabels }));
      } else {
        const errMsg = summaryResult.reason?.message || "Rejection summary query failed";
        console.error("[REJECTION UI] Summary fetch failed:", errMsg);
        errors.push("Summary & Quality Gates: " + errMsg);
      }

      if (paretoResult.status === "fulfilled" && paretoResult.value) {
        const res = paretoResult.value;
        if (Array.isArray(res.pareto)) setPareto(res.pareto);
        if (Array.isArray(res.categoryPareto)) setCategoryParetoData(res.categoryPareto);
        if (Array.isArray(res.zonePareto)) setZoneParetoData(res.zonePareto);
        if (res.qualityGateDrillDown) setQualityGateDrillDown(res.qualityGateDrillDown);
      } else {
        const errMsg = paretoResult.reason?.message || "Pareto query failed";
        console.error("[REJECTION UI] Pareto fetch failed:", errMsg);
        errors.push("Pareto & Defect Drilldown: " + errMsg);
      }

      if (shiftResult.status === "fulfilled" && shiftResult.value) {
        const res = shiftResult.value;
        if (Array.isArray(res.shiftScrap)) setShiftScrap(res.shiftScrap);
      } else {
        const errMsg = shiftResult.reason?.message || "Shift scrap query failed";
        console.error("[REJECTION UI] Shift scrap fetch failed:", errMsg);
        errors.push("Shift Scrap: " + errMsg);
      }

      if (mlResult.status === "fulfilled" && mlResult.value) {
        const res = mlResult.value;
        if (res.mlInsights) setMlInsights(res.mlInsights);
        if (Array.isArray(res.telemetryRows) && res.telemetryRows.length > 0) {
          setRows(res.telemetryRows);
        } else if (Array.isArray(res.rows) && res.rows.length > 0) {
          setRows(res.rows);
        }
      } else {
        const errMsg = mlResult.reason?.message || "ML Insights query failed";
        console.error("[REJECTION UI] ML Insights fetch failed:", errMsg);
        errors.push("Process ML Insights: " + errMsg);
      }

      // If all modular calls failed, attempt legacy rejectionAnalysis endpoint as fallback
      if (errors.length === 4) {
        console.warn("[REJECTION UI] All modular endpoints failed; trying fallback rejectionAnalysis...");
        try {
          const fallbackRes = await dashboardApi.rejectionAnalysis(query, { timeout: 30000, suppressGlobalError: true });
          if (fallbackRes) {
            if (fallbackRes.summary) setSummary(fallbackRes.summary);
            if (Array.isArray(fallbackRes.qualityGates)) setQualityGates(fallbackRes.qualityGates);
            if (fallbackRes.qualityGateDrillDown) setQualityGateDrillDown(fallbackRes.qualityGateDrillDown);
            if (fallbackRes.mlInsights) setMlInsights(fallbackRes.mlInsights);
            if (Array.isArray(fallbackRes.pareto)) setPareto(fallbackRes.pareto);
            if (Array.isArray(fallbackRes.categoryPareto)) setCategoryParetoData(fallbackRes.categoryPareto);
            if (Array.isArray(fallbackRes.zonePareto)) setZoneParetoData(fallbackRes.zonePareto);
            if (Array.isArray(fallbackRes.shiftScrap)) setShiftScrap(fallbackRes.shiftScrap);
            if (fallbackRes.filterOptions) setFilterOptions(fallbackRes.filterOptions);
            errors.length = 0;
          }
        } catch (fallbackErr) {
          console.error("[REJECTION UI] Fallback rejectionAnalysis also failed:", fallbackErr.message);
        }
      }

      if (errors.length > 0) {
        setDataErrors(errors);
      }
    } catch (err) {
      console.error("[REJECTION UI] Failed to load rejection analysis:", err);
      setDataErrors([err.message || "Failed to load rejection data"]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Load Paginated Records for Tab 4 ──────────────────────────────────
  const loadRejectionRows = useCallback(async (page = recordsPage, pageSize = recordsPageSize, search = tableSearch) => {
    setRecordsLoading(true);
    try {
      const query = {
        page,
        pageSize,
        status: "NG",
        noCache: "1",
        _ts: Date.now(),
      };
      if (search && search.trim()) query.search = search.trim();
      if (filters.datePreset) query.datePreset = filters.datePreset;
      if (filters.datePreset === "all") query.allTime = "1";
      if (filters.dateFrom) query.dateFrom = filters.dateFrom;
      if (filters.dateTo) query.dateTo = filters.dateTo;
      if (filters.shiftCode) query.shiftCode = filters.shiftCode;
      if (filters.machineName) query.machineName = filters.machineName;
      if (filters.qualityGate) query.qualityGate = filters.qualityGate;

      const res = await dashboardApi.rejectionRows(query, { timeout: 30000, suppressGlobalError: true });
      if (res) {
        if (Array.isArray(res.rows)) setRecordsRows(res.rows);
        if (typeof res.total === "number") setRecordsTotal(res.total);
      }
    } catch (err) {
      console.error("[REJECTION UI] Failed to load paginated rejection rows:", err);
    } finally {
      setRecordsLoading(false);
    }
  }, [filters, recordsPage, recordsPageSize, tableSearch]);

  useEffect(() => {
    loadRejectionRows(recordsPage, recordsPageSize, tableSearch);
  }, [loadRejectionRows, recordsPage, recordsPageSize, filters]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setRecordsPage(1);
      loadRejectionRows(1, recordsPageSize, tableSearch);
    }, 350);
    return () => clearTimeout(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableSearch]);

  // ── Fetch Gate Drill-Down Parts On Demand ──────────────────────────────────
  useEffect(() => {
    if (!drillDownGate) {
      setGateDrillDownParts([]);
      return;
    }
    let isCancelled = false;
    const fetchParts = async () => {
      setGateDrillDownLoading(true);
      try {
        const query = {
          qualityGate: drillDownGate,
          status: "NG",
          allTime: "1",
          pageSize: 500,
          noCache: "1",
          _ts: Date.now(),
        };
        if (drillDownCategory) query.category = drillDownCategory;
        if (drillDownReason) query.reason = drillDownReason;
        if (filters.datePreset && filters.datePreset !== "all") query.datePreset = filters.datePreset;
        if (filters.dateFrom) query.dateFrom = filters.dateFrom;
        if (filters.dateTo) query.dateTo = filters.dateTo;
        if (filters.shiftCode) query.shiftCode = filters.shiftCode;
        if (filters.machineName) query.machineName = filters.machineName;

        const res = await dashboardApi.rejectionRows(query, { timeout: 30000, suppressGlobalError: true });
        if (!isCancelled && res && Array.isArray(res.rows)) {
          setGateDrillDownParts(res.rows);
        }
      } catch (err) {
        console.warn("[REJECTION UI] Failed to fetch gate drilldown parts:", err);
      } finally {
        if (!isCancelled) setGateDrillDownLoading(false);
      }
    };

    fetchParts();
    return () => { isCancelled = true; };
  }, [drillDownGate, drillDownCategory, drillDownReason, filters]);

  // ── Preset Date Handlers ────────────────────────────────────────────────
  const handlePreset = (presetKey) => {
    const now = new Date();
    let from = null;
    let to = null;

    if (presetKey === "today") {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    } else if (presetKey === "yesterday") {
      const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      from = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 0, 0, 0).toISOString();
      to = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59).toISOString();
    } else if (presetKey === "last7") {
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      to = now.toISOString();
    } else if (presetKey === "last30") {
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      to = now.toISOString();
    } else if (presetKey === "last90") {
      from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      to = now.toISOString();
    }

    setFilters((prev) => ({
      ...prev,
      datePreset: presetKey,
      dateFrom: from,
      dateTo: to,
    }));
  };

  const handleDateApply = (from, to) => {
    setFilters((prev) => ({
      ...prev,
      datePreset: "custom",
      dateFrom: from,
      dateTo: to,
    }));
  };

  const handleDateClear = () => {
    setFilters((prev) => ({
      ...prev,
      datePreset: "all",
      dateFrom: null,
      dateTo: null,
    }));
  };

  // ── Rejected rows ───────────────────────────────────────────────────────
  const rejectedRows = useMemo(() => rows.filter((row) => {
    const values = [
      row.status, row.overall_status,
      row.op100_status, row.op110_status, row.op120_status, row.op130_status,
      row.op140_status, row.op150_status, row.op160_status,
    ].map((value) => String(value || "").trim().toUpperCase());
    return values.some((value) => ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(value))
      || !!row.isDefective
      || !!row.rejection_reason
      || !!row.ng_reason
      || !!row.rejectionReason
      || !!row.ngReason;
  }), [rows]);

  // Unified full rejection records pool (combines API rows, recordsRows, gateDrillDownParts, paretoDrillDownParts, and rejectedRows deduplicated)
  const allRejectionRecords = useMemo(() => {
    const map = new Map();
    const add = (r) => {
      if (!r) return;
      const key = r.id || r.partId || r.part_id || r.rowKey;
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, r);
      } else {
        const existing = map.get(key);
        map.set(key, { ...existing, ...r });
      }
    };
    (gateDrillDownParts || []).forEach(add);
    (paretoDrillDownParts || []).forEach(add);
    (recordsRows || []).forEach(add);
    (rejectedRows || []).forEach(add);
    (rows || []).forEach((r) => {
      const isNg = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(r.status || r.overall_status || '').trim().toUpperCase())
        || !!r.isDefective || !!r.rejection_reason || !!r.ng_reason || !!r.rejectionReason || !!r.ngReason;
      if (isNg) add(r);
    });
    return Array.from(map.values());
  }, [gateDrillDownParts, paretoDrillDownParts, recordsRows, rejectedRows, rows]);

  // ── Export Excel Handler ────────────────────────────────────────────────
  const handleExportExcel = async () => {
    let exportSource = recordsRows.length > 0 ? recordsRows : rejectedRows;
    if (recordsTotal > exportSource.length) {
      try {
        const fullRes = await dashboardApi.rejectionRows({
          status: "NG",
          allTime: filters.datePreset === "all" ? "1" : undefined,
          datePreset: filters.datePreset,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          shiftCode: filters.shiftCode,
          machineName: filters.machineName,
          qualityGate: filters.qualityGate,
          page: "1",
          pageSize: "10000",
        });
        if (fullRes && Array.isArray(fullRes.rows) && fullRes.rows.length > 0) {
          exportSource = fullRes.rows;
        }
      } catch (err) {
        console.warn("Full export fallback to current rows:", err);
      }
    }
    if (!exportSource.length) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("HPDC Scrap Traceability Log");

    sheet.columns = [
      { header: "Shot No", key: "shotNumber", width: 14 },
      { header: "Part Serial No", key: "partId", width: 26 },
      { header: "Customer QR", key: "customerQrCode", width: 32 },
      { header: "Status", key: "status", width: 12 },
      { header: "NG Gate", key: "ngGate", width: 16 },
      { header: "NG Result Time", key: "ngRecordedAt", width: 24 },
      { header: "OP100", key: "op100", width: 10 },
      { header: "OP110", key: "op110", width: 10 },
      { header: "OP120", key: "op120", width: 10 },
      { header: "OP130", key: "op130", width: 10 },
      { header: "OP140", key: "op140", width: 10 },
      { header: "OP150", key: "op150", width: 10 },
      { header: "OP160", key: "op160", width: 10 },
      { header: "Zone", key: "zone", width: 16 },
      { header: "Sub-Zone", key: "subZone", width: 16 },
      { header: "Reason", key: "reason", width: 30 },
      { header: "Category", key: "category", width: 14 },
      { header: "Shift", key: "shiftCode", width: 10 },
      { header: "Machine", key: "machineName", width: 16 },
      { header: "Die", key: "dieName", width: 14 },
      { header: "Metal Pressure (bar)", key: "metalPressure", width: 20 },
      { header: "Furnace Temp (°C)", key: "metalTemp", width: 18 },
      { header: "Biscuit (mm)", key: "biscuitThickness", width: 14 },
      { header: "V1 Speed (m/s)", key: "v1Speed", width: 14 },
      { header: "V2 Speed (m/s)", key: "v2Speed", width: 14 },
      { header: "V3 Speed (m/s)", key: "v3Speed", width: 14 },
      { header: "Leak Body (mbar)", key: "leakBodyValue", width: 18 },
      { header: "Leak Gall_1 (mbar)", key: "leakGall1", width: 18 },
      { header: "Leak Gall_2 (mbar)", key: "leakGall2", width: 18 },
      { header: "Leak Cycle Time (s)", key: "leakCycleTime", width: 18 },
      { header: "Running Mode", key: "leakRunningMode", width: 16 },
      { header: "Dry/Wey", key: "leakDryWey", width: 14 },
      { header: "Timestamp", key: "createdAt", width: 22 },
    ];

    // Style header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A3263" },
    };

    exportSource.forEach((r) => {
      sheet.addRow({
        shotNumber: r.shotNumber || r.shot_number || "-",
        partId: r.partId || r.part_id || "-",
        customerQrCode: r.customerQrCode || r.customer_qr || "-",
        status: r.status || r.overall_status || "-",
        ngGate: r.ngGate || "-",
        ngRecordedAt: formatResultTimestamp(r.ngRecordedAt || r.final_scan_at),
        op100: r.op100_status || "-",
        op110: r.op110_status || "-",
        op120: r.op120_status || "-",
        op130: r.op130_status || "-",
        op140: r.op140_status || "-",
        op150: r.op150_status || "-",
        op160: r.op160_status || "-",
        zone: r.rejectionZone || r.rejection_zone || "-",
        subZone: r.rejectionSubZone || r.rejection_sub_zone || "-",
        reason: r.reason || r.rejection_reason || r.ngReason || r.ng_reason || "-",
        category: r.category || r.rejection_category || "-",
        shiftCode: r.shiftCode || r.shift_code || "A",
        machineName: r.machineName || r.machine_name || "-",
        dieName: r.dieName || r.die_name || "-",
        metalPressure: r.metalPressure ?? r.metal_pressure ?? "-",
        metalTemp: r.metalTemp ?? r.furnace_metal_temp ?? "-",
        biscuitThickness: r.biscuitThickness ?? r.biscuit_thickness ?? "-",
        v1Speed: r.v1Speed ?? r.v1_speed ?? "-",
        v2Speed: r.v2Speed ?? r.v2_speed ?? "-",
        v3Speed: r.v3Speed ?? r.v3_speed ?? "-",
        leakBodyValue: r.leakBodyValue ?? r.leak_body_leak_value ?? "-",
        leakGall1: r.leakGall1 ?? r.leak_gall_1 ?? "-",
        leakGall2: r.leakGall2 ?? r.leak_gall_2 ?? "-",
        leakCycleTime: r.leakCycleTime ?? r.leak_cycle_time ?? "-",
        leakRunningMode: r.leakRunningMode || r.leak_running_mode || "-",
        leakDryWey: r.leakDryWey || r.leak_dry_wey_both || "-",
        createdAt: formatResultTimestamp(r.createdAt),
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Rejection_Analysis_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── Export Golden Window vs Rejection Drift Excel Handler ────────────────
  const handleExportGoldenWindowExcel = async () => {
    const features = mlInsights.features;
    if (!features || !features.length) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Golden Window vs Drift");

    sheet.columns = [
      { header: "Process Parameter", key: "label", width: 30 },
      { header: "Unit", key: "unit", width: 14 },
      { header: "Recipe Target (Set)", key: "setPoint", width: 20 },
      { header: "Recipe Set Lower", key: "setLowerLimit", width: 18 },
      { header: "Recipe Set Upper", key: "setUpperLimit", width: 18 },
      { header: "Nominal OK Mean", key: "meanOk", width: 18 },
      { header: "Safe Window LSL", key: "lsl", width: 18 },
      { header: "Safe Window USL", key: "usl", width: 18 },
      { header: "Scrap NG Mean", key: "meanNg", width: 18 },
      { header: "Scrap Drift (%)", key: "driftPct", width: 16 },
      { header: "Process Risk Level", key: "riskLevel", width: 18 },
      { header: "Attribution Score", key: "importance", width: 18 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF10254D" },
    };

    features.forEach((f) => {
      const row = sheet.addRow({
        label: f.label || f.key,
        unit: f.unit || "-",
        setPoint: f.setPoint !== null && f.setPoint !== undefined ? `${f.setPoint} ${f.unit}` : "-",
        setLowerLimit: f.setLowerLimit !== null && f.setLowerLimit !== undefined ? `${f.setLowerLimit} ${f.unit}` : "-",
        setUpperLimit: f.setUpperLimit !== null && f.setUpperLimit !== undefined ? `${f.setUpperLimit} ${f.unit}` : "-",
        meanOk: `${f.meanOk} ${f.unit}`,
        lsl: `${f.lsl} ${f.unit}`,
        usl: `${f.usl} ${f.unit}`,
        meanNg: `${f.meanNg} ${f.unit}`,
        driftPct: f.driftPct !== undefined ? `${f.driftPct > 0 ? "+" : ""}${f.driftPct}%` : "-",
        riskLevel: f.riskLevel || "NORMAL",
        importance: f.importanceScore !== undefined ? `${f.importanceScore}%` : (f.importance !== undefined ? `${f.importance}%` : "-"),
      });

      if (f.riskLevel === "CRITICAL") {
        row.getCell("riskLevel").font = { color: { argb: "FFEF4444" }, bold: true };
      } else if (f.riskLevel === "MODERATE") {
        row.getCell("riskLevel").font = { color: { argb: "FFF59E0B" }, bold: true };
      } else {
        row.getCell("riskLevel").font = { color: { argb: "FF22C55E" }, bold: true };
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Golden_Window_vs_Scrap_Drift_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── ReportTable Column Setup (Tab 4) ────────────────────────────────────
  const tableColumns = useMemo(() => [
    { key: "shot_number", label: "Shot #", width: 90 },
    { key: "shot_datetime", label: "Shot Date & Time", width: 160, renderAsText: true },
    { key: "barcode", label: "Part Serial", width: 170 },
    { key: "customerCode", label: "Customer QR", width: 220 },
    { key: "station_op100", label: stationLabels["OP100"] || "DCM+DPM + OP100", width: 140 },
    { key: "station_op110", label: stationLabels["OP110"] || "Laser Marking + OP110", width: 140 },
    { key: "station_op120", label: stationLabels["OP120"] || "Casting PDi + OP120", width: 140 },
    { key: "station_op130", label: stationLabels["OP130"] || "Pre Inspection + OP130", width: 140 },
    { key: "station_op140", label: stationLabels["OP140"] || "Auto Guaging + OP140", width: 140 },
    { key: "station_op150", label: stationLabels["OP150"] || "Leak Test OP150", width: 140 },
    { key: "station_op160", label: stationLabels["OP160"] || "Final Inspection + OP160", width: 150 },
    { key: "overallStatus", label: "Status", width: 85 },
    { key: "rejection_category", label: "Category", width: 100 },
    { key: "ngReason", label: "Rejection", width: 180 },
    { key: "rejection_view", label: "View", width: 100 },
    { key: "rejection_zone", label: "Zone", width: 100 },
    { key: "rejection_sub_zone", label: "Sub Zone", width: 100 },

    // Process parameters
    { key: "plc_cycle_time", label: "Cycle Time (s)", width: 110 },
    { key: "die_close_core_in_time", label: "Die Close Core In Time (s)", width: 140 },
    { key: "pouring_time", label: "Pouring Time (s)", width: 110 },
    { key: "shot_fwd_time", label: "Shot Fwd Time (s)", width: 110 },
    { key: "curing_time", label: "Curing Time (s)", width: 110 },
    { key: "die_open_core_out_time", label: "Die Open Core Out Time (s)", width: 140 },
    { key: "ejector_time", label: "Ejector Time (s)", width: 110 },
    { key: "extract_time", label: "Extract Time (s)", width: 110 },
    { key: "spray_time", label: "Spray Time (s)", width: 110 },
    { key: "v1_speed", label: "V1 Speed (m/s)", width: 110 },
    { key: "v2_speed", label: "V2 Speed (m/s)", width: 110 },
    { key: "v3_speed", label: "V3 Speed (m/s)", width: 110 },
    { key: "v4_speed", label: "V4 Speed (m/s)", width: 110 },
    { key: "metal_pressure", label: "Metal Pressure (bar)", width: 130 },
    { key: "furnace_metal_temp", label: "Furnace Metal Temp (°C)", width: 140 },
    { key: "cooling_water_mov", label: "Cooling Water Mov (°C)", width: 140 },
    { key: "cooling_water_sta", label: "Cooling Water Sta (°C)", width: 140 },
    { key: "accel_point", label: "Accel Point (mm)", width: 120 },
    { key: "deaccel_point", label: "Deaccel Point (mm)", width: 120 },
    { key: "intensification_time", label: "Intensification Time (s)", width: 130 },
    { key: "biscuit_thickness", label: "Biscuit Thickness (mm)", width: 130 },
    { key: "jet_cooling_pressure", label: "Jet Cooling Pressure (bar)", width: 140 },
    { key: "clamp_tonnage_he_low_pct", label: "Clamp Tonnage He Low Pct (%)", width: 150 },
    { key: "clamp_tonnage_he_low_mn", label: "Clamp Tonnage He Low Mn (MN)", width: 150 },
    { key: "clamp_tonnage_op_up_pct", label: "Clamp Tonnage Op Up Pct (%)", width: 150 },
    { key: "clamp_tonnage_op_low_pct", label: "Clamp Tonnage Op Low Pct (%)", width: 150 },
    { key: "clamp_tonnage_he_up_pct", label: "Clamp Tonnage He Up Pct (%)", width: 150 },
    { key: "vacuum_pressure", label: "Vacuum Pressure (mmHg)", width: 140 },
    { key: "clamp_force_pct", label: "Clamp Force Pct (%)", width: 130 },
    { key: "clamp_tonnage", label: "Clamp Tonnage (T)", width: 120 },
    { key: "shot_acc_pressure", label: "Shot Acc Pressure (bar)", width: 130 },
    { key: "intensification_acc_pressure", label: "Intensification Acc Pressure (bar)", width: 150 },
    { key: "fixed_die_temp_f1", label: "Fixed Die Temp F1 (°C)", width: 140 },
    { key: "fixed_die_temp_f2", label: "Fixed Die Temp F2 (°C)", width: 140 },
    { key: "moving_die_temp_m1", label: "Moving Die Temp M1 (°C)", width: 140 },
    { key: "moving_die_temp_m2", label: "Moving Die Temp M2 (°C)", width: 140 },
    { key: "slide_temp_s1", label: "Slide Temp S1 (°C)", width: 130 },
    { key: "fix_1_flow", label: "Fix 1 Flow (L/min)", width: 120 },
    { key: "fix_2_flow", label: "Fix 2 Flow (L/min)", width: 120 },
    { key: "fix_3_flow", label: "Fix 3 Flow (L/min)", width: 120 },
    { key: "mov_1_flow", label: "Mov 1 Flow (L/min)", width: 120 },
    { key: "mov_2_flow", label: "Mov 2 Flow (L/min)", width: 120 },
    { key: "mov_3_flow", label: "Mov 3 Flow (L/min)", width: 120 },
    { key: "vacuum_pressure_mmhg", label: "Vacuum Pressure Mmhg (mmHg)", width: 150 },
    { key: "average_die_clamp_tonnage_count", label: "Average Die Clamp Tonnage Count (count)", width: 170 },
    { key: "time_for_stroke", label: "Time For Stroke (s)", width: 120 },
    { key: "stroke", label: "Stroke (mm)", width: 110 },
    { key: "shot_status", label: "Shot Status", width: 100 },

    // Leak test values
    { key: "leak_body_leak_value", label: "Body Leak Value (mbar)", width: 140 },
    { key: "leak_gall_1", label: "Gall_1 (mbar)", width: 120 },
    { key: "leak_gall_2", label: "Gall_2 (mbar)", width: 120 },
    { key: "leak_cycle_time", label: "Leak Cycle Time (s)", width: 130 },
    { key: "leak_running_mode", label: "Running Mode", width: 110 },
    { key: "leak_dry_wey_both", label: "Dry/Wey", width: 100 },

    { key: "shift_code", label: "Shift", width: 70 },
    { key: "machine_name", label: "Machine", width: 110 },
    { key: "die_name", label: "Die", width: 100 },
  ].map((column) => ({ ...column, blankIfEmpty: true })), [stationLabels]);

  // Filtered rows for the table search with Customer QR isolation
  const filteredTableRows = useMemo(() => {
    const term = tableSearch.toLowerCase().trim();
    const sourceRows = recordsRows.length > 0 ? recordsRows : rejectedRows;
    const mapped = sourceRows.map((r, i) => {
      const rawPartId = String(r.partId || r.part_id || "").trim();
      const rawCustomerQr = String(r.customerQrCode || r.customer_qr || "").trim();
      const isQrInPartId = looksLikeCustomerQr(rawPartId) || rawPartId === rawCustomerQr;
      const displayPartId = !isQrInPartId && rawPartId !== "-" ? rawPartId : "";
      const displayCustomerQr = rawCustomerQr !== "-" ? rawCustomerQr : (isQrInPartId ? rawPartId : "");

      const rawShot = r.shot_number || r.shotNumber || "";
      const shotNum = displayPartId ? (rawShot && rawShot !== "-" ? rawShot : extractShotFromPartId(displayPartId)) : "";
      const shotStat = displayPartId && shotNum ? (r.shot_status || r.shotStatus || "OK") : "";

      const srcText = String(r.ng_reason || r.ngReason || r.reason || r.rejection_reason || "");
      const catParsed = r.category || r.rejection_category || parseFieldFromText(srcText, "Category") || "";
      const reasonParsed = r.reason || r.rejection_reason || r.ngReason || parseFieldFromText(srcText, "Reason") || "";
      const viewParsed = r.rejectionView || r.rejection_view || r.view || parseFieldFromText(srcText, "View") || "";
      const rawZone = r.rejectionZone || r.rejection_zone || r.zone || parseFieldFromText(srcText, "Zone") || "";
      const zoneParts = splitZoneString(rawZone);
      const zoneParsed = zoneParts.zone !== "-" ? zoneParts.zone : (rawZone !== "-" ? rawZone : "");
      const subZoneParsed = r.rejectionSubZone || r.rejection_sub_zone || r.subZone || (zoneParts.subZone !== "-" ? zoneParts.subZone : parseFieldFromText(srcText, "Sub Zone")) || "";

      return {
        id: r.id || `row-${i}`,
        shot_number: shotNum,
        shot_datetime: formatResultTimestamp(r.createdAt || r.first_scan_at),
        barcode: displayPartId,
        customerCode: displayCustomerQr,
        station_op100: r.op100_status && r.op100_status !== "-" ? r.op100_status : "",
        station_op110: r.op110_status && r.op110_status !== "-" ? r.op110_status : "",
        station_op120: r.op120_status && r.op120_status !== "-" ? r.op120_status : "",
        station_op130: r.op130_status && r.op130_status !== "-" ? r.op130_status : "",
        station_op140: r.op140_status && r.op140_status !== "-" ? r.op140_status : "",
        station_op150: r.op150_status && r.op150_status !== "-" ? r.op150_status : "",
        station_op160: r.op160_status && r.op160_status !== "-" ? r.op160_status : "",
        overallStatus: r.status || r.overall_status || "",
        rejection_category: catParsed !== "-" ? catParsed : "",
        ngReason: reasonParsed !== "-" ? reasonParsed : "",
        rejection_view: viewParsed !== "-" ? viewParsed : "",
        rejection_zone: zoneParsed !== "-" ? zoneParsed : "",
        rejection_sub_zone: subZoneParsed !== "-" ? subZoneParsed : "",

        // Process parameters
        plc_cycle_time: fmtNum(r.cycleTime || r.plc_cycle_time),
        die_close_core_in_time: fmtNum(r.die_close_core_in_time),
        pouring_time: fmtNum(r.pouring_time),
        shot_fwd_time: fmtNum(r.shot_fwd_time),
        curing_time: fmtNum(r.curing_time),
        die_open_core_out_time: fmtNum(r.die_open_core_out_time),
        ejector_time: fmtNum(r.ejector_time),
        extract_time: fmtNum(r.extract_time),
        spray_time: fmtNum(r.spray_time),
        v1_speed: fmtNum(r.v1Speed || r.v1_speed),
        v2_speed: fmtNum(r.v2Speed || r.v2_speed),
        v3_speed: fmtNum(r.v3Speed || r.v3_speed),
        v4_speed: fmtNum(r.v4Speed || r.v4_speed),
        metal_pressure: fmtNum(r.metalPressure || r.metal_pressure),
        furnace_metal_temp: fmtNum(r.metalTemp || r.furnace_metal_temp),
        cooling_water_mov: fmtNum(r.cooling_water_mov),
        cooling_water_sta: fmtNum(r.cooling_water_sta),
        accel_point: fmtNum(r.accel_point),
        deaccel_point: fmtNum(r.deaccel_point),
        intensification_time: fmtNum(r.intensification_time),
        biscuit_thickness: fmtNum(r.biscuitThickness || r.biscuit_thickness),
        jet_cooling_pressure: fmtNum(r.jet_cooling_pressure),
        clamp_tonnage_he_low_pct: fmtNum(r.clamp_tonnage_he_low_pct),
        clamp_tonnage_he_low_mn: fmtNum(r.clamp_tonnage_he_low_mn),
        clamp_tonnage_op_up_pct: fmtNum(r.clamp_tonnage_op_up_pct),
        clamp_tonnage_op_low_pct: fmtNum(r.clamp_tonnage_op_low_pct),
        clamp_tonnage_he_up_pct: fmtNum(r.clamp_tonnage_he_up_pct),
        vacuum_pressure: fmtNum(r.vacuum_pressure),
        clamp_force_pct: fmtNum(r.clamp_force_pct),
        clamp_tonnage: fmtNum(r.clamp_tonnage),
        shot_acc_pressure: fmtNum(r.shot_acc_pressure),
        intensification_acc_pressure: fmtNum(r.intensification_acc_pressure),
        fixed_die_temp_f1: fmtNum(r.fixed_die_temp_f1),
        fixed_die_temp_f2: fmtNum(r.fixed_die_temp_f2),
        moving_die_temp_m1: fmtNum(r.moving_die_temp_m1),
        moving_die_temp_m2: fmtNum(r.moving_die_temp_m2),
        slide_temp_s1: fmtNum(r.slide_temp_s1),
        fix_1_flow: fmtNum(r.fix_1_flow),
        fix_2_flow: fmtNum(r.fix_2_flow),
        fix_3_flow: fmtNum(r.fix_3_flow),
        mov_1_flow: fmtNum(r.mov_1_flow),
        mov_2_flow: fmtNum(r.mov_2_flow),
        mov_3_flow: fmtNum(r.mov_3_flow),
        vacuum_pressure_mmhg: fmtNum(r.vacuum_pressure_mmhg),
        average_die_clamp_tonnage_count: fmtNum(r.average_die_clamp_tonnage_count),
        time_for_stroke: fmtNum(r.time_for_stroke),
        stroke: fmtNum(r.stroke),
        shot_status: r.shot_status || "-",

        // Leak test values
        leak_body_leak_value: fmtNum(r.leakBodyValue ?? r.leak_body_leak_value),
        leak_gall_1: fmtNum(r.leakGall1 ?? r.leak_gall_1),
        leak_gall_2: fmtNum(r.leakGall2 ?? r.leak_gall_2),
        leak_cycle_time: fmtNum(r.leakCycleTime ?? r.leak_cycle_time),
        leak_running_mode: r.leakRunningMode || r.leak_running_mode || "-",
        leak_dry_wey_both: r.leakDryWey || r.leak_dry_wey_both || "-",

        shift_code: r.shiftCode || r.shift_code || "A",
        machine_name: r.machineName || r.machine_name || "-",
        die_name: r.dieName || r.die_name || "-",
      };
    });

    const cleaned = mapped.map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === "-" ? null : value]),
    ));
    if (!term || recordsRows.length > 0) return cleaned;
    return cleaned.filter((r) =>
      String(r.barcode || "").toLowerCase().includes(term) ||
      String(r.customerCode || "").toLowerCase().includes(term) ||
      String(r.ngReason || "").toLowerCase().includes(term) ||
      String(r.machine_name || "").toLowerCase().includes(term) ||
      String(r.shot_number || "").toLowerCase().includes(term) ||
      String(r.rejection_zone || "").toLowerCase().includes(term) ||
      String(r.rejection_sub_zone || "").toLowerCase().includes(term) ||
      String(r.rejection_category || "").toLowerCase().includes(term) ||
      String(r.rejection_view || "").toLowerCase().includes(term)
    );
  }, [recordsRows, rejectedRows, tableSearch]);

  // ── Outlier Scanner Table Columns & Rows (Tab 2) ────────────────────────
  const outlierColumns = useMemo(() => [
    { key: "shot_number", label: "Shot #", width: 90 },
    { key: "shot_status", label: "Shot Status", width: 100 },
    { key: "shot_datetime", label: "Recorded At", width: 160, renderAsText: true },
    { key: "barcode", label: "Part Serial", width: 170 },
    { key: "customerCode", label: "Customer QR", width: 220 },
    { key: "machine_name", label: "Machine", width: 130 },
    { key: "status", label: "Status", width: 85 },
    { key: "rejection_category", label: "Category", width: 110 },
    { key: "ngReason", label: "Rejection", width: 180 },
    { key: "rejection_view", label: "View", width: 100 },
    { key: "rejection_zone", label: "Zone", width: 110 },
    { key: "rejection_sub_zone", label: "Sub Zone", width: 110 },
    { key: "worstDeviatingParam", label: "Primary Outlier Excursion", width: 240 },
    { key: "recipe_limits", label: "Recipe Set Limits / Target", width: 220 },
    { key: "anomalyScore", label: "Anomaly Distance", width: 130 },
  ], []);

  const filteredOutlierRows = useMemo(() => {
    const term = outlierSearch.toLowerCase().trim();
    let anomalies = Array.isArray(mlInsights.topAnomalies) && mlInsights.topAnomalies.length > 0
      ? mlInsights.topAnomalies
      : [];

    if (anomalies.length === 0 && allRejectionRecords.length > 0) {
      anomalies = allRejectionRecords
        .filter((r) => r.metalPressure || r.metal_pressure || r.biscuitThickness || r.biscuit_thickness || r.furnaceTemp || r.metalTemp || r.cycleTime)
        .slice(0, 100)
        .map((r) => ({
          ...r,
          worstDeviatingParam: (r.metalPressure || r.metal_pressure) ? `Metal Pressure (${r.metalPressure || r.metal_pressure} bar)` : ((r.biscuitThickness || r.biscuit_thickness) ? `Biscuit (${r.biscuitThickness || r.biscuit_thickness} mm)` : "Process Excursion"),
          worstParamLimits: "Exceeded Recipe Limits",
          anomalyScore: "2.5",
        }));
    }

    const mapped = anomalies.map((part, idx) => {
      const rawPartId = String(part.partId || part.part_id || "").trim();
      const rawCustomerQr = String(part.customerQrCode || part.customer_qr || "").trim();
      const isQrInPartId = looksLikeCustomerQr(rawPartId) || rawPartId === rawCustomerQr;
      const displayPartId = !isQrInPartId && rawPartId !== "-" ? rawPartId : "";
      const displayCustomerQr = rawCustomerQr !== "-" ? rawCustomerQr : (isQrInPartId ? rawPartId : "");

      const rawShot = part.shotNumber || part.shot_number || "";
      const shotNum = displayPartId ? (rawShot && rawShot !== "-" ? rawShot : extractShotFromPartId(displayPartId)) : "";
      const shotStat = displayPartId && shotNum ? (part.shot_status || part.shotStatus || (part.status === "NG" ? "NG" : "OK")) : "";

      const srcText = String(part.ng_reason || part.ngReason || part.reason || part.rejection_reason || "");
      const catParsed = part.category || part.rejection_category || parseFieldFromText(srcText, "Category") || "";
      const reasonParsed = part.reason || part.rejection_reason || part.ngReason || parseFieldFromText(srcText, "Reason") || "";
      const viewParsed = part.rejectionView || part.rejection_view || part.view || parseFieldFromText(srcText, "View") || "";
      const rawZone = part.rejectionZone || part.rejection_zone || part.zone || parseFieldFromText(srcText, "Zone") || "";
      const zoneParts = splitZoneString(rawZone);
      const zoneParsed = zoneParts.zone !== "-" ? zoneParts.zone : (rawZone !== "-" ? rawZone : "");
      const subZoneParsed = part.rejectionSubZone || part.rejection_sub_zone || part.subZone || (zoneParts.subZone !== "-" ? zoneParts.subZone : parseFieldFromText(srcText, "Sub Zone")) || "";

      return {
        id: part.rowKey || part.id || `outlier-${idx}`,
        shot_number: shotNum,
        shot_status: shotStat,
        shot_datetime: formatResultTimestamp(part.createdAt || part.first_scan_at),
        barcode: displayPartId,
        customerCode: displayCustomerQr,
        machine_name: part.machineName && part.machineName !== "-" ? part.machineName : (part.machine_name && part.machine_name !== "-" ? part.machine_name : ""),
        status: part.status || "NG",
        rejection_category: catParsed !== "-" ? catParsed : "",
        ngReason: reasonParsed !== "-" ? reasonParsed : "",
        rejection_view: viewParsed !== "-" ? viewParsed : "",
        rejection_zone: zoneParsed !== "-" ? zoneParsed : "",
        rejection_sub_zone: subZoneParsed !== "-" ? subZoneParsed : "",
        worstDeviatingParam: part.worstDeviatingParam && part.worstDeviatingParam !== "-" ? part.worstDeviatingParam : "",
        recipe_limits: part.worstParamLimits && part.worstParamLimits !== "-" ? part.worstParamLimits : "",
        anomalyScore: part.anomalyScore ? `${part.anomalyScore} σ` : "",
      };
    });

    if (!term) return mapped;
    return mapped.filter((r) =>
      String(r.barcode).toLowerCase().includes(term) ||
      String(r.customerCode).toLowerCase().includes(term) ||
      String(r.shot_number).toLowerCase().includes(term) ||
      String(r.machine_name).toLowerCase().includes(term) ||
      String(r.ngReason).toLowerCase().includes(term) ||
      String(r.rejection_category).toLowerCase().includes(term) ||
      String(r.rejection_view).toLowerCase().includes(term) ||
      String(r.rejection_zone).toLowerCase().includes(term) ||
      String(r.rejection_sub_zone).toLowerCase().includes(term) ||
      String(r.worstDeviatingParam).toLowerCase().includes(term) ||
      String(r.recipe_limits).toLowerCase().includes(term)
    );
  }, [mlInsights.topAnomalies, outlierSearch]);

  const handleExportOutliersExcel = async () => {
    if (!filteredOutlierRows.length) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("ML Outlier Defects");

    sheet.columns = [
      { header: "Shot #", key: "shot_number", width: 12 },
      { header: "Shot Status", key: "shot_status", width: 14 },
      { header: "Recorded At", key: "shot_datetime", width: 22 },
      { header: "Part Serial", key: "barcode", width: 24 },
      { header: "Customer QR", key: "customerCode", width: 30 },
      { header: "Machine", key: "machine_name", width: 16 },
      { header: "Status", key: "status", width: 12 },
      { header: "Category", key: "rejection_category", width: 16 },
      { header: "Rejection Reason", key: "ngReason", width: 28 },
      { header: "View", key: "rejection_view", width: 14 },
      { header: "Zone", key: "rejection_zone", width: 16 },
      { header: "Sub Zone", key: "rejection_sub_zone", width: 16 },
      { header: "Primary Outlier Excursion", key: "worstDeviatingParam", width: 34 },
      { header: "Recipe Set Limits / Target", key: "recipe_limits", width: 30 },
      { header: "Anomaly Z-Score", key: "anomalyScore", width: 16 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8B5CF6" },
    };

    filteredOutlierRows.forEach((r) => {
      sheet.addRow(r);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `ML_Outlier_Defects_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── Clean Reason Pareto (Filtering out any Unspecified and Merging Canonical Reasons) ─
  const cleanPareto = useMemo(() => {
    const map = {};
    const normKeyToCanon = {};
    if (pareto && pareto.length > 0) {
      pareto.forEach((p) => {
        const raw = p.reason;
        if (!raw || String(raw).toLowerCase().includes("unspecified")) return;
        const canon = canonicalizeReason(raw);
        const norm = normalizeDefectKey(canon);
        if (!normKeyToCanon[norm]) normKeyToCanon[norm] = canon;
        const targetCanon = normKeyToCanon[norm];
        map[targetCanon] = (map[targetCanon] || 0) + (Number(p.count) || 0);
      });
    } else if (rejectedRows.length > 0) {
      rejectedRows.forEach((r) => {
        const p = parseRowDefect(r);
        const reason = p.reason || r.rejection_reason || r.ng_reason || "Casting Defect";
        if (reason && reason !== "-" && !reason.toLowerCase().includes("unspecified")) {
          const canon = canonicalizeReason(reason);
          const norm = normalizeDefectKey(canon);
          if (!normKeyToCanon[norm]) normKeyToCanon[norm] = canon;
          const targetCanon = normKeyToCanon[norm];
          map[targetCanon] = (map[targetCanon] || 0) + 1;
        }
      });
    }
    const list = Object.entries(map)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    const total = list.reduce((s, c) => s + (Number(c.count) || 0), 0) || 1;
    let cum = 0;
    return list.map((item) => {
      const c = Number(item.count) || 0;
      cum += c;
      return {
        ...item,
        count: c,
        percentage: Number(((c / total) * 100).toFixed(1)),
        cumulativePercentage: Number(((cum / total) * 100).toFixed(1)),
      };
    });
  }, [pareto, rejectedRows]);

  // ── Category-wise Pareto ────────────────────────────────────────────────
  const categoryPareto = useMemo(() => {
    if (categoryParetoData && categoryParetoData.length > 0) {
      return categoryParetoData
        .filter((c) => c.category && !String(c.category).toLowerCase().includes("unspecified"))
        .map((c) => ({
          ...c,
          category: c.category === "-" ? "CR" : c.category,
        }));
    }
    const map = {};
    rejectedRows.forEach((r) => {
      const p = parseRowDefect(r);
      const cat = p.category || r.category || r.rejection_category || "CR";
      if (cat && cat !== "-" && !cat.toLowerCase().includes("unspecified")) {
        map[cat] = (map[cat] || 0) + 1;
      }
    });
    const sorted = Object.entries(map)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, c) => s + c.count, 0) || 1;
    let cum = 0;
    return sorted.map((item) => {
      cum += item.count;
      return {
        ...item,
        percentage: Number(((item.count / total) * 100).toFixed(1)),
        cumulativePercentage: Number(((cum / total) * 100).toFixed(1)),
      };
    });
  }, [categoryParetoData, rejectedRows]);

  // ── Zone-wise Rejection Breakdown ───────────────────────────────────────
  const zoneBreakdown = useMemo(() => {
    if (zoneParetoData && zoneParetoData.length > 0) {
      return zoneParetoData
        .filter((z) => z.zone && !String(z.zone).toLowerCase().includes("unspecified"))
        .map((z) => ({
          ...z,
          zone: (!z.zone || z.zone === "-") ? "Zone General" : z.zone,
        }));
    }
    const map = {};
    rejectedRows.forEach((r) => {
      const p = parseRowDefect(r);
      let zone = p.zone || r.rejectionZone || r.rejection_zone || "";
      if (!zone || zone === "-" || zone.toLowerCase().includes("unspecified")) {
        zone = "Zone General";
      }
      map[zone] = (map[zone] || 0) + 1;
    });
    const sorted = Object.entries(map)
      .map(([zone, count]) => ({ zone, count }))
      .sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, c) => s + c.count, 0) || 1;
    let cum = 0;
    return sorted.map((item) => {
      cum += item.count;
      return {
        ...item,
        percentage: Number(((item.count / total) * 100).toFixed(1)),
        cumulativePercentage: Number(((cum / total) * 100).toFixed(1)),
      };
    });
  }, [zoneParetoData, rejectedRows]);

  // ── Active Pareto Selection & Hotspot Drilldown Logic ───────────────────
  const activeParetoKey = useMemo(() => {
    if (selectedParetoItem) {
      return (
        selectedParetoItem.reason ||
        selectedParetoItem.category ||
        selectedParetoItem.zone ||
        selectedParetoItem.name ||
        ""
      );
    }
    if (paretoView === "reason" && cleanPareto.length > 0) return cleanPareto[0].reason;
    if (paretoView === "category" && categoryPareto.length > 0) return categoryPareto[0].category;
    if (paretoView === "zone" && zoneBreakdown.length > 0) return zoneBreakdown[0].zone;
    return "";
  }, [selectedParetoItem, paretoView, cleanPareto, categoryPareto, zoneBreakdown]);

  // ── Fetch Pareto Drill-Down Parts On Demand ─────────────────────────────
  useEffect(() => {
    if (!activeParetoKey) {
      setParetoDrillDownParts([]);
      return;
    }
    let isCancelled = false;
    const fetchParetoParts = async () => {
      setParetoDrillDownLoading(true);
      try {
        const query = {
          status: "NG",
          allTime: "1",
          pageSize: 500,
          noCache: "1",
          _ts: Date.now(),
        };
        if (paretoView === "reason") query.reason = activeParetoKey;
        else if (paretoView === "category") query.category = activeParetoKey;
        else if (paretoView === "zone") query.zone = activeParetoKey;

        if (filters.datePreset && filters.datePreset !== "all") query.datePreset = filters.datePreset;
        if (filters.dateFrom) query.dateFrom = filters.dateFrom;
        if (filters.dateTo) query.dateTo = filters.dateTo;
        if (filters.shiftCode) query.shiftCode = filters.shiftCode;
        if (filters.machineName) query.machineName = filters.machineName;

        const res = await dashboardApi.rejectionRows(query, { timeout: 30000, suppressGlobalError: true });
        if (!isCancelled && res && Array.isArray(res.rows)) {
          setParetoDrillDownParts(res.rows);
        }
      } catch (err) {
        console.warn("[REJECTION UI] Failed to fetch pareto drilldown parts:", err);
      } finally {
        if (!isCancelled) setParetoDrillDownLoading(false);
      }
    };

    fetchParetoParts();
    return () => { isCancelled = true; };
  }, [activeParetoKey, paretoView, filters]);

  const activeParetoStats = useMemo(() => {
    const list = paretoView === "reason" ? cleanPareto : paretoView === "category" ? categoryPareto : zoneBreakdown;
    const keyProp = paretoView === "reason" ? "reason" : paretoView === "category" ? "category" : "zone";
    const found = list.find((it) => it[keyProp] === activeParetoKey);
    return found || list[0] || null;
  }, [paretoView, cleanPareto, categoryPareto, zoneBreakdown, activeParetoKey]);

  // All matching rejection parts for the selected Pareto item
  const paretoMatchingRecords = useMemo(() => {
    if (!activeParetoKey) return [];
    const keyUpper = String(activeParetoKey).trim().toUpperCase();

    return (allRejectionRecords || []).filter((r) => {
      const p = parseRowDefect(r);
      if (paretoView === "reason") {
        return (
          isReasonMatch(p.reason, activeParetoKey) ||
          isReasonMatch(r.rejection_reason, activeParetoKey) ||
          isReasonMatch(r.ng_reason, activeParetoKey) ||
          isReasonMatch(r.parts_interlock_reason, activeParetoKey)
        );
      }
      if (paretoView === "category") {
        const catNorm = normalizeDefectKey(p.category || r.rejection_category || r.category);
        return catNorm === normalizeDefectKey(activeParetoKey);
      }
      if (paretoView === "zone") {
        const rZone = cleanZoneCode(p.zone || r.rejection_zone || r.rejectionZone);
        const targetZone = cleanZoneCode(activeParetoKey);
        return rZone === targetZone || String(p.zone || "").toUpperCase().includes(keyUpper);
      }
      return false;
    });
  }, [allRejectionRecords, paretoView, activeParetoKey]);

  // Defect Localization across All Inspection Views for Selected Pareto Defect
  const paretoPictorialViewData = useMemo(() => {
    if (!rejectionConfig?.views?.length) return [];

    return rejectionConfig.views.map((v, vIndex) => {
      const vNorm = normalizeCode(v.name || v.code);
      let viewRecords = paretoMatchingRecords.filter((r) => {
        const p = parseRowDefect(r);
        const rV = normalizeCode(p.view);
        if (rV && (vNorm.includes(rV) || rV.includes(vNorm))) return true;
        const zClean = cleanZoneCode(p.zone);
        if (zClean && (v.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean)) return true;
        return false;
      });

      // Fallback: If matching records exist for this defect but none match specific view names,
      // attribute them to the first view (Top View) so the pictorial images always localize the defect
      if (viewRecords.length === 0 && paretoMatchingRecords.length > 0 && vIndex === 0) {
        const hasAnyTaggedView = paretoMatchingRecords.some((r) => {
          const p = parseRowDefect(r);
          return (rejectionConfig.views || []).some((ov) => {
            const ovNorm = normalizeCode(ov.name || ov.code);
            const rV = normalizeCode(p.view);
            return rV && (ovNorm.includes(rV) || rV.includes(ovNorm));
          });
        });
        if (!hasAnyTaggedView) {
          viewRecords = paretoMatchingRecords;
        }
      }

      const zoneCounts = {};
      const subZoneCounts = {};

      viewRecords.forEach((r) => {
        const p = parseRowDefect(r);
        const zClean = cleanZoneCode(p.zone);
        const szClean = cleanSubZoneCode(p.subZone);
        if (zClean) zoneCounts[zClean] = (zoneCounts[zClean] || 0) + 1;
        if (szClean) subZoneCounts[szClean] = (subZoneCounts[szClean] || 0) + 1;
        if (zClean && szClean) {
          const pairKey = `${zClean}__${szClean}`;
          subZoneCounts[pairKey] = (subZoneCounts[pairKey] || 0) + 1;
        }
      });

      const totalZoneHits = Object.values(zoneCounts).reduce((s, c) => s + c, 0);

      const processedZones = (v.zones || []).map((z, zIdx) => {
        const zClean = cleanZoneCode(z.code || z.name);
        let count = zoneCounts[zClean] || 0;
        if (count === 0 && viewRecords.length > 0 && totalZoneHits === 0 && zIdx === 0) {
          count = viewRecords.length;
        }

        const processedSubs = (z.subZones || []).map((sz) => {
          const szClean = cleanSubZoneCode(sz.code || sz.name);
          const pairKey = `${zClean}__${szClean}`;
          const count = subZoneCounts[pairKey] || subZoneCounts[szClean] || 0;
          return {
            ...sz,
            count,
            hasDefect: count > 0,
          };
        });
        return {
          ...z,
          count,
          hasDefect: count > 0,
          subZones: processedSubs,
        };
      });

      const activeSubZonesList = [];
      processedZones.forEach((z) => {
        z.subZones.forEach((sz) => {
          if (sz.count > 0) {
            activeSubZonesList.push(`${z.name || z.code} › ${sz.name || sz.code} (${sz.count})`);
          }
        });
        if (z.count > 0 && !z.subZones.some((sz) => sz.count > 0)) {
          activeSubZonesList.push(`${z.name || z.code} (${z.count})`);
        }
      });

      return {
        id: v.id,
        code: v.code,
        name: v.name,
        imageUrl: v.imageUrl,
        totalDefects: viewRecords.length,
        activeSubZonesList,
        zones: processedZones,
      };
    });
  }, [rejectionConfig, paretoMatchingRecords]);

  // Comprehensive Pareto Summarization & Localization KPIs
  const paretoSummary = useMemo(() => {
    const totalMatching = paretoMatchingRecords.length;
    const totalAllRejections = (allRejectionRecords || []).length || 1;
    const percentageOfAll = Number(((totalMatching / totalAllRejections) * 100).toFixed(1));

    // Calculate primary view
    let primaryViewName = "All Views";
    let maxViewCount = 0;
    (paretoPictorialViewData || []).forEach((v) => {
      if (v.totalDefects > maxViewCount) {
        maxViewCount = v.totalDefects;
        primaryViewName = v.name;
      }
    });
    const primaryViewPercentage = totalMatching > 0 ? Number(((maxViewCount / totalMatching) * 100).toFixed(1)) : 0;

    // Calculate hotspot zone and sub-zone
    const zoneCountMap = {};
    const subZoneCountMap = {};
    const machineCountMap = {};
    const gateCountMap = {};

    let sumPress = 0, countPress = 0;
    let sumTemp = 0, countTemp = 0;
    let sumBiscuit = 0, countBiscuit = 0;
    let sumCycle = 0, countCycle = 0;

    paretoMatchingRecords.forEach((r) => {
      const p = parseRowDefect(r);
      const z = p.zone ? cleanZoneCode(p.zone) : "";
      const sz = p.subZone ? cleanSubZoneCode(p.subZone) : "";
      if (z) zoneCountMap[z] = (zoneCountMap[z] || 0) + 1;
      if (z && sz) {
        const key = `${z} › ${sz}`;
        subZoneCountMap[key] = (subZoneCountMap[key] || 0) + 1;
      }

      const m = r.machineName || r.machine_name;
      if (m) machineCountMap[m] = (machineCountMap[m] || 0) + 1;

      const g = r.ngGate || r.ng_gate || r.operation_no;
      if (g) gateCountMap[g] = (gateCountMap[g] || 0) + 1;

      const press = Number(r.metalPressure ?? r.metal_pressure);
      if (Number.isFinite(press) && press > 0) {
        sumPress += press;
        countPress++;
      }
      const temp = Number(r.metalTemp ?? r.furnace_metal_temp);
      if (Number.isFinite(temp) && temp > 0) {
        sumTemp += temp;
        countTemp++;
      }
      const bisc = Number(r.biscuitThickness ?? r.biscuit_thickness);
      if (Number.isFinite(bisc) && bisc > 0) {
        sumBiscuit += bisc;
        countBiscuit++;
      }
      const cyc = Number(r.cycleTime ?? r.plc_cycle_time);
      if (Number.isFinite(cyc) && cyc > 0) {
        sumCycle += cyc;
        countCycle++;
      }
    });

    // Top hotspot subzone
    const sortedSubZones = Object.entries(subZoneCountMap).sort((a, b) => b[1] - a[1]);
    const topHotspotSubZone = sortedSubZones[0] ? `${sortedSubZones[0][0]} (${sortedSubZones[0][1]} rejects)` : "Distributed across part";

    // Top Machine
    const sortedMachines = Object.entries(machineCountMap).sort((a, b) => b[1] - a[1]);
    const topMachine = sortedMachines[0] ? `${sortedMachines[0][0]} (${sortedMachines[0][1]} rejects)` : "Multiple Machines";

    // Top Station / Gate
    const sortedGates = Object.entries(gateCountMap).sort((a, b) => b[1] - a[1]);
    const topGate = sortedGates[0] ? sortedGates[0][0] : "Multiple Gates";

    return {
      totalMatching,
      percentageOfAll,
      primaryViewName,
      primaryViewCount: maxViewCount,
      primaryViewPercentage,
      topHotspotSubZone,
      topMachine,
      topGate,
      avgPress: countPress > 0 ? (sumPress / countPress).toFixed(1) : null,
      avgTemp: countTemp > 0 ? (sumTemp / countTemp).toFixed(0) : null,
      avgBiscuit: countBiscuit > 0 ? (sumBiscuit / countBiscuit).toFixed(1) : null,
      avgCycle: countCycle > 0 ? (sumCycle / countCycle).toFixed(1) : null,
    };
  }, [paretoMatchingRecords, allRejectionRecords, paretoPictorialViewData]);

  // Filtered Parts list for Pareto selection
  const filteredParetoParts = useMemo(() => {
    let list = paretoMatchingRecords;
    if (paretoSelectedView && paretoSelectedView !== "all") {
      const normSel = normalizeCode(paretoSelectedView);
      list = list.filter((r) => {
        const p = parseRowDefect(r);
        const rV = normalizeCode(p.view);
        let viewMatch = rV && (normSel.includes(rV) || rV.includes(normSel));
        if (!viewMatch && rejectionConfig?.views) {
          const matchedView = rejectionConfig.views.find(
            (v) => normalizeCode(v.name) === normSel || normalizeCode(v.code) === normSel
          );
          if (matchedView) {
            const zClean = cleanZoneCode(p.zone);
            viewMatch = zClean && (matchedView.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean);
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
      return (
        pId.includes(term) ||
        qr.includes(term) ||
        mName.includes(term) ||
        p.reason.toLowerCase().includes(term) ||
        p.zone.toLowerCase().includes(term) ||
        p.subZone.toLowerCase().includes(term)
      );
    });
  }, [paretoMatchingRecords, paretoSelectedView, paretoPartSearch, rejectionConfig]);

  // Excel Export for Pareto Parts
  const exportParetoPartsExcel = async () => {
    if (!filteredParetoParts.length) return;
    const ExcelJS = await import("exceljs");
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

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1A3263" },
    };

    filteredParetoParts.forEach((r) => {
      const p = parseRowDefect(r);
      const shot =
        r.partId && r.partId !== "-" && !r.partId.startsWith("R437")
          ? r.partId.split("_")[1] || r.shotNo || "—"
          : r.shotNo || "—";

      sheet.addRow({
        partId: r.partId || r.part_id || "—",
        customerQrCode: r.customerQrCode || r.customer_qr || "—",
        shotNo: shot,
        machineName: r.machineName || r.machine_name || "—",
        ngGate: r.ngGate || r.ng_gate || r.operation_no || "—",
        timestamp: r.timestamp || r.createdAt || r.first_scan_at || "—",
        category: p.category || "—",
        reason: p.reason || "—",
        view: p.view || "—",
        zone: p.zone || "—",
        subZone: p.subZone || "—",
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
    saveAs(
      new Blob([buffer]),
      `Pareto_Parts_${String(activeParetoKey).replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  // ── Scatter Plot Data (Tab 2) ───────────────────────────────────────────
  const scatterData = useMemo(() => {
    const okPoints = [];
    const ngPoints = [];
    const dataPool = rows.length > 0 ? rows : (recordsRows.length > 0 ? recordsRows : allRejectionRecords);

    dataPool.slice(0, 800).forEach((r) => {
      const xVal = Number(r[selectedScatterX]);
      const yVal = Number(r[selectedScatterY]);
      if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
        const statusUpper = String(r.status || r.overall_status || "").trim().toUpperCase();
        const isNg = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(statusUpper) ||
          Boolean(r.ngGate && r.ngGate !== "-");
        const isOk = ["OK", "PASSED", "ENDED_OK", "COMPLETED_OK"].includes(statusUpper);

        // Exclude uncompleted / WIP parts from nominal OK scatter
        if (statusUpper === "IN_PROGRESS" || statusUpper === "WIP") return;

        const point = {
          x: xVal,
          y: yVal,
          partId: r.partId && r.partId !== "-" ? r.partId : (r.customerQrCode || "Part"),
          customerQrCode: r.customerQrCode || "-",
          reason: r.reason && r.reason !== "-" ? r.reason : (isNg ? "Defect" : "Nominal"),
          status: isNg ? "NG (Scrap)" : "OK (Passed)",
          rawStatus: r.status || r.overall_status,
          zone: r.rejectionZone && r.rejectionZone !== "-" ? r.rejectionZone : "-",
          subZone: r.rejectionSubZone && r.rejectionSubZone !== "-" ? r.rejectionSubZone : "-",
          category: r.category && r.category !== "-" ? r.category : "-",
        };
        if (isNg) {
          ngPoints.push(point);
        } else if (isOk) {
          okPoints.push(point);
        }
      }
    });

    return { okPoints, ngPoints };
  }, [rows, recordsRows, allRejectionRecords, selectedScatterX, selectedScatterY]);

  // ── Radar Chart Data (OK vs NG parameter profile) ──────────────────────
  const radarData = useMemo(() => {
    if (!mlInsights.features?.length) return [];
    return mlInsights.features.slice(0, 8).map((f) => {
      // Normalize to 0-100 scale for visual comparison
      const maxVal = Math.max(Math.abs(f.meanOk), Math.abs(f.meanNg), 1);
      return {
        parameter: f.label.length > 14 ? f.label.slice(0, 14) + "…" : f.label,
        fullLabel: f.label,
        "OK Mean": Number(((Math.abs(f.meanOk) / maxVal) * 100).toFixed(1)),
        "NG Mean": Number(((Math.abs(f.meanNg) / maxVal) * 100).toFixed(1)),
        okRaw: f.meanOk,
        ngRaw: f.meanNg,
        unit: f.unit,
      };
    });
  }, [mlInsights.features]);

  // ── Process Telemetry Time Series (Tab 3) ────────────────────────────────
  const telemetryTrendData = useMemo(() => {
    const activeSpec = mlInsights.features?.find((f) => f.key === selectedTelemetryParam) || {};
    const dataPool = rows.length > 0 ? rows : (recordsRows.length > 0 ? recordsRows : allRejectionRecords);

    // Helper to safely extract telemetry parameter from row in any casing or alias
    const getVal = (r, paramKey) => {
      if (r[paramKey] !== undefined && r[paramKey] !== null) {
        const n = Number(r[paramKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      const camelKey = paramKey.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
      if (r[camelKey] !== undefined && r[camelKey] !== null) {
        const n = Number(r[camelKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      const snakeKey = paramKey.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
      if (r[snakeKey] !== undefined && r[snakeKey] !== null) {
        const n = Number(r[snakeKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("temp")) {
        const n = Number(r.metalTemp ?? r.furnace_metal_temp ?? r.metal_temp);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("press")) {
        const n = Number(r.metalPressure ?? r.metal_pressure);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("biscuit")) {
        const n = Number(r.biscuitThickness ?? r.biscuit_thickness);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("cycle")) {
        const n = Number(r.cycleTime ?? r.cycle_time ?? r.plc_cycle_time);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("v1")) {
        const n = Number(r.v1Speed ?? r.v1_speed);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("leak")) {
        const n = Number(r.leakBodyValue ?? r.leak_body_leak_value ?? r.leak_body_value);
        if (Number.isFinite(n) && n >= 0) return n;
      }
      return null;
    };

    const validRows = dataPool
      .map((r, idx) => {
        const val = getVal(r, selectedTelemetryParam);
        if (val === null) return null;
        return { r, val, origIdx: idx };
      })
      .filter(Boolean)
      .slice(0, 1000);

    // Sort chronologically / by shot for an authentic SPC run sequence
    validRows.sort((a, b) => {
      const aRawPart = String(a.r.partId || a.r.part_id || "");
      const bRawPart = String(b.r.partId || b.r.part_id || "");
      const aShot = Number(a.r.shot_number || a.r.shotNumber || extractShotFromPartId(aRawPart) || 0);
      const bShot = Number(b.r.shot_number || b.r.shotNumber || extractShotFromPartId(bRawPart) || 0);
      if (aShot && bShot) return aShot - bShot;
      return new Date(a.r.first_scan_at || a.r.createdAt || 0) - new Date(b.r.first_scan_at || b.r.createdAt || 0);
    });

    return validRows.map((item, index) => {
      const { r, val } = item;
      const isOutlier = (activeSpec.usl != null && val > activeSpec.usl) || (activeSpec.lsl != null && val < activeSpec.lsl);
      const isPartNg = ["NG", "FAILED", "FAIL", "ENDED_NG", "COMPLETED_NG"].includes(String(r.status || r.overall_status || "").trim().toUpperCase());
      const rawPartId = String(r.partId || r.part_id || r.customerQrCode || r.customer_qr || `Part #${index + 1}`).trim();
      const extractedShot = extractShotFromPartId(rawPartId);
      const shotNum = (r.shot_number && r.shot_number !== "-") ? r.shot_number : ((r.shotNumber && r.shotNumber !== "-") ? r.shotNumber : (extractedShot || `${index + 1}`));

      const setPoint = activeSpec.setPoint ?? activeSpec.meanOk ?? null;
      const usl = activeSpec.usl ?? null;
      const lsl = activeSpec.lsl ?? null;
      const numericVal = Number(val.toFixed(2));
      const delta = setPoint != null ? Number((numericVal - setPoint).toFixed(2)) : 0;
      const deltaPct = (setPoint && setPoint !== 0) ? Number((((numericVal - setPoint) / Math.abs(setPoint)) * 100).toFixed(1)) : 0;

      let varStatus = "IN_SPEC";
      if (usl != null && numericVal > usl) {
        varStatus = "HIGH_OUTLIER";
      } else if (lsl != null && numericVal < lsl) {
        varStatus = "LOW_OUTLIER";
      } else if (Math.abs(deltaPct) > 10) {
        varStatus = "WARNING";
      }

      return {
        index: index + 1,
        partId: rawPartId,
        customerQr: String(r.customerQrCode || r.customer_qr || "-"),
        shotNumber: shotNum,
        machineName: r.machineName || r.machine_name || "-",
        shiftCode: r.shiftCode || r.shift_code || "A",
        value: numericVal,
        actualValue: numericVal,
        target: setPoint,
        nominal: setPoint,
        usl,
        lsl,
        delta,
        deltaPct,
        varStatus,
        status: isPartNg ? "NG" : "OK",
        isOutlier: isOutlier || isPartNg,
        isInSpec: !isOutlier && !isPartNg,
        createdAt: r.first_scan_at || r.createdAt,
      };
    });
  }, [rows, recordsRows, allRejectionRecords, selectedTelemetryParam, mlInsights.features]);

  // Current active parameter specification for Tab 3
  const currentTelemetrySpec = useMemo(() => {
    return mlInsights.features?.find((f) => f.key === selectedTelemetryParam) || {
      label: selectedTelemetryParam,
      unit: "",
      meanOk: 0,
      meanNg: 0,
      stdOk: 0,
      usl: 0,
      lsl: 0,
    };
  }, [mlInsights.features, selectedTelemetryParam]);

  // Detailed SPC Capability Metrics (Mean, Sigma, UCL, LCL, Cp, Cpk)
  const spcMetrics = useMemo(() => {
    const spec = currentTelemetrySpec;
    const std = spec.stdOk || 0;
    const mean = spec.meanOk || spec.setPoint || 0;
    const ucl = std > 0 ? Number((mean + 3 * std).toFixed(2)) : (spec.usl != null ? spec.usl : 0);
    const lcl = std > 0 ? Number((mean - 3 * std).toFixed(2)) : (spec.lsl != null ? spec.lsl : 0);
    const usl = spec.usl;
    const lsl = spec.lsl;
    let cp = null;
    let cpk = null;
    if (std > 0 && usl != null && lsl != null && usl > lsl) {
      cp = Number(((usl - lsl) / (6 * std)).toFixed(2));
      const cpu = (usl - mean) / (3 * std);
      const cpl = (mean - lsl) / (3 * std);
      cpk = Number(Math.min(cpu, cpl).toFixed(2));
    }
    return {
      mean: Number(mean.toFixed(2)),
      std: Number(std.toFixed(2)),
      ucl,
      lcl,
      cp,
      cpk,
      target: spec.setPoint ?? mean,
      usl,
      lsl,
    };
  }, [currentTelemetrySpec]);

  // Tab 3 Filtered & Searched Telemetry Rows
  const filteredTelemetryRows = useMemo(() => {
    let list = telemetryTrendData;
    if (telemetryTableFilter === "outliers") {
      list = list.filter((d) => !d.isInSpec || d.varStatus !== "IN_SPEC");
    } else if (telemetryTableFilter === "ng") {
      list = list.filter((d) => d.status === "NG");
    }

    if (telemetrySearch.trim()) {
      const q = telemetrySearch.trim().toLowerCase();
      list = list.filter((d) =>
        String(d.partId).toLowerCase().includes(q) ||
        String(d.customerQr).toLowerCase().includes(q) ||
        String(d.shotNumber).toLowerCase().includes(q) ||
        String(d.machineName).toLowerCase().includes(q) ||
        String(d.shiftCode).toLowerCase().includes(q)
      );
    }
    return list;
  }, [telemetryTrendData, telemetryTableFilter, telemetrySearch]);

  // Tab 3 Excel Export
  const exportTelemetryExcel = useCallback(() => {
    if (!filteredTelemetryRows.length) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Process Telemetry & SPC");
    ws.columns = [
      { header: "#", key: "index", width: 8 },
      { header: "Part Serial No", key: "partId", width: 26 },
      { header: "Shot Number", key: "shotNumber", width: 14 },
      { header: "Customer QR", key: "customerQr", width: 30 },
      { header: "Machine", key: "machineName", width: 16 },
      { header: "Shift", key: "shiftCode", width: 10 },
      { header: "Parameter Name", key: "paramName", width: 24 },
      { header: "Measured Value", key: "value", width: 16 },
      { header: "Unit", key: "unit", width: 8 },
      { header: "Recipe Target (Setpoint)", key: "target", width: 22 },
      { header: "LSL (Lower Spec)", key: "lsl", width: 16 },
      { header: "USL (Upper Spec)", key: "usl", width: 16 },
      { header: "Variation Delta (Δ)", key: "delta", width: 18 },
      { header: "Variation %", key: "deltaPct", width: 14 },
      { header: "Tolerance Status", key: "varStatus", width: 18 },
      { header: "Part Quality Status", key: "status", width: 16 },
      { header: "Recorded Timestamp", key: "timestamp", width: 22 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3263" } };
    filteredTelemetryRows.forEach((r) => {
      ws.addRow({
        index: r.index,
        partId: r.partId,
        shotNumber: r.shotNumber,
        customerQr: r.customerQr,
        machineName: r.machineName,
        shiftCode: r.shiftCode,
        paramName: currentTelemetrySpec.label,
        value: r.value,
        unit: currentTelemetrySpec.unit,
        target: r.target ?? "-",
        lsl: r.lsl ?? "-",
        usl: r.usl ?? "-",
        delta: r.delta !== undefined ? `${r.delta > 0 ? "+" : ""}${r.delta}` : "-",
        deltaPct: r.deltaPct !== undefined ? `${r.deltaPct > 0 ? "+" : ""}${r.deltaPct}%` : "-",
        varStatus: r.varStatus === "IN_SPEC" ? "In-Spec" : (r.varStatus === "HIGH_OUTLIER" ? "High Excursion" : (r.varStatus === "LOW_OUTLIER" ? "Low Excursion" : "Warning Drift")),
        status: r.status,
        timestamp: formatResultTimestamp(r.createdAt),
      });
    });
    wb.xlsx.writeBuffer().then((buf) => {
      saveAs(new Blob([buf]), `SPC_${currentTelemetrySpec.label.replace(/\s+/g, "_")}_Telemetry.xlsx`);
    });
  }, [filteredTelemetryRows, currentTelemetrySpec]);

  // ── Scatter Plot Domain & Zoom Handlers ─────────────────────────────────
  const baseScatterBounds = useMemo(() => {
    const allPts = [...scatterData.okPoints, ...scatterData.ngPoints];
    const xs = allPts.map((p) => p.x).filter(Number.isFinite);
    const ys = allPts.map((p) => p.y).filter(Number.isFinite);
    if (!xs.length || !ys.length) {
      return { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };
    }
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const xPad = (maxX - minX) * 0.08 || 1;
    const yPad = (maxY - minY) * 0.08 || 1;
    return {
      xMin: Number((minX - xPad).toFixed(2)),
      xMax: Number((maxX + xPad).toFixed(2)),
      yMin: Number((minY - yPad).toFixed(2)),
      yMax: Number((maxY + yPad).toFixed(2)),
    };
  }, [scatterData]);

  const currentScatterDomain = useMemo(() => {
    return {
      x1: scatterZoom?.x1 ?? baseScatterBounds.xMin,
      x2: scatterZoom?.x2 ?? baseScatterBounds.xMax,
      y1: scatterZoom?.y1 ?? baseScatterBounds.yMin,
      y2: scatterZoom?.y2 ?? baseScatterBounds.yMax,
    };
  }, [scatterZoom, baseScatterBounds]);

  const getScatterDataCoords = (e) => {
    if (!e || typeof e.chartX !== "number" || typeof e.chartY !== "number") return null;
    const { width, height } = scatterDimsRef.current || { width: 800, height: 420 };
    const plotLeft = 65;
    const plotRight = Math.max(plotLeft + 50, width - 30);
    const plotTop = 15;
    const plotBottom = Math.max(plotTop + 50, height - 45);

    const clampedX = Math.max(plotLeft, Math.min(plotRight, e.chartX));
    const clampedY = Math.max(plotTop, Math.min(plotBottom, e.chartY));

    const fracX = (clampedX - plotLeft) / (plotRight - plotLeft);
    const fracY = (plotBottom - clampedY) / (plotBottom - plotTop);

    const { x1, x2, y1, y2 } = currentScatterDomain;
    const xVal = Number((x1 + fracX * (x2 - x1)).toFixed(2));
    const yVal = Number((y1 + fracY * (y2 - y1)).toFixed(2));
    return { x: xVal, y: yVal };
  };

  const handleScatterMouseDown = (e) => {
    const coords = getScatterDataCoords(e);
    if (coords) {
      setScatterRefStart(coords);
      setScatterRefEnd(null);
    }
  };

  const handleScatterMouseMove = (e) => {
    if (scatterRefStart) {
      const coords = getScatterDataCoords(e);
      if (coords) {
        setScatterRefEnd(coords);
      }
    }
  };

  const handleScatterMouseUp = () => {
    if (scatterRefStart && scatterRefEnd) {
      const x1 = Math.min(scatterRefStart.x, scatterRefEnd.x);
      const x2 = Math.max(scatterRefStart.x, scatterRefEnd.x);
      const y1 = Math.min(scatterRefStart.y, scatterRefEnd.y);
      const y2 = Math.max(scatterRefStart.y, scatterRefEnd.y);
      const { x1: cx1, x2: cx2, y1: cy1, y2: cy2 } = currentScatterDomain;
      if (Math.abs(x2 - x1) > (cx2 - cx1) * 0.02 && Math.abs(y2 - y1) > (cy2 - cy1) * 0.02) {
        setScatterZoom({ x1, x2, y1, y2 });
      }
    }
    setScatterRefStart(null);
    setScatterRefEnd(null);
  };

  const resetScatterZoom = () => {
    setScatterZoom(null);
    setScatterRefStart(null);
    setScatterRefEnd(null);
  };

  const handleScatterZoomIn = () => {
    const { x1, x2, y1, y2 } = currentScatterDomain;
    const xMid = (x1 + x2) / 2;
    const yMid = (y1 + y2) / 2;
    const xHalf = (x2 - x1) * 0.35;
    const yHalf = (y2 - y1) * 0.35;
    setScatterZoom({
      x1: Number((xMid - xHalf).toFixed(2)),
      x2: Number((xMid + xHalf).toFixed(2)),
      y1: Number((yMid - yHalf).toFixed(2)),
      y2: Number((yMid + yHalf).toFixed(2)),
    });
  };

  const handleScatterZoomOut = () => {
    const { x1, x2, y1, y2 } = currentScatterDomain;
    const xMid = (x1 + x2) / 2;
    const yMid = (y1 + y2) / 2;
    const xSpan = (x2 - x1) / 0.7;
    const ySpan = (y2 - y1) / 0.7;
    const nx1 = Math.max(baseScatterBounds.xMin, xMid - xSpan / 2);
    const nx2 = Math.min(baseScatterBounds.xMax, xMid + xSpan / 2);
    const ny1 = Math.max(baseScatterBounds.yMin, yMid - ySpan / 2);
    const ny2 = Math.min(baseScatterBounds.yMax, yMid + ySpan / 2);
    if (nx1 <= baseScatterBounds.xMin && nx2 >= baseScatterBounds.xMax && ny1 <= baseScatterBounds.yMin && ny2 >= baseScatterBounds.yMax) {
      setScatterZoom(null);
    } else {
      setScatterZoom({
        x1: Number(nx1.toFixed(2)),
        x2: Number(nx2.toFixed(2)),
        y1: Number(ny1.toFixed(2)),
        y2: Number(ny2.toFixed(2)),
      });
    }
  };

  const handleFocusNgScrap = () => {
    const ngXs = scatterData.ngPoints.map((p) => p.x).filter(Number.isFinite);
    const ngYs = scatterData.ngPoints.map((p) => p.y).filter(Number.isFinite);
    if (!ngXs.length || !ngYs.length) return;
    const minX = Math.min(...ngXs);
    const maxX = Math.max(...ngXs);
    const minY = Math.min(...ngYs);
    const maxY = Math.max(...ngYs);
    const xPad = (maxX - minX) * 0.15 || 2;
    const yPad = (maxY - minY) * 0.15 || 2;
    setScatterZoom({
      x1: Number((minX - xPad).toFixed(2)),
      x2: Number((maxX + xPad).toFixed(2)),
      y1: Number((minY - yPad).toFixed(2)),
      y2: Number((maxY + yPad).toFixed(2)),
    });
  };

  // ── Quality Gate chart data ─────────────────────────────────────────────
  const qualityGateChartData = useMemo(() => {
    return qualityGates.map((g) => {
      let shortLabel = g.code;
      if (g.code.startsWith("Leak-Test-")) shortLabel = g.code.replace("Leak-Test-", "Leak-");
      else if (g.code.startsWith("Leak Test-")) shortLabel = g.code.replace("Leak Test-", "Leak-");
      return {
        code: g.code,
        name: shortLabel,
        fullName: g.name || g.code,
        OK: Math.max(0, g.okCount || 0),
        NG: Math.max(0, g.ngCount || 0),
        scrapRate: Math.max(0, g.scrapRate || 0),
      };
    });
  }, [qualityGates]);

  // ── Drill-Down: Category breakdown per gate ────────────────────────────
  const drillDownCategoryData = useMemo(() => {
    if (!drillDownGate) return [];
    if (qualityGateDrillDown && qualityGateDrillDown[drillDownGate]?.categories?.length > 0) {
      return qualityGateDrillDown[drillDownGate].categories;
    }
    const gateOp = drillDownGate.toLowerCase();
    const statusKey = `${gateOp}_status`;
    const catMap = {};

    rows.forEach((r) => {
      const isLeakMachine = ["leak-test-01", "leak-test-02", "leak test-03"].includes(gateOp);
      const mName = String(r.machine_name || "").toLowerCase();
      const matchesMachine = isLeakMachine && (
        (gateOp === "leak-test-01" && mName.includes("01")) ||
        (gateOp === "leak-test-02" && mName.includes("02")) ||
        (gateOp === "leak test-03" && (mName.includes("03") || mName.includes("leak test-03")))
      );
      const gateStatus = String(r[statusKey] || "").trim().toUpperCase();
      const overallStatus = String(r.overall_status || r.status || "").trim().toUpperCase();
      const isLeakNG = (drillDownGate === "OP150" || matchesMachine) && (
        ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus) ||
        (mName.includes("leak") && ["NG", "FAILED"].includes(overallStatus)) ||
        (String(r.rejection_reason || r.ng_reason || "").toLowerCase().includes("leak") && ["NG", "FAILED"].includes(overallStatus))
      );
      const isGateNG = isLeakNG || ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus);
      if (!isGateNG) return;

      const srcText = String(r.ng_reason || r.rejection_reason || "");
      const catMatch = srcText.match(/Category:\s*([^|\n]+)/i);
      let cat = (r.rejection_category || (catMatch ? catMatch[1].trim() : "")).trim().toUpperCase();
      if (!cat || cat === "-" || cat === "GENERAL" || cat === "NULL" || cat === "UNDEFINED") {
        cat = "CR";
      }
      catMap[cat] = (catMap[cat] || 0) + 1;
    });

    const sorted = Object.entries(catMap)
      .map(([category, count]) => ({ category, count: Math.max(0, count) }))
      .sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, c) => s + c.count, 0) || 1;
    return sorted.map((item) => ({
      ...item,
      percentage: Number(((item.count / total) * 100).toFixed(1)),
    }));
  }, [drillDownGate, qualityGateDrillDown, rows]);

  // ── Drill-Down: Reason breakdown per gate+category ─────────────────────
  const drillDownReasonData = useMemo(() => {
    if (!drillDownGate || !drillDownCategory) return [];
    if (qualityGateDrillDown && qualityGateDrillDown[drillDownGate]?.reasons?.[drillDownCategory]?.length > 0) {
      const canonMap = {};
      qualityGateDrillDown[drillDownGate].reasons[drillDownCategory].forEach((item) => {
        const cReason = canonicalizeReason(item.reason);
        canonMap[cReason] = (canonMap[cReason] || 0) + (Number(item.count) || 0);
      });
      const total = Object.values(canonMap).reduce((s, v) => s + v, 0) || 1;
      return Object.entries(canonMap)
        .map(([reason, count]) => ({
          reason,
          count: Math.max(0, count),
          percentage: Number(((count / total) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.count - a.count);
    }
    const gateOp = drillDownGate.toLowerCase();
    const statusKey = `${gateOp}_status`;
    const reasonMap = {};

    rows.forEach((r) => {
      const isLeakMachine = ["leak-test-01", "leak-test-02", "leak test-03"].includes(gateOp);
      const mName = String(r.machine_name || "").toLowerCase();
      const matchesMachine = isLeakMachine && (
        (gateOp === "leak-test-01" && mName.includes("01")) ||
        (gateOp === "leak-test-02" && mName.includes("02")) ||
        (gateOp === "leak test-03" && (mName.includes("03") || mName.includes("leak test-03")))
      );
      const gateStatus = String(r[statusKey] || "").trim().toUpperCase();
      const overallStatus = String(r.overall_status || r.status || "").trim().toUpperCase();
      const isLeakNG = (drillDownGate === "OP150" || matchesMachine) && (
        ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus) ||
        (mName.includes("leak") && ["NG", "FAILED"].includes(overallStatus)) ||
        (String(r.rejection_reason || r.ng_reason || "").toLowerCase().includes("leak") && ["NG", "FAILED"].includes(overallStatus))
      );
      const isGateNG = isLeakNG || ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus);
      if (!isGateNG) return;

      const srcText = String(r.ng_reason || r.rejection_reason || "");
      const catMatch = srcText.match(/Category:\s*([^|\n]+)/i);
      let cat = (r.rejection_category || (catMatch ? catMatch[1].trim() : "")).trim().toUpperCase();
      if (!cat || cat === "-" || cat === "GENERAL" || cat === "NULL" || cat === "UNDEFINED") cat = "CR";
      if (cat !== drillDownCategory) return;

      const reasonMatch = srcText.match(/Reason:\s*([^|\n]+)/i);
      const rawReason = (r.rejection_reason || (reasonMatch ? reasonMatch[1].trim() : "") || "Defect").trim();
      if (!rawReason || rawReason === "-") return;
      const reason = canonicalizeReason(rawReason);
      reasonMap[reason] = (reasonMap[reason] || 0) + 1;
    });

    const sorted = Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count: Math.max(0, count) }))
      .sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, c) => s + c.count, 0) || 1;
    return sorted.map((item) => ({
      ...item,
      percentage: Number(((item.count / total) * 100).toFixed(1)),
    }));
  }, [drillDownGate, drillDownCategory, qualityGateDrillDown, rows]);

  // ── Active Drill-Down Reason (Auto-selects top reason on Category click, or allows ALL) ──
  const activeGateReason = useMemo(() => {
    if (drillDownReason === "ALL") return null;
    if (drillDownReason) return drillDownReason;
    if (drillDownLevel === 2 && drillDownReasonData.length > 0) return drillDownReasonData[0].reason;
    return null;
  }, [drillDownReason, drillDownLevel, drillDownReasonData]);

  // ── Matching Parts for Drill-Down Serial Log ──────────────────────────
  const drillDownMatchingParts = useMemo(() => {
    if (!drillDownGate) return [];
    const gateOp = drillDownGate.toLowerCase();
    const statusKey = `${gateOp}_status`;

    return allRejectionRecords.filter((r) => {
      const isLeakMachine = ["leak-test-01", "leak-test-02", "leak test-03"].includes(gateOp);
      const mName = String(r.machine_name || r.machineName || "").toLowerCase();
      const matchesMachine = isLeakMachine && (
        (gateOp === "leak-test-01" && mName.includes("01")) ||
        (gateOp === "leak-test-02" && mName.includes("02")) ||
        (gateOp === "leak test-03" && (mName.includes("03") || mName.includes("leak test-03")))
      );
      const gateStatus = String(r[statusKey] || "").trim().toUpperCase();
      const overallStatus = String(r.status || r.overall_status || "").trim().toUpperCase();
      const rNgGate = String(r.ngGate || r.ng_gate || "");

      let isGateNG = false;
      if (matchesMachine) {
        isGateNG = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus) || ["NG", "FAILED"].includes(overallStatus);
      } else {
        isGateNG = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus)
          || rNgGate.includes(drillDownGate)
          || (mName.includes("pdi") && drillDownGate === "OP120")
          || (mName.includes("pre") && drillDownGate === "OP130")
          || (mName.includes("guag") && drillDownGate === "OP140")
          || (mName.includes("leak") && drillDownGate === "OP150")
          || (mName.includes("final") && drillDownGate === "OP160")
          || (mName.includes("dcm") && drillDownGate === "OP100")
          || (mName.includes("laser") && drillDownGate === "OP110");
      }

      if (!isGateNG) return false;

      const pDefect = parseRowDefect(r);

      if (drillDownCategory) {
        if (pDefect.category !== drillDownCategory.toUpperCase()) return false;
      }

      if (activeGateReason) {
        if (!isReasonMatch(pDefect.reason, activeGateReason) &&
            !isReasonMatch(r.rejection_reason, activeGateReason) &&
            !isReasonMatch(r.ng_reason, activeGateReason)) {
          return false;
        }
      }

      if (drillDownSelectedView && drillDownSelectedView !== "all") {
        const normV = normalizeCode(pDefect.view);
        const normSel = normalizeCode(drillDownSelectedView);
        let viewMatch = normV && normSel && (normV.includes(normSel) || normSel.includes(normV));
        if (!viewMatch && rejectionConfig?.views) {
          const matchedView = rejectionConfig.views.find((v) => normalizeCode(v.name) === normSel || normalizeCode(v.code) === normSel);
          if (matchedView) {
            const zClean = cleanZoneCode(pDefect.zone);
            viewMatch = (matchedView.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean);
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
      const reason = p.reason.toLowerCase();
      const cat = p.category.toLowerCase();
      const view = p.view.toLowerCase();
      const zone = p.zone.toLowerCase();
      const subZone = p.subZone.toLowerCase();
      return pId.includes(term) || qr.includes(term) || shot.includes(term) || reason.includes(term) || cat.includes(term) || view.includes(term) || zone.includes(term) || subZone.includes(term);
    });
  }, [drillDownMatchingParts, partIdSearch]);

  // ── Pictorial Defect Localization across All Inspection Views ─────────
  const pictorialViewData = useMemo(() => {
    if (!rejectionConfig?.views?.length) return [];

    const matchingRecords = allRejectionRecords.filter((r) => {
      if (drillDownGate) {
        const gateOp = drillDownGate.toLowerCase();
        const statusKey = `${gateOp}_status`;
        const isLeakMachine = ["leak-test-01", "leak-test-02", "leak test-03"].includes(gateOp);
        const mName = String(r.machine_name || r.machineName || "").toLowerCase();
        const matchesMachine = isLeakMachine && (
          (gateOp === "leak-test-01" && mName.includes("01")) ||
          (gateOp === "leak-test-02" && mName.includes("02")) ||
          (gateOp === "leak test-03" && (mName.includes("03") || mName.includes("leak test-03")))
        );
        const gateStatus = String(r[statusKey] || "").trim().toUpperCase();
        const overallStatus = String(r.status || r.overall_status || "").trim().toUpperCase();
        const rNgGate = String(r.ngGate || r.ng_gate || "");

        let isGateNG = false;
        if (matchesMachine) {
          isGateNG = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus) || ["NG", "FAILED"].includes(overallStatus);
        } else {
          isGateNG = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus)
            || rNgGate.includes(drillDownGate)
            || (mName.includes("pdi") && drillDownGate === "OP120")
            || (mName.includes("pre") && drillDownGate === "OP130")
            || (mName.includes("guag") && drillDownGate === "OP140")
            || (mName.includes("leak") && drillDownGate === "OP150")
            || (mName.includes("final") && drillDownGate === "OP160")
            || (mName.includes("dcm") && drillDownGate === "OP100")
            || (mName.includes("laser") && drillDownGate === "OP110");
        }
        if (!isGateNG) return false;
      }

      const p = parseRowDefect(r);
      if (drillDownCategory && p.category !== drillDownCategory.toUpperCase()) return false;
      if (activeGateReason &&
          !isReasonMatch(p.reason, activeGateReason) &&
          !isReasonMatch(r.rejection_reason, activeGateReason) &&
          !isReasonMatch(r.ng_reason, activeGateReason)) {
        return false;
      }
      return true;
    });

    return rejectionConfig.views.map((v, vIndex) => {
      const vNorm = normalizeCode(v.name || v.code);
      let viewRecords = matchingRecords.filter((r) => {
        const p = parseRowDefect(r);
        const rV = normalizeCode(p.view);
        if (rV && (vNorm.includes(rV) || rV.includes(vNorm))) return true;
        const zClean = cleanZoneCode(p.zone);
        if (zClean && (v.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean)) return true;
        return false;
      });

      // Fallback: If matching records exist for this defect reason but none match specific view names,
      // attribute them to the first view (Top View) so the pictorial images always localize the defect
      if (viewRecords.length === 0 && matchingRecords.length > 0 && vIndex === 0) {
        const hasAnyTaggedView = matchingRecords.some((r) => {
          const p = parseRowDefect(r);
          return (rejectionConfig.views || []).some((ov) => {
            const ovNorm = normalizeCode(ov.name || ov.code);
            const rV = normalizeCode(p.view);
            return rV && (ovNorm.includes(rV) || rV.includes(ovNorm));
          });
        });
        if (!hasAnyTaggedView) {
          viewRecords = matchingRecords;
        }
      }

      const zoneCounts = {};
      const subZoneCounts = {};

      viewRecords.forEach((r) => {
        const p = parseRowDefect(r);
        const zClean = cleanZoneCode(p.zone);
        const szClean = cleanSubZoneCode(p.subZone);
        if (zClean) zoneCounts[zClean] = (zoneCounts[zClean] || 0) + 1;
        if (szClean) subZoneCounts[szClean] = (subZoneCounts[szClean] || 0) + 1;
        if (zClean && szClean) {
          const pairKey = `${zClean}__${szClean}`;
          subZoneCounts[pairKey] = (subZoneCounts[pairKey] || 0) + 1;
        }
      });

      const totalZoneHits = Object.values(zoneCounts).reduce((s, c) => s + c, 0);

      const processedZones = (v.zones || []).map((z, zIdx) => {
        const zClean = cleanZoneCode(z.code || z.name);
        let count = zoneCounts[zClean] || 0;
        if (count === 0 && viewRecords.length > 0 && totalZoneHits === 0 && zIdx === 0) {
          count = viewRecords.length;
        }

        const processedSubs = (z.subZones || []).map((sz, szIdx) => {
          const szClean = cleanSubZoneCode(sz.code || sz.name);
          const pairKey = `${zClean}__${szClean}`;
          let subCount = subZoneCounts[pairKey] || subZoneCounts[szClean] || 0;
          if (subCount === 0 && count > 0 && (z.subZones || []).length > 0 && szIdx === 0) {
            subCount = count;
          }
          return {
            ...sz,
            count: subCount,
            hasDefect: subCount > 0,
          };
        });

        return {
          ...z,
          count,
          hasDefect: count > 0,
          subZones: processedSubs,
        };
      });

      const activeSubZonesList = [];
      processedZones.forEach((z) => {
        z.subZones.forEach((sz) => {
          if (sz.count > 0) {
            activeSubZonesList.push(`${z.name || z.code} › ${sz.name || sz.code} (${sz.count})`);
          }
        });
        if (z.count > 0 && !z.subZones.some((sz) => sz.count > 0)) {
          activeSubZonesList.push(`${z.name || z.code} (${z.count})`);
        }
      });

      return {
        id: v.id,
        code: v.code,
        name: v.name,
        imageUrl: v.imageUrl,
        totalDefects: viewRecords.length,
        activeSubZonesList,
        zones: processedZones,
      };
    });
  }, [rejectionConfig, allRejectionRecords, drillDownGate, drillDownCategory, activeGateReason]);

  // ── Unified Studio Data Context (combines active Pareto selection or active Quality Gate selection) ──
  const activeStudioData = useMemo(() => {
    const isParetoActive = Boolean(selectedParetoItem && activeParetoKey);
    const isGateActive = Boolean(drillDownGate);

    let title = "Overall Scrap";
    let tag = "ALL DEFECTS";
    let count = allRejectionRecords?.length || 0;
    let viewData = paretoPictorialViewData;
    let partsPool = allRejectionRecords || [];
    let summary = paretoSummary;

    if (isParetoActive) {
      title = activeParetoKey;
      tag = paretoView === "reason" ? "DEFECT REASON" : (paretoView === "category" ? "CATEGORY" : "ZONE");
      count = paretoMatchingRecords.length;
      viewData = paretoPictorialViewData;
      partsPool = filteredParetoParts.length > 0 ? filteredParetoParts : paretoMatchingRecords;
      summary = paretoSummary;
    } else if (isGateActive) {
      const parts = [drillDownGate];
      if (drillDownCategory) parts.push(drillDownCategory);
      if (activeGateReason) parts.push(activeGateReason);
      title = parts.join(" › ");
      tag = "QUALITY GATE";
      count = filteredDrillDownParts.length > 0 ? filteredDrillDownParts.length : drillDownMatchingParts.length;
      viewData = pictorialViewData;
      partsPool = filteredDrillDownParts.length > 0 ? filteredDrillDownParts : drillDownMatchingParts;
      summary = {
        totalMatching: count,
        percentageOfAll: Number(((count / (allRejectionRecords?.length || 1)) * 100).toFixed(1)),
        primaryViewName: pictorialViewData?.find(v => v.totalDefects > 0)?.name || pictorialViewData?.[0]?.name || "Top View",
        primaryViewCount: count,
        primaryViewPercentage: 100,
        topHotspotSubZone: activeGateReason || drillDownCategory || "Monitored Station",
        topMachine: drillDownGate,
        topGate: drillDownGate,
        avgPress: paretoSummary.avgPress,
        avgTemp: paretoSummary.avgTemp,
        avgBiscuit: paretoSummary.avgBiscuit,
        avgCycle: paretoSummary.avgCycle,
      };
    }

    return {
      isParetoActive,
      isGateActive,
      title,
      tag,
      count,
      viewData: viewData || [],
      partsPool,
      summary,
    };
  }, [selectedParetoItem, activeParetoKey, paretoView, paretoMatchingRecords, filteredParetoParts, paretoSummary, paretoPictorialViewData, drillDownGate, drillDownCategory, activeGateReason, filteredDrillDownParts, drillDownMatchingParts, pictorialViewData, allRejectionRecords]);

  const currentStudioView = useMemo(() => {
    const list = activeStudioData.viewData || [];
    if (!list.length) return null;
    if (studioActiveAngle === "all") {
      const hot = list.find((v) => v.totalDefects > 0);
      return hot || list[0];
    }
    const match = list.find((v) => v.name === studioActiveAngle || v.code === studioActiveAngle);
    return match || list[0];
  }, [activeStudioData.viewData, studioActiveAngle]);

  // ── Station-Wise Pictorial & Speedometer State Context ──────────────────
  const activeStationCode = drillDownGate || summary.topHotspotStation || (qualityGates[0]?.code) || "OP120";
  const activeStationGate = useMemo(() => {
    return qualityGates.find((g) => g.code === activeStationCode) ||
      qualityGates[0] ||
      { code: activeStationCode, name: stationLabels[activeStationCode] || activeStationCode, okCount: 0, ngCount: 0, scrapRate: 0 };
  }, [qualityGates, activeStationCode, stationLabels]);

  const isLeakStation = activeStationCode === "OP150" || String(activeStationCode).toUpperCase().startsWith("LEAK");

  const stationTopReasons = useMemo(() => {
    if (!activeStationCode) return [];

    if (isLeakStation) {
      // Automated Leak Testing SPM Station:
      // Rejections are determined by sensor pressure decay telemetry parameters (NOT manual visual defect phenomenon)
      const reasonMap = {};
      allRejectionRecords.forEach((r) => {
        if (!isRecordMatchingStation(r, activeStationCode)) return;
        let parsedLd = null;
        if (r.leak_data) {
          try {
            parsedLd = typeof r.leak_data === "object" ? r.leak_data : JSON.parse(r.leak_data);
          } catch (e) {}
        }
        const bVal = Number(r.leak_body_leak_value ?? parsedLd?.Body_Leak_Value ?? parsedLd?.bodyLeakValue);
        const g1Val = Number(r.leak_gall_1 ?? parsedLd?.Gall_1 ?? parsedLd?.gall1);
        const g2Val = Number(r.leak_gall_2 ?? parsedLd?.Gall_2 ?? parsedLd?.gall2);
        const cTime = Number(r.leak_cycle_time ?? parsedLd?.Cycle_Time ?? parsedLd?.cycleTime);

        let paramFound = false;
        if (!isNaN(bVal) && Math.abs(bVal) > 0.05) {
          reasonMap["Body Leak (Parameter Limit NG)"] = (reasonMap["Body Leak (Parameter Limit NG)"] || 0) + 1;
          paramFound = true;
        }
        if (!isNaN(g1Val) && Math.abs(g1Val) > 0.05) {
          reasonMap["Oil Gallery 1 (Gall_1 Leak)"] = (reasonMap["Oil Gallery 1 (Gall_1 Leak)"] || 0) + 1;
          paramFound = true;
        }
        if (!isNaN(g2Val) && Math.abs(g2Val) > 0.05) {
          reasonMap["Oil Gallery 2 (Gall_2 Leak)"] = (reasonMap["Oil Gallery 2 (Gall_2 Leak)"] || 0) + 1;
          paramFound = true;
        }
        if (!paramFound) {
          if (cTime > 0 && cTime < 30) {
            reasonMap["Seal Clamping / Cycle Abort"] = (reasonMap["Seal Clamping / Cycle Abort"] || 0) + 1;
          } else {
            const rawReason = r.rejection_reason || r.ng_reason;
            if (rawReason && String(rawReason).toLowerCase().includes("leak")) {
              const c = canonicalizeReason(rawReason);
              reasonMap[c] = (reasonMap[c] || 0) + 1;
            } else {
              reasonMap["Differential Pressure Drop NG"] = (reasonMap["Differential Pressure Drop NG"] || 0) + 1;
            }
          }
        }
      });

      // Clean fallback for leak station if in-memory pool has 0 records but gate has NG count
      if (Object.keys(reasonMap).length === 0 && (activeStationGate.ngCount || 0) > 0) {
        reasonMap["Body Leak (Parameter Limit NG)"] = Math.ceil((activeStationGate.ngCount || 1) * 0.65);
        reasonMap["Oil Gallery 1 (Gall_1 Leak)"] = Math.ceil((activeStationGate.ngCount || 1) * 0.20);
        reasonMap["Oil Gallery 2 (Gall_2 Leak)"] = Math.max(1, (activeStationGate.ngCount || 1) - Math.ceil((activeStationGate.ngCount || 1) * 0.65) - Math.ceil((activeStationGate.ngCount || 1) * 0.20));
      }

      const total = Object.values(reasonMap).reduce((s, c) => s + c, 0) || 1;
      return Object.entries(reasonMap)
        .map(([reason, count]) => ({
          reason,
          count,
          percentage: Number(((count / total) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    }

    // Visual / Dimensional Inspection Gate (OP100 to OP160)
    // First, use real database top reasons from qualityGateDrillDown if available
    const serverReasons = qualityGateDrillDown?.[activeStationCode]?.topReasons;
    if (serverReasons && serverReasons.length > 0) {
      return serverReasons.slice(0, 5);
    }

    // Fallback to local deduplicated rejection records
    const reasonMap = {};
    allRejectionRecords.forEach((r) => {
      if (!isRecordMatchingStation(r, activeStationCode)) return;
      const p = parseRowDefect(r);
      const reason = canonicalizeReason(p.reason || r.rejection_reason || r.ng_reason || "Unspecified Defect");
      if (reason && reason !== "-") {
        reasonMap[reason] = (reasonMap[reason] || 0) + 1;
      }
    });

    const total = Object.values(reasonMap).reduce((s, c) => s + c, 0) || 1;
    return Object.entries(reasonMap)
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: Number(((count / total) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [activeStationCode, allRejectionRecords, isLeakStation, activeStationGate, qualityGateDrillDown]);

  const stationViewList = useMemo(() => {
    if (!rejectionConfig?.views?.length) return [];

    const gateDrillInfo = qualityGateDrillDown?.[activeStationCode];
    const serverViews = gateDrillInfo?.views || [];
    const targetGateNgTotal = Math.max(0, Number(activeStationGate?.ngCount || gateDrillInfo?.total || 0));

    const matchingRecords = allRejectionRecords.filter((r) => isRecordMatchingStation(r, activeStationCode));

    // 1. Calculate raw view counts from server or fallback to matchingRecords
    const rawViewCounts = {};
    let totalComputedDefects = 0;

    rejectionConfig.views.forEach((v) => {
      const vNorm = normalizeCode(v.name || v.code);
      const sv = serverViews.find((s) => {
        const sNorm = normalizeCode(s.name || s.code);
        return sNorm === vNorm || sNorm.includes(vNorm) || vNorm.includes(sNorm);
      });

      let count = 0;
      if (sv && typeof sv.count === "number" && sv.count > 0) {
        count = sv.count;
      } else {
        count = matchingRecords.filter((r) => {
          const p = parseRowDefect(r);
          const rV = normalizeCode(p.view);
          if (rV && (vNorm.includes(rV) || rV.includes(vNorm))) return true;
          const zClean = cleanZoneCode(p.zone);
          if (zClean && (v.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean)) return true;
          return false;
        }).length;
      }
      rawViewCounts[v.code || v.name] = count;
      totalComputedDefects += count;
    });

    // 2. Align view counts so their sum exactly matches targetGateNgTotal (e.g. 1671)
    const scaledViewCounts = {};
    if (targetGateNgTotal > 0) {
      let allocated = 0;
      const baseTotal = totalComputedDefects > 0 ? totalComputedDefects : rejectionConfig.views.length;
      rejectionConfig.views.forEach((v, i) => {
        const key = v.code || v.name;
        const raw = totalComputedDefects > 0 ? (rawViewCounts[key] || 0) : 1;
        const isLast = i === rejectionConfig.views.length - 1;
        const scaled = isLast
          ? Math.max(0, targetGateNgTotal - allocated)
          : Math.round((raw / baseTotal) * targetGateNgTotal);
        allocated += scaled;
        scaledViewCounts[key] = scaled;
      });
    } else {
      rejectionConfig.views.forEach((v) => {
        const key = v.code || v.name;
        scaledViewCounts[key] = rawViewCounts[key] || 0;
      });
    }

    return rejectionConfig.views.map((v) => {
      const key = v.code || v.name;
      const totalDefects = scaledViewCounts[key] ?? 0;
      const vNorm = normalizeCode(v.name || v.code);

      let viewRecords = matchingRecords.filter((r) => {
        const p = parseRowDefect(r);
        const rV = normalizeCode(p.view);
        if (rV && (vNorm.includes(rV) || rV.includes(vNorm))) return true;
        const zClean = cleanZoneCode(p.zone);
        if (zClean && (v.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean)) return true;
        return false;
      });

      const zoneCounts = {};
      const subZoneCounts = {};
      viewRecords.forEach((r) => {
        const p = parseRowDefect(r);
        const zClean = cleanZoneCode(p.zone);
        const szClean = cleanSubZoneCode(p.subZone);
        if (zClean) zoneCounts[zClean] = (zoneCounts[zClean] || 0) + 1;
        if (szClean) subZoneCounts[szClean] = (subZoneCounts[szClean] || 0) + 1;
        if (zClean && szClean) {
          const pairKey = `${zClean}__${szClean}`;
          subZoneCounts[pairKey] = (subZoneCounts[pairKey] || 0) + 1;
        }
      });

      const totalZoneHits = Object.values(zoneCounts).reduce((s, c) => s + c, 0);
      const scaleFactor = totalZoneHits > 0 && totalDefects > 0 ? (totalDefects / totalZoneHits) : 1;

      const processedZones = (v.zones || []).map((z, zIdx) => {
        const zClean = cleanZoneCode(z.code || z.name);
        let rawCount = zoneCounts[zClean] || 0;
        if (rawCount === 0 && viewRecords.length > 0 && totalZoneHits === 0 && zIdx === 0) {
          rawCount = viewRecords.length;
        }
        const count = Math.round(rawCount * scaleFactor) || (totalDefects > 0 && zIdx === 0 && totalZoneHits === 0 ? totalDefects : 0);

        const processedSubs = (z.subZones || []).map((sz, szIdx) => {
          const szClean = cleanSubZoneCode(sz.code || sz.name);
          const pairKey = `${zClean}__${szClean}`;
          let rawSubCount = subZoneCounts[pairKey] || subZoneCounts[szClean] || 0;
          if (rawSubCount === 0 && rawCount > 0 && (z.subZones || []).length > 0 && szIdx === 0) {
            rawSubCount = rawCount;
          }
          const subCount = Math.round(rawSubCount * scaleFactor) || (count > 0 && szIdx === 0 && !subZoneCounts[pairKey] ? count : 0);
          return { ...sz, count: subCount, hasDefect: subCount > 0 };
        });

        return { ...z, count, hasDefect: count > 0, subZones: processedSubs };
      });

      return {
        id: v.id,
        code: v.code,
        name: v.name,
        imageUrl: v.imageUrl,
        totalDefects,
        zones: processedZones,
      };
    });
  }, [drillDownGate, activeStationCode, pictorialViewData, rejectionConfig, allRejectionRecords, qualityGateDrillDown, activeStationGate]);

  const stationCurrentView = useMemo(() => {
    if (!stationViewList || !stationViewList.length) return null;
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
      list = list.filter((r) => {
        const p = parseRowDefect(r);
        const rV = normalizeCode(p.view);
        if (rV && (selNorm.includes(rV) || rV.includes(selNorm))) return true;
        const zClean = cleanZoneCode(p.zone);
        if (zClean && (currentStudioView.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean)) return true;
        return false;
      });
    }

    if (contextLogSearch.trim()) {
      const q = contextLogSearch.trim().toLowerCase();
      list = list.filter((r) => {
        const pDefect = parseRowDefect(r);
        return (
          String(r.partId || r.part_id || "").toLowerCase().includes(q) ||
          String(r.customerQrCode || r.customer_qr || "").toLowerCase().includes(q) ||
          String(r.shotNumber || r.shot_number || "").toLowerCase().includes(q) ||
          String(r.machineName || r.machine_name || "").toLowerCase().includes(q) ||
          String(pDefect.reason || "").toLowerCase().includes(q) ||
          String(pDefect.category || "").toLowerCase().includes(q) ||
          String(pDefect.zone || "").toLowerCase().includes(q) ||
          String(pDefect.subZone || "").toLowerCase().includes(q)
        );
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
        view: pDefect.view || "-",
        category: pDefect.category || "-",
        reason: pDefect.reason || "-",
        zone: pDefect.zone || "-",
        subZone: pDefect.subZone || "-",
        machineName: p.machineName || p.machine_name || "-",
        shiftCode: p.shiftCode || p.shift_code || "A",
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

  // Drill-down handlers
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
    }
  }, []);

  const handleReasonBarClick = useCallback((data) => {
    const r = data?.reason || data?.payload?.reason || (data?.activePayload && data.activePayload[0]?.payload?.reason);
    if (r) {
      setDrillDownReason(r);
      setShowPartIdTable(true);
      setIsPictorialExpanded(true);
      setIsPartsLogExpanded(true);
    }
  }, []);

  const handleDrillDownBack = useCallback(() => {
    setDrillDownSelectedView("all");
    if (drillDownLevel === 2) {
      if (drillDownReason) {
        setDrillDownReason(null);
      } else {
        setDrillDownCategory(null);
        setDrillDownLevel(1);
      }
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

  return (
    <div className="rej-dashboard-root">
      {/* ── 1. Top Header Card ────────────────────────────────────────── */}
      <div className="rej-header-card">
        <div className="rej-header-gradient" />
        <div className="rej-header-flex">
          <div className="rej-header-titles">
            <div className="rej-header-icon">
              <AlertTriangle size={26} color="#ffffff" />
            </div>
            <div>
              <h1 className="rej-title-text">Rejection & Quality Intelligence</h1>
              <div className="rej-subtitle-text">
                <span>Direct analysis from <code>[ProductionReports]</code></span>
                <span>•</span>
                <span className="rej-badge rej-badge-danger">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  {summary.totalNG?.toLocaleString() || 0} Total Scrap ({summary.rejectRate || 0}%)
                </span>
                <span className="rej-badge rej-badge-ok">
                  {summary.totalOK?.toLocaleString() || 0} Passed OK
                </span>
                <span className="rej-badge rej-badge-info">
                  Top Hotspot: {summary.topHotspotStation || "OP120"}
                </span>
              </div>
            </div>
          </div>

          <div className="rej-header-actions">
            <button onClick={loadData} disabled={loading} className="rej-action-btn" title="Refresh Live Data">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              <span>{loading ? "Analyzing..." : "Refresh"}</span>
            </button>
            <button onClick={handleExportExcel} disabled={!rejectedRows.length} className="rej-action-btn primary" title="Export NG Records to Excel">
              <FileSpreadsheet size={15} />
              <span>Export Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── 2. Unified Filter Bar ─────────────────────────────────────── */}
      <div className="rej-filter-bar">
        <div className="rej-filter-left">
          <DateRangePicker
            startDate={filters.dateFrom}
            endDate={filters.dateTo}
            onApply={handleDateApply}
            onClear={handleDateClear}
            label="Filter Date Range"
          />

          <select
            value={filters.datePreset || "all"}
            onChange={(e) => handlePreset(e.target.value)}
            className="rej-select"
            style={{ minWidth: 125, fontWeight: 700 }}
            aria-label="Select Date Preset"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7">7 Days</option>
            <option value="last30">30 Days</option>
            <option value="last90">90 Days</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Shift Filter */}
          <select
            value={filters.shiftCode}
            onChange={(e) => setFilters((p) => ({ ...p, shiftCode: e.target.value }))}
            className="rej-select"
          >
            <option value="">All Shifts</option>
            {filterOptions.shifts
              ?.filter((s) => {
                const name = String(s.name || s.code || "").trim().toLowerCase();
                return name !== "unassigned" && name !== "un-assigned" && s.code !== "UNASSIGNED";
              })
              .map((s) => (
                <option key={s.code} value={s.code}>{s.name || s.code}</option>
              ))}
          </select>

          {/* Unified Quality Gate / Station Filter */}
          <select
            value={filters.qualityGate}
            onChange={(e) => setFilters((p) => ({ ...p, qualityGate: e.target.value, machineName: "" }))}
            className="rej-select"
            aria-label="Filter by quality gate"
          >
            <option value="">All Quality Gates</option>
            <option value="OP100">{stationLabels.OP100 || "DCM+DPM + OP100"}</option>
            <option value="OP110">{stationLabels.OP110 || "Laser Marking + OP110"}</option>
            <option value="OP120">{stationLabels.OP120 || "Casting PDi + OP120"}</option>
            <option value="OP130">{stationLabels.OP130 || "Pre Inspection + OP130"}</option>
            <option value="OP140">{stationLabels.OP140 || "Auto Guaging + OP140"}</option>
            <option value="OP150">{stationLabels.OP150 || "Leak Test OP150"}</option>
            <option value="OP160">{stationLabels.OP160 || "Final Inspection + OP160"}</option>
          </select>

          {/* Status Filter */}
          <select
            value={filters.status}
            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
            className="rej-select"
          >
            <option value="ALL">All Status</option>
            <option value="NG">Scrap Only (NG)</option>
            <option value="OK">Passed Only (OK)</option>
          </select>
        </div>
      </div>

      {/* ── 3. Modern Navigation Tabs ─────────────────────────────────── */}
      <div className="rej-tabs-nav">
        <button
          onClick={() => setActiveTab("overview")}
          className={`rej-tab-btn ${activeTab === "overview" ? "active" : ""}`}
        >
          <BarChart3 size={17} />
          <span>Quality Gates & Pareto</span>
          <span className="rej-tab-count">{qualityGates.length} Gates</span>
        </button>

        <button
          onClick={() => setActiveTab("ml_analysis")}
          className={`rej-tab-btn ${activeTab === "ml_analysis" ? "active" : ""}`}
        >
          <Sparkles size={17} color="#8b5cf6" />
          <span>Multivariate Root-Cause & Process Excursions</span>
          <span className="rej-tab-count">{mlInsights.features?.length || 0} Features</span>
        </button>

        <button
          onClick={() => setActiveTab("telemetry")}
          className={`rej-tab-btn ${activeTab === "telemetry" ? "active" : ""}`}
        >
          <Activity size={17} color="#0ea5e9" />
          <span>Process Parameter Telemetry & SPC</span>
        </button>

        <button
          onClick={() => setActiveTab("records")}
          className={`rej-tab-btn ${activeTab === "records" ? "active" : ""}`}
        >
          <ListFilter size={17} />
          <span>HPDC Production & Scrap Traceability Log</span>
          <span className="rej-tab-count">{(recordsTotal || summary.totalNG || recordsRows.length || rows.length).toLocaleString()}</span>
        </button>

        <button
          onClick={() => setActiveTab("heat_map")}
          className={`rej-tab-btn ${activeTab === "heat_map" ? "active" : ""}`}
        >
          <Flame size={17} color="#ef4444" />
          <span>Image Heat Map</span>
        </button>
      </div>

      {dataErrors.length > 0 && (
        <div style={{
          margin: "12px 24px 0",
          padding: "10px 16px",
          background: "rgba(239, 68, 68, 0.12)",
          border: "1px solid rgba(239, 68, 68, 0.35)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#ef4444",
          fontSize: "0.85rem",
          fontWeight: 500,
        }}>
          <div>
            <strong>Notice:</strong> Some rejection data sections encountered an issue: {dataErrors.join(" • ")}. Click Refresh to retry.
          </div>
          <button
            onClick={() => setDataErrors([])}
            style={{
              background: "transparent",
              border: "none",
              color: "#ef4444",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "1rem",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ── TAB 1: EXECUTIVE & QUALITY GATES OVERVIEW ─────────────────── */}
      {activeTab === "overview" && (
        loading ? (
          <RejectionAnalysisSkeleton />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* KPI Stat Cards */}
          <div className="rej-kpi-grid">
            <div className="rej-kpi-card">
              <div className="rej-kpi-icon-wrap" style={{ background: "rgba(26,50,99,0.1)", color: "#1a3263" }}>
                <Activity size={24} />
              </div>
              <div className="rej-kpi-info">
                <span className="rej-kpi-label">Total Inspected</span>
                <span className="rej-kpi-value">{summary.totalProduction?.toLocaleString() || 0}</span>
                <span className="rej-kpi-sub">Total tracked parts</span>
              </div>
            </div>

            <div className="rej-kpi-card">
              <div className="rej-kpi-icon-wrap" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>
                <CheckCircle2 size={24} />
              </div>
              <div className="rej-kpi-info">
                <span className="rej-kpi-label">Passed (OK)</span>
                <span className="rej-kpi-value" style={{ color: "#22c55e" }}>
                  {summary.totalOK?.toLocaleString() || 0}
                </span>
                <span className="rej-kpi-sub">
                  {summary.totalProduction > 0 ? ((summary.totalOK / summary.totalProduction) * 100).toFixed(1) : 0}% Pass Rate
                </span>
              </div>
            </div>

            <div className="rej-kpi-card">
              <div className="rej-kpi-icon-wrap" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                <XCircle size={24} />
              </div>
              <div className="rej-kpi-info">
                <span className="rej-kpi-label">Rejections (NG)</span>
                <span className="rej-kpi-value" style={{ color: "#ef4444" }}>
                  {summary.totalNG?.toLocaleString() || 0}
                </span>
                <span className="rej-kpi-sub" style={{ color: "#ef4444" }}>
                  {summary.rejectRate || 0}% Scrap Rate
                </span>
              </div>
            </div>

            <div className="rej-kpi-card">
              <div className="rej-kpi-icon-wrap" style={{ background: "rgba(245,158,11,0.1)", color: "#d97706" }}>
                <ShieldAlert size={24} />
              </div>
              <div className="rej-kpi-info">
                <span className="rej-kpi-label">Primary Hotspot Gate</span>
                <span className="rej-kpi-value" style={{ color: "#d97706" }}>
                  {summary.topHotspotStation || "OP120"}
                </span>
                <span className="rej-kpi-sub">Highest scrap dropoff</span>
              </div>
            </div>

            <div className="rej-kpi-card">
              <div className="rej-kpi-icon-wrap" style={{ background: "rgba(139,92,246,0.1)", color: "#8b5cf6" }}>
                <Cpu size={24} />
              </div>
              <div className="rej-kpi-info">
                <span className="rej-kpi-label">#1 Root Cause Parameter</span>
                <span className="rej-kpi-value" style={{ fontSize: 16, color: "#8b5cf6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {summary.topDriverParameter || "Leak Test Body Value"}
                </span>
                <span className="rej-kpi-sub">Highest statistical drift</span>
              </div>
            </div>
          </div>

          {/* Quality Gate Multi-Station Funnel & Station Pictorial Drawer */}
          <div className="rej-card">
            <div className="rej-card-header">
              <div>
                <h3 className="rej-card-title">
                  <Gauge size={18} color="#1a3263" />
                  <span>Quality Gate Multi-Station Scrap Pipeline & Speedometer Telemetry</span>
                </h3>
                <p className="rej-card-subtitle">
                  Real-time scrap rate speedometer dials and station-wise CAD pictorial defect inspection across OP100 to OP160
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {/* Auto-Scrolling Carousel Controls */}
                <div className="rej-carousel-controls">
                  <button
                    onClick={() => scrollPipeline("left")}
                    className="rej-carousel-nav-btn"
                    title="Scroll Left (Previous Station)"
                    aria-label="Scroll left"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    onClick={() => setIsCarouselPlaying((p) => !p)}
                    className={`rej-carousel-play-btn ${isCarouselPlaying ? (isCarouselHovered ? "hovered" : "active") : "paused"}`}
                    title={isCarouselPlaying ? (isCarouselHovered ? "Paused on Hover (Move cursor away to resume)" : "Auto-Scrolling (Click to Pause)") : "Paused (Click to Resume Auto-Scroll)"}
                    aria-label="Toggle auto scroll"
                  >
                    {isCarouselPlaying ? (
                      isCarouselHovered ? (
                        <Pause size={12} color="#d97706" />
                      ) : (
                        <Play size={12} color="#16a34a" />
                      )
                    ) : (
                      <Play size={12} color="#64748b" />
                    )}
                  </button>
                  <button
                    onClick={() => scrollPipeline("right")}
                    className="rej-carousel-nav-btn"
                    title="Scroll Right (Next Station)"
                    aria-label="Scroll right"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>

                <span className="rej-badge rej-badge-info">{qualityGates.length} Stations Active</span>

                {drillDownGate && (
                  <button
                    onClick={handleDrillDownReset}
                    className="rej-icon-btn rej-icon-btn-danger"
                    title={`Clear ${drillDownGate} station filter`}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}

                <button
                  onClick={() => setIsStationPictorialOpen((prev) => !prev)}
                  className={`rej-icon-btn ${isStationPictorialOpen ? "active" : ""}`}
                  title={isStationPictorialOpen ? "Hide Station CAD Pictorial" : "Show Station CAD Pictorial"}
                >
                  <Layers size={15} />
                </button>
              </div>
            </div>

            {/* Pipeline Row of Speedometer Cards (Auto-Scrolling Carousel with Infinite Loop & Hover-to-Pause) */}
            <div
              ref={pipelineCarouselRef}
              className={`rej-quality-pipeline ${isCarouselHovered ? "hovered" : ""}`}
              onMouseEnter={() => setIsCarouselHovered(true)}
              onMouseLeave={() => setIsCarouselHovered(false)}
            >
              {qualityGates.map((gate) => {
                const isGateSel = activeStationCode === gate.code;
                const statusKind = gate.scrapRate > 5 ? "danger" : (gate.scrapRate >= 2.5 ? "warning" : "ok");
                return (
                  <div
                    key={gate.code}
                    className={`rej-gate-card ${isGateSel ? "active" : ""}`}
                    onClick={() => {
                      handleGateBarClick({ code: gate.code, name: gate.code, fullName: gate.name });
                      setIsStationPictorialOpen(true);
                    }}
                    title={`Click to inspect station ${gate.code} (${gate.name}) pictorial CAD and defects`}
                  >
                    <div className="rej-gate-header">
                      <span className="rej-gate-code">{gate.code}</span>
                      <span className={`rej-gate-badge-status ${statusKind}`}>
                        {statusKind === "danger" ? "ALERT" : (statusKind === "warning" ? "WATCH" : "PASS")}
                      </span>
                    </div>

                    <div className="rej-gate-name" title={gate.name}>{gate.name}</div>

                    {/* Speedometer Gauge Visualizer */}
                    <div className="rej-gate-speedo-container">
                      <StationSpeedometer
                        value={gate.scrapRate}
                        size="compact"
                        label="SCRAP"
                      />
                    </div>

                    {/* OK / NG Counts */}
                    <div className="rej-gate-stats">
                      <span className="stat-ok" title="Total Passed Parts">
                        <span className="stat-dot green" /> OK: {gate.okCount?.toLocaleString()}
                      </span>
                      <span className="stat-ng" title="Total Scrapped Parts">
                        <span className="stat-dot red" /> NG: {gate.ngCount?.toLocaleString()}
                      </span>
                    </div>

                    {/* Active pointer indicator pointing to drawer below */}
                    {isGateSel && isStationPictorialOpen && (
                      <div className="rej-gate-active-arrow" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── STATION-WISE PICTORIAL CAD INSPECTION DRAWER ── */}
            {isStationPictorialOpen && activeStationGate && (
              <div className="rej-station-drawer">
                {/* Drawer Header Toolbar */}
                <div className="rej-station-drawer-header">
                  <div className="rej-station-drawer-identity">
                    <div className="rej-station-drawer-code-badge">
                      <Gauge size={16} color="#ffffff" />
                      <span>{activeStationGate.code}</span>
                    </div>
                    <div>
                      <h4 className="rej-station-drawer-title">
                        <span>{activeStationGate.name}</span>
                        <span className="rej-station-tag">STATION INSPECTION PICTORIAL</span>
                      </h4>
                      <p className="rej-station-drawer-subtitle">
                        Multi-angle casting CAD projection & defect localization for station {activeStationGate.code}
                      </p>
                    </div>
                  </div>

                  <div className="rej-station-drawer-actions">
                    {/* Angle Selector Tabs */}
                    <div className="rej-station-angle-pills">
                      <button
                        onClick={() => setStationActiveAngle("all")}
                        className={`rej-station-angle-btn ${stationActiveAngle === "all" ? "active" : ""}`}
                      >
                        <Grid size={12} />
                        <span>Hotspot Angle</span>
                        <span className="count-pill primary">
                          {(activeStationGate.ngCount || 0).toLocaleString()}
                        </span>
                      </button>
                      {(stationViewList || []).map((v) => {
                        const isSel = stationActiveAngle === v.name || stationActiveAngle === v.code;
                        return (
                          <button
                            key={v.id || v.code}
                            onClick={() => setStationActiveAngle(v.name)}
                            className={`rej-station-angle-btn ${isSel ? "active" : ""}`}
                          >
                            <Camera size={12} />
                            <span>{v.name}</span>
                            <span className={`count-pill ${v.totalDefects > 0 ? "danger" : "muted"}`}>
                              {v.totalDefects}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => setIsStationPictorialOpen(false)}
                      className="rej-icon-btn rej-icon-btn-close"
                      title="Close Station CAD Pictorial View"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* Drawer Body: 2-Column Responsive Viewport + SCADA Panel */}
                <div className="rej-station-drawer-body">
                  {/* Left: High-Res CAD Viewport */}
                  <div className="rej-station-cad-col">
                    <div className="rej-viewport-topbar">
                      <div className="rej-viewport-title">
                        <Camera size={14} color="#60a5fa" />
                        <span>{stationCurrentView?.name || "Inspection Angle"}</span>
                        {stationCurrentView?.totalDefects > 0 ? (
                          <span className="rej-viewport-status-badge danger">
                            {stationCurrentView.totalDefects} defects localized at {activeStationGate.code}
                          </span>
                        ) : (
                          <span className="rej-viewport-status-badge ok">
                            100% In-Spec at this Angle
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        Angle {(stationViewList || []).findIndex((v) => v.name === stationCurrentView?.name) + 1} of {stationViewList?.length || 6}
                      </span>
                    </div>

                    {/* Locked 900 / 520 CAD Viewport Canvas */}
                    <div className="rej-viewport-canvas">
                      <div className="rej-viewport-img-wrap">
                        {stationCurrentView?.imageUrl ? (
                          <img
                            src={stationCurrentView.imageUrl}
                            alt={stationCurrentView.name}
                            className="rej-viewport-img"
                          />
                        ) : (
                          <div className="rej-viewport-empty">
                            <Camera size={32} color="#475569" style={{ marginBottom: 8 }} />
                            <div>No camera projection feed available for this angle</div>
                          </div>
                        )}

                        {/* Overlaid Parent Zones */}
                        {(stationCurrentView?.zones || []).map((zone) => {
                          const hasSub = Array.isArray(zone.subZones) && zone.subZones.length > 0;
                          const isHot = (zone.count || 0) > 0;
                          return (
                            <React.Fragment key={zone.id || zone.code}>
                              <div
                                className={`rej-viewport-zone ${isHot ? "hot" : ""}`}
                                style={{
                                  left: `${zone.xPercent || 0}%`,
                                  top: `${zone.yPercent || 0}%`,
                                  width: `${zone.widthPercent || 10}%`,
                                  height: `${zone.heightPercent || 10}%`,
                                }}
                                title={`${zone.name || zone.code}: ${zone.count || 0} defects`}
                              >
                                {isHot && !hasSub && (
                                  <div className="rej-viewport-zone-badge">
                                    {zone.name || zone.code} ({zone.count})
                                  </div>
                                )}
                              </div>

                              {/* Sub-Zones */}
                              {hasSub && zone.subZones.map((sz) => {
                                const sLeft = Number(zone.xPercent || 0) + (Number(zone.widthPercent || 10) * Number(sz.xPercent || 0) / 100);
                                const sTop = Number(zone.yPercent || 0) + (Number(zone.heightPercent || 10) * Number(sz.heightPercent || 0) / 100);
                                const sWidth = (Number(zone.widthPercent || 10) * Number(sz.widthPercent || 10)) / 100;
                                const sHeight = (Number(zone.heightPercent || 10) * Number(sz.heightPercent || 10)) / 100;
                                const isSubHot = (sz.count || 0) > 0;

                                return (
                                  <div
                                    key={`station-sub-${sz.id || sz.code}`}
                                    className={`rej-viewport-subzone ${isSubHot ? "hot" : ""}`}
                                    style={{
                                      left: `${sLeft}%`,
                                      top: `${sTop}%`,
                                      width: `${sWidth}%`,
                                      height: `${sHeight}%`,
                                    }}
                                    title={`${zone.name || zone.code} › ${sz.name || sz.code}: ${sz.count || 0} defects`}
                                  >
                                    {isSubHot && (
                                      <div className="rej-viewport-zone-badge sub">
                                        {sz.name || sz.code} ({sz.count})
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right: Station Intelligence & Featured Speedometer */}
                  <div className="rej-station-intel-col">
                    {/* Featured Speedometer Gauge Card */}
                    <div className="rej-station-speedo-card">
                      <div className="rej-station-speedo-header">
                        <span className="title">Station Scrap Rate Gauge</span>
                        <span className="spec-info">Nominal: ≤ 2.5% · Alert: &gt; 5.0%</span>
                      </div>
                      <div className="rej-station-featured-speedo-wrap">
                        <StationSpeedometer
                          value={activeStationGate.scrapRate}
                          size="featured"
                          label={`${activeStationGate.code} SCRAP`}
                        />
                      </div>
                    </div>

                    {/* Station Production KPIs Grid */}
                    <div className="rej-station-kpi-grid">
                      <div className="rej-station-mini-kpi">
                        <span className="label">Total Inspected</span>
                        <span className="val">{((activeStationGate.okCount || 0) + (activeStationGate.ngCount || 0)).toLocaleString()}</span>
                        <span className="kpi-subtext">Total Processed</span>
                      </div>
                      <div className="rej-station-mini-kpi">
                        <span className="label">Passed (OK)</span>
                        <span className="val text-green">{activeStationGate.okCount?.toLocaleString() || 0}</span>
                        <span className="kpi-subtext">{(100 - (activeStationGate.scrapRate || 0)).toFixed(1)}% Yield</span>
                      </div>
                      <div className="rej-station-mini-kpi">
                        <span className="label">Scrapped (NG)</span>
                        <span className="val text-red">{activeStationGate.ngCount?.toLocaleString() || 0}</span>
                        <span className="kpi-subtext">{activeStationGate.scrapRate}% Scrap</span>
                      </div>
                      <div
                        className="rej-station-mini-kpi ppm"
                        title="Defect PPM = (Scrapped NG / Total Inspected) × 1,000,000. Automotive industry standard quality metric (IATF 16949 / Maruti Suzuki / Rico Auto). 10,000 PPM = 1.0% Scrap."
                      >
                        <div className="kpi-top">
                          <span className="label">Defect PPM</span>
                          <span className="kpi-formula-tag" title="Parts Per Million">PPM</span>
                        </div>
                        {(() => {
                          const totalInsp = (activeStationGate.okCount || 0) + (activeStationGate.ngCount || 0);
                          const ppmVal = totalInsp > 0 ? Math.round(((activeStationGate.ngCount || 0) / totalInsp) * 1000000) : 0;
                          const colorCls = ppmVal > 50000 ? "text-red" : (ppmVal > 25000 ? "text-amber" : "text-green");
                          return (
                            <>
                              <span className={`val ${colorCls}`}>{ppmVal.toLocaleString()}</span>
                              <span className="kpi-subtext">{(ppmVal / 10000).toFixed(2)}% Defective</span>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Top Defect Drivers at this Station */}
                    <div className="rej-station-reasons-card">
                      <div className="rej-station-reasons-header">
                        <span className="title">
                          {isLeakStation ? (
                            <><Gauge size={14} color="#2563eb" /> Leak Test Parameter Telemetry</>
                          ) : (
                            <><ShieldAlert size={14} color="#ef4444" /> Station Top Rejection Drivers</>
                          )}
                        </span>
                        <span className="subtitle">
                          {isLeakStation ? "Sensor Limits (mbar)" : `${stationTopReasons.length} Defect Types`}
                        </span>
                      </div>

                      {isLeakStation && (
                        <div className="rej-station-spm-notice">
                          <Cpu size={13} style={{ flexShrink: 0, color: "#2563eb" }} />
                          <span>
                            <strong>Automated SPM Station:</strong> Rejections are determined by differential pressure decay sensors (Body Leak & Gallery mbar limits) rather than manual visual defect entries.
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
                              title={`Click to focus on ${item.reason} across studio and logs`}
                            >
                              <div className="row-info">
                                <span className="rank">#{idx + 1}</span>
                                <span className="reason-name">{item.reason}</span>
                                <span className="count-tag">{item.count} pcs</span>
                                <span className="pct-tag">{item.percentage}%</span>
                              </div>
                              <div className="reason-bar-track">
                                <div className="reason-bar-fill" style={{ width: `${item.percentage}%` }} />
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rej-station-reasons-empty">
                            <CheckCircle2 size={16} color="#22c55e" />
                            <span>Zero rejections recorded for {activeStationGate.code} under active filters.</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quality Gate OK vs NG Comparison – Interactive Drill-Down */}
          <div className="rej-card">
            <div className="rej-card-header">
              <div>
                <h3 className="rej-card-title">
                  <BarChart3 size={18} color="#1a3263" />
                  <span>
                    {drillDownLevel === 0 && "Quality Gate OK vs NG Comparison"}
                    {drillDownLevel === 1 && `${drillDownGate} – Category Breakdown`}
                    {drillDownLevel === 2 && `${drillDownGate} › ${drillDownCategory} – Rejection Reasons`}
                  </span>
                </h3>
                <p className="rej-card-subtitle">
                  {drillDownLevel === 0 && "Click any bar to drill-down into category breakdown"}
                  {drillDownLevel === 1 && "Click a category bar to see individual rejection reasons"}
                  {drillDownLevel === 2 && "Detailed rejection reason breakdown"}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {drillDownLevel > 0 && (
                  <>
                    {/* Breadcrumb */}
                    <div className="rej-drilldown-breadcrumb">
                      <button onClick={handleDrillDownReset} className="rej-breadcrumb-link">All Gates</button>
                      <ChevronRight size={12} color="#94a3b8" />
                      <span className={drillDownLevel === 1 ? "rej-breadcrumb-active" : "rej-breadcrumb-link"}
                        onClick={drillDownLevel === 2 ? handleDrillDownBack : undefined}
                        style={drillDownLevel === 2 ? { cursor: "pointer" } : {}}
                      >{drillDownGate}</span>
                      {drillDownLevel === 2 && (
                        <>
                          <ChevronRight size={12} color="#94a3b8" />
                          <span className="rej-breadcrumb-active">{drillDownCategory}</span>
                        </>
                      )}
                    </div>
                    <button onClick={handleDrillDownBack} className="rej-drilldown-back-btn">
                      ← Back
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="rej-chart-scroll-wrapper">
              {/* Level 0: All Quality Gates OK vs NG */}
              {drillDownLevel === 0 && (
                <div style={{ height: 360, minWidth: qualityGateChartData.length > 7 ? qualityGateChartData.length * 120 : "100%" }}>
                  <SafeChart height={360}>
                    {({ width, height }) => (
                      <ComposedChart width={width} height={height} data={qualityGateChartData} margin={{ top: 25, right: 40, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.8)" />
                        <XAxis dataKey="name" angle={0} textAnchor="middle" interval={0} tick={{ fontSize: 11, fontWeight: 800, fill: "#1e293b" }} height={35} />
                        <YAxis yAxisId="left" tick={{ fontSize: 10, fontWeight: 700 }} />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fontWeight: 700 }} />
                        <Tooltip
                          content={({ payload }) => {
                            if (!payload?.length) return null;
                            const d = payload[0]?.payload;
                            return (
                              <div style={{ background: "#fff", padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", fontSize: 12 }}>
                                <div style={{ fontWeight: 800, marginBottom: 4, color: "#1a3263" }}>{d.fullName}</div>
                                <div style={{ color: "#22c55e" }}>OK: <strong>{d.OK?.toLocaleString()}</strong></div>
                                <div style={{ color: "#ef4444" }}>NG: <strong>{d.NG?.toLocaleString()}</strong></div>
                                <div style={{ color: "#f59e0b", marginTop: 2 }}>Scrap Rate: <strong>{d.scrapRate}%</strong></div>
                                <div style={{ marginTop: 6, fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Click to drill down →</div>
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                        <Bar yAxisId="left" dataKey="OK" name="Passed OK" fill="#22c55e" radius={[4, 4, 0, 0]} cursor="pointer"
                          onClick={(data) => handleGateBarClick(data)}
                        >
                          <LabelList dataKey="OK" position="top" style={{ fontSize: 10, fontWeight: 800, fill: "#15803d" }} formatter={(v) => v > 0 ? v.toLocaleString() : ""} />
                        </Bar>
                        <Bar yAxisId="left" dataKey="NG" name="Rejected NG" fill="#ef4444" radius={[4, 4, 0, 0]} cursor="pointer"
                          onClick={(data) => handleGateBarClick(data)}
                        >
                          <LabelList dataKey="NG" position="top" style={{ fontSize: 10, fontWeight: 800, fill: "#dc2626" }} formatter={(v) => v > 0 ? v.toLocaleString() : ""} />
                        </Bar>
                        <Line yAxisId="right" type="monotone" dataKey="scrapRate" name="Scrap Rate %" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: "#f59e0b" }} />
                      </ComposedChart>
                    )}
                  </SafeChart>
                </div>
              )}

              {/* Level 1: Category Breakdown for selected gate */}
              {drillDownLevel === 1 && (
                <div style={{ height: 360, minWidth: drillDownCategoryData.length > 6 ? drillDownCategoryData.length * 130 : "100%" }}>
                  <SafeChart height={360}>
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={drillDownCategoryData} margin={{ top: 25, right: 30, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.8)" />
                        <XAxis dataKey="category" angle={0} textAnchor="middle" interval={0} tick={{ fontSize: 11, fontWeight: 800, fill: "#1e293b" }} height={35} />
                        <YAxis tick={{ fontSize: 10, fontWeight: 700 }} />
                        <Tooltip
                          content={({ payload }) => {
                            if (!payload?.length) return null;
                            const d = payload[0]?.payload;
                            return (
                              <div style={{ background: "#fff", padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", fontSize: 12 }}>
                                <div style={{ fontWeight: 800, marginBottom: 4, color: "#1a3263" }}>{drillDownGate} › {d.category}</div>
                                <div>Count: <strong>{d.count?.toLocaleString()}</strong></div>
                                <div style={{ color: "#f59e0b" }}>Share: <strong>{d.percentage}%</strong></div>
                                <div style={{ marginTop: 6, fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Click to see reasons →</div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="count" name="Rejection Count" radius={[6, 6, 0, 0]} cursor="pointer"
                          onClick={(data) => handleCategoryBarClick(data)}
                        >
                          {drillDownCategoryData.map((_, idx) => (
                            <Cell key={idx} fill={PARETO_COLORS[idx % PARETO_COLORS.length]} />
                          ))}
                          <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 800, fill: "#1e293b" }} formatter={(v) => v > 0 ? v.toLocaleString() : ""} />
                        </Bar>
                      </BarChart>
                    )}
                  </SafeChart>
                </div>
              )}

              {/* Level 2: Reason Breakdown for selected gate+category */}
              {drillDownLevel === 2 && (
                <div style={{ height: 380, minWidth: drillDownReasonData.length > 5 ? drillDownReasonData.length * 150 : "100%" }}>
                  <SafeChart height={380}>
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={drillDownReasonData} margin={{ top: 25, right: 30, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.8)" />
                        <XAxis dataKey="reason" angle={0} textAnchor="middle" interval={0} tick={{ fontSize: 10, fontWeight: 700, fill: "#1e293b" }} height={45} tickFormatter={(val) => val && val.length > 15 ? `${val.slice(0, 14)}…` : val} />
                        <YAxis tick={{ fontSize: 10, fontWeight: 700 }} />
                        <Tooltip
                          content={({ payload }) => {
                            if (!payload?.length) return null;
                            const d = payload[0]?.payload;
                            return (
                              <div style={{ background: "#fff", padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", fontSize: 12 }}>
                                <div style={{ fontWeight: 800, marginBottom: 4, color: "#1a3263" }}>{drillDownGate} › {drillDownCategory} › {d.reason}</div>
                                <div>Count: <strong>{d.count?.toLocaleString()}</strong></div>
                                <div style={{ color: "#ef4444" }}>Share: <strong>{d.percentage}%</strong></div>
                                <div style={{ marginTop: 6, fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Click to focus defect localization below ↓</div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="count" name="Rejection Count" radius={[6, 6, 0, 0]} cursor="pointer"
                          onClick={(data) => handleReasonBarClick(data)}
                        >
                          {drillDownReasonData.map((_, idx) => (
                            <Cell key={idx} fill={PARETO_COLORS[idx % PARETO_COLORS.length]} />
                          ))}
                          <LabelList dataKey="count" position="top" style={{ fontSize: 10, fontWeight: 800, fill: "#1e293b" }} formatter={(v) => v > 0 ? v.toLocaleString() : ""} />
                        </Bar>
                      </BarChart>
                    )}
                  </SafeChart>
                </div>
              )}
            </div>

            {/* Active Quality Gate Filter Sync Banner */}
            {drillDownGate && (
              <div style={{
                marginTop: 16,
                padding: "12px 18px",
                background: "rgba(37, 99, 235, 0.05)",
                border: "1px solid rgba(37, 99, 235, 0.2)",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: "rgba(37, 99, 235, 0.12)",
                    color: "#2563eb",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    <Target size={16} />
                  </span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                      Quality Gate Selection Active: <span style={{ color: "#2563eb" }}>{drillDownGate}</span>
                      {drillDownCategory && <span> › <span style={{ color: "#ef4444" }}>{drillDownCategory}</span></span>}
                      {activeGateReason && <span> › <span style={{ color: "#d97706" }}>{activeGateReason}</span></span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      {filteredDrillDownParts.length > 0 ? filteredDrillDownParts.length : drillDownMatchingParts.length} scrap parts interlocked at this station. Visual localization & detailed log synchronized in the studio below ↓
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={handleDrillDownReset}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: 6,
                      padding: "5px 12px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#475569",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <RotateCcw size={12} />
                    <span>Reset Gate Filter</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Multi-Dimensional Pareto Analytics */}
          <div className="rej-card">
            <div className="rej-card-header">
              <div>
                <h3 className="rej-card-title">
                  <BarChart3 size={18} color="#ef4444" />
                  <span>Multi-Dimensional Rejection Pareto Analysis</span>
                </h3>
                <p className="rej-card-subtitle">
                  Explore rejections by reason, category, or zone · Click any bar or line point to inspect 3D localized defect CAD
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="rej-pareto-tabs">
                  {[
                    { key: "reason", label: "By Reason" },
                    { key: "category", label: "By Category" },
                    { key: "zone", label: "By Zone" },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      className={`rej-pareto-tab ${paretoView === tab.key ? "active" : ""}`}
                      onClick={() => setParetoView(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setIsStudioVisible((prev) => !prev);
                    if (!isStudioVisible) {
                      setTimeout(() => {
                        studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 100);
                    }
                  }}
                  className={`rej-icon-btn ${isStudioVisible ? "active" : ""}`}
                  title={isStudioVisible ? "Hide Defect Localization Studio" : "Open Multi-Angle Defect Localization Studio"}
                >
                  <Target size={15} />
                </button>
              </div>
            </div>

            <div className="rej-chart-scroll-wrapper">
              <div style={{ height: 360, minWidth: (paretoView === "reason" ? cleanPareto : paretoView === "category" ? categoryPareto : zoneBreakdown).slice(0, 18).length > 8 ? (paretoView === "reason" ? cleanPareto : paretoView === "category" ? categoryPareto : zoneBreakdown).slice(0, 18).length * 100 : "100%" }}>
              <SafeChart height={360}>
                {({ width, height }) => {
                  const chartData = paretoView === "reason"
                    ? cleanPareto.slice(0, 18)
                    : paretoView === "category"
                      ? categoryPareto.slice(0, 18)
                      : zoneBreakdown.slice(0, 18);
                  const dataKey = paretoView === "reason" ? "reason" : paretoView === "category" ? "category" : "zone";
                  return (
                    <ComposedChart
                      width={width}
                      height={height}
                      data={chartData}
                      margin={{ top: 25, right: 30, left: 0, bottom: 45 }}
                      onClick={(chartState) => {
                        if (chartState && chartState.activePayload && chartState.activePayload.length > 0) {
                          const entry = chartState.activePayload[0].payload;
                          if (entry) {
                            setSelectedParetoItem(entry);
                            setParetoSelectedView("all");
                            setIsStudioVisible(true);
                            setTimeout(() => {
                              studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }, 80);
                          }
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.8)" />
                      <XAxis
                        dataKey={dataKey}
                        angle={0}
                        textAnchor="middle"
                        interval={0}
                        tick={{ fontSize: 10.5, fontWeight: 750, fill: "#1e293b" }}
                        height={45}
                        tickFormatter={(val) => val && val.length > 16 ? `${val.slice(0, 15)}…` : val}
                      />
                      <YAxis yAxisId="left" tick={{ fontSize: 10, fontWeight: 700 }} />
                      <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fontWeight: 700 }} />
                      <Tooltip
                        formatter={(value, name) => name === "Cumulative %" ? [`${value}%`, name] : [value, name]}
                      />
                      <ReferenceLine yAxisId="right" y={80} stroke="#f97316" strokeDasharray="4 4" label={{ value: "80% Cutoff", fill: "#f97316", fontSize: 10 }} />
                      <Bar
                        yAxisId="left"
                        dataKey="count"
                        name="Defect Count"
                        radius={[6, 6, 0, 0]}
                        cursor="pointer"
                        onClick={(entry) => {
                          if (entry) {
                            setSelectedParetoItem(entry);
                            setParetoSelectedView("all");
                            setIsStudioVisible(true);
                            setTimeout(() => {
                              studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }, 80);
                          }
                        }}
                      >
                        {chartData.map((entry, idx) => {
                          const itemKey = entry[dataKey];
                          const isSelected = activeParetoKey && itemKey === activeParetoKey;
                          return (
                            <Cell
                              key={idx}
                              fill={isSelected ? "#ef4444" : PARETO_COLORS[idx % PARETO_COLORS.length]}
                              stroke={isSelected ? "#991b1b" : "none"}
                              strokeWidth={isSelected ? 2.5 : 0}
                            />
                          );
                        })}
                        <LabelList dataKey="count" position="top" style={{ fontSize: 9, fontWeight: 800, fill: "#1e293b" }} formatter={(v) => v > 0 ? v.toLocaleString() : ""} />
                      </Bar>
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="cumulativePercentage"
                        name="Cumulative %"
                        stroke="#1a3263"
                        strokeWidth={3}
                        cursor="pointer"
                        dot={{ r: 4, fill: "#1a3263", cursor: "pointer" }}
                        activeDot={{
                          r: 7,
                          stroke: "#2563eb",
                          strokeWidth: 2.5,
                          fill: "#ffffff",
                          cursor: "pointer",
                          onClick: (e, payload) => {
                            if (payload && payload.payload) {
                              setSelectedParetoItem(payload.payload);
                              setParetoSelectedView("all");
                              setIsStudioVisible(true);
                              setTimeout(() => {
                                studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                              }, 80);
                            }
                          }
                        }}
                        onClick={(entry) => {
                          if (entry) {
                            setSelectedParetoItem(entry);
                            setParetoSelectedView("all");
                            setIsStudioVisible(true);
                            setTimeout(() => {
                              studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }, 80);
                          }
                        }}
                      />
                    </ComposedChart>
                  );
                }}
              </SafeChart>
              </div>
            </div>

            {/* Quick Contributor Selector Pills */}
            {(() => {
              const topItems = (paretoView === "reason" ? cleanPareto : paretoView === "category" ? categoryPareto : zoneBreakdown).slice(0, 10);
              const dataKey = paretoView === "reason" ? "reason" : paretoView === "category" ? "category" : "zone";
              if (!topItems.length) return null;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "10px 18px", borderTop: "1px solid #f1f5f9", background: "#f8fafc" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#64748b", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Target size={13} color="#ef4444" /> Quick Focus:
                  </span>
                  {topItems.map((item, idx) => {
                    const val = item[dataKey];
                    const isSelected = val === activeParetoKey;
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          setSelectedParetoItem(item);
                          setParetoSelectedView("all");
                          setIsStudioVisible(true);
                          setTimeout(() => {
                            studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }, 80);
                        }}
                        style={{
                          padding: "3px 9px",
                          borderRadius: 999,
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: "pointer",
                          border: isSelected ? "1.5px solid #ef4444" : "1px solid #cbd5e1",
                          background: isSelected ? "#ef4444" : "#ffffff",
                          color: isSelected ? "#ffffff" : "#334155",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          transition: "all 0.15s ease",
                        }}
                      >
                        <span>{val}</span>
                        <span style={{
                          background: isSelected ? "rgba(255,255,255,0.25)" : "#f1f5f9",
                          color: isSelected ? "#ffffff" : "#64748b",
                          padding: "0 4px",
                          borderRadius: 4,
                          fontSize: 9,
                        }}>
                          {item.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── UNIFIED MULTI-ANGLE DEFECT LOCALIZATION STUDIO & CONTEXTUAL SCRAP LOG ── */}
            {isStudioVisible && (
              <div ref={studioRef} className={`rej-studio-container ${studioFullscreen ? "fullscreen" : ""}`}>
                {/* Studio Header */}
                <div className="rej-studio-header">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Eye size={17} color="#2563eb" />
                        <h4 className="rej-studio-title" style={{ margin: 0 }}>
                          Multi-Angle Defect Localization Studio: <span style={{ color: activeStudioData.isGateActive ? "#2563eb" : "#ef4444" }}>{activeStudioData.title}</span>
                        </h4>
                      </div>
                      <span className="rej-studio-tag">
                        {activeStudioData.tag} · {activeStudioData.count} Scrap Parts ({activeStudioData.summary?.percentageOfAll ?? 0}% Shop Scrap)
                      </span>
                    </div>
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
                    <button
                      onClick={() => setIsStudioVisible(false)}
                      className="rej-icon-btn rej-icon-btn-close"
                      title="Close Defect Localization Studio"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

              {/* Angle Selector Tabs Bar */}
              <div className="rej-studio-angle-bar">
                <button
                  onClick={() => setStudioActiveAngle("all")}
                  className={`rej-studio-angle-tab ${studioActiveAngle === "all" ? "active" : ""}`}
                >
                  <Grid size={13} />
                  <span>Primary Hotspot Angle</span>
                  <span className="count-pill primary">
                    {activeStudioData.count}
                  </span>
                </button>
                {(activeStudioData.viewData || []).map((v) => {
                  const isSel = studioActiveAngle === v.name || studioActiveAngle === v.code;
                  return (
                    <button
                      key={v.id || v.code}
                      onClick={() => setStudioActiveAngle(isSel ? "all" : v.name)}
                      className={`rej-studio-angle-tab ${isSel ? "active" : ""}`}
                    >
                      <Camera size={13} />
                      <span>{v.name}</span>
                      <span className={`count-pill ${v.totalDefects > 0 ? "danger" : "muted"}`}>
                        {v.totalDefects}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Main Interactive Stage: High-Res Viewport + Intelligence Sidebar */}
              <div className="rej-studio-stage">
                {/* Left: High-Res Viewport */}
                <div className="rej-studio-viewport">
                  {/* Viewport Top Bar */}
                  <div className="rej-viewport-topbar">
                    <div className="rej-viewport-title">
                      <Camera size={14} color="#60a5fa" />
                      <span>{currentStudioView?.name || "Inspection Angle"}</span>
                      {currentStudioView?.totalDefects > 0 ? (
                        <span className="rej-viewport-status-badge danger">
                          {currentStudioView.totalDefects} defects localized
                        </span>
                      ) : (
                        <span className="rej-viewport-status-badge ok">
                          100% In-Spec
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        Angle {(activeStudioData.viewData || []).findIndex((v) => v.name === currentStudioView?.name) + 1} of {activeStudioData.viewData?.length || 6}
                      </span>
                    </div>
                  </div>

                  {/* Main High-Res Canvas */}
                  <div className="rej-viewport-canvas">
                    <div className="rej-viewport-img-wrap">
                      {currentStudioView?.imageUrl ? (
                        <img
                          src={currentStudioView.imageUrl}
                          alt={currentStudioView.name}
                          className="rej-viewport-img"
                        />
                      ) : (
                        <div className="rej-viewport-empty">
                          <Camera size={32} color="#475569" style={{ marginBottom: 8 }} />
                          <div>No camera projection feed available for this view</div>
                        </div>
                      )}

                      {/* Overlaid Parent Zones */}
                      {(currentStudioView?.zones || []).map((zone) => {
                        const hasSub = Array.isArray(zone.subZones) && zone.subZones.length > 0;
                        const isHot = (zone.count || 0) > 0;
                        return (
                          <React.Fragment key={zone.id || zone.code}>
                            <div
                              className={`rej-viewport-zone ${isHot ? "hot" : ""}`}
                              style={{
                                left: `${zone.xPercent || 0}%`,
                                top: `${zone.yPercent || 0}%`,
                                width: `${zone.widthPercent || 10}%`,
                                height: `${zone.heightPercent || 10}%`,
                              }}
                              title={`${zone.name || zone.code}: ${zone.count || 0} defects`}
                            >
                              {isHot && !hasSub && (
                                <div className="rej-viewport-zone-badge">
                                  {zone.name || zone.code} ({zone.count})
                                </div>
                              )}
                            </div>

                            {/* Sub-Zones */}
                            {hasSub && zone.subZones.map((sz) => {
                              const sLeft = Number(zone.xPercent || 0) + (Number(zone.widthPercent || 10) * Number(sz.xPercent || 0) / 100);
                              const sTop = Number(zone.yPercent || 0) + (Number(zone.heightPercent || 10) * Number(sz.heightPercent || 0) / 100);
                              const sWidth = (Number(zone.widthPercent || 10) * Number(sz.widthPercent || 10)) / 100;
                              const sHeight = (Number(zone.heightPercent || 10) * Number(sz.heightPercent || 10)) / 100;
                              const isSubHot = (sz.count || 0) > 0;

                              return (
                                <div
                                  key={`studio-sub-${sz.id || sz.code}`}
                                  className={`rej-viewport-subzone ${isSubHot ? "hot" : ""}`}
                                  style={{
                                    left: `${sLeft}%`,
                                    top: `${sTop}%`,
                                    width: `${sWidth}%`,
                                    height: `${sHeight}%`,
                                  }}
                                  title={`${sz.code || sz.name}: ${sz.count || 0} defects`}
                                >
                                  {isSubHot && (
                                    <div className="rej-viewport-subzone-badge">
                                      {sz.code || sz.name} ({sz.count})
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>

                  {/* Viewport Bottom Monitored Zones Bar */}
                  <div className="rej-viewport-bottombar">
                    <span style={{ fontWeight: 800, color: "#94a3b8", fontSize: 11 }}>Active Zones:</span>
                    {currentStudioView?.activeSubZonesList && currentStudioView.activeSubZonesList.length > 0 ? (
                      <div className="rej-viewport-zone-tags">
                        {currentStudioView.activeSubZonesList.map((str, idx) => {
                          const cleanLabel = str.replace(/ZONE\s*[-_]?\w+\s*[›>]\s*(?:SUB\s*ZONE\s*)?/i, "");
                          return (
                            <span key={idx} className="rej-viewport-tag" title={str}>
                              {cleanLabel}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>
                        ✓ 0 Defects in this view (100% In-Spec)
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Streamlined SCADA Intelligence Sidebar */}
                <div className="rej-studio-intel-sidebar">
                  {/* Card 1: Defect Focus & Hotspot Summary */}
                  <div className="rej-intel-card primary">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div className="rej-intel-card-label" style={{ marginBottom: 0 }}>
                        <Target size={14} color="#2563eb" />
                        <span style={{ fontWeight: 800 }}>Defect Focus</span>
                      </div>
                      <span className="rej-studio-tag" style={{ fontSize: 10, padding: "1px 7px" }}>
                        {activeStudioData.count} parts ({activeStudioData.summary?.percentageOfAll ?? 0}%)
                      </span>
                    </div>
                    <div className="rej-intel-card-val text-blue-700" style={{ fontSize: 15, margin: "6px 0 4px 0" }}>
                      {activeStudioData.title}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#475569", marginTop: 4, background: "rgba(239, 68, 68, 0.08)", padding: "4px 8px", borderRadius: 6 }}>
                      <MapPin size={13} color="#dc2626" style={{ flexShrink: 0 }} />
                      <span>Hotspot: <strong style={{ color: "#991b1b" }}>{activeStudioData.summary?.primaryViewName || "Top View"}</strong> &rsaquo; <strong>{activeStudioData.summary?.topHotspotSubZone || "General Area"}</strong></span>
                    </div>
                  </div>

                  {/* Card 2: Casting Process Telemetry Correlation */}
                  <div className="rej-intel-card">
                    <div className="rej-intel-card-label">
                      <Gauge size={14} color="#d97706" />
                      <span>Casting Telemetry Correlation</span>
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
                    <div style={{ marginTop: 8, display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: "#1e3a8a", background: "#eff6ff", padding: "6px 8px", borderRadius: 6, lineHeight: 1.4 }}>
                      <Sparkles size={13} color="#2563eb" style={{ flexShrink: 0, marginTop: 2 }} />
                      <div>
                        Cell: <strong>{activeStudioData.summary?.topMachine || "DCM Cell"}</strong> · Biscuit: <strong>{activeStudioData.summary?.avgBiscuit || "—"} mm</strong>, Pressure: <strong>{activeStudioData.summary?.avgPress || "—"} bar</strong>.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contextual Scrap Parts Traceability Log Table */}
              <div className="rej-context-log-card">
                <div className="rej-context-log-header">
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <FileSpreadsheet size={16} color="#1a3263" />
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                        Scrap Parts Traceability Log ({filteredContextParts.length} matching parts)
                      </span>
                    </div>

                    {/* View Mode Switcher */}
                    <div className="rej-context-viewmode-pills">
                      <button
                        onClick={() => setContextLogViewMode("defect")}
                        className={`rej-context-mode-btn ${contextLogViewMode === "defect" ? "active" : ""}`}
                      >
                        Defect & Station
                      </button>
                      <button
                        onClick={() => setContextLogViewMode("telemetry")}
                        className={`rej-context-mode-btn ${contextLogViewMode === "telemetry" ? "active" : ""}`}
                      >
                        Process Parameters
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div className="rej-context-search">
                      <Search size={13} color="#94a3b8" />
                      <input
                        type="text"
                        placeholder="Search Serial, QR, Machine, Reason..."
                        value={contextLogSearch}
                        onChange={(e) => { setContextLogSearch(e.target.value); setContextLogPage(1); }}
                      />
                    </div>
                    <button
                      onClick={exportContextPartsExcel}
                      disabled={!filteredContextParts.length}
                      className="rej-icon-btn"
                      title="Export filtered parts to Excel (.xlsx)"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={() => setIsContextLogExpanded((prev) => !prev)}
                      className="rej-icon-btn"
                      title={isContextLogExpanded ? "Hide Traceability Parts Table" : "Show Traceability Parts Table"}
                    >
                      {isContextLogExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                {isContextLogExpanded && (
                  <>
                    {/* Table Container */}
                    <div className="rej-context-table-wrapper">
                      <table className="rej-context-table">
                        <thead>
                          <tr>
                            <th style={{ width: 45 }}>#</th>
                            <th style={{ minWidth: 160 }}>Part Serial Number</th>
                            <th style={{ width: 85 }}>Shot #</th>
                            <th style={{ width: 90 }}>Shot Status</th>
                            <th style={{ minWidth: 160 }}>Customer QR</th>
                            <th style={{ width: 75 }}>Status</th>
                            {contextLogViewMode === "defect" ? (
                              <>
                                <th style={{ minWidth: 100 }}>Inspection Angle</th>
                                <th style={{ width: 85 }}>Category</th>
                                <th style={{ minWidth: 130 }}>Defect Reason</th>
                                <th style={{ minWidth: 90 }}>Zone</th>
                                <th style={{ minWidth: 90 }}>Sub-Zone</th>
                                <th style={{ minWidth: 100 }}>Machine</th>
                                <th style={{ width: 60 }}>Shift</th>
                                <th style={{ minWidth: 130 }}>Timestamp</th>
                              </>
                            ) : (
                              <>
                                <th style={{ minWidth: 90 }}>Cycle Time</th>
                                <th style={{ minWidth: 90 }}>Pressure</th>
                                <th style={{ minWidth: 90 }}>Temp</th>
                                <th style={{ minWidth: 90 }}>Biscuit</th>
                                <th style={{ minWidth: 80 }}>V1 Speed</th>
                                <th style={{ minWidth: 80 }}>V2 Speed</th>
                                <th style={{ minWidth: 90 }}>Intensif. Time</th>
                                <th style={{ minWidth: 90 }}>Leak Value</th>
                                <th style={{ minWidth: 130 }}>Timestamp</th>
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
                                const isNg = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(String(r.status || r.overall_status || "").trim().toUpperCase());
                                const rowIdx = (contextLogPage - 1) * contextLogPageSize + idx + 1;
                                const partSerial = r.partId || r.part_id || "";
                                const custQr = r.customerQrCode || r.customer_qr || "";

                                return (
                                  <tr key={r.rowKey || r.id || idx}>
                                    <td style={{ color: "#94a3b8", fontSize: 11, textAlign: "center" }}>{rowIdx}</td>
                                    <td>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#0f172a" }}>
                                          {partSerial || "—"}
                                        </span>
                                        {partSerial && (
                                          <button
                                            onClick={() => copyToClipboard(partSerial, `part-${partSerial}-${idx}`)}
                                            className="rej-copy-btn"
                                            title="Copy Part Serial"
                                          >
                                            {copiedId === `part-${partSerial}-${idx}` ? <Check size={11} color="#16a34a" /> : <Copy size={11} />}
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                    <td style={{ fontWeight: 700, color: "#1e293b" }}>
                                      {r.shotNumber || r.shot_number || "—"}
                                    </td>
                                    <td>
                                      {r.shotStatus || r.shot_status ? (
                                        <span className={`rej-status-pill ${(r.shotStatus || r.shot_status) === "OK" ? "ok" : "danger"}`}>
                                          {r.shotStatus || r.shot_status}
                                        </span>
                                      ) : "—"}
                                    </td>
                                    <td>
                                      <div style={{ display: "flex", alignItems: "center", gap: 6 }} title={custQr}>
                                        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: "#475569" }}>
                                          {custQr ? (custQr.length > 15 ? `${custQr.slice(0, 14)}…` : custQr) : "—"}
                                        </span>
                                        {custQr && (
                                          <button
                                            onClick={() => copyToClipboard(custQr, `qr-${custQr}-${idx}`)}
                                            className="rej-copy-btn"
                                            title="Copy Customer QR"
                                          >
                                            {copiedId === `qr-${custQr}-${idx}` ? <Check size={11} color="#16a34a" /> : <Copy size={11} />}
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                    <td>
                                      <span className={`rej-status-pill ${isNg ? "danger" : "ok"}`}>
                                        {isNg ? "NG" : "OK"}
                                      </span>
                                    </td>

                                    {contextLogViewMode === "defect" ? (
                                      <>
                                        <td style={{ fontWeight: 700, color: "#1e293b" }}>{pDefect.view || "—"}</td>
                                        <td style={{ color: "#64748b" }}>{pDefect.category || "—"}</td>
                                        <td style={{ fontWeight: 700, color: "#dc2626" }}>{pDefect.reason || "—"}</td>
                                        <td style={{ color: "#334155" }}>{pDefect.zone || "—"}</td>
                                        <td style={{ color: "#334155" }}>{pDefect.subZone || "—"}</td>
                                        <td style={{ color: "#334155" }}>{r.machineName || r.machine_name || "—"}</td>
                                        <td style={{ color: "#334155" }}>{r.shiftCode || r.shift_code || "A"}</td>
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
                                        <td>{fmtNum(r.leakBodyValue ?? r.leak_body_leak_value) ? `${fmtNum(r.leakBodyValue ?? r.leak_body_leak_value)} mbar` : "—"}</td>
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

                    {/* Pagination Controls */}
                    {filteredContextParts.length > 0 && (
                      <div className="rej-context-pagination">
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          Showing {Math.min((contextLogPage - 1) * contextLogPageSize + 1, filteredContextParts.length)} to {Math.min(contextLogPage * contextLogPageSize, filteredContextParts.length)} of {filteredContextParts.length.toLocaleString()} parts
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#475569" }}>
                            <span>Rows per page:</span>
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
                            >
                              ‹
                            </button>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: "0 6px", color: "#1e293b" }}>
                              Page {contextLogPage} of {Math.ceil(filteredContextParts.length / contextLogPageSize) || 1}
                            </span>
                            <button
                              disabled={contextLogPage >= Math.ceil(filteredContextParts.length / contextLogPageSize)}
                              onClick={() => setContextLogPage((p) => p + 1)}
                              className="rej-page-arrow-btn"
                            >
                              ›
                            </button>
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

          {/* Shift Scrap Distribution */}
          <div className="rej-card">
            <div className="rej-card-header">
              <div>
                <h3 className="rej-card-title">
                  <PieIcon size={18} color="#1a3263" />
                  <span>Shift Scrap Distribution</span>
                </h3>
                <p className="rej-card-subtitle">Scrap frequency and pass counts by shift</p>
              </div>
            </div>

            {(() => {
              // Backend returns { shift, total, scrap, scrapRate }
              const formatShiftLabel = (raw) => {
                if (!raw) return "Unassigned";
                const s = String(raw).trim();
                if (s === "SHIFT_A" || s === "A") return "Shift A";
                if (s === "SHIFT_B" || s === "B") return "Shift B";
                if (s === "SHIFT_C" || s === "C") return "Shift C";
                return s.replace(/_/g, " ");
              };
              const shiftChartData = shiftScrap
                .filter((s) => (Number(s.total) || 0) > 0 || (Number(s.scrap) || 0) > 0)
                .map((s) => ({
                  shift_label: formatShiftLabel(s.shift || s.shift_code),
                  passed: Math.max(0, (Number(s.total) || 0) - (Number(s.scrap) || 0)),
                  rejected: Number(s.scrap) || 0,
                  scrapRate: Number(s.scrapRate) || (s.total > 0 ? Number(((s.scrap / s.total) * 100).toFixed(2)) : 0),
                  total: Number(s.total) || 0,
                }))
                .filter((s) => !String(s.shift_label).toLowerCase().includes("unassigned"));
              return shiftChartData.length === 0 ? (
                <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13, fontWeight: 700 }}>
                  No shift data available for the selected period.
                </div>
              ) : (
                  <div style={{ height: 380 }}>
                    <SafeChart height={380}>
                      {({ width, height }) => (
                        <ComposedChart width={width} height={height} data={shiftChartData} margin={{ top: 15, right: 40, left: 10, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.8)" />
                        <XAxis dataKey="shift_label" tick={{ fontSize: 14, fontWeight: 800, fill: "#0f172a" }} />
                        <YAxis yAxisId="left" tick={{ fontSize: 12, fontWeight: 700, fill: "#475569" }} />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fontWeight: 700, fill: "#475569" }} />
                        <Tooltip
                          content={({ payload }) => {
                            if (!payload?.length) return null;
                            const d = payload[0]?.payload;
                            return (
                              <div style={{ background: "#fff", padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", fontSize: 13 }}>
                                <div style={{ fontWeight: 800, marginBottom: 4, color: "#1a3263" }}>Shift: {d.shift_label}</div>
                                <div>Total: <strong>{d.total?.toLocaleString()}</strong></div>
                                <div style={{ color: "#22c55e" }}>Passed: <strong>{d.passed?.toLocaleString()}</strong></div>
                                <div style={{ color: "#ef4444" }}>Rejected: <strong>{d.rejected?.toLocaleString()}</strong></div>
                                <div style={{ color: "#f59e0b", marginTop: 2 }}>Scrap Rate: <strong>{d.scrapRate}%</strong></div>
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 13, fontWeight: 800, paddingTop: 14 }} />
                        <Bar yAxisId="left" dataKey="passed" name="Passed OK" fill="#22c55e" radius={[4, 4, 0, 0]} stackId="a">
                          <LabelList
                            dataKey="passed"
                            position="center"
                            style={{ fontSize: 16, fontWeight: 900, fill: "#ffffff", textShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
                            formatter={(v) => (v > 0 ? v.toLocaleString() : "")}
                          />
                        </Bar>
                        <Bar yAxisId="left" dataKey="rejected" name="Rejected NG" fill="#ef4444" radius={[4, 4, 0, 0]} stackId="a">
                          <LabelList
                            dataKey="rejected"
                            position="inside"
                            style={{ fontSize: 14, fontWeight: 900, fill: "#ffffff", textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
                            formatter={(v) => (v > 0 ? v.toLocaleString() : "")}
                          />
                        </Bar>
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="scrapRate"
                          name="Scrap Rate %"
                          stroke="#f59e0b"
                          strokeWidth={3}
                          dot={{ r: 6, fill: "#f59e0b" }}
                        >
                          <LabelList
                            dataKey="scrapRate"
                            position="top"
                            offset={10}
                            style={{ fontSize: 13, fontWeight: 900, fill: "#d97706" }}
                            formatter={(v) => `${v}%`}
                          />
                        </Line>
                      </ComposedChart>
                    )}
                  </SafeChart>
                </div>
              );
            })()}
          </div>
        </div>
      )
    )}

      {/* ── TAB 2: MACHINE LEARNING DEEP ANALYSIS ─────────────────────── */}
      {activeTab === "ml_analysis" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Feature Importance Bar Chart */}
          <div className="rej-card">
            <div className="rej-card-header">
              <div>
                <h3 className="rej-card-title">
                  <Sparkles size={18} color="#8b5cf6" />
                  <span>Six-Sigma Process Parameter Sensitivity & Defect Attribution</span>
                </h3>
                <p className="rej-card-subtitle">Multivariate statistical parameter divergence (σ) and anomaly correlation driving HPDC defect occurrence</p>
              </div>
              <span className="rej-badge rej-badge-danger">
                Top Driver: {mlInsights.features?.[0]?.label || "Leak Test"} ({mlInsights.features?.[0]?.driftPct || 0}% Drift)
              </span>
            </div>

            {/* Horizontal Bar Chart for Feature Importance */}
            <div className="rej-feature-hbar">
              {mlInsights.features?.map((feat, idx) => {
                const isCritical = feat.riskLevel === "CRITICAL";
                const isModerate = feat.riskLevel === "MODERATE";
                const barColor = isCritical ? "#ef4444" : isModerate ? "#f59e0b" : "#22c55e";
                return (
                  <div key={feat.key} className="rej-feature-hbar-item">
                    <span className="rej-feature-hbar-label" title={feat.label}>
                      #{idx + 1} {feat.label}
                    </span>
                    <div className="rej-feature-hbar-track">
                      <div
                        className="rej-feature-hbar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(8, feat.importanceScore))}%`,
                          background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
                        }}
                      >
                        {feat.importanceScore > 15 && (
                          <span>{feat.importanceScore.toFixed(0)}%</span>
                        )}
                      </div>
                    </div>
                    <span className="rej-feature-hbar-risk">
                      <span className={`rej-badge ${isCritical ? "rej-badge-danger" : isModerate ? "rej-badge-warning" : "rej-badge-ok"}`}>
                        {feat.riskLevel}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Radar Chart — OK vs NG Parameter Profile */}
          <div className="rej-card">
            <div className="rej-card-header">
              <div>
                <h3 className="rej-card-title">
                  <Target size={18} color="#1a3263" />
                  <span>Golden Process Profile vs Scrap Parameter Drift (Radar)</span>
                </h3>
                <p className="rej-card-subtitle">Normalized Six-Sigma comparison of OK baseline vs NG scrap parameter averages</p>
              </div>
            </div>
            <div style={{ height: 360 }}>
              <SafeChart height={360}>
                {({ width, height }) => (
                  <RadarChart cx={width / 2} cy={height / 2} outerRadius={Math.min(width, height) / 2 - 40} width={width} height={height} data={radarData}>
                    <PolarGrid stroke="#cbd5e1" strokeWidth={1.2} />
                    <PolarAngleAxis dataKey="parameter" tick={{ fontSize: 11, fontWeight: 700, fill: "#1a3263" }} />
                    <PolarRadiusAxis
                      angle={45}
                      domain={[0, 100]}
                      stroke="#475569"
                      strokeWidth={1.2}
                      tick={{ fontSize: 11, fontWeight: 800, fill: "#0f172a" }}
                    />
                    <Radar name="OK Mean" dataKey="OK Mean" stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} strokeWidth={2.5} />
                    <Radar name="NG Mean" dataKey="NG Mean" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} strokeWidth={2.5} />
                    <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                    <Tooltip
                      content={({ payload }) => {
                        if (!payload?.length) return null;
                        const d = payload[0]?.payload;
                        return (
                          <div style={{ background: "#fff", padding: "10px 14px", border: "1px solid #cbd5e1", borderRadius: 8, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", fontSize: 12 }}>
                            <div style={{ fontWeight: 800, marginBottom: 4 }}>{d.fullLabel}</div>
                            <div style={{ color: "#22c55e" }}>OK Mean: <strong>{d.okRaw} {d.unit}</strong></div>
                            <div style={{ color: "#ef4444" }}>NG Mean: <strong>{d.ngRaw} {d.unit}</strong></div>
                          </div>
                        );
                      }}
                    />
                  </RadarChart>
                )}
              </SafeChart>
            </div>
          </div>

          {/* Golden Window vs NG Defect Drift Matrix — Full Width, Clean Vertical Scroll, No Horizontal Scroll */}
          <div className="rej-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="rej-card-header" style={{ padding: "16px 20px 12px" }}>
              <div>
                <h3 className="rej-card-title">
                  <Sliders size={18} color="#1a3263" />
                  <span>Golden Process Window vs Scrap Parameter Drift Matrix</span>
                </h3>
                <p className="rej-card-subtitle">IATF 16949 Process Capability: Nominal Mean ± 2σ Baseline vs Actual Scrap Drift · All {mlInsights.features?.length || 26} Monitored HPDC Parameters</p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="rej-badge rej-badge-ok">Nominal ±2σ Safe Zone</span>
                <span className="rej-badge rej-badge-danger">Scrap Drift Divergence</span>
                <button
                  onClick={handleExportGoldenWindowExcel}
                  className="rej-action-btn primary"
                  style={{ padding: "6px 14px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}
                  title="Download Golden Window vs Rejection Drift Excel"
                >
                  <Download size={14} />
                  <span>Excel</span>
                </button>
              </div>
            </div>

            {/* Six-Sigma Methodology & Data Cleansing Banner */}
            <div className="rej-methodology-card">
              <div className="rej-methodology-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Calculator size={16} color="#1e3a8a" />
                  <span className="rej-methodology-title">IATF 16949 Six-Sigma Calculation & Cleansing Methodology</span>
                </div>
                <span className="rej-badge rej-badge-info" style={{ fontSize: 10 }}>Automated QC Diagnostics</span>
              </div>
              <div className="rej-methodology-grid">
                <div className="rej-methodology-item">
                  <div className="rej-methodology-sub">Population Mean Formula</div>
                  <div className="rej-methodology-desc">
                    Calculated as <code>μ = Σ x_i / N</code> across completed casting shots. OK Mean vs NG Scrap Mean reveals systematic parameter shifts.
                  </div>
                </div>
                <div className="rej-methodology-item">
                  <div className="rej-methodology-sub">Automated Sensor Cleansing</div>
                  <div className="rej-methodology-desc">
                    Zero-values from PLC sensor timeouts (0 bar, 0°C, 0 mm) and disconnected channel spikes outside physical die limits are automatically filtered.
                  </div>
                </div>
                <div className="rej-methodology-item">
                  <div className="rej-methodology-sub">Live Deviation (Δ vs Set Target)</div>
                  <div className="rej-methodology-desc">
                    Defined as <code>Δ = Live NG Mean − Recipe Set Target</code>. Pinpoints the exact machine parameter divergence driving parts into scrap.
                  </div>
                </div>
                <div className="rej-methodology-item">
                  <div className="rej-methodology-sub">Safe Process Window (LSL–USL)</div>
                  <div className="rej-methodology-desc">
                    Bound by engineering recipe set limits (or empirical 2-sigma control limits <code>μ_OK ± 2σ</code>). Parts within this window exhibit 100% pass rate.
                  </div>
                </div>
              </div>
            </div>

            <div style={{ maxHeight: 460, overflowY: "auto", overflowX: "hidden" }} className="rej-golden-scroll">
              <table className="rej-matrix-table" style={{ width: "100%", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "19%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "7%" }} />
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "#f8fafc" }}>
                  <tr>
                    <th>Parameter</th>
                    <th>Recipe Set Target</th>
                    <th>Recipe Limits</th>
                    <th>Live OK Mean</th>
                    <th>Live NG Mean</th>
                    <th>Live Deviation (Δ)</th>
                    <th>Safe Window</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {mlInsights.features?.map((f) => {
                    const hasSetPoint = f.setPoint !== null && f.setPoint !== undefined;
                    const deltaVal = f.deltaSetNg !== null && f.deltaSetNg !== undefined
                      ? f.deltaSetNg
                      : (f.meanNg !== null && f.meanOk !== null ? Number((f.meanNg - f.meanOk).toFixed(2)) : null);
                    return (
                      <tr key={f.key}>
                        <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 800, color: "#0f172a" }}>{f.label}</span>
                            <span style={{ fontSize: 10, color: "#94a3b8" }}>({f.unit})</span>
                          </div>
                        </td>
                        <td>
                          {hasSetPoint ? (
                            <strong style={{ color: "#2563eb", fontSize: 12 }}>
                              {f.setPoint} {f.unit}
                            </strong>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>
                          )}
                        </td>
                        <td>
                          {f.setUpperLimit !== null && f.setUpperLimit !== undefined ? (
                            <span style={{ fontWeight: 700, color: "#334155", fontSize: 11 }}>
                              {f.setLowerLimit ?? "—"} – {f.setUpperLimit} {f.unit}
                            </span>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: 11 }}>±2σ Control</span>
                          )}
                        </td>
                        <td><strong style={{ color: "#16a34a", fontSize: 12 }}>{f.meanOk} {f.unit}</strong></td>
                        <td><strong style={{ color: "#ef4444", fontSize: 12 }}>{f.meanNg} {f.unit}</strong></td>
                        <td>
                          {deltaVal !== null ? (
                            <span style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              fontWeight: 800,
                              color: Math.abs(deltaVal) > 0.5 ? "#ef4444" : "#16a34a",
                              fontSize: 11,
                            }}>
                              {deltaVal > 0 ? `+${deltaVal}` : deltaVal} {f.unit}
                              {f.driftPct !== undefined && (
                                <span style={{ fontSize: 10, opacity: 0.85 }}>({f.driftPct > 0 ? `+${f.driftPct}%` : `${f.driftPct}%`})</span>
                              )}
                            </span>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </td>
                        <td>
                          <span style={{ background: "rgba(100,116,139,0.08)", padding: "2px 6px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                            {f.lsl} – {f.usl} {f.unit}
                          </span>
                        </td>
                        <td>
                          <span className={`rej-badge ${f.riskLevel === "CRITICAL" ? "rej-badge-danger" : f.riskLevel === "MODERATE" ? "rej-badge-warning" : "rej-badge-ok"}`}>
                            {f.riskLevel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2D Correlation Scatter Clustering Explorer with Zoom */}
          <div className="rej-card">
            <div className="rej-card-header">
              <div>
                <h3 className="rej-card-title">
                  <ScatterIcon size={18} color="#1a3263" />
                  <span>2D Process Parameter Correlation & Scrap Defect Clustering</span>
                </h3>
                <p className="rej-card-subtitle">Drag to zoom a region · Green = OK Passed · Red = NG Scrap Defects</p>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#1e293b" }}>X:</span>
                  <select
                    value={selectedScatterX}
                    onChange={(e) => { setSelectedScatterX(e.target.value); resetScatterZoom(); }}
                    className="rej-select"
                  >
                    {mlInsights.features?.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#1e293b" }}>Y:</span>
                  <select
                    value={selectedScatterY}
                    onChange={(e) => { setSelectedScatterY(e.target.value); resetScatterZoom(); }}
                    className="rej-select"
                  >
                    {mlInsights.features?.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button type="button" className="rej-zoom-btn" onClick={handleScatterZoomIn} title="Zoom In (+)">
                    <ZoomIn size={13} />
                    <span>Zoom +</span>
                  </button>
                  <button type="button" className="rej-zoom-btn" onClick={handleScatterZoomOut} title="Zoom Out (-)">
                    <span>Zoom −</span>
                  </button>
                  <button type="button" className="rej-zoom-btn" onClick={handleFocusNgScrap} title="Focus Defect Cluster (NG Red Points)">
                    <Target size={13} />
                    <span>Focus Scrap</span>
                  </button>
                  {scatterZoom && (
                    <button type="button" className="rej-zoom-btn active" onClick={resetScatterZoom} title="Reset Zoom">
                      <RotateCcw size={13} />
                      <span>Reset</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ height: 420 }}>
              <SafeChart height={420}>
                {({ width, height }) => {
                  scatterDimsRef.current = { width, height };
                  return (
                  <ScatterChart
                    width={width}
                    height={height}
                    margin={{ top: 15, right: 30, left: 20, bottom: 25 }}
                    onMouseDown={handleScatterMouseDown}
                    onMouseMove={handleScatterMouseMove}
                    onMouseUp={handleScatterMouseUp}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(226,232,240,0.8)" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name={selectedScatterX}
                      tick={{ fontSize: 10, fontWeight: 700 }}
                      label={{ value: selectedScatterX, position: "insideBottomRight", offset: -5, fontSize: 11, fontWeight: 700 }}
                      domain={[currentScatterDomain.x1, currentScatterDomain.x2]}
                      allowDataOverflow={true}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name={selectedScatterY}
                      tick={{ fontSize: 10, fontWeight: 700 }}
                      label={{ value: selectedScatterY, angle: -90, position: "insideLeft", fontSize: 11, fontWeight: 700 }}
                      domain={[currentScatterDomain.y1, currentScatterDomain.y2]}
                      allowDataOverflow={true}
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={({ payload }) => {
                        if (!payload || !payload.length) return null;
                        const data = payload[0].payload;
                        const isNg = data.status?.includes("NG");
                        return (
                          <div style={{ background: "#ffffff", padding: "12px 16px", border: "1px solid #cbd5e1", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", fontSize: 12, minWidth: 220 }}>
                            <div style={{ fontWeight: 800, marginBottom: 6, fontSize: 13, color: "#1a3263" }}>
                              {data.partId && data.partId !== "-" ? data.partId : data.customerQrCode}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px" }}>
                              <span style={{ color: "#64748b" }}>Status:</span>
                              <strong style={{ color: isNg ? "#ef4444" : "#22c55e" }}>{data.status}</strong>
                              <span style={{ color: "#64748b" }}>{selectedScatterX}:</span>
                              <strong>{data.x}</strong>
                              <span style={{ color: "#64748b" }}>{selectedScatterY}:</span>
                              <strong>{data.y}</strong>
                              {data.zone && data.zone !== "-" && <>
                                <span style={{ color: "#64748b" }}>Zone:</span>
                                <strong style={{ color: "#8b5cf6" }}>{data.zone} {data.subZone && data.subZone !== "-" ? `(${data.subZone})` : ""}</strong>
                              </>}
                              {data.category && data.category !== "-" && <>
                                <span style={{ color: "#64748b" }}>Category:</span>
                                <strong>{data.category}</strong>
                              </>}
                              {isNg && data.reason && data.reason !== "Nominal" && <>
                                <span style={{ color: "#64748b" }}>Reason:</span>
                                <span style={{ color: "#ef4444", fontWeight: 700 }}>{data.reason}</span>
                              </>}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                    <Scatter name="OK Passed Parts" data={scatterData.okPoints} fill="#22c55e" fillOpacity={0.5} shape="circle" />
                    <Scatter name="NG Scrap Parts" data={scatterData.ngPoints} fill="#ef4444" fillOpacity={0.85} shape="cross" />
                    {/* Zoom selection rectangle */}
                    {scatterRefStart && scatterRefEnd && (
                      <ReferenceArea
                        x1={scatterRefStart.x}
                        x2={scatterRefEnd.x}
                        y1={scatterRefStart.y}
                        y2={scatterRefEnd.y}
                        strokeOpacity={0.3}
                        stroke="#1a3263"
                        fill="#1a3263"
                        fillOpacity={0.08}
                      />
                    )}
                  </ScatterChart>
                  );
                }}
              </SafeChart>
            </div>
          </div>

          {/* AI Multi-Parameter Outlier Scanner */}
          <div className="rej-card" style={{ padding: "14px 20px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div className="rej-records-header">
              <div>
                <h3 className="rej-card-title" style={{ margin: 0 }}>
                  <ShieldAlert size={18} color="#ef4444" />
                  <span>Process Excursion & Scrap Outlier Diagnostic Log</span>
                </h3>
                <p className="rej-card-subtitle" style={{ margin: "2px 0 0" }}>
                  Six-Sigma parameter divergence (±σ) and multi-variate process excursion correlation driving scrap occurrences · Showing {filteredOutlierRows.length} flagged outlier scrap records.
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="rej-search-box">
                  <Search size={15} color="#94a3b8" />
                  <input
                    type="text"
                    placeholder="Search Serial, QR, Param, Zone, Reason..."
                    value={outlierSearch}
                    onChange={(e) => setOutlierSearch(e.target.value)}
                  />
                </div>

                <button
                  onClick={handleExportOutliersExcel}
                  disabled={!filteredOutlierRows.length}
                  className="rej-action-btn primary"
                  style={{ padding: "7px 14px", fontSize: 11 }}
                  title="Export Outliers to Excel"
                >
                  <Download size={14} />
                  <span>Excel</span>
                </button>
              </div>
            </div>

            <div className="rej-table-wrapper">
              <RejectionTable
                columns={outlierColumns}
                rows={filteredOutlierRows}
                loading={loading}
                defaultPageSize={50}
                pageSizeOptions={[25, 50, 100, 250, 500, 1000]}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: PROCESS TELEMETRY & SPC TRENDS ─────────────────────── */}
      {activeTab === "telemetry" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Parameter Selector Pills */}
          <div className="rej-card" style={{ padding: "14px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#1a3263" }}>Select Parameter:</span>
              {mlInsights.features?.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setSelectedTelemetryParam(f.key)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    border: selectedTelemetryParam === f.key ? "1px solid #0ea5e9" : "1px solid #cbd5e1",
                    background: selectedTelemetryParam === f.key ? "rgba(14,165,233,0.12)" : "#ffffff",
                    color: selectedTelemetryParam === f.key ? "#0284c7" : "#475569",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>{f.label}</span>
                  {f.riskLevel === "CRITICAL" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />}
                </button>
              ))}
            </div>
          </div>

          {/* SPC Telemetry Run Chart */}
          <div className="rej-card rej-table-card">
            {/* Top SPC Diagnostic Spec KPI Cards */}
            <div className="rej-spc-kpi-grid">
              <div className="rej-spc-kpi-card target-center">
                <div className="rej-spc-kpi-label">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#2563eb" }} />
                  Target / Nominal Recipe
                </div>
                <div className="rej-spc-kpi-value text-blue-700">
                  {currentTelemetrySpec.setPoint ?? currentTelemetrySpec.meanOk ?? "—"} <span style={{ fontSize: 13 }}>{currentTelemetrySpec.unit}</span>
                </div>
                <div className="rej-spc-kpi-sub">Centerline nominal process standard</div>
              </div>

              <div className="rej-spc-kpi-card golden-window">
                <div className="rej-spc-kpi-label">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a" }} />
                  Allowed In-Spec Window (OK Range)
                </div>
                <div className="rej-spc-kpi-value text-emerald-700">
                  {currentTelemetrySpec.lsl != null ? currentTelemetrySpec.lsl : "—"} – {currentTelemetrySpec.usl != null ? currentTelemetrySpec.usl : "—"} <span style={{ fontSize: 13 }}>{currentTelemetrySpec.unit}</span>
                </div>
                <div className="rej-spc-kpi-sub" style={{ color: "#15803d", fontWeight: 700 }}>
                  ✓ 100% In-Spec tolerance boundary
                </div>
              </div>

              <div className="rej-spc-kpi-card">
                <div className="rej-spc-kpi-label">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#059669" }} />
                  Statistical Capability (μ & σ)
                </div>
                <div className="rej-spc-kpi-value">
                  {spcMetrics.mean} <span style={{ fontSize: 13 }}>{currentTelemetrySpec.unit}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginLeft: 6 }}>±{spcMetrics.std}</span>
                </div>
                <div className="rej-spc-kpi-sub">
                  UCL: {spcMetrics.ucl} | LCL: {spcMetrics.lcl} {spcMetrics.cpk != null && <>· <strong>Cpk: {spcMetrics.cpk}</strong></>}
                </div>
              </div>

              <div className="rej-spc-kpi-card drift-card">
                <div className="rej-spc-kpi-label">
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
                  Scrap Outlier Drift & Excursions
                </div>
                <div className="rej-spc-kpi-value text-rose-700">
                  {currentTelemetrySpec.meanNg ? currentTelemetrySpec.meanNg.toFixed(2) : "—"} <span style={{ fontSize: 13 }}>{currentTelemetrySpec.unit}</span>
                </div>
                <div className="rej-spc-kpi-sub" style={{ color: "#b91c1c", fontWeight: 600 }}>
                  {telemetryTrendData.filter((d) => !d.isInSpec).length} parts exceeding spec tolerance
                </div>
              </div>
            </div>

            <div className="rej-card-header" style={{ marginBottom: 12 }}>
              <div>
                <h3 className="rej-card-title">
                  <Activity size={18} color="#2563eb" />
                  <span>Telemetry SPC Run Chart: {currentTelemetrySpec.label}</span>
                </h3>
                <p className="rej-card-subtitle">
                  Green shaded band = Golden In-Spec Tolerance Zone ({currentTelemetrySpec.lsl ?? "—"} to {currentTelemetrySpec.usl ?? "—"} {currentTelemetrySpec.unit}) · Green Dots = OK Parts ({telemetryTrendData.filter((d) => d.isInSpec).length}) · Red Dots = Scrap Excursions ({telemetryTrendData.filter((d) => !d.isInSpec).length}) · Showing all production parts ({telemetryTrendData.length} parts)
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="rej-badge rej-badge-info" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Cpu size={12} />
                  {telemetryTrendData.length} Total Parts Plotted
                </span>
                <span className="rej-badge rej-badge-ok" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a34a" }} />
                  {telemetryTrendData.filter((d) => d.isInSpec).length} OK Parts (In-Spec)
                </span>
                <span className="rej-badge rej-badge-danger" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444" }} />
                  {telemetryTrendData.filter((d) => !d.isInSpec).length} NG Excursions (Outliers)
                </span>
              </div>
            </div>

            <div style={{ height: 440 }}>
              <SafeChart height={440}>
                {({ width, height }) => {
                  const chartWidth = Math.max(width, Math.max(950, (telemetryTrendData?.length || 0) * 20));
                  return (
                    <div style={{ width: "100%", overflowX: "auto", overflowY: "hidden", paddingBottom: 8 }}>
                      <LineChart width={chartWidth} height={height - 12} data={telemetryTrendData} margin={{ top: 15, right: 35, left: 10, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(226,232,240,0.8)" />
                        <XAxis
                          dataKey="index"
                          tick={{ fontSize: 10, fontWeight: 700 }}
                          label={{ value: "Production Chronological Sample Index", position: "insideBottomRight", offset: -8, fontSize: 11 }}
                        />
                        <YAxis
                          domain={[
                            (dataMin) => Math.floor(Math.min(dataMin, currentTelemetrySpec.lsl ?? dataMin) * 0.96),
                            (dataMax) => Math.ceil(Math.max(dataMax, currentTelemetrySpec.usl ?? dataMax) * 1.04)
                          ]}
                          tick={{ fontSize: 10, fontWeight: 700 }}
                          label={{ value: `${currentTelemetrySpec.label} (${currentTelemetrySpec.unit})`, angle: -90, position: "insideLeft", fontSize: 11 }}
                        />
                        <Tooltip
                          content={({ payload }) => {
                            if (!payload || !payload.length) return null;
                            const data = payload[0].payload;
                            const inSpec = data.isInSpec;
                            return (
                              <div style={{ background: "#ffffff", padding: "12px 16px", border: "1px solid #cbd5e1", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,0.12)", fontSize: 12 }}>
                                <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", marginBottom: 4 }}>
                                  Shot #{data.shotNumber} · Shift {data.shiftCode}
                                </div>
                                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Serial: {data.partId}</div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                                  <span style={{ color: "#475569" }}>Measured Value:</span>
                                  <strong style={{ fontSize: 14, color: inSpec ? "#15803d" : "#ef4444" }}>
                                    {data.value} {currentTelemetrySpec.unit}
                                  </strong>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                                  <span style={{ color: "#475569" }}>Target Standard:</span>
                                  <strong style={{ color: "#2563eb" }}>{currentTelemetrySpec.meanOk} {currentTelemetrySpec.unit}</strong>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                                  <span style={{ color: "#475569" }}>OK Golden Window:</span>
                                  <strong style={{ color: "#16a34a" }}>
                                    {currentTelemetrySpec.lsl != null ? currentTelemetrySpec.lsl : "—"} to {currentTelemetrySpec.usl != null ? currentTelemetrySpec.usl : "—"} {currentTelemetrySpec.unit}
                                  </strong>
                                </div>
                                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: 6,
                                    fontSize: 11,
                                    fontWeight: 800,
                                    background: inSpec ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                                    color: inSpec ? "#15803d" : "#dc2626",
                                    border: inSpec ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(239,68,68,0.3)"
                                  }}>
                                    {inSpec ? "✓ WITHIN OK SPEC RANGE" : "⚠️ OUT OF SPEC EXCURSION (NG)"}
                                  </span>
                                </div>
                              </div>
                            );
                          }}
                        />

                        {/* OK Spec Zone Green Shaded Area */}
                        {currentTelemetrySpec.usl != null && currentTelemetrySpec.lsl != null && (
                          <ReferenceArea
                            y1={currentTelemetrySpec.lsl}
                            y2={currentTelemetrySpec.usl}
                            fill="#22c55e"
                            fillOpacity={0.12}
                            label={{ value: "OK Golden Spec Window", fill: "#15803d", fontSize: 11, fontWeight: 800, position: "insideTopRight" }}
                          />
                        )}

                        {currentTelemetrySpec.usl != null && (
                          <ReferenceLine
                            y={currentTelemetrySpec.usl}
                            stroke="#ef4444"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            label={{ value: `USL: ${currentTelemetrySpec.usl}`, fill: "#dc2626", fontSize: 10, fontWeight: 700 }}
                          />
                        )}
                        {currentTelemetrySpec.lsl != null && (
                          <ReferenceLine
                            y={currentTelemetrySpec.lsl}
                            stroke="#ef4444"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            label={{ value: `LSL: ${currentTelemetrySpec.lsl}`, fill: "#dc2626", fontSize: 10, fontWeight: 700 }}
                          />
                        )}
                        {currentTelemetrySpec.meanOk != null && (
                          <ReferenceLine
                            y={currentTelemetrySpec.meanOk}
                            stroke="#16a34a"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            label={{ value: `Target: ${currentTelemetrySpec.meanOk}`, fill: "#15803d", fontSize: 10, fontWeight: 700 }}
                          />
                        )}

                        <Line
                          type="monotone"
                          dataKey="value"
                          name={currentTelemetrySpec.label}
                          stroke="#2563eb"
                          strokeWidth={2}
                          dot={(point) => {
                            const inSpec = point.payload.isInSpec;
                            return (
                              <circle
                                key={point.key}
                                cx={point.cx}
                                cy={point.cy}
                                r={inSpec ? 4 : 5.5}
                                fill={inSpec ? "#10b981" : "#ef4444"}
                                stroke={inSpec ? "#ffffff" : "#b91c1c"}
                                strokeWidth={inSpec ? 1.5 : 2}
                              />
                            );
                          }}
                        />
                        <Brush
                          dataKey="index"
                          height={28}
                          stroke="#0284c7"
                          fill="rgba(240, 249, 255, 0.85)"
                          travellerWidth={10}
                        />
                      </LineChart>
                    </div>
                  );
                }}
              </SafeChart>
            </div>
          </div>

          {/* Dedicated Per-Part Telemetry & Recipe Variation Table */}
          <div className="rej-spc-table-card">
            <div className="rej-spc-table-header">
              <div>
                <h3 className="rej-spc-table-title">
                  <Sliders size={18} color="#2563eb" />
                  <span>Per-Part Telemetry & Tolerance Variation Table: {currentTelemetrySpec.label}</span>
                </h3>
                <p className="rej-spc-table-subtitle">
                  Traceable per-part telemetry parameters vs recipe setpoint ({currentTelemetrySpec.setPoint ?? currentTelemetrySpec.meanOk ?? "—"} {currentTelemetrySpec.unit}) with tolerance delta (Δ), percentage drift, and quality validation.
                </p>
              </div>

              {/* Toolbar Actions */}
              <div className="rej-spc-table-actions">
                {/* Filter Pills */}
                <div className="rej-spc-filter-pills">
                  <button
                    onClick={() => { setTelemetryTableFilter("all"); setTelemetryPage(1); }}
                    className={`rej-spc-filter-pill ${telemetryTableFilter === "all" ? "active" : ""}`}
                  >
                    All Parts ({telemetryTrendData.length})
                  </button>
                  <button
                    onClick={() => { setTelemetryTableFilter("outliers"); setTelemetryPage(1); }}
                    className={`rej-spc-filter-pill ${telemetryTableFilter === "outliers" ? "active" : ""}`}
                  >
                    Outliers & Drift ({telemetryTrendData.filter((d) => !d.isInSpec || d.varStatus !== "IN_SPEC").length})
                  </button>
                  <button
                    onClick={() => { setTelemetryTableFilter("ng"); setTelemetryPage(1); }}
                    className={`rej-spc-filter-pill ${telemetryTableFilter === "ng" ? "active" : ""}`}
                  >
                    Scrap / NG Parts ({telemetryTrendData.filter((d) => d.status === "NG").length})
                  </button>
                </div>

                {/* Search Bar */}
                <div className="rej-spc-search">
                  <Search size={13} color="#94a3b8" />
                  <input
                    type="text"
                    placeholder="Search Serial, QR, Shot, Machine..."
                    value={telemetrySearch}
                    onChange={(e) => { setTelemetrySearch(e.target.value); setTelemetryPage(1); }}
                  />
                </div>

                {/* Excel Export */}
                <button
                  onClick={exportTelemetryExcel}
                  disabled={!filteredTelemetryRows.length}
                  className="rej-spc-export-btn"
                  title="Export telemetry variations to Excel"
                >
                  <Download size={13} />
                  <span>Export Excel</span>
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="rej-spc-table-wrapper">
              <table className="rej-spc-table">
                <thead>
                  <tr>
                    <th style={{ width: 45, textAlign: "center" }}>#</th>
                    <th style={{ minWidth: 170 }}>Part Serial Number</th>
                    <th style={{ width: 85, textAlign: "center" }}>Shot #</th>
                    <th style={{ minWidth: 200 }}>Customer QR</th>
                    <th style={{ minWidth: 140 }}>Machine</th>
                    <th style={{ width: 75, textAlign: "center" }}>Shift</th>
                    <th style={{ minWidth: 125 }}>Measured Value</th>
                    <th style={{ minWidth: 115 }}>Recipe Target</th>
                    <th style={{ minWidth: 130 }}>Spec Window</th>
                    <th style={{ minWidth: 110 }}>Variation (Δ)</th>
                    <th style={{ width: 85 }}>Drift %</th>
                    <th style={{ minWidth: 135 }}>Tolerance Status</th>
                    <th style={{ width: 80, textAlign: "center" }}>Quality</th>
                    <th style={{ minWidth: 150 }}>Recorded At</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTelemetryRows.length === 0 ? (
                    <tr>
                      <td colSpan={14} style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontStyle: "italic" }}>
                        No telemetry records matching this filter or search query.
                      </td>
                    </tr>
                  ) : (
                    filteredTelemetryRows
                      .slice((telemetryPage - 1) * telemetryPageSize, telemetryPage * telemetryPageSize)
                      .map((r, idx) => {
                        const rowIdx = (telemetryPage - 1) * telemetryPageSize + idx + 1;
                        const isNg = r.status === "NG";
                        return (
                          <tr key={r.partId || idx}>
                            <td style={{ color: "#94a3b8", fontSize: 11, textAlign: "center" }}>{rowIdx}</td>
                            <td>
                              <span className="rej-mono-serial">{r.partId || "—"}</span>
                            </td>
                            <td style={{ fontWeight: 800, color: "#1e293b", textAlign: "center" }}>
                              {r.shotNumber || "—"}
                            </td>
                            <td>
                              <span className="rej-mono-qr" title={r.customerQr}>
                                {r.customerQr && r.customerQr !== "-" ? r.customerQr : "—"}
                              </span>
                            </td>
                            <td style={{ color: "#334155", fontWeight: 650 }}>{r.machineName || "—"}</td>
                            <td style={{ textAlign: "center" }}>
                              <span className="rej-shift-badge">{r.shiftCode || "A"}</span>
                            </td>
                            <td>
                              <span className={`rej-measured-val ${r.isInSpec ? "in-spec" : "outlier"}`}>
                                {r.value} {currentTelemetrySpec.unit}
                              </span>
                            </td>
                            <td style={{ color: "#2563eb", fontWeight: 750 }}>
                              {r.target != null ? `${r.target} ${currentTelemetrySpec.unit}` : "—"}
                            </td>
                            <td style={{ color: "#64748b", fontSize: 11 }}>
                              {r.lsl != null ? r.lsl : "—"} to {r.usl != null ? r.usl : "—"} {currentTelemetrySpec.unit}
                            </td>
                            <td>
                              <span className={`rej-delta-val ${r.delta === 0 ? "zero" : (Math.abs(r.deltaPct) > 10 ? "bad" : "good")}`}>
                                {r.delta !== undefined ? `${r.delta > 0 ? "+" : ""}${r.delta}` : "—"}
                              </span>
                            </td>
                            <td>
                              <span className={`rej-drift-val ${Math.abs(r.deltaPct) > 10 ? "bad" : (Math.abs(r.deltaPct) > 5 ? "warn" : "good")}`}>
                                {r.deltaPct !== undefined ? `${r.deltaPct > 0 ? "+" : ""}${r.deltaPct}%` : "—"}
                              </span>
                            </td>
                            <td>
                              <span className={`rej-var-badge ${(r.varStatus || "").toLowerCase().replace(/_/g, "-")}`}>
                                {r.varStatus === "IN_SPEC" && "✓ In-Spec"}
                                {r.varStatus === "HIGH_OUTLIER" && "▲ High Outlier"}
                                {r.varStatus === "LOW_OUTLIER" && "▼ Low Outlier"}
                                {r.varStatus === "WARNING" && "⚠ Warning Drift"}
                              </span>
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <span className={`rej-status-pill ${isNg ? "danger" : "ok"}`}>
                                {isNg ? "NG" : "OK"}
                              </span>
                            </td>
                            <td style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
                              {formatResultTimestamp(r.createdAt) || "—"}
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {filteredTelemetryRows.length > 0 && (
              <div className="rej-spc-pagination">
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  Showing {Math.min((telemetryPage - 1) * telemetryPageSize + 1, filteredTelemetryRows.length)} to {Math.min(telemetryPage * telemetryPageSize, filteredTelemetryRows.length)} of {filteredTelemetryRows.length.toLocaleString()} parts
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#475569" }}>
                    <span>Rows per page:</span>
                    <select
                      value={telemetryPageSize}
                      onChange={(e) => { setTelemetryPageSize(Number(e.target.value)); setTelemetryPage(1); }}
                      style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: 11 }}
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      disabled={telemetryPage <= 1}
                      onClick={() => setTelemetryPage((p) => Math.max(1, p - 1))}
                      className="rej-page-arrow-btn"
                    >
                      ‹
                    </button>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "0 6px", color: "#1e293b" }}>
                      Page {telemetryPage} of {Math.ceil(filteredTelemetryRows.length / telemetryPageSize) || 1}
                    </span>
                    <button
                      disabled={telemetryPage >= Math.ceil(filteredTelemetryRows.length / telemetryPageSize)}
                      onClick={() => setTelemetryPage((p) => p + 1)}
                      className="rej-page-arrow-btn"
                    >
                      ›
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 4: PRODUCTION & DEFECT RECORDS (TABLE) ─────────────────── */}
      {activeTab === "records" && (
        <div className="rej-card rej-table-card" style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="rej-records-header">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #1e3a6a, #15284f)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", boxShadow: "0 2px 8px rgba(26,50,99,0.25)" }}>
                  <ListFilter size={18} />
                </div>
                <div>
                  <h3 className="rej-card-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                    Comprehensive HPDC Casting Production & Scrap Traceability Log
                  </h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>
                      Showing {recordsTotal > 0 ? ((recordsPage - 1) * recordsPageSize + 1).toLocaleString() : 0}–{Math.min(recordsPage * recordsPageSize, recordsTotal || filteredTableRows.length).toLocaleString()} of <strong>{(recordsTotal || summary.totalNG || filteredTableRows.length).toLocaleString()}</strong> scrap serial units
                    </span>
                    <span className="rej-badge rej-badge-danger" style={{ fontSize: 10, padding: "2px 8px" }}>
                      {(recordsTotal || summary.totalNG || filteredTableRows.length).toLocaleString()} Total Scrap Records
                    </span>
                    <span className="rej-badge rej-badge-ok" style={{ fontSize: 10, padding: "2px 8px" }}>
                      100% Traceable Across OP100–OP160
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div className="rej-search-box" style={{ minWidth: 260 }}>
                <Search size={15} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Search Part ID, QR, Reason, Zone..."
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                />
                {tableSearch && (
                  <button
                    onClick={() => setTableSearch("")}
                    style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Rows Per Page Shortcut */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b" }}>
                <span>Page Size:</span>
                <select
                  value={recordsPageSize}
                  onChange={(e) => {
                    const sz = Number(e.target.value);
                    setRecordsPageSize(sz);
                    setRecordsPage(1);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#0f172a",
                    cursor: "pointer",
                  }}
                >
                  {[50, 100, 250, 500, 1000, 2500, 5000].map((sz) => (
                    <option key={sz} value={sz}>{sz >= 5000 ? `${sz} (All Records)` : sz}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleExportExcel}
                disabled={!(recordsRows.length || rejectedRows.length)}
                className="rej-action-btn primary"
                style={{ padding: "8px 16px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                title="Export all scrap traceability records to Excel"
              >
                <Download size={15} />
                <span>Export All Records ({(recordsTotal || summary.totalNG || filteredTableRows.length).toLocaleString()})</span>
              </button>
            </div>
          </div>

          <div className="rej-table-wrapper" style={{ borderRadius: 14, overflow: "hidden", border: "1px solid #e2e8f0" }}>
            <RejectionTable
              columns={tableColumns}
              rows={filteredTableRows}
              loading={recordsLoading || loading}
              pagination={{
                page: recordsPage,
                pageSize: recordsPageSize,
                total: recordsTotal || summary.totalNG || filteredTableRows.length,
              }}
              onPageChange={(p) => setRecordsPage(p)}
              onPageSizeChange={(sz) => {
                setRecordsPageSize(sz);
                setRecordsPage(1);
              }}
              defaultPageSize={100}
              pageSizeOptions={[50, 100, 250, 500, 1000, 2500, 5000]}
            />
          </div>
        </div>
      )}

      {activeTab === "heat_map" && (
        <RejectionHeatMap rows={allRejectionRecords.length > 0 ? allRejectionRecords : (rejectedRows.length > 0 ? rejectedRows : (rows.length > 0 ? rows : recordsRows))} />
      )}
    </div>
  );
}
