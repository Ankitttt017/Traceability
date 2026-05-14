const { getScannerHealthSnapshot } = require("./scannerHealthService");

const GRACE_MS = Math.max(Number(process.env.SCANNER_INACTIVITY_GRACE_MS || 10000), 3000);

class ScannerConnectionManager {
  getStableSnapshot({ scannerIp, machineId }) {
    const health = getScannerHealthSnapshot(scannerIp ? { scannerIp } : { machineId });
    const entry = Array.isArray(health) ? health[0] : health;
    if (!entry) return null;
    const ageMs = Number(entry.ageMs || 0);
    const connected = ageMs <= Number(entry.staleAfterMs || 0) + GRACE_MS;
    return {
      ...entry,
      connected,
      status: connected ? "CONNECTED" : "DISCONNECTED",
      graceMs: GRACE_MS,
    };
  }
}

module.exports = new ScannerConnectionManager();
