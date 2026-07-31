const express = require("express");
const rejectionConfigController = require("../../controllers/rejectionConfigController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess, requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

const rejectionConfigReadAccess = [
  { moduleKey: "rejection_config", mode: "view" },
  { moduleKey: "dashboard", mode: "view" },
  { moduleKey: "rejection_analysis", mode: "view" },
  { moduleKey: "operator_view", mode: "view" },
];

router.get(
  "/parts",
  verifyToken,
  requireAnyModuleAccess(rejectionConfigReadAccess),
  rejectionConfigController.listParts
);

router.put(
  "/parts",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.updatePart
);

router.delete(
  "/parts/:name",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deletePart
);

router.post(
  "/delete-part",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deletePart
);

router.get(
  "/operator-config",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "view" },
    { moduleKey: "operator_view", mode: "operate" },
    ...rejectionConfigReadAccess,
  ]),
  rejectionConfigController.getOperatorConfig
);

router.post(
  "/categories",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.createCategory
);

router.put(
  "/categories",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.updateCategory
);

router.delete(
  "/categories/:id",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteCategory
);

router.post(
  "/delete-category",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteCategory
);

router.post(
  "/reasons",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.addReasons
);

router.put(
  "/reasons",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.updateReason
);

router.delete(
  "/reasons/:id",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteReason
);

router.post(
  "/delete-reason",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteReason
);

router.post(
  "/views",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.createView
);

router.put(
  "/views",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.updateView
);

router.delete(
  "/views/:id",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteView
);

router.post(
  "/delete-view",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteView
);

router.post(
  "/zones",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.addZones
);

router.put(
  "/zones",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.updateZone
);

router.delete(
  "/zones/:id",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteZone
);

router.post(
  "/delete-zone",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteZone
);

router.post(
  "/sub-zones",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.addSubZones
);

router.put(
  "/sub-zones",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.updateSubZone
);

router.delete(
  "/sub-zones/:id",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteSubZone
);

router.post(
  "/delete-sub-zone",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.deleteSubZone
);

router.post(
  "/zone-reasons",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.setZoneReasons
);

router.post(
  "/ensure-defaults",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.ensureDefaults
);

router.post(
  "/apply-reasons-all-zones",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.applyReasonsToAllZones
);

router.post(
  "/view-image",
  verifyToken,
  requireModuleAccess("rejection_config", "edit"),
  rejectionConfigController.updateViewImage
);

module.exports = router;
