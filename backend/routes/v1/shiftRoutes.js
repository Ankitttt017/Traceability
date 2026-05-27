const express = require("express");
const shiftController = require("../../controllers/shiftController");
const { verifyToken, isAdmin } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/", verifyToken, shiftController.listShifts);
router.post("/", verifyToken, isAdmin, shiftController.createShift);
router.put("/:id", verifyToken, isAdmin, shiftController.updateShift);
router.delete("/:id", verifyToken, isAdmin, shiftController.deleteShift);

module.exports = router;
