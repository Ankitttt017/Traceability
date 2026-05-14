const commissioningService = require("../services/commissioningService");
const plcStateMachineService = require("../services/plcStateMachineService");
const plcSnapshotService = require("../services/plcSnapshotService");
const machineWatchdogService = require("../services/machineWatchdogService");
const routingService = require("../services/routingService");
const Machine = require("../models/Machine");

class IndustrialController {
  async getDiagnostics(req, res) {
    try {
      const { machineId } = req.params;
      const machine = await Machine.findByPk(machineId);
      if (!machine) return res.status(404).json({ error: "Machine not found" });

      const runtime = await plcStateMachineService.getOrCreateRuntimeState(machineId);
      const snapshot = plcSnapshotService.getSnapshot(machine.plc_ip, machine.plc_port);
      const watchdog = machineWatchdogService.machineStats.get(Number(machineId)) || { errors: 0 };

      res.json({
        machineId,
        currentState: runtime.current_state,
        cycleToken: runtime.cycle_token,
        isLocked: runtime.is_locked,
        watchdogErrors: watchdog.errors,
        lastSnapshot: snapshot,
        conflicts: snapshot ? plcSnapshotService.detectConflicts(snapshot.data) : []
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async runCommissioning(req, res) {
    try {
      const { machineId } = req.params;
      const { task, scenario } = req.body;

      let result;
      switch (task) {
        case "VALIDATE_CONTRACT":
          result = await commissioningService.validateRegisterContract(machineId);
          break;
        case "SIMULATE_HANDSHAKE":
          result = await commissioningService.simulateHandshake(machineId, scenario);
          break;
        case "CHECK_INTEGRITY":
          result = await commissioningService.validateMachineStateIntegrity(machineId);
          break;
        default:
          return res.status(400).json({ error: "Invalid commissioning task" });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async manualRecovery(req, res) {
    try {
      const { machineId } = req.params;
      const { action } = req.body;

      switch (action) {
        case "UNLOCK":
          await machineWatchdogService.unlockMachine(machineId);
          break;
        case "FORCE_IDLE":
          await plcStateMachineService.transition(machineId, plcStateMachineService.states.IDLE);
          break;
        case "RESET_QUEUE":
          // Placeholder for retry queue reset
          break;
        default:
          return res.status(400).json({ error: "Invalid recovery action" });
      }

      res.json({ ok: true, message: `Action ${action} executed successfully` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getRoutingOptions(req, res) {
    try {
      const { operationNo } = req.query;
      const machine = await routingService.findMachine(operationNo);
      res.json({ recommendedMachine: machine });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getSequenceStatus(req, res) {
    try {
      const { partId, stationNo, machineId } = req.query;
      const industrialSequenceService = require("../services/industrialSequenceService");
      const result = await industrialSequenceService.validateSequence(partId, stationNo, machineId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getRcaReport(req, res) {
    try {
      const { cycleToken } = req.params;
      const industrialDiagnosticsService = require("../services/industrialDiagnosticsService");
      const report = await industrialDiagnosticsService.generateRcaReport(cycleToken);
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async setSafetyMode(req, res) {
    try {
      const { machineId } = req.params;
      const { maintenance } = req.body;
      const industrialSafetyInterlockService = require("../services/industrialSafetyInterlockService");
      industrialSafetyInterlockService.setMaintenanceMode(Number(machineId), maintenance);
      res.json({ ok: true, maintenance });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new IndustrialController();
