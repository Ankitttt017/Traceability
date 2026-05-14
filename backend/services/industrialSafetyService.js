/**
 * industrialSafetyService.js — Items #6 & #7
 * 
 * INDUSTRIAL SAFE MODE & FAILURE ISOLATION
 * 
 * Safe Mode:
 * • Triggered by repeated PLC instability (monitored via Watchdog).
 * • Rejects new scans and prevents new operation starts.
 * • Allows only recovery/reset operations.
 * • Requires supervisor/admin unlock.
 * 
 * Partial Failure Isolation:
 * • Isolates only affected machines if one PLC is unstable.
 * • Healthy machines continue normal operation.
 */

const { logInfo, logWarn } = require("./industrialLogger");
const industrialEventService = require("./industrialEventService");
const { operatorAuditService } = require("./operatorAuditService");

class IndustrialSafetyService {
  constructor() {
    this.safeMode = false;
    this.isolatedMachines = new Set(); // machineId
    this.instabilityCount = new Map(); // machineId -> count
    this.INSTABILITY_THRESHOLD = 5;    // Number of errors before isolation
    this.GLOBAL_SAFE_MODE_THRESHOLD = 3; // Number of isolated machines before global Safe Mode
  }

  /**
   * Called when a machine error occurs.
   * Tracks instability and triggers isolation or safe mode.
   */
  recordInstability(machineId) {
    const currentCount = (this.instabilityCount.get(machineId) || 0) + 1;
    this.instabilityCount.set(machineId, currentCount);

    if (currentCount >= this.INSTABILITY_THRESHOLD && !this.isolatedMachines.has(machineId)) {
      this.isolateMachine(machineId, `Instability threshold reached (${currentCount} errors)`);
    }

    if (this.isolatedMachines.size >= this.GLOBAL_SAFE_MODE_THRESHOLD && !this.safeMode) {
      this.enterGlobalSafeMode(`Too many isolated machines (${this.isolatedMachines.size})`);
    }
  }

  recordStability(machineId) {
    this.instabilityCount.set(machineId, 0);
  }

  /**
   * Item #7: Partial PLC Failure Isolation
   */
  isolateMachine(machineId, reason) {
    this.isolatedMachines.add(machineId);
    logWarn("MACHINE_ISOLATED", { machineId, reason });
    
    industrialEventService.emitWatchdogAlert(machineId, "CRITICAL", 
      `Machine isolated from production due to instability: ${reason}`, { machineId, reason });
    
    operatorAuditService.record({
      actionType: "MACHINE_ISOLATE",
      machineId,
      reason,
      metadata: { isolatedCount: this.isolatedMachines.size }
    });
  }

  rejoinMachine(machineId, user) {
    if (this.isolatedMachines.delete(machineId)) {
      this.instabilityCount.set(machineId, 0);
      logInfo("MACHINE_REJOINED", { machineId, user: user?.userName });
      
      operatorAuditService.record({
        actionType: "MACHINE_REJOIN",
        machineId,
        userName: user?.userName,
        userRole: user?.userRole,
        userId: user?.userId,
        reason: "Manual rejoin by operator"
      });

      if (this.isolatedMachines.size < this.GLOBAL_SAFE_MODE_THRESHOLD && this.safeMode) {
        this.exitGlobalSafeMode(user);
      }
      return true;
    }
    return false;
  }

  /**
   * Item #6: Industrial Safe Mode (Global)
   */
  enterGlobalSafeMode(reason) {
    this.safeMode = true;
    logWarn("SYSTEM_SAFE_MODE_ENTER", { reason });
    
    industrialEventService.emitWatchdogAlert(null, "LOCKDOWN", 
      `SYSTEM ENTERED SAFE MODE: ${reason}. Production scans disabled.`, { reason });
    
    operatorAuditService.record({
      actionType: "SAFE_MODE_ENTER",
      reason
    });
  }

  exitGlobalSafeMode(user) {
    this.safeMode = false;
    logInfo("SYSTEM_SAFE_MODE_EXIT", { user: user?.userName });
    
    operatorAuditService.record({
      actionType: "SAFE_MODE_EXIT",
      userName: user?.userName,
      userRole: user?.userRole,
      userId: user?.userId,
      reason: "Manual exit by supervisor"
    });
  }

  /**
   * Check if an operation is allowed.
   */
  isOperationAllowed(machineId) {
    if (this.safeMode) return false;
    if (this.isolatedMachines.has(machineId)) return false;
    return true;
  }

  getStatus() {
    return {
      safeMode: this.safeMode,
      isolatedMachines: Array.from(this.isolatedMachines),
      instabilityCounts: Object.fromEntries(this.instabilityCount)
    };
  }
}

module.exports = new IndustrialSafetyService();
