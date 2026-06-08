const express = require("express");
const shiftController = require("../../controllers/shiftController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/", verifyToken, requireModuleAccess("shifts", "view"), shiftController.listShifts);
router.post("/", verifyToken, requireModuleAccess("shifts", "edit"), shiftController.createShift);
router.put("/:id", verifyToken, requireModuleAccess("shifts", "edit"), shiftController.updateShift);
router.delete("/:id", verifyToken, requireModuleAccess("shifts", "edit"), shiftController.deleteShift);

module.exports = router;
