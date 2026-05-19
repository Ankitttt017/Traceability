const express = require("express");
const plcEndpointController = require("../../controllers/plcEndpointController");
const { verifyToken, isAdmin, isAdminOrEngineer } = require("../../middleware/authMiddleware");

const router = express.Router();

// List all endpoints
router.get("/endpoints", verifyToken, isAdminOrEngineer, plcEndpointController.listEndpoints);

// Get single endpoint with usage
router.get("/endpoints/:id", verifyToken, isAdminOrEngineer, plcEndpointController.getEndpoint);

// Create endpoint
router.post("/endpoints", verifyToken, isAdminOrEngineer, plcEndpointController.createEndpoint);

// Update endpoint (affects all using it)
router.put("/endpoints/:id", verifyToken, isAdminOrEngineer, plcEndpointController.updateEndpoint);

// Delete endpoint (only if not used)
router.delete("/endpoints/:id", verifyToken, isAdmin, plcEndpointController.deleteEndpoint);

// Test endpoint connectivity
router.post("/endpoints/:id/test", verifyToken, isAdminOrEngineer, plcEndpointController.testEndpoint);

module.exports = router;
