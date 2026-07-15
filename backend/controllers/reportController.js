/**
 * reportController.js
 * Controller for industrial reports.
 * Uses the new modular report system in services/report/
 */

const {
  runIndustrialExport,
  fetchProductionData,
  getPlcReadingColumns,
  fetchPlcShotSummary,
} = require("../services/report/reportExportService");
const { calculateProductionMetrics } = require("../services/report/reportMetricsService");
const Shift = require("../models/Shift");

const REPORT_CACHE_TTL_MS = Math.max(Number(process.env.REPORT_CACHE_TTL_MS || 60000), 1000);
const reportDataCache = new Map();
const reportDataInFlight = new Map();

function reportCacheKey(filters = {}, options = {}) {
  const source = {
    ...filters,
    __includePlcReadings: options.includePlcReadings !== false,
    __includePlcSummary: options.includePlcSummary !== false,
    __includeLeaktest: options.includeLeaktest !== false,
    __maxAnchorParts: options.maxAnchorParts || "",
    __maxBaseLogs: options.maxBaseLogs || "",
  };
  return JSON.stringify(Object.keys(source).sort().reduce((acc, key) => {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") acc[key] = value;
    return acc;
  }, {}));
}

async function getCachedReportBundle(filters = {}, options = {}) {
  const cleanFilters = stripReportControlFilters(filters);
  const key = reportCacheKey(cleanFilters, options);
  const cached = reportDataCache.get(key);
  if (cached && Date.now() - cached.savedAt < REPORT_CACHE_TTL_MS) return cached.bundle;
  if (reportDataInFlight.has(key)) return reportDataInFlight.get(key);
  const request = Promise.all([
    fetchProductionData(cleanFilters, {
      includePlcReadings: options.includePlcReadings !== false,
      includeLeaktest: options.includeLeaktest !== false,
      maxAnchorParts: options.maxAnchorParts,
      maxBaseLogs: options.maxBaseLogs,
    }),
    Shift.findAll({
      where: { is_active: true },
      attributes: ["id", "shift_name", "shift_code", "start_time", "end_time"],
      order: [["start_time", "ASC"]],
      raw: true,
    }),
    options.includePlcReadings === false ? Promise.resolve(new Set()) : getPlcReadingColumns(),
    options.includePlcSummary === false ? Promise.resolve(null) : fetchPlcShotSummary(cleanFilters),
  ])
    .then(([rows, shifts, plcColumnSet, plcShotSummary]) => {
      const metrics = calculateProductionMetrics(rows);
      metrics.plcShotSummary = options.includePlcSummary !== false
        ? (plcShotSummary || { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 })
        : { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 };
      metrics.plcShotSummarySource = options.includePlcSummary === false
        ? "SKIPPED_FAST"
        : "PLC_SUMMARY";
      const bundle = { rows, shifts, plcColumnSet, metrics };
      reportDataCache.set(key, { bundle, savedAt: Date.now() });
      if (reportDataCache.size > 40) {
        const oldestKey = reportDataCache.keys().next().value;
        reportDataCache.delete(oldestKey);
      }
      return bundle;
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

function stripReportControlFilters(filters = {}) {
  const {
    page,
    pageSize,
    limit,
    offset,
    fast,
    quick,
    includePlcReadings,
    includePlcSummary,
    includeLeaktest,
    ...rest
  } = filters || {};
  void page; void pageSize; void limit; void offset; void fast; void quick; void includePlcReadings; void includePlcSummary;
  return rest;
}

function isTruthyToken(value) {
  return ["1", "TRUE", "YES", "Y", "FAST"].includes(String(value || "").trim().toUpperCase());
}

function isFalseToken(value) {
  return ["0", "FALSE", "NO", "N"].includes(String(value || "").trim().toUpperCase());
}

function getReportOptions(query = {}) {
  const hasFocusedPartSearch = Boolean(String(query.barcode || query.customerCode || query.partId || "").trim());
  const fullRequested = isTruthyToken(query.full || query.fullReport) || String(query.mode || "").trim().toUpperCase() === "FULL";
  const fastDisabled = fullRequested || isFalseToken(query.fast || query.quick);
  const fast = !fastDisabled && !hasFocusedPartSearch;
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize || query.limit, 10) || 50, 10), 10000);
  const fastAnchorLimit = Math.min(Math.max(page * pageSize * 10, pageSize * 10, 1000), 20000);
  return {
    fast,
    includePlcReadings: !isFalseToken(query.includePlcReadings),
    includePlcSummary: !isFalseToken(query.includePlcSummary),
    includeLeaktest: !isFalseToken(query.includeLeaktest),
    maxAnchorParts: fast ? fastAnchorLimit : null,
    maxBaseLogs: fast ? Math.min(Math.max(fastAnchorLimit * 8, 5000), 50000) : null,
  };
}

