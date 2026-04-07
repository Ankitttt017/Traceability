const express = require("express");
const router = express.Router();
const alarmController = require("../../controllers/alarmController");

/**
 * @route GET /api/v1/alarms
 * @desc Get recent unresolved alarms.
 */
router.get("/", alarmController.getRecentAlarms);

/**
 * @route PATCH /api/v1/alarms/:id/resolve
 * @desc Resolve a specific alarm.
 */
router.patch("/:id/resolve", alarmController.resolveAlarm);

/**
 * @route POST /api/v1/alarms/resolve-all
 * @desc Resolve all unresolved alarms.
 */
router.post("/resolve-all", alarmController.resolveAllAlarms);

module.exports = router;
