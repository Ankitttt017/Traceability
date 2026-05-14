/**
 * plcBackpressureService.js — Item #13
 * 
 * SOCKET EXHAUSTION PROTECTION & BACKPRESSURE
 * 
 * Manages:
 * • Max concurrent sockets per PLC IP.
 * • Request queue overflow rejection.
 * • Reconnect throttling.
 * • Backpressure handling for high-burst polling.
 * 
 * Prevents:
 * • PLC resource exhaustion.
 * • Backend memory leaks from infinite connection attempts.
 * • "Thundering herd" reconnect storms.
 */

const { logInfo, logWarn } = require("./industrialLogger");

const MAX_SOCKETS_PER_IP = 10;
const MAX_QUEUE_SIZE_PER_IP = 50;
const RECONNECT_THROTTLE_MS = 2000;

class PlcBackpressureService {
  constructor() {
    // ip -> { activeCount, queuedCount, lastReconnectAt }
    this.stats = new Map();
  }

  getStats(ip) {
    if (!this.stats.has(ip)) {
      this.stats.set(ip, { activeCount: 0, queuedCount: 0, lastReconnectAt: 0 });
    }
    return this.stats.get(ip);
  }

  /**
   * Check if a new connection attempt is allowed.
   */
  canConnect(ip) {
    const s = this.getStats(ip);
    
    // Throttling reconnects
    const now = Date.now();
    if (now - s.lastReconnectAt < RECONNECT_THROTTLE_MS) {
      logWarn("PLC_RECONNECT_THROTTLED", { ip, waitMs: RECONNECT_THROTTLE_MS - (now - s.lastReconnectAt) });
      return false;
    }

    if (s.activeCount >= MAX_SOCKETS_PER_IP) {
      logWarn("PLC_SOCKET_EXHAUSTED", { ip, activeCount: s.activeCount });
      return false;
    }

    return true;
  }

  /**
   * Check if a new request can be queued.
   */
  canQueue(ip) {
    const s = this.getStats(ip);
    if (s.queuedCount >= MAX_QUEUE_SIZE_PER_IP) {
      logWarn("PLC_QUEUE_OVERFLOW", { ip, queuedCount: s.queuedCount });
      return false;
    }
    return true;
  }

  incrementActive(ip) {
    const s = this.getStats(ip);
    s.activeCount++;
  }

  decrementActive(ip) {
    const s = this.getStats(ip);
    s.activeCount = Math.max(0, s.activeCount - 1);
  }

  incrementQueue(ip) {
    const s = this.getStats(ip);
    s.queuedCount++;
  }

  decrementQueue(ip) {
    const s = this.getStats(ip);
    s.queuedCount = Math.max(0, s.queuedCount - 1);
  }

  recordReconnect(ip) {
    const s = this.getStats(ip);
    s.lastReconnectAt = Date.now();
  }

  getAllStats() {
    return Object.fromEntries(this.stats);
  }
}

module.exports = new PlcBackpressureService();
