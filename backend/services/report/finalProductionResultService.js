const { Op } = require("sequelize");
const FinalProductionResult = require("../../models/FinalProductionResult");
const Machine = require("../../models/Machine");

const MATERIALIZER_LOOKBACK_DAYS = Math.max(Number(process.env.REPORT_MATERIALIZER_LOOKBACK_DAYS || 90), 1);
const MATERIALIZER_BATCH_SIZE = Math.max(Number(process.env.REPORT_MATERIALIZER_BATCH_SIZE || 25), 1);
const MATERIALIZER_DEBOUNCE_MS = Math.max(Number(process.env.REPORT_MATERIALIZER_DEBOUNCE_MS || 1500), 250);

const pendingPartIds = new Map();
let materializerTimer = null;
let materializerRunning = false;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
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

function buildMaterializedRecord(groupKey, rows = []) {
  const summary = deriveGroupSummary(rows);
  const firstRow = summary.firstScanRow || rows[0] || {};
  const latestRow = summary.latestRow || rows[0] || {};
  const plc = summary.plcReading || {};
  const rejection = summary.rejectionRow || {};
  const partSerial = normalizeText(latestRow.displayPartId || latestRow.partId || latestRow.part_id || firstRow.displayPartId || firstRow.partId || firstRow.part_id);
  const customerQr = normalizeText(latestRow.customerQrCode || latestRow.customerCode || firstRow.customerQrCode || firstRow.customerCode);
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
    traceability_part_id: normalizeText(latestRow.traceabilityPartId || latestRow.traceability_part_id || partSerial || groupKey),
    part_serial_no: partSerial || null,
    customer_qr_code: customerQr && customerQr !== "-" ? customerQr : null,
    shot_number: shotNumber && shotNumber !== "-" ? shotNumber : null,
    first_scan_at: toDate(summary.firstScanAt),
    final_result_at: toDate(summary.finalResultAt),
    last_activity_at: summary.lastActivityAt,
    production_date: toDateOnly(summary.firstScanAt),
    shift_code: normalizeText(firstRow.firstScanShiftCode || firstRow.shiftCode || firstRow.anchorShiftCode || latestRow.shiftCode || latestRow.anchorShiftCode) || null,
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
    report_rows_json: safeJson(rows, "[]"),
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
    const record = buildMaterializedRecord(groupKey, groupRows);
    const existing = await FinalProductionResult.findOne({ where: { report_group_key: groupKey } });
    if (existing) {
      await existing.update(record);
    } else {
      await FinalProductionResult.create(record);
    }
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
  if (hasStationNgColumns(record) || record.rejection_reason || record.rejection_category) return "NG";
  const status = normalizeStatusFilter(record.final_status);
  if (status === "PASSED" || status === "NG") return status;
  if (normalizeStatusFilter(record.op160_status) === "OK") return "PASSED";
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
      getPassedWhere(),
      { final_result_at: { [Op.gte]: from, [Op.lte]: to } },
    ];
  } else if (status === "NG") {
    where[Op.and] = [
      getStationNgWhere(),
      { final_result_at: { [Op.gte]: from, [Op.lte]: to } },
    ];
  } else if (status === "IN_PROGRESS") {
    where[Op.and] = [
      { [Op.or]: activityRange },
      { [Op.not]: getStationNgWhere() },
      { [Op.not]: getPassedWhere() },
    ];
  } else {
    where[Op.or] = activityRange;
  }
  if (filters.shiftCode && !["ALL", "ALL_SHIFTS", "ALL SHIFT", "ALL SHIFTS"].includes(normalizeUpper(filters.shiftCode))) {
    where.shift_code = normalizeText(filters.shiftCode);
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
  if (!machineId && !operationNo) return true;
  return getRecordRows(record).some((row) => {
    if (machineId && String(row.machine_id || row.machineId || "").trim() !== machineId) return false;
    if (operationNo && getStationOperation(row) !== operationNo) return false;
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
    const groupRows = getRecordRows(record).map((row) => ({
      ...row,
      partStatus: computedStatus,
      part_status: computedStatus,
      overallStatus: computedStatus,
      statusLabel: computedStatus,
    }));
    const filteredRows = groupRows.filter((row) => {
      if (machineId && String(row.machine_id || row.machineId || "").trim() !== machineId) return false;
      if (operationNo && getStationOperation(row) !== operationNo) return false;
      return true;
    });
    if ((machineId || operationNo) && !filteredRows.length) continue;
    rows.push(...(filteredRows.length ? filteredRows : groupRows));
  }
  return rows;
}

async function fetchMaterializedRecords(filters = {}, options = {}) {
  const where = buildMaterializedWhere(filters);
  const limit = Number(options.limit || filters.limit || 0) > 0 ? Number(options.limit || filters.limit) : null;
  const offset = Number(options.offset || 0) > 0 ? Number(options.offset) : 0;
  return FinalProductionResult.findAll({
    where,
    order: [["first_scan_at", "DESC"], ["last_activity_at", "DESC"]],
    ...(limit ? { limit } : {}),
    ...(offset ? { offset } : {}),
    raw: true,
  });
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

function calculateMaterializedMetrics(records = [], filters = {}) {
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
    const activityInRange = firstScanInRange || finalResultInRange || isWithinDate(summary.lastActivityAt, from, to);
    if (firstScanInRange) {
      metrics.traceabilityProduction += 1;
      metrics.byMachine[machineName].total += 1;
      metrics.byShift[shiftCode].total += 1;
      metrics.byLine[lineName].total += 1;
    }

    const finalStatus = normalizeStatusFilter(summary.finalStatus);
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
    } else if (activityInRange) {
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
    return FinalProductionResult.count({ where: buildMaterializedWhere(filters) });
  }
  const records = await fetchMaterializedRecords(filters, { limit: Number(filters.countLimit || 1000000) });
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
    const allRecords = await fetchMaterializedRecords(filters, { limit: Number(filters.countLimit || 1000000) });
    records = allRecords.filter((record) => recordMatchesMaterializedFilters(record, filters)).slice(offset, offset + pageSize);
  } else {
    records = await fetchMaterializedRecords(filters, { limit: pageSize, offset });
  }
  const rows = rowsFromMaterializedRecords(records, filters).map((row) => ({
    ...row,
    __reportMaterialized: true,
  }));
  const metricsRecords = await fetchMaterializedRecords(filters, { limit: Number(filters.metricsLimit || 1000000) });
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
  const dateTo = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dateFrom = new Date(Date.now() - MATERIALIZER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await fetchProductionData({
    barcode: token,
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
  }, {
    includePlcReadings: true,
    includeLeaktest: true,
    includePlcSummary: false,
  });
  return upsertMaterializedReportRows(rows);
}

function scheduleMaterializePart(partId) {
  const token = normalizeText(partId);
  if (!token) return;
  pendingPartIds.set(token, Date.now());
  if (!materializerTimer) {
    materializerTimer = setTimeout(flushMaterializerQueue, MATERIALIZER_DEBOUNCE_MS);
  }
}

async function flushMaterializerQueue() {
  materializerTimer = null;
  if (materializerRunning) {
    materializerTimer = setTimeout(flushMaterializerQueue, MATERIALIZER_DEBOUNCE_MS);
    return;
  }
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
      }
    }
  } finally {
    materializerRunning = false;
    if (pendingPartIds.size) {
      materializerTimer = setTimeout(flushMaterializerQueue, MATERIALIZER_DEBOUNCE_MS);
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
  getMaterializedGroupCount,
  materializePartFromCurrentReport,
  scheduleMaterializePart,
  buildStationPairsFromRows,
};
