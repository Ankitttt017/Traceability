const express = require("express");
const packingController = require("../../controllers/packingController");
const { verifyToken, isAdminOrEngineer } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/overview", verifyToken, packingController.getOverview);
router.get("/management/settings", verifyToken, packingController.getManagementSettings);
router.put("/management/settings", verifyToken, isAdminOrEngineer, packingController.saveManagementSettings);
router.get("/management/boxes", verifyToken, packingController.listBoxes);
router.post("/management/generate-next", verifyToken, isAdminOrEngineer, packingController.generateNextBox);
router.get("/settings", verifyToken, packingController.getManagementSettings);
router.put("/settings", verifyToken, isAdminOrEngineer, packingController.saveManagementSettings);
router.get("/boxes", verifyToken, packingController.listBoxes);
router.post("/generate-next", verifyToken, isAdminOrEngineer, packingController.generateNextBox);
router.get("/box/:boxNumber", verifyToken, packingController.getSessionByBox);
router.put("/box/:sessionId", verifyToken, packingController.updateBox);
router.delete("/box/:sessionId", verifyToken, packingController.deleteBox);
router.post("/start-box", verifyToken, packingController.startBox);
router.post("/scan", verifyToken, packingController.scanPartToBox);

module.exports = router;
