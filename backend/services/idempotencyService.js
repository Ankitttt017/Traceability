/**
 * idempotencyService.js — Item #17
 * 
 * RAPID DOUBLE-SCAN PROTECTION
 * 
 * Prevents:
 * • Multiple scans of the same part within a short window.
 * • Duplicate database entries for a single production event.
 * • Duplicate PLC START signals for the same cycle.
 * 
 * Strategy:
 * • Lock part_id + machine_id combinations for a configurable duration.
 * • Atomic check-and-set for cycle tokens.
 */

const { logWarn } = require("./industrialLogger");

const LOCK_DURATION_MS = 5000; // 5 seconds lock per part/machine combo

class IdempotencyService {
  constructor() {
    // key -> lockExpiration
    this.locks = new Map();
  }

  /**
   * Attempt to acquire a lock for a scan.
   * Returns true if lock acquired, false if it's a duplicate scan.
   */
  acquireLock(machineId, partId) {
    const key = `${machineId}:${partId}`;
    const now = Date.now();
    const expiration = this.locks.get(key);

    if (expiration && now < expiration) {
      logWarn("IDEMPOTENCY_BLOCK_DOUBLE_SCAN", { machineId, partId, remainingMs: expiration - now });
      return false;
    }

    this.locks.set(key, now + LOCK_DURATION_MS);
    return true;
  }

  releaseLock(machineId, partId) {
    const key = `${machineId}:${partId}`;
    this.locks.delete(key);
  }

  /**
   * Cleanup expired locks to prevent memory growth.
   */
  cleanup() {
    const now = Date.now();
    for (const [key, expiration] of this.locks.entries()) {
      if (now >= expiration) {
        this.locks.delete(key);
      }
    }
  }
}

module.exports = new IdempotencyService();
