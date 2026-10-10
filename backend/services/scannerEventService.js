/**
 * scannerEventService (SCANNER-FIX)
 *
 * 1. Structured scanner event log (ScannerEvents table): logScannerEvent()
 *    only pushes into an in-memory buffer; a timer flushes it with one
 *    bulkCreate. The scan path never awaits a DB write. If the DB is down the
 *    buffer is capped (oldest dropped, counted) so memory cannot grow.
 * 2. Persistence adapter for the laser Customer-QR waiting state
 *    (LaserWorkflowStates table) + restore on startup.
 * 3. Daily retention cleanup of ScannerEvents.
 *
 * Models are required lazily so that nothing here creates tables unless the
 * TCP scanner server is actually started (SHOP_FLOOR_IO=on instance).
 */

const FLUSH_INTERVAL_MS = Math.max(Number(process.env.SCANNER_EVENT_FLUSH_MS || 2000), 250);
const FLUSH_BATCH_SIZE = Math.max(Number(process.env.SCANNER_EVENT_BATCH_SIZE || 200), 10);
const MAX_BUFFERED_EVENTS = Math.max(Number(process.env.SCANNER_EVENT_MAX_BUFFER || 5000), 100);
const RETENTION_DAYS = Math.max(Number(process.env.SCANNER_EVENT_RETENTION_DAYS || 90), 7);
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

const buffer = [];
let flushTimer = null;
let flushing = false;
let retentionTimer = null;
let enabled = false;
const stats = { queued: 0, written: 0, dropped: 0, failedFlushes: 0, lastError: "" };

function getScannerEventModel() {
  return require("../models/ScannerEvent");
}

function getLaserWorkflowStateModel() {
  return require("../models/LaserWorkflowState");
}

function truncate(value, max) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length > max ? text.slice(0, max) : text;
}

function toIntOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

/**
 * Queue one event. Fire-and-forget; never throws.
 */
function logScannerEvent(event = {}) {
  if (!enabled) return;
  try {
    if (buffer.length >= MAX_BUFFERED_EVENTS) {
      buffer.shift();
      stats.dropped += 1;
    }
    buffer.push({
      event_time: event.timestamp ? new Date(event.timestamp) : new Date(),
      event_type: truncate(event.eventType || "SCAN", 20),
      stage: truncate(event.stage, 80),
      scanner_id: toIntOrNull(event.scannerId),
      scanner_ip: truncate(event.scannerIp, 64),
      scanner_role: truncate(event.scannerRole, 32),
      connection_id: truncate(event.connectionId, 64),
      raw_hex: truncate(event.rawHex, 600),
      parsed_code: truncate(event.parsedCode, 255),
      validation_code: truncate(event.validationCode, 64),
      flow_type: truncate(event.flowType, 32),
      decision: truncate(event.decision, 64),
      active_part_source: truncate(event.activePartSource, 20),
      active_part_id: truncate(event.activePartId, 255),
      mapping_id: toIntOrNull(event.mappingId),
      station_no: truncate(event.stationNo, 32),
      machine_id: toIntOrNull(event.machineId),
      message: truncate(event.message, 1000),
    });
    stats.queued += 1;
    if (buffer.length >= FLUSH_BATCH_SIZE) {
      setImmediate(flushScannerEvents);
    }
  } catch (_error) {
    stats.dropped += 1;
  }
}

async function flushScannerEvents() {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, FLUSH_BATCH_SIZE);
  try {
    await getScannerEventModel().bulkCreate(batch, { validate: false, hooks: false });
    stats.written += batch.length;
  } catch (error) {
    stats.failedFlushes += 1;
    stats.lastError = String(error?.message || error).slice(0, 300);
    // Put the batch back at the front (bounded by MAX_BUFFERED_EVENTS).
    const room = Math.max(MAX_BUFFERED_EVENTS - buffer.length, 0);
    if (room < batch.length) stats.dropped += batch.length - room;
    buffer.unshift(...batch.slice(batch.length - room));
    if (stats.failedFlushes % 30 === 1) {
      console.warn(`[SCANNER_EVENTS] flush failed (${stats.failedFlushes}x): ${stats.lastError}`);
    }
  } finally {
    flushing = false;
  }
}

async function ensureScannerEventsTable() {
  await getScannerEventModel().sync();
}

async function ensureLaserWorkflowStatesTable() {
  await getLaserWorkflowStateModel().sync();
}

async function cleanupOldScannerEvents(now = Date.now()) {
  const { Op } = require("sequelize");
  const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await getScannerEventModel().destroy({ where: { event_time: { [Op.lt]: cutoff } } });
  if (deleted) console.log(`[SCANNER_EVENTS] retention cleanup removed ${deleted} events older than ${RETENTION_DAYS} days`);
  return deleted;
}

/**
 * Start buffering + periodic flush + daily retention. Table creation is
 * attempted but failures only disable nothing — events stay buffered and the
 * flush retries.
 */
async function startScannerEventLogging() {
  if (enabled) return;
  enabled = true;
  try {
    await ensureScannerEventsTable();
  } catch (error) {
    console.warn(`[SCANNER_EVENTS] ensure table failed: ${error?.message || error}`);
  }
  flushTimer = setInterval(() => {
    flushScannerEvents().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();
  const runRetention = () => cleanupOldScannerEvents().catch((error) => {
    console.warn(`[SCANNER_EVENTS] retention cleanup failed: ${error?.message || error}`);
  });
  setTimeout(runRetention, 5 * 60 * 1000).unref?.();
  retentionTimer = setInterval(runRetention, RETENTION_INTERVAL_MS);
  if (retentionTimer.unref) retentionTimer.unref();
}

async function stopScannerEventLogging() {
  if (flushTimer) clearInterval(flushTimer);
  if (retentionTimer) clearInterval(retentionTimer);
  flushTimer = null;
  retentionTimer = null;
  await flushScannerEvents().catch(() => {});
  enabled = false;
}

// --- Laser waiting-state persistence ---------------------------------------

const laserWorkflowPersistence = {
  async save(snapshot) {
    const Model = getLaserWorkflowStateModel();
    await Model.upsert({
      workflow_key: snapshot.key,
      machine_id: toIntOrNull(snapshot.machineId),
      station_no: truncate(snapshot.stationNo, 32),
      active_part_id: truncate(snapshot.activePartId, 255) || null,
      waiting_for_customer_qr: Boolean(snapshot.waitingForCustomerQr),
      waiting_since: snapshot.waitingSince ? new Date(snapshot.waitingSince) : null,
      status: truncate(snapshot.status, 40),
      last_error: truncate(snapshot.lastError, 255),
    });
  },
  async loadWaiting() {
    const Model = getLaserWorkflowStateModel();
    return Model.findAll({ where: { waiting_for_customer_qr: true }, raw: true });
  },
};

function getScannerEventStats() {
  return { ...stats, buffered: buffer.length, enabled };
}

module.exports = {
  logScannerEvent,
  flushScannerEvents,
  ensureScannerEventsTable,
  ensureLaserWorkflowStatesTable,
  cleanupOldScannerEvents,
  startScannerEventLogging,
  stopScannerEventLogging,
  laserWorkflowPersistence,
  getScannerEventStats,
};
