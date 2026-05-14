const net = require("net");
const Scanner = require("../models/Scanner");
const Machine = require("../models/Machine");
const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const { saveScan } = require("../services/scanService");
const plcHandshakeEngine = require("../services/plcHandshakeEngine");
const {
  readModbusRegisters,
  readSlmpRegisters,
  writeModbusRegister,
  writeSlmpRegister,
} = require("../services/plcIoService");
const { emitRealtime } = require("../services/realtimeService");
const { markScannerHeartbeat } = require("../services/scannerHealthService");
const scannerService = require("../services/scannerConnectionService");
const { packPart, createSessionIfMissing } = require("../services/packingService");
const { tryAcquireMachineLock, clearMachineLock } = require("../services/machineLockService");
const {
  getStationFeatureConfig,
  normalizePlcPartCount,
} = require("../services/stationFeatureService");
const { isMachineBypassEnabled } = require("../services/machineBypassService");
const { normalizeIp, sameIp } = require("../utils/networkAddress");
const { finalizeCycleAfterPlc } = require("../services/cycleFinalizationService");
const { TIMELINE_EVENTS, recordTimelineEvent } = require("../services/operationTimelineService");

const tcpPort = Number(process.env.TCP_PORT || 5000);
const SOCKET_CHUNK_FLUSH_MS = Math.max(Number(process.env.SCANNER_BUFFER_FLUSH_MS || 35), 10);
const SOCKET_BUFFER_MAX_CHARS = Math.max(Number(process.env.SCANNER_BUFFER_MAX_CHARS || 8192), 1024);

const activeSockets = new Set();
const server = net.createServer();

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

