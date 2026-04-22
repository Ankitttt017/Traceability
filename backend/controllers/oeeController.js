// UPGRADE 7 COMPLETE — OEE Metrics: Quality × Performance × Availability per machine per shift
const { Op, fn, col, literal } = require("sequelize");
const Machine      = require("../models/Machine");
const ProductionLog = require("../models/ProductionLog");
const Shift        = require("../models/Shift");
const { parseTimeParts, toMinutes, isMinuteWithinShift } = require("../utils/time");

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

    // Find the active shift for current time
    const shifts = await Shift.findAll({ where: { is_active: true }, raw: true });
    let currentShift = null;
    for (const s of shifts) {
      const start = toMinutes(s.start_time);
      const end = toMinutes(s.end_time);
      if (isMinuteWithinShift(currentMinutes, start, end, { inclusiveEnd: true })) {
        currentShift = s;
        break;
      }
    }

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
      const target = Number(machine.target_qty || 0);

      // Quality
      const quality = total > 0 ? ok / total : 0;

      // Performance
      const performance = target > 0 ? Math.min(total / target, 1) : (total > 0 ? 1 : 0);

      // Availability — calculate downtime from scan gaps > 5 min
      const GAP_THRESHOLD_MS = 5 * 60_000;
      let downtimeMs = 0;
      for (let i = 1; i < logs.length; i++) {
        const gap = new Date(logs[i].createdAt) - new Date(logs[i - 1].createdAt);
        if (gap > GAP_THRESHOLD_MS) downtimeMs += gap;
      }
      const availability = shiftDurationMs > 0 ? Math.max(0, (shiftDurationMs - downtimeMs) / shiftDurationMs) : 1;

      const oee = quality * performance * availability;

      result.push({
        machineId:    machine.id,
        machineName:  machine.machine_name,
        stationNo:    machine.station_no,
        lineName:     machine.line_name,
        oee:          Math.round(oee * 100),
        quality:      Math.round(quality * 100),
        performance:  Math.round(performance * 100),
        availability: Math.round(availability * 100),
        ok,
        total,
        target,
        downtimeMinutes: Math.round(downtimeMs / 60_000),
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
