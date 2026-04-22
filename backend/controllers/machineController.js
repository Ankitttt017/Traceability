const { Sequelize, Op } = require("sequelize");
const Machine = require("../models/Machine");
const PlcRegisterRange = require("../models/PlcRegisterRange");
const plcService = require("../services/plcCommunicationService");
const { getMachineBypass } = require("../services/machineBypassService");

const { writeModbusRegister, writeSlmpRegister, probeTcpEndpoint } = require("../services/plcIoService");
const { clearMachineLock } = require("../services/machineLockService");

const REGISTER_COLUMN_META = [
  { column: "plc_start_register", label: "startRegister" },
  { column: "plc_status_register", label: "statusRegister" },
  { column: "plc_part_register", label: "partRegister" },
  { column: "plc_station_register", label: "stationRegister" },
  { column: "plc_reset_register", label: "resetRegister" },
  { column: "plc_heartbeat_register", label: "heartbeatRegister" },
];
const PLC_SIGNAL_DIRECTION_VALUES = new Set(["PC -> PLC", "PLC -> PC", "BIDIRECTIONAL"]);
const HANDSHAKE_DIRECTION_VALUES = new Set(["WRITE", "READ", "BOTH"]);

function toInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toUpperCase();
  if (["1", "TRUE", "YES", "ON", "ENABLE", "ENABLED"].includes(normalized)) return true;
  if (["0", "FALSE", "NO", "OFF", "DISABLE", "DISABLED"].includes(normalized)) return false;
  return fallback;
}