function getReportExportOptions(filters = {}) {
  const hasFocusedPartSearch = Boolean(String(filters.barcode || filters.customerCode || filters.partId || "").trim());
  const fast = isTruthyToken(filters.fast || filters.quick) && !hasFocusedPartSearch;
  const rawLimit = Number.parseInt(filters.exportLimit || filters.maxAnchorParts || filters.pageSize || filters.limit, 10);
  const exportAnchorLimit = Math.min(Math.max(rawLimit || 10000, 500), 20000);
  return {
    fast,
    includePlcReadings: !isFalseToken(filters.includePlcReadings),
    includePlcSummary: fast ? false : !isFalseToken(filters.includePlcSummary),
    includeLeaktest: !isFalseToken(filters.includeLeaktest),
    maxAnchorParts: fast ? exportAnchorLimit : null,
    maxBaseLogs: fast ? Math.min(Math.max(exportAnchorLimit * 8, 10000), 80000) : null,
  };
}

function getPagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSizeRaw = Number.parseInt(query.pageSize || query.limit, 10) || 50;
  const pageSize = Math.min(Math.max(pageSizeRaw, 10), 10000);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function getReportPartKey(row = {}, fallback = "") {
  return String(row.reportGroupKey || row.report_group_key || row.traceabilityPartId || row.traceability_part_id || row.partId || row.part_id || row.barcode || row.shot_uid || fallback || "").trim();
}

function normalizeShotStatusBucket(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  const numeric = Number(raw);
  if (numeric === 1 || ["OK", "GOOD", "PASS", "PASSED"].includes(raw)) return "ok";
  if (numeric === 3 || raw.includes("WARM")) return "warmUp";
  if (numeric === 5 || raw.includes("OFF") || raw.includes("OFFSET")) return "off";
  return "other";
}

