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
const {
  buildWorkflowKey,
  getWorkflowState,
  resetWorkflowState,
  beginWorkflow,
  markCustomerQrMapped,
  completeWorkflow,
  enqueueLaserWorkflow,
} = require("../services/laserMarkingWorkflowService");
const { emitRealtime } = require("../services/realtimeService");
const { isMachineBypassEnabled } = require("../services/machineBypassService");
const {
  sanitizeScannerPayload: sanitizeScannerPayloadUtil,
  normalizeStation: normalizeStationUtil,
  buildScannerDisplayContext,
  validateScannerPayload,
  parseScannerPacket,
  detectQrType,
} = require("./scannerFlowUtils");
const {
  LEAKTEST_OPERATION,
  buildLeaktestIndex,
  getLeaktestReadingForPartStation,
  getLeaktestStageState,
} = require("../services/leaktestLookupService");
const { Op } = require("sequelize");
const CUSTOMER_QR_ACTIVE_WINDOW_MS = Math.max(
  Number(process.env.CUSTOMER_QR_ACTIVE_WINDOW_MS || 10 * 60 * 1000),
  30 * 1000
);
const TCP_SCANNER_FLUSH_MS = Math.min(
  Math.max(Number(process.env.TCP_SCANNER_FLUSH_MS || 250), 30),
  500
);
const TCP_SCANNER_DUPLICATE_DEBOUNCE_MS = Math.max(
  Number(process.env.TCP_SCANNER_DUPLICATE_DEBOUNCE_MS || 600),
  100
);
const TCP_SCANNER_CLIENT_TIMEOUT_MS = Math.max(
  Number(process.env.TCP_SCANNER_CLIENT_TIMEOUT_MS || 30000),
  5000
);
const TCP_SCAN_PROCESSING_TIMEOUT_MS = Math.max(
  Number(process.env.TCP_SCAN_PROCESSING_TIMEOUT_MS || 20000),
  5000
);
const scannerProcessingQueues = new Map();
const scannerDuplicateCache = new Map();
const queueRecords = [];
const tcpDiagnostics = {
  totalScans: 0,
  totalProcessed: 0,
  totalSuccess: 0,
  totalErrors: 0,
  totalTimeouts: 0,
  duplicateScans: 0,
  droppedPackets: 0,
  queueWaitMs: 0,
  processingMs: 0,
  maxQueueWaitMs: 0,
  maxProcessingMs: 0,
  activeConnections: 0,
  totalConnections: 0,
};
let nextQueueId = 1;

function sanitizeScannerPayload(value) {
  return sanitizeScannerPayloadUtil(value);
}

function normalizeStation(value) {
  return normalizeStationUtil(value);
}

function createQueueId() {
  return `tcp-${Date.now()}-${nextQueueId++}`;
}

function isDuplicateScannerPacket(scannerIp, sanitizedPayload) {
  const key = String(scannerIp || "unknown").trim() || "default";
  const lastEntry = scannerDuplicateCache.get(key);
  const now = Date.now();
  if (lastEntry && lastEntry.payload === sanitizedPayload && now - lastEntry.timestamp <= TCP_SCANNER_DUPLICATE_DEBOUNCE_MS) {
    return true;
  }
  scannerDuplicateCache.set(key, { payload: sanitizedPayload, timestamp: now });
  return false;
}

function recordQueueItem(queueItem) {
  queueRecords.push(queueItem);
  if (queueRecords.length > 200) {
    queueRecords.shift();
  }
}

function enqueueScannerProcessing(scannerIp, processor, queueItem = {}) {
  const key = String(scannerIp || "unknown").trim() || "default";
  const queuedAt = Date.now();
  queueItem.queueId = queueItem.queueId || createQueueId();
  queueItem.scannerIp = key;
  queueItem.receiveTime = queuedAt;
  queueItem.status = "QUEUED";
  recordQueueItem(queueItem);

  const previous = scannerProcessingQueues.get(key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      queueItem.processingStart = Date.now();
      queueItem.queueWaitMs = queueItem.processingStart - queuedAt;
      tcpDiagnostics.totalScans += 1;
      tcpDiagnostics.queueWaitMs += queueItem.queueWaitMs;
      tcpDiagnostics.maxQueueWaitMs = Math.max(tcpDiagnostics.maxQueueWaitMs, queueItem.queueWaitMs);
      queueItem.status = "PROCESSING";

      const work = processor()
        .then((value) => ({ value }))
        .catch((error) => ({ error }));
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), TCP_SCAN_PROCESSING_TIMEOUT_MS));
      const outcome = await Promise.race([work, timeoutPromise]);

      queueItem.processingEnd = Date.now();
      queueItem.processingDurationMs = queueItem.processingEnd - queueItem.processingStart;
      tcpDiagnostics.processingMs += queueItem.processingDurationMs;
      tcpDiagnostics.maxProcessingMs = Math.max(tcpDiagnostics.maxProcessingMs, queueItem.processingDurationMs);

      if (outcome.timeout) {
        queueItem.status = "TIMEOUT";
        tcpDiagnostics.totalTimeouts += 1;
        logScannerTrace({
          stage: "scan_timeout",
          scannerIp: key,
          queueId: queueItem.queueId,
          payload: queueItem.rawPayload,
          reason: "PROCESSING_TIMEOUT",
          status: "TIMEOUT",
          durationMs: queueItem.processingDurationMs,
          flowType: queueItem.flowType,
          qrType: queueItem.qrType,
        });
        return;
      }

      if (outcome.error) {
        queueItem.status = "ERROR";
        tcpDiagnostics.totalErrors += 1;
        logScannerTrace({
          level: "error",
          stage: "scan_error",
          scannerIp: key,
          queueId: queueItem.queueId,
          payload: queueItem.rawPayload,
          reason: outcome.error.message || "PROCESSING_EXCEPTION",
          status: "ERROR",
          durationMs: queueItem.processingDurationMs,
          flowType: queueItem.flowType,
          qrType: queueItem.qrType,
        });
        throw outcome.error;
      }

      queueItem.status = "SUCCESS";
      tcpDiagnostics.totalSuccess += 1;
      tcpDiagnostics.totalProcessed += 1;
      logScannerTrace({
        stage: "scan_processed",
        scannerIp: key,
        queueId: queueItem.queueId,
        payload: queueItem.rawPayload,
        status: "SUCCESS",
        durationMs: queueItem.processingDurationMs,
        flowType: queueItem.flowType,
        qrType: queueItem.qrType,
      });
      return outcome.value;
    });

  scannerProcessingQueues.set(key, next.catch(() => {}));
  return next;
}

