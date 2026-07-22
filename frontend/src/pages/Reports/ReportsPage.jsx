import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { reportApi, machineApi, organizationApi, shiftApi } from '../../api/services';
import { toDatetimeLocal } from '../../utils/time';
import { loadReportConfig } from '../../utils/reportConfig';
import ReportSummaryCards from './ReportSummaryCards';
import ReportTable from './ReportTable';
import { FileText, Download, RefreshCw, Filter, Calendar, Clock, ChevronDown, X, Zap, TrendingUp, AlertCircle, CheckCircle, Activity, BarChart3, Database, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useLanguage } from '../../context/LanguageContext';

const DEFAULT_PLC_CYCLE_COLUMNS = [
  "machine_name","shot_date","shot_time","shot_number","cycle_time",
  "die_close_core_in_time","pouring_time","shot_fwd_time","curing_time","die_open_core_out_time",
  "ejector_time","extract_time","spray_time","v1_speed","v2_speed","v3_speed","v4_speed","metal_pressure",
  "furnace_metal_temp","cooling_water_mov","cooling_water_sta","accel_point","deaccel_point","intensification_time",
  "biscuit_thickness","jet_cooling_pressure","clamp_tonnage_he_low_pct","clamp_tonnage_he_low_mn","clamp_tonnage_op_up_pct",
  "clamp_tonnage_op_low_pct","clamp_tonnage_he_up_pct","vacuum_pressure","clamp_force_pct","clamp_tonnage","shot_acc_pressure",
  "intensification_acc_pressure","fixed_die_temp_f1","fixed_die_temp_f2","moving_die_temp_m1","moving_die_temp_m2","slide_temp_s1",
  "fix_1_flow","fix_2_flow","fix_3_flow","mov_1_flow","mov_2_flow","mov_3_flow","vacuum_pressure_mmhg",
  "average_die_clamp_tonnage_count","time_for_stroke","stroke","shot_status"
];
const LEAK_TEST_OPERATION = "OP150";
const LEAK_TEST_SHARED_KEY = "__LEAK_TEST_OP150__";
const LEAK_TEST_COLUMNS = [
  { key: "Body_Leak_Value", label: "Body Leak Value", unit: "mbar" },
  { key: "Gall_1", label: "Gall_1", unit: "mbar" },
  { key: "Gall_2", label: "Gall_2", unit: "mbar" },
  { key: "Cycle_Time", label: "Cycle Time", unit: "s" },
  { key: "Running_Mode", label: "Running Mode" },
  { key: "Dry_Wey_Both", label: "Dry/Wey" },
];
const PLC_COLUMN_UNITS = {
  cycle_time: "s",
  die_close_core_in_time: "s",
  pouring_time: "s",
  shot_fwd_time: "s",
  curing_time: "s",
  die_open_core_out_time: "s",
  ejector_time: "s",
  extract_time: "s",
  spray_time: "s",
  intensification_time: "s",
  time_for_stroke: "s",
  v1_speed: "m/s",
  v2_speed: "m/s",
  v3_speed: "m/s",
  v4_speed: "m/s",
  metal_pressure: "bar",
  jet_cooling_pressure: "bar",
  vacuum_pressure: "mmHg",
  vacuum_pressure_mmhg: "mmHg",
  shot_acc_pressure: "bar",
  intensification_acc_pressure: "bar",
  furnace_metal_temp: "°C",
  fixed_die_temp_f1: "°C",
  fixed_die_temp_f2: "°C",
  moving_die_temp_m1: "°C",
  moving_die_temp_m2: "°C",
  slide_temp_s1: "°C",
  cooling_water_mov: "°C",
  cooling_water_sta: "°C",
  clamp_tonnage_he_low_pct: "%",
  clamp_tonnage_op_up_pct: "%",
  clamp_tonnage_op_low_pct: "%",
  clamp_tonnage_he_up_pct: "%",
  clamp_force_pct: "%",
  clamp_tonnage_he_low_mn: "MN",
  clamp_tonnage: "T",
  biscuit_thickness: "mm",
  accel_point: "mm",
  deaccel_point: "mm",
  stroke: "mm",
  fix_1_flow: "L/min",
  fix_2_flow: "L/min",
  fix_3_flow: "L/min",
  mov_1_flow: "L/min",
  mov_2_flow: "L/min",
  mov_3_flow: "L/min",
  average_die_clamp_tonnage_count: "count",
};
const withUnit = (label, unit) => unit ? `${label} (${unit})` : label;
const splitRejectionZone = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { zone: "", subZone: "" };
  const parts = raw.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  let zone = "";
  let subZone = "";
  parts.forEach((part) => {
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
  });
  return { zone: zone || raw, subZone };
};
const readLabeledValue = (text, label) => {
  const match = String(text || "").match(new RegExp(`(?:^|\\|)\\s*${label}\\s*:\\s*([^|]+)`, "i"));
  return match ? match[1].trim() : "";
};
const resolveRejectionDetails = (entries = []) => {
  const source = entries.find((row) => (
    row?.rejectionCategory || row?.rejection_category ||
    row?.rejectionReason || row?.rejection_reason ||
    row?.rejectionView || row?.rejection_view ||
    row?.rejectionZone || row?.rejection_zone ||
    row?.rejectionSubZone || row?.rejection_sub_zone ||
    String(row?.reason || row?.interlock_reason || "").includes("Category:")
  )) || {};
  const text = String(source.reason || source.interlock_reason || "").trim();
  const category = String(source.rejectionCategory || source.rejection_category || readLabeledValue(text, "Category") || "").trim();
  const rejection = String(source.rejectionReason || source.rejection_reason || readLabeledValue(text, "Reason") || "").trim();
  const view = String(source.rejectionView || source.rejection_view || readLabeledValue(text, "View") || "").trim();
  const zoneRaw = String(source.rejectionZone || source.rejection_zone || readLabeledValue(text, "Zone") || "").trim();
  const zoneParts = splitRejectionZone(zoneRaw);
  const subZone = String(source.rejectionSubZone || source.rejection_sub_zone || readLabeledValue(text, "Sub Zone") || zoneParts.subZone || "").trim();
  return {
    category,
    rejection,
    view,
    zone: zoneParts.zone,
    subZone,
  };
};
const normalizeLeakResult = (value) => {
  const token = String(value || "").trim().toUpperCase();
  if (!token) return "";
  if (["NG", "NOK", "NOT_OK", "NOT OK", "FAIL", "FAILED", "REJECT", "REJECTED"].includes(token)) return "NG";
  if (["OK", "PASS", "PASSED", "GOOD"].includes(token)) return "OK";
  return "";
};
const normalizeStationCellResult = (value) => {
  if (value && typeof value === "object") {
    return normResult(value.status || value.text || "");
  }
  const raw = String(value || "").trim().toUpperCase();
  if (!raw || raw === "-") return "";
  if (/\bNG\b|NOK|FAILED|FAIL/.test(raw)) return "NG";
  if (/\bOK\b|PASSED|PASS/.test(raw)) return "OK";
  if (raw.includes("IN_PROGRESS") || raw.includes("IN PROGRESS")) return "IN_PROGRESS";
  return normResult(raw);
};
const getLeakTestStatus = (reading) => {
  const readings = Array.isArray(reading) ? reading.filter(Boolean) : (reading ? [reading] : []);
  if (!readings.length) return "";
  const results = readings.map((r) => normalizeLeakResult(r?.Result || r?.result)).filter(Boolean);
  if (results.some((result) => result === "NG")) return "NG";
  if (results.length === readings.length && results.every((result) => result === "OK")) return "OK";
  const r = readings[readings.length - 1];
  const result = normalizeLeakResult(r?.Result || r?.result);
  if (result === "OK") return "OK";
  if (result === "NG") return "NG";
  return "IN_PROGRESS";
};
const getLeakTestValue = (readings, key) => {
  if (!readings) return "-";
  const readingsArray = Array.isArray(readings) ? readings : [readings];
  if (readingsArray.length === 0) return "-";

  return readingsArray.map(reading => {
    if (!reading) return "-";
    if (key === "Dry_Wey_Both") {
      const isTruthy = (value) => value === true || String(value ?? "").trim().toUpperCase() === "TRUE" || String(value ?? "").trim() === "1";
      if (isTruthy(reading.Both)) return "Both";
      if (isTruthy(reading.Dry)) return "Dry";
      if (isTruthy(reading.Wey) || isTruthy(reading.Way)) return "Wey";
      return "-";
    }
    if (key === "Machine") {
      return reading.Machine || reading.machineName || reading.matchedMachineName || "-";
    }
    if (key === "Cycle_End_Time") {
      const raw = reading.Cycle_End_Time || reading.cycleEndTime || "";
      if (!raw) return "-";
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? String(raw) : parsed.toLocaleString("en-IN");
    }
    const value = reading[key];
    if (key === "Running_Mode") {
      const normalizedMode = String(value ?? "").trim();
      if (!normalizedMode) return "-";
      const upper = normalizedMode.toUpperCase();
      if (upper === "MANUAL") return "Manual";
      if (upper === "AUTO" || upper === "AUTOMATIC") return "Auto";
      return normalizedMode;
    }
    return value !== undefined && value !== null && value !== "" ? value : "-";
  }).join(" | ");
};

