const { emitRealtime } = require("./realtimeService");

class IndustrialEventService {
  emitMachineState(machineId, oldState, newState, metadata = {}) {
    this.emit("machine_state", {
      machineId,
      oldState,
      newState,
      timestamp: new Date(),
      ...metadata
    });
  }

  emitPlcHealth(machineId, status, metrics = {}) {
    this.emit("plc_health", {
      machineId,
      status, // CONNECTED, DISCONNECTED, DEGRADED
      timestamp: new Date(),
      ...metrics
    });
  }

  emitScannerHealth(scannerId, status) {
    this.emit("scanner_health", {
      scannerId,
      status,
      timestamp: new Date()
    });
  }

  emitOperationTimeline(machineId, cycleToken, event, metadata = {}) {
    this.emit("operation_timeline", {
      machineId,
      cycleToken,
      event, // SCAN, VALIDATE, START, RUN, END, OK, NG, RESET
      timestamp: new Date(),
      ...metadata
    });
  }

  emitWatchdogAlert(machineId, level, message, details = {}) {
    this.emit("watchdog_alert", {
      machineId,
      level, // WARNING, DEGRADED, CRITICAL, LOCKDOWN
      message,
      timestamp: new Date(),
      ...details
    });
  }

  emitQueueStatus(queueLength, activeJobs) {
    this.emit("queue_status", {
      queueLength,
      activeJobs,
      timestamp: new Date()
    });
  }

  emit(type, payload) {
    // Standardization of payload: always include type and server timestamp
    const standardPayload = {
      event_type: type,
      server_time: new Date().toISOString(),
      ...payload
    };
    emitRealtime(type, standardPayload);
  }
}

module.exports = new IndustrialEventService();
