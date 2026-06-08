const express = require("express");
const router = express.Router();
const industrialController = require("../../controllers/industrialController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

router.get("/diagnostics/:machineId", verifyToken, requireModuleAccess("io_monitor", "view"), industrialController.getDiagnostics);
router.get("/diagnostics/rca/:cycleToken", verifyToken, requireModuleAccess("io_monitor", "view"), industrialController.getRcaReport);
router.post("/commissioning/:machineId", verifyToken, requireModuleAccess("io_monitor", "control"), industrialController.runCommissioning);
router.post("/recovery/:machineId", verifyToken, requireModuleAccess("io_monitor", "control"), industrialController.manualRecovery);
router.post("/safety/:machineId", verifyToken, requireModuleAccess("io_monitor", "control"), industrialController.setSafetyMode);
router.get("/sequence/validate", verifyToken, requireModuleAccess("io_monitor", "view"), industrialController.getSequenceStatus);
router.get("/routing", verifyToken, requireModuleAccess("io_monitor", "view"), industrialController.getRoutingOptions);

module.exports = router;
