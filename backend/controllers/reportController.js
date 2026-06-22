/**
 * reportController.js
 * Controller for industrial reports.
 * Uses the new modular report system in services/report/
 */

const { runIndustrialExport, fetchProductionData, getPlcReadingColumns } = require("../services/report/reportExportService");
const { calculateProductionMetrics } = require("../services/report/reportMetricsService");
const Shift = require("../models/Shift");

const REPORT_CACHE_TTL_MS = Math.max(Number(process.env.REPORT_CACHE_TTL_MS || 15000), 1000);
const reportDataCache = new Map();
const reportDataInFlight = new Map();

function reportCacheKey(filters = {}) {
  return JSON.stringify(Object.keys(filters).sort().reduce((acc, key) => {
    const value = filters[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") acc[key] = value;
    return acc;
  }, {}));
}

async function getCachedReportRows(filters = {}) {
  const key = reportCacheKey(filters);
  const cached = reportDataCache.get(key);
  if (cached && Date.now() - cached.savedAt < REPORT_CACHE_TTL_MS) return cached.rows;
  if (reportDataInFlight.has(key)) return reportDataInFlight.get(key);
  const request = fetchProductionData(filters)
    .then((rows) => {
      reportDataCache.set(key, { rows, savedAt: Date.now() });
      if (reportDataCache.size > 40) {
        const oldestKey = reportDataCache.keys().next().value;
        reportDataCache.delete(oldestKey);
      }
      return rows;
    })
    .finally(() => reportDataInFlight.delete(key));
  reportDataInFlight.set(key, request);
  return request;
}

function summarizeDbError(error) {
  const code = error?.original?.code || error?.parent?.code || error?.code || "UNKNOWN";
  const msg = error?.original?.message || error?.parent?.message || error?.message || "Database error";
  return { code, message: msg };
}

const DEFAULT_REPORT_CONFIG = {
  companyName: "BMW Group",
  plantName: "Gen-6 Bawal Plant",
  projectTitle: "Traceability System",
  reportTitle: "Production Report",
  logoUrl: "",
  headerLine1: "BMW India Private Limited",
  headerLine2: "Quality & Production Traceability",
  footerText: "Confidential - Internal Use Only",
  location: "Bawal, Haryana, India",
  preparedBy: "",
  approvedBy: "",
  department: "Quality Engineering",
  showLogo: true,
  showDate: true,
  showShift: true,
  showMachine: true
};

exports.getReportData = async (req, res) => {
  try {
    const filters = req.query || {};
    const [rows, shifts, plcColumnSet] = await Promise.all([
      getCachedReportRows(filters),
      Shift.findAll({ where: { is_active: true }, order: [["start_time", "ASC"]], raw: true }),
      getPlcReadingColumns(),
    ]);
    const metrics = calculateProductionMetrics(rows);
    
    res.json({
      rows,
      metrics,
      plcColumns: [...plcColumnSet],
      availableShifts: shifts.map((shift) => ({
        id: shift.id,
        shiftName: shift.shift_name,
        shiftCode: shift.shift_code,
        startTime: shift.start_time,
        endTime: shift.end_time,
      })),
    });
  } catch (error) {
    const db = summarizeDbError(error);
    console.error(`[ReportController] getReportData failed code=${db.code} msg=${db.message}`);
    res.status(500).json({ error: db.message });
  }
};

exports.exportFullReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = DEFAULT_REPORT_CONFIG } = req.body || {};
    await runIndustrialExport(res, {
      filters,
      reportConfig,
      type: "full"
    });
  } catch (error) {
    console.error("Excel export error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.exportNGReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = DEFAULT_REPORT_CONFIG } = req.body || {};
    await runIndustrialExport(res, {
      filters: { ...filters, resultType: "NG" },
      reportConfig,
      type: "ng"
    });
  } catch (error) {
    console.error("NG Excel export error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.exportPartsReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = DEFAULT_REPORT_CONFIG } = req.body || {};
    await runIndustrialExport(res, {
      filters,
      reportConfig,
      type: "parts"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportAuditReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = DEFAULT_REPORT_CONFIG } = req.body || {};
    await runIndustrialExport(res, {
      filters,
      reportConfig,
      type: "audit"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
