const express = require("express");
const reportController = require("../../controllers/reportController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

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

module.exports = router;
