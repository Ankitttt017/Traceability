const express = require("express");
const shiftController = require("../../controllers/shiftController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess, requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

const shiftReadAccess = [
  { moduleKey: "shifts", mode: "view" },
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
  { moduleKey: "packing", mode: "view" },
  { moduleKey: "packing_management", mode: "view" },
  { moduleKey: "rejection_config", mode: "view" },
  { moduleKey: "report_config", mode: "view" },
];

router.get("/", verifyToken, requireAnyModuleAccess(shiftReadAccess), shiftController.listShifts);
router.post("/", verifyToken, requireModuleAccess("shifts", "edit"), shiftController.createShift);
router.put("/:id", verifyToken, requireModuleAccess("shifts", "edit"), shiftController.updateShift);
router.delete("/:id", verifyToken, requireModuleAccess("shifts", "edit"), shiftController.deleteShift);

module.exports = router;
