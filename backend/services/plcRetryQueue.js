// UPGRADE 3 COMPLETE — In-memory PLC write retry queue with Socket.IO alerting
const { emitRealtime } = require("./realtimeService");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const PROCESS_INTERVAL_MS = 5000;

/** @type {Map<string, object[]>} */
const queues = new Map(); // keyed by machineId

function _makeKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Enqueue a failed PLC write operation for retry.
 * @param {object} item
 * @param {string|number} item.machineId
 * @param {string} item.operation   - e.g. "PART_ID_HASH_WRITE"
 * @param {object} item.payload     - data required to retry the write
 * @param {Function} item.retryFn   - async function to call on retry, receives payload
 */
function enqueue({ machineId, operation, payload, retryFn }) {
  const id = String(machineId || "global");
  if (!queues.has(id)) queues.set(id, []);
  queues.get(id).push({
    _key: _makeKey(),
    machineId,
    operation,
    payload,
    retryFn,
    attempts: 0,
    timestamp: new Date().toISOString(),
  });
  console.log(`[PLCRetryQueue] Enqueued ${operation} for machine ${machineId}`);
}

/**
 * Process all pending queue items. Called automatically on interval.
 */
async function processQueue() {
  for (const [machineId, items] of queues.entries()) {
    const remaining = [];
    for (const item of items) {
      if (item.attempts >= MAX_RETRIES) {
        // Exhausted — emit failure event
        console.error(
          `[PLCRetryQueue] FAILED after ${MAX_RETRIES} attempts: ${item.operation} machine=${machineId}`
        );
        emitRealtime("plc:write_failed", {
          machineId: item.machineId,
          operation: item.operation,
          payload: item.payload,
          attempts: item.attempts,
          timestamp: item.timestamp,
          failedAt: new Date().toISOString(),
        });
        continue; // drop from queue
      }

      item.attempts += 1;
      try {
        await item.retryFn(item.payload);
        console.log(
          `[PLCRetryQueue] SUCCESS on attempt ${item.attempts}: ${item.operation} machine=${machineId}`
        );
        // Successfully retried — do not re-queue
      } catch (err) {
        console.warn(
          `[PLCRetryQueue] Retry ${item.attempts}/${MAX_RETRIES} failed: ${item.operation} machine=${machineId} — ${err.message}`
        );
        if (item.attempts < MAX_RETRIES) {
          // Keep in queue for next cycle
          remaining.push(item);
        } else {
          // Final failure
          emitRealtime("plc:write_failed", {
            machineId: item.machineId,
            operation: item.operation,
            payload: item.payload,
            attempts: item.attempts,
            lastError: err.message,
            timestamp: item.timestamp,
            failedAt: new Date().toISOString(),
          });
        }
      }
      // Small delay between retries within the same cycle
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
    if (remaining.length > 0) {
      queues.set(machineId, remaining);
    } else {
      queues.delete(machineId);
    }
  }
}

/**
 * Clear the retry queue for a specific machine (e.g. after manual reset).
 * @param {string|number} machineId
 */
function clearQueue(machineId) {
  const id = String(machineId || "global");
  const removed = queues.get(id)?.length ?? 0;
  queues.delete(id);
  console.log(`[PLCRetryQueue] Cleared ${removed} item(s) for machine ${machineId}`);
}

function getQueueSnapshot() {
  const snapshot = [];
  for (const [machineId, items] of queues.entries()) {
    snapshot.push({ machineId, pending: items.length, items: items.map((i) => ({ key: i._key, operation: i.operation, attempts: i.attempts, timestamp: i.timestamp })) });
  }
  return snapshot;
}

// Auto-process queue every 5 seconds
setInterval(processQueue, PROCESS_INTERVAL_MS);

module.exports = { enqueue, processQueue, clearQueue, getQueueSnapshot };
