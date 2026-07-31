const express = require("express");
const organizationController = require("../../controllers/organizationController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess, requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

const organizationReadAccess = [
  { moduleKey: "plants", mode: "view" },
  { moduleKey: "lines", mode: "view" },
  { moduleKey: "parts", mode: "view" },
  { moduleKey: "machines", mode: "view" },
  { moduleKey: "users", mode: "view" },
  { moduleKey: "reports", mode: "view" },
  { moduleKey: "production", mode: "view" },
  { moduleKey: "rejection_analysis", mode: "view" },
  { moduleKey: "dashboard", mode: "view" },
  { moduleKey: "operator_view", mode: "view" },
  { moduleKey: "part_journey", mode: "view" },
  { moduleKey: "part_process_flow", mode: "view" },
  { moduleKey: "process_flow", mode: "view" },
  { moduleKey: "traceability", mode: "view" },
  { moduleKey: "control_plan", mode: "view" },
  { moduleKey: "station_control", mode: "view" },
  { moduleKey: "plc_config", mode: "view" },
  { moduleKey: "scanners", mode: "view" },
  { moduleKey: "scanner_monitor", mode: "view" },
  { moduleKey: "shifts", mode: "view" },
  { moduleKey: "qr_rules", mode: "view" },
  { moduleKey: "packing", mode: "view" },
  { moduleKey: "packing_management", mode: "view" },
  { moduleKey: "rejection_config", mode: "view" },
  { moduleKey: "report_config", mode: "view" },
];

router.get("/context", verifyToken, requireAnyModuleAccess([
  ...organizationReadAccess,
]), organizationController.getContext);
router.get("/plants", verifyToken, requireAnyModuleAccess([
  ...organizationReadAccess,
]), organizationController.listPlants);
router.post("/plants", verifyToken, requireModuleAccess("plants", "edit"), organizationController.createPlant);
router.put("/plants/:id", verifyToken, requireModuleAccess("plants", "edit"), organizationController.updatePlant);
router.delete("/plants/:id", verifyToken, requireModuleAccess("plants", "edit"), organizationController.deletePlant);
router.get("/lines", verifyToken, requireAnyModuleAccess([
  ...organizationReadAccess,
]), organizationController.listLines);
router.post("/lines", verifyToken, requireModuleAccess("lines", "edit"), organizationController.createLine);
router.put("/lines/:id", verifyToken, requireModuleAccess("lines", "edit"), organizationController.updateLine);
router.delete("/lines/:id", verifyToken, requireModuleAccess("lines", "edit"), organizationController.deleteLine);
router.get("/parts", verifyToken, requireAnyModuleAccess([
  ...organizationReadAccess,
]), organizationController.listParts);
router.post("/parts", verifyToken, requireModuleAccess("parts", "edit"), organizationController.createPart);
router.put("/parts/:id", verifyToken, requireModuleAccess("parts", "edit"), organizationController.updatePart);
router.delete("/parts/:id", verifyToken, requireModuleAccess("parts", "edit"), organizationController.deletePart);

module.exports = router;
