// ═══════════════════════════════════════════════════════════════════════════
// ── REJECTION ANALYSIS CONSTANTS & UTILITIES ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
import { getDefaultBackendOrigin } from "../../constants/network";

export const formatResultTimestamp = (value) => {
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
  { id: 1, sNo: 1, key: "plc_cycle_time", altKeys: ["plcCycleTime"], label: "Cycle Time", unit: "sec", color: "#16a34a", defaultLower: null, defaultUpper: null, setPoint: null, category: "Machine Process Parameter", categoryId: "machine_process", icon: "clock", hasStaticLimits: false },
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

export const PARETO_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6", "#a855f7", "#ec4899"];

export const looksLikeCustomerQr = (val) => {
  if (!val || typeof val !== "string") return false;
  const s = val.trim();
  if (s === "-" || !s) return false;
  if (/^R\d{3,}/i.test(s)) return true;
  if (/^[A-Z0-9-]{24,}$/i.test(s)) return true;
  if (s.includes("+") || s.includes("/")) return true;
  return false;
};

export const fmtNum = (val) => {
  if (val === null || val === undefined || val === "" || val === "-" || val === "null" || val === "undefined") return "";
  const n = Number(val);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : val;
};

export const extractShotFromPartId = (partId) => {
  const s = String(partId || "").trim();
  if (!s || s === "-") return "";
  if (looksLikeCustomerQr(s) || (s.startsWith("0408") && s.length >= 20)) return "";

  const trailingAlphaNum = s.match(/[A-Za-z](\d{3,5})$/);
  if (trailingAlphaNum?.[1]) return trailingAlphaNum[1];

  const hyphenated = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})[-_]?(?<machineCode>[A-Za-z0-9]+)[-_](?<shot>\d{1,6})$/);
  if (hyphenated?.groups?.shot) return String(Number(hyphenated.groups.shot)).trim();

  const machineCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machineCode>[A-Za-z0-9]{1})(?<shot>\d{1,6})$/i);
  if (machineCompact?.groups?.shot) return String(Number(machineCompact.groups.shot)).trim();

  const legacyCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})[-_]?(?<shot>\d{1,6})$/);
  if (legacyCompact?.groups?.shot) return String(Number(legacyCompact.groups.shot)).trim();

  const trailingDigits = s.match(/[-_](\d{3,5})$/);
  if (trailingDigits?.[1]) return trailingDigits[1];

  return "";
};

export const extractShotDateTimeFromPartId = (partId) => {
  const s = String(partId || "").trim();
  if (!s || s === "-" || looksLikeCustomerQr(s) || (s.startsWith("0408") && s.length >= 20)) return null;

  const m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (m) {
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    const hour = parseInt(m[3], 10);
    const minute = parseInt(m[4], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const year = new Date().getFullYear();
      const d = new Date(year, month - 1, day, hour, minute, 0);
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString();
      }
    }
  }
  return null;
};

export const splitZoneString = (val) => {
  const raw = String(val || "").trim();
  if (!raw || raw === "-") return { zone: "", subZone: "" };
  const parts = raw.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
  let z = "";
  let sz = "";
  parts.forEach((p) => {
    const sm = p.match(/^(?:sub\s*zone|subzone)\s*[:-]?\s*(.+)$/i);
    if (sm) { sz = sm[1].trim(); return; }
    const zm = p.match(/^zone\s*[:-]?\s*(.+)$/i);
    if (zm) { z = zm[1].trim(); return; }
    if (!z) z = p;
  });
  return { zone: z || raw || "", subZone: sz || "" };
};

export const parseFieldFromText = (text, label) => {
  if (!text || typeof text !== "string") return "";
  const m = text.match(new RegExp(label + ":\\s*([^|\\n]+)", "i"));
  return m ? m[1].trim() : "";
};

export const cleanZoneCode = (val) => {
  if (!val) return "";
  return String(val)
    .toUpperCase()
    .replace(/^(?:ZONE\s*[-_]?)+/i, "")
    .replace(/[^A-Z0-9]/g, "");
};

export const cleanSubZoneCode = (val) => {
  if (!val) return "";
  return String(val)
    .toUpperCase()
    .replace(/^(?:(?:SUB\s*ZONE|SUBZONE|SUB)\s*[-_]?)+/i, "")
    .replace(/[^A-Z0-9]/g, "");
};

