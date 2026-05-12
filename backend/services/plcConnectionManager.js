const { emitRealtime } = require("./realtimeService");

class PlcConnectionManager {
  constructor() {
    this.endpointQueues = new Map();
    this.machineLastOperation = new Map();
    this.endpointStats = new Map();
    this.DEFAULT_OPERATION_TIMEOUT_MS = Math.max(Number(process.env.PLC_QUEUE_OPERATION_TIMEOUT_MS || 15000), 1000);
  }

  getEndpointKey({ ip, port }) {
    return `${String(ip || "").trim()}:${Number(port) || 0}`;
  }

  getOrInitEndpointStats(endpointKey) {
    const existing = this.endpointStats.get(endpointKey);
    if (existing) return existing;
    const init = {
      endpointKey,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      timeouts: 0,
      maxQueueDepth: 0,
      lastDurationMs: null,
      avgDurationMs: null,
      totalDurationMs: 0,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
    this.endpointStats.set(endpointKey, init);
    return init;
  }

  withTimeout(promise, timeoutMs, onTimeout) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        const timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error(`PLC queue operation timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        promise.finally(() => clearTimeout(timer));
      }),
    ]);
  }

  async runExclusive({ machineId, ip, port, operationName, task, timeoutMs }) {
    const endpointKey = this.getEndpointKey({ ip, port });
    const stats = this.getOrInitEndpointStats(endpointKey);

    // Guard: reject immediately if queue depth is too high (prevents unbounded promise chains)
    const MAX_QUEUE_DEPTH = Math.max(Number(process.env.PLC_MAX_QUEUE_DEPTH || 10), 2);
    const currentDepth = stats.queued + stats.running;
    if (currentDepth >= MAX_QUEUE_DEPTH) {
      stats.lastError = "PLC_QUEUE_SATURATED";
      stats.updatedAt = new Date().toISOString();
      throw new Error(`PLC queue saturated (${currentDepth}/${MAX_QUEUE_DEPTH}) for ${endpointKey} — rejecting ${operationName || "UNKNOWN"}`);
    }

    const previous = this.endpointQueues.get(endpointKey) || Promise.resolve();
    stats.queued += 1;
    stats.maxQueueDepth = Math.max(stats.maxQueueDepth, stats.queued + stats.running);
    stats.updatedAt = new Date().toISOString();

    const run = async () => {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      stats.queued = Math.max(0, stats.queued - 1);
      stats.running += 1;
      stats.updatedAt = new Date().toISOString();
      try {
        const out = await this.withTimeout(
          Promise.resolve().then(task),
          Math.max(Number(timeoutMs || this.DEFAULT_OPERATION_TIMEOUT_MS), 1000),
          () => {
            stats.timeouts += 1;
            stats.lastError = "PLC_QUEUE_TIMEOUT";
          }
        );
        const durationMs = Date.now() - startedMs;
        stats.running = Math.max(0, stats.running - 1);
        stats.completed += 1;
        stats.lastDurationMs = durationMs;
        stats.totalDurationMs += durationMs;
        stats.avgDurationMs = Math.round(stats.totalDurationMs / Math.max(stats.completed, 1));
        stats.updatedAt = new Date().toISOString();
        this.machineLastOperation.set(Number(machineId || 0), {
          endpointKey,
          operationName: String(operationName || "UNKNOWN"),
          status: "OK",
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        return out;
      } catch (error) {
        stats.running = Math.max(0, stats.running - 1);
        stats.failed += 1;
        stats.lastError = String(error?.message || "Unknown PLC operation error");
        stats.updatedAt = new Date().toISOString();
        this.machineLastOperation.set(Number(machineId || 0), {
          endpointKey,
          operationName: String(operationName || "UNKNOWN"),
          status: "ERROR",
          error: String(error?.message || "Unknown PLC operation error"),
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        emitRealtime("plc_operation_error", {
          machineId: Number(machineId || 0) || null,
          endpointKey,
          operationName: String(operationName || "UNKNOWN"),
          error: String(error?.message || "Unknown PLC operation error"),
        });
        // Instead of crashing, log and return a handled error object
        console.warn(`[PLC][WARN] Operation timed out or failed: ${error?.message || "Unknown error"}`);
        return { ok: false, error: error?.message || "PLC operation failed" };
      }
    };

    const queued = previous.then(run, run);
    this.endpointQueues.set(endpointKey, queued.finally(() => {
      if (this.endpointQueues.get(endpointKey) === queued) {
        this.endpointQueues.delete(endpointKey);
      }
    }));
    return queued;
  }

  getMachineOperationSnapshot(machineId) {
    return this.machineLastOperation.get(Number(machineId || 0)) || null;
  }

  getQueueSnapshot() {
    return Array.from(this.endpointStats.values()).map((entry) => ({ ...entry }));
  }
}

module.exports = new PlcConnectionManager();
