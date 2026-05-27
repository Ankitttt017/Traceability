const express = require("express");
const plcConfigController = require("../../controllers/plcConfigController");
const plcEndpointRoutes = require("./plcEndpointRoutes");
const { verifyToken, isAdmin, isAdminOrEngineer } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/ranges", verifyToken, isAdminOrEngineer, plcConfigController.listRanges);
router.get("/ranges/:id/registers", verifyToken, isAdminOrEngineer, plcConfigController.getRangeRegisters);
router.get("/export", verifyToken, isAdminOrEngineer, plcConfigController.exportRegisterPlanCsv);
router.post("/ranges", verifyToken, isAdminOrEngineer, plcConfigController.createRange);
router.put("/ranges/:id", verifyToken, isAdminOrEngineer, plcConfigController.updateRange);
router.delete("/ranges/:id", verifyToken, isAdmin, plcConfigController.deleteRange);

// Endpoint routes mounted under /api/v1/plc-config/*
router.use("/", plcEndpointRoutes);

module.exports = router;
