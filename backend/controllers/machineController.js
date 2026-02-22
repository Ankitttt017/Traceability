const { Sequelize } = require("sequelize");
const Machine = require("../models/Machine");

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
  const parsedRegisters = parsePlcRegisters(body.plcRegisters ?? body.plc_registers ?? existingMachine?.plc_registers);

  const plcIp = normalizeText(body.plcIp ?? body.plc_ip ?? existingMachine?.plc_ip);
  const plcPort = toInt(body.plcPort ?? body.plc_port ?? existingMachine?.plc_port);

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
    plc_protocol: protocol,
    plc_registers: parsedRegisters.raw,
    plc_unit_id: toInt(body.plcUnitId ?? body.plc_unit_id ?? existingMachine?.plc_unit_id) ?? 1,
    plc_start_register:
      toInt(body.plcStartRegister ?? body.plc_start_register) ??
      parsedRegisters.parsed.start ??
      toInt(existingMachine?.plc_start_register),
    plc_status_register:
      toInt(body.plcStatusRegister ?? body.plc_status_register) ??
      parsedRegisters.parsed.status ??
      toInt(existingMachine?.plc_status_register),
    plc_part_register:
      toInt(body.plcPartRegister ?? body.plc_part_register) ??
      parsedRegisters.parsed.part ??
      toInt(existingMachine?.plc_part_register),
    plc_station_register:
      toInt(body.plcStationRegister ?? body.plc_station_register) ??
      parsedRegisters.parsed.station ??
      toInt(existingMachine?.plc_station_register),
    plc_reset_register:
      toInt(body.plcResetRegister ?? body.plc_reset_register) ??
      parsedRegisters.parsed.reset ??
      toInt(existingMachine?.plc_reset_register),
    plc_start_value: toInt(body.plcStartValue ?? body.plc_start_value ?? existingMachine?.plc_start_value) ?? 1,
    plc_started_value: toInt(body.plcStartedValue ?? body.plc_started_value ?? existingMachine?.plc_started_value) ?? 1,
    plc_end_ok_value: toInt(body.plcEndOkValue ?? body.plc_end_ok_value ?? existingMachine?.plc_end_ok_value) ?? 2,
    plc_end_ng_value: toInt(body.plcEndNgValue ?? body.plc_end_ng_value ?? existingMachine?.plc_end_ng_value) ?? 3,
    status,
    is_active: isActive,
  };
}

function toMachineResponse(machine) {
  const status = machine.status || (machine.is_active ? "ACTIVE" : "INACTIVE");
  const plcRegisters = buildRegistersFallback(machine);
  return {
    id: machine.id,
    machineName: machine.machine_name,
    lineName: machine.line_name,
    sequenceNo: machine.sequence_no,
    operationNo: machine.operation_no,
    plcIp: machine.plc_ip,
    plcPort: machine.plc_port,
    plcProtocol: machine.plc_protocol || "TCP_TEXT",
    plcRegisters,
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
    ["plcIp", payload.plc_ip],
    ["plcPort", payload.plc_port],
    ["plcProtocol", payload.plc_protocol],
    ["plcRegisters", payload.plc_registers],
  ];

  const missing = required
    .filter(([, value]) => value === null || value === undefined || value === "")
    .map(([key]) => key);

  if (payload.plc_protocol === "MODBUS_TCP") {
    if (payload.plc_start_register === null || payload.plc_start_register === undefined) {
      missing.push("plcStartRegister");
    }
    if (payload.plc_status_register === null || payload.plc_status_register === undefined) {
      missing.push("plcStatusRegister");
    }
  }

  return missing;
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
    const missing = validateMachinePayload(payload);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Required fields: ${missing.join(", ")}` });
    }
    const machine = await Machine.create(payload);
    res.status(201).json(toMachineResponse(machine));
  } catch (error) {
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
    const missing = validateMachinePayload(payload);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Required fields: ${missing.join(", ")}` });
    }

    await machine.update(payload);
    res.json(toMachineResponse(machine));
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
