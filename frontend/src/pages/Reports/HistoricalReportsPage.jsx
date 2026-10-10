import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { reportApi, machineApi, organizationApi, shiftApi, dashboardApi } from '../../api/services';
import { toDatetimeLocal } from '../../utils/time';
import { loadReportConfig } from '../../utils/reportConfig';
import ReportSummaryCards from './ReportSummaryCards';
import ReportTable from './ReportTable';
import NgCategorySplit from './NgCategorySplit';
import PlantLineSelector from '../../components/PlantLineSelector';
import { FileText, Download, RefreshCw, Filter, Calendar, Clock, ChevronDown, X, Zap, TrendingUp, AlertCircle, CheckCircle, Activity, BarChart3, Database, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Shield, Percent, Info } from 'lucide-react';
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
    const subMatch = part.match(/^sub\s*zone\s*[:-]?\s*(.+)$/i);
    if (subMatch) {
      subZone = subMatch[1].trim();
      return;
    }
    const zoneMatch = part.match(/^zone\s*[:-]?\s*(.+)$/i);
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
    row?.rejection?.category || row?.rejectionCategory || row?.rejection_category ||
    row?.rejection?.reason || row?.rejectionReason || row?.rejection_reason ||
    row?.rejection?.view || row?.rejectionView || row?.rejection_view ||
    row?.rejection?.zone || row?.rejectionZone || row?.rejection_zone ||
    row?.rejection?.subZone || row?.rejectionSubZone || row?.rejection_sub_zone ||
    String(row?.rejection?.reason || row?.reason || row?.interlock_reason || "").includes("Category:")
  )) || {};
  const text = String(source.rejection?.reason || source.reason || source.interlock_reason || "").trim();
  const category = String(source.rejection?.category || source.rejectionCategory || source.rejection_category || readLabeledValue(text, "Category") || "").trim();
  const rejection = String(source.rejection?.reason || source.rejectionReason || source.rejection_reason || readLabeledValue(text, "Reason") || "").trim();
  const view = String(source.rejection?.view || source.rejectionView || source.rejection_view || readLabeledValue(text, "View") || "").trim();
  const zoneRaw = String(source.rejection?.zone || source.rejectionZone || source.rejection_zone || readLabeledValue(text, "Zone") || "").trim();
  const zoneParts = splitRejectionZone(zoneRaw);
  const subZone = String(source.rejection?.subZone || source.rejectionSubZone || source.rejection_sub_zone || readLabeledValue(text, "Sub Zone") || zoneParts.subZone || "").trim();
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
  if (token === "19279") return "OK";
  if (["NG", "NOK", "NOT_OK", "NOT OK", "FAIL", "FAILED", "REJECT", "REJECTED"].includes(token)) return "NG";
  if (["OK", "PASS", "PASSED", "GOOD"].includes(token)) return "OK";
  if (/^\d+$/.test(token) && Number(token) > 0) return "NG";
  return "";
};
const getLeakResultToken = (reading = {}) =>
  reading?.Result ?? reading?.result ?? reading?.Raw_Result ?? reading?.rawResult ?? "";
const getLeakReadingTimeRaw = (r = {}) =>
  r?.cycleEndAt || r?.cycleEndTime || r?.Cycle_End_Time || r?.updatedAt || r?.createdAt || "";
// Leak readings in test order (oldest first). Readings without a time keep their original order.
const sortLeakReadings = (leakData) => {
  const list = (Array.isArray(leakData) ? leakData : (leakData ? [leakData] : [])).filter((r) => r && typeof r === "object");
  return list
    .map((r, i) => ({ r, i, t: parseDateSafe(getLeakReadingTimeRaw(r)) }))
    .sort((a, b) => ((Number.isFinite(a.t) && Number.isFinite(b.t)) ? a.t - b.t : 0) || a.i - b.i)
    .map((x) => x.r);
};
// Every leak test of the part, in time order. The sync may attach `readings` (all tests) to the latest reading;
// without it, the list of readings itself is the history.
const getLeakHistory = (leakData) => {
  const list = sortLeakReadings(leakData);
  const nested = list.map((r) => r.readings).find((x) => Array.isArray(x) && x.length > 0);
  return nested ? sortLeakReadings(nested) : list;
};
// Leak retest rule (plant decision): the LATEST leak test decides — NG then OK on a retest (same or another
// leak machine) is OK, like the latest OK / NG scan at every station. Every attempt is still listed
// (history / "NG → OK (retest)"); matches the backend sync.
const getLeakTestStatus = (reading) => {
  const readings = getLeakHistory(reading);
  if (!readings.length) return "";
  return normalizeLeakResult(getLeakResultToken(readings[readings.length - 1])) || "IN_PROGRESS";
};
const getLeakMachineName = (r = {}) =>
  String(r?.machine || r?.matchedMachineName || r?.Machine || r?.machineName || "").trim();
