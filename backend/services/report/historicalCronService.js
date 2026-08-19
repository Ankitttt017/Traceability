const { syncDateRange } = require("./historicalSyncService");

function startHistoricalCron() {
  // Run once every 60 minutes
  const INTERVAL_MS = 60 * 60 * 1000;

  setInterval(async () => {
    try {
      console.log(`[HistoricalCron] Starting auto-sync for the last 2 hours...`);
      
      const now = new Date();
      // Look back 2 hours to ensure overlap is captured
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      
      await syncDateRange(twoHoursAgo, now);
      
      console.log(`[HistoricalCron] Auto-sync completed successfully.`);
    } catch (error) {
      console.error(`[HistoricalCron] Auto-sync failed:`, error);
    }
  }, INTERVAL_MS);

  console.log(`[HistoricalCron] Service started. Will run every 1 hour.`);
}

module.exports = {
  startHistoricalCron
};