function sanitizeScannerMessage(message) {
  // Remove ASCII control bytes (ESC/STX/ETX/etc.) often sent by scanner framing.
  return String(message || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
}

function isControlOnlyMessage(message) {
  if (!message) {
    return true;
  }
  return !String(message || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

async function findActiveScannerByIp(scannerIp) {
  const normalizedIp = normalizeIp(scannerIp);
  if (!normalizedIp) {
    return null;
  }

  const exact = await Scanner.findOne({
    where: { scanner_ip: normalizedIp, is_active: true },
    order: [["updatedAt", "DESC"]],
  });
  if (exact) {
    return exact;
  }

  const scanners = await Scanner.findAll({
    where: { is_active: true },
    order: [["updatedAt", "DESC"]],
  });

  return scanners.find((row) => sameIp(row.scanner_ip, normalizedIp)) || null;
}

function parsePackingPayload(message) {
  const text = String(message || "").trim();
  if (!text) {
    return null;
  }

  const cleaned = text.replace(/^PACK\|?/i, "");
  const tokens = cleaned.split(/[|,;]/).map((token) => token.trim()).filter(Boolean);
  if (!tokens.length) {
    return null;
  }

  const keyValues = {};
  for (const token of tokens) {
    const [rawKey, ...rest] = token.split(/[:=]/);
    if (!rawKey || !rest.length) {
      continue;
    }
    keyValues[String(rawKey).trim().toUpperCase()] = rest.join(":").trim();
  }

  const boxNumber = keyValues.BOX || keyValues.BOXNO || keyValues.BOX_NUMBER;
  const partId = keyValues.PART || keyValues.PARTID || keyValues.PART_ID;
  const capacity = keyValues.CAPACITY || keyValues.CAP || keyValues.BOXCAP || keyValues.SLOTS;

  if (!boxNumber && !partId) {
    return null;
  }
  return { boxNumber, partId, capacity };
}

function mapScanDecisionToPopupType(scanResult) {
  if (scanResult.decision === "ALLOW") {
    return "INFO";
  }
  return "ERROR";
}

function parseTraceabilityPayload(message) {
  const text = String(message || "").trim();
  if (!text) {
    return null;
  }

  const tokens = text.split(/[|,;]/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length <= 1) {
    return {
      partId: text,
      result: "OK",
      resultProvided: false,
      rejectionBinConfirmed: false,
    };
  }

  const keyValues = {};
  for (const token of tokens) {
    const [rawKey, ...rest] = token.split(/[:=]/);
    if (!rawKey || !rest.length) {
      continue;
    }
    keyValues[String(rawKey).trim().toUpperCase()] = rest.join(":").trim();
  }

  const partId = keyValues.PART || keyValues.PARTID || keyValues.PART_ID || tokens[0];
  const explicitResult = keyValues.RESULT || keyValues.RES || "";
  const result = explicitResult || "OK";
  const rb = keyValues.RB || keyValues.REJECTION || keyValues.REJECTION_BIN || keyValues.REJECTIONBIN || "0";
  const rejectionBinConfirmed = ["1", "TRUE", "YES", "NG", "FAIL", "CONFIRMED", "DETECTED"].includes(
    String(rb || "")
      .trim()
      .toUpperCase()
  );
  const rb2 =
    keyValues.RB2 ||
    keyValues.REJ2 ||
    keyValues.REJECTION2 ||
    keyValues.REJECTION_SECONDARY ||
    keyValues.ST_RESET ||
    keyValues.STATION_RESET ||
    "0";
  const rejectionSecondaryConfirmed = ["1", "TRUE", "YES", "NG", "FAIL", "CONFIRMED", "DETECTED"].includes(
    String(rb2 || "")
      .trim()
      .toUpperCase()
  );

  return {
    partId: String(partId || "").trim(),
    result,
    resultProvided: Boolean(String(explicitResult || "").trim()),
    rejectionBinConfirmed,
    rejectionSecondaryConfirmed,
    qualityPayload: keyValues,
  };
}

function parseMachineSnapshot(machine) {
  if (!machine?.plc_registers) {
    return {};
  }
  try {
    const parsed =
      typeof machine.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine.plc_registers;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function getMachineSpcConfig(machine) {
  const snapshot = parseMachineSnapshot(machine);
  const source = snapshot?.spcConfig && typeof snapshot.spcConfig === "object" ? snapshot.spcConfig : {};
  const mode = String(source.mode || source.resultMode || "IP_PUSH")
    .trim()
    .toUpperCase();
  const payloadResultNgValues = Array.isArray(source.payloadResultNgValues)
    ? source.payloadResultNgValues
        .map((entry) => String(entry || "").trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 20)
    : ["NG", "FAIL", "0"];
  const plcResultOkValues = Array.isArray(source.plcResultOkValues)
    ? source.plcResultOkValues
        .map((entry) => String(entry || "").trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 20)
    : ["1", "3", "OK", "PASS"];
  const plcResultNgValues = Array.isArray(source.plcResultNgValues)
    ? source.plcResultNgValues
        .map((entry) => String(entry || "").trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 20)
    : ["0", "2", "NG", "FAIL"];
  const qualityPayloadKeys = Array.isArray(source.qualityPayloadKeys)
    ? source.qualityPayloadKeys.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 40)
    : [];
  return {
    enabled: source.enabled === true,
    mode: ["IP_PUSH", "PLC_REGISTER"].includes(mode) ? mode : "IP_PUSH",
    appliesTo: "ALL",
    sourceIp: normalizeIp(source.sourceIp || source.systemIp || source.ip || ""),
    payloadResultKey: String(source.payloadResultKey || source.resultKey || "RESULT").trim() || "RESULT",
    payloadResultNgValues,
    plcResultRegister: Number.isFinite(Number(source.plcResultRegister ?? source.resultRegister ?? source.register))
      ? Math.trunc(Number(source.plcResultRegister ?? source.resultRegister ?? source.register))
      : null,
    plcResultDevice: String(source.plcResultDevice || source.resultDevice || "D").trim().toUpperCase() || "D",
    plcResultOkValues,
    plcResultNgValues,
    plcAckEnabled: source.plcAckEnabled !== false,
    plcAckRegister: Number.isFinite(Number(source.plcAckRegister ?? source.ackRegister))
      ? Math.trunc(Number(source.plcAckRegister ?? source.ackRegister))
      : null,
    plcAckDevice: String(source.plcAckDevice || source.ackDevice || "D").trim().toUpperCase() || "D",
    plcAckOkValue: Number.isFinite(Number(source.plcAckOkValue ?? source.ackOkValue))
      ? Math.trunc(Number(source.plcAckOkValue ?? source.ackOkValue))
      : 101,
    plcAckNgValue: Number.isFinite(Number(source.plcAckNgValue ?? source.ackNgValue))
      ? Math.trunc(Number(source.plcAckNgValue ?? source.ackNgValue))
      : 102,
    plcAckErrorValue: Number.isFinite(Number(source.plcAckErrorValue ?? source.ackErrorValue))
      ? Math.trunc(Number(source.plcAckErrorValue ?? source.ackErrorValue))
      : 199,
    qualityPayloadKeys,
  };
}

function normalizeQualityToken(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim().toUpperCase();
}

async function readQualityCheckResultFromPlc(machine, spcConfig) {
  if (!machine || !spcConfig?.enabled || spcConfig.mode !== "PLC_REGISTER") {
    return null;
  }
  const registerNo = Number(spcConfig.plcResultRegister);
  if (!Number.isFinite(registerNo)) {
    return null;
  }
  const protocol = String(machine.plc_protocol || "TCP_TEXT").trim().toUpperCase();
  const ip = machine.plc_ip || machine.machine_ip;
  const port = Number(machine.plc_port || machine.machine_port);
  if (!ip || !Number.isFinite(port)) {
    throw new Error("PLC endpoint not configured for Quality Check register mode");
  }
  let rawValue = null;
  if (protocol === "MODBUS_TCP") {
    const response = await readModbusRegisters({
      ip,
      port,
      unitId: Number(machine.plc_unit_id || 1),
      registers: [Math.trunc(registerNo)],
      timeoutMs: Number(machine.plc_test_timeout_ms || 2000),
    });
    rawValue = response?.values?.[Math.trunc(registerNo)];
  } else if (protocol === "SLMP") {
    const snapshot = parseMachineSnapshot(machine);
    const response = await readSlmpRegisters({
      ip,
      port,
      registers: [{ register: Math.trunc(registerNo), device: spcConfig.plcResultDevice || machine.plc_slmp_device || "D" }],
      defaultDevice: spcConfig.plcResultDevice || machine.plc_slmp_device || "D",
      timeoutMs: Number(machine.plc_test_timeout_ms || 2000),
      frameMode: snapshot?.slmpFrameMode || "AUTO",
    });
    rawValue = response?.values?.[Math.trunc(registerNo)];
  }
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  const token = normalizeQualityToken(rawValue);
  let result = null;
  if (spcConfig.plcResultNgValues.includes(token)) {
    result = "NG";
  } else if (spcConfig.plcResultOkValues.includes(token)) {
    result = "OK";
  }
  return {
    token,
    result,
    rawValue,
    registerNo: Math.trunc(registerNo),
  };
}

async function sendQualityCheckAckToPlc(machine, spcConfig, finalResult) {
  if (!machine || !spcConfig?.enabled) {
    return { skipped: true, reason: "ACK_DISABLED" };
  }
  const registerNo = Number(spcConfig.plcAckRegister);
  if (!Number.isFinite(registerNo)) {
    return { skipped: true, reason: "ACK_REGISTER_NOT_SET" };
  }
  const protocol = String(machine.plc_protocol || "TCP_TEXT").trim().toUpperCase();
  const ip = machine.plc_ip || machine.machine_ip;
  const port = Number(machine.plc_port || machine.machine_port);
  if (!ip || !Number.isFinite(port)) {
    return { skipped: true, reason: "PLC_ENDPOINT_MISSING" };
  }
  const ackValue =
    finalResult === "NG"
      ? spcConfig.plcAckNgValue
      : finalResult === "OK"
      ? spcConfig.plcAckOkValue
      : spcConfig.plcAckErrorValue;
  if (protocol === "MODBUS_TCP") {
    await writeModbusRegister({
      ip,
      port,
      unitId: Number(machine.plc_unit_id || 1),
      register: Math.trunc(registerNo),
      value: ackValue,
      timeoutMs: Number(machine.plc_test_timeout_ms || 2000),
    });
    return { ok: true, protocol, register: Math.trunc(registerNo), value: ackValue };
  }
  if (protocol === "SLMP") {
    const snapshot = parseMachineSnapshot(machine);
    await writeSlmpRegister({
      ip,
      port,
      register: Math.trunc(registerNo),
      value: ackValue,
      device: spcConfig.plcAckDevice || machine.plc_slmp_device || "D",
      timeoutMs: Number(machine.plc_test_timeout_ms || 2000),
      frameMode: snapshot?.slmpFrameMode || "AUTO",
    });
    return { ok: true, protocol, register: Math.trunc(registerNo), value: ackValue };
  }
  return { skipped: true, reason: `ACK_NOT_SUPPORTED_${protocol}` };
}

function findPayloadValueCaseInsensitive(payload = {}, key = "") {
  if (!payload || typeof payload !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];
  const target = String(key || "").trim().toUpperCase();
  if (!target) return undefined;
  for (const [k, v] of Object.entries(payload)) {
    if (String(k || "").trim().toUpperCase() === target) {
      return v;
    }
  }
  return undefined;
}

function extractQualityPayloadFromTrace(tracePayload = {}, machine = null) {
  const spcConfig = getMachineSpcConfig(machine);
  if (!spcConfig.enabled) {
    return null;
  }
  const keys = spcConfig.qualityPayloadKeys;
  const source = tracePayload?.qualityPayload && typeof tracePayload.qualityPayload === "object"
    ? tracePayload.qualityPayload
    : {};
  const output = {};
  for (const key of keys) {
    const value = findPayloadValueCaseInsensitive(source, key);
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

async function getActiveStationSequence() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    order: [["sequence_no", "ASC"]],
  });
  return uniqueStages(machines.map((machine) => getMachineOperationStage(machine)));
}

async function safeRecordTimeline({
  operationId,
  partId,
  machineId,
  stationNo,
  eventType,
  eventData = {},
}) {
  if (!operationId || !eventType) return;
  try {
    await recordTimelineEvent({
      operationId,
      partId: partId || null,
      machineId: machineId || null,
      stationNo: stationNo || null,
      eventType,
      eventData,
    });
  } catch (_error) {
    // timeline persistence is best-effort in live scanner flow
  }
}

async function markStart(operationLogId, machineId) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (!opLog) {
    return;
  }
  await opLog.update({
    plc_status: "STARTED",
    machine_id: machineId,
    plc_start_time: new Date(),
    plc_start_at: new Date(),
  });
}

async function markEndOk({ operationLogId, partId, stationNo, machineId }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (opLog) {
    await opLog.update({
      plc_status: "ENDED_OK",
      machine_id: machineId,
      result: "OK",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
    });
  }

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
    status: "OK",
    ng_reason: "PLC_END_OK",
  });
}

