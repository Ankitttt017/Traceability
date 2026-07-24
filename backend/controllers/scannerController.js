const { Sequelize } = require("sequelize");
const Scanner = require("../models/Scanner");
const Machine = require("../models/Machine");
const { normalizeIp } = require("../utils/networkAddress");
const scannerService = require("../services/scannerConnectionService");
const { getScannerHealthSnapshot, markScannerHeartbeat, clearScannerHealth } = require("../services/scannerHealthService");
const { emitRealtime } = require("../services/realtimeService");
const { normalizeScannerConfig, readPartIdFromScannerPlc } = require("../services/scannerPlcDataService");
const {
  ensureMachineQrScannerUniqueness,
  ensureScannerIpCanBeShared,
} = require("../services/machineSchemaService");
const CONNECTION_GRACE_MS = Math.max(Number(process.env.SCANNER_CONNECTION_GRACE_MS || 180000), 3000);

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

async function syncMachineScannerIp(machineId, scannerIp) {
  const id = Number(machineId || 0);
  if (!id) return;
  await Machine.update(
    { qr_scanner_ip: normalizeIp(scannerIp) || null },
    { where: { id } }
  );
}

async function clearMachineScannerIpIfMatched(machineId, scannerIp) {
  const id = Number(machineId || 0);
  if (!id) return;
  const machine = await Machine.findByPk(id);
  if (!machine) return;
  if (!scannerIp || sameScannerIp(machine.qr_scanner_ip, scannerIp)) {
    await machine.update({ qr_scanner_ip: null });
  }
}

function sameScannerIp(left, right) {
  return normalizeIp(left) === normalizeIp(right);
}

