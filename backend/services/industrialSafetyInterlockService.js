/**
 * industrialSafetyInterlockService.js
 * 
 * INDUSTRIAL SAFETY & INTERLOCK ENFORCEMENT
 * 
 * Ensures:
 * • Emergency-stop (E-Stop) handling integration.
 * • Unsafe unlock prevention.
 * • Interlock enforcement (PLC hard interlock).
 * • Maintenance-mode isolation.
 */

const { logWarn, logInfo } = require("./industrialLogger");
const industrialEventService = require("./industrialEventService");
const plcSnapshotService = require("./plcSnapshotService");

class IndustrialSafetyInterlockService {
  constructor() {
    this.maintenanceMode = new Set(); // machineId
  }

  /**
   * Check for hardware-level safety blocks (E-Stop, Door Open, etc.)
   * Based on live PLC register values.
   */
  async checkHardwareSafety(machine) {
    const snapshot = plcSnapshotService.getSnapshot(machine.plc_ip || machine.plcIp, machine.plc_port || machine.plcPort);
    if (!snapshot || !snapshot.data) return { safe: true };

    const signals = snapshot.data;
    const blocks = [];

    // Common safety signals (should be mapped in machine config)
    if (signals.ESTOP) blocks.push("EMERGENCY_STOP_ACTIVE");
    if (signals.DOOR_OPEN) blocks.push("SAFETY_DOOR_OPEN");
    if (signals.AIR_LOW) blocks.push("PNEUMATIC_PRESSURE_LOW");
    if (signals.CURTAIN_BLOCK) blocks.push("LIGHT_CURTAIN_BLOCKED");

    if (blocks.length > 0) {
      logWarn("HARDWARE_SAFETY_BLOCK", { machineId: machine.id, blocks });
      return { safe: false, blocks };
    }

    return { safe: true };
  }

  /**
   * Prevents unsafe unlocks if the machine is still showing RUNNING.
   */
  async canUnlock(machine) {
    const snapshot = plcSnapshotService.getSnapshot(machine.plc_ip || machine.plcIp, machine.plc_port || machine.plcPort);
    const isRunning = snapshot?.data?.RUNNING;

    if (isRunning) {
      logWarn("UNSAFE_UNLOCK_PREVENTED", { machineId: machine.id, reason: "PLC_STILL_RUNNING" });
      return { allowed: false, reason: "PLC_STILL_RUNNING" };
    }

    if (this.maintenanceMode.has(machine.id)) {
      return { allowed: false, reason: "MAINTENANCE_MODE_ACTIVE" };
    }

    return { allowed: true };
  }

  setMaintenanceMode(machineId, active) {
    if (active) {
      this.maintenanceMode.add(machineId);
      logInfo("MAINTENANCE_MODE_ENTERED", { machineId });
    } else {
      this.maintenanceMode.delete(machineId);
      logInfo("MAINTENANCE_MODE_EXITED", { machineId });
    }
  }

  isMaintenance(machineId) {
    return this.maintenanceMode.has(machineId);
  }
}

module.exports = new IndustrialSafetyInterlockService();