const normResult = (v, reason = "", row = null) => {
  const s = String(v || "").toUpperCase().trim();
  const r = String(reason || "").toUpperCase().trim();
  const bypassStatus = Boolean(row?.bypassStatus || row?.is_bypassed || row?.isBypassed);
  const bypassReason = String(row?.bypassReason || row?.bypass_reason || "").toUpperCase().trim();
  if (bypassStatus || ["MACHINE_BYPASS_AUTO_OK", "STATION_BYPASS_AUTO_OK", "STATION_OPERATION_DISABLED_AUTO_OK"].includes(bypassReason)) {
    return "OK";
  }
  if (r === "NG_SHOT_STATUS" && ["BLOCK", "INTERLOCKED"].includes(s)) return "NG";
  if (["OK", "PASS", "PASSED", "COMPLETED", "ENDED_OK", "COMPLETED_OK"].includes(s)) return "OK";
  if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG", "INTERLOCKED"].includes(s)) return "NG";
  if (!s || s === "-" || s === "UNKNOWN") return "";
  return "IN_PROGRESS";
};
const resultRank = (value) => {
  if (value === "NG") return 3;
  if (value === "OK") return 2;
  if (value === "IN_PROGRESS") return 1;
  return 0;
};
const pickPreferredResult = (current, candidate) => {
  const currentRank = resultRank(current);
  const candidateRank = resultRank(candidate);
  if (candidateRank > currentRank) return candidate;
  return current || candidate;
};
const getResultTimestamp = (row = {}) => (
  row.finalResultCreatedAt ||
  row.finalResultAt ||
  row.cycleEndAt ||
  row.plc_end_at ||
  row.plcEndAt ||
  row.createdAtRaw ||
  row.createdAt ||
  row.updatedAt ||
  null
);
const isFinalInspectionOperation = (rowOrOperation = {}) => {
  const operation = typeof rowOrOperation === "string"
    ? rowOrOperation
    : (rowOrOperation.operationNo || rowOrOperation.stationNo || rowOrOperation.operation_no || rowOrOperation.station_no || "");
  const machineName = typeof rowOrOperation === "string"
    ? ""
    : (rowOrOperation.machineName || rowOrOperation.machine_name || rowOrOperation?.Machine?.machine_name || "");
  const op = String(operation || "").trim().toUpperCase();
  const machine = String(machineName || "").trim().toUpperCase();
  return op === "OP160" || machine.includes("FINAL INSPECTION") || machine.includes("FINAL_INSPECTION");
};
const operationResultRank = (value) => {
  if (value === "NG") return 3;
  if (value === "OK") return 2;
  if (value === "IN_PROGRESS") return 1;
  return 0;
};
const pickPreferredOperationResult = (current, candidate) => {
  const currentRank = operationResultRank(current);
  const candidateRank = operationResultRank(candidate);
  if (candidateRank > currentRank) return candidate;
  return current || candidate;
};
const formatPlcColumnLabel = (key) => {
  const raw = String(key || "").trim();
  if (!raw) return "PLC";
  const friendly = {
    machine_name: "Machine Name",
    part_name: "Part Name",
    shot_date: "Shot Date",
    shot_time: "Shot Time",
    shot_number: "Shot Number",
    shot_status: "Shot Status",
  };
  if (friendly[raw]) return friendly[raw];
  const formatted = raw
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? (w.charAt(0).toUpperCase() + w.slice(1)) : w))
    .join(" ");
  return formatted.replace(/^Plc\s+/i, "");
};
const extractShotFromPartId = (partId) => {
  const s = String(partId || "").trim();
  if (!s) return "";
  const machineCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machineCode>[A-Z0-9]{1})(?<shot>\d{1,6})$/i);
  if (machineCompact?.groups?.shot) return String(machineCompact.groups.shot).trim();
  const legacyCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<shot>\d{1,6})$/);
  if (legacyCompact?.groups?.shot) return String(legacyCompact.groups.shot).trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length > 12) return digits.slice(12);
  return "";
};
const normalizePartToken = (value) => String(value || "").trim().toUpperCase();
const splitPartDie = (value) => {
  const raw = normalizePartToken(value);
  if (!raw) return { partName: "", dieName: "" };
  const [partName, ...dieParts] = raw.split("-");
  return { partName: partName || "", dieName: dieParts.join("-") || "" };
};
const normalizeFinalPartStatus = (value) => {
  const status = String(value || "").trim().toUpperCase();
  if (["OK", "PASSED", "PASS", "COMPLETED", "COMPLETED_OK", "ENDED_OK"].includes(status)) return "PASSED";
  if (["NG", "FAILED", "FAIL", "REJECTED", "INTERLOCKED", "COMPLETED_NG", "ENDED_NG"].includes(status)) return "NG";
  return "IN_PROGRESS";
};
const INVALID_CUSTOMER_QR_VALUES = new Set([
  "ERROR",
  "ERR",
  "FAILED",
  "FAIL",
  "NG",
  "WAIT",
  "WAITING",
  "PENDING",
  "IN_PROGRESS",
  "RUNNING",
  "PLC_COMM_ERROR",
  "COMM_ERROR",
  "TIMEOUT",
  "NULL",
  "UNDEFINED",
]);
const collapseRepeatedQrValue = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const customerQrSegments = raw.match(/R[^R]+/g);
  if (
    customerQrSegments &&
    customerQrSegments.length > 1 &&
    customerQrSegments.join("") === raw &&
    customerQrSegments.every((segment) => segment === customerQrSegments[0])
  ) {
    return customerQrSegments[0];
  }
  if (raw.length < 16) return raw;
  for (let size = Math.floor(raw.length / 2); size >= 8; size -= 1) {
    if (raw.length % size !== 0) continue;
    const token = raw.slice(0, size);
    if (token && token.repeat(raw.length / size) === raw) return token;
  }
  return raw;
};
const sanitizeCustomerQrValue = (value) => {
  const raw = collapseRepeatedQrValue(value);
  if (!raw || raw === "-") return "";
  if (INVALID_CUSTOMER_QR_VALUES.has(raw.toUpperCase())) return "";
  return raw;
};
const looksLikeCustomerQrValue = (value) => /^R[A-Z0-9-]{12,}$/i.test(String(value || "").trim());
const REPORT_PREVIEW_ROWS_LIMIT = 500;

