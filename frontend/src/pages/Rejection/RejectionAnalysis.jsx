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
  X,
  Plus,
  ArrowLeft,
  QrCode,
  Droplets,
  Thermometer,
  LayoutList
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  LineChart,
  AreaChart,
  Area,
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
import { dashboardApi, machineApi, rejectionConfigApi, organizationApi } from "../../api/services";
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

// ═══════════════════════════════════════════════════════════════════════════
// ── 4 USER-SPECIFIED PARAMETER CATEGORIES (Total 45 Parameters) ───────────
// ═══════════════════════════════════════════════════════════════════════════

// 1. Machine Process Parameter — 9
export const MACHINE_PROCESS_PARAMETERS = [
  { id: 1, sNo: 1, key: "plc_cycle_time", altKeys: ["cycleTime", "cycle_time"], label: "Cycle Time", unit: "sec", color: "#16a34a", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "clock", hasStaticLimits: false },
  { id: 2, sNo: 2, key: "die_open_core_out_time", altKeys: ["dieOpenTime", "die_open_time", "die_open_core_out_time"], label: "Die Open Core Out Time", unit: "sec", color: "#10b981", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "clock", hasStaticLimits: false },
  { id: 3, sNo: 3, key: "die_close_core_in_time", altKeys: ["dieCloseTime", "die_close_time", "die_close_core_in_time"], label: "Die-Close Core In Time", unit: "sec", color: "#06b6d4", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "clock", hasStaticLimits: false },
  { id: 4, sNo: 4, key: "ejector_time", altKeys: ["ejectorTime", "ejector_time"], label: "Ejector Time", unit: "sec", color: "#d946ef", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "clock", hasStaticLimits: false },
  { id: 5, sNo: 5, key: "extract_time", altKeys: ["extractTime", "extract_time"], label: "Extract Time", unit: "sec", color: "#6366f1", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "clock", hasStaticLimits: false },
  { id: 6, sNo: 6, key: "pouring_time", altKeys: ["pouringTime", "pouring_time"], label: "Pouring Time", unit: "sec", color: "#f97316", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "clock", hasStaticLimits: false },
  { id: 7, sNo: 7, key: "shot_fwd_time", altKeys: ["shotFwdTime", "shot_fwd_time"], label: "Shot FWD Time", unit: "sec", color: "#0ea5e9", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "clock", hasStaticLimits: false },
  { id: 8, sNo: 8, key: "spray_time", altKeys: ["sprayTime", "spray_time"], label: "Spray Time", unit: "sec", color: "#ec4899", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "droplet", hasStaticLimits: false },
  { id: 9, sNo: 9, key: "curing_time", altKeys: ["curingTime", "curing_time", "cooling_time"], label: "Curing Time (Cooling Time)", unit: "sec", color: "#3b82f6", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "hourglass", hasStaticLimits: false },
];

// 2. Product Parameter — 22
export const PRODUCT_PARAMETERS = [
  { id: 10, sNo: 1, key: "clamp_tonnage_he_low_mn", altKeys: ["clampTonnageHeLowMn", "clamp_tonnage_he_low_mn", "clamp_tonnage"], label: "Clamp Tonnage (HE.Low)", unit: "MN", color: "#6366f1", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "shield", hasStaticLimits: false },
  { id: 11, sNo: 2, key: "clamp_tonnage_he_up_pct", altKeys: ["clampTonnageHeUpPct", "clamp_tonnage_he_up_pct"], label: "Clamp Tonnage (HE.Up)", unit: "%", color: "#4f46e5", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "shield", hasStaticLimits: false },
  { id: 12, sNo: 3, key: "clamp_tonnage_op_low_pct", altKeys: ["clampTonnageOpLowPct", "clamp_tonnage_op_low_pct"], label: "Clamp Tonnage (OP.Low)", unit: "%", color: "#4338ca", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "shield", hasStaticLimits: false },
  { id: 13, sNo: 4, key: "clamp_tonnage_op_up_pct", altKeys: ["clampTonnageOpUpPct", "clamp_tonnage_op_up_pct"], label: "Clamp Tonnage (OP.Up)", unit: "%", color: "#3730a3", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "shield", hasStaticLimits: false },
  { id: 14, sNo: 5, key: "average_die_clamp_tonnage_count", altKeys: ["averageDieClampTonnageCount", "average_die_clamp_tonnage_count"], label: "Average Die Clamp Tonnage Count", unit: "T", color: "#84cc16", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "shield", hasStaticLimits: false },
  { id: 15, sNo: 6, key: "accel_point", altKeys: ["accelPoint", "accel_point"], label: "Accel. Point", unit: "mm", color: "#9333ea", defaultLower: 300.0, defaultUpper: 400.0, setPoint: 350.0, category: "Product Parameter", categoryId: "product_params", icon: "activity", hasStaticLimits: true },
  { id: 16, sNo: 7, key: "deaccel_point", altKeys: ["deaccelPoint", "deaccel_point"], label: "Deaccel. Point", unit: "mm", color: "#c026d3", defaultLower: 700.0, defaultUpper: 730.0, setPoint: 715.0, category: "Product Parameter", categoryId: "product_params", icon: "activity", hasStaticLimits: true },
  { id: 17, sNo: 8, key: "clamp_tonnage", altKeys: ["clampTonnage", "clamp_tonnage"], label: "Clamp Tonnage", unit: "T", color: "#65a30d", defaultLower: 550.0, defaultUpper: 650.0, setPoint: 600.0, category: "Product Parameter", categoryId: "product_params", icon: "shield", hasStaticLimits: true },
  { id: 18, sNo: 9, key: "clamp_force_pct", altKeys: ["clampForcePct", "clamp_force_pct"], label: "Clamp Force", unit: "%", color: "#ca8a04", defaultLower: 94.0, defaultUpper: 106.0, setPoint: 100.0, category: "Product Parameter", categoryId: "product_params", icon: "shield", hasStaticLimits: true },
  { id: 19, sNo: 10, key: "furnace_metal_temp", altKeys: ["furnaceMetalTemp", "metalTemp", "metal_temp", "furnace_temp"], label: "Furnace Metal Temp.", unit: "°C", color: "#dc2626", defaultLower: 640.0, defaultUpper: 680.0, setPoint: 660.0, category: "Product Parameter", categoryId: "product_params", icon: "thermometer", hasStaticLimits: true },
  { id: 20, sNo: 11, key: "metal_pressure", altKeys: ["metalPressure", "metal_pressure"], label: "Metal Press.", unit: "MPa", color: "#e11d48", defaultLower: 65.0, defaultUpper: 74.0, setPoint: 69.5, category: "Product Parameter", categoryId: "product_params", icon: "gauge", hasStaticLimits: true },
  { id: 21, sNo: 12, key: "intensification_time", altKeys: ["intensificationTime", "intensification_time"], label: "Inten. Time", unit: "msec", color: "#db2777", defaultLower: 30.0, defaultUpper: 85.0, setPoint: 57.5, category: "Product Parameter", categoryId: "product_params", icon: "clock", hasStaticLimits: true },
  { id: 22, sNo: 13, key: "intensification_acc_pressure", altKeys: ["intensificationAccPressure", "intensification_acc_pressure"], label: "Intensification Acc. Pressure", unit: "MPa", color: "#059669", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "gauge", hasStaticLimits: false },
  { id: 23, sNo: 14, key: "stroke", altKeys: ["stroke"], label: "Stroke", unit: "mm", color: "#0284c7", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "activity", hasStaticLimits: false },
  { id: 24, sNo: 15, key: "time_for_stroke", altKeys: ["timeForStroke", "time_for_stroke"], label: "Time for Stroke", unit: "ms", color: "#0369a1", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "clock", hasStaticLimits: false },
  { id: 25, sNo: 16, key: "shot_acc_pressure", altKeys: ["shotAccPressure", "shot_acc_pressure"], label: "Shot Acc. Pressure", unit: "MPa", color: "#16a34a", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "gauge", hasStaticLimits: false },
  { id: 26, sNo: 17, key: "biscuit_thickness", altKeys: ["biscuitThickness", "biscuit_thickness"], label: "Biscuit Thickness", unit: "mm", color: "#d97706", defaultLower: 20.0, defaultUpper: 30.0, setPoint: 25.0, category: "Product Parameter", categoryId: "product_params", icon: "layers", hasStaticLimits: true },
  { id: 27, sNo: 18, key: "v1_speed", altKeys: ["v1Speed", "v1_speed"], label: "V1", unit: "m/sec", color: "#0ea5e9", defaultLower: 0.15, defaultUpper: 0.35, setPoint: 0.25, category: "Product Parameter", categoryId: "product_params", icon: "zap", hasStaticLimits: true },
  { id: 28, sNo: 19, key: "v2_speed", altKeys: ["v2Speed", "v2_speed"], label: "V2", unit: "m/sec", color: "#0284c7", defaultLower: 0.20, defaultUpper: 0.38, setPoint: 0.29, category: "Product Parameter", categoryId: "product_params", icon: "zap", hasStaticLimits: true },
  { id: 29, sNo: 20, key: "v3_speed", altKeys: ["v3Speed", "v3_speed"], label: "V3", unit: "m/sec", color: "#2563eb", defaultLower: 2.50, defaultUpper: 3.70, setPoint: 3.10, category: "Product Parameter", categoryId: "product_params", icon: "zap", hasStaticLimits: true },
  { id: 30, sNo: 21, key: "v4_speed", altKeys: ["v4Speed", "v4_speed"], label: "V4", unit: "m/sec", color: "#4f46e5", defaultLower: 3.20, defaultUpper: 4.30, setPoint: 3.75, category: "Product Parameter", categoryId: "product_params", icon: "zap", hasStaticLimits: true },
  { id: 31, sNo: 22, key: "vacuum_pressure", altKeys: ["vacuumPressure", "vacuum_pressure"], label: "Vacuum Pressure", unit: "mbar", color: "#7c3aed", defaultLower: null, defaultUpper: null, setPoint: null, category: "Product Parameter", categoryId: "product_params", icon: "wind", hasStaticLimits: false },
];

// 3. Flow & Pressure Parameter — 9
export const FLOW_PRESSURE_PARAMETERS = [
  { id: 32, sNo: 1, key: "cooling_water_mov", altKeys: ["coolingWaterMov", "cooling_water_mov"], label: "Cooling Water Flow Rate (Mov.)", unit: "L/min", color: "#0891b2", defaultLower: null, defaultUpper: null, setPoint: null, category: "Flow & Pressure Parameter", categoryId: "flow_pressure", icon: "droplet", hasStaticLimits: false },
  { id: 33, sNo: 2, key: "cooling_water_sta", altKeys: ["coolingWaterSta", "cooling_water_sta"], label: "Cooling Water Flow Rate (Sta.)", unit: "L/min", color: "#0284c7", defaultLower: null, defaultUpper: null, setPoint: null, category: "Flow & Pressure Parameter", categoryId: "flow_pressure", icon: "droplet", hasStaticLimits: false },
  { id: 34, sNo: 3, key: "fix_1_flow", altKeys: ["fix1Flow", "fix_1_flow"], label: "FIX. 1 Flow", unit: "Lpm", color: "#06b6d4", defaultLower: null, defaultUpper: null, setPoint: null, category: "Flow & Pressure Parameter", categoryId: "flow_pressure", icon: "droplet", hasStaticLimits: false },
  { id: 35, sNo: 4, key: "fix_2_flow", altKeys: ["fix2Flow", "fix_2_flow"], label: "FIX. 2 Flow", unit: "Lpm", color: "#0ea5e9", defaultLower: null, defaultUpper: null, setPoint: null, category: "Flow & Pressure Parameter", categoryId: "flow_pressure", icon: "droplet", hasStaticLimits: false },
  { id: 36, sNo: 5, key: "fix_3_flow", altKeys: ["fix3Flow", "fix_3_flow"], label: "FIX. 3 Flow", unit: "Lpm", color: "#38bdf8", defaultLower: null, defaultUpper: null, setPoint: null, category: "Flow & Pressure Parameter", categoryId: "flow_pressure", icon: "droplet", hasStaticLimits: false },
  { id: 37, sNo: 6, key: "jet_cooling_pressure", altKeys: ["jetCoolingPressure", "jet_cooling_pressure"], label: "Jet Cooling Pressure", unit: "kgf/cm²", color: "#14b8a6", defaultLower: null, defaultUpper: null, setPoint: null, category: "Flow & Pressure Parameter", categoryId: "flow_pressure", icon: "droplet", hasStaticLimits: false },
  { id: 38, sNo: 7, key: "mov_1_flow", altKeys: ["mov1Flow", "mov_1_flow"], label: "Mov. 1 Flow", unit: "Lpm", color: "#10b981", defaultLower: null, defaultUpper: null, setPoint: null, category: "Flow & Pressure Parameter", categoryId: "flow_pressure", icon: "droplet", hasStaticLimits: false },
  { id: 39, sNo: 8, key: "mov_2_flow", altKeys: ["mov2Flow", "mov_2_flow"], label: "Mov. 2 Flow", unit: "Lpm", color: "#059669", defaultLower: null, defaultUpper: null, setPoint: null, category: "Flow & Pressure Parameter", categoryId: "flow_pressure", icon: "droplet", hasStaticLimits: false },
  { id: 40, sNo: 9, key: "mov_3_flow", altKeys: ["mov3Flow", "mov_3_flow"], label: "Mov. 3 Flow", unit: "Lpm", color: "#047857", defaultLower: null, defaultUpper: null, setPoint: null, category: "Flow & Pressure Parameter", categoryId: "flow_pressure", icon: "droplet", hasStaticLimits: false },
];

// 4. Die Temperature Parameter — 5
export const DIE_TEMPERATURE_PARAMETERS = [
  { id: 41, sNo: 1, key: "fixed_die_temp_f1", altKeys: ["fixedDieTempF1", "fixed_die_temp_f1"], label: "Fixed Die Temp (F-1)", unit: "°C", color: "#f97316", defaultLower: null, defaultUpper: null, setPoint: null, category: "Die Temperature Parameter", categoryId: "die_temp", icon: "thermometer", hasStaticLimits: false },
  { id: 42, sNo: 2, key: "fixed_die_temp_f2", altKeys: ["fixedDieTempF2", "fixed_die_temp_f2"], label: "Fixed Die Temp (F-2)", unit: "°C", color: "#ea580c", defaultLower: null, defaultUpper: null, setPoint: null, category: "Die Temperature Parameter", categoryId: "die_temp", icon: "thermometer", hasStaticLimits: false },
  { id: 43, sNo: 3, key: "moving_die_temp_m1", altKeys: ["movingDieTempM1", "moving_die_temp_m1"], label: "Moving Die Temp (M-1)", unit: "°C", color: "#ef4444", defaultLower: null, defaultUpper: null, setPoint: null, category: "Die Temperature Parameter", categoryId: "die_temp", icon: "thermometer", hasStaticLimits: false },
  { id: 44, sNo: 4, key: "moving_die_temp_m2", altKeys: ["movingDieTempM2", "moving_die_temp_m2"], label: "Moving Die Temp (M-2)", unit: "°C", color: "#dc2626", defaultLower: null, defaultUpper: null, setPoint: null, category: "Die Temperature Parameter", categoryId: "die_temp", icon: "thermometer", hasStaticLimits: false },
  { id: 45, sNo: 5, key: "slide_temp_s1", altKeys: ["slideTempS1", "slide_temp_s1"], label: "Slide Temp -1 (S-1)", unit: "°C", color: "#b91c1c", defaultLower: null, defaultUpper: null, setPoint: null, category: "Die Temperature Parameter", categoryId: "die_temp", icon: "thermometer", hasStaticLimits: false },
];

export const ALL_45_PARAMETERS = [
  ...MACHINE_PROCESS_PARAMETERS,
  ...PRODUCT_PARAMETERS,
  ...FLOW_PRESSURE_PARAMETERS,
  ...DIE_TEMPERATURE_PARAMETERS,
];

export const MASTER_RECIPE_SET_PARAMETERS = ALL_45_PARAMETERS;

export const ALL_TELEMETRY_CATEGORIES = [
  {
    id: "machine_process",
    label: "Machine Process ",
    shortLabel: "Machine Process",
    count: 9,
    badge: "9",
    icon: "clock",
    params: MACHINE_PROCESS_PARAMETERS,
  },
  {
    id: "product_params",
    label: "Product Parameter",
    shortLabel: "Product",
    count: 22,
    badge: "22",
    icon: "activity",
    params: PRODUCT_PARAMETERS,
  },
  {
    id: "flow_pressure",
    label: "Flow & Pressure",
    shortLabel: "Flow & Pressure",
    count: 9,
    badge: "9",
    icon: "droplet",
    params: FLOW_PRESSURE_PARAMETERS,
  },
  {
    id: "die_temp",
    label: "Die Temperature",
    shortLabel: "Die Temperature",
    count: 5,
    badge: "5",
    icon: "thermometer",
    params: DIE_TEMPERATURE_PARAMETERS,
  },
];

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

const normalizeDefectCategory = (rawCat, gate, reason) => {
  let c = String(rawCat || "").trim().toUpperCase();
  if (["CR", "CASTING", "CASTING REJECTION"].includes(c)) return "CR";
  if (["CRAM", "CR-AM", "CASTING REJECTION AFTER MACHINING"].includes(c)) return "CRAM";
  if (["MR", "MACHINING", "MACHINING REJECTION"].includes(c)) return "MR";
  const r = String(reason || "").toLowerCase();
  const g = String(gate || "").toUpperCase();
  if (r.includes("blow hole") || r.includes("porosity") || r.includes("face blow hole")) return "CRAM";
  if (r.includes("leak") || r.includes("gauge") || r.includes("machin") || g.includes("LEAK") || g === "OP150" || g === "OP140") return "MR";
  return "CR";
};

