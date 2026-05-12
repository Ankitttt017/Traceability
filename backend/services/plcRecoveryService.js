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

      // Recovery Logic (Point 1, 21)
      if (liveSignals.RUNNING) {
        recoveredState = plcStateMachineService.states.RUNNING;
      } else if (liveSignals.END_OK || liveSignals.END_NG) {
        recoveredState = plcStateMachineService.states.WAITING_END;
      } else if (liveSignals.RESET) {
        recoveredState = plcStateMachineService.states.RESETTING;
      } else if (dbState === plcStateMachineService.states.START_SENT) {
        // If we were waiting for ACK and PLC is IDLE, we might need to resend START or enter error
        recoveredState = plcStateMachineService.states.RECOVERING;
      }

      if (recoveredState !== dbState) {
        console.log(`[RecoveryService] Machine ${machine.id}: DB state ${dbState} -> Recovered PLC state ${recoveredState}`);
        await plcStateMachineService.transition(machine.id, recoveredState, {
          recovery_state: `Recovered from PLC signals at startup`,
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
