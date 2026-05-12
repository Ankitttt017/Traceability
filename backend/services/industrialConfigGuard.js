/**
 * industrialConfigGuard.js — Item #9
 * 
 * CONFIG VERSION LOCKING
 * 
 * Rules:
 * • Mapping edits blocked while machine is RUNNING/START_SENT.
 * • Routing edits blocked during active operations.
 * • Require safe IDLE/RECOVERING state before PLC config updates.
 * 
 * Prevents:
 * • Mid-cycle register mapping changes leading to handshake corruption.
 * • Real-time parameter shifts causing deterministic failures.
 */

const plcStateMachineService = require("./plcStateMachineService");
const { logWarn } = require("./industrialLogger");

class IndustrialConfigGuard {
  /**
   * Check if config update is allowed for a machine.
   * Throws Error if machine is in a critical active state.
   */
  async ensureSafeToUpdate(machineId) {
    const runtime = await plcStateMachineService.getOrCreateRuntimeState(machineId);
    const state = runtime.current_state;

    // Critical states where config change is dangerous
    const unsafeStates = [
      plcStateMachineService.states.START_SENT,
      plcStateMachineService.states.RUNNING,
      plcStateMachineService.states.WAITING_END
    ];

    if (unsafeStates.includes(state)) {
      logWarn("CONFIG_UPDATE_BLOCKED", { machineId, currentState: state });
      throw new Error(`Cannot update configuration while machine is in active state: ${state}. Machine must be IDLE or RECOVERING.`);
    }

    return true;
  }

  /**
   * Middleware-style wrapper for controller actions.
   */
  async wrapAction(machineId, action) {
    await this.ensureSafeToUpdate(machineId);
    return action();
  }
}

module.exports = new IndustrialConfigGuard();
