const express = require("express");
const roleAccessSettingsController = require("../../controllers/roleAccessSettingsController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/", verifyToken, roleAccessSettingsController.getSettings);
router.put("/", verifyToken, requireModuleAccess("master_settings", "edit"), roleAccessSettingsController.saveSettings);

module.exports = router;
