/**
 * StaleSignalPurgeService — Item #3
 * After backend restart:
 * - Verify old END_OK not still high
 * - Verify old ACK not still high
 * - Verify RUNNING not stale
 * - Verify RESET completed
 * Implements automatic stale-signal cleanup policy.
 */

const Machine = require("../models/Machine");
const plcSnapshotService = require("./plcSnapshotService");
const plcStateMachineService = require("./plcStateMachineService");
const { logInfo, logWarn } = require("./industrialLogger");
const industrialEventService = require("./industrialEventService");

const STALE_SIGNAL_THRESHOLDS = {
  END_OK: 10000,   // If END_OK still high >10s after restart → stale
  END_NG: 10000,
  ACK: 8000,
  RUNNING: 30000,  // RUNNING still high >30s after restart → stale
  RESET: 15000,    // RESET not cleared >15s → PLC may be stuck
};

class StaleSignalPurgeService {
  /**
   * Run on startup for all active machines.
   * Checks live PLC signals and determines if any are stale from a previous cycle.
   */
  async purgeAll() {
    const machines = await Machine.findAll({ where: { status: "ACTIVE" } });
    const results = [];
    for (const machine of machines) {
      try {
        const result = await this.purgeForMachine(machine);
        results.push({ machineId: machine.id, ...result });
      } catch (err) {
        logWarn("STALE_PURGE_FAILED", { machineId: machine.id, error: err.message });
        results.push({ machineId: machine.id, error: err.message });
      }
    }
    logInfo("STALE_SIGNAL_PURGE_COMPLETE", { machineCount: machines.length, results: results.length });
    return results;
  }

  async purgeForMachine(machine) {
    const snapshot = plcSnapshotService.getSnapshot(machine.plc_ip || machine.plcIp, machine.plc_port || machine.plcPort);
    const staleSignals = [];

    if (!snapshot || !snapshot.data) {
      logInfo("STALE_PURGE_NO_SNAPSHOT", { machineId: machine.id });
      return { staleSignals: [], action: "SKIPPED_NO_SNAPSHOT" };
    }

    const signals = snapshot.data;
    const snapshotAge = Date.now() - new Date(snapshot.timestamp).getTime();

    // Check each signal against stale thresholds
    for (const [signal, thresholdMs] of Object.entries(STALE_SIGNAL_THRESHOLDS)) {
      const value = signals[signal];
      const isHigh = Boolean(value) && value !== 0;

      if (isHigh && snapshotAge > thresholdMs) {
        staleSignals.push({ signal, value, ageMs: snapshotAge, thresholdMs });
        logWarn("STALE_SIGNAL_DETECTED", {
          machineId: machine.id,
          signal,
          value,
          snapshotAgeMs: snapshotAge,
          thresholdMs,
        });
      }
    }

    if (staleSignals.length > 0) {
      // Force machine to RECOVERING state for operator acknowledgment
      const runtime = await plcStateMachineService.getOrCreateRuntimeState(machine.id);
      const current = runtime.current_state;

      // Only force transition if machine isn't already in a safe state
      if (![plcStateMachineService.states.IDLE, plcStateMachineService.states.RECOVERING].includes(current)) {
        await plcStateMachineService.transition(machine.id, plcStateMachineService.states.RECOVERING, {
          error_message: `Stale signals detected on startup: ${staleSignals.map(s => s.signal).join(", ")}`,
          error_code: "STALE_SIGNAL_PURGE",
        });
      }

      industrialEventService.emitWatchdogAlert(machine.id, "CRITICAL",
        `Stale PLC signals detected after restart: ${staleSignals.map(s => s.signal).join(", ")}. Manual verification required.`,
        { staleSignals }
      );

      return { staleSignals, action: "MACHINE_SET_TO_RECOVERING" };
    }

    return { staleSignals: [], action: "CLEAN" };
  }

  /**
   * Validate a specific signal is cleared before proceeding.
   */
  isSignalClear(snapshot, signal) {
    if (!snapshot?.data) return true; // No data = assume clear
    const val = snapshot.data[signal];
    return !val || val === 0;
  }
}

module.exports = new StaleSignalPurgeService();
