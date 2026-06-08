const express = require("express");
const plcConfigController = require("../../controllers/plcConfigController");
const plcEndpointRoutes = require("./plcEndpointRoutes");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/ranges", verifyToken, requireModuleAccess("plc_config", "view"), plcConfigController.listRanges);
router.get("/ranges/:id/registers", verifyToken, requireModuleAccess("plc_config", "view"), plcConfigController.getRangeRegisters);
router.get("/export", verifyToken, requireModuleAccess("plc_config", "view"), plcConfigController.exportRegisterPlanCsv);
router.post("/ranges", verifyToken, requireModuleAccess("plc_config", "edit"), plcConfigController.createRange);
router.put("/ranges/:id", verifyToken, requireModuleAccess("plc_config", "edit"), plcConfigController.updateRange);
router.delete("/ranges/:id", verifyToken, requireModuleAccess("plc_config", "edit"), plcConfigController.deleteRange);
router.use("/", plcEndpointRoutes);

module.exports = router;
