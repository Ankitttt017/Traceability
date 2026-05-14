/**
 * industrialStartupManager.js
 * ════════════════════════════════════════════════════════════════
 * 
 * INDUSTRIAL STARTUP + INTEGRATION MANAGER
 * 
 * Orchestrates startup of all hardened industrial services:
 * 1. Initialize socket manager
 * 2. Initialize retry queue
 * 3. Initialize watchdog system
 * 4. Initialize operation timeline
 * 5. Initialize health monitoring
 * 6. Initialize alarm monitoring
 * 7. Initialize telemetry
 * 8. Setup graceful shutdown
 * 
 * Ensures all services have proper lifecycle management.
 * 
 * ════════════════════════════════════════════════════════════════
 */

const { logInfo, logWarn, logError } = require("./industrialLogger");

let servicesInitialized = false;
const serviceReferences = {};

/**
 * Initialize all industrial services.
 */
async function initializeIndustrialServices() {
  if (servicesInitialized) {
    logWarn("INDUSTRIAL_SERVICES_ALREADY_INITIALIZED", {});
    return;
  }

  try {
    logInfo("INDUSTRIAL_SERVICES_INITIALIZATION_START", {});

    // 1. Socket Manager (passive, lazy-initialized on first use)
    const plcSocketManager = require("./plcSocketManager");
    serviceReferences.plcSocketManager = plcSocketManager;
    logInfo("SOCKET_MANAGER_LOADED", {});

    // 2. Hardened Machine Lock Service
    const machineLockService = require("./machineLockService_HARDENED");
    serviceReferences.machineLockService = machineLockService;
    logInfo("MACHINE_LOCK_SERVICE_LOADED", {});

    // 3. Retry Queue (with cleanup refs)
    const plcRetryQueue = require("./plcRetryQueue_HARDENED");
    plcRetryQueue.startProcessing();
    serviceReferences.plcRetryQueue = plcRetryQueue;
    logInfo("PLC_RETRY_QUEUE_STARTED", {});

    // 4. Health Service
    const plcHealthService = require("./plcHealthService");
    plcHealthService.startPlcHealthMonitor();
    serviceReferences.plcHealthService = plcHealthService;
    logInfo("PLC_HEALTH_MONITOR_STARTED", {});

    // 5. Watchdog System (5 independent watchdogs)
    const watchdogSystem = require("./industrialWatchdogSystem");
    watchdogSystem.startAllWatchdogs();
    serviceReferences.watchdogSystem = watchdogSystem;
    logInfo("WATCHDOG_SYSTEM_STARTED", {});

    // 6. Operation Timeline (database persistence)
    const operationTimeline = require("./operationTimelineService");
    await operationTimeline.ensureTimelineTable();
    serviceReferences.operationTimeline = operationTimeline;
    logInfo("OPERATION_TIMELINE_INITIALIZED", {});

    // 7. Telemetry (passive, collects metrics)
    const telemetry = require("./industrialTelemetryService");
    serviceReferences.telemetry = telemetry;
    logInfo("TELEMETRY_SERVICE_LOADED", {});

    // 8. Reconnect Recovery Engine (passive, used on disconnect)
    const recoveryEngine = require("./plcReconnectRecoveryEngine");
    serviceReferences.recoveryEngine = recoveryEngine;
    logInfo("RECONNECT_RECOVERY_ENGINE_LOADED", {});

    // 9. Batch Register Optimizer (passive, used for reads)
    const batchOptimizer = require("./batchRegisterOptimizationService");
    serviceReferences.batchOptimizer = batchOptimizer;
    logInfo("BATCH_REGISTER_OPTIMIZER_LOADED", {});

    // 10. Reset Validation Service (passive, used on cycle complete)
    const resetValidation = require("./deterministicResetValidationService");
    serviceReferences.resetValidation = resetValidation;
    logInfo("RESET_VALIDATION_SERVICE_LOADED", {});

    // 11. PLC State Recovery & Polling (New Hardening)
    const plcRecoveryService = require("./plcRecoveryService");
    const plcPollingService = require("./plcPollingService");
    await plcRecoveryService.recoverAll();
    await plcPollingService.start();
    serviceReferences.plcPolling = plcPollingService;
    logInfo("PLC_RECOVERY_AND_POLLING_STARTED", {});

    // 12. Machine Watchdog (New Hardening)
    const machineWatchdogService = require("./machineWatchdogService");
    serviceReferences.watchdog = machineWatchdogService;
    logInfo("MACHINE_WATCHDOG_SERVICE_LOADED", {});

    servicesInitialized = true;
    logInfo("INDUSTRIAL_SERVICES_INITIALIZATION_SUCCESS", {
      servicesCount: Object.keys(serviceReferences).length,
    });

    return serviceReferences;
  } catch (error) {
    logError("INDUSTRIAL_SERVICES_INITIALIZATION_FAILED", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Graceful shutdown of all services.
 */
async function shutdownIndustrialServices() {
  try {
    logInfo("INDUSTRIAL_SERVICES_SHUTDOWN_START", {});

    // Stop watchdogs
    if (serviceReferences.watchdogSystem) {
      serviceReferences.watchdogSystem.stopAllWatchdogs();
    }

    // Stop health monitor
    if (serviceReferences.plcHealthService) {
      serviceReferences.plcHealthService.stopPlcHealthMonitor();
    }

    // Stop retry queue
    if (serviceReferences.plcRetryQueue) {
      serviceReferences.plcRetryQueue.stopProcessing();
      serviceReferences.plcRetryQueue.cleanup();
    }

    // Cleanup health service
    // Legacy health service does not expose explicit cleanup.

    // Shutdown socket manager
    if (serviceReferences.plcSocketManager) {
      serviceReferences.plcSocketManager.shutdown();
    }
    
    // Stop Polling (Point 11)
    if (serviceReferences.plcPolling) {
      serviceReferences.plcPolling.stop();
    }

    // Cleanup batch optimizer
    if (serviceReferences.batchOptimizer) {
      serviceReferences.batchOptimizer.cleanup();
    }

    servicesInitialized = false;
    logInfo("INDUSTRIAL_SERVICES_SHUTDOWN_SUCCESS", {});
  } catch (error) {
    logError("INDUSTRIAL_SERVICES_SHUTDOWN_ERROR", {
      error: error.message,
    });
  }
}

/**
 * Get service reference.
 */
function getService(serviceName) {
  return serviceReferences[serviceName] || null;
}

/**
 * Get all service references.
 */
function getAllServices() {
  return { ...serviceReferences };
}

/**
 * Get startup status.
 */
function getStartupStatus() {
  return {
    initialized: servicesInitialized,
    services: Object.keys(serviceReferences),
    serviceCount: Object.keys(serviceReferences).length,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Setup graceful shutdown handlers.
 */
function setupGracefulShutdown() {
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];

  signals.forEach((signal) => {
    process.on(signal, async () => {
      logInfo("GRACEFUL_SHUTDOWN_SIGNAL_RECEIVED", { signal });
      await shutdownIndustrialServices();
      process.exit(0);
    });
  });

  // Uncaught exception handler
  process.on("uncaughtException", (error) => {
    logError("UNCAUGHT_EXCEPTION", {
      error: error.message,
      stack: error.stack,
    });
  });

  // Unhandled promise rejection handler
  process.on("unhandledRejection", (reason, promise) => {
    logError("UNHANDLED_PROMISE_REJECTION", {
      reason: String(reason),
      promise: String(promise),
    });
  });
}

module.exports = {
  initializeIndustrialServices,
  shutdownIndustrialServices,
  getService,
  getAllServices,
  getStartupStatus,
  setupGracefulShutdown,
};
