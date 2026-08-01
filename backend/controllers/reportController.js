/**
 * reportController.js
 * Controller for industrial reports.
 * Uses the new modular report system in services/report/
 */

const {
  runIndustrialExport,
  fetchProductionData,
  fetchProductionFirstScanPartCount,
  fetchProductionSummaryMetrics,
  getPlcReadingColumns,
  fetchPlcShotSummary,
} = require("../services/report/reportExportService");
const { calculateProductionMetrics } = require("../services/report/reportMetricsService");
const Shift = require("../models/Shift");

async function getLegacyReportBundle(cleanFilters = {}, options = {}) {
  const [rows, shifts, plcColumnSet, plcShotSummary] = await Promise.all([
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
  ]);
  const metrics = calculateProductionMetrics(rows, cleanFilters);
  metrics.plcShotSummary = options.includePlcSummary !== false
    ? (plcShotSummary || { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 })
    : { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 };
  metrics.plcShotSummarySource = options.includePlcSummary === false
    ? "SKIPPED_FAST"
    : "PLC_SUMMARY";
  return { rows, shifts, plcColumnSet, metrics, source: "LEGACY" };
}

async function getLiveReportBundle(filters = {}, options = {}) {
  const cleanFilters = stripReportControlFilters(filters);
  return getLegacyReportBundle(cleanFilters, options);
}

function stripMetricStatusFilters(filters = {}) {
  const {
    status,
    resultType,
    statusFilter,
    ...rest
  } = filters || {};
  void status; void resultType; void statusFilter;
  return rest;
}

function getStatusFilterTokens(...values) {
  return [...new Set(values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean))];
}

function scopeMetricsToStatusFilter(metrics = {}, filters = {}) {
  const tokens = getStatusFilterTokens(filters.status, filters.resultType, filters.statusFilter);
  if (!tokens.length) return metrics;
  const next = { ...(metrics || {}) };
  const wantsOk = tokens.some((token) => ["OK", "PASSED", "PASS"].includes(token));
  const wantsNg = tokens.some((token) => ["NG", "FAILED", "FAIL"].includes(token));
  const wantsProgress = tokens.some((token) => ["PENDING", "IN_PROGRESS", "IN PROGRESS", "ACTIVE"].includes(token));
  if (wantsOk && !wantsNg && !wantsProgress) {
    next.traceabilityProduction = Number(next.totalOK || 0);
    next.totalProduction = next.traceabilityProduction;
    next.totalNG = 0;
    next.inProgress = 0;
    next.validationRejects = 0;
  } else if (wantsNg && !wantsOk && !wantsProgress) {
    next.traceabilityProduction = Number(next.totalNG || 0);
    next.totalProduction = next.traceabilityProduction;
    next.totalOK = 0;
    next.inProgress = 0;
    next.validationRejects = next.traceabilityProduction;
  } else if (wantsProgress && !wantsOk && !wantsNg) {
    next.traceabilityProduction = Number(next.inProgress || 0);
    next.totalProduction = next.traceabilityProduction;
    next.totalOK = 0;
    next.totalNG = 0;
    next.validationRejects = 0;
  }
  const productionBase = Number(next.totalOK || 0) + Number(next.totalNG || 0);
  next.passRate = productionBase > 0 ? Number(((Number(next.totalOK || 0) / productionBase) * 100).toFixed(2)) : 0;
  return next;
}

