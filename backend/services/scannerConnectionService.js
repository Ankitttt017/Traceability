const net = require("net");
const ScannerConnection = require("../models/ScannerConnection");
const { emitRealtime } = require("./realtimeService");
const { normalizeIp } = require("../utils/networkAddress");

class ScannerService {
  constructor() {
    this.PROBE_TIMEOUT_MS = Math.max(Number(process.env.SCANNER_PROBE_TIMEOUT_MS || 2000), 300);
    this.DATA_PERSIST_THROTTLE_MS = Math.max(Number(process.env.SCANNER_DATA_PERSIST_THROTTLE_MS || 1000), 250);
    this.connectedScanners = new Map();
  }

  toIsoString(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  toDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  toStatus(value) {
    return String(value || "").trim().toUpperCase() === "CONNECTED" ? "CONNECTED" : "DISCONNECTED";
  }

  toPublicSnapshot(entry, source = "MEMORY") {
    if (!entry) return null;
    const status = this.toStatus(entry.status);
    return {
      scannerIp: normalizeIp(entry.scannerIp),
      status,
      connected: status === "CONNECTED",
      connectedAt: this.toIsoString(entry.connectedAt),
      lastDataAt: this.toIsoString(entry.lastDataAt),
      openSockets: Math.max(Number(entry.openSockets || 0), 0),
      source,
    };
  }

  async upsertConnectionRow(scannerIp, patch = {}) {
    const normalizedIp = normalizeIp(scannerIp);
    if (!normalizedIp) return null;

    const next = {
      scanner_ip: normalizedIp,
      status: this.toStatus(patch.status),
      connected_at: this.toDate(patch.connected_at),
      last_data_at: this.toDate(patch.last_data_at),
    };

    const existing = await ScannerConnection.findOne({ where: { scanner_ip: normalizedIp } });
    if (!existing) return ScannerConnection.create(next);

    if (!Object.prototype.hasOwnProperty.call(patch, "connected_at")) next.connected_at = existing.connected_at;
    if (!Object.prototype.hasOwnProperty.call(patch, "last_data_at")) next.last_data_at = existing.last_data_at;
    if (!Object.prototype.hasOwnProperty.call(patch, "status")) next.status = existing.status;

    await existing.update(next);
    return existing;
  }

  ensureMemoryEntry(scannerIp) {
    const normalizedIp = normalizeIp(scannerIp);
    if (!normalizedIp) return null;
    const existing = this.connectedScanners.get(normalizedIp);
    if (existing) return existing;
    const entry = {
      scannerIp: normalizedIp,
      status: "DISCONNECTED",
      connectedAt: null,
      lastDataAt: null,
      openSockets: 0,
      lastPersistDataMs: 0,
    };
    this.connectedScanners.set(normalizedIp, entry);
    return entry;
  }

  emitConnectionUpdate(entry) {
    const payload = this.toPublicSnapshot(entry, "MEMORY");
    if (payload) emitRealtime("scanner_connection", payload);
  }

  markScannerConnected({ scannerIp } = {}) {
    const entry = this.ensureMemoryEntry(scannerIp);
    if (!entry) return null;

    const now = new Date();
    entry.openSockets = Math.max(0, Number(entry.openSockets || 0)) + 1;
    entry.status = "CONNECTED";
    entry.connectedAt = now;
    this.connectedScanners.set(entry.scannerIp, entry);

    this.upsertConnectionRow(entry.scannerIp, { status: "CONNECTED", connected_at: now }).catch((error) => {
      console.error("Scanner connection upsert failed:", error.message);
    });

    this.emitConnectionUpdate(entry);
    return this.toPublicSnapshot(entry, "MEMORY");
  }

  markScannerData({ scannerIp } = {}) {
    const entry = this.ensureMemoryEntry(scannerIp);
    if (!entry) return null;

    const now = new Date();
    entry.status = "CONNECTED";
    entry.lastDataAt = now;
    if (!entry.connectedAt) entry.connectedAt = now;
    if (entry.openSockets <= 0) entry.openSockets = 1;
    this.connectedScanners.set(entry.scannerIp, entry);

    const nowMs = Date.now();
    const lastPersistMs = Number(entry.lastPersistDataMs || 0);
    if (nowMs - lastPersistMs >= this.DATA_PERSIST_THROTTLE_MS) {
      entry.lastPersistDataMs = nowMs;
      this.upsertConnectionRow(entry.scannerIp, {
        status: "CONNECTED",
        connected_at: entry.connectedAt,
        last_data_at: now,
      }).catch((error) => {
        console.error("Scanner data upsert failed:", error.message);
      });
    }

    return this.toPublicSnapshot(entry, "MEMORY");
  }

  markScannerDisconnected({ scannerIp } = {}) {
    const entry = this.ensureMemoryEntry(scannerIp);
    if (!entry) return null;

    const nextOpenSockets = Math.max(0, Number(entry.openSockets || 0) - 1);
    entry.openSockets = nextOpenSockets;
    if (nextOpenSockets === 0) entry.status = "DISCONNECTED";
    this.connectedScanners.set(entry.scannerIp, entry);

    this.upsertConnectionRow(entry.scannerIp, {
      status: entry.status,
      connected_at: entry.connectedAt,
      last_data_at: entry.lastDataAt,
    }).catch((error) => {
      console.error("Scanner disconnect upsert failed:", error.message);
    });

    this.emitConnectionUpdate(entry);
    return this.toPublicSnapshot(entry, "MEMORY");
  }

  getConnectedScannersMemory() {
    return Array.from(this.connectedScanners.values())
      .map((entry) => this.toPublicSnapshot(entry, "MEMORY"))
      .filter(Boolean)
      .sort((a, b) => String(a.scannerIp).localeCompare(String(b.scannerIp)));
  }

  async getScannerConnectionSnapshot(scannerIp) {
    const normalizedIp = normalizeIp(scannerIp);
    if (!normalizedIp) return null;

    const memory = this.connectedScanners.get(normalizedIp) || null;
    if (memory) return this.toPublicSnapshot(memory, "MEMORY");

    const row = await ScannerConnection.findOne({ where: { scanner_ip: normalizedIp } });
    if (!row) return null;

    return this.toPublicSnapshot(
      { scannerIp: row.scanner_ip, status: row.status, connectedAt: row.connected_at, lastDataAt: row.last_data_at, openSockets: row.status === "CONNECTED" ? 1 : 0 },
      "DB"
    );
  }

  async clearScannerConnection(scannerIp) {
    const normalizedIp = normalizeIp(scannerIp);
    if (!normalizedIp) return null;

    const existing = this.connectedScanners.get(normalizedIp) || null;
    this.connectedScanners.delete(normalizedIp);

    await ScannerConnection.update(
      { status: "DISCONNECTED" },
      { where: { scanner_ip: normalizedIp } }
    );

    const payload = this.toPublicSnapshot(
      {
        scannerIp: normalizedIp,
        status: "DISCONNECTED",
        connectedAt: existing?.connectedAt || null,
        lastDataAt: existing?.lastDataAt || null,
        openSockets: 0,
      },
      "MEMORY"
    );
    if (payload) emitRealtime("scanner_connection", payload);
    return payload;
  }

  async listScannerConnectionSnapshots() {
    const rows = await ScannerConnection.findAll({ order: [["scanner_ip", "ASC"]] });
    const dbMap = new Map(
      rows.map((row) => [
        normalizeIp(row.scanner_ip),
        this.toPublicSnapshot(
          { scannerIp: row.scanner_ip, status: row.status, connectedAt: row.connected_at, lastDataAt: row.last_data_at, openSockets: row.status === "CONNECTED" ? 1 : 0 },
          "DB"
        ),
      ])
    );

    for (const [scannerIp, entry] of this.connectedScanners.entries()) {
      dbMap.set(scannerIp, this.toPublicSnapshot(entry, "MEMORY"));
    }

    return Array.from(dbMap.values())
      .filter(Boolean)
      .sort((a, b) => String(a.scannerIp).localeCompare(String(b.scannerIp)));
  }

  probeScannerEndpoint({ ip, port, timeoutMs = this.PROBE_TIMEOUT_MS } = {}) {
    return new Promise((resolve) => {
      const scannerIp = normalizeIp(ip);
      const scannerPort = Number(port);
      if (!scannerIp || !Number.isFinite(scannerPort) || scannerPort <= 0) {
        resolve({ reachable: false, error: "Valid scanner IP and port are required" });
        return;
      }

      const socket = new net.Socket();
      let settled = false;

      const done = (payload) => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch (_error) {}
        resolve(payload);
      };

      socket.setTimeout(timeoutMs);
      socket.once("connect", () => done({ reachable: true, error: null }));
      socket.once("timeout", () => done({ reachable: false, error: "Scanner connect timeout" }));
      socket.once("error", (error) => done({ reachable: false, error: String(error.message || "Scanner connect failed") }));
      socket.connect(scannerPort, scannerIp);
    });
  }

  async resetAllScannerConnectionStates() {
    await ScannerConnection.update({ status: "DISCONNECTED" }, { where: { status: "CONNECTED" } });
  }
}

module.exports = new ScannerService();
