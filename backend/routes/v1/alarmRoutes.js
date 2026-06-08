const express = require("express");
const router = express.Router();
const alarmController = require("../../controllers/alarmController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

router.get("/", verifyToken, requireModuleAccess("dashboard", "view"), alarmController.getRecentAlarms);
router.patch("/:id/resolve", verifyToken, requireModuleAccess("io_monitor", "control"), alarmController.resolveAlarm);
router.post("/resolve-all", verifyToken, requireModuleAccess("io_monitor", "control"), alarmController.resolveAllAlarms);

module.exports = router;