async function applyUncappedTraceabilityMetrics(metrics = {}, filters = {}) {
  const nextMetrics = { ...(metrics || {}) };
  const hasEnrichedPartScope = Boolean(
    filters.partName ||
    filters.part_name ||
    filters.dieName ||
    filters.die_name ||
    filters.dieCastingMachine ||
    filters.die_casting_machine ||
    filters.partType
  );
  if (hasEnrichedPartScope) {
    return scopeMetricsToStatusFilter(nextMetrics, filters);
  }
  const productionFilters = stripMetricStatusFilters(filters);
  const [summaryMetrics, totalProduction] = await Promise.all([
    fetchProductionSummaryMetrics(productionFilters).catch((error) => {
      console.warn(`[ReportController] traceability SQL summary skipped: ${error.message}`);
      return null;
    }),
    fetchProductionFirstScanPartCount(productionFilters).catch((error) => {
      console.warn(`[ReportController] first-scan production total skipped: ${error.message}`);
      return null;
    }),
  ]);

  if (summaryMetrics) {
    nextMetrics.totalOK = Number(summaryMetrics.totalOK || 0);
    nextMetrics.totalNG = Number(summaryMetrics.totalNG || 0);
    nextMetrics.inProgress = Number(summaryMetrics.inProgress || 0);
    nextMetrics.validationRejects = Number(summaryMetrics.validationRejects || nextMetrics.totalNG || 0);
    nextMetrics.passRate = Number(summaryMetrics.passRate || 0);
  }

  const normalizedTotal = Number(totalProduction);
  if (Number.isFinite(normalizedTotal) && normalizedTotal >= 0) {
    nextMetrics.traceabilityProduction = normalizedTotal;
    nextMetrics.totalProduction = normalizedTotal;
  }
  return scopeMetricsToStatusFilter(nextMetrics, filters);
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
    noCache,
    refresh,
    forceFresh,
    cacheBust,
    _ts,
    includePlcReadings,
    includePlcSummary,
    includeLeaktest,
    clean,
    professional,
    format,
    ...rest
  } = filters || {};
  void page; void pageSize; void limit; void offset; void fast; void quick; void noCache; void refresh; void forceFresh; void cacheBust; void _ts; void includePlcReadings; void includePlcSummary; void includeLeaktest; void clean; void professional; void format;
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
  const fastAnchorLimit = Math.min(Math.max((page + 1) * pageSize, pageSize, 500), 5000);
  return {
    fast,
    includePlcReadings: fast ? isTruthyToken(query.includePlcReadings) : !isFalseToken(query.includePlcReadings),
    includePlcSummary: !isFalseToken(query.includePlcSummary),
    includeLeaktest: fast ? isTruthyToken(query.includeLeaktest) : !isFalseToken(query.includeLeaktest),
    maxAnchorParts: fast ? fastAnchorLimit : null,
    maxBaseLogs: fast ? Math.min(Math.max(fastAnchorLimit * 4, 2000), 20000) : null,
  };
}