async function resolveScannerReadConfig(payload = {}) {
  const merged = { ...payload };
  const machineId = Number(payload.mapped_machine_id || payload.mappedMachineId || 0);
  if (!machineId) return merged;
  const machine = await Machine.findByPk(machineId);
  if (!machine) {
    merged.__configSource = "scanner-page-config";
    return merged;
  }
  const m = machine.get({ plain: true });
  const sourceParts = [];
  sourceParts.push("scanner-page-config");
  merged.plc_ip = merged.plc_ip || m.plc_ip || m.machine_ip || null;
  if (!payload.plc_ip && (m.plc_ip || m.machine_ip)) sourceParts.push("database-machine-config:ip");
  merged.plc_port = merged.plc_port || m.plc_port || null;
  if (!payload.plc_port && m.plc_port) sourceParts.push("database-machine-config:port");
  merged.plc_protocol = merged.plc_protocol || m.plc_protocol || "MODBUS_TCP";
  if (!payload.plc_protocol && m.plc_protocol) sourceParts.push("database-machine-config:protocol");
  merged.plc_unit_id = merged.plc_unit_id || m.plc_unit_id || 1;
  if (!payload.plc_unit_id && m.plc_unit_id) sourceParts.push("database-machine-config:unitId");
  merged.plc_device = merged.plc_device || "D";
  if (!payload.plc_device) sourceParts.push("fallback/default-config:device");
  merged.plc_timeout_ms = merged.plc_timeout_ms || m.plc_test_timeout_ms || 12000;
  if (!payload.plc_timeout_ms && (m.plc_test_timeout_ms || 12000)) sourceParts.push("database-machine-config:timeout");
  merged.plc_read_retry_count = merged.plc_read_retry_count || m.plc_test_retry_count || 3;
  if (!payload.plc_read_retry_count && (m.plc_test_retry_count || 3)) sourceParts.push("database-machine-config:retry");
  if (merged.plc_start_register === null || merged.plc_start_register === undefined) {
    merged.plc_start_register = m.plc_part_register ?? m.plc_start_register ?? null;
    sourceParts.push("database-machine-config:startRegister");
  }
  if (merged.plc_end_register === null || merged.plc_end_register === undefined) {
    merged.plc_end_register = merged.plc_start_register;
    sourceParts.push("fallback/default-config:endRegister");
  }
  merged.__configSource = sourceParts.join("|");
  return merged;
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
  const message = String(error?.message || "");
  if (/timeout|plc packet timeout|connect timeout|econnrefused|ehostunreach|enetunreach/i.test(message)) {
    return res.status(504).json({
      error: `Scanner/PLC read timeout: ${message}`,
    });
  }
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      error: "Scanner configuration already exists",
      details: error.errors.map((entry) => entry.path || entry.message),
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

async function ensureSharedScannerSchema() {
  await ensureScannerIpCanBeShared();
  await ensureMachineQrScannerUniqueness();
}

async function createScannerWithSharedIp(payload) {
  try {
    return await Scanner.create(payload);
  } catch (error) {
    if (error.name !== "SequelizeUniqueConstraintError") throw error;
    await ensureSharedScannerSchema();
    return Scanner.create(payload);
  }
}

async function updateScannerWithSharedIp(scanner, payload) {
  try {
    await scanner.update(payload);
  } catch (error) {
    if (error.name !== "SequelizeUniqueConstraintError") throw error;
    await ensureSharedScannerSchema();
    await scanner.update(payload);
  }
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
      const health = getScannerHealthSnapshot({ scannerIp: scanner.scanner_ip }) || null;
      const connected = Boolean(health?.connected);
      return res.json({
        scannerId: scanner.id,
        scannerMode: mode,
        reachable: connected,
        status: connected ? "REACHABLE" : "NO_RECENT_USB_ACTIVITY",
        checkedAt: new Date().toISOString(),
        connection: health,
        message: connected
          ? "USB scanner activity was recently detected on this station."
          : "No recent USB scanner activity. Scan once on the station system, then test again.",
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
        reachable: Boolean(merged.connected && merged.lastDataAt),
        status: merged.connected && merged.lastDataAt ? "RECEIVING_DATA" : "WAITING_FOR_PUSH_DATA",
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
    let payload = toPayload(req.body);
    payload = await resolveScannerReadConfig(payload);
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

    payload.__requestSource = "scanner-page";
    const read = await readPartIdFromScannerPlc(payload);
    const partIdText = String(read.partId || "").trim();
    const waitingForPartId = !partIdText || /^0+$/.test(partIdText);
    const hasLiveData = Object.keys(read.rawValues || {}).length > 0;
    return res.json({
      success: true,
      scannerMode: mode,
      partIdPreview: partIdText || null,
      waitingForPartId,
      hasLiveData,
      read,
      message: waitingForPartId
        ? "PLC is live. Waiting for non-zero part ID."
        : "PLC read success. Part ID decoded.",
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (/timeout|plc packet timeout|connect timeout|econnrefused|ehostunreach|enetunreach/i.test(message)) {
      return res.status(504).json({ error: "PLC read timeout. Please verify scanner PLC mapping and try again." });
    }
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

    await ensureSharedScannerSchema();
    const created = await createScannerWithSharedIp(payload);
    await syncMachineScannerIp(created.mapped_machine_id, created.scanner_ip);
    emitRealtime("dashboard_refresh", { reason: "SCANNER_CREATED", scannerId: created.id, machineId: created.mapped_machine_id || null });
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

    const previousMachineId = scanner.mapped_machine_id;
    const previousScannerIp = scanner.scanner_ip;
    await ensureSharedScannerSchema();
    await updateScannerWithSharedIp(scanner, payload);
    if (Number(previousMachineId || 0) !== Number(scanner.mapped_machine_id || 0)) {
      await clearMachineScannerIpIfMatched(previousMachineId, previousScannerIp);
    }
    await syncMachineScannerIp(scanner.mapped_machine_id, scanner.scanner_ip);
    if (!sameScannerIp(previousScannerIp, scanner.scanner_ip)) {
      clearScannerHealth({ scannerIp: previousScannerIp, machineId: previousMachineId });
      await scannerService.clearScannerConnection(previousScannerIp);
    }
    emitRealtime("dashboard_refresh", { reason: "SCANNER_UPDATED", scannerId: scanner.id, machineId: scanner.mapped_machine_id || null });
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
    const machineId = scanner.mapped_machine_id || null;
    const scannerIp = scanner.scanner_ip;
    clearScannerHealth({ scannerIp: scanner.scanner_ip, machineId: scanner.mapped_machine_id });
    await clearMachineScannerIpIfMatched(machineId, scannerIp);
    await scannerService.clearScannerConnection(scannerIp);
    await scanner.destroy();
    emitRealtime("scanner_health", {
      scannerId: id,
      scannerIp,
      machineId,
      status: "NOT_CONFIGURED",
      connected: false,
    });
    emitRealtime("dashboard_refresh", { reason: "SCANNER_DELETED", scannerId: id, machineId });
    res.status(204).send();
  } catch (error) {
    handleError(error, res);
  }
};