async function markEndNg({ operationLogId, partId, stationNo, machineId, reason }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (opLog) {
    await opLog.update({
      plc_status: "ENDED_NG",
      machine_id: machineId,
      result: "NG",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
      interlock_reason: reason || "PLC_END_NG",
    });
  }

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
    status: "NG",
    ng_reason: reason || "PLC_END_NG",
  });
}

async function markCommunicationError({ operationLogId, partId, stationNo, reason }) {
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

async function getPendingStationOperations({ machineId, stationNo }) {
  return OperationLog.findAll({
    where: {
      machine_id: machineId,
      station_no: normalizeStation(stationNo),
      plc_status: "PENDING",
    },
    order: [["createdAt", "ASC"]],
  });
}

async function startPlcFlow({ operationLogId, partId, stationNo, machine, releaseLock = true }) {
  let plcCycleCompleted = false;
  try {
    await safeRecordTimeline({
      operationId: operationLogId,
      partId,
      machineId: machine.id,
      stationNo,
      eventType: TIMELINE_EVENTS.START_SENT,
      eventData: { source: "tcpServer.startPlcFlow" },
    });

    await plcHandshakeEngine.executeCycle({
      machine,
      partId,
      stationNo,
      operationLogId,
      onStarted: async () => {
        await markStart(operationLogId, machine.id);
        await safeRecordTimeline({
          operationId: operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: TIMELINE_EVENTS.RUNNING,
        });
        emitRealtime("operator_popup", {
          type: "INFO",
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "STARTED",
          plcStatus: "STARTED",
          qrResult: "PASS",
          message: "PLC start acknowledged",
        });
      },
      onEndedOk: async () => {
        await markEndOk({ operationLogId, partId, stationNo, machineId: machine.id });
        plcCycleCompleted = true;
        await safeRecordTimeline({
          operationId: operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: TIMELINE_EVENTS.COMPLETED_OK,
        });
        emitRealtime("operator_popup", {
          type: "SUCCESS",
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
      onEndedNg: async () => {
        await markEndNg({ operationLogId, partId, stationNo, machineId: machine.id, reason: "PLC_END_NG" });
        plcCycleCompleted = true;
        await safeRecordTimeline({
          operationId: operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: TIMELINE_EVENTS.COMPLETED_NG,
        });
        emitRealtime("operator_popup", {
          type: "ERROR",
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
      onError: async (error) => {
        await markCommunicationError({
          operationLogId,
          partId,
          stationNo,
          reason: `PLC_TIMEOUT_${String(error.message || "").slice(0, 120)}`,
        });
        await safeRecordTimeline({
          operationId: operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: String(error?.message || "").toUpperCase().includes("TIMEOUT")
            ? TIMELINE_EVENTS.PLC_TIMEOUT
            : TIMELINE_EVENTS.PLC_ERROR,
          eventData: { error: String(error?.message || "PLC communication failure") },
        });
        emitRealtime("operator_popup", {
          type: "WARNING",
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
    if (releaseLock) {
      if (plcCycleCompleted) {
        const finalize = await finalizeCycleAfterPlc({ machine });
        if (!finalize.success) {
          emitRealtime("operator_popup", {
            type: "WARNING",
            partId,
            stationNo,
            machineId: machine.id,
            machineName: machine.machine_name,
            status: "RECOVERING",
            plcStatus: "RECOVERING",
            qrResult: "PASS",
            reason: finalize.reason || "RESET_VALIDATION_FAILED",
            message: "Cycle ended but reset validation failed. Manual recovery may be required.",
          });
        }
      } else {
        await clearMachineLock(machine.id);
        await plcHandshakeEngine.markIdle(machine.id);
      }
    }
  }
}

async function startPlcBatchFlow({ batchItems, stationNo, machine }) {
  try {
    for (const item of batchItems) {
      try {
        await startPlcFlow({
          operationLogId: item.operationLogId,
          partId: item.partId,
          stationNo,
          machine,
          releaseLock: false,
        });
      } catch (error) {
        console.error(
          `TCP PLC batch item failed for part ${item.partId} at station ${stationNo}:`,
          error.message
        );
      }
    }
  } finally {
    const finalize = await finalizeCycleAfterPlc({ machine });
    if (!finalize.success) {
      emitRealtime("operator_popup", {
        type: "WARNING",
        partId: batchItems[batchItems.length - 1]?.partId || null,
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "RECOVERING",
        plcStatus: "RECOVERING",
        qrResult: "PASS",
        reason: finalize.reason || "RESET_VALIDATION_FAILED",
        message: "Batch ended but reset validation failed. Manual recovery may be required.",
      });
    }
  }
}

async function handleStationPlcFlow({
  scanResult,
  machine,
  stationNo,
  partId,
  requiredPlcPartCount,
}) {
  const isValid = scanResult.decision === "ALLOW" || scanResult.valid === true;
  if (!isValid) {
    // Section 1, 2 & 3: Signal Interlock to PLC and transition FSM, but KEEP scanner socket open.
    await plcHandshakeEngine.signalInterlock(machine.id, scanResult.reason || "VALIDATION_FAILED");
    console.warn(`[PLC:BLOCK_SENT] machineId=${machine.id} reason=${scanResult.reason}`);
    return; // Do NOT disconnect scanner; do NOT proceed with machine cycle
  }

  // Direct mode: No WAITING_PLC_END block anymore

  if (requiredPlcPartCount <= 1) {
    const lock = await tryAcquireMachineLock({
      machineId: machine.id,
      partId,
      stationNo,
    });
    if (!lock.acquired) {
      await rollbackPendingOperation({
        partId,
        operationLogId: scanResult.operationLogId,
      });
      scanResult.decision = "BLOCK";
      scanResult.reason = "MACHINE_RUNNING";
      scanResult.message = lock.runningPartId
        ? `Machine busy. Current part ${lock.runningPartId} is in operation.`
        : "Machine busy with another cycle. Retry after current operation completes.";
      scanResult.operationLogId = null;
      scanResult.currentStatus = "IN_PROGRESS";
      return;
    }

    startPlcFlow({
      operationLogId: scanResult.operationLogId,
      partId,
      stationNo,
      machine,
    }).catch((error) => {
      console.error("TCP PLC flow failed:", error.message);
    });
    scanResult.plcHandshake = "INITIATED";
    return;
  }

  const pendingRows = await getPendingStationOperations({
    machineId: machine.id,
    stationNo,
  });
  scanResult.pendingBatchCount = pendingRows.length;
  scanResult.plcPartCountRequired = requiredPlcPartCount;
  scanResult.operationStatus = "PENDING";

  if (pendingRows.length < requiredPlcPartCount) {
    scanResult.plcHandshake = "QUEUED";
    scanResult.reason = "BATCH_WAITING";
    scanResult.message = `Queued for PLC batch at ${stationNo}: ${pendingRows.length}/${requiredPlcPartCount} part(s) ready.`;
    return;
  }

  const lock = await tryAcquireMachineLock({
    machineId: machine.id,
    partId,
    stationNo,
  });
  if (!lock.acquired) {
    scanResult.plcHandshake = "QUEUED";
    scanResult.reason = "MACHINE_RUNNING";
    scanResult.message = lock.runningPartId
      ? `Machine busy with ${lock.runningPartId}. Batch queued and will run once machine is free.`
      : "Machine busy with another cycle. Batch queued and will run automatically once machine is free.";
    return;
  }

  const batchRows = pendingRows.slice(0, requiredPlcPartCount);
  startPlcBatchFlow({
    batchItems: batchRows.map((row) => ({
      operationLogId: row.id,
      partId: row.part_id,
    })),
    stationNo,
    machine,
  }).catch((error) => {
    console.error("TCP PLC batch flow failed:", error.message);
  });

  scanResult.plcHandshake = "BATCH_INITIATED";
  scanResult.message = `PLC batch started at ${stationNo} for ${batchRows.length} part(s).`;
  scanResult.batchPartIds = batchRows.map((row) => row.part_id);
}

server.on("connection", (socket) => {
  const scannerIp = normalizeIp(socket.remoteAddress || "");
  activeSockets.add(socket);
  
  socket.on("close", (hadError) => {
    activeSockets.delete(socket);
    if (!disconnectedHandled) {
      disconnectedHandled = true;
      scannerService.markScannerDisconnected({ scannerIp });
    }
    console.log(`Scanner Disconnected: ${scannerIp} (hadError: ${hadError})`);
  });
  
  socket.on("error", (error) => {
    activeSockets.delete(socket);
    console.warn(`[TCP:SCANNER_SOCKET_ERROR] ${scannerIp}:`, error.message);
  });

  socket.setKeepAlive(true, 10000); // 10s keep-alive probes for persistent industrial sockets
  socket.setTimeout(86400000); // 24 hours inactivity timeout
  
  socket.on("timeout", () => {
    // Industrial Rule: Do NOT disconnect scanners during idle periods
    console.warn(`[TCP:SCANNER_IDLE] ${scannerIp} - Idle for extended period. Maintaining connection.`);
  });

  let activeScanner = null;
  let activeMachine = null;
  let inboundBuffer = "";
  let flushTimer = null;
  let messageQueue = Promise.resolve();
  let disconnectedHandled = false;

  const safeSocketWrite = (data) => {
    if (!socket.destroyed) {
      socket.write(data);
    }
  };

  const markHeartbeat = () => {
    markScannerHeartbeat({
      scannerId: activeScanner?.id || null,
      scannerIp: activeScanner?.scanner_ip || scannerIp,
      scannerName: activeScanner?.scanner_name || null,
      machineId: activeMachine?.id || null,
    });
  };

  const resolveScannerContext = async () => {
    const scanner = await findActiveScannerByIp(scannerIp);
    if (!scanner) {
      activeScanner = null;
      activeMachine = null;
      markHeartbeat();
      return { scanner: null, machine: null };
    }

    const machine = await Machine.findByPk(scanner.mapped_machine_id);
    activeScanner = scanner;
    activeMachine = machine && machine.is_active ? machine : null;
    markHeartbeat();
    return { scanner: activeScanner, machine: activeMachine };
  };

  const clearFlushTimer = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  const scheduleFlush = () => {
    clearFlushTimer();
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const pending = inboundBuffer;
      inboundBuffer = "";
      if (pending) {
        queueMessage(pending);
      }
    }, SOCKET_CHUNK_FLUSH_MS);
  };

  const processRawMessage = async (inputChunk) => {
    try {
      markHeartbeat();

      const chunk = String(inputChunk || "");
      if (!chunk) {
        return;
      }
      if (isControlOnlyMessage(chunk)) {
        return;
      }

      const rawMessage = sanitizeScannerMessage(chunk);
      if (!rawMessage) {
        return;
      }

      const packingPayload = parsePackingPayload(rawMessage);
      if (packingPayload) {
        if (packingPayload.boxNumber && !packingPayload.partId) {
          await createSessionIfMissing(packingPayload.boxNumber, packingPayload.capacity);
          safeSocketWrite("BOX_READY\n");
          emitRealtime("operator_popup", {
            type: "INFO",
            message: `Packing box ${String(packingPayload.boxNumber).toUpperCase()} ready`,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (packingPayload.partId) {
          const packed = await packPart({
            boxNumber: packingPayload.boxNumber,
            partId: packingPayload.partId,
            capacity: packingPayload.capacity,
          });
          safeSocketWrite("PACK_OK\n");
          emitRealtime("operator_popup", {
            type: "SUCCESS",
            message: `Packed ${packingPayload.partId} in box ${packed.session.box_number} slot ${packed.item.slot_no}`,
            partId: packingPayload.partId,
            stationNo: "PACKING",
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }

      const tracePayload = parseTraceabilityPayload(rawMessage);
      const partId = String(tracePayload?.partId || "").trim();
      if (!partId) {
        safeSocketWrite("BLOCK\n");
        emitRealtime("operator_popup", {
          type: "ERROR",
          message: "Invalid scan payload: part ID missing",
          scannerIp,
          status: "INTERLOCKED",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      let scanner = activeScanner;
      let machine = activeMachine;
      if (!scanner || !machine) {
        const context = await resolveScannerContext();
        scanner = context.scanner;
        machine = context.machine;
      }

      if (!scanner) {
        console.log("Active scanner mapping not found for IP:", scannerIp);
        safeSocketWrite("BLOCK\n");
        emitRealtime("operator_popup", {
          type: "ERROR",
          message: "Scanner IP not mapped or inactive",
          scannerIp,
          status: "INTERLOCKED",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (!machine || !machine.is_active) {
        console.log("Mapped machine not available for scanner:", scannerIp);
        safeSocketWrite("BLOCK\n");
        emitRealtime("operator_popup", {
          type: "ERROR",
          message: "Mapped machine unavailable for scanner",
          scannerIp,
          scannerName: scanner.scanner_name,
          status: "INTERLOCKED",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      markHeartbeat();

      const stationNo = getMachineOperationStage(machine);
      const stationFeatures = await getStationFeatureConfig(stationNo);
      const spcConfig = getMachineSpcConfig(machine);
      const rejectionBinConfirmed = stationFeatures.rejectionBin && Boolean(tracePayload?.rejectionBinConfirmed);
      const manualResultEnabled = stationFeatures.manualResult === true;
      const sourceIpMismatch =
        spcConfig.enabled &&
        spcConfig.mode === "IP_PUSH" &&
        spcConfig.sourceIp &&
        scannerIp &&
        !sameIp(spcConfig.sourceIp, scannerIp);
      if (sourceIpMismatch) {
        safeSocketWrite("BLOCK\n");
        emitRealtime("operator_popup", {
          type: "ERROR",
          message: `SPC source mismatch. Expected ${spcConfig.sourceIp}, got ${scannerIp}`,
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          scannerName: scanner.scanner_name,
          scannerIp,
          status: "INTERLOCKED",
          reason: "SPC_SOURCE_IP_MISMATCH",
          timestamp: new Date().toISOString(),
        });
        return;
      }
      const resultInput = String(tracePayload?.result || "").trim().toUpperCase();
      const spcResultRaw = findPayloadValueCaseInsensitive(tracePayload?.qualityPayload || {}, spcConfig.payloadResultKey);
      const spcResultInput = normalizeQualityToken(spcResultRaw);
      let plcQualityResult = null;
      if (spcConfig.enabled && spcConfig.mode === "PLC_REGISTER") {
        plcQualityResult = await readQualityCheckResultFromPlc(machine, spcConfig).catch((error) => {
          console.warn(
            `[QUALITY_CHECK] PLC register read failed machineId=${machine.id} partId=${partId} station=${stationNo} error=${error.message}`
          );
          return null;
        });
      }
      const hasSpcResultInput = Boolean(
        spcConfig.enabled &&
          (spcConfig.mode === "PLC_REGISTER" ? plcQualityResult?.result : spcResultInput)
      );
      const hasResultInput = Boolean(tracePayload?.resultProvided && resultInput);
      const qualityPayload = extractQualityPayloadFromTrace(tracePayload, machine);
      if (manualResultEnabled && !rejectionBinConfirmed && !hasResultInput && !hasSpcResultInput) {
        safeSocketWrite("BLOCK\n");
        emitRealtime("operator_popup", {
          type: "ERROR",
          message: `Manual OK/NG result missing for station ${stationNo}`,
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          scannerName: scanner.scanner_name,
          scannerIp,
          status: "INTERLOCKED",
          reason: "MANUAL_RESULT_REQUIRED",
          timestamp: new Date().toISOString(),
        });
        return;
      }
      const spcResultIsNg = spcConfig.mode === "PLC_REGISTER"
        ? plcQualityResult?.result === "NG"
        : spcConfig.payloadResultNgValues.includes(spcResultInput);
      const spcResolvedResult = spcConfig.mode === "PLC_REGISTER"
        ? plcQualityResult?.result || null
        : hasSpcResultInput
        ? spcResultIsNg
          ? "NG"
          : "OK"
        : null;
      const finalResult = rejectionBinConfirmed
        ? "NG"
        : spcResolvedResult
        ? spcResolvedResult
        : hasResultInput
        ? resultInput
        : "OK";
      const resultSource = rejectionBinConfirmed
        ? "PLC_REJECTION_BIN"
        : spcResolvedResult
        ? spcConfig.mode === "PLC_REGISTER"
          ? "QUALITY_CHECK_PLC_REGISTER"
          : "QUALITY_CHECK_IP_PAYLOAD"
        : manualResultEnabled
        ? "MANUAL_OK_NG"
        : hasResultInput
        ? "PLC_PAYLOAD"
        : "DEFAULT_OK";
      const scanResult = await saveScan(partId, stationNo, finalResult, machine.id, null, {
        ...(rejectionBinConfirmed ? { ngReason: "REJECTION_BIN_CONFIRMED" } : {}),
        resultSource,
        resultInput: spcConfig.mode === "PLC_REGISTER"
          ? normalizeQualityToken(plcQualityResult?.token || plcQualityResult?.rawValue || finalResult)
          : hasSpcResultInput
          ? spcResultInput
          : hasResultInput
          ? resultInput
          : finalResult,
        qualityPayload,
      });
      if (scanResult?.decision === "ALLOW" && scanResult?.operationLogId) {
        await safeRecordTimeline({
          operationId: scanResult.operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: TIMELINE_EVENTS.SCANNED,
          eventData: {
            scannerIp,
            scannerName: scanner.scanner_name,
            resultSource,
          },
        });
        await safeRecordTimeline({
          operationId: scanResult.operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: TIMELINE_EVENTS.VALIDATED,
          eventData: {
            stationFeatures,
            spcMode: spcConfig.mode,
          },
        });
      }
      const qualityAck = await sendQualityCheckAckToPlc(machine, spcConfig, finalResult).catch((error) => ({
        ok: false,
        error: error.message,
      }));
      if (qualityAck?.ok) {
        console.log(
          `[QUALITY_CHECK] ACK sent machineId=${machine.id} partId=${partId} result=${finalResult} register=${qualityAck.register} value=${qualityAck.value}`
        );
      } else if (qualityAck && !qualityAck.skipped) {
        console.warn(
          `[QUALITY_CHECK] ACK failed machineId=${machine.id} partId=${partId} result=${finalResult} error=${qualityAck.error || qualityAck.reason || "UNKNOWN"}`
        );
      }
      const machineBypassEnabled = isMachineBypassEnabled(machine.id);
      const requiredPlcPartCount = normalizePlcPartCount(stationFeatures.plcPartCount || 1);
      
      console.log(`[TCP:PLC_HANDSHAKE_STARTING] partId=${partId} station=${stationNo}`);

      await handleStationPlcFlow({
        scanResult,
        machine,
        stationNo,
        partId,
        requiredPlcPartCount,
      });
      safeSocketWrite(`${scanResult.decision}\n`);

      const operationStatus = scanResult.operationStatus || (scanResult.decision === "ALLOW" ? "PENDING" : "BLOCKED");
      const isBlocked = scanResult.decision === "BLOCK";
      
      let popupType = mapScanDecisionToPopupType(scanResult);
      let popupMessage = scanResult.message || scanResult.reason || "Scan processed";
      
      if (isBlocked) {
        popupType = "ERROR"; // Must be ERROR to trigger frontend formatScanErrorMessage rules
        popupMessage = scanResult.message || `BLOCKED - ${scanResult.reason || "Interlocked"}`;
      }

      emitRealtime("operator_popup", {
        type: popupType,
        message: popupMessage,
        partId,
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        scannerName: scanner.scanner_name,
        scannerIp,
        status: isBlocked ? "BLOCKED" : operationStatus,
        plcStatus: isBlocked ? "BLOCKED" : operationStatus,
        qrResult: scanResult.decision === "ALLOW" ? "PASS" : "FAIL",
        reason: scanResult.reason || null,
        timestamp: new Date().toISOString(),
      });

      console.log(
        `Part: ${partId} | Station: ${stationNo} | Outcome: ${scanResult.decision} | Reason: ${scanResult.reason} | Status: ${scanResult.currentStatus}`
      );
    } catch (error) {
      const errorMsg = error.message || "Unknown scan handling error";
      console.error(`[TCP] Scan handling failed for ${scannerIp}:`, error);
      
      safeSocketWrite("BLOCK\n");

      // Point: Always show global popup even on system/validation errors
      emitRealtime("operator_popup", {
        type: "ERROR",
        message: `System Error: ${errorMsg}`,
        partId: String(inputChunk || "").trim().slice(0, 40),
        stationNo: activeMachine ? getMachineOperationStage(activeMachine) : "UNKNOWN",
        machineId: activeMachine?.id || null,
        machineName: activeMachine?.machine_name || "Unknown Machine",
        status: "SYSTEM_ERROR",
        plcStatus: "SYSTEM_ERROR",
        qrResult: "FAIL",
        reason: "VALIDATION_ERROR",
        timestamp: new Date().toISOString(),
      });
    }
  };

  const queueMessage = (chunk) => {
    const raw = String(chunk || "");
    if (!raw) {
      return;
    }
    messageQueue = messageQueue.then(() => processRawMessage(raw));
  };

  console.log("Scanner Connected:", scannerIp);
  scannerService.markScannerConnected({ scannerIp });
  resolveScannerContext().catch((error) => {
    console.error("Scanner context resolve failed:", error.message);
  });
  markHeartbeat();

  socket.on("data", (buffer) => {
    try {
      markHeartbeat();
      scannerService.markScannerData({ scannerIp });

      inboundBuffer += String(buffer.toString() || "");
      
      // Production Rule: PAYLOAD_OVERFLOW protection
      if (inboundBuffer.length > SOCKET_BUFFER_MAX_CHARS) {
        console.warn(`[TCP] Payload overflow from ${scannerIp}. Flushing buffer.`);
        inboundBuffer = "";
        safeSocketWrite("BLOCK\n");
        return;
      }

      const segments = inboundBuffer.split(/\r\n|\n|\r/);
      // Keep the last segment in buffer if it doesn't end with a delimiter
      inboundBuffer = segments.pop() || "";
      
      for (const segment of segments) {
        const trimmed = segment.trim();
        if (trimmed) {
          queueMessage(trimmed);
        }
      }
      
      if (inboundBuffer) {
        scheduleFlush();
      }
    } catch (error) {
      console.error(`[TCP] Critical error in data handler for ${scannerIp}:`, error.message);
      safeSocketWrite("BLOCK\n");
    }
  });

  socket.on("end", () => {
    clearFlushTimer();
    if (!disconnectedHandled) {
      disconnectedHandled = true;
      scannerService.markScannerDisconnected({ scannerIp });
    }
  });
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.warn(
      `[TCP] Port ${tcpPort} is already in use. TCP scanner listener is disabled for this process.`
    );
    return;
  }
  console.error("[TCP] Server failed:", error.message);
});

function startTcpServer() {
  if (server.listening) return;
  server.listen(tcpPort, () => {
    console.log(`TCP Server Running on Port ${tcpPort}`);
    console.log("[TCP:ACK_MODE_DISABLED]");
    console.log("[TCP:HANDSHAKE_DIRECT_MODE]");
  });
}

async function shutdownTcpServer() {
  console.log("[TCP] Shutting down TCP scanner server...");
  for (const socket of activeSockets) {
    socket.destroy();
  }
  activeSockets.clear();
  
  if (server.listening) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

module.exports = {
  startTcpServer,
  shutdownTcpServer
};
