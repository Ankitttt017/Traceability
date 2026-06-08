const express = require("express");
const plcEndpointController = require("../../controllers/plcEndpointController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/endpoints", verifyToken, requireModuleAccess("plc_config", "view"), plcEndpointController.listEndpoints);
router.get("/endpoints/:id", verifyToken, requireModuleAccess("plc_config", "view"), plcEndpointController.getEndpoint);
router.post("/endpoints", verifyToken, requireModuleAccess("plc_config", "edit"), plcEndpointController.createEndpoint);
router.put("/endpoints/:id", verifyToken, requireModuleAccess("plc_config", "edit"), plcEndpointController.updateEndpoint);
router.delete("/endpoints/:id", verifyToken, requireModuleAccess("plc_config", "edit"), plcEndpointController.deleteEndpoint);
router.post("/endpoints/:id/test", verifyToken, requireModuleAccess("plc_config", "edit"), plcEndpointController.testEndpoint);

module.exports = router;
