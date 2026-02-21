const { Sequelize } = require("sequelize");
const Machine = require("../models/Machine");

function toInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toProtocol(value) {
  const normalized = String(value || "TCP_TEXT").trim().toUpperCase();
  if (normalized === "MODBUS_TCP") {
    return "MODBUS_TCP";
  }
  return "TCP_TEXT";
}

function toMachinePayload(body = {}) {
  const sequenceNo = toInt(body.sequenceNo ?? body.sequence_no);
  const stationNoInput = String(body.stationNo ?? body.station_no ?? "")
    .trim()
    .toUpperCase();
  const operationNoInput = String(body.operationNo ?? body.operation_no ?? body.stationNo ?? body.station_no ?? "")
    .trim()
    .toUpperCase();
  const isActiveInput =
    body.isActive === undefined && body.is_active === undefined
      ? String(body.status ?? "ACTIVE").toUpperCase() !== "INACTIVE"
      : Boolean(body.isActive ?? body.is_active);
  const machineNumber = String(body.machineNumber ?? body.machine_number ?? "").trim();
  const resolvedOperation = operationNoInput || stationNoInput || (sequenceNo ? `ST-${sequenceNo}` : "");
  const resolvedStation = stationNoInput || resolvedOperation || (sequenceNo ? `ST-${sequenceNo}` : "");
  const protocol = toProtocol(body.plcProtocol ?? body.plc_protocol);

  return {
    machine_number: machineNumber || `MC-${resolvedOperation || sequenceNo || "AUTO"}`,
    machine_name: String(body.machineName ?? body.machine_name ?? "").trim(),
    station_no: resolvedStation,
    line_name: String(body.lineName ?? body.line_name ?? "").trim() || "LINE-1",
    sequence_no: sequenceNo,
    operation_no: resolvedOperation,
    machine_ip: String(body.machineIp ?? body.machine_ip ?? "").trim(),
    machine_port: toInt(body.machinePort ?? body.machine_port),
    qr_scanner_ip: String(body.qrScannerIp ?? body.qr_scanner_ip ?? "").trim() || null,
    plc_ip: String(body.plcIp ?? body.plc_ip ?? "").trim() || null,
    plc_port: toInt(body.plcPort ?? body.plc_port),
    plc_protocol: protocol,
    plc_unit_id: toInt(body.plcUnitId ?? body.plc_unit_id) ?? 1,
    plc_start_register: toInt(body.plcStartRegister ?? body.plc_start_register),
    plc_status_register: toInt(body.plcStatusRegister ?? body.plc_status_register),
    plc_part_register: toInt(body.plcPartRegister ?? body.plc_part_register),
    plc_station_register: toInt(body.plcStationRegister ?? body.plc_station_register),
    plc_reset_register: toInt(body.plcResetRegister ?? body.plc_reset_register),
    plc_start_value: toInt(body.plcStartValue ?? body.plc_start_value) ?? 1,
    plc_started_value: toInt(body.plcStartedValue ?? body.plc_started_value) ?? 1,
    plc_end_ok_value: toInt(body.plcEndOkValue ?? body.plc_end_ok_value) ?? 2,
    plc_end_ng_value: toInt(body.plcEndNgValue ?? body.plc_end_ng_value) ?? 3,
    status: isActiveInput ? "ACTIVE" : "INACTIVE",
    is_active: isActiveInput,
  };
}

function toMachineResponse(machine) {
  return {
    id: machine.id,
    machineNumber: machine.machine_number,
    machineName: machine.machine_name,
    stationNo: machine.station_no,
    lineName: machine.line_name,
    sequenceNo: machine.sequence_no,
    operationNo: machine.operation_no,
    machineIp: machine.machine_ip,
    machinePort: machine.machine_port,
    qrScannerIp: machine.qr_scanner_ip,
    plcIp: machine.plc_ip,
    plcPort: machine.plc_port,
    plcProtocol: machine.plc_protocol || "TCP_TEXT",
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
    status: machine.status || (machine.is_active ? "ACTIVE" : "INACTIVE"),
    isActive: machine.is_active,
    createdAt: machine.createdAt,
    updatedAt: machine.updatedAt,
  };
}

function validateMachinePayload(payload) {
  const requiredFields = [
    ["machineName", payload.machine_name],
    ["operationNo", payload.operation_no],
    ["sequenceNo", payload.sequence_no],
    ["machineIp", payload.machine_ip],
  ];

  const missing = requiredFields
    .filter(([, value]) => value === null || value === "")
    .map(([name]) => name);

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

    const payload = toMachinePayload(req.body);
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
