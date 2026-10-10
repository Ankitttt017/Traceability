const express = require("express");
const reportController = require("../../controllers/reportController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess, requireAnyModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/report/data", verifyToken, requireModuleAccess("reports", "view"), reportController.getReportData);
router.get("/report/summary-metrics", verifyToken, requireModuleAccess("reports", "view"), reportController.getReportSummaryMetrics);
router.get("/report/shot-summary", verifyToken, requireModuleAccess("reports", "view"), reportController.getReportShotSummary);
router.post("/report/export-full", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.get("/report/export-full", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.post("/report/export-ng", verifyToken, requireModuleAccess("reports", "view"), reportController.exportNGReportExcel);
router.post("/report/export-parts", verifyToken, requireModuleAccess("reports", "view"), reportController.exportPartsReportExcel);
router.post("/report/export-audit", verifyToken, requireModuleAccess("reports", "view"), reportController.exportAuditReportExcel);

const historicalReportController = require("../../controllers/historicalReportController");

router.get("/report/historical", verifyToken, requireModuleAccess("reports", "view"), historicalReportController.getHistoricalReportData);
router.post("/report/historical/sync", verifyToken, requireModuleAccess("reports", "view"), historicalReportController.syncHistoricalData);
router.post("/report/historical/export", verifyToken, requireModuleAccess("reports", "view"), historicalReportController.exportHistoricalReportExcel);
// Background export: start → poll → download (a long export no longer has to fit in one HTTP request)
router.post("/report/historical/export/jobs", verifyToken, requireModuleAccess("reports", "view"), historicalReportController.createHistoricalExportJob);
router.get("/report/historical/export/jobs/:jobId", verifyToken, requireModuleAccess("reports", "view"), historicalReportController.getHistoricalExportJob);
router.get("/report/historical/export/estimate", verifyToken, requireModuleAccess("reports", "view"), historicalReportController.estimateHistoricalExport);
router.delete("/report/historical/export/jobs/:jobId", verifyToken, requireModuleAccess("reports", "view"), historicalReportController.cancelHistoricalExportJob);
router.get("/report/historical/export/jobs/:jobId/file", verifyToken, requireModuleAccess("reports", "view"), historicalReportController.downloadHistoricalExportJob);
// leak tester PLC values of one part (Component Journey OP150 step)
router.get(
  "/report/leak-plc-readings",
  verifyToken,
  requireAnyModuleAccess([{ moduleKey: "reports", mode: "view" }, { moduleKey: "part_journey", mode: "view" }]),
  historicalReportController.getLeakPlcReadings
);

module.exports = router;
