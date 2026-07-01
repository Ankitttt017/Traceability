/**
 * reportExportService.js
 * Main entry point for the reporting system.
 * Orchestrates database queries, metrics calculation, and file generation.
 */

const { Op } = require("sequelize");
const sequelize = require("../../config/db");
const OperationLog = require("../../models/OperationLog");
const Machine = require("../../models/Machine");
const Part = require("../../models/Part");
const PartCodeMapping = require("../../models/PartCodeMapping");
const Shift = require("../../models/Shift");
const QrFormatRule = require("../../models/QrFormatRule");
const LinePartAssignment = require("../../models/LinePartAssignment");
const MachineModel = require("../../models/Machine");
const { calculateProductionMetrics } = require("./reportMetricsService");
const { generateIndustrialExcel } = require("./excelTemplateEngine");
const { resolveIndustrialResult } = require("./reportFormatter");
const { toMinutes: parseShiftMinutes } = require("../../utils/time");
const {
  LEAKTEST_OPERATION,
  buildLeaktestIndex,
  getLeaktestReadingForPartStation,
  getLeaktestStageState,
} = require("../leaktestLookupService");
const PLC_READING_TABLE = "PlcCycleReadings";
const CUSTOMER_QR_ONLY_FORMAT = "CUSTOMER_QR_ONLY";

async function resolveReportPartSearchValues(input) {
  const raw = String(input || "").trim();
  if (!raw) return [];
  const mappings = await PartCodeMapping.findAll({
    where: {
      [Op.or]: [
        { customer_qr: { [Op.like]: `%${raw}%` } },
        { old_part_id: { [Op.like]: `%${raw}%` } },
      ],
    },
    attributes: ["old_part_id"],
    order: [["updatedAt", "DESC"]],
    raw: true,
  });
  const numericShot = /^\d{1,6}$/.test(raw) ? String(Number(raw)) : "";
  return [...new Set([
    raw,
    ...(numericShot ? [numericShot, numericShot.padStart(4, "0"), numericShot.padStart(5, "0"), numericShot.padStart(6, "0")] : []),
    ...mappings.map((row) => String(row.old_part_id || "").trim()),
  ].filter(Boolean))];
}

const PLC_PART_ID_CANDIDATE_COLUMNS = [
  "shot_uid",
  "part_id",
  "partid",
  "part_serial_no",
  "part_serial",
  "part_no",
  "part_number",
  "barcode",
  "qr_code",
  "component_code",
];

const PLC_SHOT_CANDIDATE_COLUMNS = [
  "shot_number",
  "shotnumber",
  "sequence_no",
  "seq_no",
];

const PLC_REPORT_COLUMNS = [
  "machine_name", "part_name", "shot_date", "shot_number", "cycle_time",
  "die_close_core_in_time", "pouring_time", "shot_fwd_time", "curing_time", "die_open_core_out_time",
  "ejector_time", "extract_time", "spray_time", "v1_speed", "v2_speed", "v3_speed", "v4_speed", "metal_pressure",
  "furnace_metal_temp", "cooling_water_mov", "cooling_water_sta", "accel_point", "deaccel_point", "intensification_time",
  "biscuit_thickness", "jet_cooling_pressure", "clamp_tonnage_he_low_pct", "clamp_tonnage_he_low_mn", "clamp_tonnage_op_up_pct",
  "clamp_tonnage_op_low_pct", "clamp_tonnage_he_up_pct", "vacuum_pressure", "clamp_force_pct", "clamp_tonnage", "shot_acc_pressure",
  "intensification_acc_pressure", "fixed_die_temp_f1", "fixed_die_temp_f2", "moving_die_temp_m1", "moving_die_temp_m2", "slide_temp_s1",
  "fix_1_flow", "fix_2_flow", "fix_3_flow", "mov_1_flow", "mov_2_flow", "mov_3_flow", "vacuum_pressure_mmhg",
  "average_die_clamp_tonnage_count", "time_for_stroke", "stroke", "shot_status",
  "shot_year", "shot_month", "shot_day", "shot_hour", "shot_minute", "shot_second",
  "recorded_at",
];

const PLC_REPORT_SELECT = PLC_REPORT_COLUMNS.map((column) => `[${column}]`).join(", ");

const NON_PRODUCTION_REASONS = new Set([
  "DUPLICATE_SCAN",
  "DUPLICATE_SCAN_IN_FLIGHT",
  "ALREADY_COMPLETED",
  "ALREADY_SCANNED",
  "PREVIOUS_STATION_NOT_COMPLETED",
  "INVALID_QR_FORMAT",
  "QR_RULE_CONFIG_ERROR",
  "STATION_NOT_CONFIGURED",
  "PART_NOT_FOUND",
  "CUSTOMER_CODE_INVALID",
  "CUSTOMER_CODE_RULE_INVALID",
  "INVALID_INPUT",
  "VALIDATION_ERROR",
]);

function enrichPlcReadingDisplay(row) {
  if (!row || typeof row !== "object") return row;
  const next = { ...row };
  const y = normalizeReportYear(next.shot_year);
  const m = Number(next.shot_month);
  const d = Number(next.shot_day);
  const hh = Number(next.shot_hour);
  const mm = Number(next.shot_minute);
  const ss = Number(next.shot_second);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    next.shot_date = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (Number.isFinite(hh) && Number.isFinite(mm) && Number.isFinite(ss)) {
    next.shot_time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  const shotStatus = Number(next.shot_status);
  if (shotStatus === 1) next.shot_status_text = "OK";
  else if (shotStatus === 3) next.shot_status_text = "WARM_UP_SHOT";
  else if (shotStatus === 5) next.shot_status_text = "OFFSET_SHOT";
  return next;
}

function normalizeReportYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return year;
  if (year >= 0 && year < 100) return 2000 + year;
  return year;
}

function isProductionReportLog(log) {
  if (!log) return false;

  const status = String(log.plc_status || "").trim().toUpperCase();
  const reason = String(log.interlock_reason || "").trim().toUpperCase();
  const result = String(log.result || "").trim().toUpperCase();
  const validationResult = String(log.validation_result || "").trim().toUpperCase();

  if (Boolean(log.is_bypassed)) return result === "OK" || status === "ENDED_OK";
  if (status === "RESET" || status === "VALIDATION_ONLY") return false;
  if (["FAILED", "DUPLICATE", "BLOCKED"].includes(validationResult)) return false;
  if (NON_PRODUCTION_REASONS.has(reason)) return false;
  if (result === "BLOCK") return false;

  if (status === "INTERLOCKED") {
    if (validationResult === "DUPLICATE" || validationResult === "BLOCKED" || validationResult === "FAILED") return false;
    if (reason && NON_PRODUCTION_REASONS.has(reason)) return false;
  }

  return true;
}

