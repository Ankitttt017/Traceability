const express = require("express");
const machineController = require("../../controllers/machineController");
const { verifyToken, isAdmin, isAdminOrEngineerStrict } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/", verifyToken, machineController.getMachines);
router.get("/:id", verifyToken, machineController.getMachineById);
router.post("/test-plc", verifyToken, isAdminOrEngineerStrict, machineController.testPlc);
router.post("/test-connection", verifyToken, isAdminOrEngineerStrict, machineController.testConnection);
router.post("/reset-plc", verifyToken, isAdminOrEngineerStrict, machineController.resetPlc);
router.post("/plc-command", verifyToken, isAdminOrEngineerStrict, machineController.sendPlcCommand);
router.post("/read-plc-value", verifyToken, isAdminOrEngineerStrict, machineController.readPlcValue);
router.post("/write-plc-value", verifyToken, isAdminOrEngineerStrict, machineController.writePlcValue);
router.patch("/:id/target", verifyToken, isAdminOrEngineerStrict, machineController.updateMachineTarget);
router.post("/", verifyToken, isAdmin, machineController.createMachine);
router.put("/:id", verifyToken, isAdmin, machineController.updateMachine);
router.delete("/:id", verifyToken, isAdmin, machineController.deleteMachine);

module.exports = router;
