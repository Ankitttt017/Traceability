const express = require("express");
const packingController = require("../../controllers/packingController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/overview", verifyToken, requireModuleAccess("packing", "view"), packingController.getOverview);
router.get("/management/settings", verifyToken, requireModuleAccess("packing_management", "view"), packingController.getManagementSettings);
router.put("/management/settings", verifyToken, requireModuleAccess("packing_management", "edit"), packingController.saveManagementSettings);
router.get("/management/boxes", verifyToken, requireModuleAccess("packing_management", "view"), packingController.listBoxes);
router.post("/management/generate-next", verifyToken, requireModuleAccess("packing_management", "edit"), packingController.generateNextBox);
router.get("/settings", verifyToken, requireModuleAccess("packing_management", "view"), packingController.getManagementSettings);
router.put("/settings", verifyToken, requireModuleAccess("packing_management", "edit"), packingController.saveManagementSettings);
router.get("/boxes", verifyToken, requireModuleAccess("packing_management", "view"), packingController.listBoxes);
router.post("/generate-next", verifyToken, requireModuleAccess("packing_management", "edit"), packingController.generateNextBox);
router.get("/box/:boxNumber", verifyToken, requireModuleAccess("packing", "operate"), packingController.getSessionByBox);
router.put("/box/:sessionId", verifyToken, requireModuleAccess("packing", "operate"), packingController.updateBox);
router.delete("/box/:sessionId", verifyToken, requireModuleAccess("packing", "operate"), packingController.deleteBox);
router.post("/start-box", verifyToken, requireModuleAccess("packing", "operate"), packingController.startBox);
router.post("/scan", verifyToken, requireModuleAccess("packing", "operate"), packingController.scanPartToBox);

module.exports = router;
