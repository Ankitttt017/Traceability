const express = require("express");
const machineController = require("../../controllers/machineController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess, requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

const machineReadAccess = [
  { moduleKey: "machines", mode: "view" },
  { moduleKey: "operator_view", mode: "view" },
  { moduleKey: "reports", mode: "view" },
  { moduleKey: "production", mode: "view" },
  { moduleKey: "rejection_analysis", mode: "view" },
  { moduleKey: "dashboard", mode: "view" },
  { moduleKey: "part_journey", mode: "view" },
  { moduleKey: "part_process_flow", mode: "view" },
  { moduleKey: "process_flow", mode: "view" },
  { moduleKey: "traceability", mode: "view" },
  { moduleKey: "control_plan", mode: "view" },
  { moduleKey: "io_monitor", mode: "view" },
  { moduleKey: "station_control", mode: "view" },
  { moduleKey: "scanners", mode: "view" },
  { moduleKey: "scanner_monitor", mode: "view" },
  { moduleKey: "packing", mode: "view" },
  { moduleKey: "packing_management", mode: "view" },
  { moduleKey: "rejection_config", mode: "view" },
  { moduleKey: "report_config", mode: "view" },
];

router.get(
  "/",
  verifyToken,
  requireAnyModuleAccess(machineReadAccess),
  machineController.getMachines
);
router.get(
  "/:id",
  verifyToken,
  requireAnyModuleAccess(machineReadAccess),
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
