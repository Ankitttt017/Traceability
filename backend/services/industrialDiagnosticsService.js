/**
 * industrialDiagnosticsService.js
 * 
 * INDUSTRIAL DIAGNOSTICS & RCA TRACING
 * 
 * Aggregates data from:
 * • PLC Latency (Hold/Detect times)
 * • Clock Drift
 * • Handshake Integrity Timeline
 * • Watchdog Escalations
 * • Machine Health Scores
 * • Audit Trails
 * 
 * Provides:
 * • Industrial Diagnostics Dashboard Data.
 * • RCA (Root Cause Analysis) Trace Export.
 */

const plcSignalHoldService = require("./plcSignalHoldService");
const plcClockDriftService = require("./plcClockDriftService");
const plcCycleIntegrityService = require("./plcCycleIntegrityService");
const plcCorrelationService = require("./plcCorrelationService");
const machineWatchdogService = require("./machineWatchdogService");
const { operatorAuditService } = require("./operatorAuditService");
const industrialSafetyService = require("./industrialSafetyService");

class IndustrialDiagnosticsService {
  /**
   * Get a comprehensive snapshot of a machine's industrial health.
   */
  async getMachineHealthDiagnostic(machineId) {
    const holdMetrics = plcSignalHoldService.getMetrics(machineId);
    const drift = plcClockDriftService.getDrift(machineId);
    const healthScore = plcCorrelationService.getHealthScore(machineId);
    const safetyStatus = industrialSafetyService.getStatus();
    
    // Check if machine is isolated
    const isIsolated = safetyStatus.isolatedMachines.includes(Number(machineId));

    return {
      machineId,
      timestamp: new Date().toISOString(),
      health: {
        score: healthScore,
        isIsolated,
        isSafeMode: safetyStatus.safeMode,
      },
      plc: {
        driftMs: drift?.driftMs || 0,
        latencyMs: drift?.networkLatencyMs || 0,
        signalHolds: holdMetrics,
      },
      watchdog: machineWatchdogService.machineStats.get(Number(machineId)) || { errors: 0 }
    };
  }

  /**
   * Generate an RCA (Root Cause Analysis) report for a specific cycle/part.
   */
  async generateRcaReport(cycleToken) {
    const timeline = plcCycleIntegrityService.history.get(cycleToken);
    const auditLogs = await operatorAuditService.getAuditTrail({ cycleToken });

    return {
      cycleToken,
      generatedAt: new Date().toISOString(),
      timeline: timeline || [],
      operatorInterventions: auditLogs,
      summary: timeline ? "Incomplete" : "Not Found / Archived"
    };
  }
}

module.exports = new IndustrialDiagnosticsService();
