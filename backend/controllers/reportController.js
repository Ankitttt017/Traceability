/**
 * reportController.js
 * Controller for industrial reports.
 * Uses the new modular report system in services/report/
 */

const { runIndustrialExport, fetchProductionData, getPlcReadingColumns, fetchPlcShotSummary } = require("../services/report/reportExportService");
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
  const key = reportCacheKey(stripPaginationFilters(filters));
  const cached = reportDataCache.get(key);
  if (cached && Date.now() - cached.savedAt < REPORT_CACHE_TTL_MS) return cached.rows;
  if (reportDataInFlight.has(key)) return reportDataInFlight.get(key);
  const request = fetchProductionData(stripPaginationFilters(filters))
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

function stripPaginationFilters(filters = {}) {
  const { page, pageSize, limit, offset, ...rest } = filters || {};
  void page; void pageSize; void limit; void offset;
  return rest;
}

function getPagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSizeRaw = Number.parseInt(query.pageSize || query.limit, 10) || 50;
  const pageSize = Math.min(Math.max(pageSizeRaw, 10), 200);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function getReportPartKey(row = {}, fallback = "") {
  return String(row.partId || row.part_id || row.barcode || row.shot_uid || fallback || "").trim();
}

function paginateReportRowsByPart(rows = [], pagination = {}) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = getReportPartKey(row, `row_${grouped.size}`);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const groups = Array.from(grouped.entries()).map(([key, groupRows]) => ({
    key,
    rows: groupRows,
    latestAt: groupRows.reduce((latest, row) => {
      const value = new Date(row.latestAnchorCreatedAt || row.createdAt || row.updatedAt || 0).getTime() || 0;
      return Math.max(latest, value);
    }, 0),
  }));

  groups.sort((a, b) => b.latestAt - a.latestAt);

  const totalRows = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const offset = (page - 1) * pagination.pageSize;
  const pagedRows = groups
    .slice(offset, offset + pagination.pageSize)
    .flatMap((group) => group.rows);

  return {
    rows: pagedRows,
    pagination: {
      page,
      pageSize: pagination.pageSize,
      totalRows,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
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
    const filters = stripPaginationFilters(req.query || {});
    const pagination = getPagination(req.query || {});
    const [rows, shifts, plcColumnSet, plcShotSummary] = await Promise.all([
      getCachedReportRows(filters),
      Shift.findAll({
        where: { is_active: true },
        attributes: ["id", "shift_name", "shift_code", "start_time", "end_time"],
        order: [["start_time", "ASC"]],
        raw: true,
      }),
      getPlcReadingColumns(),
      fetchPlcShotSummary(filters),
    ]);
    const metrics = calculateProductionMetrics(rows);
    metrics.plcShotSummary = plcShotSummary;
    const paged = paginateReportRowsByPart(rows, pagination);
    
    res.json({
      rows: paged.rows,
      metrics,
      pagination: paged.pagination,
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
