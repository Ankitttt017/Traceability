const { Sequelize } = require("sequelize");
const Scanner = require("../models/Scanner");
const Machine = require("../models/Machine");
const { normalizeIp } = require("../utils/networkAddress");
const scannerService = require("../services/scannerConnectionService");
const { getScannerHealthSnapshot } = require("../services/scannerHealthService");
const { markScannerHeartbeat } = require("../services/scannerHealthService");
const { emitRealtime } = require("../services/realtimeService");
const { normalizeScannerConfig, readPartIdFromScannerPlc } = require("../services/scannerPlcDataService");
const CONNECTION_GRACE_MS = Math.max(Number(process.env.SCANNER_CONNECTION_GRACE_MS || 15000), 3000);

function toInt(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPayload(body = {}) {
  const scannerMode = String(body.scannerMode ?? body.scanner_mode ?? "TCP_CLIENT").trim().toUpperCase() || "TCP_CLIENT";
  const plcCfg = normalizeScannerConfig(body);
  const scannerIpInput = normalizeIp(body.scannerIp ?? body.scanner_ip);
  const scannerIp = scannerMode === "PLC_REGISTER"
    ? (plcCfg.plcIp || scannerIpInput)
    : scannerIpInput;

  return {
    scanner_name: String(body.scannerName ?? body.scanner_name ?? "").trim(),
    scanner_ip: scannerIp,
    scanner_port: toInt(body.scannerPort ?? body.scanner_port),
    scanner_mode: scannerMode,
    scanner_role: String(body.scannerRole ?? body.scanner_role ?? "").trim().toUpperCase() || null,
    plc_ip: plcCfg.plcIp || null,
    plc_port: plcCfg.plcPort,
    plc_protocol: plcCfg.plcProtocol,
    plc_unit_id: plcCfg.plcUnitId,
    plc_device: plcCfg.plcDevice,
    plc_frame_mode: plcCfg.plcFrameMode,
    plc_start_register: plcCfg.plcStartRegister,
    plc_end_register: plcCfg.plcEndRegister,
    plc_data_type: plcCfg.plcDataType,
    plc_timeout_ms: plcCfg.plcTimeoutMs,
    plc_read_retry_count: plcCfg.plcReadRetryCount,
    plc_read_retry_delay_ms: plcCfg.plcReadRetryDelayMs,
    concat_separator: plcCfg.concatSeparator || null,
    mapped_machine_id: toInt(body.mappedMachineId ?? body.mapped_machine_id),
    is_active:
      body.isActive === undefined && body.is_active === undefined
        ? true
        : Boolean(body.isActive ?? body.is_active),
    is_simulation:
      body.isSimulation === undefined && body.is_simulation === undefined
        ? false
        : Boolean(body.isSimulation ?? body.is_simulation),
  };
}

async function toResponse(scanner) {
  const machine = scanner.mapped_machine_id ? await Machine.findByPk(scanner.mapped_machine_id) : null;
  return {
    id: scanner.id,
    scannerName: scanner.scanner_name,
    scannerIp: scanner.scanner_ip,
    scannerPort: scanner.scanner_port,
    scannerMode: scanner.scanner_mode || "TCP_CLIENT",
    scannerRole: scanner.scanner_role || null,
    plcIp: scanner.plc_ip || null,
    plcPort: scanner.plc_port || null,
    plcProtocol: scanner.plc_protocol || "MODBUS_TCP",
    plcUnitId: scanner.plc_unit_id || 1,
    plcDevice: scanner.plc_device || "D",
    plcFrameMode: scanner.plc_frame_mode || "AUTO",
    plcStartRegister: scanner.plc_start_register,
    plcEndRegister: scanner.plc_end_register,
    plcDataType: scanner.plc_data_type || "ASCII",
    plcTimeoutMs: scanner.plc_timeout_ms || 8000,
    plcReadRetryCount: scanner.plc_read_retry_count || 3,
    plcReadRetryDelayMs: scanner.plc_read_retry_delay_ms || 300,
    concatSeparator: scanner.concat_separator || null,
    mappedMachineId: scanner.mapped_machine_id,
    isActive: scanner.is_active,
    isSimulation: Boolean(scanner.is_simulation),
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

function validateScannerPayload(payload) {
  if (!payload.scanner_name || !payload.mapped_machine_id) {
    return "scannerName and mappedMachineId are required";
  }
  if (payload.scanner_mode === "PLC_REGISTER") {
    if (!payload.plc_ip || !payload.plc_port) {
      return "PLC IP and port are required for PLC_REGISTER mode";
    }
    if (payload.plc_start_register === null || payload.plc_start_register === undefined) {
      return "PLC start register is required for PLC_REGISTER mode";
    }
  } else if (!payload.scanner_ip) {
    return "scannerIp is required for selected scanner mode";
  }
  return null;
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
  const lastDataMs = base.lastDataAt ? new Date(base.lastDataAt).getTime() : 0;
  const recentDataConnected = Number.isFinite(lastDataMs) && lastDataMs > 0
    ? (Date.now() - lastDataMs) <= CONNECTION_GRACE_MS
    : false;
  const connected = Boolean(base.connected || heartbeatConnected || recentDataConnected);
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
        try {
          const base = await toResponse(scanner);
          const connection = connectionMap.get(normalizeIp(scanner.scanner_ip)) || null;
          const health = getScannerHealthSnapshot({ scannerIp: scanner.scanner_ip }) || null;
          return {
            ...base,
            connection: mergeConnectionWithHealth(connection, health),
          };
        } catch (_error) {
          return {
            id: scanner.id,
            scannerName: scanner.scanner_name || "SCANNER",
            scannerIp: scanner.scanner_ip || null,
            scannerPort: scanner.scanner_port || null,
            scannerMode: scanner.scanner_mode || "TCP_CLIENT",
            scannerRole: scanner.scanner_role || null,
            mappedMachineId: scanner.mapped_machine_id || null,
            isActive: Boolean(scanner.is_active),
            mappedMachine: null,
            connection: toConnectionResponse(null),
          };
        }
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

    const mode = String(scanner.scanner_mode || "TCP_CLIENT").trim().toUpperCase();
    if (mode === "PLC_REGISTER") {
      const read = await readPartIdFromScannerPlc(scanner.get({ plain: true }));
      const hasPartId = Boolean(read.partId);
      return res.json({
        scannerId: scanner.id,
        scannerMode: mode,
        reachable: true,
        status: hasPartId ? "REACHABLE" : "REACHABLE_EMPTY_DATA",
        checkedAt: new Date().toISOString(),
        message: hasPartId ? "PLC register read successful" : "PLC reachable but part ID is empty",
        partIdPreview: read.partId || null,
        read,
      });
    }

    if (mode === "USB_SERIAL") {
      return res.json({
        scannerId: scanner.id,
        scannerMode: mode,
        reachable: true,
        status: "REACHABLE",
        checkedAt: new Date().toISOString(),
        message: `USB/Serial mode configured. Runtime COM adapter should be verified on station system.`,
      });
    }

    if (mode === "TCP_CLIENT") {
      const connection = await scannerService.getScannerConnectionSnapshot(scanner.scanner_ip);
      const health = getScannerHealthSnapshot({ scannerIp: scanner.scanner_ip }) || null;
      const merged = mergeConnectionWithHealth(connection, health);
      const waitingForPush = !merged.lastDataAt;
      return res.json({
        scannerId: scanner.id,
        scannerMode: mode,
        scannerIp: scanner.scanner_ip,
        backendListenerPort: Number(process.env.TCP_SERVER_PORT || 0) || null,
        reachable: true,
        status: merged.connected ? "LISTENER_ACTIVE_RECEIVING" : "WAITING_FOR_PUSH_DATA",
        checkedAt: new Date().toISOString(),
        connection: merged,
        message: waitingForPush
          ? "Scanner is push-mode (TCP client). Backend listener is active; waiting for scanner payload."
          : `Scanner push data received. Last packet at ${merged.lastDataAt}.`,
      });
    }

    const targetPort = toInt(scanner.scanner_port) || 9001;
    const result = await scannerService.probeScannerEndpoint({
      ip: scanner.scanner_ip,
      port: targetPort,
    });

    const reachable = Boolean(result?.reachable);
    res.json({
      scannerId: scanner.id,
      scannerMode: mode,
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

exports.testScannerRead = async (req, res) => {
  try {
    const payload = toPayload(req.body);
    const validationError = validateScannerPayload(payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const mode = String(payload.scanner_mode || "TCP_CLIENT").toUpperCase();
    if (mode !== "PLC_REGISTER") {
      return res.json({
        success: true,
        scannerMode: mode,
        message: `Read preview is only required for PLC_REGISTER mode. Current mode: ${mode}`,
      });
    }

    const read = await readPartIdFromScannerPlc(payload);
    return res.json({
      success: true,
      scannerMode: mode,
      partIdPreview: read.partId || null,
      read,
      message: read.partId
        ? "PLC read success. Part ID decoded."
        : "PLC read success but decoded part ID is empty.",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.markUsbActivity = async (req, res) => {
  try {
    const machineId = Number(req.body?.machineId || 0) || null;
    const scannerId = Number(req.body?.scannerId || 0) || null;

    let scanner = null;
    if (scannerId) {
      scanner = await Scanner.findByPk(scannerId);
    }
    if (!scanner && machineId) {
      scanner = await Scanner.findOne({
        where: { mapped_machine_id: machineId, is_active: true },
        order: [["updatedAt", "DESC"]],
      });
    }
    if (!scanner) {
      return res.status(404).json({ error: "Scanner not found for USB activity heartbeat" });
    }

    const scannerIp = normalizeIp(scanner.scanner_ip);
    const snapshot = scannerService.markScannerData({ scannerIp });
    const heartbeat = markScannerHeartbeat({
      scannerId: scanner.id,
      scannerIp,
      scannerName: scanner.scanner_name,
      machineId: scanner.mapped_machine_id || machineId || null,
    });
    return res.json({
      success: true,
      scannerId: scanner.id,
      scannerIp,
      scannerMode: scanner.scanner_mode || "USB_SERIAL",
      connection: snapshot || null,
      heartbeat: heartbeat || null,
      message: "USB scanner activity heartbeat recorded",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.createScanner = async (req, res) => {
  try {
    const payload = toPayload(req.body);
    const validationError = validateScannerPayload(payload);
    if (validationError) return res.status(400).json({ error: validationError });



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
    const validationError = validateScannerPayload(payload);
    if (validationError) return res.status(400).json({ error: validationError });

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
