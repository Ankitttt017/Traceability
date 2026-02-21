const { Sequelize } = require("sequelize");
const Scanner = require("../models/Scanner");
const Machine = require("../models/Machine");

function toInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPayload(body = {}) {
  return {
    scanner_name: String(body.scannerName ?? body.scanner_name ?? "").trim(),
    scanner_ip: String(body.scannerIp ?? body.scanner_ip ?? "").trim(),
    scanner_port: toInt(body.scannerPort ?? body.scanner_port),
    mapped_machine_id: toInt(body.mappedMachineId ?? body.mapped_machine_id),
    is_active:
      body.isActive === undefined && body.is_active === undefined
        ? true
        : Boolean(body.isActive ?? body.is_active),
  };
}

async function toResponse(scanner) {
  const machine = scanner.mapped_machine_id ? await Machine.findByPk(scanner.mapped_machine_id) : null;
  return {
    id: scanner.id,
    scannerName: scanner.scanner_name,
    scannerIp: scanner.scanner_ip,
    scannerPort: scanner.scanner_port,
    mappedMachineId: scanner.mapped_machine_id,
    isActive: scanner.is_active,
    mappedMachine: machine
      ? {
          id: machine.id,
          machineName: machine.machine_name,
          stationNo: machine.station_no,
          sequenceNo: machine.sequence_no,
        }
      : null,
    createdAt: scanner.createdAt,
    updatedAt: scanner.updatedAt,
  };
}

function handleError(error, res) {
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      error: "Scanner configuration already exists",
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

exports.listScanners = async (_req, res) => {
  try {
    const scanners = await Scanner.findAll({ order: [["id", "ASC"]] });
    const rows = await Promise.all(scanners.map((scanner) => toResponse(scanner)));
    res.json(rows);
  } catch (error) {
    handleError(error, res);
  }
};

exports.createScanner = async (req, res) => {
  try {
    const payload = toPayload(req.body);
    if (!payload.scanner_name || !payload.scanner_ip || !payload.mapped_machine_id) {
      return res.status(400).json({
        error: "scannerName, scannerIp and mappedMachineId are required",
      });
    }

    const machine = await Machine.findByPk(payload.mapped_machine_id);
    if (!machine) {
      return res.status(404).json({ error: "Mapped machine not found" });
    }

    const created = await Scanner.create(payload);
    res.status(201).json(await toResponse(created));
  } catch (error) {
    handleError(error, res);
  }
};

exports.updateScanner = async (req, res) => {
  try {
    const scanner = await Scanner.findByPk(req.params.id);
    if (!scanner) {
      return res.status(404).json({ error: "Scanner not found" });
    }

    const payload = toPayload(req.body);
    if (!payload.scanner_name || !payload.scanner_ip || !payload.mapped_machine_id) {
      return res.status(400).json({
        error: "scannerName, scannerIp and mappedMachineId are required",
      });
    }

    const machine = await Machine.findByPk(payload.mapped_machine_id);
    if (!machine) {
      return res.status(404).json({ error: "Mapped machine not found" });
    }

    await scanner.update(payload);
    res.json(await toResponse(scanner));
  } catch (error) {
    handleError(error, res);
  }
};

exports.deleteScanner = async (req, res) => {
  try {
    const scanner = await Scanner.findByPk(req.params.id);
    if (!scanner) {
      return res.status(404).json({ error: "Scanner not found" });
    }
    await scanner.destroy();
    res.status(204).send();
  } catch (error) {
    handleError(error, res);
  }
};
