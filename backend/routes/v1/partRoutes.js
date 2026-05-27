// Part Journey routes
const express = require("express");
const { getPartJourney } = require("../../controllers/partJourneyController");
const { verifyToken } = require("../../middleware/authMiddleware");

const router = express.Router();

// GET /api/parts/:partId/journey — Traceability timeline for a specific part
router.get("/:partId/journey", verifyToken, getPartJourney);

module.exports = router;
