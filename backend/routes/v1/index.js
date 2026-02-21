const express = require("express");
const machineRoutes = require("./machineRoutes");
const scannerRoutes = require("./scannerRoutes");
const userRoutes = require("./userRoutes");
const traceabilityRoutes = require("./traceabilityRoutes");
const dashboardRoutes = require("./dashboardRoutes");
const qrFormatRoutes = require("./qrFormatRoutes");
const packingRoutes = require("./packingRoutes");
const shiftRoutes = require("./shiftRoutes");

const router = express.Router();

router.use("/machines", machineRoutes);
router.use("/scanners", scannerRoutes);
router.use("/users", userRoutes);
router.use("/qr-format-rules", qrFormatRoutes);
router.use("/packing", packingRoutes);
router.use("/shifts", shiftRoutes);
router.use(traceabilityRoutes);
router.use(dashboardRoutes);

module.exports = router;
