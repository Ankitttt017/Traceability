const express = require("express");
const organizationController = require("../../controllers/organizationController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/context", verifyToken, requireModuleAccess("master_settings", "view"), organizationController.getContext);
router.get("/plants", verifyToken, requireModuleAccess("master_settings", "view"), organizationController.listPlants);
router.post("/plants", verifyToken, requireModuleAccess("master_settings", "edit"), organizationController.createPlant);
router.put("/plants/:id", verifyToken, requireModuleAccess("master_settings", "edit"), organizationController.updatePlant);
router.delete("/plants/:id", verifyToken, requireModuleAccess("master_settings", "edit"), organizationController.deletePlant);
router.get("/lines", verifyToken, requireModuleAccess("master_settings", "view"), organizationController.listLines);
router.post("/lines", verifyToken, requireModuleAccess("master_settings", "edit"), organizationController.createLine);
router.put("/lines/:id", verifyToken, requireModuleAccess("master_settings", "edit"), organizationController.updateLine);
router.delete("/lines/:id", verifyToken, requireModuleAccess("master_settings", "edit"), organizationController.deleteLine);
router.get("/parts", verifyToken, requireModuleAccess("master_settings", "view"), organizationController.listParts);
router.post("/parts", verifyToken, requireModuleAccess("master_settings", "edit"), organizationController.createPart);
router.put("/parts/:id", verifyToken, requireModuleAccess("master_settings", "edit"), organizationController.updatePart);
router.delete("/parts/:id", verifyToken, requireModuleAccess("master_settings", "edit"), organizationController.deletePart);

module.exports = router;
