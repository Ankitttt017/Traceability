const { Sequelize } = require("sequelize");
const Machine = require("../models/Machine");
const MachineRuntimeState = require("../models/MachineRuntimeState");
const Alarm = require("../models/Alarm");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const Scanner = require("../models/Scanner");
const plcService = require("../services/plcCommunicationService");
const {
  readModbusRegisters,
  readSlmpRegisters,
  writeModbusRegister,
  writeSlmpRegister,
} = require("../services/plcIoService");
const { getMachineBypass } = require("../services/machineBypassService");
const {
  FILTERED_QR_SCANNER_INDEX,
  ensureMachineQrScannerUniqueness,
} = require("../services/machineSchemaService");

function toInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function parseRegisterToken(rawValue, fallbackDevice = null) {
  const text = String(rawValue ?? "").trim().toUpperCase();
  if (!text) {
    return { register: null, device: fallbackDevice };
  }
  const direct = Number(text);
  if (Number.isFinite(direct)) {
    return { register: Math.trunc(direct), device: fallbackDevice };
  }
  const match = text.match(/^([A-Z]+)?\s*(\d+)$/);
  if (!match) {
    return { register: null, device: fallbackDevice };
  }
  const register = Number(match[2]);
  if (!Number.isFinite(register)) {
    return { register: null, device: fallbackDevice };
  }
  return {
    register: Math.trunc(register),
    device: String(match[1] || fallbackDevice || "").trim().toUpperCase() || fallbackDevice,
  };
}

function toPositiveInt(value) {
  const parsed = toInt(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

function toText(value) {
  return String(value || "").trim();
}

function parseJson(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function normalizeProtocol(value, fallback = "TCP_TEXT") {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (normalized === "MODBUS" || normalized === "MODBUS_TCP") return "MODBUS_TCP";
  if (normalized === "SLMP") return "SLMP";
  if (["TCP", "TEXT", "TCP_TEXT"].includes(normalized)) return "TCP_TEXT";
  return fallback;
}

function normalizeStatus(value, fallback = "ACTIVE") {
  return String(value || fallback).trim().toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE";
}

function normalizeDirection(value, fallback = "READ") {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (normalized === "PC -> PLC" || normalized === "PC_TO_PLC") return "WRITE";
  if (normalized === "PLC -> PC" || normalized === "PLC_TO_PC") return "READ";
  if (["WRITE", "READ", "BOTH", "BIDIRECTIONAL"].includes(normalized)) return normalized === "BIDIRECTIONAL" ? "BOTH" : normalized;
  return fallback;
}

function normalizeFrameMode(value, fallback = "AUTO") {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (normalized === "ASCII" || normalized === "BINARY" || normalized === "AUTO") {
    return normalized;
  }
  return fallback;
}

function normalizeHandshakeMap(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const parsedRegister = parseRegisterToken(row?.register, null);
      return {
        id: row?.id || null,
        signal: toText(row?.signal || row?.label),
        direction: normalizeDirection(row?.direction, "READ"),
        register: parsedRegister.register,
        value: toInt(row?.value),
        meaning: toText(row?.meaning || row?.purpose || row?.description),
        required: row?.required !== false,
        category: toText(row?.category || "handshake") || "handshake",
        frameMode: normalizeFrameMode(row?.frameMode ?? row?.slmpFrameMode, "AUTO"),
      };
    })
    .filter((row) => row.signal || row.register !== null);
}

function normalizeDataRegisterRanges(value, fallbackFrameMode = "AUTO") {
  if (!Array.isArray(value)) return [];
  return value.map((row, index) => {
    const startReg = toInt(row?.startReg);
    const count = toInt(row?.count) ?? 1;
    const endFromCount = startReg !== null ? startReg + Math.max(count, 1) - 1 : null;
    return {
      id: row?.id || `range_${index + 1}`,
      name: toText(row?.name || row?.label || `Range ${index + 1}`),
      device: toText(row?.device || "D").toUpperCase() || "D",
      startReg,
      endReg: toInt(row?.endReg) ?? endFromCount,
      count: Math.max(count, 1),
      dataType: toText(row?.dataType || "INT16").toUpperCase() || "INT16",
      scale: Number.isFinite(Number(row?.scale)) ? Number(row.scale) : 1,
      unit: toText(row?.unit),
      purpose: toText(row?.purpose),
      formula: toText(row?.formula),
      toleranceMin: row?.toleranceMin === "" ? null : toInt(row?.toleranceMin),
      toleranceMax: row?.toleranceMax === "" ? null : toInt(row?.toleranceMax),
      frameMode: normalizeFrameMode(row?.frameMode ?? row?.slmpFrameMode, fallbackFrameMode),
    };
  });
}

function normalizePlcSignalMap(value) {
  if (value === undefined || value === null || value === "") return [];
  const source = parseJson(value, []);
  if (!Array.isArray(source)) return [];
  return source.map((row) => {
    const explicitDevice = toText(row?.device).toUpperCase() || null;
    const parsed = parseRegisterToken(row?.register ?? row?.registerNo ?? row?.address, explicitDevice);
    return {
      key: toText(row?.key || row?.signal || row?.name).toUpperCase(),
      label: toText(row?.label || row?.key || row?.signal || row?.name),
      register: parsed.register,
      device: parsed.device || explicitDevice,
      direction: row?.direction || null,
      writable: row?.writable === undefined ? undefined : Boolean(row.writable),
      description: toText(row?.description),
    };
  });
}

function normalizeSpcConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const resolvedMode = String(source.activeProtocol || source.mode || "TCP_CLIENT").trim().toUpperCase();
  const protocolConfig = source.protocolConfig && typeof source.protocolConfig === "object" ? source.protocolConfig : {};
  const parser = source.parser && typeof source.parser === "object" ? source.parser : {};
  const reliability = source.reliability && typeof source.reliability === "object" ? source.reliability : {};
  return {
    enabled: source.enabled === true,
    mode: resolvedMode,
    activeProtocol: resolvedMode,
    activeProtocols: [resolvedMode],
    priority: [resolvedMode],
    
    // Core acquisition settings
    sourceIp: toText(source.sourceIp) || null,
    sourcePort: toInt(source.sourcePort),
    payloadResultKey: toText(source.payloadResultKey || "RESULT") || "RESULT",
    protocolConfig: {
      sourceIp: toText(protocolConfig.sourceIp || source.sourceIp) || null,
      sourcePort: toInt(protocolConfig.sourcePort ?? source.sourcePort),
      listenerIp: toText(protocolConfig.listenerIp) || null,
      listenerPort: toInt(protocolConfig.listenerPort),
      allowedSourceIp: toText(protocolConfig.allowedSourceIp) || null,
      comPort: toText(protocolConfig.comPort || source.sourceIp) || null,
      folderPath: toText(protocolConfig.folderPath || source.folderConfig?.path) || null,
      delimiter: toText(protocolConfig.delimiter) || null,
      encoding: toText(protocolConfig.encoding || "utf8") || "utf8",
      markingEnabled: protocolConfig.markingEnabled === true,
      markingSecondaryProtocol: toText(protocolConfig.markingSecondaryProtocol || "TCP_CLIENT").toUpperCase() || "TCP_CLIENT",
      markingSecondaryIp: toText(protocolConfig.markingSecondaryIp) || null,
      markingSecondaryPort: toInt(protocolConfig.markingSecondaryPort),
      markingSecondaryComPort: toText(protocolConfig.markingSecondaryComPort) || null,
      markingCustomerQrKey: toText(protocolConfig.markingCustomerQrKey || "customer_qr") || "customer_qr",
    },
    parser: {
      mode: toText(parser.mode || "JSON").toUpperCase() || "JSON",
      regex: toText(parser.regex),
      delimiter: toText(parser.delimiter || ","),
      fixedLength: toText(parser.fixedLength),
    },
    
    // Reliability Engine (Requirement 5)
    retryCount: toInt(reliability.retryCount ?? source.retryCount) ?? 4,
    retryDelayMs: toInt(reliability.retryDelayMs ?? source.retryDelayMs) ?? 1500,
    timeoutMs: toInt(reliability.timeoutMs ?? source.timeoutMs) ?? 12000,
    reliability: {
      timeoutMs: toInt(reliability.timeoutMs ?? source.timeoutMs) ?? 12000,
      retryCount: toInt(reliability.retryCount ?? source.retryCount) ?? 4,
      retryDelayMs: toInt(reliability.retryDelayMs ?? source.retryDelayMs) ?? 1500,
      autoReconnect: reliability.autoReconnect !== false,
      heartbeat: toText(reliability.heartbeat || ""),
    },

    // Dynamic Register Mapping (Requirement 21)
    dynamicRegisters: Array.isArray(source.dynamicRegisters) ? source.dynamicRegisters.map(r => ({
      name: toText(r.name) || "PARAM",
      register: toInt(r.register),
      device: toText(r.device || "D").toUpperCase(),
      type: toText(r.type || "INT16").toUpperCase(),
      scale: parseFloat(r.scale) || 1.0,
      unit: toText(r.unit) || ""
    })) : [],
    fieldMappings: Array.isArray(source.fieldMappings) ? source.fieldMappings : [],

    // Folder Watcher Config (Requirement 1)
    folderConfig: {
      path: toText(source.folderConfig?.path) || "",
      pattern: toText(source.folderConfig?.pattern) || "*.*",
      parser: toText(source.folderConfig?.parser || "JSON").toUpperCase(),
      deleteAfterRead: source.folderConfig?.deleteAfterRead !== false
    },

    // Legacy/Standard fields (maintained for compatibility)
    payloadResultNgValues: Array.isArray(source.payloadResultNgValues) ? source.payloadResultNgValues : String(source.payloadResultNgValues || "").split(/[,\n;|]/).map(e => toText(e).toUpperCase()).filter(Boolean),
    qualityPayloadKeys: Array.isArray(source.qualityPayloadKeys) ? source.qualityPayloadKeys : String(source.qualityPayloadKeys || "").split(/[,\n;|]/).map(e => toText(e)).filter(Boolean),
    plcResultRegister: toInt(source.plcResultRegister),
    plcResultDevice: toText(source.plcResultDevice || "D").toUpperCase() || "D",
    plcResultOkValues: Array.isArray(source.plcResultOkValues) ? source.plcResultOkValues : String(source.plcResultOkValues || "").split(/[,\n;|]/).map(e => toText(e).toUpperCase()).filter(Boolean),
    plcResultNgValues: Array.isArray(source.plcResultNgValues) ? source.plcResultNgValues : String(source.plcResultNgValues || "").split(/[,\n;|]/).map(e => toText(e).toUpperCase()).filter(Boolean),
    plcAckEnabled: source.plcAckEnabled !== false,
    plcAckRegister: toInt(source.plcAckRegister),
    plcAckDevice: toText(source.plcAckDevice || "D").toUpperCase() || "D",
    plcAckOkValue: toInt(source.plcAckOkValue),
    plcAckNgValue: toInt(source.plcAckNgValue),
    plcAckErrorValue: toInt(source.plcAckErrorValue),
  };
}

