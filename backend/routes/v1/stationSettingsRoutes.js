const express = require("express");
const stationSettingsController = require("../../controllers/stationSettingsController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess, requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get(
  "/",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "station_control", mode: "view" },
    { moduleKey: "operator_view", mode: "view" },
    { moduleKey: "part_journey", mode: "view" },
    { moduleKey: "traceability", mode: "view" },
  ]),
  stationSettingsController.getSettings
);
router.put("/", verifyToken, requireModuleAccess("station_control", "edit"), stationSettingsController.saveSettings);

module.exports = router;
