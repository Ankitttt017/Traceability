/**
 * reportMetricsService.js
 * Calculates industrial production metrics for reports and dashboards.
 */

const { resolveIndustrialResult } = require("./reportFormatter");

/**
 * Aggregates row data into industrial metrics
 */
function calculateProductionMetrics(rows) {
  const metrics = {
    totalProduction: 0,
    totalOK: 0,
    totalNG: 0,
    inProgress: 0,
    validationRejects: 0,
    passRate: 0, // (OK / (OK + NG)) * 100
    byMachine: {},
    byShift: {},
    byLine: {}
  };

  rows.forEach(row => {
    const status = row.industrialResult || resolveIndustrialResult(row).status;
    const category = row.category || resolveIndustrialResult(row).category;
    const mName = row.machineName || "Unknown Machine";
    const sCode = row.shiftCode   || "Unknown Shift";
    const lName = row.lineName    || "Unknown Line";

    // Initialize groupings
    if (!metrics.byMachine[mName]) metrics.byMachine[mName] = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };
    if (!metrics.byShift[sCode])   metrics.byShift[sCode]   = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };
    if (!metrics.byLine[lName])    metrics.byLine[lName]    = { total: 0, ok: 0, ng: 0, inProgress: 0, rejects: 0 };

    if (category === "PRODUCTION") {
      metrics.totalProduction++;
      metrics.byMachine[mName].total++;
      metrics.byShift[sCode].total++;
      metrics.byLine[lName].total++;

      if (status === "OK") {
        metrics.totalOK++;
        metrics.byMachine[mName].ok++;
        metrics.byShift[sCode].ok++;
        metrics.byLine[lName].ok++;
      } else {
        metrics.totalNG++;
        metrics.byMachine[mName].ng++;
        metrics.byShift[sCode].ng++;
        metrics.byLine[lName].ng++;
      }
    } else if (category === "VALIDATION") {
      metrics.validationRejects++;
      metrics.byMachine[mName].rejects++;
      metrics.byShift[sCode].rejects++;
      metrics.byLine[lName].rejects++;
    } else {
      const normalizedStatus = String(status || "").trim().toUpperCase();
      if (normalizedStatus === "IN PROGRESS" || normalizedStatus === "IN_PROGRESS") {
        metrics.inProgress++;
        metrics.byMachine[mName].inProgress++;
        metrics.byShift[sCode].inProgress++;
        metrics.byLine[lName].inProgress++;
      }
    }
  });

  const productionBase = metrics.totalOK + metrics.totalNG;
  metrics.passRate = productionBase > 0 
    ? Number(((metrics.totalOK / productionBase) * 100).toFixed(2)) 
    : 0;

  return metrics;
}

module.exports = {
  calculateProductionMetrics
};
