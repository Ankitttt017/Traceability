const { Op } = require("sequelize");
const ProductionReport = require("../models/ProductionReport");

exports.getHistoricalReportData = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(Number.parseInt(req.query.pageSize || req.query.limit, 10) || 1000, 10);
    const offset = (page - 1) * pageSize;

    // Build fast filter
    const where = {};
    if (req.query.dateFrom && req.query.dateTo) {
      where.first_scan_at = {
        [Op.gte]: new Date(req.query.dateFrom),
        [Op.lte]: new Date(req.query.dateTo),
      };
    }

    if (req.query.barcode || req.query.customerCode || req.query.partId) {
       const term = req.query.barcode || req.query.customerCode || req.query.partId;
       where[Op.or] = [
         { part_id: { [Op.like]: `%${term}%` } },
         { customer_qr: { [Op.like]: `%${term}%` } }
       ];
    }
    
    if (req.query.status) {
       where.overall_status = req.query.status.toUpperCase();
    }

    if (req.query.shiftCode) {
       where.shift_code = req.query.shiftCode;
    }

    if (req.query.partName) {
       where.part_name = req.query.partName;
    }

    if (req.query.category) {
       where.rejection_category = req.query.category;
    }

    let stationScope = String(req.query.machineId || req.query.operationNo || req.query.stationNo || req.query.station || "").trim().toUpperCase();
    if (stationScope && !/^OP\d{3}$/i.test(stationScope)) {
      try {
        const Machine = require("../models/Machine");
        const resolvedMachine = await Machine.findOne({ 
          where: { machine_name: req.query.machineId || req.query.operationNo || req.query.stationNo || req.query.station },
          attributes: ['operation_no'],
          raw: true
        });
        if (resolvedMachine && resolvedMachine.operation_no) {
          stationScope = String(resolvedMachine.operation_no).toUpperCase();
        }
      } catch (err) { void err; }
    }

    if (stationScope) {
      where.station_keys = {
        [Op.like]: `%${stationScope}%`
      };
    }
    
    // 1. Fetch Paginated Rows
    const { count, rows } = await ProductionReport.findAndCountAll({
      where,
      limit: pageSize,
      offset: offset,
      order: [["first_scan_at", "DESC"]],
      raw: true,
    });

    // 2. Fetch Lightning Fast Metrics
    // If we are filtering by a specific Quality Gate (OP code), aggregate based on that specific station's status
    const isOpScope = /^OP\d{3}$/i.test(stationScope);
    const statusCol = isOpScope ? stationScope.toLowerCase() + '_status' : 'overall_status';

    const metricsResult = await ProductionReport.findAll({
      where,
      attributes: [
        [ProductionReport.sequelize.col(statusCol), 'overall_status'],
        [ProductionReport.sequelize.fn('COUNT', ProductionReport.sequelize.col('id')), 'count']
      ],
      group: [statusCol],
      raw: true,
    });

    const { getPlcReadingColumns } = require("../services/report/reportExportService");
    const plcColumnSet = await getPlcReadingColumns();

    let totalProduction = 0;
    let totalOK = 0;
    let totalNG = 0;
    let inProgress = 0;

    metricsResult.forEach(row => {
      const status = row.overall_status;
      const cnt = Number(row.count) || 0;
      totalProduction += cnt;
      if (status === 'OK' || status === 'PASSED') totalOK += cnt;
      else if (status === 'NG' || status === 'FAILED') totalNG += cnt;
      else inProgress += cnt;
    });

    const passRate = totalProduction > 0 ? Number(((totalOK / totalProduction) * 100).toFixed(2)) : 0;

    // 3. Format rows back exactly as the UI expects (array of OperationLog arrays)
    // The Master Table stored the raw OperationLog entries array in `raw_logs` for this part.
    // The UI's `paginateReportRowsByPart` grouping logic expects an array of these raw OperationLog entries.
    // So we just flatten the `raw_logs` array of arrays into a single array of raw logs, 
    // exactly like `getLegacyReportBundle` would return!
    const formattedRows = rows.flatMap(row => {
      let rawLogs = row.raw_logs ? (typeof row.raw_logs === 'string' ? JSON.parse(row.raw_logs) : row.raw_logs) : [];

      // Sort logs chronologically to ensure trimming works correctly
      rawLogs.sort((a, b) => {
        const tA = new Date(a.createdAt || a.plc_end_time || 0).getTime();
        const tB = new Date(b.createdAt || b.plc_end_time || 0).getTime();
        return tA - tB;
      });
      
      // Trim data table: if a quality gate is selected, hide all stations that occurred AFTER it
      if (stationScope) {
        let targetIndex = rawLogs.length - 1;
        // Search backwards to find the last occurrence of the selected station
        for (let i = rawLogs.length - 1; i >= 0; i--) {
          const op = String(rawLogs[i].operationNo || rawLogs[i].stationNo || rawLogs[i].operation_no || rawLogs[i].station_no || "").trim().toUpperCase();
          if (op === stationScope || String(rawLogs[i].machine_id).toUpperCase() === stationScope || String(rawLogs[i].machineId).toUpperCase() === stationScope) {
            targetIndex = i;
            break;
          }
        }
        rawLogs = rawLogs.slice(0, targetIndex + 1);

        // If the sliced logs don't include the Leak Test station, don't show future leak test results
        const hasLeakTest = rawLogs.some(log => {
          const op = String(log.operationNo || log.stationNo || log.operation_no || log.station_no || "").trim().toUpperCase();
          return op === "OP150" || op === "LEAKTEST";
        });
        if (!hasLeakTest) {
          rawLogs.forEach(log => {
            delete log.leakTestReadings;
            delete log.leakTestReading;
            delete log.leak_data;
          });
        }
      }

      // Clean up legacy duplicate leak test structures to prevent showing double in Postman
      rawLogs.forEach(log => {
        if (log.leakTestReadings && log.leakTestReading) {
          delete log.leakTestReading; // We only need the array version
        }
      });
      return rawLogs;
    });

    res.json({
      rows: formattedRows,
      metrics: {
        totalProduction,
        totalOK,
        totalNG,
        passed: totalOK, // keeping for backward compatibility
        failed: totalNG,
        inProgress,
        passRate,
        shotSummary: { totalShots: 0, okShots: 0, warmUpShots: 0, ngShots: 0 }
      },
      pagination: {
        page,
        pageSize,
        totalRows: count,
        totalPages: Math.ceil(count / pageSize),
        hasNextPage: (page * pageSize) < count,
        hasPrevPage: page > 1,
      },
      plcColumns: [...plcColumnSet],
      reportMode: "HISTORICAL_MASTER",
      warning: undefined,
    });
  } catch (error) {
    console.error("[HistoricalReport] Error fetching historical report:", error);
    res.status(500).json({ error: error.message });
  }
};

