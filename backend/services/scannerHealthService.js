const { emitRealtime } = require("./realtimeService");
const { normalizeIp } = require("../utils/networkAddress");

const HEARTBEAT_STALE_MS = Math.max(Number(process.env.SCANNER_HEARTBEAT_STALE_MS || 30000), 5000);
const HEARTBEAT_RETAIN_MS = Math.max(Number(process.env.SCANNER_HEARTBEAT_RETAIN_MS || 6 * 60 * 60 * 1000), HEARTBEAT_STALE_MS * 2);

const scannerStateMap = new Map();

function toSnapshot(entry) {
  if (!entry) {
    return null;
  }
  const now = Date.now();
  const ageMs = Math.max(0, now - Number(entry.lastSeenMs || 0));
  const connected = ageMs <= HEARTBEAT_STALE_MS;

  return {
    scannerId: entry.scannerId || null,
    scannerIp: entry.scannerIp,
    scannerName: entry.scannerName || null,
    machineId: entry.machineId || null,
    lastSeenAt: entry.lastSeenAt || null,
    ageMs,
    connected,
    status: connected ? "CONNECTED" : "DISCONNECTED",
    staleAfterMs: HEARTBEAT_STALE_MS,
  };
}

function pruneOldEntries() {
  const now = Date.now();
  for (const [ip, entry] of scannerStateMap.entries()) {
    if (now - Number(entry.lastSeenMs || 0) > HEARTBEAT_RETAIN_MS) {
      scannerStateMap.delete(ip);
    }
  }
}

function markScannerHeartbeat({ scannerId, scannerIp, scannerName, machineId } = {}) {
  const normalizedIp = normalizeIp(scannerIp);
  if (!normalizedIp) {
    return null;
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const previous = scannerStateMap.get(normalizedIp) || null;
  const next = {
    scannerId: scannerId || previous?.scannerId || null,
    scannerIp: normalizedIp,
    scannerName: scannerName || previous?.scannerName || null,
    machineId: machineId || previous?.machineId || null,
    lastSeenAt: nowIso,
    lastSeenMs: nowMs,
  };

  scannerStateMap.set(normalizedIp, next);
  pruneOldEntries();

  const wasConnected = previous ? Date.now() - Number(previous.lastSeenMs || 0) <= HEARTBEAT_STALE_MS : false;
  const machineChanged = previous ? Number(previous.machineId || 0) !== Number(next.machineId || 0) : false;
  if (!wasConnected || machineChanged) {
    emitRealtime("scanner_health", toSnapshot(next));
  }
  return toSnapshot(next);
}

function getScannerHealthSnapshot({ machineId, scannerIp } = {}) {
  if (scannerIp) {
    return toSnapshot(scannerStateMap.get(normalizeIp(scannerIp)));
  }

  const all = Array.from(scannerStateMap.values())
    .map((entry) => toSnapshot(entry))
    .sort((a, b) => (b.ageMs === a.ageMs ? 0 : a.ageMs - b.ageMs)); // Smallest ageMs (most recent) first

  if (!machineId) {
    return all;
  }

  const target = Number(machineId);
  return all.filter((entry) => Number(entry.machineId || 0) === target);
}

function clearScannerHealth({ scannerIp, machineId } = {}) {
  const normalizedIp = normalizeIp(scannerIp);
  if (normalizedIp) {
    scannerStateMap.delete(normalizedIp);
    return;
  }

  if (!machineId) return;
  const target = Number(machineId);
  for (const [ip, entry] of scannerStateMap.entries()) {
    if (Number(entry.machineId || 0) === target) {
      scannerStateMap.delete(ip);
    }
  }
}

module.exports = {
  markScannerHeartbeat,
  getScannerHealthSnapshot,
  clearScannerHealth,
};
