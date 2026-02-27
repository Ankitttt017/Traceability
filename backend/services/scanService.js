const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const Machine = require("../models/Machine");
const QrFormatRule = require("../models/QrFormatRule");
const { emitRealtime } = require("./realtimeService");

function normalizeResult(result) {
  return String(result || "OK").trim().toUpperCase() === "OK" ? "OK" : "NG";
}

function normalizeStation(stationNo) {
  return String(stationNo || "")
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

async function getActiveQrRule() {
  return QrFormatRule.findOne({
    where: { is_active: true },
    order: [["updatedAt", "DESC"]],
  });
}

async function getActiveStations() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    order: [["sequence_no", "ASC"]],
  });
  return uniqueStages(machines.map((machine) => getMachineOperationStage(machine)));
}

async function saveAuditLog(partId, machineId, status, reason, userId = null) {
  const parsedMachineId = Number(machineId);
  await ProductionLog.create({
    part_id: partId,
    machine_id: Number.isNaN(parsedMachineId) ? 0 : parsedMachineId,
    user_id: userId,
    status,
    ng_reason: reason || null,
  });
}

async function setPartInterlock(part, reason) {
  part.status = "INTERLOCKED";
  part.is_interlocked = true;
  part.interlock_reason = reason;
  await part.save();
}

function getExpectedStation(part, sequence) {
  if (!sequence.length) {
    return null;
  }

  if (!part.current_station) {
    return sequence[0];
  }

  const currentIndex = sequence.findIndex((station) => station === normalizeStation(part.current_station));
  if (currentIndex === -1) {
    return sequence[0];
  }
  if (currentIndex >= sequence.length - 1) {
    return sequence[sequence.length - 1];
  }
  return sequence[currentIndex + 1];
}

