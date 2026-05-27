const { emitRealtime } = require("./realtimeService");

class PlcSnapshotService {
  constructor() {
    this.snapshots = new Map(); // endpoint -> { data: {}, timestamp: Date }
    this.STALE_THRESHOLD_MS = 5000;
  }

  getEndpointKey(ip, port) {
    return `${ip}:${port}`;
  }

  updateSnapshot(ip, port, data) {
    const key = this.getEndpointKey(ip, port);
    const snapshot = {
      data,
      timestamp: new Date(),
    };
    this.snapshots.set(key, snapshot);
    
    emitRealtime("plc_snapshot_update", {
      endpoint: key,
      timestamp: snapshot.timestamp,
      data
    });
  }

  getSnapshot(ip, port) {
    const key = this.getEndpointKey(ip, port);
    const snapshot = this.snapshots.get(key);
    
    if (!snapshot) return null;
    
    const isStale = (new Date() - snapshot.timestamp) > this.STALE_THRESHOLD_MS;
    return {
      ...snapshot,
      isStale
    };
  }

  // Check for conflicts (Point 20)
  detectConflicts(data) {
    const conflicts = [];
    
    // Example conflict rules
    if (data.START && data.RESET) {
      conflicts.push("START and RESET both active");
    }
    if (data.END_OK && data.END_NG) {
      conflicts.push("END_OK and END_NG both active");
    }
    if (data.ACK && !data.START && !data.RESET) {
      conflicts.push("ACK active without START or RESET");
    }
    
    return conflicts;
  }
}

module.exports = new PlcSnapshotService();
