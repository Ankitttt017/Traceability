const { Op, fn, col } = require("sequelize");
const Part = require("../models/Part");
const Machine = require("../models/Machine");
const Scanner = require("../models/Scanner");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const ReworkLog = require("../models/ReworkLog");
const Shift = require("../models/Shift");
const { saveScan } = require("../services/scanService");
const { executePlcHandshake } = require("../services/plcSocketService");
const { emitRealtime } = require("../services/realtimeService");

function normalizeIp(ip) {
  return String(ip || "").replace("::ffff:", "").trim();
}

function normalizeStation(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getMachineOperationStage(machine) {
  return normalizeStation(machine?.operation_no || machine?.station_no);
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

async function markOperationInterlocked({ operationLogId, partId, stationNo, machineId, userId, reason }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (opLog) {
    await opLog.update({
      plc_status: "INTERLOCKED",
      interlock_reason: reason || "PLC_COMMUNICATION_FAILED",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
    });
  }

  const part = await Part.findOne({ where: { part_id: partId } });
  if (part) {
    part.current_station = normalizeStation(stationNo);
    part.current_operation = normalizeStation(stationNo);
    part.status = "INTERLOCKED";
    part.is_interlocked = true;
    part.interlock_reason = reason || "PLC_COMMUNICATION_FAILED";
    await part.save();
  }

  await ProductionLog.create({
    part_id: partId,
    machine_id: machineId,
    user_id: userId || null,
    status: "NG",
    ng_reason: reason || "PLC_COMMUNICATION_FAILED",
  });
}

async function startPlcFlow({ operationLogId, partId, stationNo, machine, userId }) {
  const plcIp = machine.plc_ip || machine.machine_ip;
  const plcPort = machine.plc_port || machine.machine_port;

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
        machineName: machine.machine_name,
        status: "STARTED",
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
        machineName: machine.machine_name,
        status: "ENDED_OK",
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
        machineName: machine.machine_name,
        status: "ENDED_NG",
        message: "Operation Failed (NG)",
      });
      emitRealtime("dashboard_refresh", { reason: "PLC_END_NG" });
    },
    onFailure: async (error) => {
      await markOperationInterlocked({
        operationLogId,
        partId,
        stationNo,
        machineId: machine.id,
        userId,
        reason: `PLC_TIMEOUT_${String(error.message || "").slice(0, 120)}`,
      });
      emitOperatorPopup("WARNING", {
        partId,
        stationNo,
        machineName: machine.machine_name,
        status: "INTERLOCKED",
        message: "PLC timeout/interruption - part interlocked",
      });
      emitRealtime("dashboard_refresh", { reason: "PLC_FAILURE" });
    },
  });
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

    const current = logs.find((row) => row.plc_status === "STARTED" || row.plc_status === "PENDING") || logs[0] || null;

    res.json({
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        stationNo,
        machineIp: machine.machine_ip,
        plcIp: machine.plc_ip,
        plcProtocol: machine.plc_protocol || "TCP_TEXT",
        isActive: machine.is_active,
      },
      scanner: scanner
        ? {
            id: scanner.id,
            scannerName: scanner.scanner_name,
            scannerIp: scanner.scanner_ip,
            scannerPort: scanner.scanner_port,
            isActive: scanner.is_active,
          }
        : null,
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

exports.getPartJourney = async (req, res) => {
  try {
    const { partId } = req.params;
    const part = await Part.findOne({ where: { part_id: partId } });
    const logs = await OperationLog.findAll({
      where: { part_id: partId },
      order: [["createdAt", "ASC"]],
    });
    const reworkHistory = await ReworkLog.findAll({
      where: { part_id: partId },
      order: [["createdAt", "DESC"]],
    });

    if (!part && logs.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }

    res.json({
      part,
      journey: logs.map((log) => ({
        id: log.id,
        stationNo: log.station_no || log.operation_no,
        plcStatus: log.plc_status,
        plcStartTime: log.plc_start_time || log.plc_start_at,
        plcEndTime: log.plc_end_time || log.plc_end_at,
        result: log.result,
        interlockReason: log.interlock_reason,
        machineId: log.machine_id,
      })),
      interlockHistory: logs
        .filter((log) => log.interlock_reason)
        .map((log) => ({
          id: log.id,
          stationNo: log.station_no || log.operation_no,
          reason: log.interlock_reason,
          createdAt: log.createdAt,
        })),
      reworkHistory,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.processScan = async (req, res) => {
  try {
    const { partId, stationNo, operation, result } = req.body;
    if (!partId) {
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

    const response = await saveScan(partId, normalizedStation, result || "OK", machine.id, req.user?.id);

    if (response.decision === "ALLOW" && response.operationLogId) {
      startPlcFlow({
        operationLogId: response.operationLogId,
        partId,
        stationNo: normalizedStation,
        machine,
        userId: req.user?.id,
      }).catch((error) => {
        console.error("PLC flow failed:", error.message);
      });
      response.plcHandshake = "INITIATED";
    }

    res.json({
      ...response,
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
    if (!qrCode || !machineId) {
      return res.status(400).json({ error: "qrCode and machineId are required" });
    }

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const stationNo = getMachineOperationStage(machine);
    const response = await saveScan(qrCode, stationNo, result || "OK", machine.id, req.user?.id);

    if (response.decision === "ALLOW" && response.operationLogId) {
      startPlcFlow({
        operationLogId: response.operationLogId,
        partId: qrCode,
        stationNo,
        machine,
        userId: req.user?.id,
      }).catch((error) => {
        console.error("PLC flow failed:", error.message);
      });
      response.plcHandshake = "INITIATED";
    }

    res.json({
      status: response.decision === "ALLOW" ? "OK" : "NG",
      ...response,
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
      machineName: machine.machine_name,
      status: "STARTED",
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
        machineName: machine.machine_name,
        status: "ENDED_OK",
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
        machineName: machine.machine_name,
        status: "ENDED_NG",
        message: "Operation Failed (NG)",
      });
    }

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
      attributes: ["id", "machine_name", "station_no", "operation_no", "sequence_no", "machine_ip", "machine_port"],
    });

    const operations = machines.map((machine) => ({
      machineId: machine.id,
      machineName: machine.machine_name,
      stationNo: getMachineOperationStage(machine),
      sequenceNo: machine.sequence_no,
      machineIp: machine.machine_ip,
      machinePort: machine.machine_port,
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
