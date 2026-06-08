/**
 * reportFormatter.js
 * Centralized formatting logic for industrial reports.
 * Enforces DD-MMM-YYYY HH:mm:ss format and OK/NG/Validation logic.
 */

const moment = require("moment");

const VALIDATION_REJECT_REASONS = [
  "DUPLICATE_SCAN",
  "PREVIOUS_STATION_NOT_COMPLETED",
  "VALIDATION_BLOCK",
  "INTERLOCKED",
  "PLC_COMM_ERROR",
  "DUPLICATE",
  "PREVIOUS_STATION"
];

/**
 * Formats a date to industrial standard: 13-May-2026 17:40:55
 */
function formatIndustrialTimestamp(date) {
  if (!date) return "-";
  return moment(date).format("DD-MMM-YYYY HH:mm:ss");
}

/**
 * Logic to determine if a result is OK, NG, or a Validation Reject
 */
function resolveIndustrialResult(row) {
  const rawResult = String(row.result || "").toUpperCase();
  const plcStatus = String(row.plc_status || "").toUpperCase();
  const reason    = String(row.interlock_reason || "").toUpperCase();

  // NG shot events (warmup/off-shot etc.) are production NG outcomes.
  if (reason === "NG_SHOT_STATUS") {
    return { status: "NG", category: "PRODUCTION" };
  }

  // 1. Validation Rejects / Process Artifacts
  const isValidationReject = VALIDATION_REJECT_REASONS.some(r => 
    reason.includes(r) || plcStatus.includes(r) || rawResult.includes(r)
  );

  if (isValidationReject) {
    if (reason.includes("DUPLICATE")) return { status: "DUPLICATE", category: "VALIDATION" };
    if (reason.includes("PREVIOUS")) return { status: "PREVIOUS STATION PENDING", category: "VALIDATION" };
    return { status: "VALIDATION REJECT", category: "VALIDATION" };
  }

  // 2. Production OK
  if (rawResult === "OK" || rawResult === "PASSED" || plcStatus === "ENDED_OK" || plcStatus === "PASSED") {
    return { status: "OK", category: "PRODUCTION" };
  }

  // 3. Production NG (True failure)
  if (rawResult === "NG" || rawResult === "FAILED" || plcStatus === "ENDED_NG" || plcStatus === "FAILED") {
    return { status: "NG", category: "PRODUCTION" };
  }

  // 4. Default / In Progress
  return { status: "IN PROGRESS", category: "OTHER" };
}

module.exports = {
  formatIndustrialTimestamp,
  resolveIndustrialResult,
  VALIDATION_REJECT_REASONS
};
