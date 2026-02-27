const express = require("express");
const machineController = require("../../controllers/machineController");
const { verifyToken, isAdmin, isAdminOrEngineerStrict } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/", verifyToken, machineController.getMachines);
router.get("/:id", verifyToken, machineController.getMachineById);
router.post("/test-plc", verifyToken, isAdminOrEngineerStrict, machineController.testPlc);
router.post("/reset-plc", verifyToken, isAdminOrEngineerStrict, machineController.resetPlc);
router.post("/write-plc-value", verifyToken, isAdminOrEngineerStrict, machineController.writePlcValue);
router.post("/", verifyToken, isAdmin, machineController.createMachine);
router.put("/:id", verifyToken, isAdmin, machineController.updateMachine);
router.delete("/:id", verifyToken, isAdmin, machineController.deleteMachine);

module.exports = router;
