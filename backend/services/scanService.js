const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const Machine = require("../models/Machine");
const QrFormatRule = require("../models/QrFormatRule");
const { emitRealtime } = require("./realtimeService");
const { testQrPattern } = require("../utils/qrRegex");
const RECENT_DUPLICATE_GRACE_MS = Math.max(Number(process.env.RECENT_DUPLICATE_GRACE_MS || 1500), 0);
const SCAN_INFLIGHT_GUARD_MS = Math.max(Number(process.env.SCAN_INFLIGHT_GUARD_MS || 8000), 1000);
const scanInflightKeys = new Map();

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

function normalizeQualityPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    if (raw === undefined) continue;
    out[normalizedKey] = raw;
  }
  if (Object.keys(out).length === 0) {
    return null;
  }
  try {
    const serialized = JSON.stringify(out);
    return serialized.length > 4000 ? serialized.slice(0, 4000) : serialized;
  } catch (_error) {
    return null;
  }
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

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function makeScanInflightKey(partId, station, machineId) {
  return `${String(partId || "").trim().toUpperCase()}|${String(station || "").trim().toUpperCase()}|${Number(machineId) || 0}`;
}

function beginScanInflight(key) {
  const now = Date.now();
  const existing = scanInflightKeys.get(key);
  if (existing && now - existing.startedAtMs <= SCAN_INFLIGHT_GUARD_MS) {
    return false;
  }
  scanInflightKeys.set(key, { startedAtMs: now });
  return true;
}

function endScanInflight(key) {
  scanInflightKeys.delete(key);
}

