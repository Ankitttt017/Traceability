const industrialEventService = require("./industrialEventService");
const plcStateMachineService = require("./plcStateMachineService");

class MachineWatchdogService {
  constructor() {
    this.machineStats = new Map(); // machineId -> { errors: 0, lastError: null }
    this.THRESHOLDS = {
      WARNING: 2,
      DEGRADED: 5,
      CRITICAL: 10,
      LOCKDOWN: 15
    };
  }

  recordError(machineId, type, message) {
    if (!this.machineStats.has(machineId)) {
      this.machineStats.set(machineId, { errors: 0, lastError: null, errorCounts: {} });
    }
    
    const stats = this.machineStats.get(machineId);
    stats.errors += 1;
    stats.lastError = { type, message, timestamp: new Date() };
    stats.errorCounts[type] = (stats.errorCounts[type] || 0) + 1;

    this.checkEscalation(machineId, stats);
  }

  recordSuccess(machineId) {
    if (this.machineStats.has(machineId)) {
      const stats = this.machineStats.get(machineId);
      // Industrial logic: Slow recovery of error count on success
      if (stats.errors > 0) stats.errors -= 1;
    }
  }

  checkEscalation(machineId, stats) {
    let level = "OK";
    if (stats.errors >= this.THRESHOLDS.LOCKDOWN) level = "LOCKDOWN";
    else if (stats.errors >= this.THRESHOLDS.CRITICAL) level = "CRITICAL";
    else if (stats.errors >= this.THRESHOLDS.DEGRADED) level = "DEGRADED";
    else if (stats.errors >= this.THRESHOLDS.WARNING) level = "WARNING";

    if (level !== "OK") {
      industrialEventService.emitWatchdogAlert(machineId, level, `Watchdog escalated due to repeated errors`, {
        errorCount: stats.errors,
        lastError: stats.lastError
      });

      if (level === "LOCKDOWN") {
        this.lockdownMachine(machineId);
      }
    }
  }

  async lockdownMachine(machineId) {
    console.warn(`[Watchdog] Machine ${machineId} ENTERING LOCKDOWN`);
    // Implement actual lockdown (e.g. set is_locked in MachineRuntimeState)
    const runtime = await plcStateMachineService.getOrCreateRuntimeState(machineId);
    await runtime.update({ is_locked: true, error_code: "WATCHDOG_LOCKDOWN" });
  }

  async unlockMachine(machineId) {
    const stats = this.machineStats.get(machineId);
    if (stats) stats.errors = 0;
    
    const runtime = await plcStateMachineService.getOrCreateRuntimeState(machineId);
    await runtime.update({ is_locked: false, error_code: null });
    
    industrialEventService.emitWatchdogAlert(machineId, "INFO", "Machine unlocked by administrator");
  }
}

module.exports = new MachineWatchdogService();
