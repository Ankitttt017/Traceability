const express = require("express");
const roleAccessSettingsController = require("../../controllers/roleAccessSettingsController");
const { verifyToken, isAdmin } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/", verifyToken, roleAccessSettingsController.getSettings);
router.put("/", verifyToken, isAdmin, roleAccessSettingsController.saveSettings);

module.exports = router;
