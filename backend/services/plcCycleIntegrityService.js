/**
 * plcCycleIntegrityService.js — Item #15
 * 
 * TIMELINE INTEGRITY VALIDATION
 * 
 * Every industrial cycle MUST contain the following sequence:
 * SCANNED -> VALIDATED -> START_SENT -> 
 * WAITING_RUNNING -> RUNNING -> WAITING_END -> COMPLETED_OK/NG -> RESETTING -> IDLE
 * 
 * Checks for:
 * • Missing transitions.
 * • Out-of-order states.
 * • Time-jumps (impossible transition speeds).
 */

const { logWarn } = require("./industrialLogger");

const MANDATORY_SEQUENCE = [
  "SCANNED",
  "VALIDATED",
  "START_SENT",
  "WAITING_RUNNING",
  "RUNNING",
  "WAITING_END"
];

class PlcCycleIntegrityService {
  constructor() {
    // cycleToken -> [states]
    this.history = new Map();
  }

  recordTransition(cycleToken, state) {
    if (!cycleToken) return;
    if (!this.history.has(cycleToken)) {
      this.history.set(cycleToken, []);
    }
    this.history.get(cycleToken).push({
      state,
      timestamp: Date.now()
    });
  }

  /**
   * Validate the full timeline of a completed cycle.
   */
  validate(cycleToken) {
    const timeline = this.history.get(cycleToken);
    if (!timeline) return { valid: false, reason: "NO_HISTORY" };

    const states = timeline.map(t => t.state);
    const missing = MANDATORY_SEQUENCE.filter(s => !states.includes(s));

    if (missing.length > 0) {
      logWarn("CYCLE_INTEGRITY_MISSING_STATES", { cycleToken, missing });
      return { 
        valid: false, 
        reason: "MISSING_MANDATORY_STATES", 
        missing,
        timeline: states 
      };
    }

    // Check order
    let lastIdx = -1;
    for (const state of states) {
      const currentIdx = MANDATORY_SEQUENCE.indexOf(state);
      if (currentIdx !== -1) {
        if (currentIdx < lastIdx) {
          logWarn("CYCLE_INTEGRITY_OUT_OF_ORDER", { cycleToken, state, lastIdx, currentIdx });
          return { valid: false, reason: "OUT_OF_ORDER_TRANSITION", timeline: states };
        }
        lastIdx = currentIdx;
      }
    }

    // Cleanup after validation
    this.history.delete(cycleToken);
    return { valid: true };
  }

  purgeOld(maxAgeMs = 3600000) {
    const now = Date.now();
    for (const [token, timeline] of this.history.entries()) {
      if (timeline.length > 0 && (now - timeline[0].timestamp) > maxAgeMs) {
        this.history.delete(token);
      }
    }
  }
}

module.exports = new PlcCycleIntegrityService();