function attachScannerDisplayMetadata(payload = {}, { rawPacket = "", rawPayload = "", partId = "", customerQrCode = "", mappedPartId = "" } = {}) {
  const context = buildScannerDisplayContext({ rawPacket, rawPayload, sanitizedPayload: rawPayload, partId, customerQrCode, mappedPartId });
  return {
    ...payload,
    scannedQr: context.scannedQr,
    displayQr: context.displayQr,
    customerQrCode: context.customerQrCode || payload.customerQrCode || "",
    mappedPartId: context.mappedPartId || payload.mappedPartId || "",
  };
}

function logScannerTrace({ level = "info", stage, scannerIp, scannerName, machineId, stationNo, flowType, payload, reason, status, durationMs, queueId, qrType, validationCode, validationMessage, rawPacket }) {
  const line = {
    stage,
    queueId,
    scannerIp,
    scannerName,
    machineId,
    stationNo,
    flowType,
    qrType,
    payload,
    rawPacket,
    reason,
    validationCode,
    validationMessage,
    status,
    durationMs,
  };
  if (level === "error") {
    console.error(`[TCP][TRACE] ${JSON.stringify(line)}`);
  } else {
    console.info(`[TCP][TRACE] ${JSON.stringify(line)}`);
  }
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

const CUSTOMER_QR_WAITING_OPERATIONS = new Set(["LASER", "LASER_MARKING", "LASER MARKING", "OP_LASER", "OP110", "OP160", "OP170"]);

function requiresCustomerQrForCompletion(machine = {}) {
  const tokens = [
    machine.operation_no,
    machine.machine_name,
  ].map((value) => String(value || "").trim().toUpperCase());
  return tokens.some((token) => CUSTOMER_QR_WAITING_OPERATIONS.has(token) || token.includes("LASER"));
}

async function stationRequiresCustomerQrForCompletion(machine = {}, stationNo = "") {
  const station = normalizeStation(stationNo || machine?.operation_no);
  if (!machine || !station) return false;
  const features = await getStationFeatureConfig(station, {
    plantId: machine.plantId || machine.plant_id,
    lineId: machine.lineId || machine.line_id,
  }).catch(() => null);
  if (features?.customerQrRequiredConfigured === true) {
    return features.customerQrRequired === true;
  }
  return requiresCustomerQrForCompletion(machine);
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
  const customerQrStations = new Set();
  for (const machine of sequenceData?.machines || []) {
    if (await stationRequiresCustomerQrForCompletion(machine, machine.operation_no)) {
      customerQrStations.add(normalizeStation(machine.operation_no));
    }
  }
  const customerQrStationIndex = sequence.findIndex((candidateStation) => {
    const machines = (sequenceData?.machines || []).filter((machine) => normalizeStation(machine.operation_no) === candidateStation);
    return customerQrStations.has(candidateStation) || machines.some((machine) => requiresCustomerQrForCompletion(machine));
  });
  if (customerQrStationIndex < 0) return true;
  if (currentIndex < 0) return false;
  return currentIndex <= customerQrStationIndex;
}

function wrongCustomerQrAtStartMessage(stationNo) {
  return `Wrong QR scanned at ${normalizeStation(stationNo) || "this station"}. Scan Part Serial/Casting QR here. Customer QR is allowed only after Laser Marking.`;
}

async function isAfterCustomerQrMappingStation(stationNo) {
  const station = normalizeStation(stationNo);
  if (!station) return false;
  const sequenceData = await getActiveMachineSequenceData();
  const sequence = Array.isArray(sequenceData?.sequence) ? sequenceData.sequence : [];
  const currentIndex = sequence.indexOf(station);
  const customerQrStations = new Set();
  for (const machine of sequenceData?.machines || []) {
    if (await stationRequiresCustomerQrForCompletion(machine, machine.operation_no)) {
      customerQrStations.add(normalizeStation(machine.operation_no));
    }
  }
  const customerQrStationIndex = sequence.findIndex((candidateStation) => {
    const machines = (sequenceData?.machines || []).filter((machine) => normalizeStation(machine.operation_no) === candidateStation);
    return customerQrStations.has(candidateStation) || machines.some((machine) => requiresCustomerQrForCompletion(machine));
  });
  return currentIndex >= 0 && customerQrStationIndex >= 0 && currentIndex > customerQrStationIndex;
}

async function shouldBlockUnknownQrAfterLaser({ code, stationNo }) {
  const raw = String(code || "").trim();
  if (!raw) return false;
  const afterCustomerQrStation = await isAfterCustomerQrMappingStation(stationNo);
  if (!afterCustomerQrStation) return false;

  const [mapping, successfulHistory] = await Promise.all([
    PartCodeMapping.findOne({
      where: { customer_qr: raw, is_active: true },
      attributes: ["id"],
      order: [["updatedAt", "DESC"]],
    }),
    OperationLog.findOne({
      where: {
        part_id: raw,
        result: "OK",
        plc_status: { [Op.in]: ["PENDING", "STARTED", "RUNNING", "WAITING_PLC", "ENDED_OK", "PASSED", "COMPLETED_OK"] },
      },
      attributes: ["id"],
      order: [["createdAt", "DESC"]],
    }),
  ]);
  if (mapping || successfulHistory) return false;
  return true;
}

async function unknownQrAfterLaserMessage(stationNo) {
  const sequence = await getActiveStationSequence().catch(() => []);
  const firstStation = normalizeStation(sequence?.[0]);
  const currentStation = normalizeStation(stationNo) || "This station";
  return firstStation
    ? `${currentStation}: Part not found. Scan this part at first station ${firstStation} first.`
    : `${currentStation}: Part not found. Scan this part at first station first.`;
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

  const features = await getStationFeatureConfig(station, {
    plantId: machine.plantId || machine.plant_id,
    lineId: machine.lineId || machine.line_id,
  }).catch(() => null);
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

function emitCustomerQrScannerResult({
  type = "INFO",
  partId = "",
  customerQrCode = "",
  stationNo,
  machine,
  scanner,
  scannerRole = "CUSTOMER_QR",
  scannerIp,
  decision = "BLOCK",
  reason,
  qrStatus,
  operationStatus,
  status,
  plcStatus,
  customerQrPending = false,
  customerQrMapped = false,
  message,
}) {
  const displayContext = buildScannerDisplayContext({ rawPayload: customerQrCode || partId, partId, customerQrCode, mappedPartId: partId });
  const payload = attachScannerDisplayMetadata({
    partId: partId || displayContext.mappedPartId || "",
    customerQrCode: displayContext.customerQrCode,
    stationNo,
    machineId: machine?.id || null,
    machineName: machine?.machine_name || null,
    scannerId: scanner?.id || null,
    scannerName: scanner?.scanner_name || null,
    scannerRole,
    scannerIp,
    reason,
    qrStatus,
    operationStatus,
    status,
    plcStatus,
    customerQrPending,
    customerQrMapped,
    message,
    timestamp: new Date().toISOString(),
  }, {
    rawPayload: customerQrCode || partId,
    partId,
    customerQrCode: displayContext.customerQrCode,
    mappedPartId: partId,
  });

  emitRealtime("scan_event", {
    sourceEvent: "scan_event",
    ...payload,
    decision,
  });

  emitRealtime("operator_popup", {
    type,
    ...payload,
  });
}

async function resolveActivePartIdForMachine(machine, stationNo) {
  if (!machine) return "";
  const targetStation = String(stationNo || "").trim().toUpperCase();
  const workflowKey = buildWorkflowKey(machine.id, targetStation);
  const workflowState = getWorkflowState(workflowKey);
  if (workflowState?.waitingForCustomerQr && workflowState.activePartId) {
    return workflowState.activePartId;
  }
  return "";
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

async function isKnownPartOrMappedCustomerQr(code) {
  const raw = String(code || "").trim();
  if (!raw) return true;
  const [part, mapping] = await Promise.all([
    Part.findOne({ where: { part_id: raw }, attributes: ["part_id", "qr_format_name"] }),
    PartCodeMapping.findOne({
      where: { customer_qr: raw, is_active: true },
      attributes: ["id", "old_part_id", "customer_qr"],
      order: [["updatedAt", "DESC"]],
    }),
  ]);
  const formatName = String(part?.qr_format_name || "").trim().toUpperCase();
  const oldPartId = String(mapping?.old_part_id || "").trim();
  const customerQr = String(mapping?.customer_qr || "").trim();
  if (formatName === "CUSTOMER_QR_ONLY") return false;
  if (oldPartId && customerQr && oldPartId === customerQr) return false;
  return Boolean(part || mapping);
}

async function canStartCustomerQrOnlyPart({ code, stationNo, machine }) {
  const raw = String(code || "").trim();
  const station = normalizeStation(stationNo);
  if (!raw || !station || !machine || !(await stationRequiresCustomerQrForCompletion(machine, station))) return false;
  const minCustomerQrLength = Math.max(Number(process.env.TCP_CUSTOMER_QR_MIN_LENGTH || 2), 2);
  if (raw.length < minCustomerQrLength) return false;
  const features = await getStationFeatureConfig(station, {
    plantId: machine.plantId || machine.plant_id,
    lineId: machine.lineId || machine.line_id,
  }).catch(() => null);
  if (features?.allowCustomerQrOnlyStart !== true) return false;
  return !(await isKnownPartOrMappedCustomerQr(raw));
}

async function resolveScannerFlow({ code, stationNo, machine, qrType = "UNKNOWN", scannerRole = "UNKNOWN" }) {
  const raw = String(code || "").trim();
  const station = normalizeStation(stationNo);
  const normalizedScannerRole = String(scannerRole || "").trim().toUpperCase();
  if (!raw || !station || !machine) {
    return {
      flowType: "UNKNOWN",
      reason: "MISSING_CONTEXT",
      resolvedPartId: raw,
      customerQrCode: raw,
      qrType,
    };
  }

  const workflowKey = buildWorkflowKey(machine.id, station);
  const workflowState = getWorkflowState(workflowKey);
  const hasActiveLaserStart = Boolean(workflowState?.waitingForCustomerQr && workflowState.activePartId);

  if ((normalizedScannerRole === "CUSTOMER_QR" || qrType === "CUSTOMER_QR") && hasActiveLaserStart) {
    return {
      flowType: "CUSTOMER_QR",
      reason: "CUSTOMER_QR_DETECTED_FOR_ACTIVE_START",
      resolvedPartId: raw,
      customerQrCode: raw,
      qrType: "CUSTOMER_QR",
    };
  }

  const resolved = await resolveMappedPartId(raw);
  const knownPartOrMapped = await isKnownPartOrMappedCustomerQr(raw);
  if (knownPartOrMapped) {
    return {
      flowType: "NORMAL",
      reason: normalizedScannerRole === "CUSTOMER_QR"
        ? "KNOWN_PART_START_QR_ON_CUSTOMER_SCANNER"
        : "KNOWN_PART_OR_MAPPED_QR",
      resolvedPartId: resolved.resolvedPartId,
      customerQrCode: resolved.customerQrCode || "",
      qrType: resolved.customerQrCode ? "CUSTOMER_QR" : "START_QR",
    };
  }

  const customerQrOnlyEligible = await canStartCustomerQrOnlyPart({ code: raw, stationNo: station, machine });
  if (customerQrOnlyEligible) {
    return {
      flowType: "CUSTOMER_QR_ONLY",
      reason: "CUSTOMER_QR_ONLY_START_ALLOWED",
      resolvedPartId: raw,
      customerQrCode: raw,
      qrType: "CUSTOMER_QR_ONLY",
    };
  }

  if (normalizedScannerRole === "CUSTOMER_QR" || qrType === "CUSTOMER_QR") {
    return {
      flowType: "CUSTOMER_QR",
      reason: "NO_ACTIVE_START_QR",
      resolvedPartId: raw,
      customerQrCode: raw,
      qrType: "CUSTOMER_QR",
    };
  }

  if (resolved.customerQrCode) {
    return {
      flowType: "NORMAL",
      reason: "MAPPED_CUSTOMER_QR",
      resolvedPartId: resolved.resolvedPartId,
      customerQrCode: resolved.customerQrCode,
      qrType: "CUSTOMER_QR",
    };
  }

  return {
    flowType: "UNKNOWN",
    reason: "NO_ACTIVE_START_QR",
    resolvedPartId: raw,
    customerQrCode: raw,
    qrType,
  };
}

async function markCustomerQrOnlyMapping({ code, machine, stationNo }) {
  const raw = String(code || "").trim();
  if (!raw) return;
  const part = await Part.findOne({ where: { part_id: raw } });
  if (part && part.qr_format_name !== "CUSTOMER_QR_ONLY") {
    part.qr_format_name = "CUSTOMER_QR_ONLY";
    await part.save();
  }
  await PartCodeMapping.upsert({
    old_part_id: raw,
    customer_qr: raw,
    machine_id: machine?.id || null,
    station_no: normalizeStation(stationNo) || null,
    is_active: true,
  });
}

async function isCustomerQrOnlyTracePart(partId, customerQrCode = "") {
  const normalizedPartId = String(partId || "").trim();
  const normalizedCustomerQr = String(customerQrCode || "").trim();
  if (!normalizedPartId && !normalizedCustomerQr) return false;

  const [part, mapping] = await Promise.all([
    normalizedPartId
      ? Part.findOne({
          where: { part_id: normalizedPartId },
          attributes: ["part_id", "qr_format_name"],
        })
      : null,
    PartCodeMapping.findOne({
      where: {
        is_active: true,
        [Op.or]: [
          ...(normalizedPartId ? [{ old_part_id: normalizedPartId }, { customer_qr: normalizedPartId }] : []),
          ...(normalizedCustomerQr ? [{ customer_qr: normalizedCustomerQr }, { old_part_id: normalizedCustomerQr }] : []),
        ],
      },
      attributes: ["old_part_id", "customer_qr"],
      order: [["updatedAt", "DESC"]],
    }),
  ]);

  if (String(part?.qr_format_name || "").trim().toUpperCase() === "CUSTOMER_QR_ONLY") return true;
  const mappedOldPartId = String(mapping?.old_part_id || "").trim();
  const mappedCustomerQr = String(mapping?.customer_qr || "").trim();
  return Boolean(mappedOldPartId && mappedCustomerQr && mappedOldPartId === mappedCustomerQr);
}

async function processIncomingScannerPayload({ scannerIp, rawPacket }) {
  const startedAt = Date.now();
  const packet = parseScannerPacket(rawPacket);
  const validation = validateScannerPayload({
    payload: packet.rawPayload,
    scannerRole: "UNKNOWN",
  });
  const sanitizedPayload = validation.sanitizedPayload;
  const scanners = await Scanner.findAll({
    where: { scanner_ip: scannerIp, is_active: true },
    order: [["mapped_machine_id", "ASC"], ["id", "ASC"]],
  });

  logScannerTrace({
    stage: "scan_received",
    scannerIp,
    payload: sanitizedPayload,
    rawPacket: packet.rawPacket,
    status: validation.isValid ? "RECEIVED" : "ERROR",
    reason: validation.reason,
    durationMs: Date.now() - startedAt,
  });

  if (!validation.isValid) {
    const targets = scanners.length ? scanners : [null];
    for (const scanner of targets) {
      const machine = scanner?.mapped_machine_id
        ? await Machine.findByPk(scanner.mapped_machine_id)
        : null;
      const role = String(scanner?.scanner_role || "START_QR").trim().toUpperCase();
      const message = validation.message || (role === "CUSTOMER_QR"
        ? `Invalid CUSTOMER_QR payload "${sanitizedPayload || ""}". Scan a valid Customer QR.`
        : `Invalid START_QR payload "${sanitizedPayload || ""}". Scan a valid Part ID.`);
      emitRealtime("operator_popup", attachScannerDisplayMetadata({
        type: "ERROR",
        partId: "",
        stationNo: machine?.operation_no || null,
        machineId: machine?.id || null,
        machineName: machine?.machine_name || null,
        scannerId: scanner?.id || null,
        scannerName: scanner?.scanner_name || null,
        scannerRole: scanner?.scanner_role || null,
        scannerIp,
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        reason: validation.reason,
        message,
        timestamp: new Date().toISOString(),
      }, { rawPayload: packet.rawPayload, partId: "", customerQrCode: "", mappedPartId: "" }));
    }
    return;
  }

  if (!scanners.length) {
    const msg = `No active scanner mapping found for IP ${scannerIp}.`;
    console.warn(`[TCP] ${msg} Payload ignored: ${sanitizedPayload}`);
    emitRealtime("operator_popup", {
      type: "ERROR",
      partId: sanitizedPayload,
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

  if (isDuplicateScannerPacket(scannerIp, sanitizedPayload)) {
    tcpDiagnostics.duplicateScans += 1;
    logScannerTrace({
      stage: "duplicate_scan",
      scannerIp,
      payload: sanitizedPayload,
      rawPacket: packet.rawPacket,
      reason: "DUPLICATE_PACKET",
      status: "IGNORED",
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  console.log(`[TCP] Routing payload from ${scannerIp} to ${scanners.length} scanner mapping(s). Payload=${sanitizedPayload}`);
  logScannerTrace({
    stage: "routing_started",
    scannerIp,
    scannerName: scanners[0]?.scanner_name || null,
    payload: sanitizedPayload,
    status: "PROCESSING",
    durationMs: Date.now() - startedAt,
  });

  const customerQrTargets = await resolveSharedCustomerQrTargets({ scanners, partId: sanitizedPayload });
  const customerQrOnlyStartTargets = customerQrTargets.length > 0
    ? []
    : await resolveCustomerQrOnlyStartTargets({ scanners, partId: sanitizedPayload });
  const routingTargets = customerQrTargets.length > 0
    ? customerQrTargets
    : customerQrOnlyStartTargets.length > 0
      ? customerQrOnlyStartTargets
      : scanners.map((scanner) => ({ scanner, forceCustomerQr: false }));

  for (const target of routingTargets) {
    if (!target.forceCustomerQr) {
      const delay = await shouldDelayCustomerQrStationStart({
        scanner: target.scanner,
        partId: sanitizedPayload,
        scannerIp,
      });
      if (delay.delayed) {
        emitRealtime("operator_popup", {
          type: "INFO",
          partId: sanitizedPayload,
          stationNo: delay.stationNo,
          machineId: delay.machineId,
          machineName: delay.machineName,
          scannerId: target.scanner.id,
          scannerName: target.scanner.scanner_name,
          scannerRole: String(target.scanner.scanner_role || "GENERAL").trim().toUpperCase() || "GENERAL",
          scannerIp,
          qrStatus: "PASSED",
          operationStatus: "WAITING_PREVIOUS",
          status: "WAITING",
          plcStatus: "WAITING_PREVIOUS",
          reason: "WAITING_PREVIOUS_STATION_OK",
          message: `${delay.stationNo} waiting. Previous station ${delay.previousStation} is not completed OK for this part. Complete ${delay.previousStation} first, then scan the customer QR here.`,
          timestamp: new Date().toISOString(),
        });
        continue;
      }
    }

    const machine = await Machine.findByPk(target.scanner.mapped_machine_id);
    const stationNo = normalizeStation(machine?.operation_no || "");
    await enqueueLaserWorkflow({
      machineId: machine?.id || target.scanner.mapped_machine_id || null,
      stationNo,
      payload: sanitizedPayload,
      processor: async () => {
        await processScannerPayloadForMapping({
          scanner: target.scanner,
          scannerIp,
          partId: sanitizedPayload,
          forceCustomerQr: target.forceCustomerQr,
          rawPacket: packet.rawPacket,
        });
      },
    });
  }
}

async function resolveSharedCustomerQrTargets({ scanners, partId }) {
  const targets = [];
  const existingPart = await Part.findOne({
    where: { part_id: partId },
    attributes: ["part_id"],
  });

  if (existingPart) {
    return targets;
  }

  const customerRoleScanners = scanners.filter((scanner) => String(scanner.scanner_role || "").trim().toUpperCase() === "CUSTOMER_QR");
  const candidates = customerRoleScanners.length ? customerRoleScanners : scanners;

  for (const scanner of candidates) {
    const machine = await Machine.findByPk(scanner.mapped_machine_id);
    const stationNo = String(machine?.operation_no || "").trim().toUpperCase();
    if (!machine || machine.is_active === false || !stationNo || !(await stationRequiresCustomerQrForCompletion(machine, stationNo))) {
      continue;
    }
    const activePartId = await resolveActivePartIdForMachine(machine, stationNo, partId);
    if (!activePartId || activePartId === partId) {
      continue;
    }
    targets.push({ scanner, forceCustomerQr: true });
  }

  return targets;
}

async function resolveCustomerQrOnlyStartTargets({ scanners, partId }) {
  const targets = [];
  const existingPart = await Part.findOne({
    where: { part_id: partId },
    attributes: ["part_id"],
  });

  if (existingPart) {
    return targets;
  }

  const customerRoleScanners = scanners.filter((scanner) => String(scanner.scanner_role || "").trim().toUpperCase() === "CUSTOMER_QR");
  const candidates = customerRoleScanners.length ? customerRoleScanners : scanners;

  for (const scanner of candidates) {
    const machine = await Machine.findByPk(scanner.mapped_machine_id);
    const stationNo = String(machine?.operation_no || "").trim().toUpperCase();
    if (!machine || machine.is_active === false || !stationNo) {
      continue;
    }
    if (await canStartCustomerQrOnlyPart({ code: partId, stationNo, machine })) {
      targets.push({ scanner, forceCustomerQr: false });
    }
  }

  return targets;
}

async function hasStationPassed(partId, stationNo) {
  const station = normalizeStation(stationNo);
  if (!partId || !station) return false;
  const { resolvedPartId } = await resolveMappedPartId(partId);
  const effectivePartId = String(resolvedPartId || partId || "").trim();
  const passed = await OperationLog.findOne({
    where: {
      part_id: effectivePartId,
      station_no: station,
      plc_status: "ENDED_OK",
      result: "OK",
    },
    attributes: ["id"],
    order: [["createdAt", "DESC"]],
  });
  if (passed) return true;
  if (station !== LEAKTEST_OPERATION) return false;

  const mapping = await PartCodeMapping.findOne({
    where: {
      old_part_id: effectivePartId,
      is_active: true,
    },
    attributes: ["old_part_id", "customer_qr"],
    order: [["updatedAt", "DESC"]],
    raw: true,
  });
  const customerQr = String(mapping?.customer_qr || "").trim();
  if (!customerQr) return false;

  const machines = await Machine.findAll({
    where: {
      is_active: true,
      operation_no: LEAKTEST_OPERATION,
    },
    attributes: ["id", "machine_name", "operation_no", "plc_ip", "qr_scanner_ip", "machine_ip"],
    raw: true,
  });
  if (!machines.length) return false;

  const index = await buildLeaktestIndex({
    partIds: [effectivePartId],
    customerQrByPartId: {
      [effectivePartId.toUpperCase()]: customerQr,
      [effectivePartId]: customerQr,
    },
    machines,
  });
  const reading = getLeaktestReadingForPartStation(index.byPartAndStation, effectivePartId, LEAKTEST_OPERATION);
  return getLeaktestStageState(reading) === "PASSED";
}

async function isStationBypassedForValidation(stationNo) {
  const station = normalizeStation(stationNo);
  if (!station) return false;

  const features = await getStationFeatureConfig(station).catch(() => null);
  if (features?.operation === false || features?.bypass === true || features?.bypassEnabled === true) {
    return true;
  }

  const machines = await Machine.findAll({
    where: {
      is_active: true,
      operation_no: station,
    },
    attributes: ["id", "bypass_enabled"],
    raw: true,
  });
  return machines.length > 0 && machines.every((machine) => (
    machine.bypass_enabled === true || isMachineBypassEnabled(machine.id)
  ));
}

async function shouldDelayCustomerQrStationStart({ scanner, partId }) {
  const machine = await Machine.findByPk(scanner.mapped_machine_id);
  const stationNo = normalizeStation(machine?.operation_no);
  if (!machine || machine.is_active === false || !stationNo || !(await stationRequiresCustomerQrForCompletion(machine, stationNo))) {
    return { delayed: false };
  }

  if (await canStartCustomerQrOnlyPart({ code: partId, stationNo, machine })) {
    return { delayed: false };
  }

  const sequence = await getActiveStationSequence();
  const stationIndex = sequence.indexOf(stationNo);
  const previousStation = stationIndex > 0 ? sequence[stationIndex - 1] : "";
  if (!previousStation) {
    return { delayed: false };
  }
  if (await isStationBypassedForValidation(previousStation)) {
    return { delayed: false };
  }

  const { resolvedPartId } = await resolveMappedPartId(partId);
  const previousPassed = await hasStationPassed(resolvedPartId || partId, previousStation);
  if (previousPassed) {
    return { delayed: false };
  }

  return {
    delayed: true,
    stationNo,
    previousStation,
    machineId: machine.id,
    machineName: machine.machine_name,
  };
}

async function processScannerPayloadForMapping({ scanner, scannerIp, partId, forceCustomerQr = false, rawPacket = "" }) {
  const scanStartedAt = Date.now();
  const scannerRole = String(scanner.scanner_role || "GENERAL").trim().toUpperCase() || "GENERAL";
  const effectiveScannerRole = forceCustomerQr ? "CUSTOMER_QR" : scannerRole;
  markScannerHeartbeat({
    scannerId: scanner.id,
    scannerIp,
    scannerName: scanner.scanner_name,
    machineId: scanner.mapped_machine_id || null,
  });

  const qrDetection = detectQrType({ rawPayload: partId, scannerRole: effectiveScannerRole, stationNo: null });
  const qrType = qrDetection.qrType || "UNKNOWN";
  const machine = await Machine.findByPk(scanner.mapped_machine_id);
  const stationNo = String(machine?.operation_no || "").trim().toUpperCase();
  const flowContext = await resolveScannerFlow({
    code: partId,
    stationNo,
    machine,
    qrType,
    scannerRole: effectiveScannerRole,
  });
  if (!machine || machine.is_active === false) {
    logScannerTrace({
      level: "error",
      stage: "machine_lookup_failed",
      scannerIp,
      scannerName: scanner.scanner_name,
      machineId: scanner.mapped_machine_id || null,
      payload: partId,
      reason: "MACHINE_INACTIVE",
      status: "ERROR",
      durationMs: Date.now() - scanStartedAt,
    });
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

  if (!stationNo) {
    logScannerTrace({
      level: "error",
      stage: "station_lookup_failed",
      scannerIp,
      scannerName: scanner.scanner_name,
      machineId: machine.id,
      payload: partId,
      reason: "STATION_NOT_CONFIGURED",
      status: "ERROR",
      durationMs: Date.now() - scanStartedAt,
    });
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
    `[TCP] Routing payload scanner=${scanner.id} name=${scanner.scanner_name} role=${effectiveScannerRole} machine=${machine.id} station=${stationNo} payload=${partId}`
  );

  const customerQrFlow = effectiveScannerRole === "CUSTOMER_QR" || flowContext.flowType === "CUSTOMER_QR";
  const customerQrOnlyStart = flowContext.flowType === "CUSTOMER_QR_ONLY";

  if (customerQrFlow) {
    await processCustomerQrScan({
      scanner,
      scannerIp,
      partId,
      stationNo,
      machine,
      scannerRole: effectiveScannerRole,
      flowContext,
      qrType,
      rawPacket,
    });
    return;
  }

  if (customerQrOnlyStart) {
    await processCustomerQrOnlyStart({
      scanner,
      scannerIp,
      partId,
      stationNo,
      machine,
      scannerRole: effectiveScannerRole,
      flowContext,
      qrType,
      rawPacket,
    });
    return;
  }

  await processNormalPartScan({
    scanner,
    scannerIp,
    partId,
    stationNo,
    machine,
    scannerRole: effectiveScannerRole,
    flowContext,
    qrType,
    rawPacket,
  });
}

async function processCustomerQrScan({ scanner, scannerIp, partId, stationNo, machine, scannerRole, flowContext, qrType, rawPacket }) {
  const scanStartedAt = Date.now();
  const workflowKey = buildWorkflowKey(machine.id, stationNo);
  const activePartId = await resolveActivePartIdForMachine(machine, stationNo);
  if (!activePartId) {
    resetWorkflowState(workflowKey, { reason: "NO_ACTIVE_START_QR" });
    if (
      flowContext.flowType === "CUSTOMER_QR_ONLY" ||
      await canStartCustomerQrOnlyPart({ code: partId, stationNo, machine })
    ) {
      await processCustomerQrOnlyStart({ scanner, scannerIp, partId, stationNo, machine, scannerRole, rawPacket });
      return;
    }

    emitCustomerQrScannerResult({
      type: "WARNING",
      partId: "",
      customerQrCode: partId,
      stationNo,
      machine,
      scanner,
      scannerRole,
      scannerIp,
      decision: "WAIT",
      qrStatus: "WAIT",
      operationStatus: "WAITING",
      status: "WAITING",
      plcStatus: "WAITING_PLC",
      customerQrPending: true,
      reason: "NO_ACTIVE_START_QR",
      message: `${stationNo}: No active Start QR found. Please scan Start QR first.`,
      timestamp: new Date().toISOString(),
    });
    logScannerTrace({
      stage: "customer_qr_no_active_start",
      scannerIp,
      scannerName: scanner.scanner_name,
      machineId: machine.id,
      stationNo,
      flowType: flowContext.flowType,
      qrType,
      payload: partId,
      reason: "NO_ACTIVE_START_QR",
      status: "WARNING",
      durationMs: Date.now() - scanStartedAt,
    });
    return;
  }

  let existingSamePartMapping = false;
  const transaction = await PartCodeMapping.sequelize.transaction();
  try {
    const existingMapping = await PartCodeMapping.findOne({
      where: { customer_qr: partId, is_active: true },
      order: [["updatedAt", "DESC"]],
      transaction,
    });

    if (existingMapping && String(existingMapping.old_part_id || "").trim() === activePartId) {
      existingSamePartMapping = true;
      await transaction.commit();
    } else if (existingMapping && String(existingMapping.old_part_id || "").trim() !== activePartId) {
      await transaction.commit();
      emitCustomerQrScannerResult({
        type: "ERROR",
        partId: activePartId,
        customerQrCode: partId,
        stationNo,
        machine,
        scanner,
        scannerRole,
        scannerIp,
        decision: "BLOCK",
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        customerQrMapped: false,
        reason: "CUSTOMER_QR_ALREADY_MAPPED",
        message: "Customer QR already mapped to another part.",
        timestamp: new Date().toISOString(),
      });
      return;
    } else {
      await PartCodeMapping.upsert({
        old_part_id: activePartId,
        customer_qr: partId,
        machine_id: machine.id,
        station_no: stationNo || null,
        is_active: true,
      }, { transaction });
      await transaction.commit();
    }
  } catch (error) {
    await transaction.rollback();
    logScannerTrace({
      level: "error",
      stage: "customer_qr_mapping_failed",
      scannerIp,
      scannerName: scanner.scanner_name,
      machineId: machine.id,
      stationNo,
      payload: partId,
      reason: error.message,
      status: "ERROR",
      durationMs: Date.now() - scanStartedAt,
    });
    throw error;
  }

  const finalized = await finalizeCustomerQrMappingIfEligible({ partId: activePartId, stationNo, machine });
  markCustomerQrMapped(workflowKey, { customerQr: partId, partId: activePartId });
  completeWorkflow(workflowKey);
  emitCustomerQrScannerResult({
    type: finalized.finalized ? "SUCCESS" : "INFO",
    partId: activePartId,
    customerQrCode: partId,
    stationNo,
    machine,
    scanner,
    scannerRole,
    scannerIp,
    decision: "ALLOW",
    qrStatus: "PASSED",
    operationStatus: finalized.operationStatus || "WAITING",
    status: finalized.finalized ? "ENDED_OK" : "SCANNED",
    plcStatus: finalized.finalized ? "ENDED_OK" : "WAITING_PLC",
    customerQrMapped: true,
    reason: existingSamePartMapping ? "CUSTOMER_QR_ALREADY_MAPPED_SAME_PART" : "CUSTOMER_QR_MAPPED",
    message: existingSamePartMapping
      ? "Customer QR already mapped to this part. Operation confirmed."
      : finalized.finalized
      ? "Customer QR mapped successfully. Operation passed."
      : "Customer QR mapped successfully to active part.",
    timestamp: new Date().toISOString(),
  });
  logScannerTrace({
    stage: "customer_qr_mapped",
    scannerIp,
    scannerName: scanner.scanner_name,
    machineId: machine.id,
    stationNo,
    flowType: "CUSTOMER_QR",
    qrType,
    payload: partId,
    reason: finalized.finalized ? "CUSTOMER_QR_MAPPED_FINALIZED" : "CUSTOMER_QR_MAPPED_PENDING",
    status: "SUCCESS",
    durationMs: Date.now() - scanStartedAt,
  });
}

async function processNormalPartScan({ scanner, scannerIp, partId, stationNo, machine, scannerRole, flowContext, qrType, rawPacket }) {
  const scanStartedAt = Date.now();
  const workflowKey = buildWorkflowKey(machine.id, stationNo);
  const resolvedCode = await resolveMappedPartId(partId);
  const normalizedPartId = resolvedCode.resolvedPartId;
  const isMappedCustomerQrScan = Boolean(resolvedCode.customerQrCode) && resolvedCode.customerQrCode === partId;
  const isCustomerQrOnlyStart = flowContext.flowType === "CUSTOMER_QR_ONLY";

  if (!isMappedCustomerQrScan && !isCustomerQrOnlyStart && await shouldBlockUnknownQrAfterLaser({ code: partId, stationNo })) {
    const message = await unknownQrAfterLaserMessage(stationNo);
    emitRealtime("scan_event", {
      sourceEvent: "scan_event",
      partId,
      customerQrCode: partId,
      stationNo,
      machineId: machine.id,
      machineName: machine.machine_name,
      scannerId: scanner.id,
      scannerName: scanner.scanner_name,
      scannerRole,
      scannerIp,
      decision: "BLOCK",
      reason: "CUSTOMER_QR_NOT_MAPPED",
      status: "BLOCKED",
      qrStatus: "FAILED",
      operationStatus: "BLOCKED",
      message,
      timestamp: new Date().toISOString(),
    });
    emitRealtime("operator_popup", {
      type: "ERROR",
      partId,
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
      reason: "CUSTOMER_QR_NOT_MAPPED",
      message,
      timestamp: new Date().toISOString(),
    });
    resetWorkflowState(workflowKey, { reason: "UNKNOWN_QR_AFTER_LASER" });
    logScannerTrace({
      stage: "unknown_qr_after_laser",
      scannerIp,
      scannerName: scanner.scanner_name,
      machineId: machine.id,
      stationNo,
      flowType: flowContext.flowType,
      qrType,
      payload: partId,
      reason: "CUSTOMER_QR_NOT_MAPPED",
      status: "BLOCKED",
      durationMs: Date.now() - scanStartedAt,
    });
    return;
  }

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
    resetWorkflowState(workflowKey, { reason: "CUSTOMER_QR_BLOCKED_AT_START" });
    logScannerTrace({
      stage: "mapped_customer_qr_at_start_blocked",
      scannerIp,
      scannerName: scanner.scanner_name,
      machineId: machine.id,
      stationNo,
      flowType: flowContext.flowType,
      qrType,
      payload: partId,
      reason: "CUSTOMER_QR_NOT_ALLOWED_AT_START_STATION",
      status: "BLOCKED",
      durationMs: Date.now() - scanStartedAt,
    });
    return;
  }

  const scanPartId = isCustomerQrOnlyStart ? partId : normalizedPartId;
  const isCustomerQrOnlyTrace = isCustomerQrOnlyStart || await isCustomerQrOnlyTracePart(scanPartId, resolvedCode.customerQrCode || (isCustomerQrOnlyStart ? scanPartId : ""));
  const response = await saveScan(scanPartId, stationNo, "OK", machine.id, null, {
    resultSource: isCustomerQrOnlyStart ? "CUSTOMER_QR_ONLY_START" : "TCP_PUSH_SCANNER",
    resultInput: "OK",
    skipQrFormatValidation: isMappedCustomerQrScan || isCustomerQrOnlyStart,
    skipShotValidation: isMappedCustomerQrScan || isCustomerQrOnlyTrace,
    skipCustomerCodeValidation: isMappedCustomerQrScan || isCustomerQrOnlyStart,
    skipSequenceValidation: isCustomerQrOnlyStart,
  });

  const customerQrPending =
    flowContext.flowType === "NORMAL" &&
    flowContext.qrType === "START_QR" &&
    (await stationRequiresCustomerQrForCompletion(machine, stationNo)) &&
    !isCustomerQrOnlyStart;
  if (response?.decision === "ALLOW" && customerQrPending) {
    beginWorkflow(workflowKey, { machineId: machine.id, stationNo, partId: scanPartId });
    response.operationStatus = "WAITING_CUSTOMER_QR";
    response.plcStatus = "WAITING_PLC";
    response.status = "SCANNED";
    response.reason = "WAITING_CUSTOMER_QR";
    response.customerQrPending = true;
    response.message = `QR PASS - Waiting for Customer QR at ${stationNo}`;
  }
  if (response?.decision === "ALLOW" && isCustomerQrOnlyStart) {
    beginWorkflow(workflowKey, { machineId: machine.id, stationNo, partId: scanPartId });
    await markCustomerQrOnlyMapping({ code: scanPartId, machine, stationNo });
    const finalized = await finalizeCustomerQrMappingIfEligible({
      partId: scanPartId,
      stationNo,
      machine,
    });
    if (finalized?.finalized) {
      completeWorkflow(workflowKey);
      response.operationStatus = "ENDED_OK";
      response.plcStatus = "ENDED_OK";
      response.status = "ENDED_OK";
      response.message = "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station.";
    }
  }

  if (response?.decision === "ALLOW" && !customerQrPending && !isCustomerQrOnlyStart) {
    completeWorkflow(workflowKey);
  }

  if (response?.decision !== "ALLOW") {
    resetWorkflowState(workflowKey, { reason: "START_QR_NOT_ALLOWED" });
  }

  emitRealtime("scan_event", attachScannerDisplayMetadata({
    sourceEvent: "scan_event",
    partId: scanPartId,
    customerQrCode: isCustomerQrOnlyStart ? scanPartId : (resolvedCode.customerQrCode || null),
    stationNo,
    machineId: machine.id,
    machineName: machine.machine_name,
    scannerId: scanner.id,
    scannerName: scanner.scanner_name,
    scannerRole,
    scannerIp,
    decision: response?.decision || "BLOCK",
    reason: isCustomerQrOnlyStart && response?.decision === "ALLOW"
      ? "CUSTOMER_QR_ONLY_STARTED"
      : (customerQrPending && response?.decision === "ALLOW" ? "WAITING_CUSTOMER_QR" : (response?.reason || null)),
    status: response?.decision === "ALLOW" ? (customerQrPending ? "WAITING" : "SCANNED") : "BLOCKED",
    qrStatus: response?.qrStatus || (response?.decision === "ALLOW" ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (response?.decision === "ALLOW" ? (customerQrPending ? "WAITING_CUSTOMER_QR" : "WAITING") : "BLOCKED"),
    customerQrPending,
    customerQrMapped: Boolean(isCustomerQrOnlyStart && response?.decision === "ALLOW"),
    message: isCustomerQrOnlyStart && response?.decision === "ALLOW"
      ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
      : (customerQrPending && response?.decision === "ALLOW"
        ? `QR PASS - Waiting for Customer QR at ${stationNo}`
        : (response?.message || "")),
    timestamp: new Date().toISOString(),
  }, { rawPacket, rawPayload: rawPacket, partId: scanPartId, customerQrCode: isCustomerQrOnlyStart ? scanPartId : (resolvedCode.customerQrCode || null), mappedPartId: scanPartId }));

  emitRealtime("operator_popup", attachScannerDisplayMetadata({
    type: response?.decision === "ALLOW" ? "INFO" : "ERROR",
    partId: scanPartId,
    customerQrCode: isCustomerQrOnlyStart ? scanPartId : (resolvedCode.customerQrCode || null),
    stationNo,
    machineId: machine.id,
    machineName: machine.machine_name,
    scannerId: scanner.id,
    scannerName: scanner.scanner_name,
    scannerRole,
    scannerIp,
    qrStatus: response?.qrStatus || (response?.decision === "ALLOW" ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (response?.decision === "ALLOW" ? (customerQrPending ? "WAITING_CUSTOMER_QR" : "WAITING") : "BLOCKED"),
    status: response?.decision === "ALLOW" ? (customerQrPending ? "WAITING" : "SCANNED") : "BLOCKED",
    plcStatus: response?.decision === "ALLOW" ? (customerQrPending ? "WAITING_PLC" : "WAITING_PLC") : "BLOCKED",
    reason: isCustomerQrOnlyStart && response?.decision === "ALLOW"
      ? "CUSTOMER_QR_ONLY_STARTED"
      : (customerQrPending && response?.decision === "ALLOW" ? "WAITING_CUSTOMER_QR" : (response?.reason || null)),
    customerQrPending,
    customerQrMapped: Boolean(isCustomerQrOnlyStart && response?.decision === "ALLOW"),
    message: isCustomerQrOnlyStart && response?.decision === "ALLOW"
      ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
      : (customerQrPending && response?.decision === "ALLOW"
        ? `QR PASS - Waiting for Customer QR at ${stationNo}`
        : (response?.message || "")),
    timestamp: new Date().toISOString(),
  }, { rawPacket, rawPayload: rawPacket, partId: scanPartId, customerQrCode: isCustomerQrOnlyStart ? scanPartId : (resolvedCode.customerQrCode || null), mappedPartId: scanPartId }));

  const processingDurationMs = Date.now() - scanStartedAt;
  console.log(
    `[TCP] Scan decision scanner=${scanner.id} role=${scannerRole} machine=${machine.id} station=${stationNo} payload=${partId} decision=${response?.decision || "BLOCK"} reason=${response?.reason || "NA"}`
  );
  logScannerTrace({
    stage: "scan_completed",
    scannerIp,
    scannerName: scanner.scanner_name,
    machineId: machine.id,
    stationNo,
    flowType: isCustomerQrOnlyStart ? "CUSTOMER_QR_ONLY" : "NORMAL",
    payload: partId,
    reason: response?.reason || null,
    status: response?.decision === "ALLOW" ? "SUCCESS" : "ERROR",
    durationMs: processingDurationMs,
  });
}

async function processCustomerQrOnlyStart({ scanner, scannerIp, partId, stationNo, machine, scannerRole }) {
  const scanStartedAt = Date.now();
  const workflowKey = buildWorkflowKey(machine.id, stationNo);
  const response = await saveScan(partId, stationNo, "OK", machine.id, null, {
    resultSource: "CUSTOMER_QR_ONLY_START",
    resultInput: "OK",
    skipQrFormatValidation: true,
    skipShotValidation: true,
    skipCustomerCodeValidation: true,
    skipSequenceValidation: true,
  });
  if (response?.decision === "ALLOW") {
    await markCustomerQrOnlyMapping({ code: partId, machine, stationNo });
    const finalized = await finalizeCustomerQrMappingIfEligible({
      partId,
      stationNo,
      machine,
    });
    if (finalized?.finalized) {
      completeWorkflow(workflowKey);
      response.operationStatus = "ENDED_OK";
      response.plcStatus = "ENDED_OK";
      response.status = "ENDED_OK";
      response.message = "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station.";
    }
  }
  const allowed = response?.decision === "ALLOW";
  if (!allowed) {
    resetWorkflowState(workflowKey, { reason: "QR_ONLY_START_BLOCKED" });
  }
  const message = allowed
    ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
    : (response?.message || "Customer QR start blocked.");
  logScannerTrace({
    stage: "customer_qr_only_completed",
    scannerIp,
    scannerName: scanner.scanner_name,
    machineId: machine.id,
    stationNo,
    flowType: "CUSTOMER_QR_ONLY",
    payload: partId,
    reason: allowed ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || null),
    status: allowed ? "SUCCESS" : "ERROR",
    durationMs: Date.now() - scanStartedAt,
  });
  emitRealtime("scan_event", attachScannerDisplayMetadata({
    sourceEvent: "scan_event",
    partId,
    customerQrCode: partId,
    stationNo,
    machineId: machine.id,
    machineName: machine.machine_name,
    scannerId: scanner.id,
    scannerName: scanner.scanner_name,
    scannerRole,
    scannerIp,
    decision: response?.decision || "BLOCK",
    reason: allowed ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || null),
    status: allowed ? "SCANNED" : "BLOCKED",
    qrStatus: response?.qrStatus || (allowed ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (allowed ? "WAITING" : "BLOCKED"),
    message,
    timestamp: new Date().toISOString(),
  }, { rawPayload: partId, partId, customerQrCode: partId, mappedPartId: partId }));
  emitRealtime("operator_popup", attachScannerDisplayMetadata({
    type: allowed ? "INFO" : "ERROR",
    partId,
    customerQrCode: partId,
    stationNo,
    machineId: machine.id,
    machineName: machine.machine_name,
    scannerId: scanner.id,
    scannerName: scanner.scanner_name,
    scannerRole,
    scannerIp,
    qrStatus: response?.qrStatus || (allowed ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (allowed ? "WAITING" : "BLOCKED"),
    status: allowed ? "SCANNED" : "BLOCKED",
    plcStatus: allowed ? "WAITING_PLC" : "BLOCKED",
    reason: allowed ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || null),
    message,
    timestamp: new Date().toISOString(),
  }, { rawPayload: partId, partId, customerQrCode: partId, mappedPartId: partId }));
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
      enqueueScannerProcessing(remoteIp, async () => {
        try {
          await processIncomingScannerPayload({ scannerIp: remoteIp, rawPacket: data });
        } catch (error) {
          console.error(`[TCP] Scanner payload processing failed (${remoteIp}): ${error.message}`);
          emitRealtime("operator_popup", attachScannerDisplayMetadata({
            type: "ERROR",
            partId: "",
            stationNo: null,
            machineId: null,
            machineName: null,
            scannerIp,
            qrStatus: "FAILED",
            operationStatus: "BLOCKED",
            status: "BLOCKED",
            plcStatus: "BLOCKED",
            reason: "SCAN_PROCESSING_ERROR",
            message: `Scan processing failed for ${sanitizeScannerPayload(data) || "the received payload"}. Please rescan.`,
            timestamp: new Date().toISOString(),
          }, { rawPayload: data, partId: "", customerQrCode: "", mappedPartId: "" }));
        }
      }).catch((error) => {
        console.error(`[TCP] Scanner queue failure (${remoteIp}): ${error.message}`);
      });
    };

    const schedulePendingFlush = () => {
      clearFlushTimer();
      flushTimer = setTimeout(() => {
        if (pending.trim()) {
          consumeMessage(pending);
          pending = "";
        }
      }, TCP_SCANNER_FLUSH_MS);
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
