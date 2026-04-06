const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const Machine = require("../models/Machine");
const QrFormatRule = require("../models/QrFormatRule");
const { emitRealtime } = require("./realtimeService");
const { testQrPattern } = require("../utils/qrRegex");

function normalizeResult(result) {
  return String(result || "OK").trim().toUpperCase() === "OK" ? "OK" : "NG";
}

function normalizeStation(stationNo) {
  return String(stationNo || "")
    .trim()
    .toUpperCase();
}

function normalizeResultSource(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
}

function normalizeResultInput(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
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

async function getActiveQrRules() {
  return QrFormatRule.findAll({
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

function getStationScopeSet(rule) {
  const raw = String(rule?.station_scope || "").trim();
  if (!raw) {
    return null;
  }
  const list = raw
    .split(/\r?\n|[,;|]/)
    .map((entry) => normalizeStation(entry))
    .filter(Boolean);
  if (list.length === 0) {
    return null;
  }
  return new Set(list);
}

function isRuleApplicableToStation(rule, station) {
  const scopeSet = getStationScopeSet(rule);
  if (!scopeSet) {
    return true;
  }
  return scopeSet.has(normalizeStation(station));
}

function getRuleLabel(rule) {
  return rule?.format_name || rule?.model_code || `RULE_${rule?.id || "UNKNOWN"}`;
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

exports.saveScan = async (partId, stationNo, result, machineId = 0, userId = null, options = {}) => {
  const now = new Date();
  const normalizedPartId = String(partId || "").trim();
  const station = normalizeStation(stationNo);
  const normalizedResult = normalizeResult(result);
  const resultSource = normalizeResultSource(options?.resultSource);
  const resultInput = normalizeResultInput(options?.resultInput ?? result);
  const forcedNgReason = String(options?.ngReason || "SCAN_RESULT_NG")
    .trim()
    .toUpperCase();
  const skipInterlockValidation = options?.skipInterlockValidation === true;
  const skipDuplicateValidation = options?.skipDuplicateValidation === true;
  const skipSequenceValidation = options?.skipSequenceValidation === true;
  const mId = Number(machineId) || 0;

  if (!normalizedPartId || !station) {
    return {
      decision: "BLOCK",
      reason: "INVALID_INPUT",
      message: "partId and stationNo are required",
      currentStatus: "UNKNOWN",
    };
  }

  const activeRules = await getActiveQrRules();
  const applicableRules = activeRules.filter((rule) => isRuleApplicableToStation(rule, station));
  let matchedRule = null;
  if (applicableRules.length > 0) {
    for (const rule of applicableRules) {
      try {
        if (testQrPattern(rule.regex_pattern, normalizedPartId)) {
          matchedRule = rule;
          break;
        }
      } catch (_error) {
        await saveAuditLog(normalizedPartId, mId, "NG", "QR_RULE_CONFIG_ERROR", userId);
        emitRealtime("scan_event", {
          type: "ERROR",
          partId: normalizedPartId,
          stationNo: station,
          machineId: mId || null,
          decision: "BLOCK",
          reason: "QR_RULE_CONFIG_ERROR",
          message: `QR rule invalid: ${getRuleLabel(rule)}`,
        });
        return {
          decision: "BLOCK",
          reason: "QR_RULE_CONFIG_ERROR",
          message: `QR rule invalid for station ${station}: ${getRuleLabel(rule)}. Contact supervisor/admin.`,
          currentStatus: "REJECTED_QR_RULE",
        };
      }
    }

    if (!matchedRule) {
      const expectedFormats = applicableRules
        .slice(0, 5)
        .map((rule) => getRuleLabel(rule))
        .join(", ");
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
        message: expectedFormats
          ? `QR format mismatch. Allowed model/rules: ${expectedFormats}`
          : "QR format mismatch.",
        currentStatus: "REJECTED_QR_FORMAT",
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

  if (matchedRule) {
    const formatName = matchedRule.format_name || matchedRule.model_code || "ACTIVE_RULE";
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

  // Check if we are at the same station where the part was interlocked
  const isInterlockRecovery = (part.status === "INTERLOCKED" || part.is_interlocked) && 
                              (part.current_operation === station || part.current_station === station);

  if (!skipInterlockValidation && (part.is_interlocked || part.status === "INTERLOCKED") && !isInterlockRecovery) {
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
  
  const isRetryableCommFailure = String(existingAtStation?.plc_status || "") === "RESET";

  if (
    !skipDuplicateValidation &&
    existingAtStation &&
    String(existingAtStation.plc_status || "").toUpperCase() === "PLC_COMM_ERROR"
  ) {
    emitRealtime("scan_event", {
      type: "WARNING",
      code: "RESET_REQUIRED_AFTER_PLC_COMM_ERROR",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: "RESET_REQUIRED_AFTER_PLC_COMM_ERROR",
      message: `Previous PLC cycle timed out at ${station}. Use Reset Operation, then scan again.`,
    });
    return {
      decision: "BLOCK",
      reason: "RESET_REQUIRED_AFTER_PLC_COMM_ERROR",
      message: `Previous PLC cycle timed out at ${station}. Use Reset Operation, then scan again.`,
      currentStatus: part.status,
    };
  }

  if (
    !skipDuplicateValidation &&
    existingAtStation &&
    !part.is_rework &&
    !isRetryableCommFailure &&
    !isInterlockRecovery
  ) {
    await saveAuditLog(normalizedPartId, mId, "NG", "DUPLICATE_SCAN", userId);
    emitRealtime("scan_event", {
      type: "WARNING",
      code: "DUPLICATE_SCAN",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: "DUPLICATE_SCAN",
      message: `Duplicate scan at station ${station}. Part is currently ${part.status}.`,
    });
    return {
      decision: "BLOCK",
      reason: "DUPLICATE_SCAN",
      message: `Duplicate scan at station ${station}`,
      currentStatus: part.status,
    };
  }

  if (isInterlockRecovery) {
    // Reset the previous log entry to allow a clean retry
    if (existingAtStation && existingAtStation.plc_status !== "PENDING") {
      await existingAtStation.update({ plc_status: "RETRY", interlock_reason: "INTERLOCK_RECOVERY_SCAN" });
    }
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
  if (!skipSequenceValidation && expectedStation && station !== expectedStation) {
    const errorDetail = {
      level: "ERROR",
      code: "SEQ_VIOLATION",
      partId: normalizedPartId,
      expectedStation,
      actualStation: station,
      lastCompletedStation: part.current_station || "START",
      timestamp: new Date().toISOString()
    };
    console.error(`[TRACEABILITY] Sequence Violation:`, errorDetail);

    await saveAuditLog(normalizedPartId, mId, "NG", "PREVIOUS_STATION_NOT_COMPLETED", userId);
    emitRealtime("scan_event", {
      type: "ERROR",
      code: "SEQ_VIOLATION",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: "PREVIOUS_STATION_NOT_COMPLETED",
      expectedStation,
      message: `Sequence violation. Expected ${expectedStation}, got ${station}.`,
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
      result_source: resultSource,
      result_input: resultInput,
      user_id: userId,
      interlock_reason: forcedNgReason,
    });

    part.status = "NG";
    part.is_interlocked = true;
    part.interlock_reason = forcedNgReason;
    await part.save();
    await saveAuditLog(normalizedPartId, mId, "NG", forcedNgReason, userId);

    emitRealtime("scan_event", {
      type: "ERROR",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: forcedNgReason,
      message: "Operation Failed (NG)",
      operationLogId: ngLog.id,
    });

    return {
      decision: "BLOCK",
      reason: forcedNgReason,
      message: "Scan result NG",
      expectedStation,
      currentStatus: part.status,
      operationLogId: ngLog.id,
      resultSource,
    };
  }

  const log = await OperationLog.create({
    part_id: normalizedPartId,
    machine_id: mId || null,
    operation_no: station,
    station_no: station,
    plc_status: "PENDING",
    result: "OK",
    result_source: resultSource,
    result_input: resultInput,
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
    qrRule: matchedRule
      ? {
          id: matchedRule.id,
          formatName: matchedRule.format_name || null,
          modelCode: matchedRule.model_code || null,
          stationScope: matchedRule.station_scope || null,
          sampleValue: matchedRule.sample_value || null,
        }
      : null,
    resultSource,
  };
};
