const { logInfo, logWarn } = require("./industrialLogger");

const DEFAULT_CACHE_TTL_MS = Math.max(Number(process.env.BATCH_REGISTER_CACHE_TTL_MS || 5000), 250);
const DEFAULT_BATCH_WINDOW_MS = Math.max(Number(process.env.BATCH_REGISTER_WINDOW_MS || 80), 10);

class RegisterSnapshot {
  constructor(startAddress, endAddress, values = {}, ttlMs = DEFAULT_CACHE_TTL_MS) {
    this.startAddress = startAddress;
    this.endAddress = endAddress;
    this.values = values;
    this.timestamp = Date.now();
    this.ttlMs = ttlMs;
  }

  isExpired() {
    return Date.now() - this.timestamp > this.ttlMs;
  }

  getValue(address) {
    if (address < this.startAddress || address > this.endAddress) {
      return null;
    }
    return Object.prototype.hasOwnProperty.call(this.values, address) ? this.values[address] : null;
  }
}

class BatchRegisterOptimizer {
  constructor() {
    this.snapshots = new Map(); // endpoint -> Map<startAddress, RegisterSnapshot>
    this.pendingBatches = new Map(); // endpoint -> { addresses:Set<number>, readFn, waiters:[], timerRef }
  }

  async requestRegisterRead({ ip, port, address, readFn, batchWindow = DEFAULT_BATCH_WINDOW_MS }) {
    const endpoint = `${ip}:${port}`;
    const normalizedAddress = Number(address);

    if (!Number.isFinite(normalizedAddress)) {
      throw new Error("requestRegisterRead requires a numeric address");
    }

    const cached = this._getCachedValue(endpoint, normalizedAddress);
    if (cached !== null) {
      return { value: cached, fromCache: true };
    }

    return new Promise((resolve, reject) => {
      const pending = this._getOrCreatePendingBatch(endpoint, readFn, batchWindow);
      pending.addresses.add(normalizedAddress);
      pending.waiters.push({
        targetAddress: normalizedAddress,
        resolve,
        reject,
      });
    });
  }

  _getOrCreatePendingBatch(endpoint, readFn, batchWindow) {
    const existing = this.pendingBatches.get(endpoint);
    if (existing) {
      if (existing.readFn !== readFn) {
        logWarn("BATCH_REGISTER_READFN_MISMATCH", { endpoint });
      }
      return existing;
    }

    const pending = {
      endpoint,
      readFn,
      addresses: new Set(),
      waiters: [],
      timerRef: null,
      startedAt: Date.now(),
    };

    pending.timerRef = setTimeout(() => {
      this._flushPendingBatch(endpoint).catch((error) => {
        logWarn("BATCH_REGISTER_FLUSH_ERROR", {
          endpoint,
          error: error.message,
        });
      });
    }, Math.max(Number(batchWindow || DEFAULT_BATCH_WINDOW_MS), 10));

    this.pendingBatches.set(endpoint, pending);
    return pending;
  }

  async _flushPendingBatch(endpoint) {
    const pending = this.pendingBatches.get(endpoint);
    if (!pending) {
      return;
    }
    this.pendingBatches.delete(endpoint);

    if (pending.timerRef) {
      clearTimeout(pending.timerRef);
      pending.timerRef = null;
    }

    const addresses = Array.from(pending.addresses);
    if (addresses.length === 0) {
      for (const waiter of pending.waiters) {
        waiter.resolve({ value: null, fromCache: false, allResults: {} });
      }
      return;
    }

    try {
      const groups = this._groupContiguousAddresses(addresses);
      const results = {};

      for (const group of groups) {
        const { start, end } = group;
        const values = await pending.readFn({
          startAddress: start,
          endAddress: end,
          quantity: end - start + 1,
        });

        const snapshot = new RegisterSnapshot(start, end, values || {});
        if (!this.snapshots.has(endpoint)) {
          this.snapshots.set(endpoint, new Map());
        }
        this.snapshots.get(endpoint).set(start, snapshot);

        for (const address of group.addresses) {
          results[address] = Object.prototype.hasOwnProperty.call(values || {}, address)
            ? values[address]
            : null;
        }
      }

      for (const waiter of pending.waiters) {
        waiter.resolve({
          value: Object.prototype.hasOwnProperty.call(results, waiter.targetAddress)
            ? results[waiter.targetAddress]
            : null,
          fromCache: false,
          allResults: results,
        });
      }

      logInfo("BATCH_REGISTER_FLUSHED", {
        endpoint,
        requestedAddresses: addresses.length,
        groups: groups.length,
        waiters: pending.waiters.length,
        windowMs: Date.now() - pending.startedAt,
      });
    } catch (error) {
      for (const waiter of pending.waiters) {
        waiter.reject(error);
      }
      throw error;
    }
  }

