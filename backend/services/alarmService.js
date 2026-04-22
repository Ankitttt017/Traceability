// UPGRADE 6 COMPLETE - Alarm monitoring service: NG rate, silent machine, PLC disconnect
const { Op, fn, col, literal } = require("sequelize");
const { emitRealtime } = require("./realtimeService");
const Alarm = require("../models/Alarm");
const { toMinutes, isMinuteWithinShift } = require("../utils/time");

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const MONITOR_INTERVAL_MS = toNumber(process.env.ALARM_MONITOR_INTERVAL_SECONDS, 30) * 1000;
const NG_RATE_WINDOW_MS   = 60 * 60_000; // 60 minutes
const NG_RATE_THRESHOLD   = toNumber(process.env.ALARM_NG_RATE_THRESHOLD, 0.10);
const SILENT_WINDOW_MS    = toNumber(process.env.ALARM_SILENT_WINDOW_MINUTES, 10) * 60_000;
const ALARM_MONITOR_ENABLED = toBool(process.env.ALARM_MONITOR_ENABLED, true);
const ALARM_SILENT_ENABLED = toBool(process.env.ALARM_SILENT_ENABLED, true);
const ALARM_SILENT_REQUIRE_PREVIOUS_LOG = toBool(process.env.ALARM_SILENT_REQUIRE_PREVIOUS_LOG, true);

// Track last alarm raised per machine to avoid duplicate spam
const _lastAlarmAt = new Map(); // key: `${machineId}:${type}`

function _throttleAlarm(machineId, type, cooldownMs = 5 * 60_000) {
  const key = `${machineId}:${type}`;
  const last = _lastAlarmAt.get(key) || 0;
  if (Date.now() - last < cooldownMs) return false; // already alarmed recently
  _lastAlarmAt.set(key, Date.now());
  return true;
}

async function _persistAlarm({ type, machineId, machineName, detail }) {
  try {
    await Alarm.create({ type, machineId, machineName, detail });
  } catch (err) {
    console.error(`[AlarmService] Failed to persist alarm ${type} for machine ${machineId}: ${err.message}`);
  }
}

/**
 * ALARM 1: NG Rate — if NG count in last 60 min > 10% of total for any machine.
 */
async function checkNgRateAlarms() {
  try {
    const ProductionLog = require("../models/ProductionLog");
    const Machine       = require("../models/Machine");
    const since = new Date(Date.now() - NG_RATE_WINDOW_MS);

    const stats = await ProductionLog.findAll({
      attributes: [
        "machine_id",
        [fn("SUM", literal("CASE WHEN status='OK' THEN 1 ELSE 0 END")), "ok"],
        [fn("SUM", literal("CASE WHEN status='NG' THEN 1 ELSE 0 END")), "ng"],
        [fn("COUNT", col("id")), "total"],
      ],
      where: { createdAt: { [Op.gte]: since } },
      group: ["machine_id"],
      raw: true,
    });

    for (const row of stats) {
      const total = Number(row.total || 0);
      const ng    = Number(row.ng || 0);
      if (total < 5) continue; // too few samples to be meaningful
      const rate = ng / total;
      if (rate <= NG_RATE_THRESHOLD) continue;

      if (!_throttleAlarm(row.machine_id, "NG_RATE")) continue;

      const machine = await Machine.findByPk(row.machine_id, { attributes: ["id", "machine_name"], raw: true });
      const detail  = { ngCount: ng, totalCount: total, ngRate: `${(rate * 100).toFixed(1)}%`, windowMinutes: 60 };

      emitRealtime("alarm:ng_rate", { machineId: row.machine_id, machineName: machine?.machine_name, ...detail });
      await _persistAlarm({ type: "NG_RATE", machineId: row.machine_id, machineName: machine?.machine_name, detail });
      console.warn(`[AlarmService] NG_RATE alarm: machine=${row.machine_id} rate=${detail.ngRate}`);
    }
  } catch (err) {
    console.error("[AlarmService] checkNgRateAlarms error:", err.message);
  }
}

