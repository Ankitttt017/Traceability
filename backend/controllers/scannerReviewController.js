const { getScannerReview } = require("../services/scannerReviewService");

/**
 * GET /api/v1/scanner-review  (SCANNER-FIX, read-only)
 * Query: type, page, pageSize (<= 500), days (<= 90, default 14),
 *        lostLinkWindowSec (default 120)
 */
async function listScannerReview(req, res) {
  try {
    const result = await getScannerReview({
      type: req.query.type,
      page: req.query.page,
      pageSize: req.query.pageSize,
      days: req.query.days,
      lostLinkWindowSec: req.query.lostLinkWindowSec,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[SCANNER_REVIEW] failed:", error?.message || error);
    res.status(500).json({ success: false, message: "Failed to build scanner review list." });
  }
}

module.exports = { listScannerReview };