function shouldTreatRecoveryPendingAsPassed(log, mappedCustomerQr) {
  const status = String(log?.plc_status || "").trim().toUpperCase();
  const result = String(log?.result || "").trim().toUpperCase();
  const reason = String(log?.interlock_reason || "").trim().toUpperCase();
  return (
    Boolean(mappedCustomerQr) &&
    result === "OK" &&
    ["PENDING", "PLC_COMM_ERROR", "STARTED"].includes(status) &&
    reason === "RECOVERY_PENDING_AFTER_BACKEND_RESTART"
  );
}

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}
function normalizePartToken(value) {
  return String(value || "").trim().toUpperCase();
}
function splitPlcPartDie(value) {
  const raw = normalizePartToken(value);
  if (!raw) return { partName: "", dieName: "", label: "" };
  const [partName, ...dieParts] = raw.split("-");
  return {
    partName: partName || "",
    dieName: dieParts.join("-") || "",
    label: raw,
  };
}
function normalizeShotToken(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.toUpperCase() === "NULL") return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw.toUpperCase();
  const noLead = digits.replace(/^0+/, "");
  return (noLead || "0").toUpperCase();
}
function extractShotFromPartId(partId) {
  const raw = String(partId || "").trim();
  if (!raw) return "";
  // Compact QR format: MMDDHHMM + MACHINE_CODE(1) + SHOT(1..6)
  const machineCompact = raw.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machineCode>[A-Z0-9]{1})(?<shot>\d{1,6})$/i);
  if (machineCompact?.groups?.shot) return String(machineCompact.groups.shot).trim();
  // Legacy compact QR format: MMDDHHMM + SHOT(1..6)
  const compact = raw.match(/^(\d{8})(\d{1,6})$/);
  if (compact?.[2]) return compact[2];
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // Common production format: YYMMDDHHMMSS + SHOT_SUFFIX
  const tsShot = digits.match(/^(\d{12})(\d{1,8})$/);
  if (tsShot?.[2]) return tsShot[2];
  if (digits.length <= 12) return "";
  return digits.slice(12);
}
function parseCompactQrPartId(partId) {
  const raw = String(partId || "").trim();
  const machineCompact = raw.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machineCode>[A-Z0-9]{1})(?<shot>\d{1,6})$/i);
  const legacyCompact = raw.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<shot>\d{1,6})$/);
  const groups = machineCompact?.groups || legacyCompact?.groups;
  if (!groups) return null;
  const month = Number(groups.month);
  const day = Number(groups.day);
  const hour = Number(groups.hour);
  const minute = Number(groups.minute);
  const shot = Number(groups.shot);
  if (![day, month, hour, minute, shot].every(Number.isFinite)) return null;
  return {
    key: `${month}|${day}|${hour}|${minute}|${shot}`,
    day,
    month,
    hour,
    minute,
    shot,
    shotRaw: String(groups.shot || "").trim(),
  };
}
function deriveShotCandidates(log) {
  const direct = String(log.shot_number || log.shotNumber || "").trim();
  const fromPartPattern = extractShotFromPartId(log.part_id);
  const candidates = [direct, fromPartPattern]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  return [...new Set(candidates)];
}

function getMinutesForDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: process.env.REPORT_TIMEZONE || "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(date).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    const hours = Number(parts.hour);
    const minutes = Number(parts.minute);
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      return hours * 60 + minutes;
    }
  } catch (_) {
    // Fall back to process-local time if the runtime does not support the configured timezone.
  }
  return date.getHours() * 60 + date.getMinutes();
}

function toShiftMinutes(timeValue) {
  return parseShiftMinutes(timeValue);
}

