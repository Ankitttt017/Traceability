const { Op, fn, col } = require("sequelize");
const Part = require("../models/Part");
const Machine = require("../models/Machine");
const Scanner = require("../models/Scanner");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const ReworkLog = require("../models/ReworkLog");
const Shift = require("../models/Shift");
const { saveScan } = require("../services/scanService");
const { executePlcHandshake, getPlcCircuitSnapshot } = require("../services/plcSocketService");
const { readModbusRegisters, probeTcpEndpoint } = require("../services/plcIoService");
const { getPlcHealthSnapshot } = require("../services/plcHealthService");
const { getScannerHealthSnapshot } = require("../services/scannerHealthService");
const { emitRealtime } = require("../services/realtimeService");
const { tryAcquireMachineLock, clearMachineLock } = require("../services/machineLockService");

function normalizeIp(ip) {
  return String(ip || "").replace("::ffff:", "").trim();
}

function normalizeStation(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getMachineOperationStage(machine) {
  return normalizeStation(machine?.operation_no);
}

function uniqueStages(stages) {
  const seen = new Set();
  const output = [];
  for (const stage of stages) {
    if (!stage || seen.has(stage)) {
      continue;
    }
    seen.add(stage);
    output.push(stage);
  }
  return output;
}

function toIntegerOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function evaluateSignalState(signalKey, value, machine, latestPlcStatus) {
  const startValue = toIntegerOrNull(machine?.plc_start_value) ?? 1;
  const startedValue = toIntegerOrNull(machine?.plc_started_value) ?? 2;
  const endOkValue = toIntegerOrNull(machine?.plc_end_ok_value) ?? 3;
  const endNgValue = toIntegerOrNull(machine?.plc_end_ng_value) ?? 4;
  const resetValue = toIntegerOrNull(machine?.plc_reset_value) ?? 9;

  if (value === null || value === undefined) {
    if (signalKey === "TRIGGER" && latestPlcStatus === "STARTED") {
      return { status: "RUNNING", tone: "warn" };
    }
    if (signalKey === "INTERLOCK") {
      if (latestPlcStatus === "ENDED_OK") {
        return { status: "PASS", tone: "good" };
      }
      if (latestPlcStatus === "ENDED_NG" || latestPlcStatus === "INTERLOCKED") {
        return { status: "FAIL", tone: "error" };
      }
      if (latestPlcStatus === "STARTED" || latestPlcStatus === "PENDING") {
        return { status: "IN_PROGRESS", tone: "warn" };
      }
      if (latestPlcStatus === "PLC_COMM_ERROR") {
        return { status: "COMM_ERROR", tone: "error" };
      }
    }
    return { status: "NO_DATA", tone: "muted" };
  }

  if (signalKey === "TRIGGER") {
    if (value === startValue) {
      return { status: "TRIGGERED", tone: "good" };
    }
    if (value === 0) {
      return { status: "IDLE", tone: "idle" };
    }
    return { status: "VALUE_MISMATCH", tone: "warn" };
  }

  if (signalKey === "INTERLOCK") {
    if (value === endOkValue) {
      return { status: "PASS", tone: "good" };
    }
    if (value === endNgValue) {
      return { status: "FAIL", tone: "error" };
    }
    if (value === startedValue) {
      return { status: "STARTED", tone: "warn" };
    }
    if (value === 0) {
      return { status: "WAIT", tone: "idle" };
    }
    return { status: "UNKNOWN", tone: "warn" };
  }

  if (signalKey === "COMPLETE") {
    if (value === endOkValue) {
      return { status: "PASS", tone: "good" };
    }
    if (value === endNgValue) {
      return { status: "FAIL", tone: "error" };
    }
    if (value === startedValue) {
      return { status: "IN_PROGRESS", tone: "warn" };
    }
    if (value === 0) {
      return { status: "WAIT", tone: "idle" };
    }
    return { status: "UNKNOWN", tone: "warn" };
  }

  if (signalKey === "RESET") {
    if (value === resetValue) {
      return { status: "RESET_REQUESTED", tone: "warn" };
    }
    if (value === 0) {
      return { status: "IDLE", tone: "idle" };
    }
    return { status: "ACTIVE", tone: "warn" };
  }

  return { status: "UNKNOWN", tone: "warn" };
}

function buildIoSignalRows(machine, registerValues, latestPlcStatus) {
  const signalMap = [
    {
      key: "TRIGGER",
      label: "TRIGGER",
      register: toIntegerOrNull(machine?.plc_start_register),
      direction: "PC -> PLC",
      description: "Start command written by software to PLC",
    },
    {
      key: "INTERLOCK",
      label: "INTERLOCK",
      register: toIntegerOrNull(machine?.plc_status_register),
      direction: "PLC -> PC",
      description: "Handshake status read by software from PLC",
    },
    {
      key: "COMPLETE",
      label: "COMPLETE",
      register: toIntegerOrNull(machine?.plc_station_register),
      direction: "PLC -> PC",
      description: "Completion/confirmation signal read by software",
    },
    {
      key: "RESET",
      label: "RESET",
      register: toIntegerOrNull(machine?.plc_reset_register),
      direction: "PC -> PLC",
      description: "Reset command written by software to PLC",
    },
  ];

  return signalMap.map((entry) => {
    const currentValue =
      entry.register !== null && registerValues && Object.prototype.hasOwnProperty.call(registerValues, entry.register)
        ? registerValues[entry.register]
        : null;
    const state = entry.register === null
      ? { status: "NOT_CONFIGURED", tone: "muted" }
      : evaluateSignalState(entry.key, currentValue, machine, latestPlcStatus);
    return {
      signal: entry.label,
      register: entry.register,
      direction: entry.direction,
      currentValue,
      status: state.status,
      tone: state.tone,
      description: entry.description,
    };
  });
}

async function resolveMachineFromRequest(body, req) {
  if (body.machineId) {
    return Machine.findByPk(body.machineId);
  }

  const explicitScannerIp = normalizeIp(body.scannerIp);
  const clientIp =
    explicitScannerIp || normalizeIp(req.ip) || normalizeIp(req.socket?.remoteAddress) || normalizeIp(req.connection?.remoteAddress);

  const scanner = await Scanner.findOne({
    where: { scanner_ip: clientIp, is_active: true },
  });
  if (scanner) {
    const mapped = await Machine.findByPk(scanner.mapped_machine_id);
    if (mapped) {
      return mapped;
    }
  }

  return Machine.findOne({
    where: {
      [Op.or]: [{ machine_ip: clientIp }, { plc_ip: clientIp }, { qr_scanner_ip: clientIp }],
      is_active: true,
    },
  });
}

async function getActiveStationSequence() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    order: [["sequence_no", "ASC"]],
  });

  return uniqueStages(machines.map((machine) => getMachineOperationStage(machine)));
}

async function getActiveMachineSequenceData() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    order: [["sequence_no", "ASC"]],
  });

  const sequence = uniqueStages(machines.map((machine) => getMachineOperationStage(machine)));
  const stationMachineMap = machines.reduce((acc, machine) => {
    const station = getMachineOperationStage(machine);
    if (!station) {
      return acc;
    }
    if (!acc[station]) {
      acc[station] = [];
    }
    acc[station].push(machine.id);
    return acc;
  }, {});

  return { machines, sequence, stationMachineMap };
}

function toJourneyRow(log) {
  return {
    id: log.id,
    stationNo: normalizeStation(log.station_no || log.operation_no),
    plcStatus: log.plc_status,
    plcStartTime: log.plc_start_time || log.plc_start_at,
    plcEndTime: log.plc_end_time || log.plc_end_at,
    result: log.result,
    interlockReason: log.interlock_reason,
    machineId: log.machine_id,
    isBypassed: Boolean(log.is_bypassed),
    bypassReason: log.bypass_reason,
    createdAt: log.createdAt,
  };
}

