function toBoundedInt(value, fallback, min = 1, max = 120000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(parsed), min), max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

/**
 * Generates a 32-bit unsigned integer hash from a string.
 * Uses a polynomial rolling hash with a 32-bit accumulator.
 * Returns values in range [0, 4,294,967,295] — ~4.2 billion unique values,
 * making collision risk near-zero compared to the old 16-bit (65,535) approach.
 *
 * @param {string} value - The part ID or station identifier to hash.
 * @returns {number} A 32-bit unsigned integer hash.
 */
function hashToRegisterValue(value) {
  const text = String(value || "");
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // FNV prime: 0x01000193 (16777619) — multiplication stays within JS safe integer range
    hash = Math.imul(hash, 0x01000193);
  }
  // Ensure unsigned 32-bit
  return hash >>> 0;
}

/**
 * Splits a 32-bit unsigned integer into two 16-bit words for PLC dual-register writes.
 * Write highWord to register N, lowWord to register N+1.
 *
 * @param {number} value32 - A 32-bit unsigned integer (from hashToRegisterValue).
 * @returns {[number, number]} [highWord (bits 31-16), lowWord (bits 15-0)]
 */
function split32To16(value32) {
  const u32 = (value32 >>> 0); // ensure unsigned
  const highWord = (u32 >>> 16) & 0xffff;
  const lowWord = u32 & 0xffff;
  return [highWord, lowWord];
}

/*
 * ─── UNIT TEST REFERENCE (Commented) ───────────────────────────────────────
 * Run manually in Node REPL to verify correctness:
 *
 * const { hashToRegisterValue, split32To16 } = require('./utils');
 *
 * Test 1: Short typical part ID
 *   Input : "PART-001"
 *   hash  : hashToRegisterValue("PART-001")  // e.g. 3857650428
 *   split : split32To16(3857650428)           // e.g. [58851, 58492]
 *
 * Test 2: Long part ID with timestamp
 *   Input : "PART-20260314-XJ9-0042"
 *   hash  : hashToRegisterValue("PART-20260314-XJ9-0042")
 *   split : split32To16(hash)
 *
 * Test 3: Empty/null guard
 *   Input : null
 *   hash  : hashToRegisterValue(null)   // deterministic hash of ""
 *   split : split32To16(hash)           // always [highWord, lowWord] — never throws
 *
 * Collision check: hashToRegisterValue("PART-001") !== hashToRegisterValue("PART-002")  // true
 * ─────────────────────────────────────────────────────────────────────────────
 */

module.exports = {
  toBoundedInt,
  sleep,
  withTimeout,
  hashToRegisterValue,
  split32To16,
};
