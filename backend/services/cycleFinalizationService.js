const plcService = require("./plcCommunicationService");
const {
  readModbusRegisters,
  readSlmpRegisters,
} = require("./plcIoService");
const resetValidation = require("./deterministicResetValidationService");
const plcHandshakeEngine = require("./plcHandshakeEngine");
const plcStateMachineService = require("./plcStateMachineService");
const { clearMachineLock } = require("./machineLockService");
const { TIMELINE_EVENTS } = require("./operationTimelineService");
const { logInfo, logWarn } = require("./industrialLogger");

function toIntOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeProtocol(machine) {
  return String(machine?.plc_protocol || "TCP_TEXT").trim().toUpperCase();
}

async function readResetSignals(machine) {
  const protocol = normalizeProtocol(machine);
  const ip = machine?.plc_ip || machine?.machine_ip;
  const port = toIntOrNull(machine?.plc_port || machine?.machine_port);
  if (!ip || !port) {
    return {
      start_signal: null,
      run_command: null,
      output_signal: null,
      busy_flag: null,
    };
  }

  const startRegister = toIntOrNull(machine?.plc_start_register);
  const statusRegister = toIntOrNull(machine?.plc_status_register);
  const resetRegister = toIntOrNull(machine?.plc_reset_register);
  const startedValue = Number(machine?.plc_started_value ?? 2);
  const registers = [startRegister, statusRegister, resetRegister].filter((entry) => entry !== null);
  if (registers.length === 0) {
    return {
      start_signal: 0,
      run_command: 0,
      output_signal: 0,
      busy_flag: 0,
    };
  }

  const timeoutMs = Math.max(toIntOrNull(machine?.plc_test_timeout_ms) || 2000, 500);

  if (protocol === "MODBUS_TCP") {
    const result = await readModbusRegisters({
      ip,
      port,
      unitId: toIntOrNull(machine?.plc_unit_id) || 1,
      registers,
      timeoutMs,
    });
    const values = result?.values || {};
    const status = statusRegister !== null ? values[statusRegister] ?? null : null;
    const running = Number.isFinite(status) && Number(status) === Number(startedValue);
    return {
      start_signal: startRegister !== null ? values[startRegister] ?? null : 0,
      run_command: running ? 1 : 0,
      output_signal: startRegister !== null ? values[startRegister] ?? null : 0,
      busy_flag: resetRegister !== null ? values[resetRegister] ?? null : 0,
      status_raw: status,
    };
  }

  if (protocol === "SLMP") {
    const defaultDevice = String(machine?.plc_slmp_device || "D").trim().toUpperCase() || "D";
    const result = await readSlmpRegisters({
      ip,
      port,
      registers: registers.map((register) => ({ register, device: defaultDevice })),
      defaultDevice,
      timeoutMs,
      frameMode: machine?.plc_slmp_frame_mode || "AUTO",
    });
    const values = result?.values || {};
    const status = statusRegister !== null ? values[statusRegister] ?? null : null;
    const running = Number.isFinite(status) && Number(status) === Number(startedValue);
    return {
      start_signal: startRegister !== null ? values[startRegister] ?? null : 0,
      run_command: running ? 1 : 0,
      output_signal: startRegister !== null ? values[startRegister] ?? null : 0,
      busy_flag: resetRegister !== null ? values[resetRegister] ?? null : 0,
      status_raw: status,
    };
  }

  return {
    start_signal: 0,
    run_command: 0,
    output_signal: 0,
    busy_flag: 0,
  };
}

async function finalizeCycleAfterPlc({ machine }) {
  const machineId = Number(machine?.id || 0);
  if (!machineId) {
    return { success: false, reason: "INVALID_MACHINE" };
  }

  const ip = machine.plc_ip || machine.machine_ip || null;
  const port = toIntOrNull(machine.plc_port || machine.machine_port);
  const protocol = normalizeProtocol(machine);

  await plcHandshakeEngine.markResetting(machineId);

  const result = await resetValidation.executeResetAndUnlock({
    machineId,
    plcEndpoint: `${ip || "NA"}:${port || "NA"} (${protocol})`,
    sendResetFn: async () =>
      plcService.resetPlcState({
        ip,
        port,
        protocol,
        machine,
      }),
    pollSignalsFn: async () => readResetSignals(machine),
    verifyIdleFn: async () => {
      const runtime = await plcStateMachineService.getOrCreateRuntimeState(machineId);
      const currentState = String(runtime?.current_state || "").toUpperCase();
      const running = ["RUNNING", "WAITING_RUNNING", "WAITING_END"].includes(currentState);
      return {
        running,
        alarm: false,
        ready: !running,
        currentState,
      };
    },
    unlockFn: async () => clearMachineLock(machineId),
  });

  if (!result.success) {
    await plcHandshakeEngine.recordTimelineForMachine(machineId, TIMELINE_EVENTS.PLC_ERROR, {
      reason: "RESET_VALIDATION_FAILED",
      error: result.error || result.reason || "UNKNOWN_RESET_FAILURE",
    });
    await plcHandshakeEngine.markRecovering(machineId, new Error(result.error || result.reason || "RESET_VALIDATION_FAILED"));
    logWarn("CYCLE_FINALIZATION_FAILED", {
      machineId,
      reason: result.reason || "RESET_VALIDATION_FAILED",
      error: result.error || null,
    });
    return {
      success: false,
      reason: result.reason || "RESET_VALIDATION_FAILED",
      error: result.error || null,
    };
  }

  await plcHandshakeEngine.markIdle(machineId);
  logInfo("CYCLE_FINALIZATION_SUCCESS", {
    machineId,
    resetDuration: result.resetDuration || null,
  });
  return {
    success: true,
    machineId,
    resetDuration: result.resetDuration || null,
  };
}

module.exports = {
  finalizeCycleAfterPlc,
};
