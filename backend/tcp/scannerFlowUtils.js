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

// ---------------------------------------------------------------------------
// SCANNER-FIX (OP110 framing / validation)
// ---------------------------------------------------------------------------
// Frame terminators. Industrial scanners are configured with CR, LF, CRLF or
// NUL as the read suffix. Previously only LF/CRLF/NUL were treated as frame
// ends, so a scanner that ends every read with a bare CR was framed only by
// the idle flush timer and consecutive reads were glued together
// (e.g. "ERRORERRORERROR1007210822642"). CR is now a frame end as well.
const SCANNER_FRAME_TERMINATOR_REGEX = /\r\n|\r|\n|\0/;

// Default part-code formats (used when no env override is configured).
//  - DPM (dot-peen part id at OP110):          13 digits, e.g. 1009090124135
//  - Customer QR (laser label):  R437111511-54T00011026A0005 — NOTE the letter
//    before the 4-digit serial is A, B or C in real production data (9,100 A /
//    8,146 B / 6,859 C in the last 30 days), so the letter is [A-Z], not "B".
const DEFAULT_DPM_CODE_REGEX = /^\d{13}$/;
const DEFAULT_CUSTOMER_QR_REGEX = /^R\d{9}-\d{2}T\d{8}[A-Z]\d{4}$/;
// Words that scanners emit instead of a code (no-read / error output). They are
// rejected when they appear ANYWHERE in the payload, not only as the whole
// payload, because a glued frame such as "ERROR1002002227260" or
// "1003011627828ERROR" is still a bad read. ("NG" is not matched anywhere
// because it can legitimately occur inside generic codes at other stations;
// for the DPM / customer-QR scanners the strict role format rejects it.)
const SCANNER_STATUS_WORD_ANYWHERE_REGEX = /(ERROR|NO[\s_-]?READ|FAIL|TIMEOUT)/i;
// Runtime-configurable rules (loaded from QrFormatRules by tcpServer). Kept in
// module state so the pure validators below stay synchronous and testable.
let configuredFormatRules = { dpm: [], customer: [] };

function compileRegex(value) {
  if (!value) return null;
  if (value instanceof RegExp) return value;
  try {
    return new RegExp(String(value));
  } catch (_error) {
    return null;
  }
}

/**
 * Install plant-configured format rules (from the QrFormatRules table).
 * `rules` = [{ format_name, regex_pattern, is_active }]. A rule whose name
 * contains "DPM" is treated as a DPM rule, one containing "CUSTOMER" as a
 * customer-QR rule. Invalid regexes are ignored.
 */
function setScannerFormatRules(rules = []) {
  const next = { dpm: [], customer: [] };
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (rule?.is_active === false) continue;
    const name = String(rule?.format_name || "").toUpperCase();
    const regex = compileRegex(rule?.regex_pattern);
    if (!regex) continue;
    if (name.includes("DPM")) next.dpm.push(regex);
    else if (name.includes("CUSTOMER")) next.customer.push(regex);
  }
  configuredFormatRules = next;
  return next;
}

function getEnvRegex(name) {
  return compileRegex(String(process.env[name] || "").trim());
}

/**
 * DPM check = env override (SCANNER_DPM_CODE_REGEX) or the strict 13-digit
 * default, AND every active plant "DPM" rule (intersection: plant config can
 * only make it stricter, never accept a glued/fragment read).
 */
function isDpmCode(value) {
  const code = String(value || "").trim();
  if (!code) return false;
  const base = getEnvRegex("SCANNER_DPM_CODE_REGEX") || DEFAULT_DPM_CODE_REGEX;
  if (!base.test(code)) return false;
  return configuredFormatRules.dpm.every((regex) => regex.test(code));
}

/**
 * Customer QR check = env override (SCANNER_CUSTOMER_QR_REGEX) or the default,
 * OR any active plant "Customer" rule (union). A union is used because the
 * current plant rule `^R\d{9}-\d{2}T\d{8}B\d{4}$` only allows "B" and would
 * reject ~2/3 of the real labels (A / C series). Fix the rule in the QR format
 * screen to `[A-Z]` and this keeps working either way.
 */
function isCustomerQrCode(value) {
  const code = String(value || "").trim();
  if (!code) return false;
  const base = getEnvRegex("SCANNER_CUSTOMER_QR_REGEX") || DEFAULT_CUSTOMER_QR_REGEX;
  if (base.test(code)) return true;
  return configuredFormatRules.customer.some((regex) => regex.test(code));
}

