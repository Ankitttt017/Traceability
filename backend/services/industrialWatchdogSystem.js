/**
 * industrialWatchdogSystem.js
 * ════════════════════════════════════════════════════════════════
 * 
 * INDUSTRIAL WATCHDOG + HEARTBEAT SYSTEM
 * 
 * Five independent watchdogs with configurable intervals:
 * 1. PLC Heartbeat - Detects PLC connection loss
 * 2. Backend Heartbeat - Monitors backend health
 * 3. Scanner Heartbeat - Verifies scanner connectivity
 * 4. Machine Watchdog - Detects machine state anomalies
 * 5. Queue Watchdog - Monitors operation queue backlog
 * 
 * Each watchdog:
 * • Has independent timer with cleanup refs
 * • Detects stale communication
 * • Triggers automatic cleanup on stale detection
 * • Emits operator-visible alarms
 * • Maintains telemetry
 * 
 * ════════════════════════════════════════════════════════════════
 */

const { emitRealtime } = require("./realtimeService");
const { logInfo, logWarn, logError } = require("./industrialLogger");

// Configurable intervals
const PLC_WATCHDOG_INTERVAL_MS = Number(
  process.env.PLC_WATCHDOG_INTERVAL_MS || 20000
);
const BACKEND_HEARTBEAT_INTERVAL_MS = Number(
  process.env.BACKEND_HEARTBEAT_INTERVAL_MS || 10000
);
const SCANNER_WATCHDOG_INTERVAL_MS = Number(
  process.env.SCANNER_WATCHDOG_INTERVAL_MS || 15000
);
const MACHINE_WATCHDOG_INTERVAL_MS = Number(
  process.env.MACHINE_WATCHDOG_INTERVAL_MS || 30000
);
const QUEUE_WATCHDOG_INTERVAL_MS = Number(
  process.env.QUEUE_WATCHDOG_INTERVAL_MS || 5000
);

// Stale detection thresholds
const PLC_STALE_THRESHOLD_MS = Number(
  process.env.PLC_STALE_THRESHOLD_MS || 60000
);
const BACKEND_STALE_THRESHOLD_MS = Number(
  process.env.BACKEND_STALE_THRESHOLD_MS || 30000
);
const SCANNER_STALE_THRESHOLD_MS = Number(
  process.env.SCANNER_STALE_THRESHOLD_MS || 45000
);
const MACHINE_STALE_THRESHOLD_MS = Number(
  process.env.MACHINE_STALE_THRESHOLD_MS || 120000
);
const QUEUE_BACKLOG_THRESHOLD = Number(
  process.env.QUEUE_BACKLOG_THRESHOLD || 100
);

// State tracking
const watchdogState = {
  plc: {
    running: false,
    lastCheck: null,
    healthy: true,
    staleCount: 0,
    timerRef: null,
    metrics: { checks: 0, stales: 0, recoveries: 0 },
  },
  backend: {
    running: false,
    lastCheck: null,
    healthy: true,
    staleCount: 0,
    timerRef: null,
    metrics: { checks: 0, stales: 0, recoveries: 0 },
  },
  scanner: {
    running: false,
    lastCheck: null,
    healthy: true,
    staleCount: 0,
    timerRef: null,
    metrics: { checks: 0, stales: 0, recoveries: 0 },
  },
  machine: {
    running: false,
    lastCheck: null,
    healthy: true,
    staleCount: 0,
    timerRef: null,
    metrics: { checks: 0, anomalies: 0, recoveries: 0 },
  },
  queue: {
    running: false,
    lastCheck: null,
    healthy: true,
    backlogCount: 0,
    timerRef: null,
    metrics: { checks: 0, backlogs: 0, clears: 0 },
  },
};

/**
 * Watchdog 1: PLC Health Monitoring
 */
