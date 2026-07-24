const Machine = require("../models/Machine");
const Scanner = require("../models/Scanner");

const cache = {
  machines: [],
  scanners: [],
  plcConfigs: [],
  lastRefreshAt: null,
  lastMachineCacheRefresh: null,
  lastScannerCacheRefresh: null,
};

let refreshing = false;
let dbAvailable = false;
let degradedMode = true;
const warningThrottleMap = new Map();
let nextRefreshAllowedAt = 0;
const CACHE_REFRESH_FAILURE_BACKOFF_MS = Math.max(Number(process.env.INDUSTRIAL_CACHE_REFRESH_FAILURE_BACKOFF_MS || 30000), 5000);

function warnOnce(key, message, throttleMs = 30000) {
  const now = Date.now();
  const last = warningThrottleMap.get(key) || 0;
  if (now - last > throttleMs) {
    console.warn(message);
    warningThrottleMap.set(key, now);
  }
}

async function refreshIndustrialCaches() {
  if (refreshing) return cache;
  if (Date.now() < nextRefreshAllowedAt) return cache;
  refreshing = true;
  try {
    const results = await Promise.allSettled([
      Machine.findAll({
        attributes: [
          "id",
          "machine_name",
          "status",
          "is_running",
          "sequence_no",
          "daily_target_qty",
          "cycle_time",
          "loading_time",
        ],
        order: [["sequence_no", "ASC"]],
        raw: true,
      }),
      Scanner.findAll({
        attributes: ["id", "scanner_name", "machine_id", "scanner_mode", "ip_address", "is_active", "updatedAt"],
        where: { is_active: true },
        raw: true,
      }),
    ]);

    const [machinesResult, scannersResult] = results;

    if (machinesResult.status === "fulfilled") {
      cache.machines = machinesResult.value || cache.machines || [];
      cache.lastMachineCacheRefresh = new Date().toISOString();
    } else {
      warnOnce(
        "machine_cache_refresh_failed",
        `[IndustrialCache] Machine cache refresh failed; using last snapshot. ${machinesResult.reason?.message || ""}`
      );
    }

    if (scannersResult.status === "fulfilled") {
      cache.scanners = scannersResult.value || cache.scanners || [];
      cache.lastScannerCacheRefresh = new Date().toISOString();
    } else {
      warnOnce(
        "scanner_cache_refresh_failed",
        `[IndustrialCache] Scanner cache refresh failed; using last snapshot. ${scannersResult.reason?.message || ""}`
      );
    }

    if (machinesResult.status === "fulfilled" && scannersResult.status === "fulfilled") {
      nextRefreshAllowedAt = 0;
    } else {
      nextRefreshAllowedAt = Date.now() + CACHE_REFRESH_FAILURE_BACKOFF_MS;
    }

    cache.lastRefreshAt = new Date().toISOString();
    return cache;
  } finally {
    refreshing = false;
  }
}

function setDbAvailabilityState(nextDbAvailable) {
  dbAvailable = Boolean(nextDbAvailable);
  degradedMode = !dbAvailable;
}

function getIndustrialCaches() {
  return {
    machinesCache: cache.machines,
    scannersCache: cache.scanners,
    plcConfigCache: cache.plcConfigs,
    lastRefreshAt: cache.lastRefreshAt,
    lastMachineCacheRefresh: cache.lastMachineCacheRefresh,
    lastScannerCacheRefresh: cache.lastScannerCacheRefresh,
    dbAvailable,
    degradedMode,
  };
}

module.exports = {
  refreshIndustrialCaches,
  getIndustrialCaches,
  setDbAvailabilityState,
  warnOnce,
};
