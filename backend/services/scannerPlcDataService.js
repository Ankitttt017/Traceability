const { readModbusRegisters, readSlmpRegisters } = require("./plcIoService");

function toInt(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeMode(value) {
  const mode = toText(value, "TCP_CLIENT").toUpperCase();
  if (["TCP_CLIENT", "USB_SERIAL", "TCP_SERVER", "PLC_REGISTER"].includes(mode)) return mode;
  return "TCP_CLIENT";
}

function normalizeProtocol(value) {
  const protocol = toText(value, "MODBUS_TCP").toUpperCase();
  if (protocol === "SLMP") return "SLMP";
  return "MODBUS_TCP";
}

function normalizeDevice(value) {
  const device = toText(value, "D").toUpperCase();
  if (["D", "W", "R", "M", "ZR", "X", "Y", "L", "F", "V", "B"].includes(device)) return device;
  return "D";
}

function normalizeDataType(value) {
  const type = toText(value, "ASCII").toUpperCase();
  if (["ASCII", "ALPHANUM", "HEX", "INT16", "UINT16", "DEC", "BOOL", "BIT", "FLOAT32", "REAL32BIT"].includes(type)) return type;
  return "ASCII";
}

function toSigned16(value) {
  const v = Number(value || 0) & 0xffff;
  return v > 0x7fff ? v - 0x10000 : v;
}

function toFloat32FromWords(lowWord, highWord) {
  const low = Number(lowWord || 0) & 0xffff;
  const high = Number(highWord || 0) & 0xffff;
  const buf = Buffer.allocUnsafe(4);
  // Mitsubishi 16-bit words: low-word first, high-word second.
  buf.writeUInt16LE(low, 0);
  buf.writeUInt16LE(high, 2);
  return buf.readFloatLE(0);
}

function decodeRegisterWords(words, dataType) {
  if (!Array.isArray(words) || words.length === 0) return "";
  const mode = normalizeDataType(dataType);

  if (mode === "HEX") {
    return words.map((value) => Number(value || 0).toString(16).toUpperCase().padStart(4, "0")).join("");
  }

  if (mode === "INT16" || mode === "UINT16") {
    if (words.length === 1) {
      return mode === "INT16" ? String(toSigned16(words[0])) : String(Number(words[0] || 0));
    }
    return words.map((value) => String(mode === "INT16" ? toSigned16(value) : Number(value || 0))).join(",");
  }

  if (mode === "DEC") {
    return String(Number(words[0] || 0));
  }

  if (mode === "BOOL" || mode === "BIT") {
    return Number(words[0] || 0) > 0 ? "1" : "0";
  }

  if (mode === "FLOAT32" || mode === "REAL32BIT") {
    if (words.length < 2) return "";
    const f = toFloat32FromWords(words[0], words[1]);
    if (!Number.isFinite(f)) return "";
    return String(f);
  }

  // ASCII decode: each 16-bit register contains two ASCII bytes (low byte first, then high byte).
  let out = "";
  for (const raw of words) {
    const value = Number(raw || 0) & 0xffff;
    const low = value & 0xff;
    const high = (value >> 8) & 0xff;
    if (low >= 32 && low <= 126) out += String.fromCharCode(low);
    if (high >= 32 && high <= 126) out += String.fromCharCode(high);
  }
  if (mode === "ALPHANUM") {
    return out.replace(/[^A-Za-z0-9\-_.:/]/g, "");
  }
  return out;
}

function normalizeScannerConfig(source = {}) {
  const mode = normalizeMode(source.scanner_mode ?? source.scannerMode);
  const plcStartRegister = toInt(source.plc_start_register ?? source.plcStartRegister);
  const plcEndRegister = toInt(source.plc_end_register ?? source.plcEndRegister);

  return {
    mode,
    scannerIp: toText(source.scanner_ip ?? source.scannerIp),
    scannerPort: toInt(source.scanner_port ?? source.scannerPort),
    plcIp: toText(source.plc_ip ?? source.plcIp),
    plcPort: toInt(source.plc_port ?? source.plcPort, 502),
    plcProtocol: normalizeProtocol(source.plc_protocol ?? source.plcProtocol),
    plcUnitId: toInt(source.plc_unit_id ?? source.plcUnitId, 1) || 1,
    plcDevice: normalizeDevice(source.plc_device ?? source.plcDevice),
    plcFrameMode: toText(source.plc_frame_mode ?? source.plcFrameMode, "AUTO").toUpperCase(),
    plcStartRegister,
    plcEndRegister: plcEndRegister ?? plcStartRegister,
    plcDataType: normalizeDataType(source.plc_data_type ?? source.plcDataType),
    plcTimeoutMs: Math.max(500, toInt(source.plc_timeout_ms ?? source.plcTimeoutMs, 8000) || 8000),
    plcReadRetryCount: Math.max(1, toInt(source.plc_read_retry_count ?? source.plcReadRetryCount, 3) || 3),
    plcReadRetryDelayMs: Math.max(0, toInt(source.plc_read_retry_delay_ms ?? source.plcReadRetryDelayMs, 300) || 300),
    concatSeparator: toText(source.concat_separator ?? source.concatSeparator),
  };
}

function isRetryableReadError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("socket") ||
    message.includes("unreachable")
  );
}