// "NG → OK (retest)" when the part was tested more than once (the last result is the counted one); "" for a single test.
const formatLeakHistorySummary = (history = []) => {
  if (history.length < 2) return "";
  const results = history.map((r) => normalizeLeakResult(getLeakResultToken(r)) || "?");
  return `${results.join(" → ")} (retest)`;
};
// Machine / time / value of every test, e.g. "LT-1 NG 08/10/2026, 10:02:11 (2.3 mbar) → LT-2 OK ...".
const formatLeakHistoryDetail = (history = []) => {
  if (history.length < 2) return "";
  return history.map((r) => {
    const result = normalizeLeakResult(getLeakResultToken(r)) || "?";
    const rawTime = getLeakReadingTimeRaw(r);
    const time = rawTime ? formatDateSafeStr(rawTime) : "";
    const value = r?.bodyLeakValue ?? r?.Body_Leak_Value;
    const valueText = value !== undefined && value !== null && value !== "" && value !== "-" ? `(${value} mbar)` : "";
    return [getLeakMachineName(r), result, time, valueText].filter(Boolean).join(" ");
  }).join(" → ");
};
const getLeakTestValue = (readings, key) => {
  if (!readings) return "-";
  const readingsArray = Array.isArray(readings) ? readings : [readings];
  if (readingsArray.length === 0) return "-";

  return readingsArray.map(reading => {
    if (!reading) return "-";
    if (key === "Dry_Wey_Both") {
      const isTruthy = (value) => value === true || String(value ?? "").trim().toUpperCase() === "TRUE" || String(value ?? "").trim() === "1";
      if (isTruthy(reading.both) || isTruthy(reading.Both)) return "Both";
      if (isTruthy(reading.dry) || isTruthy(reading.Dry)) return "Dry";
      if (isTruthy(reading.wey) || isTruthy(reading.Wey) || isTruthy(reading.way) || isTruthy(reading.Way)) return "Wey";
      return "-";
    }
    if (key === "Machine") {
      return reading.machine || reading.Machine || reading.machineName || reading.matchedMachineName || "-";
    }
    if (key === "Cycle_End_Time") {
      const raw = reading.cycleEndAt || reading.Cycle_End_Time || reading.cycleEndTime || "";
      if (!raw) return "-";
      const parsed = new Date(raw);
      if (isNaN(parsed.getTime())) return String(raw);
      return parsed.toLocaleString("en-IN");
    }
    if (key === "Body_Leak_Value") return reading.bodyLeakValue ?? reading.Body_Leak_Value ?? "-";
    if (key === "Gall_1") return reading.gall1 ?? reading.Gall_1 ?? "-";
    if (key === "Gall_2") return reading.gall2 ?? reading.Gall_2 ?? "-";
    if (key === "Cycle_Time") return reading.cycleTime ?? reading.Cycle_Time ?? "-";
    if (key === "Running_Mode") return reading.runningMode ?? reading.Running_Mode ?? "-";

    const camelKey = key.split('_').map((word, idx) => idx === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join('');
    const value = reading[key] ?? reading[camelKey] ?? reading[key.charAt(0).toLowerCase() + key.slice(1)];
    return value ?? "-";
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
const parseDateSafe = (dateStr) => {
  if (!dateStr || dateStr === "-") return NaN;
  const native = new Date(dateStr).getTime();
  if (!Number.isNaN(native)) return native;

  // Try space to T (YYYY-MM-DD HH:MM:SS -> YYYY-MM-DDT... )
  const spaceToT = String(dateStr).replace(' ', 'T');
  const spaceToTNative = new Date(spaceToT).getTime();
  if (!Number.isNaN(spaceToTNative)) return spaceToTNative;

  const parts = String(dateStr).match(/(\d+)\/(\d+)\/(\d+)[,\s]+(\d+):(\d+):(\d+)\s*(am|pm|AM|PM)?/i);
  if (parts) {
    const [_, day, month, year, hours, minutes, seconds, ampm] = parts;
    let h = parseInt(hours, 10);
    if (ampm) {
      if (ampm.toLowerCase() === 'pm' && h < 12) h += 12;
      if (ampm.toLowerCase() === 'am' && h === 12) h = 0;
    }
    return new Date(year, parseInt(month, 10) - 1, day, h, minutes, seconds).getTime();
  }
  return NaN;
};
const formatDateSafeStr = (dateStr) => {
  if (!dateStr || dateStr === "-") return "-";
  const time = parseDateSafe(dateStr);
  if (Number.isNaN(time)) return String(dateStr);
  return new Date(time).toLocaleString("en-IN");
};
const getResultTimestamp = (row = {}) => {
  const cands = [
    row.final_scan_at,
    row.first_scan_at,
    row.finalResultCreatedAt,
    row.finalResultAt,
    row.station?.cycleEndAt,
    row.cycleEndAt,
    row.plc_end_at,
    row.plcEndAt,
    row.production?.latestActivityAt,
    row.createdAtRaw,
    row.createdAt,
    row.updated_at,
    row.updatedAt,
  ];
  return cands.find((c) => c && c !== "-") || null;
};
const isFinalInspectionOperation = (rowOrOperation = {}) => {
  const operation = typeof rowOrOperation === "string"
    ? rowOrOperation
    : (rowOrOperation.station?.operation || rowOrOperation.operationNo || rowOrOperation.stationNo || rowOrOperation.operation_no || rowOrOperation.station_no || "");
  const machineName = typeof rowOrOperation === "string"
    ? ""
    : (rowOrOperation.station?.name || rowOrOperation.station?.machineName || rowOrOperation.machineName || rowOrOperation.machine_name || rowOrOperation?.Machine?.machine_name || "");
  const op = String(operation || "").replace(/[\s-]/g, '').toUpperCase();
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
const normalizeShotSummaryBucket = (value) => {
  const raw = String(value ?? "").trim().toUpperCase();
  const numeric = Number(raw);
  if (numeric === 1 || ["OK", "GOOD", "PASS", "PASSED"].includes(raw)) return "ok";
  if (numeric === 3 || raw.includes("WARM")) return "warmUp";
  if (numeric === 5 || raw.includes("OFF") || raw.includes("OFFSET")) return "off";
  return "other";
};
const derivePlcShotSummaryFromRows = (rows = []) => {
  const summary = { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 };
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const plc = {
      ...(row?.plcReading || {}),
      ...(row?.plc_reading || {}),
      ...(row?.plcReadings || {}),
      ...(row?.plcCycleReadings || {}),
      ...(row?.plc_cycle_readings || {}),
    };
    const shotNumber = String(plc.shot_number ?? row.shot_number ?? row.shotNumber ?? "").trim();
    const shotStatus = plc.shot_status ?? row.shot_status ?? row.shotStatus;
    if (!shotNumber && (shotStatus === undefined || shotStatus === null || shotStatus === "")) return;
    const key = [
      shotNumber || row.reportGroupKey || row.partId || row.part_id || "",
      plc.recorded_at || plc.recordedAt || plc.shot_date || row.createdAtRaw || row.createdAt || "",
      shotStatus ?? "",
    ].map((value) => String(value || "").trim()).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    const bucket = normalizeShotSummaryBucket(shotStatus);
    if (bucket === "ok") summary.okShot += 1;
    else if (bucket === "warmUp") summary.warmUpShot += 1;
    else if (bucket === "off") summary.offShot += 1;
  });
  summary.totalProduction = summary.okShot + summary.warmUpShot + summary.offShot;
  return summary;
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
  if (!looksLikeCustomerQrValue(raw)) return "";
  return raw;
};
function looksLikeCustomerQrValue(value) {
  return /^R\d[A-Z0-9-]{10,}$/i.test(String(value || "").trim());
}
// ── Production-day date helpers ─────────────────────────────────────────
// A plain "YYYY-MM-DD" is one production day (D 06:00 → D+1 06:00, Shift A+B+C); the historical report API
// resolves it server side.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDateOnly = (value) => DATE_ONLY_RE.test(String(value || "").trim());
const toDateOnlyString = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// Parses "YYYY-MM-DD" as a LOCAL date (new Date("YYYY-MM-DD") would be UTC midnight); anything else as usual.
const parseFilterDate = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (isDateOnly(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
// Calendar days the picker should show for a filter range. A range ending at 06:00 (or earlier) belongs to the
// previous production day, so "D 06:00 → D+1 06:00" shows as the single day D.
const toPickerDays = (startValue, endValue) => {
  const start = parseFilterDate(startValue);
  const end = parseFilterDate(endValue);
  const startDay = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()) : null;
  if (startDay && start && !isDateOnly(startValue) && start.getHours() < 6) startDay.setDate(startDay.getDate() - 1);
  let endDay = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : null;
  if (endDay && end && !isDateOnly(endValue)) {
    const minutes = end.getHours() * 60 + end.getMinutes();
    if (minutes <= 6 * 60) endDay.setDate(endDay.getDate() - 1);
  }
  if (startDay && endDay && endDay < startDay) endDay = new Date(startDay);
  return { start: startDay, end: endDay };
};
// For endpoints that expect explicit times: plain dates → D 06:00 / D+1 06:00 (end capped at now).
const expandProductionDayFilters = (filters = {}) => {
  if (!isDateOnly(filters.dateFrom) && !isDateOnly(filters.dateTo)) return filters;
  const out = { ...filters };
  if (isDateOnly(out.dateFrom)) {
    const from = parseFilterDate(out.dateFrom);
    from.setHours(6, 0, 0, 0);
    out.dateFrom = toDatetimeLocal(from);
  }
  if (isDateOnly(out.dateTo)) {
    const to = parseFilterDate(out.dateTo);
    to.setDate(to.getDate() + 1);
    to.setHours(6, 0, 0, 0);
    const now = new Date();
    out.dateTo = toDatetimeLocal(to > now ? now : to);
  }
  return out;
};
// "today" / "yesterday" / "1 day" / "30 days" — for the loading and export messages
const describeDateRange = (filters = {}) => {
  if (filters.quickRange === "today") return "today";
  if (filters.quickRange === "yesterday") return "yesterday";
  const from = parseFilterDate(filters.dateFrom);
  const to = parseFilterDate(filters.dateTo);
  if (!from || !to) return "";
  const days = isDateOnly(filters.dateFrom) && isDateOnly(filters.dateTo)
    ? Math.round((to - from) / 86400000) + 1
    : Math.max(1, Math.round((to - from) / 86400000));
  return days === 1 ? "1 day" : `${days} days`;
};
const formatDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} min ${rest} s` : `${m} min`;
};
const aboutDuration = (seconds) => {
  const s = Math.max(1, Math.round(Number(seconds) || 0));
  if (s < 50) return `about ${Math.max(5, Math.ceil(s / 5) * 5)} s`;
  const m = Math.round(s / 60);
  return m <= 1 ? "about 1 min" : `about ${m} min`;
};
// Display name of a quality-gate select value (operation no., a leak machine's name, or "OP150" = all leak testers)
// table column of the selected gate's own result ("station_" prefix → status chip in ReportTable)
const GATE_RESULT_KEY = "station__gateResult";
const gateLabelOf = (rawValue, machines = []) => {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  const opOf = (m) => String(m.operation_no || m.operationNo || "").trim().toUpperCase();
  const nameOf = (m) => String(m.machine_name || m.machineName || "").trim();
  if (value.toUpperCase() === LEAK_TEST_OPERATION) return `Leak Test ${LEAK_TEST_OPERATION}`;
  const leakMachine = (machines || []).find((m) => opOf(m) === LEAK_TEST_OPERATION && nameOf(m) === value);
  if (leakMachine) return `${nameOf(leakMachine)} (${LEAK_TEST_OPERATION})`;
  const machine = (machines || []).find((m) => opOf(m) === value.toUpperCase() || nameOf(m) === value);
  if (machine) {
    const op = opOf(machine);
    return op && nameOf(machine) !== op ? `${nameOf(machine)} (${op})` : (nameOf(machine) || op);
  }
  return value;
};
// "OP130 · 30 days · SHIFT_B"
const describeReportScope = (filters = {}, machines = []) => [
  String(filters.machineId || "").trim() ? gateLabelOf(filters.machineId, machines) : "All stations",
  describeDateRange(filters),
  filters.shiftCode ? String(filters.shiftCode).replace(/_/g, " ") : "",
].filter(Boolean).join(" · ");
// Filter changes within this time are merged into one request (also absorbs React StrictMode's double effect run)
const REPORT_FETCH_DEBOUNCE_MS = 250;
const EXPORT_JOB_STORAGE_KEY = "historicalReport.exportJob";

// Export job kept across reloads / navigation (only the id and labels — the file stays on the server)
const readStoredExportJob = () => {
  try { return JSON.parse(window.localStorage.getItem(EXPORT_JOB_STORAGE_KEY) || "null"); } catch { return null; }
};
const storeExportJob = (value) => {
  try {
    if (value) window.localStorage.setItem(EXPORT_JOB_STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(EXPORT_JOB_STORAGE_KEY);
  } catch { /* storage unavailable: the export still works while this page is open */ }
};

// Floating "Export in progress" panel (bottom right): parts · time left, phase, progress, Cancel / Download
const ExportJobPanel = ({ job, onCancel, onDownload, onDismiss }) => {
  if (!job) return null;
  const { status } = job;
  const active = ["starting", "queued", "running"].includes(status);
  const progress = status === "downloading" ? Number(job.downloadProgress || 0) : Math.max(0, Math.min(100, Math.round(Number(job.progress) || 0)));
  const parts = Number(job.parts) || 0;
  const title = status === "error" ? "Export failed"
    : status === "cancelled" ? "Export cancelled"
    : status === "downloaded" ? "Export downloaded"
    : status === "done" ? "Export ready"
    : status === "downloading" ? "Downloading export"
    : "Export in progress";
  const facts = [
    parts > 0 ? `${parts.toLocaleString()} parts` : (active ? "Counting parts…" : ""),
    active && job.etaSeconds !== null && job.etaSeconds !== undefined && Number.isFinite(Number(job.etaSeconds))
      ? (status === "queued" || progress < 3 ? aboutDuration(job.etaSeconds) : `${formatDuration(job.etaSeconds)} left`)
      : "",
  ].filter(Boolean).join(" · ");
  const tone = status === "error" ? "var(--pk-ng)" : status === "cancelled" ? "var(--pk-txt-muted)" : (status === "downloaded" || status === "done") ? "var(--pk-ok)" : "var(--pk-steel)";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="export-job-panel"
      className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[rgba(var(--pk-bdr),0.2)] bg-[rgb(var(--pk-bg-card))] shadow-2xl"
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="mt-0.5 flex-shrink-0" style={{ color: `rgb(${tone})` }}>
          {status === "error" ? <AlertCircle size={18} />
            : (status === "downloaded" || status === "done") ? <CheckCircle size={18} />
            : status === "cancelled" ? <X size={18} />
            : <RefreshCw size={18} className="animate-spin" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-extrabold text-[rgb(var(--pk-txt-pri))] truncate">{title}</p>
            {(active || status === "downloading") && (
              <span className="text-[11px] font-black font-mono text-[rgb(var(--pk-steel))]">{progress}%</span>
            )}
          </div>
          {job.scope && <p className="text-[11px] font-semibold text-[rgb(var(--pk-txt-sec))] truncate">{job.scope}</p>}
          {facts && <p className="text-[11px] text-[rgb(var(--pk-txt-muted))] mt-0.5">{facts}</p>}
          {(active || status === "downloading") && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(var(--pk-bdr),0.12)]">
                <div className="h-full rounded-full bg-[rgb(var(--pk-steel))] transition-all duration-500" style={{ width: `${Math.max(3, progress)}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-[rgb(var(--pk-txt-muted))] truncate">
                {job.phase || "Preparing…"}
              </p>
            </>
          )}
          {status === "error" && <p className="mt-1 text-[11px] text-[rgb(var(--pk-ng))]">{job.error || "Export failed"}</p>}
          {active && <p className="mt-1 text-[10px] text-[rgb(var(--pk-txt-muted))]">You can keep using the page — the file downloads by itself when ready.</p>}
          <div className="mt-2.5 flex items-center justify-end gap-2">
            {(active) && (
              <button type="button" onClick={onCancel} className="reports-btn-secondary !h-7 !px-2.5 !text-[11px]" data-testid="export-cancel">
                <X size={12} /> Cancel
              </button>
            )}
            {(status === "done" || status === "downloaded") && (
              <button type="button" onClick={onDownload} className="reports-btn-secondary !h-7 !px-2.5 !text-[11px]">
                <Download size={12} /> {status === "downloaded" ? "Download again" : "Download"}
              </button>
            )}
            {!active && status !== "downloading" && (
              <button type="button" onClick={onDismiss} className="reports-btn-secondary !h-7 !px-2.5 !text-[11px]">
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const HISTORICAL_REQUEST_TIMEOUT_MS = 180000;

// Parts per page. Each part carries its full station log (~40 KB), so 1,000 parts took ~40 s; 100 loads in ~5 s.
const REPORT_PREVIEW_ROWS_LIMIT = 100;

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
  const [selectedStart, setSelectedStart] = useState(() => toPickerDays(startDate, endDate).start);
  const [selectedEnd, setSelectedEnd] = useState(() => toPickerDays(startDate, endDate).end);
  const [tempStart, setTempStart] = useState(selectedStart);
  const [tempEnd, setTempEnd] = useState(selectedEnd);
  const [, setIsSelecting] = useState(false);
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
    const days = toPickerDays(startDate, endDate);
    setSelectedStart(days.start);
    setSelectedEnd(days.end);
    setTempStart(days.start);
    setTempEnd(days.end);
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

  // One production day (D 06:00 → D+1 06:00): applied straight away, sent as a plain date.
  const commitSingleDay = (date) => {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    setTempStart(day);
    setTempEnd(day);
    setSelectedStart(day);
    setSelectedEnd(day);
    setIsSelecting(false);
    onApply(day, day, { singleDay: true });
    setIsOpen(false);
  };

  const handleDayClick = (day, month, year) => {
    const clickedDate = new Date(year, month, day);
    clickedDate.setHours(0, 0, 0, 0);

    // Second click on the same day = that single production day
    if (tempStart && !tempEnd && clickedDate.getTime() === tempStart.getTime()) {
      commitSingleDay(clickedDate);
      return;
    }

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
      if (end.getTime() === tempStart.getTime()) {
        commitSingleDay(tempStart);
        return;
      }
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
          onDoubleClick={() => commitSingleDay(new Date(year, month, day))}
          title="Click twice for this production day (06:00 → next day 06:00)"
        >
          {day}
        </button>
      );
    }

    return days;
  };

  const dateRangeText = selectedStart && selectedEnd && selectedStart.getTime() !== selectedEnd.getTime()
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

// ── Station-wise summary (quality gate selected) ─────────────────────────
// Same look as ReportSummaryCards. Inspected = OK + NG at the station; "In progress" (parts waiting for the station)
// is its own card and is NOT part of the inspected total.
const STAT_COLORS = {
  navy: { bg: 'rgba(26,50,99,0.08)', border: 'rgba(26,50,99,0.15)', text: 'rgb(26,50,99)' },
  green: { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.2)', text: 'rgb(34,197,94)' },
  red: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)', text: 'rgb(239,68,68)' },
  amber: { bg: 'rgba(250,185,91,0.12)', border: 'rgba(250,185,91,0.2)', text: 'rgb(250,185,91)' },
  orange: { bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.2)', text: 'rgb(249,115,22)' },
};
const StatCardSkeleton = () => (
  <div className="relative min-h-[120px] overflow-hidden bg-[rgb(var(--pk-bg-card))] border border-[rgba(var(--pk-bdr),0.12)] rounded-xl p-4 shadow-sm">
    <div className="h-11 w-11 rounded-xl bg-[rgba(var(--pk-steel),0.06)] mb-3" />
    <div className="h-3 w-32 rounded-lg bg-[rgba(var(--pk-steel),0.06)] mb-2.5" />
    <div className="h-7 w-20 rounded-lg bg-[rgba(var(--pk-steel),0.08)]" />
  </div>
);
const StatCard = ({ label, value, icon, colorClass, subValue, subtitle, info, split }) => {
  const Icon = icon;
  const styles = STAT_COLORS[colorClass] || STAT_COLORS.navy;
  return (
    <div className="relative bg-[rgb(var(--pk-bg-card))] border border-[rgba(var(--pk-bdr),0.12)] rounded-xl p-4 shadow-sm shadow-[rgba(var(--pk-navy),0.04)] hover:shadow-md transition-all duration-300">
      <div className="flex items-start justify-between mb-3">
        <div className="p-2.5 rounded-xl" style={{ background: styles.bg, border: `1px solid ${styles.border}` }}>
          <Icon size={17} style={{ color: styles.text }} strokeWidth={2.5} />
        </div>
        {subValue && (
          <span className="text-[9px] font-extrabold text-[rgb(var(--pk-txt-muted))] bg-[rgba(var(--pk-bdr),0.06)] px-2.5 py-1 rounded-lg border border-[rgba(var(--pk-bdr),0.06)] uppercase tracking-wider">
            {subValue}
          </span>
        )}
      </div>
      <p className="text-[10px] font-extrabold text-[rgb(var(--pk-txt-muted))] uppercase tracking-wider inline-flex items-center gap-1">
        {label}
        {info && (
          <span title={info} aria-label={info} role="img" className="cursor-help normal-case">
            <Info size={11} strokeWidth={2.5} />
          </span>
        )}
      </p>
      <div className="flex items-end gap-2 mt-1">
        <h3 className="text-2xl font-black text-[rgb(var(--pk-txt-pri))] tracking-tight font-mono leading-none">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </h3>
        {subtitle && <span className="text-[10px] font-medium text-[rgb(var(--pk-txt-muted))] mb-0.5">{subtitle}</span>}
      </div>
      {split && <NgCategorySplit split={split} />}
    </div>
  );
};
const StationSummaryCards = ({ metrics = {}, stationLabel = "", loading = false, shotSummaryLoading = false }) => {
  const plc = metrics.plcShotSummary || {};
  const ok = Number(metrics.totalOK || 0);
  const ng = Number(metrics.totalNG || 0);
  const total = ok + ng;
  const station = stationLabel || "station";
  const shotCards = [
    { label: "Total Shots", value: plc.totalProduction ?? 0, icon: TrendingUp, colorClass: "navy", subValue: "HPDC Machine", subtitle: "shots" },
    { label: "OK Shots", value: plc.okShot ?? 0, icon: CheckCircle, colorClass: "green", subValue: "Passed", subtitle: "shots" },
    { label: "Warm Up Shots", value: plc.warmUpShot ?? 0, icon: Activity, colorClass: "amber", subValue: "NG Status", subtitle: "shots" },
    { label: "NG Shots", value: plc.offShot ?? 0, icon: AlertCircle, colorClass: "red", subValue: "Rejected", subtitle: "shots" },
  ];
  const stationCards = [
    { label: `Inspected at ${station}`, value: total, icon: BarChart3, colorClass: "navy", subValue: "OK + NG", subtitle: "parts", info: `Parts with an OK / NG result at ${station} in the period (OK + NG).` },
    { label: "OK", value: ok, icon: Shield, colorClass: "green", subValue: "Station OK", subtitle: "parts" },
    { label: "NG", value: ng, icon: AlertCircle, colorClass: "red", subValue: "Station NG", subtitle: ng > 0 ? "Needs review" : "All good", split: metrics.ngCategories || null },
    { label: "Pass rate", value: total > 0 ? `${Number(metrics.passRate || 0).toFixed(2)}%` : "-", icon: Percent, colorClass: "amber", subValue: "OK / (OK + NG)" },
  ];
  const stationGridCls = stationCards.length > 4 ? "grid grid-cols-2 lg:grid-cols-5 gap-3" : "grid grid-cols-2 lg:grid-cols-4 gap-3";
  if (loading) {
    return (
      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{shotCards.map((_, i) => <StatCardSkeleton key={`s-${i}`} />)}</div>
        <div className={stationGridCls}>{stationCards.map((_, i) => <StatCardSkeleton key={`g-${i}`} />)}</div>
      </div>
    );
  }
  return (
    <div className="space-y-4 mb-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <div className="h-4 w-1 rounded-full bg-[rgb(var(--pk-steel))]" />
          <span className="text-[11px] font-extrabold text-[rgb(var(--pk-steel))] uppercase tracking-wider">Machine Shot Statistics</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {shotSummaryLoading
            ? shotCards.map((_, i) => <StatCardSkeleton key={`s-${i}`} />)
            : shotCards.map((card, i) => <StatCard key={`s-${i}`} {...card} />)}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <div className="h-4 w-1 rounded-full bg-[rgb(var(--pk-amber))]" />
          <span className="text-[11px] font-extrabold text-[rgb(var(--pk-steel))] uppercase tracking-wider">Station-wise · {station}</span>
          <span className="text-[11px] text-[rgb(var(--pk-txt-muted))] font-semibold">
            each part counted once, by its latest OK/NG scan at this station
          </span>
        </div>
        <div className={stationGridCls}>
          {stationCards.map((card, i) => <StatCard key={`g-${i}`} {...card} />)}
        </div>
      </div>
    </div>
  );
};

