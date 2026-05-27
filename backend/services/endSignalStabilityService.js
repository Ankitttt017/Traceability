/**
 * EndSignalStabilityService — Item #2
 * Do NOT trust a single END_OK/END_NG read.
 * Requires the signal to be stable across multiple consecutive polls
 * within a configurable debounce window before accepting it as truth.
 * Prevents flicker-based false PASS and stale END signal reuse.
 */

const { logInfo, logWarn } = require("./industrialLogger");
const industrialEventService = require("./industrialEventService");

const DEFAULT_DEBOUNCE_POLLS = 3;       // Signal must be stable for N consecutive polls
const DEFAULT_DEBOUNCE_WINDOW_MS = 600; // All polls must occur within this window
const DEFAULT_MAX_SIGNAL_AGE_MS = 5000; // END signal older than this is considered stale

class EndSignalStabilityService {
  constructor() {
    // machineId -> { END_OK: { readings: [], firstSeenAt }, END_NG: {...} }
    this.buffer = new Map();
    // machineId -> { END_OK: confirmedAt, END_NG: confirmedAt }
    this.confirmed = new Map();
  }

  /**
   * Feed a new poll reading into the stability buffer.
   * Returns { stable: true, signal: "END_OK"|"END_NG" } when confirmed stable.
   * Returns { stable: false } if not yet stable.
   */
  feedReading(machineId, signals = {}, options = {}) {
    const debouncePollsRequired = options.debounce_polls || DEFAULT_DEBOUNCE_POLLS;
    const debounceWindowMs = options.debounce_window_ms || DEFAULT_DEBOUNCE_WINDOW_MS;
    const now = Date.now();

    if (!this.buffer.has(machineId)) {
      this.buffer.set(machineId, { END_OK: { readings: [], firstSeenAt: null }, END_NG: { readings: [], firstSeenAt: null } });
    }

    const buf = this.buffer.get(machineId);

    for (const sigName of ["END_OK", "END_NG"]) {
      const isHigh = Boolean(signals[sigName]);

      if (!isHigh) {
        // Signal is low — clear the buffer for this signal
        buf[sigName].readings = [];
        buf[sigName].firstSeenAt = null;
        continue;
      }

      // Signal is high — record reading
      if (!buf[sigName].firstSeenAt) {
        buf[sigName].firstSeenAt = now;
      }
      buf[sigName].readings.push(now);

      // Purge readings outside debounce window
      buf[sigName].readings = buf[sigName].readings.filter(t => now - t <= debounceWindowMs);

      // Check if already confirmed this cycle (prevent re-use of stale END signal)
      const alreadyConfirmed = this.confirmed.get(machineId)?.[sigName];
      if (alreadyConfirmed) {
        const age = now - alreadyConfirmed;
        if (age < DEFAULT_MAX_SIGNAL_AGE_MS) {
          // Already confirmed recently — do not re-trigger
          logWarn("END_SIGNAL_STALE_REUSE_BLOCKED", { machineId, signal: sigName, ageMs: age });
          return { stable: false, reason: "STALE_REUSE_BLOCKED" };
        }
      }

      if (buf[sigName].readings.length >= debouncePollsRequired) {
        // Check window consistency
        const windowSpan = buf[sigName].readings.at(-1) - buf[sigName].readings[0];
        if (windowSpan <= debounceWindowMs) {
          // CONFIRMED STABLE
          if (!this.confirmed.has(machineId)) this.confirmed.set(machineId, {});
          this.confirmed.get(machineId)[sigName] = now;

          logInfo("END_SIGNAL_STABLE_CONFIRMED", {
            machineId,
            signal: sigName,
            pollCount: buf[sigName].readings.length,
            windowSpanMs: windowSpan,
          });

          return { stable: true, signal: sigName, confirmedAt: now, pollCount: buf[sigName].readings.length };
        }
      }
    }

    return { stable: false };
  }

  /**
   * Validate that an END signal is not stale (e.g., leftover from previous cycle).
   */
  isSignalStale(machineId, signal, maxAgeMs = DEFAULT_MAX_SIGNAL_AGE_MS) {
    const confirmedAt = this.confirmed.get(machineId)?.[signal];
    if (!confirmedAt) return false;
    return (Date.now() - confirmedAt) > maxAgeMs;
  }

  /**
   * Call this at the start of a new cycle to reset stability buffers.
   */
  resetForNewCycle(machineId) {
    this.buffer.delete(machineId);
    this.confirmed.delete(machineId);
  }

  getBuffer(machineId) {
    return this.buffer.get(machineId) || {};
  }
}

module.exports = new EndSignalStabilityService();
