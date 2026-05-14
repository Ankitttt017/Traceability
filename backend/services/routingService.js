const Machine = require("../models/Machine");
const MachineRuntimeState = require("../models/MachineRuntimeState");
const plcStateMachineService = require("./plcStateMachineService");

class RoutingService {
  constructor() {
    this.roundRobinIndex = new Map(); // operationNo -> index
  }

  async findMachine(operationNo, preferredMachineId = null) {
    const machines = await Machine.findAll({
      where: {
        operation_no: operationNo,
        status: "ACTIVE",
        is_active: true
      },
      order: [["sequence_no", "ASC"]]
    });

    if (machines.length === 0) {
      throw new Error(`No active machines found for operation ${operationNo}`);
    }

    // Filter machines by health (Point 4)
    const availableMachines = [];
    for (const machine of machines) {
      const runtime = await plcStateMachineService.getOrCreateRuntimeState(machine.id);
      if (runtime.current_state === plcStateMachineService.states.IDLE && !runtime.is_locked) {
        availableMachines.push({ machine, runtime });
      }
    }

    if (availableMachines.length === 0) {
      // If no IDLE machines, check for LEAST_BUSY logic or just throw
      // For now, let's implement the routing strategies
      return this.applyRoutingStrategy(machines, operationNo, preferredMachineId);
    }

    return this.applyRoutingStrategy(availableMachines.map(m => m.machine), operationNo, preferredMachineId);
  }

  async applyRoutingStrategy(machines, operationNo, preferredMachineId) {
    // If preferred machine is available, use it
    if (preferredMachineId) {
      const preferred = machines.find(m => m.id === preferredMachineId);
      if (preferred) return preferred;
    }

    // Default strategy from first machine or system default
    const strategy = machines[0].routing_strategy || "FIRST_AVAILABLE";

    switch (strategy) {
      case "LEAST_BUSY":
        // This would require checking operation queues. For now, use FIRST_AVAILABLE.
        return machines[0];
      
      case "ROUND_ROBIN":
        let index = this.roundRobinIndex.get(operationNo) || 0;
        if (index >= machines.length) index = 0;
        const machine = machines[index];
        this.roundRobinIndex.set(operationNo, index + 1);
        return machine;

      case "PRIORITY_ORDER":
        // Machines are already ordered by sequence_no
        return machines[0];

      case "FIRST_AVAILABLE":
      default:
        return machines[0];
    }
  }

  async validateCapability(machine, requiredCapability) {
    if (!requiredCapability) return true;
    const capabilities = machine.capabilities ? machine.capabilities.split(",") : [];
    return capabilities.includes(requiredCapability);
  }
}

module.exports = new RoutingService();
