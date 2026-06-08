const express = require("express");
const { getPartJourney } = require("../../controllers/partJourneyController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/:partId/journey", verifyToken, requireModuleAccess("part_journey", "view"), getPartJourney);

module.exports = router;