function getQualitySummaryFromOperationLogs(rows) {
  const summary = {
    okCount: 0,
    ngCount: 0,
    interlockedCount: 0,
    commErrorCount: 0,
    inProgressCount: 0,
  };

  for (const row of rows) {
    if (row.plc_status === "ENDED_OK" && row.result === "OK") {
      summary.okCount += 1;
      continue;
    }
    if (row.plc_status === "ENDED_NG" && row.result === "NG") {
      summary.ngCount += 1;
      continue;
    }
    if (row.plc_status === "INTERLOCKED") {
      summary.interlockedCount += 1;
      continue;
    }
    if (row.plc_status === "PLC_COMM_ERROR") {
      summary.commErrorCount += 1;
      continue;
    }
    if (row.plc_status === "PENDING" || row.plc_status === "STARTED") {
      summary.inProgressCount += 1;
    }
  }

  const processedCount = summary.okCount + summary.ngCount;
  const accuracy = processedCount > 0 ? Number(((summary.okCount / processedCount) * 100).toFixed(2)) : 0;

  return {
    ...summary,
    processedCount,
    accuracy,
  };
}

async function getLatestOperationLog(partId, stationNo) {
  return OperationLog.findOne({
    where: {
      part_id: partId,
      station_no: normalizeStation(stationNo),
    },
    order: [["createdAt", "DESC"]],
  });
}

function emitOperatorPopup(type, payload) {
  emitRealtime("operator_popup", {
    type,
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

function buildScannerHealth(scanner, machineId) {
  if (!scanner) {
    return {
      scannerId: null,
      scannerIp: null,
      scannerName: null,
      machineId: machineId || null,
      status: "NOT_CONFIGURED",
      connected: false,
      lastSeenAt: null,
    };
  }

  const health = getScannerHealthSnapshot({ scannerIp: scanner.scanner_ip });
  if (health) {
    return health;
  }

  return {
    scannerId: scanner.id,
    scannerIp: scanner.scanner_ip,
    scannerName: scanner.scanner_name,
    machineId: machineId || null,
    status: "DISCONNECTED",
    connected: false,
    lastSeenAt: null,
  };
}

function mapScanDecisionToPopupType(scanResult) {
  if (scanResult?.decision === "ALLOW") {
    return "INFO";
  }
  return "ERROR";
}

async function rollbackPendingOperation({ partId, operationLogId }) {
  if (operationLogId) {
    await OperationLog.destroy({ where: { id: operationLogId } });
  }

  const part = await Part.findOne({ where: { part_id: partId } });
  if (!part) {
    return;
  }

  part.current_operation = normalizeStation(part.current_station || null);
  if (!part.current_operation) {
    part.current_operation = null;
  }
  await part.save();
}

async function markOperationStarted(operationLogId, machineId) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (!opLog) {
    return null;
  }
  await opLog.update({
    plc_status: "STARTED",
    machine_id: machineId,
    plc_start_time: new Date(),
    plc_start_at: new Date(),
  });
  return opLog;
}

async function markOperationEndedOk({ operationLogId, partId, stationNo, machineId, userId }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (!opLog) {
    return null;
  }
  await opLog.update({
    plc_status: "ENDED_OK",
    result: "OK",
    machine_id: machineId,
    plc_end_time: new Date(),
    plc_end_at: new Date(),
    interlock_reason: null,
    is_bypassed: false,
    bypass_reason: null,
  });

  const part = await Part.findOne({ where: { part_id: partId } });
  if (part) {
    const sequence = await getActiveStationSequence();
    const isLastStation = sequence.length > 0 && normalizeStation(stationNo) === sequence[sequence.length - 1];
    part.current_station = normalizeStation(stationNo);
    part.current_operation = normalizeStation(stationNo);
    part.status = isLastStation ? "COMPLETED" : "IN_PROGRESS";
    part.is_interlocked = false;
    part.interlock_reason = null;
    part.is_rework = false;
    await part.save();
  }

  await ProductionLog.create({
    part_id: partId,
    machine_id: machineId,
    user_id: userId || null,
    status: "OK",
    ng_reason: "PLC_END_OK",
  });

  return opLog;
}

async function markOperationEndedNg({ operationLogId, partId, stationNo, machineId, userId, reason }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (!opLog) {
    return null;
  }
  await opLog.update({
    plc_status: "ENDED_NG",
    result: "NG",
    machine_id: machineId,
    plc_end_time: new Date(),
    plc_end_at: new Date(),
    interlock_reason: reason || "PLC_END_NG",
    is_bypassed: false,
    bypass_reason: null,
  });

  const part = await Part.findOne({ where: { part_id: partId } });
  if (part) {
    part.current_station = normalizeStation(stationNo);
    part.current_operation = normalizeStation(stationNo);
    part.status = "NG";
    part.is_interlocked = true;
    part.interlock_reason = reason || "PLC_END_NG_INTERLOCK";
    await part.save();
  }

  await ProductionLog.create({
    part_id: partId,
    machine_id: machineId,
    user_id: userId || null,
    status: "NG",
    ng_reason: reason || "PLC_END_NG",
  });

  return opLog;
}

async function markOperationCommunicationError({ operationLogId, partId, stationNo, machineId, reason }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (opLog) {
    await opLog.update({
      plc_status: "PLC_COMM_ERROR",
      interlock_reason: reason || "PLC_COMMUNICATION_FAILED",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
    });
  }

  const part = await Part.findOne({ where: { part_id: partId } });
  if (part) {
    part.current_operation = normalizeStation(stationNo);
    part.status = part.is_rework ? "REWORK" : "IN_PROGRESS";
    part.is_interlocked = false;
    part.interlock_reason = reason || "PLC_COMMUNICATION_FAILED";
    await part.save();
  }
}

async function startPlcFlow({ operationLogId, partId, stationNo, machine, userId }) {
  const plcIp = machine.plc_ip || machine.machine_ip;
  const plcPort = machine.plc_port || machine.machine_port;

  try {
    await executePlcHandshake({
      ip: plcIp,
      port: plcPort,
      partId,
      stationNo,
      machineId: machine.id,
      machine,
      onAckStart: async () => {
        await markOperationStarted(operationLogId, machine.id);
        emitOperatorPopup("INFO", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "STARTED",
          plcStatus: "STARTED",
          qrResult: "PASS",
          message: "PLC start acknowledged",
        });
        emitRealtime("dashboard_refresh", { reason: "PLC_START_ACK" });
      },
      onAckEndOk: async () => {
        await markOperationEndedOk({
          operationLogId,
          partId,
          stationNo,
          machineId: machine.id,
          userId,
        });
        emitOperatorPopup("SUCCESS", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "ENDED_OK",
          plcStatus: "ENDED_OK",
          qrResult: "PASS",
          message: "Operation Passed",
        });
        emitRealtime("dashboard_refresh", { reason: "PLC_END_OK" });
      },
      onAckEndNg: async () => {
        await markOperationEndedNg({
          operationLogId,
          partId,
          stationNo,
          machineId: machine.id,
          userId,
          reason: "PLC_END_NG",
        });
        emitOperatorPopup("ERROR", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "ENDED_NG",
          plcStatus: "ENDED_NG",
          qrResult: "PASS",
          message: "Operation Failed (NG)",
        });
        emitRealtime("dashboard_refresh", { reason: "PLC_END_NG" });
      },
      onFailure: async (error) => {
        await markOperationCommunicationError({
          operationLogId,
          partId,
          stationNo,
          machineId: machine.id,
          reason: `PLC_TIMEOUT_${String(error.message || "").slice(0, 120)}`,
        });
        emitOperatorPopup("WARNING", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "PLC_COMM_ERROR",
          plcStatus: "PLC_COMM_ERROR",
          qrResult: "PASS",
          message: "PLC communication issue. Use Reset Operation, then scan again.",
        });
        emitRealtime("dashboard_refresh", { reason: "PLC_COMM_ERROR" });
      },
    });
  } finally {
    await clearMachineLock(machine.id);
  }
}

