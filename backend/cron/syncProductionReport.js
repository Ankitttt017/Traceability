const { syncDateRange } = require("../services/report/historicalSyncService");

let isSyncing = false;

async function runLiveSync() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    // Sync the last 15 minutes to catch any late-arriving logs
    const dateTo = new Date();
    const dateFrom = new Date(dateTo.getTime() - 15 * 60 * 1000);
    await syncDateRange(dateFrom, dateTo);
  } catch (error) {
    console.error("[CronSync] Error running live sync:", error);
  } finally {
    isSyncing = false;
  }
}

function initCronJobs() {
  console.log("[CronSync] Initializing 1-minute live sync for ProductionReport master table.");
  // Run every 1 minute
  setInterval(runLiveSync, 60 * 1000);
  
  // Run once on startup after 10 seconds
  setTimeout(runLiveSync, 10 * 1000);
}

module.exports = {
  initCronJobs
};
