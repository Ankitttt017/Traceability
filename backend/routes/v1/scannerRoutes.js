const express = require("express");
const scannerController = require("../../controllers/scannerController");
const { verifyToken, isAdmin } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/", verifyToken, scannerController.listScanners);
router.get("/connections", verifyToken, scannerController.listScannerConnections);
router.post("/test-read", verifyToken, scannerController.testScannerRead);
router.post("/usb-activity", verifyToken, scannerController.markUsbActivity);
router.post("/:id/test-connection", verifyToken, scannerController.testScannerConnection);
router.post("/", verifyToken, isAdmin, scannerController.createScanner);
router.put("/:id", verifyToken, isAdmin, scannerController.updateScanner);
router.delete("/:id", verifyToken, isAdmin, scannerController.deleteScanner);

module.exports = router;
