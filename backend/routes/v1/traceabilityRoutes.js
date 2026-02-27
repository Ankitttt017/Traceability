const express = require("express");
const traceabilityController = require("../../controllers/traceabilityController");
const { verifyToken } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/traceability/operations", traceabilityController.getOperationSequence);
router.get("/traceability/parts", traceabilityController.getPartCatalog);
router.get("/traceability/machine-stats", traceabilityController.getMachineStationStats);
router.get("/traceability/plc-health", traceabilityController.getPlcHealth);
router.get("/traceability/scanner-health", traceabilityController.getScannerHealth);
router.get("/traceability/live-state", traceabilityController.getLiveMachineState);
router.get("/traceability/io-snapshot", verifyToken, traceabilityController.getIoSnapshot);
router.get("/traceability/journey/:partId", traceabilityController.getPartJourney);
router.get("/traceability/:partId", traceabilityController.getPartTraceability);
router.post("/traceability/verify", verifyToken, traceabilityController.verifyScanForOperator);
router.post("/scan/process", verifyToken, traceabilityController.processScan);
router.post("/plc/operation/start", verifyToken, traceabilityController.confirmOperationStart);
router.post("/plc/operation/end", verifyToken, traceabilityController.confirmOperationEnd);
router.post("/traceability/rework", verifyToken, traceabilityController.reworkPart);
router.post("/traceability/reset-interlock", verifyToken, traceabilityController.resetInterlock);
router.post("/traceability/reset-operation", verifyToken, traceabilityController.resetOperation);
router.post("/traceability/reset-station", verifyToken, traceabilityController.resetStationOperation);
router.post("/traceability/bypass", verifyToken, traceabilityController.bypassOperation);

module.exports = router;
