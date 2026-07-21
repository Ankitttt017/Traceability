const express = require("express");
const reportController = require("../../controllers/reportController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/report/data", verifyToken, requireModuleAccess("reports", "view"), reportController.getReportData);
router.get("/report/shot-summary", verifyToken, requireModuleAccess("reports", "view"), reportController.getReportShotSummary);
router.post("/report/export-full", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.get("/report/export-full", verifyToken, requireModuleAccess("reports", "view"), reportController.exportFullReportExcel);
router.post("/report/export-ng", verifyToken, requireModuleAccess("reports", "view"), reportController.exportNGReportExcel);
router.post("/report/export-parts", verifyToken, requireModuleAccess("reports", "view"), reportController.exportPartsReportExcel);
router.post("/report/export-audit", verifyToken, requireModuleAccess("reports", "view"), reportController.exportAuditReportExcel);

module.exports = router;