const HistoricalReportsPage = () => {
  injectReportStyles();
  const { t } = useLanguage();
  const getMesDayRange = useCallback(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(6, 0, 0, 0);
    if (now < start) start.setDate(start.getDate() - 1);
    const end = new Date(now);
    return { start, end };
  }, []);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [shotSummaryLoading, setShotSummaryLoading] = useState(false);
  const [machines, setMachines] = useState([]);
  const [organization, setOrganization] = useState({ plants: [], lines: [], parts: [] });
  const [availableShifts, setAvailableShifts] = useState([]);
  const [data, setData] = useState({
    rows: [],
    metrics: {},
    availableShifts: [],
    plcColumns: [],
    leakPlcColumns: [],
    pagination: { page: 1, pageSize: REPORT_PREVIEW_ROWS_LIMIT, totalRows: 0, totalPages: 1 },
  });
  const [reportPage, setReportPage] = useState({ page: 1, pageSize: REPORT_PREVIEW_ROWS_LIMIT });
  // Server-side order by the selected station's own scan time: "" (default: newest first scan) | "asc" | "desc"
  const [gateSortDir, setGateSortDir] = useState("");
  const [loadError, setLoadError] = useState("");
  // What is being loaded ("OP130 · 30 days") and since when — shown while a request runs
  const [loadScope, setLoadScope] = useState({ label: "", startedAt: 0 });
  const [loadElapsed, setLoadElapsed] = useState(0);
  const [reportConfig, setReportConfig] = useState(() => loadReportConfig());
  const reportAbortRef = useRef(null);
  const machinesRef = useRef([]);
  useEffect(() => { machinesRef.current = machines; }, [machines]);
  const shotSummarySeqRef = useRef(0);
  const dataRowsCountRef = useRef(0);
  
  const [filters, setFilters] = useState(() => {
    const r = (() => {
      const now = new Date();
      const start = new Date(now);
      start.setHours(6, 0, 0, 0);
      if (now < start) start.setDate(start.getDate() - 1);
      const end = new Date(now);
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
      operationNo: '',
      partCategory: '',
      quickRange: 'today'
    };
  });

  useEffect(() => {
    dataRowsCountRef.current = Array.isArray(data.rows) ? data.rows.length : 0;
  }, [data.rows]);
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [refreshTick, setRefreshTick] = useState(0);
  const [, setQuickRange] = useState("today");
  const [isFilterExpanded] = useState(true);

  const getFreshQuickRangeFilters = useCallback((baseFilters) => {
    const missingDateRange = !baseFilters?.dateFrom || !baseFilters?.dateTo;
    const currentQuickRange = baseFilters?.quickRange || "today";
    if (currentQuickRange !== "today" && !missingDateRange) return baseFilters;
    const liveRange = getMesDayRange();
    return {
      ...baseFilters,
      dateFrom: toDatetimeLocal(liveRange.start),
      dateTo: toDatetimeLocal(liveRange.end),
      quickRange: "today"
    };
  }, [getMesDayRange]);

  const fetchData = useCallback(async () => {
    reportAbortRef.current?.abort();
    const controller = new AbortController();
    reportAbortRef.current = controller;
    const liveAppliedFilters = getFreshQuickRangeFilters(appliedFilters);
    const hasGateForSort = Boolean(String(liveAppliedFilters.machineId || "").trim());
    const requestPayload = {
      ...liveAppliedFilters,
      fast: "0",
      includePlcSummary: "0",
      includePlcReadings: "1",
      includeLeaktest: "1",
      noCache: "1",
      _ts: refreshTick || Date.now(),
      page: reportPage.page,
      pageSize: reportPage.pageSize,
      // Sorted in SQL by the station's scan time, so the order is right across all pages
      ...(hasGateForSort && gateSortDir ? { sortBy: "gateScanAt", sortDir: gateSortDir } : {}),
    };
    const hasExistingRows = Number(dataRowsCountRef.current || 0) > 0;
    setLoadScope({ label: describeReportScope(liveAppliedFilters, machinesRef.current), startedAt: Date.now() });
    setLoadError("");
    setLoading(!hasExistingRows);
    setRefreshing(hasExistingRows);
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
      // A busy database can take 10–30 s; errors are shown on this page, not by the global toast
      const response = await reportApi.getHistoricalData(requestPayload, {
        signal: controller.signal,
        suppressGlobalError: true,
        timeout: HISTORICAL_REQUEST_TIMEOUT_MS,
      });
      if (controller.signal.aborted) return; // a newer request took over
      setLoadError("");
      const summaryMetricsResponse = { metrics: response.metrics };
      setLoadProgress(100);
      const rowShotSummary = derivePlcShotSummaryFromRows(response.rows || []);
      const hasQualityGateFilter = Boolean(String(liveAppliedFilters.machineId || "").trim());
      const getShotSummaryFilters = (source = {}) => {
        const {
          machineId,
          operationNo,
          station,
          stationNo,
          status,
          resultType,
          operatorId,
          ...shotFilters
        } = source || {};
        void machineId; void operationNo; void station; void stationNo; void status; void resultType; void operatorId;
        return shotFilters;
      };
      const responseShotSummary = response.metrics?.plcShotSummary || {};
      const resolvedInitialShotSummary = hasQualityGateFilter
        ? {
            totalProduction: Number(responseShotSummary.totalProduction || 0),
            okShot: Number(responseShotSummary.okShot || 0),
            warmUpShot: Number(responseShotSummary.warmUpShot || 0),
            offShot: Number(responseShotSummary.offShot || 0),
          }
        : (Number(responseShotSummary.totalProduction || 0) > 0 ? responseShotSummary : rowShotSummary);
      const pageData = {
        filters: liveAppliedFilters, // the figures below belong to these filters
        reportMode: response.reportMode || "",
        rows: response.rows || [], 
        metrics: {
          ...(response.metrics || {}),
          ...(summaryMetricsResponse?.metrics || {}),
          metricsSource: summaryMetricsResponse?.metricsSource || response.metrics?.metricsSource || response.metricsSource || "REPORT_ROWS",
          plcShotSummary: resolvedInitialShotSummary,
          plcShotSummarySource: hasQualityGateFilter
            ? (response.metrics?.plcShotSummarySource || "PLC_SUMMARY")
            : (Number(responseShotSummary.totalProduction || 0) > 0 ? (response.metrics?.plcShotSummarySource || "PLC_SUMMARY") : "REPORT_ROWS"),
        },
        availableShifts: response.availableShifts || [],
        plcColumns: response.plcColumns || [],
        // leak tester PLC value columns: [{ key, label }] named as on the Machine page (data register ranges)
        leakPlcColumns: Array.isArray(response.leakPlcColumns) ? response.leakPlcColumns : [],
        // Rows are log entries (several per part); the part count comes from the server pagination total
        pagination: (response.pagination && Number.isFinite(Number(response.pagination.totalRows)))
          ? response.pagination
          : (() => {
              const totalRows = Number(response.metrics?.totalProduction ?? 0);
              return { page: reportPage.page, pageSize: reportPage.pageSize, totalRows, totalPages: Math.max(1, Math.ceil(totalRows / reportPage.pageSize)) };
            })(),
      };
      setData(pageData);
      const summarySeq = shotSummarySeqRef.current + 1;
      shotSummarySeqRef.current = summarySeq;
      // Machine shot statistics = the die-casting machine's shots in the period / shift (PlcCycleReadings, each shot
      // number once) — the same source as the Dashboard and the Rejection Analysis OP100 gauge. They describe the
      // machine, so they do not change with the quality-gate filter.
      void getShotSummaryFilters;
      const shotQuery = { dateFrom: liveAppliedFilters.dateFrom, dateTo: liveAppliedFilters.dateTo, shiftCode: liveAppliedFilters.shiftCode || undefined, _ts: refreshTick || Date.now() };
      setShotSummaryLoading(true);
      dashboardApi.shotAnalytics(shotQuery, { suppressGlobalError: true })
        .then((analytics) => {
          if (shotSummarySeqRef.current !== summarySeq) return;
          const t = analytics?.totals || {};
          const summary = { plcShotSummarySource: "PLC_SHOTS" };
          const serverShotSummary = { totalProduction: Number(t.shots || 0), okShot: Number(t.ok || 0), warmUpShot: Number(t.warmUp || 0), offShot: Number(t.ng || 0) };
          const nextShotSummary = {
            plcShotSummary: hasQualityGateFilter
              ? serverShotSummary
              : (Number(serverShotSummary.totalProduction || 0) > 0 ? serverShotSummary : rowShotSummary),
            plcShotSummarySource: hasQualityGateFilter
              ? (summary?.plcShotSummarySource || "PLC_SUMMARY")
              : (Number(serverShotSummary.totalProduction || 0) > 0 ? (summary?.plcShotSummarySource || "PLC_SUMMARY") : "REPORT_ROWS"),
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
          setData((prev) => ({
            ...prev,
            metrics: {
              ...(prev.metrics || {}),
              plcShotSummary: rowShotSummary,
              plcShotSummarySource: "REPORT_ROWS_FALLBACK",
            },
          }));
        })
        .finally(() => {
          if (shotSummarySeqRef.current === summarySeq) setShotSummaryLoading(false);
        });
      if (response.warning) {
        toast(response.warning);
      }
    } catch (e) {
      if (e?.code === "ERR_CANCELED" || e?.name === "CanceledError" || controller.signal.aborted) return;
      console.error(e);
      const isTimeout = String(e?.code || "").toUpperCase() === "ECONNABORTED" || /timeout/i.test(String(e?.message || ""));
      const serverMessage = String(e?.response?.data?.error || e?.response?.data?.message || "").trim();
      const scope = describeReportScope(liveAppliedFilters, machinesRef.current);
      setLoadError(
        isTimeout
          ? `${scope} did not load within ${Math.round(HISTORICAL_REQUEST_TIMEOUT_MS / 1000)} s — the database is probably busy. Retry in a moment, or choose a shorter date range or a single shift.`
          : serverMessage || (e?.response ? `${scope} could not be loaded (HTTP ${e.response.status}).` : "The report could not be loaded. Check the network / server and retry.")
      );
    } finally {
      window.clearInterval(progressTimer);
      // cancelled for newer filters: keep the loading state — the next request clears it
      if (reportAbortRef.current === controller && !controller.signal.aborted) {
        window.setTimeout(() => {
          setLoading(false);
          setRefreshing(false);
          setLoadProgress(0);
        }, 250);
        reportAbortRef.current = null;
      }
    }
  }, [appliedFilters, getFreshQuickRangeFilters, refreshTick, reportPage.page, reportPage.pageSize, gateSortDir]);

  // Station Scan Time header: default → ascending → descending → default. Reloads page 1 from the server.
  const cycleGateSort = useCallback(() => {
    setGateSortDir((prev) => (prev === "" ? "asc" : prev === "asc" ? "desc" : ""));
    setReportPage((prev) => ({ ...prev, page: 1 }));
  }, []);

  const refreshReportData = useCallback(() => {
    const nextFilters = getFreshQuickRangeFilters(filters);
    setReportPage((prev) => ({ ...prev, page: 1 }));
    if (!String(nextFilters.machineId || "").trim()) setGateSortDir("");
    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setRefreshTick(Date.now());
  }, [filters, getFreshQuickRangeFilters]);

  const applyReportFilters = useCallback(() => {
    const nextFilters = getFreshQuickRangeFilters(filters);
    setReportPage((prev) => ({ ...prev, page: 1 }));
    if (!String(nextFilters.machineId || "").trim()) setGateSortDir("");
    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setRefreshTick(Date.now());
    toast.success(t("reports.filtersApplied", "✅ Filters applied successfully"));
  }, [filters, getFreshQuickRangeFilters, t]);

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

  // One request per filter / page change: changes in quick succession (and StrictMode's mount → unmount → mount)
  // are merged by a short delay; a request still running for older filters is cancelled.
  useEffect(() => {
    const timer = window.setTimeout(() => { fetchData(); }, REPORT_FETCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      reportAbortRef.current?.abort();
    };
  }, [fetchData]);

  // seconds counter for the loading banner
  useEffect(() => {
    if (!(loading || refreshing) || !loadScope.startedAt) { setLoadElapsed(0); return undefined; }
    const tick = () => setLoadElapsed(Math.floor((Date.now() - loadScope.startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [loading, refreshing, loadScope.startedAt]);

  /* Excel export = a background job on the server. The page stays usable: a small floating panel shows parts,
     time estimate, phase and progress, with Cancel and (when ready) Download. The job id is kept in localStorage,
     so a page reload or coming back to this page later resumes it and still downloads the file. */
  const [exportJob, setExportJob] = useState(null);
  const exportJobRef = useRef(null);
  useEffect(() => { exportJobRef.current = exportJob; }, [exportJob]);
  const exportPollRef = useRef(null);
  const exportDownloadingRef = useRef(false);
  const exportActive = Boolean(exportJob && ["starting", "queued", "running", "downloading"].includes(exportJob.status));

  const mergeExportJob = useCallback((patch) => {
    setExportJob((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const downloadExport = useCallback(async () => {
    const job = exportJobRef.current;
    if (!job?.jobId || exportDownloadingRef.current) return;
    exportDownloadingRef.current = true;
    mergeExportJob({ status: "downloading", phase: "Downloading file", downloadProgress: 0 });
    try {
      const { blob, fileName } = await reportApi.downloadHistoricalExportJob(job.jobId, {
        suppressGlobalError: true,
        onDownloadProgress: (event) => {
          if (event.total) mergeExportJob({ downloadProgress: Math.round((event.loaded / event.total) * 100) });
        },
      });
      if (!blob) throw new Error("Empty response from export engine");
      const url = window.URL.createObjectURL(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a");
      link.href = url;
      const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      link.setAttribute("download", job.fileName || fileName || `${String(job.type || "full").toUpperCase()}_REPORT_${ts}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      storeExportJob(null);
      mergeExportJob({ status: "downloaded", phase: "Downloaded", downloadProgress: 100 });
      toast.success(`${t("reports.reportDownloaded", "✅ Report downloaded successfully")}${Number(job.parts) > 0 ? ` — ${Number(job.parts).toLocaleString()} parts` : ""}`);
    } catch (e) {
      const status = Number(e?.response?.status || 0);
      storeExportJob(null);
      mergeExportJob({
        status: "error",
        error: status === 410 || status === 404 ? "The export file has expired. Please export again." : (e?.message || "Download failed"),
      });
    } finally {
      exportDownloadingRef.current = false;
    }
  }, [mergeExportJob, t]);

  // poll the job (every 1.5 s) while it is queued / running; a finished job downloads by itself
  const exportJobId = exportJob?.jobId || null;
  const exportPolling = Boolean(exportJobId && ["starting", "queued", "running"].includes(exportJob?.status));
  useEffect(() => {
    if (!exportPolling) return undefined;
    let failures = 0;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const job = await reportApi.getHistoricalExportJob(exportJobId, { suppressGlobalError: true });
        if (stopped) return;
        failures = 0;
        mergeExportJob({
          status: job.status,
          progress: Number(job.progress) || 0,
          phase: job.phase,
          parts: job.parts || job.rows || exportJobRef.current?.parts || 0,
          etaSeconds: job.etaSeconds,
          queuePosition: job.queuePosition,
          fileName: job.fileName || null,
          error: job.error || null,
        });
        if (job.status === "done") { downloadExport(); return; }
        if (job.status === "error" || job.status === "cancelled") { storeExportJob(null); return; }
      } catch (e) {
        if (stopped) return;
        if (Number(e?.response?.status) === 404) {
          storeExportJob(null);
          mergeExportJob({ status: "error", error: "The export was interrupted (server restarted or the job expired). Please export again." });
          return;
        }
        failures += 1; // a short network blip must not lose a long export
        if (failures >= 10) {
          mergeExportJob({ status: "error", error: "Lost contact with the server. The export may still finish — reload this page to check." });
          return;
        }
      }
      exportPollRef.current = window.setTimeout(poll, 1500);
    };
    exportPollRef.current = window.setTimeout(poll, 500);
    return () => { stopped = true; window.clearTimeout(exportPollRef.current); };
  }, [exportJobId, exportPolling, mergeExportJob, downloadExport]);

  // resume an export started earlier (page reload / navigated away and back)
  useEffect(() => {
    const stored = readStoredExportJob();
    if (!stored?.jobId) return;
    if (Date.now() - Number(stored.startedAt || 0) > 70 * 60 * 1000) { storeExportJob(null); return; } // files expire after 1 h
    setExportJob({ ...stored, status: "starting", progress: 0, phase: "Checking export…", resumed: true });
  }, []);

  const handleExport = async (type = "full") => {
    if (exportActive) {
      toast(t("reports.exportRunning", "An export is already running — see the panel at the bottom right."));
      return;
    }
    // Exactly what is on screen: the filters of the figures / table shown (the same date window for "today",
    // shift, gate, status, search) and the table's sort — the file holds every page of those rows.
    const onScreenFilters = data.filters || appliedFilters || {};
    const { page, pageSize, limit, offset, ...filtersWithoutPagination } = onScreenFilters;
    void page; void pageSize; void limit; void offset;
    const hasGate = Boolean(String(onScreenFilters.machineId || "").trim());
    const exportFilters = {
      ...filtersWithoutPagination,
      ...(hasGate && gateSortDir ? { sortBy: "gateScanAt", sortDir: gateSortDir } : {}),
      fast: "0",
      quick: "0",
      full: "1",
      includePlcSummary: "0",
      includePlcReadings: "1",
      includeLeaktest: "1",
    };
    exportFilters.type = type;
    const scope = describeReportScope(onScreenFilters, machines);
    const startedAt = Date.now();
    setExportJob({ jobId: null, type, scope, startedAt, status: "starting", progress: 0, phase: "Counting parts…", parts: 0, etaSeconds: null });
    // the part count / time estimate runs next to the job start (both answer within a second or two)
    reportApi.estimateHistoricalExport(exportFilters, { suppressGlobalError: true })
      .then((est) => {
        setExportJob((prev) => (prev && prev.startedAt === startedAt
          ? { ...prev, parts: prev.parts || est?.parts || 0, etaSeconds: prev.etaSeconds ?? est?.etaSeconds ?? null }
          : prev));
      })
      .catch(() => {});
    try {
      const started = await reportApi.startHistoricalExport(exportFilters, reportConfig, { suppressGlobalError: true });
      if (!started?.jobId) throw new Error("The server did not start the export");
      storeExportJob({ jobId: started.jobId, type, scope, startedAt });
      setExportJob((prev) => ({
        ...(prev || {}),
        jobId: started.jobId,
        status: started.status || "queued",
        phase: started.phase || "Queued",
        queuePosition: started.queuePosition,
      }));
    } catch (e) {
      const status = Number(e?.response?.status || 0);
      const code = String(e?.code || "").toUpperCase();
      const message = status === 429
        ? "Too many exports are waiting. Please try again in a few minutes."
        : status === 0 && (code === "ERR_NETWORK" || e?.message === "Network Error")
        ? "Unable to reach the server. Check the network and try again."
        : e?.response?.data?.error || e?.message || t("reports.exportFailed", "Export failed");
      setExportJob((prev) => ({ ...(prev || {}), status: "error", error: message }));
    }
  };

  const cancelExport = useCallback(async () => {
    const job = exportJobRef.current;
    window.clearTimeout(exportPollRef.current);
    storeExportJob(null);
    if (!job?.jobId) { setExportJob(null); return; }
    mergeExportJob({ status: "cancelled", phase: "Cancelled" });
    try {
      await reportApi.cancelHistoricalExportJob(job.jobId, { suppressGlobalError: true });
    } catch { /* already finished / expired: nothing to cancel */ }
    window.setTimeout(() => setExportJob((prev) => (prev?.jobId === job.jobId && prev.status === "cancelled" ? null : prev)), 2500);
  }, [mergeExportJob]);

  const dismissExport = useCallback(() => {
    window.clearTimeout(exportPollRef.current);
    storeExportJob(null);
    setExportJob(null);
  }, []);
  const exportProgress = exportJob ? Math.round(Number(exportJob.progress) || 0) : 0;

  const handleSync = async () => {
    try {
      const syncRange = expandProductionDayFilters(appliedFilters);
      const payload = {
        dateFrom: syncRange.dateFrom,
        dateTo: syncRange.dateTo
      };
      
      toast.promise(reportApi.syncHistoricalData(payload), {
        loading: "Initiating Background Sync...",
        success: "Master table sync started in background!",
        error: "Failed to start sync"
      });
    } catch (e) {
      console.error("Sync failed:", e);
    }
  };

  const handleDateRangeApply = (start, end, options = {}) => {
    const singleDay = Boolean(options.singleDay) || (end && toDateOnlyString(start) === toDateOnlyString(end));
    if (singleDay) {
      // One production day: plain YYYY-MM-DD for both ends; the server applies D 06:00 → D+1 06:00
      const day = toDateOnlyString(start);
      setFilters((prev) => ({ ...prev, dateFrom: day, dateTo: day, quickRange: "custom" }));
      setQuickRange("custom");
      return;
    }
    const normalizedStart = new Date(start);
    const normalizedEnd = new Date(end || start);
    normalizedStart.setHours(6, 0, 0, 0);
    normalizedEnd.setHours(6, 0, 0, 0);
    normalizedEnd.setDate(normalizedEnd.getDate() + 1);
    const currentRange = getMesDayRange();
    if (
      normalizedStart.toDateString() === currentRange.start.toDateString() &&
      normalizedEnd > currentRange.end
    ) {
      normalizedEnd.setTime(currentRange.end.getTime());
    }
    setFilters((prev) => ({
      ...prev,
      dateFrom: toDatetimeLocal(normalizedStart),
      dateTo: toDatetimeLocal(normalizedEnd),
      quickRange: "custom"
    }));
    setQuickRange("custom");
  };

  const handleDateRangeClear = () => {
    const liveRange = getMesDayRange();
    setFilters((prev) => ({
      ...prev,
      dateFrom: toDatetimeLocal(liveRange.start),
      dateTo: toDatetimeLocal(liveRange.end),
    }));
    setQuickRange("today");
  };

  // The filters the figures on screen belong to: while a new filter loads, the previous figures stay (dimmed) with
  // their own labels instead of e.g. overall totals under an "OP130" heading.
  const shownFilters = data.filters || appliedFilters;

  const reportTable = useMemo(() => {
    const sourceRows = data.rows || [];
    const hasAppliedGate = Boolean(String(shownFilters.machineId || "").trim());
    // Applied gate → its operation: the select value is an operation no. ("OP130"), a leak machine's name, or "OP150"
    const scopedOperationKey = (() => {
      const value = String(shownFilters.machineId || "").trim();
      if (!value) return "";
      if (/^OP\d{3}$/i.test(value)) return value.toUpperCase();
      const m = (machines || []).find((x) => String(x.machine_name || x.machineName || "").trim() === value || String(x.id ?? "") === value);
      return m ? String(m.operation_no || m.operationNo || m.station_no || m.stationNo || "").trim().toUpperCase() : "";
    })();
    const appliedGateName = hasAppliedGate ? gateLabelOf(shownFilters.machineId, machines) : "";
    const machineStationPairs = (machines || [])
      .map((m) => {
        const machineName = String(m.machineName || m.machine_name || "").trim();
        const op = String(m.operationNo || m.operation_no || m.stationNo || m.station_no || "").trim();
        if (!machineName || !op) return null;
        const bypassed = Boolean(m.bypassEnabled || m.bypass_enabled || m.isBypassed || m.is_bypassed);
        if (String(op).trim().toUpperCase() === LEAK_TEST_OPERATION) {
          return { key: LEAK_TEST_SHARED_KEY, machineName: "Leak Test", op, label: "OP150 · Leak Test", sharedLeakOperation: true, bypassed };
        }
        return { key: op.toUpperCase(), machineName, op, label: `${op.toUpperCase()} · ${machineName}`, bypassed };
      })
      .filter(Boolean);
    const machineStationMap = new Map(machineStationPairs.map((x) => [x.key, x]));
    // Placeholder values ("-", "N/A", "null") are not stations; they used to create a "- + -" column
    const isPlaceholder = (v) => !v || /^[-–—\s]*$/.test(v) || ["N/A", "NA", "NULL", "UNDEFINED"].includes(v.toUpperCase());
    const rowStationPairs = sourceRows
      .map((r) => {
        const machineName = String(r.station?.name || r.machineName || "").trim();
        const op = String(r.station?.operation || r.operationNo || r.stationNo || "").trim();
        if (isPlaceholder(machineName) || isPlaceholder(op)) return null;
        if (String(op).trim().toUpperCase() === LEAK_TEST_OPERATION) {
          return { key: LEAK_TEST_SHARED_KEY, machineName: "Leak Test", op, label: "OP150 · Leak Test", sharedLeakOperation: true };
        }
        return { key: op.toUpperCase(), machineName, op, label: `${op.toUpperCase()} · ${machineName}` };
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
    const configuredBypassedStationKeys = stationPairs.reduce((acc, station) => {
      if (station.bypassed) {
        acc.add(String(station.op || station.key || "").trim().toUpperCase());
        acc.add(String(station.key || station.op || "").trim().toUpperCase());
      }
      return acc;
    }, new Set());
    const requiredOperations = Array.from(
      new Set(
        stationPairs
          .map((s) => String(s.op || "").trim().toUpperCase())
          .filter(Boolean)
      )
    );
    const discoveredPlcColumns = Array.isArray(data.plcColumns) && data.plcColumns.length > 0 ? data.plcColumns : DEFAULT_PLC_CYCLE_COLUMNS;
    const plcKeys = discoveredPlcColumns
      .filter((key) => DEFAULT_PLC_CYCLE_COLUMNS.includes(key))
      .filter((key) => !["machine_name", "part_name", "shot_number", "shot_date", "shot_time", "shot_datetime"].includes(key));
    const plcColumns = (() => {
      const used = new Map();
      const baseColumns = plcKeys.map((key) => ({ key, label: withUnit(formatPlcColumnLabel(key), PLC_COLUMN_UNITS[key]) }));
      return baseColumns.map(({ key, label: initialLabel }) => {
        const base = initialLabel;
        const count = used.get(base) || 0;
        used.set(base, count + 1);
        return { key, label: count === 0 ? base : `${base} (${count + 1})` };
      });
    })();
    const grouped = new Map();
    sourceRows.forEach((row, idx) => {
      const partKey = String(row.part?.id || row.__reportPageGroupKey || row.reportPageGroupKey || row.reportGroupKey || row.report_group_key || row.traceabilityPartId || row.traceability_part_id || row.partId || row.part_id || row.barcode || row.shot_uid || `row_${idx}`).trim();
      const key = partKey || `row_${idx}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });

    /* Column set — the Excel download (backend services/report/historicalExcelService.js → buildHistoricalColumns)
       uses the same columns in the same order; keep both in step.
       Overall view: part, first scan / final result time, every station's result, final status, where it is,
       rejection details, shot (PLC) parameters and leak readings.
       Gate view: only what belongs to the selected gate — part, the gate's scan time / shift / result, its NG
       details, the shot (PLC) parameters and, from the leak test onwards, the leak readings (no Final Status and
       no per-station columns of the whole line). */
    const isLeakGate = hasAppliedGate && scopedOperationKey === LEAK_TEST_OPERATION;
    // Leak tester PLC values (read at END OK / NG) — one column per data register configured on the leak machines,
    // labelled with the Machine page name; shown before the leak tester database columns (Body Leak Value, Gall…)
    const leakPlcColumnDefs = (Array.isArray(data.leakPlcColumns) ? data.leakPlcColumns : []).filter((c) => c && c.key);
    const leakColumns = [
      ...leakPlcColumnDefs.map((c) => ({ key: `leakplc_${c.key}`, label: c.label || c.name || c.key, renderAsText: true })),
      ...LEAK_TEST_COLUMNS.map((c) => ({ key: `leak_${c.key}`, label: withUnit(c.label, c.unit) })),
    ];
    const plcTableColumns = plcColumns.map((c) => ({ key: `plc_${c.key}`, label: c.label }));
    const rejectionColumns = [
      { key: "rejectionCategory", label: "Category" },
      { key: "rejectionReason", label: "Rejection" },
      { key: "rejectionView", label: "View" },
      { key: "rejectionZone", label: "Zone" },
      { key: "rejectionSubZone", label: "Sub Zone" },
    ];
    const finalStatusColumn = { key: "overallStatus", label: "Final Status" };
    const dynamicColumns = [
      { key: "srNo", label: "#" },
      { key: "plc_shot_number", label: "Shot #" },
      { key: "shot_datetime", label: "Shot Date & Time" },
      { key: "barcode", label: "Part Serial", blankIfEmpty: true },
      { key: "customerCode", label: "Customer QR" },
      { key: "dieName", label: "Die" },
      ...(hasAppliedGate ? [] : [{ key: "createdAt", label: "First Scan" }]),
      // With a station selected, the day and shift follow the time that station handled the part
      // With a gate applied the header sorts by this time on the server (asc → desc → default order)
      ...(hasAppliedGate ? [{
        key: "gateScanAt",
        label: hasAppliedGate ? (
          <button
            type="button"
            onClick={cycleGateSort}
            className="inline-flex items-center gap-1 uppercase tracking-wider font-black text-white hover:opacity-80 cursor-pointer"
            style={{ background: "transparent", border: "none", padding: 0, font: "inherit" }}
            title={gateSortDir === "asc"
              ? "Sorted oldest first. Click for newest first."
              : gateSortDir === "desc"
                ? "Sorted newest first. Click to return to the default order."
                : "Click to sort by station scan time (oldest first)."}
            aria-sort={gateSortDir === "asc" ? "ascending" : gateSortDir === "desc" ? "descending" : "none"}
          >
            Station Scan Time
            {gateSortDir === "asc" ? <ArrowUp size={12} /> : gateSortDir === "desc" ? <ArrowDown size={12} /> : <ArrowUpDown size={12} style={{ opacity: 0.6 }} />}
          </button>
        ) : "Station Scan Time",
      }, { key: "gateShift", label: "Station Shift", renderAsText: true }] : []),
      ...(hasAppliedGate
        ? [
          // "station_" key → rendered as a status chip by ReportTable
          { key: GATE_RESULT_KEY, label: `${appliedGateName} Result` },
          ...rejectionColumns,
          // gate view: the gate's own result only (no Final Status); shot parameters whenever the part has a shot,
          // leak readings from the leak test onwards — same columns as the Excel (buildHistoricalColumns)
          ...plcTableColumns,
          ...(isLeakGate || scopedOperationKey === "OP160" ? leakColumns : []),
        ]
        : [
          { key: "finalResultAt", label: "Final Result Time" },
          ...stationPairs.map((s) => ({
            key: `station_${s.key}`,
            label: s.label,
            renderAsText: Boolean(s.sharedLeakOperation),
            renderLeakOperation: Boolean(s.sharedLeakOperation),
          })),
          finalStatusColumn,
          // for parts still in process: the last station with a result and the next one it is waiting for
          { key: "progressAt", label: "Where is it", renderAsText: true },
          ...rejectionColumns,
          ...plcTableColumns,
          ...leakColumns,
        ]),
    ];

    const dynamicRows = Array.from(grouped.values()).map((entries, idx) => {
      const first = entries[0] || {};
      const partKey = String(first.part?.id || first.__reportPageGroupKey || first.reportPageGroupKey || first.reportGroupKey || first.report_group_key || first.traceabilityPartId || first.traceability_part_id || first.partId || first.part_id || first.barcode || first.shot_uid || `row_${idx}`).trim();
      const displayPartId = looksLikeCustomerQrValue(partKey) ? "" : partKey;
      const stationResults = {};
      const stationDisplayValues = {};
      const operationResults = {};
      const operationResultTimes = {};
      const stationCycleTimes = {};
      const plcData = {};
      let leakData = null;
      let finalInspectionOkAt = null;
      let hasFinalInspectionOk = false;
      // first scan: the master table's time (same as the Excel); older servers: the earliest log
      const firstScanAt = first.__pr_first_scan_at || entries.reduce((earliest, row) => {
        const raw = row.first_scan_at || row.production?.firstScanAt || row.firstScanCreatedAt || row.createdAtRaw || row.createdAt || null;
        if (!raw) return earliest;
        if (!earliest) return raw;
        return new Date(raw).getTime() < new Date(earliest).getTime() ? raw : earliest;
      }, null);
      entries.forEach((row) => {
        const stationOp = String(row.station?.operation || row.operationNo || row.stationNo || "").trim();
        const stationKey = stationOp ? stationOp.toUpperCase() : "";
        const rowLeakData = (row.leakTest && row.leakTest.length > 0) ? row.leakTest : (row.leakTestReadings?.length > 0 ? row.leakTestReadings : (row.leakTestReading && typeof row.leakTestReading === "object" ? row.leakTestReading : null));
        if (!leakData && rowLeakData) {
          leakData = rowLeakData;
        }
        if (stationKey) {
          const normalizedStationResult = normResult(
            String(row.station?.result || row.industrialResult || row.statusLabel || row.result || "-").toUpperCase(),
            row.rejection?.reason || row.reason || row.interlock_reason,
            row
          );
          if (normalizedStationResult) {
            stationResults[stationKey] = pickPreferredResult(stationResults[stationKey], normalizedStationResult);
            const resultTime = getResultTimestamp(row);
            if (resultTime) {
              const currentTime = operationResultTimes[stationOp];
              if (!currentTime || parseDateSafe(resultTime) >= parseDateSafe(currentTime)) {
                operationResultTimes[stationOp] = resultTime;
              }
            }
          }
          if (stationOp && normalizedStationResult) {
            operationResults[stationOp] = pickPreferredOperationResult(operationResults[stationOp], normalizedStationResult);
          }
          if (normalizedStationResult === "OK" && isFinalInspectionOperation(row)) {
            hasFinalInspectionOk = true;
            const resultTime = getResultTimestamp(row);
            if (resultTime) {
              if (!finalInspectionOkAt || parseDateSafe(resultTime) >= parseDateSafe(finalInspectionOkAt)) {
                finalInspectionOkAt = resultTime;
              }
            }
          }
          stationCycleTimes[stationKey] = row.station?.cycleTime || row.cycleTime || "-";
        }
        const nextPlcData = {
          shot_number: row.shot?.number,
          recordedAt: row.shot?.recordedAt,
          shot_date: row.shot?.date,
          shot_time: row.shot?.time,
          machine_name: row.shot?.machine,
          part_name: row.shot?.partDie,
          shot_status: row.shot?.status,

          ...(row.shot?.parameters || {}),
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
      // Leak tests in time order (the latest test decides, see getLeakTestStatus). leakHistory also covers the sync's `readings` list.
      const leakReadingsSorted = sortLeakReadings(leakData);
      const leakHistory = getLeakHistory(leakData);
      const leakHistorySummary = formatLeakHistorySummary(leakHistory);
      if (hasLeakData) {
        const actualLeakData = leakReadingsSorted[leakReadingsSorted.length - 1] || (Array.isArray(leakData) ? leakData[leakData.length - 1] : leakData);
        const leakStatus = getLeakTestStatus(leakData);
        const leakMachineName = getLeakMachineName(actualLeakData);
        // the latest leak test decides OP150 (a retest OK overrides an earlier NG)
        stationResults[LEAK_TEST_SHARED_KEY] = leakStatus || stationResults[LEAK_TEST_SHARED_KEY];
        stationDisplayValues[LEAK_TEST_SHARED_KEY] = leakMachineName
          ? `${leakMachineName} ${leakStatus || "-"}`.trim()
          : (leakStatus || "-");
        operationResults[LEAK_TEST_OPERATION] = leakStatus || operationResults[LEAK_TEST_OPERATION];
      }
      const rejectionDetails = resolveRejectionDetails(entries);
      const plcPartDie = splitPartDie(first.shot?.partDie || plcData.part_name || first.part?.label || first.part?.name || first.partDieLabel || first.partName || "");
      const mappedCustomerCode = entries
        .map((row) => sanitizeCustomerQrValue(row.part?.customerQr || row.customerQrCode || row.customerCode || row.customer_qr || ""))
        .find((value) => String(value || "").trim() && String(value).trim() !== "-") ||
        (looksLikeCustomerQrValue(partKey) ? partKey : "");
      const customerQrPending = entries.some((row) => Boolean(row.customerQrPending || row.customer_qr_pending));
      const displayShotNumber = entries
        .map((row) => row.shot?.number ?? row.plcReading?.shot_number ?? row.plc_reading?.shot_number ?? row.shot_number ?? row.shotNumber ?? "")
        .map((value) => String(value || "").trim())
        .find((value) => value && value !== "-") || "";
      // The selected gate's own result: OK / NG of the part's decisive scan there (stamped by the server, the same
      // result the gate's OK / NG figures count), IN_PROGRESS = waiting for the gate. Fallback: the gate's column.
      const gateResult = (() => {
        if (!hasAppliedGate) return "";
        const stamped = String(first.__pr_gate_status || "").trim().toUpperCase();
        if (stamped === "OK" || stamped === "NG" || stamped === "IN_PROGRESS") return stamped;
        const fromLogs = normResult(scopedOperationKey === LEAK_TEST_OPERATION ? stationResults[LEAK_TEST_SHARED_KEY] : operationResults[scopedOperationKey]);
        return fromLogs === "OK" || fromLogs === "NG" ? fromLogs : "-";
      })();
      const resolveOverallStatus = () => {
        const effectiveRequiredOperations = hasLeakData
          ? requiredOperations
          : requiredOperations.filter((operation) => operation !== LEAK_TEST_OPERATION);
        const allVals = Object.values(operationResults).map((value) => normResult(value)).filter(Boolean);
        if (allVals.some((v) => v === "NG")) return "NG";
        const vals = effectiveRequiredOperations.map((operation) => normResult(operationResults[operation])).filter(Boolean);
        if (vals.some((v) => v === "NG")) return "NG";
        if (hasFinalInspectionOk) return "PASSED";
        if (finalInspectionOkAt) return "PASSED";
        if (vals.some((v) => v === "IN_PROGRESS")) return "IN_PROGRESS";
        const finalStatus = normalizeFinalPartStatus(first.overall_status || first.part?.status || first.partStatus || first.part_status || first.status);
        if (finalStatus === "NG") return "NG";
        if (finalStatus === "PASSED") return "PASSED";
        return "IN_PROGRESS";
      };
      const resolvedOverallStatus = resolveOverallStatus();
      // Final status = the server's part status ("OK" / "NG" / "IN_PROGRESS"): exactly what the OK / NG / In progress
      // cards and the Excel count (NG = overall NG, any station NG or a leak-test NG). Rows from an older server
      // without it fall back to the status worked out from the logs.
      const overallStatus = (() => {
        const prStatus = normResult(first.__pr_overall_status);
        if (prStatus === "OK" || prStatus === "NG" || prStatus === "IN_PROGRESS") return prStatus;
        return normResult(resolvedOverallStatus) || "IN_PROGRESS";
      })();
      // Final result time: the master table's final scan time (leak testers' clocks can be off); for a completed part
      // without one, the latest station result time in its logs. Same rule as the Excel.
      const finalResultRaw = (() => {
        if (overallStatus !== "OK" && overallStatus !== "NG") return null;
        if (first.__pr_final_scan_at) return first.__pr_final_scan_at;
        return entries.reduce((latest, row) => {
          const t = row.station?.cycleEndAt || row.production?.latestActivityAt || null;
          return t && (!latest || parseDateSafe(t) > parseDateSafe(latest)) ? t : latest;
        }, null);
      })();

      // On the Historical page, trust the ProductionReport master table's pre-computed status.
      // Do NOT apply any hide-out-of-range override — the data is already finalized in the DB.
      const displayOverallStatus = overallStatus;
      const progressAt = (() => {
        if (normResult(displayOverallStatus) === "OK" || normResult(displayOverallStatus) === "NG") return "";
        const LINE = ["OP100", "OP110", "OP120", "OP130", "OP140", "OP150", "OP160"];
        const res = (op) => normResult(stationResults[op] || "");
        const passed = (op) => res(op) === "OK" || (op === "OP150" && Boolean(leakData));
        const started = LINE.find((op) => res(op) === "IN_PROGRESS");
        if (started) return `Scan started at ${started} · no result yet`;
        const done = LINE.filter(passed);
        if (!done.length) return "Not scanned yet";
        const last = done[done.length - 1];
        const next = LINE[LINE.indexOf(last) + 1];
        return next ? `Passed ${last} · awaiting ${next}` : `Passed ${last}`;
      })();
      const displayFinalResultRaw = finalResultRaw;
      const bypassedStationKeys = entries.reduce((acc, row) => {
        const bypassStatus = Boolean(row?.bypassStatus || row?.is_bypassed || row?.isBypassed);
        const bypassReason = String(row?.bypassReason || row?.bypass_reason || "").trim().toUpperCase();
        const stationOp = String(row.operationNo || row.stationNo || "").trim().toUpperCase();
        if (stationOp && (bypassStatus || ["MACHINE_BYPASS_AUTO_OK", "STATION_BYPASS_AUTO_OK", "STATION_OPERATION_DISABLED_AUTO_OK", "MANUAL_BYPASS"].includes(bypassReason))) {
          acc.add(stationOp);
        }
        return acc;
      }, new Set());
      const shaped = {
        reportGroupKey: partKey,
        traceabilityPartId: partKey,
        srNo: Math.max(
          1,
          Number(data.pagination?.totalRows || sourceRows.length || 0) -
            ((Number(data.pagination?.page || 1) - 1) * Number(data.pagination?.pageSize || sourceRows.length || 0)) -
            idx
        ),
        plc_shot_number: plcData.shot_number || displayShotNumber || "-",
        shot_datetime: plcData.shot_datetime
          ? formatDateSafeStr(plcData.shot_datetime)
          : [plcData.shot_date || first.shot_date, plcData.shot_time || first.shot_time].filter(Boolean).join(" ") || "-",
        barcode: displayPartId !== "" ? displayPartId : "",
        plc_machine_name: plcData.machine_name || first.machineName || "-",
        createdAt: firstScanAt ? formatDateSafeStr(firstScanAt) : "-",
        gateScanAt: (() => { const g = entries.find((r) => r.__pr_gate_scan_at)?.__pr_gate_scan_at; return g ? formatDateSafeStr(g) : "-"; })(),
        finalResultAt: displayFinalResultRaw ? formatDateSafeStr(displayFinalResultRaw) : "-",
        partName: plcPartDie.partName || first.partName || first.modelName || first.componentName || "-",
        dieName: plcPartDie.dieName || first.part?.die || first.dieName || "-",
        // shift of the gate scan (gate view), from the server's Shift Management timings
        gateShift: entries.find((r) => r.__pr_gate_shift)?.__pr_gate_shift || "-",
        customerCode: mappedCustomerCode || (customerQrPending ? "Customer QR Pending" : ""),
        overallStatus: displayOverallStatus,
        [GATE_RESULT_KEY]: gateResult,
        progressAt,
        ngReason: normResult(displayOverallStatus) === "OK" ? "" : (() => {
          const rawReason = first.reason || first.interlock_reason || "";
          const normalizedReason = String(rawReason || "").trim().toUpperCase();
          if (!rawReason || rawReason === "-" || normalizedReason === "RECOVERY_PENDING_AFTER_BACKEND_RESTART") {
            return "";
          }
          return rawReason;
        })(),
        // gate view: rejection details only for parts NG at the gate (a later leak reject is not this gate's)
        ...(() => {
          const hide = hasAppliedGate ? gateResult !== "NG" : normResult(displayOverallStatus) === "OK";
          return {
            rejectionCategory: hide ? "-" : (rejectionDetails.category || "-"),
            rejectionReason: hide ? "-" : (rejectionDetails.rejection || "-"),
            rejectionView: hide ? "-" : (rejectionDetails.view || "-"),
            rejectionZone: hide ? "-" : (rejectionDetails.zone || "-"),
            rejectionSubZone: hide ? "-" : (rejectionDetails.subZone || "-"),
          };
        })(),
        cycleStartTime: firstScanAt ? formatDateSafeStr(firstScanAt) : "-",
        cycleTimeValue: stationPairs.length ? (stationCycleTimes[stationPairs[stationPairs.length - 1].key] || "-") : "-",
      };
      stationPairs.forEach((s) => {
        if (s.sharedLeakOperation) {
          const leakArr = leakHistory.length ? leakHistory : leakReadingsSorted;
          const allMachineNames = [...new Set(
            leakArr
              .map((r) => getLeakMachineName(r))
              .filter(Boolean)
          )];
          const leakStatus = getLeakTestStatus(leakData);
          const machineLabel = allMachineNames.join(" + ") || (leakHistorySummary ? "Leak Test" : "");
          shaped[`station_${s.key}`] = {
            // retested part: "LT-1 + LT-2 · NG → OK (retest)" next to the counted result chip (the latest test decides)
            machineName: leakHistorySummary ? `${machineLabel} · ${leakHistorySummary}` : machineLabel,
            status: String(leakStatus || "").trim().toUpperCase() || "-",
            text: stationDisplayValues[s.key] || "-",
          };
        } else {
          const normalizedStationValue = normResult(stationResults[s.key]);
          const stationToken = String(s.op || s.key || "").trim().toUpperCase();
          const stationKeyToken = String(s.key || s.op || "").trim().toUpperCase();
          shaped[`station_${s.key}`] = normalizedStationValue || (
            bypassedStationKeys.has(stationToken) ||
            bypassedStationKeys.has(stationKeyToken) ||
            configuredBypassedStationKeys.has(stationToken) ||
            configuredBypassedStationKeys.has(stationKeyToken)
              ? "OK"
              : "-"
          );
        }
        shaped[`cycle_${s.key}`] = stationCycleTimes[s.key] || "-";
      });
      if (String(shaped.overallStatus || "").toUpperCase() === "IN_PROGRESS" && customerQrPending) {
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
        shaped[`leak_${key}`] = getLeakTestValue(leakReadingsSorted.length ? leakReadingsSorted : leakData, key);
      });
      // leak tester PLC values: the part's latest END OK / NG reading (server: LeakTestReadings), by normalised key
      const leakPlcValues = (entries.find((row) => row.leakPlc || row.__pr_leak_plc) || {});
      const leakPlcReading = leakPlcValues.leakPlc || leakPlcValues.__pr_leak_plc || null;
      leakPlcColumnDefs.forEach(({ key }) => {
        const v = leakPlcReading?.values?.[key];
        shaped[`leakplc_${key}`] = v === undefined || v === null || v === "" ? "-" : v;
      });
      // Every leak test (machine, time, value) when the part was tested more than once
      shaped.leakHistory = formatLeakHistoryDetail(leakHistory) || "-";
      return shaped;
    });
    // "Leak Test History" column, only when a part on this page was retested on the leak tester
    if (dynamicRows.some((row) => row.leakHistory && row.leakHistory !== "-")) {
      const statusIndex = dynamicColumns.findIndex((c) => c.key === "overallStatus" || c.key === GATE_RESULT_KEY);
      dynamicColumns.splice(statusIndex >= 0 ? statusIndex : dynamicColumns.length, 0, {
        key: "leakHistory",
        label: "Leak Test History",
        renderAsText: true,
      });
    }

    // The server already filters by status (gate view: the gate's result / waiting parts) — the gate view shows
    // every row it returns; the overall view keeps its check on the part's final status.
    const filteredDynamicRows = dynamicRows.filter(row => {
      if (!shownFilters.status || hasAppliedGate) return true;
      const expectedStatus = shownFilters.status.toUpperCase();
      const currentStatus = String(row.overallStatus || "").toUpperCase();
      
      if (expectedStatus === "PASSED" || expectedStatus === "OK") {
         return currentStatus === "PASSED" || currentStatus === "OK";
      }
      if (expectedStatus === "IN_PROGRESS" || expectedStatus === "WIP") {
         return currentStatus === "IN_PROGRESS" || currentStatus === "WIP";
      }
      return currentStatus === expectedStatus;
    });

    // row number across pages (page 2 of 100 starts at 101) — the Excel numbers the same rows 1…N in the same order
    const rowOffset = (Math.max(1, Number(data.pagination?.page || 1)) - 1) * Math.max(1, Number(data.pagination?.pageSize || 0) || filteredDynamicRows.length || 1);
    const visibleRows = filteredDynamicRows.map((row, index) => ({
      ...row,
      srNo: rowOffset + index + 1,
    }));

    return { columns: dynamicColumns, rows: visibleRows };
  }, [data.rows, data.plcColumns, data.leakPlcColumns, data.pagination, machines, shownFilters.machineId, shownFilters.status, gateSortDir, cycleGateSort]);

  const reportSummaryMetrics = useMemo(() => {
    const metrics = data.summary || data.metrics || {};
    const visibleRows = Array.isArray(data.rows) ? data.rows : [];
    const traceabilityProduction = Number(
      metrics.traceabilityProduction ??
      metrics.totalProduction ??
      0
    );
    const totalOK = Number(metrics.passed ?? metrics.totalOK ?? 0);
    const totalNG = Number(metrics.failed ?? metrics.totalNG ?? 0);
    const inProgress = Number(metrics.inProgress || 0);
    const isPlcCommonError = (value = "") => {
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
    };

    const visibleNgCount = visibleRows.filter((row) => {
      const status = String(row?.overallStatus || row?.status || row?.result || row?.finalStatus || "").toUpperCase();
      const reason = String(row?.reason || row?.interlock_reason || "").trim();
      if (isPlcCommonError(reason)) return false;
      return status === "NG" || status === "FAILED";
    }).length;
    
    const visibleOkCount = visibleRows.filter((row) => {
      const status = String(row?.overallStatus || row?.status || row?.result || row?.finalStatus || "").toUpperCase();
      return status === "PASSED" || status === "OK";
    }).length;

    const visibleInProgressCount = visibleRows.filter((row) => {
      const status = String(row?.overallStatus || row?.status || row?.result || row?.finalStatus || "").toUpperCase();
      return status === "IN_PROGRESS" || status === "PENDING";
    }).length;

    const hasQualityGateFilter = Boolean(String(shownFilters.machineId || "").trim());
    const rawMetrics = data.summary || data.metrics;
    const resolvedTotalNG = (rawMetrics && (typeof rawMetrics.failed !== "undefined" || typeof rawMetrics.totalNG !== "undefined")) ? totalNG : visibleNgCount;
    const resolvedTotalOK = (rawMetrics && (typeof rawMetrics.passed !== "undefined" || typeof rawMetrics.totalOK !== "undefined")) ? totalOK : visibleOkCount;
    const resolvedInProgress = (rawMetrics && typeof rawMetrics.inProgress !== "undefined") ? inProgress : visibleInProgressCount;
    const resolvedProductionBase = resolvedTotalOK + resolvedTotalNG;
    const resolvedPassRate = resolvedProductionBase > 0 ? Number(((resolvedTotalOK / resolvedProductionBase) * 100).toFixed(2)) : 0;
    // Station: total = parts it inspected (OK + NG); parts waiting for it are a separate figure (gateInProgress).
    // Overall adds in-progress parts to the total.
    const stationInProgress = hasQualityGateFilter ? 0 : resolvedInProgress;
    const resolvedTotal = resolvedProductionBase + stationInProgress;
    const gateInProgressDef = metrics.gateScope?.inProgress || null;
    const gateInProgress = hasQualityGateFilter && gateInProgressDef
      ? { ...gateInProgressDef, count: Number(metrics.inProgress ?? gateInProgressDef.count ?? 0) }
      : null;
    if (traceabilityProduction && traceabilityProduction !== resolvedTotal) {
      console.warn(`[HistoricalReports] server total ${traceabilityProduction} != OK ${resolvedTotalOK} + NG ${resolvedTotalNG}${hasQualityGateFilter ? "" : ` + in progress ${resolvedInProgress}`}`);
    }

    return {
      totalProduction: resolvedTotal,
      traceabilityProduction: resolvedTotal,
      serverTotalProduction: traceabilityProduction,
      isStationScope: hasQualityGateFilter,
      totalOK: resolvedTotalOK,
      totalNG: resolvedTotalNG,
      inProgress: stationInProgress,
      gateInProgress,
      validationRejects: Number(metrics.validationRejects ?? resolvedTotalNG),
      passRate: resolvedPassRate,
      // CR / MR / CRAM split of the NG figure, computed by the server for the whole filtered set
      ngCategories: metrics.ngCategories || null,
      plcShotSummary: metrics.plcShotSummary || {},
    };
  }, [data.metrics, data.summary, data.rows, shownFilters.machineId]);
  // Display name of the applied quality gate (select values: operation no., a leak machine's name, or "OP150" = all leak testers)
  const appliedGateLabel = useMemo(() => gateLabelOf(shownFilters.machineId, machines), [shownFilters.machineId, machines]);
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

  const getControlCls = useCallback(() => {
    return 'h-9 w-full rounded-lg border border-[rgba(var(--pk-bdr),0.2)] bg-[rgb(var(--pk-bg-input))] px-3 text-xs font-semibold text-[rgb(var(--pk-txt-pri))] outline-none transition-all focus:border-[rgba(var(--pk-steel),0.5)] focus:ring-2 focus:ring-[rgba(var(--pk-steel),0.08)]';
  }, []);

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
                {t("reports.title", "📊 Historical Reports")}
               
              </h1>
              <p className="text-sm text-[rgb(var(--pk-txt-sec))] mt-0.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs">
                  <Database size={12} className="text-[rgb(var(--pk-txt-muted))]" />
                  {data.pagination?.totalRows || 0} records
                </span>
                <span className="w-px h-4 bg-[rgba(var(--pk-bdr),0.2)]" />
                <span className="inline-flex items-center gap-1 text-xs">
                  <Activity size={12} className="text-[rgb(var(--pk-txt-muted))]" />
                  {loading ? t("reports.loading", "Loading...") : refreshing ? t("reports.refreshing", "Refreshing...") : t("reports.productionAnalytics", "Production Analytics")}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              disabled={loading || refreshing}
              onClick={handleSync}
              className="reports-btn-secondary !bg-[rgb(var(--pk-navy))] !text-white"
            >
              <Database size={13} />
              <span className="hidden sm:inline">Sync Database</span>
            </button>
            <button
              disabled={loading || refreshing}
              onClick={refreshReportData}
              className="reports-btn-secondary"
            >
              <RefreshCw size={13} className={(loading || refreshing) ? "animate-spin" : ""} />
              <span className="hidden sm:inline">{(loading || refreshing) ? t("reports.refreshing", "Refreshing...") : t("reports.refresh", "Refresh")}</span>
            </button>
            <button
              disabled={exportActive}
              onClick={() => handleExport("full")}
              className="reports-btn-export"
              title={exportActive ? "Export in progress — see the panel at the bottom right" : undefined}
            >
              {exportActive && (
                <span
                  className="absolute inset-y-0 left-0 bg-white/20 transition-all duration-300"
                  style={{ width: `${Math.max(8, exportProgress)}%` }}
                />
              )}
              <span className="relative inline-flex items-center gap-2">
                {exportActive ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                <span className="hidden sm:inline">{exportActive ? `Exporting ${exportProgress}%` : t("reports.downloadReport", "Download Report")}</span>
                <span className="sm:hidden">{exportActive ? `${exportProgress}%` : <Download size={14} />}</span>
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
              {Object.entries(filters).filter(([k, v]) => !["dateFrom", "dateTo", "quickRange"].includes(k) && v && String(v).trim()).length} active
            </span>
          </div>
         
        </div>

        <div className={`grid gap-2.5 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 reports-filters-grid ${isFilterExpanded ? '' : 'max-h-48 overflow-hidden'}`}>
          {/* Custom Date Range Picker */}
          <DateRangePicker
            startDate={filters.dateFrom}
            endDate={filters.dateTo}
            onApply={handleDateRangeApply}
            onClear={handleDateRangeClear}
            label="📅 Select Date Range"
          />

          {/* 
          <PlantLineSelector
            value={filters}
            onChange={(scope) => setFilters(prev => ({ ...prev, ...scope, machineId: "" }))}
            includeAll
            compact
            hideLabels
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:col-span-2"
            inputClassName={getControlCls}
          />

          <select
            className={getControlCls(!!filters.partName)}
            value={filters.partName || ""}
            onChange={(e) => setFilters({ ...filters, partName: e.target.value, dieName: "", dieCastingMachine: "" })}
          >
            <option value="">⚙️ All Parts</option>
            {availablePartNames.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select
            className={getControlCls(!!filters.dieName)}
            value={filters.dieName || ""}
            onChange={(e) => setFilters({ ...filters, dieName: e.target.value, dieCastingMachine: "" })}
            disabled={!availableDies.length && !filters.dieName}
          >
            <option value="">🎯 All Dies</option>
            {availableDies.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          */}

          <select
            id="filter-partCategory"
            name="partCategory"
            className={getControlCls(!!filters.partCategory)}
            value={filters.partCategory || ""}
            onChange={(e) => setFilters({ ...filters, partCategory: e.target.value })}
          >
            <option value="">🏷️ All Categories</option>
            <option value="HPDC">⚙️ Casted Parts (With Shot Details)</option>
            <option value="OTHER">📦 Other Parts (No Shot Details)</option>
          </select>

          <select
            id="filter-machineId"
            name="machineId"
            className={getControlCls(!!filters.machineId)}
            value={filters.machineId || ""}
            onChange={(e) => setFilters({ ...filters, machineId: e.target.value })}
          >
            <option value="">🏭 All Quality Gates</option>
            {machines.map((m) => {
              const op = String(m.operation_no || m.operationNo || "").trim().toUpperCase();
              const name = m.machine_name || m.machineName;
              // The three leak testers share OP150, so each is selected by its own machine name
              const isLeak = op === LEAK_TEST_OPERATION;
              return (
                <option key={m.id || name} value={isLeak ? name : (op || name)}>
                  {isLeak ? `${name} (${LEAK_TEST_OPERATION})` : name}
                </option>
              );
            })}
            {machines.some((m) => String(m.operation_no || m.operationNo || "").trim().toUpperCase() === LEAK_TEST_OPERATION) && (
              <option value={LEAK_TEST_OPERATION}>Leak Test {LEAK_TEST_OPERATION} — all {machines.filter((m) => String(m.operation_no || m.operationNo || "").trim().toUpperCase() === LEAK_TEST_OPERATION).length} machines</option>
            )}
          </select>

          <select
            id="filter-status"
            name="status"
            className={getControlCls(!!filters.status)}
            value={filters.status || ""}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">📊 All Status</option>
            {["OK", "NG", "WIP"].map((status) => (
              <option key={status} value={status}>
                {status === "OK" ? "✅ OK" : status === "NG" ? "❌ NG" : "⏳ In Progress"}
              </option>
            ))}
          </select>

          <input
            id="filter-barcode"
            name="barcode"
            type="text"
            className={getControlCls(!!filters.barcode)}
            placeholder="🔍 Part ID / Shot No / Customer QR"
            value={filters.barcode || ""}
            onChange={(e) => setFilters({ ...filters, barcode: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                applyReportFilters();
              }
            }}
          />

          <select
            id="filter-shiftCode"
            name="shiftCode"
            className={getControlCls(!!filters.shiftCode)}
            value={filters.shiftCode || ""}
            onChange={(e) => setFilters({ ...filters, shiftCode: e.target.value })}
          >
            <option value="">🕐 Full Day (All Shifts)</option>
            {(availableShifts || []).map((shift) => (
              <option key={shift.shiftCode} value={shift.shiftCode}>
                {shift.shiftName || shift.shiftCode}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 col-span-1 md:col-span-2 lg:col-span-1">
            <button
              onClick={() => {
                const todayRange = getMesDayRange();
                const nextFilters = {
                  dateFrom: toDatetimeLocal(todayRange.start),
                  dateTo: toDatetimeLocal(todayRange.end),
                  plantId: '', lineId: '', machineId: '', partName: '', dieName: '', dieCastingMachine: '', lineName: '', shiftCode: '', status: '', partType: '', station: '', barcode: '', customerCode: '',
                  operatorId: '', resultType: '', modelCode: '', operationNo: '', partCategory: '', quickRange: 'today'
                };
                setQuickRange("today");
                setGateSortDir("");
                setFilters(nextFilters);
                setAppliedFilters(nextFilters);
                setReportPage((prev) => ({ ...prev, page: 1 }));
                setRefreshTick(Date.now());
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
              <Calendar size={10} />{" "}
              {isDateOnly(filters.dateFrom) && filters.dateFrom === filters.dateTo
                ? parseFilterDate(filters.dateFrom)?.toLocaleDateString()
                : `${parseFilterDate(filters.dateFrom)?.toLocaleDateString() || "-"} → ${parseFilterDate(filters.dateTo)?.toLocaleDateString() || "-"}`}
            </span>
          )}
        </div>
      </div>

      {(loading || refreshing || shotSummaryLoading) && (
        <div
          role="status"
          aria-live="polite"
          data-testid="report-loading-banner"
          className="mt-3 rounded-xl border border-[rgba(var(--pk-steel),0.18)] bg-[rgba(var(--pk-steel),0.06)] px-4 py-3 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <RefreshCw size={14} className="animate-spin text-[rgb(var(--pk-steel))] flex-shrink-0" />
              <span className="text-xs font-bold text-[rgb(var(--pk-txt-pri))] truncate">
                {(loading || refreshing)
                  ? `Loading ${loadScope.label || "report"}…`
                  : "Updating shot summary"}
              </span>
              {(loading || refreshing) && (
                <span className="hidden sm:inline text-[11px] font-semibold text-[rgb(var(--pk-txt-muted))] truncate">
                  {refreshing ? "· previous figures shown until the new ones arrive" : ""}
                  {loadElapsed >= 3 ? ` · ${formatDuration(loadElapsed)}` : ""}
                  {loadElapsed >= 20 ? " · the database is busy, still working" : ""}
                </span>
              )}
            </div>
            <span className="text-[10px] font-black text-[rgb(var(--pk-steel))] font-mono">
              {Math.max(0, Math.min(100, Math.round(loadProgress || (shotSummaryLoading ? 92 : 0))))}%
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
            <div
              className="h-full rounded-full bg-[rgb(var(--pk-steel))] transition-all duration-300"
              style={{ width: `${Math.max(8, Math.min(100, loadProgress || (shotSummaryLoading ? 92 : 12)))}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Load error (this page's own error state; the global error toast is suppressed for this request) ── */}
      {loadError && !loading && !refreshing && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-[rgba(var(--pk-ng),0.25)] bg-[rgba(var(--pk-ng),0.06)] px-4 py-3">
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle size={16} className="text-[rgb(var(--pk-ng))] flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-[rgb(var(--pk-ng))]">Report could not be loaded</p>
              <p className="text-xs text-[rgb(var(--pk-txt-sec))] mt-0.5">
                {loadError}
                {Array.isArray(data.rows) && data.rows.length > 0 ? " The figures below are from the previous load." : ""}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setRefreshTick(Date.now())} className="reports-btn-secondary flex-shrink-0">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* ── Summary Cards + table. While new filters load, the previous figures stay visible (dimmed). ── */}
      <div
        aria-busy={loading || refreshing}
        data-testid="report-results"
        className={`space-y-5 transition-opacity duration-200 ${refreshing ? "opacity-50 saturate-50" : "opacity-100"}`}
      >
      {reportSummaryMetrics.isStationScope ? (
        <StationSummaryCards
          metrics={reportSummaryMetrics}
          stationLabel={appliedGateLabel}
          loading={loading}
          shotSummaryLoading={shotSummaryLoading}
        />
      ) : (
        <ReportSummaryCards metrics={reportSummaryMetrics} loading={loading} shotSummaryLoading={shotSummaryLoading} />
      )}

      {/* ── Table ── */}
      <ReportTable
        rows={reportTable.rows}
        columns={reportTable.columns}
        loading={loading}
        progress={loadProgress}
        disablePagination={false}
        pagination={data.pagination}
        onPageChange={(page) => setReportPage((prev) => ({ ...prev, page }))}
        onPageSizeChange={(pageSize) => {
          setReportPage({ page: 1, pageSize });
        }}
        defaultPageSize={REPORT_PREVIEW_ROWS_LIMIT}
        pageSizeOptions={[100, 250, 500, 1000, 2000, 5000, 10000]}
      />
      </div>
      <ExportJobPanel
        job={exportJob}
        onCancel={cancelExport}
        onDownload={downloadExport}
        onDismiss={dismissExport}
      />
    </div>
  );
};

export default HistoricalReportsPage;