async function readPartIdFromScannerPlc(configInput = {}) {
  const config = normalizeScannerConfig(configInput);
  if (config.mode !== "PLC_REGISTER") {
    throw new Error("Scanner mode is not PLC_REGISTER");
  }
  if (!config.plcIp || !config.plcPort) {
    throw new Error("PLC IP and port are required");
  }
  if (config.plcStartRegister === null || config.plcStartRegister < 0) {
    throw new Error("Valid PLC start register is required");
  }

  const start = config.plcStartRegister;
  const end = Math.max(start, Number(config.plcEndRegister ?? start));
  const count = Math.min(Math.max(1, end - start + 1), 64);
  const registers = Array.from({ length: count }, (_, index) => start + index);
  let values = {};
  let errors = [];

  const attempts = Math.max(1, Number(config.plcReadRetryCount || 1));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (config.plcProtocol === "SLMP") {
        const response = await readSlmpRegisters({
          ip: config.plcIp,
          port: config.plcPort,
          registers: registers.map((register) => ({ register, device: config.plcDevice })),
          timeoutMs: config.plcTimeoutMs,
          defaultDevice: config.plcDevice,
          frameMode: config.plcFrameMode || "AUTO",
        });
        values = response?.values || {};
        errors = Array.isArray(response?.errors) ? response.errors : [];
      } else {
        const response = await readModbusRegisters({
          ip: config.plcIp,
          port: config.plcPort,
          unitId: config.plcUnitId || 1,
          registers,
          timeoutMs: config.plcTimeoutMs,
        });
        values = response?.values || {};
        errors = Array.isArray(response?.errors) ? response.errors : [];
      }
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableReadError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, config.plcReadRetryDelayMs));
    }
  }

  if (lastError) {
    throw lastError;
  }

  const wordValues = registers
    .map((register) => (Object.prototype.hasOwnProperty.call(values, register) ? values[register] : null))
    .filter((value) => value !== null && value !== undefined);

  const concatenated = decodeRegisterWords(wordValues, config.plcDataType);
  const partId = config.concatSeparator
    ? concatenated.split(config.concatSeparator).join("")
    : concatenated;

  return {
    partId: String(partId || "").trim(),
    rawValues: values,
    errors,
    registerRange: {
      start,
      end: start + count - 1,
      count,
    },
    decode: {
      dataType: config.plcDataType,
      device: config.plcDevice,
      frameMode: config.plcFrameMode,
      protocol: config.plcProtocol,
      timeoutMs: config.plcTimeoutMs,
      retryCount: config.plcReadRetryCount,
    },
  };
}

module.exports = {
  normalizeScannerConfig,
  readPartIdFromScannerPlc,
};