function buildParsedPlcSnapshot(machine) {
  const parsed = parseJson(machine?.plc_registers, {}) || {};
  const handshakeMap = normalizeHandshakeMap(parsed.handshakeMap);
  const defaultFrameMode = normalizeFrameMode(parsed.slmpFrameMode || machine?.plc_slmp_frame_mode || "AUTO", "AUTO");
  const plcConfig = {
    rangeId: toInt(parsed.rangeId ?? machine?.plc_range_id),
    startRegister: toInt(parsed.startRegister ?? machine?.plc_start_register),
    statusRegister: toInt(parsed.statusRegister ?? parsed.runningRegister ?? machine?.plc_status_register),
    runningRegister: toInt(parsed.runningRegister ?? machine?.plc_status_register),
    blockRegister: toInt(parsed.blockRegister),
    endOkRegister: toInt(parsed.endOkRegister),
    endNgRegister: toInt(parsed.endNgRegister),
    partRegister: toInt(parsed.partRegister ?? machine?.plc_part_register),
    stationRegister: toInt(parsed.stationRegister ?? machine?.plc_station_register),
    resetRegister: toInt(parsed.resetRegister ?? machine?.plc_reset_register),
    heartbeatRegister: toInt(parsed.heartbeatRegister ?? machine?.plc_heartbeat_register),
    bypassRegister: toInt(parsed.bypassRegister),
    startValue: toInt(parsed.startValue ?? machine?.plc_start_value),
    startedValue: toInt(parsed.startedValue ?? machine?.plc_started_value),
    endOkValue: toInt(parsed.endOkValue ?? machine?.plc_end_ok_value),
    endNgValue: toInt(parsed.endNgValue ?? machine?.plc_end_ng_value),
    blockValue: toInt(parsed.blockValue ?? machine?.plc_block_value),
    resetValue: toInt(parsed.resetValue ?? machine?.plc_reset_value),
    slmpFrameMode: defaultFrameMode,
    handshakeMap,
    dataRegisterRanges: normalizeDataRegisterRanges(parsed.dataRegisterRanges, defaultFrameMode),
  };

  return {
    plcConfig,
    plcSignalMap: normalizePlcSignalMap(machine?.plc_signal_map),
    spcConfig: normalizeSpcConfig(parsed.spcConfig || {}),
  };
}

