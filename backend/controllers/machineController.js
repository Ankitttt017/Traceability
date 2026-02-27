const { Sequelize, Op } = require("sequelize");
const Machine = require("../models/Machine");
const PlcRegisterRange = require("../models/PlcRegisterRange");
const { testPlcConnection, resetPlcState } = require("../services/plcSocketService");
const { writeModbusRegister } = require("../services/plcIoService");
const { clearMachineLock } = require("../services/machineLockService");

const REGISTER_COLUMN_META = [
  { column: "plc_start_register", label: "startRegister" },
  { column: "plc_status_register", label: "statusRegister" },
  { column: "plc_part_register", label: "partRegister" },
  { column: "plc_station_register", label: "stationRegister" },
  { column: "plc_reset_register", label: "resetRegister" },
  { column: "plc_heartbeat_register", label: "heartbeatRegister" },
];

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

function toProtocol(value) {
  return normalizeUpper(value) === "MODBUS_TCP" ? "MODBUS_TCP" : "TCP_TEXT";
}

function toStatus(value) {
  return normalizeUpper(value) === "INACTIVE" ? "INACTIVE" : "ACTIVE";
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

function getPlcConfigInput(body = {}) {
  const raw = body.plcConfig;
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return raw;
}

function serializePlcConfigSnapshot(config = {}) {
  const snapshot = {
    rangeId: toInt(config.rangeId),
    unitId: toInt(config.unitId),
    startRegister: toInt(config.startRegister),
    statusRegister: toInt(config.statusRegister),
    partRegister: toInt(config.partRegister),
    stationRegister: toInt(config.stationRegister),
    resetRegister: toInt(config.resetRegister),
    startValue: toInt(config.startValue),
    startedValue: toInt(config.startedValue),
    endOkValue: toInt(config.endOkValue),
    endNgValue: toInt(config.endNgValue),
    resetValue: toInt(config.resetValue),
    testTimeoutMs: toInt(config.testTimeoutMs),
    testRetryCount: toInt(config.testRetryCount),
    heartbeatRegister: toInt(config.heartbeatRegister),
    heartbeatStaleMs: toInt(config.heartbeatStaleMs),
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
  payload.plc_registers =
    serializePlcConfigSnapshot({
      rangeId: payload.plc_range_id,
      unitId: payload.plc_unit_id,
      startRegister: payload.plc_start_register,
      statusRegister: payload.plc_status_register,
      partRegister: payload.plc_part_register,
      stationRegister: payload.plc_station_register,
      resetRegister: payload.plc_reset_register,
      startValue: payload.plc_start_value,
      startedValue: payload.plc_started_value,
      endOkValue: payload.plc_end_ok_value,
      endNgValue: payload.plc_end_ng_value,
      resetValue: payload.plc_reset_value,
      testTimeoutMs: payload.plc_test_timeout_ms,
      testRetryCount: payload.plc_test_retry_count,
      heartbeatRegister: payload.plc_heartbeat_register,
      heartbeatStaleMs: payload.plc_heartbeat_stale_ms,
    }) || payload.plc_registers;
}

async function hydratePayloadFromRange(payload) {
  if (String(payload.plc_protocol || "").toUpperCase() !== "MODBUS_TCP") {
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

  payload.plc_protocol = toProtocol(range.plc_protocol || payload.plc_protocol);
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
  const parsedRegisters = parsePlcRegisters(body.plcRegisters ?? body.plc_registers ?? existingMachine?.plc_registers);

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
  const plcStatusRegister =
    toInt(body.plcStatusRegister ?? body.plc_status_register ?? plcConfigInput.statusRegister) ??
    parsedRegisters.parsed.status ??
    toInt(existingMachine?.plc_status_register);
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

  const plcRegistersSnapshot =
    parsedRegisters.raw ||
    serializePlcConfigSnapshot({
      rangeId: plcRangeId,
      unitId: plcUnitId,
      startRegister: plcStartRegister,
      statusRegister: plcStatusRegister,
      partRegister: plcPartRegister,
      stationRegister: plcStationRegister,
      resetRegister: plcResetRegister,
      startValue: plcStartValue,
      startedValue: plcStartedValue,
      endOkValue: plcEndOkValue,
      endNgValue: plcEndNgValue,
      resetValue: plcResetValue,
      testTimeoutMs: plcTestTimeoutMs,
      testRetryCount: plcTestRetryCount,
      heartbeatRegister: plcHeartbeatRegister,
      heartbeatStaleMs: plcHeartbeatStaleMs,
    });

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
    plc_unit_id: plcUnitId,
    plc_start_register: plcStartRegister,
    plc_status_register: plcStatusRegister,
    plc_part_register: plcPartRegister,
    plc_station_register: plcStationRegister,
    plc_reset_register: plcResetRegister,
    plc_start_value: plcStartValue,
    plc_started_value: plcStartedValue,
    plc_end_ok_value: plcEndOkValue,
    plc_end_ng_value: plcEndNgValue,
    plc_reset_value: plcResetValue,
    plc_test_timeout_ms: plcTestTimeoutMs,
    plc_test_retry_count: plcTestRetryCount,
    plc_heartbeat_register: plcHeartbeatRegister,
    plc_heartbeat_stale_ms: plcHeartbeatStaleMs,
    status,
    is_active: isActive,
  };
}

function toMachineResponse(machine) {
  const status = machine.status || (machine.is_active ? "ACTIVE" : "INACTIVE");
  const plcRegisters = buildRegistersFallback(machine);
  const plcConfig = {
    rangeId: machine.plc_range_id,
    unitId: machine.plc_unit_id ?? 1,
    startRegister: machine.plc_start_register,
    statusRegister: machine.plc_status_register,
    partRegister: machine.plc_part_register,
    stationRegister: machine.plc_station_register,
    resetRegister: machine.plc_reset_register,
    startValue: machine.plc_start_value ?? 1,
    startedValue: machine.plc_started_value ?? 2,
    endOkValue: machine.plc_end_ok_value ?? 3,
    endNgValue: machine.plc_end_ng_value ?? 4,
    resetValue: machine.plc_reset_value ?? 9,
    testTimeoutMs: machine.plc_test_timeout_ms ?? 2000,
    testRetryCount: machine.plc_test_retry_count ?? 2,
    heartbeatRegister: machine.plc_heartbeat_register ?? null,
    heartbeatStaleMs: machine.plc_heartbeat_stale_ms ?? 5000,
  };
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
    plcConfig,
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
    plcPartRegister: machine.plc_part_register,
    plcStationRegister: machine.plc_station_register,
    plcResetRegister: machine.plc_reset_register,
    plcStartValue: machine.plc_start_value,
    plcStartedValue: machine.plc_started_value,
    plcEndOkValue: machine.plc_end_ok_value,
    plcEndNgValue: machine.plc_end_ng_value,
    plcResetValue: machine.plc_reset_value,
    plcTestTimeoutMs: machine.plc_test_timeout_ms,
    plcTestRetryCount: machine.plc_test_retry_count,
    plcHeartbeatRegister: machine.plc_heartbeat_register,
    plcHeartbeatStaleMs: machine.plc_heartbeat_stale_ms,
    isRunning: Boolean(machine.is_running),
    runningPartId: machine.running_part_id || null,
    runningStationNo: machine.running_station_no || null,
    runningStartedAt: machine.running_started_at || null,
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

  if (payload.plc_protocol === "TCP_TEXT") {
    if (payload.plc_ip === null || payload.plc_ip === undefined || payload.plc_ip === "") {
      missing.push("plcIp");
    }
    if (payload.plc_port === null || payload.plc_port === undefined || payload.plc_port === "") {
      missing.push("plcPort");
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

async function validateModbusRangeAndRegisterUsage(payload, excludeMachineId = null) {
  if (String(payload.plc_protocol || "").toUpperCase() !== "MODBUS_TCP") {
    return;
  }

  const rangeId = toInt(payload.plc_range_id);
  if (!rangeId) {
    throw new Error("plcRangeId is required for MODBUS_TCP");
  }

  const range = await PlcRegisterRange.findByPk(rangeId);
  if (!range) {
    throw new Error("Configured plcRangeId does not exist");
  }
  if (String(range.status || "ACTIVE").toUpperCase() !== "ACTIVE") {
    throw new Error("Configured plcRangeId is INACTIVE. Select an ACTIVE range.");
  }

  const selectedRegisterMap = new Map();
  for (const entry of REGISTER_COLUMN_META) {
    const registerNo = toInt(payload[entry.column]);
    if (registerNo === null) {
      continue;
    }

    if (registerNo < range.range_start || registerNo > range.range_end) {
      throw new Error(
        `${entry.label} (${registerNo}) is outside selected range ${range.range_start}-${range.range_end}`
      );
    }

    const existingRole = selectedRegisterMap.get(registerNo);
    if (existingRole && existingRole !== entry.label) {
      throw new Error(`Register ${registerNo} is assigned twice (${existingRole} and ${entry.label})`);
    }
    selectedRegisterMap.set(registerNo, entry.label);
  }

  if (selectedRegisterMap.size === 0) {
    return;
  }

  const peerMachines = await Machine.findAll({
    where: {
      plc_range_id: rangeId,
      ...(excludeMachineId ? { id: { [Op.ne]: excludeMachineId } } : {}),
    },
    attributes: ["id", "machine_name", "operation_no", ...REGISTER_COLUMN_META.map((entry) => entry.column)],
  });

  for (const machine of peerMachines) {
    for (const entry of REGISTER_COLUMN_META) {
      const registerNo = toInt(machine[entry.column]);
      if (registerNo === null || !selectedRegisterMap.has(registerNo)) {
        continue;
      }

      const incomingRole = selectedRegisterMap.get(registerNo);
      throw new Error(
        `Register ${registerNo} already used by ${machine.machine_name} (${machine.operation_no}) as ${entry.label}. Conflicts with ${incomingRole}.`
      );
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
    await validateModbusRangeAndRegisterUsage(payload);
    const machine = await Machine.create(payload);
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
    await validateModbusRangeAndRegisterUsage(payload, machine.id);

    await machine.update(payload);
    res.json(toMachineResponse(machine));
  } catch (error) {
    if (!String(error?.name || "").startsWith("Sequelize")) {
      return res.status(400).json({ error: error.message || "Failed to update machine" });
    }
    handleSequelizeError(error, res);
  }
};

exports.testPlc = async (req, res) => {
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
      plcTestTimeoutMs: req.body.plcTestTimeoutMs ?? req.body.plc_test_timeout_ms,
      plcTestRetryCount: req.body.plcTestRetryCount ?? req.body.plc_test_retry_count,
      plcHeartbeatRegister: req.body.plcHeartbeatRegister ?? req.body.plc_heartbeat_register,
      plcHeartbeatStaleMs: req.body.plcHeartbeatStaleMs ?? req.body.plc_heartbeat_stale_ms,
      status: "ACTIVE",
    }, existingMachine);
    await hydratePayloadFromRange(payload);

    if (!payload.plc_ip || !payload.plc_port) {
      return res.status(400).json({ error: "plcIp and plcPort are required for PLC test" });
    }

    if (payload.plc_protocol === "MODBUS_TCP" && !Number.isFinite(Number(payload.plc_status_register))) {
      return res.status(400).json({ error: "plcConfig.statusRegister is required for MODBUS_TCP test" });
    }

    const probe = await testPlcConnection({
      ip: payload.plc_ip,
      port: payload.plc_port,
      protocol: payload.plc_protocol,
      machine: payload,
    });

    res.json({
      message: "PLC connection test successful",
      probe,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || "PLC connection test failed" });
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

    if (!payload.plc_ip || !payload.plc_port) {
      return res.status(400).json({ error: "plcIp and plcPort are required for PLC reset" });
    }

    if (payload.plc_protocol === "MODBUS_TCP" && !Number.isFinite(Number(payload.plc_reset_register))) {
      return res.status(400).json({ error: "plcConfig.resetRegister is required for MODBUS_TCP reset" });
    }

    const reset = await resetPlcState({
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

    if (!payload.plc_ip || !payload.plc_port) {
      return res.status(400).json({ error: "plcIp and plcPort are required for PLC write" });
    }

    if (String(payload.plc_protocol || "").toUpperCase() !== "MODBUS_TCP") {
      return res.status(400).json({ error: "Write test value is supported for MODBUS_TCP machines only" });
    }

    const signalKey = normalizeUpper(req.body.signalKey || req.body.signal || "");
    const signalRegisterMap = {
      TRIGGER: toInt(payload.plc_start_register),
      INTERLOCK: toInt(payload.plc_status_register),
      COMPLETE: toInt(payload.plc_station_register),
      RESET: toInt(payload.plc_reset_register),
    };

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
    const write = await writeModbusRegister({
      ip: payload.plc_ip,
      port: payload.plc_port,
      unitId: payload.plc_unit_id || 1,
      register: registerNo,
      value,
      timeoutMs,
    });

    res.json({
      message: "PLC register write successful",
      write: {
        protocol: "MODBUS_TCP",
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
