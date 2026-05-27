/**
 * plcRetryQueue_HARDENED.js
 * ════════════════════════════════════════════════════════════════
 * 
 * INDUSTRIAL PLC WRITE RETRY QUEUE WITH CLEANUP
 * 
 * Guarantees:
 * • All interval timers have refs for cleanup
 * • Proper shutdown/restart lifecycle
 * • Prevents stale intervals from accumulating
 * • No memory leaks on server reload
 * • Structured retry telemetry
 * 
 * ════════════════════════════════════════════════════════════════
 */

const { emitRealtime } = require("./realtimeService");
const { logInfo, logWarn, logError } = require("./industrialLogger");

const MAX_RETRIES = Number(process.env.PLC_RETRY_MAX_ATTEMPTS || 3);
const RETRY_DELAY_MS = Number(process.env.PLC_RETRY_DELAY_MS || 2000);
const PROCESS_INTERVAL_MS = Number(process.env.PLC_RETRY_PROCESS_INTERVAL_MS || 5000);

/** @type {Map<string, object[]>} */
const queues = new Map(); // keyed by machineId

/** @type {NodeJS.Timeout | null} */
let processingTimerRef = null;

/** @type {Set<NodeJS.Timeout>} */
const allTimerRefs = new Set();

const telemetry = {
  totalEnqueued: 0,
  totalRetried: 0,
  totalSucceeded: 0,
  totalFailed: 0,
  currentQueueSize: 0,
};

function _makeKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Enqueue a failed PLC write operation for retry.
 */
function enqueue({ machineId, operation, payload, retryFn }) {
  const id = String(machineId || "global");
  if (!queues.has(id)) queues.set(id, []);

  const item = {
    _key: _makeKey(),
    machineId,
    operation,
    payload,
    retryFn,
    attempts: 0,
    timestamp: new Date().toISOString(),
  };

  queues.get(id).push(item);
  telemetry.totalEnqueued += 1;
  telemetry.currentQueueSize = _getTotalQueueSize();

  logInfo("PLC_RETRY_ENQUEUED", {
    machineId,
    operation,
    queueSize: queues.get(id).length,
  });

  emitRealtime("plc:retry_enqueued", {
    machineId,
    operation,
    timestamp: item.timestamp,
  });
}

/**
 * Process all pending queue items.
 */
async function processQueue() {
  try {
    for (const [machineId, items] of queues.entries()) {
      const remaining = [];

      for (const item of items) {
        if (item.attempts >= MAX_RETRIES) {
          // Exhausted all retries
          logError("PLC_RETRY_EXHAUSTED", {
            machineId: item.machineId,
            operation: item.operation,
            attempts: item.attempts,
            timestamp: item.timestamp,
          });

          telemetry.totalFailed += 1;

          emitRealtime("plc:retry_failed", {
            machineId: item.machineId,
            operation: item.operation,
            payload: item.payload,
            attempts: item.attempts,
            timestamp: item.timestamp,
            failedAt: new Date().toISOString(),
          });

          continue; // Don't re-queue
        }

        item.attempts += 1;
        telemetry.totalRetried += 1;

        try {
          await item.retryFn(item.payload);

          logInfo("PLC_RETRY_SUCCESS", {
            machineId: item.machineId,
            operation: item.operation,
            attempt: item.attempts,
          });

          telemetry.totalSucceeded += 1;

          emitRealtime("plc:retry_succeeded", {
            machineId: item.machineId,
            operation: item.operation,
            attempts: item.attempts,
            timestamp: new Date().toISOString(),
          });

          // Successfully retried — don't re-queue
        } catch (err) {
          logWarn("PLC_RETRY_ATTEMPT_FAILED", {
            machineId: item.machineId,
            operation: item.operation,
            attempt: item.attempts,
            maxRetries: MAX_RETRIES,
            error: err.message,
          });

          // Keep in queue for next cycle
          remaining.push(item);
        }
      }

      if (remaining.length > 0) {
        queues.set(machineId, remaining);
      } else {
        queues.delete(machineId);
      }
    }

    telemetry.currentQueueSize = _getTotalQueueSize();
  } catch (error) {
    logError("PLC_RETRY_PROCESS_ERROR", {
      error: error.message,
    });
  }
}

/**
 * Get total queue size across all machines.
 */
function _getTotalQueueSize() {
  let total = 0;
  for (const items of queues.values()) {
    total += items.length;
  }
  return total;
}

/**
 * Start the processing loop (setTimeout chain).
 */
function startProcessing() {
  if (processingTimerRef) {
    logWarn("PLC_RETRY_PROCESSING_ALREADY_RUNNING", {});
    return;
  }

  const scheduleNextProcess = () => {
    const timerRef = setTimeout(async () => {
      allTimerRefs.delete(timerRef);
      if (processingTimerRef !== timerRef) {
        return;
      }
      try {
        await processQueue();
      } catch (error) {
        logError("PLC_RETRY_PROCESS_CYCLE_ERROR", {
          error: error.message,
        });
      } finally {
        if (processingTimerRef === timerRef) {
          scheduleNextProcess();
        }
      }
    }, PROCESS_INTERVAL_MS);
    processingTimerRef = timerRef;
    allTimerRefs.add(timerRef);
  };

  scheduleNextProcess();

  logInfo("PLC_RETRY_PROCESSING_STARTED", {
    intervalMs: PROCESS_INTERVAL_MS,
    maxRetries: MAX_RETRIES,
  });
}

/**
 * Stop the processing loop.
 */
function stopProcessing() {
  if (processingTimerRef) {
    clearTimeout(processingTimerRef);
    allTimerRefs.delete(processingTimerRef);
    processingTimerRef = null;
  }

  logInfo("PLC_RETRY_PROCESSING_STOPPED", {});
}

/**
 * Clear all queues and stop processing.
 */
function clearQueue() {
  queues.clear();
  stopProcessing();
  telemetry.currentQueueSize = 0;

  logInfo("PLC_RETRY_QUEUE_CLEARED", {});
}

/**
 * Get queue snapshot for diagnostics.
 */
function getQueueSnapshot() {
  const snapshot = {
    timestamp: new Date().toISOString(),
    isProcessing: processingTimerRef !== null,
    totalMachines: queues.size,
    totalQueuedItems: _getTotalQueueSize(),
    telemetry,
    queues: {},
  };

  for (const [machineId, items] of queues.entries()) {
    snapshot.queues[machineId] = {
      count: items.length,
      items: items.map((item) => ({
        key: item._key,
        operation: item.operation,
        attempts: item.attempts,
        timestamp: item.timestamp,
      })),
    };
  }

  return snapshot;
}

/**
 * Cleanup on shutdown - clear all timers and queues.
 */
function cleanup() {
  stopProcessing();
  const timersCleaned = allTimerRefs.size;
  allTimerRefs.forEach((ref) => clearTimeout(ref));
  allTimerRefs.clear();
  queues.clear();

  logInfo("PLC_RETRY_QUEUE_CLEANUP", {
    timersCleaned,
  });
}

module.exports = {
  enqueue,
  processQueue,
  startProcessing,
  stopProcessing,
  clearQueue,
  getQueueSnapshot,
  cleanup,
};
