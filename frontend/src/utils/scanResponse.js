function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function normalizeDecision(raw = "") {
  const upper = String(raw || "").trim().toUpperCase();
  if (["PASS", "PASSED", "OK", "ALLOW", "VALID", "ACCEPT", "SUCCESS"].includes(upper)) return "PASS";
  if (["NG"].includes(upper)) return "NG";
  if (["DUPLICATE", "ALREADY_DONE", "ALREADY_COMPLETED"].includes(upper)) return "DUPLICATE";
  if (["WARNING", "PREVIOUS_STATION", "PREVIOUS_STATION_NOT_COMPLETED", "SEQUENCE_ERROR"].includes(upper)) return "WARNING";
  if (["BLOCK", "BLOCKED"].includes(upper)) return "BLOCK";
  if (["FAIL", "FAILED", "REJECT", "INVALID"].includes(upper)) return "FAIL";
  return "";
}

export function normalizeScanResponse(response) {
  const src = response?.data || response || {};
  const decisionRaw =
    src.qrDecision || src.qrResult || src.result || src.decision || src.status || src.previousStationStatus || "";
  const reasonRaw = src.reason || src.error || src.ngReason || src.message || "";
  const decision = normalizeDecision(decisionRaw) || normalizeDecision(reasonRaw) || (src.success === true ? "PASS" : "ERROR");
  const reasons = [
    ...toArray(src.validationErrors),
    ...toArray(src.stationResult),
    ...toArray(src.previousStationStatus),
    ...toArray(src.ngReason),
    ...toArray(src.reason),
    ...toArray(src.error),
  ];
  const message =
    String(src.message || src.error || src.reason || src.ngReason || reasons[0] || "").trim() ||
    (decision === "PASS" ? "Validation passed." : "Validation failed.");
  return {
    ok: decision === "PASS",
    decision,
    message,
    reasons,
    ngReasonRequired: ["NG", "FAIL"].includes(decision),
    statusLabel: decision,
    stationNo: src.stationNo || src.station_no || "",
    timestamp: src.timestamp || new Date().toISOString(),
    raw: src,
  };
}

