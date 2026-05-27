const express = require("express");
const reportController = require("../../controllers/reportController");
const { verifyToken } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/report/data", verifyToken, reportController.getReportData);
router.post("/report/export-full", verifyToken, reportController.exportFullReportExcel);
router.get("/report/export-full", verifyToken, reportController.exportFullReportExcel);
router.post("/report/export-ng", verifyToken, reportController.exportNGReportExcel);
router.post("/report/export-parts", verifyToken, reportController.exportPartsReportExcel);
router.post("/report/export-audit", verifyToken, reportController.exportAuditReportExcel);

module.exports = router;