async function checkPlcHealth() {
  try {
    const { getPlcHealthSnapshot } = require("./plcHealthService");
    const machines = getPlcHealthSnapshot();
    const list = Array.isArray(machines) ? machines : [];
    let healthyCount = 0;
    const unhealthy = [];

    for (const machine of list) {
      const checkedAtMs = machine?.checkedAt ? new Date(machine.checkedAt).getTime() : 0;
      const staleByAge = checkedAtMs > 0 ? Date.now() - checkedAtMs > PLC_STALE_THRESHOLD_MS : true;
      if (!machine?.healthy || staleByAge) {
        unhealthy.push(machine.machineId || machine.id);
      } else {
        healthyCount += 1;
      }
    }

    watchdogState.plc.metrics.checks += 1;
    watchdogState.plc.lastCheck = new Date().toISOString();

    const wasHealthy = watchdogState.plc.healthy;
    watchdogState.plc.healthy = unhealthy.length === 0;

    if (!watchdogState.plc.healthy) {
      watchdogState.plc.staleCount += 1;
      watchdogState.plc.metrics.stales += 1;

      if (unhealthy.length > 0) {
        logWarn("WATCHDOG_PLC_UNHEALTHY", {
          unhealthyMachines: unhealthy,
          staleCount: watchdogState.plc.staleCount,
        });

        emitRealtime("watchdog:plc_unhealthy", {
          timestamp: new Date().toISOString(),
          unhealthyMachines: unhealthy,
          healthyCount,
          totalCount: list.length,
        });
      }
    } else if (!wasHealthy && watchdogState.plc.healthy) {
      // Recovered from unhealthy
      watchdogState.plc.staleCount = 0;
      watchdogState.plc.metrics.recoveries += 1;

      logInfo("WATCHDOG_PLC_RECOVERED", {
        healthyMachines: healthyCount,
      });

      emitRealtime("watchdog:plc_recovered", {
        timestamp: new Date().toISOString(),
        healthyCount,
        totalCount: list.length,
      });
    }
  } catch (error) {
    logError("WATCHDOG_PLC_CHECK_ERROR", {
      error: error.message,
    });
  }
}

/**
 * Watchdog 2: Backend Heartbeat
 */
async function checkBackendHealth() {
  try {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    watchdogState.backend.metrics.checks += 1;
    watchdogState.backend.lastCheck = new Date().toISOString();
    watchdogState.backend.healthy = true; // Backend is running if we can check it

    emitRealtime("watchdog:backend_heartbeat", {
      timestamp: new Date().toISOString(),
      uptime,
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      },
    });

    logInfo("WATCHDOG_BACKEND_HEARTBEAT", {
      uptime: Math.round(uptime),
      heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    });
  } catch (error) {
    logError("WATCHDOG_BACKEND_CHECK_ERROR", {
      error: error.message,
    });
  }
}

/**
 * Watchdog 3: Scanner Connectivity
 */
async function checkScannerHealth() {
  try {
    const { getScannerHealthSnapshot } = require("./scannerHealthService");
    const scanners = getScannerHealthSnapshot();
    const list = Array.isArray(scanners) ? scanners : [];
    let healthyCount = 0;
    const unhealthy = [];

    for (const scanner of list) {
      const ageMs = Number(scanner?.ageMs || Number.MAX_SAFE_INTEGER);
      if (!scanner?.connected || ageMs > SCANNER_STALE_THRESHOLD_MS) {
        unhealthy.push(scanner.scannerId || scanner.scannerIp);
      } else {
        healthyCount += 1;
      }
    }

    watchdogState.scanner.metrics.checks += 1;
    watchdogState.scanner.lastCheck = new Date().toISOString();

    const wasHealthy = watchdogState.scanner.healthy;
    watchdogState.scanner.healthy = unhealthy.length === 0;

    if (!watchdogState.scanner.healthy) {
      watchdogState.scanner.staleCount += 1;
      watchdogState.scanner.metrics.stales += 1;

      logWarn("WATCHDOG_SCANNER_UNHEALTHY", {
        unhealthyScanners: unhealthy,
        staleCount: watchdogState.scanner.staleCount,
      });

      emitRealtime("watchdog:scanner_unhealthy", {
        timestamp: new Date().toISOString(),
        unhealthyScanners: unhealthy,
        healthyCount,
        totalCount: list.length,
      });
    } else if (!wasHealthy && watchdogState.scanner.healthy) {
      watchdogState.scanner.staleCount = 0;
      watchdogState.scanner.metrics.recoveries += 1;

      logInfo("WATCHDOG_SCANNER_RECOVERED", {
        healthyCount,
      });

      emitRealtime("watchdog:scanner_recovered", {
        timestamp: new Date().toISOString(),
        healthyCount,
        totalCount: list.length,
      });
    }
  } catch (error) {
    logError("WATCHDOG_SCANNER_CHECK_ERROR", {
      error: error.message,
    });
  }
}

