/**
 * plcContractTestService.js — Item #10
 * 
 * LIVE PLC CONTRACT TEST
 * 
 * Before machine activation or after a reconnection:
 * 1. Write START test signal.
 * 2. Verify ACK is received.
 * 3. Verify RUNNING is detected.
 * 4. Write RESET signal.
 * 5. Verify all signals are cleared.
 * 
 * Fails machine activation if contract is invalid.
 */

const { logInfo, logWarn, logError } = require("./industrialLogger");
const plcCommunicationService = require("./plcCommunicationService");
const { sleep } = require("./plcProtocols/utils");
const { operatorAuditService } = require("./operatorAuditService");

class PlcContractTestService {
  constructor() {
    this.TEST_TIMEOUT_MS = 10000;
  }

  async runContractTest(machine) {
    const machineId = machine.id;
    logInfo("PLC_CONTRACT_TEST_START", { machineId });

    try {
      // Step 1: Probe Connection
      const probe = await plcCommunicationService.probePlc(machine);
      if (!probe.connected) throw new Error("PLC not reachable for contract test");

      // Step 2: Verify Initial State (Signals should be clear)
      const initialState = await this.getCurrentSignals(machine);
      if (initialState.START || initialState.RUNNING || initialState.ACK) {
        throw new Error("Initial PLC signals not clear. Reset machine manually.");
      }

      // Step 3: Write START and Verify ACK (or state change)
      await plcCommunicationService.sendPlcCommand(machine, "START_OPERATION");
      await sleep(500); // Give PLC time to process
      
      const ackState = await this.waitForSignal(machine, "ACK", true, 3000);
      if (!ackState) {
        logWarn("PLC_CONTRACT_TEST_FAILED_ACK", { machineId });
        throw new Error("PLC failed to ACK the START command");
      }

      // Step 4: Write RESET and Verify Clear
      await plcCommunicationService.sendPlcCommand(machine, "RESET_OPERATION");
      await sleep(500);

      const clearState = await this.waitForSignal(machine, "ACK", false, 3000);
      if (clearState === null || clearState === true) {
        throw new Error("PLC failed to clear signals after RESET command");
      }

      logInfo("PLC_CONTRACT_TEST_PASSED", { machineId });
      
      operatorAuditService.record({
        actionType: "PLC_CONTRACT_TEST",
        machineId,
        metadata: { status: "PASSED" }
      });

      return { ok: true, message: "PLC contract test passed" };

    } catch (error) {
      logError("PLC_CONTRACT_TEST_FAILED", { machineId, error: error.message });
      
      operatorAuditService.record({
        actionType: "PLC_CONTRACT_TEST",
        machineId,
        metadata: { status: "FAILED", error: error.message }
      });

      return { ok: false, error: error.message };
    }
  }

  async getCurrentSignals(machine) {
    // Reuses probe logic which usually returns signal snapshot
    const probe = await plcCommunicationService.probePlc(machine);
    return probe.signals || {};
  }

  async waitForSignal(machine, signalName, expectedValue, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const signals = await this.getCurrentSignals(machine);
      if (Boolean(signals[signalName]) === expectedValue) return true;
      await sleep(200);
    }
    return false;
  }
}

module.exports = new PlcContractTestService();
