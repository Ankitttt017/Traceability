const { Op } = require("sequelize");
const FinalProductionResult = require("../../models/FinalProductionResult");
const Machine = require("../../models/Machine");
const OperationLog = require("../../models/OperationLog");
const PartCodeMapping = require("../../models/PartCodeMapping");

const MATERIALIZER_LOOKBACK_DAYS = Math.max(Number(process.env.REPORT_MATERIALIZER_LOOKBACK_DAYS || 90), 1);
const MATERIALIZER_BATCH_SIZE = Math.max(Number(process.env.REPORT_MATERIALIZER_BATCH_SIZE || 50), 1);
const MATERIALIZER_DEBOUNCE_MS = Math.max(Number(process.env.REPORT_MATERIALIZER_DEBOUNCE_MS || 0), 0);

const pendingPartIds = new Map();
const retryPartIds = new Map();
let materializerTimer = null;
let materializerRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSqlDeadlockError(error) {
  const message = String(error?.message || error?.parent?.message || error?.original?.message || "").toLowerCase();
  const code = String(error?.code || error?.parent?.code || error?.original?.code || "");
  const number = Number(error?.number || error?.parent?.number || error?.original?.number || 0);
  return (
    number === 1205 ||
    code === "EREQUEST" && message.includes("deadlock") ||
    message.includes("deadlock victim") ||
    message.includes("was deadlocked on lock resources")
  );
}

