const net = require("net");
const scannerConnectionService = require("../services/scannerConnectionService");
const { markScannerHeartbeat } = require("../services/scannerHealthService");
const Scanner = require("../models/Scanner");
const Machine = require("../models/Machine");
const OperationLog = require("../models/OperationLog");
const Part = require("../models/Part");
const PartCodeMapping = require("../models/PartCodeMapping");
const ProductionLog = require("../models/ProductionLog");
const { saveScan } = require("../services/scanService");
const { getStationFeatureConfig } = require("../services/stationFeatureService");
const { emitRealtime } = require("../services/realtimeService");
const { Op } = require("sequelize");

function sanitizeScannerPayload(value) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

function normalizeStation(value) {
  return String(value || "").trim().toUpperCase();
}

function uniqueStages(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeStation(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

const CUSTOMER_QR_WAITING_OPERATIONS = new Set(["LASER", "LASER_MARKING", "LASER MARKING", "OP_LASER", "OP160", "OP170"]);

function requiresCustomerQrForCompletion(machine = {}) {
  const tokens = [
    machine.operation_no,
    machine.machine_name,
  ].map((value) => String(value || "").trim().toUpperCase());
  return tokens.some((token) => CUSTOMER_QR_WAITING_OPERATIONS.has(token) || token.includes("LASER"));
}

async function getActiveStationSequence() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    attributes: ["operation_no"],
    order: [["sequence_no", "ASC"], ["id", "ASC"]],
    raw: true,
  });
  return uniqueStages(machines.map((machine) => machine.operation_no));
}

async function getActiveMachineSequenceData() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    attributes: ["id", "operation_no", "machine_name"],
    order: [["sequence_no", "ASC"], ["id", "ASC"]],
    raw: true,
  });
  return {
    machines,
    sequence: uniqueStages(machines.map((machine) => machine.operation_no)),
  };
}

async function shouldBlockMappedCustomerQrOnStartScan(stationNo) {
  const station = normalizeStation(stationNo);
  if (!station) return false;
  const sequenceData = await getActiveMachineSequenceData();
  const sequence = Array.isArray(sequenceData?.sequence) ? sequenceData.sequence : [];
  const currentIndex = sequence.indexOf(station);
  const customerQrStationIndex = sequence.findIndex((candidateStation) => {
    const machines = (sequenceData?.machines || []).filter((machine) => normalizeStation(machine.operation_no) === candidateStation);
    return machines.some((machine) => requiresCustomerQrForCompletion(machine));
  });
  if (customerQrStationIndex < 0) return true;
  if (currentIndex < 0) return false;
  return currentIndex <= customerQrStationIndex;
}

function wrongCustomerQrAtStartMessage(stationNo) {
  return `Wrong QR scanned at ${normalizeStation(stationNo) || "this station"}. Scan Part Serial/Casting QR here. Customer QR is allowed only after Laser Marking.`;
}

async function markOperationEndedOk({ operationLogId, partId, stationNo, machineId }) {
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
  });

  const part = await Part.findOne({ where: { part_id: partId } });
  if (part) {
    const sequence = await getActiveStationSequence();
    const station = normalizeStation(stationNo);
    const isLastStation = sequence.length > 0 && station === sequence[sequence.length - 1];
    part.current_station = station;
    part.current_operation = station;
    part.status = isLastStation ? "COMPLETED" : "IN_PROGRESS";
    part.is_interlocked = false;
    part.interlock_reason = null;
    part.is_rework = false;
    await part.save();
  }

  await ProductionLog.create({
    part_id: partId,
    machine_id: machineId,
    user_id: null,
    status: "OK",
    ng_reason: "TCP_CUSTOMER_QR_AUTO_OK",
  });

  return opLog;
}

