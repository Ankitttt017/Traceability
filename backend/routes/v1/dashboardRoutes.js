const express = require("express");
const traceabilityController = require("../../controllers/traceabilityController");
const reportController = require("../../controllers/reportController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");
const { getOeeMetrics } = require("../../controllers/oeeController");

const router = express.Router();

router.get("/dashboard/summary", verifyToken, requireModuleAccess("dashboard", "view"), traceabilityController.getDashboardSummary);
router.get("/dashboard/trends", verifyToken, requireModuleAccess("dashboard", "view"), traceabilityController.getDashboardTrends);
router.get("/dashboard/report", verifyToken, requireModuleAccess("dashboard", "view"), traceabilityController.getDashboardReport);
router.get("/dashboard/report/export", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.get("/dashboard/report/export-full", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.get("/dashboard/report/export-parts", verifyToken, requireModuleAccess("reports", "view"), reportController.exportPartsReportExcel);
router.get("/dashboard/report/export-audit", verifyToken, requireModuleAccess("reports", "view"), reportController.exportAuditReportExcel);
router.post("/dashboard/report/export-full", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.post("/dashboard/report/export-parts", verifyToken, requireModuleAccess("reports", "view"), reportController.exportPartsReportExcel);
router.post("/dashboard/report/export-audit", verifyToken, requireModuleAccess("reports", "view"), reportController.exportAuditReportExcel);
router.get("/dashboard/oee", verifyToken, requireModuleAccess("dashboard", "view"), getOeeMetrics);

module.exports = router;
