// UPGRADE 4 COMPLETE — Offline write buffer: JSON file fallback when DB is unavailable
const fs = require("fs");
const path = require("path");
const { emitRealtime } = require("./realtimeService");

const BUFFER_DIR = path.join(__dirname, "../data");
const BUFFER_FILE = path.join(BUFFER_DIR, "offline_buffer.json");

let isBuffering = false;

function _ensureDir() {
  if (!fs.existsSync(BUFFER_DIR)) {
    fs.mkdirSync(BUFFER_DIR, { recursive: true });
  }
}

function _readBuffer() {
  _ensureDir();
  if (!fs.existsSync(BUFFER_FILE)) return [];
  try {
    const raw = fs.readFileSync(BUFFER_FILE, "utf-8");
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

function _writeBuffer(records) {
  _ensureDir();
  fs.writeFileSync(BUFFER_FILE, JSON.stringify(records, null, 2), "utf-8");
}

/**
 * Buffer a record to the local JSON file when DB is unavailable.
 * @param {object} record - The DB record object to buffer (plain JS object).
 * @param {string} record._model - The Sequelize model name to replay into.
 */
function bufferRecord(record) {
  const records = _readBuffer();
  records.push({ ...record, _bufferedAt: new Date().toISOString() });
  _writeBuffer(records);

  if (!isBuffering) {
    isBuffering = true;
    emitRealtime("db:offline", { message: "DB unavailable. Records being buffered locally.", count: records.length });
    console.warn(`[OfflineBuffer] DB offline — buffering record. Total buffered: ${records.length}`);
  }
}

/**
 * Replay all buffered records into the DB. Call this after a successful DB reconnect.
 * @param {object} modelMap - Map of model name strings to Sequelize model classes.
 *   e.g. { ProductionLog: require('../models/ProductionLog') }
 */
async function replayBuffer(modelMap = {}) {
  const records = _readBuffer();
  if (records.length === 0) {
    isBuffering = false;
    return;
  }

  console.log(`[OfflineBuffer] DB reconnected. Replaying ${records.length} buffered records...`);
  const failed = [];

  for (const record of records) {
    const modelName = record._model;
    const Model = modelMap[modelName];
    if (!Model) {
      console.warn(`[OfflineBuffer] No model registered for "${modelName}" — skipping record.`);
      continue;
    }
    const { _model, _bufferedAt, ...data } = record;
    try {
      await Model.create(data);
    } catch (err) {
      console.error(`[OfflineBuffer] Replay failed for ${modelName}: ${err.message}`);
      failed.push(record);
    }
  }

  _writeBuffer(failed); // keep only failed ones
  isBuffering = failed.length > 0;

  emitRealtime("db:reconnected", {
    message: `DB reconnected. ${records.length - failed.length} records replayed. ${failed.length} failed.`,
    replayed: records.length - failed.length,
    failed: failed.length,
  });

  console.log(`[OfflineBuffer] Replay complete. Replayed: ${records.length - failed.length}, Failed: ${failed.length}`);
}

/**
 * Returns the current buffered record count.
 */
function getBufferCount() {
  return _readBuffer().length;
}

module.exports = { bufferRecord, replayBuffer, getBufferCount, get isBuffering() { return isBuffering; } };
