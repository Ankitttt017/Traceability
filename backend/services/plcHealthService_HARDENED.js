/**
 * plcHealthService_HARDENED.js
 * ════════════════════════════════════════════════════════════════
 * 
 * INDUSTRIAL PLC HEALTH MONITOR - BACKLOG PREVENTION
 * 
 * Guarantees:
 * • No health check cycles queue up
 * • Configurable intervals between checks
 * • Proper cleanup on shutdown
 * • Structured health event logging
 * • Graceful error handling
 * 
 * Architecture:
 * • setTimeout chain instead of setInterval
 * • Each check schedules next check after completion
 * • Prevents backlog even if check takes longer than interval
 * 
 * ════════════════════════════════════════════════════════════════
 */

const Machine = require("../models/Machine");
const { emitRealtime } = require("./realtimeService");
const { logInfo, logWarn, logError } = require("./industrialLogger");

const HEARTBEAT_INTERVAL_MS = Math.max(
  Number(process.env.PLC_HEARTBEAT_INTERVAL_MS || 15000),
  1000
);
const HEARTBEAT_TIMEOUT_MS = Math.max(
  Number(process.env.PLC_HEARTBEAT_TIMEOUT_MS || 3000),
  300
);

let timerRef = null;
let isMonitorRunning = false;
const healthStateMap = new Map();

/**
 * Get health state for an endpoint.
 */
function getHealthState(endpoint) {
  return healthStateMap.get(endpoint) || {
    endpoint,
    healthy: false,
    lastProbe: null,
    consecutiveFailures: 0,
    lastError: null,
  };
}

/**
 * Update health state for an endpoint.
 */
function updateHealthState(endpoint, updates) {
  const current = getHealthState(endpoint);
  const next = {
    ...current,
    ...updates,
    lastProbe: new Date().toISOString(),
  };

  if (!updates.healthy) {
    next.consecutiveFailures = (current.consecutiveFailures || 0) + 1;
  } else {
    next.consecutiveFailures = 0;
  }

  healthStateMap.set(endpoint, next);
  return next;
}

/**
 * Probe a single PLC endpoint for health.
 */
function probePlcTcp({ ip, port }) {
  return new Promise((resolve) => {
    if (!ip || !port) {
      resolve({ healthy: false, error: "PLC endpoint missing" });
      return;
    }

    const net = require("net");
    const socket = new net.Socket();
    let settled = false;

    const done = (payload) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (_err) {
        // noop
      }
      resolve(payload);
    };

    socket.setTimeout(HEARTBEAT_TIMEOUT_MS);
    socket.once("connect", () =>
      done({ healthy: true, error: null, probeType: "TCP" })
    );
    socket.once("timeout", () =>
      done({ healthy: false, error: "TCP timeout", probeType: "TCP" })
    );
    socket.once("error", (error) =>
      done({
        healthy: false,
        error: String(error.message || "TCP error"),
        probeType: "TCP",
      })
    );

    socket.connect(Number(port), ip);
  });
}

/**
 * Run a single health check cycle.
 */
async function runHealthCheckCycle() {
  try {
    const machines = await Machine.findAll({
      attributes: ["id", "name", "plc_ip", "machine_ip", "plc_port", "machine_port"],
      where: { is_active: true },
    });

    const probes = [];

    for (const machine of machines) {
      const ip = machine.plc_ip || machine.machine_ip;
      const port = machine.plc_port || machine.machine_port;

      if (!ip || !port) continue;

      const endpoint = `${ip}:${port}`;
      const probe = probePlcTcp({ ip, port }).then((result) => {
        const state = updateHealthState(endpoint, {
          healthy: result.healthy,
          error: result.error || null,
          machineId: machine.id,
          machineName: machine.name,
        });

        return {
          machineId: machine.id,
          endpoint,
          ...state,
        };
      });

      probes.push(probe);
    }

    const results = await Promise.all(probes);

    // Emit health summary
    const healthSummary = {
      timestamp: new Date().toISOString(),
      totalEndpoints: results.length,
      healthyEndpoints: results.filter((r) => r.healthy).length,
      unhealthyEndpoints: results.filter((r) => !r.healthy).length,
      endpoints: results,
    };

    emitRealtime("plc:health_check", healthSummary);

    logInfo("PLC_HEALTH_CHECK_CYCLE", {
      total: results.length,
      healthy: healthSummary.healthyEndpoints,
      unhealthy: healthSummary.unhealthyEndpoints,
    });

    return healthSummary;
  } catch (error) {
    logError("PLC_HEALTH_CHECK_ERROR", {
      error: error.message,
    });
    emitRealtime("plc:health_check_error", {
      timestamp: new Date().toISOString(),
      error: error.message,
    });
    throw error;
  }
}

/**
 * Schedule next health check using setTimeout chain.
 * This prevents check cycles from queuing up.
 */
function scheduleNextHealthCheck() {
  if (!isMonitorRunning) return;

  timerRef = setTimeout(async () => {
    try {
      await runHealthCheckCycle();
    } catch (error) {
      logWarn("HEALTH_CHECK_CYCLE_FAILED", {
        error: error.message,
      });
    } finally {
      // Always schedule next check
      scheduleNextHealthCheck();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Start the health monitor.
 */
function startPlcHealthMonitor() {
  if (isMonitorRunning) {
    logWarn("PLC_HEALTH_MONITOR_ALREADY_RUNNING", {});
    return;
  }

  isMonitorRunning = true;
  logInfo("PLC_HEALTH_MONITOR_STARTED", {
    intervalMs: HEARTBEAT_INTERVAL_MS,
    timeoutMs: HEARTBEAT_TIMEOUT_MS,
  });

  // Start first check immediately
  scheduleNextHealthCheck();
}

/**
 * Stop the health monitor and cleanup.
 */
function stopPlcHealthMonitor() {
  if (!isMonitorRunning) return;

  isMonitorRunning = false;

  if (timerRef) {
    clearTimeout(timerRef);
    timerRef = null;
  }

  logInfo("PLC_HEALTH_MONITOR_STOPPED", {});
}

/**
 * Get current health snapshot.
 */
function getHealthSnapshot() {
  const endpoints = Array.from(healthStateMap.values());
  return {
    timestamp: new Date().toISOString(),
    isRunning: isMonitorRunning,
    totalEndpoints: endpoints.length,
    healthyEndpoints: endpoints.filter((e) => e.healthy).length,
    unhealthyEndpoints: endpoints.filter((e) => !e.healthy).length,
    endpoints,
  };
}

/**
 * Cleanup on shutdown.
 */
function cleanup() {
  stopPlcHealthMonitor();
  healthStateMap.clear();
  logInfo("PLC_HEALTH_MONITOR_CLEANUP", {});
}

module.exports = {
  startPlcHealthMonitor,
  stopPlcHealthMonitor,
  getHealthSnapshot,
  cleanup,
  runHealthCheckCycle,
};
