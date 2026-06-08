const express = require("express");
const qrFormatController = require("../../controllers/qrFormatController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/", verifyToken, requireModuleAccess("qr_rules", "view"), qrFormatController.listRules);
router.post("/", verifyToken, requireModuleAccess("qr_rules", "edit"), qrFormatController.createRule);
router.put("/:id", verifyToken, requireModuleAccess("qr_rules", "edit"), qrFormatController.updateRule);
router.delete("/:id", verifyToken, requireModuleAccess("qr_rules", "edit"), qrFormatController.deleteRule);

module.exports = router;
