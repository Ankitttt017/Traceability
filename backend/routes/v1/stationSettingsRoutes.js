const express = require("express");
const stationSettingsController = require("../../controllers/stationSettingsController");
const { verifyToken } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/", verifyToken, stationSettingsController.getSettings);
router.put("/", verifyToken, stationSettingsController.saveSettings);

module.exports = router;