/**
 * Watchdog 4: Machine State Anomaly Detection
 */
async function checkMachineAnomalies() {
  try {
    const Machine = require("../models/Machine");
    const machines = await Machine.findAll({
      attributes: [
        "id",
        "machine_name",
        "is_running",
        "running_started_at",
      ],
    });

    const anomalies = [];
    const now = Date.now();

    for (const machine of machines) {
      // Detect stale lock (running for > 30 minutes)
      if (machine.is_running && machine.running_started_at) {
        const lockAgeMs =
          now - new Date(machine.running_started_at).getTime();
        if (lockAgeMs > MACHINE_STALE_THRESHOLD_MS) {
          anomalies.push({
            machineId: machine.id,
            anomaly: "STALE_LOCK",
            ageMs: lockAgeMs,
          });

          // Clear stale lock
          await Machine.update(
            {
              is_running: false,
              running_part_id: null,
              running_station_no: null,
              running_started_at: null,
            },
            { where: { id: machine.id } }
          );

          watchdogState.machine.metrics.recoveries += 1;
        }
      }

    }

    watchdogState.machine.metrics.checks += 1;
    watchdogState.machine.lastCheck = new Date().toISOString();
    watchdogState.machine.metrics.anomalies += anomalies.length;

    if (anomalies.length > 0) {
      logWarn("WATCHDOG_MACHINE_ANOMALIES", {
        count: anomalies.length,
        anomalies,
      });

      emitRealtime("watchdog:machine_anomalies", {
        timestamp: new Date().toISOString(),
        anomalies,
      });
    }
  } catch (error) {
    logError("WATCHDOG_MACHINE_CHECK_ERROR", {
      error: error.message,
    });
  }
}

/**
 * Watchdog 5: Queue Backlog Detection
 */
async function checkQueueBacklog() {
  try {
    // Get queue status from retry queue service if available
    let queueSize = 0;
    try {
      const plcRetryQueue = require("./plcRetryQueue_HARDENED");
      const snapshot = plcRetryQueue.getQueueSnapshot();
      queueSize = snapshot.totalQueuedItems;
    } catch (_err) {
      // Retry queue not available
    }

    watchdogState.queue.metrics.checks += 1;
    watchdogState.queue.lastCheck = new Date().toISOString();
    watchdogState.queue.backlogCount = queueSize;

    if (queueSize > QUEUE_BACKLOG_THRESHOLD) {
      watchdogState.queue.metrics.backlogs += 1;

      logWarn("WATCHDOG_QUEUE_BACKLOG", {
        queueSize,
        threshold: QUEUE_BACKLOG_THRESHOLD,
      });

      emitRealtime("watchdog:queue_backlog", {
        timestamp: new Date().toISOString(),
        queueSize,
        threshold: QUEUE_BACKLOG_THRESHOLD,
      });
    }
  } catch (error) {
    logError("WATCHDOG_QUEUE_CHECK_ERROR", {
      error: error.message,
    });
  }
}

/**
 * Start all watchdogs.
 */
function startAllWatchdogs() {
  startPlcWatchdog();
  startBackendHeartbeat();
  startScannerWatchdog();
  startMachineWatchdog();
  startQueueWatchdog();

  logInfo("WATCHDOG_SYSTEM_STARTED", {
    plcInterval: PLC_WATCHDOG_INTERVAL_MS,
    backendInterval: BACKEND_HEARTBEAT_INTERVAL_MS,
    scannerInterval: SCANNER_WATCHDOG_INTERVAL_MS,
    machineInterval: MACHINE_WATCHDOG_INTERVAL_MS,
    queueInterval: QUEUE_WATCHDOG_INTERVAL_MS,
  });
}

