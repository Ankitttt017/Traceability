const MachineRuntimeState = require("../models/MachineRuntimeState");
const { emitRealtime } = require("./realtimeService");
const { logWarn } = require("./industrialLogger");
const { v4: uuidv4 } = require("uuid");
// Industrial Hardening: v1.3.1 - Enhanced IDLE->COMPLETED_NG transitions

const States = {
  IDLE: "IDLE",
  SCANNED: "SCANNED",
  VALIDATED: "VALIDATED",
  START_SENT: "START_SENT",
  WAITING_RUNNING: "WAITING_RUNNING",
  RUNNING: "RUNNING",
  WAITING_END: "WAITING_END",
  COMPLETED_OK: "COMPLETED_OK",
  COMPLETED_NG: "COMPLETED_NG",
  WAITING_BIN_ACK: "WAITING_BIN_ACK",
  RESETTING: "RESETTING",
  RESET_ACK_WAIT: "RESET_ACK_WAIT",
  // Industrial Blocked States
  BLOCKED: "BLOCKED",
  INTERLOCKED: "INTERLOCKED",
  // Error/Timeout States
  RUNNING_TIMEOUT: "RUNNING_TIMEOUT",
  END_TIMEOUT: "END_TIMEOUT",
  RESET_TIMEOUT: "RESET_TIMEOUT",
  PLC_ERROR: "PLC_ERROR",
  RECOVERING: "RECOVERING",
};

const Transitions = {
  [States.IDLE]: [States.SCANNED, States.RECOVERING, States.RESETTING, States.BLOCKED, States.INTERLOCKED],
  [States.SCANNED]: [States.VALIDATED, States.IDLE, States.PLC_ERROR, States.BLOCKED, States.INTERLOCKED],
  [States.VALIDATED]: [States.START_SENT, States.RUNNING, States.IDLE, States.PLC_ERROR, States.BLOCKED],
  [States.BLOCKED]: [States.IDLE, States.RESETTING, States.SCANNED, States.PLC_ERROR, States.RECOVERING],
  [States.INTERLOCKED]: [States.IDLE, States.RESETTING, States.SCANNED, States.PLC_ERROR, States.RECOVERING],

  [States.WAITING_RUNNING]: [States.RUNNING, States.RUNNING_TIMEOUT, States.PLC_ERROR, States.RECOVERING, States.RESETTING, States.IDLE],
  [States.START_SENT]: [States.RUNNING, States.WAITING_RUNNING, States.RECOVERING, States.PLC_ERROR, States.RESETTING, States.IDLE, States.SCANNED],
  [States.RUNNING]: [States.WAITING_END, States.COMPLETED_OK, States.COMPLETED_NG, States.PLC_ERROR, States.RECOVERING, States.RESETTING, States.IDLE, States.SCANNED],
  [States.WAITING_END]: [States.COMPLETED_OK, States.COMPLETED_NG, States.END_TIMEOUT, States.PLC_ERROR, States.RECOVERING, States.RESETTING, States.IDLE, States.SCANNED],
  [States.COMPLETED_OK]: [States.RESETTING, States.IDLE, States.RECOVERING, States.SCANNED],
  [States.COMPLETED_NG]: [States.WAITING_BIN_ACK, States.RESETTING, States.IDLE, States.RECOVERING, States.SCANNED],
  [States.WAITING_BIN_ACK]: [States.RESETTING, States.IDLE, States.PLC_ERROR, States.RECOVERING, States.SCANNED],
  [States.RESETTING]: [States.IDLE, States.RESET_ACK_WAIT, States.RESET_TIMEOUT, States.PLC_ERROR, States.RECOVERING],
  [States.RESET_ACK_WAIT]: [States.IDLE, States.RESET_TIMEOUT, States.PLC_ERROR, States.RECOVERING],
  [States.RUNNING_TIMEOUT]: [States.RESETTING, States.IDLE, States.RECOVERING],
  [States.END_TIMEOUT]: [States.RESETTING, States.IDLE, States.RECOVERING],
  [States.RESET_TIMEOUT]: [States.IDLE, States.PLC_ERROR, States.RECOVERING],
  [States.PLC_ERROR]: [States.RECOVERING, States.RESETTING, States.IDLE],
  [States.RECOVERING]: [States.IDLE, States.RUNNING, States.WAITING_END, States.PLC_ERROR, States.BLOCKED, States.INTERLOCKED],
};

class PlcStateMachineService {
  constructor() {
    this.states = States;
  }

