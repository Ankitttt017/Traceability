const Part = require("../models/Part");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const Machine = require("../models/Machine");
const StationFeatureSetting = require("../models/StationFeatureSetting");
const QrFormatRule = require("../models/QrFormatRule");
const PartCodeMapping = require("../models/PartCodeMapping");
const { emitRealtime } = require("./realtimeService");
const { getStationFeatureConfig } = require("./stationFeatureService");
const { isMachineBypassEnabled } = require("./machineBypassService");
const {
  LEAKTEST_OPERATION,
  buildLeaktestIndex,
  getLeaktestReadingForPartStation,
  getLeaktestStageState,
} = require("./leaktestLookupService");
const sequelize = require("../config/db");
const { Op } = require("sequelize");
const RECENT_DUPLICATE_GRACE_MS = Math.max(Number(process.env.RECENT_DUPLICATE_GRACE_MS || 1500), 0);
const SCAN_INFLIGHT_GUARD_MS = Math.max(Number(process.env.SCAN_INFLIGHT_GUARD_MS || 8000), 1000);
const scanInflightKeys = new Map();
const TERMINAL_SUCCESS_PLC_STATUSES = new Set(["ENDED_OK", "PASSED", "COMPLETED_OK"]);
const TERMINAL_FAILURE_PLC_STATUSES = new Set(["ENDED_NG", "FAILED", "COMPLETED_NG"]);
const NON_TERMINAL_PLC_STATUSES = new Set([
  "PENDING",
  "STARTED",
  "RUNNING",
  "WAITING_PLC",
  "START_SENT",
  "WAITING_RUNNING",
  "WAITING_END",
  "INTERLOCKED",
  "BLOCKED",
  "PLC_COMM_ERROR",
  "RESET",
  "RETRY",
  "VALIDATION_ONLY",
]);

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
  const isOkShotStatus = (value) => {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (!normalized) return false;
    if (["1", "OK", "PASS", "PASSED"].includes(normalized)) return true;
    return Number(value) === 1;
  };
  const getShotStatusCode = (row) => row?.shot_status ?? row?.status ?? row?.result ?? row?.shot_result ?? null;
  const getShotStatusLabel = (value) => {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (["OK", "PASS", "PASSED"].includes(normalized)) return "OK";
    if (["NG", "FAIL", "FAILED"].includes(normalized)) return "NG";
    const code = Number(value);
    if (code === 1) return "OK";
    if (code === 3) return "WARM_UP_SHOT";
    if (code === 5) return "OFFSET_SHOT";
    return Number.isFinite(code) ? `UNKNOWN_${code}` : "UNKNOWN";
  };

  // Priority path for compact QR format:
  // Compact format: DDMMHHMM + SHOT(1..6)
  // Also support DPM-style compact code: DDMMHHMM + MACHINE_CODE(1) + SHOT(1..6),
  // where machine code is ignored for PlcCycleReadings lookup.
  const compactBarcode = String(barcode || "").trim();
  const compactMatch =
    compactBarcode.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{1,6})$/) ||
    compactBarcode.match(/^(\d{2})(\d{2})(\d{2})(\d{2})([A-Z0-9]{1})(\d{1,6})$/i);
  if (compactMatch) {
    const day = Number(compactMatch[1]);
    const month = Number(compactMatch[2]);
    const hour = Number(compactMatch[3]);
    const minute = Number(compactMatch[4]);
    const shotGroupIndex = compactMatch.length >= 7 ? 6 : 5;
    const shotNumber = String(parseInt(compactMatch[shotGroupIndex], 10));
    try {
      const [rows] = await sequelize.query(
        `
          SELECT TOP 1 * FROM PlcCycleReadings
          WHERE TRY_CONVERT(INT, shot_day) = :day
            AND TRY_CONVERT(INT, shot_month) = :month
            AND TRY_CONVERT(INT, shot_hour) = :hour
            AND TRY_CONVERT(INT, shot_minute) = :minute
            AND shot_number = :shot
          ORDER BY recorded_at DESC
        `,
        {
          replacements: {
            day,
            month,
            hour,
            minute,
            shot: parseInt(shotNumber, 10),
          },
        }
      );
      if (rows && rows.length > 0) {
        const reading = rows[0];
        const shotStatus = getShotStatusCode(reading);
        if (!isOkShotStatus(shotStatus)) {
          return {
            success: false,
            reason: "NG_SHOT_STATUS",
            message: `Shot status ${shotStatus} (${getShotStatusLabel(shotStatus)}) is not allowed.`,
            reading,
            shotNumber,
            shotStatus,
          };
        }
        return { success: true, reading, shotNumber, shotStatus };
      }
    } catch (error) {
      console.warn("[PLC_CYCLE_AUDIT] compact format query failed:", error.message);
    }
  }
  const parsed = parseBarcodeToCycleReadingFields(barcode);

  if (parsed.success) {
    console.log(`[PLC_CYCLE_AUDIT] Scanned barcode: ${barcode} -> Parsed fields:`, parsed);
    const allowAutoSeed = String(process.env.PLC_CYCLE_AUTO_SEED || "").trim() === "1";
    if (allowAutoSeed) {
      await ensurePlcCycleReadingExists(parsed);
    }

    const query = `
      SELECT TOP 1 * FROM PlcCycleReadings 
      WHERE (
          shot_year = :shot_year
          OR shot_year = :shot_year_short
          OR CAST(shot_year AS NVARCHAR(10)) = :shot_year_text
          OR CAST(shot_year AS NVARCHAR(10)) = :shot_year_short_text
        )
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
          shot_year_short: Number(parsed.shot_year) % 100,
          shot_year_text: String(parsed.shot_year),
          shot_year_short_text: String(Number(parsed.shot_year) % 100).padStart(2, "0"),
          shot_month: parsed.shot_month,
          shot_day: parsed.shot_day,
          shot_hour: parsed.shot_hour,
          shot_minute: parsed.shot_minute,
          shot_second: parsed.shot_second,
          shot_number: parsed.shot_number,
        }
      });

      if (results && results.length > 0) {
        const reading = results[0];
        const shotStatus = getShotStatusCode(reading);
        if (!isOkShotStatus(shotStatus)) {
          return {
            success: false,
            reason: "NG_SHOT_STATUS",
            message: `Shot status ${shotStatus} (${getShotStatusLabel(shotStatus)}) is not allowed.`,
            reading,
            shotNumber: parsed.shot_number,
            shotStatus,
          };
        }
        return { success: true, reading, shotNumber: parsed.shot_number, shotStatus };
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
  let compactParts = null;
  if (matchResult && matchResult.groups) {
    shotNumber = matchResult.groups.shot_number || matchResult.groups.shot || matchResult.groups.sequence;
    const month = Number(matchResult.groups.month ?? matchResult.groups.mm);
    const day = Number(matchResult.groups.day ?? matchResult.groups.dd);
    const hour = Number(matchResult.groups.hour ?? matchResult.groups.hh);
    const minute = Number(matchResult.groups.minute ?? matchResult.groups.min);
    if (
      Number.isFinite(day) && day >= 1 && day <= 31 &&
      Number.isFinite(month) && month >= 1 && month <= 12 &&
      Number.isFinite(hour) && hour >= 0 && hour <= 23 &&
      Number.isFinite(minute) && minute >= 0 && minute <= 59
    ) {
      compactParts = { day, month, hour, minute };
    }
  }
  if (!shotNumber && matchResult && matchResult.length > 1) {
    shotNumber = matchResult[matchResult.length - 1];
  }
  if (!shotNumber) {
    const fallbackMatch = barcode.match(/(\d{4,5})$/);
    if (fallbackMatch) shotNumber = fallbackMatch[1];
  }

  if (!shotNumber) {
    return {
      success: false,
      reason: "NO_SHOT_NUMBER",
      message: "Shot details are invalid. Could not extract the shot number from the scanned QR.",
    };
  }

  // Strict compact-format matching: DDMMHHMM + shot
  // If rule parsing extracted shot/day/month/hour/minute, prefer that over the generic compact parse.
  if (compactParts) {
    try {
      const compactQuery = `
        SELECT TOP 1 * FROM PlcCycleReadings
        WHERE TRY_CONVERT(INT, shot_day) = :day
          AND TRY_CONVERT(INT, shot_month) = :month
          AND TRY_CONVERT(INT, shot_hour) = :hour
          AND TRY_CONVERT(INT, shot_minute) = :minute
          AND shot_number = :shot
        ORDER BY recorded_at DESC
      `;
      const [rows] = await sequelize.query(compactQuery, {
        replacements: {
          day: compactParts.day,
          month: compactParts.month,
          hour: compactParts.hour,
          minute: compactParts.minute,
          shot: parseInt(shotNumber, 10),
        },
      });
      if (rows && rows.length > 0) {
        const reading = rows[0];
        const shotStatus = getShotStatusCode(reading);
        if (!isOkShotStatus(shotStatus)) {
          return {
            success: false,
            reason: "NG_SHOT_STATUS",
            message: `Shot status ${shotStatus} (${getShotStatusLabel(shotStatus)}) is not allowed.`,
            reading,
            shotNumber,
            shotStatus,
          };
        }
        return { success: true, reading, shotNumber, shotStatus };
      }
      return {
        success: false,
        reason: "PART_NOT_FOUND",
        message: `Part not found — shot details unavailable in PlcCycleReadings for ${compactParts.day}/${compactParts.month} ${compactParts.hour}:${compactParts.minute}, shot ${shotNumber}.`,
      };
    } catch (error) {
      console.warn("[PLC_CYCLE_AUDIT] compact format query failed:", error.message);
      // Continue to fallback queries below.
    }
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
            const reading = strictResults[0];
            const shotStatus = getShotStatusCode(reading);
            if (!isOkShotStatus(shotStatus)) {
              return {
                success: false,
                reason: "NG_SHOT_STATUS",
                message: `Shot status ${shotStatus} (${getShotStatusLabel(shotStatus)}) is not allowed.`,
                reading,
                shotNumber: parsedSeq,
                shotStatus,
              };
            }
            return { success: true, reading, shotNumber: parsedSeq, shotStatus };
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
      const reading = results[0];
      const shotStatus = getShotStatusCode(reading);
      if (!isOkShotStatus(shotStatus)) {
        return {
          success: false,
          reason: "NG_SHOT_STATUS",
          message: `Shot status ${shotStatus} (${getShotStatusLabel(shotStatus)}) is not allowed.`,
          reading,
          shotNumber,
          shotStatus,
        };
      }
      return { success: true, reading, shotNumber, shotStatus };
    }
  } catch (err) {
    // ignore
  }

  return {
    success: false,
    reason: "PART_NOT_FOUND",
    message: `Part not found — shot details are unavailable in PlcCycleReadings for shot number ${shotNumber}.`,
  };
}

async function hasRealCompletedOperationBefore(partId, currentStation, sequence) {
  const stationIndex = Array.isArray(sequence) ? sequence.indexOf(currentStation) : -1;
  if (!partId || stationIndex <= 0) return false;

  const previousStations = sequence.slice(0, stationIndex);
  const rows = await OperationLog.findAll({
    where: {
      part_id: partId,
      station_no: { [Op.in]: previousStations },
    },
    attributes: ["id", "plc_status", "result", "is_bypassed"],
    order: [["createdAt", "DESC"]],
    limit: 200,
  });

  if (rows.some((row) => row?.is_bypassed !== true && isSuccessfulOperationLog(row))) {
    return true;
  }

  const leaktestState = await getLeaktestSequenceStateForPart(partId, sequence);
  return previousStations.includes(LEAKTEST_OPERATION) && leaktestState?.state === "PASSED";
}

function normalizeResult(result) {
  return String(result || "OK").trim().toUpperCase() === "OK" ? "OK" : "NG";
}

function normalizeStation(stationNo) {
  return String(stationNo || "")
    .trim()
    .toUpperCase();
}

function getNormalizedOperationState(log) {
  return {
    plcStatus: String(log?.plc_status || "").trim().toUpperCase(),
    result: String(log?.result || "").trim().toUpperCase(),
  };
}

function isTerminalOperationLog(log) {
  if (!log) return false;
  const { plcStatus, result } = getNormalizedOperationState(log);

  if (TERMINAL_SUCCESS_PLC_STATUSES.has(plcStatus) || TERMINAL_FAILURE_PLC_STATUSES.has(plcStatus)) {
    return true;
  }
  if (NON_TERMINAL_PLC_STATUSES.has(plcStatus)) {
    return false;
  }

  return ["OK", "NG", "PASS", "FAIL", "PASSED", "FAILED"].includes(result);
}

function isSuccessfulOperationLog(log) {
  if (!log) return false;
  const { plcStatus, result } = getNormalizedOperationState(log);
  if (TERMINAL_SUCCESS_PLC_STATUSES.has(plcStatus)) return true;
  if (TERMINAL_FAILURE_PLC_STATUSES.has(plcStatus) || NON_TERMINAL_PLC_STATUSES.has(plcStatus)) return false;
  return ["OK", "PASS", "PASSED"].includes(result);
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
  await ensureQrRuleScopeColumns();
  return QrFormatRule.findAll({
    where: { is_active: true },
    order: [["updatedAt", "DESC"]],
  });
}

async function ensureQrRuleScopeColumns() {
  await sequelize.query(`
    IF COL_LENGTH('QrFormatRules', 'plant_id') IS NULL
      ALTER TABLE [QrFormatRules] ADD [plant_id] INT NULL;
  `);
  await sequelize.query(`
    IF COL_LENGTH('QrFormatRules', 'line_id') IS NULL
      ALTER TABLE [QrFormatRules] ADD [line_id] INT NULL;
  `);
  await sequelize.query(`
    IF COL_LENGTH('QrFormatRules', 'part_name') IS NULL
      ALTER TABLE [QrFormatRules] ADD [part_name] NVARCHAR(255) NULL;
  `);
  await sequelize.query(`
    IF COL_LENGTH('QrFormatRules', 'die_name') IS NULL
      ALTER TABLE [QrFormatRules] ADD [die_name] NVARCHAR(255) NULL;
  `);
}

async function getStationValidationPlan() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    order: [["sequence_no", "ASC"]],
  });
  const machineStageRows = machines
    .map((machine) => ({ machine, stage: getMachineOperationStage(machine) }))
    .filter((row) => Boolean(row.stage));
  const staged = uniqueStages(machineStageRows.map((row) => row.stage));
  if (staged.length === 0) {
    return { physicalSequence: [], validationSequence: [], skippedStages: new Set(), stageMeta: {} };
  }

  const settings = await StationFeatureSetting.findAll({
    where: { station_no: staged },
    attributes: ["station_no", "operation_enabled", "config"],
  });
  const byStation = settings.reduce((acc, row) => {
    let config = {};
    try {
      config = typeof row.config === "string" ? JSON.parse(row.config || "{}") : (row.config || {});
    } catch (_error) {
      config = {};
    }
    acc[normalizeStation(row.station_no)] = {
      operationEnabled: row.operation_enabled !== false,
      stationBypassEnabled: config.bypass === true || config.bypassEnabled === true,
    };
    return acc;
  }, {});

  const machinesByStage = machineStageRows.reduce((acc, row) => {
    if (!acc[row.stage]) acc[row.stage] = [];
    acc[row.stage].push(row.machine);
    return acc;
  }, {});

  const stageMeta = {};
  const validationSequence = staged.filter((stage) => {
    const stationSetting = byStation[stage] || {};
    const operationEnabled = stationSetting.operationEnabled !== false;
    const stationBypassEnabled = stationSetting.stationBypassEnabled === true;
    const stageMachines = machinesByStage[stage] || [];
    const allMachinesBypassed = stageMachines.length > 0 && stageMachines.every((machine) => {
      const runtimeBypass = isMachineBypassEnabled(machine.id);
      const persistedBypass = machine.bypass_enabled === true;
      return runtimeBypass || persistedBypass;
    });
    const stageBypassed = !operationEnabled || stationBypassEnabled || allMachinesBypassed;

    stageMeta[stage] = {
      operationEnabled,
      stationBypassEnabled,
      allMachinesBypassed,
      stageBypassed,
      machineIds: stageMachines.map((machine) => Number(machine.id)).filter(Boolean),
    };

    return !stageBypassed;
  });

  const validationSet = new Set(validationSequence);
  const skippedStages = new Set(staged.filter((stage) => !validationSet.has(stage)));

  return {
    physicalSequence: staged,
    validationSequence,
    skippedStages,
    stageMeta,
  };
}

async function getActiveStations() {
  const plan = await getStationValidationPlan();
  return plan.validationSequence;
}

async function getLeaktestSequenceStateForPart(partId, sequence) {
  const normalizedPartId = String(partId || "").trim();
  if (!normalizedPartId || !Array.isArray(sequence) || !sequence.includes(LEAKTEST_OPERATION)) {
    return null;
  }

  const mapping = await PartCodeMapping.findOne({
    where: {
      is_active: true,
      [Op.or]: [
        { old_part_id: normalizedPartId },
        { customer_qr: normalizedPartId },
      ],
    },
    attributes: ["old_part_id", "customer_qr"],
    order: [["updatedAt", "DESC"]],
    raw: true,
  });
  const customerQr = String(mapping?.customer_qr || "").trim();
  if (!customerQr) {
    return null;
  }
  const effectivePartId = String(mapping?.old_part_id || normalizedPartId).trim();

  const machines = await Machine.findAll({
    where: {
      is_active: true,
      operation_no: LEAKTEST_OPERATION,
    },
    attributes: ["id", "machine_name", "operation_no", "plc_ip", "qr_scanner_ip", "machine_ip"],
    raw: true,
  });
  if (!machines.length) {
    return null;
  }

  const index = await buildLeaktestIndex({
    partIds: [effectivePartId],
    customerQrByPartId: {
      [effectivePartId.toUpperCase()]: customerQr,
      [effectivePartId]: customerQr,
    },
    machines,
  });
  const reading = getLeaktestReadingForPartStation(index.byPartAndStation, effectivePartId, LEAKTEST_OPERATION);
  if (!reading) {
    return null;
  }

  return {
    state: getLeaktestStageState(reading),
    reading,
    customerQr,
  };
}

async function autoPassSkippedStationsBefore({
  part,
  partId,
  currentStation,
  plan,
  userId,
}) {
  if (!part || !partId || !currentStation || !plan?.physicalSequence?.length) {
    return [];
  }
  const currentPhysicalIndex = plan.physicalSequence.indexOf(currentStation);
  if (currentPhysicalIndex <= 0) return [];

  const created = [];
  const priorSkippedStations = plan.physicalSequence
    .slice(0, currentPhysicalIndex)
    .filter((station) => plan.skippedStages?.has(station));

  for (const skippedStation of priorSkippedStations) {
    const existing = await OperationLog.findOne({
      where: {
        part_id: partId,
        station_no: skippedStation,
      },
      order: [["createdAt", "DESC"]],
    });
    if (existing) {
      const plcStatus = String(existing.plc_status || "").trim().toUpperCase();
      const reason = String(existing.interlock_reason || "").trim().toUpperCase();
      const isTerminal =
        TERMINAL_SUCCESS_PLC_STATUSES.has(plcStatus) ||
        TERMINAL_FAILURE_PLC_STATUSES.has(plcStatus) ||
        isTerminalOperationLog(existing) ||
        existing.is_bypassed === true;
      const isRealInterlock = plcStatus === "INTERLOCKED" && reason && !["PREVIOUS_STATION_NOT_COMPLETED", "STATION_NOT_CONFIGURED"].includes(reason);
      if (isTerminal || isRealInterlock) continue;
    }

    const meta = plan.stageMeta?.[skippedStation] || {};
    const machineId = Number(meta.machineIds?.[0] || 0) || null;
    const bypassReason = meta.allMachinesBypassed
      ? "MACHINE_BYPASS_AUTO_OK"
      : meta.stationBypassEnabled
        ? "STATION_BYPASS_AUTO_OK"
        : "STATION_OPERATION_DISABLED_AUTO_OK";

    const log = await OperationLog.create({
      part_id: partId,
      machine_id: machineId,
      operation_no: skippedStation,
      station_no: skippedStation,
      plc_status: "ENDED_OK",
      plc_start_time: new Date(),
      plc_start_at: new Date(),
      plc_end_time: new Date(),
      plc_end_at: new Date(),
      result: "OK",
      scan_attempt_type: "BYPASS",
      validation_result: "PASSED",
      operation_result: "PASSED",
      user_id: userId,
      interlock_reason: null,
      is_bypassed: true,
      bypass_reason: bypassReason,
    });
    created.push(log);
  }

  if (created.length > 0) {
    const latestSkippedStation = created[created.length - 1].station_no;
    part.current_operation = latestSkippedStation;
    part.current_station = latestSkippedStation;
    part.status = "IN_PROGRESS";
    part.last_validation_result = "PASSED";
    part.is_interlocked = false;
    part.interlock_reason = null;
    await part.save();
  }

  return created;
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

function normalizeRuleScopeToken(value) {
  return String(value || "").trim().toUpperCase();
}

function isRuleApplicableToMachine(rule, machine) {
  if (!rule) return false;
  const rulePlantId = Number(rule.plant_id || rule.plantId || 0);
  const ruleLineId = Number(rule.line_id || rule.lineId || 0);
  if (rulePlantId && Number(machine?.plant_id || machine?.plantId || 0) !== rulePlantId) return false;
  if (ruleLineId && Number(machine?.line_id || machine?.lineId || 0) !== ruleLineId) return false;
  return true;
}

function getRegexMatch(rule, value) {
  try {
    const pattern = new RegExp(rule.regex_pattern, "i");
    return pattern.exec(String(value || "").trim());
  } catch (_error) {
    return null;
  }
}

function isRulePartScopeMatch(rule, value, match) {
  const expectedPart = normalizeRuleScopeToken(rule?.part_name || rule?.partName);
  const expectedDie = normalizeRuleScopeToken(rule?.die_name || rule?.dieName);
  if (!expectedPart && !expectedDie) return true;

  const groups = match?.groups || {};
  const candidates = [
    value,
    groups.partName,
    groups.part_name,
    groups.part,
    groups.model,
    groups.modelCode,
    groups.model_code,
  ].map(normalizeRuleScopeToken).filter(Boolean);
  const dieCandidates = [
    groups.dieName,
    groups.die_name,
    groups.die,
    groups.cavity,
    value,
  ].map(normalizeRuleScopeToken).filter(Boolean);

  if (expectedPart) {
    const partOk = candidates.some((candidate) => candidate === expectedPart || candidate.includes(expectedPart));
    if (!partOk) return false;
  }
  if (expectedDie) {
    const dieOk = dieCandidates.some((candidate) => candidate === expectedDie || candidate.includes(`-${expectedDie}`) || candidate.endsWith(expectedDie));
    if (!dieOk) return false;
  }
  return true;
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

async function deriveSequenceStateFromHistory(partId, sequence) {
  if (!partId || !Array.isArray(sequence) || sequence.length === 0) {
    return { expectedStation: null, lastCompletedStation: null };
  }

  const logs = await OperationLog.findAll({
    where: { part_id: partId },
    attributes: ["station_no", "operation_no", "plc_status", "result", "createdAt"],
    order: [["createdAt", "DESC"]],
    limit: 400,
  });

  const completedStations = new Set();
  for (const log of logs) {
    const station = normalizeStation(log.station_no || log.operation_no);
    if (!station || !sequence.includes(station)) continue;

    if (isSuccessfulOperationLog(log)) {
      completedStations.add(station);
    }
  }

  const leaktestState = await getLeaktestSequenceStateForPart(partId, sequence);
  if (leaktestState?.state === "PASSED") {
    completedStations.add(LEAKTEST_OPERATION);
  }

  let lastCompletedIndex = -1;
  for (let i = 0; i < sequence.length; i += 1) {
    if (completedStations.has(sequence[i])) {
      lastCompletedIndex = i;
    } else {
      break;
    }
  }

  if (lastCompletedIndex < 0) {
    return {
      expectedStation: sequence[0] || null,
      lastCompletedStation: null,
      blockedStationDueToNg: leaktestState?.state === "FAILED" ? LEAKTEST_OPERATION : null,
    };
  }

  return {
    expectedStation: sequence[lastCompletedIndex + 1] || null,
    lastCompletedStation: sequence[lastCompletedIndex] || null,
    blockedStationDueToNg: leaktestState?.state === "FAILED" ? LEAKTEST_OPERATION : null,
  };
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
  const shotValidationPartId = String(options?.shotValidationPartId || normalizedPartId).trim();
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
  const skipQrFormatValidation = options?.skipQrFormatValidation === true;
  const skipShotValidation = options?.skipShotValidation === true;
  const skipCustomerCodeValidation = options?.skipCustomerCodeValidation === true;
  const customerCodePattern = String(options?.customerCodePattern || "").trim();
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
    const currentMachine = mId ? await Machine.findByPk(mId, { raw: true }) : null;
    const activeRules = await getActiveQrRules();
    const applicableRules = activeRules.filter((rule) =>
      isRuleApplicableToStation(rule, station) && isRuleApplicableToMachine(rule, currentMachine)
    );
    let matchedRule = null;

    if (!skipQrFormatValidation && applicableRules.length === 0) {
      return {
        decision: "BLOCK",
        reason: "QR_RULE_NOT_FOUND_FOR_STATION",
        validationResult: "FAILED",
        message: `No active QR rule configured for station ${station}.`,
        currentStatus: "REJECTED_QR_RULE",
      };
    }

    if (!skipQrFormatValidation && applicableRules.length > 0) {
      for (const rule of applicableRules) {
        try {
          const match = getRegexMatch(rule, normalizedPartId);
          if (match && isRulePartScopeMatch(rule, normalizedPartId, match)) {
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

    const validationPlan = await getStationValidationPlan();
    const sequence = validationPlan.validationSequence;
    if (!sequence.includes(station)) {
      return {
        decision: "BLOCK",
        reason: "STATION_NOT_CONFIGURED",
        message: validationPlan.physicalSequence.includes(station)
          ? `Station ${station} is bypassed or scanner is inactive. Scan at the next active station.`
          : `Station ${station} is not configured in active station sequence.`,
        currentStatus: "UNKNOWN"
      };
    }
    const firstValidationStation = sequence[0] || null;
    const stationSequenceIndex = sequence.indexOf(station);
    const hasPreviousRealCompletion = await hasRealCompletedOperationBefore(normalizedPartId, station, sequence);
    const shouldValidateShot =
      !skipShotValidation &&
      (station === firstValidationStation || stationSequenceIndex === 0 || !hasPreviousRealCompletion);

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

    await autoPassSkippedStationsBefore({
      part,
      partId: normalizedPartId,
      currentStation: station,
      plan: validationPlan,
      userId,
    });

    if (shouldValidateShot) {
      const plcMatch = await checkPlcCycleReading(shotValidationPartId);
      if (!plcMatch?.success) {
        const blockedPart = await Part.findOne({ where: { part_id: normalizedPartId } }) || await Part.create({
          part_id: normalizedPartId,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          current_operation: null,
          current_station: null,
          status: "IN_PROGRESS",
        });
        const interlockReason = String(plcMatch?.reason || "PART_NOT_FOUND").toUpperCase();
        const blockedLog = await OperationLog.create({
          part_id: normalizedPartId,
          machine_id: mId || null,
          operation_no: station,
          station_no: station,
          plc_status: "INTERLOCKED",
          result: "BLOCK",
          scan_attempt_type: "INITIAL",
          validation_result: "FAILED",
          operation_result: "INTERLOCKED",
          user_id: userId,
          interlock_reason: interlockReason,
          shot_number: plcMatch?.shotNumber || null,
        });
        blockedPart.last_validation_result = "FAILED";
        blockedPart.interlock_reason = interlockReason;
        await blockedPart.save();
        return {
          decision: "BLOCK",
          reason: interlockReason,
          validationResult: "FAILED",
          message: interlockReason === "NG_SHOT_STATUS"
            ? (plcMatch?.message || "Shot status is not OK. Warm-up/offset shots are blocked.")
            : "Part QR not found in moulding records. Verify part was recorded first.",
          currentStatus: "REJECTED_PLC_MATCH",
          operationLogId: blockedLog.id,
        };
      }
    }

    if (!skipCustomerCodeValidation && customerCodePattern) {
      try {
        const customerRegex = new RegExp(customerCodePattern, "i");
        if (!customerRegex.test(normalizedPartId)) {
          return {
            decision: "BLOCK",
            reason: "CUSTOMER_CODE_INVALID",
            validationResult: "FAILED",
            message: "Customer code validation failed for scanned QR.",
            currentStatus: "REJECTED_CUSTOMER_CODE",
          };
        }
      } catch (_error) {
        return {
          decision: "BLOCK",
          reason: "CUSTOMER_CODE_RULE_INVALID",
          validationResult: "FAILED",
          message: "Customer code rule is invalid. Contact supervisor.",
          currentStatus: "REJECTED_CUSTOMER_RULE",
        };
      }
    }

    if (matchedRule) {
      const formatName = matchedRule.format_name || matchedRule.model_code || "ACTIVE_RULE";
      if (part.qr_format_name !== formatName) {
        part.qr_format_name = formatName;
        await part.save();
      }
    }

    const stationFeatures = await getStationFeatureConfig(station);

    const partExpectedStation = getExpectedStation(part, sequence);
    const derivedSequenceState = await deriveSequenceStateFromHistory(normalizedPartId, sequence);
    const expectedStation = derivedSequenceState.expectedStation || partExpectedStation;
    const nextStationAfterCurrent = stationSequenceIndex >= 0 ? (sequence[stationSequenceIndex + 1] || null) : null;
    const lastCompletedStation =
      derivedSequenceState.lastCompletedStation ||
      normalizeStation(part.current_operation || part.current_station);
    const leakNgBlockedStation = normalizeStation(derivedSequenceState.blockedStationDueToNg);
    const leakNgBlockedIndex = leakNgBlockedStation ? sequence.indexOf(leakNgBlockedStation) : -1;

    if (
      derivedSequenceState.lastCompletedStation &&
      normalizeStation(part.current_operation) !== derivedSequenceState.lastCompletedStation
    ) {
      part.current_operation = derivedSequenceState.lastCompletedStation;
      part.current_station = derivedSequenceState.lastCompletedStation;
      await part.save();
    }

    if (!part.is_rework && leakNgBlockedIndex >= 0 && stationSequenceIndex > leakNgBlockedIndex) {
      part.status = "NG";
      part.is_interlocked = true;
      part.interlock_reason = "LEAK_TEST_NG";
      part.last_validation_result = "FAILED";
      await part.save();
      return {
        decision: "BLOCK",
        reason: "LEAK_TEST_NG",
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        message: "Leak Test is NG. Further operations are not allowed.",
        currentStatus: part.status,
        expectedStation: leakNgBlockedStation,
        lastCompletedStation,
        forceNg: true,
      };
    }

    // 1. DUPLICATE VALIDATION
    // Once a station has a real success for this part, any later attempt is a duplicate
    // unless the part is explicitly in rework.
    const stationLogs = await OperationLog.findAll({
      where: {
        part_id: normalizedPartId,
        station_no: station,
      },
      order: [["createdAt", "DESC"]],
      limit: 50,
    });
    const latestStationLog = stationLogs[0] || null;
    const latestStationStatus = String(latestStationLog?.plc_status || "").trim().toUpperCase();
    const hasExistingSuccess =
      stationLogs.some((row) => isTerminalOperationLog(row)) ||
      ["ENDED_OK", "PASSED", "COMPLETED_OK", "ENDED_NG", "COMPLETED_NG"].includes(latestStationStatus);

    const scanAttemptType = hasExistingSuccess ? "RE-SCAN" : "INITIAL";

    if (part.is_interlocked && !part.is_rework) {
      const lockedReason = String(part.interlock_reason || "").trim().toUpperCase();
      if (["DUPLICATE_SCAN", "ALREADY_COMPLETED", "DUPLICATE_SCAN_LOCK"].includes(lockedReason)) {
        return {
          decision: "BLOCK",
          reason: lockedReason || "DUPLICATE_SCAN_LOCK",
          qrStatus: "DUPLICATE",
          operationStatus: "PASSED",
          message: "This part is locked after a duplicate scan. Reset the journey before scanning again.",
          currentStatus: part.status,
        };
      }
    }

    if (part.status === "COMPLETED" && !part.is_rework) {
       part.last_validation_result = "DUPLICATE";
       part.is_interlocked = true;
       part.interlock_reason = "ALREADY_COMPLETED";
       await part.save();
       return {
        decision: "BLOCK",
        reason: "ALREADY_COMPLETED",
        qrStatus: "DUPLICATE",
        operationStatus: "PASSED",
        message: `Already completed at ${station}. ${nextStationAfterCurrent ? `Scan next at ${nextStationAfterCurrent}.` : "Final operation already done."}`,
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
      part.is_interlocked = true;
      part.interlock_reason = "DUPLICATE_SCAN_LOCK";
      await part.save();

      return {
        decision: "BLOCK",
        reason: "DUPLICATE_SCAN",
        qrStatus: "DUPLICATE",
        operationStatus: "PASSED",
        message: `Already passed at ${station}. ${nextStationAfterCurrent ? `Scan next at ${nextStationAfterCurrent}.` : "No next operation."}`,
        currentStatus: part.status,
        expectedStation: nextStationAfterCurrent,
        lastCompletedStation: station,
        operationLogId: blockedLog.id,
      };
    }

    // 2. SEQUENCE VALIDATION
    if (!skipSequenceValidation && sequence.length > 0) {
      if (stationSequenceIndex > 0 && expectedStation && expectedStation !== station) {
        const expectedIdx = sequence.indexOf(expectedStation);

        // Allow rework parts to be rescanned/re-run at current/previous stages if they are in rework state
        if (part.is_rework && stationSequenceIndex <= expectedIdx) {
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
            message: `Wrong station. Scan ${expectedStation} first, then ${station}.`,
            expectedStation,
            lastCompletedStation,
            scannedStation: station,
            currentStatus: part.status,
            operationLogId: blockedLog.id,
          };
        }
      }
    }

    // 3. INTERLOCK / NG VALIDATION
    // Always block further stations when part is NG/interlocked,
    // unless part is explicitly in rework flow.
    const normalizedPartStatus = String(part.status || "").trim().toUpperCase();
    const interlockReason = String(part.interlock_reason || "").trim().toUpperCase();
    const isNgTerminalState = ["NG", "ENDED_NG", "FAILED", "COMPLETED_NG"].includes(normalizedPartStatus);
    const isNgReason =
      ["SCAN_RESULT_NG", "PLC_END_NG", "MANUAL_REJECT", "REJECTION_BIN_CONFIRMED"].includes(interlockReason) ||
      interlockReason.startsWith("NG_") ||
      interlockReason.includes("NG");
    if (!part.is_rework && (isNgTerminalState || isNgReason)) {
      return {
        decision: "BLOCK",
        reason: "PART_INTERLOCKED",
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        message: "Part is marked as NG (Rejected). Further operations are not allowed. Please move to rejection bin.",
        currentStatus: part.status,
        forceNg: true
      };
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
        qrStatus: "FAILED",
        operationStatus: "FAILED",
        message: "Scan result NG. Operation rejected.",
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
      result_source: resultSource,
      result_input: options?.resultInput || null,
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
