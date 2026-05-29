const { logInfo, logWarn, logError } = require("./industrialLogger");

let servicesInitialized = false;
const serviceReferences = {};
const serviceRegistry = {};
const warningThrottleMap = new Map();

function warnOnce(key, message, throttleMs = 30000) {
  const now = Date.now();
  const last = warningThrottleMap.get(key) || 0;
  if (now - last > throttleMs) {
    logWarn("INDUSTRIAL_SERVICE_WARN_THROTTLED", { key, message });
    warningThrottleMap.set(key, now);
  }
}

function setServiceStatus(serviceName, status, errorMessage = null) {
  serviceRegistry[serviceName] = {
    serviceName,
    status,
    errorMessage: errorMessage ? String(errorMessage) : null,
    startedAt: new Date().toISOString(),
  };
}

function isDbDependencyError(error) {
  const msg = String(
    error?.message ||
    error?.parent?.message ||
    error?.original?.message ||
    ""
  ).toLowerCase();
  const code = String(error?.parent?.code || error?.original?.code || "").toUpperCase();
  return (
    msg.includes("timeout") ||
    msg.includes("login failed") ||
    msg.includes("sequelize") ||
    code === "ETIMEOUT" ||
    code === "ESOCKET"
  );
}

async function safeStartService(serviceName, startFn, { dbDependent = false, dbAvailable = true } = {}) {
  if (dbDependent && !dbAvailable) {
    setServiceStatus(serviceName, "skipped", "DB unavailable");
    warnOnce(`service_skip_${serviceName}`, `[IndustrialStartup] Skipped ${serviceName} (DB unavailable)`);
    return null;
  }
  try {
    const result = await startFn();
    setServiceStatus(serviceName, "running", null);
    return result;
  } catch (error) {
    const dbErr = isDbDependencyError(error);
    if (dbDependent || dbErr) {
      setServiceStatus(serviceName, "skipped", error?.message || "DB dependency unavailable");
      warnOnce(
        `service_db_skip_${serviceName}`,
        `[IndustrialStartup] ${serviceName} skipped due to DB dependency: ${error?.message || "unknown"}`
      );
      return null;
    }
    setServiceStatus(serviceName, "failed", error?.message || "startup failure");
    logError("INDUSTRIAL_SERVICE_START_FAILED", { serviceName, error: error?.message, stack: error?.stack });
    return null;
  }
}

async function initializeIndustrialServices({ dbAvailable = true } = {}) {
  if (servicesInitialized) {
    logWarn("INDUSTRIAL_SERVICES_ALREADY_INITIALIZED", {});
    return serviceReferences;
  }
  logInfo("INDUSTRIAL_SERVICES_INITIALIZATION_START", { dbAvailable });

  await safeStartService("plcSocketManager", async () => {
    const svc = require("./plcSocketManager");
    serviceReferences.plcSocketManager = svc;
    return svc;
  }, { dbAvailable });

  await safeStartService("machineLockService", async () => {
    const svc = require("./machineLockService_HARDENED");
    serviceReferences.machineLockService = svc;
    return svc;
  }, { dbAvailable });

  await safeStartService("plcRetryQueue", async () => {
    const svc = require("./plcRetryQueue_HARDENED");
    svc.startProcessing();
    serviceReferences.plcRetryQueue = svc;
    return svc;
  }, { dbAvailable });

  await safeStartService("plcHealthService", async () => {
    const svc = require("./plcHealthService");
    svc.startPlcHealthMonitor();
    serviceReferences.plcHealthService = svc;
    return svc;
  }, { dbAvailable });

  await safeStartService("watchdogSystem", async () => {
    const svc = require("./industrialWatchdogSystem");
    svc.startAllWatchdogs();
    serviceReferences.watchdogSystem = svc;
    return svc;
  }, { dbAvailable });

  await safeStartService("operationTimeline", async () => {
    const svc = require("./operationTimelineService");
    await svc.ensureTimelineTable();
    serviceReferences.operationTimeline = svc;
    return svc;
  }, { dbDependent: true, dbAvailable });

  await safeStartService("telemetry", async () => {
    const svc = require("./industrialTelemetryService");
    serviceReferences.telemetry = svc;
    return svc;
  }, { dbAvailable });

  await safeStartService("recoveryEngine", async () => {
    const svc = require("./plcReconnectRecoveryEngine");
    serviceReferences.recoveryEngine = svc;
    return svc;
  }, { dbAvailable });

  await safeStartService("batchOptimizer", async () => {
    const svc = require("./batchRegisterOptimizationService");
    serviceReferences.batchOptimizer = svc;
    return svc;
  }, { dbAvailable });

  await safeStartService("resetValidation", async () => {
    const svc = require("./deterministicResetValidationService");
    serviceReferences.resetValidation = svc;
    return svc;
  }, { dbAvailable });

  await safeStartService("plcRecoveryAndPolling", async () => {
    const recoverySvc = require("./plcRecoveryService");
    const pollingSvc = require("./plcPollingService");
    await recoverySvc.recoverAll();
    await pollingSvc.start();
    serviceReferences.plcPolling = pollingSvc;
    return pollingSvc;
  }, { dbDependent: true, dbAvailable });

  await safeStartService("machineWatchdog", async () => {
    const svc = require("./machineWatchdogService");
    serviceReferences.watchdog = svc;
    return svc;
  }, { dbAvailable });

  servicesInitialized = true;
  logInfo("INDUSTRIAL_SERVICES_INITIALIZATION_SUCCESS", {
    servicesCount: Object.keys(serviceReferences).length,
    registryCount: Object.keys(serviceRegistry).length,
  });
  return serviceReferences;
}

