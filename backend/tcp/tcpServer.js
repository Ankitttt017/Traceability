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
const { isMachineBypassEnabled } = require("../services/machineBypassService");
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
  Math.max(Number(process.env.TCP_SCANNER_FLUSH_MS || 80), 30),
  250
);

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

async function isAfterCustomerQrMappingStation(stationNo) {
  const station = normalizeStation(stationNo);
  if (!station) return false;
  const sequenceData = await getActiveMachineSequenceData();
  const sequence = Array.isArray(sequenceData?.sequence) ? sequenceData.sequence : [];
  const currentIndex = sequence.indexOf(station);
  const customerQrStationIndex = sequence.findIndex((candidateStation) => {
    const machines = (sequenceData?.machines || []).filter((machine) => normalizeStation(machine.operation_no) === candidateStation);
    return machines.some((machine) => requiresCustomerQrForCompletion(machine));
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
  const payload = {
    partId: partId || customerQrCode || "",
    customerQrCode,
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
  };

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

async function resolveActivePartIdForMachine(machine, stationNo, incomingCustomerQr = "") {
  if (!machine) return "";
  const machineRunningPartId = String(machine.running_part_id || "").trim();
  const machineRunningStation = String(machine.running_station_no || "").trim().toUpperCase();
  const targetStation = String(stationNo || "").trim().toUpperCase();
  const activeStatuses = ["PENDING", "STARTED", "RUNNING", "WAITING_PLC", "START_SENT", "WAITING_RUNNING"];
  const mappingCandidateStatuses = requiresCustomerQrForCompletion(machine)
    ? [...activeStatuses, "ENDED_OK"]
    : activeStatuses;
  const freshCutoff = new Date(Date.now() - CUSTOMER_QR_ACTIVE_WINDOW_MS);
  const isValidCustomerQrCandidate = async (partId) => {
    const normalizedPartId = String(partId || "").trim();
    if (!normalizedPartId) return false;
    const [part, mapping] = await Promise.all([
      Part.findOne({ where: { part_id: normalizedPartId }, attributes: ["part_id", "qr_format_name"] }),
      PartCodeMapping.findOne({
        where: { old_part_id: normalizedPartId, is_active: true },
        attributes: ["old_part_id", "customer_qr"],
        order: [["updatedAt", "DESC"]],
      }),
    ]);
    if (String(part?.qr_format_name || "").trim().toUpperCase() === "CUSTOMER_QR_ONLY") return false;
    return true;
  };
  if (machineRunningPartId && (!targetStation || !machineRunningStation || machineRunningStation === targetStation)) {
    const matchingActiveLog = await OperationLog.findOne({
      where: {
        part_id: machineRunningPartId,
        machine_id: machine.id,
        ...(targetStation ? { station_no: targetStation } : {}),
        plc_status: { [Op.in]: mappingCandidateStatuses },
        result: "OK",
        updatedAt: { [Op.gte]: freshCutoff },
      },
      attributes: ["id", "part_id"],
      order: [["updatedAt", "DESC"]],
    });
    if (matchingActiveLog && await isValidCustomerQrCandidate(machineRunningPartId)) {
      return machineRunningPartId;
    }
  }
  const activeLogs = await OperationLog.findAll({
    where: {
      machine_id: machine.id,
      ...(targetStation ? { station_no: targetStation } : {}),
      plc_status: { [Op.in]: mappingCandidateStatuses },
      result: "OK",
      updatedAt: { [Op.gte]: freshCutoff },
    },
    attributes: ["id", "part_id", "updatedAt"],
    order: [["updatedAt", "DESC"]],
    limit: 10,
  });
  for (const log of activeLogs) {
    const candidatePartId = String(log.part_id || "").trim();
    if (await isValidCustomerQrCandidate(candidatePartId)) return candidatePartId;
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
  if (!raw || !station || !machine || !requiresCustomerQrForCompletion(machine)) return false;
  const features = await getStationFeatureConfig(station, {
    plantId: machine.plantId || machine.plant_id,
    lineId: machine.lineId || machine.line_id,
  }).catch(() => null);
  if (features?.allowCustomerQrOnlyStart !== true) return false;
  return !(await isKnownPartOrMappedCustomerQr(raw));
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

async function processIncomingScannerPayload({ scannerIp, payload }) {
  const partId = sanitizeScannerPayload(payload);
  if (!partId) return;
  if (partId.length < 4) return;

  const scanners = await Scanner.findAll({
    where: { scanner_ip: scannerIp, is_active: true },
    order: [["mapped_machine_id", "ASC"], ["id", "ASC"]],
  });
  if (!scanners.length) {
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

  console.log(`[TCP] Routing payload from ${scannerIp} to ${scanners.length} scanner mapping(s). Payload=${partId}`);
  const customerQrTargets = await resolveSharedCustomerQrTargets({ scanners, partId });
  const customerQrOnlyStartTargets = customerQrTargets.length > 0
    ? []
    : await resolveCustomerQrOnlyStartTargets({ scanners, partId });
  const routingTargets = customerQrTargets.length > 0
    ? customerQrTargets
    : customerQrOnlyStartTargets.length > 0
      ? customerQrOnlyStartTargets
    : scanners.map((scanner) => ({ scanner, forceCustomerQr: false }));

  for (const target of routingTargets) {
    if (!target.forceCustomerQr) {
      const delay = await shouldDelayCustomerQrStationStart({
        scanner: target.scanner,
        partId,
        scannerIp,
      });
      if (delay.delayed) {
        emitRealtime("operator_popup", {
          type: "INFO",
          partId,
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
    await processScannerPayloadForMapping({
      scanner: target.scanner,
      scannerIp,
      partId,
      forceCustomerQr: target.forceCustomerQr,
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

  for (const scanner of scanners) {
    const machine = await Machine.findByPk(scanner.mapped_machine_id);
    const stationNo = String(machine?.operation_no || "").trim().toUpperCase();
    if (!machine || machine.is_active === false || !stationNo || !requiresCustomerQrForCompletion(machine)) {
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

  for (const scanner of scanners) {
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
  if (!machine || machine.is_active === false || !stationNo || !requiresCustomerQrForCompletion(machine)) {
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

async function processScannerPayloadForMapping({ scanner, scannerIp, partId, forceCustomerQr = false }) {
  const scannerRole = String(scanner.scanner_role || "GENERAL").trim().toUpperCase() || "GENERAL";
  const effectiveScannerRole = forceCustomerQr ? "CUSTOMER_QR" : scannerRole;
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
    `[TCP] Routing payload scanner=${scanner.id} name=${scanner.scanner_name} role=${effectiveScannerRole} machine=${machine.id} station=${stationNo} payload=${partId}`
  );

  if (effectiveScannerRole === "CUSTOMER_QR") {
    const activePartId = await resolveActivePartIdForMachine(machine, stationNo, partId);
    if (!activePartId) {
      if (await canStartCustomerQrOnlyPart({ code: partId, stationNo, machine })) {
        await processCustomerQrOnlyStart({
          scanner,
          scannerIp,
          partId,
          stationNo,
          machine,
          scannerRole: effectiveScannerRole,
        });
        return;
      }
      emitCustomerQrScannerResult({
        type: "WARNING",
        partId: "",
        customerQrCode: partId,
        stationNo,
        machine,
        scanner,
        scannerRole: effectiveScannerRole,
        scannerIp,
        decision: "WAIT",
        qrStatus: "WAIT",
        operationStatus: "WAITING",
        status: "WAITING",
        plcStatus: "WAITING_PLC",
        customerQrPending: true,
        reason: "START_QR_REQUIRED",
        message: `${stationNo}: customer QR read. Scan Part ID / Start QR first, then scan Customer QR again.`,
      });
      return;
    }

    const existingMapping = await PartCodeMapping.findOne({
      where: { customer_qr: partId, is_active: true },
      order: [["updatedAt", "DESC"]],
    });
    if (existingMapping && String(existingMapping.old_part_id || "").trim() === activePartId) {
      emitCustomerQrScannerResult({
        type: "WARNING",
        partId: activePartId,
        customerQrCode: partId,
        stationNo,
        machine,
        scanner,
        scannerRole: effectiveScannerRole,
        scannerIp,
        decision: "ALLOW",
        qrStatus: "DUPLICATE",
        operationStatus: "WAITING",
        status: "DUPLICATE",
        plcStatus: "WAITING_PLC",
        customerQrMapped: true,
        reason: "CUSTOMER_QR_ALREADY_MAPPED_SAME_PART",
        message: "Customer QR already mapped to this part. Continue to next station.",
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (existingMapping && String(existingMapping.old_part_id || "").trim() !== activePartId) {
      emitCustomerQrScannerResult({
        type: "ERROR",
        partId: activePartId,
        customerQrCode: partId,
        stationNo,
        machine,
        scanner,
        scannerRole: effectiveScannerRole,
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

    emitCustomerQrScannerResult({
      type: finalized.finalized ? "SUCCESS" : "INFO",
      partId: activePartId,
      customerQrCode: partId,
      stationNo,
      machine,
      scanner,
      scannerRole: effectiveScannerRole,
      scannerIp,
      decision: "ALLOW",
      qrStatus: "PASSED",
      operationStatus: finalized.operationStatus || "WAITING",
      status: finalized.finalized ? "ENDED_OK" : "SCANNED",
      plcStatus: finalized.finalized ? "ENDED_OK" : "WAITING_PLC",
      customerQrMapped: true,
      reason: "CUSTOMER_QR_MAPPED",
      message: finalized.finalized
        ? "Customer QR mapped successfully. Operation passed."
        : "Customer QR mapped successfully to active part.",
    });
    return;
  }

  const resolvedCode = await resolveMappedPartId(partId);
  const normalizedPartId = resolvedCode.resolvedPartId;
  const isMappedCustomerQrScan =
    Boolean(resolvedCode.customerQrCode) && resolvedCode.customerQrCode === partId;
  const isCustomerQrOnlyStart =
    !isMappedCustomerQrScan &&
    await canStartCustomerQrOnlyPart({ code: partId, stationNo, machine });

  if (!isMappedCustomerQrScan && !isCustomerQrOnlyStart && await shouldBlockUnknownQrAfterLaser({
    code: partId,
    stationNo,
  })) {
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
    return;
  }

  const scanPartId = isCustomerQrOnlyStart ? partId : normalizedPartId;
  const isCustomerQrOnlyTrace =
    isCustomerQrOnlyStart ||
    await isCustomerQrOnlyTracePart(scanPartId, resolvedCode.customerQrCode || (isCustomerQrOnlyStart ? scanPartId : ""));
  const response = await saveScan(scanPartId, stationNo, "OK", machine.id, null, {
    resultSource: isCustomerQrOnlyStart ? "CUSTOMER_QR_ONLY_START" : "TCP_PUSH_SCANNER",
    resultInput: "OK",
    skipQrFormatValidation: isMappedCustomerQrScan || isCustomerQrOnlyStart,
    skipShotValidation: isMappedCustomerQrScan || isCustomerQrOnlyTrace,
    skipCustomerCodeValidation: isMappedCustomerQrScan || isCustomerQrOnlyStart,
    skipSequenceValidation: isCustomerQrOnlyStart,
  });
  if (response?.decision === "ALLOW" && isCustomerQrOnlyStart) {
    await markCustomerQrOnlyMapping({ code: scanPartId, machine, stationNo });
    const finalized = await finalizeCustomerQrMappingIfEligible({
      partId: scanPartId,
      stationNo,
      machine,
    });
    if (finalized?.finalized) {
      response.operationStatus = "ENDED_OK";
      response.plcStatus = "ENDED_OK";
      response.status = "ENDED_OK";
      response.message = "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station.";
    }
  }

  emitRealtime("scan_event", {
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
    reason: isCustomerQrOnlyStart && response?.decision === "ALLOW" ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || null),
    status: response?.decision === "ALLOW" ? "SCANNED" : "BLOCKED",
    qrStatus: response?.qrStatus || (response?.decision === "ALLOW" ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (response?.decision === "ALLOW" ? "WAITING" : "BLOCKED"),
    message: isCustomerQrOnlyStart && response?.decision === "ALLOW"
      ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
      : (response?.message || ""),
    timestamp: new Date().toISOString(),
  });

  console.log(
    `[TCP] Scan decision scanner=${scanner.id} role=${scannerRole} machine=${machine.id} station=${stationNo} payload=${partId} decision=${response?.decision || "BLOCK"} reason=${response?.reason || "NA"}`
  );
  emitRealtime("operator_popup", {
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
    operationStatus: response?.operationStatus || (response?.decision === "ALLOW" ? "WAITING" : "BLOCKED"),
    status: response?.decision === "ALLOW" ? "SCANNED" : "BLOCKED",
    plcStatus: response?.decision === "ALLOW" ? "WAITING_PLC" : "BLOCKED",
    reason: isCustomerQrOnlyStart && response?.decision === "ALLOW" ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || null),
    message: isCustomerQrOnlyStart && response?.decision === "ALLOW"
      ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
      : (response?.message || ""),
    timestamp: new Date().toISOString(),
  });
}

async function processCustomerQrOnlyStart({ scanner, scannerIp, partId, stationNo, machine, scannerRole }) {
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
      response.operationStatus = "ENDED_OK";
      response.plcStatus = "ENDED_OK";
      response.status = "ENDED_OK";
      response.message = "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station.";
    }
  }
  const allowed = response?.decision === "ALLOW";
  const message = allowed
    ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
    : (response?.message || "Customer QR start blocked.");
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
    decision: response?.decision || "BLOCK",
    reason: allowed ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || null),
    status: allowed ? "SCANNED" : "BLOCKED",
    qrStatus: response?.qrStatus || (allowed ? "PASSED" : "FAILED"),
    operationStatus: response?.operationStatus || (allowed ? "WAITING" : "BLOCKED"),
    message,
    timestamp: new Date().toISOString(),
  });
  emitRealtime("operator_popup", {
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
      }, TCP_SCANNER_FLUSH_MS);
    };

    socket.on("data", (buffer) => {
      const chunk = buffer.toString("utf8");
      console.log(`[TCP] Raw chunk from ${remoteIp}: ${JSON.stringify(chunk)}`);

      if (!/[\r\n\0]/.test(chunk)) {
        const cleanChunk = sanitizeScannerPayload(chunk);
        const cleanPending = sanitizeScannerPayload(pending);
        if (cleanPending && cleanChunk && cleanChunk.length >= 4) {
          consumeMessage(cleanPending);
          pending = "";
        }
      }

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

