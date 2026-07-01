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
    if (currentShift) {
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

    const machines = await Machine.findAll({ where: { status: "ACTIVE" }, raw: true });
    const result   = [];

    for (const machine of machines) {
      const logs = await ProductionLog.findAll({
        where: { machine_id: machine.id, createdAt: { [Op.between]: [shiftStartDate, shiftEndDate] } },
        order: [["createdAt", "ASC"]],
        attributes: ["status", "createdAt"],
        raw: true,
      });

      const total  = logs.length;
      const ok     = logs.filter((l) => l.status === "OK").length;
      
      const target = computeTargetProduction({ machine, shift: currentShift });

      // Quality: OK / Total
      const quality = total > 0 ? ok / total : 0;

      // Availability — calculate downtime from scan gaps > 5 min
      const { downtimeMs, downtimeMinutes, downtimeEvents } = computeDowntimeFromLogs(logs);
      const operatingTimeMs = shiftDurationMs - downtimeMs;
      const plannedProductionMinutes = Math.max(0, Math.round(shiftDurationMs / 60000));
      const downtimeEventRatio = (total + downtimeEvents) > 0
        ? Number(((downtimeEvents / (total + downtimeEvents)) * 100).toFixed(2))
        : 0;
      const downtimeTimePct = plannedProductionMinutes > 0
        ? Number(((downtimeMinutes / plannedProductionMinutes) * 100).toFixed(2))
        : 0;
      const idealCycleTimeSeconds = getEffectiveCycleTimeSeconds(machine);
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
        stationNo:    machine.station_no,
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

    res.json({ oee: result, shiftCode: currentShift?.shift_code || "CUSTOM", generatedAt: now.toISOString() });
  } catch (error) {
    console.error("[OEEController] Error:", error.message);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getOeeMetrics };
