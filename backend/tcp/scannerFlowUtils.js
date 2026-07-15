const DEFAULT_MAX_QR_PAYLOAD_LENGTH = 128;
const DEFAULT_MIN_QR_PAYLOAD_LENGTH = 4;
const DEFAULT_DUPLICATE_DEBOUNCE_MS = 600;
const VALID_QR_PAYLOAD_REGEX = /^[^\x00-\x1F\x7F]+$/u;
const QR_TOKEN_SEPARATOR_REGEX = /[\s;,|]+/;
const PART_QR_FORMAT_REGEX = /^[A-Za-z0-9\-_/.:]{1,128}$/;
const CUSTOMER_QR_PREFIX_REGEX = /^(CUS|CQR|CUST|CUSTOMER)/i;
const INVALID_SCANNER_STATUS_TOKENS = new Set([
  "ERROR",
  "ERR",
  "FAILED",
  "FAIL",
  "NG",
  "WAIT",
  "WAITING",
  "PENDING",
  "IN_PROGRESS",
  "RUNNING",
  "PLC_COMM_ERROR",
  "COMM_ERROR",
  "TIMEOUT",
  "NULL",
  "UNDEFINED",
]);

function sanitizeScannerPayload(value) {
  return collapseRepeatedScannerPayload(String(value || "").replace(/[\x00-\x1F\x7F]/g, "").trim());
}

function collapseRepeatedScannerPayload(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const customerQrSegments = raw.match(/R[^R]+/g);
  if (
    customerQrSegments &&
    customerQrSegments.length > 1 &&
    customerQrSegments.join("") === raw &&
    customerQrSegments.every((segment) => segment === customerQrSegments[0])
  ) {
    return customerQrSegments[0];
  }

  if (raw.length < 16) return raw;

  for (let size = Math.floor(raw.length / 2); size >= Math.max(DEFAULT_MIN_QR_PAYLOAD_LENGTH, 8); size -= 1) {
    if (raw.length % size !== 0) continue;
    const token = raw.slice(0, size);
    if (token && token.repeat(raw.length / size) === raw) {
      return token;
    }
  }

  return raw;
}

function sanitizeDisplayPayload(value) {
  const payload = sanitizeScannerPayload(value);
  return INVALID_SCANNER_STATUS_TOKENS.has(payload.toUpperCase()) ? "" : payload;
}

function normalizeStation(value) {
  return String(value || "").trim().toUpperCase();
}

function parseScannerPacket(rawPacket = "") {
  const packet = String(rawPacket || "");
  const rawPayload = packet.replace(/[\r\n\0]/g, "").trim();
  const sanitizedPayload = sanitizeScannerPayload(rawPayload);
  return {
    rawPacket: packet,
    rawPayload,
    sanitizedPayload,
  };
}

function buildScannerDisplayContext({ rawPacket = "", rawPayload = "", sanitizedPayload = "", partId = "", customerQrCode = "", mappedPartId = "" } = {}) {
  const scannedPayload = sanitizeDisplayPayload(rawPayload || sanitizedPayload || partId || customerQrCode || mappedPartId || rawPacket);
  const sanitizedCustomerQr = sanitizeDisplayPayload(customerQrCode);
  const sanitizedMappedPartId = sanitizeDisplayPayload(mappedPartId || partId);

  return {
    rawPacket: String(rawPacket || ""),
    rawPayload: sanitizeDisplayPayload(rawPayload || rawPacket),
    sanitizedPayload: scannedPayload,
    scannedQr: scannedPayload,
    customerQrCode: sanitizedCustomerQr,
    mappedPartId: sanitizedMappedPartId,
    displayQr: scannedPayload || sanitizedCustomerQr || sanitizedMappedPartId || "",
  };
}

function detectQrType({ rawPayload = "", scannerRole = "", stationNo = "" } = {}) {
  const normalizedRole = String(scannerRole || "").trim().toUpperCase();
  const payload = sanitizeScannerPayload(rawPayload);
  if (!payload) {
    return { qrType: "UNKNOWN", reason: "EMPTY_PAYLOAD" };
  }

  if (normalizedRole === "CUSTOMER_QR") {
    return { qrType: "CUSTOMER_QR", reason: "SCANNER_ROLE_CUSTOMER_QR" };
  }

  if (normalizedRole === "START_QR") {
    return { qrType: "START_QR", reason: "SCANNER_ROLE_START_QR" };
  }

  if (CUSTOMER_QR_PREFIX_REGEX.test(payload)) {
    return { qrType: "CUSTOMER_QR", reason: "PREFIX_CUSTOMER_QR" };
  }

  if (PART_QR_FORMAT_REGEX.test(payload)) {
    return { qrType: "INTERNAL_PART_QR", reason: "PATTERN_PART_QR" };
  }

  return { qrType: "UNKNOWN", reason: "UNDETERMINED" };
}

