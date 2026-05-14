const Machine = require("../models/Machine");
const plcCommunicationService = require("./plcCommunicationService");
const plcSnapshotService = require("./plcSnapshotService");
const plcStateMachineService = require("./plcStateMachineService");

class CommissioningService {
  async validateRegisterContract(machineId) {
    const machine = await Machine.findByPk(machineId);
    if (!machine) throw new Error("Machine not found");

    const issues = [];
    const signals = machine.plc_registers ? JSON.parse(machine.plc_registers) : {};
    
    // Check for missing mandatory signals
    const mandatory = ["START", "RUNNING", "END_OK", "END_NG", "RESET"];
    mandatory.forEach(sig => {
      if (!signals[sig]) issues.push(`Missing mandatory signal: ${sig}`);
    });

    // Check for overlapping registers
    const registers = new Map();
    Object.entries(signals).forEach(([sig, reg]) => {
      if (registers.has(reg)) {
        issues.push(`Register conflict: ${sig} and ${registers.get(reg)} both use R${reg}`);
      }
      registers.set(reg, sig);
    });

    return { ok: issues.length === 0, issues };
  }

  async simulateHandshake(machineId, scenario = "OK") {
    const machine = await Machine.findByPk(machineId);
    if (!machine) throw new Error("Machine not found");

    console.log(`[Commissioning] Simulating ${scenario} handshake for machine ${machine.id}`);
    
    // Trigger sequence
    await plcStateMachineService.transition(machineId, plcStateMachineService.states.START_SENT);
    await new Promise(r => setTimeout(r, 500));
    
    await plcStateMachineService.transition(machineId, plcStateMachineService.states.ACK_RECEIVED);
    await new Promise(r => setTimeout(r, 500));
    
    await plcStateMachineService.transition(machineId, plcStateMachineService.states.RUNNING);
    await new Promise(r => setTimeout(r, 2000));
    
    if (scenario === "OK") {
      await plcStateMachineService.transition(machineId, plcStateMachineService.states.COMPLETED_OK);
    } else {
      await plcStateMachineService.transition(machineId, plcStateMachineService.states.COMPLETED_NG);
    }
    
    await new Promise(r => setTimeout(r, 1000));
    await plcStateMachineService.transition(machineId, plcStateMachineService.states.IDLE);
    
    return { ok: true, scenario };
  }

  async detectStaleSignals(machineId) {
    const machine = await Machine.findByPk(machineId);
    const snapshot = plcSnapshotService.getSnapshot(machine.plc_ip, machine.plc_port);
    
    if (!snapshot) return { stale: true, reason: "No snapshot available" };
    
    const isStale = (new Date() - snapshot.timestamp) > 10000;
    return { stale: isStale, lastUpdate: snapshot.timestamp };
  }

  async validateMachineStateIntegrity(machineId) {
    const runtime = await plcStateMachineService.getOrCreateRuntimeState(machineId);
    const machine = await Machine.findByPk(machineId);
    
    const issues = [];
    if (runtime.current_state === "RUNNING" && !machine.is_running) {
      issues.push("Runtime says RUNNING but Machine model says NOT RUNNING");
    }
    
    return { ok: issues.length === 0, issues };
  }
}

module.exports = new CommissioningService();
