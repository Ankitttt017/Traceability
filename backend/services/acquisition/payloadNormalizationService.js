/**
 * IndusTrace Payload Normalization Service
 * ─────────────────────────────────────────────────────────────────
 * Transforms protocol-specific payloads into a unified structure.
 * Supports dynamic field mapping for vision/quality systems.
 */

/**
 * Normalizes an incoming payload using machine-specific mapping rules.
 * @param {Object} rawData - The raw parsed data from any source
 * @param {Object} config - spcConfig for the machine
 * @returns {Object} - Unified payload structure
 */
function normalizePayload(rawData, config = {}) {
  const { mapping = {}, payloadResultKey = 'RESULT', payloadResultNgValues = [] } = config;
  
  // 1. Resolve Result (Requirement 2 & 6)
  const rawResult = findValue(rawData, payloadResultKey);
  const result = isNg(rawResult, payloadResultNgValues) ? 'NG' : 'OK';

  // 2. Resolve Parameters (Requirement 15: Dynamic Mapping)
  const parameters = {};
  if (mapping && typeof mapping === 'object') {
    Object.entries(mapping).forEach(([targetKey, sourcePath]) => {
      parameters[targetKey] = findValue(rawData, sourcePath);
    });
  } else {
    // Default: capture all top-level keys if no mapping defined
    Object.assign(parameters, rawData);
  }

  // 3. Resolve Part Identification
  const partId = findValue(rawData, 'partId') || findValue(rawData, 'QR') || findValue(rawData, 'SERIAL');

  // 4. Build Unified Structure (Requirement 10)
  return {
    source: config.mode || 'UNKNOWN',
    machineId: config.machineId || null,
    partId: partId || null,
    result: result,
    reason: result === 'NG' ? (findValue(rawData, 'reason') || findValue(rawData, 'error_id') || 'UNKNOWN') : null,
    timestamp: new Date().toISOString(),
    parameters: parameters,
    raw: rawData // Preserve raw for diagnostics/DLQ
  };
}

/**
 * Deep find value in object by path (e.g., "results.measurements[0].value")
 */
function findValue(obj, path) {
  if (!obj || !path) return null;
  if (obj[path] !== undefined) return obj[path]; // Fast path for top-level

  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return null;
    current = current[key];
  }
  return current;
}

/**
 * Case-insensitive NG check
 */
function isNg(value, ngValues) {
  if (!value) return false;
  const v = String(value).trim().toUpperCase();
  const list = (Array.isArray(ngValues) ? ngValues : String(ngValues).split(',')).map(x => String(x).trim().toUpperCase());
  return list.includes(v);
}

module.exports = {
  normalizePayload
};
