/**
 * reportMetricsService.js
 * Calculates industrial production metrics for reports and dashboards.
 */

const { resolveIndustrialResult } = require("./reportFormatter");

const LEAK_TEST_OPERATION = "OP150";

function normalizeResult(value, reason = "", row = null) {
  const status = String(value || "").trim().toUpperCase();
  const normalizedReason = String(reason || "").trim().toUpperCase();
  const bypassStatus = Boolean(row?.bypassStatus || row?.is_bypassed || row?.isBypassed);
  const bypassReason = String(row?.bypassReason || row?.bypass_reason || "").trim().toUpperCase();

  if (bypassStatus || ["MACHINE_BYPASS_AUTO_OK", "STATION_BYPASS_AUTO_OK", "STATION_OPERATION_DISABLED_AUTO_OK"].includes(bypassReason)) {
    return "OK";
  }
  if (normalizedReason === "NG_SHOT_STATUS" && ["BLOCK", "INTERLOCKED"].includes(status)) {
    return "NG";
  }
  if (["OK", "PASS", "PASSED", "COMPLETED", "ENDED_OK", "COMPLETED_OK"].includes(status)) {
    return "OK";
  }
  if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG", "INTERLOCKED", "REJECTED"].includes(status)) {
    return "NG";
  }
  if (!status || status === "-" || status === "UNKNOWN") {
    return "";
  }
  return "IN_PROGRESS";
}

function pickPreferredOperationResult(current, candidate) {
  const rank = (value) => {
    if (value === "NG") return 3;
    if (value === "OK") return 2;
    if (value === "IN_PROGRESS") return 1;
    return 0;
  };
  return rank(candidate) > rank(current) ? candidate : (current || candidate);
}

function normalizeFinalPartStatus(value) {
  const status = String(value || "").trim().toUpperCase();
  if (["OK", "PASSED", "PASS", "COMPLETED", "COMPLETED_OK", "ENDED_OK"].includes(status)) return "PASSED";
  if (["NG", "FAILED", "FAIL", "REJECTED", "INTERLOCKED", "COMPLETED_NG", "ENDED_NG"].includes(status)) return "NG";
  return "IN_PROGRESS";
}

function toTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isWithinRange(value, range = {}) {
  const time = toTime(value);
  if (!time) return false;
  const from = range.dateFrom ? toTime(range.dateFrom) : 0;
  const to = range.dateTo ? toTime(range.dateTo) : 0;
  if (from && time < from) return false;
  if (to && time > to) return false;
  return true;
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

function isFinalInspectionOperation(rowOrOperation = {}) {
  const operation = typeof rowOrOperation === "string"
    ? rowOrOperation
    : (rowOrOperation.operationNo || rowOrOperation.stationNo || rowOrOperation.operation_no || rowOrOperation.station_no || "");
  const machineName = typeof rowOrOperation === "string"
    ? ""
    : (rowOrOperation.machineName || rowOrOperation.machine_name || rowOrOperation?.Machine?.machine_name || "");
  const op = String(operation || "").trim().toUpperCase();
  const machine = String(machineName || "").trim().toUpperCase();
  return op === "OP160" || machine.includes("FINAL INSPECTION") || machine.includes("FINAL_INSPECTION");
}

function getMetricGroupKey(row = {}, fallback = "") {
  return String(
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
    fallback ||
    ""
  ).trim();
}

function calculateProductionMetrics(rows, range = {}) {
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

  const groupedByPart = new Map();
  const requiredOperations = Array.from(
    new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => String(row.operationNo || row.stationNo || row.operation_no || row.station_no || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );

  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const key = getMetricGroupKey(row, `row_${index}`);
    if (!key) continue;
    if (!groupedByPart.has(key)) groupedByPart.set(key, []);
    groupedByPart.get(key).push(row);
  }

  const groupedParts = Array.from(groupedByPart.values()).map((entries) => {
    const operationResults = {};
    let latestRow = entries[0] || {};
    let latestTs = new Date(latestRow?.latestAnchorCreatedAt || latestRow?.createdAt || 0).getTime() || 0;
    let hasValidationReject = false;
    let firstNgAt = null;
    let firstScanAt = null;
    let firstScanRow = entries[0] || {};
    let activityInRange = false;
    const operationResultTimes = {};
    let finalInspectionOkAt = null;
    let hasLeakData = false;

    for (const row of entries) {
      const { status: fallbackStatus, category: fallbackCategory } = resolveIndustrialResult(row);
      const industrialResult = String(row.industrialResult || fallbackStatus || "").trim().toUpperCase();
      const category = String(row.category || fallbackCategory || "").trim().toUpperCase();
      const operationKey = String(row.operationNo || row.stationNo || row.operation_no || row.station_no || "").trim().toUpperCase();
      const rowLeakData = row.leakTestReadings || row.leakTestReading || row.leak_test_readings || row.leak_test_reading;
      if (Array.isArray(rowLeakData) ? rowLeakData.length > 0 : Boolean(rowLeakData)) {
        hasLeakData = true;
      }
      const normalized = normalizeResult(industrialResult, row.reason || row.interlock_reason, row);
      if (operationKey && normalized) {
        operationResults[operationKey] = pickPreferredOperationResult(operationResults[operationKey], normalized);
        const resultTime = getRowResultTimestamp(row);
        if (isWithinRange(resultTime, range)) {
          activityInRange = true;
        }
        if (resultTime) {
          const currentTime = operationResultTimes[operationKey];
          if (!currentTime || toTime(resultTime) >= toTime(currentTime)) {
            operationResultTimes[operationKey] = resultTime;
          }
        }
      }
      if (category === "VALIDATION") {
        hasValidationReject = true;
      }
      if (normalized === "NG") {
        const resultTime = getRowResultTimestamp(row);
        if (resultTime && (!firstNgAt || toTime(resultTime) < toTime(firstNgAt))) {
          firstNgAt = resultTime;
        }
      }
      if (normalized === "OK" && isFinalInspectionOperation(row)) {
        const resultTime = getRowResultTimestamp(row);
        if (resultTime && (!finalInspectionOkAt || toTime(resultTime) >= toTime(finalInspectionOkAt))) {
          finalInspectionOkAt = resultTime;
        }
      }
      const scanTime = getRowFirstScanTimestamp(row);
      if (scanTime && (!firstScanAt || toTime(scanTime) < toTime(firstScanAt))) {
        firstScanAt = scanTime;
        firstScanRow = row;
      }
      if (isWithinRange(row.latestAnchorCreatedAt || row.createdAt || row.updatedAt, range)) {
        activityInRange = true;
      }
      const rowTs = new Date(row.latestAnchorCreatedAt || row.createdAt || 0).getTime() || 0;
      if (rowTs >= latestTs) {
        latestRow = row;
        latestTs = rowTs;
      }
    }

    const overallStatus = (() => {
      const effectiveRequiredOperations = hasLeakData
        ? requiredOperations
        : requiredOperations.filter((operation) => operation !== LEAK_TEST_OPERATION);
      const values = effectiveRequiredOperations.map((operation) => normalizeResult(operationResults[operation])).filter(Boolean);
      if (values.some((value) => value === "NG")) return "NG";
      if (finalInspectionOkAt) return "PASSED";
      if (values.some((value) => value === "IN_PROGRESS")) return "IN_PROGRESS";
      const finalStatus = normalizeFinalPartStatus(latestRow.partStatus || latestRow.part_status || latestRow.status);
      if (finalStatus === "NG") return "NG";
      if (effectiveRequiredOperations.length > 1 && values.length >= effectiveRequiredOperations.length && values.every((value) => value === "OK")) {
        return "PASSED";
      }
      if (finalStatus === "PASSED") return "PASSED";
      return "IN_PROGRESS";
    })();
    const effectiveRequiredOperations = hasLeakData
      ? requiredOperations
      : requiredOperations.filter((operation) => operation !== LEAK_TEST_OPERATION);
    const terminalOperation = effectiveRequiredOperations[effectiveRequiredOperations.length - 1];
    const finalResultAt = overallStatus === "NG"
      ? firstNgAt
      : overallStatus === "PASSED"
        ? (finalInspectionOkAt || operationResultTimes[terminalOperation] || getRowResultTimestamp(latestRow))
        : null;
    const finalResultInRange = isWithinRange(finalResultAt, range);
    const firstScanInRange = isWithinRange(firstScanAt, range);
    return {
      partId: String(latestRow.partId || latestRow.part_id || "").trim(),
      machineName: firstScanRow.anchorMachineName || firstScanRow.machineName || latestRow.anchorMachineName || latestRow.machineName || "Unknown Machine",
      shiftCode: firstScanRow.firstScanShiftCode || firstScanRow.shiftCode || firstScanRow.anchorShiftCode || latestRow.firstScanShiftCode || latestRow.anchorShiftCode || latestRow.shiftCode || "Unknown Shift",
      lineName: firstScanRow.anchorLineName || firstScanRow.lineName || latestRow.anchorLineName || latestRow.lineName || "Unknown Line",
      overallStatus,
      firstScanAt,
      firstScanInRange,
      activityInRange,
      finalResultAt,
      finalResultInRange,
      hasValidationReject,
    };
  });

  groupedParts.forEach((part) => {
    const machineName = part.machineName || "Unknown Machine";
    const shiftCode = part.shiftCode || "Unknown Shift";
    const lineName = part.lineName || "Unknown Line";

    if (!metrics.byMachine[machineName]) metrics.byMachine[machineName] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };
    if (!metrics.byShift[shiftCode]) metrics.byShift[shiftCode] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };
    if (!metrics.byLine[lineName]) metrics.byLine[lineName] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };

    const completedInRange = part.finalResultInRange && (part.overallStatus === "PASSED" || part.overallStatus === "NG");
    const activeInRange = part.firstScanInRange || part.activityInRange || part.finalResultInRange;

    if (part.firstScanInRange) {
      metrics.traceabilityProduction += 1;
      metrics.byMachine[machineName].total += 1;
      metrics.byShift[shiftCode].total += 1;
      metrics.byLine[lineName].total += 1;
    }

    if (part.overallStatus === "PASSED" && part.finalResultInRange) {
      metrics.completedProduction += 1;
      metrics.totalOK += 1;
      metrics.byMachine[machineName].ok += 1;
      metrics.byShift[shiftCode].ok += 1;
      metrics.byLine[lineName].ok += 1;
    } else if (part.overallStatus === "NG" && part.finalResultInRange) {
      metrics.completedProduction += 1;
      metrics.totalNG += 1;
      metrics.byMachine[machineName].ng += 1;
      metrics.byShift[shiftCode].ng += 1;
      metrics.byLine[lineName].ng += 1;
    } else if (activeInRange && !completedInRange) {
      metrics.inProgress += 1;
      metrics.byMachine[machineName].inProgress += 1;
      metrics.byShift[shiftCode].inProgress += 1;
      metrics.byLine[lineName].inProgress += 1;
    }

    if (part.hasValidationReject) {
      metrics.validationRejects += 1;
      metrics.byMachine[machineName].rejects += 1;
      metrics.byShift[shiftCode].rejects += 1;
      metrics.byLine[lineName].rejects += 1;
    }
  });

  const productionBase = metrics.totalOK + metrics.totalNG;
  metrics.totalProduction = metrics.traceabilityProduction;
  metrics.passRate = productionBase > 0
    ? Number(((metrics.totalOK / productionBase) * 100).toFixed(2))
    : 0;

  return metrics;
}

module.exports = {
  calculateProductionMetrics,
};
