/**
 * IndusTrace Parser Engine
 * ─────────────────────────────────────────────────────────────────
 * Handles multi-protocol data parsing: JSON, CSV, XML, KeyValue, Text.
 */

const xml2js = require('xml2js'); // Need to ensure this is installed

const ParserTypes = {
  JSON: 'JSON',
  CSV: 'CSV',
  XML: 'XML',
  KEYVALUE: 'KEYVALUE',
  RAW: 'RAW'
};

/**
 * Parses raw data based on the specified type and options.
 * @param {string|Buffer|Object} data - Raw payload
 * @param {string} type - Parser type (JSON, CSV, etc.)
 * @param {Object} options - Parser-specific options (e.g., separator for CSV)
 * @returns {Promise<Object>} - Parsed JSON object
 */
async function parsePayload(data, type, options = {}) {
  if (!data) return null;

  try {
    switch (String(type).toUpperCase()) {
      case ParserTypes.JSON:
        return typeof data === 'object' ? data : JSON.parse(data.toString());

      case ParserTypes.CSV:
        return parseCsv(data.toString(), options);

      case ParserTypes.XML:
        return await parseXml(data.toString());

      case ParserTypes.KEYVALUE:
        return parseKeyValue(data.toString(), options);

      case ParserTypes.RAW:
      default:
        return { raw: data.toString() };
    }
  } catch (error) {
    console.error(`[ParserEngine] Failed to parse ${type}:`, error.message);
    throw new Error(`Parse failed: ${error.message}`);
  }
}

/**
 * Basic CSV parser
 */
function parseCsv(text, options = {}) {
  const separator = options.separator || ',';
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { raw: text };

  const headers = lines[0].split(separator).map(h => h.trim());
  const values = lines[1].split(separator).map(v => v.trim());

  const result = {};
  headers.forEach((h, i) => {
    result[h] = values[i];
  });
  return result;
}

/**
 * XML parser using xml2js
 */
async function parseXml(text) {
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
  return await parser.parseStringPromise(text);
}

/**
 * Key-Value parser (e.g., "key1=val1;key2=val2")
 */
function parseKeyValue(text, options = {}) {
  const pairSep = options.pairSeparator || ';';
  const kvSep = options.kvSeparator || '=';
  
  const result = {};
  text.split(pairSep).forEach(pair => {
    const [key, ...valParts] = pair.split(kvSep);
    if (key) {
      result[key.trim()] = valParts.join(kvSep).trim();
    }
  });
  return result;
}

module.exports = {
  parsePayload,
  ParserTypes
};