exports.getPartTraceability = async (req, res) => {
  try {
    const { partId } = req.params;
    const part = await Part.findOne({ where: { part_id: partId } });
    const history = await OperationLog.findAll({
      where: { part_id: partId },
      order: [["createdAt", "ASC"]],
    });
    const reworkHistory = await ReworkLog.findAll({
      where: { part_id: partId },
      order: [["createdAt", "DESC"]],
    });

    if (!part && history.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }

    res.json({
      part: part || { part_id: partId, status: "UNKNOWN", current_station: null },
      history,
      reworkHistory,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPlcHealth = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    const health = machineId ? getPlcHealthSnapshot(machineId) : getPlcHealthSnapshot();
    const circuits = getPlcCircuitSnapshot();

    if (machineId) {
      const machineCircuit = circuits.find((entry) => entry.key === `machine:${machineId}`) || null;
      return res.json({
        health: health || null,
        circuit: machineCircuit,
      });
    }

    res.json({
      health,
      circuits,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getScannerHealth = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    if (!machineId) {
      return res.json({
        health: getScannerHealthSnapshot(),
      });
    }

    const scanner = await Scanner.findOne({
      where: {
        mapped_machine_id: machineId,
        is_active: true,
      },
      order: [["updatedAt", "DESC"]],
    });

    res.json({
      health: buildScannerHealth(scanner, machineId),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getLiveMachineState = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    if (!machineId) {
      return res.status(400).json({ error: "machineId query param is required" });
    }

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }
    const scanner = await Scanner.findOne({
      where: {
        mapped_machine_id: machine.id,
        is_active: true,
      },
      order: [["updatedAt", "DESC"]],
    });

    const stationNo = getMachineOperationStage(machine);

    const logs = await OperationLog.findAll({
      where: { machine_id: machine.id, station_no: stationNo },
      order: [["createdAt", "DESC"]],
      limit: 20,
    });

    const current = logs.find((row) => row.plc_status === "STARTED" || row.plc_status === "PENDING") || null;
    const lastEvent = logs[0] || null;
    const plcHealth = getPlcHealthSnapshot(machine.id);
    const plcCircuit = getPlcCircuitSnapshot().find((entry) => entry.key === `machine:${machine.id}`) || null;
    const scannerHealth = buildScannerHealth(scanner, machine.id);

    res.json({
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        lineName: machine.line_name,
        sequenceNo: machine.sequence_no,
        operationNo: machine.operation_no,
        stationNo,
        machineIp: machine.machine_ip,
        plcIp: machine.plc_ip,
        plcPort: machine.plc_port,
        plcProtocol: machine.plc_protocol || "TCP_TEXT",
        plcRegisters: machine.plc_registers || null,
        isActive: machine.is_active,
        isRunning: Boolean(machine.is_running),
        runningPartId: machine.running_part_id || null,
        runningStationNo: machine.running_station_no || null,
        runningStartedAt: machine.running_started_at || null,
      },
      plcHealth: plcHealth || null,
      plcCircuit,
      scanner: scanner
        ? {
            id: scanner.id,
            scannerName: scanner.scanner_name,
            scannerIp: scanner.scanner_ip,
            scannerPort: scanner.scanner_port,
            isActive: scanner.is_active,
          }
        : null,
      scannerHealth,
      current: current
        ? {
            operationLogId: current.id,
            partId: current.part_id,
            plcStatus: current.plc_status,
            result: current.result,
            interlockReason: current.interlock_reason,
            isBypassed: current.is_bypassed,
            bypassReason: current.bypass_reason,
            createdAt: current.createdAt,
          }
        : null,
      lastEvent: lastEvent
        ? {
            operationLogId: lastEvent.id,
            partId: lastEvent.part_id,
            plcStatus: lastEvent.plc_status,
            result: lastEvent.result,
            interlockReason: lastEvent.interlock_reason,
            isBypassed: lastEvent.is_bypassed,
            bypassReason: lastEvent.bypass_reason,
            createdAt: lastEvent.createdAt,
          }
        : null,
      recent: logs.map((row) => ({
        id: row.id,
        partId: row.part_id,
        plcStatus: row.plc_status,
        result: row.result,
        interlockReason: row.interlock_reason,
        isBypassed: row.is_bypassed,
        bypassReason: row.bypass_reason,
        createdAt: row.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getIoSnapshot = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    if (!machineId) {
      return res.status(400).json({ error: "machineId query param is required" });
    }

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const requestedPlcIp = normalizeIp(req.query.plcIp);
    const effectivePlcIp = normalizeIp(machine.plc_ip || machine.machine_ip);
    if (requestedPlcIp && effectivePlcIp && requestedPlcIp !== effectivePlcIp) {
      return res.status(400).json({ error: "Selected machine does not belong to requested PLC IP" });
    }

    const stationNo = getMachineOperationStage(machine);
    const [latestLog, scanner] = await Promise.all([
      OperationLog.findOne({
        where: stationNo
          ? { machine_id: machine.id, station_no: stationNo }
          : { machine_id: machine.id },
        order: [["createdAt", "DESC"]],
      }),
      Scanner.findOne({
        where: {
          mapped_machine_id: machine.id,
          is_active: true,
        },
        order: [["updatedAt", "DESC"]],
      }),
    ]);

    const protocol = toUpper(machine.plc_protocol || "TCP_TEXT");
    const plcIp = machine.plc_ip || machine.machine_ip || null;
    const plcPort = toIntegerOrNull(machine.plc_port || machine.machine_port);
    const plcUnitId = toIntegerOrNull(machine.plc_unit_id) || 1;
    const timeoutMs = toIntegerOrNull(machine.plc_test_timeout_ms) || 2000;
    const registerList = [
      toIntegerOrNull(machine.plc_start_register),
      toIntegerOrNull(machine.plc_status_register),
      toIntegerOrNull(machine.plc_station_register),
      toIntegerOrNull(machine.plc_reset_register),
    ].filter((entry, index, array) => entry !== null && array.indexOf(entry) === index);

    const errors = [];
    const registerValues = {};
    const checkedAt = new Date().toISOString();
    const plcConnection = {
      connected: false,
      protocol,
      checkedAt,
      error: null,
    };

    if (!plcIp || !plcPort) {
      plcConnection.error = "PLC endpoint missing on machine configuration";
      errors.push(plcConnection.error);
    } else if (protocol === "MODBUS_TCP") {
      if (registerList.length === 0) {
        const message = "No Modbus register mapped on this machine";
        errors.push(message);
        plcConnection.error = message;
      } else {
        try {
          const readResult = await readModbusRegisters({
            ip: plcIp,
            port: plcPort,
            unitId: plcUnitId,
            registers: registerList,
            timeoutMs,
          });
          plcConnection.connected = true;
          for (const [registerNo, value] of Object.entries(readResult.values || {})) {
            registerValues[Number(registerNo)] = value;
          }
          if (Array.isArray(readResult.errors) && readResult.errors.length > 0) {
            for (const row of readResult.errors) {
              errors.push(
                `Register ${row.register}: ${row.message}`
              );
            }
          }
        } catch (error) {
          const message = String(error.message || "Unable to read PLC register values");
          plcConnection.error = message;
          errors.push(message);
        }
      }
    } else {
      try {
        await probeTcpEndpoint({
          ip: plcIp,
          port: plcPort,
          timeoutMs,
        });
        plcConnection.connected = true;
      } catch (error) {
        const message = String(error.message || "Unable to connect to PLC endpoint");
        plcConnection.error = message;
        errors.push(message);
      }
    }

    const latestPlcStatus = toUpper(latestLog?.plc_status);
    const rows = buildIoSignalRows(machine, registerValues, latestPlcStatus);
    const plcHealth = getPlcHealthSnapshot(machine.id) || null;
    const plcCircuit = getPlcCircuitSnapshot().find((entry) => entry.key === `machine:${machine.id}`) || null;
    const scannerHealth = buildScannerHealth(scanner, machine.id);

    res.json({
      snapshotAt: checkedAt,
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        lineName: machine.line_name,
        sequenceNo: machine.sequence_no,
        operationNo: machine.operation_no,
        stationNo,
        isRunning: Boolean(machine.is_running),
        runningPartId: machine.running_part_id || null,
        runningStationNo: machine.running_station_no || null,
        runningStartedAt: machine.running_started_at || null,
      },
      plc: {
        ip: plcIp,
        port: plcPort,
        protocol,
        unitId: plcUnitId,
      },
      plcConnection,
      plcHealth,
      plcCircuit,
      scanner: scanner
        ? {
            id: scanner.id,
            scannerName: scanner.scanner_name,
            scannerIp: scanner.scanner_ip,
            scannerPort: scanner.scanner_port,
            isActive: scanner.is_active,
          }
        : null,
      scannerHealth,
      latestOperation: latestLog
        ? {
            operationLogId: latestLog.id,
            partId: latestLog.part_id,
            plcStatus: latestLog.plc_status,
            result: latestLog.result,
            interlockReason: latestLog.interlock_reason,
            createdAt: latestLog.createdAt,
          }
        : null,
      rows,
      errors,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPartJourney = async (req, res) => {
  try {
    const { partId } = req.params;
    const [part, logs, reworkHistory, auditLogs, sequenceData] = await Promise.all([
      Part.findOne({ where: { part_id: partId } }),
      OperationLog.findAll({
        where: { part_id: partId },
        order: [["createdAt", "ASC"]],
      }),
      ReworkLog.findAll({
        where: { part_id: partId },
        order: [["createdAt", "DESC"]],
      }),
      ProductionLog.findAll({
        where: { part_id: partId },
        order: [["createdAt", "DESC"]],
        limit: 150,
      }),
      getActiveMachineSequenceData(),
    ]);

    if (!part && logs.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }

    const machineIds = uniqueStages(
      [...logs.map((log) => Number(log.machine_id)), ...auditLogs.map((log) => Number(log.machine_id))]
        .filter((entry) => Number.isFinite(entry) && entry > 0)
        .map((entry) => String(entry))
    )
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));

    const machineRows =
      machineIds.length > 0
        ? await Machine.findAll({
            where: { id: { [Op.in]: machineIds } },
            attributes: ["id", "machine_name", "operation_no", "sequence_no"],
          })
        : [];

    const machineMap = machineRows.reduce((acc, machine) => {
      acc[machine.id] = {
        id: machine.id,
        machineName: machine.machine_name,
        stationNo: getMachineOperationStage(machine),
        sequenceNo: machine.sequence_no,
      };
      return acc;
    }, {});

    const journey = logs.map(toJourneyRow);
    const logsByStation = journey.reduce((acc, row) => {
      if (!row.stationNo) {
        return acc;
      }
      if (!acc[row.stationNo]) {
        acc[row.stationNo] = [];
      }
      acc[row.stationNo].push(row);
      return acc;
    }, {});

    const knownStations = uniqueStages([
      ...sequenceData.sequence,
      ...Object.keys(logsByStation),
      ...auditLogs
        .map((entry) => {
          const machine = machineMap[Number(entry.machine_id)];
          return normalizeStation(machine?.stationNo);
        })
        .filter(Boolean),
    ]);

    const currentStation = normalizeStation(part?.current_station);
    const currentIndex = sequenceData.sequence.findIndex((station) => station === currentStation);
    const expectedNextStation =
      !part || part.status === "COMPLETED"
        ? null
        : currentIndex < 0
        ? sequenceData.sequence[0] || null
        : sequenceData.sequence[currentIndex + 1] || null;

    const stationTimeline = knownStations.map((stationNo, idx) => {
      const attempts = (logsByStation[stationNo] || []).map((row) => ({
        id: row.id,
        plcStatus: row.plcStatus,
        result: row.result,
        interlockReason: row.interlockReason,
        isBypassed: row.isBypassed,
        bypassReason: row.bypassReason,
        plcStartTime: row.plcStartTime,
        plcEndTime: row.plcEndTime,
        createdAt: row.createdAt,
        machine: machineMap[row.machineId] || null,
      }));

      const latestAttempt = attempts[attempts.length - 1] || null;
      let stageState = "PENDING";
      if (latestAttempt) {
        if (latestAttempt.plcStatus === "ENDED_OK") {
          stageState = "PASSED";
        } else if (latestAttempt.plcStatus === "ENDED_NG") {
          stageState = "FAILED";
        } else if (latestAttempt.plcStatus === "PLC_COMM_ERROR") {
          stageState = "COMM_ERROR";
        } else if (latestAttempt.plcStatus === "INTERLOCKED") {
          stageState = "INTERLOCKED";
        } else {
          stageState = "IN_PROGRESS";
        }
      } else if (expectedNextStation === stationNo) {
        stageState = "NEXT";
      }

      return {
        stationNo,
        sequenceIndex: idx + 1,
        stageState,
        isNextExpected: expectedNextStation === stationNo,
        latestStatus: latestAttempt?.plcStatus || null,
        latestResult: latestAttempt?.result || null,
        latestInterlockReason: latestAttempt?.interlockReason || null,
        latestAt: latestAttempt?.createdAt || null,
        attempts,
      };
    });

    const auditTrail = auditLogs.map((entry) => {
      const machine = machineMap[Number(entry.machine_id)] || null;
      return {
        id: entry.id,
        status: entry.status,
        reason: entry.ng_reason,
        machineId: entry.machine_id,
        machineName: machine?.machineName || null,
        stationNo: machine?.stationNo || null,
        createdAt: entry.createdAt,
      };
    });

    res.json({
      part,
      sequence: knownStations,
      expectedNextStation,
      journey,
      stationTimeline,
      interlockHistory: journey
        .filter((log) => log.interlockReason)
        .map((log) => ({
          id: log.id,
          stationNo: log.stationNo,
          reason: log.interlockReason,
          createdAt: log.createdAt,
        })),
      auditTrail,
      reworkHistory,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPartCatalog = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 400);

    const where = search
      ? {
          part_id: {
            [Op.like]: `%${search}%`,
          },
        }
      : undefined;

    const parts = await Part.findAll({
      where,
      order: [["updatedAt", "DESC"]],
      limit,
    });

    if (!parts.length) {
      return res.json([]);
    }

    const partIds = parts.map((part) => part.part_id);
    const logs = await OperationLog.findAll({
      where: { part_id: { [Op.in]: partIds } },
      order: [["createdAt", "DESC"]],
    });

    const latestByPart = new Map();
    for (const row of logs) {
      if (!latestByPart.has(row.part_id)) {
        latestByPart.set(row.part_id, row);
      }
    }

    const response = parts.map((part) => {
      const latest = latestByPart.get(part.part_id);
      return {
        partId: part.part_id,
        status: part.status,
        currentStation: part.current_station,
        currentOperation: part.current_operation,
        isInterlocked: Boolean(part.is_interlocked),
        interlockReason: part.interlock_reason,
        isRework: Boolean(part.is_rework),
        qrFormatName: part.qr_format_name,
        updatedAt: part.updatedAt,
        latestStatus: latest?.plc_status || null,
        latestResult: latest?.result || null,
        latestStation: normalizeStation(latest?.station_no || latest?.operation_no),
        latestAt: latest?.createdAt || null,
      };
    });

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMachineStationStats = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    if (!machineId) {
      return res.status(400).json({ error: "machineId query param is required" });
    }

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const scanner = await Scanner.findOne({
      where: {
        mapped_machine_id: machine.id,
        is_active: true,
      },
      order: [["updatedAt", "DESC"]],
    });

    const stationNo = getMachineOperationStage(machine);
    const { from, to } = getDateRangeFromQuery(req.query);

    const logs = await OperationLog.findAll({
      where: {
        machine_id: machine.id,
        station_no: stationNo,
        createdAt: {
          [Op.gte]: from,
          [Op.lte]: to,
        },
      },
      order: [["createdAt", "DESC"]],
      limit: 800,
    });

    const summary = getQualitySummaryFromOperationLogs(logs);
    const hourlyMap = logs.reduce((acc, row) => {
      const key = formatHourBucket(row.createdAt);
      if (!acc[key]) {
        acc[key] = { hour: key, ok: 0, ng: 0, interlocked: 0, commErrors: 0, total: 0 };
      }

      if (row.plc_status === "ENDED_OK" && row.result === "OK") {
        acc[key].ok += 1;
        acc[key].total += 1;
      } else if (row.plc_status === "ENDED_NG" && row.result === "NG") {
        acc[key].ng += 1;
        acc[key].total += 1;
      } else if (row.plc_status === "INTERLOCKED") {
        acc[key].interlocked += 1;
      } else if (row.plc_status === "PLC_COMM_ERROR") {
        acc[key].commErrors += 1;
      }
      return acc;
    }, {});

    const trend = Object.values(hourlyMap)
      .sort((a, b) => String(a.hour).localeCompare(String(b.hour)))
      .slice(-12);

    const current = logs.find((row) => row.plc_status === "STARTED" || row.plc_status === "PENDING") || null;
    const lastEvent = logs[0] || null;
    const recentParts = logs.slice(0, 10).map((row) => ({
      id: row.id,
      partId: row.part_id,
      plcStatus: row.plc_status,
      result: row.result,
      interlockReason: row.interlock_reason,
      isBypassed: row.is_bypassed,
      createdAt: row.createdAt,
    }));
    const plcHealth = getPlcHealthSnapshot(machine.id);
    const plcCircuit = getPlcCircuitSnapshot().find((entry) => entry.key === `machine:${machine.id}`) || null;
    const scannerHealth = buildScannerHealth(scanner, machine.id);

    res.json({
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        lineName: machine.line_name,
        sequenceNo: machine.sequence_no,
        stationNo,
      },
      range: {
        from,
        to,
      },
      plcHealth: plcHealth || null,
      plcCircuit,
      scanner: scanner
        ? {
            id: scanner.id,
            scannerName: scanner.scanner_name,
            scannerIp: scanner.scanner_ip,
            scannerPort: scanner.scanner_port,
            isActive: scanner.is_active,
          }
        : null,
      scannerHealth,
      summary,
      trend,
      current: current
        ? {
            operationLogId: current.id,
            partId: current.part_id,
            plcStatus: current.plc_status,
            result: current.result,
            interlockReason: current.interlock_reason,
            createdAt: current.createdAt,
          }
        : null,
      lastEvent: lastEvent
        ? {
            operationLogId: lastEvent.id,
            partId: lastEvent.part_id,
            plcStatus: lastEvent.plc_status,
            result: lastEvent.result,
            interlockReason: lastEvent.interlock_reason,
            createdAt: lastEvent.createdAt,
          }
        : null,
      recentParts,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.processScan = async (req, res) => {
  try {
    const { partId, stationNo, operation, result } = req.body;
    const normalizedPartId = String(partId || "").trim();
    if (!normalizedPartId) {
      return res.status(400).json({ error: "partId is required" });
    }

    const machine = await resolveMachineFromRequest(req.body, req);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found for scanner/IP mapping" });
    }

    const machineStage = getMachineOperationStage(machine);
    const requestedStage = normalizeStation(stationNo || operation);
    if (requestedStage && machineStage && requestedStage !== machineStage) {
      return res.status(400).json({
        error: `Requested station ${requestedStage} does not match machine operation ${machineStage}`,
      });
    }

    const normalizedStation = machineStage || requestedStage;
    if (!normalizedStation) {
      return res.status(400).json({ error: "stationNo/operation is required" });
    }

    const response = await saveScan(normalizedPartId, normalizedStation, result || "OK", machine.id, req.user?.id);

    if (response.decision === "ALLOW" && response.operationLogId) {
      const lock = await tryAcquireMachineLock({
        machineId: machine.id,
        partId: normalizedPartId,
        stationNo: normalizedStation,
      });

      if (!lock.acquired) {
        await rollbackPendingOperation({
          partId: normalizedPartId,
          operationLogId: response.operationLogId,
        });
        response.decision = "BLOCK";
        response.reason = "MACHINE_RUNNING";
        response.message = lock.runningPartId
          ? `Machine busy. Current part ${lock.runningPartId} is in operation.`
          : "Machine busy with another cycle. Retry after current operation completes.";
        response.operationLogId = null;
        response.lock = {
          runningPartId: lock.runningPartId || null,
          runningStationNo: lock.runningStationNo || null,
          runningStartedAt: lock.runningStartedAt || null,
        };
      } else {
        startPlcFlow({
          operationLogId: response.operationLogId,
          partId: normalizedPartId,
          stationNo: normalizedStation,
          machine,
          userId: req.user?.id,
        }).catch((error) => {
          console.error("PLC flow failed:", error.message);
        });
        response.plcHandshake = "INITIATED";
      }
    }

    const qrStatus = response.decision === "ALLOW" || response.reason === "MACHINE_RUNNING" ? "PASS" : "FAIL";
    const operationStatus = response.decision === "ALLOW" ? "PENDING" : "WAIT";
    emitOperatorPopup(mapScanDecisionToPopupType(response), {
      partId: normalizedPartId,
      stationNo: normalizedStation,
      machineId: machine.id,
      machineName: machine.machine_name,
      status: operationStatus,
      plcStatus: operationStatus,
      qrResult: qrStatus,
      reason: response.reason || null,
      expectedStation: response.expectedStation || null,
      qrReason: response.reason || null,
      message: response.message || response.reason || "Scan processed",
    });

    response.qrStatus = qrStatus;
    response.operationStatus = operationStatus;

    res.json({
      ...response,
      partId: normalizedPartId,
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        stationNo: getMachineOperationStage(machine),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.verifyScanForOperator = async (req, res) => {
  try {
    const { qrCode, machineId, result } = req.body;
    const normalizedPartId = String(qrCode || "").trim();
    if (!normalizedPartId || !machineId) {
      return res.status(400).json({ error: "qrCode and machineId are required" });
    }

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const stationNo = getMachineOperationStage(machine);
    const response = await saveScan(normalizedPartId, stationNo, result || "OK", machine.id, req.user?.id);

    if (response.decision === "ALLOW" && response.operationLogId) {
      const lock = await tryAcquireMachineLock({
        machineId: machine.id,
        partId: normalizedPartId,
        stationNo,
      });

      if (!lock.acquired) {
        await rollbackPendingOperation({
          partId: normalizedPartId,
          operationLogId: response.operationLogId,
        });
        response.decision = "BLOCK";
        response.reason = "MACHINE_RUNNING";
        response.message = lock.runningPartId
          ? `Machine busy. Current part ${lock.runningPartId} is in operation.`
          : "Machine busy with another cycle. Retry after current operation completes.";
        response.operationLogId = null;
        response.lock = {
          runningPartId: lock.runningPartId || null,
          runningStationNo: lock.runningStationNo || null,
          runningStartedAt: lock.runningStartedAt || null,
        };
      } else {
        startPlcFlow({
          operationLogId: response.operationLogId,
          partId: normalizedPartId,
          stationNo,
          machine,
          userId: req.user?.id,
        }).catch((error) => {
          console.error("PLC flow failed:", error.message);
        });
        response.plcHandshake = "INITIATED";
      }
    }

    const qrStatus = response.decision === "ALLOW" || response.reason === "MACHINE_RUNNING" ? "PASS" : "FAIL";
    const operationStatus = response.decision === "ALLOW" ? "PENDING" : "WAIT";
    emitOperatorPopup(mapScanDecisionToPopupType(response), {
      partId: normalizedPartId,
      stationNo,
      machineId: machine.id,
      machineName: machine.machine_name,
      status: operationStatus,
      plcStatus: operationStatus,
      qrResult: qrStatus,
      reason: response.reason || null,
      expectedStation: response.expectedStation || null,
      qrReason: response.reason || null,
      message: response.message || response.reason || "Scan processed",
    });

    response.qrStatus = qrStatus;
    response.operationStatus = operationStatus;

    res.json({
      status: response.decision === "ALLOW" ? "OK" : "NG",
      ...response,
      partId: normalizedPartId,
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        stationNo,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.confirmOperationStart = async (req, res) => {
  try {
    const { partId, stationNo, operation, machineId } = req.body;
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }

    const machine = machineId ? await Machine.findByPk(machineId) : await resolveMachineFromRequest(req.body, req);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const machineStage = getMachineOperationStage(machine);
    const requestedStage = normalizeStation(stationNo || operation);
    if (requestedStage && machineStage && requestedStage !== machineStage) {
      return res.status(400).json({
        error: `Requested station ${requestedStage} does not match machine operation ${machineStage}`,
      });
    }

    const station = machineStage || requestedStage;
    const opLog = await getLatestOperationLog(partId, station);
    if (!opLog) {
      return res.status(404).json({ error: "Operation log not found for this part/station" });
    }

    await markOperationStarted(opLog.id, machine.id);
    emitOperatorPopup("INFO", {
      partId,
      stationNo: station,
      machineId: machine.id,
      machineName: machine.machine_name,
      status: "STARTED",
      plcStatus: "STARTED",
      qrResult: "PASS",
      message: "Operation started by PLC",
    });

    res.json({
      message: "Operation start confirmed",
      partId,
      stationNo: station,
      plcStatus: "STARTED",
      operationLogId: opLog.id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.confirmOperationEnd = async (req, res) => {
  try {
    const { partId, stationNo, operation, machineId, finalResult } = req.body;
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }

    const machine = machineId ? await Machine.findByPk(machineId) : await resolveMachineFromRequest(req.body, req);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const machineStage = getMachineOperationStage(machine);
    const requestedStage = normalizeStation(stationNo || operation);
    if (requestedStage && machineStage && requestedStage !== machineStage) {
      return res.status(400).json({
        error: `Requested station ${requestedStage} does not match machine operation ${machineStage}`,
      });
    }

    const station = machineStage || requestedStage;
    const opLog = await getLatestOperationLog(partId, station);
    if (!opLog) {
      return res.status(404).json({ error: "Operation log not found for this part/station" });
    }

    const normalized = String(finalResult || "OK").toUpperCase() === "OK" ? "OK" : "NG";
    if (normalized === "OK") {
      await markOperationEndedOk({
        operationLogId: opLog.id,
        partId,
        stationNo: station,
        machineId: machine.id,
        userId: req.user?.id,
      });
      emitOperatorPopup("SUCCESS", {
        partId,
        stationNo: station,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "ENDED_OK",
        plcStatus: "ENDED_OK",
        qrResult: "PASS",
        message: "Operation Passed",
      });
    } else {
      await markOperationEndedNg({
        operationLogId: opLog.id,
        partId,
        stationNo: station,
        machineId: machine.id,
        userId: req.user?.id,
        reason: "PLC_END_NG",
      });
      emitOperatorPopup("ERROR", {
        partId,
        stationNo: station,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "ENDED_NG",
        plcStatus: "ENDED_NG",
        qrResult: "PASS",
        message: "Operation Failed (NG)",
      });
    }

    await clearMachineLock(machine.id);
    emitRealtime("dashboard_refresh", { reason: "PLC_CONFIRMATION" });
    res.json({
      message: "Operation end confirmed",
      partId,
      stationNo: station,
      plcStatus: normalized === "OK" ? "ENDED_OK" : "ENDED_NG",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.reworkPart = async (req, res) => {
  try {
    const { partId, stationNo, reason } = req.body;
    if (!partId || !stationNo) {
      return res.status(400).json({ error: "partId and stationNo are required" });
    }

    const part = await Part.findOne({ where: { part_id: partId } });
    if (!part) {
      return res.status(404).json({ error: "Part not found" });
    }

    const sequence = await getActiveStationSequence();
    const targetStation = normalizeStation(stationNo);
    const targetIndex = sequence.findIndex((station) => station === targetStation);
    if (targetIndex === -1) {
      return res.status(400).json({ error: "Invalid stationNo for rework" });
    }

    const previousStation = targetIndex > 0 ? sequence[targetIndex - 1] : null;

    await ReworkLog.create({
      part_id: partId,
      from_station: part.current_station || null,
      to_station: targetStation,
      reason: reason || "Manual rework",
      user_id: req.user?.id || null,
    });

    part.status = "REWORK";
    part.is_rework = true;
    part.is_interlocked = false;
    part.interlock_reason = null;
    part.current_station = previousStation;
    part.current_operation = previousStation;
    await part.save();

    emitOperatorPopup("INFO", {
      partId,
      stationNo: targetStation,
      status: "REWORK",
      message: "Part moved to rework flow",
    });
    emitRealtime("dashboard_refresh", { reason: "PART_REWORK" });

    res.json({
      message: "Part moved to rework",
      partId,
      restartFromStation: targetStation,
      previousStation,
      status: part.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resetInterlock = async (req, res) => {
  try {
    const { partId, reason } = req.body;
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }

    const part = await Part.findOne({ where: { part_id: partId } });
    if (!part) {
      return res.status(404).json({ error: "Part not found" });
    }

    part.is_interlocked = false;
    part.interlock_reason = null;
    if (part.status === "INTERLOCKED") {
      part.status = part.is_rework ? "REWORK" : "IN_PROGRESS";
    }
    await part.save();

    emitOperatorPopup("INFO", {
      partId,
      stationNo: part.current_station,
      status: "INTERLOCK_RESET",
      message: reason || "Interlock reset by admin",
    });
    emitRealtime("dashboard_refresh", { reason: "INTERLOCK_RESET" });

    res.json({
      message: "Interlock reset successful",
      partId,
      status: part.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resetOperation = async (req, res) => {
  try {
    const partId = String(req.body.partId || "").trim();
    const targetStation = normalizeStation(req.body.stationNo || req.body.operationNo);

    if (!partId || !targetStation) {
      return res.status(400).json({ error: "partId and stationNo are required" });
    }

    const [part, opLog, sequence] = await Promise.all([
      Part.findOne({ where: { part_id: partId } }),
      getLatestOperationLog(partId, targetStation),
      getActiveStationSequence(),
    ]);

    if (!part) {
      return res.status(404).json({ error: "Part not found" });
    }

    if (!opLog) {
      return res.status(404).json({ error: "Operation log not found for this part/station" });
    }

    const targetIndex = sequence.findIndex((station) => station === targetStation);
    if (targetIndex === -1) {
      return res.status(400).json({ error: "Invalid stationNo for reset-operation" });
    }

    const previousStation = targetIndex > 0 ? sequence[targetIndex - 1] : null;

    await opLog.update({
      plc_status: "RESET",
      result: "OK",
      interlock_reason: null,
      is_bypassed: false,
      bypass_reason: null,
      plc_end_time: null,
      plc_end_at: null,
    });

    part.current_station = previousStation;
    part.current_operation = previousStation;
    part.is_interlocked = false;
    part.interlock_reason = null;
    if (part.status !== "COMPLETED") {
      part.status = part.is_rework ? "REWORK" : "IN_PROGRESS";
    }
    await part.save();

    if (opLog.machine_id) {
      await clearMachineLock(opLog.machine_id);
    }

    emitOperatorPopup("INFO", {
      partId,
      stationNo: targetStation,
      machineId: opLog.machine_id || null,
      status: "WAIT",
      plcStatus: "WAIT",
      qrResult: "WAIT",
      message: "Operation manually reset by operator. Scan again to restart.",
    });
    emitRealtime("dashboard_refresh", { reason: "OPERATION_RESET" });

    res.json({
      message: "Operation reset successful",
      partId,
      stationNo: targetStation,
      previousStation,
      operationLogId: opLog.id,
      plcStatus: "PENDING",
      partStatus: part.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resetStationOperation = async (req, res) => {
  try {
    const partId = String(req.body.partId || "").trim();
    const targetStation = normalizeStation(req.body.stationNo || req.body.operationNo);
    const reason = String(req.body.reason || "").trim();

    if (!partId || !targetStation) {
      return res.status(400).json({ error: "partId and stationNo are required" });
    }

    const [part, sequenceData] = await Promise.all([Part.findOne({ where: { part_id: partId } }), getActiveMachineSequenceData()]);

    if (!part) {
      return res.status(404).json({ error: "Part not found" });
    }

    const targetIndex = sequenceData.sequence.findIndex((station) => station === targetStation);
    if (targetIndex === -1) {
      return res.status(400).json({ error: "Invalid stationNo for reset" });
    }

    const targetStations = sequenceData.sequence.slice(targetIndex);
    const previousStation = targetIndex > 0 ? sequenceData.sequence[targetIndex - 1] : null;

    const logs = await OperationLog.findAll({
      where: { part_id: partId },
      order: [["createdAt", "DESC"]],
    });

    const operationLogIdsToDelete = logs
      .filter((log) => {
        const station = normalizeStation(log.station_no || log.operation_no);
        return targetStations.includes(station);
      })
      .map((log) => log.id);

    if (operationLogIdsToDelete.length > 0) {
      await OperationLog.destroy({
        where: { id: { [Op.in]: operationLogIdsToDelete } },
      });
    }

    const machineIdsForStations = targetStations.flatMap((station) => sequenceData.stationMachineMap[station] || []);
    if (machineIdsForStations.length > 0) {
      await ProductionLog.destroy({
        where: {
          part_id: partId,
          machine_id: { [Op.in]: machineIdsForStations },
        },
      });

      await Promise.all([...new Set(machineIdsForStations)].map((machineId) => clearMachineLock(machineId)));
    }

    const fromStation = part.current_station || null;
    part.current_station = previousStation;
    part.current_operation = previousStation;
    part.is_interlocked = false;
    part.interlock_reason = null;
    part.status = part.is_rework ? "REWORK" : "IN_PROGRESS";
    await part.save();

    await ReworkLog.create({
      part_id: partId,
      from_station: fromStation,
      to_station: targetStation,
      reason: reason || `Manual reset to ${targetStation}`,
      user_id: req.user?.id || null,
    });

    emitOperatorPopup("WARNING", {
      partId,
      stationNo: targetStation,
      status: "STATION_RESET",
      message: `Station reset to ${targetStation}. Re-run process from this stage.`,
    });
    emitRealtime("dashboard_refresh", { reason: "STATION_RESET" });

    res.json({
      message: "Station reset successful",
      partId,
      resetFromStation: targetStation,
      previousStation,
      deletedLogs: operationLogIdsToDelete.length,
      status: part.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.bypassOperation = async (req, res) => {
  try {
    const { partId, machineId, stationNo, reason } = req.body;
    if (!partId || (!machineId && !stationNo)) {
      return res.status(400).json({ error: "partId and machineId/stationNo are required" });
    }

    let machine = null;
    if (machineId) {
      machine = await Machine.findByPk(machineId);
    } else {
      machine = await Machine.findOne({
        where: { operation_no: normalizeStation(stationNo) },
        order: [["sequence_no", "ASC"]],
      });
    }
    if (!machine) {
      return res.status(404).json({ error: "Machine not found for bypass" });
    }

    const targetStation = normalizeStation(stationNo || getMachineOperationStage(machine));
    let opLog = await getLatestOperationLog(partId, targetStation);

    if (!opLog) {
      opLog = await OperationLog.create({
        part_id: partId,
        machine_id: machine.id,
        operation_no: targetStation,
        station_no: targetStation,
        plc_status: "PENDING",
        result: "OK",
        user_id: req.user?.id || null,
        interlock_reason: null,
      });
    }

    await opLog.update({
      plc_status: "ENDED_OK",
      plc_start_time: opLog.plc_start_time || new Date(),
      plc_start_at: opLog.plc_start_at || new Date(),
      plc_end_time: new Date(),
      plc_end_at: new Date(),
      result: "OK",
      is_bypassed: true,
      bypass_reason: reason || "MANUAL_BYPASS",
      interlock_reason: null,
      machine_id: machine.id,
    });

    const part = await Part.findOne({ where: { part_id: partId } });
    if (part) {
      const sequence = await getActiveStationSequence();
      const isLastStation = sequence.length > 0 && targetStation === sequence[sequence.length - 1];
      part.current_station = targetStation;
      part.current_operation = targetStation;
      part.status = isLastStation ? "COMPLETED" : "IN_PROGRESS";
      part.is_interlocked = false;
      part.interlock_reason = null;
      await part.save();
    }

    await ProductionLog.create({
      part_id: partId,
      machine_id: machine.id,
      user_id: req.user?.id || null,
      status: "OK",
      ng_reason: "BYPASS_OK",
    });

    emitOperatorPopup("WARNING", {
      partId,
      stationNo: targetStation,
      machineId: machine.id,
      machineName: machine.machine_name,
      status: "BYPASS",
      message: "Operation bypassed manually",
    });
    emitRealtime("dashboard_refresh", { reason: "BYPASS_OPERATION" });

    res.json({
      message: "Bypass successful",
      partId,
      stationNo: targetStation,
      operationLogId: opLog.id,
      status: part?.status || "IN_PROGRESS",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getOperationSequence = async (_req, res) => {
  try {
    const machines = await Machine.findAll({
      where: { is_active: true },
      order: [["sequence_no", "ASC"]],
      attributes: [
        "id",
        "machine_name",
        "line_name",
        "operation_no",
        "sequence_no",
        "plc_ip",
        "plc_port",
        "plc_protocol",
        "plc_registers",
      ],
    });

    const operations = machines.map((machine) => ({
      machineId: machine.id,
      machineName: machine.machine_name,
      lineName: machine.line_name,
      stationNo: getMachineOperationStage(machine),
      operationNo: machine.operation_no,
      sequenceNo: machine.sequence_no,
      plcIp: machine.plc_ip,
      plcPort: machine.plc_port,
      plcProtocol: machine.plc_protocol || "TCP_TEXT",
      plcRegisters: machine.plc_registers || null,
    }));

    res.json(operations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

function getDateRangeFromQuery(query) {
  const now = new Date();
  const from = query.dateFrom ? new Date(query.dateFrom) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = query.dateTo ? new Date(query.dateTo) : now;
  return { from, to };
}

function toMinutes(timeValue) {
  if (!timeValue) {
    return null;
  }
  const [hh, mm] = String(timeValue).split(":");
  const hour = Number(hh);
  const minute = Number(mm);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return hour * 60 + minute;
}

function getMinutesForDate(dateValue) {
  const date = new Date(dateValue);
  return date.getHours() * 60 + date.getMinutes();
}

function isDateInShift(dateValue, shift) {
  const currentMinutes = getMinutesForDate(dateValue);
  const start = toMinutes(shift.start_time);
  const end = toMinutes(shift.end_time);
  if (start === null || end === null) {
    return false;
  }
  if (start === end) {
    return true;
  }
  if (start < end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
}

async function getActiveShiftDefinitions() {
  const rows = await Shift.findAll({
    where: { is_active: true },
    order: [["start_time", "ASC"]],
    raw: true,
  });
  return rows;
}

function resolveShiftCodeForDate(dateValue, shifts) {
  for (const shift of shifts) {
    if (isDateInShift(dateValue, shift)) {
      return shift.shift_code;
    }
  }
  return "UNASSIGNED";
}

function applyShiftFilter(rows, shiftCode, shifts) {
  if (!shiftCode) {
    return rows;
  }
  const target = String(shiftCode).trim().toUpperCase();
  return rows.filter((row) => resolveShiftCodeForDate(row.createdAt, shifts) === target);
}

function formatHourBucket(dateValue) {
  const date = new Date(dateValue);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:00`;
}

exports.getDashboardSummary = async (req, res) => {
  try {
    const { from, to } = getDateRangeFromQuery(req.query);
    const logWhere = { createdAt: { [Op.gte]: from, [Op.lte]: to } };
    const shiftCodeFilter = req.query.shiftCode ? String(req.query.shiftCode).trim().toUpperCase() : null;

    const [machineTotal, machineActive, partCounts, interlockedCount, reworkCount, recentRows, qualityRows, shifts] =
      await Promise.all([
        Machine.count(),
        Machine.count({ where: { is_active: true } }),
        Part.findAll({
          attributes: ["status", [fn("COUNT", col("id")), "count"]],
          group: ["status"],
          raw: true,
        }),
        Part.count({ where: { status: "INTERLOCKED" } }),
        Part.count({ where: { is_rework: true } }),
        ProductionLog.findAll({
          where: logWhere,
          order: [["createdAt", "DESC"]],
          limit: 250,
          raw: true,
        }),
        ProductionLog.findAll({
          where: logWhere,
          attributes: ["status", "createdAt"],
          raw: true,
        }),
        getActiveShiftDefinitions(),
      ]);

    const filteredQualityRows = applyShiftFilter(qualityRows, shiftCodeFilter, shifts);
    const filteredRecentRows = applyShiftFilter(recentRows, shiftCodeFilter, shifts).slice(0, 10);
    const okLogs = filteredQualityRows.filter((row) => row.status === "OK").length;
    const ngLogs = filteredQualityRows.filter((row) => row.status === "NG").length;

    const statusMap = partCounts.reduce((acc, row) => {
      acc[row.status] = Number(row.count) || 0;
      return acc;
    }, {});

    const shiftProduction = shifts.reduce((acc, shift) => {
      acc[shift.shift_code] = { total: 0, ok: 0, ng: 0 };
      return acc;
    }, {});
    shiftProduction.UNASSIGNED = { total: 0, ok: 0, ng: 0 };

    for (const row of filteredQualityRows) {
      const code = resolveShiftCodeForDate(row.createdAt, shifts);
      if (!shiftProduction[code]) {
        shiftProduction[code] = { total: 0, ok: 0, ng: 0 };
      }
      shiftProduction[code].total += 1;
      if (row.status === "OK") {
        shiftProduction[code].ok += 1;
      } else {
        shiftProduction[code].ng += 1;
      }
    }

    res.json({
      machines: {
        total: machineTotal,
        active: machineActive,
        inactive: Math.max(machineTotal - machineActive, 0),
      },
      parts: {
        inProgress: statusMap.IN_PROGRESS || 0,
        completed: statusMap.COMPLETED || 0,
        ng: statusMap.NG || 0,
        interlocked: interlockedCount,
        rework: reworkCount,
      },
      quality: {
        ok: okLogs,
        ng: ngLogs,
      },
      shiftProduction,
      availableShifts: shifts.map((shift) => ({
        shiftCode: shift.shift_code,
        shiftName: shift.shift_name,
        startTime: shift.start_time,
        endTime: shift.end_time,
      })),
      recentScans: filteredRecentRows,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDashboardTrends = async (req, res) => {
  try {
    const { from, to } = getDateRangeFromQuery(req.query);
    const shiftCodeFilter = req.query.shiftCode ? String(req.query.shiftCode).trim().toUpperCase() : null;
    const [rows, shifts] = await Promise.all([
      ProductionLog.findAll({
        where: { createdAt: { [Op.gte]: from, [Op.lte]: to } },
        attributes: ["status", "createdAt"],
        raw: true,
      }),
      getActiveShiftDefinitions(),
    ]);

    const filteredRows = applyShiftFilter(rows, shiftCodeFilter, shifts);
    const map = filteredRows.reduce((acc, row) => {
      const key = formatHourBucket(row.createdAt);
      if (!acc[key]) {
        acc[key] = { hour: key, ok: 0, ng: 0 };
      }
      if (row.status === "OK") {
        acc[key].ok += 1;
      } else {
        acc[key].ng += 1;
      }
      return acc;
    }, {});

    const trends = Object.values(map).sort((a, b) => String(a.hour).localeCompare(String(b.hour)));

    res.json(trends);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDashboardReport = async (req, res) => {
  try {
    const { from, to } = getDateRangeFromQuery(req.query);
    const shiftCodeFilter = req.query.shiftCode ? String(req.query.shiftCode).trim().toUpperCase() : null;
    const productionWhere = {
      createdAt: { [Op.gte]: from, [Op.lte]: to },
    };

    if (req.query.machineId) {
      productionWhere.machine_id = Number(req.query.machineId);
    }
    if (req.query.partId) {
      productionWhere.part_id = req.query.partId;
    }
    if (req.query.status) {
      productionWhere.status = String(req.query.status).toUpperCase();
    }

    const [productionRows, interlocks, reworkCount, partHistory, shifts] = await Promise.all([
      ProductionLog.findAll({
        where: productionWhere,
        attributes: ["id", "part_id", "machine_id", "status", "createdAt"],
        raw: true,
      }),
      OperationLog.findAll({
        where: {
          interlock_reason: { [Op.ne]: null },
          createdAt: { [Op.gte]: from, [Op.lte]: to },
        },
        order: [["createdAt", "DESC"]],
        limit: 100,
      }),
      ReworkLog.count({
        where: { createdAt: { [Op.gte]: from, [Op.lte]: to } },
      }),
      req.query.partId
        ? OperationLog.findAll({
            where: { part_id: req.query.partId },
            order: [["createdAt", "ASC"]],
          })
        : [],
      getActiveShiftDefinitions(),
    ]);

    const filteredRows = applyShiftFilter(productionRows, shiftCodeFilter, shifts);

    const machineWiseMap = filteredRows.reduce((acc, row) => {
      if (!acc[row.machine_id]) {
        acc[row.machine_id] = { machine_id: row.machine_id, ok: 0, ng: 0 };
      }
      if (row.status === "OK") {
        acc[row.machine_id].ok += 1;
      } else {
        acc[row.machine_id].ng += 1;
      }
      return acc;
    }, {});
    const machineWise = Object.values(machineWiseMap);

    const hourlyMap = filteredRows.reduce((acc, row) => {
      const key = formatHourBucket(row.createdAt);
      if (!acc[key]) {
        acc[key] = { hour: key, total: 0 };
      }
      acc[key].total += 1;
      return acc;
    }, {});
    const hourly = Object.values(hourlyMap).sort((a, b) => String(a.hour).localeCompare(String(b.hour)));

    const shiftProduction = shifts.reduce((acc, shift) => {
      acc[shift.shift_code] = { total: 0, ok: 0, ng: 0 };
      return acc;
    }, {});
    shiftProduction.UNASSIGNED = { total: 0, ok: 0, ng: 0 };

    for (const row of filteredRows) {
      const shiftCode = resolveShiftCodeForDate(row.createdAt, shifts);
      if (!shiftProduction[shiftCode]) {
        shiftProduction[shiftCode] = { total: 0, ok: 0, ng: 0 };
      }
      shiftProduction[shiftCode].total += 1;
      if (row.status === "OK") {
        shiftProduction[shiftCode].ok += 1;
      } else {
        shiftProduction[shiftCode].ng += 1;
      }
    }

    res.json({
      filters: {
        from,
        to,
        machineId: req.query.machineId || null,
        partId: req.query.partId || null,
        status: req.query.status || null,
        shiftCode: shiftCodeFilter,
      },
      machineWise,
      hourlyProduction: hourly,
      shiftProduction,
      interlockHistory: interlocks,
      reworkCount,
      partJourney: partHistory,
      availableShifts: shifts.map((shift) => ({
        shiftCode: shift.shift_code,
        shiftName: shift.shift_name,
        startTime: shift.start_time,
        endTime: shift.end_time,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.exportDashboardReportCsv = async (req, res) => {
  try {
    const { from, to } = getDateRangeFromQuery(req.query);
    const shiftCodeFilter = req.query.shiftCode ? String(req.query.shiftCode).trim().toUpperCase() : null;
    const where = {
      createdAt: { [Op.gte]: from, [Op.lte]: to },
    };
    if (req.query.machineId) {
      where.machine_id = Number(req.query.machineId);
    }
    if (req.query.partId) {
      where.part_id = req.query.partId;
    }
    if (req.query.status) {
      where.status = String(req.query.status).toUpperCase();
    }

    const [rows, shifts] = await Promise.all([
      ProductionLog.findAll({
        where,
        order: [["createdAt", "DESC"]],
        raw: true,
      }),
      getActiveShiftDefinitions(),
    ]);

    const filteredRows = applyShiftFilter(rows, shiftCodeFilter, shifts);

    const header = "id,part_id,machine_id,status,shift_code,ng_reason,createdAt";
    const body = filteredRows
      .map((row) =>
        [
          row.id,
          row.part_id,
          row.machine_id,
          row.status,
          resolveShiftCodeForDate(row.createdAt, shifts),
          row.ng_reason || "",
          row.createdAt,
        ].join(",")
      )
      .join("\n");
    const csv = `${header}\n${body}`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=traceability_report.csv");
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