function containsScannerStatusWord(value) {
  return SCANNER_STATUS_WORD_ANYWHERE_REGEX.test(String(value || ""));
}

/**
 * True when the payload looks like two or more codes glued together:
 * two customer-QR heads (R#########-##T), a digit run of >= 26 (two DPMs),
 * or two separate digit runs of >= 13.
 */
function looksLikeConcatenatedCodes(value) {
  const code = String(value || "");
  const customerHeads = code.match(/R\d{9}-\d{2}T/g) || [];
  if (customerHeads.length > 1) return true;
  const longDigitRuns = code.match(/\d{13,}/g) || [];
  if (longDigitRuns.some((run) => run.length >= 26)) return true;
  if (longDigitRuns.length > 1) return true;
  // A complete customer QR plus any extra DPM-length digit run.
  if (customerHeads.length === 1 && longDigitRuns.length >= 1) return true;
  return false;
}

function isRoleFormatValidationEnabled() {
  return String(process.env.SCANNER_ROLE_FORMAT_VALIDATION || "on").trim().toLowerCase() !== "off";
}

/**
 * Split a TCP receive buffer into complete frames. Returns the complete
 * frames and the unterminated remainder (still waiting for more bytes).
 */
function splitScannerFrames(buffer = "") {
  const parts = String(buffer || "").split(SCANNER_FRAME_TERMINATOR_REGEX);
  const rest = parts.pop() || "";
  return { frames: parts.filter((part) => part.length > 0), rest };
}

/**
 * Leftover bytes when a socket closes: only keep them when they are a complete
 * known code (DPM or customer QR). Anything else is a partial read ("?V047").
 */
function isCompleteKnownCode(value) {
  const code = String(value || "").replace(/[\x00-\x1F\x7F]/g, "").trim();
  return isDpmCode(code) || isCustomerQrCode(code);
}

function toHex(value, maxBytes = 256) {
  try {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""), "utf8");
    return buffer.subarray(0, maxBytes).toString("hex");
  } catch (_error) {
    return "";
  }
}

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

  // SCANNER-FIX: status words are rejected anywhere in the payload (glued
  // frames like "ERRORERROR1005143520268"), not only as an exact match.
  if (INVALID_SCANNER_STATUS_TOKENS.has(sanitizedPayload.toUpperCase()) || containsScannerStatusWord(sanitizedPayload)) {
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
  // SCANNER-FIX: also catch codes glued WITHOUT a separator (CR stripped).
  if (tokens.length > 1 || looksLikeConcatenatedCodes(sanitizedPayload)) {
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

  // SCANNER-FIX: role-specific format check with the REAL scanner role.
  //  - START_QR (DPM scanner) must read a DPM part id.
  //  - CUSTOMER_QR scanner may read a customer QR or a DPM part id (operators
  //    sometimes present the part to the wrong scanner; routing handles it and
  //    a DPM value is never stored as a customer QR).
  // Disable with SCANNER_ROLE_FORMAT_VALIDATION=off.
  const qrKind = isDpmCode(sanitizedPayload) ? "DPM" : (isCustomerQrCode(sanitizedPayload) ? "CUSTOMER" : null);
  if (isRoleFormatValidationEnabled()) {
    if (normalizedRole === "START_QR" && qrKind !== "DPM") {
      return {
        isValid: false,
        sanitizedPayload,
        reason: "QR_ROLE_FORMAT_MISMATCH",
        code: "QR009",
        severity: "RECOVERABLE",
        message: "Read is not a valid Part ID / DPM code.",
        stationNo: station,
        qrKind,
      };
    }
    if (normalizedRole === "CUSTOMER_QR" && !qrKind) {
      return {
        isValid: false,
        sanitizedPayload,
        reason: "QR_ROLE_FORMAT_MISMATCH",
        code: "QR009",
        severity: "RECOVERABLE",
        message: "Read is not a valid Customer QR or Part ID.",
        stationNo: station,
        qrKind,
      };
    }
  }

  return {
    isValid: true,
    sanitizedPayload,
    reason: null,
    code: null,
    severity: "NONE",
    message: "",
    stationNo: station,
    qrKind,
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
  // SCANNER-FIX additions
  splitScannerFrames,
  isCompleteKnownCode,
  isDpmCode,
  isCustomerQrCode,
  containsScannerStatusWord,
  looksLikeConcatenatedCodes,
  setScannerFormatRules,
  toHex,
  DEFAULT_DPM_CODE_REGEX,
  DEFAULT_CUSTOMER_QR_REGEX,
};
