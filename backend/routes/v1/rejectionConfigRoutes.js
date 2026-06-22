const express = require("express");
const rejectionConfigController = require("../../controllers/rejectionConfigController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess, requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get(
  "/parts",
  verifyToken,
  requireModuleAccess("master_settings", "view"),
  rejectionConfigController.listParts
);

router.put(
  "/parts",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.updatePart
);

router.delete(
  "/parts/:name",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deletePart
);

router.post(
  "/delete-part",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deletePart
);

router.get(
  "/operator-config",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "view" },
    { moduleKey: "operator_view", mode: "operate" },
    { moduleKey: "master_settings", mode: "view" },
  ]),
  rejectionConfigController.getOperatorConfig
);

router.post(
  "/categories",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.createCategory
);

router.put(
  "/categories",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.updateCategory
);

router.delete(
  "/categories/:id",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deleteCategory
);

router.post(
  "/delete-category",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deleteCategory
);

router.post(
  "/reasons",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.addReasons
);

router.put(
  "/reasons",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.updateReason
);

router.delete(
  "/reasons/:id",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deleteReason
);

router.post(
  "/delete-reason",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deleteReason
);

router.post(
  "/views",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.createView
);

router.put(
  "/views",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.updateView
);

router.delete(
  "/views/:id",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deleteView
);

router.post(
  "/delete-view",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deleteView
);

router.post(
  "/zones",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.addZones
);

router.put(
  "/zones",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.updateZone
);

router.delete(
  "/zones/:id",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deleteZone
);

router.post(
  "/delete-zone",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.deleteZone
);

router.post(
  "/zone-reasons",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.setZoneReasons
);

router.post(
  "/ensure-defaults",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.ensureDefaults
);

router.post(
  "/apply-reasons-all-zones",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.applyReasonsToAllZones
);

router.post(
  "/view-image",
  verifyToken,
  requireModuleAccess("master_settings", "edit"),
  rejectionConfigController.updateViewImage
);

module.exports = router;