exports.saveScan = async (partId, stationNo, result, machineId = 0, userId = null) => {
  const now = new Date();
  const normalizedPartId = String(partId || "").trim();
  const station = normalizeStation(stationNo);
  const normalizedResult = normalizeResult(result);
  const mId = Number(machineId) || 0;

  if (!normalizedPartId || !station) {
    return {
      decision: "BLOCK",
      reason: "INVALID_INPUT",
      message: "partId and stationNo are required",
      currentStatus: "UNKNOWN",
    };
  }

  const activeRule = await getActiveQrRule();
  if (activeRule) {
    const regex = new RegExp(activeRule.regex_pattern);
    if (!regex.test(normalizedPartId)) {
      await saveAuditLog(normalizedPartId, mId, "NG", "INVALID_QR_FORMAT", userId);
      emitRealtime("scan_event", {
        type: "WARNING",
        partId: normalizedPartId,
        stationNo: station,
        machineId: mId || null,
        decision: "BLOCK",
        reason: "INVALID_QR_FORMAT",
        message: "QR format mismatch",
      });
      return {
        decision: "BLOCK",
        reason: "INVALID_QR_FORMAT",
        message: `QR format mismatch. Required format: ${activeRule.format_name || "ACTIVE_RULE"}`,
        currentStatus: "REJECTED_QR_FORMAT",
        qrRule: {
          formatName: activeRule.format_name || "ACTIVE_RULE",
          sampleValue: activeRule.sample_value,
        },
      };
    }
  }

  let part = await Part.findOne({ where: { part_id: normalizedPartId } });
  if (!part) {
    part = await Part.create({
      part_id: normalizedPartId,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      current_operation: station,
      current_station: null,
      status: "IN_PROGRESS",
    });
  }

  if (activeRule) {
    const formatName = activeRule.format_name || "ACTIVE_RULE";
    if (part.qr_format_name !== formatName) {
      part.qr_format_name = formatName;
      await part.save();
    }
  }

  if (part.status === "COMPLETED") {
    await saveAuditLog(normalizedPartId, mId, "NG", "ALREADY_COMPLETED", userId);
    emitRealtime("scan_event", {
      type: "WARNING",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: "ALREADY_COMPLETED",
      message: "Part already completed",
    });
    return {
      decision: "BLOCK",
      reason: "ALREADY_COMPLETED",
      message: `${normalizedPartId} already completed`,
      currentStatus: part.status,
    };
  }

  if (part.is_interlocked || part.status === "INTERLOCKED") {
    await saveAuditLog(normalizedPartId, mId, "NG", part.interlock_reason || "PART_INTERLOCKED", userId);
    emitRealtime("scan_event", {
      type: "WARNING",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: part.interlock_reason || "PART_INTERLOCKED",
      message: "Part is interlocked",
    });
    return {
      decision: "BLOCK",
      reason: part.interlock_reason || "PART_INTERLOCKED",
      message: `${normalizedPartId} is interlocked`,
      currentStatus: part.status,
    };
  }

  const existingAtStation = await OperationLog.findOne({
    where: { part_id: normalizedPartId, station_no: station },
    order: [["createdAt", "DESC"]],
  });
  // Production rule: once scanned at a station, next scan must be blocked as duplicate
  // unless operator/admin explicitly performs reset-operation.
  const isRetryableCommFailure = String(existingAtStation?.plc_status || "") === "RESET";
  if (existingAtStation && !part.is_rework && !isRetryableCommFailure) {
    await saveAuditLog(normalizedPartId, mId, "NG", "DUPLICATE_SCAN", userId);
    emitRealtime("scan_event", {
      type: "WARNING",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: "DUPLICATE_SCAN",
      message: "Duplicate scan",
    });
    return {
      decision: "BLOCK",
      reason: "DUPLICATE_SCAN",
      message: `Duplicate scan at station ${station}`,
      currentStatus: part.status,
    };
  }

  const sequence = await getActiveStations();
  if (!sequence.includes(station)) {
    await saveAuditLog(normalizedPartId, mId, "NG", "STATION_NOT_CONFIGURED", userId);
    emitRealtime("scan_event", {
      type: "WARNING",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: "STATION_NOT_CONFIGURED",
      message: `Station ${station} not configured`,
    });
    return {
      decision: "BLOCK",
      reason: "STATION_NOT_CONFIGURED",
      message: `Station ${station} not configured`,
      currentStatus: part.status,
    };
  }

  const expectedStation = getExpectedStation(part, sequence);
  if (expectedStation && station !== expectedStation) {
    await saveAuditLog(normalizedPartId, mId, "NG", "PREVIOUS_STATION_NOT_COMPLETED", userId);
    emitRealtime("scan_event", {
      type: "WARNING",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: "PREVIOUS_STATION_NOT_COMPLETED",
      expectedStation,
      message: "Previous station not completed",
    });
    return {
      decision: "BLOCK",
      reason: "PREVIOUS_STATION_NOT_COMPLETED",
      message: `Previous station not completed. Expected ${expectedStation}`,
      expectedStation,
      currentStatus: part.status,
    };
  }

  if (normalizedResult === "NG") {
    const ngLog = await OperationLog.create({
      part_id: normalizedPartId,
      machine_id: mId || null,
      operation_no: station,
      station_no: station,
      plc_status: "ENDED_NG",
      plc_end_time: new Date(),
      plc_end_at: new Date(),
      result: "NG",
      user_id: userId,
      interlock_reason: "SCAN_RESULT_NG",
    });

    part.status = "NG";
    part.is_interlocked = true;
    part.interlock_reason = "SCAN_RESULT_NG";
    await part.save();
    await saveAuditLog(normalizedPartId, mId, "NG", "SCAN_RESULT_NG", userId);

    emitRealtime("scan_event", {
      type: "ERROR",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: "SCAN_RESULT_NG",
      message: "Operation Failed (NG)",
      operationLogId: ngLog.id,
    });

    return {
      decision: "BLOCK",
      reason: "SCAN_RESULT_NG",
      message: "Scan result NG",
      expectedStation,
      currentStatus: part.status,
      operationLogId: ngLog.id,
    };
  }

  const log = await OperationLog.create({
    part_id: normalizedPartId,
    machine_id: mId || null,
    operation_no: station,
    station_no: station,
    plc_status: "PENDING",
    result: "OK",
    user_id: userId,
    interlock_reason: null,
  });

  part.current_operation = station;
  part.status = part.status === "REWORK" ? "REWORK" : "IN_PROGRESS";
  await part.save();

  emitRealtime("scan_event", {
    type: "INFO",
    partId: normalizedPartId,
    stationNo: station,
    machineId: mId || null,
    decision: "ALLOW",
    reason: "QR_VALIDATED",
    message: "QR verified, waiting PLC ACK",
    operationLogId: log.id,
  });

  return {
    decision: "ALLOW",
    reason: "PASS",
    message: "QR verified. Starting operation",
    expectedStation,
    currentStatus: part.status,
    operationLogId: log.id,
    stationNo: station,
    plcCommand: "START_OPERATION",
  };
};