async function withDeadlockRetry(label, task, options = {}) {
  const attempts = Math.max(Number(options.attempts || process.env.DB_DEADLOCK_RETRY_ATTEMPTS || 4), 1);
  const baseDelayMs = Math.max(Number(options.baseDelayMs || process.env.DB_DEADLOCK_RETRY_BASE_MS || 120), 25);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isSqlDeadlockError(error) || attempt >= attempts) throw error;
      const delay = baseDelayMs * attempt + Math.floor(Math.random() * baseDelayMs);
      console.warn(`[FinalProductionResult] ${label} deadlocked; retry ${attempt}/${attempts - 1} in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function isAllShiftToken(value) {
  return ["ALL", "ANY", "ALL_SHIFT", "ALL_SHIFTS", "ALL SHIFT", "ALL SHIFTS"].includes(normalizeUpper(value));
}

function normalizeShiftAlias(value) {
  const token = normalizeUpper(value).replace(/\s+/g, "_");
  if (!token || isAllShiftToken(token)) return "";
  if (token === "A" || token === "SHIFT_A" || token === "SHIFT_A_SHIFT") return "SHIFT_A";
  if (token === "B" || token === "SHIFT_B" || token === "SHIFT_B_SHIFT") return "SHIFT_B";
  if (token === "C" || token === "SHIFT_C" || token === "SHIFT_C_SHIFT") return "SHIFT_C";
  if (token === "S1" || token === "SHIFT_S1") return "SHIFT_A";
  if (token === "S2" || token === "SHIFT_S2") return "SHIFT_B";
  if (token === "S3" || token === "SHIFT_S3") return "SHIFT_C";
  return token;
}

function getShiftAliasVariants(value) {
  const canonical = normalizeShiftAlias(value);
  if (!canonical) return [];
  if (canonical === "SHIFT_A") return ["SHIFT_A", "A", "S1", "SHIFT_S1", "Shift A"];
  if (canonical === "SHIFT_B") return ["SHIFT_B", "B", "S2", "SHIFT_S2", "Shift B"];
  if (canonical === "SHIFT_C") return ["SHIFT_C", "C", "S3", "SHIFT_S3", "Shift C"];
  return [canonical, normalizeText(value)].filter(Boolean);
}

function shiftMatchesFilter(rowShift, filterShift) {
  const filterCanonical = normalizeShiftAlias(filterShift);
  if (!filterCanonical) return true;
  return normalizeShiftAlias(rowShift) === filterCanonical;
}

function hasStationScope(filters = {}) {
  return Boolean(filters.machineId || filters.operationNo || filters.station);
}

function getRowShiftCode(row = {}) {
  return row.firstScanShiftCode || row.first_scan_shift_code || row.shiftCode || row.shift_code || row.anchorShiftCode || row.anchor_shift_code || "";
}

function getRowActivityTimestamp(row = {}) {
  return row.createdAt || row.created_at || row.latestAnchorCreatedAt || row.updatedAt || getRowResultTimestamp(row) || getRowFirstScanTimestamp(row);
}

const INVALID_CUSTOMER_QR_VALUES = new Set([
  "-",
  "CUSTOMER QR PENDING",
  "PENDING",
  "IN_PROGRESS",
  "WAITING",
  "UNKNOWN",
  "NULL",
  "UNDEFINED",
]);

function sanitizeCustomerQrValue(value) {
  const raw = normalizeText(value);
  if (!raw || INVALID_CUSTOMER_QR_VALUES.has(raw.toUpperCase())) return "";
  return raw;
}

function normalizeKey(value) {
  return normalizeUpper(value).replace(/[^A-Z0-9]/g, "");
}

function isSameCode(a, b) {
  const left = normalizeKey(a);
  const right = normalizeKey(b);
  return Boolean(left && right && left === right);
}

function compactDistinctCode(value, excludedValues = []) {
  const raw = normalizeText(value);
  if (!raw) return "";
  return excludedValues.some((excluded) => isSameCode(raw, excluded)) ? "" : raw;
}

function safeJson(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return fallback;
  }
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function toDate(value) {
  if (!value || value === "-") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateOnly(value) {
  const date = toDate(value);
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function toTime(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

function getReportGroupKey(row = {}, fallback = "") {
  return normalizeText(
    row.reportGroupKey ||
    row.report_group_key ||
    row.traceabilityPartId ||
    row.traceability_part_id ||
    row.displayPartId ||
    row.display_part_id ||
    row.partId ||
    row.part_id ||
    row.barcode ||
    row.shot_uid ||
    fallback
  );
}

function getStationOperation(row = {}) {
  return normalizeUpper(row.operationNo || row.stationNo || row.operation_no || row.station_no);
}

function getRowResultTimestamp(row = {}) {
  return (
    row.finalResultCreatedAt ||
    row.finalResultAt ||
    row.cycleEndAt ||
    row.plc_end_at ||
    row.plcEndAt ||
    row.createdAt ||
    row.updatedAt ||
    null
  );
}

function getRowFirstScanTimestamp(row = {}) {
  return (
    row.firstScanCreatedAt ||
    row.first_scan_created_at ||
    row.createdAt ||
    row.created_at ||
    row.latestAnchorCreatedAt ||
    row.updatedAt ||
    null
  );
}

function normalizeStationResult(value, reason = "", row = {}) {
  const status = normalizeUpper(value);
  const normalizedReason = normalizeUpper(reason);
  const bypassStatus = Boolean(row.bypassStatus || row.is_bypassed || row.isBypassed);
  const bypassReason = normalizeUpper(row.bypassReason || row.bypass_reason);

  if (bypassStatus || ["MACHINE_BYPASS_AUTO_OK", "STATION_BYPASS_AUTO_OK", "STATION_OPERATION_DISABLED_AUTO_OK"].includes(bypassReason)) {
    return "OK";
  }
  if (normalizedReason === "NG_SHOT_STATUS" && ["BLOCK", "INTERLOCKED"].includes(status)) return "NG";
  if (["OK", "PASS", "PASSED", "COMPLETED", "ENDED_OK", "COMPLETED_OK"].includes(status)) return "OK";
  if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG", "INTERLOCKED", "REJECTED"].includes(status)) return "NG";
  if (!status || status === "-" || status === "UNKNOWN") return "";
  return "IN_PROGRESS";
}

function pickStationResult(current, candidate) {
  const rank = (value) => {
    if (value === "NG") return 3;
    if (value === "OK") return 2;
    if (value === "IN_PROGRESS") return 1;
    return 0;
  };
  return rank(candidate) > rank(current) ? candidate : (current || candidate || "");
}

function isFinalInspectionOperation(row = {}) {
  const op = getStationOperation(row);
  const machine = normalizeUpper(row.machineName || row.machine_name || row?.Machine?.machine_name);
  return op === "OP160" || machine.includes("FINAL INSPECTION") || machine.includes("FINAL_INSPECTION");
}

function normalizeFinalPartStatus(value) {
  const status = normalizeUpper(value);
  if (["OK", "PASSED", "PASS", "COMPLETED", "COMPLETED_OK", "ENDED_OK"].includes(status)) return "PASSED";
  if (["NG", "FAILED", "FAIL", "REJECTED", "INTERLOCKED", "COMPLETED_NG", "ENDED_NG"].includes(status)) return "NG";
  return "IN_PROGRESS";
}

function deriveGroupSummary(rows = []) {
  const stationResults = {};
  const operationResultTimes = {};
  let firstScanAt = null;
  let firstScanRow = rows[0] || {};
  let latestRow = rows[0] || {};
  let latestAt = 0;
  let firstNgAt = null;
  let ngRow = null;
  let finalInspectionOkAt = null;

  for (const row of rows) {
    const operation = getStationOperation(row);
    const status = normalizeStationResult(row.industrialResult || row.statusLabel || row.result || row.plc_status, row.reason || row.interlock_reason, row);
    if (operation && status) {
      stationResults[operation] = pickStationResult(stationResults[operation], status);
      const resultAt = getRowResultTimestamp(row);
      if (resultAt && (!operationResultTimes[operation] || toTime(resultAt) >= toTime(operationResultTimes[operation]))) {
        operationResultTimes[operation] = resultAt;
      }
    }

    const scanAt = getRowFirstScanTimestamp(row);
    if (scanAt && (!firstScanAt || toTime(scanAt) < toTime(firstScanAt))) {
      firstScanAt = scanAt;
      firstScanRow = row;
    }

    if (status === "NG") {
      const resultAt = getRowResultTimestamp(row);
      if (resultAt && (!firstNgAt || toTime(resultAt) < toTime(firstNgAt))) {
        firstNgAt = resultAt;
        ngRow = row;
      }
    }

    if (status === "OK" && isFinalInspectionOperation(row)) {
      const resultAt = getRowResultTimestamp(row);
      if (resultAt && (!finalInspectionOkAt || toTime(resultAt) >= toTime(finalInspectionOkAt))) {
        finalInspectionOkAt = resultAt;
      }
    }

    const rowAt = toTime(row.latestAnchorCreatedAt || row.createdAt || row.updatedAt);
    if (rowAt >= latestAt) {
      latestAt = rowAt;
      latestRow = row;
    }
  }

  const operations = Object.keys(stationResults).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const values = operations.map((operation) => stationResults[operation]).filter(Boolean);
  const finalStatus = (() => {
    if (values.includes("NG")) return "NG";
    if (finalInspectionOkAt) return "PASSED";
    if (values.includes("IN_PROGRESS")) return "IN_PROGRESS";
    const partStatus = normalizeFinalPartStatus(latestRow.partStatus || latestRow.part_status || latestRow.status);
    if (partStatus === "NG") return "NG";
    if (partStatus === "PASSED") return "PASSED";
    return "IN_PROGRESS";
  })();
  const terminalOperation = operations[operations.length - 1];
  const finalResultAt = finalStatus === "NG"
    ? firstNgAt
    : finalStatus === "PASSED"
      ? (finalInspectionOkAt || operationResultTimes[terminalOperation] || getRowResultTimestamp(latestRow))
      : null;
  const lastActivityAt = rows.reduce((latest, row) => {
    const candidates = [
      row.latestAnchorCreatedAt,
      row.createdAt,
      row.updatedAt,
      getRowResultTimestamp(row),
    ].map(toTime).filter(Boolean);
    const rowLatest = candidates.length ? Math.max(...candidates) : 0;
    return Math.max(latest, rowLatest);
  }, 0);
  const plcReading = rows.map((row) => row.plcReading || row.plc_reading).find((value) => value && Object.keys(value).length);
  const leakReadings = rows.flatMap((row) => Array.isArray(row.leakTestReadings) ? row.leakTestReadings : (row.leakTestReading ? [row.leakTestReading] : []));
  const rejectionRow = rows.find((row) => row.rejectionReason || row.rejection_reason || row.rejectionCategory || row.rejection_category || row.reason) || ngRow || {};

  return {
    firstScanAt,
    firstScanRow,
    latestRow,
    finalResultAt,
    lastActivityAt: lastActivityAt ? new Date(lastActivityAt) : null,
    finalStatus,
    stationResults,
    plcReading,
    leakReadings,
    rejectionRow,
    ngRow,
  };
}

function getCustomerQrFromRows(rows = [], excludedValues = []) {
  for (const row of rows) {
    const customerQr = sanitizeCustomerQrValue(row.customerQrCode || row.customerCode || row.customer_qr_code || row.customer_qr);
    const distinctCustomerQr = compactDistinctCode(customerQr, excludedValues);
    if (distinctCustomerQr) return distinctCustomerQr;
  }
  return "";
}

async function lookupPartCodeMapping(candidates = []) {
  const values = [...new Set(candidates.map((value) => normalizeText(value)).filter(Boolean))];
  if (!values.length) return null;
  const mapping = await PartCodeMapping.findOne({
    where: {
      [Op.or]: [
        { old_part_id: { [Op.in]: values } },
        { customer_qr: { [Op.in]: values } },
      ],
    },
    raw: true,
  }).catch(() => null);
  return mapping || null;
}

async function buildMaterializedRecord(groupKey, rows = []) {
  const summary = deriveGroupSummary(rows);
  const firstRow = summary.firstScanRow || rows[0] || {};
  const latestRow = summary.latestRow || rows[0] || {};
  const plc = summary.plcReading || {};
  const rejection = summary.rejectionRow || {};
  const rawPartSerial = normalizeText(latestRow.displayPartId || latestRow.partId || latestRow.part_id || firstRow.displayPartId || firstRow.partId || firstRow.part_id);
  const candidateCodes = [
    rawPartSerial,
    latestRow.traceabilityPartId,
    latestRow.traceability_part_id,
    latestRow.partId,
    latestRow.part_id,
    firstRow.traceabilityPartId,
    firstRow.traceability_part_id,
    firstRow.partId,
    firstRow.part_id,
    groupKey,
  ];
  const mapping = await lookupPartCodeMapping(candidateCodes);
  const mappedOldPart = normalizeText(mapping?.old_part_id);
  const mappedCustomerQr = sanitizeCustomerQrValue(mapping?.customer_qr);
  const partSerial = mappedOldPart || rawPartSerial;
  const identityValues = [
    partSerial,
    rawPartSerial,
    latestRow.traceabilityPartId,
    latestRow.traceability_part_id,
    latestRow.partId,
    latestRow.part_id,
    firstRow.traceabilityPartId,
    firstRow.traceability_part_id,
    firstRow.partId,
    firstRow.part_id,
    groupKey,
  ];
  const customerQr = compactDistinctCode(mappedCustomerQr, identityValues) || getCustomerQrFromRows(rows, identityValues);
  const rawTraceabilityPartId = normalizeText(latestRow.traceabilityPartId || latestRow.traceability_part_id || partSerial || groupKey);
  const traceabilityPartId = compactDistinctCode(rawTraceabilityPartId, [partSerial, groupKey]);
  const rowsWithCustomerQr = customerQr
    ? rows.map((row) => ({
      ...row,
      customerCode: customerQr,
      customerQrCode: customerQr,
      customer_qr_code: customerQr,
      customerQrPending: false,
      customer_qr_pending: false,
    }))
    : rows;
  const shotNumber = normalizeText(plc.shot_number || latestRow.shotNumber || latestRow.shot_number || firstRow.shotNumber || firstRow.shot_number);
  const stationResults = summary.stationResults || {};
  const rejectionJson = {
    category: rejection.rejectionCategory || rejection.rejection_category || "",
    view: rejection.rejectionView || rejection.rejection_view || "",
    zone: rejection.rejectionZone || rejection.rejection_zone || "",
    subZone: rejection.rejectionSubZone || rejection.rejection_sub_zone || "",
    reason: rejection.rejectionReason || rejection.rejection_reason || "",
    remark: rejection.rejectionRemark || rejection.rejection_remark || "",
    text: rejection.reason || rejection.interlock_reason || "",
  };

  return {
    report_group_key: groupKey,
    traceability_part_id: traceabilityPartId || null,
    part_serial_no: partSerial || null,
    customer_qr_code: customerQr || null,
    shot_number: shotNumber && shotNumber !== "-" ? shotNumber : null,
    first_scan_at: toDate(summary.firstScanAt),
    final_result_at: toDate(summary.finalResultAt),
    last_activity_at: summary.lastActivityAt,
    production_date: toDateOnly(summary.firstScanAt),
    shift_code: normalizeShiftAlias(firstRow.firstScanShiftCode || firstRow.shiftCode || firstRow.anchorShiftCode || latestRow.shiftCode || latestRow.anchorShiftCode) || null,
    final_status: summary.finalStatus || "IN_PROGRESS",
    part_status: normalizeText(latestRow.partStatus || latestRow.part_status || latestRow.status) || null,
    plant_id: Number(latestRow.plant_id || firstRow.plant_id) || null,
    line_id: Number(latestRow.line_id || firstRow.line_id) || null,
    line_name: normalizeText(firstRow.anchorLineName || firstRow.lineName || latestRow.anchorLineName || latestRow.lineName) || null,
    anchor_machine_id: Number(latestRow.machine_id || firstRow.machine_id) || null,
    anchor_machine_name: normalizeText(firstRow.anchorMachineName || latestRow.anchorMachineName || latestRow.machineName || firstRow.machineName) || null,
    die_casting_machine_name: normalizeText(plc.machine_name || latestRow.dieCastingMachine || latestRow.die_casting_machine) || null,
    part_name: normalizeText(latestRow.partName || latestRow.part_name || firstRow.partName || firstRow.part_name || plc.part_name) || null,
    die_name: normalizeText(latestRow.dieName || latestRow.die_name || firstRow.dieName || firstRow.die_name) || null,
    ng_station: normalizeText(getStationOperation(summary.ngRow || {})) || null,
    ng_reason: normalizeText(rejectionJson.reason || rejectionJson.text) || null,
    rejection_category: normalizeText(rejectionJson.category) || null,
    rejection_view: normalizeText(rejectionJson.view) || null,
    rejection_zone: normalizeText(rejectionJson.zone) || null,
    rejection_sub_zone: normalizeText(rejectionJson.subZone) || null,
    rejection_reason: normalizeText(rejectionJson.reason) || null,
    op100_status: stationResults.OP100 || null,
    op110_status: stationResults.OP110 || null,
    op120_status: stationResults.OP120 || null,
    op130_status: stationResults.OP130 || null,
    op140_status: stationResults.OP140 || null,
    op150_status: stationResults.OP150 || null,
    op160_status: stationResults.OP160 || null,
    station_results_json: safeJson(stationResults, "{}"),
    leak_test_json: safeJson(summary.leakReadings, "[]"),
    shot_details_json: safeJson(plc, "{}"),
    plc_shot_json: safeJson(plc, "{}"),
    rejection_json: safeJson(rejectionJson, "{}"),
    report_rows_json: safeJson(rowsWithCustomerQr, "[]"),
  };
}

async function upsertMaterializedReportRows(rows = []) {
  const grouped = new Map();
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const key = getReportGroupKey(row, `row_${index}`);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  let upserted = 0;
  for (const [groupKey, groupRows] of grouped.entries()) {
    const record = await buildMaterializedRecord(groupKey, groupRows);
    await withDeadlockRetry(`upsert ${groupKey}`, () => FinalProductionResult.upsert(record));
    upserted += 1;
  }
  return { upserted };
}

function normalizeStatusFilter(value) {
  const token = normalizeUpper(value);
  if (!token || ["ALL", "ANY", "ALL STATUS", "ALL_STATUS"].includes(token)) return "";
  if (["OK", "PASSED", "PASS"].includes(token)) return "PASSED";
  if (["NG", "FAILED", "FAIL"].includes(token)) return "NG";
  if (["IN PROGRESS", "IN_PROGRESS", "RUNNING", "PENDING"].includes(token)) return "IN_PROGRESS";
  return token;
}

function hasStationNgColumns(record = {}) {
  return ["op100_status", "op110_status", "op120_status", "op130_status", "op140_status", "op150_status", "op160_status"]
    .some((key) => normalizeStatusFilter(record[key]) === "NG");
}

function getRecordEffectiveStatus(record = {}) {
  const status = normalizeStatusFilter(record.final_status);
  if (status === "PASSED" || status === "NG") return status;
  return "IN_PROGRESS";
}

function getStationNgWhere() {
  return {
    [Op.or]: [
      { op100_status: "NG" },
      { op110_status: "NG" },
      { op120_status: "NG" },
      { op130_status: "NG" },
      { op140_status: "NG" },
      { op150_status: "NG" },
      { op160_status: "NG" },
      { rejection_reason: { [Op.ne]: null } },
      { rejection_category: { [Op.ne]: null } },
      { final_status: "NG" },
    ],
  };
}

function getPassedWhere() {
  const notNg = (field) => ({
    [Op.or]: [
      { [field]: null },
      { [field]: "" },
      { [field]: { [Op.ne]: "NG" } },
    ],
  });
  return {
    [Op.and]: [
      { final_status: { [Op.in]: ["PASSED", "OK"] } },
      notNg("op100_status"),
      notNg("op110_status"),
      notNg("op120_status"),
      notNg("op130_status"),
      notNg("op140_status"),
      notNg("op150_status"),
      notNg("op160_status"),
      { rejection_reason: null },
      { rejection_category: null },
    ],
  };
}

function getFinalStatusWhere(status) {
  const normalized = normalizeStatusFilter(status);
  if (normalized === "PASSED") return { final_status: { [Op.in]: ["PASSED", "OK"] } };
  if (normalized === "NG") return { final_status: "NG" };
  if (normalized === "IN_PROGRESS") {
    return {
      [Op.or]: [
        { final_status: "IN_PROGRESS" },
        { final_status: "" },
        { final_status: null },
      ],
    };
  }
  return {};
}

function getMaterializedDateRange(filters = {}) {
  const now = new Date();
  const from = filters.dateFrom ? toDate(filters.dateFrom) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = filters.dateTo ? toDate(filters.dateTo) : now;
  return { from, to };
}

function buildMaterializedWhere(filters = {}) {
  const { from, to } = getMaterializedDateRange(filters);
  const activityRange = [
      { first_scan_at: { [Op.gte]: from, [Op.lte]: to } },
      { final_result_at: { [Op.gte]: from, [Op.lte]: to } },
      { last_activity_at: { [Op.gte]: from, [Op.lte]: to } },
  ];
  const status = normalizeStatusFilter(filters.status || filters.resultType);
  const where = {};
  if (status === "PASSED") {
    where[Op.and] = [
      getFinalStatusWhere("PASSED"),
      { final_result_at: { [Op.gte]: from, [Op.lte]: to } },
    ];
  } else if (status === "NG") {
    where[Op.and] = [
      getFinalStatusWhere("NG"),
      { final_result_at: { [Op.gte]: from, [Op.lte]: to } },
    ];
  } else if (status === "IN_PROGRESS") {
    where[Op.and] = [
      { [Op.or]: activityRange },
      getFinalStatusWhere("IN_PROGRESS"),
    ];
  } else {
    where[Op.or] = activityRange;
  }
  if (!hasStationScope(filters) && filters.shiftCode && !isAllShiftToken(filters.shiftCode)) {
    where.shift_code = { [Op.in]: getShiftAliasVariants(filters.shiftCode) };
  }
  if (filters.lineId) where.line_id = filters.lineId;
  if (filters.plantId) where.plant_id = filters.plantId;

  const search = normalizeText(filters.barcode || filters.customerCode || filters.partId);
  if (search) {
    where[Op.and] = [
      ...(where[Op.and] || []),
      {
        [Op.or]: [
          { part_serial_no: { [Op.like]: `%${search}%` } },
          { customer_qr_code: { [Op.like]: `%${search}%` } },
          { traceability_part_id: { [Op.like]: `%${search}%` } },
          { shot_number: { [Op.like]: `%${search}%` } },
        ],
      },
    ];
  }
  if (filters.partName || filters.part_name) where.part_name = { [Op.like]: `%${normalizeText(filters.partName || filters.part_name)}%` };
  if (filters.dieName || filters.die_name) where.die_name = { [Op.like]: `%${normalizeText(filters.dieName || filters.die_name)}%` };
  if (filters.dieCastingMachine || filters.die_casting_machine) {
    where.die_casting_machine_name = { [Op.like]: `%${normalizeText(filters.dieCastingMachine || filters.die_casting_machine)}%` };
  }
  return where;
}

function appendMaterializedDimensionFilters(where = {}, filters = {}) {
  if (!hasStationScope(filters) && filters.shiftCode && !isAllShiftToken(filters.shiftCode)) {
    where.shift_code = { [Op.in]: getShiftAliasVariants(filters.shiftCode) };
  }
  if (filters.lineId) where.line_id = filters.lineId;
  if (filters.plantId) where.plant_id = filters.plantId;
  if (filters.machineId) where.anchor_machine_id = filters.machineId;

  const search = normalizeText(filters.barcode || filters.customerCode || filters.partId);
  if (search) {
    where[Op.and] = [
      ...(where[Op.and] || []),
      {
        [Op.or]: [
          { part_serial_no: { [Op.like]: `%${search}%` } },
          { customer_qr_code: { [Op.like]: `%${search}%` } },
          { traceability_part_id: { [Op.like]: `%${search}%` } },
          { shot_number: { [Op.like]: `%${search}%` } },
        ],
      },
    ];
  }
  if (filters.partName || filters.part_name) where.part_name = { [Op.like]: `%${normalizeText(filters.partName || filters.part_name)}%` };
  if (filters.dieName || filters.die_name) where.die_name = { [Op.like]: `%${normalizeText(filters.dieName || filters.die_name)}%` };
  if (filters.dieCastingMachine || filters.die_casting_machine) {
    where.die_casting_machine_name = { [Op.like]: `%${normalizeText(filters.dieCastingMachine || filters.die_casting_machine)}%` };
  }
  return where;
}

function mergeMaterializedWhere(...parts) {
  const and = parts.filter((part) => part && Reflect.ownKeys(part).length);
  return and.length ? { [Op.and]: and } : {};
}

async function fetchMaterializedTraceabilityMetrics(filters = {}) {
  if (filters.machineId || filters.operationNo || filters.station) {
    const records = await fetchMaterializedRecords(filters, { limit: Number(filters.metricsLimit || 50000) });
    return calculateMaterializedMetrics(records, filters);
  }

  const { from, to } = getMaterializedDateRange(filters);
  const status = normalizeStatusFilter(filters.status || filters.resultType);
  const baseWhere = appendMaterializedDimensionFilters({}, filters);
  const range = (field) => ({ [field]: { [Op.gte]: from, [Op.lte]: to } });
  const activityWhere = {
    [Op.or]: [
      range("first_scan_at"),
      range("final_result_at"),
      range("last_activity_at"),
    ],
  };
  const countOrZero = async (where) => Number(await withDeadlockRetry(
    "metric count",
    () => FinalProductionResult.count({ where })
  )) || 0;
  const [totalProduction, passed, failed, inProgress] = await Promise.all([
    countOrZero(mergeMaterializedWhere(baseWhere, range("first_scan_at"))),
    status && status !== "PASSED" ? Promise.resolve(0) : countOrZero(mergeMaterializedWhere(baseWhere, getFinalStatusWhere("PASSED"), range("final_result_at"))),
    status && status !== "NG" ? Promise.resolve(0) : countOrZero(mergeMaterializedWhere(baseWhere, getFinalStatusWhere("NG"), range("final_result_at"))),
    status && status !== "IN_PROGRESS" ? Promise.resolve(0) : countOrZero(mergeMaterializedWhere(baseWhere, getFinalStatusWhere("IN_PROGRESS"), activityWhere)),
  ]);
  const productionBase = passed + failed;
  return {
    totalProduction,
    traceabilityProduction: totalProduction,
    completedProduction: productionBase,
    totalOK: passed,
    totalNG: failed,
    inProgress,
    validationRejects: failed,
    passRate: productionBase > 0 ? Number(((passed / productionBase) * 100).toFixed(2)) : 0,
    byMachine: {},
    byShift: {},
    byLine: {},
  };
}

function getRecordRows(record = {}) {
  return parseJson(record.report_rows_json, []);
}

function getRecordComputedSummary(record = {}) {
  const rows = getRecordRows(record);
  if (!rows.length) {
    return {
      finalStatus: getRecordEffectiveStatus(record),
      firstScanAt: record.first_scan_at,
      finalResultAt: record.final_result_at,
      lastActivityAt: record.last_activity_at,
    };
  }
  const summary = deriveGroupSummary(rows);
  return {
    ...summary,
    finalStatus: summary.finalStatus || "IN_PROGRESS",
    firstScanAt: summary.firstScanAt || record.first_scan_at,
    finalResultAt: summary.finalResultAt || record.final_result_at,
    lastActivityAt: summary.lastActivityAt || record.last_activity_at,
  };
}

function getRecordComputedStatus(record = {}) {
  return getRecordComputedSummary(record).finalStatus || "IN_PROGRESS";
}

function recordMatchesFinalStatus(record = {}, filters = {}) {
  const status = normalizeStatusFilter(filters.status || filters.resultType);
  if (!status) return true;
  const computedStatus = getRecordEffectiveStatus(record);
  const { from, to } = getMaterializedDateRange(filters);
  const finalResultInRange = isWithinDate(record.final_result_at, from, to);
  const firstScanInRange = isWithinDate(record.first_scan_at, from, to);
  const activityInRange = firstScanInRange || finalResultInRange || isWithinDate(record.last_activity_at, from, to);
  if (status === "PASSED" || status === "NG") {
    return computedStatus === status && finalResultInRange;
  }
  if (status === "IN_PROGRESS") {
    return computedStatus === "IN_PROGRESS" && activityInRange;
  }
  return computedStatus === status;
}

function recordMatchesMaterializedFilters(record = {}, filters = {}) {
  const machineId = normalizeText(filters.machineId);
  const operationNo = normalizeUpper(filters.operationNo || filters.station);
  if (!recordMatchesFinalStatus(record, filters)) return false;
  if (!hasStationScope(filters) && filters.shiftCode && !shiftMatchesFilter(record.shift_code, filters.shiftCode)) return false;
  if (!machineId && !operationNo) return true;
  return getRecordRows(record).some((row) => {
    if (machineId && String(row.machine_id || row.machineId || "").trim() !== machineId) return false;
    if (operationNo && getStationOperation(row) !== operationNo) return false;
    if (filters.shiftCode && !shiftMatchesFilter(getRowShiftCode(row), filters.shiftCode)) return false;
    return true;
  });
}

function rowsFromMaterializedRecords(records = [], filters = {}) {
  const machineId = normalizeText(filters.machineId);
  const operationNo = normalizeUpper(filters.operationNo || filters.station);
  const rows = [];
  for (const record of records) {
    if (!recordMatchesFinalStatus(record, filters)) continue;
    const computedStatus = getRecordComputedStatus(record);
    const recordCustomerQr = sanitizeCustomerQrValue(record.customer_qr_code);
    const groupRows = getRecordRows(record).map((row) => ({
      ...row,
      partStatus: computedStatus,
      part_status: computedStatus,
      overallStatus: computedStatus,
      statusLabel: computedStatus,
      ...(recordCustomerQr ? {
        customerCode: recordCustomerQr,
        customerQrCode: recordCustomerQr,
        customer_qr_code: recordCustomerQr,
        customerQrPending: false,
        customer_qr_pending: false,
      } : {}),
    }));
    const filteredRows = groupRows.filter((row) => {
      if (machineId && String(row.machine_id || row.machineId || "").trim() !== machineId) return false;
      if (operationNo && getStationOperation(row) !== operationNo) return false;
      if (filters.shiftCode && !shiftMatchesFilter(getRowShiftCode(row), filters.shiftCode)) return false;
      return true;
    });
    if ((machineId || operationNo) && !filteredRows.length) continue;
    rows.push(...(filteredRows.length ? filteredRows : groupRows));
  }
  return rows;
}

async function fetchMaterializedRecords(filters = {}, options = {}) {
  const where = buildMaterializedWhere(filters);
  const requestedLimit = Number(options.limit || filters.limit || 0) > 0 ? Number(options.limit || filters.limit) : null;
  const limit = requestedLimit ? Math.min(requestedLimit, 200000) : 200000;
  const offset = Number(options.offset || 0) > 0 ? Number(options.offset) : 0;
  return withDeadlockRetry("fetch records", () => FinalProductionResult.findAll({
    where,
    order: [
      ["first_scan_at", "DESC"],
      ["last_activity_at", "DESC"],
      ["final_result_at", "DESC"],
    ],
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
    raw: true,
  }));
}

async function fetchMaterializedReportRows(filters = {}, options = {}) {
  const records = await fetchMaterializedRecords(filters, options);
  return rowsFromMaterializedRecords(records, filters);
}

function isWithinDate(value, from, to) {
  const time = toTime(value);
  if (!time) return false;
  if (from && time < from.getTime()) return false;
  if (to && time > to.getTime()) return false;
  return true;
}

function getScopedRecordRows(record = {}, filters = {}) {
  const machineId = normalizeText(filters.machineId);
  const operationNo = normalizeUpper(filters.operationNo || filters.station);
  return getRecordRows(record).filter((row) => {
    if (machineId && String(row.machine_id || row.machineId || "").trim() !== machineId) return false;
    if (operationNo && getStationOperation(row) !== operationNo) return false;
    if (filters.shiftCode && !shiftMatchesFilter(getRowShiftCode(row), filters.shiftCode)) return false;
    return true;
  });
}

function calculateScopedMaterializedMetrics(records = [], filters = {}) {
  const { from, to } = getMaterializedDateRange(filters);
  const metrics = {
    totalProduction: 0,
    traceabilityProduction: 0,
    completedProduction: 0,
    totalOK: 0,
    totalNG: 0,
    inProgress: 0,
    validationRejects: 0,
    passRate: 0,
    byMachine: {},
    byShift: {},
    byLine: {},
  };

  for (const record of records) {
    const scopedRows = getScopedRecordRows(record, filters);
    if (!scopedRows.length) continue;

    const rowsInRange = scopedRows.filter((row) => isWithinDate(getRowActivityTimestamp(row), from, to));
    if (!rowsInRange.length) continue;

    let status = "";
    let machineName = record.anchor_machine_name || "Unknown Machine";
    let shiftCode = record.shift_code || "Unknown Shift";
    let lineName = record.line_name || "Unknown Line";
    for (const row of rowsInRange) {
      machineName = row.machineName || row.machine_name || machineName;
      shiftCode = getRowShiftCode(row) || shiftCode;
      lineName = row.lineName || row.line_name || lineName;
      const candidate = normalizeStationResult(row.industrialResult || row.statusLabel || row.result || row.plc_status, row.reason || row.interlock_reason, row);
      status = pickStationResult(status, candidate || "IN_PROGRESS");
    }

    if (!metrics.byMachine[machineName]) metrics.byMachine[machineName] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };
    if (!metrics.byShift[shiftCode]) metrics.byShift[shiftCode] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };
    if (!metrics.byLine[lineName]) metrics.byLine[lineName] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };

    metrics.traceabilityProduction += 1;
    metrics.byMachine[machineName].total += 1;
    metrics.byShift[shiftCode].total += 1;
    metrics.byLine[lineName].total += 1;

    if (status === "OK") {
      metrics.completedProduction += 1;
      metrics.totalOK += 1;
      metrics.byMachine[machineName].ok += 1;
      metrics.byShift[shiftCode].ok += 1;
      metrics.byLine[lineName].ok += 1;
    } else if (status === "NG") {
      metrics.completedProduction += 1;
      metrics.totalNG += 1;
      metrics.validationRejects += 1;
      metrics.byMachine[machineName].ng += 1;
      metrics.byShift[shiftCode].ng += 1;
      metrics.byLine[lineName].ng += 1;
      metrics.byMachine[machineName].rejects += 1;
      metrics.byShift[shiftCode].rejects += 1;
      metrics.byLine[lineName].rejects += 1;
    } else {
      metrics.inProgress += 1;
      metrics.byMachine[machineName].inProgress += 1;
      metrics.byShift[shiftCode].inProgress += 1;
      metrics.byLine[lineName].inProgress += 1;
    }
  }

  const productionBase = metrics.totalOK + metrics.totalNG;
  metrics.totalProduction = metrics.traceabilityProduction;
  metrics.passRate = productionBase > 0 ? Number(((metrics.totalOK / productionBase) * 100).toFixed(2)) : 0;
  return metrics;
}

function calculateMaterializedMetrics(records = [], filters = {}) {
  if (hasStationScope(filters)) {
    return calculateScopedMaterializedMetrics(records, filters);
  }

  const { from, to } = getMaterializedDateRange(filters);
  const metrics = {
    totalProduction: 0,
    traceabilityProduction: 0,
    completedProduction: 0,
    totalOK: 0,
    totalNG: 0,
    inProgress: 0,
    validationRejects: 0,
    passRate: 0,
    byMachine: {},
    byShift: {},
    byLine: {},
  };

  for (const record of records) {
    if (!recordMatchesMaterializedFilters(record, filters)) continue;
    const summary = getRecordComputedSummary(record);
    const machineName = record.anchor_machine_name || "Unknown Machine";
    const shiftCode = record.shift_code || "Unknown Shift";
    const lineName = record.line_name || "Unknown Line";
    if (!metrics.byMachine[machineName]) metrics.byMachine[machineName] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };
    if (!metrics.byShift[shiftCode]) metrics.byShift[shiftCode] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };
    if (!metrics.byLine[lineName]) metrics.byLine[lineName] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };

    const firstScanInRange = isWithinDate(summary.firstScanAt, from, to);
    const finalResultInRange = isWithinDate(summary.finalResultAt, from, to);
    const finalStatus = normalizeStatusFilter(summary.finalStatus);
    const activityInRange = firstScanInRange || finalResultInRange || isWithinDate(summary.lastActivityAt, from, to);
    const completedInRange = finalResultInRange && (finalStatus === "PASSED" || finalStatus === "NG");

    if (firstScanInRange) {
      metrics.traceabilityProduction += 1;
      metrics.byMachine[machineName].total += 1;
      metrics.byShift[shiftCode].total += 1;
      metrics.byLine[lineName].total += 1;
    }

    if (finalStatus === "PASSED" && finalResultInRange) {
      metrics.completedProduction += 1;
      metrics.totalOK += 1;
      metrics.byMachine[machineName].ok += 1;
      metrics.byShift[shiftCode].ok += 1;
      metrics.byLine[lineName].ok += 1;
    } else if (finalStatus === "NG" && finalResultInRange) {
      metrics.completedProduction += 1;
      metrics.totalNG += 1;
      metrics.byMachine[machineName].ng += 1;
      metrics.byShift[shiftCode].ng += 1;
      metrics.byLine[lineName].ng += 1;
    } else if (activityInRange && !completedInRange) {
      metrics.inProgress += 1;
      metrics.byMachine[machineName].inProgress += 1;
      metrics.byShift[shiftCode].inProgress += 1;
      metrics.byLine[lineName].inProgress += 1;
    }

    if (record.rejection_reason || record.rejection_category || finalStatus === "NG") {
      metrics.validationRejects += 1;
      metrics.byMachine[machineName].rejects += 1;
      metrics.byShift[shiftCode].rejects += 1;
      metrics.byLine[lineName].rejects += 1;
    }
  }
  const productionBase = metrics.totalOK + metrics.totalNG;
  metrics.totalProduction = metrics.traceabilityProduction;
  metrics.passRate = productionBase > 0 ? Number(((metrics.totalOK / productionBase) * 100).toFixed(2)) : 0;
  return metrics;
}

async function getMaterializedGroupCount(filters = {}) {
  if (!filters.machineId && !filters.operationNo && !filters.station) {
    return withDeadlockRetry("group count", () => FinalProductionResult.count({ where: buildMaterializedWhere(filters) }));
  }
  const records = await fetchMaterializedRecords(filters, { limit: Number(filters.countLimit || 50000) });
  return records.filter((record) => recordMatchesMaterializedFilters(record, filters)).length;
}

async function fetchMaterializedReportPage(filters = {}, pagination = {}) {
  const pageSize = Math.min(Math.max(Number(pagination.pageSize || 500), 10), 10000);
  const requestedPage = Math.max(Number(pagination.page || 1), 1);
  const totalRows = await getMaterializedGroupCount(filters);
  if (!totalRows) return null;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  let records;
  if (filters.machineId || filters.operationNo || filters.station) {
    const allRecords = await fetchMaterializedRecords(filters, { limit: Number(filters.countLimit || 50000) });
    records = allRecords.filter((record) => recordMatchesMaterializedFilters(record, filters)).slice(offset, offset + pageSize);
  } else {
    records = await fetchMaterializedRecords(filters, { limit: pageSize, offset });
  }
  const rows = rowsFromMaterializedRecords(records, filters).map((row) => ({
    ...row,
    __reportMaterialized: true,
  }));
  const metricsRecords = await fetchMaterializedRecords(filters, { limit: Number(filters.metricsLimit || 50000) });
  const metrics = calculateMaterializedMetrics(metricsRecords, filters);
  return {
    rows,
    metrics,
    pagination: {
      page,
      pageSize,
      totalRows,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

async function materializePartFromCurrentReport(partId) {
  const token = normalizeText(partId);
  if (!token) return { upserted: 0 };
  const { fetchProductionData } = require("./reportExportService");
  const rows = await withDeadlockRetry(`source read ${token}`, () => fetchProductionData({
    exactPartId: token,
  }, {
    includePlcReadings: true,
    includeLeaktest: true,
    includePlcSummary: false,
  }));
  if (!Array.isArray(rows) || rows.length === 0) {
    const error = new Error(`No source rows available yet for ${token}`);
    error.code = "FINAL_RESULT_SOURCE_PENDING";
    throw error;
  }
  return upsertMaterializedReportRows(rows);
}

async function refreshRecentMaterializedParts(filters = {}, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 25), 1), 100);
  const { from, to } = getMaterializedDateRange(filters);
  const where = {
    createdAt: { [Op.gte]: from, [Op.lte]: to },
  };
  if (filters.machineId) where.machine_id = filters.machineId;
  if (filters.operationNo) where.operation_no = normalizeUpper(filters.operationNo);
  if (filters.station) {
    where[Op.or] = [
      { operation_no: normalizeUpper(filters.station) },
      { station_no: normalizeUpper(filters.station) },
    ];
  }
  const rows = await withDeadlockRetry("recent operation log read", () => OperationLog.findAll({
    where,
    attributes: ["part_id", "createdAt", "updatedAt"],
    order: [["createdAt", "DESC"], ["updatedAt", "DESC"]],
    limit: limit * 3,
    raw: true,
  })).catch((error) => {
    console.warn(`[FinalProductionResult] recent operation log read skipped: ${error.message}`);
    return [];
  });
  const partIds = [...new Set(rows.map((row) => normalizeText(row.part_id)).filter(Boolean))].slice(0, limit);
  for (const partId of partIds) {
    await materializePartFromCurrentReport(partId);
  }
  return { refreshed: partIds.length };
}

async function queueRecentMaterializedParts(filters = {}, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 10), 1), 50);
  const { from, to } = getMaterializedDateRange(filters);
  const where = {
    createdAt: { [Op.gte]: from, [Op.lte]: to },
  };
  if (filters.machineId) where.machine_id = filters.machineId;
  if (filters.operationNo) where.operation_no = normalizeUpper(filters.operationNo);
  if (filters.station) {
    where[Op.or] = [
      { operation_no: normalizeUpper(filters.station) },
      { station_no: normalizeUpper(filters.station) },
    ];
  }
  const rows = await withDeadlockRetry("recent operation log queue read", () => OperationLog.findAll({
    where,
    attributes: ["part_id", "createdAt", "updatedAt"],
    order: [["createdAt", "DESC"], ["updatedAt", "DESC"]],
    limit: limit * 3,
    raw: true,
  })).catch((error) => {
    console.warn(`[FinalProductionResult] recent queue read skipped: ${error.message}`);
    return [];
  });
  const partIds = [...new Set(rows.map((row) => normalizeText(row.part_id)).filter(Boolean))].slice(0, limit);
  partIds.forEach(scheduleMaterializePart);
  return { queued: partIds.length };
}

function scheduleMaterializePart(partId) {
  const token = normalizeText(partId);
  if (!token) return;
  pendingPartIds.set(token, Date.now());
  if (!materializerTimer) {
    materializerTimer = MATERIALIZER_DEBOUNCE_MS > 0
      ? setTimeout(flushMaterializerQueue, MATERIALIZER_DEBOUNCE_MS)
      : setImmediate(flushMaterializerQueue);
  }
}

function scheduleMaterializerFlush(delayMs = MATERIALIZER_DEBOUNCE_MS) {
  if (materializerTimer) return;
  materializerTimer = delayMs > 0
    ? setTimeout(flushMaterializerQueue, delayMs)
    : setImmediate(flushMaterializerQueue);
}

function flushMaterializerQueueSoon() {
  scheduleMaterializerFlush(0);
}

function getMaterializerQueueStatus() {
  return {
    pending: pendingPartIds.size,
    retry: retryPartIds.size,
    running: materializerRunning,
  };
}

async function flushMaterializerQueue() {
  materializerTimer = null;
  if (materializerRunning) {
    materializerTimer = setTimeout(flushMaterializerQueue, MATERIALIZER_DEBOUNCE_MS);
    return;
  }
  retryPartIds.forEach((queuedAt, partId) => {
    if (!pendingPartIds.has(partId)) pendingPartIds.set(partId, queuedAt);
  });
  retryPartIds.clear();
  const batch = [...pendingPartIds.keys()].slice(0, MATERIALIZER_BATCH_SIZE);
  batch.forEach((partId) => pendingPartIds.delete(partId));
  if (!batch.length) return;

  materializerRunning = true;
  try {
    for (const partId of batch) {
      try {
        await materializePartFromCurrentReport(partId);
      } catch (error) {
        console.warn(`[FinalProductionResult] materialize failed for ${partId}: ${error.message}`);
        retryPartIds.set(partId, Date.now());
      }
    }
  } finally {
    materializerRunning = false;
    if (pendingPartIds.size || retryPartIds.size) {
      scheduleMaterializerFlush(Math.max(MATERIALIZER_DEBOUNCE_MS, 30000));
    }
  }
}

async function buildStationPairsFromRows(rows = [], filters = {}) {
  const machineWhere = {};
  if (filters?.machineId) machineWhere.id = filters.machineId;
  if (filters?.plantId) machineWhere.plant_id = filters.plantId;
  if (filters?.lineId) machineWhere.line_id = filters.lineId;
  else if (filters?.lineName) machineWhere.line_name = filters.lineName;
  const machines = await Machine.findAll({ where: machineWhere, raw: true });
  const fromMachines = (machines || []).map((m) => {
    const machineName = normalizeText(m.machine_name || m.machineName);
    const op = normalizeText(m.operation_no || m.operationNo || m.station_no || m.stationNo);
    if (!machineName || !op) return null;
    return { key: `${machineName}__${op}`, machineName, op, label: `${machineName} + ${op}` };
  }).filter(Boolean);
  const fromRows = (rows || []).map((row) => {
    const machineName = normalizeText(row.machineName || row.machine_name || row?.Machine?.machine_name);
    const op = normalizeText(row.operationNo || row.operation_no || row.stationNo || row.station_no);
    if (!machineName || !op || machineName === "-") return null;
    return { key: `${machineName}__${op}`, machineName, op, label: `${machineName} + ${op}` };
  }).filter(Boolean);
  const map = new Map();
  [...fromMachines, ...fromRows].forEach((pair) => {
    if (!map.has(pair.key)) map.set(pair.key, pair);
  });
  return [...map.values()].sort((a, b) =>
    a.op.localeCompare(b.op, undefined, { numeric: true, sensitivity: "base" }) ||
    a.machineName.localeCompare(b.machineName)
  );
}

module.exports = {
  upsertMaterializedReportRows,
  fetchMaterializedReportRows,
  fetchMaterializedReportPage,
  fetchMaterializedTraceabilityMetrics,
  getMaterializedGroupCount,
  refreshRecentMaterializedParts,
  queueRecentMaterializedParts,
  materializePartFromCurrentReport,
  scheduleMaterializePart,
  flushMaterializerQueueSoon,
  getMaterializerQueueStatus,
  buildStationPairsFromRows,
};
