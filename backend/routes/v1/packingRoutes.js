const express = require("express");
const packingController = require("../../controllers/packingController");
const { verifyToken } = require("../../middleware/authMiddleware");

const router = express.Router();

router.get("/overview", verifyToken, packingController.getOverview);
router.get("/box/:boxNumber", verifyToken, packingController.getSessionByBox);
router.post("/start-box", verifyToken, packingController.startBox);
router.post("/scan", verifyToken, packingController.scanPartToBox);

module.exports = router;
