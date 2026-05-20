const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const Machine = require("../models/Machine");
const QrFormatRule = require("../models/QrFormatRule");
const { emitRealtime } = require("./realtimeService");
const { testQrPattern } = require("../utils/qrRegex");
const { getStationFeatureConfig } = require("./stationFeatureService");
const sequelize = require("../config/db");
const RECENT_DUPLICATE_GRACE_MS = Math.max(Number(process.env.RECENT_DUPLICATE_GRACE_MS || 1500), 0);
const SCAN_INFLIGHT_GUARD_MS = Math.max(Number(process.env.SCAN_INFLIGHT_GUARD_MS || 8000), 1000);
const scanInflightKeys = new Map();

function parseBarcodeToCycleReadingFields(barcode) {
  const result = {
    shot_year: null,
    shot_month: null,
    shot_day: null,
    shot_hour: null,
    shot_minute: null,
    shot_second: null,
    shot_number: null,
    success: false
  };

  const cleanBarcode = String(barcode || "").trim();
  if (!cleanBarcode) return result;

  // Let's check if the barcode matches the standard 18-digit timestamp format: YYMMDDHHMMSS + 6-digit sequence
  // e.g. 250101235959654321
  if (cleanBarcode.length === 18 && /^\d{18}$/.test(cleanBarcode)) {
    const yy = parseInt(cleanBarcode.slice(0, 2), 10);
    const mm = parseInt(cleanBarcode.slice(2, 4), 10);
    const dd = parseInt(cleanBarcode.slice(4, 6), 10);
    const hh = parseInt(cleanBarcode.slice(6, 8), 10);
    const min = parseInt(cleanBarcode.slice(8, 10), 10);
    const ss = parseInt(cleanBarcode.slice(10, 12), 10);
    const seq = parseInt(cleanBarcode.slice(12), 10);

    result.shot_year = 2000 + yy;
    result.shot_month = mm;
    result.shot_day = dd;
    result.shot_hour = hh;
    result.shot_minute = min;
    result.shot_second = ss;
    result.shot_number = seq;
    result.success = true;
    return result;
  }

  // Fallback: If it starts or ends with a timestamped format of 12 digits, try parsing that!
  // e.g. timestamp is 12 digits (YYMMDDHHMMSS)
  const timestampMatch = cleanBarcode.match(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (timestampMatch) {
    const yy = parseInt(timestampMatch[1], 10);
    const mm = parseInt(timestampMatch[2], 10);
    const dd = parseInt(timestampMatch[3], 10);
    const hh = parseInt(timestampMatch[4], 10);
    const min = parseInt(timestampMatch[5], 10);
    const ss = parseInt(timestampMatch[6], 10);

    // Shot number is the remaining digits after or before the timestamp
    const index = timestampMatch.index;
    let seqStr = "";
    if (index === 0) {
      seqStr = cleanBarcode.slice(12);
    } else {
      seqStr = cleanBarcode.slice(0, index);
    }
    const seq = parseInt(seqStr.replace(/\D/g, ""), 10);

    if (!isNaN(seq)) {
      result.shot_year = 2000 + yy;
      result.shot_month = mm;
      result.shot_day = dd;
      result.shot_hour = hh;
      result.shot_minute = min;
      result.shot_second = ss;
      result.shot_number = seq;
      result.success = true;
      return result;
    }
  }

  return result;
}

async function ensurePlcCycleReadingExists(parsed) {
  if (!parsed.success) return;

  // Check if it already exists
  const checkQuery = `
    SELECT TOP 1 * FROM PlcCycleReadings 
    WHERE shot_year = :shot_year
      AND shot_month = :shot_month
      AND shot_day = :shot_day
      AND shot_hour = :shot_hour
      AND shot_minute = :shot_minute
      AND shot_second = :shot_second
      AND shot_number = :shot_number
  `;
  try {
    const [existing] = await sequelize.query(checkQuery, {
      replacements: {
        shot_year: parsed.shot_year,
        shot_month: parsed.shot_month,
        shot_day: parsed.shot_day,
        shot_hour: parsed.shot_hour,
        shot_minute: parsed.shot_minute,
        shot_second: parsed.shot_second,
        shot_number: parsed.shot_number,
      }
    });

    if (existing && existing.length > 0) {
      console.log(`[PLC_CYCLE_AUDIT] Record already exists in PlcCycleReadings for shot_number: ${parsed.shot_number}`);
      return;
    }
  } catch (err) {
    // If table doesn't support advanced columns, query check might fail. We'll proceed with try-catch insert.
  }

  const recordedAt = new Date(
    parsed.shot_year,
    parsed.shot_month - 1,
    parsed.shot_day,
    parsed.shot_hour,
    parsed.shot_minute,
    parsed.shot_second
  );

  console.log(`[PLC_CYCLE_AUDIT] Record not found. Seeding mock record into PlcCycleReadings...`);
  
  const insertQuery = `
    INSERT INTO PlcCycleReadings (
      shot_year, shot_month, shot_day, 
      shot_hour, shot_minute, shot_second, 
      shot_number, recorded_at
    ) VALUES (
      :shot_year, :shot_month, :shot_day, 
      :shot_hour, :shot_minute, :shot_second, 
      :shot_number, :recorded_at
    )
  `;

  try {
    await sequelize.query(insertQuery, {
      replacements: {
        shot_year: parsed.shot_year,
        shot_month: parsed.shot_month,
        shot_day: parsed.shot_day,
        shot_hour: parsed.shot_hour,
        shot_minute: parsed.shot_minute,
        shot_second: parsed.shot_second,
        shot_number: parsed.shot_number,
        recorded_at: recordedAt
      }
    });
    console.log(`[PLC_CYCLE_AUDIT] Successfully inserted mock record for shot_number: ${parsed.shot_number}`);
  } catch (error) {
    console.warn(`[PLC_CYCLE_AUDIT] Failed to insert mock PlcCycleReading record (perhaps table schema differs):`, error.message);
  }
}

async function checkPlcCycleReading(barcode) {
  const parsed = parseBarcodeToCycleReadingFields(barcode);

  if (parsed.success) {
    console.log(`[PLC_CYCLE_AUDIT] Scanned barcode: ${barcode} -> Parsed fields:`, parsed);
    await ensurePlcCycleReadingExists(parsed);

    const query = `
      SELECT TOP 1 * FROM PlcCycleReadings 
      WHERE shot_year = :shot_year
        AND shot_month = :shot_month
        AND shot_day = :shot_day
        AND shot_hour = :shot_hour
        AND shot_minute = :shot_minute
        AND shot_second = :shot_second
        AND shot_number = :shot_number
    `;
    try {
      const [results] = await sequelize.query(query, {
        replacements: {
          shot_year: parsed.shot_year,
          shot_month: parsed.shot_month,
          shot_day: parsed.shot_day,
          shot_hour: parsed.shot_hour,
          shot_minute: parsed.shot_minute,
          shot_second: parsed.shot_second,
          shot_number: parsed.shot_number,
        }
      });

      if (results && results.length > 0) {
        return { success: true, reading: results[0], shotNumber: parsed.shot_number };
      }
    } catch (err) {
      console.warn(`[PLC_CYCLE_AUDIT] Exact query failed (table may not have columns):`, err.message);
    }
    console.log(`[PLC_CYCLE_AUDIT] No exact match in PlcCycleReadings for all fields. Falling back to query by shot_number only.`);
  }

  const rules = await QrFormatRule.findAll({ where: { is_active: true } });
  let matchedRule = null;
  let matchResult = null;
  for (const rule of rules) {
    try {
      const regexPattern = new RegExp(rule.regex_pattern, "i");
      const match = barcode.match(regexPattern);
      if (match) {
        matchedRule = rule;
        matchResult = match;
        break;
      }
    } catch (e) {
      // ignore
    }
  }

  let shotNumber = null;
  if (matchResult && matchResult.groups) {
    shotNumber = matchResult.groups.shot_number || matchResult.groups.shot || matchResult.groups.sequence;
  }
  if (!shotNumber && matchResult && matchResult.length > 1) {
    shotNumber = matchResult[matchResult.length - 1];
  }
  if (!shotNumber) {
    const fallbackMatch = barcode.match(/(\d{4,5})$/);
    if (fallbackMatch) shotNumber = fallbackMatch[1];
  }

  if (!shotNumber) {
    return { success: false, reason: "NO_SHOT_NUMBER", message: "Could not extract shot number from barcode." };
  }

  let query = `SELECT TOP 1 * FROM PlcCycleReadings WHERE shot_number = :shotNumber`;
  let replacements = { shotNumber: parseInt(shotNumber, 10) };

  // Advanced YYMMDDSS parsing fallback
  if (shotNumber.length >= 8 && shotNumber.length <= 10 && /^\d+$/.test(shotNumber)) {
    const datePart = shotNumber.slice(0, 6);
    const seqPart = shotNumber.slice(6);
    const yy = parseInt(datePart.slice(0, 2), 10);
    const mm = parseInt(datePart.slice(2, 4), 10);
    const dd = parseInt(datePart.slice(4, 6), 10);

    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const year = 2000 + yy;
      const startOfDay = new Date(year, mm - 1, dd, 0, 0, 0);
      const endOfDay = new Date(year, mm - 1, dd, 23, 59, 59);

      if (!isNaN(startOfDay.getTime())) {
        const parsedSeq = parseInt(seqPart, 10);
        // Try strict YYMMDD + sequence query first
        const strictQuery = `SELECT TOP 1 * FROM PlcCycleReadings WHERE shot_number = :seqNumber AND recorded_at BETWEEN :startDate AND :endDate ORDER BY recorded_at DESC`;
        try {
          const [strictResults] = await sequelize.query(strictQuery, {
            replacements: {
              seqNumber: parsedSeq,
              startDate: startOfDay,
              endDate: endOfDay
            }
          });

          if (strictResults && strictResults.length > 0) {
            return { success: true, reading: strictResults[0], shotNumber: parsedSeq };
          }
        } catch (err) {
          // ignore
        }
      }
    }
  }

  // Fallback to original single-field full match
  try {
    const [results] = await sequelize.query(query + " ORDER BY recorded_at DESC", { replacements });
    if (results && results.length > 0) {
      return { success: true, reading: results[0], shotNumber };
    }
  } catch (err) {
    // ignore
  }

  return { success: false, reason: "PART_NOT_FOUND", message: `Part not found in database for shot number ${shotNumber}.` };
}

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
        const expectedFormats = applicableRules
          .slice(0, 5)
          .map((rule) => getRuleLabel(rule))
          .filter((label) => String(label || "").trim().length >= 3)
          .join(", ");
        return {
          decision: "BLOCK",
          reason: "INVALID_QR_FORMAT",
          validationResult: "FAILED",
          message: expectedFormats ? `QR format mismatch. Allowed rules: ${expectedFormats}` : "QR format mismatch.",
          currentStatus: "REJECTED_QR_FORMAT",
        };
      }
    }

    const sequence = await getActiveStations();
    if (!sequence.includes(station)) {
      return {
        decision: "BLOCK",
        reason: "STATION_NOT_CONFIGURED",
        message: `BLOCKED\nStation Not Found\n\nStation: ${station}\nPlease check configuration.`,
        currentStatus: "UNKNOWN"
      };
    }
    const firstStation = sequence[0] || null;

    // First operation gate: scanned QR must exist in PLC reading table.
    if (station === firstStation) {
      const plcMatch = await checkPlcCycleReading(normalizedPartId);
      if (!plcMatch?.success) {
        return {
          decision: "BLOCK",
          reason: "PART_NOT_FOUND",
          validationResult: "FAILED",
          message: "Part QR not found in moulding records. Verify part was recorded first.",
          currentStatus: "REJECTED_PLC_MATCH",
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

    const stationFeatures = await getStationFeatureConfig(station);

    const expectedStation = getExpectedStation(part, sequence);

    // 1. DUPLICATE VALIDATION
    const hasExistingSuccess = await OperationLog.findOne({
      where: { 
        part_id: normalizedPartId, 
        station_no: station,
        plc_status: ["ENDED_OK", "PASSED", "COMPLETED_OK", "ENDED_NG", "COMPLETED_NG"]
      }
    });

    const scanAttemptType = hasExistingSuccess ? "RE-SCAN" : "INITIAL";

    if (part.status === "COMPLETED" && !part.is_rework) {
       part.last_validation_result = "DUPLICATE";
       await part.save();
       return {
        decision: "BLOCK",
        reason: "ALREADY_COMPLETED",
        qrStatus: "DUPLICATE",
        operationStatus: "PASSED",
        message: `Duplicate scan. Operation has already passed.`,
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
        message: `Duplicate scan. Operation has already passed.`,
        currentStatus: part.status,
        operationLogId: blockedLog.id,
      };
    }

    // 2. SEQUENCE VALIDATION
    if (!skipSequenceValidation && sequence.length > 0) {
      const currentIdx = sequence.indexOf(station);
      if (currentIdx > 0 && expectedStation && expectedStation !== station) {
        const expectedIdx = sequence.indexOf(expectedStation);

        // Allow rework parts to be rescanned/re-run at current/previous stages if they are in rework state
        if (part.is_rework && currentIdx <= expectedIdx) {
          // Allow
        } else {
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
            message: `Previous station not completed with OP number ${expectedStation}.`,
            expectedStation,
            currentStatus: part.status,
            operationLogId: blockedLog.id,
          };
        }
      }
    }

    // 3. INTERLOCK / NG VALIDATION
    if (!skipInterlockValidation && (part.is_interlocked || part.status === "INTERLOCKED")) {
      if (["NG", "ENDED_NG", "FAILED"].includes(part.status) || part.interlock_reason === "SCAN_RESULT_NG") {
        return {
          decision: "ALLOW",
          reason: "GLOBAL_REJECTION",
          qrStatus: "PASSED",
          operationStatus: "FAILED",
          message: "Part is marked as NG (Rejected). Further operations are not allowed. Please move to rejection bin.",
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
