const express = require("express");
const scannerController = require("../../controllers/scannerController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess, requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/", verifyToken, requireModuleAccess("scanners", "view"), scannerController.listScanners);
router.get("/connections", verifyToken, requireModuleAccess("scanner_monitor", "view"), scannerController.listScannerConnections);
router.post("/test-read", verifyToken, requireModuleAccess("scanners", "edit"), scannerController.testScannerRead);
router.post("/usb-activity", verifyToken, scannerController.markUsbActivity);
router.post(
  "/:id/test-connection",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "scanners", mode: "view" },
    { moduleKey: "scanner_monitor", mode: "view" },
  ]),
  scannerController.testScannerConnection
);
router.post("/", verifyToken, requireModuleAccess("scanners", "edit"), scannerController.createScanner);
router.put("/:id", verifyToken, requireModuleAccess("scanners", "edit"), scannerController.updateScanner);
router.delete("/:id", verifyToken, requireModuleAccess("scanners", "edit"), scannerController.deleteScanner);

module.exports = router;
