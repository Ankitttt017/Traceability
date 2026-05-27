const Machine = require("../models/Machine");
const MachineRuntimeState = require("../models/MachineRuntimeState");
const plcPollingService = require("./plcPollingService");
const plcStateMachineService = require("./plcStateMachineService");
const plcSnapshotService = require("./plcSnapshotService");

class PlcRecoveryService {
  async recoverAll() {
    console.log("[RecoveryService] Starting industrial state re-synchronization...");
    const machines = await Machine.findAll({ where: { status: "ACTIVE" } });

    for (const machine of machines) {
      await this.recoverMachine(machine);
    }
    console.log("[RecoveryService] State re-synchronization completed.");
  }

  async recoverMachine(machine) {
    try {
      const runtime = await plcStateMachineService.getOrCreateRuntimeState(machine.id);
      
      // Read live registers from PLC (Point 1)
      const liveSignals = await plcPollingService.readAllRegisters(machine);
      if (!liveSignals) {
        console.warn(`[RecoveryService] Could not read PLC for machine ${machine.id}, keeping last state: ${runtime.current_state}`);
        return;
      }

      plcSnapshotService.updateSnapshot(machine.plc_ip, machine.plc_port, liveSignals);

      const dbState = runtime.current_state;
      let recoveredState = dbState;

      // Industrial Recovery Rules (Section 4 & 6)
      const hasActiveOp = Boolean(runtime.active_operation_id);
      const isTerminalState = [
        plcStateMachineService.states.COMPLETED_OK, 
        plcStateMachineService.states.COMPLETED_NG,
        plcStateMachineService.states.BLOCKED,
        plcStateMachineService.states.INTERLOCKED
      ].includes(dbState);

      if (liveSignals.RUNNING) {
        // Only reconstruct RUNNING if we have a matching active operation (Rule 4)
        recoveredState = hasActiveOp ? plcStateMachineService.states.RUNNING : plcStateMachineService.states.RECOVERING;
      } else if (liveSignals.END_OK || liveSignals.END_NG) {
        recoveredState = hasActiveOp ? plcStateMachineService.states.WAITING_END : plcStateMachineService.states.IDLE;
      } else if (liveSignals.RESET) {
        recoveredState = plcStateMachineService.states.RESETTING;
      } else if (isTerminalState || dbState === plcStateMachineService.states.RECOVERING) {
        // If PLC is clear and we are in a terminal state, return to IDLE (Rule 4)
        recoveredState = plcStateMachineService.states.IDLE;
      } else if (dbState === plcStateMachineService.states.START_SENT || dbState === plcStateMachineService.states.WAITING_RUNNING) {
        // Handshake interrupted, move to recovery
        recoveredState = plcStateMachineService.states.RECOVERING;
      }

      if (recoveredState !== dbState) {
        console.log(`[RecoveryService] Machine ${machine.id}: DB ${dbState} -> PLC ${recoveredState} (ActiveOp=${hasActiveOp})`);
        await plcStateMachineService.transition(machine.id, recoveredState, {
          recovery_state: `Recovered from PLC signals (hasActiveOp=${hasActiveOp})`,
          plc_snapshot: liveSignals
        });
      } else {
        console.log(`[RecoveryService] Machine ${machine.id}: DB state ${dbState} synchronized with PLC.`);
      }

    } catch (error) {
      console.error(`[RecoveryService] Failed to recover machine ${machine.id}:`, error.message);
    }
  }
}

module.exports = new PlcRecoveryService();