async function finalizeCustomerQrMappingIfEligible({ partId, stationNo, machine }) {
  const station = normalizeStation(stationNo);
  if (!partId || !station || !machine?.id) {
    return { finalized: false, operationStatus: "WAITING" };
  }

  const features = await getStationFeatureConfig(station).catch(() => null);
  const shouldAutoComplete =
    features &&
    features.manualResult !== true &&
    features.plcCommunication === false;

  if (!shouldAutoComplete) {
    return { finalized: false, operationStatus: "WAITING" };
  }

  const latest = await OperationLog.findOne({
    where: {
      part_id: partId,
      station_no: station,
    },
    order: [["createdAt", "DESC"]],
  });

  if (!latest) {
    return { finalized: false, operationStatus: "WAITING" };
  }

  const plcStatus = String(latest.plc_status || "").trim().toUpperCase();
  if (plcStatus === "ENDED_OK") {
    return { finalized: true, operationStatus: "ENDED_OK", operationLogId: latest.id };
  }
  if (plcStatus === "ENDED_NG") {
    return { finalized: false, operationStatus: "ENDED_NG", operationLogId: latest.id };
  }

  await markOperationEndedOk({
    operationLogId: latest.id,
    partId,
    stationNo: station,
    machineId: machine.id,
  });

  emitRealtime("dashboard_refresh", {
    reason: "TCP_CUSTOMER_QR_AUTO_COMPLETED",
    partId,
    stationNo: station,
    machineId: machine.id,
  });

  return { finalized: true, operationStatus: "ENDED_OK", operationLogId: latest.id };
}

async function resolveActivePartIdForMachine(machine, stationNo) {
  if (!machine) return "";
  const machineRunningPartId = String(machine.running_part_id || "").trim();
  const machineRunningStation = String(machine.running_station_no || "").trim().toUpperCase();
  const targetStation = String(stationNo || "").trim().toUpperCase();
  if (machineRunningPartId && (!targetStation || !machineRunningStation || machineRunningStation === targetStation)) {
    return machineRunningPartId;
  }
  const activeLog = await OperationLog.findOne({
    where: {
      machine_id: machine.id,
      ...(targetStation ? { station_no: targetStation } : {}),
      plc_status: { [Op.in]: ["PENDING", "STARTED", "RUNNING", "WAITING_PLC", "START_SENT", "WAITING_RUNNING"] },
    },
    order: [["createdAt", "DESC"]],
  });
  return String(activeLog?.part_id || "").trim();
}

async function resolveMappedPartId(inputCode) {
  const raw = String(inputCode || "").trim();
  if (!raw) return { resolvedPartId: "", customerQrCode: null };
  const row = await PartCodeMapping.findOne({
    where: { customer_qr: raw, is_active: true },
    order: [["updatedAt", "DESC"]],
  });
  if (!row) {
    return { resolvedPartId: raw, customerQrCode: null };
  }
  return {
    resolvedPartId: String(row.old_part_id || raw).trim(),
    customerQrCode: String(row.customer_qr || raw).trim(),
  };
}

