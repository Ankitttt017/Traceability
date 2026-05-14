/**
 * industrialCommissioningMode.js — Item #20
 * 
 * FINAL PRODUCTION COMMISSIONING MODE
 * 
 * When enabled (typically for the first week of production):
 * • Verbose industrial logs enabled.
 * • Every state transition traced to DB/Audit.
 * • High-frequency queue metrics telemetry.
 * • PLC latency histograms recorded.
 * • Full signal snapshots for every transition.
 */

const { logInfo } = require("./industrialLogger");

class IndustrialCommissioningMode {
  constructor() {
    this.enabled = process.env.INDUSTRIAL_COMMISSIONING_MODE === "true";
    this.traceTransitions = true;
    this.verboseAudit = true;
    this.snapshotFrequency = "EVERY_TRANSITION";
  }

  enable() {
    this.enabled = true;
    logInfo("COMMISSIONING_MODE_ENABLED", { 
      message: "Verbose industrial tracing and telemetry active." 
    });
  }

  disable() {
    this.enabled = false;
    logInfo("COMMISSIONING_MODE_DISABLED", { 
      message: "Standard production logging active." 
    });
  }

  isActive() {
    return this.enabled;
  }

  /**
   * Determine if we should record a full snapshot for this event.
   */
  shouldSnapshot(event) {
    if (!this.enabled) return false;
    // In commissioning mode, we snapshot everything critical
    return ["TRANSITION", "ERROR", "RECOVERY", "WATCHDOG"].includes(event);
  }

  getSettings() {
    return {
      enabled: this.enabled,
      traceTransitions: this.traceTransitions,
      verboseAudit: this.verboseAudit,
      snapshotFrequency: this.snapshotFrequency
    };
  }
}

module.exports = new IndustrialCommissioningMode();
