const express = require("express");
const traceabilityController = require("../../controllers/traceabilityController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess, requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/traceability/operations", verifyToken, requireModuleAccess("traceability", "view"), traceabilityController.getOperationSequence);
router.get("/traceability/process-flow", verifyToken, requireModuleAccess("process_flow", "view"), traceabilityController.getProcessFlow);
router.get("/traceability/parts", verifyToken, requireModuleAccess("traceability", "view"), traceabilityController.getPartCatalog);
router.get(
  "/traceability/machine-stats",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "view" },
    { moduleKey: "traceability", mode: "view" },
    { moduleKey: "io_monitor", mode: "view" },
  ]),
  traceabilityController.getMachineStationStats
);
router.get(
  "/traceability/plc-health",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "view" },
    { moduleKey: "io_monitor", mode: "view" },
  ]),
  traceabilityController.getPlcHealth
);
router.get(
  "/traceability/scanner-health",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "view" },
    { moduleKey: "scanner_monitor", mode: "view" },
  ]),
  traceabilityController.getScannerHealth
);
router.get(
  "/traceability/live-state",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "view" },
    { moduleKey: "traceability", mode: "view" },
  ]),
  traceabilityController.getLiveMachineState
);
router.get("/traceability/io-snapshot", verifyToken, requireModuleAccess("io_monitor", "view"), traceabilityController.getIoSnapshot);
router.get("/traceability/journey/:partId", verifyToken, requireModuleAccess("part_journey", "view"), traceabilityController.getPartJourney);
router.get("/traceability/:partId", verifyToken, requireModuleAccess("traceability", "view"), traceabilityController.getPartTraceability);
router.post(
  "/traceability/verify",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "operate" },
    { moduleKey: "traceability", mode: "operate" },
  ]),
  traceabilityController.verifyScanForOperator
);
router.post(
  "/traceability/map-customer-qr",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "operate" },
    { moduleKey: "traceability", mode: "operate" },
  ]),
  traceabilityController.mapCustomerQrCode
);
router.post(
  "/scan/process",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "operate" },
    { moduleKey: "traceability", mode: "operate" },
  ]),
  traceabilityController.processScan
);
router.post("/plc/operation/start", verifyToken, requireModuleAccess("io_monitor", "control"), traceabilityController.confirmOperationStart);
router.post("/plc/operation/end", verifyToken, requireModuleAccess("io_monitor", "control"), traceabilityController.confirmOperationEnd);
router.post("/traceability/rework", verifyToken, requireModuleAccess("part_journey", "operate"), traceabilityController.reworkPart);
router.post("/traceability/reset-interlock", verifyToken, requireModuleAccess("part_journey", "operate"), traceabilityController.resetInterlock);
router.post("/traceability/reset-operation", verifyToken, requireModuleAccess("part_journey", "operate"), traceabilityController.resetOperation);
router.post(
  "/traceability/reset-plc-only",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "operator_view", mode: "operate" },
    { moduleKey: "io_monitor", mode: "control" },
  ]),
  traceabilityController.resetPlcOnly
);
router.post("/traceability/reset-station", verifyToken, requireModuleAccess("part_journey", "operate"), traceabilityController.resetStationOperation);
router.post("/traceability/delete-part", verifyToken, requireModuleAccess("part_journey", "operate"), traceabilityController.deletePartTraceability);
router.post("/traceability/bypass", verifyToken, requireModuleAccess("io_monitor", "control"), traceabilityController.bypassOperation);
router.post("/traceability/test-plc-cycle", verifyToken, requireModuleAccess("io_monitor", "control"), traceabilityController.testPlcCycle);
router.post("/traceability/manual-result", verifyToken, requireModuleAccess("operator_view", "operate"), traceabilityController.submitManualResult);

module.exports = router;