function toMachineResponse(machine) {
  const plain = typeof machine?.get === "function" ? machine.get({ plain: true }) : machine;
  const { plcConfig, plcSignalMap, spcConfig } = buildParsedPlcSnapshot(plain);
  const bypass = getMachineBypass(plain.id);
  return {
    id: plain.id,
    machineNumber: plain.machine_number,
    machineName: plain.machine_name,
    machineType: plain.machine_type || "HPDC",
    lineName: plain.line_name,
    sequenceNo: plain.sequence_no,
    operationNo: plain.operation_no,
    machineIp: plain.machine_ip,
    machinePort: plain.machine_port,
    qrScannerIp: plain.qr_scanner_ip,
    plcIp: plain.plc_ip,
    plcPort: plain.plc_port,
    plcRangeId: plain.plc_range_id,
    plcProtocol: normalizeProtocol(plain.plc_protocol, "TCP_TEXT"),
    plcUnitId: plain.plc_unit_id || 1,
    plcSlmpDevice: "D",
    plcSlmpFrameMode: plcConfig.slmpFrameMode || "AUTO",
    plcStartRegister: plain.plc_start_register,
    plcStatusRegister: plain.plc_status_register,
    plcBlockRegister: plain.plc_block_register,
    plcPartRegister: plain.plc_part_register,
    plcStationRegister: plain.plc_station_register,
    plcResetRegister: plain.plc_reset_register,
    plcStartValue: plain.plc_start_value,
    plcStartedValue: plain.plc_started_value,
    plcEndOkValue: plain.plc_end_ok_value,
    plcEndNgValue: plain.plc_end_ng_value,
    plcBlockValue: plain.plc_block_value,
    plcResetValue: plain.plc_reset_value,
    plcHeartbeatRegister: plain.plc_heartbeat_register,
    plcHeartbeatStaleMs: plain.plc_heartbeat_stale_ms,
    plcTestTimeoutMs: plain.plc_test_timeout_ms,
    plcTestRetryCount: plain.plc_test_retry_count,
    dailyTargetQty: plain.daily_target_qty,
    status: plain.status || "ACTIVE",
    isActive: plain.is_active !== false,
    isRunning: Boolean(plain.is_running),
    runningPartId: plain.running_part_id || null,
    runningStationNo: plain.running_station_no || null,
    runningStartedAt: plain.running_started_at || null,
    cycleTime: plain.cycle_time || 0,
    loadingTime: plain.loading_time || 0,
    plcConfig,
    plcSignalMap,
    spcConfig,
    machineBypassEnabled: Boolean(bypass?.enabled),
    machineBypassReason: bypass?.reason || null,
    machineBypassUpdatedAt: bypass?.updatedAt || null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function buildMachineNumberSeed(payload) {
  const preferred = toText(payload.machineNumber || payload.machine_number);
  if (preferred) return preferred.toUpperCase();
  const op = toText(payload.operationNo || payload.operation_no).toUpperCase();
  const seq = toInt(payload.sequenceNo ?? payload.sequence_no);
  if (op && seq !== null) return `${op}-${String(seq).padStart(2, "0")}`;
  if (op) return op;
  return `M-${Date.now()}`;
}

async function ensureUniqueMachineNumber(seed, excludeId = null) {
  let base = String(seed || "").trim().toUpperCase() || `M-${Date.now()}`;
  let candidate = base;
  let suffix = 1;
  while (true) {
    const existing = await Machine.findOne({
      where: excludeId ? { machine_number: candidate, id: { [Sequelize.Op.ne]: excludeId } } : { machine_number: candidate },
    });
    if (!existing) {
      return candidate;
    }
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

function normalizePayload(body = {}, existing = null) {
  const parsedExisting = existing ? buildParsedPlcSnapshot(existing).plcConfig : {};
  const cfgRaw = body.plcConfig && typeof body.plcConfig === "object" ? body.plcConfig : {};
  const normalizedProtocol = normalizeProtocol(body.plcProtocol ?? body.plc_protocol ?? existing?.plc_protocol ?? "TCP_TEXT");
  const slmpFrameMode = toText(body.plcSlmpFrameMode || cfgRaw.slmpFrameMode || existing?.plc_slmp_frame_mode || parsedExisting.slmpFrameMode || "AUTO")
    .toUpperCase();

  const plcConfig = {
    rangeId: toInt(cfgRaw.rangeId ?? body.plcRangeId ?? body.plc_range_id ?? existing?.plc_range_id),
    startRegister: toInt(cfgRaw.startRegister ?? body.plcStartRegister ?? body.plc_start_register ?? existing?.plc_start_register ?? null),
    statusRegister: toInt(
      cfgRaw.statusRegister ??
        cfgRaw.runningRegister ??
        body.plcStatusRegister ??
        body.plc_status_register ??
        existing?.plc_status_register ?? null
    ),
    runningRegister: toInt(cfgRaw.runningRegister ?? existing?.plc_status_register ?? null),
    blockRegister: toInt(cfgRaw.blockRegister ?? body.plcBlockRegister ?? body.plc_block_register ?? null),
    endOkRegister: toInt(cfgRaw.endOkRegister ?? body.plcEndOkRegister ?? body.plc_end_ok_register ?? null),
    endNgRegister: toInt(cfgRaw.endNgRegister ?? body.plcEndNgRegister ?? body.plc_end_ng_register ?? null),
    partRegister: toInt(cfgRaw.partRegister ?? body.plcPartRegister ?? body.plc_part_register ?? existing?.plc_part_register ?? null),
    stationRegister: toInt(cfgRaw.stationRegister ?? body.plcStationRegister ?? body.plc_station_register ?? existing?.plc_station_register ?? null),
    resetRegister: toInt(cfgRaw.resetRegister ?? body.plcResetRegister ?? body.plc_reset_register ?? existing?.plc_reset_register ?? null),
    heartbeatRegister: toInt(cfgRaw.heartbeatRegister ?? body.plcHeartbeatRegister ?? existing?.plc_heartbeat_register ?? null),
    bypassRegister: toInt(cfgRaw.bypassRegister ?? body.plcBypassRegister ?? null),
    startValue: toInt(cfgRaw.startValue ?? body.plcStartValue ?? body.plc_start_value ?? existing?.plc_start_value ?? null),
    startedValue: toInt(cfgRaw.startedValue ?? body.plcStartedValue ?? body.plc_started_value ?? existing?.plc_started_value ?? null),
    endOkValue: toInt(cfgRaw.endOkValue ?? body.plcEndOkValue ?? body.plc_end_ok_value ?? existing?.plc_end_ok_value ?? null),
    endNgValue: toInt(cfgRaw.endNgValue ?? body.plcEndNgValue ?? body.plc_end_ng_value ?? existing?.plc_end_ng_value ?? null),
    blockValue: toInt(cfgRaw.blockValue ?? body.plcBlockValue ?? body.plc_block_value ?? existing?.plc_block_value ?? null),
    resetValue: toInt(cfgRaw.resetValue ?? body.plcResetValue ?? body.plc_reset_value ?? existing?.plc_reset_value ?? null),
    slmpFrameMode,
    handshakeMap: normalizeHandshakeMap(cfgRaw.handshakeMap),
    dataRegisterRanges: normalizeDataRegisterRanges(cfgRaw.dataRegisterRanges, slmpFrameMode),
  };

  const spcConfig = normalizeSpcConfig(body.spcConfig || {});
  const plcSignalMap = normalizePlcSignalMap(body.plcSignalMap ?? body.plc_signal_map);

  const payload = {
    machine_name: toText(body.machineName ?? body.machine_name ?? existing?.machine_name),
    machine_type: toText(body.machineType ?? body.machine_type ?? existing?.machine_type) || "HPDC",
    line_name: toText(body.lineName ?? body.line_name ?? existing?.line_name) || "-",
    sequence_no: toInt(body.sequenceNo ?? body.sequence_no ?? existing?.sequence_no),
    operation_no: toText(body.operationNo ?? body.operation_no ?? existing?.operation_no).toUpperCase(),
    machine_ip: toText(body.machineIp ?? body.machine_ip ?? body.plcIp ?? body.plc_ip ?? existing?.machine_ip ?? existing?.plc_ip) || "0.0.0.0",
    machine_port: toInt(body.machinePort ?? body.machine_port ?? body.plcPort ?? body.plc_port ?? existing?.machine_port ?? existing?.plc_port),
    qr_scanner_ip: toText(body.qrScannerIp ?? body.qr_scanner_ip ?? existing?.qr_scanner_ip) || null,
    plc_ip: toText(body.plcIp ?? body.plc_ip ?? existing?.plc_ip ?? body.machineIp ?? body.machine_ip) || null,
    plc_port: toInt(body.plcPort ?? body.plc_port ?? existing?.plc_port ?? body.machinePort ?? body.machine_port),
    plc_range_id: toInt(plcConfig.rangeId),
    plc_protocol: normalizedProtocol,
    plc_signal_map: plcSignalMap.length ? JSON.stringify(plcSignalMap) : null,
    plc_unit_id: toInt(body.plcUnitId ?? body.plc_unit_id ?? existing?.plc_unit_id ?? 1) || 1,
    plc_start_register: toInt(plcConfig.startRegister),
    plc_status_register: toInt(plcConfig.statusRegister ?? plcConfig.runningRegister),
    plc_block_register: toInt(plcConfig.blockRegister),
    plc_part_register: toInt(plcConfig.partRegister),
    plc_station_register: toInt(plcConfig.stationRegister),
    plc_reset_register: toInt(plcConfig.resetRegister),
    plc_start_value: toInt(plcConfig.startValue),
    plc_started_value: toInt(plcConfig.startedValue),
    plc_end_ok_value: toInt(plcConfig.endOkValue),
    plc_end_ng_value: toInt(plcConfig.endNgValue),
    plc_block_value: toInt(plcConfig.blockValue),
    plc_reset_value: toInt(plcConfig.resetValue),
    plc_slmp_frame_mode: slmpFrameMode,
    plc_test_timeout_ms: toPositiveInt(body.plcTestTimeoutMs ?? body.plc_test_timeout_ms ?? existing?.plc_test_timeout_ms),
    plc_test_retry_count: toPositiveInt(body.plcTestRetryCount ?? body.plc_test_retry_count ?? existing?.plc_test_retry_count),
    plc_heartbeat_register: toInt(plcConfig.heartbeatRegister),
    plc_heartbeat_stale_ms: toPositiveInt(body.plcHeartbeatStaleMs ?? body.plc_heartbeat_stale_ms ?? existing?.plc_heartbeat_stale_ms),
    daily_target_qty: toPositiveInt(body.dailyTargetQty ?? body.daily_target_qty ?? existing?.daily_target_qty ?? 0) ?? 0,
    cycle_time: toPositiveInt(body.cycleTime ?? body.cycle_time ?? existing?.cycle_time ?? 0) ?? 0,
    loading_time: toPositiveInt(body.loadingTime ?? body.loading_time ?? existing?.loading_time ?? 0) ?? 0,
    status: normalizeStatus(body.status ?? existing?.status ?? "ACTIVE"),
    is_active:
      body.isActive !== undefined || body.is_active !== undefined
        ? Boolean(body.isActive ?? body.is_active)
        : normalizeStatus(body.status ?? existing?.status ?? "ACTIVE") === "ACTIVE",
  };

  payload.plc_registers = JSON.stringify({
    ...plcConfig,
    statusRegister: payload.plc_status_register,
    runningRegister: payload.plc_status_register,
    rangeId: payload.plc_range_id,
    slmpFrameMode: payload.plc_slmp_frame_mode || "AUTO",
    handshakeMap: plcConfig.handshakeMap,
    spcConfig,
  });

  return payload;
}

function parsePlcSnapshotFromPayload(payload = {}) {
  try {
    const parsed = payload?.plc_registers ? JSON.parse(payload.plc_registers) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function validateIndustrialMachinePayload(payload = {}) {
  const errors = [];
  if (!payload.machine_name) {
    errors.push("Machine name is required.");
  }
  if (!payload.operation_no) {
    errors.push("Operation number is required.");
  }
  if (payload.sequence_no === null || payload.sequence_no === undefined) {
    errors.push("Sequence number is required.");
  }
  return errors;
}

function sequelizeErrorToHttp(error) {
  if (error) {
    console.error("[Database Error] Handled by sequelizeErrorToHttp:", {
      name: error.name,
      message: error.message,
      errors: error.errors?.map(e => ({ message: e.message, path: e.path, value: e.value })),
      parent: error.parent?.message,
      original: error.original?.message
    });
  }
  if (error?.name === "SequelizeUniqueConstraintError") {
    const rawDetails = (error.errors || []).map((entry) => entry.path).filter(Boolean);
    const normalizedDetails = rawDetails.map((detail) => {
      const token = String(detail || "").trim();
      const normalizedToken = token.replace(/[\[\]`"' ]/g, "");
      const lowerToken = normalizedToken.toLowerCase();
      const sqlText = [error?.message, error?.parent?.message, error?.original?.message]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (
        token === FILTERED_QR_SCANNER_INDEX ||
        lowerToken.includes("qr_scanner_ip") ||
        sqlText.includes(FILTERED_QR_SCANNER_INDEX.toLowerCase()) ||
        sqlText.includes("uq__machines__fa6f4bfb")
      ) {
        return "qrScannerIp";
      }
      if (lowerToken.includes("machine_number")) {
        return "machineNumber";
      }
      return token;
    });

    return {
      status: 409,
      body: {
        error: "Duplicate value violates unique constraint",
        details: normalizedDetails.length > 0 ? normalizedDetails : rawDetails,
      },
    };
  }
  if (error instanceof Sequelize.ValidationError) {
    return {
      status: 400,
      body: {
        error: "Validation failed",
        details: (error.errors || []).map((entry) => entry.message),
      },
    };
  }
  return null;
}

function isLegacyQrScannerUniqueConflict(error) {
  if (!error) return false;
  const sqlText = [error?.message, error?.parent?.message, error?.original?.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return sqlText.includes("uq__machines__fa6f4bfb") || sqlText.includes(FILTERED_QR_SCANNER_INDEX.toLowerCase());
}

async function resolveMachineForPlc(body = {}) {
  const machineId = toInt(body.machineId ?? body.machine_id);
  if (!machineId) return null;
  return Machine.findByPk(machineId);
}

function resolvePlcEndpoint(body = {}, machine = null) {
  const ip = toText(body.plcIp ?? body.plc_ip ?? machine?.plc_ip ?? machine?.machine_ip);
  const port = toInt(body.plcPort ?? body.plc_port ?? machine?.plc_port ?? machine?.machine_port);
  const protocol = normalizeProtocol(body.plcProtocol ?? body.plc_protocol ?? machine?.plc_protocol ?? "TCP_TEXT");
  return { ip: ip || null, port, protocol };
}

function buildPlcMachineSnapshot(machine, body = {}) {
  const raw = machine ? machine.get({ plain: true }) : {};
  const snapshot = { ...raw };
  if (toInt(body.plcStatusRegister) !== null) snapshot.plc_status_register = toInt(body.plcStatusRegister);
  if (toInt(body.plcStartRegister) !== null) snapshot.plc_start_register = toInt(body.plcStartRegister);
  if (toInt(body.plcResetRegister) !== null) snapshot.plc_reset_register = toInt(body.plcResetRegister);
  if (toInt(body.plcPartRegister) !== null) snapshot.plc_part_register = toInt(body.plcPartRegister);
  if (toInt(body.plcStationRegister) !== null) snapshot.plc_station_register = toInt(body.plcStationRegister);
  if (toInt(body.plcUnitId) !== null) snapshot.plc_unit_id = toInt(body.plcUnitId);
  if (toInt(body.plcTestTimeoutMs) !== null) snapshot.plc_test_timeout_ms = toInt(body.plcTestTimeoutMs);
  if (toInt(body.plcTestRetryCount) !== null) snapshot.plc_test_retry_count = toInt(body.plcTestRetryCount);
  if (toText(body.plcProtocol)) snapshot.plc_protocol = normalizeProtocol(body.plcProtocol);

  const parsedRegisters = parseJson(snapshot.plc_registers, {}) || {};
  const slmpFrameMode = toText(body.plcSlmpFrameMode || body.plc_slmp_frame_mode || parsedRegisters.slmpFrameMode || snapshot.plc_slmp_frame_mode || "AUTO")
    .toUpperCase();
  snapshot.plc_slmp_frame_mode = slmpFrameMode;
  snapshot.plc_registers = JSON.stringify({
    ...parsedRegisters,
    slmpFrameMode,
  });

  return snapshot;
}

function resolveWritableRegisterFromSignal(machine, signalKey) {
  const key = toText(signalKey).toUpperCase();
  if (!key) return null;
  const byKey = {
    TRIGGER: machine?.plc_start_register,
    START: machine?.plc_start_register,
    START_OPERATION: machine?.plc_start_register,
    INTERLOCK: machine?.plc_status_register,
    STATUS: machine?.plc_status_register,
    COMPLETE: machine?.plc_station_register,
    STATION_HASH: machine?.plc_station_register,
    PART_HASH: machine?.plc_part_register,
    PART_ID_HASH: machine?.plc_part_register,
    RESET: machine?.plc_reset_register,
    RESET_OPERATION: machine?.plc_reset_register,
  };
  const mapped = toInt(byKey[key]);
  if (mapped !== null) return mapped;

  const parsedMap = normalizePlcSignalMap(machine?.plc_signal_map);
  const found = parsedMap.find((row) => row.key === key);
  return toInt(found?.register);
}

function resolveSignalMapEntry(machine, signalKey) {
  const key = toText(signalKey).toUpperCase();
  if (!key) return null;
  const parsedMap = normalizePlcSignalMap(machine?.plc_signal_map);
  return parsedMap.find((row) => row.key === key) || null;
}

exports.getMachines = async (_req, res) => {
  try {
    const rows = await Machine.findAll({ order: [["sequence_no", "ASC"], ["id", "ASC"]] });
    res.json(rows.map((row) => toMachineResponse(row)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMachineById = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid machine id" });
    const row = await Machine.findByPk(id);
    if (!row) return res.status(404).json({ error: "Machine not found" });
    res.json(toMachineResponse(row));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.createMachine = async (req, res) => {
  try {
    const payload = normalizePayload(req.body);
    if (!payload.machine_name || !payload.operation_no || payload.sequence_no === null) {
      return res.status(400).json({ error: "machineName, operationNo and sequenceNo are required" });
    }
    const validationErrors = validateIndustrialMachinePayload(payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: "Invalid machine PLC mapping",
        details: validationErrors,
      });
    }

    payload.machine_number = await ensureUniqueMachineNumber(buildMachineNumberSeed(req.body));
    let created = null;
    try {
      created = await Machine.create(payload);
    } catch (error) {
      if (error?.name === "SequelizeUniqueConstraintError" && isLegacyQrScannerUniqueConflict(error)) {
        await ensureMachineQrScannerUniqueness();
        created = await Machine.create(payload);
      } else {
        throw error;
      }
    }
    res.status(201).json(toMachineResponse(created));
  } catch (error) {
    const mapped = sequelizeErrorToHttp(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    res.status(500).json({ error: error.message });
  }
};

exports.updateMachine = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid machine id" });

    const existing = await Machine.findByPk(id);
    if (!existing) return res.status(404).json({ error: "Machine not found" });

    const payload = normalizePayload(req.body, existing.get({ plain: true }));
    if (!payload.machine_name || !payload.operation_no || payload.sequence_no === null) {
      return res.status(400).json({ error: "machineName, operationNo and sequenceNo are required" });
    }
    const validationErrors = validateIndustrialMachinePayload(payload);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: "Invalid machine PLC mapping",
        details: validationErrors,
      });
    }

    const requestedMachineNumber = toText(req.body.machineNumber || req.body.machine_number);
    payload.machine_number = requestedMachineNumber
      ? await ensureUniqueMachineNumber(requestedMachineNumber, id)
      : existing.machine_number || (await ensureUniqueMachineNumber(buildMachineNumberSeed(req.body), id));

    try {
      await existing.update(payload);
    } catch (error) {
      if (error?.name === "SequelizeUniqueConstraintError" && isLegacyQrScannerUniqueConflict(error)) {
        await ensureMachineQrScannerUniqueness();
        await existing.update(payload);
      } else {
        throw error;
      }
    }
    res.json(toMachineResponse(existing));
  } catch (error) {
    const mapped = sequelizeErrorToHttp(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteMachine = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid machine id" });
    const row = await Machine.findByPk(id);
    if (!row) return res.status(404).json({ error: "Machine not found" });

    // Cascade-delete all FK-dependent records before destroying the machine
    // Only include tables that actually reference machine_id
    await Promise.all([
      MachineRuntimeState.destroy({ where: { machine_id: id } }),
      OperationLog.destroy({ where: { machine_id: id } }),
      ProductionLog.destroy({ where: { machine_id: id } }),
      Scanner.destroy({ where: { mapped_machine_id: id } }),
      // Alarm uses machineId (camelCase) — no FK constraint but clean up anyway
      Alarm.destroy({ where: { machineId: id } }),
    ]);

    await row.destroy();
    res.status(204).send();
  } catch (error) {
    const mapped = sequelizeErrorToHttp(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    res.status(500).json({ error: error.message });
  }
};

exports.updateMachineTarget = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid machine id" });
    const row = await Machine.findByPk(id);
    if (!row) return res.status(404).json({ error: "Machine not found" });

    const target = toPositiveInt(req.body?.dailyTargetQty ?? req.body?.daily_target_qty ?? req.body?.targetQty);
    if (target === null) return res.status(400).json({ error: "Valid dailyTargetQty is required" });

    await row.update({ daily_target_qty: target });
    res.json({
      message: "Machine target updated",
      machineId: row.id,
      dailyTargetQty: row.daily_target_qty,
    });
  } catch (error) {
    const mapped = sequelizeErrorToHttp(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    res.status(500).json({ error: error.message });
  }
};

exports.testPlc = async (req, res) => {
  try {
    const machine = await resolveMachineForPlc(req.body);
    const { ip, port, protocol } = resolvePlcEndpoint(req.body, machine);
    if (!ip || !port) {
      return res.status(400).json({ error: "PLC IP and port are required (or provide machineId with configured PLC)" });
    }

    const machineSnapshot = buildPlcMachineSnapshot(machine, req.body);
    const probe = await plcService.testPlcConnection({
      ip,
      port,
      protocol,
      machine: machineSnapshot,
    });

    res.json({
      message: "PLC connection test passed",
      machineId: machine?.id || null,
      plc: { ip, port, protocol },
      probe,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resetPlc = async (req, res) => {
  try {
    const machine = await resolveMachineForPlc(req.body);
    const { ip, port, protocol } = resolvePlcEndpoint(req.body, machine);
    if (!ip || !port) {
      return res.status(400).json({ error: "PLC IP and port are required (or provide machineId with configured PLC)" });
    }

    const machineSnapshot = buildPlcMachineSnapshot(machine, req.body);
    const reset = await plcService.resetPlcState({
      ip,
      port,
      protocol,
      machine: machineSnapshot,
      stationNo: toText(req.body.stationNo ?? req.body.operationNo),
    });

    res.json({
      message: "PLC reset command sent",
      machineId: machine?.id || null,
      plc: { ip, port, protocol },
      reset,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.sendPlcCommand = async (req, res) => {
  try {
    const machine = await resolveMachineForPlc(req.body);
    const { ip, port, protocol } = resolvePlcEndpoint(req.body, machine);
    const command = toText(req.body.command).toUpperCase();
    if (!command) return res.status(400).json({ error: "command is required" });
    if (!ip || !port) {
      return res.status(400).json({ error: "PLC IP and port are required (or provide machineId with configured PLC)" });
    }

    const machineSnapshot = buildPlcMachineSnapshot(machine, req.body);
    const result = await plcService.sendPlcCommand({
      ip,
      port,
      protocol,
      command,
      machine: machineSnapshot,
      partId: toText(req.body.partId ?? req.body.part_id),
      stationNo: toText(req.body.stationNo ?? req.body.operationNo ?? req.body.station_no),
    });

    res.json({
      message: "PLC command sent",
      machineId: machine?.id || null,
      plc: { ip, port, protocol },
      result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};exports.writePlcValue = async (req, res) => {
  try {
    const machine = await resolveMachineForPlc(req.body);
    const { ip, port, protocol } = resolvePlcEndpoint(req.body, machine);
    if (!ip || !port) {
      return res.status(400).json({ error: "PLC IP and port are required (or provide machineId with configured PLC)" });
    }

    const machineSnapshot = buildPlcMachineSnapshot(machine, req.body);
    const rawRegister = req.body.registerNo ?? req.body.register ?? req.body.register_no;
    const regToken = parseRegisterToken(rawRegister);
    const registerNo = regToken.register !== null ? regToken.register : resolveWritableRegisterFromSignal(machineSnapshot, req.body.signalKey);
    const value = toInt(req.body.value);
    if (registerNo === null) return res.status(400).json({ error: "registerNo is required" });
    if (value === null) return res.status(400).json({ error: "value must be a number" });

    const timeoutMs =
      toPositiveInt(req.body.timeoutMs ?? req.body.timeout_ms ?? machineSnapshot?.plc_test_timeout_ms) || 8000;
    const retryCount =
      toPositiveInt(req.body.retryCount ?? req.body.plcTestRetryCount ?? machineSnapshot?.plc_test_retry_count) || 2;
    const normalizedProtocol = normalizeProtocol(protocol);

    let write = null;
    if (normalizedProtocol === "SLMP") {
      const device = regToken.device || toText(req.body.plcSlmpDevice || "D").toUpperCase() || "D";
      write = await writeSlmpRegister({
        ip,
        port,
        register: registerNo,
        value,
        device,
        frameMode: toText(req.body.plcSlmpFrameMode || machineSnapshot?.plc_slmp_frame_mode || "AUTO").toUpperCase() || "AUTO",
        timeoutMs,
        retryCount,
      });
    } else if (normalizedProtocol === "MODBUS_TCP") {
      write = await writeModbusRegister({
        ip,
        port,
        unitId: toInt(req.body.plcUnitId ?? machineSnapshot?.plc_unit_id ?? 1) || 1,
        register: registerNo,
        value,
        timeoutMs,
        retryCount,
      });
    } else {
      return res.status(400).json({ error: "Register write is supported only for MODBUS_TCP and SLMP protocols" });
    }

    res.json({
      message: "PLC register write successful",
      machineId: machine?.id || null,
      plc: { ip, port, protocol: normalizedProtocol },
      write: {
        ...write,
        register: registerNo,
        value,
        timeoutMs,
        retryCount,
      },
    });
  } catch (error) {
    if (/plc packet timeout/i.test(String(error?.message || ""))) {
      return res.status(504).json({
        error:
          "PLC packet timeout. Check Unit ID/register mapping, PLC load, and increase machine test timeout if needed.",
        details: String(error?.message || ""),
      });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.readPlcValue = async (req, res) => {
  try {
    const machine = await resolveMachineForPlc(req.body);
    const { ip, port, protocol } = resolvePlcEndpoint(req.body, machine);
    if (!ip || !port) {
      return res.status(400).json({ error: "PLC IP and port are required (or provide machineId with configured PLC)" });
    }

    const machineSnapshot = buildPlcMachineSnapshot(machine, req.body);
    const signalKey = toText(req.body.signalKey).toUpperCase() || null;
    const rawRegister = req.body.registerNo ?? req.body.register ?? req.body.register_no;
    const regToken = parseRegisterToken(rawRegister);
    const resolvedSignalEntry = resolveSignalMapEntry(machineSnapshot, signalKey);
    const registerNo =
      regToken.register !== null
        ? regToken.register
        : resolveWritableRegisterFromSignal(machineSnapshot, signalKey);

    if (registerNo === null) return res.status(400).json({ error: "registerNo is required" });

    const timeoutMs =
      toPositiveInt(req.body.timeoutMs ?? req.body.timeout_ms ?? machineSnapshot?.plc_test_timeout_ms) || 8000;
    const normalizedProtocol = normalizeProtocol(protocol);

    let value = null;
    let read = null;
    if (normalizedProtocol === "SLMP") {
      const device =
        regToken.device ||
        toText(req.body.plcSlmpDevice || resolvedSignalEntry?.device || "D")
          .toUpperCase() || "D";
      const frameMode =
        toText(req.body.plcSlmpFrameMode || machineSnapshot?.plc_slmp_frame_mode || "AUTO").toUpperCase() || "AUTO";
      const result = await readSlmpRegisters({
        ip,
        port,
        registers: [{ register: registerNo, device }],
        timeoutMs,
        defaultDevice: device,
        frameMode,
      });
      value = Object.prototype.hasOwnProperty.call(result?.values || {}, registerNo)
        ? result.values[registerNo]
        : null;
      read = {
        register: registerNo,
        device,
        frameMode,
        errors: Array.isArray(result?.errors) ? result.errors : [],
      };
    } else if (normalizedProtocol === "MODBUS_TCP") {
      const unitId = toInt(req.body.plcUnitId ?? machineSnapshot?.plc_unit_id ?? 1) || 1;
      const result = await readModbusRegisters({
        ip,
        port,
        unitId,
        registers: [registerNo],
        timeoutMs,
      });
      value = Object.prototype.hasOwnProperty.call(result?.values || {}, registerNo)
        ? result.values[registerNo]
        : null;
      read = {
        register: registerNo,
        unitId,
        errors: Array.isArray(result?.errors) ? result.errors : [],
      };
    } else {
      return res.status(400).json({ error: "Register read is supported only for MODBUS_TCP and SLMP protocols" });
    }

    if (value === null || value === undefined) {
      return res.status(502).json({
        error: "PLC did not return a value for the requested register",
        machineId: machine?.id || null,
        plc: { ip, port, protocol: normalizedProtocol },
        read: {
          ...read,
          signalKey,
          value: null,
          timeoutMs,
        },
      });
    }

    res.json({
      message: "PLC register read successful",
      machineId: machine?.id || null,
      plc: { ip, port, protocol: normalizedProtocol },
      read: {
        ...read,
        signalKey,
        value,
        timeoutMs,
      },
    });
  } catch (error) {
    if (/plc packet timeout/i.test(String(error?.message || ""))) {
      return res.status(504).json({
        error:
          "PLC packet timeout. Check Unit ID/register mapping, PLC load, and increase machine test timeout if needed.",
        details: String(error?.message || ""),
      });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.readPlcRegisters = async (req, res) => {
  try {
    const machine = await resolveMachineForPlc(req.body);
    const { ip, port, protocol } = resolvePlcEndpoint(req.body, machine);
    if (!ip || !port) {
      return res.status(400).json({ error: "PLC IP and port are required" });
    }

    const machineSnapshot = buildPlcMachineSnapshot(machine, req.body);
    const registers = req.body.registers; // expects array of { register, device }
    if (!Array.isArray(registers) || registers.length === 0) {
      return res.status(400).json({ error: "registers array is required" });
    }

    const timeoutMs = toPositiveInt(req.body.timeoutMs ?? machineSnapshot?.plc_test_timeout_ms) || 8000;
    const normalizedProtocol = normalizeProtocol(protocol);

    let values = {};
    let errors = [];

    if (normalizedProtocol === "SLMP") {
      const defaultDevice = toText(req.body.plcSlmpDevice || "D").toUpperCase() || "D";
      const frameMode = toText(req.body.plcSlmpFrameMode || machineSnapshot?.plc_slmp_frame_mode || "AUTO").toUpperCase() || "AUTO";
      const mappedRegisters = registers.map(r => {
        const token = parseRegisterToken(r.register, r.device || defaultDevice);
        return {
          register: token.register,
          device: token.device || defaultDevice
        };
      }).filter(r => r.register !== null);

      if (mappedRegisters.length === 0) return res.status(400).json({ error: "No valid registers provided" });

      const result = await readSlmpRegisters({
        ip,
        port,
        registers: mappedRegisters,
        timeoutMs,
        defaultDevice,
        frameMode,
      });
      values = result?.values || {};
      errors = Array.isArray(result?.errors) ? result.errors : [];
    } else if (normalizedProtocol === "MODBUS_TCP") {
      const unitId = toInt(req.body.plcUnitId ?? machineSnapshot?.plc_unit_id ?? 1) || 1;
      const mappedRegisters = registers.map(r => {
        const token = parseRegisterToken(r.register);
        return token.register;
      }).filter(r => r !== null);

      if (mappedRegisters.length === 0) return res.status(400).json({ error: "No valid registers provided" });

      const result = await readModbusRegisters({
        ip,
        port,
        unitId,
        registers: mappedRegisters,
        timeoutMs,
      });
      values = result?.values || {};
      errors = Array.isArray(result?.errors) ? result.errors : [];
    } else {
      return res.status(400).json({ error: "Register read is supported only for MODBUS_TCP and SLMP protocols" });
    }

    res.json({
      message: "PLC registers read successful",
      machineId: machine?.id || null,
      plc: { ip, port, protocol: normalizedProtocol },
      values,
      errors
    });
  } catch (error) {
    if (/plc packet timeout/i.test(String(error?.message || ""))) {
      return res.status(504).json({
        error: "PLC packet timeout.",
        details: String(error?.message || ""),
      });
    }
    res.status(500).json({ error: error.message });
  }
};

exports.testConnection = async (req, res) => {
  try {
    const {
      mode,
      sourceIp,
      sourcePort,
      endpoint,
      folderConfig,
      payloadResultKey,
      registerNo,
      plcRegister,
      plcProtocol,
      plcSlmpDevice,
      plcSlmpFrameMode,
      timeoutMs,
    } = req.body;
    const protocolMode = String(mode || "IP_PUSH").trim().toUpperCase();
    const testTimeoutMs = toPositiveInt(timeoutMs) || 12000;

    const testTcpReachability = async (ip, port) => {
      const net = require("net");
      return new Promise((resolve, reject) => {
        const client = new net.Socket();
        let settled = false;
        const done = (fn) => (arg) => {
          if (settled) return;
          settled = true;
          client.destroy();
          fn(arg);
        };
        client.setTimeout(testTimeoutMs);
        client.connect(Number(port), ip, done(resolve));
        client.on("error", done(reject));
        client.on("timeout", done(() => reject(new Error("Connection timeout"))));
      });
    };

    if (protocolMode === "IP_PUSH") {
      if (!sourceIp) return res.status(400).json({ error: "Source IP required for IP_PUSH test" });
      const { spawn } = require("child_process");
      return new Promise((resolve) => {
        const ping = spawn("ping", ["-n", "1", "-w", String(testTimeoutMs), String(sourceIp)]);
        let stdout = "";
        let stderr = "";
        ping.stdout.on("data", (chunk) => { stdout += String(chunk || ""); });
        ping.stderr.on("data", (chunk) => { stderr += String(chunk || ""); });
        ping.on("close", (code) => {
          const output = `${stdout}\n${stderr}`.toLowerCase();
          if (code !== 0 || output.includes("unreachable") || output.includes("timed out")) {
            resolve(res.status(502).json({ error: "IP Unreachable", details: "Ping failed or timed out" }));
          } else {
            resolve(res.json({ success: true, message: "IP Reachable (Ping Success)" }));
          }
        });
      });
    }

    if (protocolMode === "TCP_CLIENT") {
      if (!sourceIp) return res.status(400).json({ error: "Source IP is required for TCP Client test" });
      // Port is optional for deployments where scanner bridge abstracts socket details.
      // If port is provided, run socket reachability; otherwise run host reachability only.
      if (!sourcePort) {
        const { spawn } = require("child_process");
        return new Promise((resolve) => {
          const ping = spawn("ping", ["-n", "1", "-w", String(testTimeoutMs), String(sourceIp)]);
          let stdout = "";
          let stderr = "";
          ping.stdout.on("data", (chunk) => { stdout += String(chunk || ""); });
          ping.stderr.on("data", (chunk) => { stderr += String(chunk || ""); });
          ping.on("close", (code) => {
            const output = `${stdout}\n${stderr}`.toLowerCase();
            if (code !== 0 || output.includes("unreachable") || output.includes("timed out")) {
              resolve(res.status(502).json({ error: "TCP source host unreachable", details: "Ping failed or timed out" }));
            } else {
              resolve(res.json({
                success: true,
                message: "TCP Client source host reachable (port not provided; socket check skipped)",
                testType: "tcpClient",
              }));
            }
          });
        });
      }
      try {
        await testTcpReachability(sourceIp, sourcePort);
      } catch (err) {
        return res.status(502).json({ error: "Endpoint Unreachable", details: err.message });
      }
      return res.json({
        success: true,
        message: "TCP Client source reachable",
        testType: "tcpClient",
      });
    }

    if (["PLC_REGISTER", "PLC_SLMP", "MODBUS_TCP"].includes(protocolMode)) {
      if (!sourceIp || !sourcePort) return res.status(400).json({ error: "PLC IP and PLC Port are required for PLC protocol test" });
      try {
        await testTcpReachability(sourceIp, sourcePort);
      } catch (err) {
        return res.status(502).json({ error: "PLC endpoint unreachable", details: err.message });
      }

      // Optional real register read validation when register is provided and protocol is PLC-like.
      const registerCandidate = toInt(registerNo ?? plcRegister ?? payloadResultKey);
      const normalizedPlcProtocol = normalizeProtocol(plcProtocol, "MODBUS_TCP");
      if (registerCandidate !== null) {
        try {
          if (normalizedPlcProtocol === "MODBUS_TCP") {
            const read = await readModbusRegisters({
              ip: sourceIp,
              port: Number(sourcePort),
              unitId: 1,
              registers: [registerCandidate],
              timeoutMs: testTimeoutMs,
            });
            return res.json({
              success: true,
              message: "PLC reachable and register read successful",
              registerRead: {
                protocol: "MODBUS_TCP",
                register: registerCandidate,
                value: read?.values?.[registerCandidate] ?? null,
                errors: Array.isArray(read?.errors) ? read.errors : [],
              },
            });
          }
          if (normalizedPlcProtocol === "SLMP") {
            const device = toText(plcSlmpDevice || "D").toUpperCase() || "D";
            const read = await readSlmpRegisters({
              ip: sourceIp,
              port: Number(sourcePort),
              registers: [{ register: registerCandidate, device }],
              timeoutMs: testTimeoutMs,
              defaultDevice: device,
              frameMode: toText(plcSlmpFrameMode || "AUTO").toUpperCase() || "AUTO",
            });
            return res.json({
              success: true,
              message: "PLC reachable and register read successful",
              registerRead: {
                protocol: "SLMP",
                register: registerCandidate,
                device,
                value: read?.values?.[registerCandidate] ?? null,
                errors: Array.isArray(read?.errors) ? read.errors : [],
              },
            });
          }
        } catch (readError) {
          return res.status(502).json({
            error: "PLC reachable but register read failed",
            details: readError.message,
          });
        }
      }

      return res.json({ success: true, message: "PLC reachable", testType: "plc" });
    }

    if (protocolMode === "TCP_SERVER") {
      const net = require("net");
      const bindIp = sourceIp || "0.0.0.0";
      const port = Number(sourcePort);
      if (!Number.isFinite(port) || port <= 0) {
        return res.status(400).json({ error: "Valid listener port required for TCP_SERVER test" });
      }
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", (err) => {
          server.close(() => resolve(res.status(502).json({ error: "TCP listener bind failed", details: err.message })));
        });
        server.listen(port, bindIp, () => {
          server.close(() => resolve(res.json({ success: true, message: `TCP listener bind OK on ${bindIp}:${port}` })));
        });
      });
    }

    if (protocolMode === "HTTP_API") {
      const url = endpoint || sourceIp;
      if (!url) return res.status(400).json({ error: "Endpoint URL required" });
      const axios = require("axios");
      try {
        await axios.get(url, { timeout: testTimeoutMs });
        return res.json({ success: true, message: "HTTP API Reachable" });
      } catch (err) {
        return res.status(502).json({ error: "HTTP API Unreachable", details: err.message });
      }
    }

    if (protocolMode === "FOLDER" || protocolMode === "FILE_WATCH") {
      const folderPath = toText(folderConfig?.path || sourceIp);
      if (!folderPath) return res.status(400).json({ error: "Folder path required" });
      const fs = require("fs");
      try {
        await fs.promises.access(folderPath, fs.constants.R_OK);
        return res.json({ success: true, message: "Folder Reachable" });
      } catch (err) {
        return res.status(502).json({ error: "Folder Unreachable", details: err.message });
      }
    }

    if (protocolMode === "SERIAL") {
      const comPort = String(sourceIp || "").trim().toUpperCase();
      if (!comPort) return res.status(400).json({ error: "COM port required for SERIAL test" });
      if (!/^COM\d+$/.test(comPort)) {
        return res.status(400).json({ error: "Invalid COM port format. Example: COM3" });
      }
      return res.json({
        success: true,
        message: `Serial configuration accepted (${comPort}). Runtime COM open check handled by scanner adapter.`,
      });
    }

    // Unknown mode defaults
    return res.json({ success: true, message: `${protocolMode} connection simulated (Test not fully implemented for this mode)` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
