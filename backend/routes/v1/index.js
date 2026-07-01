const express = require("express");
const machineRoutes = require("./machineRoutes");
const scannerRoutes = require("./scannerRoutes");
const userRoutes = require("./userRoutes");
const traceabilityRoutes = require("./traceabilityRoutes");
const dashboardRoutes = require("./dashboardRoutes");
const qrFormatRoutes = require("./qrFormatRoutes");
const packingRoutes = require("./packingRoutes");
const shiftRoutes = require("./shiftRoutes");
const stationSettingsRoutes = require("./stationSettingsRoutes");
const plcConfigRoutes = require("./plcConfigRoutes");
const roleAccessSettingsRoutes = require("./roleAccessSettingsRoutes");
const partRoutes = require("./partRoutes"); // UPGRADE COMPLETE — Part Journey
const alarmRoutes = require("./alarmRoutes");
const industrialRoutes = require("./industrialRoutes");
const reportRoutes = require("./reportRoutes");
const rejectionConfigRoutes = require("./rejectionConfigRoutes");
const organizationRoutes = require("./organizationRoutes");

const router = express.Router();

router.use("/machines", machineRoutes);
router.use("/scanners", scannerRoutes);
router.use("/users", userRoutes);
router.use("/qr-format-rules", qrFormatRoutes);
router.use("/packing", packingRoutes);
router.use("/shifts", shiftRoutes);
router.use("/station-settings", stationSettingsRoutes);
router.use("/role-access-settings", roleAccessSettingsRoutes);
router.use("/plc-config", plcConfigRoutes);
router.use("/parts", partRoutes); // GET /api/parts/:partId/journey
router.use("/alarms", alarmRoutes);
router.use("/reports", reportRoutes);
router.use("/rejection-config", rejectionConfigRoutes);
router.use("/organization", organizationRoutes);
router.use(industrialRoutes);
router.use(traceabilityRoutes);
router.use(dashboardRoutes);

module.exports = router;
