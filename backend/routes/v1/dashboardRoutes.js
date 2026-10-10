const express = require("express");
const traceabilityController = require("../../controllers/traceabilityController");
const reportController = require("../../controllers/reportController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess, requireAnyModuleAccess } = require("../../middleware/roleAccessMiddleware");
const { getShotAnalytics } = require("../../services/report/shotAnalyticsService");
const { getOeeMetrics } = require("../../controllers/oeeController");

const router = express.Router();

router.get("/dashboard/summary", verifyToken, requireModuleAccess("dashboard", "view"), traceabilityController.getDashboardSummary);
router.get("/dashboard/trends", verifyToken, requireModuleAccess("dashboard", "view"), traceabilityController.getDashboardTrends);
router.get("/dashboard/report", verifyToken, requireModuleAccess("dashboard", "view"), traceabilityController.getDashboardReport);
router.get("/rejection-analysis", verifyToken, requireModuleAccess("rejection_analysis", "view"), traceabilityController.getRejectionAnalysis);
router.get("/rejection-summary", verifyToken, requireModuleAccess("rejection_analysis", "view"), traceabilityController.getRejectionSummary);
router.get("/rejection-pareto", verifyToken, requireModuleAccess("rejection_analysis", "view"), traceabilityController.getRejectionPareto);
router.get("/rejection-shift-scrap", verifyToken, requireModuleAccess("rejection_analysis", "view"), traceabilityController.getRejectionShiftScrap);
router.get("/rejection-daily", verifyToken, requireModuleAccess("rejection_analysis", "view"), traceabilityController.getRejectionDaily);
router.get("/rejection-ml-insights", verifyToken, requireModuleAccess("rejection_analysis", "view"), traceabilityController.getRejectionMlInsights);
// DCM (OP100) shot analytics — first stage of the production funnel (Dashboard + Rejection Analysis)
router.get("/shot-analytics", verifyToken, requireAnyModuleAccess([{ moduleKey: "dashboard", mode: "view" }, { moduleKey: "rejection_analysis", mode: "view" }, { moduleKey: "reports", mode: "view" }]), async (req, res) => {
  try { res.json(await getShotAnalytics(req.query || {})); }
  catch (err) { console.error("[SHOT-ANALYTICS]", err.message); res.status(500).json({ error: err.message }); }
});
// NG rows with their view / zone — also feeds the Dashboard's Rejection tab (zone heat map), so Dashboard users can read it
router.get("/rejection-rows", verifyToken, requireAnyModuleAccess([{ moduleKey: "dashboard", mode: "view" }, { moduleKey: "rejection_analysis", mode: "view" }]), traceabilityController.getRejectionRows);
router.get("/dashboard/report/export", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.get("/dashboard/report/export-full", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.get("/dashboard/report/export-parts", verifyToken, requireModuleAccess("reports", "view"), reportController.exportPartsReportExcel);
router.get("/dashboard/report/export-audit", verifyToken, requireModuleAccess("reports", "view"), reportController.exportAuditReportExcel);
router.post("/dashboard/report/export-full", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.post("/dashboard/report/export-parts", verifyToken, requireModuleAccess("reports", "view"), reportController.exportPartsReportExcel);
router.post("/dashboard/report/export-audit", verifyToken, requireModuleAccess("reports", "view"), reportController.exportAuditReportExcel);
router.get("/dashboard/oee", verifyToken, requireModuleAccess("dashboard", "view"), getOeeMetrics);

module.exports = router;
