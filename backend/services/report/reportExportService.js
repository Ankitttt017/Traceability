/**
 * reportExportService.js
 * Main entry point for the reporting system.
 * Orchestrates database queries, metrics calculation, and file generation.
 */

const { Op } = require("sequelize");
const OperationLog = require("../../models/OperationLog");
const Machine = require("../../models/Machine");
const Part = require("../../models/Part");
const QrFormatRule = require("../../models/QrFormatRule");
const { calculateProductionMetrics } = require("./reportMetricsService");
const { generateIndustrialExcel } = require("./excelTemplateEngine");
const { resolveIndustrialResult } = require("./reportFormatter");

async function runIndustrialExport(res, { filters, reportConfig, type = "full" }) {
  // 1. Resolve Data
  const rows = await fetchProductionData(filters);

  // 2. Calculate Metrics
  const metrics = calculateProductionMetrics(rows);

  // 3. Generate File
  await generateIndustrialExcel(res, {
    rows,
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
async function fetchProductionData(filters = {}) {
  const {
    dateFrom, dateTo,
    machineId, lineName,
    shiftCode, modelCode,
    operationNo, resultType
  } = filters;

  // Safe date defaults — always query last 24 hours if nothing specified
  const now = new Date();
  const from = dateFrom ? new Date(dateFrom) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to   = dateTo   ? new Date(dateTo)   : now;

  // Guard invalid dates
  const safeFrom = isNaN(from.getTime()) ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : from;
  const safeTo   = isNaN(to.getTime())   ? now : to;

  const where = {
    createdAt: {
      [Op.gte]: safeFrom,
      [Op.lte]: safeTo
    }
  };

  if (machineId)   where.machine_id   = machineId;
  if (operationNo) where.operation_no = operationNo;
  
  // Note: Sequelize joins for lineName would be better if we have associations, 
  // but for reliability we can fetch scoped machine IDs first.
  if (lineName) {
    const machines = await Machine.findAll({ where: { line_name: lineName }, attributes: ["id"] });
    const ids = machines.map(m => m.id);
    where.machine_id = { [Op.in]: ids };
  }

  const logs = await OperationLog.findAll({
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
  });

  // Fetch Part & QR Info (Flattening for performance)
  const partIds = [...new Set(logs.map(l => l.part_id))];
  const parts = await Part.findAll({
    where: { part_id: { [Op.in]: partIds } },
    attributes: ["part_id", "qr_format_name"],
    raw: true
  });

  const partMap = parts.reduce((acc, p) => {
    acc[p.part_id] = p;
    return acc;
  }, {});

  const qrRules = await QrFormatRule.findAll({ attributes: ["format_name", "model_code"], raw: true });
  const qrMap = qrRules.reduce((acc, q) => {
    acc[q.format_name] = q.model_code;
    return acc;
  }, {});

  // Enrich & Standardize
  const enriched = logs.map((log, index) => {
    const part = partMap[log.part_id] || {};
    const { status: industrialResult, category } = resolveIndustrialResult({
      result: log.result,
      plc_status: log.plc_status,
      interlock_reason: log.interlock_reason
    });

    // Calculate Cycle Time if timestamps exist
    let cycleTime = log.cycle_time;
    if (!cycleTime && log.plc_start_at && log.plc_end_at) {
      const start = new Date(log.plc_start_at);
      const end = new Date(log.plc_end_at);
      cycleTime = Math.max(0, (end.getTime() - start.getTime()) / 1000);
    }

    return {
      ...log,
      srNo: index + 1,
      partId:      log.part_id || "-",
      machineName: log.Machine?.machine_name || "-",
      lineName:    log.Machine?.line_name    || "-",
      operationNo: log.operation_no || log.Machine?.operation_no || "-",
      qrFormatName: part.qr_format_name || "-",
      modelCode:    qrMap[part.qr_format_name] || "-",
      shiftCode:    log.shift_code || "A",
      cycleTime:    cycleTime ? cycleTime.toFixed(2) : "0.00",
      industrialResult,
      category
    };
  });

  if (resultType) {
    if (resultType === "VALIDATION") {
      return enriched.filter(r => r.category === "VALIDATION");
    }
    return enriched.filter(r => r.industrialResult === resultType);
  }

  return enriched;
}

module.exports = {
  runIndustrialExport,
  fetchProductionData
};