  async getOrCreateRuntimeState(machineId) {
    let [state, created] = await MachineRuntimeState.findOrCreate({
      where: { machine_id: machineId },
      defaults: { current_state: States.IDLE }
    });
    return state;
  }

  async transition(machineId, newState, metadata = {}) {
    const runtime = await this.getOrCreateRuntimeState(machineId);
    const currentState = runtime.current_state;

    // RULE 1: STRICT RESETTING GUARD
    if (currentState === States.RESETTING && newState !== States.IDLE && newState !== States.PLC_ERROR) {
       console.warn(`[StateMachine] BLOCKING transition ${currentState} -> ${newState} for machine ${machineId}. System is RESETTING.`);
       return runtime; // Ignore all events except IDLE or ERROR during reset
    }

    // Guard Rules (Point 19)
    if (!this.isValidTransition(currentState, newState)) {
      if (currentState === States.IDLE && newState === States.PLC_ERROR) {
        logWarn("IDLE_PLC_ERROR_IGNORED", {
          machineId,
          reason: metadata.error_message || "PLC poll failed while machine was idle",
        });
        return runtime;
      }
      const errorMsg = `Illegal state transition from ${currentState} to ${newState}`;
      console.error(`[StateMachine] Invalid transition: ${currentState} -> ${newState} for machine ${machineId}`);
      // Don't throw immediately, log it but allow transition if both states are error/recovery states
      // This helps prevent deadlocks during error recovery
      if (!this.isRecoveryTransition(currentState, newState)) {
        throw new Error(errorMsg);
      }
      logWarn("RECOVERY_TRANSITION_OVERRIDE", {
        machineId,
        from: currentState,
        to: newState,
        reason: "Allowing recovery transition despite invalid path"
      });
    }

    const updateData = {
      current_state: newState,
      last_transition_at: new Date(),
    };

    if (metadata.cycle_token) updateData.cycle_token = metadata.cycle_token;
    if (metadata.active_operation_id) updateData.active_operation_id = metadata.active_operation_id;
    if (metadata.plc_snapshot) updateData.plc_snapshot = JSON.stringify(metadata.plc_snapshot);
    if (metadata.recovery_state) updateData.recovery_state = metadata.recovery_state;
    if (metadata.error_code) updateData.error_code = metadata.error_code;
    if (metadata.error_message) updateData.error_message = metadata.error_message;

    // Reset cycle token if going to IDLE
    if (newState === States.IDLE) {
      updateData.cycle_token = null;
      updateData.active_operation_id = null;
    }

    await runtime.update(updateData);

    // Record for integrity validation (Item 15)
    const plcCycleIntegrityService = require("./plcCycleIntegrityService");
    plcCycleIntegrityService.recordTransition(runtime.cycle_token, newState);

    // Commissioning Tracing (Item 20)
    const commissioning = require("./industrialCommissioningMode");
    if (commissioning.isActive()) {
      metadata.is_commissioning_trace = true;
      if (newState === States.IDLE && runtime.cycle_token) {
        const validation = plcCycleIntegrityService.validate(runtime.cycle_token);
        if (!validation.valid) {
          metadata.integrity_error = validation.reason;
        }
      }
    }

    emitRealtime("machine_state_change", {
      machineId,
      oldState: currentState,
      newState,
      timestamp: updateData.last_transition_at,
      cycleToken: updateData.cycle_token,
      ...metadata
    });

    emitRealtime("dashboard_refresh", { 
      reason: "MACHINE_STATE_CHANGE", 
      machineId, 
      newState 
    });

    emitRealtime("operator_popup", {
      type: "INFO",
      machineId,
      plcStatus: newState,
      timestamp: updateData.last_transition_at,
      ...metadata
    });

    console.log(`[StateMachine] Machine ${machineId}: ${currentState} -> ${newState}`);
    return runtime;
  }

  isValidTransition(from, to) {
    if (from === to) return true; // Allow self-transition for updates
    const allowed = Transitions[from];
    return allowed && allowed.includes(to);
  }

  isRecoveryTransition(from, to) {
    // Allow transitions between error/recovery states to prevent deadlocks
    const errorStates = ["RESETTING", "RESET_TIMEOUT", "RUNNING_TIMEOUT", "END_TIMEOUT", "PLC_ERROR", "RECOVERING"];
    return errorStates.includes(from) && errorStates.includes(to) && from !== to;
  }

  generateCycleToken() {
    return `CYC-${Date.now()}-${uuidv4().substring(0, 8).toUpperCase()}`;
  }
}

module.exports = new PlcStateMachineService();