exports.saveScan = async (partId, stationNo, result, machineId = 0, userId = null, options = {}) => {
  const now = new Date();
  const normalizedPartId = String(partId || "").trim();
  const station = normalizeStation(stationNo);
  const normalizedResult = normalizeResult(result);
  const resultSource = normalizeResultSource(options?.resultSource);
  const resultInput = normalizeResultInput(options?.resultInput ?? result);
  const qualityPayload = normalizeQualityPayload(options?.qualityPayload);
  const forcedNgReason = String(options?.ngReason || "SCAN_RESULT_NG")
    .trim()
    .toUpperCase();
  const skipInterlockValidation = options?.skipInterlockValidation === true;
  const skipDuplicateValidation = options?.skipDuplicateValidation === true;
  const skipSequenceValidation = options?.skipSequenceValidation === true;
  const mId = Number(machineId) || 0;
  const scanInflightKey = makeScanInflightKey(normalizedPartId, station, mId);
  const scanStartAllowed = beginScanInflight(scanInflightKey);

  if (!normalizedPartId || !station) {
    return {
      decision: "BLOCK",
      reason: "INVALID_INPUT",
      message: "partId and stationNo are required",
      currentStatus: "UNKNOWN",
    };
  }

  if (!scanStartAllowed) {
    const blockedLog = await OperationLog.create({
      part_id: normalizedPartId,
      machine_id: mId || null,
      operation_no: station,
      station_no: station,
      plc_status: "INTERLOCKED",
      result: "NG",
      result_source: "AUDIT_BLOCK",
      result_input: "BLOCK",
      user_id: userId,
      interlock_reason: "DUPLICATE_SCAN_IN_FLIGHT",
    }).catch(() => null);
    emitRealtime("scan_event", {
      type: "WARNING",
      partId: normalizedPartId,
      stationNo: station,
      machineId: mId || null,
      decision: "BLOCK",
      reason: "DUPLICATE_SCAN_IN_FLIGHT",
      message: "Scan already in progress for this part/station",
      operationLogId: blockedLog?.id || null,
    });
    return {
      decision: "BLOCK",
      reason: "DUPLICATE_SCAN_IN_FLIGHT",
      message: "Scan already in progress. Wait for current cycle processing.",
      currentStatus: "IN_PROGRESS",
      operationLogId: blockedLog?.id || null,
    };
  }

  try {
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
          return {
            decision: "BLOCK",
            reason: "QR_RULE_CONFIG_ERROR",
            message: `QR rule invalid for station ${station}: ${getRuleLabel(rule)}`,
            currentStatus: "REJECTED_QR_RULE",
          };
        }
      }

      if (!matchedRule) {
        const expectedFormats = applicableRules.slice(0, 5).map((rule) => getRuleLabel(rule)).join(", ");
        await saveAuditLog(normalizedPartId, mId, "NG", "INVALID_QR_FORMAT", userId);
        return {
          decision: "BLOCK",
          reason: "INVALID_QR_FORMAT",
          message: expectedFormats ? `QR format mismatch. Allowed: ${expectedFormats}` : "QR format mismatch.",
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
      return { decision: "BLOCK", reason: "ALREADY_COMPLETED", message: `${normalizedPartId} already completed`, currentStatus: part.status };
    }

    const isInterlockRecovery = (part.status === "INTERLOCKED" || part.is_interlocked) && 
                                (part.current_operation === station || part.current_station === station);

    if (!skipInterlockValidation && (part.is_interlocked || part.status === "INTERLOCKED") && !isInterlockRecovery) {
      if (part.status === "NG" || part.status === "ENDED_NG" || part.interlock_reason === "SCAN_RESULT_NG" || part.interlock_reason === "GLOBAL_REJECTION") {
        return { decision: "ALLOW", reason: "GLOBAL_REJECTION", message: "Part is globally NG. Rejection flow.", currentStatus: part.status, forceNg: true };
      }
      await saveAuditLog(normalizedPartId, mId, "NG", part.interlock_reason || "PART_INTERLOCKED", userId);
      return { decision: "BLOCK", reason: part.interlock_reason || "PART_INTERLOCKED", message: `${normalizedPartId} is interlocked`, currentStatus: part.status };
    }

    const existingAtStation = await OperationLog.findOne({
      where: { part_id: normalizedPartId, station_no: station },
      order: [["createdAt", "DESC"]],
    });
    
    const isRetryableCommFailure = String(existingAtStation?.plc_status || "") === "RESET";

    if (!skipDuplicateValidation && existingAtStation && String(existingAtStation.plc_status || "").toUpperCase() === "PLC_COMM_ERROR") {
      return { decision: "BLOCK", reason: "RESET_REQUIRED_AFTER_PLC_COMM_ERROR", message: `PLC timeout at ${station}. Use Reset Operation.`, currentStatus: part.status };
    }

    if (!skipDuplicateValidation && existingAtStation && !part.is_rework && !isRetryableCommFailure && !isInterlockRecovery) {
      const existingStatus = toUpper(existingAtStation.plc_status);
      const createdAtMs = existingAtStation.createdAt ? new Date(existingAtStation.createdAt).getTime() : NaN;
      const ageMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : Number.POSITIVE_INFINITY;
      const canTreatAsIdempotent = RECENT_DUPLICATE_GRACE_MS > 0 && ageMs >= 0 && ageMs <= RECENT_DUPLICATE_GRACE_MS && (existingStatus === "PENDING" || existingStatus === "STARTED" || existingStatus === "ENDED_OK");

      if (canTreatAsIdempotent) {
        return { decision: "ALLOW", reason: "RECENT_DUPLICATE_IGNORED", message: "Duplicate scan ignored; using recent result.", currentStatus: part.status, operationStatus: existingStatus || "PENDING", stationNo: station };
      }

      await saveAuditLog(normalizedPartId, mId, "NG", "DUPLICATE_SCAN", userId);
      const blockedLog = await OperationLog.create({
        part_id: normalizedPartId,
        machine_id: mId || null,
        operation_no: station,
        station_no: station,
        plc_status: "INTERLOCKED",
        result: "NG",
        result_source: "AUDIT_BLOCK",
        result_input: "BLOCK",
        user_id: userId,
        interlock_reason: "DUPLICATE_SCAN",
      });
      return {
        decision: "BLOCK",
        reason: "DUPLICATE_SCAN",
        message: `Duplicate scan at ${station}`,
        currentStatus: part.status,
        operationLogId: blockedLog.id,
      };
    }

    if (isInterlockRecovery && existingAtStation && existingAtStation.plc_status !== "PENDING") {
      await existingAtStation.update({ plc_status: "RETRY", interlock_reason: "INTERLOCK_RECOVERY_SCAN" });
    }

    const sequence = await getActiveStations();
    if (!sequence.includes(station)) {
      await saveAuditLog(normalizedPartId, mId, "NG", "STATION_NOT_CONFIGURED", userId);
      return { decision: "BLOCK", reason: "STATION_NOT_CONFIGURED", message: `Station ${station} not configured`, currentStatus: part.status };
    }

    const expectedStation = getExpectedStation(part, sequence);
    const previousStation = expectedStation && sequence.includes(expectedStation) ? sequence[Math.max(sequence.indexOf(expectedStation) - 1, 0)] || null : null;

    if (!skipSequenceValidation && previousStation && station === expectedStation && sequence.indexOf(station) > 0) {
      const previousLog = await OperationLog.findOne({ where: { part_id: normalizedPartId, station_no: normalizeStation(previousStation) }, order: [["createdAt", "DESC"]] });
      const prevStatus = toUpper(previousLog?.plc_status);
      if (prevStatus !== "ENDED_OK" && prevStatus !== "ENDED_NG") {
        await saveAuditLog(normalizedPartId, mId, "NG", "PREVIOUS_STATION_NOT_COMPLETED", userId);
        const blockedLog = await OperationLog.create({
          part_id: normalizedPartId,
          machine_id: mId || null,
          operation_no: station,
          station_no: station,
          plc_status: "INTERLOCKED",
          result: "NG",
          result_source: "AUDIT_BLOCK",
          result_input: "BLOCK",
          user_id: userId,
          interlock_reason: "PREVIOUS_STATION_NOT_COMPLETED",
        });
        return {
          decision: "BLOCK",
          reason: "PREVIOUS_STATION_NOT_COMPLETED",
          message: `Previous station ${previousStation} not completed`,
          expectedStation,
          currentStatus: part.status,
          operationLogId: blockedLog.id,
        };
      }
    }

    if (!skipSequenceValidation && expectedStation && station !== expectedStation) {
      await saveAuditLog(normalizedPartId, mId, "NG", "PREVIOUS_STATION_NOT_COMPLETED", userId);
      const blockedLog = await OperationLog.create({
        part_id: normalizedPartId,
        machine_id: mId || null,
        operation_no: station,
        station_no: station,
        plc_status: "INTERLOCKED",
        result: "NG",
        result_source: "AUDIT_BLOCK",
        result_input: "BLOCK",
        user_id: userId,
        interlock_reason: "PREVIOUS_STATION_NOT_COMPLETED",
      });
      return {
        decision: "BLOCK",
        reason: "PREVIOUS_STATION_NOT_COMPLETED",
        message: `Seq violation. Expected ${expectedStation}`,
        expectedStation,
        currentStatus: part.status,
        operationLogId: blockedLog.id,
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
      return { decision: "BLOCK", reason: forcedNgReason, message: "Operation Failed (NG)", expectedStation, currentStatus: part.status, operationLogId: ngLog.id, resultSource };
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

    return {
      decision: "ALLOW",
      reason: "PASS",
      message: "QR verified. Starting operation",
      expectedStation,
      currentStatus: part.status,
      operationLogId: log.id,
      stationNo: station,
      plcCommand: "START_OPERATION",
      resultSource,
    };
  } catch (err) {
    const isUniqueConstraint = err.name === 'SequelizeUniqueConstraintError';
    console.error(`[ScanService] ${isUniqueConstraint ? 'DB CONFLICT' : 'DB ERROR'}:`, err.message);
    
    return {
      decision: "BLOCK",
      reason: isUniqueConstraint ? "ALREADY_SCANNED" : "VALIDATION_ERROR",
      message: isUniqueConstraint 
        ? "This part was already scanned here. Please check the process sequence or reset if required."
        : "Process validation failed. Please check connectivity and try again.",
      currentStatus: "ERROR",
    };
  } finally {
    endScanInflight(scanInflightKey);
  }
};