export const normalizeCode = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export const canonicalizeReason = (raw) => {
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
  if (lower.includes("op150") || lower.includes("op 150")) return "Pressure Leakage Fail (OP150)";
  if (lower.includes("body leak")) return "Body Leak Fail";
  if (lower.includes("pressure leak")) return "Pressure Leakage Fail (OP150)";
  if (lower.includes("leak") || lower.includes("leakage")) return "Pressure Leakage Fail (OP150)";
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

export const normalizeDefectKey = (val) => String(val || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export const isReasonMatch = (rowReason, targetReason) => {
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

export const normalizeDefectCategory = (rawCat, gate, reason) => {
  // Leak test rejects are casting porosity found after machining → CRAM, whatever category was stored
  const gU = String(gate || "").toUpperCase();
  if (gU.includes("LEAK") || gU === "OP150" || String(reason || "").toLowerCase().includes("leak")) return "CRAM";
  let c = String(rawCat || "").trim().toUpperCase();
  if (["CR", "CASTING", "CASTING REJECTION"].includes(c)) return "CR";
  if (["CRAM", "CR-AM", "CASTING REJECTION AFTER MACHINING"].includes(c)) return "CRAM";
  if (["MR", "MACHINING", "MACHINING REJECTION"].includes(c)) return "MR";
  const r = String(reason || "").toLowerCase();
  const g = String(gate || "").toUpperCase();
  if (r.includes("blow hole") || r.includes("porosity") || r.includes("face blow hole")) return "CRAM";
  if (r.includes("gauge") || r.includes("machin") || g === "OP140") return "MR";
  return "CR";
};

export const parseRowDefect = (r) => {
  if (!r) return { category: "CR", reason: "Defect", view: "", zone: "", subZone: "" };
  const srcText = String(r.parts_interlock_reason || r.ng_reason || r.ngReason || r.reason || r.rejection_reason || "");
  const catMatch = srcText.match(/Category:\s*([^|\n]+)/i);
  const reasonMatch = srcText.match(/Reason:\s*([^|\n]+)/i);
  const viewMatch = srcText.match(/View:\s*([^|\n]+)/i);
  const zoneMatch = srcText.match(/Zone:\s*([^|\n]+)/i);
  const subZoneMatch = srcText.match(/(?:Sub\s*Zone|SubZone):\s*([^|\n]+)/i);

  let rawReason = r.rejection_reason || r.reason || r.ng_reason || r.ngReason || (reasonMatch ? reasonMatch[1].trim() : "");
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

  // "D / Sub Zone D-4" → zone "D", sub-zone "D-4". Split on the separator only — sub-zone codes contain "-".
  if (zoneRaw.includes("/") || zoneRaw.includes(" - ")) {
    const parts = zoneRaw.includes("/") ? zoneRaw.split(/\s*\/\s*/) : zoneRaw.split(" - ");
    if (parts[0]) zoneRaw = parts[0].trim();
    if (parts[1] && !subZoneRaw) {
      subZoneRaw = parts[1].replace(/^(?:sub\s*zone|subzone)\s*:?\s*/i, "").trim();
    }
  }

  // The report API fills unrecorded locations with station placeholders ("Zone General" + "Front").
  // They are not CAD zones, so treat them as "not recorded".
  if (isPlaceholderZone(zoneRaw)) {
    zoneRaw = "";
    subZoneRaw = isPlaceholderZone(subZoneRaw) ? "" : subZoneRaw;
    if (/^FRONT$/i.test(String(view).trim())) view = "";
  }
  if (isPlaceholderView(view)) view = "";
  const recordedZone = !!zoneRaw;

  const isLeakDefect = String(reason).toLowerCase().includes("leak") || String(gateIdentifier).toUpperCase().includes("150") || String(gateIdentifier).toUpperCase().includes("LEAK");
  if (!view || !zoneRaw) {
    const rLower = String(reason).toLowerCase();
    if (isLeakDefect) {
      // leak rejects come from the pressure-decay sensor: there is no visual location to plot
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
    // true when the zone was not recorded at inspection and comes from the defect-type default above
    inferred: !recordedZone && !!zoneRaw,
    sensorReject: isLeakDefect,
  };
};

const PLACEHOLDER_ZONES = new Set(["GENERAL", "DCM", "GUAGING", "GAUGING", "LEAKTEST", "UNSPECIFIED", "NA", "NONE", "OTHER", "OTHERS"]);
const PLACEHOLDER_VIEWS = new Set(["LEAKTESTING", "GUAGINGVIEW", "GAUGINGVIEW", "UNSPECIFIED", "NA", "NONE"]);
export const isPlaceholderZone = (val) => {
  const c = cleanZoneCode(val);
  return !c || PLACEHOLDER_ZONES.has(c);
};
const isPlaceholderView = (val) => PLACEHOLDER_VIEWS.has(normalizeCode(val));

// "Top View", "TOP", "top_view", "View 1" → comparable token
const viewToken = (val) => {
  const n = normalizeCode(val);
  const numbered = n.match(/^VIEW(\d)$/);
  if (numbered) return ["", "TOP", "BOTTOM", "LEFT", "RIGHT", "FRONT", "REAR"][Number(numbered[1])] || n;
  return n.replace(/VIEW|SIDE/g, "") || n;
};

/**
 * Place a parsed defect (from parseRowDefect) on the configured CAD views.
 * Matching is exact on cleaned codes/names — never substring — so "Zone General" can't land on zone "A".
 * Returns indices into views / view.zones / zone.subZones (-1 when unresolved).
 */
export const resolveDefectLocation = (parsed, views = []) => {
  const out = { viewIndex: -1, zoneIndex: -1, subIndex: -1, inferred: !!parsed?.inferred };
  if (!parsed || !views.length) return out;
  const zc = cleanZoneCode(parsed.zone);
  const sc = cleanSubZoneCode(parsed.subZone);
  const vt = parsed.view ? viewToken(parsed.view) : "";

  const zoneIdx = (v) => (v.zones || []).findIndex((z) => [z.code, z.name].some((k) => k && cleanZoneCode(k) === zc));
  const subIdx = (z) => (z?.subZones || []).findIndex((s) => [s.code, s.name].some((k) => k && cleanSubZoneCode(k) === sc));

  if (vt) out.viewIndex = views.findIndex((v) => [v.code, v.name].some((k) => k && viewToken(k) === vt));
  if (zc) {
    if (out.viewIndex >= 0) {
      out.zoneIndex = zoneIdx(views[out.viewIndex]);
    } else {
      // No usable view: accept the zone only if exactly one view defines it.
      const hits = views.map((v, i) => [i, zoneIdx(v)]).filter(([, zi]) => zi >= 0);
      if (hits.length === 1) [out.viewIndex, out.zoneIndex] = hits[0];
    }
  }
  if (out.zoneIndex >= 0 && sc) out.subIndex = subIdx(views[out.viewIndex].zones[out.zoneIndex]);
  return out;
};

export const getFullImageUrl = (url) => {
  if (!url) return "";
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return getDefaultBackendOrigin() + (url.startsWith("/") ? url : "/" + url);
};

export const isRecordMatchingStation = (r, stationCode) => {
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

  // The record names the gate(s) that rejected it (e.g. "OP120" or "OP130, OP150"): that is authoritative.
  // The keyword heuristics below are only for older records without it.
  const recordedGates = rNgGate.split(/[,;\s]+/).filter(Boolean);
  if (recordedGates.length) {
    const hit = isLeakStation
      ? recordedGates.some((g) => g === "OP150" || g.includes("LEAK"))
      : recordedGates.includes(sUpper);
    if (!hit) return false;
    if (!isLeakStation || ["OP150", "LEAK-TEST-OP150", "LEAK"].includes(sUpper)) return true;
  }

  if (isLeakStation) {
    const isOp150NG = ["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(String(r.op150_status || "").toUpperCase());
    const isLeakDataNG = r.leak_data && (
      (typeof r.leak_data === "object" && (r.leak_data.result === "NG" || r.leak_data.status === "NG")) ||
      (typeof r.leak_data === "string" && (r.leak_data.includes('"NG"') || r.leak_data.includes('"FAIL"')))
    );
    const srcReason = String(r.parts_interlock_reason || r.ng_reason || r.rejection_reason || "").toUpperCase();
    const isLeakReason = srcReason.includes("LEAK") || srcReason.includes("PRESSURE");
    const isLeakNgGate = rNgGate.includes("LEAK") || rNgGate.includes("150");

    const hasActualLeakFailure = isOp150NG || isLeakDataNG || (isLeakReason && (overallStatus === "NG" || overallStatus === "FAILED")) || isLeakNgGate;
    if (!hasActualLeakFailure) return false;

    if (sUpper === "OP150" || sUpper === "LEAK-TEST-OP150" || sUpper === "LEAK") return true;

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
      } catch { /* malformed leak data */ }
    }
    const isLeakMachineName = (mName.includes("leak") || mName.includes("op150") || mId === "1773" || mId === "1774" || mId === "1776") && (
      ((sUpper.includes("01") || sUpper.includes("-1") || sUpper.endsWith("1")) && (mName.includes("01") || mName.includes("1") || mId === "1773")) ||
      ((sUpper.includes("02") || sUpper.includes("-2") || sUpper.endsWith("2")) && (mName.includes("02") || mName.includes("2") || mId === "1774")) ||
      ((sUpper.includes("03") || sUpper.includes("-3") || sUpper.endsWith("3")) && (mName.includes("03") || mName.includes("3") || mId === "1776"))
    );
    const isSpecificLeakGate = rNgGate.includes(sUpper) || (sUpper.includes("1") && (rNgGate.includes("01") || rNgGate.includes("1")));

    if (!leakMatched && !isLeakMachineName && !isSpecificLeakGate && !hasExplicitStationInRecord && (sUpper.includes("01") || sUpper.includes("-1") || sUpper.endsWith("1"))) {
      return true;
    }

    return leakMatched || isLeakMachineName || isSpecificLeakGate;
  }

  // Visual / Dimensional Quality Gates (OP100 to OP160)
  if (rNgGate && (rNgGate === sUpper || rNgGate.includes(sUpper))) return true;
  if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(gateStatus)) return true;
  if (mName === sLower || mName.includes(sLower)) return true;
  if (mId === sUpper || mId === sLower) return true;

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

// CSS box for a zone authored in Rejection Configuration (percent of the 900×520 stage)
export const boxStyle = (o, defW = 10, defH = 10) => ({
  left: `${Number(o.xPercent || 0)}%`,
  top: `${Number(o.yPercent || 0)}%`,
  width: `${Number(o.widthPercent || defW)}%`,
  height: `${Number(o.heightPercent || defH)}%`,
});

// CSS box for a sub-zone. Rejection Configuration saves sub-zones as a percent of their PARENT ZONE box (not of
// the stage), so place them inside the zone exactly as the editor and the operator NG picker do.
export const subBoxStyle = (zone, sz) => {
  const zx = Number(zone?.xPercent || 0), zy = Number(zone?.yPercent || 0);
  const zw = Math.max(1, Number(zone?.widthPercent || 10)), zh = Math.max(1, Number(zone?.heightPercent || 10));
  return {
    left: `${zx + (zw * Number(sz.xPercent || 0)) / 100}%`,
    top: `${zy + (zh * Number(sz.yPercent || 0)) / 100}%`,
    width: `${(zw * Number(sz.widthPercent || 10)) / 100}%`,
    height: `${(zh * Number(sz.heightPercent || 10)) / 100}%`,
  };
};

/**
 * Exact defect counts per configured CAD view / zone / sub-zone for a set of records.
 * Each record is counted once at the location it resolves to — no scaling to a target, no defaults.
 */
export const buildViewLocations = (records = [], views = []) => {
  const list = views.map((v) => ({
    id: v.id, code: v.code, name: v.name, imageUrl: v.imageUrl,
    totalDefects: 0, inferredDefects: 0, unzoned: 0,
    zones: (v.zones || []).map((z) => ({
      ...z, count: 0, inferredCount: 0, hasDefect: false,
      subZones: (z.subZones || []).map((sz) => ({ ...sz, count: 0, inferredCount: 0, hasDefect: false })),
    })),
  }));
  const stats = { records: 0, localized: 0, inferred: 0, unlocalized: 0, sensor: 0 };
  records.forEach((r) => {
    const qty = Number(r.quantity || r.scrap_quantity || 1) || 1;
    const parsed = parseRowDefect(r);
    stats.records += qty;
    if (parsed.sensorReject) { stats.sensor += qty; return; }
    const loc = resolveDefectLocation(parsed, views);
    if (loc.viewIndex < 0) { stats.unlocalized += qty; return; }
    const v = list[loc.viewIndex];
    v.totalDefects += qty;
    if (loc.inferred) v.inferredDefects += qty;
    if (loc.zoneIndex < 0) { v.unzoned += qty; stats.unlocalized += qty; return; }
    stats.localized += qty;
    if (loc.inferred) stats.inferred += qty;
    const z = v.zones[loc.zoneIndex];
    z.count += qty;
    if (loc.inferred) z.inferredCount += qty;
    if (loc.subIndex >= 0) {
      const s = z.subZones[loc.subIndex];
      s.count += qty;
      if (loc.inferred) s.inferredCount += qty;
    }
  });
  list.forEach((v) => {
    const active = [];
    v.zones.forEach((z) => {
      z.hasDefect = z.count > 0;
      let inSubs = 0;
      z.subZones.forEach((s) => {
        s.hasDefect = s.count > 0;
        inSubs += s.count;
        if (s.count > 0) active.push(`${z.name || z.code} › ${s.code || s.name} (${s.count})`);
      });
      if (z.count - inSubs > 0) active.push(`${z.name || z.code} (${z.count - inSubs})`);
    });
    v.activeSubZonesList = active;
  });
  return { views: list, stats };
};