// ── Professional Design System ────────────────────────────────────────────
const DS = `
  :root {
    --pk-navy: 26,50,99;
    --pk-steel: 84,119,146;
    --pk-amber: 250,185,91;
    --pk-linen: 232,226,219;
    --pk-ok: 34,197,94;
    --pk-ng: 239,68,68;
    --pk-wip: 249,115,22;
    --pk-idle: 148,163,184;
  }
  [data-theme="light"] {
    --pk-bg-card: 255,255,255;
    --pk-bg-surf: 240,236,230;
    --pk-bg-input: 255,255,255;
    --pk-txt-pri: 26,50,99;
    --pk-txt-sec: 84,119,146;
    --pk-txt-muted: 140,160,180;
    --pk-bdr: 84,119,146;
    --pk-bop: 0.13;
  }
  [data-theme="dark"] {
    --pk-bg-card: 20,34,62;
    --pk-bg-surf: 16,26,50;
    --pk-bg-input: 14,22,44;
    --pk-txt-pri: 232,226,219;
    --pk-txt-sec: 120,160,190;
    --pk-txt-muted: 84,119,146;
    --pk-bdr: 84,119,146;
    --pk-bop: 0.18;
  }
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(var(--pk-steel), 0.2); }
    50% { box-shadow: 0 0 20px 4px rgba(var(--pk-steel), 0.1); }
  }
  @keyframes datePop {
    0% { transform: scale(0.95); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }
  .reports-container {
    animation: fadeSlideIn 0.3s ease;
  }
  .reports-gradient-bar {
    height: 3px;
    background: linear-gradient(90deg, rgb(var(--pk-navy)), rgb(var(--pk-steel)), rgb(var(--pk-amber)), rgb(var(--pk-steel)), rgb(var(--pk-navy)));
    background-size: 200% 100%;
    animation: shimmer 3s ease-in-out infinite;
  }
  .reports-card {
    background: rgb(var(--pk-bg-card));
    border: 1px solid rgba(var(--pk-bdr), var(--pk-bop));
    border-radius: 14px;
    box-shadow: 0 2px 12px rgba(var(--pk-navy), 0.06);
    transition: all 0.2s ease;
  }
  .reports-card:hover {
    box-shadow: 0 4px 24px rgba(var(--pk-navy), 0.1);
  }
  .reports-filter-group {
    background: rgb(var(--pk-bg-card));
    border: 1px solid rgba(var(--pk-bdr), var(--pk-bop));
    border-radius: 12px;
    padding: 16px 20px;
    box-shadow: 0 2px 8px rgba(var(--pk-navy), 0.04);
    transition: all 0.3s ease;
  }
  .reports-filter-input {
    height: 36px;
    min-width: 0;
    border-radius: 8px;
    border: 1px solid rgba(var(--pk-bdr), 0.2);
    background: rgb(var(--pk-bg-input));
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--pk-txt-pri));
    outline: none;
    transition: all 0.15s ease;
  }
  .reports-filter-input:focus {
    border-color: rgba(var(--pk-steel), 0.5);
    box-shadow: 0 0 0 3px rgba(var(--pk-steel), 0.08);
  }
  .reports-filter-input::placeholder {
    color: rgba(var(--pk-txt-muted), 0.6);
    font-weight: 400;
  }
  .reports-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 18px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: none;
    background: linear-gradient(135deg, rgb(var(--pk-navy)), rgb(var(--pk-steel)));
    color: rgb(var(--pk-linen));
    box-shadow: 0 3px 12px rgba(var(--pk-navy), 0.25);
    transition: all 0.15s ease;
  }
  .reports-btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(var(--pk-navy), 0.3);
  }
  .reports-btn-primary:active {
    transform: translateY(0);
  }
  .reports-btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
  .reports-btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 16px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    background: rgba(var(--pk-steel), 0.08);
    border: 1px solid rgba(var(--pk-steel), 0.2);
    color: rgb(var(--pk-steel));
    transition: all 0.15s ease;
  }
  .reports-btn-secondary:hover {
    background: rgba(var(--pk-steel), 0.15);
    border-color: rgba(var(--pk-steel), 0.35);
  }
  .reports-btn-clear {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    background: rgba(var(--pk-ng), 0.06);
    border: 1px solid rgba(var(--pk-ng), 0.15);
    color: rgb(var(--pk-ng));
    transition: all 0.15s ease;
  }
  .reports-btn-clear:hover {
    background: rgba(var(--pk-ng), 0.12);
    border-color: rgba(var(--pk-ng), 0.25);
  }
  .reports-btn-export {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 20px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: none;
    background: linear-gradient(135deg, rgb(var(--pk-amber)), #f6b83d);
    color: rgb(var(--pk-navy));
    box-shadow: 0 3px 12px rgba(var(--pk-amber), 0.3);
    transition: all 0.15s ease;
    position: relative;
    overflow: hidden;
  }
  .reports-btn-export:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(var(--pk-amber), 0.35);
  }
  .reports-btn-export:active {
    transform: translateY(0);
  }
  .reports-btn-export:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none;
  }
  .reports-btn-export .progress-bar {
    position: absolute;
    inset: 0;
    left: 0;
    background: rgba(255, 255, 255, 0.2);
    transition: width 0.3s ease;
  }
  .reports-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    border-radius: 99px;
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .reports-badge-ok {
    background: rgba(var(--pk-ok), 0.1);
    color: rgb(var(--pk-ok));
    border: 1px solid rgba(var(--pk-ok), 0.2);
  }
  .reports-badge-ng {
    background: rgba(var(--pk-ng), 0.1);
    color: rgb(var(--pk-ng));
    border: 1px solid rgba(var(--pk-ng), 0.2);
  }
  .reports-badge-wip {
    background: rgba(var(--pk-amber), 0.1);
    color: rgb(var(--pk-amber));
    border: 1px solid rgba(var(--pk-amber), 0.2);
  }
  
  /* Custom Date Picker Styles */
  .date-picker-container {
    position: relative;
    animation: datePop 0.2s ease;
  }
  .date-picker-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    background: rgb(var(--pk-bg-card));
    border: 1px solid rgba(var(--pk-bdr), 0.2);
    border-radius: 12px;
    box-shadow: 0 12px 48px rgba(var(--pk-navy), 0.15), 0 2px 8px rgba(var(--pk-navy), 0.06);
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
    border: 1px solid rgba(var(--pk-bdr), 0.1);
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgb(var(--pk-txt-sec));
    transition: all 0.15s ease;
  }
  .date-picker-header button:hover {
    background: rgba(var(--pk-steel), 0.08);
    border-color: rgba(var(--pk-steel), 0.2);
  }
  .date-picker-header span {
    font-size: 13px;
    font-weight: 700;
    color: rgb(var(--pk-txt-pri));
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
    color: rgba(var(--pk-txt-muted), 0.7);
    padding: 4px 0;
    text-align: center;
  }
  .date-picker-day {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--pk-txt-pri));
    cursor: pointer;
    transition: all 0.12s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  .date-picker-day:hover {
    background: rgba(var(--pk-steel), 0.08);
  }
  .date-picker-day.selected {
    background: linear-gradient(135deg, rgb(var(--pk-navy)), rgb(var(--pk-steel)));
    color: rgb(var(--pk-linen));
    box-shadow: 0 2px 8px rgba(var(--pk-navy), 0.25);
  }
  .date-picker-day.in-range {
    background: rgba(var(--pk-steel), 0.12);
    color: rgb(var(--pk-txt-pri));
  }
  .date-picker-day.range-start {
    background: linear-gradient(135deg, rgb(var(--pk-navy)), rgb(var(--pk-steel)));
    color: rgb(var(--pk-linen));
    box-shadow: 0 2px 8px rgba(var(--pk-navy), 0.25);
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .date-picker-day.range-end {
    background: linear-gradient(135deg, rgb(var(--pk-navy)), rgb(var(--pk-steel)));
    color: rgb(var(--pk-linen));
    box-shadow: 0 2px 8px rgba(var(--pk-navy), 0.25);
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .date-picker-day.range-middle {
    background: rgba(var(--pk-steel), 0.12);
    border-radius: 0;
  }
  .date-picker-day.other-month {
    color: rgba(var(--pk-txt-muted), 0.3);
  }
  .date-picker-day.today {
    border: 2px solid rgba(var(--pk-amber), 0.4);
  }
  .date-picker-day.today.selected,
  .date-picker-day.today.range-start,
  .date-picker-day.today.range-end {
    border-color: rgba(var(--pk-linen), 0.3);
  }
  .date-picker-footer {
    display: flex;
    gap: 6px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(var(--pk-bdr), 0.08);
  }
  .date-picker-footer button {
    flex: 1;
    height: 30px;
    border-radius: 6px;
    border: none;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .date-picker-footer .clear-btn {
    background: rgba(var(--pk-ng), 0.06);
    color: rgb(var(--pk-ng));
    border: 1px solid rgba(var(--pk-ng), 0.1);
  }
  .date-picker-footer .clear-btn:hover {
    background: rgba(var(--pk-ng), 0.12);
  }
  .date-picker-footer .apply-btn {
    background: linear-gradient(135deg, rgb(var(--pk-navy)), rgb(var(--pk-steel)));
    color: rgb(var(--pk-linen));
  }
  .date-picker-footer .apply-btn:hover {
    opacity: 0.9;
  }
  
  @media (max-width: 768px) {
    .reports-filters-grid {
      grid-template-columns: 1fr 1fr !important;
    }
    .date-picker-dropdown {
      left: -50%;
      min-width: 260px;
    }
  }
  @media (max-width: 480px) {
    .reports-filters-grid {
      grid-template-columns: 1fr !important;
    }
    .reports-actions {
      flex-wrap: wrap !important;
    }
    .date-picker-dropdown {
      left: -100%;
      min-width: 240px;
      max-width: 280px;
    }
    .date-picker-day {
      width: 28px;
      height: 28px;
      font-size: 11px;
    }
  }
`;

// ── Inject Styles ──────────────────────────────────────────────────────────
let _dsInjected = false;
function injectReportStyles() {
  if (_dsInjected || typeof document === "undefined") return;
  _dsInjected = true;
  const el = document.createElement("style");
  el.textContent = DS;
  document.head.appendChild(el);
  if (!document.documentElement.hasAttribute("data-theme")) {
    document.documentElement.setAttribute("data-theme", "light");
  }
}

