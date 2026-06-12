const express = require("express");
const machineController = require("../../controllers/machineController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess, requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get(
  "/",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "machines", mode: "view" },
    { moduleKey: "operator_view", mode: "view" },
  ]),
  machineController.getMachines
);
router.get(
  "/:id",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "machines", mode: "view" },
    { moduleKey: "operator_view", mode: "view" },
  ]),
  machineController.getMachineById
);
router.post("/test-plc", verifyToken, requireModuleAccess("io_monitor", "control"), machineController.testPlc);
router.post("/test-connection", verifyToken, requireModuleAccess("io_monitor", "control"), machineController.testConnection);
router.post("/reset-plc", verifyToken, requireModuleAccess("io_monitor", "control"), machineController.resetPlc);
router.post("/plc-command", verifyToken, requireModuleAccess("io_monitor", "control"), machineController.sendPlcCommand);
router.post("/read-plc-value", verifyToken, requireModuleAccess("io_monitor", "control"), machineController.readPlcValue);
router.post("/read-plc-registers", verifyToken, requireModuleAccess("io_monitor", "control"), machineController.readPlcRegisters);
router.post("/debug-plc-effective-config", verifyToken, requireModuleAccess("io_monitor", "control"), machineController.debugPlcEffectiveConfig);
router.post("/write-plc-value", verifyToken, requireModuleAccess("io_monitor", "control"), machineController.writePlcValue);
router.patch("/:id/target", verifyToken, requireModuleAccess("machines", "edit"), machineController.updateMachineTarget);
router.post("/", verifyToken, requireModuleAccess("machines", "edit"), machineController.createMachine);
router.put("/:id", verifyToken, requireModuleAccess("machines", "edit"), machineController.updateMachine);
router.delete("/:id", verifyToken, requireModuleAccess("machines", "edit"), machineController.deleteMachine);

module.exports = router;