const { syncDateRange } = require("../services/report/historicalSyncService");

exports.syncHistoricalData = async (req, res) => {
  try {
    let dateFrom, dateTo;
    if (req.body.dateFrom && req.body.dateTo) {
      dateFrom = new Date(req.body.dateFrom);
      dateTo = new Date(req.body.dateTo);
    } else {
      dateTo = new Date();
      dateFrom = new Date(dateTo.getTime() - 24 * 60 * 60 * 1000); // 24 hours back
    }
    
    // Kick off sync asynchronously so we don't block the request if it takes a while
    syncDateRange(dateFrom, dateTo).catch(err => {
      console.error("[HistoricalReport] Manual sync error:", err);
    });

    res.json({ message: "Sync started in the background", dateFrom, dateTo });
  } catch (error) {
    console.error("[HistoricalReport] Error triggering sync:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.exportHistoricalReportExcel = async (req, res) => {
  try {
    const { filters = {}, reportConfig = {}, type = "full" } = req.body || {};
    req.setTimeout?.(10 * 60 * 1000);
    res.setTimeout?.(10 * 60 * 1000);

    const { Op } = require("sequelize");
    const ProductionReport = require("../models/ProductionReport");
    const { buildStationPairsFromRows } = require("../services/report/stationPairBuilder");
    const { calculateProductionMetrics } = require("../services/report/reportMetricsService");
    const { generateIndustrialExcel } = require("../services/report/excelTemplateEngine");

    const where = {};
    if (filters.dateFrom && filters.dateTo) {
      where.first_scan_at = {
        [Op.gte]: new Date(filters.dateFrom),
        [Op.lte]: new Date(filters.dateTo),
      };
    }
    if (filters.barcode || filters.customerCode || filters.partId) {
       const term = filters.barcode || filters.customerCode || filters.partId;
       where[Op.or] = [
         { part_id: { [Op.like]: `%${term}%` } },
         { customer_qr: { [Op.like]: `%${term}%` } }
       ];
    }
    if (filters.status) {
       where.overall_status = filters.status.toUpperCase();
    }
    if (filters.shiftCode) {
       where.shift_code = filters.shiftCode;
    }
    let stationScope = String(filters.machineId || filters.operationNo || filters.stationNo || filters.station || "").trim().toUpperCase();
    if (stationScope && !/^OP\d{3}$/i.test(stationScope)) {
      try {
        const Machine = require("../models/Machine");
        const resolvedMachine = await Machine.findOne({ 
          where: { machine_name: filters.machineId || filters.operationNo || filters.stationNo || filters.station },
          attributes: ['operation_no'],
          raw: true
        });
        if (resolvedMachine && resolvedMachine.operation_no) {
          stationScope = String(resolvedMachine.operation_no).toUpperCase();
        }
      } catch (err) { void err; }
    }

    if (stationScope) {
      where.station_keys = {
        [Op.like]: `%${stationScope}%`
      };
    }

    const reports = await ProductionReport.findAll({
      where,
      order: [["first_scan_at", "DESC"]],
      raw: true,
    });

    const rows = [];
    for (const report of reports) {
      let rawLogs = report.raw_logs;
      if (typeof rawLogs === 'string') {
         try { rawLogs = JSON.parse(rawLogs); } catch(e) { rawLogs = []; }
      }
      if (Array.isArray(rawLogs)) {
        // Sort logs chronologically to ensure trimming works correctly
        rawLogs.sort((a, b) => {
          const tA = new Date(a.createdAt || a.plc_end_time || 0).getTime();
          const tB = new Date(b.createdAt || b.plc_end_time || 0).getTime();
          return tA - tB;
        });
        
        // Trim data table: if a quality gate is selected, hide all stations that occurred AFTER it
        if (stationScope) {
          let targetIndex = rawLogs.length - 1;
          for (let i = rawLogs.length - 1; i >= 0; i--) {
            const op = String(rawLogs[i].operationNo || rawLogs[i].stationNo || rawLogs[i].operation_no || rawLogs[i].station_no || "").trim().toUpperCase();
            if (op === stationScope || String(rawLogs[i].machine_id).toUpperCase() === stationScope || String(rawLogs[i].machineId).toUpperCase() === stationScope) {
              targetIndex = i;
              break;
            }
          }
          rawLogs = rawLogs.slice(0, targetIndex + 1);
          
          const hasLeakTest = rawLogs.some(log => {
            const op = String(log.operationNo || log.stationNo || log.operation_no || log.station_no || "").trim().toUpperCase();
            return op === "OP150" || op === "LEAKTEST";
          });
          if (!hasLeakTest) {
            rawLogs.forEach(log => {
              delete log.leakTestReadings;
              delete log.leakTestReading;
              delete log.leak_data;
            });
          }
        }

        rows.push(...rawLogs);
      }
    }

    const stationPairs = await buildStationPairsFromRows(rows, filters);
    const metrics = calculateProductionMetrics(rows, filters);

    await generateIndustrialExcel(res, {
      rows,
      stationPairs,
      metrics,
      filters,
      reportConfig,
      sheetName: type === "ng" ? "Historical NG Report" : "Historical Production",
      filePrefix: type === "ng" ? "HISTORICAL_NG_REPORT" : "HISTORICAL_FULL_REPORT"
    });
  } catch (error) {
    console.error("[HistoricalReport] Excel export error:", error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
};
