const express = require("express");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireAnyModuleAccess } = require("../../middleware/roleAccessMiddleware");
const { listScannerReview } = require("../../controllers/scannerReviewController");

// SCANNER-FIX: read-only review list of suspicious scanner mappings / logs.
const router = express.Router();

router.get(
  "/",
  verifyToken,
  requireAnyModuleAccess([
    { moduleKey: "scanners", mode: "view" },
    { moduleKey: "reports", mode: "view" },
  ]),
  listScannerReview
);

module.exports = router;
