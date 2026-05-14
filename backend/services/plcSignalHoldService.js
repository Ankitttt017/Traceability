/**
 * PlcSignalHoldService — Item #1
 * Tracks actual PLC signal hold durations, PLC detect latency, and missed pulse counts.
 * Ensures START/RESET/BLOCK signals are visible long enough for the PLC scan cycle to detect.
 */

const { logInfo, logWarn } = require("./industrialLogger");
const industrialEventService = require("./industrialEventService");

// Default hold requirements (ms) — must exceed PLC scan cycle (typically 10-20ms)
const DEFAULT_HOLD_REQUIREMENTS_MS = {
  START: 120,   // START must be held ≥120ms
  RESET: 150,   // RESET must be held ≥150ms
  BLOCK: 100,   // BLOCK must be held ≥100ms
};

class PlcSignalHoldService {
  constructor() {
    // machineId -> { signal -> { sentAt, heldMs, detectedAt, latencyMs, missedCount } }
    this.metrics = new Map();
  }

  /**
   * Called immediately when a signal is sent to PLC.
   */
  recordSignalSent(machineId, signal) {
    if (!this.metrics.has(machineId)) {
      this.metrics.set(machineId, {});
    }
    const m = this.metrics.get(machineId);
    m[signal] = {
      sentAt: Date.now(),
      heldMs: null,
      detectedAt: null,
      latencyMs: null,
      missedCount: m[signal]?.missedCount || 0,
    };
  }

  /**
   * Called when the signal is released/cleared.
   */
  recordSignalReleased(machineId, signal) {
    const m = this.metrics.get(machineId);
    if (!m?.[signal]?.sentAt) return;

    const heldMs = Date.now() - m[signal].sentAt;
    m[signal].heldMs = heldMs;

    const required = DEFAULT_HOLD_REQUIREMENTS_MS[signal] || 100;
    if (heldMs < required) {
      m[signal].missedCount = (m[signal].missedCount || 0) + 1;
      logWarn("SIGNAL_HOLD_INSUFFICIENT", {
        machineId,
        signal,
        heldMs,
        requiredMs: required,
        missedCount: m[signal].missedCount,
      });
      industrialEventService.emitWatchdogAlert(machineId, "WARNING",
        `Signal ${signal} held only ${heldMs}ms (required ≥${required}ms). PLC may have missed pulse.`,
        { signal, heldMs, requiredMs: required, missedCount: m[signal].missedCount }
      );
    } else {
      logInfo("SIGNAL_HOLD_OK", { machineId, signal, heldMs, requiredMs: required });
    }
  }

  /**
   * Called when PLC ACK confirms it detected the signal.
   */
  recordSignalDetected(machineId, signal) {
    const m = this.metrics.get(machineId);
    if (!m?.[signal]?.sentAt) return;

    const detectedAt = Date.now();
    m[signal].detectedAt = detectedAt;
    m[signal].latencyMs = detectedAt - m[signal].sentAt;

    logInfo("SIGNAL_DETECT_LATENCY", {
      machineId,
      signal,
      latencyMs: m[signal].latencyMs,
      heldMs: m[signal].heldMs,
    });
  }

  getMetrics(machineId) {
    return this.metrics.get(machineId) || {};
  }

  getAllMetrics() {
    const out = {};
    for (const [machineId, signals] of this.metrics.entries()) {
      out[machineId] = signals;
    }
    return out;
  }

  resetMetrics(machineId) {
    this.metrics.delete(machineId);
  }
}

module.exports = new PlcSignalHoldService();
