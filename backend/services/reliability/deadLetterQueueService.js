/**
 * IndusTrace Dead Letter Queue (DLQ) Service
 * ─────────────────────────────────────────────────────────────────
 * Stores failed payloads for manual inspection, retry, or replay.
 */

const fs = require('fs-extra');
const path = require('path');

const DLQ_DIR = path.join(process.cwd(), 'data', 'dlq');

class DeadLetterQueueService {
  constructor() {
    this.ensureDir();
  }

  async ensureDir() {
    await fs.ensureDir(DLQ_DIR);
  }

  /**
   * Captures a failed payload with metadata.
   */
  async capture(machineId, protocol, payload, error) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `FAIL_${machineId}_${protocol}_${timestamp}.json`;
    const filePath = path.join(DLQ_DIR, fileName);

    const entry = {
      machineId,
      protocol,
      timestamp: new Date().toISOString(),
      error: error.message || String(error),
      payload: payload
    };

    try {
      await fs.writeJson(filePath, entry, { spaces: 2 });
      console.warn(`[DLQ] Captured failure for Machine ${machineId}: ${fileName}`);
    } catch (err) {
      console.error(`[DLQ] CRITICAL: Failed to write to DLQ:`, err.message);
    }
  }

  /**
   * Lists all failed payloads.
   */
  async list() {
    const files = await fs.readdir(DLQ_DIR);
    const results = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        results.push(await fs.readJson(path.join(DLQ_DIR, file)));
      }
    }
    return results;
  }

  /**
   * Removes an entry from DLQ.
   */
  async resolve(fileName) {
    await fs.remove(path.join(DLQ_DIR, fileName));
  }
}

module.exports = new DeadLetterQueueService();