const parseRowDefect = (r) => {
  if (!r) return { category: "CR", reason: "Defect", view: "", zone: "", subZone: "" };
  const srcText = String(r.parts_interlock_reason || r.ng_reason || r.ngReason || r.reason || r.rejection_reason || "");
  const catMatch = srcText.match(/Category:\s*([^|\n]+)/i);
  const reasonMatch = srcText.match(/Reason:\s*([^|\n]+)/i);
  const viewMatch = srcText.match(/View:\s*([^|\n]+)/i);
  const zoneMatch = srcText.match(/Zone:\s*([^|\n]+)/i);
  const subZoneMatch = srcText.match(/(?:Sub\s*Zone|SubZone):\s*([^|\n]+)/i);

  let rawReason = r.rejection_reason || r.reason || r.ngReason || (reasonMatch ? reasonMatch[1].trim() : "");
  if (!rawReason || rawReason === "-") rawReason = "Defect";
  const reason = canonicalizeReason(rawReason);

  const rawCat = r.rejection_category || r.category || (catMatch ? catMatch[1].trim() : "");
  const gateIdentifier = r.ngGate || r.ng_gate || r.operation_no || r.station || r.ng_station || "";
  const cat = normalizeDefectCategory(rawCat, gateIdentifier, reason);

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

  // If view or zone is missing, infer for visual defects, but NEVER assign fake zones to leak / sensor tests!
  const isLeakDefect = String(reason).toLowerCase().includes("leak") || String(gateIdentifier).toUpperCase().includes("150") || String(gateIdentifier).toUpperCase().includes("LEAK");
  if (!view || !zoneRaw) {
    const rLower = String(reason).toLowerCase();
    if (isLeakDefect) {
      if (!view) view = "Top View";
      // No fake zone for leak tests! It is a volumetric whole-part sensor test.
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
  const mName = String(r.machine_name || r.machineName || r.station_name || r.station || "").toLowerCase();
  const mId = String(r.machine_id || r.machineId || "");
  const rNgGate = String(r.ngGate || r.ng_gate || r.ng_station || "").toUpperCase();
  const statusKey = `${sLower}_status`;
  const gateStatus = String(r[statusKey] || "").trim().toUpperCase();
  const overallStatus = String(r.status || r.overall_status || "").trim().toUpperCase();

  const isLeakStation = sUpper === "OP150" || sUpper.includes("LEAK") || sUpper.includes("150");

  if (isLeakStation) {
    const isOp150NG = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(String(r.op150_status || "").toUpperCase());
    const isLeakDataNG = r.leak_data && (
      (typeof r.leak_data === "object" && (r.leak_data.result === "NG" || r.leak_data.status === "NG")) ||
      (typeof r.leak_data === "string" && (r.leak_data.includes('"NG"') || r.leak_data.includes('"FAIL"')))
    );
    const srcReason = String(r.parts_interlock_reason || r.ng_reason || r.rejection_reason || "").toUpperCase();
    const isLeakReason = srcReason.includes("LEAK") || srcReason.includes("PRESSURE");
    const isLeakNgGate = rNgGate.includes("LEAK") || rNgGate.includes("150");

    // Must actually be a leak test failure
    const hasActualLeakFailure = isOp150NG || isLeakDataNG || (isLeakReason && (overallStatus === "NG" || overallStatus === "FAILED")) || isLeakNgGate;
    if (!hasActualLeakFailure) return false;

    if (sUpper === "OP150" || sUpper === "LEAK-TEST-OP150" || sUpper === "LEAK") return true;

    // Check machine assignment (1773 / 1774 / 1776)
    let leakMatched = false;
    let hasExplicitStationInRecord = false;
    if (r.leak_data) {
      try {
        const ld = typeof r.leak_data === "object" ? r.leak_data : JSON.parse(r.leak_data);
        const ldMach = String(ld.matchedMachineName || ld.machineName || ld.machine_name || "").toUpperCase();
        if (ldMach) hasExplicitStationInRecord = true;
        if ((sUpper.includes("01") || sUpper.includes("-1") || sUpper.endsWith("1")) && (ldMach.includes("01") || ldMach.includes("1") || ldMach.includes("1773") || mId === "1773")) leakMatched = true;
        else if ((sUpper.includes("02") || sUpper.includes("-2") || sUpper.endsWith("2")) && (ldMach.includes("02") || ldMach.includes("2") || ldMach.includes("1774") || mId === "1774")) leakMatched = true;
        else if ((sUpper.includes("03") || sUpper.includes("-3") || sUpper.endsWith("3")) && (ldMach.includes("03") || ldMach.includes("3") || ldMach.includes("1776") || mId === "1776")) leakMatched = true;
      } catch (e) {}
    }
    const isLeakMachineName = (mName.includes("leak") || mName.includes("op150") || mId === "1773" || mId === "1774" || mId === "1776") && (
      ((sUpper.includes("01") || sUpper.includes("-1") || sUpper.endsWith("1")) && (mName.includes("01") || mName.includes("1") || mId === "1773")) ||
      ((sUpper.includes("02") || sUpper.includes("-2") || sUpper.endsWith("2")) && (mName.includes("02") || mName.includes("2") || mId === "1774")) ||
      ((sUpper.includes("03") || sUpper.includes("-3") || sUpper.endsWith("3")) && (mName.includes("03") || mName.includes("3") || mId === "1776"))
    );
    const isSpecificLeakGate = rNgGate.includes(sUpper) || (sUpper.includes("1") && (rNgGate.includes("01") || rNgGate.includes("1")));

    // Fallback: If record does not designate machine 02 or 03 and target is Leak-Test-1, match it
    if (!leakMatched && !isLeakMachineName && !isSpecificLeakGate && !hasExplicitStationInRecord && (sUpper.includes("01") || sUpper.includes("-1") || sUpper.endsWith("1"))) {
      return true;
    }

    return leakMatched || isLeakMachineName || isSpecificLeakGate;
  }

  // Visual / Dimensional Quality Gates (OP100 to OP160)
  // 1. Explicit gate match in ng_gate column
  if (rNgGate && (rNgGate === sUpper || rNgGate.includes(sUpper))) return true;

  // 2. Specific station status column is NG
  if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus)) return true;

  // 3. Overall NG only if the defect reason explicitly points to this gate
  const srcReason = String(r.parts_interlock_reason || r.ng_reason || r.rejection_reason || "").toUpperCase();
  if (overallStatus === "NG" || overallStatus === "FAILED") {
    if (sUpper === "OP100" && (srcReason.includes("DCM") || srcReason.includes("OP100"))) return true;
    if (sUpper === "OP110" && (srcReason.includes("LASER") || srcReason.includes("QR") || srcReason.includes("OP110"))) return true;
    if (sUpper === "OP120" && (srcReason.includes("CASTING") || srcReason.includes("PDI") || srcReason.includes("OP120") || srcReason.includes("BLOW HOLE") || srcReason.includes("POROSITY") || srcReason.includes("NON-FILLING") || srcReason.includes("DENT") || srcReason.includes("BLACK MARK") || srcReason.includes("CRACK") || srcReason.includes("BEND") || srcReason.includes("CHIP") || srcReason.includes("SHRINKAGE"))) return true;
    if (sUpper === "OP130" && (srcReason.includes("PRE") || srcReason.includes("OP130"))) return true;
    if (sUpper === "OP140" && (srcReason.includes("GAUG") || srcReason.includes("DIMENSION") || srcReason.includes("OP140"))) return true;
    if (sUpper === "OP160" && (srcReason.includes("FINAL") || srcReason.includes("FPI") || srcReason.includes("OP160"))) return true;
  }

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
  showStatusPill = null, // null defaults to false in compact (avoids duplicate badge with card header), true in featured
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
  const shouldShowPill = showStatusPill !== null ? showStatusPill : !isCompact;

  const width = isCompact ? 164 : 240;
  const height = isCompact ? 92 : 145;
  const cx = width / 2;
  const cy = isCompact ? 72 : 112;
  const r = isCompact ? 56 : 84;
  const strokeWidth = isCompact ? 10 : 14;
  const needleLen = isCompact ? 42 : 64;

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

  const tickSteps = [0, 0.25, 0.5, 0.75, 1];
  const ticks = tickSteps.map((pct) => {
    const deg = 180 - pct * 180;
    const rad = (deg * Math.PI) / 180;
    const innerR = r - (isCompact ? 5 : 7);
    const outerR = r + (isCompact ? 5 : 7);
    return {
      x1: cx + innerR * Math.cos(rad),
      y1: cy - innerR * Math.sin(rad),
      x2: cx + outerR * Math.cos(rad),
      y2: cy - outerR * Math.sin(rad),
      label: `${Math.round(pct * effectiveMax)}`,
      labelX: cx + (r - (isCompact ? 12 : 18)) * Math.cos(rad),
      labelY: cy - (r - (isCompact ? 12 : 18)) * Math.sin(rad),
      pct,
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
            stroke="#475569"
            strokeWidth={isCompact ? "1.4" : "1.8"}
          />
        ))}

        {/* Min / Max Range Markers on Arc Base */}
        <text
          x={(cx - r + (isCompact ? 4 : 6)).toFixed(1)}
          y={(cy + (isCompact ? 13 : 17)).toFixed(1)}
          textAnchor="middle"
          fontSize={isCompact ? "8" : "10"}
          fontWeight="750"
          fill="#64748b"
        >
          0
        </text>
        <text
          x={(cx + r - (isCompact ? 4 : 6)).toFixed(1)}
          y={(cy + (isCompact ? 13 : 17)).toFixed(1)}
          textAnchor="middle"
          fontSize={isCompact ? "8" : "10"}
          fontWeight="750"
          fill="#64748b"
        >
          {effectiveMax}
        </text>

        {/* Featured Size Intermediate Numeric Tick Labels */}
        {!isCompact && ticks.filter(t => t.pct > 0 && t.pct < 1).map((t, i) => (
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
            points={`${cx - (isCompact ? 2.5 : 3.5)},${cy} ${cx + (isCompact ? 2.5 : 3.5)},${cy} ${cx},${cy - needleLen}`}
            fill="#0f172a"
          />
          {/* Bold vibrant colored pointer tip */}
          <polygon
            points={`${cx - (isCompact ? 1.4 : 2)},${cy - needleLen * 0.55} ${cx + (isCompact ? 1.4 : 2)},${cy - needleLen * 0.55} ${cx},${cy - needleLen}`}
            fill={arcColor}
          />
        </g>

        {/* Pivot Center Pin Hub */}
        <circle cx={cx} cy={cy} r={isCompact ? 5.5 : 7} fill="#0f172a" stroke="#ffffff" strokeWidth={isCompact ? "1.5" : "2"} />
        <circle cx={cx} cy={cy} r={isCompact ? 2.5 : 3} fill={arcColor} />

        {/* Bold Central Numeric Value Readout */}
        <text
          x={cx}
          y={isCompact ? 44 : 76}
          textAnchor="middle"
          fontSize={isCompact ? "16" : "25"}
          fontWeight="900"
          fill={readoutColor}
          fontFamily="'Inter', -apple-system, sans-serif"
        >
          {numVal.toFixed(1)}{unit}
        </text>

        {/* Sub-label under value */}
        <text
          x={cx}
          y={isCompact ? 58 : 94}
          textAnchor="middle"
          fontSize={isCompact ? "8.5" : "10.5"}
          fontWeight="800"
          fill="#475569"
          letterSpacing="0.06em"
        >
          {label}
        </text>
      </svg>

      {/* Bold Status Pill Badge - Omitted in compact card mode to avoid duplicate PASS/WATCH badge */}
      {shouldShowPill && (
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
      )}
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

  // Filters State — Default to 90 Days
  const [filters, setFilters] = useState(() => {
    const now = new Date();
    const past90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return {
      dateFrom: past90.toISOString().slice(0, 10),
      dateTo: now.toISOString().slice(0, 10),
      datePreset: "last90",
      shiftCode: "",
      machineName: "",
      qualityGate: "",
      partName: "",
      partCategory: "",
      dieName: "",
      status: "ALL",
    };
  });

  // Data Response State
  const [summary, setSummary] = useState({
    totalProduction: 0,
    totalOK: 0,
    totalNG: 0,
    inProgress: 0,
    rejectRate: 0,
    topHotspotStation: "Evaluating...",
    topDriverParameter: "Evaluating...",
  });

  const [qualityGates, setQualityGates] = useState([]);
  const [isOp150Grouped, setIsOp150Grouped] = useState(false); // Default shows distinct parallel stations: Leak-Test-1, Leak-Test-2, Leak-Test-3
  const [stationLabels, setStationLabels] = useState({
    OP100: "DCM+DPM + OP100",
    OP110: "Laser Marking + OP110",
    OP120: "Casting PDi + OP120",
    OP130: "Pre Inspection + OP130",
    OP140: "Auto Guaging + OP140",
    OP150: "Leak Test OP150",
    "Leak-Test-01": "Leak-Test-1 (OP150)",
    "Leak-Test-02": "Leak-Test-2 (OP150)",
    "Leak Test-03": "Leak-Test-3 (OP150)",
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
  const [selectedTelemetryParam, setSelectedTelemetryParam] = useState("plc_cycle_time");
  const [mlCategoryFilter, setMlCategoryFilter] = useState("ALL");
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
  const [isCompactRecords, setIsCompactRecords] = useState(true);

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

  // Master Recipe Set Parameters Modal State
  const [showSetParamsModal, setShowSetParamsModal] = useState(false);
  const [setParamsSearch, setSetParamsSearch] = useState("");
  const [setParamsCategoryFilter, setSetParamsCategoryFilter] = useState("ALL");
  const [setParamsScope, setSetParamsScope] = useState("ALL"); // "ALL", "RECIPE_BOUND", "AI_DYNAMIC"

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
  const [telemetryCategory, setTelemetryCategory] = useState("machine_process"); // 4 user-specified categories
  const [telemetryViewMode, setTelemetryViewMode] = useState("stacked_timeline"); // "stacked_timeline" | "spc_detail"

  // Tab 3: Part Parameter Compliance Matrix State & Scroller
  const [complianceFilter, setComplianceFilter] = useState("all"); // "all" | "out_or_ng" | "ok_only"
  const [complianceLayout, setComplianceLayout] = useState("carousel"); // "carousel" | "grid"
  const [complianceSearch, setComplianceSearch] = useState("");
  const complianceScrollRef = useRef(null);

  const scrollCompliance = useCallback((direction) => {
    if (complianceScrollRef.current) {
      const offset = direction === "left" ? -440 : 440;
      complianceScrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
    }
  }, []);

  // Tab 3: SPC Run Chart Horizontal Scroll Stream State
  const [spcChartMode, setSpcChartMode] = useState("scroll"); // "scroll" | "fit"
  const spcChartScrollRef = useRef(null);

  const scrollSpcChart = useCallback((direction) => {
    if (spcChartScrollRef.current) {
      const offset = direction === "left" ? -600 : 600;
      spcChartScrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
    }
  }, []);

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

    // Fetch dynamic dies from part assignments
    organizationApi.listParts()
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.data || []);
        if (list.length > 0) {
          const distinctDies = [...new Set(list.map(p => p.dieName).filter(Boolean))];
          setFilterOptions(prev => ({
            ...prev,
            dies: [...new Set([...(prev.dies || []), ...distinctDies])].sort()
          }));
        }
      })
      .catch(err => console.warn("[REJECTION UI] organizationApi.listParts fallback:", err.message));
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
      if (filters.partCategory) query.partCategory = filters.partCategory;
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
    setGateDrillDownParts([]);
    setParetoDrillDownParts([]);
    setRecordsPage(1);
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
      if (filters.partName) query.partName = filters.partName;
      if (filters.partCategory) query.partCategory = filters.partCategory;
      if (filters.dieName) query.dieName = filters.dieName;
      if (filters.category) query.category = filters.category;

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
          pageSize: 500,
          noCache: "1",
          _ts: Date.now(),
        };
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
    const now = new Date();
    const past90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    setFilters((prev) => ({
      ...prev,
      datePreset: "last90",
      dateFrom: past90.toISOString().slice(0, 10),
      dateTo: now.toISOString().slice(0, 10),
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

  const tableColumnsNgCompact = useMemo(() => {
    return tableColumns
      .filter((col) => !col.key.startsWith("station_op"))
      .reduce((acc, col) => {
        if (col.key === "overallStatus") {
          acc.push({ key: "ng_station", label: "NG Station", width: 140, blankIfEmpty: true });
        }
        acc.push(col);
        return acc;
      }, []);
  }, [tableColumns]);

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

      let isLeakNg = r.isOp150Ng || r.op150_status === 'NG' || r.op150_status === 'FAIL' || r.op150_status === 'FAILED';
      let parsedLeakData = null;
      if (r.leak_data) {
        try {
          parsedLeakData = typeof r.leak_data === 'string' ? JSON.parse(r.leak_data) : r.leak_data;
          const res = String(parsedLeakData?.result || parsedLeakData?.status || '').toUpperCase();
          if (res === 'NG' || res === 'FAIL' || res === 'FAILED') {
            isLeakNg = true;
          }
        } catch(e) {}
      }

      const srcText = String(r.ng_reason || r.ngReason || r.reason || r.rejection_reason || (isLeakNg ? "Leak Test Failure" : ""));
      const catParsed = r.category || r.rejection_category || parseFieldFromText(srcText, "Category") || (isLeakNg ? "LEAK TEST" : "");
      const reasonParsed = r.reason || r.rejection_reason || r.ngReason || parseFieldFromText(srcText, "Reason") || (isLeakNg ? (parsedLeakData?.body_leak_value ? `Body Leak: ${parsedLeakData.body_leak_value} cc/min` : "Leak Test NG") : "");
      const viewParsed = r.rejectionView || r.rejection_view || r.view || parseFieldFromText(srcText, "View") || "";
      const rawZone = r.rejectionZone || r.rejection_zone || r.zone || parseFieldFromText(srcText, "Zone") || (isLeakNg ? "BODY" : "");
      const zoneParts = splitZoneString(rawZone);
      const zoneParsed = zoneParts.zone !== "-" ? zoneParts.zone : (rawZone !== "-" ? rawZone : "");
      const subZoneParsed = r.rejectionSubZone || r.rejection_sub_zone || r.subZone || (zoneParts.subZone !== "-" ? zoneParts.subZone : parseFieldFromText(srcText, "Sub Zone")) || "";

      let isAnyGateNg = false;
      let ng_station = "";
      if (r.op100_status === 'NG' || r.op100_status === 'FAIL' || r.op100_status === 'FAILED') { ng_station = "OP100"; isAnyGateNg = true; }
      else if (r.op110_status === 'NG' || r.op110_status === 'FAIL' || r.op110_status === 'FAILED') { ng_station = "OP110"; isAnyGateNg = true; }
      else if (r.op120_status === 'NG' || r.op120_status === 'FAIL' || r.op120_status === 'FAILED') { ng_station = "OP120"; isAnyGateNg = true; }
      else if (r.op130_status === 'NG' || r.op130_status === 'FAIL' || r.op130_status === 'FAILED') { ng_station = "OP130"; isAnyGateNg = true; }
      else if (r.op140_status === 'NG' || r.op140_status === 'FAIL' || r.op140_status === 'FAILED') { ng_station = "OP140"; isAnyGateNg = true; }
      else if (isLeakNg) { ng_station = "OP150"; isAnyGateNg = true; }
      else if (r.op160_status === 'NG' || r.op160_status === 'FAIL' || r.op160_status === 'FAILED') { ng_station = "OP160"; isAnyGateNg = true; }
      else ng_station = r.machine_name || "";

      let finalOverallStatus = String(r.status || r.overall_status || "").trim();
      if (isAnyGateNg || reasonParsed || catParsed) {
        finalOverallStatus = "NG";
      } else if (!finalOverallStatus) {
        finalOverallStatus = "";
      }

      return {
        id: r.id || `row-${i}`,
        shot_number: shotNum,
        shot_datetime: formatResultTimestamp(r.createdAt || r.first_scan_at),
        barcode: displayPartId,
        customerCode: displayCustomerQr,
        ng_station,
        station_op100: r.op100_status && r.op100_status !== "-" ? r.op100_status : "",
        station_op110: r.op110_status && r.op110_status !== "-" ? r.op110_status : "",
        station_op120: r.op120_status && r.op120_status !== "-" ? r.op120_status : "",
        station_op130: r.op130_status && r.op130_status !== "-" ? r.op130_status : "",
        station_op140: r.op140_status && r.op140_status !== "-" ? r.op140_status : "",
        station_op150: isLeakNg ? "NG" : (r.op150_status && r.op150_status !== "-" ? r.op150_status : ""),
        station_op160: r.op160_status && r.op160_status !== "-" ? r.op160_status : "",
        overallStatus: finalOverallStatus,
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
        leak_body_leak_value: fmtNum(r.leakBodyValue ?? r.leak_body_leak_value ?? parsedLeakData?.body_leak_value ?? parsedLeakData?.bodyLeakValue),
        leak_gall_1: fmtNum(r.leakGall1 ?? r.leak_gall_1 ?? parsedLeakData?.gall_1_leak_value ?? parsedLeakData?.gall_1),
        leak_gall_2: fmtNum(r.leakGall2 ?? r.leak_gall_2 ?? parsedLeakData?.gall_2_leak_value ?? parsedLeakData?.gall_2),
        leak_cycle_time: fmtNum(r.leakCycleTime ?? r.leak_cycle_time ?? parsedLeakData?.cycle_time),
        leak_running_mode: r.leakRunningMode || r.leak_running_mode || parsedLeakData?.running_mode || "-",
        leak_dry_wey_both: r.leakDryWey || r.leak_dry_wey_both || parsedLeakData?.dry_wet_both || "-",

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
          pageSize: 500,
          noCache: "1",
          _ts: Date.now(),
        };
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
    const targetParetoCount = Number(activeParetoStats?.count ?? paretoMatchingRecords.length);

    // Canonical defect mapping to standard views/zones for parts where specific CAD angle metadata wasn't tagged
    const defectKeyUpper = String(activeParetoKey || "").toUpperCase();
    let defaultViewCode = "TOP";
    let defaultZoneCode = "A";

    if (defectKeyUpper.includes("NON-FILL") || defectKeyUpper.includes("NON FILL") || defectKeyUpper.includes("SHRINKAGE")) {
      defaultViewCode = "BOTTOM";
      defaultZoneCode = "B";
    } else if (defectKeyUpper.includes("BLOW") || defectKeyUpper.includes("POROSITY") || defectKeyUpper.includes("AIR LOCK")) {
      defaultViewCode = "TOP";
      defaultZoneCode = "A";
    } else if (defectKeyUpper.includes("DENT") || defectKeyUpper.includes("DAMAGE") || defectKeyUpper.includes("MISALIGN")) {
      defaultViewCode = "LEFT";
      defaultZoneCode = "C";
    } else if (defectKeyUpper.includes("CRACK") || defectKeyUpper.includes("COLD SHUT") || defectKeyUpper.includes("FLASH")) {
      defaultViewCode = "RIGHT";
      defaultZoneCode = "D";
    } else if (defectKeyUpper.includes("CHIP") || defectKeyUpper.includes("BURR") || defectKeyUpper.includes("PIN")) {
      defaultViewCode = "FRONT";
      defaultZoneCode = "O";
    } else if (defectKeyUpper.includes("LEAK") || defectKeyUpper.includes("PRESSURE")) {
      defaultViewCode = "TOP";
      defaultZoneCode = "BODY";
    }

    // Step 1: Map raw matching records to each view
    const rawViewDistribution = rejectionConfig.views.map((v, vIndex) => {
      const vNorm = normalizeCode(v.name || v.code);
      const isDefaultView = vNorm.includes(normalizeCode(defaultViewCode)) || (vIndex === 0 && !rejectionConfig.views.some(ov => normalizeCode(ov.name || ov.code).includes(normalizeCode(defaultViewCode))));

      const viewRecords = paretoMatchingRecords.filter((r) => {
        const p = parseRowDefect(r);
        const rV = normalizeCode(p.view);
        if (rV && (vNorm.includes(rV) || rV.includes(vNorm))) return true;
        const zClean = cleanZoneCode(p.zone);
        if (zClean && (v.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean)) return true;
        return false;
      });

      return {
        view: v,
        isDefaultView,
        viewRecords,
        rawCount: viewRecords.length,
      };
    });

    const totalRawCount = rawViewDistribution.reduce((s, it) => s + it.rawCount, 0);

    // Step 2: Compute exact scaled defect counts so sum across views matches targetParetoCount
    let allocatedTotal = 0;
    const viewCounts = rawViewDistribution.map((item, idx) => {
      let count = 0;
      if (totalRawCount > 0) {
        if (idx === rawViewDistribution.length - 1) {
          count = Math.max(0, targetParetoCount - allocatedTotal);
        } else {
          count = Math.round((item.rawCount / totalRawCount) * targetParetoCount);
          allocatedTotal += count;
        }
      } else if (item.isDefaultView) {
        count = targetParetoCount;
      }
      return count;
    });

    // Step 3: Build processed zones and sub-zones for each view
    return rawViewDistribution.map((item, vIdx) => {
      const v = item.view;
      const totalDefectsInView = viewCounts[vIdx] || 0;
      const viewRecords = item.viewRecords;

      const rawZoneCounts = {};
      const rawSubZoneCounts = {};

      viewRecords.forEach((r) => {
        const p = parseRowDefect(r);
        const zClean = cleanZoneCode(p.zone);
        const szClean = cleanSubZoneCode(p.subZone);
        if (zClean) rawZoneCounts[zClean] = (rawZoneCounts[zClean] || 0) + 1;
        if (szClean) rawSubZoneCounts[szClean] = (rawSubZoneCounts[szClean] || 0) + 1;
        if (zClean && szClean) {
          const pairKey = `${zClean}__${szClean}`;
          rawSubZoneCounts[pairKey] = (rawSubZoneCounts[pairKey] || 0) + 1;
        }
      });

      const rawZoneTotal = Object.values(rawZoneCounts).reduce((s, c) => s + c, 0);

      const processedZones = (v.zones || []).map((z, zIdx) => {
        const zClean = cleanZoneCode(z.code || z.name);
        let zoneCount = 0;
        if (rawZoneTotal > 0) {
          const rawZ = rawZoneCounts[zClean] || 0;
          zoneCount = Math.round((rawZ / rawZoneTotal) * totalDefectsInView);
        } else if (item.isDefaultView && (zClean === defaultZoneCode || zIdx === 0)) {
          zoneCount = totalDefectsInView;
        }

        const rawSubsTotal = (z.subZones || []).reduce((s, sz) => {
          const szClean = cleanSubZoneCode(sz.code || sz.name);
          const pairKey = `${zClean}__${szClean}`;
          return s + (rawSubZoneCounts[pairKey] || rawSubZoneCounts[szClean] || 0);
        }, 0);

        const processedSubs = (z.subZones || []).map((sz, sIdx) => {
          const szClean = cleanSubZoneCode(sz.code || sz.name);
          const pairKey = `${zClean}__${szClean}`;
          let subCount = 0;
          if (rawSubsTotal > 0) {
            const rawS = rawSubZoneCounts[pairKey] || rawSubZoneCounts[szClean] || 0;
            subCount = Math.round((rawS / rawSubsTotal) * zoneCount);
          } else if (zoneCount > 0 && sIdx === 0) {
            subCount = zoneCount;
          }
          return {
            ...sz,
            count: subCount,
            hasDefect: subCount > 0,
          };
        });

        return {
          ...z,
          count: zoneCount,
          hasDefect: zoneCount > 0,
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
        totalDefects: totalDefectsInView,
        activeSubZonesList,
        zones: processedZones,
      };
    });
  }, [rejectionConfig, paretoMatchingRecords, activeParetoStats, activeParetoKey]);

  // Comprehensive Pareto Summarization & Localization KPIs
  const paretoSummary = useMemo(() => {
    const totalMatching = Number(activeParetoStats?.count ?? paretoMatchingRecords.length);
    const totalAllRejections = Number(summary?.totalNG || (allRejectionRecords || []).length || 1);
    const percentageOfAll = activeParetoStats?.percentage ?? Number(((totalMatching / (totalAllRejections || 1)) * 100).toFixed(1));

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
    let list = mlInsights.features;
    if (mlCategoryFilter !== "ALL") {
      list = list.filter((f) => f.category === mlCategoryFilter || (f.category && f.category.toLowerCase().includes(mlCategoryFilter.toLowerCase())));
    }
    const targetList = list.length > 0 ? list : mlInsights.features;
    return targetList.slice(0, 10).map((f) => {
      // Normalize to 0-100 scale for visual comparison
      const maxVal = Math.max(Math.abs(f.meanOk || 0), Math.abs(f.meanNg || 0), 1);
      return {
        parameter: f.label.length > 15 ? f.label.slice(0, 14) + "…" : f.label,
        fullLabel: f.label,
        "OK Mean": Number(((Math.abs(f.meanOk || 0) / maxVal) * 100).toFixed(1)),
        "NG Mean": Number(((Math.abs(f.meanNg || 0) / maxVal) * 100).toFixed(1)),
        okRaw: f.meanOk,
        ngRaw: f.meanNg,
        unit: f.unit,
        lsl: f.setLowerLimit ?? f.lsl ?? null,
        usl: f.setUpperLimit ?? f.usl ?? null,
      };
    });
  }, [mlInsights.features, mlCategoryFilter]);

  // ── Parameter Categories for Telemetry & SPC (User-Specified 4 Categories) ──
  const activeCategoryParams = useMemo(() => {
    const cat = ALL_TELEMETRY_CATEGORIES.find((c) => c.id === telemetryCategory);
    return cat ? cat.params : MACHINE_PROCESS_PARAMETERS;
  }, [telemetryCategory]);

  const MACHINE_CYCLE_PARAMETERS = MACHINE_PROCESS_PARAMETERS;
  const PROCESS_PARAMETERS_EACH_CYCLE = PRODUCT_PARAMETERS;

  // ── Stacked Multi-Chart Timeline Data (Image 2 style) ─────────────────────
  const stackedTimelineData = useMemo(() => {
    const dataPool = rows.length > 0 ? rows : (recordsRows.length > 0 ? recordsRows : allRejectionRecords);
    if (!dataPool || !dataPool.length) return [];

    const getVal = (r, keys) => {
      for (const k of keys) {
        if (r[k] !== undefined && r[k] !== null && r[k] !== "") {
          const n = Number(r[k]);
          if (Number.isFinite(n) && n > 0) return n;
        }
      }
      return null;
    };

    // Sort chronologically
    const sorted = [...dataPool].sort((a, b) => {
      const ta = new Date(a.createdAt || a.first_scan_at || 0).getTime();
      const tb = new Date(b.createdAt || b.first_scan_at || 0).getTime();
      return ta - tb;
    });

    const slice = sorted.slice(-180);
    return slice.map((r, idx) => {
      const dt = new Date(r.createdAt || r.first_scan_at || Date.now());
      const timeLabel = !isNaN(dt.getTime())
        ? dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
        : `#${idx + 1}`;
      const dateLabel = !isNaN(dt.getTime())
        ? dt.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
        : "";
      const shift = r.shiftCode || r.shift_code || "A";
      const shot = r.shot_number || r.shotNumber || idx + 1;
      const part = r.partId || r.part_id || "";
      const isNg = r.status === "NG" || r.overall_status === "NG" || r.isOp150Ng;

      const pt = {
        index: idx + 1,
        timeLabel,
        dateLabel,
        shift,
        shot,
        part,
        isNg,
      };

      // Populate all 45 parameters across the 4 categories
      ALL_45_PARAMETERS.forEach((p) => {
        const val = getVal(r, [p.key, ...(p.altKeys || [])]);
        pt[p.key] = val !== null ? val : 0;
      });

      return pt;
    });
  }, [rows, recordsRows, allRejectionRecords, MACHINE_CYCLE_PARAMETERS, PROCESS_PARAMETERS_EACH_CYCLE]);

  // ── Process Telemetry Time Series (Tab 3) ────────────────────────────────
  const telemetryTrendData = useMemo(() => {
    const activeSpec = mlInsights.features?.find((f) => f.key === selectedTelemetryParam)
      || ALL_45_PARAMETERS.find((p) => p.key === selectedTelemetryParam)
      || {};
    const dataPool = rows.length > 0 ? rows : (recordsRows.length > 0 ? recordsRows : allRejectionRecords);

    // Helper to safely extract telemetry parameter from row in any casing or alias
    const getVal = (r, paramKey) => {
      if (r[paramKey] !== undefined && r[paramKey] !== null && r[paramKey] !== "") {
        const n = Number(r[paramKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      const camelKey = paramKey.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
      if (r[camelKey] !== undefined && r[camelKey] !== null && r[camelKey] !== "") {
        const n = Number(r[camelKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      const snakeKey = paramKey.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
      if (r[snakeKey] !== undefined && r[snakeKey] !== null && r[snakeKey] !== "") {
        const n = Number(r[snakeKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("temp")) {
        const n = Number(r.metalTemp ?? r.furnace_metal_temp ?? r.metal_temp ?? r[paramKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("press")) {
        const n = Number(r.metalPressure ?? r.metal_pressure ?? r[paramKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("biscuit")) {
        const n = Number(r.biscuitThickness ?? r.biscuit_thickness ?? r[paramKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("cycle")) {
        const n = Number(r.cycleTime ?? r.cycle_time ?? r.plc_cycle_time ?? r[paramKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("v1")) {
        const n = Number(r.v1Speed ?? r.v1_speed ?? r[paramKey]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      if (paramKey.includes("flow") || paramKey.includes("water")) {
        const n = Number(r[paramKey]);
        if (Number.isFinite(n) && n > 0) return n;
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

    const hasSetLimits = Boolean(activeSpec.usl != null && activeSpec.lsl != null);
    const usl = hasSetLimits ? activeSpec.usl : null;
    const lsl = hasSetLimits ? activeSpec.lsl : null;
    const setPoint = hasSetLimits ? (activeSpec.setPoint ?? ((usl + lsl) / 2)) : null;

    return validRows.map((item, index) => {
      const { r, val } = item;
      const isPartNg = ["NG", "FAILED", "FAIL", "ENDED_NG", "COMPLETED_NG"].includes(String(r.status || r.overall_status || "").trim().toUpperCase());
      const rawPartId = String(r.partId || r.part_id || r.customerQrCode || r.customer_qr || `Part #${index + 1}`).trim();
      const extractedShot = extractShotFromPartId(rawPartId);
      const shotNum = (r.shot_number && r.shot_number !== "-") ? r.shot_number : ((r.shotNumber && r.shotNumber !== "-") ? r.shotNumber : (extractedShot || `${index + 1}`));

      const numericVal = Number(val.toFixed(2));
      const delta = setPoint != null ? Number((numericVal - setPoint).toFixed(2)) : 0;
      const deltaPct = (setPoint && setPoint !== 0) ? Number((((numericVal - setPoint) / Math.abs(setPoint)) * 100).toFixed(1)) : 0;

      let isOutlier = false;
      let varStatus = "LIVE_TRACKED";

      if (hasSetLimits) {
        if (usl != null && numericVal > usl) {
          isOutlier = true;
          varStatus = "HIGH_OUTLIER";
        } else if (lsl != null && numericVal < lsl) {
          isOutlier = true;
          varStatus = "LOW_OUTLIER";
        } else if (Math.abs(deltaPct) > 10) {
          varStatus = "WARNING";
        } else {
          varStatus = "IN_SPEC";
        }
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
        isOutlier: hasSetLimits ? (isOutlier || isPartNg) : isPartNg,
        isInSpec: hasSetLimits ? (!isOutlier && !isPartNg) : !isPartNg,
        hasSetLimits,
        createdAt: r.first_scan_at || r.createdAt,
      };
    });
  }, [rows, recordsRows, allRejectionRecords, selectedTelemetryParam, mlInsights.features]);


  // SPC Zoom Range and Slice (Mouse drag-to-select zoom)
  const [spcZoomRange, setSpcZoomRange] = useState({ start: 0, end: null });
  const [spcDragLeft, setSpcDragLeft] = useState(null);
  const [spcDragRight, setSpcDragRight] = useState(null);

  const displayedSpcData = useMemo(() => {
    if (!telemetryTrendData.length) return [];
    const end = spcZoomRange.end != null ? Math.min(spcZoomRange.end, telemetryTrendData.length) : telemetryTrendData.length;
    const start = Math.max(0, Math.min(spcZoomRange.start, end - 5));
    return telemetryTrendData.slice(start, end);
  }, [telemetryTrendData, spcZoomRange]);

  const handleSpcMouseDown = useCallback((e) => {
    if (e && e.activeLabel != null) {
      setSpcDragLeft(Number(e.activeLabel));
      setSpcDragRight(null);
    }
  }, []);

  const handleSpcMouseMove = useCallback((e) => {
    if (spcDragLeft != null && e && e.activeLabel != null) {
      setSpcDragRight(Number(e.activeLabel));
    }
  }, [spcDragLeft]);

  const handleSpcMouseUp = useCallback(() => {
    if (spcDragLeft != null && spcDragRight != null && spcDragLeft !== spcDragRight) {
      const left = Math.min(spcDragLeft, spcDragRight);
      const right = Math.max(spcDragLeft, spcDragRight);
      const startIdx = displayedSpcData.findIndex((d) => d.index >= left);
      const endIdx = displayedSpcData.findIndex((d) => d.index > right);
      const actualStart = spcZoomRange.start + Math.max(0, startIdx);
      const actualEnd = spcZoomRange.start + (endIdx === -1 ? displayedSpcData.length : endIdx);
      if (actualEnd - actualStart >= 3) {
        setSpcZoomRange({ start: actualStart, end: actualEnd });
      }
    }
    setSpcDragLeft(null);
    setSpcDragRight(null);
  }, [spcDragLeft, spcDragRight, displayedSpcData, spcZoomRange.start]);

  const handleSpcResetZoom = useCallback(() => {
    setSpcZoomRange({ start: 0, end: null });
    setSpcDragLeft(null);
    setSpcDragRight(null);
  }, []);

  // Download Set Params vs Live Value Overview (all parameters)
  const exportSetVsLiveOverview = useCallback(() => {
    if (!mlInsights.features?.length) return;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Set vs Live Overview");
    ws.columns = [
      { header: "#", key: "idx", width: 6 },
      { header: "Parameter", key: "param", width: 26 },
      { header: "Unit", key: "unit", width: 10 },
      { header: "Set Target", key: "target", width: 14 },
      { header: "LSL", key: "lsl", width: 12 },
      { header: "USL", key: "usl", width: 12 },
      { header: "Live Mean (μ)", key: "liveMean", width: 16 },
      { header: "Live Std (σ)", key: "liveStd", width: 14 },
      { header: "Live Min", key: "liveMin", width: 12 },
      { header: "Live Max", key: "liveMax", width: 12 },
      { header: "UCL (μ+3σ)", key: "ucl", width: 14 },
      { header: "LCL (μ-3σ)", key: "lcl", width: 14 },
      { header: "Cpk", key: "cpk", width: 10 },
      { header: "Total Parts", key: "totalParts", width: 12 },
      { header: "In-Spec", key: "inSpec", width: 10 },
      { header: "Out-of-Spec", key: "outSpec", width: 12 },
      { header: "Out-of-Spec %", key: "outPct", width: 14 },
      { header: "NG Parts", key: "ngParts", width: 10 },
      { header: "OK Parts", key: "okParts", width: 10 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };

    const dataPool = rows.length > 0 ? rows : (recordsRows.length > 0 ? recordsRows : allRejectionRecords);

    mlInsights.features.forEach((feat, fi) => {
      const vals = [];
      dataPool.forEach((r) => {
        const raw = r[feat.key] ?? r[feat.key?.replace(/_([a-z])/g, (_, l) => l.toUpperCase())];
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) vals.push(n);
      });
      if (!vals.length) return;
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      const liveMin = Math.min(...vals);
      const liveMax = Math.max(...vals);
      const ucl = Number((mean + 3 * std).toFixed(2));
      const lcl = Number((mean - 3 * std).toFixed(2));
      const lsl = feat.lsl;
      const usl = feat.usl;
      let cpk = "-";
      if (std > 0 && usl != null && lsl != null && usl > lsl) {
        cpk = Number(Math.min((usl - mean) / (3 * std), (mean - lsl) / (3 * std)).toFixed(2));
      }
      const inSpec = vals.filter((v) => (lsl == null || v >= lsl) && (usl == null || v <= usl)).length;
      const outSpec = vals.length - inSpec;
      const ngCount = dataPool.filter((r) => {
        const raw = r[feat.key] ?? r[feat.key?.replace(/_([a-z])/g, (_, l) => l.toUpperCase())];
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) return false;
        return ["NG", "FAILED", "FAIL", "ENDED_NG", "COMPLETED_NG"].includes(String(r.status || r.overall_status || "").trim().toUpperCase());
      }).length;

      ws.addRow({
        idx: fi + 1,
        param: feat.label || feat.key,
        unit: feat.unit || "",
        target: feat.setPoint ?? feat.meanOk ?? "-",
        lsl: lsl ?? "-",
        usl: usl ?? "-",
        liveMean: Number(mean.toFixed(2)),
        liveStd: Number(std.toFixed(2)),
        liveMin: Number(liveMin.toFixed(2)),
        liveMax: Number(liveMax.toFixed(2)),
        ucl,
        lcl,
        cpk,
        totalParts: vals.length,
        inSpec,
        outSpec,
        outPct: vals.length > 0 ? `${((outSpec / vals.length) * 100).toFixed(1)}%` : "0%",
        ngParts: ngCount,
        okParts: vals.length - ngCount,
      });
    });

    wb.xlsx.writeBuffer().then((buf) => {
      saveAs(new Blob([buf]), `Set_vs_Live_Parameters_Overview.xlsx`);
    });
  }, [mlInsights.features, rows, recordsRows, allRejectionRecords]);

  // Download Part Parameter Compliance Matrix to Excel
  const exportComplianceMatrixExcel = useCallback(() => {
    const dataPool = rows.length > 0 ? rows : (recordsRows.length > 0 ? recordsRows : allRejectionRecords);
    if (!dataPool?.length) return;

    const allParams = [
      { key: "metal_pressure", altKeys: ["metalPressure", "metal_pressure"], label: "Metal Pressure", unit: "MPa", defaultLower: 63.0, defaultUpper: 74.0, setPoint: 68.5 },
      { key: "furnace_metal_temp", altKeys: ["furnaceMetalTemp", "metalTemp", "metal_temp", "furnace_temp"], label: "Furnace Temp", unit: "°C", defaultLower: 640, defaultUpper: 680, setPoint: 660 },
      { key: "biscuit_thickness", altKeys: ["biscuitThickness", "biscuit_thickness"], label: "Biscuit Thickness", unit: "mm", defaultLower: 20.0, defaultUpper: 30.0, setPoint: 25.0 },
      { key: "plc_cycle_time", altKeys: ["plcCycleTime", "cycleTime", "cycle_time", "total_cycle_time"], label: "Cycle Time", unit: "Sec", defaultLower: 45.0, defaultUpper: 65.0, setPoint: 55.0 },
      { key: "v1_speed", altKeys: ["v1Speed", "v1_speed"], label: "Speed 1 (V1)", unit: "m/s", defaultLower: 0.22, defaultUpper: 0.35, setPoint: 0.28 },
      { key: "v2_speed", altKeys: ["v2Speed", "v2_speed"], label: "Speed 2 (V2)", unit: "m/s", defaultLower: 0.20, defaultUpper: 0.35, setPoint: 0.28 },
      { key: "v3_speed", altKeys: ["v3Speed", "v3_speed"], label: "Speed 3 (V3)", unit: "m/s", defaultLower: 2.50, defaultUpper: 3.50, setPoint: 3.00 },
      { key: "v4_speed", altKeys: ["v4Speed", "v4_speed"], label: "Speed 4 (V4)", unit: "m/s", defaultLower: 3.20, defaultUpper: 3.80, setPoint: 3.50 },
      { key: "intensification_time", altKeys: ["intensificationTime", "intensification_time"], label: "Intensification Time", unit: "ms", defaultLower: 35.0, defaultUpper: 85.0, setPoint: 60.0 },
      { key: "accel_point", altKeys: ["accelPoint", "accel_point"], label: "Acc Position 1", unit: "mm", defaultLower: 340.0, defaultUpper: 400.0, setPoint: 370.0 },
      { key: "deaccel_point", altKeys: ["deaccelPoint", "deaccel_point"], label: "Deacc Position 1", unit: "mm", defaultLower: 700.0, defaultUpper: 730.0, setPoint: 715.0 },
      { key: "clamp_tonnage", altKeys: ["clampTonnage", "clamp_tonnage", "clamp_tonnage_he_low_mn"], label: "Clamp Tonnage", unit: "T", defaultLower: 550.0, defaultUpper: 650.0, setPoint: 600.0 },
      { key: "clamp_force_pct", altKeys: ["clampForcePct", "clamp_force_pct", "clamp_tonnage_he_low_pct"], label: "Clamp Force", unit: "%", defaultLower: 94.0, defaultUpper: 106.0, setPoint: 100.0 },
      { key: "die_close_core_in_time", altKeys: ["dieCloseTime", "die_close_time", "die_close_core_in_time"], label: "Die Close Time", unit: "Sec", defaultLower: 3.0, defaultUpper: 6.5, setPoint: 4.8 },
      { key: "die_open_core_out_time", altKeys: ["dieOpenTime", "die_open_time", "die_open_core_out_time"], label: "Die Open Time", unit: "Sec", defaultLower: 4.0, defaultUpper: 6.0, setPoint: 5.0 },
      { key: "pouring_time", altKeys: ["pouringTime", "pouring_time"], label: "Pouring Time", unit: "Sec", defaultLower: 2.0, defaultUpper: 5.8, setPoint: 3.9 },
      { key: "shot_fwd_time", altKeys: ["shotFwdTime", "shot_fwd_time"], label: "Shot Fwd Time", unit: "Sec", defaultLower: 1.7, defaultUpper: 2.5, setPoint: 2.1 },
      { key: "curing_time", altKeys: ["curingTime", "curing_time", "cooling_time"], label: "Cooling Time", unit: "Sec", defaultLower: 10.0, defaultUpper: 16.0, setPoint: 13.0 },
      { key: "ejector_time", altKeys: ["ejectorTime", "ejector_time"], label: "Ejector Time", unit: "Sec", defaultLower: 4.5, defaultUpper: 6.5, setPoint: 5.5 },
      { key: "extract_time", altKeys: ["extractTime", "extract_time"], label: "Extract Time", unit: "Sec", defaultLower: 10.0, defaultUpper: 16.5, setPoint: 13.2 },
      { key: "spray_time", altKeys: ["sprayTime", "spray_time"], label: "Spray Time", unit: "Sec", defaultLower: 11.5, defaultUpper: 25.0, setPoint: 18.0 },
      { key: "cooling_water_mov", altKeys: ["coolingWaterMov", "mov_1_flow", "cooling_water_mov"], label: "Moving Die Cooling", unit: "°C", defaultLower: 12.5, defaultUpper: 28.0, setPoint: 20.0 },
      { key: "cooling_water_sta", altKeys: ["coolingWaterSta", "fix_1_flow", "cooling_water_sta"], label: "Fixed Die Cooling", unit: "°C", defaultLower: 12.5, defaultUpper: 43.0, setPoint: 27.5 },
      { key: "leak_body_leak_value", altKeys: ["leakBodyValue", "leak_body_leak_value", "bodyLeakValue", "body_leak_value"], label: "Body Leak Value", unit: "mbar", defaultLower: 0.0, defaultUpper: 0.05, setPoint: 0.02 },
    ];

    const extractParamVal = (r, pDef) => {
      const keys = [
        pDef.key,
        pDef.key?.replace(/_([a-z])/g, (_, l) => l.toUpperCase()),
        pDef.key?.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`),
        ...(pDef.altKeys || []),
        ...(pDef.altKeys || []).map(k => k.replace(/_([a-z])/g, (_, l) => l.toUpperCase())),
        ...(pDef.altKeys || []).map(k => k.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`))
      ];
      for (const k of keys) {
        if (r[k] !== undefined && r[k] !== null && r[k] !== "" && r[k] !== "-") {
          const n = Number(r[k]);
          if (Number.isFinite(n) && (n > 0 || pDef.allowZero)) return Number(n.toFixed(2));
        }
      }
      if (pDef.key.includes("leak") && r.leak_data) {
        try {
          const ld = typeof r.leak_data === "object" ? r.leak_data : JSON.parse(r.leak_data);
          if (pDef.key.includes("body")) {
            const val = Number(ld.Body_Leak_Value ?? ld.bodyLeakValue ?? ld.body_leak_value);
            if (Number.isFinite(val)) return Number(val.toFixed(3));
          }
        } catch(e) {}
      }
      return null;
    };

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Compliance Matrix");

    const columns = [
      { header: "#", key: "idx", width: 6 },
      { header: "Part Serial Number", key: "partId", width: 26 },
      { header: "Customer QR Code", key: "customerQr", width: 32 },
      { header: "Shot Number", key: "shotNumber", width: 14 },
      { header: "Machine", key: "machine", width: 16 },
      { header: "Shift", key: "shift", width: 10 },
      { header: "Quality Status", key: "quality", width: 14 },
      { header: "Total Evaluated", key: "totalEval", width: 15 },
      { header: "In-Spec Count", key: "inSpecCount", width: 14 },
      { header: "Out-of-Spec Count", key: "outCount", width: 16 },
      { header: "Compliance %", key: "compliancePct", width: 14 },
    ];

    allParams.forEach(p => {
      columns.push({
        header: `${p.label} (${p.unit}) [Live]`,
        key: `${p.key}_val`,
        width: 18,
      });
      columns.push({
        header: `${p.label} [Set Target]`,
        key: `${p.key}_target`,
        width: 16,
      });
      columns.push({
        header: `${p.label} [Recipe Range]`,
        key: `${p.key}_range`,
        width: 20,
      });
      columns.push({
        header: `${p.label} [Status]`,
        key: `${p.key}_status`,
        width: 14,
      });
    });

    ws.columns = columns;
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };

    dataPool.slice(0, 500).forEach((r, idx) => {
      const rawPartId = String(r.partId || r.part_id || "").trim();
      const rawCustomerQr = String(r.customerQrCode || r.customer_qr || r.customerQr || r.customer_qr_code || "").trim();
      const isQrInPartId = looksLikeCustomerQr(rawPartId) || rawPartId === rawCustomerQr;
      const displayPartId = !isQrInPartId && rawPartId !== "-" ? rawPartId : "";
      const displayCustomerQr = rawCustomerQr !== "-" && rawCustomerQr !== "" ? rawCustomerQr : (isQrInPartId ? rawPartId : "");
      const finalPartSerial = displayPartId || displayCustomerQr || `Part-${idx + 1}`;

      const isNg = ["NG", "FAILED", "FAIL", "ENDED_NG", "COMPLETED_NG"].includes(
        String(r.status || r.overall_status || "").trim().toUpperCase()
      );

      let inCount = 0;
      let outCount = 0;
      const rowData = {
        idx: idx + 1,
        partId: finalPartSerial,
        customerQr: displayCustomerQr || "-",
        shotNumber: r.shotNumber || r.shot_number || "-",
        machine: r.machineName || r.machine_name || "-",
        shift: r.shiftCode || r.shift_code || "A",
        quality: isNg ? "NG (Scrap)" : "OK (Passed)",
      };

      allParams.forEach(p => {
        const feat = mlInsights.features?.find(f => f.key === p.key || (p.altKeys && p.altKeys.includes(f.key)));
        const lsl = feat?.lsl ?? feat?.setLowerLimit ?? p.defaultLower;
        const usl = feat?.usl ?? feat?.setUpperLimit ?? p.defaultUpper;
        const setPoint = feat?.setPoint ?? p.setPoint ?? ((lsl != null && usl != null) ? Number(((lsl + usl) / 2).toFixed(1)) : null);
        const val = extractParamVal(r, p);

        if (val !== null) {
          const inRange = (lsl == null || val >= lsl) && (usl == null || val <= usl);
          if (inRange) inCount++; else outCount++;
          rowData[`${p.key}_val`] = val;
          rowData[`${p.key}_target`] = setPoint != null ? `${setPoint} ${p.unit}` : "-";
          rowData[`${p.key}_range`] = `${lsl ?? "—"} to ${usl ?? "—"} ${p.unit}`;
          rowData[`${p.key}_status`] = inRange ? "IN_SPEC" : "OUT_OF_SPEC";
        } else {
          rowData[`${p.key}_val`] = "-";
          rowData[`${p.key}_target`] = setPoint != null ? `${setPoint} ${p.unit}` : "-";
          rowData[`${p.key}_range`] = `${lsl ?? "—"} to ${usl ?? "—"} ${p.unit}`;
          rowData[`${p.key}_status`] = "N/A";
        }
      });

      const totalEval = inCount + outCount;
      rowData.totalEval = totalEval;
      rowData.inSpecCount = inCount;
      rowData.outCount = outCount;
      rowData.compliancePct = totalEval > 0 ? `${((inCount / totalEval) * 100).toFixed(1)}%` : "100%";

      ws.addRow(rowData);
    });

    wb.xlsx.writeBuffer().then((buf) => {
      saveAs(new Blob([buf]), `Part_Parameter_Compliance_Matrix_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }, [rows, recordsRows, allRejectionRecords, mlInsights.features]);


  // Current active parameter specification for Tab 3
  const currentTelemetrySpec = useMemo(() => {
    const fromMl = mlInsights.features?.find((f) => f.key === selectedTelemetryParam);
    const fromCatalog = ALL_45_PARAMETERS.find((p) => p.key === selectedTelemetryParam);
    const def = fromMl || fromCatalog || { label: selectedTelemetryParam, unit: "", meanOk: 0, meanNg: 0, stdOk: 0 };
    const hasSetLimits = Boolean(def.usl != null && def.lsl != null);
    return {
      ...def,
      label: def.label || selectedTelemetryParam,
      unit: def.unit || "",
      hasSetLimits,
      usl: hasSetLimits ? def.usl : null,
      lsl: hasSetLimits ? def.lsl : null,
      setPoint: hasSetLimits ? (def.setPoint ?? ((def.usl + def.lsl) / 2)) : null,
      meanOk: Number(def.meanOk || 0),
      meanNg: Number(def.meanNg || 0),
      stdOk: Number(def.stdOk || 0),
    };
  }, [mlInsights.features, selectedTelemetryParam]);

  // Detailed SPC Capability Metrics (Mean, Sigma, UCL, LCL, Cp, Cpk)
  const spcMetrics = useMemo(() => {
    const spec = currentTelemetrySpec;
    const std = spec.stdOk || 0;
    const mean = spec.meanOk || 0;
    const hasSetLimits = spec.hasSetLimits;
    const ucl = std > 0 ? Number((mean + 3 * std).toFixed(2)) : (hasSetLimits ? spec.usl : null);
    const lcl = std > 0 ? Number((mean - 3 * std).toFixed(2)) : (hasSetLimits ? spec.lsl : null);
    const usl = spec.usl;
    const lsl = spec.lsl;
    let cp = null;
    let cpk = null;
    if (hasSetLimits && std > 0 && usl != null && lsl != null && usl > lsl) {
      cp = Number(((usl - lsl) / (6 * std)).toFixed(2));
      const cpu = (usl - mean) / (3 * std);
      const cpl = (mean - lsl) / (3 * std);
      cpk = Number(Math.min(cpu, cpl).toFixed(2));
    }
    return {
      hasSetLimits,
      mean: Number(mean.toFixed(2)),
      std: Number(std.toFixed(2)),
      ucl,
      lcl,
      cp,
      cpk,
      target: spec.setPoint,
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

  // ── Unified / Grouped Quality Gates (combining parallel OP150 leak test stations) ──
  const processedQualityGates = useMemo(() => {
    if (!qualityGates || qualityGates.length === 0) return [];
    if (!isOp150Grouped) {
      return qualityGates.map((g) => {
        let shortLabel = g.code;
        let displayName = g.name || g.code;
        if (g.code === "Leak-Test-01" || g.code === "Leak-Test-1" || g.code === "Leak Test-01") {
          shortLabel = "Leak-Test-1";
          displayName = "Leak-Test-1 (OP150)";
        } else if (g.code === "Leak-Test-02" || g.code === "Leak-Test-2" || g.code === "Leak Test-02") {
          shortLabel = "Leak-Test-2";
          displayName = "Leak-Test-2 (OP150)";
        } else if (g.code === "Leak Test-03" || g.code === "Leak-Test-03" || g.code === "Leak-Test-3") {
          shortLabel = "Leak-Test-3";
          displayName = "Leak-Test-3 (OP150)";
        }
        return {
          ...g,
          shortLabel,
          displayName,
          name: displayName,
        };
      });
    }

    const leakGates = qualityGates.filter(g =>
      g.code === "OP150" || g.code.toLowerCase().startsWith("leak")
    );

    if (leakGates.length <= 1) return qualityGates;

    const totalOk = leakGates.reduce((s, g) => s + (g.okCount || 0), 0);
    const totalNg = leakGates.reduce((s, g) => s + (g.ngCount || 0), 0);
    const totalInspected = totalOk + totalNg;
    const scrapRate = totalInspected > 0 ? Number(((totalNg / totalInspected) * 100).toFixed(2)) : 0;

    const combinedOp150 = {
      code: "OP150",
      shortLabel: "OP150 (Total)",
      name: "Leak Test OP150 (Total)",
      fullName: "OP150 Leak Testing (All 3 Stations)",
      displayName: "Leak Test OP150 (Total)",
      isGrouped: true,
      subStations: leakGates,
      okCount: totalOk,
      ngCount: totalNg,
      inspected: totalInspected,
      scrapRate,
    };

    const result = [];
    let addedCombined = false;
    qualityGates.forEach((g) => {
      const isLeak = g.code === "OP150" || g.code.toLowerCase().startsWith("leak");
      if (!isLeak) {
        result.push(g);
      } else if (!addedCombined) {
        result.push(combinedOp150);
        addedCombined = true;
      }
    });
    return result;
  }, [qualityGates, isOp150Grouped]);

  // ── Quality Gate chart data ─────────────────────────────────────────────
  const qualityGateChartData = useMemo(() => {
    const isLeakStationCode = (c) => {
      const u = String(c || "").toUpperCase();
      return u === "OP150" || u.startsWith("LEAK");
    };

    const leakGates = processedQualityGates.filter(g => isLeakStationCode(g.code));
    const totalLeakOk = leakGates.reduce((s, g) => s + (g.okCount || 0), 0);
    const totalLeakNg = leakGates.reduce((s, g) => s + (g.ngCount || 0), 0);
    const totalLeakInspected = totalLeakOk + totalLeakNg;

    return processedQualityGates.map((g, idx) => {
      let shortLabel = g.shortLabel || g.code;
      if (g.code === "OP150") shortLabel = "OP150 (Total)";
      else if (g.code === "Leak-Test-01" || g.code === "Leak-Test-1" || g.code === "Leak Test-01") shortLabel = "Leak-Test-1";
      else if (g.code === "Leak-Test-02" || g.code === "Leak-Test-2" || g.code === "Leak Test-02") shortLabel = "Leak-Test-2";
      else if (g.code === "Leak Test-03" || g.code === "Leak-Test-03" || g.code === "Leak-Test-3") shortLabel = "Leak-Test-3";

      const nextGate = processedQualityGates[idx + 1];
      const isCurLeak = isLeakStationCode(g.code);
      const isNextLeak = nextGate ? isLeakStationCode(nextGate.code) : false;

      let inProgress = 0;
      if (!isCurLeak && isNextLeak) {
        // e.g. OP140 -> parallel Leak Test operation
        inProgress = Math.max(0, (g.okCount || 0) - totalLeakInspected);
      } else if (isCurLeak && isNextLeak) {
        // Between parallel leak stations (Leak-1 -> Leak-2, Leak-2 -> Leak-3) -> No WIP
        inProgress = 0;
      } else if (isCurLeak && nextGate && !isNextLeak) {
        // Last leak station (Leak-3) -> OP160
        inProgress = Math.max(0, totalLeakOk - ((nextGate.okCount || 0) + (nextGate.ngCount || 0)));
      } else if (nextGate) {
        // Normal sequential stations
        inProgress = Math.max(0, (g.okCount || 0) - ((nextGate.okCount || 0) + (nextGate.ngCount || 0)));
      }

      return {
        code: g.code,
        name: shortLabel,
        fullName: g.displayName || g.fullName || g.name || g.code,
        isGrouped: g.isGrouped,
        subStations: g.subStations,
        OK: Math.max(0, g.okCount || 0),
        NG: Math.max(0, g.ngCount || 0),
        inProgress: Math.max(0, inProgress),
        scrapRate: Math.max(0, g.scrapRate || 0),
      };
    });
  }, [processedQualityGates]);

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

    return allRejectionRecords.filter((r) => {
      if (!isRecordMatchingStation(r, drillDownGate)) return false;

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

  // ── Pictorial Defect Localization across All Inspection Views (Quality Gates) ─────────
  const pictorialViewData = useMemo(() => {
    if (!rejectionConfig?.views?.length) return [];

    const matchingRecords = allRejectionRecords.filter((r) => {
      if (drillDownGate && !isRecordMatchingStation(r, drillDownGate)) return false;

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

    const gateFound = (processedQualityGates || []).find(g => g.code === drillDownGate) || (qualityGates || []).find(g => g.code === drillDownGate);
    const targetGateCount = typeof gateFound?.ngCount === "number" ? gateFound.ngCount : matchingRecords.length;

    const rawViewDistribution = rejectionConfig.views.map((v, vIndex) => {
      const vNorm = normalizeCode(v.name || v.code);
      const isDefaultView = vIndex === 0;

      const viewRecords = matchingRecords.filter((r) => {
        const p = parseRowDefect(r);
        const rV = normalizeCode(p.view);
        if (rV && (vNorm.includes(rV) || rV.includes(vNorm))) return true;
        const zClean = cleanZoneCode(p.zone);
        if (zClean && (v.zones || []).some((z) => cleanZoneCode(z.code || z.name) === zClean)) return true;
        return false;
      });

      return {
        view: v,
        isDefaultView,
        viewRecords,
        rawCount: viewRecords.length,
      };
    });

    const totalRawCount = rawViewDistribution.reduce((s, it) => s + it.rawCount, 0);
    let allocatedTotal = 0;
    const isSensorTest = Boolean((drillDownGate && (drillDownGate === "OP150" || drillDownGate.toLowerCase().startsWith("leak"))) ||
      (activeGateReason && activeGateReason.toLowerCase().includes("leak")));

    const viewCounts = rawViewDistribution.map((item, idx) => {
      let count = 0;
      if (isSensorTest) {
        return idx === 0 ? targetGateCount : 0;
      }
      if (totalRawCount > 0) {
        if (idx === rawViewDistribution.length - 1) {
          count = Math.max(0, targetGateCount - allocatedTotal);
        } else {
          count = Math.round((item.rawCount / totalRawCount) * targetGateCount);
          allocatedTotal += count;
        }
      } else if (item.isDefaultView) {
        count = targetGateCount;
      }
      return count;
    });

    return rawViewDistribution.map((item, vIdx) => {
      const v = item.view;
      const totalDefectsInView = viewCounts[vIdx] || 0;
      const viewRecords = item.viewRecords;

      const rawZoneCounts = {};
      const rawSubZoneCounts = {};

      viewRecords.forEach((r) => {
        const p = parseRowDefect(r);
        const zClean = cleanZoneCode(p.zone);
        const szClean = cleanSubZoneCode(p.subZone);
        if (zClean) rawZoneCounts[zClean] = (rawZoneCounts[zClean] || 0) + 1;
        if (szClean) rawSubZoneCounts[szClean] = (rawSubZoneCounts[szClean] || 0) + 1;
        if (zClean && szClean) {
          const pairKey = `${zClean}__${szClean}`;
          rawSubZoneCounts[pairKey] = (rawSubZoneCounts[pairKey] || 0) + 1;
        }
      });

      const rawZoneTotal = Object.values(rawZoneCounts).reduce((s, c) => s + c, 0);

      const processedZones = (v.zones || []).map((z, zIdx) => {
        const zClean = cleanZoneCode(z.code || z.name);
        let zoneCount = 0;
        if (isSensorTest) {
          zoneCount = 0;
        } else if (rawZoneTotal > 0) {
          const rawZ = rawZoneCounts[zClean] || 0;
          zoneCount = Math.round((rawZ / rawZoneTotal) * totalDefectsInView);
        } else if (item.isDefaultView && zIdx === 0) {
          zoneCount = totalDefectsInView;
        }

        const rawSubsTotal = (z.subZones || []).reduce((s, sz) => {
          const szClean = cleanSubZoneCode(sz.code || sz.name);
          const pairKey = `${zClean}__${szClean}`;
          return s + (rawSubZoneCounts[pairKey] || rawSubZoneCounts[szClean] || 0);
        }, 0);

        const processedSubs = (z.subZones || []).map((sz, sIdx) => {
          const szClean = cleanSubZoneCode(sz.code || sz.name);
          const pairKey = `${zClean}__${szClean}`;
          let subCount = 0;
          if (isSensorTest) {
            subCount = 0;
          } else if (rawSubsTotal > 0) {
            const rawS = rawSubZoneCounts[pairKey] || rawSubZoneCounts[szClean] || 0;
            subCount = Math.round((rawS / rawSubsTotal) * zoneCount);
          } else if (zoneCount > 0 && sIdx === 0) {
            subCount = zoneCount;
          }
          return {
            ...sz,
            count: subCount,
            hasDefect: subCount > 0,
          };
        });

        return {
          ...z,
          count: zoneCount,
          hasDefect: zoneCount > 0,
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
        totalDefects: totalDefectsInView,
        activeSubZonesList,
        zones: processedZones,
      };
    });
  }, [rejectionConfig, allRejectionRecords, drillDownGate, drillDownCategory, activeGateReason, processedQualityGates, qualityGates]);

  // ── Unified Studio Data Context (combines active Pareto selection or active Quality Gate selection) ──
  const activeStudioData = useMemo(() => {
    const isParetoActive = Boolean(selectedParetoItem && activeParetoKey);
    const isGateActive = Boolean(drillDownGate);

    let title = "Overall Scrap";
    let tag = "ALL DEFECTS";
    let count = Number(summary?.totalNG || allRejectionRecords?.length || 0);
    let viewData = paretoPictorialViewData;
    let partsPool = allRejectionRecords || [];
    let studioSummary = paretoSummary;

    if (isParetoActive) {
      title = activeParetoKey;
      tag = paretoView === "reason" ? "DEFECT REASON" : (paretoView === "category" ? "CATEGORY" : "ZONE");
      count = Number(activeParetoStats?.count ?? paretoMatchingRecords.length);
      viewData = paretoPictorialViewData;
      partsPool = filteredParetoParts.length > 0 ? filteredParetoParts : paretoMatchingRecords;
      studioSummary = {
        ...paretoSummary,
        totalMatching: count,
        percentageOfAll: activeParetoStats?.percentage ?? paretoSummary.percentageOfAll,
      };
    } else if (isGateActive) {
      const parts = [drillDownGate];
      if (drillDownCategory) parts.push(drillDownCategory);
      if (activeGateReason) parts.push(activeGateReason);
      title = parts.join(" › ");
      tag = "QUALITY GATE";
      const gateFound = (processedQualityGates || []).find(g => g.code === drillDownGate) || (qualityGates || []).find(g => g.code === drillDownGate);
      count = typeof gateFound?.ngCount === "number" ? gateFound.ngCount : (filteredDrillDownParts.length > 0 ? filteredDrillDownParts.length : drillDownMatchingParts.length);
      viewData = pictorialViewData;
      partsPool = filteredDrillDownParts.length > 0 ? filteredDrillDownParts : drillDownMatchingParts;
      studioSummary = {
        totalMatching: count,
        percentageOfAll: Number(((count / (summary?.totalNG || allRejectionRecords?.length || 1)) * 100).toFixed(1)),
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
      summary: studioSummary,
    };
  }, [selectedParetoItem, activeParetoKey, paretoView, activeParetoStats, paretoMatchingRecords, filteredParetoParts, paretoSummary, paretoPictorialViewData, drillDownGate, drillDownCategory, activeGateReason, processedQualityGates, qualityGates, filteredDrillDownParts, drillDownMatchingParts, pictorialViewData, summary?.totalNG, allRejectionRecords]);

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
    if (!activeStationCode) return processedQualityGates[0] || qualityGates[0];

    // 1. Search in processedQualityGates
    let found = processedQualityGates.find(
      (g) => g.code === activeStationCode || g.shortLabel === activeStationCode || g.displayName === activeStationCode
    );

    // 2. Search in raw qualityGates
    if (!found) {
      found = qualityGates.find((g) => g.code === activeStationCode);
    }

    // 3. Flexible Leak Station matching (OP150, Leak-Test-1, Leak-Test-01, etc.)
    const sNorm = String(activeStationCode).toUpperCase().replace(/[-_ ]?0+/g, "-");
    if (!found && (sNorm.includes("LEAK") || sNorm.includes("150"))) {
      if (sNorm.includes("150") || sNorm === "LEAK" || sNorm === "LEAK-TEST") {
        const leakGates = qualityGates.filter(g => {
          const gn = String(g.code).toUpperCase().replace(/[-_ ]?0+/g, "-");
          return gn.includes("LEAK") || gn.includes("150");
        });
        const totOk = leakGates.reduce((s, g) => s + (g.okCount || 0), 0);
        const totNg = leakGates.reduce((s, g) => s + (g.ngCount || 0), 0);
        const totInsp = totOk + totNg;
        found = {
          code: "OP150",
          shortLabel: "OP150",
          name: "Leak Test OP150 (Total)",
          displayName: "Leak Test OP150 (Total)",
          okCount: totOk,
          ngCount: totNg,
          inspected: totInsp,
          scrapRate: totInsp > 0 ? Number(((totNg / totInsp) * 100).toFixed(2)) : 0,
          subStations: leakGates,
          isGrouped: true,
        };
      } else {
        found = qualityGates.find((g) => {
          const gn = String(g.code).toUpperCase().replace(/[-_ ]?0+/g, "-");
          return gn === sNorm || (sNorm.includes("1") && gn.includes("1")) || (sNorm.includes("2") && gn.includes("2")) || (sNorm.includes("3") && gn.includes("3"));
        });
      }
    }

    return found || processedQualityGates[0] || qualityGates[0] || {
      code: activeStationCode,
      name: stationLabels[activeStationCode] || activeStationCode,
      okCount: 0,
      ngCount: 0,
      scrapRate: 0,
    };
  }, [processedQualityGates, qualityGates, activeStationCode, stationLabels]);

  const isLeakStation = activeStationCode === "OP150" || String(activeStationCode).toUpperCase().includes("LEAK") || String(activeStationGate?.code || "").toUpperCase().includes("LEAK") || activeStationGate?.code === "OP150";

  const stationTopReasons = useMemo(() => {
    if (!activeStationCode || !activeStationGate || (activeStationGate.ngCount || 0) === 0) {
      return [];
    }

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

    const isSensorStation = activeStationCode === "OP150" || String(activeStationCode).toUpperCase().startsWith("LEAK");
    const ngTotal = Math.max(0, Number(activeStationGate?.ngCount || 0));

    // When a station has 0 rejections, or when it is an automated pneumatic sensor test (no optical camera defect zones):
    if (ngTotal === 0 || isSensorStation) {
      return rejectionConfig.views.map((v) => ({
        id: v.id,
        code: v.code,
        name: v.name,
        imageUrl: v.imageUrl,
        totalDefects: 0,
        isSensorTest: isSensorStation,
        zones: (v.zones || []).map((z) => ({
          ...z,
          count: 0,
          hasDefect: false,
          subZones: (z.subZones || []).map((sz) => ({
            ...sz,
            count: 0,
            hasDefect: false,
          })),
        })),
      }));
    }

    const gateDrillInfo = qualityGateDrillDown?.[activeStationCode];
    const serverViews = gateDrillInfo?.views || [];
    const targetGateNgTotal = ngTotal;

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

    // 2. Distribute only genuine defects across views
    const scaledViewCounts = {};
    if (targetGateNgTotal > 0 && totalComputedDefects > 0) {
      let allocated = 0;
      rejectionConfig.views.forEach((v, i) => {
        const key = v.code || v.name;
        const raw = rawViewCounts[key] || 0;
        const isLast = i === rejectionConfig.views.length - 1;
        const scaled = isLast
          ? Math.max(0, targetGateNgTotal - allocated)
          : Math.round((raw / totalComputedDefects) * targetGateNgTotal);
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

      const processedZones = (v.zones || []).map((z) => {
        const zClean = cleanZoneCode(z.code || z.name);
        // Only count genuine zone matches; do not fabricate synthetic hotspots when zone is unspecified
        const rawCount = zoneCounts[zClean] || 0;
        const count = rawCount > 0 ? Math.max(1, Math.round(rawCount * scaleFactor)) : 0;

        const processedSubs = (z.subZones || []).map((sz) => {
          const szClean = cleanSubZoneCode(sz.code || sz.name);
          const pairKey = `${zClean}__${szClean}`;
          const rawSubCount = subZoneCounts[pairKey] || (rawCount > 0 && subZoneCounts[szClean]) || 0;
          const subCount = rawSubCount > 0 ? Math.max(1, Math.round(rawSubCount * scaleFactor)) : 0;
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

  // ── Total WIP (In-Progress parts across factory, properly deducting OK + NG) ──
  const totalWIP = useMemo(() => {
    const factoryWip = Math.max(0, (summary.totalProduction || 0) - ((summary.totalOK || 0) + (summary.totalNG || 0)));
    if (summary.inProgress && summary.inProgress > 0) {
      return Math.max(summary.inProgress, factoryWip);
    }
    if (factoryWip > 0) return factoryWip;
    const isLeakStationCode = (c) => {
      const u = String(c || "").toUpperCase();
      return u === "OP150" || u.startsWith("LEAK");
    };
    const leakGates = processedQualityGates.filter(g => isLeakStationCode(g.code));
    const totalLeakOk = leakGates.reduce((s, g) => s + (g.okCount || 0), 0);
    const totalLeakNg = leakGates.reduce((s, g) => s + (g.ngCount || 0), 0);
    const totalLeakInspected = totalLeakOk + totalLeakNg;

    return processedQualityGates.reduce((acc, g, idx) => {
      const nextG = processedQualityGates[idx + 1];
      if (!nextG) return acc;
      const isCur = isLeakStationCode(g.code);
      const isNext = isLeakStationCode(nextG.code);
      if (!isCur && isNext) {
        return acc + Math.max(0, (g.okCount || 0) - totalLeakInspected);
      } else if (isCur && isNext) {
        return acc; // parallel machine, 0 WIP
      } else if (isCur && !isNext) {
        return acc + Math.max(0, totalLeakOk - ((nextG.okCount || 0) + (nextG.ngCount || 0)));
      }
      return acc + Math.max(0, (g.okCount || 0) - ((nextG.okCount || 0) + (nextG.ngCount || 0)));
    }, 0);
  }, [summary, processedQualityGates]);

  // ── Dynamic Primary Hotspot Gate & #1 Root Cause Parameter ───────────────────
  const primaryHotspot = useMemo(() => {
    if (!qualityGates || qualityGates.length === 0) {
      const code = summary.topHotspotStation || "OP120";
      return {
        title: code,
        sub: "Scrap monitoring",
        isNominal: false,
      };
    }
    // Find gate with highest NG count
    const sorted = [...qualityGates].sort((a, b) => (Number(b.ngCount) || 0) - (Number(a.ngCount) || 0));
    const top = sorted[0];
    if (!top || (Number(top.ngCount) || 0) === 0) {
      return {
        title: "100% In-Spec",
        sub: "0 scrap across gates",
        isNominal: true,
      };
    }
    let cleanCode = top.code;
    if (top.code === "Leak-Test-01") cleanCode = "Leak-Test-1";
    else if (top.code === "Leak-Test-02") cleanCode = "Leak-Test-2";
    else if (top.code === "Leak Test-03") cleanCode = "Leak-Test-3";
    else if (top.shortLabel) cleanCode = top.shortLabel;

    return {
      title: cleanCode,
      sub: `${Number(top.ngCount).toLocaleString()} NG · ${top.scrapRate || 0}% Scrap`,
      isNominal: false,
    };
  }, [qualityGates, summary.topHotspotStation]);

  const primaryDriver = useMemo(() => {
    // 1. Check ML Insights features for highest statistical drift/importance
    const topFeat = mlInsights?.features?.[0];
    if (topFeat && topFeat.label) {
      const drift = Math.abs(topFeat.driftPct || 0);
      return {
        title: topFeat.label,
        sub: drift > 0 ? `${drift.toFixed(1)}% statistical drift` : "Top statistical driver",
      };
    }
    // 2. Check Pareto defect reasons if available
    if (pareto && pareto.length > 0 && pareto[0].reason) {
      return {
        title: pareto[0].reason,
        sub: `${pareto[0].percentage || 0}% of all defects`,
      };
    }
    // 3. Fallback based on summary or nominal
    if (summary.totalNG === 0) {
      return {
        title: "Parameters In-Spec",
        sub: "Zero anomaly drift",
      };
    }
    return {
      title: summary.topDriverParameter || "Process Parameters In-Spec",
      sub: "Primary defect driver",
    };
  }, [mlInsights.features, pareto, summary.totalNG, summary.topDriverParameter]);

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
            <button
              onClick={() => setShowSetParamsModal(true)}
              className="rej-action-btn"
              title="View All 31 Master Recipe Set Parameters & Process Limits"
              style={{
                background: "#f0fdf4",
                borderColor: "#bbf7d0",
                color: "#166534",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Sliders size={15} color="#16a34a" />
              <span>Master Set Parameters</span>
              <span style={{
                background: "#16a34a",
                color: "#ffffff",
                fontSize: 10,
                fontWeight: 800,
                padding: "1px 6px",
                borderRadius: 10,
              }}>
                31
              </span>
            </button>
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
            value={filters.datePreset || "last90"}
            onChange={(e) => handlePreset(e.target.value)}
            className="rej-select"
            style={{ minWidth: 125, fontWeight: 700 }}
            aria-label="Select Date Preset"
          >
            <option value="last90">90 Days</option>
            <option value="last30">30 Days</option>
            <option value="last7">7 Days</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Part Category Filter — 3 Clean Options (Referenced from Historical Reports) */}
          <select
            id="filter-partCategory"
            name="partCategory"
            value={filters.partCategory || ""}
            onChange={(e) => setFilters((p) => ({ ...p, partCategory: e.target.value }))}
            className="rej-select"
            aria-label="Filter by Part Category"
            style={{ minWidth: 200, fontWeight: 700 }}
          >
            <option value=""> All Parts</option>
            <option value="HPDC"> Casted Parts </option>
            <option value="OTHER"> Other Parts</option>
          </select>

          {/* Die Name Filter */}
          <select
            id="filter-dieName"
            name="dieName"
            value={filters.dieName || ""}
            onChange={(e) => setFilters((p) => ({ ...p, dieName: e.target.value }))}
            className="rej-select"
            aria-label="Filter by Die Name"
            style={{ minWidth: 200, fontWeight: 700 }}
          >
            <option value=""> All Dies</option>
            {filterOptions.dies && filterOptions.dies.map((die) => (
              <option key={die} value={die}>{die}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── 3. Modern Navigation Tabs ─────────────────────────────────── */}
      <div className="rej-tabs-nav">
        <button
          onClick={() => setActiveTab("overview")}
          className={`rej-tab-btn ${activeTab === "overview" ? "active" : ""}`}
        >
          <BarChart3 size={16} />
          <span>Quality Gates</span>
          <span className="rej-tab-count">{qualityGates.length} Gates</span>
        </button>

        <button
          onClick={() => setActiveTab("ml_analysis")}
          className={`rej-tab-btn ${activeTab === "ml_analysis" ? "active" : ""}`}
        >
          <Sparkles size={16} color="#8b5cf6" />
          <span>Root Cause ML</span>
          <span className="rej-tab-count">{mlInsights.features?.length || 0}</span>
        </button>

        <button
          onClick={() => setActiveTab("telemetry")}
          className={`rej-tab-btn ${activeTab === "telemetry" ? "active" : ""}`}
        >
          <Activity size={16} color="#0ea5e9" />
          <span>Telemetry & SPC</span>
        </button>

        <button
          onClick={() => setActiveTab("records")}
          className={`rej-tab-btn ${activeTab === "records" ? "active" : ""}`}
        >
          <ListFilter size={16} />
          <span>Scrap Traceability Log</span>
          <span className="rej-tab-count">{(recordsTotal || summary.totalNG || recordsRows.length || rows.length).toLocaleString()}</span>
        </button>

        <button
          onClick={() => setActiveTab("heat_map")}
          className={`rej-tab-btn ${activeTab === "heat_map" ? "active" : ""}`}
        >
          <Flame size={16} color="#ef4444" />
          <span>Defect Heatmap</span>
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
              <div className="rej-kpi-icon-wrap" style={{ background: "rgba(245,158,11,0.12)", color: "#d97706" }}>
                <Clock size={24} />
              </div>
              <div className="rej-kpi-info">
                <span className="rej-kpi-label">In-Progress (WIP)</span>
                <span className="rej-kpi-value" style={{ color: "#d97706" }}>
                  {totalWIP?.toLocaleString() || 0}
                </span>
                <span className="rej-kpi-sub" style={{ color: "#b45309" }}>
                  Parts active across gates
                </span>
              </div>
            </div>

            <div className="rej-kpi-card">
              <div className="rej-kpi-icon-wrap" style={{ background: primaryHotspot.isNominal ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)", color: primaryHotspot.isNominal ? "#16a34a" : "#d97706" }}>
                {primaryHotspot.isNominal ? <CheckCircle2 size={24} /> : <ShieldAlert size={24} />}
              </div>
              <div className="rej-kpi-info">
                <span className="rej-kpi-label">Primary Hotspot Gate</span>
                <span className="rej-kpi-value" style={{ color: primaryHotspot.isNominal ? "#16a34a" : "#d97706" }}>
                  {primaryHotspot.title}
                </span>
                <span className="rej-kpi-sub">{primaryHotspot.sub}</span>
              </div>
            </div>

            <div className="rej-kpi-card">
              <div className="rej-kpi-icon-wrap" style={{ background: "rgba(139,92,246,0.1)", color: "#8b5cf6" }}>
                <Cpu size={24} />
              </div>
              <div className="rej-kpi-info">
                <span className="rej-kpi-label">#1 Root Cause Parameter</span>
                <span className="rej-kpi-value" style={{ fontSize: 16, color: "#8b5cf6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={primaryDriver.title}>
                  {primaryDriver.title}
                </span>
                <span className="rej-kpi-sub">{primaryDriver.sub}</span>
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
                  Real-time scrap rate speedometer dials station-wise 
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

                <span className="rej-badge rej-badge-info">{processedQualityGates.length} Stations Active</span>

                {/* OP150 Grouping Toggle */}
                <button
                  onClick={() => setIsOp150Grouped((prev) => !prev)}
                  className={`rej-toggle-btn ${isOp150Grouped ? "active" : ""}`}
                  title={isOp150Grouped ? "Currently grouping Leak-01, 02, 03 into OP150 Total. Click to split into individual machines." : "Click to group all leak test machines into OP150 Total."}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: isOp150Grouped ? "rgba(37,99,235,0.08)" : "#ffffff",
                    color: isOp150Grouped ? "#1d4ed8" : "#64748b",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Layers size={13} />
                  <span>{isOp150Grouped ? "OP150: Combined" : "OP150: Split"}</span>
                </button>

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
              {(() => {
                const isLeakStationCode = (c) => {
                  const u = String(c || "").toUpperCase();
                  return u === "OP150" || u.startsWith("LEAK");
                };
                const leakGates = processedQualityGates.filter(g => isLeakStationCode(g.code));
                const totalLeakOk = leakGates.reduce((s, g) => s + (g.okCount || 0), 0);
                const totalLeakNg = leakGates.reduce((s, g) => s + (g.ngCount || 0), 0);
                const totalLeakInspected = totalLeakOk + totalLeakNg;

                return processedQualityGates.map((gate, gIdx) => {
                  const isGateSel = activeStationCode === gate.code ||
                    (gate.isGrouped && ["Leak-Test-01", "Leak-Test-02", "Leak Test-03", "OP150", "Leak-Test-1", "Leak-Test-2", "Leak-Test-3"].includes(activeStationCode)) ||
                    (activeStationCode === "Leak-Test-01" && gate.code === "Leak-Test-1") ||
                    (activeStationCode === "Leak-Test-1" && gate.code === "Leak-Test-01");
                  const statusKind = gate.scrapRate > 5 ? "danger" : (gate.scrapRate >= 2.5 ? "warning" : "ok");
                  const nextGate = processedQualityGates[gIdx + 1];

                  const isCurLeak = isLeakStationCode(gate.code);
                  const isNextLeak = nextGate ? isLeakStationCode(nextGate.code) : false;
                  const isParallelConnector = isCurLeak && isNextLeak;

                  let inProgressCount = 0;
                  if (!isCurLeak && isNextLeak) {
                    inProgressCount = Math.max(0, (gate.okCount || 0) - totalLeakInspected);
                  } else if (isCurLeak && isNextLeak) {
                    inProgressCount = 0;
                  } else if (isCurLeak && nextGate && !isNextLeak) {
                    inProgressCount = Math.max(0, totalLeakOk - ((nextGate.okCount || 0) + (nextGate.ngCount || 0)));
                  } else if (nextGate) {
                    inProgressCount = Math.max(0, (gate.okCount || 0) - ((nextGate.okCount || 0) + (nextGate.ngCount || 0)));
                  }

                  const displayCode = gate.shortLabel || gate.code;

                  return (
                    <React.Fragment key={gate.code}>
                      <div
                        className={`rej-gate-card ${isGateSel ? "active" : ""}`}
                        onClick={() => {
                          handleGateBarClick({ code: gate.code, name: displayCode, fullName: gate.name });
                          setIsStationPictorialOpen(true);
                        }}
                        title={`Click to inspect station ${displayCode} (${gate.name}) pictorial CAD and defects`}
                      >
                        <div className="rej-gate-header">
                          <span className="rej-gate-code">
                            {displayCode}
                            {isCurLeak && !gate.isGrouped && <span className="rej-gate-op-tag">OP150</span>}
                          </span>
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

                        {/* Sub-Station Breakdown Badge for Combined OP150 */}
                        {gate.isGrouped && gate.subStations && gate.subStations.length > 0 && (
                          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
                            {gate.subStations.map((sub) => (
                              <span
                                key={sub.code}
                                style={{
                                  fontSize: 9,
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                  background: "rgba(100,116,139,0.08)",
                                  color: "#475569",
                                  fontWeight: 700,
                                }}
                                title={`${sub.code}: ${sub.okCount || 0} OK / ${sub.ngCount || 0} NG (${sub.scrapRate}%)`}
                              >
                                {sub.code.replace("Leak-Test-", "LT").replace("Leak Test-", "LT")}: {sub.ngCount || 0} NG
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Active pointer indicator pointing to drawer below */}
                        {isGateSel && isStationPictorialOpen && (
                          <div className="rej-gate-active-arrow" />
                        )}
                      </div>

                      {/* ── Connector between stations: Either + Parallel Icon or Animated Flow Wire with WIP ── */}
                      {nextGate && (
                        isParallelConnector ? (
                          <div
                            className="rej-pipeline-connector parallel"
                            title={`Parallel Operation: ${displayCode} + ${nextGate.shortLabel || nextGate.code} (Concurrent OP150 Stations)`}
                          >
                            <div className="rej-parallel-connector-wrap">
                              <div className="rej-parallel-track" />
                              <div className="rej-parallel-badge" title="Parallel OP150 Station - No sequential WIP">
                                <Plus size={16} strokeWidth={3} />
                              </div>
                              <span className="rej-parallel-label">+ PARALLEL</span>
                            </div>
                          </div>
                        ) : (
                          <div
                            className="rej-pipeline-connector"
                            title={inProgressCount > 0
                              ? `${inProgressCount.toLocaleString()} parts WIP in transit: ${displayCode} → ${nextGate.shortLabel || nextGate.code}`
                              : `Flow: ${displayCode} → ${nextGate.shortLabel || nextGate.code}`}
                          >
                            <svg width="60" height="64" viewBox="0 0 60 64" style={{ display: "block", overflow: "visible" }}>
                              {/* Wire track background */}
                              <line x1="4" y1="32" x2="56" y2="32" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" />
                              {/* Colored active wire */}
                              <line x1="4" y1="32" x2="56" y2="32"
                                stroke={inProgressCount > 0 ? "#f59e0b" : "#22c55e"}
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeDasharray="4 3"
                                opacity="0.8"
                              />
                              {/* Flow particle animation */}
                              <circle r="4.5" fill={inProgressCount > 0 ? "#f59e0b" : "#16a34a"} opacity="0.95" filter="url(#glow)">
                                <animateMotion
                                  dur={inProgressCount > 0 ? "1.0s" : "2.2s"}
                                  repeatCount="indefinite"
                                  path="M4,32 L56,32"
                                />
                              </circle>
                              {/* Arrow head */}
                              <polygon points="50,27 57,32 50,37" fill={inProgressCount > 0 ? "#f59e0b" : "#22c55e"} opacity="0.85" />
                              <defs>
                                <filter id="glow">
                                  <feGaussianBlur stdDeviation="1.5" result="blur" />
                                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                                </filter>
                              </defs>
                            </svg>
                            {inProgressCount > 0 && (
                              <div className="rej-wire-badge">
                                <div className="rej-wire-header">
                                  <span className="rej-wire-dot" />
                                  <span className="rej-wire-title">WIP</span>
                                  <span className="rej-wire-arrow">→</span>
                                </div>
                                <div className="rej-wire-count">{inProgressCount.toLocaleString()}</div>
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </React.Fragment>
                  );
                });
              })()}
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
                      {!isLeakStation ? (
                        <>
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
                        </>
                      ) : (
                        <button className="rej-station-angle-btn active" style={{ cursor: "default" }}>
                          <Gauge size={12} />
                          <span>Pneumatic Parameter Monitored</span>
                          <span className="count-pill primary">
                            {(activeStationGate.ngCount || 0).toLocaleString()}
                          </span>
                        </button>
                      )}
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
                        {isLeakStation ? (
                          <span className="rej-viewport-status-badge info">
                            ⚡ Pneumatic Sensor Monitored · {activeStationGate.ngCount || 0} Pressure Decay {activeStationGate.ngCount === 1 ? "Rejection" : "Rejections"}
                          </span>
                        ) : (activeStationGate?.ngCount || 0) === 0 ? (
                          <span className="rej-viewport-status-badge ok">
                            100% In-Spec at {activeStationGate.code} (0 Defects)
                          </span>
                        ) : stationCurrentView?.totalDefects > 0 ? (
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
                        {/* Status Overlay Banners */}
                        {isLeakStation && (
                          <div className="rej-sensor-viewport-banner">
                            <Cpu size={14} color="#60a5fa" />
                            <span>Pneumatic Pressure Decay Telemetry · Internal Cavity Integrity (No visual surface zone coordinates)</span>
                          </div>
                        )}
                        {!isLeakStation && (activeStationGate?.ngCount || 0) === 0 && (
                          <div className="rej-pass-viewport-banner">
                            <CheckCircle2 size={15} color="#4ade80" />
                            <span>100% In-Spec · Zero Defects Localized at {activeStationGate.code}</span>
                          </div>
                        )}

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

                        {/* Overlaid Parent Zones (Only for visual inspection gates with genuine defect localization) */}
                        {!isLeakStation && (stationCurrentView?.zones || []).map((zone) => {
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
              {/* Level 0: All Quality Gates OK vs NG vs In-Progress */}
              {drillDownLevel === 0 && (
                <div style={{ height: 410, minWidth: qualityGateChartData.length > 8 ? qualityGateChartData.length * 115 : "100%" }}>
                  <SafeChart height={410}>
                    {({ width, height }) => (
                      <ComposedChart
                        width={width}
                        height={height}
                        data={qualityGateChartData}
                        barGap={3}
                        barCategoryGap="16%"
                        margin={{ top: 38, right: 50, left: 10, bottom: 44 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.8)" />
                        <XAxis
                          dataKey="name"
                          angle={0}
                          textAnchor="middle"
                          interval={0}
                          tick={{ fontSize: 12, fontWeight: 800, fill: "#1e293b" }}
                          height={42}
                        />
                        <YAxis yAxisId="left" domain={[0, (dataMax) => Math.ceil((dataMax || 10) * 1.18)]} tick={{ fontSize: 12, fontWeight: 700, fill: "#475569" }} width={55} />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          domain={[0, (dataMax) => Math.min(100, Math.max(10, Math.ceil(dataMax * 1.5)))]}
                          tickFormatter={(v) => `${v}%`}
                          tick={{ fontSize: 12, fontWeight: 700, fill: "#475569" }}
                          width={48}
                        />
                        <Tooltip
                          content={({ payload }) => {
                            if (!payload?.length) return null;
                            const d = payload[0]?.payload;
                            return (
                              <div style={{ background: "#fff", padding: "12px 16px", border: "1px solid #cbd5e1", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", fontSize: 13 }}>
                                <div style={{ fontWeight: 800, marginBottom: 6, color: "#1a3263", fontSize: 14 }}>{d.fullName}</div>
                                <div style={{ color: "#16a34a", marginBottom: 2 }}>✅ OK Passed: <strong>{d.OK?.toLocaleString()}</strong></div>
                                <div style={{ color: "#ef4444", marginBottom: 2 }}>❌ NG Rejected: <strong>{(d.NG > 0 ? d.NG?.toLocaleString() : "0")}</strong></div>
                                {d.inProgress > 0 && (
                                  <div style={{ color: "#d97706", marginBottom: 2 }}>⏳ In Progress: <strong>{d.inProgress?.toLocaleString()}</strong></div>
                                )}
                                <div style={{ color: "#f59e0b", marginTop: 4, borderTop: "1px solid #f1f5f9", paddingTop: 4 }}>Scrap Rate: <strong>{d.scrapRate}%</strong></div>
                                <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>Click to drill down →</div>
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 13, fontWeight: 700, paddingTop: 10 }} />
                        <Bar yAxisId="left" dataKey="OK" name="Passed OK" fill="#22c55e" radius={[5, 5, 0, 0]} cursor="pointer" maxBarSize={48}
                          onClick={(data) => handleGateBarClick(data)}
                        >
                          <LabelList dataKey="OK" position="top" style={{ fontSize: 11.5, fontWeight: 800, fill: "#15803d" }} formatter={(v) => v > 0 ? v.toLocaleString() : ""} />
                        </Bar>
                        <Bar yAxisId="left" dataKey="NG" name="Rejected NG" radius={[5, 5, 0, 0]} cursor="pointer" maxBarSize={48}
                          onClick={(data) => handleGateBarClick(data)}
                        >
                          {qualityGateChartData.map((entry, idx) => (
                            <Cell
                              key={`ng-cell-${idx}`}
                              fill={entry.NG > 0 ? "#ef4444" : "rgba(239,68,68,0.15)"}
                            />
                          ))}
                          <LabelList dataKey="NG" position="top" style={{ fontSize: 11.5, fontWeight: 800, fill: "#dc2626" }} formatter={(v) => v > 0 ? v.toLocaleString() : ""} />
                        </Bar>
                        <Bar yAxisId="left" dataKey="inProgress" name="In Progress" fill="#f59e0b" radius={[5, 5, 0, 0]} cursor="pointer" maxBarSize={48} fillOpacity={0.85}>
                          <LabelList dataKey="inProgress" position="top" style={{ fontSize: 11.5, fontWeight: 800, fill: "#b45309" }} formatter={(v) => v > 0 ? v.toLocaleString() : ""} />
                        </Bar>
                        <Line yAxisId="right" type="monotone" dataKey="scrapRate" name="Scrap Rate %" stroke="#ea580c" strokeWidth={3.5} dot={{ r: 4.5, fill: "#ea580c", strokeWidth: 2, stroke: "#ffffff" }}>
                          <LabelList dataKey="scrapRate" position="top" offset={8} style={{ fontSize: 12, fontWeight: 900, fill: "#c2410c" }} formatter={(v) => v > 0 ? `${v}%` : ""} />
                        </Line>
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
                      <BarChart width={width} height={height} data={drillDownCategoryData} margin={{ top: 36, right: 30, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.8)" />
                        <XAxis dataKey="category" angle={0} textAnchor="middle" interval={0} tick={{ fontSize: 11, fontWeight: 800, fill: "#1e293b" }} height={35} />
                        <YAxis domain={[0, (dataMax) => Math.ceil((dataMax || 10) * 1.25)]} tick={{ fontSize: 11, fontWeight: 700 }} />
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
                      <BarChart width={width} height={height} data={drillDownReasonData} margin={{ top: 36, right: 30, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.8)" />
                        <XAxis dataKey="reason" angle={0} textAnchor="middle" interval={0} tick={{ fontSize: 10, fontWeight: 700, fill: "#1e293b" }} height={45} tickFormatter={(val) => val && val.length > 15 ? `${val.slice(0, 14)}…` : val} />
                        <YAxis domain={[0, (dataMax) => Math.ceil((dataMax || 10) * 1.25)]} tick={{ fontSize: 11, fontWeight: 700 }} />
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
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      setIsStudioVisible(true);
                      setIsContextLogExpanded(true);
                      setTimeout(() => {
                        studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 100);
                    }}
                    style={{
                      background: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 14px",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      boxShadow: "0 2px 6px rgba(37,99,235,0.25)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <Eye size={14} />
                    <span>View Parts Serial Log ({(filteredDrillDownParts.length > 0 ? filteredDrillDownParts.length : drillDownMatchingParts.length).toLocaleString()})</span>
                  </button>
                  <button
                    onClick={handleDrillDownReset}
                    style={{
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: 6,
                      padding: "6px 12px",
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
                      margin={{ top: 36, right: 35, left: 5, bottom: 45 }}
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
                      <YAxis yAxisId="left" domain={[0, (dataMax) => Math.max(10, Math.ceil((dataMax || 10) * 1.22))]} tick={{ fontSize: 11, fontWeight: 700 }} />
                      <YAxis yAxisId="right" orientation="right" domain={[0, 115]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fontWeight: 700 }} />
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
                      {Boolean(drillDownGate && (drillDownGate === "OP150" || String(drillDownGate).toLowerCase().startsWith("leak"))) ? (
                        <span className="rej-viewport-status-badge info">
                          ⚡ Pneumatic Pressure Decay Telemetry
                        </span>
                      ) : currentStudioView?.totalDefects > 0 ? (
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
                      {Boolean(drillDownGate && (drillDownGate === "OP150" || String(drillDownGate).toLowerCase().startsWith("leak"))) && (
                        <div className="rej-sensor-viewport-banner">
                          <Cpu size={14} color="#60a5fa" />
                          <span>Pneumatic Pressure Decay Telemetry · Internal Cavity Integrity (No visual surface zone coordinates)</span>
                        </div>
                      )}

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
                      {Boolean(!drillDownGate || (!drillDownGate.startsWith("Leak") && drillDownGate !== "OP150")) && (currentStudioView?.zones || []).map((zone) => {
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
                    {((drillDownGate && (drillDownGate === "OP150" || drillDownGate.toLowerCase().startsWith("leak"))) ||
                      (activeGateReason && activeGateReason.toLowerCase().includes("leak"))) ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="rej-badge rej-badge-warning" style={{ fontSize: 10, padding: "2px 8px" }}>
                          ⚡ Volumetric Pressure Decay Test (Whole Part Cavity)
                        </span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          Automated sensor parameter inspection · No localized surface zone overlay
                        </span>
                      </div>
                    ) : (
                      <>
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
                      </>
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
                        <ComposedChart width={width} height={height} data={shiftChartData} margin={{ top: 35, right: 45, left: 10, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(226,232,240,0.8)" />
                        <XAxis dataKey="shift_label" tick={{ fontSize: 14, fontWeight: 800, fill: "#0f172a" }} />
                        <YAxis yAxisId="left" domain={[0, (dataMax) => Math.ceil((dataMax || 10) * 1.18)]} tick={{ fontSize: 12, fontWeight: 700, fill: "#475569" }} />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 115]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fontWeight: 700, fill: "#475569" }} />
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
          {/* Category Filter Navigation Bar for Root Cause ML */}
          
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
              {mlInsights.features?.filter((f) => mlCategoryFilter === "ALL" || f.category === mlCategoryFilter || (f.category && f.category.toLowerCase().includes(mlCategoryFilter.toLowerCase()))).map((feat, idx) => {
                const isCritical = feat.riskLevel === "CRITICAL";
                const isModerate = feat.riskLevel === "MODERATE";
                const barColor = isCritical ? "#ef4444" : isModerate ? "#f59e0b" : "#22c55e";
                const sigmaVal = feat.stdOk > 0 ? Math.abs((feat.meanNg - feat.meanOk) / feat.stdOk) : 0;
                const hasLimits = feat.hasStaticLimits && feat.setLowerLimit !== null && feat.setUpperLimit !== null;
                return (
                  <div key={feat.key} className="rej-feature-hbar-item">
                    <span className="rej-feature-hbar-label" title={`${feat.label} | LSL: ${hasLimits ? feat.setLowerLimit : '—'} | USL: ${hasLimits ? feat.setUpperLimit : '—'} | OK μ: ${feat.meanOk} | NG μ: ${feat.meanNg} ${feat.unit}`}>
                      #{idx + 1} {feat.label}
                      <span style={{ fontSize: 9, color: "#94a3b8", marginLeft: 4, fontWeight: 500 }}>
                        {hasLimits ? `[${feat.setLowerLimit}–${feat.setUpperLimit}]` : `(μ±2σ)`} {feat.unit}
                      </span>
                    </span>
                    <div className="rej-feature-hbar-track">
                      <div
                        className="rej-feature-hbar-fill"
                        style={{
                          width: `${Math.min(100, Math.max(8, feat.importanceScore))}%`,
                          background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
                        }}
                      >
                        {feat.importanceScore > 12 && (
                          <span>{sigmaVal.toFixed(1)}σ ({feat.importanceScore.toFixed(0)}%)</span>
                        )}
                      </div>
                    </div>
                    <span className="rej-feature-hbar-risk" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 9.5, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>Δ{feat.driftPct > 0 ? "+" : ""}{feat.driftPct}%</span>
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
            <div style={{ height: 420 }}>
              <SafeChart height={420}>
                {({ width, height }) => (
                  <RadarChart cx={width / 2} cy={height / 2} outerRadius={Math.min(width, height) / 2 - 35} width={width} height={height} data={radarData}>
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
                            <div style={{ color: "#22c55e" }}>OK Mean (μ): <strong>{d.okRaw} {d.unit}</strong></div>
                            <div style={{ color: "#ef4444" }}>NG Mean (μ): <strong>{d.ngRaw} {d.unit}</strong></div>
                            {d.lsl != null && <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>Recipe Limits: <strong>{d.lsl} – {d.usl} {d.unit}</strong></div>}
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
                    <th style={{ textAlign: "center" }}>LSL</th>
                    <th style={{ textAlign: "center" }}>Set Target</th>
                    <th style={{ textAlign: "center" }}>USL</th>
                    <th style={{ textAlign: "center" }}>OK Mean (μ)</th>
                    <th style={{ textAlign: "center" }}>NG Mean (μ)</th>
                    <th style={{ textAlign: "center" }}>σ (OK)</th>
                    <th style={{ textAlign: "center" }}>Deviation (Δ)</th>
                    <th style={{ textAlign: "center" }}>Z-Score</th>
                    <th>Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {mlInsights.features?.filter((f) => mlCategoryFilter === "ALL" || f.category === mlCategoryFilter || (f.category && f.category.toLowerCase().includes(mlCategoryFilter.toLowerCase()))).map((f) => {
                    const hasLimits = f.hasStaticLimits && f.setLowerLimit !== null && f.setUpperLimit !== null;
                    const deltaVal = f.deltaSetNg !== null && f.deltaSetNg !== undefined
                      ? f.deltaSetNg
                      : (f.meanNg !== null && f.meanOk !== null ? Number((f.meanNg - f.meanOk).toFixed(2)) : null);
                    const zScore = f.stdOk > 0 ? Math.abs((f.meanNg - f.meanOk) / f.stdOk) : 0;
                    // Check if NG mean is outside the spec limits
                    const ngOutsideLimits = hasLimits && (f.meanNg > f.setUpperLimit || f.meanNg < f.setLowerLimit);
                    return (
                      <tr key={f.key} style={{ background: ngOutsideLimits ? "rgba(239,68,68,0.04)" : "transparent" }}>
                        <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 800, color: "#0f172a" }}>{f.label}</span>
                            <span style={{ fontSize: 10, color: "#94a3b8" }}>({f.unit})</span>
                            {!hasLimits && <span style={{ fontSize: 8.5, fontWeight: 700, color: "#7c3aed", background: "#f5f3ff", border: "1px solid #ede9fe", borderRadius: 3, padding: "0 3px" }}>TEL</span>}
                          </div>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {hasLimits ? (
                            <span style={{ fontWeight: 800, color: "#b45309", fontSize: 11 }}>{f.setLowerLimit}</span>
                          ) : (
                            <span style={{ color: "#d4d4d8", fontSize: 11 }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {f.setPoint !== null && f.setPoint !== undefined ? (
                            <strong style={{ color: "#1d4ed8", fontSize: 12 }}>{f.setPoint}</strong>
                          ) : (
                            <span style={{ color: "#d4d4d8", fontSize: 11 }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {hasLimits ? (
                            <span style={{ fontWeight: 800, color: "#b91c1c", fontSize: 11 }}>{f.setUpperLimit}</span>
                          ) : (
                            <span style={{ color: "#d4d4d8", fontSize: 11 }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}><strong style={{ color: "#16a34a", fontSize: 11.5 }}>{f.meanOk}</strong></td>
                        <td style={{ textAlign: "center" }}><strong style={{ color: ngOutsideLimits ? "#dc2626" : "#ef4444", fontSize: 11.5 }}>{f.meanNg}</strong></td>
                        <td style={{ textAlign: "center" }}>
                          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{f.stdOk > 0 ? f.stdOk : "—"}</span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {deltaVal !== null ? (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 2,
                              fontWeight: 800, fontSize: 10.5,
                              color: Math.abs(deltaVal) > 0.5 ? "#ef4444" : "#16a34a",
                              background: Math.abs(deltaVal) > 0.5 ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
                              padding: "1px 5px", borderRadius: 4,
                            }}>
                              {deltaVal > 0 ? `+${deltaVal}` : deltaVal}
                              <span style={{ fontSize: 9.5, opacity: 0.8 }}>({f.driftPct > 0 ? `+${f.driftPct}%` : `${f.driftPct}%`})</span>
                            </span>
                          ) : (
                            <span style={{ color: "#d4d4d8" }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span style={{
                            fontWeight: 800, fontSize: 11,
                            color: zScore >= 2 ? "#dc2626" : zScore >= 1 ? "#d97706" : "#16a34a",
                          }}>
                            {zScore.toFixed(1)}σ
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

            <div style={{ height: 480 }}>
              <SafeChart height={480}>
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
          {/* Category Navigation Bar & View Mode Switcher */}
          <div className="rej-telemetry-header-card">
            <div className="rej-telemetry-category-tabs">
              {ALL_TELEMETRY_CATEGORIES.map((cat) => {
                const isActive = telemetryCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setTelemetryCategory(cat.id);
                      if (cat.params && cat.params.length > 0) {
                        setSelectedTelemetryParam(cat.params[0].key);
                      }
                    }}
                    className={`rej-category-tab-btn ${isActive ? "active" : ""}`}
                  >
                    {cat.icon === "clock" && <Clock size={15} />}
                    {cat.icon === "activity" && <Activity size={15} />}
                    {cat.icon === "droplet" && <Droplets size={15} />}
                    {cat.icon === "thermometer" && <Thermometer size={15} />}
                    <span>{cat.label}</span>
                    <span className="rej-category-count-badge">{cat.badge}</span>
                  </button>
                );
              })}
            </div>

            <div className="rej-telemetry-view-toggles">
              <button
                type="button"
                onClick={() => setTelemetryViewMode("stacked_timeline")}
                className={`rej-view-toggle-btn ${telemetryViewMode === "stacked_timeline" ? "active" : ""}`}
                title="View Synchronized Multi-Chart State Analysis"
              >
                <Activity size={14} />
                <span>Step & State Analysis</span>
              </button>
              <button
                type="button"
                onClick={() => setTelemetryViewMode("spc_detail")}
                className={`rej-view-toggle-btn ${telemetryViewMode === "spc_detail" ? "active" : ""}`}
                title="View In-Depth SPC Golden Window & Tolerances"
              >
                <Target size={14} />
                <span>Single Param SPC</span>
              </button>
            </div>
          </div>

          {/* ── View 1: Synchronized Stacked Multi-Chart Timeline ── */}
          {telemetryViewMode === "stacked_timeline" && (
            <div className="rej-stacked-charts-grid">
              <div className="rej-card" style={{ padding: "14px 20px", background: "linear-gradient(135deg, rgba(30,58,138,0.04) 0%, rgba(37,99,235,0.08) 100%)", border: "1px solid #bfdbfe" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#1e3a8a" }}>
                      {ALL_TELEMETRY_CATEGORIES.find((c) => c.id === telemetryCategory)?.label || "Telemetry Category"} ({activeCategoryParams.length} Parameters)
                    </h3>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: "#475569" }}>
                      Synchronized step & parameter duration timeline across Shift A, B, and C · Live stream directly from machine PLC <code>[ProductionReports]</code>
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="rej-badge rej-badge-ok">PLC Stream Synchronized</span>
                    <span className="rej-badge rej-badge-info">{stackedTimelineData.length} Shots Plotted</span>
                  </div>
                </div>
              </div>

              {/* Stacked Charts for each parameter in the selected category */}
              {activeCategoryParams.map((param) => {
                const vals = stackedTimelineData.map((d) => d[param.key]).filter((v) => typeof v === "number" && v > 0);
                const meanVal = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
                const minVal = vals.length > 0 ? Math.min(...vals) : 0;
                const maxVal = vals.length > 0 ? Math.max(...vals) : 0;
                const hasLimits = Boolean(param.defaultLower != null && param.defaultUpper != null);
                const setTarget = hasLimits ? Number(((param.defaultLower + param.defaultUpper) / 2).toFixed(2)) : null;

                const outOfRangeShots = hasLimits ? stackedTimelineData.filter((d) => {
                  const v = d[param.key];
                  if (v == null || v === 0) return false;
                  return (param.defaultUpper != null && v > param.defaultUpper) || (param.defaultLower != null && v < param.defaultLower);
                }) : [];
                const outOfRangeCount = outOfRangeShots.length;
                const outOfRangePct = stackedTimelineData.length > 0 ? ((outOfRangeCount / stackedTimelineData.length) * 100).toFixed(1) : 0;
                const fluctuationPct = meanVal > 0 ? Math.abs((((maxVal - minVal) / meanVal) * 100).toFixed(1)) : 0;

                return (
                  <div key={param.key} className="rej-stacked-chart-card">
                    <div className="rej-stacked-chart-header">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="rej-param-sno-badge">#{param.sNo}</span>
                        <div>
                          <h4 className="rej-stacked-chart-title">{param.label}</h4>
                          <div className="rej-stacked-chart-subtitle">
                            {hasLimits ? (
                              <>Set Recipe Target: <strong>{setTarget} {param.unit}</strong> · Allowed Range: <strong>{param.defaultLower} – {param.defaultUpper} {param.unit}</strong></>
                            ) : (
                              <>Set Recipe Limits: <strong style={{ color: "#64748b" }}>Not Configured</strong> · Live Range: <strong>{minVal.toFixed(1)} – {maxVal.toFixed(1)} {param.unit}</strong></>
                            )}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="rej-param-stat-chip" title="Live measured average and fluctuation spread">
                          Live: <strong>μ={meanVal > 0 ? meanVal.toFixed(2) : "0"} {param.unit}</strong> (Min: {minVal.toFixed(1)}, Max: {maxVal.toFixed(1)})
                        </span>
                        {fluctuationPct > 0 && (
                          <span className="rej-param-stat-chip" style={{ color: "#d97706", fontWeight: 700 }}>
                            Spread: <strong>±{fluctuationPct}%</strong>
                          </span>
                        )}
                        {hasLimits ? (
                          <span
                            className={`rej-badge ${outOfRangeCount > 0 ? "rej-badge-danger" : "rej-badge-ok"}`}
                            style={{ fontWeight: 800, padding: "3px 9px" }}
                          >
                            {outOfRangeCount > 0 ? `⚠ ${outOfRangeCount} Out of Range (${outOfRangePct}%)` : "✓ 100% In-Spec"}
                          </span>
                        ) : (
                          <span
                            className="rej-badge rej-badge-info"
                            style={{ fontWeight: 800, padding: "3px 9px" }}
                          >
                            Live Monitored ({vals.length} Shots)
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTelemetryParam(param.key);
                            setTelemetryViewMode("spc_detail");
                          }}
                          className="rej-inspect-spc-btn"
                          title="Drill down into full SPC Golden Window & Tolerances"
                        >
                          <Sliders size={12} />
                          <span>Inspect SPC</span>
                        </button>
                      </div>
                    </div>

                    <div style={{ height: 360 }}>
                      <SafeChart height={360}>
                        {({ width, height }) => (
                          <AreaChart
                            width={width}
                            height={height}
                            data={stackedTimelineData}
                            margin={{ top: 14, right: 35, left: 10, bottom: 20 }}
                          >
                            <defs>
                              <linearGradient id={`grad-${param.key}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={param.color} stopOpacity={0.38} />
                                <stop offset="95%" stopColor={param.color} stopOpacity={0.03} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={true} />
                            <XAxis
                              dataKey="timeLabel"
                              tick={{ fontSize: 10, fontWeight: 700, fill: "#475569" }}
                              interval="preserveStartEnd"
                              height={25}
                            />
                            <YAxis
                              unit={param.unit !== "—" ? ` ${param.unit}` : ""}
                              tick={{ fontSize: 10, fontWeight: 700, fill: "#475569" }}
                              width={64}
                              domain={[
                                (dataMin) => {
                                  const effectiveMin = hasLimits ? Math.min(dataMin, param.defaultLower) : dataMin;
                                  return Math.floor(effectiveMin * 0.94);
                                },
                                (dataMax) => {
                                  const effectiveMax = hasLimits ? Math.max(dataMax, param.defaultUpper) : dataMax;
                                  return Math.ceil(effectiveMax * 1.06);
                                }
                              ]}
                            />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload || !payload.length) return null;
                                const d = payload[0].payload;
                                const val = payload[0].value;
                                const isOut = hasLimits && ((param.defaultUpper != null && val > param.defaultUpper) || (param.defaultLower != null && val < param.defaultLower));
                                return (
                                  <div className="rej-stacked-tooltip">
                                    <div className="rej-stacked-tooltip-title">
                                      <span>Shot #{d.shot}</span>
                                      <span className="rej-shift-badge">Shift {d.shift}</span>
                                    </div>
                                    <div className="rej-stacked-tooltip-time">{d.dateLabel} {d.timeLabel}</div>
                                    {d.part && <div className="rej-stacked-tooltip-part">Part: {d.part}</div>}
                                    <div className="rej-stacked-tooltip-val">
                                      <span>Live Measured:</span>
                                      <strong style={{ color: isOut ? "#dc2626" : param.color, fontSize: 14 }}>
                                        {val != null ? val : 0} {param.unit}
                                      </strong>
                                    </div>
                                    {hasLimits ? (
                                      <>
                                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
                                          <span>Allowed Recipe:</span>
                                          <strong>{param.defaultLower} – {param.defaultUpper} {param.unit}</strong>
                                        </div>
                                        {isOut ? (
                                          <div className="rej-stacked-tooltip-ng" style={{ fontWeight: 800 }}>
                                            ⚠ OUT OF RANGE (Allowed: {param.defaultLower} – {param.defaultUpper} {param.unit})
                                          </div>
                                        ) : (
                                          <div style={{ marginTop: 5, padding: "2px 6px", background: "#f0fdf4", color: "#15803d", borderRadius: 4, fontSize: 10, fontWeight: 800 }}>
                                            ✓ WITHIN SPEC RANGE
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <div style={{ marginTop: 5, padding: "2px 6px", background: "#f8fafc", color: "#475569", borderRadius: 4, fontSize: 10, fontWeight: 700 }}>
                                        Live Measured · Recipe Limits Not Configured
                                      </div>
                                    )}
                                  </div>
                                );
                              }}
                            />
                            {/* Shaded Allowed In-Spec Window (Only if limits configured) */}
                            {hasLimits && param.defaultLower != null && param.defaultUpper != null && (
                              <ReferenceArea
                                y1={param.defaultLower}
                                y2={param.defaultUpper}
                                fill="#22c55e"
                                fillOpacity={0.12}
                                stroke="none"
                              />
                            )}
                            {/* USL - Upper Spec Limit */}
                            {hasLimits && param.defaultUpper != null && (
                              <ReferenceLine
                                y={param.defaultUpper}
                                stroke="#dc2626"
                                strokeWidth={1.5}
                                strokeDasharray="5 3"
                                label={{ value: `▲ USL: ${param.defaultUpper}`, position: "insideTopRight", fill: "#b91c1c", fontSize: 10, fontWeight: 800 }}
                              />
                            )}
                            {/* LSL - Lower Spec Limit */}
                            {hasLimits && param.defaultLower != null && (
                              <ReferenceLine
                                y={param.defaultLower}
                                stroke="#dc2626"
                                strokeWidth={1.5}
                                strokeDasharray="5 3"
                                label={{ value: `▼ LSL: ${param.defaultLower}`, position: "insideBottomRight", fill: "#b91c1c", fontSize: 10, fontWeight: 800 }}
                              />
                            )}
                            {/* Recipe Setpoint Centerline or Live Mean */}
                            {hasLimits && setTarget > 0 ? (
                              <ReferenceLine
                                y={setTarget}
                                stroke="#2563eb"
                                strokeDasharray="4 2"
                                strokeWidth={1.5}
                                label={{ value: `Set: ${setTarget}`, position: "insideTopLeft", fill: "#1d4ed8", fontSize: 9, fontWeight: 700 }}
                              />
                            ) : (meanVal > 0 && (
                              <ReferenceLine
                                y={Number(meanVal.toFixed(2))}
                                stroke="#64748b"
                                strokeDasharray="3 3"
                                strokeWidth={1.2}
                                label={{ value: `Live μ: ${meanVal.toFixed(2)}`, position: "insideTopLeft", fill: "#475569", fontSize: 9, fontWeight: 700 }}
                              />
                            ))}
                            <Area
                              type="monotone"
                              dataKey={param.key}
                              name={param.label}
                              stroke={param.color}
                              strokeWidth={2}
                              fill={`url(#grad-${param.key})`}
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        )}
                      </SafeChart>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── View 2: Detailed Single-Parameter SPC Analysis & Golden Window ── */}
          {telemetryViewMode === "spc_detail" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Back to Parameters Navigation Banner */}
              <div className="rej-card" style={{ padding: "10px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, background: "linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)", border: "1px solid #bfdbfe" }}>
                <button
                  type="button"
                  onClick={() => setTelemetryViewMode("stacked_timeline")}
                  className="rej-spc-back-btn"
                  title="Return to Step & State Parameter Overview"
                >
                  <ArrowLeft size={16} />
                  <span>Back to Parameter Overview</span>
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="rej-badge rej-badge-info" style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px" }}>
                    Active Parameter: <strong>{currentTelemetrySpec.label}</strong> ({currentTelemetrySpec.unit})
                  </span>
                  <button
                    type="button"
                    onClick={() => setTelemetryViewMode("stacked_timeline")}
                    className="rej-view-toggle-btn"
                    style={{ padding: "6px 12px", fontSize: 11 }}
                  >
                    <Activity size={13} />
                    <span>View All Charts</span>
                  </button>
                </div>
              </div>

              {/* Category Filter & Parameter Selector Pills */}
              <div className="rej-card" style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Category Pills */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingBottom: 10, borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#1e3a8a" }}>Parameter Category:</span>
                  {ALL_TELEMETRY_CATEGORIES.map((cat) => {
                    const isActive = telemetryCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setTelemetryCategory(cat.id);
                          if (cat.params && cat.params.length > 0) {
                            setSelectedTelemetryParam(cat.params[0].key);
                          }
                        }}
                        className={`rej-category-tab-btn ${isActive ? "active" : ""}`}
                        style={{ padding: "5px 12px", fontSize: 11.5 }}
                      >
                        <span>{cat.shortLabel}</span>
                        <span className="rej-category-count-badge">{cat.count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Individual Parameter Buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#1a3263" }}>
                    Select Parameter:
                  </span>
                  {activeCategoryParams.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setSelectedTelemetryParam(f.key)}
                      style={{
                        padding: "5px 12px",
                        borderRadius: 8,
                        fontSize: 11.5,
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
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: f.color }} />
                      <span>{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SPC Telemetry Run Chart */}
          <div className="rej-card rej-table-card">
            {/* Compact KPI Summary Strip */}
            <div className="rej-spc-kpi-grid">
              <div className="rej-spc-kpi-card target-center">
                <div className="rej-spc-kpi-label">
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2563eb" }} />
                  Set Target
                </div>
                <div className="rej-spc-kpi-value" style={{ color: "#1d4ed8" }}>
                  {currentTelemetrySpec.hasSetLimits && currentTelemetrySpec.setPoint != null ? (
                    <>{currentTelemetrySpec.setPoint} <span style={{ fontSize: 12, fontWeight: 700 }}>{currentTelemetrySpec.unit}</span></>
                  ) : (
                    <span style={{ color: "#94a3b8", fontSize: 14 }}>Not Configured</span>
                  )}
                </div>
                <div className="rej-spc-kpi-sub">
                  {currentTelemetrySpec.hasSetLimits ? "Recipe centerline setpoint" : "No recipe target defined"}
                </div>
              </div>

              <div className="rej-spc-kpi-card golden-window">
                <div className="rej-spc-kpi-label">
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a34a" }} />
                  Spec Window
                </div>
                <div className="rej-spc-kpi-value" style={{ color: "#15803d" }}>
                  {currentTelemetrySpec.hasSetLimits ? (
                    <>{currentTelemetrySpec.lsl}<span style={{ fontSize: 12, color: "#64748b", margin: "0 3px" }}>–</span>{currentTelemetrySpec.usl} <span style={{ fontSize: 12, fontWeight: 700 }}>{currentTelemetrySpec.unit}</span></>
                  ) : (
                    <span style={{ color: "#94a3b8", fontSize: 14 }}>Limits: Not Defined</span>
                  )}
                </div>
                <div className="rej-spc-kpi-sub" style={{ color: "#15803d", fontWeight: 600 }}>
                  {currentTelemetrySpec.hasSetLimits ? (() => {
                    const inCnt = telemetryTrendData.filter((d) => d.isInSpec).length;
                    return `${inCnt} In-Spec · ${telemetryTrendData.length - inCnt} Out`;
                  })() : "Live tracking mode"}
                </div>
              </div>

              <div className="rej-spc-kpi-card capability-card">
                <div className="rej-spc-kpi-label">
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#059669" }} />
                  μ ± σ
                </div>
                <div className="rej-spc-kpi-value" style={{ color: "#0f172a" }}>
                  {spcMetrics.mean} <span style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>±{spcMetrics.std}</span>
                </div>
                <div className="rej-spc-kpi-sub" style={{ fontWeight: 600 }}>
                  {spcMetrics.cpk != null ? <><strong style={{ color: spcMetrics.cpk >= 1.33 ? "#15803d" : (spcMetrics.cpk >= 1 ? "#d97706" : "#dc2626") }}>Cpk: {spcMetrics.cpk}</strong> · </> : ""}{spcMetrics.ucl != null ? `UCL: ${spcMetrics.ucl} | LCL: ${spcMetrics.lcl}` : "Live Distribution"}
                </div>
              </div>

              <div className="rej-spc-kpi-card drift-card">
                <div className="rej-spc-kpi-label">
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444" }} />
                  NG Drift
                </div>
                <div className="rej-spc-kpi-value" style={{ color: "#dc2626" }}>
                  {currentTelemetrySpec.meanNg ? currentTelemetrySpec.meanNg.toFixed(2) : "—"} <span style={{ fontSize: 12, fontWeight: 700 }}>{currentTelemetrySpec.unit}</span>
                </div>
                <div className="rej-spc-kpi-sub" style={{ color: "#b91c1c", fontWeight: 600 }}>
                  {currentTelemetrySpec.hasSetLimits ? (
                    `${telemetryTrendData.filter((d) => !d.isInSpec).length} excursions · ${telemetryTrendData.filter((d) => d.status === "NG").length} NG parts`
                  ) : (
                    `${telemetryTrendData.filter((d) => d.status === "NG").length} NG parts · ${telemetryTrendData.length} total shots`
                  )}
                </div>
              </div>
            </div>

            {/* Chart Header with Toolbar */}
            <div className="rej-card-header" style={{ marginBottom: 8 }}>
              <div>
                <h3 className="rej-card-title" style={{ fontSize: 14 }}>
                  <Activity size={16} color="#2563eb" />
                  <span>SPC Run Chart: {currentTelemetrySpec.label}</span>
                </h3>
                <p className="rej-card-subtitle" style={{ fontWeight: 600, fontSize: 11 }}>
                  Drag to select & zoom · Green area = In-Spec zone · Showing {displayedSpcData.length} of {telemetryTrendData.length} parts
                </p>
              </div>
              <div className="rej-spc-chart-toolbar">
                <button
                  type="button"
                  onClick={() => setTelemetryViewMode("stacked_timeline")}
                  className="rej-spc-toolbar-btn"
                  title="Back to Step & State Analysis"
                  style={{ color: "#1e40af", fontWeight: 750, background: "#eff6ff" }}
                >
                  <ArrowLeft size={12} />
                  <span>Back to Overview</span>
                </button>
                <span className="rej-badge rej-badge-ok" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 800, fontSize: 11 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#16a34a" }} />
                  {displayedSpcData.filter((d) => d.isInSpec).length} OK
                </span>
                <span className="rej-badge rej-badge-danger" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 800, fontSize: 11 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />
                  {displayedSpcData.filter((d) => !d.isInSpec).length} NG
                </span>

                {/* Horizontal Scroll / Fit Mode Switcher */}
                <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: 6, overflow: "hidden", background: "#f8fafc" }}>
                  <button
                    type="button"
                    onClick={() => setSpcChartMode("scroll")}
                    className={`rej-view-toggle-btn ${spcChartMode === "scroll" ? "active" : ""}`}
                    style={{ padding: "3px 8px", fontSize: 11, border: "none", borderRadius: 0 }}
                    title="Horizontal Scroll Stream (Spaced for maximum clarity)"
                  >
                    ↔ Horizontal Scroller
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpcChartMode("fit")}
                    className={`rej-view-toggle-btn ${spcChartMode === "fit" ? "active" : ""}`}
                    style={{ padding: "3px 8px", fontSize: 11, border: "none", borderRadius: 0 }}
                    title="Fit all samples to screen"
                  >
                    ⊡ Fit Screen
                  </button>
                </div>

                {/* Left/Right Scroll Buttons */}
                {spcChartMode === "scroll" && (
                  <div style={{ display: "flex", gap: 3 }}>
                    <button
                      type="button"
                      onClick={() => scrollSpcChart("left")}
                      className="rej-page-arrow-btn"
                      title="Scroll Left"
                      style={{ width: 26, height: 26 }}
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollSpcChart("right")}
                      className="rej-page-arrow-btn"
                      title="Scroll Right"
                      style={{ width: 26, height: 26 }}
                    >
                      ›
                    </button>
                  </div>
                )}

                {(spcZoomRange.start !== 0 || spcZoomRange.end != null) && (
                  <button type="button" onClick={handleSpcResetZoom} className="rej-spc-toolbar-btn">
                    <RotateCcw size={12} />
                    Reset Zoom
                  </button>
                )}
                <button type="button" onClick={exportSetVsLiveOverview} className="rej-spc-toolbar-btn" title="Download Set Params vs Live Values Overview (All Parameters)">
                  <Download size={12} />
                  Set vs Live
                </button>
              </div>
            </div>

            {/* AreaChart with horizontal scroller & drag-to-zoom */}
            <div style={{ minHeight: 580 }}>
              <SafeChart height={580}>
                {({ width, height }) => {
                  const chartWidth = spcChartMode === "scroll" ? Math.max(width, displayedSpcData.length * 30) : width;
                  return (
                    <div
                      ref={spcChartScrollRef}
                      className={spcChartMode === "scroll" ? "rej-spc-chart-scroll-wrapper" : ""}
                      style={{ width: "100%", height: "100%" }}
                    >
                      <div style={{ width: chartWidth, minWidth: "100%", height: 560, cursor: spcDragLeft != null ? "col-resize" : "crosshair" }}>
                        <ComposedChart
                          width={chartWidth}
                          height={540}
                          data={displayedSpcData}
                          margin={{ top: 20, right: 55, left: 12, bottom: 36 }}
                          onMouseDown={handleSpcMouseDown}
                          onMouseMove={handleSpcMouseMove}
                          onMouseUp={handleSpcMouseUp}
                        >
                      <defs>
                        <linearGradient id="spcAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                          <stop offset="60%" stopColor="#60a5fa" stopOpacity={0.12} />
                          <stop offset="100%" stopColor="#93c5fd" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="spcOkZoneGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.12} />
                          <stop offset="100%" stopColor="#22c55e" stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(226,232,240,0.7)" vertical={false} />
                      <XAxis
                        dataKey="index"
                        tick={{ fontSize: 11, fontWeight: 800, fill: "#0f172a" }}
                        tickLine={{ stroke: "#94a3b8" }}
                        label={{ value: "Sample Index →", position: "insideBottomRight", offset: -8, fontSize: 11, fontWeight: 800, fill: "#334155" }}
                        height={36}
                      />
                      <YAxis
                        domain={[
                          (dataMin) => {
                            const low = currentTelemetrySpec.hasSetLimits && currentTelemetrySpec.lsl != null
                              ? Math.min(dataMin, currentTelemetrySpec.lsl)
                              : (spcMetrics.lcl != null ? Math.min(dataMin, spcMetrics.lcl) : dataMin);
                            return Math.floor(low * 0.94);
                          },
                          (dataMax) => {
                            const high = currentTelemetrySpec.hasSetLimits && currentTelemetrySpec.usl != null
                              ? Math.max(dataMax, currentTelemetrySpec.usl)
                              : (spcMetrics.ucl != null ? Math.max(dataMax, spcMetrics.ucl) : dataMax);
                            return Math.ceil(high * 1.06);
                          }
                        ]}
                        tick={{ fontSize: 12, fontWeight: 800, fill: "#0f172a" }}
                        tickLine={{ stroke: "#cbd5e1" }}
                        width={60}
                        label={{ value: `${currentTelemetrySpec.label} (${currentTelemetrySpec.unit})`, angle: -90, position: "insideLeft", offset: -3, fontSize: 11, fontWeight: 800, fill: "#334155" }}
                      />
                      <Tooltip
                        content={({ payload }) => {
                          if (!payload || !payload.length) return null;
                          const data = payload[0].payload;
                          const inSpec = data.isInSpec;
                          const isNg = data.status === "NG";
                          return (
                            <div style={{ background: "#ffffff", padding: "12px 16px", border: `2px solid ${isNg ? "#ef4444" : (inSpec ? "#22c55e" : "#f59e0b")}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,0.12)", fontSize: 12, minWidth: 220 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                <strong style={{ fontSize: 13, color: "#0f172a" }}>Shot #{data.shotNumber}</strong>
                                <span style={{
                                  padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 800,
                                  background: isNg ? "rgba(239,68,68,0.15)" : (inSpec ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)"),
                                  color: isNg ? "#dc2626" : (inSpec ? "#15803d" : "#d97706"),
                                  border: `1px solid ${isNg ? "rgba(239,68,68,0.3)" : (inSpec ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)")}`
                                }}>
                                  {isNg ? "NG" : (inSpec ? "OK" : "DRIFT")}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, fontFamily: "var(--font-mono, monospace)" }}>{data.partId}</div>
                              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px" }}>
                                <span style={{ color: "#64748b", fontWeight: 600 }}>Measured:</span>
                                <strong style={{ color: inSpec ? "#15803d" : "#ef4444", fontSize: 14 }}>{data.value} {currentTelemetrySpec.unit}</strong>
                                {currentTelemetrySpec.hasSetLimits && (
                                  <>
                                    <span style={{ color: "#64748b", fontWeight: 600 }}>Target:</span>
                                    <span style={{ color: "#2563eb", fontWeight: 700 }}>{data.target ?? currentTelemetrySpec.meanOk} {currentTelemetrySpec.unit}</span>
                                    <span style={{ color: "#64748b", fontWeight: 600 }}>Window:</span>
                                    <span style={{ color: "#475569", fontWeight: 600 }}>{currentTelemetrySpec.lsl ?? "—"} – {currentTelemetrySpec.usl ?? "—"}</span>
                                    <span style={{ color: "#64748b", fontWeight: 600 }}>Delta:</span>
                                    <span style={{ color: data.delta > 0 ? "#dc2626" : "#15803d", fontWeight: 700 }}>{data.delta > 0 ? "+" : ""}{data.delta} ({data.deltaPct > 0 ? "+" : ""}{data.deltaPct}%)</span>
                                  </>
                                )}
                                {!currentTelemetrySpec.hasSetLimits && (
                                  <>
                                    <span style={{ color: "#64748b", fontWeight: 600 }}>Live μ:</span>
                                    <span style={{ color: "#2563eb", fontWeight: 700 }}>{currentTelemetrySpec.meanOk} {currentTelemetrySpec.unit}</span>
                                    <span style={{ color: "#64748b", fontWeight: 600 }}>Recipe:</span>
                                    <span style={{ color: "#94a3b8", fontWeight: 600 }}>Limits Not Configured</span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        }}
                      />

                      {/* OK Spec Zone — Green Shaded (Only if limits configured) */}
                      {currentTelemetrySpec.hasSetLimits && currentTelemetrySpec.usl != null && currentTelemetrySpec.lsl != null && (
                        <ReferenceArea y1={currentTelemetrySpec.lsl} y2={currentTelemetrySpec.usl} fill="url(#spcOkZoneGrad)" />
                      )}

                      {/* UCL */}
                      {spcMetrics.ucl > 0 && spcMetrics.ucl !== currentTelemetrySpec.usl && (
                        <ReferenceLine y={spcMetrics.ucl} stroke="#f97316" strokeWidth={1.5} strokeDasharray="6 3"
                          label={{ value: `UCL: ${spcMetrics.ucl}`, position: "insideTopRight", fill: "#ea580c", fontSize: 11, fontWeight: 800 }}
                        />
                      )}

                      {/* LCL */}
                      {spcMetrics.lcl > 0 && spcMetrics.lcl !== currentTelemetrySpec.lsl && (
                        <ReferenceLine y={spcMetrics.lcl} stroke="#f97316" strokeWidth={1.5} strokeDasharray="6 3"
                          label={{ value: `LCL: ${spcMetrics.lcl}`, position: "insideBottomRight", fill: "#ea580c", fontSize: 11, fontWeight: 800 }}
                        />
                      )}

                      {/* USL */}
                      {currentTelemetrySpec.hasSetLimits && currentTelemetrySpec.usl != null && (
                        <ReferenceLine y={currentTelemetrySpec.usl} stroke="#dc2626" strokeWidth={2} strokeDasharray="5 3"
                          label={{ value: `▲ USL: ${currentTelemetrySpec.usl}`, position: "insideTopRight", fill: "#b91c1c", fontSize: 12, fontWeight: 900 }}
                        />
                      )}

                      {/* LSL */}
                      {currentTelemetrySpec.hasSetLimits && currentTelemetrySpec.lsl != null && (
                        <ReferenceLine y={currentTelemetrySpec.lsl} stroke="#dc2626" strokeWidth={2} strokeDasharray="5 3"
                          label={{ value: `▼ LSL: ${currentTelemetrySpec.lsl}`, position: "insideBottomRight", fill: "#b91c1c", fontSize: 12, fontWeight: 900 }}
                        />
                      )}

                      {/* Target Centerline or Live Mean */}
                      {currentTelemetrySpec.hasSetLimits && currentTelemetrySpec.setPoint != null ? (
                        <ReferenceLine y={currentTelemetrySpec.setPoint} stroke="#16a34a" strokeWidth={1.5} strokeDasharray="7 4"
                          label={{ value: `⊕ Target: ${currentTelemetrySpec.setPoint}`, position: "insideTopLeft", fill: "#15803d", fontSize: 11, fontWeight: 800 }}
                        />
                      ) : ((currentTelemetrySpec.meanOk || spcMetrics.mean) > 0 && (
                        <ReferenceLine y={currentTelemetrySpec.meanOk || spcMetrics.mean} stroke="#2563eb" strokeWidth={1.5} strokeDasharray="7 4"
                          label={{ value: `Live μ: ${(currentTelemetrySpec.meanOk || spcMetrics.mean).toFixed(2)}`, position: "insideTopLeft", fill: "#1d4ed8", fontSize: 11, fontWeight: 800 }}
                        />
                      ))}

                      {/* Area Fill */}
                      <Area
                        type="monotone"
                        dataKey="value"
                        fill="url(#spcAreaGrad)"
                        stroke="none"
                        isAnimationActive={false}
                      />

                      {/* Line Trace with dots */}
                      <Line
                        type="monotone"
                        dataKey="value"
                        name={currentTelemetrySpec.label}
                        stroke="#2563eb"
                        strokeWidth={2}
                        isAnimationActive={false}
                        dot={(point) => {
                          const inSpec = point.payload.isInSpec;
                          const isNgPart = point.payload.status === "NG";
                          return (
                            <circle
                              key={point.key}
                              cx={point.cx}
                              cy={point.cy}
                              r={isNgPart ? 6 : (inSpec ? 3 : 5)}
                              fill={isNgPart ? "#ef4444" : (inSpec ? "#10b981" : "#f59e0b")}
                              stroke={isNgPart ? "#b91c1c" : (inSpec ? "#ffffff" : "#d97706")}
                              strokeWidth={isNgPart ? 2 : 1.5}
                              opacity={0.92}
                            />
                          );
                        }}
                        activeDot={{ r: 8, strokeWidth: 2, stroke: "#ffffff" }}
                      />

                      {/* Drag Selection Highlight */}
                      {spcDragLeft != null && spcDragRight != null && (
                        <ReferenceArea
                          x1={Math.min(spcDragLeft, spcDragRight)}
                          x2={Math.max(spcDragLeft, spcDragRight)}
                          fill="#3b82f6"
                          fillOpacity={0.15}
                          stroke="#2563eb"
                          strokeWidth={1}
                          strokeDasharray="4 2"
                        />
                      )}

                      {/* Brush Navigator */}
                      <Brush
                        dataKey="index"
                        height={24}
                        stroke="#3b82f6"
                        fill="rgba(241,245,249,0.95)"
                        travellerWidth={10}
                        style={{ marginTop: 6 }}
                      />
                    </ComposedChart>
                  </div>
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
                    <th style={{ minWidth: 100 }}>Die</th>
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
                            <td style={{ color: "#0ea5e9", fontWeight: 700 }}>{r.dieName || r.die_name || "—"}</td>
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

            {/* Per-Part Parameter Compliance Matrix — shows which parameters are in/out of range with set limits */}
            {(() => {
              const dataPool = rows.length > 0 ? rows : (recordsRows.length > 0 ? recordsRows : allRejectionRecords);
              if (!dataPool || !dataPool.length) return null;

              // Combined master 31-parameter list synchronized with user recipe
              const allMasterParams = MASTER_RECIPE_SET_PARAMETERS;

              const getValForRow = (r, pDef) => {
                const keys = [
                  pDef.key,
                  pDef.key?.replace(/_([a-z])/g, (_, l) => l.toUpperCase()),
                  pDef.key?.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`),
                  ...(pDef.altKeys || []),
                  ...(pDef.altKeys || []).map(k => k.replace(/_([a-z])/g, (_, l) => l.toUpperCase())),
                  ...(pDef.altKeys || []).map(k => k.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`))
                ];
                for (const k of keys) {
                  if (r[k] !== undefined && r[k] !== null && r[k] !== "" && r[k] !== "-") {
                    const n = Number(r[k]);
                    if (Number.isFinite(n) && (n > 0 || pDef.allowZero)) return Number(n.toFixed(2));
                  }
                }
                if (pDef.key.includes("leak") && r.leak_data) {
                  try {
                    const ld = typeof r.leak_data === "object" ? r.leak_data : JSON.parse(r.leak_data);
                    if (pDef.key.includes("body")) {
                      const val = Number(ld.Body_Leak_Value ?? ld.bodyLeakValue ?? ld.body_leak_value);
                      if (Number.isFinite(val)) return Number(val.toFixed(3));
                    }
                  } catch(e) {}
                }
                return null;
              };

              // Build compliance items for all distinct parts in dataPool
              const evaluatedParts = [];
              const seenIds = new Set();

              dataPool.forEach((partRow) => {
                const rawPartId = String(partRow.partId || partRow.part_id || "").trim();
                const rawCustomerQr = String(partRow.customerQrCode || partRow.customer_qr || partRow.customerQr || partRow.customer_qr_code || "").trim();
                const isQrInPartId = looksLikeCustomerQr(rawPartId) || rawPartId === rawCustomerQr;
                const displayPartId = !isQrInPartId && rawPartId !== "-" ? rawPartId : "";
                const displayCustomerQr = rawCustomerQr !== "-" && rawCustomerQr !== "" ? rawCustomerQr : (isQrInPartId ? rawPartId : "");
                const pid = displayPartId || displayCustomerQr || String(partRow.id || "").trim();
                
                if (!pid || seenIds.has(pid)) return;
                seenIds.add(pid);

                const isNg = ["NG", "FAILED", "FAIL", "ENDED_NG", "COMPLETED_NG"].includes(
                  String(partRow.status || partRow.overall_status || "").trim().toUpperCase()
                );

                const paramResults = allMasterParams.map((pDef) => {
                  const val = getValForRow(partRow, pDef);
                  if (val === null) return null;

                  const feat = mlInsights.features?.find(f => f.key === pDef.key || (pDef.altKeys && pDef.altKeys.includes(f.key)));
                  const lsl = feat?.lsl ?? feat?.setLowerLimit ?? pDef.defaultLower;
                  const usl = feat?.usl ?? feat?.setUpperLimit ?? pDef.defaultUpper;
                  const setPoint = feat?.setPoint ?? pDef.setPoint ?? ((lsl != null && usl != null) ? Number(((lsl + usl) / 2).toFixed(1)) : (feat?.meanOk ? Number(feat.meanOk.toFixed(1)) : null));
                  const inRange = (lsl == null || val >= lsl) && (usl == null || val <= usl);
                  const delta = setPoint != null ? Number((val - setPoint).toFixed(2)) : null;

                  return {
                    key: pDef.key,
                    label: pDef.label || feat?.label || pDef.key,
                    unit: pDef.unit || feat?.unit || "",
                    value: val,
                    target: setPoint,
                    lsl,
                    usl,
                    inRange,
                    delta,
                    isHigh: usl != null && val > usl,
                    isLow: lsl != null && val < lsl,
                  };
                }).filter(Boolean);

                if (!paramResults.length) return;

                const inRangeCount = paramResults.filter((p) => p.inRange).length;
                const outCount = paramResults.length - inRangeCount;
                const isAllOk = outCount === 0;

                evaluatedParts.push({
                  partId: displayPartId || pid,
                  customerQr: displayCustomerQr,
                  machine: partRow.machineName || partRow.machine_name || null,
                  shift: partRow.shiftCode || partRow.shift_code || null,
                  shotNumber: partRow.shotNumber || partRow.shot_number || null,
                  isNg,
                  isAllOk,
                  inRangeCount,
                  outCount,
                  totalParams: paramResults.length,
                  paramResults,
                });
              });

              if (!evaluatedParts.length) return null;

              // Filter evaluatedParts based on complianceFilter and complianceSearch
              let filteredParts = evaluatedParts;
              if (complianceFilter === "out_or_ng") {
                filteredParts = filteredParts.filter(p => p.outCount > 0 || p.isNg);
              } else if (complianceFilter === "ok_only") {
                filteredParts = filteredParts.filter(p => p.isAllOk && !p.isNg);
              }

              if (complianceSearch.trim()) {
                const q = complianceSearch.trim().toLowerCase();
                filteredParts = filteredParts.filter(p => 
                  p.partId.toLowerCase().includes(q) || 
                  (p.customerQr && p.customerQr.toLowerCase().includes(q)) ||
                  (p.machine && p.machine.toLowerCase().includes(q))
                );
              }

              const ngAndOutCount = evaluatedParts.filter(p => p.outCount > 0 || p.isNg).length;
              const okCount = evaluatedParts.filter(p => p.isAllOk && !p.isNg).length;

              return (
                <div className="rej-part-compliance-section">
                  {/* Filter and Controls Header Bar */}
                  <div className="rej-compliance-filter-bar">
                    <div>
                      <h4 style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                        <Target size={17} color="#2563eb" />
                        <span>Part Parameter Compliance Matrix — Set Parameters vs Live Measured Limits</span>
                      </h4>
                      <p style={{ fontSize: 11, color: "#64748b", margin: "3px 0 0 0" }}>
                        Multi-parameter recipe verification per serial part. Displays nominal setpoint & recipe window <span style={{ color: "#15803d", fontWeight: 700 }}>✓ In-Range</span> · <span style={{ color: "#dc2626", fontWeight: 700 }}>✗ Out-of-Range</span>
                      </p>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {/* Filter Tabs: All Parts, Out of Spec / NG, All OK */}
                      <div className="rej-spc-filter-pills" style={{ margin: 0, display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => setComplianceFilter("all")}
                          className={`rej-spc-filter-pill ${complianceFilter === "all" ? "active" : ""}`}
                          style={{
                            padding: "5px 12px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 750,
                            cursor: "pointer",
                            border: complianceFilter === "all" ? "1.5px solid #2563eb" : "1px solid #cbd5e1",
                            background: complianceFilter === "all" ? "#2563eb" : "#f8fafc",
                            color: complianceFilter === "all" ? "#ffffff" : "#334155",
                            transition: "all 0.15s ease",
                          }}
                        >
                          All Parts ({evaluatedParts.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setComplianceFilter("out_or_ng")}
                          className={`rej-spc-filter-pill ${complianceFilter === "out_or_ng" ? "active" : ""}`}
                          style={{
                            padding: "5px 12px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 750,
                            cursor: "pointer",
                            border: complianceFilter === "out_or_ng" ? "1.5px solid #dc2626" : "1px solid #cbd5e1",
                            background: complianceFilter === "out_or_ng" ? "#dc2626" : "#f8fafc",
                            color: complianceFilter === "out_or_ng" ? "#ffffff" : "#dc2626",
                            transition: "all 0.15s ease",
                          }}
                        >
                          Out-of-Spec & NG ({ngAndOutCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setComplianceFilter("ok_only")}
                          className={`rej-spc-filter-pill ${complianceFilter === "ok_only" ? "active" : ""}`}
                          style={{
                            padding: "5px 12px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 750,
                            cursor: "pointer",
                            border: complianceFilter === "ok_only" ? "1.5px solid #16a34a" : "1px solid #cbd5e1",
                            background: complianceFilter === "ok_only" ? "#16a34a" : "#f8fafc",
                            color: complianceFilter === "ok_only" ? "#ffffff" : "#16a34a",
                            transition: "all 0.15s ease",
                          }}
                        >
                          100% In-Spec OK ({okCount})
                        </button>
                      </div>

                      {/* Search serial / QR */}
                      <div className="rej-spc-search" style={{ minWidth: 160 }}>
                        <Search size={12} color="#94a3b8" />
                        <input
                          type="text"
                          placeholder="Filter Serial or QR..."
                          value={complianceSearch}
                          onChange={(e) => setComplianceSearch(e.target.value)}
                          style={{ padding: "4px 8px", fontSize: 11 }}
                        />
                      </div>

                      {/* Layout switcher: Horizontal Stream vs Grid */}
                      <div style={{ display: "flex", alignItems: "center", border: "1px solid #cbd5e1", borderRadius: 6, overflow: "hidden", background: "#f8fafc" }}>
                        <button
                          type="button"
                          onClick={() => setComplianceLayout("carousel")}
                          className={`rej-view-toggle-btn ${complianceLayout === "carousel" ? "active" : ""}`}
                          style={{ padding: "4px 8px", fontSize: 11, border: "none", borderRadius: 0 }}
                          title="Horizontal Scrolling Stream"
                        >
                          Horizontal Stream
                        </button>
                        <button
                          type="button"
                          onClick={() => setComplianceLayout("grid")}
                          className={`rej-view-toggle-btn ${complianceLayout === "grid" ? "active" : ""}`}
                          style={{ padding: "4px 8px", fontSize: 11, border: "none", borderRadius: 0 }}
                          title="Grid View"
                        >
                          Grid
                        </button>
                      </div>

                      {/* Carousel navigation arrows */}
                      {complianceLayout === "carousel" && (
                        <div style={{ display: "flex", gap: 3 }}>
                          <button
                            type="button"
                            onClick={() => scrollCompliance("left")}
                            className="rej-page-arrow-btn"
                            title="Scroll Left"
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            onClick={() => scrollCompliance("right")}
                            className="rej-page-arrow-btn"
                            title="Scroll Right"
                          >
                            ›
                          </button>
                        </div>
                      )}

                      {/* Export to Excel */}
                      <button
                        type="button"
                        onClick={exportComplianceMatrixExcel}
                        className="rej-spc-export-btn"
                        style={{ padding: "5px 10px", fontSize: 11 }}
                        title="Download Part Parameter Compliance Matrix Excel"
                      >
                        <Download size={12} />
                        <span>Export Matrix</span>
                      </button>
                    </div>
                  </div>

                  {/* Display Container: Carousel or Grid */}
                  <div className={complianceLayout === "carousel" ? "rej-compliance-carousel-wrapper" : ""}>
                    <div
                      ref={complianceScrollRef}
                      className={complianceLayout === "carousel" ? "rej-part-compliance-carousel" : "rej-part-compliance-grid"}
                    >
                      {filteredParts.length === 0 ? (
                        <div style={{ padding: "24px 16px", color: "#94a3b8", fontStyle: "italic", textAlign: "center", width: "100%" }}>
                          No parts matching this filter or search query.
                        </div>
                      ) : (
                        filteredParts.slice(0, 60).map((part, pIdx) => (
                          <div key={part.partId || pIdx} className={`rej-part-compliance-card ${part.isNg ? "ng-part" : "ok-part"}`}>
                            <div className="rej-part-compliance-header">
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  <span className="rej-part-compliance-serial" title={part.partId}>
                                    {part.partId}
                                  </span>
                                  {part.shotNumber && (
                                    <span className="rej-param-sno-badge" style={{ fontSize: 10 }}>#{part.shotNumber}</span>
                                  )}
                                  {part.customerQr && part.customerQr !== "-" && part.customerQr !== part.partId && (
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 3,
                                        fontSize: 9.5,
                                        fontWeight: 750,
                                        background: "rgba(37, 99, 235, 0.08)",
                                        color: "#2563eb",
                                        border: "1px solid rgba(37, 99, 235, 0.2)",
                                        borderRadius: 4,
                                        padding: "1px 5px",
                                      }}
                                      title={`Customer QR: ${part.customerQr}`}
                                    >
                                      <QrCode size={10} />
                                      {part.customerQr.length > 18 ? `${part.customerQr.slice(0, 16)}…` : part.customerQr}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                  {part.isAllOk ? (
                                    <span style={{ color: "#15803d", fontWeight: 800 }}>✓ All {part.totalParams} In-Spec</span>
                                  ) : (
                                    <>
                                      <span style={{ color: "#15803d", fontWeight: 700 }}>{part.inRangeCount} In-Spec</span>
                                      <span>·</span>
                                      <span style={{ color: "#dc2626", fontWeight: 800 }}>{part.outCount} Out-of-Range</span>
                                    </>
                                  )}
                                  {part.shift && <span>· Shift {part.shift}</span>}
                                  {part.machine && <span>· {part.machine}</span>}
                                </div>
                              </div>
                              <span className={`rej-compliance-status-pill ${part.isNg ? "ng" : "ok"}`}>
                                {part.isNg ? "NG SCRAP" : "OK PASSED"}
                              </span>
                            </div>

                            {/* Table showing Parameter, Measured Live, Recipe Window (Set), Status */}
                            <table className="rej-compliance-table">
                              <thead>
                                <tr>
                                  <th style={{ minWidth: 120 }}>Parameter</th>
                                  <th style={{ minWidth: 80 }}>Live Value</th>
                                  <th style={{ minWidth: 95 }}>Recipe Window</th>
                                  <th style={{ width: 65, textAlign: "right" }}>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {part.paramResults.map((p, pi) => (
                                  <tr key={pi}>
                                    <td style={{ fontWeight: 650, color: "#334155" }} title={p.label}>
                                      {p.label}
                                    </td>
                                    <td>
                                      <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 800, color: p.inRange ? "#15803d" : "#dc2626" }}>
                                        {p.value} <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b" }}>{p.unit}</span>
                                      </span>
                                    </td>
                                    <td style={{ color: "#475569", fontSize: 10.5 }}>
                                      <strong>{p.lsl != null ? p.lsl : "—"}</strong> to <strong>{p.usl != null ? p.usl : "—"}</strong> {p.unit}
                                      {p.target != null && <span style={{ color: "#2563eb", marginLeft: 3 }}>(Set: {p.target})</span>}
                                    </td>
                                    <td style={{ textAlign: "right" }}>
                                      {p.inRange ? (
                                        <span className="rej-compliance-in-range" style={{ fontSize: 10.5 }}>✓ OK</span>
                                      ) : (
                                        <span className="rej-compliance-out-range" style={{ fontSize: 10.5 }}>
                                          {p.isHigh ? "▲ High" : "▼ Low"}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
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
                  {isCompactRecords ? <LayoutList size={18} /> : <ListFilter size={18} />}
                </div>
                <div>
                  <h3 className="rej-card-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
                    {isCompactRecords ? "Station NG Log" : "Comprehensive HPDC Casting Production & Scrap Traceability Log"}
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
              <button
                onClick={() => setIsCompactRecords(!isCompactRecords)}
                className={`rej-action-btn ${isCompactRecords ? "primary" : "secondary"}`}
                style={{ padding: "8px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
                title="Toggle Compact Station NG View"
              >
                {isCompactRecords ? <ListFilter size={15} /> : <LayoutList size={15} />}
                <span>{isCompactRecords ? "View All Stations" : "View NG Station Only"}</span>
              </button>

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
              columns={isCompactRecords ? tableColumnsNgCompact : tableColumns}
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

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* ── MODAL: MASTER CASTING RECIPE & PARAMETER INTELLIGENCE VIEWER ────────── */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {showSetParamsModal && (() => {
        // Resolve dynamic spec for each parameter from live DB / ML features
        const resolveParam = (p) => {
          const feat = mlInsights.features?.find(f => f.key === p.key || (p.altKeys && p.altKeys.includes(f.key)));
          const hasLimits = (feat && feat.hasStaticLimits && feat.setLowerLimit !== null && feat.setUpperLimit !== null)
            ? true
            : Boolean(p.hasStaticLimits && p.defaultLower !== null && p.defaultUpper !== null);

          const lsl = (feat && feat.setLowerLimit !== null && feat.setLowerLimit !== undefined)
            ? feat.setLowerLimit
            : (hasLimits ? p.defaultLower : null);

          const usl = (feat && feat.setUpperLimit !== null && feat.setUpperLimit !== undefined)
            ? feat.setUpperLimit
            : (hasLimits ? p.defaultUpper : null);

          const nominal = (feat && feat.setPoint !== null && feat.setPoint !== undefined)
            ? feat.setPoint
            : (hasLimits ? p.setPoint : null);

          const unit = (feat && feat.unit) ? feat.unit : p.unit;
          const liveMean = feat?.meanNg && feat.meanNg > 0 ? feat.meanNg : (feat?.meanOk && feat.meanOk > 0 ? feat.meanOk : null);

          return { p, feat, hasLimits, lsl, usl, nominal, unit, liveMean };
        };

        const resolvedList = MASTER_RECIPE_SET_PARAMETERS.map(resolveParam);
        const recipeBoundParams = resolvedList.filter(item => item.hasLimits);
        const telemetryOnlyParams = resolvedList.filter(item => !item.hasLimits);
        const totalParams = resolvedList.length;

        // Compute how many recipe-bound params have live data with drift
        let driftUpCount = 0, driftDownCount = 0, optimalCount = 0, noDataCount = 0;
        recipeBoundParams.forEach(item => {
          if (item.liveMean !== null && item.nominal !== null) {
            const d = item.liveMean - item.nominal;
            if (d > 0.05) driftUpCount++;
            else if (d < -0.05) driftDownCount++;
            else optimalCount++;
          } else {
            noDataCount++;
          }
        });

        return (
        <div
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(8px)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            animation: "fadeIn 0.15s ease-out",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSetParamsModal(false); }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(226,232,240,0.6)",
              width: "100%",
              maxWidth: 1340,
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* ── HEADER ── */}
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg, #3b82f6, #2563eb)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                  <Sliders size={16} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.01em" }}>
                    Master Casting Recipe
                  </h3>
                 
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  onClick={() => {
                    const csvContent = [
                      ["#", "Parameter", "DB Key", "Subsystem", "LSL", "Nominal", "USL", "Live Value", "Drift", "Mode", "Unit"],
                      ...resolvedList.map(({ p, hasLimits, lsl, nominal, usl, liveMean, unit }) => {
                        const drift = (liveMean !== null && nominal !== null) ? (liveMean - nominal).toFixed(2) : "—";
                        return [
                          p.id, p.label, p.key, p.category,
                          hasLimits ? (lsl !== null ? lsl : "—") : "—",
                          hasLimits ? (nominal !== null ? nominal : "—") : "—",
                          hasLimits ? (usl !== null ? usl : "—") : "—",
                          liveMean !== null ? liveMean : "—",
                          drift !== "—" ? `${drift > 0 ? "+" : ""}${drift}` : "—",
                          hasLimits ? "Recipe Bound" : "Telemetry Only",
                          unit,
                        ];
                      }),
                    ].map((e) => e.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
                    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
                    saveAs(blob, `Master_Recipe_${new Date().toISOString().slice(0,10)}.csv`);
                  }}
                  style={{ fontSize: 10.5, display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontWeight: 700, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, color: "#fff", cursor: "pointer", transition: "all 0.15s ease" }}
                  title="Export to CSV"
                >
                  <Download size={12} />
                  <span>Export</span>
                </button>
                <button
                  onClick={() => setShowSetParamsModal(false)}
                  style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.7)", transition: "all 0.15s ease" }}
                  title="Close (Esc)"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* ── STATS STRIP ── */}
            <div style={{ padding: "8px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { label: "Recipe Gated", value: `${recipeBoundParams.length}`, sub: "LSL/USL Enforced", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
                { label: "Telemetry Only", value: `${telemetryOnlyParams.length}`, sub: "No Set Limits", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
                { label: "Optimal", value: `${optimalCount}`, sub: "Within ±0.05", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
                { label: "Drifting ▲", value: `${driftUpCount}`, sub: "Above Target", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
                { label: "Drifting ▼", value: `${driftDownCount}`, sub: "Below Target", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
              ].map((tile) => (
                <div key={tile.label} style={{ flex: "1 1 140px", padding: "6px 10px", borderRadius: 6, background: tile.bg, border: `1px solid ${tile.border}`, minWidth: 120 }}>
                  <div style={{ fontSize: 9.5, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{tile.label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 1 }}>
                    <span style={{ fontSize: 16, fontWeight: 900, color: tile.color }}>{tile.value}</span>
                    <span style={{ fontSize: 9.5, color: tile.color, fontWeight: 600, opacity: 0.8 }}>{tile.sub}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── TOOLBAR: SEARCH + SCOPE + CATEGORY ── */}
            <div style={{ padding: "8px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#fff" }}>
              {/* Search */}
              <div style={{ position: "relative", width: 240 }}>
                <Search size={13} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
                <input
                  type="text" placeholder="Search parameters..."
                  value={setParamsSearch} onChange={(e) => setSetParamsSearch(e.target.value)}
                  style={{ width: "100%", padding: "5px 8px 5px 26px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 11, outline: "none", background: "#f8fafc" }}
                />
                {setParamsSearch && (
                  <button onClick={() => setSetParamsSearch("")} style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", color: "#94a3b8", padding: 0 }}>
                    <X size={11} />
                  </button>
                )}
              </div>

              {/* Scope Switcher */}
              <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden", background: "#f8fafc" }}>
                {[
                  { key: "ALL", label: `All (${totalParams})`, activeColor: "#1e293b" },
                  { key: "RECIPE_BOUND", label: `Recipe (${recipeBoundParams.length})`, activeColor: "#16a34a" },
                  { key: "AI_DYNAMIC", label: `Telemetry (${telemetryOnlyParams.length})`, activeColor: "#7c3aed" },
                ].map((s, i) => (
                  <button
                    key={s.key}
                    onClick={() => setSetParamsScope(s.key)}
                    style={{
                      padding: "4px 10px", fontSize: 10.5, fontWeight: 700, border: "none",
                      borderLeft: i > 0 ? "1px solid #e2e8f0" : "none",
                      cursor: "pointer",
                      background: setParamsScope === s.key ? s.activeColor : "transparent",
                      color: setParamsScope === s.key ? "#fff" : "#475569",
                      transition: "all 0.12s ease",
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Divider */}
              <div style={{ width: 1, height: 20, background: "#e2e8f0" }} />
            </div>

            {/* ── TABLE BODY ── */}
            <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 3 }}>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={{ width: 32, textAlign: "center", padding: "7px 4px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1" }}>#</th>
                    <th style={{ textAlign: "left", padding: "7px 8px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1", minWidth: 160 }}>PARAMETER</th>
                    <th style={{ textAlign: "left", padding: "7px 8px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1" }}>SUBSYSTEM</th>
                    <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#d97706", borderBottom: "2px solid #fde68a", background: "#fffbeb", minWidth: 60 }}>LSL</th>
                    <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#2563eb", borderBottom: "2px solid #93c5fd", background: "#eff6ff", minWidth: 70 }}>NOMINAL</th>
                    <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#dc2626", borderBottom: "2px solid #fca5a5", background: "#fef2f2", minWidth: 60 }}>USL</th>
                    <th style={{ textAlign: "center", padding: "7px 8px", fontSize: 10, fontWeight: 700, color: "#0f172a", borderBottom: "2px solid #cbd5e1", minWidth: 80 }}>LIVE VALUE</th>
                    <th style={{ textAlign: "center", padding: "7px 8px", fontSize: 10, fontWeight: 700, color: "#0f172a", borderBottom: "2px solid #cbd5e1", minWidth: 80 }}>DRIFT (Δ)</th>
                    <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1", minWidth: 80 }}>MODE</th>
                    <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1", width: 50 }}>UNIT</th>
                  </tr>
                </thead>
                <tbody>
                  {resolvedList.filter((item) => {
                    const { p, hasLimits } = item;
                    if (setParamsScope === "RECIPE_BOUND" && !hasLimits) return false;
                    if (setParamsScope === "AI_DYNAMIC" && hasLimits) return false;
                    if (setParamsCategoryFilter !== "ALL" && p.category !== setParamsCategoryFilter) return false;
                    if (setParamsSearch) {
                      const q = setParamsSearch.toLowerCase();
                      return p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q) || item.unit.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q));
                    }
                    return true;
                  }).map((item, idx) => {
                    const { p, feat, hasLimits, lsl, nominal, usl, unit, liveMean } = item;

                    // Drift: only compute vs nominal for recipe-bound params
                    const targetRef = hasLimits && nominal !== null ? nominal : null;
                    const delta = (liveMean !== null && targetRef !== null) ? Number((liveMean - targetRef).toFixed(2)) : null;

                    const isUp = delta !== null && delta > 0.05;
                    const isDown = delta !== null && delta < -0.05;
                    const isOptimal = delta !== null && Math.abs(delta) <= 0.05;

                    // Row background
                    const rowBg = !hasLimits
                      ? (idx % 2 === 0 ? "rgba(245, 243, 255, 0.4)" : "rgba(245, 243, 255, 0.2)")
                      : (idx % 2 === 0 ? "#ffffff" : "#fafbfc");

                    return (
                      <tr key={p.id || p.key} style={{ background: rowBg, borderBottom: "1px solid #f1f5f9", transition: "background 0.1s" }}>
                        {/* # */}
                        <td style={{ textAlign: "center", fontWeight: 700, color: "#94a3b8", padding: "5px 4px", fontSize: 10 }}>{p.id}</td>

                        {/* PARAMETER */}
                        <td style={{ padding: "5px 8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 11 }}>{p.label}</span>
                            {!hasLimits && (
                              <span style={{ fontSize: 8.5, fontWeight: 700, color: "#7c3aed", background: "#f5f3ff", border: "1px solid #ede9fe", borderRadius: 3, padding: "0px 4px", lineHeight: "16px", letterSpacing: "0.02em" }} title="No recipe limits set — telemetry monitoring only">
                                TELEMETRY
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 9.5, color: "#94a3b8", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", marginTop: 1, fontWeight: 500 }}>{p.key}</div>
                        </td>

                        {/* SUBSYSTEM */}
                        <td style={{ padding: "5px 8px" }}>
                          <span style={{ background: "#f1f5f9", color: "#475569", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>{p.category}</span>
                        </td>

                        {/* LSL */}
                        <td style={{ textAlign: "center", padding: "5px 4px", background: hasLimits ? "rgba(251, 191, 36, 0.04)" : "transparent" }}>
                          {hasLimits && lsl !== null ? (
                            <span style={{ fontWeight: 800, color: "#b45309", fontSize: 11 }}>{lsl}</span>
                          ) : (
                            <span style={{ color: "#d4d4d8", fontSize: 11 }}>—</span>
                          )}
                        </td>

                        {/* NOMINAL */}
                        <td style={{ textAlign: "center", padding: "5px 4px", background: hasLimits ? "rgba(37, 99, 235, 0.04)" : "transparent" }}>
                          {hasLimits && nominal !== null ? (
                            <span style={{ fontWeight: 900, color: "#1d4ed8", fontSize: 11.5, background: "#eff6ff", padding: "1px 6px", borderRadius: 3, border: "1px solid #bfdbfe" }}>{nominal}</span>
                          ) : (
                            <span style={{ color: "#d4d4d8", fontSize: 11 }}>—</span>
                          )}
                        </td>

                        {/* USL */}
                        <td style={{ textAlign: "center", padding: "5px 4px", background: hasLimits ? "rgba(239, 68, 68, 0.04)" : "transparent" }}>
                          {hasLimits && usl !== null ? (
                            <span style={{ fontWeight: 800, color: "#b91c1c", fontSize: 11 }}>{usl}</span>
                          ) : (
                            <span style={{ color: "#d4d4d8", fontSize: 11 }}>—</span>
                          )}
                        </td>

                        {/* LIVE VALUE */}
                        <td style={{ textAlign: "center", padding: "5px 6px" }}>
                          {liveMean !== null ? (
                            <span style={{ fontWeight: 750, color: "#0f172a", fontSize: 11 }}>
                              {typeof liveMean === 'number' ? liveMean.toFixed ? (liveMean % 1 !== 0 ? liveMean.toFixed(2) : liveMean) : liveMean : liveMean}
                              <span style={{ color: "#94a3b8", fontSize: 9, marginLeft: 2 }}>{unit}</span>
                            </span>
                          ) : (
                            <span style={{ color: "#d4d4d8", fontSize: 10, fontStyle: "italic" }}>—</span>
                          )}
                        </td>

                        {/* DRIFT */}
                        <td style={{ textAlign: "center", padding: "5px 6px" }}>
                          {hasLimits && delta !== null ? (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 2,
                              fontWeight: 800, fontSize: 10,
                              padding: "1px 5px", borderRadius: 3,
                              background: isUp ? "#fef2f2" : isDown ? "#eff6ff" : "#f0fdf4",
                              color: isUp ? "#dc2626" : isDown ? "#2563eb" : "#16a34a",
                              border: `1px solid ${isUp ? "#fecaca" : isDown ? "#bfdbfe" : "#bbf7d0"}`,
                            }}>
                              {isUp && <>▲ +{Math.abs(delta).toFixed(1)}</>}
                              {isDown && <>▼ −{Math.abs(delta).toFixed(1)}</>}
                              {isOptimal && <>● OK</>}
                            </span>
                          ) : !hasLimits && liveMean !== null ? (
                            <span style={{ color: "#a78bfa", fontSize: 9.5, fontWeight: 600 }} title="No set target — drift cannot be calculated">
                              n/a
                            </span>
                          ) : (
                            <span style={{ color: "#d4d4d8", fontSize: 10 }}>—</span>
                          )}
                        </td>

                        {/* MODE */}
                        <td style={{ textAlign: "center", padding: "5px 4px" }}>
                          {hasLimits ? (
                            <span style={{
                              fontSize: 9, fontWeight: 700, color: "#15803d",
                              background: "#f0fdf4", border: "1px solid #bbf7d0",
                              padding: "1px 5px", borderRadius: 3,
                              display: "inline-flex", alignItems: "center", gap: 2,
                            }}>
                            Recipe
                            </span>
                          ) : (
                            <span style={{
                              fontSize: 9, fontWeight: 700, color: "#7c3aed",
                              background: "#f5f3ff", border: "1px solid #ddd6fe",
                              padding: "1px 5px", borderRadius: 3,
                              display: "inline-flex", alignItems: "center", gap: 2,
                            }}>
                              <span style={{ fontSize: 8 }}>📡</span> Monitor
                            </span>
                          )}
                        </td>

                        {/* UNIT */}
                        <td style={{ textAlign: "center", padding: "5px 4px" }}>
                          <span style={{ fontWeight: 600, color: "#64748b", fontSize: 10 }}>{unit}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── FOOTER ── */}
            <div style={{ padding: "8px 20px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 10.5, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#16a34a", display: "inline-block" }} /> Recipe-Gated: LSL/USL enforced from standard recipe</span>
                <span style={{ color: "#cbd5e1" }}>|</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#7c3aed", display: "inline-block" }} /> Telemetry: No set limits — live monitoring only, dash (—) shown</span>
                <span style={{ color: "#cbd5e1" }}>|</span>
                <span>Drift computed only for recipe-bound parameters against nominal setpoint</span>
              </div>
              <button
                onClick={() => setShowSetParamsModal(false)}
                style={{ padding: "5px 14px", fontSize: 11, fontWeight: 700, background: "#1e293b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
