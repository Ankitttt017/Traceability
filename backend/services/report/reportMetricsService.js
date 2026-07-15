/**
 * reportMetricsService.js
 * Calculates industrial production metrics for reports and dashboards.
 */

const { resolveIndustrialResult } = require("./reportFormatter");

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

function calculateProductionMetrics(rows) {
  const metrics = {
    totalProduction: 0,
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

  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row.partId || row.part_id || row.barcode || row.shot_uid || "").trim();
    if (!key) continue;
    if (!groupedByPart.has(key)) groupedByPart.set(key, []);
    groupedByPart.get(key).push(row);
  }

  const groupedParts = Array.from(groupedByPart.values()).map((entries) => {
    const operationResults = {};
    let latestRow = entries[0] || {};
    let latestTs = new Date(latestRow?.latestAnchorCreatedAt || latestRow?.createdAt || 0).getTime() || 0;
    let hasValidationReject = false;

    for (const row of entries) {
      const { status: fallbackStatus, category: fallbackCategory } = resolveIndustrialResult(row);
      const industrialResult = String(row.industrialResult || fallbackStatus || "").trim().toUpperCase();
      const category = String(row.category || fallbackCategory || "").trim().toUpperCase();
      const operationKey = String(row.operationNo || row.stationNo || row.operation_no || row.station_no || "").trim().toUpperCase();
      const normalized = normalizeResult(industrialResult, row.reason || row.interlock_reason, row);
      if (operationKey && normalized) {
        operationResults[operationKey] = pickPreferredOperationResult(operationResults[operationKey], normalized);
      }
      if (category === "VALIDATION") {
        hasValidationReject = true;
      }
      const rowTs = new Date(row.latestAnchorCreatedAt || row.createdAt || 0).getTime() || 0;
      if (rowTs >= latestTs) {
        latestRow = row;
        latestTs = rowTs;
      }
    }

    const overallStatus = (() => {
      const values = requiredOperations.map((operation) => normalizeResult(operationResults[operation])).filter(Boolean);
      if (values.some((value) => value === "NG")) return "NG";
      if (values.some((value) => value === "IN_PROGRESS")) return "IN_PROGRESS";
      const finalStatus = normalizeFinalPartStatus(latestRow.partStatus || latestRow.part_status || latestRow.status);
      if (finalStatus === "NG") return "NG";
      const terminalOperation = requiredOperations[requiredOperations.length - 1];
      if (terminalOperation && normalizeResult(operationResults[terminalOperation]) === "OK") {
        return "PASSED";
      }
      if (requiredOperations.length > 0 && values.length >= requiredOperations.length && values.every((value) => value === "OK")) {
        return "PASSED";
      }
      if (finalStatus === "PASSED") return "PASSED";
      return "IN_PROGRESS";
    })();

    return {
      partId: String(latestRow.partId || latestRow.part_id || "").trim(),
      machineName: latestRow.anchorMachineName || latestRow.machineName || "Unknown Machine",
      shiftCode: latestRow.anchorShiftCode || latestRow.shiftCode || "Unknown Shift",
      lineName: latestRow.anchorLineName || latestRow.lineName || "Unknown Line",
      overallStatus,
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

    metrics.totalProduction += 1;
    metrics.byMachine[machineName].total += 1;
    metrics.byShift[shiftCode].total += 1;
    metrics.byLine[lineName].total += 1;

    if (part.overallStatus === "PASSED") {
      metrics.totalOK += 1;
      metrics.byMachine[machineName].ok += 1;
      metrics.byShift[shiftCode].ok += 1;
      metrics.byLine[lineName].ok += 1;
    } else if (part.overallStatus === "NG") {
      metrics.totalNG += 1;
      metrics.byMachine[machineName].ng += 1;
      metrics.byShift[shiftCode].ng += 1;
      metrics.byLine[lineName].ng += 1;
    } else {
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
  metrics.passRate = productionBase > 0
    ? Number(((metrics.totalOK / productionBase) * 100).toFixed(2))
    : 0;

  return metrics;
}

module.exports = {
  calculateProductionMetrics,
};