/**
 * ALARM 2: Silent Machine — no scan for a machine in the last 10 minutes during an active shift.
 */
async function checkSilentMachineAlarms() {
  try {
    if (!ALARM_SILENT_ENABLED) return;
    const ProductionLog = require("../models/ProductionLog");
    const Machine       = require("../models/Machine");
    const Shift         = require("../models/Shift");

    // Check if we are currently in any active shift
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const shifts = await Shift.findAll({ where: { is_active: true }, raw: true });

    const inActiveShift = shifts.some((s) => {
      const start = toMinutes(s.start_time);
      const end = toMinutes(s.end_time);
      return isMinuteWithinShift(currentMinutes, start, end, { inclusiveEnd: true });
    });

    if (!inActiveShift) return; // Not in a shift, no silent alarm needed

    const machines = await Machine.findAll({ where: { status: "ACTIVE" }, raw: true });
    const since    = new Date(Date.now() - SILENT_WINDOW_MS);

    for (const machine of machines) {
      const lastLog = await ProductionLog.findOne({
        where: { machine_id: machine.id, createdAt: { [Op.gte]: since } },
        order: [["createdAt", "DESC"]],
        raw: true,
      });

      if (lastLog) continue; // Machine has scanned recently

      if (!_throttleAlarm(machine.id, "SILENT_MACHINE", 10 * 60_000)) continue;

      const prevLog = await ProductionLog.findOne({
        where: { machine_id: machine.id },
        order: [["createdAt", "DESC"]],
        raw: true,
      });

      if (ALARM_SILENT_REQUIRE_PREVIOUS_LOG && !prevLog) continue;

      const detail = { lastScanTime: prevLog?.createdAt || null, silentWindowMinutes: 10 };
      emitRealtime("alarm:silent", { machineId: machine.id, machineName: machine.machine_name, ...detail });
      await _persistAlarm({ type: "SILENT_MACHINE", machineId: machine.id, machineName: machine.machine_name, detail });
      console.warn(`[AlarmService] SILENT_MACHINE alarm: machine=${machine.id} (${machine.machine_name})`);
    }
  } catch (err) {
    console.error("[AlarmService] checkSilentMachineAlarms error:", err.message);
  }
}

/**
 * ALARM 3: PLC Disconnect — called externally when a socket pool error is detected.
 * @param {object} opts
 */
async function raisePlcDisconnectAlarm({ machineId, machineName, ip, port, errorMessage }) {
  if (!_throttleAlarm(machineId, "PLC_DISCONNECT", 2 * 60_000)) return;
  const detail = { ip, port, errorMessage, detectedAt: new Date().toISOString() };
  emitRealtime("alarm:plc_disconnect", { machineId, machineName, ...detail });
  await _persistAlarm({ type: "PLC_DISCONNECT", machineId, machineName, detail });
  console.error(`[AlarmService] PLC_DISCONNECT alarm: machine=${machineId} (${machineName}) ip=${ip}:${port}`);
}

/**
 * Resolve (clear) an alarm by ID.
 */
async function resolveAlarm(alarmId, resolvedBy = "system") {
  await Alarm.update({ resolvedAt: new Date(), resolvedBy }, { where: { id: alarmId, resolvedAt: null } });
}

/**
 * Start the alarm monitor loop.
 */
function startAlarmMonitor() {
  if (!ALARM_MONITOR_ENABLED) {
    console.log("[AlarmService] Alarm monitor disabled via env");
    return;
  }
  console.log("[AlarmService] Alarm monitor started (interval: 30s)");
  setInterval(async () => {
    await checkNgRateAlarms();
    await checkSilentMachineAlarms();
  }, MONITOR_INTERVAL_MS);
}

module.exports = { startAlarmMonitor, raisePlcDisconnectAlarm, resolveAlarm };
