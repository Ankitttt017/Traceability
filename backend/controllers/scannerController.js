const { Sequelize } = require("sequelize");
const Scanner = require("../models/Scanner");
const Machine = require("../models/Machine");
const { normalizeIp } = require("../utils/networkAddress");
const scannerService = require("../services/scannerConnectionService");
const { getScannerHealthSnapshot } = require("../services/scannerHealthService");
const { emitRealtime } = require("../services/realtimeService");

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
    scanner_ip: normalizeIp(body.scannerIp ?? body.scanner_ip),
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
            stationNo: machine.operation_no,
            operationNo: machine.operation_no,
            lineName: machine.line_name,
            sequenceNo: machine.sequence_no,
        }
      : null,
    createdAt: scanner.createdAt,
    updatedAt: scanner.updatedAt,
  };
}

function toConnectionResponse(connection) {
  if (!connection) {
    return {
      status: "DISCONNECTED",
      connected: false,
      connectedAt: null,
      lastDataAt: null,
      openSockets: 0,
      source: "NONE",
    };
  }
  return {
    status: String(connection.status || "DISCONNECTED").toUpperCase(),
    connected: Boolean(connection.connected),
    connectedAt: connection.connectedAt || null,
    lastDataAt: connection.lastDataAt || null,
    openSockets: Number(connection.openSockets || 0),
    source: connection.source || "UNKNOWN",
  };
}

function mergeConnectionWithHealth(connection, health) {
  const base = toConnectionResponse(connection);
  const heartbeatConnected = Boolean(health?.connected);
  const connected = Boolean(base.connected || heartbeatConnected);
  const status = connected ? "CONNECTED" : "DISCONNECTED";
  return {
    ...base,
    status,
    connected,
    lastDataAt: base.lastDataAt || health?.lastSeenAt || null,
    source: base.source !== "NONE" ? base.source : health ? "HEARTBEAT" : base.source,
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

exports.listScannerConnections = async (_req, res) => {
  try {
    const [scanners, connectionRows] = await Promise.all([
      Scanner.findAll({ order: [["id", "ASC"]] }),
      scannerService.listScannerConnectionSnapshots(),
    ]);

    const connectionMap = new Map(
      (connectionRows || []).map((row) => [normalizeIp(row.scannerIp), row])
    );

    const configuredRows = await Promise.all(
      scanners.map(async (scanner) => {
        const base = await toResponse(scanner);
        const connection = connectionMap.get(normalizeIp(scanner.scanner_ip)) || null;
        const health = getScannerHealthSnapshot({ scannerIp: scanner.scanner_ip }) || null;
        return {
          ...base,
          connection: mergeConnectionWithHealth(connection, health),
        };
      })
    );

    const configuredIps = new Set(configuredRows.map((row) => normalizeIp(row.scannerIp)));
    const unmanagedRows = (connectionRows || [])
      .filter((row) => !configuredIps.has(normalizeIp(row.scannerIp)))
      .map((row, index) => ({
        id: `unmanaged-${index}-${row.scannerIp}`,
        scannerName: "UNMAPPED_SCANNER",
        scannerIp: row.scannerIp,
        scannerPort: null,
        mappedMachineId: null,
        isActive: false,
        mappedMachine: null,
        connection: toConnectionResponse(row),
      }));

    res.json({
      configured: configuredRows,
      unmanaged: unmanagedRows,
      totalConnected: [...configuredRows, ...unmanagedRows].filter((row) => row.connection.connected).length,
    });
  } catch (error) {
    handleError(error, res);
  }
};

exports.testScannerConnection = async (req, res) => {
  try {
    const scanner = await Scanner.findByPk(req.params.id);
    if (!scanner) {
      return res.status(404).json({ error: "Scanner not found" });
    }

    const targetPort = toInt(scanner.scanner_port) || 9001;
    const result = await scannerService.probeScannerEndpoint({
      ip: scanner.scanner_ip,
      port: targetPort,
    });

    const reachable = Boolean(result?.reachable);
    res.json({
      scannerId: scanner.id,
      scannerIp: scanner.scanner_ip,
      scannerPort: targetPort,
      reachable,
      status: reachable ? "REACHABLE" : "UNREACHABLE",
      checkedAt: new Date().toISOString(),
      error: result?.error || null,
      message: reachable
        ? "Scanner endpoint is reachable over TCP"
        : result?.error || "Scanner endpoint is unreachable",
    });
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
    emitRealtime("dashboard_refresh", { reason: "SCANNER_CREATED", scannerId: created.id });
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
    emitRealtime("dashboard_refresh", { reason: "SCANNER_UPDATED", scannerId: scanner.id });
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
    const id = scanner.id;
    await scanner.destroy();
    emitRealtime("dashboard_refresh", { reason: "SCANNER_DELETED", scannerId: id });
    res.status(204).send();
  } catch (error) {
    handleError(error, res);
  }
};