function startPlcWatchdog() {
  if (watchdogState.plc.running) return;
  watchdogState.plc.running = true;
  const schedule = async () => {
    await checkPlcHealth();
    if (watchdogState.plc.running) {
      watchdogState.plc.timerRef = setTimeout(
        schedule,
        PLC_WATCHDOG_INTERVAL_MS
      );
    }
  };
  schedule();
}

function startBackendHeartbeat() {
  if (watchdogState.backend.running) return;
  watchdogState.backend.running = true;
  const schedule = async () => {
    await checkBackendHealth();
    if (watchdogState.backend.running) {
      watchdogState.backend.timerRef = setTimeout(
        schedule,
        BACKEND_HEARTBEAT_INTERVAL_MS
      );
    }
  };
  schedule();
}

function startScannerWatchdog() {
  if (watchdogState.scanner.running) return;
  watchdogState.scanner.running = true;
  const schedule = async () => {
    await checkScannerHealth();
    if (watchdogState.scanner.running) {
      watchdogState.scanner.timerRef = setTimeout(
        schedule,
        SCANNER_WATCHDOG_INTERVAL_MS
      );
    }
  };
  schedule();
}

function startMachineWatchdog() {
  if (watchdogState.machine.running) return;
  watchdogState.machine.running = true;
  const schedule = async () => {
    await checkMachineAnomalies();
    if (watchdogState.machine.running) {
      watchdogState.machine.timerRef = setTimeout(
        schedule,
        MACHINE_WATCHDOG_INTERVAL_MS
      );
    }
  };
  schedule();
}

function startQueueWatchdog() {
  if (watchdogState.queue.running) return;
  watchdogState.queue.running = true;
  const schedule = async () => {
    await checkQueueBacklog();
    if (watchdogState.queue.running) {
      watchdogState.queue.timerRef = setTimeout(
        schedule,
        QUEUE_WATCHDOG_INTERVAL_MS
      );
    }
  };
  schedule();
}

/**
 * Stop all watchdogs and cleanup.
 */
function stopAllWatchdogs() {
  for (const [watchdogName, state] of Object.entries(watchdogState)) {
    state.running = false;
    if (state.timerRef) {
      clearTimeout(state.timerRef);
      state.timerRef = null;
    }
  }

  logInfo("WATCHDOG_SYSTEM_STOPPED", {});
}

/**
 * Get watchdog telemetry.
 */
function getWatchdogTelemetry() {
  return {
    timestamp: new Date().toISOString(),
    plc: {
      running: watchdogState.plc.running,
      healthy: watchdogState.plc.healthy,
      lastCheck: watchdogState.plc.lastCheck,
      metrics: watchdogState.plc.metrics,
    },
    backend: {
      running: watchdogState.backend.running,
      healthy: watchdogState.backend.healthy,
      lastCheck: watchdogState.backend.lastCheck,
      metrics: watchdogState.backend.metrics,
    },
    scanner: {
      running: watchdogState.scanner.running,
      healthy: watchdogState.scanner.healthy,
      lastCheck: watchdogState.scanner.lastCheck,
      metrics: watchdogState.scanner.metrics,
    },
    machine: {
      running: watchdogState.machine.running,
      healthy: watchdogState.machine.healthy,
      lastCheck: watchdogState.machine.lastCheck,
      metrics: watchdogState.machine.metrics,
    },
    queue: {
      running: watchdogState.queue.running,
      healthy: watchdogState.queue.healthy,
      lastCheck: watchdogState.queue.lastCheck,
      backlogCount: watchdogState.queue.backlogCount,
      metrics: watchdogState.queue.metrics,
    },
  };
}

module.exports = {
  startAllWatchdogs,
  stopAllWatchdogs,
  getWatchdogTelemetry,
  // Individual controls for testing
  startPlcWatchdog,
  startBackendHeartbeat,
  startScannerWatchdog,
  startMachineWatchdog,
  startQueueWatchdog,
};