function derivePlcShotSummaryFromRows(rows = []) {
  const summary = { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 };
  const seen = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const plc = row?.plcReading || row?.plc_reading || row?.plcReadings || row?.plcCycleReadings || row?.plc_cycle_readings || {};
    const shotNumber = String(plc.shot_number ?? row.shot_number ?? row.shotNumber ?? "").trim();
    const shotStatus = plc.shot_status ?? row.shot_status;
    if (!shotNumber && (shotStatus === undefined || shotStatus === null || shotStatus === "")) continue;

    const key = [
      shotNumber || getReportPartKey(row, ""),
      String(plc.recorded_at || plc.recordedAt || plc.shot_date || row.createdAt || "").trim(),
      String(shotStatus ?? "").trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    summary.totalProduction += 1;
    const bucket = normalizeShotStatusBucket(shotStatus);
    if (bucket === "ok") summary.okShot += 1;
    else if (bucket === "warmUp") summary.warmUpShot += 1;
    else if (bucket === "off") summary.offShot += 1;
  }

  return summary;
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
    scannedAt: groupRows.reduce((earliest, row) => {
      const value = new Date(row.firstScanCreatedAt || row.createdAt || row.latestAnchorCreatedAt || row.updatedAt || 0).getTime() || 0;
      return earliest === 0 ? value : Math.min(earliest, value || earliest);
    }, 0),
  }));

  groups.sort((a, b) => b.scannedAt - a.scannedAt);

  const localTotalRows = groups.length;
  const totalRows = localTotalRows;
  const totalPages = Math.max(1, Math.ceil(totalRows / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const offset = (page - 1) * pagination.pageSize;
  const pagedRows = groups
    .slice(offset, offset + pagination.pageSize)
    .flatMap((group) => group.rows.map((row) => ({
      ...row,
      __reportPageGroupKey: group.key,
    })));

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
    const options = getReportOptions(req.query || {});
    const filters = stripReportControlFilters(req.query || {});
    const pagination = getPagination(req.query || {});
    const { rows, shifts, plcColumnSet, metrics } = await getCachedReportBundle(filters, options);
    const paged = paginateReportRowsByPart(rows, pagination);
    metrics.plcShotSummary = metrics.plcShotSummary || {};
    metrics.plcShotSummarySource = metrics.plcShotSummarySource || "REPORT_ROWS";
    
    res.json({
      rows: paged.rows,
      metrics,
      pagination: paged.pagination,
      plcColumns: [...plcColumnSet],
      reportMode: options.fast ? "FAST" : "FULL",
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
    try {
      const filters = stripReportControlFilters(req.query || {});
      const pagination = getPagination(req.query || {});
      const fallbackOptions = {
        ...getReportOptions(req.query || {}),
        includePlcReadings: false,
        includeLeaktest: false,
        includePlcSummary: false,
      };
      const { rows, shifts, plcColumnSet, metrics } = await getCachedReportBundle(filters, fallbackOptions);
      const paged = paginateReportRowsByPart(rows, pagination);
      return res.json({
        rows: paged.rows,
        metrics: {
          ...metrics,
          plcShotSummary: { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 },
          plcShotSummarySource: "SKIPPED_FALLBACK",
        },
        pagination: paged.pagination,
        plcColumns: [...plcColumnSet],
        reportMode: "FALLBACK_FAST",
        warning: "Report loaded in fast mode because detailed PLC/leak enrichment was unavailable for this range.",
        availableShifts: shifts.map((shift) => ({
          id: shift.id,
          shiftName: shift.shift_name,
          shiftCode: shift.shift_code,
          startTime: shift.start_time,
          endTime: shift.end_time,
        })),
      });
    } catch (fallbackError) {
      const fallbackDb = summarizeDbError(fallbackError);
      console.error(`[ReportController] getReportData fallback failed code=${fallbackDb.code} msg=${fallbackDb.message}`);
      res.status(500).json({ error: fallbackDb.message });
    }
  }
};

exports.exportFullReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = DEFAULT_REPORT_CONFIG } = req.body || {};
    req.setTimeout?.(10 * 60 * 1000);
    res.setTimeout?.(10 * 60 * 1000);
    const options = getReportExportOptions(filters);
    await runIndustrialExport(res, {
      filters,
      reportConfig,
      type: "full",
      options,
    });
  } catch (error) {
    console.error("Excel export error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.exportNGReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = DEFAULT_REPORT_CONFIG } = req.body || {};
    req.setTimeout?.(10 * 60 * 1000);
    res.setTimeout?.(10 * 60 * 1000);
    const ngFilters = { ...filters, resultType: "NG" };
    const options = getReportExportOptions(ngFilters);
    await runIndustrialExport(res, {
      filters: ngFilters,
      reportConfig,
      type: "ng",
      options,
    });
  } catch (error) {
    console.error("NG Excel export error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.exportPartsReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = DEFAULT_REPORT_CONFIG } = req.body || {};
    req.setTimeout?.(10 * 60 * 1000);
    res.setTimeout?.(10 * 60 * 1000);
    const options = getReportExportOptions(filters);
    await runIndustrialExport(res, {
      filters,
      reportConfig,
      type: "parts",
      options,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportAuditReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = DEFAULT_REPORT_CONFIG } = req.body || {};
    req.setTimeout?.(10 * 60 * 1000);
    res.setTimeout?.(10 * 60 * 1000);
    const options = getReportExportOptions(filters);
    await runIndustrialExport(res, {
      filters,
      reportConfig,
      type: "audit",
      options,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports._private = {
  derivePlcShotSummaryFromRows,
};