  _groupContiguousAddresses(addresses) {
    if (addresses.length === 0) return [];

    const sorted = [...addresses]
      .map((entry) => Math.trunc(Number(entry)))
      .filter((entry) => Number.isFinite(entry))
      .sort((a, b) => a - b);

    const groups = [];
    let current = {
      start: sorted[0],
      end: sorted[0],
      addresses: [sorted[0]],
    };

    for (let i = 1; i < sorted.length; i += 1) {
      const address = sorted[i];
      if (address - current.end <= 10) {
        current.end = Math.max(current.end, address);
        current.addresses.push(address);
        continue;
      }
      groups.push(current);
      current = {
        start: address,
        end: address,
        addresses: [address],
      };
    }
    groups.push(current);
    return groups;
  }

  _getCachedValue(endpoint, address) {
    const endpointSnapshots = this.snapshots.get(endpoint);
    if (!endpointSnapshots) return null;

    for (const [key, snapshot] of endpointSnapshots.entries()) {
      if (snapshot.isExpired()) {
        endpointSnapshots.delete(key);
        continue;
      }

      const value = snapshot.getValue(address);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }

  invalidateCache(ip, port) {
    const endpoint = `${ip}:${port}`;
    this.snapshots.delete(endpoint);
    logInfo("BATCH_REGISTER_CACHE_INVALIDATED", { endpoint });
  }

  invalidateCacheRange(ip, port, startAddress, endAddress) {
    const endpoint = `${ip}:${port}`;
    const endpointSnapshots = this.snapshots.get(endpoint);
    if (!endpointSnapshots) return;

    for (const [key, snapshot] of endpointSnapshots.entries()) {
      if (!(snapshot.endAddress < startAddress || snapshot.startAddress > endAddress)) {
        endpointSnapshots.delete(key);
      }
    }

    logInfo("BATCH_REGISTER_CACHE_RANGE_INVALIDATED", {
      endpoint,
      range: `${startAddress}-${endAddress}`,
    });
  }

  getCacheStats() {
    const stats = {
      totalSnapshots: 0,
      totalCachedRegisters: 0,
      pendingBatches: this.pendingBatches.size,
      endpoints: {},
    };

    for (const [endpoint, snapshots] of this.snapshots.entries()) {
      let endpointTotal = 0;
      let snapshotCount = 0;
      for (const snapshot of snapshots.values()) {
        if (snapshot.isExpired()) {
          continue;
        }
        snapshotCount += 1;
        endpointTotal += snapshot.endAddress - snapshot.startAddress + 1;
      }

      stats.endpoints[endpoint] = {
        snapshots: snapshotCount,
        cachedRegisters: endpointTotal,
      };
      stats.totalSnapshots += snapshotCount;
      stats.totalCachedRegisters += endpointTotal;
    }

    return stats;
  }

  cleanup() {
    for (const [endpoint, pending] of this.pendingBatches.entries()) {
      if (pending.timerRef) {
        clearTimeout(pending.timerRef);
      }
      for (const waiter of pending.waiters) {
        waiter.reject(new Error(`Batch optimizer cleanup interrupted pending batch for ${endpoint}`));
      }
    }
    this.pendingBatches.clear();

    for (const [, snapshots] of this.snapshots.entries()) {
      for (const [key, snapshot] of snapshots.entries()) {
        if (snapshot.isExpired()) {
          snapshots.delete(key);
        }
      }
    }
  }
}

const optimizer = new BatchRegisterOptimizer();

module.exports = {
  requestRegisterRead: (opts) => optimizer.requestRegisterRead(opts),
  invalidateCache: (ip, port) => optimizer.invalidateCache(ip, port),
  invalidateCacheRange: (ip, port, start, end) => optimizer.invalidateCacheRange(ip, port, start, end),
  getCacheStats: () => optimizer.getCacheStats(),
  cleanup: () => optimizer.cleanup(),
};