function normalizeSpcConfig(rawValue = {}) {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const mode = normalizeUpper(source.mode || source.resultMode || "IP_PUSH");
  const payloadResultKey = normalizeText(source.payloadResultKey || source.resultKey || "RESULT");
  const payloadResultNgValues = Array.isArray(source.payloadResultNgValues)
    ? source.payloadResultNgValues
    : String(source.payloadResultNgValues || source.resultNgValues || "")
        .split(/[,\n;|]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
  const qualityPayloadKeys = Array.isArray(source.qualityPayloadKeys)
    ? source.qualityPayloadKeys
    : String(source.qualityPayloadKeys || "")
        .split(/[,\n;|]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
  const plcResultOkValues = Array.isArray(source.plcResultOkValues)
    ? source.plcResultOkValues
    : String(source.plcResultOkValues || "1,3,OK,PASS")
        .split(/[,\n;|]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
  const plcResultNgValues = Array.isArray(source.plcResultNgValues)
    ? source.plcResultNgValues
    : String(source.plcResultNgValues || "0,2,NG,FAIL")
        .split(/[,\n;|]/)
        .map((entry) => entry.trim())
        .filter(Boolean);

  return {
    enabled: toBoolean(source.enabled ?? source.isSpcStation ?? source.isQualityCheckStation, false),
    mode: ["IP_PUSH", "PLC_REGISTER"].includes(mode) ? mode : "IP_PUSH",
    appliesTo: "ALL",
    sourceIp: normalizeText(source.sourceIp || source.systemIp || source.ip) || null,
    sourcePort: toInt(source.sourcePort || source.systemPort || source.port),
    payloadResultKey: payloadResultKey || "RESULT",
    payloadResultNgValues: [...new Set(payloadResultNgValues.map((entry) => normalizeUpper(entry)).filter(Boolean))].slice(
      0,
      20
    ),
    qualityPayloadKeys: [...new Set(qualityPayloadKeys.map((entry) => String(entry).trim()).filter(Boolean))].slice(0, 40),
    plcResultRegister: toInt(source.plcResultRegister ?? source.resultRegister ?? source.register),
    plcResultDevice: normalizeUpper(source.plcResultDevice || source.resultDevice || "D") || "D",
    plcResultOkValues: [...new Set(plcResultOkValues.map((entry) => normalizeUpper(entry)).filter(Boolean))].slice(0, 20),
    plcResultNgValues: [...new Set(plcResultNgValues.map((entry) => normalizeUpper(entry)).filter(Boolean))].slice(0, 20),
    plcAckEnabled: toBoolean(source.plcAckEnabled, false),
    plcAckRegister: toInt(source.plcAckRegister ?? source.ackRegister),
    plcAckDevice: normalizeUpper(source.plcAckDevice || source.ackDevice || "D") || "D",
    plcAckOkValue: toInt(source.plcAckOkValue ?? source.ackOkValue) ?? 101,
    plcAckNgValue: toInt(source.plcAckNgValue ?? source.ackNgValue) ?? 102,
    plcAckErrorValue: toInt(source.plcAckErrorValue ?? source.ackErrorValue) ?? 199,
  };
}

function normalizeSlmpFrameMode(value, fallback = null) {
  const mode = normalizeUpper(value);
  if (["ASCII", "BINARY", "AUTO"].includes(mode)) {
    return mode;
  }
  return fallback;
}

function parsePlcRegistersSnapshot(rawPlcRegisters) {
  if (!rawPlcRegisters) return null;
  try {
    const parsed = typeof rawPlcRegisters === "string" ? JSON.parse(rawPlcRegisters) : rawPlcRegisters;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function extractSlmpFrameMode(rawPlcRegisters) {
  const parsed = parsePlcRegistersSnapshot(rawPlcRegisters);
  if (!parsed) return null;
  return normalizeSlmpFrameMode(parsed.slmpFrameMode ?? parsed.slmpFrame ?? parsed.frameMode, null);
}

function resolveSlmpFrameModeInput(body = {}, machinePayload = {}, existingMachine = null) {
  const fromBody = normalizeSlmpFrameMode(
    body.plcSlmpFrameMode ??
      body.plc_slmp_frame_mode ??
      body.plcSlmpFrame ??
      body.plc_slmp_frame ??
      body.slmpFrameMode ??
      body.slmp_frame_mode,
    null
  );
  if (fromBody) return fromBody;

  const plcConfig = body.plcConfig && typeof body.plcConfig === "object" ? body.plcConfig : {};
  const fromConfig = normalizeSlmpFrameMode(
    plcConfig.slmpFrameMode ?? plcConfig.slmpFrame ?? plcConfig.frameMode,
    null
  );
  if (fromConfig) return fromConfig;

  const fromPayload = extractSlmpFrameMode(machinePayload.plc_registers);
  if (fromPayload) return fromPayload;

  const fromExisting = extractSlmpFrameMode(existingMachine?.plc_registers);
  if (fromExisting) return fromExisting;

  return normalizeSlmpFrameMode(process.env.PLC_SLMP_FRAME_MODE, "AUTO");
}

function toProtocol(value) {
  const protocol = normalizeUpper(value);
  if (protocol === "MODBUS_TCP") {
    return "MODBUS_TCP";
  }
  if (protocol === "SLMP") {
    return "SLMP";
  }
  return "TCP_TEXT";
}

function toStatus(value) {
  return normalizeUpper(value) === "INACTIVE" ? "INACTIVE" : "ACTIVE";
}

function withPlcConnectivityHint(message, { ip, port, protocol } = {}) {
  const base = String(message || "").trim() || "PLC communication failed";
  const normalized = base.toUpperCase();
  const looksLikeNetworkIssue =
    normalized.includes("CONNECT TIMEOUT") ||
    normalized.includes("ECONNREFUSED") ||
    normalized.includes("EHOSTUNREACH") ||
    normalized.includes("ENETUNREACH") ||
    normalized.includes("ETIMEDOUT") ||
    normalized.includes("UNABLE TO CONNECT");

  if (!looksLikeNetworkIssue || normalized.includes("PING MAY STILL WORK")) {
    return base;
  }

  const protocolLabel = String(protocol || "TCP_TEXT").toUpperCase();
  const endpoint =
    ip && port ? `${ip}:${port}` : ip ? String(ip) : port ? `port ${port}` : "configured PLC endpoint";
  return `${base}. Ping may still work while TCP port is blocked/unreachable. Verify ${protocolLabel} service on ${endpoint} and firewall/ACL rules.`;
}

function toRegistersFromObject(rawObject = {}) {
  return {
    range: toInt(rawObject.range ?? rawObject.rangeId ?? rawObject.plcRangeId ?? rawObject.plc_range_id),
    start: toInt(rawObject.start ?? rawObject.startRegister ?? rawObject.plcStartRegister ?? rawObject.plc_start_register),
    status: toInt(rawObject.status ?? rawObject.statusRegister ?? rawObject.plcStatusRegister ?? rawObject.plc_status_register),
    part: toInt(rawObject.part ?? rawObject.partRegister ?? rawObject.plcPartRegister ?? rawObject.plc_part_register),
    station: toInt(rawObject.station ?? rawObject.stationRegister ?? rawObject.plcStationRegister ?? rawObject.plc_station_register),
    reset: toInt(rawObject.reset ?? rawObject.resetRegister ?? rawObject.plcResetRegister ?? rawObject.plc_reset_register),
  };
}

function parsePlcRegisters(value) {
  if (value === undefined || value === null) {
    return { raw: null, parsed: {} };
  }

  if (typeof value === "object") {
    const serialized = JSON.stringify(value);
    return {
      raw: serialized === "{}" ? null : serialized,
      parsed: toRegistersFromObject(value),
    };
  }

  const raw = normalizeText(value);
  if (!raw) {
    return { raw: null, parsed: {} };
  }

  try {
    const parsedJson = JSON.parse(raw);
    if (parsedJson && typeof parsedJson === "object") {
      return {
        raw,
        parsed: toRegistersFromObject(parsedJson),
      };
    }
  } catch (_error) {
    // Non-JSON input is treated as CSV/space separated numeric register list.
  }

  const tokens = raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const numeric = tokens.map((entry) => toInt(entry));

  return {
    raw,
    parsed: {
      start: numeric[0] ?? null,
      status: numeric[1] ?? null,
      part: numeric[2] ?? null,
      station: numeric[3] ?? null,
      reset: numeric[4] ?? null,
    },
  };
}

function normalizeSignalDirection(value, fallback = "PLC -> PC") {
  const normalized = String(value || "").trim().toUpperCase();
  if (["PC_TO_PLC", "PC->PLC", "PC -> PLC", "WRITE"].includes(normalized)) {
    return "PC -> PLC";
  }
  if (["PLC_TO_PC", "PLC->PC", "PLC -> PC", "READ"].includes(normalized)) {
    return "PLC -> PC";
  }
  if (["BIDIRECTIONAL", "BI", "BOTH"].includes(normalized)) {
    return "BIDIRECTIONAL";
  }
  return PLC_SIGNAL_DIRECTION_VALUES.has(fallback) ? fallback : "PLC -> PC";
}

function normalizeHandshakeDirection(value, fallback = "READ") {
  const normalized = String(value || "").trim().toUpperCase();
  if (["WRITE", "PC -> PLC", "PC_TO_PLC", "PC->PLC"].includes(normalized)) {
    return "WRITE";
  }
  if (["READ", "PLC -> PC", "PLC_TO_PC", "PLC->PC"].includes(normalized)) {
    return "READ";
  }
  if (["BOTH", "BIDIRECTIONAL", "PLC<->PC", "PLC <-> PC"].includes(normalized)) {
    return "BOTH";
  }
  return HANDSHAKE_DIRECTION_VALUES.has(fallback) ? fallback : "READ";
}

function normalizePlcHandshakeMap(rawMap, fallback = null) {
  if (rawMap === undefined) {
    return Array.isArray(fallback) ? fallback : null;
  }
  if (rawMap === null || rawMap === "") {
    return null;
  }

  let source = rawMap;
  if (typeof rawMap === "string") {
    const text = rawMap.trim();
    if (!text) return null;
    try {
      source = JSON.parse(text);
    } catch (_error) {
      throw new Error("plcHandshakeMap must be a valid JSON array");
    }
  }
  if (!Array.isArray(source)) {
    throw new Error("plcHandshakeMap must be an array");
  }

  const normalized = [];
  for (const row of source) {
    const signal = normalizeText(row?.signal || row?.label || row?.name);
    if (!signal) continue;
    normalized.push({
      id: normalizeText(row?.id || row?.key) || null,
      signal,
      direction: normalizeHandshakeDirection(row?.direction, "READ"),
      register: toInt(row?.register ?? row?.registerNo ?? row?.address),
      value: toInt(row?.value),
      meaning: normalizeText(row?.meaning || row?.purpose || row?.description) || null,
      required: row?.required === undefined ? true : Boolean(row.required),
    });
  }
  return normalized.length > 0 ? normalized : null;
}

const STANDARD_HANDSHAKE_SIGNAL_META = {
  START: {
    signal: "Start",
    direction: "WRITE",
    registerKey: "startRegister",
    valueKey: "startValue",
    defaultMeaning: "Start machine cycle",
  },
  BLOCK_INTERLOCK: {
    signal: "Block / Interlock",
    direction: "WRITE",
    registerKey: "blockRegister",
    valueKey: "blockValue",
    defaultMeaning: "Block cycle on NG / duplicate / interlock",
  },
  RUNNING: {
    signal: "Running",
    direction: "READ",
    registerKey: "runningRegister",
    valueKey: "startedValue",
    defaultMeaning: "Machine is running",
  },
  END_OK: {
    signal: "End OK",
    direction: "READ",
    registerKey: "endOkRegister",
    valueKey: "endOkValue",
    defaultMeaning: "Cycle completed OK",
  },
  END_NG: {
    signal: "End NG",
    direction: "READ",
    registerKey: "endNgRegister",
    valueKey: "endNgValue",
    defaultMeaning: "Cycle completed NG",
  },
  RESET: {
    signal: "Reset",
    direction: "WRITE",
    registerKey: "resetRegister",
    valueKey: "resetValue",
    defaultMeaning: "Reset/clear machine state",
  },
  CONFIRMATION: {
    signal: "Confirmation",
    direction: "BOTH",
    registerKey: "heartbeatRegister",
    valueKey: null,
    defaultValue: 1,
    defaultMeaning: "Confirmation",
  },
};

function normalizeSignalKeyForStandardHandshake(signal) {
  const text = normalizeUpper(signal).replace(/[^A-Z0-9]+/g, "_");
  if (text === "START") return "START";
  if (["BLOCK", "BLOCK_INTERLOCK", "INTERLOCK", "BLOCK_INTERLOCK_SIGNAL"].includes(text)) return "BLOCK_INTERLOCK";
  if (["RUNNING", "STARTED"].includes(text)) return "RUNNING";
  if (["END_OK", "OK_END", "ENDED_OK"].includes(text)) return "END_OK";
  if (["END_NG", "NG_END", "ENDED_NG"].includes(text)) return "END_NG";
  if (text === "RESET") return "RESET";
  if (["CONFIRMATION", "CONFIRM", "ACK", "ACKNOWLEDGE", "ACKNOWLEDGEMENT"].includes(text)) return "CONFIRMATION";
  return null;
}

function syncStandardHandshakeMapWithCore(handshakeMap, core = {}) {
  const rows = Array.isArray(handshakeMap) ? [...handshakeMap] : [];
  const indexByStandardKey = new Map();

  for (let i = 0; i < rows.length; i += 1) {
    const standardKey = normalizeSignalKeyForStandardHandshake(rows[i]?.signal);
    if (standardKey && !indexByStandardKey.has(standardKey)) {
      indexByStandardKey.set(standardKey, i);
    }
  }

  for (const [standardKey, meta] of Object.entries(STANDARD_HANDSHAKE_SIGNAL_META)) {
    const defaultValue = meta.valueKey ? toInt(core?.[meta.valueKey]) : toInt(meta.defaultValue);
    const registerNo =
      meta.registerKey === "runningRegister"
        ? toInt(core?.runningRegister ?? core?.statusRegister)
        : toInt(core?.[meta.registerKey]);
    const nextRow = {
      id: null,
      signal: meta.signal,
      direction: meta.direction,
      register: registerNo,
      value: defaultValue,
      meaning: meta.defaultMeaning,
      required: true,
    };
    if (indexByStandardKey.has(standardKey)) {
      const idx = indexByStandardKey.get(standardKey);
      const current = rows[idx] || {};
      rows[idx] = {
        ...current,
        signal: meta.signal,
        direction: meta.direction,
        register: nextRow.register,
        value: meta.valueKey ? nextRow.value : toInt(current.value) ?? nextRow.value,
        meaning: normalizeText(current.meaning) || meta.defaultMeaning,
        required: current.required === undefined ? true : Boolean(current.required),
      };
    } else {
      rows.push(nextRow);
    }
  }

  return rows;
}

function deriveCoreFromHandshakeMap(handshakeMap, core = {}) {
  const next = {
    startRegister: toInt(core.startRegister),
    blockRegister: toInt(core.blockRegister),
    runningRegister: toInt(core.runningRegister),
    statusRegister: toInt(core.statusRegister ?? core.runningRegister),
    endOkRegister: toInt(core.endOkRegister),
    endNgRegister: toInt(core.endNgRegister),
    resetRegister: toInt(core.resetRegister),
    heartbeatRegister: toInt(core.heartbeatRegister),
    startValue: toInt(core.startValue),
    blockValue: toInt(core.blockValue),
    startedValue: toInt(core.startedValue),
    endOkValue: toInt(core.endOkValue),
    endNgValue: toInt(core.endNgValue),
    resetValue: toInt(core.resetValue),
  };

  const rows = Array.isArray(handshakeMap) ? handshakeMap : [];
  for (const row of rows) {
    const key = normalizeSignalKeyForStandardHandshake(row?.signal);
    if (!key) continue;
    const registerNo = toInt(row?.register);
    const valueNo = toInt(row?.value);
    if (key === "START") {
      if (registerNo !== null) next.startRegister = registerNo;
      if (valueNo !== null) next.startValue = valueNo;
      continue;
    }
    if (key === "BLOCK_INTERLOCK") {
      if (registerNo !== null) next.blockRegister = registerNo;
      if (valueNo !== null) next.blockValue = valueNo;
      continue;
    }
    if (key === "RUNNING") {
      if (registerNo !== null) {
        next.runningRegister = registerNo;
        next.statusRegister = registerNo;
      }
      if (valueNo !== null) next.startedValue = valueNo;
      continue;
    }
    if (key === "END_OK") {
      if (registerNo !== null) next.endOkRegister = registerNo;
      if (valueNo !== null) next.endOkValue = valueNo;
      continue;
    }
    if (key === "END_NG") {
      if (registerNo !== null) next.endNgRegister = registerNo;
      if (valueNo !== null) next.endNgValue = valueNo;
      continue;
    }
    if (key === "RESET") {
      if (registerNo !== null) next.resetRegister = registerNo;
      if (valueNo !== null) next.resetValue = valueNo;
      continue;
    }
    if (key === "CONFIRMATION") {
      if (registerNo !== null) next.heartbeatRegister = registerNo;
    }
  }

  return next;
}

function normalizePlcSignalMap(rawMap, fallbackRaw = null) {
  if (rawMap === undefined) {
    return fallbackRaw || null;
  }

  if (rawMap === null || rawMap === "") {
    return null;
  }

  let source = rawMap;
  if (typeof rawMap === "string") {
    const text = rawMap.trim();
    if (!text) {
      return null;
    }
    try {
      source = JSON.parse(text);
    } catch (_error) {
      throw new Error("plcSignalMap must be a valid JSON object/array");
    }
  }

  let entries = [];
  if (Array.isArray(source)) {
    entries = source;
  } else if (source && typeof source === "object") {
    entries = Object.entries(source).map(([key, value]) => ({
      key,
      ...(value && typeof value === "object" ? value : {}),
    }));
  } else {
    throw new Error("plcSignalMap must be an object or array");
  }

  const normalized = [];
  const usedKeys = new Set();
  for (const entry of entries) {
    const key = normalizeUpper(entry.key || entry.signal || entry.name);
    if (!key || usedKeys.has(key)) {
      continue;
    }
    usedKeys.add(key);
    const label = normalizeText(entry.label || key) || key;
    const register = toInt(entry.register ?? entry.registerNo ?? entry.address);
    const direction = normalizeSignalDirection(
      entry.direction,
      ["TRIGGER", "RESET"].includes(key) ? "PC -> PLC" : "PLC -> PC"
    );
    const description = normalizeText(entry.description || "");
    const device = normalizeText(entry.device ?? entry.deviceCode ?? entry.deviceType ?? entry.slmpDevice ?? "");
    const writable =
      entry.writable === undefined ? direction === "PC -> PLC" || direction === "BIDIRECTIONAL" : Boolean(entry.writable);

    normalized.push({
      key,
      label,
      register,
      direction,
      writable,
      description: description || null,
      device: device ? device.toUpperCase() : null,
    });
  }

  if (normalized.length === 0) {
    return null;
  }
  return JSON.stringify(normalized);
}

function parsePlcSignalMap(rawValue) {
  if (!rawValue) {
    return null;
  }

  let parsed = rawValue;
  if (typeof rawValue === "string") {
    try {
      parsed = JSON.parse(rawValue);
    } catch (_error) {
      return null;
    }
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  return parsed
    .map((entry) => ({
      key: normalizeUpper(entry?.key || entry?.signal || entry?.name),
      label: normalizeText(entry?.label || entry?.key || entry?.signal || entry?.name),
        register: toInt(entry?.register ?? entry?.registerNo ?? entry?.address),
        direction: normalizeSignalDirection(entry?.direction),
        writable: Boolean(entry?.writable),
        description: normalizeText(entry?.description || "") || null,
        device: normalizeText(entry?.device || entry?.deviceCode || entry?.deviceType || entry?.slmpDevice || "")
          ? normalizeText(entry?.device || entry?.deviceCode || entry?.deviceType || entry?.slmpDevice || "").toUpperCase()
          : null,
      }))
    .filter((entry) => entry.key);
}

function getPlcConfigInput(body = {}) {
  const raw = body.plcConfig;
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return raw;
}

function serializePlcConfigSnapshot(config = {}) {
  const slmpFrameMode = normalizeSlmpFrameMode(config.slmpFrameMode ?? config.slmpFrame ?? config.frameMode, null);
  const handshakeMap = normalizePlcHandshakeMap(config.handshakeMap, null);
  const spcConfig = normalizeSpcConfig(config.spcConfig || {});
  const snapshot = {
    rangeId: toInt(config.rangeId),
    unitId: toInt(config.unitId),
    startRegister: toInt(config.startRegister),
    statusRegister: toInt(config.statusRegister ?? config.runningRegister),
    blockRegister: toInt(config.blockRegister),
    runningRegister: toInt(config.runningRegister ?? config.statusRegister),
    endOkRegister: toInt(config.endOkRegister),
    endNgRegister: toInt(config.endNgRegister),
    partRegister: toInt(config.partRegister),
    stationRegister: toInt(config.stationRegister),
    resetRegister: toInt(config.resetRegister),
    startValue: toInt(config.startValue),
    startedValue: toInt(config.startedValue),
    endOkValue: toInt(config.endOkValue),
    endNgValue: toInt(config.endNgValue),
    blockValue: toInt(config.blockValue),
    resetValue: toInt(config.resetValue),
    testTimeoutMs: toInt(config.testTimeoutMs),
    testRetryCount: toInt(config.testRetryCount),
    heartbeatRegister: toInt(config.heartbeatRegister),
    heartbeatStaleMs: toInt(config.heartbeatStaleMs),
    cycleTimeSec: toInt(config.cycleTimeSec),
    loadingTimeSec: toInt(config.loadingTimeSec),
    handshakeMap: handshakeMap || null,
    slmpDevice: normalizeText(config.slmpDevice) ? normalizeText(config.slmpDevice).toUpperCase() : null,
    slmpFrameMode,
    spcConfig,
  };

  const hasAnyValue = Object.values(snapshot).some((entry) => entry !== null && entry !== undefined);
  if (!hasAnyValue) {
    return null;
  }
  return JSON.stringify(snapshot);
}

function parseRangeDefaultRegisterMap(rawValue) {
  if (!rawValue) {
    return {};
  }

  let parsed = rawValue;
  if (typeof rawValue === "string") {
    try {
      parsed = JSON.parse(rawValue);
    } catch (_error) {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const output = {};
  for (const entry of REGISTER_COLUMN_META) {
    const registerNo = toInt(parsed[entry.label]);
    if (registerNo === null) {
      continue;
    }
    output[entry.label] = registerNo;
  }
  return output;
}

function refreshPlcConfigSnapshot(payload) {
  const existingSnapshot = parsePlcRegistersSnapshot(payload.plc_registers) || {};
  const preservedCore = deriveCoreFromHandshakeMap(existingSnapshot.handshakeMap, {
    startRegister: toInt(payload.plc_start_register ?? existingSnapshot.startRegister),
    blockRegister: toInt(existingSnapshot.blockRegister),
    runningRegister: toInt(
      existingSnapshot.runningRegister ??
        existingSnapshot.statusRegister ??
        payload.plc_status_register
    ),
    statusRegister: toInt(
      payload.plc_status_register ??
        existingSnapshot.statusRegister ??
        existingSnapshot.runningRegister
    ),
    endOkRegister: toInt(existingSnapshot.endOkRegister),
    endNgRegister: toInt(existingSnapshot.endNgRegister),
    resetRegister: toInt(payload.plc_reset_register ?? existingSnapshot.resetRegister),
    heartbeatRegister: toInt(payload.plc_heartbeat_register ?? existingSnapshot.heartbeatRegister),
    startValue: toInt(payload.plc_start_value ?? existingSnapshot.startValue),
    blockValue: toInt(payload.plc_block_value ?? existingSnapshot.blockValue),
    startedValue: toInt(payload.plc_started_value ?? existingSnapshot.startedValue),
    endOkValue: toInt(payload.plc_end_ok_value ?? existingSnapshot.endOkValue),
    endNgValue: toInt(payload.plc_end_ng_value ?? existingSnapshot.endNgValue),
    resetValue: toInt(payload.plc_reset_value ?? existingSnapshot.resetValue),
  });
  payload.plc_registers =
    serializePlcConfigSnapshot({
      rangeId: payload.plc_range_id,
      unitId: payload.plc_unit_id,
      startRegister: preservedCore.startRegister,
      statusRegister: preservedCore.statusRegister ?? preservedCore.runningRegister,
      blockRegister: preservedCore.blockRegister,
      runningRegister: preservedCore.runningRegister ?? preservedCore.statusRegister,
      endOkRegister: preservedCore.endOkRegister,
      endNgRegister: preservedCore.endNgRegister,
      partRegister: payload.plc_part_register,
      stationRegister: payload.plc_station_register,
      resetRegister: preservedCore.resetRegister,
      startValue: preservedCore.startValue,
      startedValue: preservedCore.startedValue,
      endOkValue: preservedCore.endOkValue,
      endNgValue: preservedCore.endNgValue,
      blockValue: preservedCore.blockValue,
      resetValue: preservedCore.resetValue,
      testTimeoutMs: payload.plc_test_timeout_ms,
      testRetryCount: payload.plc_test_retry_count,
      heartbeatRegister: preservedCore.heartbeatRegister,
      heartbeatStaleMs: payload.plc_heartbeat_stale_ms,
      cycleTimeSec: toInt(existingSnapshot.cycleTimeSec),
      loadingTimeSec: toInt(existingSnapshot.loadingTimeSec),
      handshakeMap: existingSnapshot.handshakeMap ?? null,
      slmpDevice: payload.plc_slmp_device,
      slmpFrameMode: payload.plc_slmp_frame_mode,
      spcConfig: normalizeSpcConfig(payload.spc_config ?? existingSnapshot.spcConfig ?? {}),
    }) || payload.plc_registers;
}

async function hydratePayloadFromRange(payload) {
  const protocol = String(payload.plc_protocol || "").toUpperCase();
  if (!["MODBUS_TCP", "SLMP"].includes(protocol)) {
    return;
  }

  const rangeId = toInt(payload.plc_range_id);
  if (!rangeId) {
    return;
  }

  const range = await PlcRegisterRange.findByPk(rangeId);
  if (!range) {
    throw new Error("Configured plcRangeId does not exist");
  }

  const rangeProtocol = toProtocol(range.plc_protocol || payload.plc_protocol);
  if (rangeProtocol !== protocol) {
    throw new Error(`Selected plcRangeId protocol ${rangeProtocol} does not match machine protocol ${protocol}`);
  }
  payload.plc_protocol = rangeProtocol;
  payload.plc_ip = normalizeText(payload.plc_ip || range.plc_ip) || null;
  payload.plc_port = toInt(payload.plc_port ?? range.plc_port);
  payload.machine_ip = normalizeText(payload.machine_ip || payload.plc_ip || range.plc_ip) || null;
  payload.machine_port = toInt(payload.machine_port ?? payload.plc_port ?? range.plc_port);

  const defaults = parseRangeDefaultRegisterMap(range.default_register_map);
  const roleToColumn = {
    startRegister: "plc_start_register",
    statusRegister: "plc_status_register",
    partRegister: "plc_part_register",
    stationRegister: "plc_station_register",
    resetRegister: "plc_reset_register",
    heartbeatRegister: "plc_heartbeat_register",
  };

  for (const [roleKey, column] of Object.entries(roleToColumn)) {
    if (toInt(payload[column]) === null && toInt(defaults[roleKey]) !== null) {
      payload[column] = toInt(defaults[roleKey]);
    }
  }

  refreshPlcConfigSnapshot(payload);
}

function resolveMachineNumber(machineNumber, lineName, sequenceNo, operationNo, existingMachine = null) {
  if (machineNumber) {
    return machineNumber;
  }
  if (existingMachine?.machine_number) {
    return existingMachine.machine_number;
  }
  const lineToken = normalizeUpper(lineName || "LINE").replace(/\s+/g, "");
  const operationToken = normalizeUpper(operationNo || "").replace(/\s+/g, "");
  const seqToken = sequenceNo ?? "AUTO";
  return `MC-${lineToken}-${operationToken || seqToken}`;
}

function buildRegistersFallback(machine) {
  if (machine?.plc_registers) {
    return machine.plc_registers;
  }
  const values = [
    machine?.plc_start_register,
    machine?.plc_status_register,
    machine?.plc_part_register,
    machine?.plc_station_register,
    machine?.plc_reset_register,
  ].filter((entry) => entry !== null && entry !== undefined);
  return values.length > 0 ? values.join(",") : null;
}

function toMachinePayload(body = {}, existingMachine = null) {
  const sequenceNo = toInt(body.sequenceNo ?? body.sequence_no ?? existingMachine?.sequence_no);
  const operationNo =
    normalizeUpper(body.operationNo ?? body.operation_no) ||
    normalizeUpper(body.stationNo ?? body.station_no) ||
    normalizeUpper(existingMachine?.operation_no) ||
    (sequenceNo !== null ? `OP-${sequenceNo}` : "");

  const lineName = normalizeText(body.lineName ?? body.line_name) || normalizeText(existingMachine?.line_name) || "LINE-1";
  const machineName = normalizeText(body.machineName ?? body.machine_name) || normalizeText(existingMachine?.machine_name);
  const machineNumberInput = normalizeText(body.machineNumber ?? body.machine_number);
  const status = toStatus(body.status ?? existingMachine?.status ?? "ACTIVE");
  const isActive = status === "ACTIVE";

  const protocol = toProtocol(body.plcProtocol ?? body.plc_protocol ?? existingMachine?.plc_protocol);
  const plcConfigInput = getPlcConfigInput(body);
  const existingSnapshot = parsePlcRegistersSnapshot(existingMachine?.plc_registers) || {};
  const hasIncomingPlcRegisters =
    Object.prototype.hasOwnProperty.call(body, "plcRegisters") ||
    Object.prototype.hasOwnProperty.call(body, "plc_registers");
  const incomingRegistersSnapshot = hasIncomingPlcRegisters
    ? parsePlcRegistersSnapshot(body.plcRegisters ?? body.plc_registers) || {}
    : null;
  const snapshotFallback = incomingRegistersSnapshot || existingSnapshot;
  const parsedRegisters = parsePlcRegisters(
    hasIncomingPlcRegisters ? body.plcRegisters ?? body.plc_registers : existingMachine?.plc_registers
  );
  const plcSignalMap = normalizePlcSignalMap(
    body.plcSignalMap ?? body.plc_signal_map ?? plcConfigInput.signalMap,
    existingMachine?.plc_signal_map
  );

  const plcIp = normalizeText(body.plcIp ?? body.plc_ip ?? existingMachine?.plc_ip);
  const plcPort = toInt(body.plcPort ?? body.plc_port ?? existingMachine?.plc_port);
  const plcRangeId =
    toInt(body.plcRangeId ?? body.plc_range_id ?? plcConfigInput.rangeId) ??
    parsedRegisters.parsed.range ??
    toInt(existingMachine?.plc_range_id);

  const plcUnitId =
    toInt(body.plcUnitId ?? body.plc_unit_id ?? plcConfigInput.unitId ?? existingMachine?.plc_unit_id) ?? 1;
  const plcStartRegister =
    toInt(body.plcStartRegister ?? body.plc_start_register ?? plcConfigInput.startRegister) ??
    parsedRegisters.parsed.start ??
    toInt(existingMachine?.plc_start_register);
  const plcBlockRegister =
    toInt(body.plcBlockRegister ?? body.plc_block_register ?? plcConfigInput.blockRegister) ??
    toInt(existingMachine?.plc_block_register);
  const plcRunningRegister =
    toInt(body.plcRunningRegister ?? body.plc_running_register ?? plcConfigInput.runningRegister) ??
    toInt(existingMachine?.plc_running_register);
  const plcEndOkRegister =
    toInt(body.plcEndOkRegister ?? body.plc_end_ok_register ?? plcConfigInput.endOkRegister) ??
    toInt(existingMachine?.plc_end_ok_register);
  const plcEndNgRegister =
    toInt(body.plcEndNgRegister ?? body.plc_end_ng_register ?? plcConfigInput.endNgRegister) ??
    toInt(existingMachine?.plc_end_ng_register);
  const plcStatusRegister =
    toInt(body.plcStatusRegister ?? body.plc_status_register ?? plcConfigInput.statusRegister) ??
    toInt(plcConfigInput.runningRegister) ??
    parsedRegisters.parsed.status ??
    toInt(existingMachine?.plc_status_register) ??
    plcRunningRegister;
  const plcPartRegister =
    toInt(body.plcPartRegister ?? body.plc_part_register ?? plcConfigInput.partRegister) ??
    parsedRegisters.parsed.part ??
    toInt(existingMachine?.plc_part_register);
  const plcStationRegister =
    toInt(body.plcStationRegister ?? body.plc_station_register ?? plcConfigInput.stationRegister) ??
    parsedRegisters.parsed.station ??
    toInt(existingMachine?.plc_station_register);
  const plcResetRegister =
    toInt(body.plcResetRegister ?? body.plc_reset_register ?? plcConfigInput.resetRegister) ??
    parsedRegisters.parsed.reset ??
    toInt(existingMachine?.plc_reset_register);

  const plcStartValue =
    toInt(body.plcStartValue ?? body.plc_start_value ?? plcConfigInput.startValue ?? existingMachine?.plc_start_value) ?? 1;
  const plcStartedValue =
    toInt(body.plcStartedValue ?? body.plc_started_value ?? plcConfigInput.startedValue ?? existingMachine?.plc_started_value) ??
    2;
  const plcEndOkValue =
    toInt(body.plcEndOkValue ?? body.plc_end_ok_value ?? plcConfigInput.endOkValue ?? existingMachine?.plc_end_ok_value) ?? 3;
  const plcEndNgValue =
    toInt(body.plcEndNgValue ?? body.plc_end_ng_value ?? plcConfigInput.endNgValue ?? existingMachine?.plc_end_ng_value) ?? 4;
  const plcBlockValue =
    toInt(body.plcBlockValue ?? body.plc_block_value ?? plcConfigInput.blockValue ?? existingMachine?.plc_block_value) ?? 2;
  const plcResetValue =
    toInt(body.plcResetValue ?? body.plc_reset_value ?? plcConfigInput.resetValue ?? existingMachine?.plc_reset_value) ?? 9;
  const plcTestTimeoutMs =
    toInt(body.plcTestTimeoutMs ?? body.plc_test_timeout_ms ?? plcConfigInput.testTimeoutMs ?? existingMachine?.plc_test_timeout_ms) ??
    2000;
  const plcTestRetryCount =
    toInt(body.plcTestRetryCount ?? body.plc_test_retry_count ?? plcConfigInput.testRetryCount ?? existingMachine?.plc_test_retry_count) ??
    2;
  const plcHeartbeatRegister =
    toInt(
      body.plcHeartbeatRegister ??
        body.plc_heartbeat_register ??
        plcConfigInput.heartbeatRegister ??
        existingMachine?.plc_heartbeat_register
    );
  const plcHeartbeatStaleMs =
    toInt(
      body.plcHeartbeatStaleMs ??
        body.plc_heartbeat_stale_ms ??
        plcConfigInput.heartbeatStaleMs ??
        existingMachine?.plc_heartbeat_stale_ms
    ) ?? 5000;
  const plcSlmpDeviceRaw =
    normalizeText(body.plcSlmpDevice ?? body.plc_slmp_device ?? plcConfigInput.slmpDevice ?? existingMachine?.plc_slmp_device) || "";
  const plcSlmpDevice = plcSlmpDeviceRaw ? plcSlmpDeviceRaw.toUpperCase() : null;
  const plcSlmpFrameMode =
    normalizeSlmpFrameMode(
      body.plcSlmpFrameMode ??
        body.plc_slmp_frame_mode ??
        plcConfigInput.slmpFrameMode ??
        plcConfigInput.slmpFrame ??
        extractSlmpFrameMode(existingMachine?.plc_registers),
      "AUTO"
    ) || "AUTO";
  const dailyTargetQty =
    toInt(body.dailyTargetQty ?? body.daily_target_qty ?? existingMachine?.daily_target_qty) ?? 0;
  const cycleTimeSec =
    toInt(
      body.cycleTimeSec ??
        body.cycle_time_sec ??
        plcConfigInput.cycleTimeSec ??
        plcConfigInput.cycle_time_sec ??
        snapshotFallback.cycleTimeSec
    ) ?? 0;
  const loadingTimeSec =
    toInt(
      body.loadingTimeSec ??
        body.loading_time_sec ??
        plcConfigInput.loadingTimeSec ??
        plcConfigInput.loading_time_sec ??
        snapshotFallback.loadingTimeSec
    ) ?? 0;
  const incomingHandshakeSource =
    body.plcHandshakeMap ??
    body.plc_handshake_map ??
    plcConfigInput.handshakeMap ??
    plcConfigInput.plcHandshakeMap;
  const hasIncomingHandshakeMap = incomingHandshakeSource !== undefined;
  const parsedHandshakeMap = normalizePlcHandshakeMap(
    incomingHandshakeSource,
    snapshotFallback.handshakeMap
  );
  const baseCore = {
    startRegister: plcStartRegister,
    blockRegister: plcBlockRegister,
    runningRegister: plcRunningRegister,
    statusRegister: plcStatusRegister,
    endOkRegister: plcEndOkRegister,
    endNgRegister: plcEndNgRegister,
    resetRegister: plcResetRegister,
    heartbeatRegister: plcHeartbeatRegister,
    startValue: plcStartValue,
    blockValue: plcBlockValue,
    startedValue: plcStartedValue,
    endOkValue: plcEndOkValue,
    endNgValue: plcEndNgValue,
    resetValue: plcResetValue,
  };
  const resolvedCore = hasIncomingHandshakeMap
    ? deriveCoreFromHandshakeMap(parsedHandshakeMap, baseCore)
    : baseCore;
  const plcHandshakeMap =
    Array.isArray(parsedHandshakeMap) && parsedHandshakeMap.length > 0
      ? syncStandardHandshakeMapWithCore(parsedHandshakeMap, resolvedCore)
      : syncStandardHandshakeMapWithCore(null, {
          startRegister: resolvedCore.startRegister,
          blockRegister: resolvedCore.blockRegister,
          runningRegister: resolvedCore.runningRegister,
          statusRegister: resolvedCore.statusRegister,
          endOkRegister: resolvedCore.endOkRegister,
          endNgRegister: resolvedCore.endNgRegister,
          resetRegister: resolvedCore.resetRegister,
          heartbeatRegister: resolvedCore.heartbeatRegister,
          startValue: resolvedCore.startValue,
          startedValue: resolvedCore.startedValue,
          endOkValue: resolvedCore.endOkValue,
          endNgValue: resolvedCore.endNgValue,
          blockValue: resolvedCore.blockValue,
          resetValue: resolvedCore.resetValue,
        });
  const spcConfigInput =
    body.spcConfig ??
    body.spc_config ??
    plcConfigInput.spcConfig ??
    plcConfigInput.spc_config ??
    snapshotFallback.spcConfig ??
    {};
  const spcConfig = normalizeSpcConfig(spcConfigInput);

  const serializedSnapshot = serializePlcConfigSnapshot({
    rangeId: plcRangeId,
    unitId: plcUnitId,
    startRegister: resolvedCore.startRegister,
    statusRegister: resolvedCore.statusRegister ?? resolvedCore.runningRegister,
    blockRegister: resolvedCore.blockRegister,
    runningRegister: resolvedCore.runningRegister,
    endOkRegister: resolvedCore.endOkRegister,
    endNgRegister: resolvedCore.endNgRegister,
    partRegister: plcPartRegister,
    stationRegister: plcStationRegister,
    resetRegister: resolvedCore.resetRegister,
    startValue: resolvedCore.startValue,
    startedValue: resolvedCore.startedValue,
    endOkValue: resolvedCore.endOkValue,
    endNgValue: resolvedCore.endNgValue,
    blockValue: resolvedCore.blockValue,
    resetValue: resolvedCore.resetValue,
    testTimeoutMs: plcTestTimeoutMs,
    testRetryCount: plcTestRetryCount,
    heartbeatRegister: resolvedCore.heartbeatRegister,
    heartbeatStaleMs: plcHeartbeatStaleMs,
    cycleTimeSec,
    loadingTimeSec,
    handshakeMap: plcHandshakeMap,
    slmpDevice: plcSlmpDevice,
    slmpFrameMode: plcSlmpFrameMode,
    spcConfig,
  });
  const plcRegistersSnapshot = serializedSnapshot || parsedRegisters.raw || existingMachine?.plc_registers || null;

  const machineIp =
    normalizeText(body.machineIp ?? body.machine_ip) || plcIp || normalizeText(existingMachine?.machine_ip) || null;
  const machinePort =
    toInt(body.machinePort ?? body.machine_port) ??
    plcPort ??
    toInt(existingMachine?.machine_port);

  return {
    machine_number: resolveMachineNumber(machineNumberInput, lineName, sequenceNo, operationNo, existingMachine),
    machine_name: machineName,
    line_name: lineName,
    sequence_no: sequenceNo,
    operation_no: operationNo,
    machine_ip: machineIp,
    machine_port: machinePort,
    qr_scanner_ip: normalizeText(body.qrScannerIp ?? body.qr_scanner_ip ?? existingMachine?.qr_scanner_ip) || null,
    plc_ip: plcIp || null,
    plc_port: plcPort,
    plc_range_id: plcRangeId,
    plc_protocol: protocol,
    plc_registers: plcRegistersSnapshot,
    plc_signal_map: plcSignalMap,
    plc_unit_id: plcUnitId,
    plc_start_register: resolvedCore.startRegister,
    plc_status_register: resolvedCore.statusRegister ?? resolvedCore.runningRegister,
    plc_part_register: plcPartRegister,
    plc_station_register: plcStationRegister,
    plc_reset_register: resolvedCore.resetRegister,
    plc_start_value: resolvedCore.startValue,
    plc_started_value: resolvedCore.startedValue,
    plc_end_ok_value: resolvedCore.endOkValue,
    plc_end_ng_value: resolvedCore.endNgValue,
    plc_block_value: resolvedCore.blockValue,
    plc_reset_value: resolvedCore.resetValue,
    plc_test_timeout_ms: plcTestTimeoutMs,
    plc_test_retry_count: plcTestRetryCount,
    plc_heartbeat_register: resolvedCore.heartbeatRegister,
    plc_heartbeat_stale_ms: plcHeartbeatStaleMs,
    plc_slmp_device: plcSlmpDevice,
    plc_slmp_frame_mode: plcSlmpFrameMode,
    spc_config: spcConfig,
    daily_target_qty: Math.max(dailyTargetQty, 0),
    status,
    is_active: isActive,
  };
}

function toMachineResponse(machine) {
  const bypassState = getMachineBypass(machine.id);
  const status = machine.status || (machine.is_active ? "ACTIVE" : "INACTIVE");
  const plcRegisters = buildRegistersFallback(machine);
  const snapshot = parsePlcRegistersSnapshot(machine.plc_registers) || {};
  const cycleTimeSec = toInt(snapshot.cycleTimeSec) ?? 0;
  const loadingTimeSec = toInt(snapshot.loadingTimeSec) ?? 0;
  const savedHandshakeMap = normalizePlcHandshakeMap(snapshot.handshakeMap, null);
  const plcConfig = {
    rangeId: machine.plc_range_id,
    unitId: machine.plc_unit_id ?? 1,
    startRegister: machine.plc_start_register,
    statusRegister:
      machine.plc_status_register ??
      toInt(snapshot.statusRegister ?? snapshot.runningRegister),
    blockRegister: toInt(snapshot.blockRegister),
    runningRegister:
      toInt(snapshot.runningRegister ?? snapshot.statusRegister) ??
      machine.plc_status_register,
    endOkRegister: toInt(snapshot.endOkRegister),
    endNgRegister: toInt(snapshot.endNgRegister),
    partRegister: machine.plc_part_register,
    stationRegister: machine.plc_station_register,
    resetRegister: machine.plc_reset_register,
    startValue: machine.plc_start_value ?? 1,
    startedValue: machine.plc_started_value ?? 2,
    endOkValue: machine.plc_end_ok_value ?? 3,
    endNgValue: machine.plc_end_ng_value ?? 4,
    blockValue: machine.plc_block_value ?? 2,
    resetValue: machine.plc_reset_value ?? 9,
    testTimeoutMs: machine.plc_test_timeout_ms ?? 2000,
    testRetryCount: machine.plc_test_retry_count ?? 2,
    heartbeatRegister: machine.plc_heartbeat_register ?? null,
    heartbeatStaleMs: machine.plc_heartbeat_stale_ms ?? 5000,
    cycleTimeSec,
    loadingTimeSec,
    handshakeMap:
      (Array.isArray(savedHandshakeMap) && savedHandshakeMap.length > 0
        ? savedHandshakeMap
        : syncStandardHandshakeMapWithCore(null, {
            startRegister: machine.plc_start_register,
            runningRegister: machine.plc_status_register,
            statusRegister: machine.plc_status_register,
            resetRegister: machine.plc_reset_register,
            startValue: machine.plc_start_value ?? 1,
            startedValue: machine.plc_started_value ?? 2,
            endOkValue: machine.plc_end_ok_value ?? 3,
            endNgValue: machine.plc_end_ng_value ?? 4,
            blockValue: machine.plc_block_value ?? 2,
            resetValue: machine.plc_reset_value ?? 9,
          })) || [],
    slmpDevice: machine.plc_slmp_device ?? null,
    slmpFrameMode: extractSlmpFrameMode(machine.plc_registers) || "AUTO",
    spcConfig: normalizeSpcConfig(snapshot.spcConfig || {}),
  };
  const plcSignalMap = parsePlcSignalMap(machine.plc_signal_map);
  return {
    id: machine.id,
    machineName: machine.machine_name,
    lineName: machine.line_name,
    sequenceNo: machine.sequence_no,
    operationNo: machine.operation_no,
    plcIp: machine.plc_ip,
    plcPort: machine.plc_port,
    plcRangeId: machine.plc_range_id,
    plcProtocol: machine.plc_protocol || "TCP_TEXT",
    plcRegisters,
    plcSignalMap,
    plcConfig,
    spcConfig: normalizeSpcConfig(snapshot.spcConfig || {}),
    status,
    isActive: machine.is_active,
    machineNumber: machine.machine_number,
    stationNo: machine.operation_no,
    machineIp: machine.machine_ip,
    machinePort: machine.machine_port,
    qrScannerIp: machine.qr_scanner_ip,
    plcUnitId: machine.plc_unit_id,
    plcStartRegister: machine.plc_start_register,
    plcStatusRegister: machine.plc_status_register,
    plcBlockRegister: toInt(snapshot.blockRegister),
    plcRunningRegister:
      toInt(snapshot.runningRegister ?? snapshot.statusRegister) ??
      machine.plc_status_register,
    plcEndOkRegister: toInt(snapshot.endOkRegister),
    plcEndNgRegister: toInt(snapshot.endNgRegister),
    plcPartRegister: machine.plc_part_register,
    plcStationRegister: machine.plc_station_register,
    plcResetRegister: machine.plc_reset_register,
    plcStartValue: machine.plc_start_value,
    plcStartedValue: machine.plc_started_value,
    plcEndOkValue: machine.plc_end_ok_value,
    plcEndNgValue: machine.plc_end_ng_value,
    plcBlockValue: machine.plc_block_value,
    plcResetValue: machine.plc_reset_value,
    plcTestTimeoutMs: machine.plc_test_timeout_ms,
    plcTestRetryCount: machine.plc_test_retry_count,
    plcHeartbeatRegister: machine.plc_heartbeat_register,
    plcHeartbeatStaleMs: machine.plc_heartbeat_stale_ms,
    plcSlmpDevice: machine.plc_slmp_device,
    plcSlmpFrameMode: extractSlmpFrameMode(machine.plc_registers) || "AUTO",
    dailyTargetQty: machine.daily_target_qty ?? 0,
    cycleTimeSec,
    loadingTimeSec,
    isRunning: Boolean(machine.is_running),
    runningPartId: machine.running_part_id || null,
    runningStationNo: machine.running_station_no || null,
    runningStartedAt: machine.running_started_at || null,
    machineBypassEnabled: Boolean(bypassState?.enabled),
    machineBypassReason: bypassState?.reason || null,
    machineBypassUpdatedAt: bypassState?.updatedAt || null,
    machineBypassUpdatedBy: bypassState?.updatedBy || null,
    createdAt: machine.createdAt,
    updatedAt: machine.updatedAt,
  };
}

function validateMachinePayload(payload) {
  const required = [
    ["machineName", payload.machine_name],
    ["lineName", payload.line_name],
    ["sequenceNo", payload.sequence_no],
    ["operationNo", payload.operation_no],
    ["plcProtocol", payload.plc_protocol],
  ];

  const missing = required
    .filter(([, value]) => value === null || value === undefined || value === "")
    .map(([key]) => key);

  if (["TCP_TEXT", "SLMP"].includes(payload.plc_protocol)) {
    if (payload.plc_ip === null || payload.plc_ip === undefined || payload.plc_ip === "") {
      missing.push("plcIp");
    }
    if (payload.plc_port === null || payload.plc_port === undefined || payload.plc_port === "") {
      missing.push("plcPort");
    }
  }

  if (payload.plc_protocol === "SLMP") {
    if (payload.plc_start_register === null || payload.plc_start_register === undefined) {
      missing.push("plcStartRegister");
    }
    if (payload.plc_status_register === null || payload.plc_status_register === undefined) {
      missing.push("plcStatusRegister");
    }
  }

  if (payload.plc_protocol === "MODBUS_TCP") {
    if (payload.plc_range_id === null || payload.plc_range_id === undefined) {
      missing.push("plcRangeId");
    }
    if (payload.plc_start_register === null || payload.plc_start_register === undefined) {
      missing.push("plcStartRegister");
    }
    if (payload.plc_status_register === null || payload.plc_status_register === undefined) {
      missing.push("plcStatusRegister");
    }
  }

  return missing;
}

async function validateRangeAndRegisterUsage(payload, excludeMachineId = null) {
  const protocol = String(payload.plc_protocol || "").toUpperCase();
  if (!["MODBUS_TCP", "SLMP"].includes(protocol)) {
    return;
  }

  const rangeId = toInt(payload.plc_range_id);
  if (!rangeId) {
    if (protocol === "MODBUS_TCP") {
      throw new Error("plcRangeId is required for MODBUS_TCP");
    }
    return;
  }

  const range = await PlcRegisterRange.findByPk(rangeId);
  if (!range) {
    throw new Error("Configured plcRangeId does not exist");
  }
  const rangeProtocol = toProtocol(range.plc_protocol || payload.plc_protocol);
  if (rangeProtocol !== protocol) {
    throw new Error(`Configured plcRangeId protocol ${rangeProtocol} does not match ${protocol}`);
  }
  if (String(range.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
    throw new Error("Configured plcRangeId is INACTIVE. Select an ACTIVE range.");
  }

  const selectedRegisterMap = new Map();
  const coreRoleTokenByLabel = {
    startRegister: "handshake:START_GROUP",
    statusRegister: "handshake:STATUS_GROUP",
    resetRegister: "handshake:RESET_GROUP",
    heartbeatRegister: "handshake:CONFIRMATION_GROUP",
    partRegister: "core:partRegister",
    stationRegister: "core:stationRegister",
  };
  const addSelectedRegister = (registerWord, roleToken, displayLabel) => {
    if (registerWord < range.range_start || registerWord > range.range_end) {
      throw new Error(`${displayLabel} (${registerWord}) is outside selected range ${range.range_start}-${range.range_end}`);
    }
    const existingRole = selectedRegisterMap.get(registerWord);
    if (existingRole && existingRole.roleToken !== roleToken) {
      throw new Error(`Register ${registerWord} is assigned twice (${existingRole.displayLabel} and ${displayLabel})`);
    }
    selectedRegisterMap.set(registerWord, {
      roleToken,
      displayLabel,
    });
  };

  for (const entry of REGISTER_COLUMN_META) {
    const registerNo = toInt(payload[entry.column]);
    if (registerNo === null) {
      continue;
    }
    const spanWords =
      protocol === "SLMP" && ["plc_part_register", "plc_station_register"].includes(entry.column) ? 2 : 1;
    for (let offset = 0; offset < spanWords; offset += 1) {
      const roleToken = coreRoleTokenByLabel[entry.label] || `core:${entry.label}`;
      addSelectedRegister(registerNo + offset, roleToken, entry.label);
    }
  }

  const incomingAuxEntries = buildAuxRegisterEntries(payload);
  for (const entry of incomingAuxEntries) {
    const registerNo = toInt(entry.register);
    if (registerNo === null) continue;
    const spanWords = Math.max(1, toInt(entry.spanWords) || 1);
    for (let offset = 0; offset < spanWords; offset += 1) {
      const displayLabel = entry.label || "signalRegister";
      addSelectedRegister(registerNo + offset, `aux:${displayLabel}`, displayLabel);
    }
  }

  const incomingHandshakeEntries = buildHandshakeRegisterEntries(payload);
  const handshakeRegisterOwner = new Map();
  for (const entry of incomingHandshakeEntries) {
    const registerNo = toInt(entry.register);
    if (registerNo === null) continue;
    const spanWords = Math.max(1, toInt(entry.spanWords) || 1);
    for (let offset = 0; offset < spanWords; offset += 1) {
      const registerWord = registerNo + offset;
      const existingOwner = handshakeRegisterOwner.get(registerWord);
      if (existingOwner && existingOwner.groupKey !== entry.groupKey) {
        throw new Error(
          `Handshake register ${registerWord} is duplicated across groups (${existingOwner.label} and ${entry.label}).`
        );
      }
      handshakeRegisterOwner.set(registerWord, { label: entry.label, groupKey: entry.groupKey });
    }
  }
  for (const entry of incomingHandshakeEntries) {
    const registerNo = toInt(entry.register);
    if (registerNo === null) continue;
    const spanWords = Math.max(1, toInt(entry.spanWords) || 1);
    for (let offset = 0; offset < spanWords; offset += 1) {
      addSelectedRegister(registerNo + offset, `handshake:${entry.groupKey}`, entry.label);
    }
  }

  if (selectedRegisterMap.size === 0) {
    return;
  }

  const peerMachines = await Machine.findAll({
    where: {
      plc_range_id: rangeId,
      ...(excludeMachineId ? { id: { [Op.ne]: excludeMachineId } } : {}),
    },
    attributes: [
      "id",
      "machine_name",
      "operation_no",
      "plc_protocol",
      "plc_signal_map",
      "plc_registers",
      "plc_slmp_device",
      ...REGISTER_COLUMN_META.map((entry) => entry.column),
    ],
  });

  for (const machine of peerMachines) {
    const peerProtocol = String(machine.plc_protocol || protocol).toUpperCase();
    for (const entry of REGISTER_COLUMN_META) {
      const registerNo = toInt(machine[entry.column]);
      if (registerNo === null) continue;
      const spanWords =
        peerProtocol === "SLMP" && ["plc_part_register", "plc_station_register"].includes(entry.column) ? 2 : 1;
      for (let offset = 0; offset < spanWords; offset += 1) {
        const registerWord = registerNo + offset;
        if (!selectedRegisterMap.has(registerWord)) continue;
        const incomingRole = selectedRegisterMap.get(registerWord)?.displayLabel || "incoming register";
        throw new Error(
          `Register ${registerWord} already used by ${machine.machine_name} (${machine.operation_no}) as ${entry.label}. Conflicts with ${incomingRole}.`
        );
      }
    }

    const peerAuxEntries = buildAuxRegisterEntries(machine);
    for (const entry of peerAuxEntries) {
      const registerNo = toInt(entry.register);
      if (registerNo === null) continue;
      const spanWords = Math.max(1, toInt(entry.spanWords) || 1);
      for (let offset = 0; offset < spanWords; offset += 1) {
        const registerWord = registerNo + offset;
        if (!selectedRegisterMap.has(registerWord)) continue;
        const incomingRole = selectedRegisterMap.get(registerWord)?.displayLabel || "incoming register";
        throw new Error(
          `Register ${registerWord} already used by ${machine.machine_name} (${machine.operation_no}) as ${entry.label}. Conflicts with ${incomingRole}.`
        );
      }
    }

    const peerHandshakeEntries = buildHandshakeRegisterEntries(machine);
    for (const entry of peerHandshakeEntries) {
      const registerNo = toInt(entry.register);
      if (registerNo === null) continue;
      const spanWords = Math.max(1, toInt(entry.spanWords) || 1);
      for (let offset = 0; offset < spanWords; offset += 1) {
        const registerWord = registerNo + offset;
        if (!selectedRegisterMap.has(registerWord)) continue;
        const incomingRole = selectedRegisterMap.get(registerWord)?.displayLabel || "incoming register";
        throw new Error(
          `Register ${registerWord} already used by ${machine.machine_name} (${machine.operation_no}) as ${entry.label}. Conflicts with ${incomingRole}.`
        );
      }
    }
  }
}

const SLMP_DEFAULT_DEVICE = normalizeUpper(process.env.PLC_SLMP_DEVICE || "D");

function resolveSlmpDeviceForSignal(signalKey, machine = {}) {
  const defaultDevice = normalizeUpper(machine.plc_slmp_device || SLMP_DEFAULT_DEVICE);
  const signalMap = parsePlcSignalMap(machine.plc_signal_map);
  if (signalMap) {
    const entry = signalMap.find((row) => normalizeUpper(row.key) === normalizeUpper(signalKey));
    if (entry?.device) {
      return normalizeUpper(entry.device);
    }
  }
  return defaultDevice || SLMP_DEFAULT_DEVICE;
}

function buildSlmpRegisterEntries(machine = {}) {
  return [
    { key: "TRIGGER", label: "startRegister", register: toInt(machine.plc_start_register), spanWords: 1 },
    { key: "STATUS", label: "statusRegister", register: toInt(machine.plc_status_register), spanWords: 1 },
    { key: "RESET", label: "resetRegister", register: toInt(machine.plc_reset_register), spanWords: 1 },
    { key: "HEARTBEAT", label: "heartbeatRegister", register: toInt(machine.plc_heartbeat_register), spanWords: 1 },
    // PART_ID_HASH and STATION_HASH are written as 32-bit payloads (2 words).
    { key: "PART_ID_HASH", label: "partRegister", register: toInt(machine.plc_part_register), spanWords: 2 },
    { key: "STATION_HASH", label: "stationRegister", register: toInt(machine.plc_station_register), spanWords: 2 },
  ]
    .filter((entry) => entry.register !== null)
    .map((entry) => ({
      ...entry,
      device: resolveSlmpDeviceForSignal(entry.key, machine),
    }));
}

function buildAuxRegisterEntries(machine = {}) {
  const entries = [];
  const signalMap = parsePlcSignalMap(machine.plc_signal_map) || [];
  for (const row of signalMap) {
    const register = toInt(row?.register);
    if (register === null) continue;
    const key = normalizeUpper(row?.key || row?.label || "SIGNAL");
    const device = normalizeUpper(row?.device) || resolveSlmpDeviceForSignal(key, machine);
    entries.push({
      key,
      label: normalizeText(row?.label || row?.key || "signalRegister") || "signalRegister",
      register,
      spanWords: 1,
      device: device || SLMP_DEFAULT_DEVICE,
    });
  }

  const snapshot = parsePlcRegistersSnapshot(machine.plc_registers) || {};
  const spcConfig = normalizeSpcConfig(snapshot.spcConfig || machine.spcConfig || {});
  if (spcConfig.enabled && spcConfig.mode === "PLC_REGISTER") {
    const resultRegister = toInt(spcConfig.plcResultRegister);
    if (resultRegister !== null) {
      entries.push({
        key: "SPC_RESULT",
        label: "spcResultRegister",
        register: resultRegister,
        spanWords: 1,
        device: normalizeUpper(spcConfig.plcResultDevice) || resolveSlmpDeviceForSignal("SPC_RESULT", machine),
      });
    }
  }
  if (spcConfig.enabled && spcConfig.plcAckEnabled) {
    const ackRegister = toInt(spcConfig.plcAckRegister);
    if (ackRegister !== null) {
      entries.push({
        key: "SPC_ACK",
        label: "spcAckRegister",
        register: ackRegister,
        spanWords: 1,
        device: normalizeUpper(spcConfig.plcAckDevice) || resolveSlmpDeviceForSignal("SPC_ACK", machine),
      });
    }
  }

  return entries;
}

function getHandshakeSignalGroup(signal) {
  const normalized = normalizeUpper(signal).replace(/[^A-Z0-9]+/g, "_");
  if (normalized === "START" || normalized === "BLOCK_INTERLOCK") return "START_GROUP";
  if (normalized === "RUNNING" || normalized === "END_OK" || normalized === "END_NG") return "STATUS_GROUP";
  if (normalized === "RESET") return "RESET_GROUP";
  if (["CONFIRMATION", "CONFIRM", "ACK", "ACKNOWLEDGE", "ACKNOWLEDGEMENT"].includes(normalized)) {
    return "CONFIRMATION_GROUP";
  }
  return `CUSTOM_${normalized || "UNNAMED"}`;
}

function buildHandshakeRegisterEntries(machine = {}) {
  const snapshot = parsePlcRegistersSnapshot(machine.plc_registers) || {};
  const handshakeMap = normalizePlcHandshakeMap(snapshot.handshakeMap, null) || [];
  const entries = [];

  for (let index = 0; index < handshakeMap.length; index += 1) {
    const row = handshakeMap[index];
    const register = toInt(row?.register);
    if (register === null) continue;
    const signal = normalizeText(row?.signal || row?.label || `Handshake ${index + 1}`) || `Handshake ${index + 1}`;
    const groupKey = getHandshakeSignalGroup(signal);
    entries.push({
      register,
      spanWords: 1,
      signal,
      groupKey,
      label: `Handshake ${signal}`,
    });
  }

  return entries;
}

function expandSlmpWordOccupancy(entries = []) {
  const occupied = [];
  for (const entry of entries) {
    const width = Math.max(1, toInt(entry.spanWords) || 1);
    for (let offset = 0; offset < width; offset += 1) {
      occupied.push({
        ...entry,
        registerWord: entry.register + offset,
      });
    }
  }
  return occupied;
}

async function validateSlmpRegisterOverlap(payload, excludeMachineId = null) {
  if (String(payload.plc_protocol || "").toUpperCase() !== "SLMP") {
    return;
  }

  const plcIp = normalizeText(payload.plc_ip);
  const plcPort = toInt(payload.plc_port);
  if (!plcIp || plcPort === null) {
    return;
  }

  const currentEntries = [...buildSlmpRegisterEntries(payload), ...buildAuxRegisterEntries(payload)];
  const seen = new Set();
  const currentWords = expandSlmpWordOccupancy(currentEntries);
  for (const entry of currentWords) {
    const key = `${entry.device}:${entry.registerWord}`;
    if (seen.has(key)) {
      throw new Error(`SLMP register ${entry.device}${entry.registerWord} overlaps multiple mappings in same machine`);
    }
    seen.add(key);
  }

  const peers = await Machine.findAll({
    where: {
      plc_protocol: "SLMP",
      plc_ip: plcIp,
      plc_port: plcPort,
      ...(excludeMachineId ? { id: { [Op.ne]: excludeMachineId } } : {}),
    },
    attributes: [
      "id",
      "machine_name",
      "operation_no",
      "plc_slmp_device",
      "plc_signal_map",
      "plc_registers",
      "plc_start_register",
      "plc_status_register",
      "plc_reset_register",
      "plc_heartbeat_register",
      "plc_part_register",
      "plc_station_register",
    ],
  });

  for (const peer of peers) {
    const peerEntries = [...buildSlmpRegisterEntries(peer), ...buildAuxRegisterEntries(peer)];
    const peerWords = expandSlmpWordOccupancy(peerEntries);
    for (const entry of currentWords) {
      if (!entry.device || entry.registerWord === null) {
        continue;
      }
      const conflict = peerEntries.find(
        (row) => row.device === entry.device && row.register === entry.register
      );
      const conflictWord = peerWords.find(
        (row) => row.device === entry.device && row.registerWord === entry.registerWord
      );
      if (conflict || conflictWord) {
        const conflictLabel = conflict?.label || conflictWord?.label || "mapped signal";
        throw new Error(
          `SLMP register ${entry.device}${entry.registerWord} already used by ${peer.machine_name} (${peer.operation_no}) as ${conflictLabel}`
        );
      }
    }
  }
}

function handleSequelizeError(error, res) {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      error: "Duplicate machine configuration",
      details: error.errors.map((entry) => entry.path),
    });
  }

  if (error instanceof Sequelize.ValidationError) {
    return res.status(400).json({
      error: "Validation failed",
      details: error.errors.map((entry) => entry.message),
    });
  }

  return res.status(500).json({ error: error.message });
}

exports.getMachines = async (_req, res) => {
  try {
    const machines = await Machine.findAll({ order: [["sequence_no", "ASC"]] });
    res.json(machines.map(toMachineResponse));
  } catch (error) {
    handleSequelizeError(error, res);
  }
};

exports.getMachineById = async (req, res) => {
  try {
    const machine = await Machine.findByPk(req.params.id);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }
    res.json(toMachineResponse(machine));
  } catch (error) {
    handleSequelizeError(error, res);
  }
};

exports.createMachine = async (req, res) => {
  try {
    const payload = toMachinePayload(req.body);
    await hydratePayloadFromRange(payload);
    const missing = validateMachinePayload(payload);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Required fields: ${missing.join(", ")}` });
    }
    await validateRangeAndRegisterUsage(payload);
    await validateSlmpRegisterOverlap(payload);
    const persistPayload = { ...payload };
    delete persistPayload.plc_slmp_frame_mode;
    delete persistPayload.spc_config;
    const machine = await Machine.create(persistPayload);
    res.status(201).json(toMachineResponse(machine));
  } catch (error) {
    if (!String(error?.name || "").startsWith("Sequelize")) {
      return res.status(400).json({ error: error.message || "Failed to create machine" });
    }
    handleSequelizeError(error, res);
  }
};

exports.updateMachine = async (req, res) => {
  try {
    const machine = await Machine.findByPk(req.params.id);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const payload = toMachinePayload(req.body, machine);
    await hydratePayloadFromRange(payload);
    const missing = validateMachinePayload(payload);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Required fields: ${missing.join(", ")}` });
    }
    await validateRangeAndRegisterUsage(payload, machine.id);
    await validateSlmpRegisterOverlap(payload, machine.id);

    const persistPayload = { ...payload };
    delete persistPayload.plc_slmp_frame_mode;
    delete persistPayload.spc_config;
    await machine.update(persistPayload);
    res.json(toMachineResponse(machine));
  } catch (error) {
    if (!String(error?.name || "").startsWith("Sequelize")) {
      return res.status(400).json({ error: error.message || "Failed to update machine" });
    }
    handleSequelizeError(error, res);
  }
};

exports.testPlc = async (req, res) => {
  let plcContext = {};
  try {
    const machineId = toInt(req.body.machineId ?? req.body.id);
    const existingMachine = machineId !== null ? await Machine.findByPk(machineId) : null;
    if (machineId !== null && !existingMachine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const payload = toMachinePayload({
      machineName: req.body.machineName || "PLC_TEST",
      lineName: req.body.lineName || "LINE",
      sequenceNo: req.body.sequenceNo ?? 1,
      operationNo: req.body.operationNo || "OP-TEST",
      plcIp: req.body.plcIp ?? req.body.plc_ip ?? req.body.machineIp ?? req.body.machine_ip,
      plcPort: req.body.plcPort ?? req.body.plc_port ?? req.body.machinePort ?? req.body.machine_port,
      plcProtocol: req.body.plcProtocol ?? req.body.plc_protocol,
      plcConfig: req.body.plcConfig,
      plcRegisters: req.body.plcRegisters ?? req.body.plc_registers,
      plcUnitId: req.body.plcUnitId ?? req.body.plc_unit_id,
      plcStartRegister: req.body.plcStartRegister ?? req.body.plc_start_register,
      plcStatusRegister: req.body.plcStatusRegister ?? req.body.plc_status_register,
      plcResetRegister: req.body.plcResetRegister ?? req.body.plc_reset_register,
      plcStartValue: req.body.plcStartValue ?? req.body.plc_start_value,
      plcStartedValue: req.body.plcStartedValue ?? req.body.plc_started_value,
      plcEndOkValue: req.body.plcEndOkValue ?? req.body.plc_end_ok_value,
      plcEndNgValue: req.body.plcEndNgValue ?? req.body.plc_end_ng_value,
      plcResetValue: req.body.plcResetValue ?? req.body.plc_reset_value,
      plcSlmpDevice: req.body.plcSlmpDevice ?? req.body.plc_slmp_device,
      plcTestTimeoutMs: req.body.plcTestTimeoutMs ?? req.body.plc_test_timeout_ms,
      plcTestRetryCount: req.body.plcTestRetryCount ?? req.body.plc_test_retry_count,
      plcHeartbeatRegister: req.body.plcHeartbeatRegister ?? req.body.plc_heartbeat_register,
      plcHeartbeatStaleMs: req.body.plcHeartbeatStaleMs ?? req.body.plc_heartbeat_stale_ms,
      status: "ACTIVE",
    }, existingMachine);
    await hydratePayloadFromRange(payload);
    const slmpFrameMode = resolveSlmpFrameModeInput(req.body, payload, existingMachine);
    payload.plc_slmp_frame_mode = slmpFrameMode;
    plcContext = {
      ip: payload.plc_ip,
      port: payload.plc_port,
      protocol: payload.plc_protocol,
    };

    if (!payload.plc_ip || !payload.plc_port) {
      return res.status(400).json({ error: "plcIp and plcPort are required for PLC test" });
    }

    if (payload.plc_protocol === "MODBUS_TCP" && !Number.isFinite(Number(payload.plc_status_register))) {
      return res.status(400).json({ error: "plcConfig.statusRegister is required for MODBUS_TCP test" });
    }

    const probe = await plcService.testPlcConnection({
      ip: payload.plc_ip,
      port: payload.plc_port,
      protocol: payload.plc_protocol,
      machine: payload,
    });

    res.json({
      message: "PLC connection test successful",
      request: {
        machineId: machineId ?? null,
        protocol: payload.plc_protocol,
        ip: payload.plc_ip,
        port: payload.plc_port,
        statusRegister: payload.plc_status_register ?? null,
        slmpDevice: payload.plc_slmp_device || null,
        slmpFrameMode: payload.plc_slmp_frame_mode || "AUTO",
        timeoutMs: payload.plc_test_timeout_ms ?? null,
      },
      probe,
    });
  } catch (error) {
    let baseMessage = error.message || "PLC connection test failed";
    const protocolForHint = String(plcContext.protocol ?? req.body.plcProtocol ?? req.body.plc_protocol ?? "").toUpperCase();
    const ipForHint = plcContext.ip ?? req.body.plcIp ?? req.body.plc_ip ?? req.body.machineIp ?? req.body.machine_ip;
    const portForHint = plcContext.port ?? req.body.plcPort ?? req.body.plc_port ?? req.body.machinePort ?? req.body.machine_port;

    if (/PLC packet timeout/i.test(String(baseMessage || "")) && protocolForHint === "SLMP" && ipForHint && portForHint) {
      try {
        await probeTcpEndpoint({ ip: ipForHint, port: portForHint, timeoutMs: 1500 });
        baseMessage = `${baseMessage}. TCP port is reachable, but SLMP frame got no response. Check PLC open setting and SLMP route params (networkNo/plcNo/ioNo/stationNo).`;
      } catch (_probeError) {
        // keep original message; withPlcConnectivityHint will append transport hint
      }
    }

    const message = withPlcConnectivityHint(baseMessage, {
      ip: plcContext.ip ?? req.body.plcIp ?? req.body.plc_ip ?? req.body.machineIp ?? req.body.machine_ip,
      port: plcContext.port ?? req.body.plcPort ?? req.body.plc_port ?? req.body.machinePort ?? req.body.machine_port,
      protocol: plcContext.protocol ?? req.body.plcProtocol ?? req.body.plc_protocol,
    });
    res.status(400).json({ error: message });
  }
};

exports.resetPlc = async (req, res) => {
  try {
    const machineId = toInt(req.body.machineId ?? req.body.id);
    const existingMachine = machineId !== null ? await Machine.findByPk(machineId) : null;
    if (machineId !== null && !existingMachine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const payload = toMachinePayload({
      machineName: req.body.machineName || "PLC_RESET",
      lineName: req.body.lineName || "LINE",
      sequenceNo: req.body.sequenceNo ?? 1,
      operationNo: req.body.operationNo || req.body.stationNo || "OP-RESET",
      plcIp: req.body.plcIp ?? req.body.plc_ip ?? req.body.machineIp ?? req.body.machine_ip,
      plcPort: req.body.plcPort ?? req.body.plc_port ?? req.body.machinePort ?? req.body.machine_port,
      plcProtocol: req.body.plcProtocol ?? req.body.plc_protocol,
      plcConfig: req.body.plcConfig,
      plcRegisters: req.body.plcRegisters ?? req.body.plc_registers,
      plcUnitId: req.body.plcUnitId ?? req.body.plc_unit_id,
      plcStartRegister: req.body.plcStartRegister ?? req.body.plc_start_register,
      plcStatusRegister: req.body.plcStatusRegister ?? req.body.plc_status_register,
      plcResetRegister: req.body.plcResetRegister ?? req.body.plc_reset_register,
      plcStartValue: req.body.plcStartValue ?? req.body.plc_start_value,
      plcStartedValue: req.body.plcStartedValue ?? req.body.plc_started_value,
      plcEndOkValue: req.body.plcEndOkValue ?? req.body.plc_end_ok_value,
      plcEndNgValue: req.body.plcEndNgValue ?? req.body.plc_end_ng_value,
      plcResetValue: req.body.plcResetValue ?? req.body.plc_reset_value,
      plcTestTimeoutMs: req.body.plcTestTimeoutMs ?? req.body.plc_test_timeout_ms,
      plcTestRetryCount: req.body.plcTestRetryCount ?? req.body.plc_test_retry_count,
      plcHeartbeatRegister: req.body.plcHeartbeatRegister ?? req.body.plc_heartbeat_register,
      plcHeartbeatStaleMs: req.body.plcHeartbeatStaleMs ?? req.body.plc_heartbeat_stale_ms,
      status: "ACTIVE",
    }, existingMachine);
    await hydratePayloadFromRange(payload);
    payload.plc_slmp_frame_mode = resolveSlmpFrameModeInput(req.body, payload, existingMachine);

    if (!payload.plc_ip || !payload.plc_port) {
      return res.status(400).json({ error: "plcIp and plcPort are required for PLC reset" });
    }

    if (payload.plc_protocol === "MODBUS_TCP" && !Number.isFinite(Number(payload.plc_reset_register))) {
      return res.status(400).json({ error: "plcConfig.resetRegister is required for MODBUS_TCP reset" });
    }

    const reset = await plcService.resetPlcState({
      ip: payload.plc_ip,
      port: payload.plc_port,
      protocol: payload.plc_protocol,
      machine: payload,
      stationNo: req.body.stationNo ?? payload.operation_no ?? "",
    });

    if (machineId !== null) {
      await clearMachineLock(machineId);
    }

    res.json({
      message: "PLC reset command sent",
      reset,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "PLC reset failed" });
  }
};

exports.sendPlcCommand = async (req, res) => {
  let plcContext = {};
  try {
    const machineId = toInt(req.body.machineId ?? req.body.id);
    const existingMachine = machineId !== null ? await Machine.findByPk(machineId) : null;
    if (machineId !== null && !existingMachine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const command = normalizeUpper(req.body.command ?? req.body.plcCommand);
    if (!["START_OPERATION", "BLOCK_OPERATION", "RESET_OPERATION"].includes(command)) {
      return res.status(400).json({ error: "Invalid command. Use START_OPERATION, BLOCK_OPERATION, or RESET_OPERATION." });
    }

    const payload = toMachinePayload({
      machineName: req.body.machineName || existingMachine?.machine_name || "PLC_CMD",
      lineName: req.body.lineName || existingMachine?.line_name || "LINE",
      sequenceNo: req.body.sequenceNo ?? existingMachine?.sequence_no ?? 1,
      operationNo: req.body.operationNo || req.body.stationNo || existingMachine?.operation_no || "OP-CMD",
      plcIp: req.body.plcIp ?? req.body.plc_ip ?? req.body.machineIp ?? req.body.machine_ip,
      plcPort: req.body.plcPort ?? req.body.plc_port ?? req.body.machinePort ?? req.body.machine_port,
      plcProtocol: req.body.plcProtocol ?? req.body.plc_protocol ?? existingMachine?.plc_protocol,
      plcConfig: req.body.plcConfig,
      plcRegisters: req.body.plcRegisters ?? req.body.plc_registers,
      plcUnitId: req.body.plcUnitId ?? req.body.plc_unit_id,
      plcStartRegister: req.body.plcStartRegister ?? req.body.plc_start_register,
      plcStatusRegister: req.body.plcStatusRegister ?? req.body.plc_status_register,
      plcStationRegister: req.body.plcStationRegister ?? req.body.plc_station_register,
      plcPartRegister: req.body.plcPartRegister ?? req.body.plc_part_register,
      plcResetRegister: req.body.plcResetRegister ?? req.body.plc_reset_register,
      plcStartValue: req.body.plcStartValue ?? req.body.plc_start_value,
      plcStartedValue: req.body.plcStartedValue ?? req.body.plc_started_value,
      plcEndOkValue: req.body.plcEndOkValue ?? req.body.plc_end_ok_value,
      plcEndNgValue: req.body.plcEndNgValue ?? req.body.plc_end_ng_value,
      plcBlockValue: req.body.plcBlockValue ?? req.body.plc_block_value,
      plcResetValue: req.body.plcResetValue ?? req.body.plc_reset_value,
      plcSlmpDevice: req.body.plcSlmpDevice ?? req.body.plc_slmp_device,
      status: "ACTIVE",
    }, existingMachine);
    await hydratePayloadFromRange(payload);
    payload.plc_slmp_frame_mode = resolveSlmpFrameModeInput(req.body, payload, existingMachine);
    plcContext = {
      ip: payload.plc_ip,
      port: payload.plc_port,
      protocol: payload.plc_protocol,
    };

    if (!payload.plc_ip || !payload.plc_port) {
      return res.status(400).json({ error: "plcIp and plcPort are required for PLC command" });
    }

    const partIdRaw = req.body.partId ?? req.body.part_id ?? null;
    const partId = String(partIdRaw ?? "").trim() || null;
    const stationNo = req.body.stationNo ?? req.body.station_no ?? payload.operation_no ?? null;

    const result = await plcService.sendPlcCommand({
      ip: payload.plc_ip,
      port: payload.plc_port,
      protocol: payload.plc_protocol,
      machine: payload,
      command,
      partId,
      stationNo,
    });

    res.json({
      message: `PLC command sent (${command})`,
      command,
      result,
    });
  } catch (error) {
    const message = withPlcConnectivityHint(error.message || "PLC command failed", {
      ip: plcContext.ip ?? req.body.plcIp ?? req.body.plc_ip ?? req.body.machineIp ?? req.body.machine_ip,
      port: plcContext.port ?? req.body.plcPort ?? req.body.plc_port ?? req.body.machinePort ?? req.body.machine_port,
      protocol: plcContext.protocol ?? req.body.plcProtocol ?? req.body.plc_protocol,
    });
    res.status(400).json({ error: message });
  }
};

exports.writePlcValue = async (req, res) => {
  try {
    const machineId = toInt(req.body.machineId ?? req.body.id);
    const existingMachine = machineId !== null ? await Machine.findByPk(machineId) : null;
    if (machineId !== null && !existingMachine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const payload = toMachinePayload({
      machineName: req.body.machineName || "PLC_WRITE",
      lineName: req.body.lineName || "LINE",
      sequenceNo: req.body.sequenceNo ?? 1,
      operationNo: req.body.operationNo || req.body.stationNo || "OP-WRITE",
      plcIp: req.body.plcIp ?? req.body.plc_ip ?? req.body.machineIp ?? req.body.machine_ip,
      plcPort: req.body.plcPort ?? req.body.plc_port ?? req.body.machinePort ?? req.body.machine_port,
      plcProtocol: req.body.plcProtocol ?? req.body.plc_protocol,
      plcConfig: req.body.plcConfig,
      plcRegisters: req.body.plcRegisters ?? req.body.plc_registers,
      plcUnitId: req.body.plcUnitId ?? req.body.plc_unit_id,
      plcStartRegister: req.body.plcStartRegister ?? req.body.plc_start_register,
      plcStatusRegister: req.body.plcStatusRegister ?? req.body.plc_status_register,
      plcStationRegister: req.body.plcStationRegister ?? req.body.plc_station_register,
      plcResetRegister: req.body.plcResetRegister ?? req.body.plc_reset_register,
      plcStartValue: req.body.plcStartValue ?? req.body.plc_start_value,
      plcStartedValue: req.body.plcStartedValue ?? req.body.plc_started_value,
      plcEndOkValue: req.body.plcEndOkValue ?? req.body.plc_end_ok_value,
      plcEndNgValue: req.body.plcEndNgValue ?? req.body.plc_end_ng_value,
      plcResetValue: req.body.plcResetValue ?? req.body.plc_reset_value,
      plcTestTimeoutMs: req.body.plcTestTimeoutMs ?? req.body.plc_test_timeout_ms,
      plcTestRetryCount: req.body.plcTestRetryCount ?? req.body.plc_test_retry_count,
      plcHeartbeatRegister: req.body.plcHeartbeatRegister ?? req.body.plc_heartbeat_register,
      plcHeartbeatStaleMs: req.body.plcHeartbeatStaleMs ?? req.body.plc_heartbeat_stale_ms,
      status: "ACTIVE",
    }, existingMachine);
    await hydratePayloadFromRange(payload);
    payload.plc_slmp_frame_mode = resolveSlmpFrameModeInput(req.body, payload, existingMachine);

    if (!payload.plc_ip || !payload.plc_port) {
      return res.status(400).json({ error: "plcIp and plcPort are required for PLC write" });
    }

    const protocol = String(payload.plc_protocol || "").toUpperCase();
    if (!["MODBUS_TCP", "SLMP"].includes(protocol)) {
      return res.status(400).json({ error: "Write test value is supported for MODBUS_TCP or SLMP machines only" });
    }

    const signalKey = normalizeUpper(req.body.signalKey || req.body.signal || "");
    const signalRegisterMap = {
      TRIGGER: toInt(payload.plc_start_register),
      INTERLOCK: toInt(payload.plc_status_register),
      COMPLETE: toInt(payload.plc_station_register),
      RESET: toInt(payload.plc_reset_register),
    };
    const configuredSignals = parsePlcSignalMap(payload.plc_signal_map) || [];
    for (const row of configuredSignals) {
      const key = normalizeUpper(row?.key || row?.label || "");
      const registerNo = toInt(row?.register);
      if (!key || registerNo === null) continue;
      if (!Object.prototype.hasOwnProperty.call(signalRegisterMap, key)) {
        signalRegisterMap[key] = registerNo;
      }
    }
    const handshakeEntries = buildHandshakeRegisterEntries(payload);
    for (const row of handshakeEntries) {
      const key = normalizeUpper(String(row?.signal || "").replace(/[^A-Z0-9]+/g, "_"));
      const registerNo = toInt(row?.register);
      if (!key || registerNo === null) continue;
      if (!Object.prototype.hasOwnProperty.call(signalRegisterMap, key)) {
        signalRegisterMap[key] = registerNo;
      }
    }

    let registerNo = toInt(req.body.registerNo ?? req.body.register ?? req.body.address);
    if (registerNo === null && signalKey) {
      registerNo = signalRegisterMap[signalKey] ?? null;
    }
    if (registerNo === null) {
      return res.status(400).json({ error: "registerNo is required (or select mapped signalKey)" });
    }

    const value = toInt(req.body.value);
    if (value === null) {
      return res.status(400).json({ error: "value is required for write" });
    }

    const timeoutMs = toInt(req.body.timeoutMs ?? payload.plc_test_timeout_ms) || 2000;
    let write = null;
    if (protocol === "SLMP") {
      const slmpDevice =
        normalizeUpper(req.body.device ?? req.body.plcSlmpDevice ?? resolveSlmpDeviceForSignal(signalKey || "TRIGGER", payload)) ||
        "D";
      write = await writeSlmpRegister({
        ip: payload.plc_ip,
        port: payload.plc_port,
        register: registerNo,
        value,
        device: slmpDevice,
        timeoutMs,
        frameMode: payload.plc_slmp_frame_mode,
      });
    } else {
      write = await writeModbusRegister({
        ip: payload.plc_ip,
        port: payload.plc_port,
        unitId: payload.plc_unit_id || 1,
        register: registerNo,
        value,
        timeoutMs,
      });
    }

    res.json({
      message: "PLC register write successful",
      write: {
        protocol,
        device: write.device || null,
        frameMode: write.frameMode || payload.plc_slmp_frame_mode || null,
        route: write.route || null,
        signalKey: signalKey || null,
        registerNo: write.register,
        value: write.value,
        timeoutMs,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "PLC register write failed" });
  }
};

exports.updateMachineTarget = async (req, res) => {
  try {
    const machine = await Machine.findByPk(req.params.id);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const target = toInt(req.body.dailyTargetQty ?? req.body.daily_target_qty ?? req.body.targetQty ?? req.body.target_qty);
    if (target === null || target < 0 || target > 1000000) {
      return res.status(400).json({ error: "dailyTargetQty must be between 0 and 1000000" });
    }

    await machine.update({ daily_target_qty: target });
    res.json({
      message: "Machine target updated",
      machine: toMachineResponse(machine),
    });
  } catch (error) {
    handleSequelizeError(error, res);
  }
};

exports.deleteMachine = async (req, res) => {
  try {
    const machine = await Machine.findByPk(req.params.id);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }
    await machine.destroy();
    res.status(204).send();
  } catch (error) {
    handleSequelizeError(error, res);
  }
};
