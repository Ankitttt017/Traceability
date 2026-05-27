const express = require("express");
const traceabilityController = require("../../controllers/traceabilityController");
const reportController = require("../../controllers/reportController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { getOeeMetrics } = require("../../controllers/oeeController");

const router = express.Router();

router.get("/dashboard/summary", verifyToken, traceabilityController.getDashboardSummary);
router.get("/dashboard/trends", verifyToken, traceabilityController.getDashboardTrends);
router.get("/dashboard/report", verifyToken, traceabilityController.getDashboardReport);
router.get("/dashboard/report/export", verifyToken, reportController.exportFullReportExcel);
router.get("/dashboard/report/export-full", verifyToken, reportController.exportFullReportExcel);
router.get("/dashboard/report/export-parts", verifyToken, reportController.exportPartsReportExcel);
router.get("/dashboard/report/export-audit", verifyToken, reportController.exportAuditReportExcel);
router.post("/dashboard/report/export-full", verifyToken, reportController.exportFullReportExcel);
router.post("/dashboard/report/export-parts", verifyToken, reportController.exportPartsReportExcel);
router.post("/dashboard/report/export-audit", verifyToken, reportController.exportAuditReportExcel);
router.get("/dashboard/oee", verifyToken, getOeeMetrics); // UPGRADE 7 — OEE metrics

module.exports = router;

