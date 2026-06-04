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
const { calculateProductionMetrics } = require("./reportMetricsService");
const { generateIndustrialExcel } = require("./excelTemplateEngine");
const { resolveIndustrialResult } = require("./reportFormatter");
const PLC_READING_TABLE = "PlcCycleReadings";

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
  "machine_name", "shot_date", "shot_time", "shot_number", "cycle_time",
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

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
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
  const fromPartRaw = String(log.part_id || "").trim();
  const digitGroups = fromPartRaw.match(/\d+/g) || [];
  const candidates = [direct, fromPartPattern, fromPartRaw, ...digitGroups]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  return [...new Set(candidates)];
}

function getMinutesForDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function toShiftMinutes(timeValue) {
  if (!timeValue) return null;
  const parts = String(timeValue).split(":").map((p) => Number(p));
  if (parts.length < 2 || parts.some((p) => Number.isNaN(p))) return null;
  return parts[0] * 60 + parts[1];
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
    order: [["start_time", "ASC"]],
    raw: true,
  });
}

function applyShiftFilter(rows, shiftCode, shifts) {
  if (!shiftCode) return rows;
  const target = String(shiftCode).trim().toUpperCase();
  return rows.filter((row) => {
    const shift = shifts.find((s) => String(s.shift_code || "").trim().toUpperCase() === target);
    return shift && isDateInShift(row.createdAt, shift);
  });
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
  if (filters?.lineName) machineWhere.line_name = filters.lineName;
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
  const {
    dateFrom, dateTo,
    machineId, lineName,
    shiftCode, modelCode,
    operationNo, resultType,
    barcode, customerCode, station, operatorId, status
  } = filters;

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
      nextWhere.part_id = { [Op.like]: `%${String(barcode).trim()}%` };
    }
    if (station) {
      const stationToken = String(station).trim().toUpperCase();
      nextWhere[Op.or] = [
        { operation_no: stationToken },
        { station_no: stationToken },
      ];
    }
    if (lineName) {
      const machines = await Machine.findAll({ where: { line_name: lineName }, attributes: ["id"] });
      const ids = machines.map((m) => m.id);
      nextWhere.machine_id = { [Op.in]: ids };
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
    const byCode = productionLogs.filter(
      (row) => String(row.shift_code || "").trim().toUpperCase() === target
    );
    const byTime = applyShiftFilter(productionLogs, shiftCode, shifts);
    const merged = new Map();
    [...byCode, ...byTime].forEach((row) => {
      const key = `${row.id || ""}|${row.part_id || ""}|${row.operation_no || row.station_no || ""}|${row.createdAt || ""}`;
      if (!merged.has(key)) merged.set(key, row);
    });
    productionLogs = [...merged.values()];
  }

  // Fetch Part & QR Info (Flattening for performance)
  const partIds = [...new Set(productionLogs.map(l => l.part_id))];
  const parts = await Part.findAll({
    where: { part_id: { [Op.in]: partIds } },
    attributes: ["part_id", "qr_format_name"],
    raw: true
  });
  const partCodeMappings = await PartCodeMapping.findAll({
    where: {
      old_part_id: { [Op.in]: partIds },
      is_active: true,
    },
    attributes: ["old_part_id", "customer_qr"],
    raw: true,
  });

  const partMap = parts.reduce((acc, p) => {
    acc[normalizeKey(p.part_id)] = p;
    return acc;
  }, {});
  const partCodeMap = partCodeMappings.reduce((acc, row) => {
    if (!row?.old_part_id) return acc;
    acc[normalizeKey(row.old_part_id)] = String(row.customer_qr || "").trim();
    return acc;
  }, {});

  const qrRules = await QrFormatRule.findAll({ attributes: ["format_name", "model_code"], raw: true });
  const qrMap = qrRules.reduce((acc, q) => {
    acc[q.format_name] = q.model_code;
    return acc;
  }, {});

  // Deduplicate: per (part_id + operation_no) keep only the best outcome log.
  // Priority: ENDED_OK > ENDED_NG > everything else.
  const bestByPartStation = new Map();
  for (const log of productionLogs) {
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
  const deduplicatedLogs = [...bestByPartStation.values()];

  let plcByPartId = new Map();
  let plcByUid = new Map();
  let plcByCompactQr = new Map();
  let plcByShot = new Map();
  if (includePlcReadings) {
    // Attach PLC cycle readings from DB table (PlcCycleReadings):
    // 1) Prefer part-id style columns (if available in current schema)
    // 2) Fallback to shot_number style columns
    const plcColumns = await getPlcReadingColumns();
    const partLookupColumn = pickFirstAvailableColumn(plcColumns, PLC_PART_ID_CANDIDATE_COLUMNS);
    const shotLookupColumn = pickFirstAvailableColumn(plcColumns, PLC_SHOT_CANDIDATE_COLUMNS);
    const partIdsForPlcLookup = [...new Set(
      deduplicatedLogs
        .map((log) => String(log.part_id || "").trim())
        .filter(Boolean)
    )];
    const shotNumbers = [...new Set(
      deduplicatedLogs
        .flatMap((log) => deriveShotCandidates(log))
        .filter(Boolean)
    )];
    plcByPartId = partLookupColumn
      ? await fetchLatestPlcReadingsByColumn(partLookupColumn, partIdsForPlcLookup)
      : new Map();
    plcByUid = plcColumns.has("shot_uid")
      ? await fetchLatestPlcReadingsByColumn("shot_uid", partIdsForPlcLookup)
      : new Map();
    plcByCompactQr = await fetchLatestPlcReadingsByCompactQr(partIdsForPlcLookup);
    plcByShot = shotLookupColumn
      ? (String(shotLookupColumn).toLowerCase() === "shot_number"
        ? await fetchLatestPlcReadingsByShotTokens(shotNumbers)
        : await fetchLatestPlcReadingsByColumn(shotLookupColumn, shotNumbers))
      : new Map();
  }

  // Enrich & Standardize
  const enriched = deduplicatedLogs.map((log, index) => {
    const normalizedPartIdKey = normalizeKey(log.part_id);
    const part = partMap[normalizedPartIdKey] || {};
    const { status: industrialResult, category } = resolveIndustrialResult({
      result: log.result,
      plc_status: log.plc_status,
      interlock_reason: log.interlock_reason
    });

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

    const partLookupKey = normalizeKey(partIdValue);
    const compactQrKey = parseCompactQrPartId(partIdValue)?.key || "";
    const shotCandidates = deriveShotCandidates(log).map((s) => normalizeShotToken(s) || normalizeKey(s));
    const plcReadingFromDbRaw = includePlcReadings
      ? (
        (compactQrKey && plcByCompactQr.get(compactQrKey)) ||
        plcByUid.get(partLookupKey) ||
        plcByPartId.get(partLookupKey) ||
        shotCandidates.map((k) => plcByShot.get(k)).find(Boolean) ||
        null
      )
      : null;
    const plcReadingFromDb = enrichPlcReadingDisplay(plcReadingFromDbRaw);

    return {
      ...log,
      srNo: index + 1,
      partId:      partIdValue || "-",
      customerCode: mappedCustomerQr || "-",
      customerQrCode: mappedCustomerQr || "-",
      machineName: log.Machine?.machine_name || "-",
      lineName:    log.Machine?.line_name    || "-",
      operationNo: log.operation_no || log.Machine?.operation_no || "-",
      stationNo: log.station_no || log.operation_no || "-",
      qrFormatName: part.qr_format_name || "-",
      modelCode:    qrMap[part.qr_format_name] || "-",
      shiftCode:    log.shift_code || "A",
      cycleStartTime: cycleStartTime ? new Date(cycleStartTime).toLocaleString() : "-",
      cycleEndTime:   cycleEndTime   ? new Date(cycleEndTime).toLocaleString()   : "-",
      cycleTime:    cycleTime ? Number(cycleTime).toFixed(2) : "0.00",
      industrialResult,
      category,
      statusLabel: industrialResult,
      bypassStatus: Boolean(log.is_bypassed),
      reason: log.interlock_reason || "-",
      plcReading: plcReadingFromDb
    };
  });

  let filtered = enriched;

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
  fetchProductionData
};