function isDateInShift(dateValue, shift) {
  const currentMinutes = getMinutesForDate(dateValue);
  const start = toShiftMinutes(shift.start_time);
  const end = toShiftMinutes(shift.end_time);
  if (currentMinutes === null || start === null || end === null) return false;
  if (start === end) return true;
  if (start < end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
}

async function getActiveShiftDefinitions() {
  return Shift.findAll({
    where: { is_active: true },
    attributes: ["id", "shift_name", "shift_code", "start_time", "end_time"],
    order: [["start_time", "ASC"]],
    raw: true,
  });
}

function applyShiftFilter(rows, shiftCode, shifts) {
  if (!shiftCode) return rows;
  const target = String(shiftCode).trim().toUpperCase();
  if (!target || ["ALL", "ANY", "ALL_SHIFTS", "ALL SHIFT", "ALL SHIFTS"].includes(target)) return rows;
  const shift = findShiftDefinition(shifts, shiftCode);
  if (!shift) return rows;
  return rows.filter((row) => {
    const timestamp = row.createdAt || row.updatedAt || row.latestAnchorCreatedAt;
    return shift && isDateInShift(timestamp, shift);
  });
}

function findShiftDefinition(shifts, shiftCode) {
  const target = String(shiftCode || "").trim().toUpperCase();
  if (!target) return null;
  return (shifts || []).find((s) => {
    const code = String(s.shift_code || s.shiftCode || "").trim().toUpperCase();
    const name = String(s.shift_name || s.shiftName || "").trim().toUpperCase();
    return code === target || name === target;
  }) || null;
}

async function getPlcReadingColumns() {
  try {
    const [rows] = await sequelize.query(
      `
        SELECT LOWER(COLUMN_NAME) AS column_name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = :tableName
      `,
      { replacements: { tableName: PLC_READING_TABLE } }
    );
    return new Set((rows || []).map((row) => String(row.column_name || "").trim()).filter(Boolean));
  } catch (_) {
    return new Set();
  }
}

function normalizeReportDateRange(filters = {}) {
  const now = new Date();
  const from = filters.dateFrom ? new Date(filters.dateFrom) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = filters.dateTo ? new Date(filters.dateTo) : now;
  return {
    safeFrom: Number.isNaN(from.getTime()) ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : from,
    safeTo: Number.isNaN(to.getTime()) ? now : to,
  };
}

function normalizeShotStatusBucket(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  const numeric = Number(raw);
  if (numeric === 1 || ["OK", "GOOD", "PASS", "PASSED"].includes(raw)) return "ok";
  if (numeric === 3 || raw.includes("WARM")) return "warmUp";
  if (numeric === 5 || raw.includes("OFF") || raw.includes("OFFSET")) return "off";
  return "other";
}

function normalizeOptionalToken(value) {
  const token = String(value || "").trim();
  const upper = token.toUpperCase();
  return ["", "ALL", "ANY", "ALL_SHIFTS", "ALL SHIFT", "ALL SHIFTS"].includes(upper) ? "" : token;
}

async function applyPlcShiftWhere(whereParts, replacements, shiftCode) {
  const target = normalizeOptionalToken(shiftCode).toUpperCase();
  if (!target) return;
  const shifts = await getActiveShiftDefinitions();
  const shift = shifts.find((row) => {
    const code = String(row.shift_code || row.shiftCode || "").trim().toUpperCase();
    const name = String(row.shift_name || row.shiftName || "").trim().toUpperCase();
    return code === target || name === target;
  });
  if (!shift) return;
  const start = toShiftMinutes(shift.start_time);
  const end = toShiftMinutes(shift.end_time);
  if (start === null || end === null) return;
  const minuteExpr = "(DATEPART(HOUR, recorded_at) * 60 + DATEPART(MINUTE, recorded_at))";
  if (start === end) return;
  replacements.shiftStartMinutes = start;
  replacements.shiftEndMinutes = end;
  whereParts.push(start < end
    ? `${minuteExpr} >= :shiftStartMinutes AND ${minuteExpr} < :shiftEndMinutes`
    : `(${minuteExpr} >= :shiftStartMinutes OR ${minuteExpr} < :shiftEndMinutes)`);
}

async function fetchPlcShotSummary(filters = {}) {
  const { safeFrom, safeTo } = normalizeReportDateRange(filters);
  const whereParts = ["recorded_at BETWEEN :dateFrom AND :dateTo"];
  const replacements = { dateFrom: safeFrom, dateTo: safeTo };
  const partName = normalizePartToken(filters.partName || filters.part_name);
  const dieName = normalizePartToken(filters.dieName || filters.die_name);
  const dieCastingMachine = String(filters.dieCastingMachine || filters.die_casting_machine || "").trim();

  const assignmentWhere = { is_active: true };
  if (filters.plantId) assignmentWhere.plant_id = filters.plantId;
  if (filters.lineId) assignmentWhere.line_id = filters.lineId;
  if (partName) assignmentWhere.part_name = partName;
  if (dieName) assignmentWhere.die_name = dieName;
  if (dieCastingMachine) assignmentWhere.die_casting_machine = dieCastingMachine;

  let assignmentRows = [];
  try {
    assignmentRows = await LinePartAssignment.findAll({
      where: assignmentWhere,
      attributes: ["part_name", "die_name", "die_casting_machine"],
      raw: true,
    });
  } catch (error) {
    console.warn(`[REPORT] Part assignment scope unavailable: ${error.message}`);
  }

  const machineNames = [];
  if (dieCastingMachine) {
    machineNames.push(dieCastingMachine);
  } else if (assignmentRows.length) {
    machineNames.push(...assignmentRows.map((row) => String(row.die_casting_machine || "").trim()).filter(Boolean));
  }

  if (!machineNames.length && filters.machineId) {
    const machine = await Machine.findByPk(filters.machineId, { attributes: ["machine_name"], raw: true });
    if (!machine?.machine_name) return { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 };
    machineNames.push(String(machine.machine_name).trim());
  } else if (!machineNames.length && (filters.lineId || filters.lineName || filters.plantId)) {
    const machineWhere = {};
    if (filters.lineId) machineWhere.line_id = filters.lineId;
    else if (filters.lineName) machineWhere.line_name = filters.lineName;
    if (filters.plantId) machineWhere.plant_id = filters.plantId;
    const machines = await Machine.findAll({
      where: machineWhere,
      attributes: ["machine_name"],
      raw: true,
    });
    machineNames.push(...machines.map((machine) => String(machine.machine_name || "").trim()).filter(Boolean));
    if (!machineNames.length) return { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 };
  }

  const uniqueMachineNames = [...new Set(machineNames.map((name) => String(name || "").trim()).filter(Boolean))];
  if (assignmentRows.length) {
    const clauses = [];
    assignmentRows.forEach((row, index) => {
      const rowPart = normalizePartToken(row.part_name);
      const rowDie = normalizePartToken(row.die_name);
      const rowMachine = String(row.die_casting_machine || "").trim();
      if (!rowPart && !rowMachine) return;
      const parts = [];
      if (rowPart) {
        const key = `assignmentPart${index}`;
        replacements[key] = rowDie ? `${rowPart}-${rowDie}%` : `${rowPart}%`;
        parts.push(`UPPER(LTRIM(RTRIM(CAST(part_name AS NVARCHAR(255))))) LIKE :${key}`);
      }
      if (rowMachine) {
        const key = `assignmentMachine${index}`;
        replacements[key] = rowMachine;
        parts.push(`LTRIM(RTRIM(CAST(machine_name AS NVARCHAR(255)))) = :${key}`);
      }
      if (parts.length) clauses.push(`(${parts.join(" AND ")})`);
    });
    if (clauses.length) whereParts.push(`(${clauses.join(" OR ")})`);
  } else if (uniqueMachineNames.length) {
    const placeholders = uniqueMachineNames.map((_, index) => `:machineName${index}`).join(", ");
    whereParts.push(`LTRIM(RTRIM(CAST(machine_name AS NVARCHAR(255)))) IN (${placeholders})`);
    uniqueMachineNames.forEach((name, index) => {
      replacements[`machineName${index}`] = name;
    });
  }

  const searchToken = String(filters.barcode || filters.customerCode || "").trim();
  if (searchToken) {
    whereParts.push(`(
      LTRIM(RTRIM(CAST(shot_number AS NVARCHAR(255)))) LIKE :searchToken
      OR LTRIM(RTRIM(CAST(part_name AS NVARCHAR(255)))) LIKE :searchToken
    )`);
    replacements.searchToken = `%${searchToken}%`;
  }

  if (partName) {
    whereParts.push(`UPPER(LTRIM(RTRIM(CAST(part_name AS NVARCHAR(255))))) LIKE :partNameLike`);
    replacements.partNameLike = `${partName}%`;
  }
  if (dieName) {
    whereParts.push(`UPPER(LTRIM(RTRIM(CAST(part_name AS NVARCHAR(255))))) LIKE :dieNameLike`);
    replacements.dieNameLike = partName ? `${partName}-${dieName}%` : `%-${dieName}%`;
  }
  await applyPlcShiftWhere(whereParts, replacements, filters.shiftCode || filters.shift_code);

  try {
    const [rows] = await sequelize.query(
      `
        SELECT shot_status, COUNT(*) AS count
        FROM ${PLC_READING_TABLE}
        WHERE ${whereParts.join(" AND ")}
        GROUP BY shot_status
      `,
      { replacements }
    );

    const summary = { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 };
    for (const row of rows || []) {
      const count = Number(row.count || 0) || 0;
      summary.totalProduction += count;
      const bucket = normalizeShotStatusBucket(row.shot_status);
      if (bucket === "ok") summary.okShot += count;
      else if (bucket === "warmUp") summary.warmUpShot += count;
      else if (bucket === "off") summary.offShot += count;
    }
    return summary;
  } catch (error) {
    console.warn(`[REPORT] PLC shot summary unavailable: ${error.message}`);
    return { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 };
  }
}

function pickFirstAvailableColumn(columnSet, candidates) {
  for (const column of candidates) {
    if (columnSet.has(String(column).toLowerCase())) return column;
  }
  return null;
}

async function fetchLatestPlcReadingsByColumn(columnName, values = []) {
  const map = new Map();
  for (const value of values) {
    const normalized = normalizeKey(value);
    if (!normalized || map.has(normalized)) continue;
    try {
      const [rows] = await sequelize.query(
        `SELECT TOP 1 ${PLC_REPORT_SELECT} FROM ${PLC_READING_TABLE} WHERE [${columnName}] = :value ORDER BY recorded_at DESC`,
        { replacements: { value: String(value).trim() } }
      );
      if (rows && rows[0]) map.set(normalized, rows[0]);
    } catch (_) {
      // Keep report resilient even when schema differs on some installations.
    }
  }
  return map;
}

async function fetchLatestPlcReadingsByShotTokens(values = []) {
  const map = new Map();
  const shotValues = [...new Set(values.map((v) => normalizeShotToken(v)).filter(Boolean))];
  if (!shotValues.length) return map;
  try {
    const placeholders = shotValues.map((_, idx) => `:s${idx}`).join(", ");
    const replacements = shotValues.reduce((acc, value, idx) => {
      acc[`s${idx}`] = value;
      return acc;
    }, {});
    const [rows] = await sequelize.query(
      `SELECT ${PLC_REPORT_SELECT} FROM ${PLC_READING_TABLE} WHERE CAST(shot_number AS NVARCHAR(255)) IN (${placeholders}) ORDER BY recorded_at DESC`,
      { replacements }
    );
    for (const row of rows || []) {
      const key = normalizeShotToken(row.shot_number || "");
      if (!key || map.has(key)) continue;
      map.set(key, row);
    }
  } catch (_) {
    return map;
  }
  return map;
}

async function fetchLatestPlcReadingsByCompactQr(values = []) {
  const map = new Map();
  const compactValues = [...new Map(
    values
      .map((value) => parseCompactQrPartId(value))
      .filter(Boolean)
      .map((parsed) => [parsed.key, parsed])
  ).values()];
  if (!compactValues.length) return map;

  for (const parsed of compactValues) {
    try {
      const [rows] = await sequelize.query(
        `
          SELECT TOP 1 ${PLC_REPORT_SELECT} FROM ${PLC_READING_TABLE}
          WHERE TRY_CONVERT(INT, shot_day) = :day
            AND TRY_CONVERT(INT, shot_month) = :month
            AND TRY_CONVERT(INT, shot_hour) = :hour
            AND TRY_CONVERT(INT, shot_minute) = :minute
            AND (
              TRY_CONVERT(INT, shot_number) = :shot
              OR LTRIM(RTRIM(CAST(shot_number AS NVARCHAR(255)))) = :shotRaw
            )
          ORDER BY recorded_at DESC
        `,
        {
          replacements: {
            day: parsed.day,
            month: parsed.month,
            hour: parsed.hour,
            minute: parsed.minute,
            shot: parsed.shot,
            shotRaw: parsed.shotRaw,
          },
        }
      );
      if (rows && rows[0]) map.set(parsed.key, rows[0]);
    } catch (_) {
      // Keep report resilient even when schema differs on some installations.
    }
  }

  return map;
}

async function fetchLatestPlcReadingByMachineShotContext({ shotCandidates = [], machineName = "", logCreatedAt = null }) {
  const normalizedShots = [...new Set(shotCandidates.map((v) => normalizeShotToken(v)).filter(Boolean))];
  if (!normalizedShots.length) return null;

  const normalizedMachine = String(machineName || "").trim();
  const logDate = logCreatedAt ? new Date(logCreatedAt) : null;
  const hasLogDate = Boolean(logDate) && !Number.isNaN(logDate.getTime());
  if (!normalizedMachine || !hasLogDate) return null;

  for (const shot of normalizedShots) {
    try {
      const [rows] = await sequelize.query(
        `
          SELECT TOP 1 ${PLC_REPORT_SELECT}
          FROM ${PLC_READING_TABLE}
          WHERE (
            TRY_CONVERT(INT, shot_number) = TRY_CONVERT(INT, :shot)
            OR LTRIM(RTRIM(CAST(shot_number AS NVARCHAR(255)))) = :shot
          )
          AND LTRIM(RTRIM(CAST(machine_name AS NVARCHAR(255)))) = :machineName
          AND ABS(DATEDIFF(MINUTE, recorded_at, :logCreatedAt)) <= 15
          ORDER BY
            ABS(DATEDIFF(SECOND, recorded_at, :logCreatedAt)) ASC,
            recorded_at DESC
        `,
        {
          replacements: {
            shot,
            machineName: normalizedMachine,
            logCreatedAt: hasLogDate ? logDate : new Date(),
          },
        }
      );
      if (rows && rows[0]) return enrichPlcReadingDisplay(rows[0]);
    } catch (_) {
      // Keep report resilient if context fallback is not supported in some installations.
    }
  }

  return null;
}

async function fetchLatestPlcReadingForPartId(partId, plcColumns = null) {
  const normalizedPartId = String(partId || "").trim();
  if (!normalizedPartId) return null;

  const availableColumns = plcColumns || await getPlcReadingColumns();
  const compact = parseCompactQrPartId(normalizedPartId);
  if (compact) {
    const compactMap = await fetchLatestPlcReadingsByCompactQr([normalizedPartId]);
    if (compactMap.has(compact.key)) return enrichPlcReadingDisplay(compactMap.get(compact.key));
  }

  const partLookupColumn = pickFirstAvailableColumn(availableColumns, PLC_PART_ID_CANDIDATE_COLUMNS);
  if (partLookupColumn) {
    const byPart = await fetchLatestPlcReadingsByColumn(partLookupColumn, [normalizedPartId]);
    const partKey = normalizeKey(normalizedPartId);
    if (byPart.has(partKey)) return enrichPlcReadingDisplay(byPart.get(partKey));
  }

  if (availableColumns.has("shot_uid")) {
    const byUid = await fetchLatestPlcReadingsByColumn("shot_uid", [normalizedPartId]);
    const uidKey = normalizeKey(normalizedPartId);
    if (byUid.has(uidKey)) return enrichPlcReadingDisplay(byUid.get(uidKey));
  }

  const shotCandidates = deriveShotCandidates({ part_id: normalizedPartId });
  if (shotCandidates.length) {
    const shotLookupColumn = pickFirstAvailableColumn(availableColumns, PLC_SHOT_CANDIDATE_COLUMNS);
    const byShot = shotLookupColumn
      ? (String(shotLookupColumn).toLowerCase() === "shot_number"
        ? await fetchLatestPlcReadingsByShotTokens(shotCandidates)
        : await fetchLatestPlcReadingsByColumn(shotLookupColumn, shotCandidates))
      : new Map();
    for (const candidate of shotCandidates) {
      const key = normalizeShotToken(candidate) || normalizeKey(candidate);
      if (key && byShot.has(key)) return enrichPlcReadingDisplay(byShot.get(key));
    }
  }

  return null;
}

function isTransientDbError(error) {
  const msg = String(error?.message || error?.parent?.message || error?.original?.message || "").toUpperCase();
  const code = String(error?.code || error?.parent?.code || error?.original?.code || "").toUpperCase();
  return code === "ECONNRESET" || code === "ESOCKET" || code === "ETIMEOUT" || msg.includes("ECONNRESET") || msg.includes("COULD NOT CONNECT");
}

async function findAllWithRetry(queryFn, retries = 1, waitMs = 1200) {
  let lastErr;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await queryFn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === retries) break;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

async function runIndustrialExport(res, { filters, reportConfig, type = "full" }) {
  // 1. Resolve Data
  const rows = await fetchProductionData(filters);
  const machineWhere = {};
  if (filters?.machineId) machineWhere.id = filters.machineId;
  if (filters?.plantId) machineWhere.plant_id = filters.plantId;
  if (filters?.lineId) machineWhere.line_id = filters.lineId;
  else if (filters?.lineName) machineWhere.line_name = filters.lineName;
  const machines = await Machine.findAll({ where: machineWhere, raw: true });
  const stationPairs = (machines || [])
    .map((m) => {
      const machineName = String(m.machine_name || m.machineName || "").trim();
      const op = String(m.operation_no || m.operationNo || m.station_no || m.stationNo || "").trim();
      if (!machineName || !op) return null;
      return { key: `${machineName}__${op}`, machineName, op, label: `${machineName} + ${op}` };
    })
    .filter(Boolean)
    .sort((a, b) =>
      a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: "base" }) || a.machineName.localeCompare(b.machineName)
    );

  // 2. Calculate Metrics
  const metrics = calculateProductionMetrics(rows);

  // 3. Generate File
  await generateIndustrialExcel(res, {
    rows,
    stationPairs,
    metrics,
    filters,
    reportConfig,
    sheetName: type === "ng" ? "NG Report" : "Production Report",
    filePrefix: type === "ng" ? "NG_REPORT" : "FULL_REPORT"
  });
}

