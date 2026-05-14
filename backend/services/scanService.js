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
  if (!sequence.length) return null;
  if (!part.current_operation) return sequence[0];

  const currentOp = normalizeStation(part.current_operation);
  const currentIndex = sequence.indexOf(currentOp);

  if (currentIndex === -1) return sequence[0];
  if (currentIndex >= sequence.length - 1) return null; // Already at the end

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
    return {
      decision: "BLOCK",
      reason: "DUPLICATE_SCAN_IN_FLIGHT",
      message: "Scan already in progress. Wait for current cycle processing.",
      currentStatus: "IN_PROGRESS",
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
        return {
          decision: "BLOCK",
          reason: "INVALID_QR_FORMAT",
          validationResult: "FAILED",
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
        current_operation: null,
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

    const sequence = await getActiveStations();
    if (!sequence.includes(station)) {
      return {
        decision: "BLOCK",
        reason: "STATION_NOT_CONFIGURED",
        message: `BLOCKED\nStation Not Found\n\nStation: ${station}\nPlease check configuration.`,
        currentStatus: part.status
      };
    }

    // 1. INDUSTRIAL SEQUENCE VALIDATION
    const expectedStation = getExpectedStation(part, sequence);
    const hasExistingSuccess = await OperationLog.findOne({
      where: { 
        part_id: normalizedPartId, 
        station_no: station,
        plc_status: ["ENDED_OK", "PASSED", "COMPLETED_OK"] 
      }
    });

    const scanAttemptType = hasExistingSuccess ? "RE-SCAN" : "INITIAL";

    if (!skipSequenceValidation && expectedStation && station !== expectedStation) {
      const scannedIndex = sequence.indexOf(station);
      const expectedIndex = sequence.indexOf(expectedStation);

      if (scannedIndex > expectedIndex) {
        const blockedLog = await OperationLog.create({
          part_id: normalizedPartId,
          machine_id: mId || null,
          operation_no: station,
          station_no: station,
          plc_status: "INTERLOCKED",
          result: "BLOCK",
          scan_attempt_type: scanAttemptType,
          validation_result: "BLOCKED",
          operation_result: "INTERLOCKED",
          user_id: userId,
          interlock_reason: "PREVIOUS_STATION_NOT_COMPLETED",
        });
        
        part.last_validation_result = "BLOCKED";
        await part.save();

        return {
          decision: "BLOCK",
          reason: "PREVIOUS_STATION_NOT_COMPLETED",
          qrStatus: "BLOCKED",
          operationStatus: "INTERLOCKED",
          message: `BLOCKED - Sequence Error\nPlease scan at ${expectedStation} first.\n(Skipped operation detected)`,
          expectedStation,
          currentStatus: part.status,
          operationLogId: blockedLog.id,
        };
      }
    }

    // 2. DUPLICATE VALIDATION
    if (part.status === "COMPLETED" && !part.is_rework) {
       part.last_validation_result = "DUPLICATE";
       await part.save();
       return {
        decision: "BLOCK",
        reason: "ALREADY_COMPLETED",
        qrStatus: "DUPLICATE",
        operationStatus: "PASSED",
        message: `BLOCKED - Already Done\nThis part is already finished.\n\nPart: ${normalizedPartId}`,
        currentStatus: part.status
      };
    }

    if (!skipDuplicateValidation && hasExistingSuccess && !part.is_rework) {
      const blockedLog = await OperationLog.create({
        part_id: normalizedPartId,
        machine_id: mId || null,
        operation_no: station,
        station_no: station,
        plc_status: "INTERLOCKED",
        result: "BLOCK",
        scan_attempt_type: "RE-SCAN",
        validation_result: "DUPLICATE",
        operation_result: "PASSED", // Show that previous was PASS
        user_id: userId,
        interlock_reason: "DUPLICATE_SCAN",
      });
      
      part.last_validation_result = "DUPLICATE";
      await part.save();

      return {
        decision: "BLOCK",
        reason: "DUPLICATE_SCAN",
        qrStatus: "DUPLICATE",
        operationStatus: "PASSED",
        message: `BLOCKED - Duplicate Scan\nOperation ${station} already completed previously.`,
        currentStatus: part.status,
        operationLogId: blockedLog.id,
      };
    }

    // 3. INTERLOCK / NG VALIDATION
    if (!skipInterlockValidation && (part.is_interlocked || part.status === "INTERLOCKED")) {
      if (["NG", "ENDED_NG", "FAILED"].includes(part.status) || part.interlock_reason === "SCAN_RESULT_NG") {
        return {
          decision: "ALLOW",
          reason: "GLOBAL_REJECTION",
          qrStatus: "PASSED",
          operationStatus: "FAILED",
          message: "BLOCKED - Quality Alert\nPart marked as NG/Rejected.\nMove to rejection area.",
          currentStatus: part.status,
          forceNg: true
        };
      }
    }

    if (normalizedResult === "NG") {
      const ngLog = await OperationLog.create({
        part_id: normalizedPartId,
        machine_id: mId || null,
        operation_no: station,
        station_no: station,
        plc_status: "ENDED_NG",
        result: "NG",
        scan_attempt_type: scanAttemptType,
        validation_result: "PASSED",
        operation_result: "FAILED",
        user_id: userId,
        interlock_reason: forcedNgReason,
      });
      part.status = "NG";
      part.is_interlocked = true;
      part.interlock_reason = forcedNgReason;
      part.last_validation_result = "PASSED";
      await part.save();
      return {
        decision: "BLOCK",
        reason: forcedNgReason,
        qrStatus: "PASSED",
        operationStatus: "FAILED",
        message: "FAILED\nScan Result NG\n\nOperation rejected.",
        expectedStation,
        currentStatus: part.status,
        operationLogId: ngLog.id
      };
    }

    // 4. FINAL ALLOWANCE
    const log = await OperationLog.create({
      part_id: normalizedPartId,
      machine_id: mId || null,
      operation_no: station,
      station_no: station,
      plc_status: "PENDING",
      result: "OK",
      scan_attempt_type: scanAttemptType,
      validation_result: "PASSED",
      operation_result: "WAITING",
      user_id: userId,
      interlock_reason: null,
    });

    part.current_operation = station;
    part.status = part.status === "REWORK" ? "REWORK" : "IN_PROGRESS";
    part.last_validation_result = "PASSED";
    await part.save();

    return {
      decision: "ALLOW",
      reason: "PASS",
      qrStatus: "PASSED",
      operationStatus: "WAITING",
      message: `SCAN OK - Starting ${station}`,
      expectedStation,
      currentStatus: part.status,
      operationLogId: log.id,
      stationNo: station,
      plcCommand: "START_OPERATION",
      resultSource,
    };
  } catch (err) {
    console.error(`[SCAN_VALIDATION_ERROR] partId=${normalizedPartId} station=${station}:`, err);
    const isUniqueConstraint = err.name === 'SequelizeUniqueConstraintError';
    return {
      decision: "BLOCK",
      reason: isUniqueConstraint ? "ALREADY_SCANNED" : "VALIDATION_ERROR",
      qrStatus: "FAILED",
      operationStatus: "IDLE",
      message: `Process validation failed. ${err.message || "Please check connectivity and try again."}`,
      currentStatus: "ERROR",
    };
  } finally {
    endScanInflight(scanInflightKey);
  }
};
