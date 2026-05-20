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

  // ── Filter: only keep meaningful production logs ─────────────────────────
  // Exclude: duplicate scans (INTERLOCKED + DUPLICATE_SCAN reason),
  //          sequence errors (INTERLOCKED + PREVIOUS_STATION_NOT_COMPLETED),
  //          QR format blocks, and RESET entries.
  // Keep:    ENDED_OK, ENDED_NG, and any log that represents a real outcome.
  const NON_PRODUCTION_REASONS = new Set([
    "DUPLICATE_SCAN",
    "ALREADY_SCANNED",
    "PREVIOUS_STATION_NOT_COMPLETED",
    "INVALID_QR_FORMAT",
    "QR_RULE_CONFIG_ERROR",
    "STATION_NOT_CONFIGURED",
  ]);

  const productionLogs = logs.filter((log) => {
    const status = String(log.plc_status || "").trim().toUpperCase();
    const reason = String(log.interlock_reason || "").trim().toUpperCase();

    // Always exclude RESET status
    if (status === "RESET") return false;

    // Exclude INTERLOCKED logs caused by non-production reasons
    if (status === "INTERLOCKED" && NON_PRODUCTION_REASONS.has(reason)) return false;

    // If result is BLOCK (blocked before PLC start) — skip unless it's a meaningful NG
    if (String(log.result || "").trim().toUpperCase() === "BLOCK") return false;

    return true;
  });

  // Fetch Part & QR Info (Flattening for performance)
  const partIds = [...new Set(productionLogs.map(l => l.part_id))];
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

  // Attach PLC cycle readings by shot number when available
  const shotNumbers = [...new Set(
    deduplicatedLogs
      .map((log) => String(log.shot_number || log.shotNumber || "").trim())
      .filter(Boolean)
  )];
  const plcByShot = new Map();
  for (const shot of shotNumbers) {
    try {
      const [rows] = await sequelize.query(
        "SELECT TOP 1 * FROM PlcCycleReadings WHERE shot_number = :shot ORDER BY recorded_at DESC",
        { replacements: { shot } }
      );
      if (rows && rows[0]) plcByShot.set(shot, rows[0]);
    } catch (_) {
      // Keep export resilient even if PlcCycleReadings schema differs
    }
  }

  // Enrich & Standardize
  const enriched = deduplicatedLogs.map((log, index) => {
    const part = partMap[log.part_id] || {};
    const { status: industrialResult, category } = resolveIndustrialResult({
      result: log.result,
      plc_status: log.plc_status,
      interlock_reason: log.interlock_reason
    });

    // Cycle times: scan time (createdAt of PENDING = QR scan) → PLC end time
    const cycleStartTime = log.plc_start_at || log.createdAt || null;
    const cycleEndTime   = log.plc_end_at   || null;

    let cycleTime = log.cycle_time;
    if (!cycleTime && cycleStartTime && cycleEndTime) {
      const start = new Date(cycleStartTime);
      const end   = new Date(cycleEndTime);
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
      cycleStartTime: cycleStartTime ? new Date(cycleStartTime).toLocaleString() : "-",
      cycleEndTime:   cycleEndTime   ? new Date(cycleEndTime).toLocaleString()   : "-",
      cycleTime:    cycleTime ? Number(cycleTime).toFixed(2) : "0.00",
      industrialResult,
      category,
      reason: log.interlock_reason || "-",
      plcReading: plcByShot.get(String(log.shot_number || log.shotNumber || "").trim()) || null
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