function validateScannerPayload({ payload, scannerRole = "", stationNo = "", productCategory = "" } = {}) {
  const rawPayload = String(payload || "");
  const trimmedPayload = rawPayload.replace(/[\r\n\0]/g, "").trim();
  const sanitizedPayload = sanitizeScannerPayload(trimmedPayload);
  const normalizedRole = String(scannerRole || "").trim().toUpperCase();
  const station = normalizeStation(stationNo);
  const maxLength = Number(process.env.TCP_QR_MAX_PAYLOAD_LENGTH || DEFAULT_MAX_QR_PAYLOAD_LENGTH);
  const minLength = Math.max(Number(process.env.TCP_QR_MIN_PAYLOAD_LENGTH || DEFAULT_MIN_QR_PAYLOAD_LENGTH), 1);
  const minCustomerQrLength = Number(process.env.TCP_CUSTOMER_QR_MIN_LENGTH || 2);

  if (!sanitizedPayload) {
    return {
      isValid: false,
      sanitizedPayload: "",
      reason: "QR_PAYLOAD_EMPTY",
      code: "QR001",
      severity: "RECOVERABLE",
      message: normalizedRole === "CUSTOMER_QR"
        ? "Customer QR scanner did not receive a readable code. Scan again."
        : "Start QR scanner did not receive a readable code. Scan again.",
      stationNo: station,
    };
  }

  if (sanitizedPayload.length > maxLength) {
    return {
      isValid: false,
      sanitizedPayload,
      reason: "QR_PAYLOAD_TOO_LONG",
      code: "QR002",
      severity: "RECOVERABLE",
      message: `QR payload exceeds maximum length of ${maxLength}. Scan again with a single QR.`,
      stationNo: station,
    };
  }

  if (!VALID_QR_PAYLOAD_REGEX.test(sanitizedPayload)) {
    return {
      isValid: false,
      sanitizedPayload,
      reason: "QR_PAYLOAD_INVALID_CHARS",
      code: "QR003",
      severity: "RECOVERABLE",
      message: "QR payload contains invalid characters. Scan a valid QR code."
        + (normalizedRole === "CUSTOMER_QR" ? " Customer QR should contain only printable characters." : " Start QR should contain only printable characters."),
      stationNo: station,
    };
  }

  if (sanitizedPayload.length < minLength) {
    return {
      isValid: false,
      sanitizedPayload,
      reason: "QR_PAYLOAD_TOO_SHORT",
      code: "QR008",
      severity: "RECOVERABLE",
      message: `Scanner payload is too short. Scan a complete QR code with at least ${minLength} characters.`,
      stationNo: station,
    };
  }

  if (INVALID_SCANNER_STATUS_TOKENS.has(sanitizedPayload.toUpperCase())) {
    return {
      isValid: false,
      sanitizedPayload,
      reason: "QR_PAYLOAD_STATUS_TOKEN",
      code: "QR007",
      severity: "RECOVERABLE",
      message: normalizedRole === "CUSTOMER_QR"
        ? "Customer QR scanner returned a status word, not a QR code. Scan the actual Customer QR again."
        : "Scanner returned a status word, not a QR code. Scan the actual Part QR again.",
      stationNo: station,
    };
  }

  const tokens = sanitizedPayload.split(QR_TOKEN_SEPARATOR_REGEX).filter(Boolean);
  if (tokens.length > 1) {
    return {
      isValid: false,
      sanitizedPayload,
      reason: "QR_MULTIPLE_VALUES",
      code: "QR004",
      severity: "RECOVERABLE",
      message: "Multiple QR values detected in the scan. Scan a single QR code."
        + (normalizedRole === "CUSTOMER_QR" ? " Customer QR must be scanned alone." : ""),
      stationNo: station,
    };
  }

  if (normalizedRole === "CUSTOMER_QR" && sanitizedPayload.length < minCustomerQrLength) {
    return {
      isValid: false,
      sanitizedPayload,
      reason: "CUSTOMER_QR_TOO_SHORT",
      code: "QR005",
      severity: "RECOVERABLE",
      message: `Customer QR is too short. Scan a valid Customer QR with at least ${minCustomerQrLength} characters.`,
      stationNo: station,
    };
  }

  if (normalizedRole === "START_QR" && !PART_QR_FORMAT_REGEX.test(sanitizedPayload)) {
    return {
      isValid: false,
      sanitizedPayload,
      reason: "QR_UNKNOWN_FORMAT",
      code: "QR006",
      severity: "RECOVERABLE",
      message: "Start QR format is not recognized. Scan a valid part serial or casting QR.",
      stationNo: station,
    };
  }

  return {
    isValid: true,
    sanitizedPayload,
    reason: null,
    code: null,
    severity: "NONE",
    message: "",
    stationNo: station,
  };
}

module.exports = {
  sanitizeScannerPayload,
  collapseRepeatedScannerPayload,
  normalizeStation,
  buildScannerDisplayContext,
  validateScannerPayload,
  parseScannerPacket,
  detectQrType,
};
