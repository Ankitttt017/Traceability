const express = require("express");
const router = express.Router();
const industrialController = require("../../controllers/industrialController");

router.get("/diagnostics/:machineId", industrialController.getDiagnostics);
router.get("/diagnostics/rca/:cycleToken", industrialController.getRcaReport);
router.post("/commissioning/:machineId", industrialController.runCommissioning);
router.post("/recovery/:machineId", industrialController.manualRecovery);
router.post("/safety/:machineId", industrialController.setSafetyMode);
router.get("/sequence/validate", industrialController.getSequenceStatus);
router.get("/routing", industrialController.getRoutingOptions);

module.exports = router;
