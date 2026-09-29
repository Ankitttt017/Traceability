// UPGRADE 7 COMPLETE — OEE Metrics: Quality × Performance × Availability per machine per shift
const { Op } = require("sequelize");
const Machine      = require("../models/Machine");
const ProductionLog = require("../models/ProductionLog");
const Shift        = require("../models/Shift");
const { parseTimeParts, toMinutes, isMinuteWithinShift } = require("../utils/time");
const {
  getProductionDate,
  resolveShift,
  getShiftDurationSeconds,
  getEffectiveCycleTimeSeconds,
  computeTargetProduction,
  computeDowntimeFromLogs,
  computeOeeAndOa,
} = require("../services/metrics/productionMetricsService");

/**
 * GET /api/dashboard/oee
 * Returns OEE breakdown per machine for the current shift.
 *
 * OEE = Quality × Performance × Availability
 *   Quality     = OK / Total
 *   Performance = Total / Target (from machine.target_qty)
 *   Availability = (shiftDuration - downtime) / shiftDuration
 *     downtime  = sum of consecutive-scan gaps > 5 minutes
 */
async function getOeeMetrics(req, res) {
  try {
    const now  = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const shifts = await Shift.findAll({
      where: { is_active: true },
      attributes: ["id", "shift_name", "shift_code", "start_time", "end_time"],
      raw: true,
    });
    let currentShift = resolveShift(now, shifts);

    // Determine shift start/end as Date objects
    let shiftStartDate, shiftEndDate, shiftDurationMs;
    if (req.query.dateFrom && req.query.dateTo) {
      shiftStartDate = new Date(req.query.dateFrom);
      shiftEndDate = new Date(req.query.dateTo);
      shiftDurationMs = Math.max(3600000, shiftEndDate.getTime() - shiftStartDate.getTime());
    } else if (currentShift) {
      const startParts = parseTimeParts(currentShift.start_time);
      const endParts = parseTimeParts(currentShift.end_time);
      if (!startParts || !endParts) {
        throw new Error("Invalid shift time format");
      }
      const { hours: sh, minutes: sm } = startParts;
      const { hours: eh, minutes: em } = endParts;
      shiftStartDate = new Date(now);
      shiftStartDate.setHours(sh, sm, 0, 0);
      shiftEndDate = new Date(now);
      shiftEndDate.setHours(eh, em, 0, 0);
      if (shiftEndDate <= shiftStartDate) shiftEndDate.setDate(shiftEndDate.getDate() + 1); // overnight
      shiftDurationMs = shiftEndDate - shiftStartDate;
    } else {
      // Default: last 8 hours
      shiftStartDate = new Date(Date.now() - 8 * 3600_000);
      shiftEndDate   = now;
      shiftDurationMs = 8 * 3600_000;
    }

    const machines = await Machine.findAll({ where: { is_active: true }, raw: true }).catch(() => Machine.findAll({ raw: true }));
    const result   = [];

    const sequelize = require("../config/db");
    const [prAggs] = await sequelize.query(`
      SELECT
        COUNT(*) as totalParts,
        SUM(CASE WHEN overall_status IN ('OK','PASSED') THEN 1 ELSE 0 END) as overall_ok,
        SUM(CASE WHEN op100_status IN ('OK','PASSED','ENDED_OK') THEN 1 ELSE 0 END) as op100_ok,
        COUNT(CASE WHEN op100_status IS NOT NULL AND op100_status != '' THEN 1 END) as op100_tot,
        SUM(CASE WHEN op110_status IN ('OK','PASSED','ENDED_OK') THEN 1 ELSE 0 END) as op110_ok,
        COUNT(CASE WHEN op110_status IS NOT NULL AND op110_status != '' THEN 1 END) as op110_tot,
        SUM(CASE WHEN op120_status IN ('OK','PASSED','ENDED_OK') THEN 1 ELSE 0 END) as op120_ok,
        COUNT(CASE WHEN op120_status IS NOT NULL AND op120_status != '' THEN 1 END) as op120_tot,
        SUM(CASE WHEN op130_status IN ('OK','PASSED','ENDED_OK') THEN 1 ELSE 0 END) as op130_ok,
        COUNT(CASE WHEN op130_status IS NOT NULL AND op130_status != '' THEN 1 END) as op130_tot,
        SUM(CASE WHEN op140_status IN ('OK','PASSED','ENDED_OK') THEN 1 ELSE 0 END) as op140_ok,
        COUNT(CASE WHEN op140_status IS NOT NULL AND op140_status != '' THEN 1 END) as op140_tot,
        SUM(CASE WHEN op150_status IN ('OK','PASSED','ENDED_OK') OR JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED') THEN 1 ELSE 0 END) as op150_ok,
        COUNT(CASE WHEN op150_status IS NOT NULL AND op150_status != '' OR leak_data IS NOT NULL THEN 1 END) as op150_tot,
        SUM(CASE WHEN op160_status IN ('OK','PASSED','ENDED_OK') THEN 1 ELSE 0 END) as op160_ok,
        COUNT(CASE WHEN op160_status IS NOT NULL AND op160_status != '' THEN 1 END) as op160_tot
      FROM [RICO_IOT].[dbo].[ProductionReports]
      WHERE (first_scan_at BETWEEN :start AND :end OR final_scan_at BETWEEN :start AND :end OR createdAt BETWEEN :start AND :end)
    `, {
      replacements: { start: shiftStartDate, end: shiftEndDate },
      type: sequelize.QueryTypes.SELECT,
    }).catch(() => [{}]);

    const prStats = prAggs || {};

    for (const machine of machines) {
      const logs = await ProductionLog.findAll({
        where: { machine_id: machine.id, createdAt: { [Op.between]: [shiftStartDate, shiftEndDate] } },
        order: [["createdAt", "ASC"]],
        attributes: ["status", "createdAt"],
        raw: true,
      });

      let total  = logs.length;
      let ok     = logs.filter((l) => l.status === "OK").length;

      const opKey = String(machine.operation_no || "").toLowerCase();
      if (total === 0 && opKey && prStats[`${opKey}_tot`] !== undefined) {
        total = Number(prStats[`${opKey}_tot`] || 0);
        ok = Number(prStats[`${opKey}_ok`] || 0);
      }
      
      const target = computeTargetProduction({ machine, shift: currentShift });

      // Quality: OK / Total
      const quality = total > 0 ? ok / total : 1;

      // Availability — calculate downtime from scan gaps > 5 min
      const { downtimeMs, downtimeMinutes, downtimeEvents } = computeDowntimeFromLogs(logs);
      const operatingTimeMs = Math.max(0, shiftDurationMs - downtimeMs);
      const plannedProductionMinutes = Math.max(0, Math.round(shiftDurationMs / 60000));
      const downtimeEventRatio = (total + downtimeEvents) > 0
        ? Number(((downtimeEvents / (total + downtimeEvents)) * 100).toFixed(2))
        : 0;
      const downtimeTimePct = plannedProductionMinutes > 0
        ? Number(((downtimeMinutes / plannedProductionMinutes) * 100).toFixed(2))
        : 0;
      const idealCycleTimeSeconds = getEffectiveCycleTimeSeconds(machine) || 55;
      const calc = computeOeeAndOa({
        totalCount: total,
        goodCount: ok,
        runtimeSeconds: Math.max(0, Math.floor(operatingTimeMs / 1000)),
        plannedProductionSeconds: Math.max(0, Math.floor(shiftDurationMs / 1000)),
        idealCycleTimeSeconds,
        downtimeSeconds: Math.max(0, Math.floor(downtimeMs / 1000)),
      });
      const productionDate = getProductionDate(now);

      result.push({
        machineId:    machine.id,
        machineName:  machine.machine_name,
        stationNo:    machine.station_no || machine.operation_no,
        operationNo:  machine.operation_no,
        lineName:     machine.line_name,
        oee:          calc.oeePct,
        oa:           calc.oaPct,
        quality:      calc.qualityPct,
        performance:  calc.performancePct,
        availability: calc.availabilityPct,
        ok,
        total,
        target,
        downtimeMinutes,
        downtimeEvents,
        plannedProductionMinutes,
        downtimeEventRatio,
        downtimeTimePct,
        actualProduction: total,
        achievementPct: target > 0 ? Math.round((total / target) * 100) : 0,
        targetGap: target > 0 ? Math.max(target - total, 0) : 0,
        productionDate: productionDate ? productionDate.toISOString().slice(0, 10) : null,
        shiftCode: currentShift?.shift_code || "CUSTOM",
      });
    }

    // Line aggregated metrics
    const avgOee = result.length > 0 ? Math.round(result.reduce((s, r) => s + r.oee, 0) / result.length) : 0;
    const avgOa = result.length > 0 ? Math.round(result.reduce((s, r) => s + r.oa, 0) / result.length) : 0;
    const avgQuality = result.length > 0 ? Math.round(result.reduce((s, r) => s + r.quality, 0) / result.length) : 0;
    const avgPerformance = result.length > 0 ? Math.round(result.reduce((s, r) => s + r.performance, 0) / result.length) : 0;
    const avgAvailability = result.length > 0 ? Math.round(result.reduce((s, r) => s + r.availability, 0) / result.length) : 0;

    res.json({
      lineMetrics: {
        oee: avgOee,
        oa: avgOa,
        quality: avgQuality,
        performance: avgPerformance,
        availability: avgAvailability,
      },
      oee: result,
      shiftCode: currentShift?.shift_code || "CUSTOM",
      generatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[OEEController] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getOeeMetrics };