function getReportExportOptions(filters = {}) {
  const hasFocusedPartSearch = Boolean(String(filters.barcode || filters.customerCode || filters.partId || "").trim());
  const fast = isTruthyToken(filters.fast || filters.quick) && !hasFocusedPartSearch;
  const rawLimit = Number.parseInt(filters.exportLimit || filters.maxAnchorParts || filters.pageSize || filters.limit, 10);
  const exportAnchorLimit = Math.min(Math.max(rawLimit || 20000, 500), 50000);
  return {
    fast,
    includePlcReadings: !isFalseToken(filters.includePlcReadings),
    includePlcSummary: fast ? false : !isFalseToken(filters.includePlcSummary),
    includeLeaktest: !isFalseToken(filters.includeLeaktest),
    maxAnchorParts: fast ? exportAnchorLimit : null,
    maxBaseLogs: fast ? Math.min(Math.max(exportAnchorLimit * 6, 10000), 250000) : null,
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

function wantsCleanReportResponse(query = {}) {
  const format = String(query.format || "").trim().toUpperCase();
  return isTruthyToken(query.clean || query.professional) || ["CLEAN", "PROFESSIONAL", "PUBLIC"].includes(format);
}

function cleanValue(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

function cleanStatus(value) {
  const token = String(value || "").trim().toUpperCase();
  if (!token) return null;
  if (["OK", "PASS", "PASSED", "COMPLETED", "ENDED_OK", "COMPLETED_OK"].includes(token)) return "OK";
  if (["NG", "NOK", "FAIL", "FAILED", "REJECTED", "INTERLOCKED", "ENDED_NG", "COMPLETED_NG"].includes(token)) return "NG";
  if (token.includes("IN_PROGRESS") || token.includes("IN PROGRESS")) return "IN_PROGRESS";
  return token;
}

function cleanShotStatus(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  const numeric = Number(raw);
  if (numeric === 1 || ["OK", "GOOD", "PASS", "PASSED"].includes(raw)) return "OK";
  if (numeric === 3 || raw.includes("WARM")) return "WARM_UP_SHOT";
  if (numeric === 5 || raw.includes("OFF") || raw.includes("OFFSET")) return "NG_SHOT";
  if (["NG", "NOK", "FAIL", "FAILED", "REJECTED"].includes(raw)) return "NG_SHOT";
  return raw || null;
}

function pickObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function cleanLeakTest(reading, readings) {
  const list = Array.isArray(readings) ? readings.filter(Boolean) : (reading ? [reading] : []);
  if (!list.length) return null;
  return list.map((item) => ({
    machine: cleanValue(item.Machine || item.machineName || item.matchedMachineName),
    result: cleanStatus(item.Result || item.result),
    bodyLeakValue: cleanValue(item.Body_Leak_Value),
    gall1: cleanValue(item.Gall_1),
    gall2: cleanValue(item.Gall_2),
    cycleTime: cleanValue(item.Cycle_Time),
    cycleEndAt: cleanValue(item.Cycle_End_Time || item.cycleEndTime || item.updatedAt || item.createdAt),
    runningMode: cleanValue(item.Running_Mode),
  }));
}

function formatCleanReportResponse(payload = {}) {
  const metrics = payload.metrics || {};
  const records = (Array.isArray(payload.rows) ? payload.rows : []).map((row, index) => {
    const plc = pickObject(row.plcReading, row.plc_reading, row.plcReadings, row.plcCycleReadings, row.plc_cycle_readings);
    const shotStatusRaw = plc.shot_status ?? row.shot_status ?? row.shotStatus;
    return {
      serialNo: cleanValue(row.srNo, index + 1),
      part: {
        id: cleanValue(row.partId || row.displayPartId || row.traceabilityPartId || row.part_id),
        customerQr: cleanValue(row.customerQrCode || row.customerCode || row.customer_qr),
        name: cleanValue(row.partName),
        die: cleanValue(row.dieName),
        label: cleanValue(row.partDieLabel || plc.part_name),
        status: cleanStatus(row.partStatus || row.status),
      },
      production: {
        firstScanAt: cleanValue(row.firstScanCreatedAt || row.createdAtRaw || row.createdAt),
        firstScanShift: cleanValue(row.firstScanShiftCode || row.shiftCode),
        latestActivityAt: cleanValue(row.latestAnchorCreatedAt || row.updatedAt || row.createdAtRaw || row.createdAt),
        line: cleanValue(row.lineName || row.anchorLineName),
      },
      station: {
        operation: cleanValue(row.operationNo || row.stationNo),
        name: cleanValue(row.machineName),
        result: cleanStatus(row.industrialResult || row.statusLabel || row.result),
        cycleStartAt: cleanValue(row.cycleStartTime),
        cycleEndAt: cleanValue(row.cycleEndTime),
        cycleTime: cleanValue(row.cycleTime),
      },
      shot: {
        number: cleanValue(row.shotNumber ?? row.shot_number ?? plc.shot_number),
        status: cleanShotStatus(shotStatusRaw),
        recordedAt: cleanValue(plc.recorded_at || plc.recordedAt),
        machine: cleanValue(plc.machine_name),
        partDie: cleanValue(plc.part_name),
        date: cleanValue(plc.shot_date),
        time: cleanValue(plc.shot_time),
        parameters: {
          cycleTime: cleanValue(plc.cycle_time),
          dieCloseCoreInTime: cleanValue(plc.die_close_core_in_time),
          pouringTime: cleanValue(plc.pouring_time),
          shotForwardTime: cleanValue(plc.shot_fwd_time),
          curingTime: cleanValue(plc.curing_time),
          dieOpenCoreOutTime: cleanValue(plc.die_open_core_out_time),
          ejectorTime: cleanValue(plc.ejector_time),
          extractTime: cleanValue(plc.extract_time),
          sprayTime: cleanValue(plc.spray_time),
          v1Speed: cleanValue(plc.v1_speed),
          v2Speed: cleanValue(plc.v2_speed),
          v3Speed: cleanValue(plc.v3_speed),
          v4Speed: cleanValue(plc.v4_speed),
          metalPressure: cleanValue(plc.metal_pressure),
          furnaceMetalTemp: cleanValue(plc.furnace_metal_temp),
          coolingWaterMoving: cleanValue(plc.cooling_water_mov),
          coolingWaterStationary: cleanValue(plc.cooling_water_sta),
          accelPoint: cleanValue(plc.accel_point),
          deaccelPoint: cleanValue(plc.deaccel_point),
          intensificationTime: cleanValue(plc.intensification_time),
          biscuitThickness: cleanValue(plc.biscuit_thickness),
          jetCoolingPressure: cleanValue(plc.jet_cooling_pressure),
          clampTonnage: cleanValue(plc.clamp_tonnage),
          vacuumPressure: cleanValue(plc.vacuum_pressure),
          stroke: cleanValue(plc.stroke),
        },
      },
      leakTest: cleanLeakTest(row.leakTestReading, row.leakTestReadings),
      rejection: {
        category: cleanValue(row.rejectionCategory || row.category),
        view: cleanValue(row.rejectionView),
        zone: cleanValue(row.rejectionZone),
        subZone: cleanValue(row.rejectionSubZone),
        reason: cleanValue(row.rejectionReason || row.reason),
        remark: cleanValue(row.rejectionRemark),
      },
    };
  });

  return {
    records,
    summary: {
      totalProduction: Number(metrics.totalProduction || metrics.traceabilityProduction || 0),
      passed: Number(metrics.totalOK || 0),
      failed: Number(metrics.totalNG || 0),
      inProgress: Number(metrics.inProgress || 0),
      passRate: Number(metrics.passRate || 0),
      shotSummary: {
        totalShots: Number(metrics.plcShotSummary?.totalProduction || 0),
        okShots: Number(metrics.plcShotSummary?.okShot || 0),
        warmUpShots: Number(metrics.plcShotSummary?.warmUpShot || 0),
        ngShots: Number(metrics.plcShotSummary?.offShot || 0),
        source: cleanValue(metrics.plcShotSummarySource, "UNKNOWN"),
      },
    },
    pagination: payload.pagination || {},
    reportMode: payload.reportMode || null,
    availableShifts: payload.availableShifts || [],
    warning: payload.warning || undefined,
  };
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
    const { rows, shifts, plcColumnSet, metrics } = await getLiveReportBundle(filters, options);
    const paged = paginateReportRowsByPart(rows, pagination);
    const responseMetrics = await applyUncappedTraceabilityMetrics(metrics, filters);
    responseMetrics.plcShotSummary = responseMetrics.plcShotSummary || {};
    responseMetrics.plcShotSummarySource = responseMetrics.plcShotSummarySource || "REPORT_ROWS";

    const payload = {
      rows: paged.rows,
      metrics: responseMetrics,
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
    };
    res.json(wantsCleanReportResponse(req.query || {}) ? formatCleanReportResponse(payload) : payload);
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
      const { rows, shifts, plcColumnSet, metrics } = await getLiveReportBundle(filters, fallbackOptions);
      const paged = paginateReportRowsByPart(rows, pagination);
      const responseMetrics = await applyUncappedTraceabilityMetrics(metrics, filters);
      const fallbackPayload = {
        rows: paged.rows,
        metrics: {
          ...responseMetrics,
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
      };
      return res.json(wantsCleanReportResponse(req.query || {}) ? formatCleanReportResponse(fallbackPayload) : fallbackPayload);
    } catch (fallbackError) {
      const fallbackDb = summarizeDbError(fallbackError);
      console.error(`[ReportController] getReportData fallback failed code=${fallbackDb.code} msg=${fallbackDb.message}`);
      res.status(500).json({ error: fallbackDb.message });
    }
  }
};

exports.getPublicReportData = async (req, res) => {
  req.query = {
    ...req.query,
    fast: req.query.fast ?? "1",
    includePlcSummary: req.query.includePlcSummary ?? "1",
    includePlcReadings: req.query.includePlcReadings ?? "1",
    includeLeaktest: req.query.includeLeaktest ?? "1",
    noCache: "1",
  };
  return exports.getReportData(req, res);
};

exports.getReportShotSummary = async (req, res) => {
  try {
    const filters = stripReportControlFilters(req.query || {});
    const plcShotSummary = await fetchPlcShotSummary(filters);
    res.json({
      plcShotSummary: plcShotSummary || { totalProduction: 0, okShot: 0, warmUpShot: 0, offShot: 0 },
      plcShotSummarySource: "PLC_SUMMARY",
    });
  } catch (error) {
    const db = summarizeDbError(error);
    console.error(`[ReportController] getReportShotSummary failed code=${db.code} msg=${db.message}`);
    res.status(500).json({ error: db.message });
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
    if (!res.headersSent) res.status(500).json({ error: error.message });
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
    if (!res.headersSent) res.status(500).json({ error: error.message });
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
    if (!res.headersSent) res.status(500).json({ error: error.message });
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
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
};

exports._private = {
  derivePlcShotSummaryFromRows,
};