// ── Custom Date Range Picker Component ──────────────────────────────────
const DateRangePicker = ({ startDate, endDate, onApply, onClear, label = "Select Date Range" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedStart, setSelectedStart] = useState(startDate ? new Date(startDate) : null);
  const [selectedEnd, setSelectedEnd] = useState(endDate ? new Date(endDate) : null);
  const [tempStart, setTempStart] = useState(selectedStart);
  const [tempEnd, setTempEnd] = useState(selectedEnd);
  const [isSelecting, setIsSelecting] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setSelectedStart(startDate ? new Date(startDate) : null);
    setSelectedEnd(endDate ? new Date(endDate) : null);
    setTempStart(startDate ? new Date(startDate) : null);
    setTempEnd(endDate ? new Date(endDate) : null);
  }, [startDate, endDate]);

  const formatDateDisplay = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const getDaysInMonth = (year, month) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year, month) => {
    return new Date(year, month, 1).getDay();
  };

  const handleDayClick = (day, month, year) => {
    const clickedDate = new Date(year, month, day);
    clickedDate.setHours(0, 0, 0, 0);

    if (!tempStart || (tempStart && tempEnd)) {
      // Start new selection
      setTempStart(clickedDate);
      setTempEnd(null);
      setIsSelecting(true);
    } else if (tempStart && !tempEnd) {
      // Complete selection
      if (clickedDate < tempStart) {
        setTempStart(clickedDate);
        setTempEnd(tempStart);
      } else {
        setTempEnd(clickedDate);
      }
      setIsSelecting(false);
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
    setTempStart(null);
    setTempEnd(null);
    setSelectedStart(null);
    setSelectedEnd(null);
    setIsSelecting(false);
    onClear();
    setIsOpen(false);
  };

  const handleMonthChange = (delta) => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    setCurrentMonth(newMonth);
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = [];
    // Weekday headers
    const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    weekdays.forEach((day) => {
      days.push(
        <div key={`weekday-${day}`} className="date-picker-weekday">
          {day}
        </div>
      );
    });

    // Empty cells for days before first day
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} />);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      date.setHours(0, 0, 0, 0);
      const isToday = date.getTime() === today.getTime();
      const isSelected = tempStart && date.getTime() === tempStart.getTime();
      const isEndSelected = tempEnd && date.getTime() === tempEnd.getTime();
      const isInRange = tempStart && tempEnd && date > tempStart && date < tempEnd;
      const isStart = tempStart && date.getTime() === tempStart.getTime();
      const isEnd = tempEnd && date.getTime() === tempEnd.getTime();
      const isOtherMonth = false;

      let className = 'date-picker-day';
      if (isToday) className += ' today';
      if (isSelected || isStart) className += ' range-start';
      if (isEndSelected || isEnd) className += ' range-end';
      if (isInRange) className += ' range-middle';
      if (isOtherMonth) className += ' other-month';

      days.push(
        <button
          key={`day-${day}`}
          className={className}
          onClick={() => handleDayClick(day, month, year)}
        >
          {day}
        </button>
      );
    }

    return days;
  };

  const dateRangeText = selectedStart && selectedEnd
    ? `${formatDateDisplay(selectedStart)} - ${formatDateDisplay(selectedEnd)}`
    : selectedStart
    ? formatDateDisplay(selectedStart)
    : label;

  return (
    <div className="date-picker-container" ref={pickerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="reports-filter-input"
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          minWidth: '220px',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Calendar size={14} className="text-[rgb(var(--pk-txt-muted))]" />
          <span style={{ fontSize: '12px', fontWeight: 600, color: selectedStart ? 'rgb(var(--pk-txt-pri))' : 'rgba(var(--pk-txt-muted),0.6)' }}>
            {dateRangeText}
          </span>
        </span>
        <ChevronDown size={14} className={`text-[rgb(var(--pk-txt-muted))] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="date-picker-dropdown">
          <div className="date-picker-header">
            <button onClick={() => handleMonthChange(-1)}>
              <ChevronLeft size={14} />
            </button>
            <span>
              {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => handleMonthChange(1)}>
              <ChevronRight size={14} />
            </button>
          </div>
          
          <div className="date-picker-grid">
            {renderCalendar()}
          </div>

          <div className="date-picker-footer">
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

const ReportsPage = () => {
  injectReportStyles();
  const { t } = useLanguage();
  const getMesDayRange = useCallback(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(6, 0, 0, 0);
    if (now < start) start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }, []);

  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [shotSummaryLoading, setShotSummaryLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [machines, setMachines] = useState([]);
  const [organization, setOrganization] = useState({ plants: [], lines: [], parts: [] });
  const [availableShifts, setAvailableShifts] = useState([]);
  const [data, setData] = useState({
    rows: [],
    metrics: {},
    availableShifts: [],
    plcColumns: [],
    pagination: { page: 1, pageSize: REPORT_PREVIEW_ROWS_LIMIT, totalRows: 0, totalPages: 1 },
  });
  const [reportPage, setReportPage] = useState({ page: 1, pageSize: REPORT_PREVIEW_ROWS_LIMIT });
  const [reportConfig, setReportConfig] = useState(() => loadReportConfig());
  const reportAbortRef = useRef(null);
  const shotSummarySeqRef = useRef(0);
  
  const [filters, setFilters] = useState(() => {
    const r = (() => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(6, 0, 0, 0);
      if (now < start) start.setDate(start.getDate() - 1);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    })();
    return {
      dateFrom: toDatetimeLocal(r.start),
      dateTo: toDatetimeLocal(r.end),
        plantId: '',
        lineId: '',
        machineId: '',
      partName: '',
      dieName: '',
      dieCastingMachine: '',
      lineName: '',
      shiftCode: '',
      status: '',
      partType: '',
      station: '',
      barcode: '',
      customerCode: '',
      operatorId: '',
      resultType: '',
      modelCode: '',
      operationNo: ''
    };
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [quickRange, setQuickRange] = useState("today");
  const [isFilterExpanded, setIsFilterExpanded] = useState(true);

  const applyQuickRange = useCallback((key) => {
    const now = new Date();
    const from = new Date(now);
    const to = new Date(now);
    if (key === "today") {
      const r = getMesDayRange();
      from.setTime(r.start.getTime());
      to.setTime(r.end.getTime());
    } else if (key === "yesterday") {
      const r = getMesDayRange();
      from.setTime(r.start.getTime());
      to.setTime(r.end.getTime());
      from.setDate(from.getDate() - 1);
      to.setDate(to.getDate() - 1);
    } else if (key === "last7") {
      from.setDate(from.getDate() - 7);
    } else if (key === "last15") {
      from.setDate(from.getDate() - 15);
    } else if (key === "last30") {
      from.setMonth(from.getMonth() - 1);
    }
    setFilters((prev) => ({
      ...prev,
      dateFrom: toDatetimeLocal(from),
      dateTo: toDatetimeLocal(to),
    }));
  }, [getMesDayRange]);

  const fetchData = useCallback(async () => {
    reportAbortRef.current?.abort();
    const controller = new AbortController();
    reportAbortRef.current = controller;
    const requestPayload = {
      ...appliedFilters,
      fast: "1",
      includePlcSummary: "0",
      includePlcReadings: "1",
      includeLeaktest: "1",
      noCache: "1",
      page: reportPage.page,
      pageSize: reportPage.pageSize,
    };
    setLoading(true);
    setLoadProgress(8);
    const progressTimer = window.setInterval(() => {
      setLoadProgress((prev) => {
        if (prev < 55) return prev + 7;
        if (prev < 82) return prev + 3;
        if (prev < 94) return prev + 1;
        return prev;
      });
    }, 550);
    try {
      const response = await reportApi.getData(requestPayload, { signal: controller.signal });
      setLoadProgress(100);
      const pageData = {
        reportMode: response.reportMode || "",
        rows: response.rows || [], 
        metrics: response.metrics || {},
        availableShifts: response.availableShifts || [],
        plcColumns: response.plcColumns || [],
        pagination: response.pagination || { page: reportPage.page, pageSize: reportPage.pageSize, totalRows: response.rows?.length || 0, totalPages: 1 },
      };
      setData(pageData);
      const summarySeq = shotSummarySeqRef.current + 1;
      shotSummarySeqRef.current = summarySeq;
      const summaryFilters = { ...appliedFilters, fast: "1", noCache: "1" };
      setShotSummaryLoading(true);
      reportApi.getShotSummary(summaryFilters)
        .then((summary) => {
          if (shotSummarySeqRef.current !== summarySeq) return;
          const nextShotSummary = {
            plcShotSummary: summary?.plcShotSummary || { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 },
            plcShotSummarySource: summary?.plcShotSummarySource || "PLC_SUMMARY",
          };
          setData((prev) => {
            return {
              ...prev,
              metrics: {
                ...(prev.metrics || {}),
                ...nextShotSummary,
              },
            };
          });
        })
        .catch((summaryError) => {
          if (shotSummarySeqRef.current !== summarySeq) return;
          console.warn("Report shot summary failed", summaryError);
        })
        .finally(() => {
          if (shotSummarySeqRef.current === summarySeq) setShotSummaryLoading(false);
        });
      if (response.warning) {
        toast(response.warning);
      }
    } catch (e) {
      if (e?.code === "ERR_CANCELED" || e?.name === "CanceledError") return;
      console.error(e);
      toast.error(t("reports.failedLoad", "Preview failed to load. You can still download the filtered Excel report."));
    } finally {
      window.clearInterval(progressTimer);
      if (reportAbortRef.current === controller) {
        window.setTimeout(() => {
          setLoading(false);
          setLoadProgress(0);
        }, 250);
        reportAbortRef.current = null;
      }
    }
  }, [appliedFilters, reportPage.page, reportPage.pageSize]);

  const refreshReportData = useCallback(() => {
    fetchData();
  }, [fetchData]);

  const applyReportFilters = useCallback(() => {
    setReportPage((prev) => ({ ...prev, page: 1 }));
    setAppliedFilters(filters);
    toast.success(t("reports.filtersApplied", "✅ Filters applied successfully"));
  }, [filters, t]);

  useEffect(() => {
    const metadataConfig = { timeout: 45000, suppressGlobalError: true };
    machineApi.list({ ...metadataConfig, params: { compact: 1 } })
      .then((rows) => setMachines(Array.isArray(rows) ? rows : []))
      .catch(() => setMachines([]));
    organizationApi.context(metadataConfig)
      .then((org) => setOrganization({ plants: org?.plants || [], lines: org?.lines || [], parts: org?.parts || [] }))
      .catch(() => {});
    shiftApi.list(undefined, metadataConfig)
      .then((rows) => setAvailableShifts(Array.isArray(rows) ? rows : []))
      .catch(() => []);
    try { setReportConfig(loadReportConfig()); } catch (err) { void err; }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchData();
    }, 450);
    return () => {
      window.clearTimeout(timer);
      reportAbortRef.current?.abort();
    };
  }, [fetchData]);

  const handleExport = async (type = "full") => {
    setExportLoading(true);
    setExportProgress(8);
    const toastId = toast.loading(t("reports.preparingReport", "📊 Preparing report..."));
    const exportTimer = window.setInterval(() => {
      setExportProgress((prev) => {
        if (prev < 45) return prev + 6;
        if (prev < 75) return prev + 3;
        if (prev < 98) return prev + 1;
        return prev;
      });
    }, 700);
    try {
      let blob;
      const { page, pageSize, limit, offset, ...filtersWithoutPagination } = appliedFilters || {};
      void page; void pageSize; void limit; void offset;
      const exportFilters = {
        ...filtersWithoutPagination,
        fast: "0",
        quick: "0",
        full: "1",
        includePlcSummary: "0",
        includePlcReadings: "1",
        includeLeaktest: "1",
      };
      const downloadConfig = {
        onDownloadProgress: (event) => {
          if (event.total) {
            const percent = Math.min(95, Math.max(12, Math.round((event.loaded / event.total) * 95)));
            setExportProgress(percent);
            return;
          }
          setExportProgress((prev) => Math.min(92, Math.max(prev, prev + 1)));
        },
      };

      if (type === 'full')  blob = await reportApi.exportFull(exportFilters, reportConfig, downloadConfig);
      else if (type === 'ng')    blob = await reportApi.exportNG(exportFilters, reportConfig, downloadConfig);
      else if (type === 'parts') blob = await reportApi.exportParts(exportFilters, reportConfig, downloadConfig);
      else if (type === 'audit') blob = await reportApi.exportAudit(exportFilters, reportConfig, downloadConfig);

      if (!blob) throw new Error("Empty response from export engine");
      setExportProgress(100);

      const url  = window.URL.createObjectURL(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement('a');
      link.href  = url;
      const ts   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      link.setAttribute('download', `${type.toUpperCase()}_REPORT_${ts}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t("reports.reportDownloaded", "✅ Report downloaded successfully"), { id: toastId });
    } catch (e) {
      console.error("Export failed:", e);
      const status = Number(e?.response?.status || 0);
      const code = String(e?.code || "").toUpperCase();
      const errorBlob = e?.response?.data instanceof Blob ? e.response.data : null;
      let serverMessage = "";
      if (errorBlob && errorBlob.type?.includes("application/json")) {
        try {
          serverMessage = JSON.parse(await errorBlob.text())?.error || "";
        } catch (_parseError) {
          serverMessage = "";
        }
      }
      const message = status === 504
        ? "⏱️ Template export timed out. Try a shorter date range."
        : code === "ECONNABORTED"
        ? "⏱️ Export timed out. Try a shorter date range."
        : serverMessage || e?.response?.data?.error || t("reports.exportFailed", "Export failed");
      toast.error(message, { id: toastId, duration: 7000 });
    } finally {
      window.clearInterval(exportTimer);
      window.setTimeout(() => {
        setExportLoading(false);
        setExportProgress(0);
      }, 350);
    }
  };

  const handleDateRangeApply = (start, end) => {
    setFilters((prev) => ({
      ...prev,
      dateFrom: toDatetimeLocal(start),
      dateTo: toDatetimeLocal(end),
    }));
    setQuickRange("custom");
  };

  const handleDateRangeClear = () => {
    setFilters((prev) => ({
      ...prev,
      dateFrom: '',
      dateTo: '',
    }));
    setQuickRange("");
  };

  const reportTable = useMemo(() => {
    const sourceRows = data.rows || [];
    const machineStationPairs = (machines || [])
      .map((m) => {
        const machineName = String(m.machineName || m.machine_name || "").trim();
        const op = String(m.operationNo || m.operation_no || m.stationNo || m.station_no || "").trim();
        if (!machineName || !op) return null;
        if (String(op).trim().toUpperCase() === LEAK_TEST_OPERATION) {
          return { key: LEAK_TEST_SHARED_KEY, machineName: "Leak Test", op, label: "Leak Test OP150", sharedLeakOperation: true };
        }
        return { key: op.toUpperCase(), machineName, op, label: `${machineName} + ${op.toUpperCase()}` };
      })
      .filter(Boolean);
    const machineStationMap = new Map(machineStationPairs.map((x) => [x.key, x]));
    const rowStationPairs = sourceRows
      .map((r) => {
        const machineName = String(r.machineName || "").trim();
        const op = String(r.operationNo || r.stationNo || "").trim();
        if (!machineName || !op) return null;
        if (String(op).trim().toUpperCase() === LEAK_TEST_OPERATION) {
          return { key: LEAK_TEST_SHARED_KEY, machineName: "Leak Test", op, label: "Leak Test OP150", sharedLeakOperation: true };
        }
        return { key: op.toUpperCase(), machineName, op, label: `${machineName} + ${op.toUpperCase()}` };
      })
      .filter(Boolean);
    rowStationPairs.forEach((x) => {
      if (!machineStationMap.has(x.key)) {
        machineStationMap.set(x.key, x);
      }
    });
    const stationPairs = Array.from(machineStationMap.values()).sort((a, b) =>
      a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: "base" }) || a.machineName.localeCompare(b.machineName)
    );
    const requiredOperations = Array.from(
      new Set(
        stationPairs
          .map((s) => String(s.op || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
    const discoveredPlcColumns = Array.isArray(data.plcColumns) ? data.plcColumns : DEFAULT_PLC_CYCLE_COLUMNS;
    const plcKeys = discoveredPlcColumns
      .filter((key) => DEFAULT_PLC_CYCLE_COLUMNS.includes(key))
      .filter((key) => !["machine_name", "part_name", "shot_number", "shot_date", "shot_time"].includes(key));
    const plcColumns = (() => {
      const used = new Map();
      const baseColumns = [
        { key: "shot_datetime", label: "Shot Date & Time" },
        ...plcKeys.map((key) => ({ key, label: withUnit(formatPlcColumnLabel(key), PLC_COLUMN_UNITS[key]) }))
      ];
      return baseColumns.map(({ key, label: initialLabel }) => {
        const base = initialLabel;
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        return { key, label: count === 0 ? base : `${base} (${count + 1})` };
      });
    })();
    const grouped = new Map();
    sourceRows.forEach((row, idx) => {
      const partKey = String(row.__reportPageGroupKey || row.reportPageGroupKey || row.reportGroupKey || row.report_group_key || row.traceabilityPartId || row.traceability_part_id || row.partId || row.part_id || row.barcode || row.shot_uid || `row_${idx}`).trim();
      const key = partKey || `row_${idx}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });

    const dynamicColumns = [
      { key: "srNo", label: "#" },
      { key: "plc_shot_number", label: "Shot #" },
      { key: "barcode", label: "Part Serial", blankIfEmpty: true },
      { key: "customerCode", label: "Customer QR" },
      { key: "createdAt", label: "First Scan" },
      { key: "finalResultAt", label: "Final Result Time" },
      ...stationPairs.map((s) => ({
        key: `station_${s.key}`,
        label: s.label,
        renderAsText: Boolean(s.sharedLeakOperation),
        renderLeakOperation: Boolean(s.sharedLeakOperation),
      })),
      { key: "overallStatus", label: "Status" },
      { key: "rejectionCategory", label: "Category" },
      { key: "rejectionReason", label: "Rejection" },
      { key: "rejectionView", label: "View" },
      { key: "rejectionZone", label: "Zone" },
      { key: "rejectionSubZone", label: "Sub Zone" },
      ...plcColumns.map((c) => ({ key: `plc_${c.key}`, label: c.label })),
      ...LEAK_TEST_COLUMNS.map((c) => ({ key: `leak_${c.key}`, label: withUnit(c.label, c.unit) })),
    ];

    const dynamicRows = Array.from(grouped.values()).map((entries, idx) => {
      const first = entries[0] || {};
      const partKey = String(first.__reportPageGroupKey || first.reportPageGroupKey || first.reportGroupKey || first.report_group_key || first.traceabilityPartId || first.traceability_part_id || first.partId || first.part_id || first.barcode || first.shot_uid || `row_${idx}`).trim();
      const bestPartRow = entries.find((row) => String(row.displayPartId || row.display_part_id || "").trim()) || first;
      const displayPartId = String(
        bestPartRow.displayPartId ||
        bestPartRow.display_part_id ||
        ""
      ).trim();
      const stationResults = {};
      const stationDisplayValues = {};
      const operationResults = {};
      const operationResultTimes = {};
      const stationCycleTimes = {};
      const plcData = {};
      let leakData = null;
      let leakResultTime = null;
      let finalInspectionOkAt = null;
      const firstScanAt = entries.reduce((earliest, row) => {
        const raw = row.firstScanCreatedAt || row.createdAtRaw || row.createdAt || null;
        if (!raw) return earliest;
        if (!earliest) return raw;
        return new Date(raw).getTime() < new Date(earliest).getTime() ? raw : earliest;
      }, null);
      entries.forEach((row) => {
        const stationOp = String(row.operationNo || row.stationNo || "").trim();
        const stationKey = stationOp ? stationOp.toUpperCase() : "";
        const rowLeakData = row.leakTestReadings?.length > 0 ? row.leakTestReadings : (row.leakTestReading && typeof row.leakTestReading === "object" ? row.leakTestReading : null);
        if (!leakData && rowLeakData) {
          leakData = rowLeakData;
        }
        if (stationKey) {
          const normalizedStationResult = normResult(
            stationOp === LEAK_TEST_OPERATION
              ? ""
              : String(row.industrialResult || row.statusLabel || row.result || "-").toUpperCase(),
            row.reason || row.interlock_reason,
            row
          );
          if (normalizedStationResult) {
            stationResults[stationKey] = pickPreferredResult(stationResults[stationKey], normalizedStationResult);
            const resultTime = getResultTimestamp(row);
            if (resultTime) {
              const currentTime = operationResultTimes[stationOp];
              if (!currentTime || new Date(resultTime).getTime() >= new Date(currentTime).getTime()) {
                operationResultTimes[stationOp] = resultTime;
              }
            }
          }
          if (stationOp && normalizedStationResult) {
            operationResults[stationOp] = pickPreferredOperationResult(operationResults[stationOp], normalizedStationResult);
          }
          if (normalizedStationResult === "OK" && isFinalInspectionOperation(row)) {
            const resultTime = getResultTimestamp(row);
            if (resultTime) {
              if (!finalInspectionOkAt || new Date(resultTime).getTime() >= new Date(finalInspectionOkAt).getTime()) {
                finalInspectionOkAt = resultTime;
              }
            }
          }
          stationCycleTimes[stationKey] = row.cycleTime || "-";
        }
        const nextPlcData = {
          ...(row.plcReading || {}),
          ...(row.plc_reading || {}),
          ...(row.plcReadings || {}),
          ...(row.plcCycleReadings || {}),
          ...(row.plc_cycle_readings || {}),
        };
        Object.keys(nextPlcData).forEach((key) => {
          if (plcData[key] === undefined || plcData[key] === null || plcData[key] === "" || plcData[key] === "-") {
            plcData[key] = nextPlcData[key];
          }
        });
      });
      const hasLeakData = Boolean(leakData && (!Array.isArray(leakData) || leakData.length > 0));
      if (hasLeakData) {
        const actualLeakData = Array.isArray(leakData) ? leakData[leakData.length - 1] : leakData;
        const leakStatus = getLeakTestStatus(leakData);
        const leakMachineName = String(actualLeakData?.matchedMachineName || actualLeakData?.Machine || actualLeakData?.machineName || "").trim();
        leakResultTime = actualLeakData?.Cycle_End_Time || actualLeakData?.cycleEndTime || actualLeakData?.updatedAt || actualLeakData?.createdAt || null;
        stationResults[LEAK_TEST_SHARED_KEY] = pickPreferredResult(stationResults[LEAK_TEST_SHARED_KEY], leakStatus);
        stationDisplayValues[LEAK_TEST_SHARED_KEY] = leakMachineName
          ? `${leakMachineName} ${leakStatus || "-"}`.trim()
          : (leakStatus || "-");
        operationResults[LEAK_TEST_OPERATION] = pickPreferredOperationResult(operationResults[LEAK_TEST_OPERATION], leakStatus);
      }
      const rejectionDetails = resolveRejectionDetails(entries);
      const plcPartDie = splitPartDie(plcData.part_name || first.partDieLabel || first.partName || "");
      const mappedCustomerCode = entries
        .map((row) => sanitizeCustomerQrValue(row.customerQrCode || row.customerCode || row.customer_qr || ""))
        .find((value) => String(value || "").trim() && String(value).trim() !== "-") ||
        (looksLikeCustomerQrValue(partKey) ? partKey : "");
      const customerQrPending = entries.some((row) => Boolean(row.customerQrPending || row.customer_qr_pending));
      const displayShotNumber = entries
        .map((row) => row.plcReading?.shot_number ?? row.plc_reading?.shot_number ?? row.shot_number ?? row.shotNumber ?? "")
        .map((value) => String(value || "").trim())
        .find((value) => value && value !== "-") || "";
      const resolveOverallStatus = () => {
        const effectiveRequiredOperations = hasLeakData
          ? requiredOperations
          : requiredOperations.filter((operation) => operation !== LEAK_TEST_OPERATION);
        const vals = effectiveRequiredOperations.map((operation) => normResult(operationResults[operation])).filter(Boolean);
        if (vals.some((v) => v === "NG")) return "NG";
        if (finalInspectionOkAt) return "PASSED";
        if (vals.some((v) => v === "IN_PROGRESS")) return "IN_PROGRESS";
        const finalStatus = normalizeFinalPartStatus(first.partStatus || first.part_status || first.status);
        if (finalStatus === "NG") return "NG";
        if (effectiveRequiredOperations.length > 1 && vals.length >= effectiveRequiredOperations.length && vals.every((v) => v === "OK")) return "PASSED";
        if (finalStatus === "PASSED") return "PASSED";
        return "IN_PROGRESS";
      };
      const overallStatus = customerQrPending && !mappedCustomerCode ? "IN_PROGRESS" : resolveOverallStatus();
      const finalResultRaw = (() => {
        if (overallStatus === "NG") {
          return entries.reduce((picked, row) => {
            const normalized = normResult(
              String(row.industrialResult || row.statusLabel || row.result || "-").toUpperCase(),
              row.reason || row.interlock_reason,
              row
            );
            if (normalized !== "NG") return picked;
            const resultTime = getResultTimestamp(row);
            if (!resultTime) return picked;
            if (!picked) return resultTime;
            return new Date(resultTime).getTime() < new Date(picked).getTime() ? resultTime : picked;
          }, leakResultTime);
        }
        if (overallStatus === "PASSED") {
          const effectiveRequiredOperations = hasLeakData
            ? requiredOperations
            : requiredOperations.filter((operation) => operation !== LEAK_TEST_OPERATION);
          const terminalOperation = effectiveRequiredOperations[effectiveRequiredOperations.length - 1];
          return finalInspectionOkAt || operationResultTimes[terminalOperation] || entries.reduce((latest, row) => {
            const normalized = normResult(
              String(row.industrialResult || row.statusLabel || row.result || "-").toUpperCase(),
              row.reason || row.interlock_reason,
              row
            );
            if (normalized !== "OK") return latest;
            const resultTime = getResultTimestamp(row);
            if (!resultTime) return latest;
            if (!latest) return resultTime;
            return new Date(resultTime).getTime() > new Date(latest).getTime() ? resultTime : latest;
          }, null);
        }
        return null;
      })();
      const finalResultInAppliedRange = (() => {
        if (!finalResultRaw) return false;
        const time = new Date(finalResultRaw).getTime();
        if (!Number.isFinite(time)) return false;
        const from = appliedFilters.dateFrom ? new Date(appliedFilters.dateFrom).getTime() : 0;
        const to = appliedFilters.dateTo ? new Date(appliedFilters.dateTo).getTime() : 0;
        if (Number.isFinite(from) && from && time < from) return false;
        if (Number.isFinite(to) && to && time > to) return false;
        return true;
      })();
      const hasKnownFinalResultTime = Boolean(finalResultRaw);
      const hasExplicitStatusFilter = Boolean(String(appliedFilters.status || appliedFilters.resultType || "").trim());
      const displayOverallStatus = !hasExplicitStatusFilter && ["OK", "NG"].includes(normResult(overallStatus)) && hasKnownFinalResultTime && !finalResultInAppliedRange
        ? "IN_PROGRESS"
        : overallStatus;
      const displayFinalResultRaw = displayOverallStatus === "IN_PROGRESS" ? null : finalResultRaw;
      const shaped = {
        reportGroupKey: partKey,
        traceabilityPartId: partKey,
        srNo: Math.max(
          1,
          Number(data.pagination?.totalRows || sourceRows.length || 0) -
            ((Number(data.pagination?.page || 1) - 1) * Number(data.pagination?.pageSize || sourceRows.length || 0)) -
            idx
        ),
        plc_shot_number: displayPartId ? (plcData.shot_number || displayShotNumber || "-") : "-",
        barcode: displayPartId,
        plc_machine_name: plcData.machine_name || first.machineName || "-",
        createdAt: firstScanAt ? new Date(firstScanAt).toLocaleString("en-IN") : "-",
        finalResultAt: displayFinalResultRaw ? new Date(displayFinalResultRaw).toLocaleString("en-IN") : "-",
        partName: plcPartDie.partName || first.partName || first.modelName || first.componentName || "-",
        dieName: plcPartDie.dieName || first.dieName || "-",
        customerCode: mappedCustomerCode || (customerQrPending ? "Customer QR Pending" : "-"),
        overallStatus: displayOverallStatus,
        ngReason: (() => {
          const rawReason = first.reason || first.interlock_reason || "";
          const normalizedReason = String(rawReason || "").trim().toUpperCase();
          if (!rawReason || rawReason === "-" || normalizedReason === "RECOVERY_PENDING_AFTER_BACKEND_RESTART") {
            return "";
          }
          return rawReason;
        })(),
        rejectionCategory: rejectionDetails.category || "-",
        rejectionReason: rejectionDetails.rejection || "-",
        rejectionView: rejectionDetails.view || "-",
        rejectionZone: rejectionDetails.zone || "-",
        rejectionSubZone: rejectionDetails.subZone || "-",
        cycleStartTime: firstScanAt ? new Date(firstScanAt).toLocaleString("en-IN") : "-",
        cycleTimeValue: stationPairs.length ? (stationCycleTimes[stationPairs[stationPairs.length - 1].key] || "-") : "-",
      };
      stationPairs.forEach((s) => {
        if (s.sharedLeakOperation) {
          const leakArr = Array.isArray(leakData) ? leakData : (leakData ? [leakData] : []);
          const allMachineNames = [...new Set(
            leakArr
              .map((r) => String(r?.matchedMachineName || r?.Machine || r?.machineName || "").trim())
              .filter(Boolean)
          )];
          const leakStatus = getLeakTestStatus(leakData);
          shaped[`station_${s.key}`] = {
            machineName: allMachineNames.join(" + ") || "",
            status: String(leakStatus || "").trim().toUpperCase() || "-",
            text: stationDisplayValues[s.key] || "-",
          };
        } else {
          shaped[`station_${s.key}`] = normResult(stationResults[s.key]) || "-";
        }
        shaped[`cycle_${s.key}`] = stationCycleTimes[s.key] || "-";
      });
      if (String(shaped.overallStatus || "").toUpperCase() === "IN_PROGRESS") {
        const laserMarkingPendingStation = stationPairs.find((s) => {
          if (s.sharedLeakOperation) return false;
          const op = String(s.op || s.key || "").trim().toUpperCase();
          const label = String(s.label || s.machineName || "").trim().toUpperCase();
          const isLaserMarkingStation = op === "OP110" || label.includes("LASER");
          if (!isLaserMarkingStation) return false;
          const currentValue = shaped[`station_${s.key}`];
          const normalized = normResult(
            typeof currentValue === "object" ? currentValue?.status : currentValue
          );
          return !normalized || normalized === "-";
        });
        if (laserMarkingPendingStation) {
          shaped[`station_${laserMarkingPendingStation.key}`] = "IN_PROGRESS";
        }
      }
      plcColumns.forEach(({ key }) => {
        if (key === "shot_datetime") {
          const y = plcData.shot_year ?? first.shot_year;
          const m = plcData.shot_month ?? first.shot_month;
          const d = plcData.shot_day ?? first.shot_day;
          const hh = plcData.shot_hour ?? first.shot_hour;
          const mm = plcData.shot_minute ?? first.shot_minute;
          const ss = plcData.shot_second ?? first.shot_second;
          shaped[`plc_${key}`] = (y !== undefined && m !== undefined && d !== undefined && hh !== undefined && mm !== undefined && ss !== undefined)
            ? `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
            : `${plcData.shot_date ?? first.shot_date ?? "-"} ${plcData.shot_time ?? first.shot_time ?? ""}`.trim();
        } else if (key === "shot_status") {
          const code = Number(plcData[key] ?? first[key]);
          shaped[`plc_${key}`] = ({ 1: "OK", 3: "WARM UP SHOT", 5: "OFF SHOT" }[code] || (plcData[key] ?? first[key] ?? "-"));
        } else {
          shaped[`plc_${key}`] = plcData[key] ?? first[key] ?? "-";
        }
      });
      LEAK_TEST_COLUMNS.forEach(({ key }) => {
        shaped[`leak_${key}`] = getLeakTestValue(leakData, key);
      });
      return shaped;
    });

    const visibleRows = dynamicRows.map((row, index, list) => ({
      ...row,
      srNo: list.length - index,
    }));

    return { columns: dynamicColumns, rows: visibleRows };
  }, [data.rows, data.plcColumns, filters.machineId, machines, appliedFilters.dateFrom, appliedFilters.dateTo]);

  const reportSummaryMetrics = useMemo(() => {
    const metrics = data.metrics || {};
    // Fix: only use server-provided metrics; never fall back to pagination.totalRows
    // (that is the paginated page row count, not the actual "parts tracked" metric)
    const traceabilityProduction = Number(
      metrics.traceabilityProduction ??
      metrics.totalProduction ??
      0
    );
    const totalOK = Number(metrics.totalOK || 0);
    const totalNG = Number(metrics.totalNG || 0);
    const inProgress = Number(metrics.inProgress || 0);
    const productionBase = totalOK + totalNG;
    return {
      totalProduction: traceabilityProduction,
      traceabilityProduction,
      totalOK,
      totalNG,
      inProgress,
      validationRejects: Number(metrics.validationRejects ?? totalNG),
      passRate: productionBase > 0 ? Number(((totalOK / productionBase) * 100).toFixed(2)) : 0,
      plcShotSummary: metrics.plcShotSummary || {},
    };
  }, [data.metrics]);
  const scopedMachines = useMemo(
    () => (machines || []).filter((machine) => !filters.plantId || String(machine.plantId || "") === String(filters.plantId)),
    [machines, filters.plantId]
  );
  const availableLines = useMemo(
    () => [...new Set(scopedMachines.map((m) => String(m.line_name || m.lineName || "").trim()).filter(Boolean))],
    [scopedMachines]
  );
  const activePartAssignments = useMemo(() => {
    return (organization.parts || []).filter((part) => {
      const active = String(part.status || "ACTIVE").toUpperCase() !== "INACTIVE" && part.isActive !== false;
      const plantOk = !filters.plantId || String(part.plantId || "") === String(filters.plantId);
      const lineOk = !filters.lineId || String(part.lineId || "") === String(filters.lineId);
      return active && plantOk && lineOk;
    });
  }, [organization.parts, filters.plantId, filters.lineId]);
  const availablePartNames = useMemo(() => (
    [...new Set(activePartAssignments.map((part) => normalizePartToken(part.partName)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
  ), [activePartAssignments]);
  const availableDies = useMemo(() => (
    [...new Set(activePartAssignments
      .filter((part) => !filters.partName || normalizePartToken(part.partName) === normalizePartToken(filters.partName))
      .map((part) => normalizePartToken(part.dieName))
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
  ), [activePartAssignments, filters.partName]);
  const availableDieCastingMachines = useMemo(() => (
    [...new Set(activePartAssignments
      .filter((part) => !filters.partName || normalizePartToken(part.partName) === normalizePartToken(filters.partName))
      .filter((part) => !filters.dieName || normalizePartToken(part.dieName) === normalizePartToken(filters.dieName))
      .map((part) => normalizePartToken(part.dieCastingMachine))
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
  ), [activePartAssignments, filters.partName, filters.dieName]);

  useEffect(() => {
    if (!filters.lineId || filters.partName || availablePartNames.length !== 1) return;
    setFilters((prev) => ({ ...prev, partName: availablePartNames[0], dieName: "" }));
  }, [availablePartNames, filters.lineId, filters.partName]);

  useEffect(() => {
    if (!filters.lineId || filters.dieName || availableDies.length !== 1) return;
    setFilters((prev) => ({ ...prev, dieName: availableDies[0], dieCastingMachine: "" }));
  }, [availableDies, filters.lineId, filters.dieName]);

  useEffect(() => {
    if (!filters.lineId || filters.dieCastingMachine || availableDieCastingMachines.length !== 1) return;
    setFilters((prev) => ({ ...prev, dieCastingMachine: availableDieCastingMachines[0] }));
  }, [availableDieCastingMachines, filters.lineId, filters.dieCastingMachine]);

  return (
    <div className="space-y-5 pb-16 reports-container">
      {/* ── Enhanced Page Header ── */}
      <div className="reports-card overflow-hidden">
        <div className="reports-gradient-bar" />
        <div className="flex items-start justify-between p-5 md:p-6">
          <div className="flex items-start gap-4">
            <div className="hidden sm:flex w-12 h-12 rounded-xl bg-gradient-to-br from-[rgb(var(--pk-navy))] to-[rgb(var(--pk-steel))] flex-shrink-0 items-center justify-center shadow-lg shadow-[rgba(var(--pk-navy),0.25)]">
              <FileText size={22} className="text-[rgb(var(--pk-linen))]" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-[rgb(var(--pk-txt-pri))] tracking-tight flex items-center gap-2">
                {t("reports.title", "📊 Traceability Report")}
               
              </h1>
              <p className="text-sm text-[rgb(var(--pk-txt-sec))] mt-0.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs">
                  <Database size={12} className="text-[rgb(var(--pk-txt-muted))]" />
                  {data.pagination?.totalRows || 0} records
                </span>
                <span className="w-px h-4 bg-[rgba(var(--pk-bdr),0.2)]" />
                <span className="inline-flex items-center gap-1 text-xs">
                  <Activity size={12} className="text-[rgb(var(--pk-txt-muted))]" />
                  {loading ? t("reports.loading", "Loading...") : t("reports.productionAnalytics", "Production Analytics")}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              disabled={loading}
              onClick={refreshReportData}
              className="reports-btn-secondary"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">{loading ? t("reports.refreshing", "Refreshing...") : t("reports.refresh", "Refresh")}</span>
            </button>
            <button
              disabled={exportLoading}
              onClick={() => handleExport("full")}
              className="reports-btn-export"
            >
              {exportLoading && (
                <span
                  className="absolute inset-y-0 left-0 bg-white/20 transition-all duration-300"
                  style={{ width: `${Math.max(8, exportProgress)}%` }}
                />
              )}
              <span className="relative inline-flex items-center gap-2">
                {exportLoading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                <span className="hidden sm:inline">{exportLoading ? `Preparing ${exportProgress}%` : t("reports.downloadReport", "Download Report")}</span>
                <span className="sm:hidden">{exportLoading ? `${exportProgress}%` : <Download size={14} />}</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Enhanced Filters ── */}
      <div className="reports-filter-group">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Filter size={16} className="text-[rgb(var(--pk-txt-muted))]" />
            <span className="text-sm font-bold text-[rgb(var(--pk-txt-pri))]">{t("reports.filters", "Filters")}</span>
            <span className="text-xs text-[rgb(var(--pk-txt-muted))] bg-[rgba(var(--pk-bdr),0.06)] px-2 py-0.5 rounded-full border border-[rgba(var(--pk-bdr),0.06)]">
              {Object.values(filters).filter(v => v && String(v).trim()).length} active
            </span>
          </div>
         
        </div>

        <div className={`grid gap-2.5 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 reports-filters-grid ${isFilterExpanded ? '' : 'max-h-48 overflow-hidden'}`}>
          <select
            value={filters.partType === "OTHER" ? "__OTHER__" : (filters.partName || "")}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "__OTHER__") {
                setFilters((prev) => ({ ...prev, partName: "", partType: "OTHER", dieName: "", dieCastingMachine: "" }));
                return;
              }
              setFilters((prev) => ({ ...prev, partName: normalizePartToken(value), partType: prev.partType === "OTHER" ? "" : prev.partType, dieName: "", dieCastingMachine: "" }));
            }}
            className="reports-filter-input"
          >
            <option value="">🔹 All Parts</option>
            <option value="__OTHER__">📌 Other Parts</option>
            {availablePartNames.map((partName) => <option key={partName} value={partName}>{partName}</option>)}
          </select>
          <select
            value={filters.dieName || ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, dieName: normalizePartToken(e.target.value), dieCastingMachine: "" }))}
            className="reports-filter-input"
          >
            <option value="">🔸 All Dies</option>
            {availableDies.map((dieName) => <option key={dieName} value={dieName}>{dieName}</option>)}
          </select>
          <select
            value={filters.dieCastingMachine || ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, dieCastingMachine: normalizePartToken(e.target.value) }))}
            className="reports-filter-input"
          >
            <option value="">🏭 All Die Casting Machines</option>
            {availableDieCastingMachines.map((machineName) => <option key={machineName} value={machineName}>{machineName}</option>)}
          </select>
          <select
            value={filters.machineId}
            onChange={(e) => setFilters((prev) => ({ ...prev, machineId: e.target.value }))}
            className="reports-filter-input"
          >
            <option value="">⚙️ All Quality Gates</option>
            {scopedMachines
              .filter((m) => !filters.lineId || String(m.line_id || m.lineId || "") === String(filters.lineId))
              .filter((m) => !filters.lineName || String(m.line_name || m.lineName || "").trim() === filters.lineName)
              .map((m) => <option key={m.id} value={m.id}>{m.machine_name || m.machineName}</option>)}
          </select>
          <input
            value={filters.barcode || ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, barcode: e.target.value }))}
            placeholder="🔍 Customer QR / Part ID / Shot #"
            className="reports-filter-input"
          />
          <select
            value={filters.status || ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            className="reports-filter-input"
          >
            <option value="">📊 All Status</option>
            <option value="OK">✅ PASSED</option>
            <option value="NG">❌ FAILED</option>
            <option value="IN_PROGRESS">⏳ IN PROGRESS</option>
          </select>
          <select
            value={filters.shiftCode || ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, shiftCode: e.target.value }))}
            className="reports-filter-input"
          >
            <option value="">🕐 All Shifts</option>
            {((data.availableShifts && data.availableShifts.length) ? data.availableShifts : availableShifts).map((shift) => (
              <option key={shift.shiftCode || shift.shift_code} value={shift.shiftCode || shift.shift_code}>
                {shift.shiftName || shift.shift_name || shift.shiftCode || shift.shift_code}
              </option>
            ))}
          </select>
          
          {/* Custom Date Range Picker */}
          <DateRangePicker
            startDate={filters.dateFrom}
            endDate={filters.dateTo}
            onApply={handleDateRangeApply}
            onClear={handleDateRangeClear}
            label="📅 Select Date Range"
          />

          <div className="flex items-center gap-1.5 col-span-1 md:col-span-2 lg:col-span-1">
            <button
              onClick={() => {
                const nextFilters = {
                  dateFrom: toDatetimeLocal(getMesDayRange().start),
                  dateTo: toDatetimeLocal(getMesDayRange().end),
                  plantId: '', lineId: '', machineId: '', partName: '', dieName: '', dieCastingMachine: '', lineName: '', shiftCode: '', status: '', partType: '', station: '', barcode: '', customerCode: '',
                  operatorId: '', resultType: '', modelCode: '', operationNo: ''
                };
                setQuickRange("today");
                setFilters(nextFilters);
                setAppliedFilters(nextFilters);
                setReportPage((prev) => ({ ...prev, page: 1 }));
                toast(t("reports.filtersCleared", "🧹 Filters cleared"));
              }}
              className="reports-btn-clear flex-1"
            >
              <X size={13} /> {t("reports.clear", "Clear")}
            </button>
            <button
              disabled={loading}
              onClick={applyReportFilters}
              className="reports-btn-primary flex-1"
            >
              <Zap size={14} /> {loading ? t("reports.loading", "Loading...") : t("reports.applyFilters", "Apply")}
            </button>
          </div>
        </div>

        {/* Active filters summary */}
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-[rgba(var(--pk-bdr),0.06)]">
          {Object.entries(filters).filter(([key, value]) => value && String(value).trim() && !['dateFrom', 'dateTo'].includes(key)).slice(0, 5).map(([key, value]) => (
            <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-[rgba(var(--pk-steel),0.06)] border border-[rgba(var(--pk-steel),0.1)] text-[rgb(var(--pk-txt-sec))]">
              <span className="opacity-50">{key}:</span> {String(value).slice(0, 20)}
            </span>
          ))}
          {Object.entries(filters).filter(([key, value]) => value && String(value).trim() && !['dateFrom', 'dateTo'].includes(key)).length > 5 && (
            <span className="text-[10px] text-[rgb(var(--pk-txt-muted))] font-medium">+{Object.entries(filters).filter(([key, value]) => value && String(value).trim() && !['dateFrom', 'dateTo'].includes(key)).length - 5} more</span>
          )}
          {filters.dateFrom && filters.dateTo && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-[rgba(var(--pk-amber),0.06)] border border-[rgba(var(--pk-amber),0.1)] text-[rgb(var(--pk-amber))]">
              <Calendar size={10} /> {new Date(filters.dateFrom).toLocaleDateString()} → {new Date(filters.dateTo).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <ReportSummaryCards metrics={reportSummaryMetrics} loading={loading} shotSummaryLoading={shotSummaryLoading} />

      {/* ── Table ── */}
      <ReportTable
        rows={reportTable.rows}
        columns={reportTable.columns}
        loading={loading}
        progress={loadProgress}
        pagination={data.pagination}
        onPageChange={(page) => setReportPage((prev) => ({ ...prev, page }))}
        onPageSizeChange={(pageSize) => {
          setReportPage({ page: 1, pageSize });
        }}
        defaultPageSize={REPORT_PREVIEW_ROWS_LIMIT}
        pageSizeOptions={[100, 250, 500, 1000]}
      />
    </div>
  );
};

export default ReportsPage;
