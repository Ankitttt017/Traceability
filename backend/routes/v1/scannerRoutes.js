const express = require("express");
const scannerController = require("../../controllers/scannerController");
const { verifyToken, isAdmin } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/", verifyToken, scannerController.listScanners);
router.post("/", verifyToken, isAdmin, scannerController.createScanner);
router.put("/:id", verifyToken, isAdmin, scannerController.updateScanner);
router.delete("/:id", verifyToken, isAdmin, scannerController.deleteScanner);

module.exports = router;
