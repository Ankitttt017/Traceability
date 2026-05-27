const express = require("express");
const qrFormatController = require("../../controllers/qrFormatController");
const { verifyToken, isAdmin } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/", verifyToken, qrFormatController.listRules);
router.post("/", verifyToken, isAdmin, qrFormatController.createRule);
router.put("/:id", verifyToken, isAdmin, qrFormatController.updateRule);
router.delete("/:id", verifyToken, isAdmin, qrFormatController.deleteRule);

module.exports = router;
