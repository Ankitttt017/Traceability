const express = require("express");
const traceabilityController = require("../../controllers/traceabilityController");
const { verifyToken } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/traceability/operations", traceabilityController.getOperationSequence);
router.get("/traceability/journey/:partId", traceabilityController.getPartJourney);
router.get("/traceability/:partId", traceabilityController.getPartTraceability);
router.get("/traceability/live-state", traceabilityController.getLiveMachineState);
router.post("/traceability/verify", verifyToken, traceabilityController.verifyScanForOperator);
router.post("/scan/process", verifyToken, traceabilityController.processScan);
router.post("/plc/operation/start", verifyToken, traceabilityController.confirmOperationStart);
router.post("/plc/operation/end", verifyToken, traceabilityController.confirmOperationEnd);
router.post("/traceability/rework", verifyToken, traceabilityController.reworkPart);
router.post("/traceability/reset-interlock", verifyToken, traceabilityController.resetInterlock);
router.post("/traceability/bypass", verifyToken, traceabilityController.bypassOperation);

module.exports = router;
