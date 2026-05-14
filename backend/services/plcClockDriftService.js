/**
 * PlcClockDriftService — Item #4
 * Monitors drift between backend system clock and PLC timestamps.
 * Compensates for network latency in watchdog escalation timing and RCA timelines.
 */

const { logInfo, logWarn } = require("./industrialLogger");
const industrialEventService = require("./industrialEventService");

const MAX_ACCEPTABLE_DRIFT_MS = 500;   // Alert if drift > 500ms
const CRITICAL_DRIFT_MS = 2000;        // Critical alert if drift > 2s
const MEASUREMENT_INTERVAL_MS = 30000; // Re-measure every 30s per machine

class PlcClockDriftService {
  constructor() {
    // machineId -> { driftMs, networkLatencyMs, lastMeasuredAt, samples }
    this.driftMap = new Map();
  }

  /**
   * Record a PLC timestamp reading alongside the backend timestamp.
   * Uses the round-trip-time to estimate latency and compute drift.
   */
  recordMeasurement(machineId, { plcTimestampMs, requestSentAt, responsReceivedAt }) {
    const networkLatencyMs = Math.max(0, Math.floor((responsReceivedAt - requestSentAt) / 2));
    const backendNow = requestSentAt + networkLatencyMs; // approximate PLC "receive" time
    const driftMs = plcTimestampMs ? Math.abs(backendNow - plcTimestampMs) : null;

    const entry = {
      driftMs,
      networkLatencyMs,
      lastMeasuredAt: new Date(),
      plcTimestampMs,
      backendTimestampMs: backendNow,
    };

    if (!this.driftMap.has(machineId)) {
      this.driftMap.set(machineId, { history: [], ...entry });
    }

    const existing = this.driftMap.get(machineId);
    existing.history = [...(existing.history || []).slice(-19), entry]; // keep last 20
    Object.assign(existing, entry);

    if (driftMs !== null) {
      if (driftMs >= CRITICAL_DRIFT_MS) {
        logWarn("PLC_CLOCK_DRIFT_CRITICAL", { machineId, driftMs, networkLatencyMs });
        industrialEventService.emitWatchdogAlert(machineId, "CRITICAL",
          `PLC clock drift CRITICAL: ${driftMs}ms. RCA timelines and watchdog timing unreliable.`,
          { driftMs, networkLatencyMs }
        );
      } else if (driftMs >= MAX_ACCEPTABLE_DRIFT_MS) {
        logWarn("PLC_CLOCK_DRIFT_WARNING", { machineId, driftMs, networkLatencyMs });
        industrialEventService.emitWatchdogAlert(machineId, "WARNING",
          `PLC clock drift detected: ${driftMs}ms.`,
          { driftMs, networkLatencyMs }
        );
      } else {
        logInfo("PLC_CLOCK_DRIFT_OK", { machineId, driftMs, networkLatencyMs });
      }
    }

    return entry;
  }

  /**
   * Adjust a raw PLC timestamp to compensate for measured drift.
   */
  compensateTimestamp(machineId, rawTimestampMs) {
    const drift = this.driftMap.get(machineId);
    if (!drift || drift.driftMs === null) return rawTimestampMs;
    // Simple linear compensation — subtract measured drift
    return rawTimestampMs - drift.driftMs;
  }

  getDrift(machineId) {
    return this.driftMap.get(machineId) || null;
  }

  getAllDrifts() {
    const out = {};
    for (const [id, d] of this.driftMap) out[id] = d;
    return out;
  }

  shouldRemeasure(machineId) {
    const drift = this.driftMap.get(machineId);
    if (!drift?.lastMeasuredAt) return true;
    return Date.now() - new Date(drift.lastMeasuredAt).getTime() > MEASUREMENT_INTERVAL_MS;
  }
}

module.exports = new PlcClockDriftService();