async function retrySkippedDbDependentServices({ dbAvailable = true } = {}) {
  if (!dbAvailable) return getServiceRegistry();
  const retries = [
    ["operationTimeline", async () => {
      const svc = require("./operationTimelineService");
      await svc.ensureTimelineTable();
      serviceReferences.operationTimeline = svc;
      return svc;
    }],
    ["plcRecoveryAndPolling", async () => {
      const recoverySvc = require("./plcRecoveryService");
      const pollingSvc = require("./plcPollingService");
      await recoverySvc.recoverAll();
      await pollingSvc.start();
      serviceReferences.plcPolling = pollingSvc;
      return pollingSvc;
    }],
  ];
  for (const [name, fn] of retries) {
    if (serviceRegistry[name]?.status === "running") continue;
    await safeStartService(name, fn, { dbDependent: true, dbAvailable });
  }
  return getServiceRegistry();
}

async function shutdownIndustrialServices() {
  try {
    logInfo("INDUSTRIAL_SERVICES_SHUTDOWN_START", {});
    if (serviceReferences.watchdogSystem) serviceReferences.watchdogSystem.stopAllWatchdogs();
    if (serviceReferences.plcHealthService) serviceReferences.plcHealthService.stopPlcHealthMonitor();
    if (serviceReferences.plcRetryQueue) {
      serviceReferences.plcRetryQueue.stopProcessing();
      serviceReferences.plcRetryQueue.cleanup();
    }
    if (serviceReferences.plcSocketManager) serviceReferences.plcSocketManager.shutdown();
    if (serviceReferences.plcPolling) serviceReferences.plcPolling.stop();
    if (serviceReferences.batchOptimizer) serviceReferences.batchOptimizer.cleanup();
    servicesInitialized = false;
    logInfo("INDUSTRIAL_SERVICES_SHUTDOWN_SUCCESS", {});
  } catch (error) {
    logError("INDUSTRIAL_SERVICES_SHUTDOWN_ERROR", { error: error.message });
  }
}

function getService(serviceName) {
  return serviceReferences[serviceName] || null;
}

function getAllServices() {
  return { ...serviceReferences };
}

function getServiceRegistry() {
  return Object.values(serviceRegistry);
}

function getStartupStatus() {
  return {
    initialized: servicesInitialized,
    services: Object.keys(serviceReferences),
    serviceCount: Object.keys(serviceReferences).length,
    serviceRegistry: getServiceRegistry(),
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  initializeIndustrialServices,
  retrySkippedDbDependentServices,
  shutdownIndustrialServices,
  getService,
  getAllServices,
  getServiceRegistry,
  getStartupStatus,
  warnOnce,
};