/**
 * Fetches and joins data for the report
 */
async function fetchProductionData(filters = {}, options = {}) {
  const includePlcReadings = options.includePlcReadings !== false;
  let plcColumns = new Set();
  const normalizeOptionalFilter = (value) => {
    const token = String(value || "").trim();
    const upper = token.toUpperCase();
    return ["", "ALL", "ANY", "ALL_SHIFTS", "ALL SHIFT", "ALL SHIFTS"].includes(upper) ? "" : token;
  };
  const {
    dateFrom, dateTo,
    machineId, plantId, lineId, lineName,
    shiftCode: rawShiftCode, modelCode,
    operationNo, resultType,
    barcode, customerCode, station, operatorId, status
  } = filters;
  const shiftCode = normalizeOptionalFilter(rawShiftCode);
  const filterPartName = normalizePartToken(filters.partName || filters.part_name);
  const filterDieName = normalizePartToken(filters.dieName || filters.die_name);
  const filterDieCastingMachine = String(filters.dieCastingMachine || filters.die_casting_machine || "").trim().toUpperCase();

  // Safe date defaults — always query last 24 hours if nothing specified
  const now = new Date();
  const from = dateFrom ? new Date(dateFrom) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to   = dateTo   ? new Date(dateTo)   : now;

  // Guard invalid dates
  const safeFrom = isNaN(from.getTime()) ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : from;
  const safeTo   = isNaN(to.getTime())   ? now : to;

  const buildWhere = async ({ includeDateRange = true } = {}) => {
    const nextWhere = {};
    if (includeDateRange) {
      nextWhere.createdAt = {
        [Op.gte]: safeFrom,
        [Op.lte]: safeTo
      };
    }
    if (machineId) nextWhere.machine_id = machineId;
    if (operationNo) nextWhere.operation_no = operationNo;
    if (operatorId) nextWhere.user_id = operatorId;
    if (barcode) {
      const searchValues = await resolveReportPartSearchValues(barcode);
      nextWhere.part_id = {
        [Op.or]: searchValues.map((value) => ({ [Op.like]: `%${value}%` })),
      };
    }
    if (station) {
      const stationToken = String(station).trim().toUpperCase();
      nextWhere[Op.or] = [
        { operation_no: stationToken },
        { station_no: stationToken },
      ];
    }
    if (plantId || lineId || lineName) {
      const machineWhere = {};
      if (plantId) machineWhere.plant_id = plantId;
      if (lineId) machineWhere.line_id = lineId;
      else if (lineName) machineWhere.line_name = lineName;
      const machines = await Machine.findAll({ where: machineWhere, attributes: ["id"] });
      const ids = machines.map((m) => Number(m.id)).filter((id) => Number.isFinite(id) && id > 0);
      if (machineId) {
        const selectedMachineId = Number(machineId);
        nextWhere.machine_id = ids.includes(selectedMachineId) ? selectedMachineId : { [Op.in]: [] };
      } else {
        nextWhere.machine_id = { [Op.in]: ids };
      }
    }
    return nextWhere;
  };

  const runLogQuery = async (where) => findAllWithRetry(() =>
    OperationLog.findAll({
      where,
      include: [
        {
          model: Machine,
          attributes: ["machine_name", "line_name", "operation_no"]
        }
      ],
      order: [["createdAt", "DESC"]],
      raw: true,
      nest: true
    }), 1, 1500
  );

  const baseWhere = await buildWhere({ includeDateRange: true });
  const logs = await runLogQuery(baseWhere);

  // Keep only production-relevant rows. Validation-noise attempts
  // (duplicate/sequence/format/config blocks) are excluded from reports.
  let productionLogs = logs.filter(isProductionReportLog);
  if (shiftCode) {
    const target = String(shiftCode).trim().toUpperCase();
    const shifts = await getActiveShiftDefinitions();
    const shift = findShiftDefinition(shifts, shiftCode);
    productionLogs = shift
      ? applyShiftFilter(productionLogs, shiftCode, shifts)
      : productionLogs.filter(
          (row) => String(row.shift_code || row.shiftCode || "").trim().toUpperCase() === target
        );
  }

  const fetchPartStatusFallbackRows = async () => {
    const hasStationScope = Boolean(machineId || operationNo || station || plantId || lineId || lineName);
    if (hasStationScope) return [];

    const partWhere = {
      updatedAt: {
        [Op.gte]: safeFrom,
        [Op.lte]: safeTo,
      },
    };
    const searchToken = String(barcode || customerCode || "").trim();
    if (searchToken) {
      const values = await resolveReportPartSearchValues(searchToken);
      partWhere.part_id = values.length
        ? { [Op.in]: values }
        : { [Op.like]: `%${searchToken}%` };
    }
    if (status) {
      const normalizedStatus = String(status || "").trim().toUpperCase();
      if (["OK", "PASSED", "COMPLETED"].includes(normalizedStatus)) {
        partWhere.status = { [Op.in]: ["OK", "PASSED", "COMPLETED"] };
      } else if (["NG", "FAILED", "REJECTED", "INTERLOCKED"].includes(normalizedStatus)) {
        partWhere.status = { [Op.in]: ["NG", "FAILED", "REJECTED", "INTERLOCKED"] };
      } else if (["IN_PROGRESS", "RUNNING", "PENDING"].includes(normalizedStatus)) {
        partWhere.status = { [Op.in]: ["IN_PROGRESS", "RUNNING", "PENDING"] };
      }
    }

    const parts = await Part.findAll({
      where: partWhere,
      attributes: ["part_id", "qr_format_name", "status", "createdAt", "updatedAt"],
      order: [["updatedAt", "DESC"]],
      raw: true,
      limit: 5000,
    });
    const scopedParts = shiftCode
      ? applyShiftFilter(parts, shiftCode, await getActiveShiftDefinitions())
      : parts;
    if (!scopedParts.length) return [];

    const partIds = scopedParts.map((part) => String(part.part_id || "").trim()).filter(Boolean);
    const mappings = partIds.length
      ? await PartCodeMapping.findAll({
          where: { old_part_id: { [Op.in]: partIds }, is_active: true },
          attributes: ["old_part_id", "customer_qr"],
          order: [["updatedAt", "DESC"]],
          raw: true,
        })
      : [];
    const customerQrByPartId = mappings.reduce((acc, row) => {
      const key = normalizeKey(row.old_part_id);
      if (key && !acc[key]) acc[key] = String(row.customer_qr || "").trim();
      return acc;
    }, {});

    return scopedParts.map((part, index) => {
      const partId = String(part.part_id || "").trim();
      const partStatus = String(part.status || "IN_PROGRESS").trim().toUpperCase();
      const mappedCustomerQr = customerQrByPartId[normalizeKey(partId)] || "-";
      return {
        srNo: index + 1,
        partId,
        part_id: partId,
        firstScanCreatedAt: part.createdAt || part.updatedAt || null,
        latestAnchorCreatedAt: part.updatedAt || part.createdAt || null,
        anchorMachineName: "-",
        anchorLineName: "-",
        anchorShiftCode: shiftCode || "UNASSIGNED",
        isAnchorMachineRow: true,
        customerCode: mappedCustomerQr,
        customerQrCode: mappedCustomerQr,
        machineName: "-",
        lineName: "-",
        operationNo: "-",
        stationNo: "-",
        qrFormatName: part.qr_format_name || "-",
        partStatus,
        modelCode: "-",
        shiftCode: shiftCode || "UNASSIGNED",
        cycleStartTime: part.createdAt ? new Date(part.createdAt).toLocaleString() : "-",
        cycleEndTime: part.updatedAt ? new Date(part.updatedAt).toLocaleString() : "-",
        cycleTime: "0.00",
        industrialResult: partStatus,
        category: "PRODUCTION",
        statusLabel: partStatus,
        bypassStatus: false,
        reason: "",
        plcReading: null,
        leakTestReading: null,
      };
    });
  };

  const anchorPartIds = [...new Set(
    productionLogs
      .map((log) => String(log.part_id || "").trim())
      .filter(Boolean)
  )];

  if (!anchorPartIds.length) {
    return fetchPartStatusFallbackRows();
  }

  const fullHistoryLogs = await runLogQuery({
    part_id: { [Op.in]: anchorPartIds }
  });
  const fullProductionHistoryLogs = fullHistoryLogs.filter(isProductionReportLog);

  const earliestScanByPart = new Map();
  const latestAnchorScanByPart = new Map();
  const latestAnchorLogByPart = new Map();
  fullProductionHistoryLogs.forEach((log) => {
    const partId = String(log.part_id || "").trim();
    if (!partId) return;
    const prev = earliestScanByPart.get(partId);
    if (!prev || new Date(log.createdAt).getTime() < new Date(prev).getTime()) {
      earliestScanByPart.set(partId, log.createdAt);
    }
  });
  productionLogs.forEach((log) => {
    const partId = String(log.part_id || "").trim();
    if (!partId) return;
    const prev = latestAnchorScanByPart.get(partId);
    if (!prev || new Date(log.createdAt).getTime() > new Date(prev).getTime()) {
      latestAnchorScanByPart.set(partId, log.createdAt);
      latestAnchorLogByPart.set(partId, log);
    }
  });

  // Fetch Part & QR Info (Flattening for performance)
  const partIds = anchorPartIds;
  const parts = await Part.findAll({
    where: { part_id: { [Op.in]: partIds } },
    attributes: ["part_id", "qr_format_name", "status"],
    raw: true
  });
  const partCodeMappings = await PartCodeMapping.findAll({
    where: {
      old_part_id: { [Op.in]: partIds },
      is_active: true,
    },
    attributes: ["old_part_id", "customer_qr"],
    order: [["updatedAt", "DESC"]],
    raw: true,
  });

  const partMap = parts.reduce((acc, p) => {
    acc[normalizeKey(p.part_id)] = p;
    return acc;
  }, {});
  const isCustomerQrOnlyPart = (partId) =>
    String(partMap[normalizeKey(partId)]?.qr_format_name || "").trim().toUpperCase() === CUSTOMER_QR_ONLY_FORMAT;
  const partCodeMap = partCodeMappings.reduce((acc, row) => {
    if (!row?.old_part_id) return acc;
    const key = normalizeKey(row.old_part_id);
    if (!acc[key]) acc[key] = String(row.customer_qr || "").trim();
    return acc;
  }, {});
  const leakLookupMachines = await MachineModel.findAll({
    where: {
      is_active: true,
      ...(plantId ? { plant_id: plantId } : {}),
      ...(lineId ? { line_id: lineId } : (lineName ? { line_name: lineName } : {})),
    },
    attributes: ["id", "machine_name", "operation_no", "plc_ip", "qr_scanner_ip", "machine_ip"],
    raw: true,
  });
  const leaktestIndex = (
    await buildLeaktestIndex({
      partIds,
      customerQrByPartId: partCodeMap,
      machines: leakLookupMachines,
    })
  ).byPartAndStation;

  const qrRules = await QrFormatRule.findAll({ attributes: ["format_name", "model_code"], raw: true });
  const qrMap = qrRules.reduce((acc, q) => {
    acc[q.format_name] = q.model_code;
    return acc;
  }, {});

  // Deduplicate: per (part_id + operation_no) keep only the best outcome log.
  // Priority: ENDED_OK > ENDED_NG > everything else.
  const bestByPartStation = new Map();
  for (const log of fullProductionHistoryLogs) {
    const key = `${log.part_id}||${log.operation_no || log.station_no}`;
    const existing = bestByPartStation.get(key);
    if (!existing) {
      bestByPartStation.set(key, log);
    } else {
      const existStatus = String(existing.plc_status || "").toUpperCase();
      const newStatus   = String(log.plc_status || "").toUpperCase();
      // Prefer ENDED_OK; then ENDED_NG; then most recent
      const rank = (s) => s === "ENDED_OK" ? 2 : s === "ENDED_NG" ? 1 : 0;
      if (rank(newStatus) > rank(existStatus)) {
        bestByPartStation.set(key, log);
      } else if (rank(newStatus) === rank(existStatus)) {
        // Same rank: keep the most recent
        if (new Date(log.createdAt) > new Date(existing.createdAt)) {
          bestByPartStation.set(key, log);
        }
      }
    }
  }
  const deduplicatedLogs = [...bestByPartStation.values()].sort((a, b) => {
    const partA = String(a.part_id || "").trim();
    const partB = String(b.part_id || "").trim();
    const anchorA = latestAnchorScanByPart.get(partA);
    const anchorB = latestAnchorScanByPart.get(partB);
    const anchorDiff = new Date(anchorB || 0).getTime() - new Date(anchorA || 0).getTime();
    if (anchorDiff !== 0) return anchorDiff;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  let plcByPartId = new Map();
  let plcByUid = new Map();
  let plcByCompactQr = new Map();
  let plcByShot = new Map();
  if (includePlcReadings) {
    // Attach PLC cycle readings from DB table (PlcCycleReadings):
    // 1) Prefer part-id style columns (if available in current schema)
    // 2) Fallback to shot_number style columns
    plcColumns = await getPlcReadingColumns();
    const partLookupColumn = pickFirstAvailableColumn(plcColumns, PLC_PART_ID_CANDIDATE_COLUMNS);
    const partIdsForPlcLookup = [...new Set(
      deduplicatedLogs
        .map((log) => String(log.part_id || "").trim())
        .filter(Boolean)
    )];
    plcByPartId = partLookupColumn
      ? await fetchLatestPlcReadingsByColumn(partLookupColumn, partIdsForPlcLookup)
      : new Map();
    plcByUid = plcColumns.has("shot_uid")
      ? await fetchLatestPlcReadingsByColumn("shot_uid", partIdsForPlcLookup)
      : new Map();
    plcByCompactQr = await fetchLatestPlcReadingsByCompactQr(partIdsForPlcLookup);
    plcByShot = plcColumns.has("shot_number")
      ? await fetchLatestPlcReadingsByShotTokens(
          deduplicatedLogs.flatMap((log) => deriveShotCandidates(log))
        )
      : new Map();
  }

  // Enrich & Standardize
  const enriched = await Promise.all(deduplicatedLogs.map(async (log, index) => {
    const normalizedPartIdKey = normalizeKey(log.part_id);
    const part = partMap[normalizedPartIdKey] || {};

    // Cycle times: scan time (createdAt of PENDING = QR scan) ? PLC end time
    const cycleStartTime = log.plc_start_at || log.createdAt || null;
    const cycleEndTime   = log.plc_end_at   || null;

    let cycleTime = log.cycle_time;
    if (!cycleTime && cycleStartTime && cycleEndTime) {
      const start = new Date(cycleStartTime);
      const end   = new Date(cycleEndTime);
      cycleTime = Math.max(0, (end.getTime() - start.getTime()) / 1000);
    }

    const partIdValue = String(log.part_id || "").trim();
    const mappedCustomerQr = String(partCodeMap[normalizeKey(partIdValue)] || "").trim();
    const recoveryCompletedByCustomerQr = shouldTreatRecoveryPendingAsPassed(log, mappedCustomerQr);
    const stationNo = String(log.operation_no || log.station_no || "").trim().toUpperCase();
    const leakTestReading = getLeaktestReadingForPartStation(leaktestIndex, partIdValue, LEAKTEST_OPERATION);
    const leakStageState = stationNo === LEAKTEST_OPERATION && leakTestReading
      ? getLeaktestStageState(leakTestReading)
      : null;
    const { status: industrialResultRaw, category: categoryRaw } = resolveIndustrialResult({
      result: log.result,
      plc_status: log.plc_status,
      interlock_reason: log.interlock_reason
    });
    const industrialResult = leakStageState === "PASSED"
      ? "OK"
      : leakStageState === "FAILED"
        ? "NG"
        : recoveryCompletedByCustomerQr
          ? "OK"
          : industrialResultRaw;
    const category = recoveryCompletedByCustomerQr ? "PRODUCTION" : categoryRaw;
    const structuredRejectionReason = [
      log.rejection_category ? `Category: ${log.rejection_category}` : "",
      log.rejection_view ? `View: ${log.rejection_view}` : "",
      log.rejection_zone ? `Zone: ${log.rejection_zone}` : "",
      log.rejection_reason ? `Reason: ${log.rejection_reason}` : "",
      log.rejection_remark ? `Remark: ${log.rejection_remark}` : "",
    ].filter(Boolean).join(" | ");
    const displayReason = (recoveryCompletedByCustomerQr || stationNo === LEAKTEST_OPERATION)
      ? ""
      : (structuredRejectionReason || log.interlock_reason || "");

    const partLookupKey = normalizeKey(partIdValue);
    const compactQrKey = parseCompactQrPartId(partIdValue)?.key || "";
    const customerQrOnlyPart = isCustomerQrOnlyPart(partIdValue);
    const displayPartId = customerQrOnlyPart ? "-" : (partIdValue || "-");
    const shotCandidates = deriveShotCandidates(log).map((s) => normalizeShotToken(s) || normalizeKey(s));
    const shouldLookupPlcReading = includePlcReadings && (!customerQrOnlyPart || compactQrKey || shotCandidates.length);
    const plcReadingFromDbRaw = shouldLookupPlcReading
      ? (
        (compactQrKey && plcByCompactQr.get(compactQrKey)) ||
        shotCandidates.map((shot) => plcByShot.get(normalizeShotToken(shot))).find(Boolean) ||
        plcByUid.get(partLookupKey) ||
        plcByPartId.get(partLookupKey) ||
        null
      )
      : null;
    const plcReadingFromDb = plcReadingFromDbRaw
      ? enrichPlcReadingDisplay(plcReadingFromDbRaw)
      : (
        shouldLookupPlcReading
          ? await fetchLatestPlcReadingByMachineShotContext({
              shotCandidates: deriveShotCandidates(log),
              machineName: log.Machine?.machine_name || "",
              logCreatedAt: log.createdAt,
            })
          : null
      );
    const plcPartDie = splitPlcPartDie(plcReadingFromDb?.part_name || "");

    return {
      ...log,
      srNo: index + 1,
      partId:      partIdValue || "-",
      displayPartId,
      isCustomerQrOnly: customerQrOnlyPart,
      firstScanCreatedAt: earliestScanByPart.get(partIdValue) || log.createdAt || null,
      latestAnchorCreatedAt: latestAnchorScanByPart.get(partIdValue) || log.createdAt || null,
      anchorMachineName: latestAnchorLogByPart.get(partIdValue)?.Machine?.machine_name || log.Machine?.machine_name || "-",
      anchorLineName: latestAnchorLogByPart.get(partIdValue)?.Machine?.line_name || log.Machine?.line_name || "-",
      anchorShiftCode: latestAnchorLogByPart.get(partIdValue)?.shift_code || log.shift_code || "A",
      isAnchorMachineRow: Number(latestAnchorLogByPart.get(partIdValue)?.machine_id || 0) === Number(log.machine_id || 0),
      customerCode: mappedCustomerQr || "-",
      customerQrCode: mappedCustomerQr || "-",
      machineName: log.Machine?.machine_name || "-",
      lineName:    log.Machine?.line_name    || "-",
      operationNo: log.operation_no || log.Machine?.operation_no || "-",
      stationNo: log.station_no || log.operation_no || "-",
      qrFormatName: part.qr_format_name || "-",
      partStatus: part.status || "",
      modelCode:    qrMap[part.qr_format_name] || "-",
      partName: plcPartDie.partName || "",
      dieName: plcPartDie.dieName || "",
      partDieLabel: plcPartDie.label || "",
      shiftCode:    log.shift_code || "A",
      cycleStartTime: cycleStartTime ? new Date(cycleStartTime).toLocaleString() : "-",
      cycleEndTime:   (leakTestReading?.cycleEndTime || cycleEndTime) ? new Date(leakTestReading?.cycleEndTime || cycleEndTime).toLocaleString()   : "-",
      cycleTime:    stationNo === LEAKTEST_OPERATION && leakTestReading?.cycleTime != null ? String(leakTestReading.cycleTime) : (cycleTime ? Number(cycleTime).toFixed(2) : "0.00"),
      industrialResult,
      category,
      statusLabel: industrialResult,
      bypassStatus: Boolean(log.is_bypassed),
      reason: displayReason,
      rejectionCategory: log.rejection_category || "",
      rejectionView: log.rejection_view || "",
      rejectionZone: log.rejection_zone || "",
      rejectionReason: log.rejection_reason || "",
      rejectionRemark: log.rejection_remark || "",
      plcReading: plcReadingFromDb,
      leakTestReading,
    };
  }));

  let filtered = enriched;

  if (filterPartName || filterDieName) {
    filtered = filtered.filter((row) => {
      const parsed = splitPlcPartDie(row.partDieLabel || row.plcReading?.part_name || row.partName || "");
      const partOk = !filterPartName || parsed.partName === filterPartName || normalizePartToken(row.partName) === filterPartName;
      const dieOk = !filterDieName || parsed.dieName === filterDieName || normalizePartToken(row.dieName) === filterDieName;
      return partOk && dieOk;
    });
  }
  if (filterDieCastingMachine) {
    filtered = filtered.filter((row) => String(row.plcReading?.machine_name || "").trim().toUpperCase() === filterDieCastingMachine);
  }

  if (customerCode) {
    const cc = String(customerCode).trim().toUpperCase();
    filtered = filtered.filter((row) => String(row.customerCode || "").toUpperCase().includes(cc));
  }

  const normalizedStatus = String(status || resultType || "").trim().toUpperCase();
  if (normalizedStatus) {
    if (normalizedStatus === "VALIDATION") {
      filtered = filtered.filter((row) => row.category === "VALIDATION");
    } else if (normalizedStatus === "BYPASS") {
      filtered = filtered.filter((row) => row.bypassStatus === true);
    } else if (normalizedStatus === "PENDING") {
      filtered = filtered.filter((row) => String(row.statusLabel || "").toUpperCase() === "UNKNOWN");
    } else {
      filtered = filtered.filter((row) => String(row.industrialResult || "").toUpperCase() === normalizedStatus);
    }
  }

  return filtered;
}

module.exports = {
  runIndustrialExport,
  fetchProductionData,
  getPlcReadingColumns,
  fetchPlcShotSummary,
};