async function processIncomingScannerPayload({ scannerIp, payload }) {
  const partId = sanitizeScannerPayload(payload);
  if (!partId) return;
  if (partId.length < 4) return;

  const scanner = await Scanner.findOne({
    where: { scanner_ip: scannerIp, is_active: true },
    order: [["updatedAt", "DESC"]],
  });
  if (!scanner) {
    const msg = `No active scanner mapping found for IP ${scannerIp}.`;
    console.warn(`[TCP] ${msg} Payload ignored: ${partId}`);
    emitRealtime("operator_popup", {
      type: "ERROR",
      partId,
      stationNo: null,
      machineId: null,
      machineName: null,
      scannerIp,
      qrStatus: "FAILED",
      operationStatus: "BLOCKED",
      status: "BLOCKED",
      plcStatus: "BLOCKED",
      reason: "SCANNER_NOT_MAPPED",
      message: msg,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const scannerRole = String(scanner.scanner_role || "GENERAL").trim().toUpperCase() || "GENERAL";
  markScannerHeartbeat({
    scannerId: scanner.id,
    scannerIp,
    scannerName: scanner.scanner_name,
    machineId: scanner.mapped_machine_id || null,
  });

  const machine = await Machine.findByPk(scanner.mapped_machine_id);
  if (!machine || machine.is_active === false) {
    const msg = `Scanner ${scanner.id} mapped machine is missing/inactive.`;
    console.warn(`[TCP] ${msg} Payload ignored: ${partId}`);
    emitRealtime("operator_popup", {
      type: "ERROR",
      partId,
      stationNo: null,
      machineId: scanner.mapped_machine_id || null,
      machineName: null,
      scannerIp,
      qrStatus: "FAILED",
      operationStatus: "BLOCKED",
      status: "BLOCKED",
      plcStatus: "BLOCKED",
      reason: "MACHINE_INACTIVE",
      message: msg,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const stationNo = String(machine.operation_no || "").trim().toUpperCase();
  if (!stationNo) {
    const msg = `Machine ${machine.id} has no operation/station mapping.`;
    console.warn(`[TCP] ${msg} Payload ignored: ${partId}`);
    emitRealtime("operator_popup", {
      type: "ERROR",
      partId,
      stationNo: null,
      machineId: machine.id,
      machineName: machine.machine_name,
      scannerIp,
      qrStatus: "FAILED",
      operationStatus: "BLOCKED",
      status: "BLOCKED",
      plcStatus: "BLOCKED",
      reason: "STATION_NOT_CONFIGURED",
      message: msg,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  console.log(
    `[TCP] Routing payload scanner=${scanner.id} name=${scanner.scanner_name} role=${scannerRole} machine=${machine.id} station=${stationNo} payload=${partId}`
  );

  if (scannerRole === "CUSTOMER_QR") {
    const activePartId = await resolveActivePartIdForMachine(machine, stationNo);
    if (!activePartId) {
      emitRealtime("operator_popup", {
        type: "ERROR",
        partId: "",
        customerQrCode: partId,
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        scannerId: scanner.id,
        scannerName: scanner.scanner_name,
        scannerRole,
        scannerIp,
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        reason: "START_QR_REQUIRED",
        message: "Scan the start QR first, then scan customer QR for mapping.",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const existingMapping = await PartCodeMapping.findOne({
      where: { customer_qr: partId, is_active: true },
      order: [["updatedAt", "DESC"]],
    });
    if (existingMapping && String(existingMapping.old_part_id || "").trim() !== activePartId) {
      emitRealtime("operator_popup", {
        type: "ERROR",
        partId: activePartId,
        customerQrCode: partId,
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        scannerId: scanner.id,
        scannerName: scanner.scanner_name,
        scannerRole,
        scannerIp,
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        reason: "CUSTOMER_QR_ALREADY_MAPPED",
        message: "Customer QR already mapped to another part.",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    await PartCodeMapping.upsert({
      old_part_id: activePartId,
      customer_qr: partId,
      machine_id: machine.id,
      station_no: stationNo || null,
      is_active: true,
    });

    const finalized = await finalizeCustomerQrMappingIfEligible({
      partId: activePartId,
      stationNo,
      machine,
    });

    emitRealtime("scan_event", {
      sourceEvent: "scan_event",
      partId: activePartId,
      customerQrCode: partId,
      stationNo,
      machineId: machine.id,
      machineName: machine.machine_name,
      scannerId: scanner.id,
      scannerName: scanner.scanner_name,
      scannerRole,
      scannerIp,
      decision: "ALLOW",
      reason: "CUSTOMER_QR_MAPPED",
      status: finalized.finalized ? "ENDED_OK" : "SCANNED",
      qrStatus: "PASSED",
      operationStatus: finalized.operationStatus || "WAITING",
      message: finalized.finalized
        ? "Customer QR mapped successfully. Operation passed."
        : "Customer QR mapped successfully",
      timestamp: new Date().toISOString(),
    });

    emitRealtime("operator_popup", {
      type: finalized.finalized ? "SUCCESS" : "INFO",
      partId: activePartId,
      customerQrCode: partId,
      stationNo,
      machineId: machine.id,
      machineName: machine.machine_name,
      scannerId: scanner.id,
      scannerName: scanner.scanner_name,
      scannerRole,
      scannerIp,
      qrStatus: "PASSED",
      operationStatus: finalized.operationStatus || "WAITING",
      status: finalized.finalized ? "ENDED_OK" : "SCANNED",
      plcStatus: finalized.finalized ? "ENDED_OK" : "WAITING_PLC",
      reason: "CUSTOMER_QR_MAPPED",
      message: finalized.finalized
        ? "Customer QR mapped successfully. Operation passed."
        : "Customer QR mapped successfully to active part.",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const resolvedCode = await resolveMappedPartId(partId);
  const normalizedPartId = resolvedCode.resolvedPartId;
  const isMappedCustomerQrScan =
    Boolean(resolvedCode.customerQrCode) && resolvedCode.customerQrCode === partId;

  if (isMappedCustomerQrScan && await shouldBlockMappedCustomerQrOnStartScan(stationNo)) {
    const message = wrongCustomerQrAtStartMessage(stationNo);
    emitRealtime("scan_event", {
      sourceEvent: "scan_event",
      partId: normalizedPartId,
      customerQrCode: resolvedCode.customerQrCode || null,
      stationNo,
      machineId: machine.id,
      machineName: machine.machine_name,
      scannerId: scanner.id,
      scannerName: scanner.scanner_name,
      scannerRole,
      scannerIp,
      decision: "BLOCK",
      reason: "CUSTOMER_QR_NOT_ALLOWED_AT_START_STATION",
      status: "BLOCKED",
      qrStatus: "FAILED",
      operationStatus: "BLOCKED",
      message,
      timestamp: new Date().toISOString(),
    });
    emitRealtime("operator_popup", {
      type: "ERROR",
      partId: normalizedPartId,
      customerQrCode: resolvedCode.customerQrCode || null,
      stationNo,
      machineId: machine.id,
      machineName: machine.machine_name,
      scannerId: scanner.id,
      scannerName: scanner.scanner_name,
      scannerRole,
      scannerIp,
      qrStatus: "FAILED",
      operationStatus: "BLOCKED",
      status: "BLOCKED",
      plcStatus: "BLOCKED",
      reason: "CUSTOMER_QR_NOT_ALLOWED_AT_START_STATION",
      message,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const response = await saveScan(normalizedPartId, stationNo, "OK", machine.id, null, {
    resultSource: "TCP_PUSH_SCANNER",
    resultInput: "OK",
    skipQrFormatValidation: isMappedCustomerQrScan,
    skipShotValidation: isMappedCustomerQrScan,
    skipCustomerCodeValidation: isMappedCustomerQrScan,
  });

  emitRealtime("scan_event", {
    sourceEvent: "scan_event",
    partId: normalizedPartId,
    customerQrCode: resolvedCode.customerQrCode || null,
    stationNo,
    machineId: machine.id,
    machineName: machine.machine_name,
    scannerId: scanner.id,
    scannerName: scanner.scanner_name,
    scannerRole,
    scannerIp,
    decision: response?.decision || "BLOCK",
    reason: response?.reason || null,
    status: response?.decision === "ALLOW" ? "SCANNED" : "BLOCKED",
    qrStatus: response?.qrStatus || (response?.decision === "ALLOW" ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (response?.decision === "ALLOW" ? "WAITING" : "BLOCKED"),
    message: response?.message || "",
    timestamp: new Date().toISOString(),
  });

  console.log(
    `[TCP] Scan decision scanner=${scanner.id} role=${scannerRole} machine=${machine.id} station=${stationNo} payload=${partId} decision=${response?.decision || "BLOCK"} reason=${response?.reason || "NA"}`
  );
  emitRealtime("operator_popup", {
    type: response?.decision === "ALLOW" ? "INFO" : "ERROR",
    partId: normalizedPartId,
    customerQrCode: resolvedCode.customerQrCode || null,
    stationNo,
    machineId: machine.id,
    machineName: machine.machine_name,
    scannerId: scanner.id,
    scannerName: scanner.scanner_name,
    scannerRole,
    scannerIp,
    qrStatus: response?.qrStatus || (response?.decision === "ALLOW" ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (response?.decision === "ALLOW" ? "WAITING" : "BLOCKED"),
    status: response?.decision === "ALLOW" ? "SCANNED" : "BLOCKED",
    plcStatus: response?.decision === "ALLOW" ? "WAITING_PLC" : "BLOCKED",
    reason: response?.reason || null,
    message: response?.message || "",
    timestamp: new Date().toISOString(),
  });
}

let tcpServer = null;
let running = false;

function getTcpPort() {
  const parsed = Number(process.env.TCP_SERVER_PORT || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function startTcpServer() {
  if (running) {
    return;
  }

  const port = getTcpPort();
  if (!port) {
    console.log("[TCP] TCP server disabled (set TCP_SERVER_PORT to enable).");
    running = true;
    return;
  }

  tcpServer = net.createServer((socket) => {
    const remoteIp = String(socket.remoteAddress || "").replace(/^::ffff:/, "");
    console.log(`[TCP] Client connected: ${remoteIp}:${socket.remotePort || "-"}`);
    scannerConnectionService.markScannerConnected({ scannerIp: remoteIp });

    let pending = "";
    let flushTimer = null;

    const clearFlushTimer = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    };

    const consumeMessage = (raw) => {
      const data = sanitizeScannerPayload(raw);
      if (!data) return;
      console.log(`[TCP] Received from ${remoteIp}: ${data}`);
      scannerConnectionService.markScannerData({ scannerIp: remoteIp });
      markScannerHeartbeat({ scannerIp: remoteIp });
      processIncomingScannerPayload({ scannerIp: remoteIp, payload: data }).catch((error) => {
        console.error(`[TCP] Scanner payload processing failed (${remoteIp}): ${error.message}`);
      });
    };

    const schedulePendingFlush = () => {
      clearFlushTimer();
      flushTimer = setTimeout(() => {
        if (pending.trim()) {
          consumeMessage(pending);
          pending = "";
        }
      }, 250);
    };

    socket.on("data", (buffer) => {
      const chunk = buffer.toString("utf8");
      console.log(`[TCP] Raw chunk from ${remoteIp}: ${JSON.stringify(chunk)}`);
      pending += chunk;

      const parts = pending.split(/\r?\n|\0/);
      pending = parts.pop() || "";

      for (const raw of parts) {
        consumeMessage(raw);
      }
      schedulePendingFlush();
    });

    socket.on("close", () => {
      clearFlushTimer();
      if (pending.trim()) {
        consumeMessage(pending);
      }
      scannerConnectionService.markScannerDisconnected({ scannerIp: remoteIp });
      console.log(`[TCP] Client disconnected: ${remoteIp}`);
    });

    socket.on("error", (error) => {
      clearFlushTimer();
      console.error("[TCP] Client socket error:", error.message);
    });
  });

  tcpServer.on("error", (error) => {
    console.error("[TCP] Server error:", error.message);
  });

  tcpServer.listen(port, () => {
    console.log(`[TCP] Server listening on port ${port}`);
  });

  running = true;
}

function shutdownTcpServer() {
  return new Promise((resolve) => {
    if (!tcpServer) {
      running = false;
      resolve();
      return;
    }

    tcpServer.close(() => {
      running = false;
      tcpServer = null;
      resolve();
    });
  });
}

module.exports = {
  startTcpServer,
  shutdownTcpServer,
};
