const { Op, fn, col } = require("sequelize");
const sequelize = require("../config/db");
const ExcelJS = require("exceljs");
const Part = require("../models/Part");
const Machine = require("../models/Machine");
const Scanner = require("../models/Scanner");
const OperationLog = require("../models/OperationLog");
const ProductionLog = require("../models/ProductionLog");
const ReworkLog = require("../models/ReworkLog");
const Shift = require("../models/Shift");
const QrFormatRule = require("../models/QrFormatRule");
const PartCodeMapping = require("../models/PartCodeMapping");
const MachineRuntimeState = require("../models/MachineRuntimeState");
const RejectionView = require("../models/RejectionView");
const FinalProductionResult = require("../models/FinalProductionResult");
const LinePartAssignment = require("../models/LinePartAssignment");
const { saveScan } = require("../services/scanService");
const { captureLeakReadingsForScan } = require("../services/leakTestCaptureService");
const LeakTestReading = require("../models/LeakTestReading");
const {
  LEAKTEST_OPERATION,
  buildLeaktestIndex,
  getLeaktestReadingForPartStation,
  getAllLeaktestReadingsForPart,
  getLeaktestStageState,
  getLeaktestStageStateFromReadings,
  isLeaktestMachine,
} = require("../services/leaktestLookupService");
const { getPlcCircuitSnapshot } = require("../services/plcCommunicationService");
const plcHandshakeEngine = require("../services/plcHandshakeEngine");
const scannerConnectionManager = require("../services/scannerConnectionManager");
const plcConnectionManager = require("../services/plcConnectionManager");
const {
  readModbusRegisters,
  readSlmpRegisters,
  writeModbusRegister,
  writeSlmpRegister,
  probeTcpEndpoint,
} = require("../services/plcIoService");
const { getPlcHealthSnapshot } = require("../services/plcHealthService");
const { getScannerHealthSnapshot } = require("../services/scannerHealthService");
const scannerConnectionService = require("../services/scannerConnectionService");
const { getScannerConnectionSnapshot } = scannerConnectionService;
const { emitRealtime } = require("../services/realtimeService");
const { tryAcquireMachineLock, clearMachineLock } = require("../services/machineLockService");
const { finalizeCycleAfterPlc } = require("../services/cycleFinalizationService");
const { autoPackReadyPart } = require("../services/packingService");
const {
  fetchProductionData,
  fetchProductionFirstScanPartCount,
  fetchProductionSummaryMetrics,
} = require("../services/report/reportExportService");
const { calculateProductionMetrics } = require("../services/report/reportMetricsService");
const {
  fetchMaterializedTraceabilityMetrics,
} = require("../services/report/finalProductionResultService");
const { TIMELINE_EVENTS, recordTimelineEvent } = require("../services/operationTimelineService");
const {
  getStationFeatureConfig,
  normalizePlcPartCount,
} = require("../services/stationFeatureService");
const {
  setMachineBypass,
  getMachineBypass,
  isMachineBypassEnabled,
} = require("../services/machineBypassService");
const { normalizeIp, sameIp } = require("../utils/networkAddress");
const { normalizeTimeValue, toSeconds: toShiftSeconds } = require("../utils/time");
const {
  getProductionDate,
  resolveShift,
  getShiftDurationSeconds,
  getEffectiveCycleTimeSeconds,
  computeTargetProduction,
  computeDowntimeFromLogs,
  computeOeeAndOa,
} = require("../services/metrics/productionMetricsService");
const { readPartIdFromScannerPlc } = require("../services/scannerPlcDataService");

const IO_SNAPSHOT_MIN_INTERVAL_MS = Math.max(Number(process.env.IO_SNAPSHOT_MIN_INTERVAL_MS || 2500), 1000);
const IO_SNAPSHOT_CACHE_MAX_AGE_MS = Math.max(
  Number(process.env.IO_SNAPSHOT_CACHE_MAX_AGE_MS || IO_SNAPSHOT_MIN_INTERVAL_MS * 2),
  IO_SNAPSHOT_MIN_INTERVAL_MS
);
const IO_PLC_DISCONNECT_FAILURE_THRESHOLD = Math.max(
  Number(process.env.IO_PLC_DISCONNECT_FAILURE_THRESHOLD || 3),
  1
);
const ioSnapshotCache = new Map();
const ioSnapshotInFlight = new Map();
const ioPlcConnectionStability = new Map();
const CUSTOMER_QR_ACTIVE_WINDOW_MS = Math.max(
  Number(process.env.CUSTOMER_QR_ACTIVE_WINDOW_MS || 60 * 60 * 1000),
  30 * 1000
);
const SCANNER_CONNECTION_GRACE_MS = Math.max(
  Number(process.env.SCANNER_CONNECTION_GRACE_MS || 180000),
  3000
);
const CUSTOMER_QR_ONLY_FORMAT = "CUSTOMER_QR_ONLY";
const INVALID_CUSTOMER_QR_VALUES = new Set([
  "ERROR",
  "ERR",
  "FAILED",
  "FAIL",
  "NG",
  "WAIT",
  "WAITING",
  "PENDING",
  "IN_PROGRESS",
  "RUNNING",
  "PLC_COMM_ERROR",
  "COMM_ERROR",
  "TIMEOUT",
  "NULL",
  "UNDEFINED",
]);

function normalizeStation(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function collapseRepeatedQrValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const customerQrSegments = raw.match(/R[^R]+/g);
  if (
    customerQrSegments &&
    customerQrSegments.length > 1 &&
    customerQrSegments.join("") === raw &&
    customerQrSegments.every((segment) => segment === customerQrSegments[0])
  ) {
    return customerQrSegments[0];
  }
  if (raw.length < 16) return raw;
  for (let size = Math.floor(raw.length / 2); size >= 8; size -= 1) {
    if (raw.length % size !== 0) continue;
    const token = raw.slice(0, size);
    if (token && token.repeat(raw.length / size) === raw) return token;
  }
  return raw;
}

function sanitizeCustomerQrValue(value) {
  const raw = collapseRepeatedQrValue(value);
  if (!raw || raw === "-") return "";
  if (INVALID_CUSTOMER_QR_VALUES.has(raw.toUpperCase())) return "";
  if (!/^R\d[A-Z0-9-]{10,}$/i.test(raw)) return "";
  return raw;
}

async function resolveMappedPartId(inputCode) {
  const raw = String(inputCode || "").trim();
  if (!raw) return { resolvedPartId: "", customerQrCode: null };
  if (!sanitizeCustomerQrValue(raw)) return { resolvedPartId: raw, customerQrCode: null };
  const row = await PartCodeMapping.findOne({
    where: { customer_qr: raw, is_active: true },
    order: [["updatedAt", "DESC"]],
  });
  if (!row) return { resolvedPartId: raw, customerQrCode: null };
  const customerQrCode = sanitizeCustomerQrValue(row.customer_qr || raw);
  return {
    resolvedPartId: String(row.old_part_id || raw).trim(),
    customerQrCode: customerQrCode || null,
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
  const customerQr = sanitizeCustomerQrValue(mapping?.customer_qr);
  if (formatName === CUSTOMER_QR_ONLY_FORMAT) return false;
  if (oldPartId && customerQr && oldPartId === customerQr) return false;
  return Boolean(part || mapping);
}

async function canStartCustomerQrOnlyPart({ code, stationNo, machine, stationFeatures = null }) {
  const raw = sanitizeCustomerQrValue(code);
  const station = normalizeStation(stationNo);
  if (!raw || !station || !machine || !requiresCustomerQrForCompletion(machine)) return false;
  const features = stationFeatures || await getStationFeatureConfig(station).catch(() => null);
  if (features?.allowCustomerQrOnlyStart !== true) return false;
  return !(await isKnownPartOrMappedCustomerQr(raw));
}

// true when the "customer QR" is really a Part ID: a DPM code, or the part's own ID
function isPartIdAsCustomerQr(customerQr, partId) {
  const qr = String(customerQr || "").trim();
  if (!qr) return false;
  if (partId && qr === String(partId).trim()) return false; // QR-only parts map to themselves
  return require("../tcp/scannerFlowUtils").isDpmCode(qr);
}

async function markCustomerQrOnlyMapping({ code, machine, stationNo }) {
  const raw = sanitizeCustomerQrValue(code);
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

async function saveCustomerQrOnlyStart({ code, stationNo, machine, userId = null }) {
  const station = normalizeStation(stationNo);
  const response = await saveScan(code, station, "OK", machine.id, userId, {
    resultSource: "CUSTOMER_QR_ONLY_START",
    resultInput: "OK",
    skipQrFormatValidation: true,
    skipShotValidation: true,
    skipCustomerCodeValidation: true,
    skipSequenceValidation: true,
  });
  if (response?.decision === "ALLOW") {
    await markCustomerQrOnlyMapping({ code, machine, stationNo: station });
    const finalized = await finalizeCustomerQrMappingIfEligible({
      partId: code,
      stationNo: station,
      machine,
      userId,
      stationFeatures: await getStationFeatureConfig(station).catch(() => null),
    });
    if (finalized?.finalized) {
      response.operationStatus = "ENDED_OK";
      response.plcStatus = "ENDED_OK";
      response.status = "ENDED_OK";
      response.message = "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station.";
    }
  }
  return response;
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

  const formatName = String(part?.qr_format_name || "").trim().toUpperCase();
  if (formatName === CUSTOMER_QR_ONLY_FORMAT) return true;

  const mappedOldPartId = String(mapping?.old_part_id || "").trim();
  const mappedCustomerQr = String(mapping?.customer_qr || "").trim();
  return Boolean(mappedOldPartId && mappedCustomerQr && mappedOldPartId === mappedCustomerQr);
}

async function resolvePartIdSearchValues(inputCode) {
  const raw = String(inputCode || "").trim();
  if (!raw) return [];
  const numericShot = /^\d{1,6}$/.test(raw) ? String(Number(raw)) : "";
  const shotVariants = numericShot
    ? [numericShot, numericShot.padStart(4, "0"), numericShot.padStart(5, "0"), numericShot.padStart(6, "0")]
    : [];
  const mappings = await PartCodeMapping.findAll({
    where: {
      [Op.or]: [
        { customer_qr: { [Op.like]: `%${raw}%` } },
        { old_part_id: { [Op.like]: `%${raw}%` } },
      ],
    },
    attributes: ["old_part_id", "customer_qr"],
    order: [["updatedAt", "DESC"]],
    raw: true,
  });
  return uniqueStages([
    raw,
    ...shotVariants,
    ...mappings.map((row) => String(row.old_part_id || "").trim()),
  ].filter(Boolean));
}

function buildPartIdSearchCondition(searchValues) {
  const values = Array.isArray(searchValues) ? searchValues.map((value) => String(value || "").trim()).filter(Boolean) : [];
  if (!values.length) return null;
  return { [Op.or]: values.map((value) => ({ [Op.like]: `%${value}%` })) };
}

function getMachineOperationStage(machine) {
  return normalizeStation(getModelValue(machine, "operation_no"));
}

function getModelValue(model, key) {
  if (!model || !key) return undefined;
  if (typeof model.get === "function") return model.get(key);
  if (Object.prototype.hasOwnProperty.call(model, key)) return model[key];
  return model?.dataValues?.[key];
}

function getMachineStationScope(machine) {
  return {
    plantId: getModelValue(machine, "plant_id") ?? getModelValue(machine, "plantId"),
    lineId: getModelValue(machine, "line_id") ?? getModelValue(machine, "lineId"),
  };
}

function parseMachineDataRegisterRanges(machine) {
  try {
    const parsed = machine?.plc_registers ? JSON.parse(machine.plc_registers) : {};
    const ranges = Array.isArray(parsed?.dataRegisterRanges) ? parsed.dataRegisterRanges : [];
    return ranges
      .map((row) => {
        const start = toIntegerOrNull(row?.startReg);
        const end = toIntegerOrNull(row?.endReg);
        if (start === null) return null;
        const from = start;
        const to = end === null ? start : end;
        const min = Math.min(from, to);
        const max = Math.max(from, to);
        const device = String(row?.device || parsed?.slmpDevice || machine?.plc_slmp_device || "D")
          .trim()
          .toUpperCase();
        return { min, max, device: device || "D" };
      })
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function getIoSnapshotCacheKey(machineId, plcIp) {
  return `${Number(machineId) || 0}:${normalizeIp(plcIp || "")}`;
}

function getInstantPlcConnected(plcConnection = {}) {
  const protocol = toUpper(plcConnection.protocol || "TCP_TEXT");
  if (protocol === "TCP_TEXT") {
    return Boolean(plcConnection.transportConnected);
  }
  return Boolean(plcConnection.transportConnected || plcConnection.readConnected);
}

function applyPlcConnectionStability(machineId, plcConnection = {}) {
  const key = Number(machineId || 0);
  const instantConnected = getInstantPlcConnected(plcConnection);

  if (!key) {
    return {
      connected: instantConnected,
      instantConnected,
      failureCount: instantConnected ? 0 : 1,
      holdActive: false,
    };
  }

  const previous =
    ioPlcConnectionStability.get(key) || {
      connected: false,
      failureCount: 0,
    };

  let nextConnected = previous.connected;
  let failureCount = previous.failureCount;

  if (instantConnected) {
    nextConnected = true;
    failureCount = 0;
  } else {
    failureCount = Math.max(0, Number(previous.failureCount || 0)) + 1;
    if (failureCount >= IO_PLC_DISCONNECT_FAILURE_THRESHOLD) {
      nextConnected = false;
    }
  }

  ioPlcConnectionStability.set(key, {
    connected: nextConnected,
    failureCount,
    updatedAtMs: Date.now(),
  });

  return {
    connected: nextConnected,
    instantConnected,
    failureCount,
    holdActive:
      !instantConnected &&
      nextConnected &&
      failureCount < IO_PLC_DISCONNECT_FAILURE_THRESHOLD,
  };
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

function toIntegerOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function parseRegisterToken(rawValue, fallbackDevice = null) {
  const text = String(rawValue ?? "").trim().toUpperCase();
  if (!text) {
    return { register: null, device: fallbackDevice };
  }
  const direct = Number(text);
  if (Number.isFinite(direct)) {
    return { register: Math.trunc(direct), device: fallbackDevice };
  }
  const match = text.match(/^([A-Z]+)?\s*(\d+)$/);
  if (!match) {
    return { register: null, device: fallbackDevice };
  }
  const register = Number(match[2]);
  if (!Number.isFinite(register)) {
    return { register: null, device: fallbackDevice };
  }
  return {
    register: Math.trunc(register),
    device: String(match[1] || fallbackDevice || "").trim().toUpperCase() || fallbackDevice,
  };
}

function toUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function withPlcConnectivityHint(message, { ip, port, protocol } = {}) {
  const base = String(message || "").trim() || "PLC communication failed";
  const normalized = base.toUpperCase();
  const looksLikeNetworkIssue =
    normalized.includes("CONNECT TIMEOUT") ||
    normalized.includes("ECONNREFUSED") ||
    normalized.includes("EHOSTUNREACH") ||
    normalized.includes("ENETUNREACH") ||
    normalized.includes("ETIMEDOUT") ||
    normalized.includes("UNABLE TO CONNECT");

  if (!looksLikeNetworkIssue || normalized.includes("PING MAY STILL WORK")) {
    return base;
  }

  const protocolLabel = String(protocol || "TCP_TEXT").toUpperCase();
  const endpoint =
    ip && port ? `${ip}:${port}` : ip ? String(ip) : port ? `port ${port}` : "configured PLC endpoint";
  return `${base}. Ping may still work while TCP port is blocked/unreachable. Verify ${protocolLabel} service on ${endpoint} and firewall/ACL rules.`;
}

function evaluateSignalState(signalKey, value, machine, latestPlcStatus) {
  const startValue = toIntegerOrNull(machine?.plc_start_value) ?? 1;
  const startedValue = toIntegerOrNull(machine?.plc_started_value) ?? 2;
  const endOkValue = toIntegerOrNull(machine?.plc_end_ok_value) ?? 3;
  const endNgValue = toIntegerOrNull(machine?.plc_end_ng_value) ?? 4;
  const resetValue = toIntegerOrNull(machine?.plc_reset_value) ?? 9;

  if (value === null || value === undefined) {
    if (latestPlcStatus === "PLC_COMM_ERROR") {
      return { status: "COMM_ERROR", tone: "error" };
    }
    return { status: "NO_DATA", tone: "muted" };
  }

  if (signalKey === "TRIGGER") {
    if (value === startValue) {
      return { status: "TRIGGERED", tone: "good" };
    }
    if (value === 0) {
      return { status: "IDLE", tone: "idle" };
    }
    return { status: "VALUE_MISMATCH", tone: "warn" };
  }

  if (signalKey === "INTERLOCK") {
    if (value === endOkValue) {
      return { status: "PASS", tone: "good" };
    }
    if (value === endNgValue) {
      return { status: "FAIL", tone: "error" };
    }
    if (value === startedValue) {
      return { status: "STARTED", tone: "warn" };
    }
    if (value === 0) {
      return { status: "WAIT", tone: "idle" };
    }
    return { status: `RAW_${value}`, tone: "warn" };
  }

  if (signalKey === "COMPLETE") {
    if (value === endOkValue) {
      return { status: "PASS", tone: "good" };
    }
    if (value === endNgValue) {
      return { status: "FAIL", tone: "error" };
    }
    if (value === startedValue) {
      return { status: "IN_PROGRESS", tone: "warn" };
    }
    if (value === 0) {
      return { status: "WAIT", tone: "idle" };
    }
    return { status: `RAW_${value}`, tone: "warn" };
  }

  if (signalKey === "RESET") {
    if (value === resetValue) {
      return { status: "RESET_REQUESTED", tone: "warn" };
    }
    if (value === 0) {
      return { status: "IDLE", tone: "idle" };
    }
    return { status: "ACTIVE", tone: "warn" };
  }

  return { status: `RAW_${value}`, tone: "warn" };
}

function normalizeSignalDirection(value, fallback = "PLC -> PC") {
  const normalized = String(value || "").trim().toUpperCase();
  if (["PC_TO_PLC", "PC->PLC", "PC -> PLC", "WRITE"].includes(normalized)) {
    return "PC -> PLC";
  }
  if (["PLC_TO_PC", "PLC->PC", "PLC -> PC", "READ"].includes(normalized)) {
    return "PLC -> PC";
  }
  if (["BIDIRECTIONAL", "BI", "BOTH"].includes(normalized)) {
    return "BIDIRECTIONAL";
  }
  return fallback;
}

function normalizeHandshakeDirectionToSignalDirection(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (["WRITE", "PC -> PLC", "PC_TO_PLC", "PC->PLC"].includes(normalized)) return "PC -> PLC";
  if (["BOTH", "BIDIRECTIONAL", "PLC<->PC", "PLC <-> PC"].includes(normalized)) return "BIDIRECTIONAL";
  return "PLC -> PC";
}

function normalizeFrameMode(value, fallback = "AUTO") {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (["AUTO", "ASCII", "BINARY"].includes(normalized)) return normalized;
  return fallback;
}

function parseMachineHandshakeMap(machine) {
  if (!machine?.plc_registers) return [];
  try {
    const snapshot = typeof machine.plc_registers === "string" ? JSON.parse(machine.plc_registers) : machine.plc_registers;
    const rows = Array.isArray(snapshot?.handshakeMap) ? snapshot.handshakeMap : [];
    return rows
      .map((row) => {
        const parsedRegister = parseRegisterToken(row?.register ?? row?.registerNo ?? row?.address, null);
        return {
          signal: String(row?.signal || row?.label || "").trim(),
          register: parsedRegister.register,
          device: parsedRegister.device,
          direction: normalizeHandshakeDirectionToSignalDirection(row?.direction),
          meaning: String(row?.meaning || row?.purpose || row?.description || "").trim() || null,
          frameMode: normalizeFrameMode(row?.frameMode ?? row?.slmpFrameMode, "AUTO"),
        };
      })
      .filter((row) => row.signal && row.register !== null);
  } catch (_error) {
    return [];
  }
}

function getDefaultIoSignals(machine) {
  return [
    {
      key: "TRIGGER",
      label: "TRIGGER",
      register: toIntegerOrNull(machine?.plc_start_register),
      direction: "PC -> PLC",
      writable: true,
      description: "Start command written by software to PLC",
    },
    {
      key: "INTERLOCK",
      label: "INTERLOCK",
      register: toIntegerOrNull(machine?.plc_status_register),
      direction: "PLC -> PC",
      writable: false,
      description: "Handshake status read by software from PLC",
    },
    {
      key: "COMPLETE",
      label: "STATION_HASH",
      register: toIntegerOrNull(machine?.plc_station_register),
      direction: "PC -> PLC",
      writable: true,
      description: "Optional station/hash payload written by software",
    },
    {
      key: "RESET",
      label: "RESET",
      register: toIntegerOrNull(machine?.plc_reset_register),
      direction: "PC -> PLC",
      writable: true,
      description: "Reset command written by software to PLC",
    },
  ];
}

function parseMachineSignalMap(machine) {
  const normalized = [];
  const seen = new Set();
  const seenRegisters = new Set();

  const addSignal = (row, deduplicateRegister = false) => {
    if (seen.has(row.key)) return;
    const regNo = toIntegerOrNull(row.register);
    if (deduplicateRegister && regNo !== null && seenRegisters.has(regNo)) return;
    seen.add(row.key);
    if (regNo !== null) seenRegisters.add(regNo);
    normalized.push(row);
  };

  // 1. Core Map (plc_signal_map)
  const raw = machine?.plc_signal_map;
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch (e) { }
  }
  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.entries(parsed).map(([key, value]) => ({ key, ...(value || {}) }))
      : [];

  for (const row of source) {
    const key = toUpper(row?.key || row?.signal || row?.name);
    if (!key) continue;
    const direction = normalizeSignalDirection(
      row?.direction,
      ["TRIGGER", "RESET"].includes(key) ? "PC -> PLC" : "PLC -> PC"
    );
    const explicitDevice = String(row?.device || "").trim().toUpperCase() || null;
    const parsedRegister = parseRegisterToken(row?.register ?? row?.registerNo ?? row?.address, explicitDevice);
    addSignal({
      key,
      label: String(row?.label || key).trim() || key,
      register: parsedRegister.register,
      device: parsedRegister.device || explicitDevice,
      direction,
      writable: row?.writable === undefined ? direction !== "PLC -> PC" : Boolean(row.writable),
      description: String(row?.description || "").trim() || "Configured signal mapping",
      frameMode: normalizeFrameMode(row?.frameMode ?? row?.slmpFrameMode, "AUTO"),
    });
  }

  // 2. Handshake Map (plc_handshake_map)
  const handshakeRows = parseMachineHandshakeMap(machine);
  for (const row of handshakeRows) {
    const signalToken = toUpper(row.signal).replace(/[^A-Z0-9]+/g, "_");
    if (!signalToken) continue;
    const key = `HS_${signalToken}`;
    addSignal({
      key,
      label: row.signal,
      register: row.register,
      device: row.device || null,
      direction: row.direction,
      writable: row.direction !== "PLC -> PC",
      description: row.meaning || "Configured handshake signal",
      frameMode: normalizeFrameMode(row.frameMode, "AUTO"),
    });
  }

  // 3. Fallback Defaults (getDefaultIoSignals)
  // Ensure core signals exist, but do not override custom mappings!
  const defaults = getDefaultIoSignals(machine);
  for (const def of defaults) {
    addSignal(def, true);
  }

  return normalized;
}

function buildIoSignalRows(machine, registerValues, latestPlcStatus) {
  const signalMap = parseMachineSignalMap(machine);

  return signalMap.map((entry) => {
    const currentValue =
      entry.register !== null && registerValues && Object.prototype.hasOwnProperty.call(registerValues, entry.register)
        ? registerValues[entry.register]
        : null;
    const state = entry.register === null
      ? { status: "NOT_CONFIGURED", tone: "muted" }
      : evaluateSignalState(entry.key, currentValue, machine, latestPlcStatus);
    return {
      signalKey: entry.key,
      signal: entry.label,
      register: entry.register,
      device: entry.device || null,
      direction: entry.direction,
      writable: Boolean(entry.writable),
      frameMode: normalizeFrameMode(entry.frameMode, "AUTO"),
      currentValue,
      status: state.status,
      tone: state.tone,
      description: entry.description,
    };
  });
}

async function resolveMachineFromRequest(body, req) {
  if (body.machineId) {
    return Machine.findByPk(body.machineId);
  }

  const explicitScannerIp = normalizeIp(body.scannerIp);
  const clientIp =
    explicitScannerIp || normalizeIp(req.ip) || normalizeIp(req.socket?.remoteAddress) || normalizeIp(req.connection?.remoteAddress);

  const scanner = await Scanner.findOne({
    where: { scanner_ip: clientIp, is_active: true },
  });
  if (scanner) {
    const mapped = await Machine.findByPk(scanner.mapped_machine_id);
    if (mapped) {
      return mapped;
    }
  }

  return Machine.findOne({
    where: {
      [Op.or]: [{ machine_ip: clientIp }, { plc_ip: clientIp }, { qr_scanner_ip: clientIp }],
      is_active: true,
    },
  });
}

async function resolveScannerFromRequest({ machine, body, req }) {
  const explicitScannerIp = normalizeIp(body?.scannerIp);
  const sourceIp = explicitScannerIp || normalizeIp(body?.sourceIp) || normalizeIp(req?.ip) || normalizeIp(req?.socket?.remoteAddress);
  if (sourceIp) {
    const byIp = await Scanner.findOne({
      where: {
        scanner_ip: sourceIp,
        is_active: true,
      },
      order: [["updatedAt", "DESC"]],
    });
    if (byIp) return byIp;
  }

  if (machine?.id) {
    return Scanner.findOne({
      where: {
        mapped_machine_id: machine.id,
        is_active: true,
      },
      order: [["updatedAt", "DESC"]],
    });
  }
  return null;
}

async function enforceScannerProtocolBinding({ machine, body, req, scanner }) {
  if (!machine) return { ok: false, status: 404, error: "Machine not found" };
  const requestSourceIp = normalizeIp(
    body?.scannerIp || body?.systemIp || body?.sourceIp || req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress || ""
  );
  if (!requestSourceIp) return { ok: false, status: 400, error: "Source IP not detected" };

  const isLoopbackSource = ["::1", "127.0.0.1", "localhost"].includes(String(requestSourceIp || "").toLowerCase());
  let resolvedScanner = scanner || await resolveScannerFromRequest({ machine, body, req });
  if (!resolvedScanner && isLoopbackSource) {
    resolvedScanner = await Scanner.findOne({
      where: { mapped_machine_id: machine.id, is_active: true },
      order: [["updatedAt", "DESC"]],
    });
  }
  if (!resolvedScanner) {
    return { ok: false, status: 403, error: `No active scanner mapped for source IP ${requestSourceIp}` };
  }

  const scannerMode = String(resolvedScanner.scanner_mode || "TCP_CLIENT").trim().toUpperCase();
  const scannerIp = normalizeIp(resolvedScanner.scanner_ip);

  if (!isLoopbackSource && !sameIp(scannerIp, requestSourceIp)) {
    return {
      ok: false,
      status: 403,
      error: `Scanner source IP mismatch. Expected ${scannerIp}, got ${requestSourceIp}`,
    };
  }

  if (Number(resolvedScanner.mapped_machine_id) !== Number(machine.id)) {
    return {
      ok: false,
      status: 403,
      error: `Scanner-machine mismatch. Scanner mapped to machine ${resolvedScanner.mapped_machine_id}, request machine ${machine.id}`,
    };
  }

  // Mode-specific hard guard: USB scans must come from mapped tablet/scanner IP only.
  if (scannerMode === "USB_SERIAL" && !isLoopbackSource && !sameIp(scannerIp, requestSourceIp)) {
    return {
      ok: false,
      status: 403,
      error: `USB source mismatch. Expected tablet/scanner IP ${scannerIp}, got ${requestSourceIp}`,
    };
  }

  return {
    ok: true,
    scanner: resolvedScanner,
    scannerMode,
    sourceIp: requestSourceIp,
  };
}

async function enforceScannerRoleIfConfigured({ machine, sourceIp, allowedRoles = [] }) {
  const srcIp = normalizeIp(sourceIp || "");
  if (!machine || !srcIp) return { ok: true };
  const normalizedRoles = Array.isArray(allowedRoles)
    ? allowedRoles
      .map((role) => String(role || "").trim().toUpperCase())
      .filter(Boolean)
    : [];
  if (normalizedRoles.length === 0) {
    return { ok: true };
  }
  const roleScanners = await Scanner.findAll({
    where: { mapped_machine_id: machine.id, is_active: true },
  });
  const scopedRoleScanners = roleScanners.filter(
    (s) => normalizedRoles.includes(String(s.scanner_role || "").trim().toUpperCase())
  );
  if (scopedRoleScanners.length === 0) return { ok: true };
  const matched = scopedRoleScanners.some((s) => sameIp(s.scanner_ip, srcIp));
  if (!matched) {
    return {
      ok: false,
      status: 403,
      error: `Scan source is not authorized for scanner role ${normalizedRoles.join("/")}`,
    };
  }
  return { ok: true };
}

async function resolveActivePartIdForMachine(machine, stationNo) {
  if (!machine) {
    return "";
  }

  const machineRunningPartId = String(machine.running_part_id || "").trim();
  const machineRunningStation = normalizeStation(machine.running_station_no);
  const targetStation = normalizeStation(stationNo);
  const activeStatuses = ["PENDING", "STARTED", "RUNNING", "WAITING_PLC", "START_SENT", "WAITING_RUNNING"];
  const mappingCandidateStatuses = requiresCustomerQrForCompletion(machine)
    ? [...activeStatuses, "ENDED_OK"]
    : activeStatuses;
  const freshCutoff = new Date(Date.now() - CUSTOMER_QR_ACTIVE_WINDOW_MS);

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
    if (matchingActiveLog) {
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
    limit: 5,
  });

  const uniquePartIds = [...new Set(
    activeLogs
      .map((log) => String(log.part_id || "").trim())
      .filter(Boolean)
  )];

  if (uniquePartIds.length === 1) {
    return uniquePartIds[0];
  }

  return resolveLatestUnmappedCustomerQrPartForMachine({
    machine,
    stationNo: targetStation,
    freshCutoff,
    candidateLogs: activeLogs,
    mappingCandidateStatuses,
  });
}

async function resolveLatestUnmappedCustomerQrPartForMachine({
  machine,
  stationNo,
  freshCutoff,
  candidateLogs = [],
  mappingCandidateStatuses = [],
}) {
  if (!machine || !requiresCustomerQrForCompletion(machine)) {
    return "";
  }

  const targetStation = normalizeStation(stationNo);
  const logs = candidateLogs.length
    ? candidateLogs
    : await OperationLog.findAll({
        where: {
          machine_id: machine.id,
          ...(targetStation ? { station_no: targetStation } : {}),
          plc_status: { [Op.in]: mappingCandidateStatuses.length ? mappingCandidateStatuses : ["PENDING", "STARTED", "RUNNING", "WAITING_PLC", "START_SENT", "WAITING_RUNNING", "ENDED_OK"] },
          result: "OK",
          updatedAt: { [Op.gte]: freshCutoff || new Date(Date.now() - CUSTOMER_QR_ACTIVE_WINDOW_MS) },
        },
        attributes: ["id", "part_id", "updatedAt"],
        order: [["updatedAt", "DESC"]],
        limit: 20,
      });

  const candidatePartIds = [...new Set(
    logs
      .map((log) => String(log.part_id || "").trim())
      .filter(Boolean)
  )];
  if (!candidatePartIds.length) {
    return "";
  }

  const existingMappings = await PartCodeMapping.findAll({
    where: {
      is_active: true,
      old_part_id: { [Op.in]: candidatePartIds },
    },
    attributes: ["old_part_id"],
  });
  const mappedPartIds = new Set(
    existingMappings
      .map((row) => String(row.old_part_id || "").trim().toUpperCase())
      .filter(Boolean)
  );

  const latestUnmapped = logs.find((log) => {
    const partId = String(log.part_id || "").trim();
    return partId && !mappedPartIds.has(partId.toUpperCase());
  });

  return latestUnmapped ? String(latestUnmapped.part_id || "").trim() : "";
}

async function getActiveStationSequence() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    order: [["sequence_no", "ASC"]],
  });

  return uniqueStages(machines.map((machine) => getMachineOperationStage(machine)));
}

async function getActiveMachineSequenceData() {
  const machines = await Machine.findAll({
    where: { is_active: true },
    order: [["sequence_no", "ASC"]],
  });

  const sequence = uniqueStages(machines.map((machine) => getMachineOperationStage(machine)));
  const stationMachineMap = machines.reduce((acc, machine) => {
    const station = getMachineOperationStage(machine);
    if (!station) {
      return acc;
    }
    if (!acc[station]) {
      acc[station] = [];
    }
    acc[station].push(machine.id);
    return acc;
  }, {});

  return { machines, sequence, stationMachineMap };
}

function toJourneyRow(log) {
  return {
    id: log.id,
    stationNo: normalizeStation(log.station_no || log.operation_no),
    plcStatus: log.plc_status,
    plcStartTime: log.plc_start_time || log.plc_start_at,
    plcEndTime: log.plc_end_time || log.plc_end_at,
    result: log.result,
    resultSource: log.result_source || null,
    resultInput: log.result_input || null,
    qualityPayload: null,
    interlockReason: log.interlock_reason,
    machineId: log.machine_id,
    isBypassed: Boolean(log.is_bypassed),
    bypassReason: log.bypass_reason,
    createdAt: log.createdAt,
  };
}

const JOURNEY_NOISE_REASONS = new Set([
  "DUPLICATE_SCAN",
  "DUPLICATE_SCAN_IN_FLIGHT",
  "ALREADY_COMPLETED",
  "PREVIOUS_STATION_NOT_COMPLETED",
  "INVALID_QR_FORMAT",
  "QR_RULE_CONFIG_ERROR",
  "STATION_NOT_CONFIGURED",
  "PART_NOT_FOUND",
  "CUSTOMER_CODE_INVALID",
  "CUSTOMER_CODE_RULE_INVALID",
  "INVALID_INPUT",
  "VALIDATION_ERROR",
  "ALREADY_SCANNED",
]);

const CUSTOMER_QR_WAITING_MACHINE_TYPES = new Set(["LASER"]);
const CUSTOMER_QR_WAITING_EXCLUDED_TOKENS = ["FINAL_INSPECTION", "FINAL INSPECTION", "FINAL STATION", "PDI", "PACKING", "PACKAGING", "DISPATCH"];

function requiresCustomerQrForCompletion(machine = {}) {
  const machineType = String(getModelValue(machine, "machine_type") || getModelValue(machine, "machineType") || "").trim().toUpperCase();
  const tokens = [
    getModelValue(machine, "operation_no"),
    getModelValue(machine, "machine_name"),
  ].map((value) => String(value || "").trim().toUpperCase());
  if (tokens.some((token) => CUSTOMER_QR_WAITING_EXCLUDED_TOKENS.some((excluded) => token === excluded || token.includes(excluded)))) {
    return false;
  }
  return CUSTOMER_QR_WAITING_MACHINE_TYPES.has(machineType);
}

async function getStationBypassMetaForJourney(stationNo, machines = []) {
  const station = normalizeStation(stationNo);
  if (!station) {
    return { bypassed: false, reason: null };
  }

  const features = await getStationFeatureConfig(station).catch(() => null);
  if (features?.operation === false) {
    return { bypassed: true, reason: "STATION_OPERATION_DISABLED_AUTO_OK" };
  }
  if (features?.bypass === true || features?.bypassEnabled === true) {
    return { bypassed: true, reason: "STATION_BYPASS_AUTO_OK" };
  }

  const stationMachines = (Array.isArray(machines) ? machines : [])
    .filter((machine) => getMachineOperationStage(machine) === station);
  const allMachinesBypassed = stationMachines.length > 0 && stationMachines.every((machine) => {
    const machineId = getModelValue(machine, "id");
    return getModelValue(machine, "bypass_enabled") === true || isMachineBypassEnabled(machineId);
  });

  return {
    bypassed: allMachinesBypassed,
    reason: allMachinesBypassed ? "MACHINE_BYPASS_AUTO_OK" : null,
  };
}

async function shouldBlockMappedCustomerQrOnStartScan(stationNo) {
  const station = normalizeStation(stationNo);
  if (!station) return false;
  const sequenceData = await getActiveMachineSequenceData();
  const sequence = Array.isArray(sequenceData?.sequence) ? sequenceData.sequence : [];
  const currentIndex = sequence.indexOf(station);
  const customerQrStationIndex = sequence.findIndex((candidateStation) => {
    const machines = (sequenceData?.machines || []).filter((machine) => getMachineOperationStage(machine) === candidateStation);
    return machines.some((machine) => requiresCustomerQrForCompletion(machine));
  });
  if (customerQrStationIndex < 0) return true;
  if (currentIndex < 0) return false;
  return currentIndex <= customerQrStationIndex;
}

function wrongCustomerQrAtStartMessage(stationNo) {
  return `Wrong QR scanned at ${normalizeStation(stationNo) || "this station"}. Scan Part Serial/Casting QR here. Customer QR is allowed only after Laser Marking.`;
}

function matchesConfiguredCustomerQrPattern(code, pattern) {
  const raw = sanitizeCustomerQrValue(code);
  const configuredPattern = String(pattern || "").trim();
  if (!raw || !configuredPattern) return false;
  try {
    return new RegExp(configuredPattern, "i").test(raw);
  } catch (_error) {
    return false;
  }
}

function isCustomerQrFormatName(formatName) {
  const name = String(formatName || "").trim().toUpperCase();
  return name.includes("CUSTOMER") && name.includes("QR") && name !== CUSTOMER_QR_ONLY_FORMAT;
}

async function matchesActiveCustomerQrRule(code) {
  const raw = sanitizeCustomerQrValue(code);
  if (!raw) return false;
  const rules = await QrFormatRule.findAll({
    where: { is_active: true },
    attributes: ["format_name", "regex_pattern"],
    raw: true,
  }).catch(() => []);

  return rules.some((rule) => {
    if (!isCustomerQrFormatName(rule.format_name)) return false;
    const pattern = String(rule.regex_pattern || "").trim();
    if (!pattern) return false;
    try {
      return new RegExp(pattern, "i").test(raw);
    } catch (_error) {
      return false;
    }
  });
}

async function getCustomerQrMappingStationMeta(sequenceData = null) {
  const data = sequenceData || await getActiveMachineSequenceData();
  const sequence = Array.isArray(data?.sequence) ? data.sequence : [];
  for (const candidateStation of sequence) {
    const machines = (data?.machines || []).filter((machine) => getMachineOperationStage(machine) === candidateStation);
    const mappingMachine = machines.find((machine) => requiresCustomerQrForCompletion(machine));
    if (!mappingMachine) continue;
    const features = await getStationFeatureConfig(candidateStation, getMachineStationScope(mappingMachine)).catch(() => null);
    return {
      stationNo: candidateStation,
      machine: mappingMachine,
      customerCodePattern: String(features?.customerCodePattern || "").trim(),
    };
  }
  return null;
}

async function isAfterCustomerQrMappingStation(stationNo) {
  const station = normalizeStation(stationNo);
  if (!station) return false;
  const sequenceData = await getActiveMachineSequenceData();
  const sequence = Array.isArray(sequenceData?.sequence) ? sequenceData.sequence : [];
  const currentIndex = sequence.indexOf(station);
  const customerQrStationIndex = sequence.findIndex((candidateStation) => {
    const machines = (sequenceData?.machines || []).filter((machine) => getMachineOperationStage(machine) === candidateStation);
    return machines.some((machine) => requiresCustomerQrForCompletion(machine));
  });
  return currentIndex >= 0 && customerQrStationIndex >= 0 && currentIndex > customerQrStationIndex;
}

async function shouldBlockUnknownQrAfterLaser({ code, stationNo }) {
  const raw = String(code || "").trim();
  if (!raw) return false;
  const station = normalizeStation(stationNo);
  if (!station) return false;
  const sequenceData = await getActiveMachineSequenceData();
  const sequence = Array.isArray(sequenceData?.sequence) ? sequenceData.sequence : [];
  const currentIndex = sequence.indexOf(station);
  const customerQrMeta = await getCustomerQrMappingStationMeta(sequenceData);
  const customerQrStationIndex = customerQrMeta?.stationNo ? sequence.indexOf(customerQrMeta.stationNo) : -1;
  if (currentIndex < 0 || customerQrStationIndex < 0 || currentIndex <= customerQrStationIndex) return false;

  const mapping = await PartCodeMapping.findOne({
    where: { customer_qr: raw, is_active: true },
    attributes: ["id"],
    order: [["updatedAt", "DESC"]],
  });
  if (mapping) return false;

  return matchesConfiguredCustomerQrPattern(raw, customerQrMeta?.customerCodePattern) || await matchesActiveCustomerQrRule(raw);
}

async function unknownQrAfterLaserMessage(stationNo, code = "") {
  const customerQrMeta = await getCustomerQrMappingStationMeta().catch(() => null);
  if (
    matchesConfiguredCustomerQrPattern(code, customerQrMeta?.customerCodePattern) ||
    await matchesActiveCustomerQrRule(code)
  ) {
    return `${normalizeStation(stationNo) || "This station"}: Customer QR is not mapped. Complete Customer QR mapping at ${customerQrMeta?.stationNo || "OP110"} first.`;
  }
  const sequence = await getActiveStationSequence().catch(() => []);
  const firstStation = normalizeStation(sequence?.[0]);
  const currentStation = normalizeStation(stationNo) || "This station";
  return firstStation
    ? `${currentStation}: Part not found. Scan this part at first station ${firstStation} first.`
    : `${currentStation}: Part not found. Scan this part at first station first.`;
}

function isJourneyNoiseLog(log) {
  if (!log) return false;
  const plcStatus = String(log.plc_status || "").trim().toUpperCase();
  const validationResult = String(log.validation_result || "").trim().toUpperCase();
  const reason = String(log.interlock_reason || "").trim().toUpperCase();
  const result = String(log.result || "").trim().toUpperCase();

  if (Boolean(log.is_bypassed)) return !(result === "OK" || plcStatus === "ENDED_OK");
  if (plcStatus === "VALIDATION_ONLY") return true;
  if (["FAILED", "DUPLICATE", "BLOCKED"].includes(validationResult)) return true;
  if (JOURNEY_NOISE_REASONS.has(reason)) return true;

  if (plcStatus === "INTERLOCKED") {
    if (validationResult === "DUPLICATE" || validationResult === "BLOCKED") return true;
    if (result === "BLOCK") return true;
  }

  return false;
}

function shouldTreatRecoveryPendingAsPassed(log, mappedCustomerQr) {
  const plcStatus = String(log?.plc_status || "").trim().toUpperCase();
  const result = String(log?.result || "").trim().toUpperCase();
  const reason = String(log?.interlock_reason || "").trim().toUpperCase();

  return (
    Boolean(mappedCustomerQr) &&
    result === "OK" &&
    ["PENDING", "PLC_COMM_ERROR", "STARTED"].includes(plcStatus) &&
    reason === "RECOVERY_PENDING_AFTER_BACKEND_RESTART"
  );
}

function getEffectiveOperationOutcome(log, mappedCustomerQr = null) {
  const plcStatus = String(log?.plc_status || "").trim().toUpperCase();
  const result = String(log?.result || "").trim().toUpperCase();

  if (shouldTreatRecoveryPendingAsPassed(log, mappedCustomerQr)) {
    return "OK";
  }
  if (plcStatus === "ENDED_OK" && result === "OK") {
    return "OK";
  }
  if (plcStatus === "ENDED_NG" || result === "NG") {
    return "NG";
  }
  if (plcStatus === "INTERLOCKED" || plcStatus === "BLOCKED") {
    return "INTERLOCKED";
  }
  if (plcStatus === "PLC_COMM_ERROR") {
    return "COMM_ERROR";
  }
  if (plcStatus === "PENDING" || plcStatus === "STARTED" || plcStatus === "RUNNING" || plcStatus === "IN_PROGRESS") {
    return "IN_PROGRESS";
  }
  return "";
}

// One row per part ID: its latest scan (by updatedAt, else createdAt).
function latestOperationRowPerPart(rows) {
  const latestByPart = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const partKey = String(row?.part_id || row?.partId || "").trim().toUpperCase();
    if (!partKey) continue;
    const rowTime = new Date(row?.updatedAt || row?.createdAt || 0).getTime() || 0;
    const existing = latestByPart.get(partKey);
    const existingTime = existing ? (new Date(existing.updatedAt || existing.createdAt || 0).getTime() || 0) : -1;
    if (!existing || rowTime >= existingTime) {
      latestByPart.set(partKey, row);
    }
  }
  return [...latestByPart.values()];
}

// OK / NG of one leak tester in [range.from, range.to) (and shift), from the leak results stored on the report rows
// (leak_data.matchedMachineId, result time = cycleEndTime, plant time written with "Z") — the same rows and filters
// the Rejection Analysis / Dashboard leak counts use (valid scans, newest report row per part).
// OK / NG per machine for [range.from, range.to]: the latest OK / NG scan of each part at that machine decides it,
// counted in the shift of that scan (same rule as the Historical gate view and the Operator page). Leak testers
// (OP150) use their leak results (leakMachineResultCounts). Returns Map(machineId -> { ok, ng }).
async function machineDecisiveCounts(machines, range, shiftCode, shifts = []) {
  const PD = require("../utils/productionDay");
  const out = new Map();
  const list = (machines || []).filter((m) => Number(m.id) > 0);
  const isLeak = (m) => String(m.operation_no || m.operationNo || "").trim().toUpperCase() === "OP150";
  const ids = list.filter((m) => !isLeak(m)).map((m) => Number(m.id));
  const shiftSql = PD.shiftCaseSql("createdAt", shifts);
  const shiftFilter = shiftCode ? ` AND ${shiftSql} = :shift` : "";
  if (ids.length) {
    const rows = await sequelize.query(`
      SELECT machine_id, SUM(CASE WHEN r = 'OK' THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN r = 'NG' THEN 1 ELSE 0 END) AS ng
        FROM (SELECT o.machine_id, UPPER(o.result) AS r, o.createdAt,
                     -- a part scanned under its customer QR and its part ID counts once (customer QR → part ID)
                     ROW_NUMBER() OVER (PARTITION BY COALESCE(al.old_part_id, o.part_id), o.machine_id ORDER BY o.createdAt DESC, o.id DESC) AS rn
                FROM OperationLogs o
                OUTER APPLY (SELECT TOP 1 m.old_part_id FROM PartCodeMappings m
                              WHERE m.customer_qr = o.part_id AND m.is_active = 1 AND m.old_part_id <> m.customer_qr
                                AND o.part_id LIKE '%[^0-9]%') al
               WHERE o.createdAt >= :from AND o.createdAt <= :to AND o.machine_id IN (:ids)
                 AND UPPER(o.result) IN ('OK', 'NG') AND LEN(o.part_id) >= 7
                 -- reports' part-ID rule: 13-digit DPM or a customer QR (20–32 chars, starts with a letter)
                 AND ((o.part_id NOT LIKE '%[^0-9]%' AND LEN(o.part_id) = 13)
                      OR (o.part_id LIKE '[A-Za-z]%' AND LEN(o.part_id) BETWEEN 20 AND 32))) x
       WHERE rn = 1${shiftFilter}
       GROUP BY machine_id`, {
      replacements: { from: range.from, to: range.to, ids, shift: shiftCode ? String(shiftCode).trim().toUpperCase() : null },
      type: sequelize.QueryTypes.SELECT,
    });
    for (const id of ids) out.set(id, { ok: 0, ng: 0 });
    for (const r of rows) out.set(Number(r.machine_id), { ok: Number(r.ok || 0), ng: Number(r.ng || 0) });
  }
  const leakTo = new Date(new Date(range.to).getTime() + 1);
  await Promise.all(list.filter(isLeak).map(async (m) => {
    out.set(Number(m.id), await leakMachineResultCounts(Number(m.id), { from: range.from, to: leakTo }, shiftCode, shifts));
  }));
  return out;
}

async function leakMachineResultCounts(machineId, range, shiftCode, shifts = []) {
  const PD = require("../utils/productionDay");
  const leakJson = (path) => `(CASE WHEN ISJSON(leak_data) = 1 THEN JSON_VALUE(leak_data, '${path}') END)`;
  const leakTime = `TODATETIMEOFFSET(DATEADD(MINUTE, -${PD.PLANT_OFFSET_MIN}, TRY_CAST(${leakJson("$.cycleEndTime")} AS datetime2)), 0)`;
  const rows = await sequelize.query(`
    SELECT UPPER(${leakJson("$.result")}) AS result, ${leakTime} AS at
      FROM [RICO_IOT].[dbo].[ProductionReports]
     WHERE ${PD.VALID_SCAN_SQL} AND ${PD.notStaleRowSql("id")}
       AND ${leakJson("$.matchedMachineId")} = :mid AND ${leakJson("$.result")} IS NOT NULL
       AND ${leakTime} >= :from AND ${leakTime} < :to
       AND first_scan_at < :to AND first_scan_at >= DATEADD(DAY, -60, CAST(:from AS datetimeoffset))`,
  { replacements: { mid: String(machineId), from: range.from, to: range.to }, type: sequelize.QueryTypes.SELECT });
  const OK = new Set(["OK", "PASS", "PASSED", "ENDED_OK", "COMPLETED_OK"]);
  const NG = new Set(["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"]);
  const target = shiftCode ? normalizeShiftAlias(shiftCode) : "";
  const out = { ok: 0, ng: 0 };
  for (const r of rows) {
    if (target && normalizeShiftAlias(PD.shiftCodeAt(new Date(r.at), shifts) || "") !== target) continue;
    const res = String(r.result || "").trim();
    if (OK.has(res)) out.ok += 1;
    else if (NG.has(res)) out.ng += 1;
  }
  return out;
}

function getQualitySummaryFromOperationLogs(rows, getMappedCustomerQr = null) {
  const summary = {
    okCount: 0,
    ngCount: 0,
    interlockedCount: 0,
    commErrorCount: 0,
    inProgressCount: 0,
  };

  for (const row of latestOperationRowPerPart(rows)) {
    const mappedCustomerQr = typeof getMappedCustomerQr === "function" ? getMappedCustomerQr(row) : null;
    const effectiveOutcome = getEffectiveOperationOutcome(row, mappedCustomerQr);

    if (effectiveOutcome === "OK") {
      summary.okCount += 1;
      continue;
    }
    if (effectiveOutcome === "NG") {
      summary.ngCount += 1;
      continue;
    }
    if (effectiveOutcome === "INTERLOCKED") {
      summary.interlockedCount += 1;
      continue;
    }
    if (effectiveOutcome === "COMM_ERROR") {
      summary.commErrorCount += 1;
      continue;
    }
    if (effectiveOutcome === "IN_PROGRESS") {
      summary.inProgressCount += 1;
    }
  }

  const processedCount = summary.okCount + summary.ngCount;
  const accuracy = processedCount > 0 ? Number(((summary.okCount / processedCount) * 100).toFixed(2)) : 0;

  return {
    ...summary,
    processedCount,
    accuracy,
  };
}

function isInProgressPlcStatus(value) {
  const normalized = toUpper(value);
  return normalized === "STARTED" || normalized === "PENDING";
}

function isJourneyPassedAttempt(attempt = {}) {
  const plcStatus = toUpper(attempt.plcStatus || attempt.plc_status);
  const result = toUpper(attempt.result);
  return (
    ["ENDED_OK", "COMPLETED_OK", "PASSED"].includes(plcStatus) ||
    (plcStatus === "OK" && (!result || ["OK", "PASS", "PASSED"].includes(result))) ||
    (["OK", "PASS", "PASSED"].includes(result) && !["ENDED_NG", "COMPLETED_NG", "NG", "FAILED"].includes(plcStatus))
  );
}

function isJourneyFailedAttempt(attempt = {}) {
  const plcStatus = toUpper(attempt.plcStatus || attempt.plc_status);
  const result = toUpper(attempt.result);
  return ["ENDED_NG", "COMPLETED_NG", "NG", "FAILED"].includes(plcStatus) || ["NG", "FAIL", "FAILED"].includes(result);
}

function resolveCurrentOperationForMachine(logs, machine) {
  if (!Array.isArray(logs) || logs.length === 0 || !machine) {
    return null;
  }

  if (!Boolean(machine.is_running)) {
    return null;
  }

  const runningPartId = String(machine.running_part_id || "").trim();
  const runningStation = normalizeStation(machine.running_station_no);
  return (
    logs.find((row) => {
      if (!isInProgressPlcStatus(row?.plc_status)) {
        return false;
      }
      if (runningPartId && String(row?.part_id || "").trim() !== runningPartId) {
        return false;
      }
      if (runningStation) {
        const rowStation = normalizeStation(row?.station_no || row?.operation_no);
        if (rowStation !== runningStation) {
          return false;
        }
      }
      return true;
    }) || null
  );
}

async function getLatestOperationLog(partId, stationNo) {
  const station = normalizeStation(stationNo);
  const logs = await OperationLog.findAll({
    where: {
      part_id: partId,
      station_no: station,
    },
    order: [["createdAt", "DESC"]],
  });

  if (!logs.length) return null;

  // Prioritize quality outcomes (NG/PASS) over administrative blocks (DUPLICATE/SEQUENCE).
  // NG wins because a later/parallel OK must not hide a failed quality gate.
  const success = logs.find(l => ["ENDED_OK", "PASSED", "OK"].includes(toUpper(l.plc_status)) || ["PASS", "OK"].includes(toUpper(l.result)));
  const ng = logs.find(l => ["ENDED_NG", "NG"].includes(toUpper(l.plc_status)) || ["FAIL", "NG"].includes(toUpper(l.result)));

  return ng || success || logs[0];
}

async function safeRecordTimeline({
  operationId,
  partId,
  machineId,
  stationNo,
  eventType,
  eventData = {},
  durationFromStartMs = null,
}) {
  if (!operationId || !eventType) {
    return;
  }
  try {
    await recordTimelineEvent({
      operationId,
      partId: partId || null,
      machineId: machineId || null,
      stationNo: stationNo || null,
      eventType,
      eventData,
      durationFromStartMs,
    });
  } catch (_error) {
    // Timeline persistence is best-effort; never break cycle flow.
  }
}

function emitOperatorPopup(type, payload) {
  emitRealtime("operator_popup", {
    type,
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

async function emitPackingReadyPopup({ partId, stationNo, machineId, machineName }) {
  const station = normalizeStation(stationNo);
  if (!station || !partId) return;
  const features = await getStationFeatureConfig(station).catch(() => null);
  if (!features?.finalPacking) return;
  const autoPackResult = await autoPackReadyPart({
    partId,
    stationNo: station,
    machineId,
    machineName,
  });
  emitOperatorPopup("SUCCESS", {
    partId,
    stationNo: "PACKING",
    sourceStationNo: station,
    machineId,
    machineName,
    qrStatus: "PASSED",
    operationStatus: "READY_FOR_PACKING",
    status: "READY_FOR_PACKING",
    plcStatus: "READY_FOR_PACKING",
    finalPackingEligible: true,
    autoPacked: autoPackResult?.success === true,
    boxNumber: autoPackResult?.session?.box_number || null,
    message: autoPackResult?.success === true && autoPackResult?.session?.box_number
      ? `Part auto-mapped to packing box ${autoPackResult.session.box_number}.`
      : `Part ready for packing from ${station}.`,
  });
  emitRealtime("packing_update", {
    event: "PART_READY_FOR_PACKING",
    partId,
    stationNo: "PACKING",
    sourceStationNo: station,
    machineId,
    machineName,
    finalPackingEligible: true,
    autoPacked: autoPackResult?.success === true,
    boxNumber: autoPackResult?.session?.box_number || null,
    timestamp: new Date().toISOString(),
  });
}

async function buildScannerHealth(scanner, machineId) {
  if (!scanner) {
    return {
      scannerId: null,
      scannerIp: null,
      scannerName: null,
      machineId: machineId || null,
      status: "NOT_CONFIGURED",
      connected: false,
      connectedAt: null,
      lastDataAt: null,
      lastSeenAt: null,
      source: "NONE",
    };
  }

  const connectionSnapshot = await getScannerConnectionSnapshot(scanner.scanner_ip).catch(() => null);
  const connectionConnected = Boolean(connectionSnapshot?.connected);
  const lastDataMs = connectionSnapshot?.lastDataAt ? new Date(connectionSnapshot.lastDataAt).getTime() : 0;
  const recentDataConnected = Number.isFinite(lastDataMs) && lastDataMs > 0
    ? (Date.now() - lastDataMs) <= SCANNER_CONNECTION_GRACE_MS
    : false;
  const probeReachability = async () => {
    const port = Number(scanner?.scanner_port || 0);
    if (!scanner?.scanner_ip || !Number.isFinite(port) || port <= 0) {
      return null;
    }
    return scannerConnectionService.probeScannerEndpoint({
      ip: scanner.scanner_ip,
      port,
      timeoutMs: 1200,
    }).catch(() => null);
  };

  const byIpHealth = getScannerHealthSnapshot({ scannerIp: scanner.scanner_ip });
  if (byIpHealth) {
    let connected = Boolean(byIpHealth.connected) || connectionConnected || recentDataConnected;
    let reachability = null;
    if (!connected) {
      reachability = await probeReachability();
      connected = Boolean(reachability?.reachable);
    }
    return {
      ...byIpHealth,
      scannerId: byIpHealth.scannerId || scanner.id,
      scannerName: byIpHealth.scannerName || scanner.scanner_name,
      machineId: byIpHealth.machineId || machineId || null,
      connected,
      status: connected ? "CONNECTED" : "DISCONNECTED",
      connectedAt: byIpHealth.lastSeenAt || connectionSnapshot?.connectedAt || null,
      lastDataAt: connectionSnapshot?.lastDataAt || byIpHealth.lastSeenAt || null,
      source: connected && reachability?.reachable ? "PROBE" : (connectionSnapshot?.source || "HEARTBEAT"),
    };
  }

  const byMachineHealth = getScannerHealthSnapshot({ machineId });
  if (Array.isArray(byMachineHealth) && byMachineHealth.length > 0) {
    const match =
      byMachineHealth.find((entry) => entry.scannerId && Number(entry.scannerId) === Number(scanner.id)) ||
      byMachineHealth.find((entry) => sameIp(entry.scannerIp, scanner.scanner_ip)) ||
      null;

    if (match) {
      let connected = Boolean(match.connected) || connectionConnected || recentDataConnected;
      let reachability = null;
      if (!connected) {
        reachability = await probeReachability();
        connected = Boolean(reachability?.reachable);
      }
      return {
        ...match,
        scannerId: match.scannerId || scanner.id,
        scannerName: match.scannerName || scanner.scanner_name,
        machineId: match.machineId || machineId || null,
        connected,
        status: connected ? "CONNECTED" : "DISCONNECTED",
        connectedAt: match.lastSeenAt || connectionSnapshot?.connectedAt || null,
        lastDataAt: connectionSnapshot?.lastDataAt || match.lastSeenAt || null,
        source: connected && reachability?.reachable ? "PROBE" : (connectionSnapshot?.source || "HEARTBEAT"),
      };
    }
  }

  if (connectionSnapshot) {
    let connected = Boolean(connectionSnapshot.connected) || recentDataConnected;
    let reachability = null;
    if (!connected) {
      reachability = await probeReachability();
      connected = Boolean(reachability?.reachable);
    }
    return {
      scannerId: scanner.id,
      scannerIp: scanner.scanner_ip,
      scannerName: scanner.scanner_name,
      machineId: machineId || null,
      status: connected ? "CONNECTED" : String(connectionSnapshot.status || "DISCONNECTED").toUpperCase(),
      connected,
      connectedAt: connectionSnapshot.connectedAt || null,
      lastDataAt: connectionSnapshot.lastDataAt || null,
      lastSeenAt: connectionSnapshot.lastDataAt || null,
      source: connected && reachability?.reachable ? "PROBE" : (connectionSnapshot.source || "DB"),
    };
  }

  const reachability = await probeReachability();
  if (reachability?.reachable) {
    return {
      scannerId: scanner.id,
      scannerIp: scanner.scanner_ip,
      scannerName: scanner.scanner_name,
      machineId: machineId || null,
      status: "CONNECTED",
      connected: true,
      connectedAt: null,
      lastDataAt: null,
      lastSeenAt: null,
      source: "PROBE",
    };
  }

  return {
    scannerId: scanner.id,
    scannerIp: scanner.scanner_ip,
    scannerName: scanner.scanner_name,
    machineId: machineId || null,
    status: "DISCONNECTED",
    connected: false,
    connectedAt: null,
    lastDataAt: null,
    lastSeenAt: null,
    source: "NONE",
  };
}

function mapScanDecisionToPopupType(scanResult) {
  if (scanResult?.decision === "ALLOW") {
    return "INFO";
  }
  const reason = String(scanResult?.reason || "").trim().toUpperCase();
  if (["DUPLICATE_SCAN", "DUPLICATE_SCAN_IN_FLIGHT", "ALREADY_COMPLETED", "ALREADY_FAILED_AT_STATION"].includes(reason)) {
    return "WARNING";
  }
  return "ERROR";
}

function getBlockedPopupMessage(scanResult = {}) {
  const reason = String(scanResult?.reason || "").trim().toUpperCase();
  const message = scanResult?.message || "";

  if (reason === "PREVIOUS_STATION_NOT_COMPLETED") {
    if (message) return message;
    if (scanResult?.expectedStation && scanResult?.lastCompletedStation) {
      return `Wrong station. Scan ${scanResult.expectedStation} first. Last OK: ${scanResult.lastCompletedStation}.`;
    }
    return `Wrong station. Scan ${scanResult.expectedStation || "previous OP"} first.`;
  }
  if (reason === "DUPLICATE_SCAN" || reason === "DUPLICATE_SCAN_IN_FLIGHT" || reason === "ALREADY_COMPLETED") {
    return message || `Already passed at ${scanResult.stationNo || "this OP"}. Scan next operation.`;
  }
  if (reason === "ALREADY_FAILED_AT_STATION") {
    return message || `Already failed at ${scanResult.stationNo || "this OP"}. Rework/reset is required before scanning again.`;
  }
  // If it's a validation error, prefer the dynamic error message passed from the backend
  if (reason === "VALIDATION_ERROR" && message) {
    return message;
  }
  return message || reason || "BLOCKED";
}

function hasRejectionBinConfirmation(payload = {}) {
  const raw =
    payload.rejectionBinConfirmed ??
    payload.rejection_bin_confirmed ??
    payload.rejectionBinSignal ??
    payload.rejection_bin_signal ??
    payload.rejectionBin ??
    payload.rejection_bin ??
    payload.rb ??
    payload.RB ??
    null;

  if (typeof raw === "boolean") {
    return raw;
  }
  const normalized = String(raw || "")
    .trim()
    .toUpperCase();
  return ["1", "TRUE", "YES", "NG", "FAIL", "CONFIRMED", "DETECTED"].includes(normalized);
}

function hasSecondaryRejectionSignal(payload = {}) {
  const raw =
    payload.rejectionSecondaryConfirmed ??
    payload.rejection_secondary_confirmed ??
    payload.rejectionSecondarySignal ??
    payload.rejection_secondary_signal ??
    payload.ngSignal2 ??
    payload.ng_signal_2 ??
    payload.stationResetSignal ??
    payload.station_reset_signal ??
    null;

  if (typeof raw === "boolean") {
    return raw;
  }
  const normalized = String(raw || "").trim().toUpperCase();
  return ["1", "TRUE", "YES", "NG", "FAIL", "CONFIRMED", "DETECTED"].includes(normalized);
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
  const mode = toUpper(source.mode || source.resultMode || "IP_PUSH");
  const qualityPayloadKeys = Array.isArray(source.qualityPayloadKeys)
    ? source.qualityPayloadKeys.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 40)
    : [];
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
  return {
    enabled: source.enabled === true,
    mode: ["IP_PUSH", "PLC_REGISTER"].includes(mode) ? mode : "IP_PUSH",
    appliesTo: "ALL",
    sourceIp: normalizeIp(source.sourceIp || source.systemIp || source.ip || ""),
    sourcePort: toIntegerOrNull(source.sourcePort || source.systemPort || source.port),
    payloadResultKey: String(source.payloadResultKey || source.resultKey || "RESULT").trim() || "RESULT",
    payloadResultNgValues,
    qualityPayloadKeys,
    plcResultRegister: toIntegerOrNull(source.plcResultRegister ?? source.resultRegister ?? source.register),
    plcResultDevice: String(source.plcResultDevice || source.resultDevice || "D").trim().toUpperCase() || "D",
    plcResultOkValues,
    plcResultNgValues,
    plcAckEnabled: source.plcAckEnabled !== false,
    plcAckRegister: toIntegerOrNull(source.plcAckRegister ?? source.ackRegister),
    plcAckDevice: String(source.plcAckDevice || source.ackDevice || "D").trim().toUpperCase() || "D",
    plcAckOkValue: toIntegerOrNull(source.plcAckOkValue ?? source.ackOkValue) ?? 101,
    plcAckNgValue: toIntegerOrNull(source.plcAckNgValue ?? source.ackNgValue) ?? 102,
    plcAckErrorValue: toIntegerOrNull(source.plcAckErrorValue ?? source.ackErrorValue) ?? 199,
  };
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

function extractQualityPayload(payload = {}, machine = null) {
  const spcConfig = getMachineSpcConfig(machine);
  if (!spcConfig.enabled || !payload || typeof payload !== "object") {
    return null;
  }
  const keys = spcConfig.qualityPayloadKeys;
  const output = {};
  for (const key of keys) {
    const direct = findPayloadValueCaseInsensitive(payload, key);
    if (direct !== undefined) {
      output[key] = direct;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

function normalizeQualityToken(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim().toUpperCase();
}

async function readQualityCheckResultFromPlc(machine, spcConfig) {
  if (!machine || !spcConfig?.enabled || spcConfig.mode !== "PLC_REGISTER") {
    return null;
  }
  const registerNo = toIntegerOrNull(spcConfig.plcResultRegister);
  if (registerNo === null) {
    return null;
  }
  const protocol = toUpper(machine.plc_protocol || "TCP_TEXT");
  const ip = machine.plc_ip || machine.machine_ip;
  const port = toIntegerOrNull(machine.plc_port || machine.machine_port);
  if (!ip || !port) {
    throw new Error("PLC endpoint not configured for Quality Check register mode");
  }
  let rawValue = null;
  if (protocol === "MODBUS_TCP") {
    const response = await readModbusRegisters({
      ip,
      port,
      unitId: toIntegerOrNull(machine.plc_unit_id) ?? 1,
      registers: [registerNo],
      timeoutMs: toIntegerOrNull(machine.plc_test_timeout_ms) ?? 2000,
    });
    rawValue = response?.values?.[registerNo];
  } else if (protocol === "SLMP") {
    const response = await readSlmpRegisters({
      ip,
      port,
      registers: [{ register: registerNo, device: spcConfig.plcResultDevice || machine.plc_slmp_device || "D" }],
      defaultDevice: spcConfig.plcResultDevice || machine.plc_slmp_device || "D",
      timeoutMs: toIntegerOrNull(machine.plc_test_timeout_ms) ?? 2000,
      frameMode: parseMachineSnapshot(machine)?.slmpFrameMode || "AUTO",
    });
    rawValue = response?.values?.[registerNo];
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
    registerNo,
  };
}

async function sendQualityCheckAckToPlc(machine, spcConfig, finalResult) {
  if (!machine || !spcConfig?.enabled) {
    return { skipped: true, reason: "ACK_DISABLED" };
  }
  const registerNo = toIntegerOrNull(spcConfig.plcAckRegister);
  if (registerNo === null) {
    return { skipped: true, reason: "ACK_REGISTER_NOT_SET" };
  }
  const protocol = toUpper(machine.plc_protocol || "TCP_TEXT");
  const ip = machine.plc_ip || machine.machine_ip;
  const port = toIntegerOrNull(machine.plc_port || machine.machine_port);
  if (!ip || !port) {
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
      unitId: toIntegerOrNull(machine.plc_unit_id) ?? 1,
      register: registerNo,
      value: ackValue,
      timeoutMs: toIntegerOrNull(machine.plc_test_timeout_ms) ?? 2000,
    });
    return { ok: true, protocol, register: registerNo, value: ackValue };
  }
  if (protocol === "SLMP") {
    const routeSnapshot = parseMachineSnapshot(machine);
    await writeSlmpRegister({
      ip,
      port,
      register: registerNo,
      value: ackValue,
      device: spcConfig.plcAckDevice || machine.plc_slmp_device || "D",
      timeoutMs: toIntegerOrNull(machine.plc_test_timeout_ms) ?? 2000,
      frameMode: routeSnapshot?.slmpFrameMode || "AUTO",
    });
    return { ok: true, protocol, register: registerNo, value: ackValue };
  }
  return { skipped: true, reason: `ACK_NOT_SUPPORTED_${protocol}` };
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

async function markOperationStarted(operationLogId, machineId) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (!opLog) {
    return null;
  }
  await opLog.update({
    plc_status: "STARTED",
    machine_id: machineId,
    plc_start_time: new Date(),
    plc_start_at: new Date(),
  });
  return opLog;
}

async function markOperationEndedOk({ operationLogId, partId, stationNo, machineId, userId, isBypassed = false, bypassReason = null }) {
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
    is_bypassed: Boolean(isBypassed),
    bypass_reason: isBypassed ? (bypassReason || "STATION_BYPASS_AUTO_OK") : null,
  });

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
    user_id: userId || null,
    status: "OK",
    ng_reason: "PLC_END_OK",
  });

  await autoStartNextCustomerQrStation({
    partId,
    completedStation: stationNo,
    userId,
  });

  return opLog;
}

async function autoStartNextCustomerQrStation({ partId, completedStation, userId }) {
  const normalizedPartId = String(partId || "").trim();
  const currentStation = normalizeStation(completedStation);
  if (!normalizedPartId || !currentStation) return null;

  const sequenceData = await getActiveMachineSequenceData();
  const sequence = Array.isArray(sequenceData?.sequence) ? sequenceData.sequence : [];
  const currentIndex = sequence.indexOf(currentStation);
  const nextStation = currentIndex >= 0 ? sequence[currentIndex + 1] : "";
  if (!nextStation) return null;

  const nextMachines = (sequenceData?.machines || []).filter(
    (machine) => getMachineOperationStage(machine) === nextStation
  );
  const nextMachine = nextMachines.find((machine) => requiresCustomerQrForCompletion(machine));
  if (!nextMachine) return null;

  const existingActive = await OperationLog.findOne({
    where: {
      part_id: normalizedPartId,
      station_no: nextStation,
      plc_status: { [Op.in]: ["PENDING", "STARTED", "RUNNING", "WAITING_PLC", "START_SENT", "WAITING_RUNNING"] },
    },
    attributes: ["id"],
    order: [["createdAt", "DESC"]],
  });
  if (existingActive) return { started: false, reason: "ALREADY_ACTIVE", stationNo: nextStation };

  const existingPassed = await OperationLog.findOne({
    where: {
      part_id: normalizedPartId,
      station_no: nextStation,
      plc_status: "ENDED_OK",
      result: "OK",
    },
    attributes: ["id"],
    order: [["createdAt", "DESC"]],
  });
  if (existingPassed) return { started: false, reason: "ALREADY_PASSED", stationNo: nextStation };

  const response = await saveScan(normalizedPartId, nextStation, "OK", nextMachine.id, userId || null, {
    resultSource: "AUTO_START_AFTER_PREVIOUS_OK",
    resultInput: `${currentStation}_OK`,
  });

  if (response?.decision === "ALLOW") {
    emitOperatorPopup("INFO", {
      partId: normalizedPartId,
      stationNo: nextStation,
      machineId: nextMachine.id,
      machineName: nextMachine.machine_name,
      status: "SCANNED",
      operationStatus: "WAITING",
      plcStatus: "WAITING_PLC",
      qrStatus: "PASSED",
      reason: "WAITING_CUSTOMER_QR",
      message: `${nextStation} Laser started. Scan Customer QR to complete mapping.`,
    });
    emitRealtime("dashboard_refresh", {
      reason: "AUTO_START_CUSTOMER_QR_STATION",
      partId: normalizedPartId,
      stationNo: nextStation,
      machineId: nextMachine.id,
    });
    return { started: true, stationNo: nextStation, operationLogId: response.operationLogId || null };
  }

  return { started: false, stationNo: nextStation, reason: response?.reason || "BLOCKED" };
}

async function markOperationEndedNg({ operationLogId, partId, stationNo, machineId, userId, reason }) {
  const opLog = await OperationLog.findByPk(operationLogId);
  if (!opLog) {
    return null;
  }
  await opLog.update({
    plc_status: "ENDED_NG",
    result: "NG",
    machine_id: machineId,
    plc_end_time: new Date(),
    plc_end_at: new Date(),
    interlock_reason: reason || "PLC_END_NG",
    is_bypassed: false,
    bypass_reason: null,
  });

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
    user_id: userId || null,
    status: "NG",
    ng_reason: reason || "PLC_END_NG",
  });

  return opLog;
}

async function markOperationCommunicationError({ operationLogId, partId, stationNo, machineId, reason }) {
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

async function startPlcFlow({ operationLogId, partId, stationNo, machine, userId, releaseLock = true }) {
  let plcCycleCompleted = false;
  try {
    await safeRecordTimeline({
      operationId: operationLogId,
      partId,
      machineId: machine.id,
      stationNo,
      eventType: TIMELINE_EVENTS.START_SENT,
      eventData: { source: "traceabilityController.startPlcFlow" },
    });

    await plcHandshakeEngine.executeCycle({
      machine,
      partId,
      stationNo,
      operationLogId,
      onStarted: async () => {
        await markOperationStarted(operationLogId, machine.id);
        await safeRecordTimeline({
          operationId: operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: TIMELINE_EVENTS.RUNNING,
        });
        emitOperatorPopup("INFO", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          qrStatus: "PASSED",
          operationStatus: "RUNNING",
          status: "RUNNING",
          plcStatus: "STARTED",
          message: "PLC cycle running",
        });
        emitRealtime("PLC_RUNNING", { partId, machineId: machine.id, stationNo });
        emitRealtime("dashboard_refresh", { reason: "PLC_START_ACK" });
      },
      onEndedOk: async () => {
        await markOperationEndedOk({
          operationLogId,
          partId,
          stationNo,
          machineId: machine.id,
          userId,
        });
        plcCycleCompleted = true;
        await safeRecordTimeline({
          operationId: operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: TIMELINE_EVENTS.COMPLETED_OK,
        });
        emitOperatorPopup("SUCCESS", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          qrStatus: "PASSED",
          operationStatus: "PASSED",
          status: "ENDED_OK",
          plcStatus: "ENDED_OK",
          message: "Operation Passed",
        });
        await emitPackingReadyPopup({
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
        });
        emitRealtime("PLC_COMPLETED_OK", { partId, machineId: machine.id, stationNo });
        emitRealtime("dashboard_refresh", { reason: "PLC_END_OK" });
      },
      onEndedNg: async () => {
        await markOperationEndedNg({
          operationLogId,
          partId,
          stationNo,
          machineId: machine.id,
          userId,
          reason: "PLC_END_NG",
        });
        plcCycleCompleted = true;
        await safeRecordTimeline({
          operationId: operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: TIMELINE_EVENTS.COMPLETED_NG,
        });
        emitOperatorPopup("ERROR", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          qrStatus: "PASSED",
          operationStatus: "FAILED",
          status: "ENDED_NG",
          plcStatus: "ENDED_NG",
          message: "Operation Failed (NG)",
        });
        emitRealtime("PLC_COMPLETED_NG", { partId, machineId: machine.id, stationNo });
        emitRealtime("dashboard_refresh", { reason: "PLC_END_NG" });
      },
      onError: async (error) => {
        await markOperationCommunicationError({
          operationLogId,
          partId,
          stationNo,
          machineId: machine.id,
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
        emitOperatorPopup("WARNING", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          qrStatus: "PASSED",
          operationStatus: "PLC_TIMEOUT",
          status: "PLC_COMM_ERROR",
          plcStatus: "PLC_COMM_ERROR",
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
          emitOperatorPopup("WARNING", {
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

async function startPlcBatchFlow({ batchItems, stationNo, machine, userId }) {
  try {
    for (const item of batchItems) {
      try {
        await startPlcFlow({
          operationLogId: item.operationLogId,
          partId: item.partId,
          stationNo,
          machine,
          userId,
          releaseLock: false,
        });
      } catch (error) {
        console.error(
          `PLC batch item failed for part ${item.partId} at station ${stationNo}:`,
          error.message
        );
      }
    }
  } finally {
    const finalize = await finalizeCycleAfterPlc({ machine });
    if (!finalize.success) {
      emitOperatorPopup("WARNING", {
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
  response,
  machine,
  stationNo,
  partId,
  userId,
  requiredPlcPartCount,
}) {
  const machineBypassEnabled = isMachineBypassEnabled(machine.id) || machine.bypass_enabled === true;
  const stationFeatures = await getStationFeatureConfig(stationNo, getMachineStationScope(machine)).catch(() => ({ operation: true }));
  const plcConfigured = Boolean(machine.plc_ip);
  const plcCommunicationEnabled = stationFeatures.plcCommunication !== false;

  if (response.decision !== "ALLOW" || !response.operationLogId) {
    if (response.operationLogId) {
      await safeRecordTimeline({
        operationId: response.operationLogId,
        partId,
        machineId: machine.id,
        stationNo,
        eventType: TIMELINE_EVENTS.INTERLOCKED,
        eventData: {
          reason: response.reason || "REJECTED_SCAN",
          message: getBlockedPopupMessage(response),
        },
      });
    }
    if (plcConfigured && plcCommunicationEnabled) {
      // Blocked scans must reach the PLC before any bypass/auto-pass handling.
      await plcHandshakeEngine.signalInterlock(machine.id, response.reason || "REJECTED_SCAN", { force: true })
        .catch(err => console.error("[PLC:INTERLOCK_TRIGGER_FAILED]", err.message));
    } else {
      console.warn(
        `[PLC:INTERLOCK_SKIPPED] machineId=${machine.id} reason=${response.reason || "REJECTED_SCAN"} plcConfigured=${plcConfigured} plcCommunicationEnabled=${plcCommunicationEnabled}`
      );
    }
    return;
  }

  if (!stationFeatures.operation || machineBypassEnabled || !plcConfigured || !plcCommunicationEnabled) {
    // PLC is bypassed, disabled, or not configured!
    if (response.decision === "ALLOW" && response.operationLogId) {
      if (stationFeatures.manualResult) {
        response.plcHandshake = "BYPASSED_WAITING_MANUAL";
        response.operationStatus = "PENDING";
        response.message = "Scan OK. Awaiting manual result.";

        emitOperatorPopup("INFO", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          qrStatus: "PASSED",
          operationStatus: "PENDING",
          status: "PENDING",
          plcStatus: "PENDING",
          message: "Scan OK. Awaiting manual OK/NG result.",
        });
      } else {
        await markOperationEndedOk({
          operationLogId: response.operationLogId,
          partId,
          stationNo,
          machineId: machine.id,
          userId,
          isBypassed: true,
          bypassReason: machineBypassEnabled
            ? "MACHINE_BYPASS_AUTO_OK"
            : (!stationFeatures.operation
              ? "STATION_OPERATION_DISABLED_AUTO_OK"
              : "STATION_BYPASS_AUTO_OK"),
        }).catch(err => console.error("Failed to mark bypassed operation ended OK:", err.message));

        await safeRecordTimeline({
          operationId: response.operationLogId,
          partId,
          machineId: machine.id,
          stationNo,
          eventType: TIMELINE_EVENTS.COMPLETED_OK,
          eventData: {
            bypassed: true,
            machineBypassEnabled,
            operationEnabled: stationFeatures.operation,
            plcConfigured,
            plcCommunicationEnabled,
          },
        });

        response.plcHandshake = "BYPASSED";
        response.operationStatus = "PASSED";
        response.message = "Operation completed directly (PLC communication bypassed/disabled).";

        emitOperatorPopup("SUCCESS", {
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          qrStatus: "PASSED",
          operationStatus: "PASSED",
          status: "ENDED_OK",
          plcStatus: "ENDED_OK",
          message: "Operation Passed (PLC communication bypassed/disabled)",
        });
        await emitPackingReadyPopup({
          partId,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
        });
        emitRealtime("dashboard_refresh", { reason: "PLC_BYPASSED" });
      }
    }
    return;
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
        operationLogId: response.operationLogId,
      });
      response.decision = "BLOCK";
      response.reason = "MACHINE_RUNNING";
      response.message = lock.runningPartId
        ? `Machine busy. Current part ${lock.runningPartId} is in operation.`
        : "Machine busy with another cycle. Retry after current operation completes.";
      response.operationLogId = null;
      response.lock = {
        runningPartId: lock.runningPartId || null,
        runningStationNo: lock.runningStationNo || null,
        runningStartedAt: lock.runningStartedAt || null,
      };
      return;
    }

    startPlcFlow({
      operationLogId: response.operationLogId,
      partId,
      stationNo,
      machine,
      userId,
    }).catch((error) => {
      console.error("PLC flow failed:", error.message);
    });
    response.plcHandshake = "INITIATED";
    return;
  }

  const pendingRows = await getPendingStationOperations({
    machineId: machine.id,
    stationNo,
  });

  response.pendingBatchCount = pendingRows.length;
  response.plcPartCountRequired = requiredPlcPartCount;
  response.operationStatus = "PENDING";

  if (pendingRows.length < requiredPlcPartCount) {
    response.plcHandshake = "QUEUED";
    response.reason = "BATCH_WAITING";
    response.message = `Queued for PLC batch at ${stationNo}: ${pendingRows.length}/${requiredPlcPartCount} part(s) ready.`;
    return;
  }

  const lock = await tryAcquireMachineLock({
    machineId: machine.id,
    partId,
    stationNo,
  });

  if (!lock.acquired) {
    response.plcHandshake = "QUEUED";
    response.reason = "MACHINE_RUNNING";
    response.message = lock.runningPartId
      ? `Machine busy with ${lock.runningPartId}. Batch queued and will run once machine is free.`
      : "Machine busy with another cycle. Batch queued and will run automatically once machine is free.";
    response.lock = {
      runningPartId: lock.runningPartId || null,
      runningStationNo: lock.runningStationNo || null,
      runningStartedAt: lock.runningStartedAt || null,
    };
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
    userId,
  }).catch((error) => {
    console.error("PLC batch flow failed:", error.message);
  });

  response.plcHandshake = "BATCH_INITIATED";
  response.message = `PLC batch started at ${stationNo} for ${batchRows.length} part(s).`;
  response.batchPartIds = batchRows.map((row) => row.part_id);
}

async function sendRejectedScanInterlock({ machine, stationNo, reason = "REJECTED_SCAN" }) {
  if (!machine?.id) return false;
  const normalizedStation = normalizeStation(stationNo || getMachineOperationStage(machine));
  const stationFeatures = normalizedStation
    ? await getStationFeatureConfig(normalizedStation, getMachineStationScope(machine)).catch(() => ({}))
    : {};
  const plcConfigured = Boolean(machine.plc_ip);
  const plcCommunicationEnabled = stationFeatures.plcCommunication !== false;

  if (!plcConfigured || !plcCommunicationEnabled) {
    console.warn(
      `[PLC:INTERLOCK_SKIPPED] machineId=${machine.id} reason=${reason} plcConfigured=${plcConfigured} plcCommunicationEnabled=${plcCommunicationEnabled}`
    );
    return false;
  }

  await plcHandshakeEngine.signalInterlock(machine.id, reason, { force: true })
    .catch(err => console.error("[PLC:INTERLOCK_TRIGGER_FAILED]", err.message));
  return true;
}

exports.getPartTraceability = async (req, res) => {
  try {
    const { partId } = req.params;
    const part = await Part.findOne({ where: { part_id: partId } });
    const history = await OperationLog.findAll({
      where: { part_id: partId },
      order: [["createdAt", "ASC"]],
    });
    const reworkHistory = await ReworkLog.findAll({
      where: { part_id: partId },
      order: [["createdAt", "DESC"]],
    });

    if (!part && history.length === 0) {
      return res.status(404).json({ error: "Part not found" });
    }

    res.json({
      part: part || { part_id: partId, status: "UNKNOWN", current_station: null },
      history,
      reworkHistory,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPlcHealth = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    const health = machineId ? getPlcHealthSnapshot(machineId) : getPlcHealthSnapshot();
    const circuits = getPlcCircuitSnapshot();

    const queue = plcConnectionManager.getQueueSnapshot();
    if (machineId) {
      const machineCircuit = circuits.find((entry) => entry.key === `machine:${machineId}`) || null;
      const machine = await Machine.findByPk(machineId);
      const endpointKey = machine ? `${String(machine.plc_ip || machine.machine_ip || "").trim()}:${Number(machine.plc_port || machine.machine_port || 0)}` : null;
      const queueEntry = endpointKey ? queue.find((q) => q.endpointKey === endpointKey) || null : null;
      return res.json({
        health: health || null,
        circuit: machineCircuit,
        queue: queueEntry,
      });
    }

    res.json({
      health,
      circuits,
      queue,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getScannerHealth = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    if (!machineId) {
      return res.json({
        health: getScannerHealthSnapshot(),
      });
    }

    const scanner = await Scanner.findOne({
      where: {
        mapped_machine_id: machineId,
        is_active: true,
      },
      order: [["updatedAt", "DESC"]],
    });

    res.json({
      health: await buildScannerHealth(scanner, machineId),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getLiveMachineState = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    if (!machineId) {
      return res.status(400).json({ error: "machineId query param is required" });
    }

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }
    const stationNo = getMachineOperationStage(machine);

    const logs = await OperationLog.findAll({
      where: { machine_id: machine.id, station_no: stationNo },
      order: [["createdAt", "DESC"]],
      limit: 20,
    });

    const current = resolveCurrentOperationForMachine(logs, machine);
    const lastEvent = logs[0] || null;
    const plcHealth = getPlcHealthSnapshot(machine.id);
    const plcCircuit = getPlcCircuitSnapshot().find((entry) => entry.key === `machine:${machine.id}`) || null;
    const scannerBundle = await buildMachineScannerBundle(machine.id);
    const machineState = plcHandshakeEngine.getState(machine.id);

    res.json({
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        lineName: machine.line_name,
        sequenceNo: machine.sequence_no,
        operationNo: machine.operation_no,
        stationNo,
        machineIp: machine.machine_ip,
        plcIp: machine.plc_ip,
        plcPort: machine.plc_port,
        plcProtocol: machine.plc_protocol || "TCP_TEXT",
        plcRegisters: machine.plc_registers || null,
        isActive: machine.is_active,
        isRunning: Boolean(machine.is_running),
        runningPartId: machine.running_part_id || null,
        runningStationNo: machine.running_station_no || null,
        runningStartedAt: machine.running_started_at || null,
      },
      plcHealth: plcHealth || null,
      plcCircuit,
      plcQueue: plcConnectionManager.getQueueSnapshot(),
      scanner: scannerBundle.primaryScanner,
      scannerHealth: scannerBundle.primaryHealth,
      scanners: scannerBundle.scanners,
      scannerHealthList: scannerBundle.scannerHealth,
      machineState,
      current: current
        ? {
          operationLogId: current.id,
          partId: current.part_id,
          plcStatus: current.plc_status,
          result: current.result,
          interlockReason: current.interlock_reason,
          isBypassed: current.is_bypassed,
          bypassReason: current.bypass_reason,
          createdAt: current.createdAt,
        }
        : null,
      lastEvent: lastEvent
        ? {
          operationLogId: lastEvent.id,
          partId: lastEvent.part_id,
          plcStatus: lastEvent.plc_status,
          result: lastEvent.result,
          interlockReason: lastEvent.interlock_reason,
          isBypassed: lastEvent.is_bypassed,
          bypassReason: lastEvent.bypass_reason,
          createdAt: lastEvent.createdAt,
        }
        : null,
      recent: logs.map((row) => ({
        id: row.id,
        partId: row.part_id,
        plcStatus: row.plc_status,
        result: row.result,
        interlockReason: row.interlock_reason,
        isBypassed: row.is_bypassed,
        bypassReason: row.bypass_reason,
        createdAt: row.createdAt,
      })),
      stationSettings: await getStationFeatureConfig(stationNo).catch(() => null),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getIoSnapshot = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    if (!machineId) {
      return res.status(400).json({ error: "machineId query param is required" });
    }

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const requestedPlcIp = normalizeIp(req.query.plcIp);
    const effectivePlcIp = normalizeIp(machine.plc_ip || machine.machine_ip);
    if (requestedPlcIp && effectivePlcIp && requestedPlcIp !== effectivePlcIp) {
      return res.status(400).json({ error: "Selected machine does not belong to requested PLC IP" });
    }
    const cacheKey = getIoSnapshotCacheKey(machine.id, effectivePlcIp);
    const forceRefresh = String(req.query.force || "")
      .trim()
      .toLowerCase();
    const bypassCache = forceRefresh === "1" || forceRefresh === "true";
    const nowMs = Date.now();
    const cachedEntry = ioSnapshotCache.get(cacheKey) || null;
    if (!bypassCache && cachedEntry?.payload) {
      const ageMs = Math.max(0, nowMs - Number(cachedEntry.savedAtMs || 0));
      if (ageMs <= IO_SNAPSHOT_CACHE_MAX_AGE_MS) {
        return res.json({
          ...cachedEntry.payload,
          monitorPolicy: {
            minIntervalMs: IO_SNAPSHOT_MIN_INTERVAL_MS,
            cacheMaxAgeMs: IO_SNAPSHOT_CACHE_MAX_AGE_MS,
            servedFromCache: true,
            throttled: ageMs <= IO_SNAPSHOT_MIN_INTERVAL_MS,
            cacheAgeMs: ageMs,
          },
        });
      }
    }

    if (!bypassCache && ioSnapshotInFlight.has(cacheKey)) {
      const sharedPayload = await ioSnapshotInFlight.get(cacheKey);
      return res.json({
        ...sharedPayload,
        monitorPolicy: {
          ...(sharedPayload.monitorPolicy || {}),
          servedFromCache: false,
          inFlightShared: true,
        },
      });
    }

    const snapshotPromise = (async () => {

      const stationNo = getMachineOperationStage(machine);
      const [latestLog, scanner] = await Promise.all([
        OperationLog.findOne({
          where: stationNo
            ? { machine_id: machine.id, station_no: stationNo }
            : { machine_id: machine.id },
          order: [["createdAt", "DESC"]],
        }),
        Scanner.findOne({
          where: {
            mapped_machine_id: machine.id,
            is_active: true,
          },
          order: [["updatedAt", "DESC"]],
        }),
      ]);

      const protocol = toUpper(machine.plc_protocol || "TCP_TEXT");
      const plcIp = machine.plc_ip || machine.machine_ip || null;
      const plcPort = toIntegerOrNull(machine.plc_port || machine.machine_port);
      const plcUnitId = toIntegerOrNull(machine.plc_unit_id) || 1;
      const timeoutMs = toIntegerOrNull(machine.plc_test_timeout_ms) || 2000;
      const signalMapEntries = parseMachineSignalMap(machine);
      const rangeEntries = parseMachineDataRegisterRanges(machine);
      const registerSpecsMap = new Map();
      for (const entry of signalMapEntries) {
        const reg = toIntegerOrNull(entry.register);
        if (reg === null) continue;
        const dev = String(entry?.device || machine?.plc_slmp_device || "D").trim().toUpperCase() || "D";
        const key = `${dev}:${reg}`;
        if (!registerSpecsMap.has(key)) {
          registerSpecsMap.set(key, { register: reg, device: dev });
        }
      }
      for (const range of rangeEntries) {
        for (let reg = range.min; reg <= range.max; reg += 1) {
          const dev = String(range.device || machine?.plc_slmp_device || "D").trim().toUpperCase() || "D";
          const key = `${dev}:${reg}`;
          if (!registerSpecsMap.has(key)) {
            registerSpecsMap.set(key, { register: reg, device: dev });
          }
        }
      }
      const registerList = Array.from(
        new Set(Array.from(registerSpecsMap.values()).map((spec) => spec.register))
      );
      const slmpDefaultDevice = String(machine.plc_slmp_device || "D").trim().toUpperCase() || "D";
      const slmpRegisterSpecs = Array.from(registerSpecsMap.values()).sort((a, b) => a.register - b.register);

      const errors = [];
      const registerValues = {};
      const checkedAt = new Date().toISOString();
      const plcConnection = {
        connected: false,
        transportConnected: false,
        readConnected: false,
        protocol,
        checkedAt,
        error: null,
        transportError: null,
        readError: null,
      };

      if (!plcIp || !plcPort) {
        plcConnection.error = "PLC endpoint missing on machine configuration";
        errors.push(plcConnection.error);
      } else {
        try {
          await probeTcpEndpoint({
            ip: plcIp,
            port: plcPort,
            timeoutMs: Math.min(timeoutMs, 2000),
          });
          plcConnection.transportConnected = true;
        } catch (error) {
          const message = withPlcConnectivityHint(String(error.message || "Unable to connect to PLC endpoint"), {
            ip: plcIp,
            port: plcPort,
            protocol,
          });
          plcConnection.transportError = message;
          plcConnection.error = message;
          errors.push(message);
        }
      }

      if (plcIp && plcPort && protocol === "MODBUS_TCP") {
        if (registerList.length === 0) {
          const message = "No Modbus register mapped on this machine";
          errors.push(message);
          plcConnection.readError = message;
          if (!plcConnection.error) {
            plcConnection.error = message;
          }
        } else {
          try {
            const readResult = await readModbusRegisters({
              ip: plcIp,
              port: plcPort,
              unitId: plcUnitId,
              registers: registerList,
              timeoutMs,
            });
            plcConnection.readConnected = true;
            for (const [registerNo, value] of Object.entries(readResult.values || {})) {
              registerValues[Number(registerNo)] = value;
            }
            if (Array.isArray(readResult.errors) && readResult.errors.length > 0) {
              for (const row of readResult.errors) {
                errors.push(
                  `Register ${row.register}: ${row.message}`
                );
              }
            }
          } catch (error) {
            const message = withPlcConnectivityHint(String(error.message || "Unable to read PLC register values"), {
              ip: plcIp,
              port: plcPort,
              protocol,
            });
            plcConnection.readError = message;
            plcConnection.error = message;
            errors.push(message);
          }
        }
      } else if (plcIp && plcPort && protocol === "SLMP") {
        if (registerList.length === 0) {
          const message = "No SLMP register mapped on this machine";
          errors.push(message);
          plcConnection.readError = message;
          if (!plcConnection.error) {
            plcConnection.error = message;
          }
        } else {
          try {
            let slmpFrameMode = "AUTO";
            try {
              const parsed = machine?.plc_registers ? JSON.parse(machine.plc_registers) : null;
              const rawMode = String(parsed?.slmpFrameMode ?? parsed?.slmpFrame ?? parsed?.frameMode ?? "").trim().toUpperCase();
              if (["ASCII", "BINARY", "AUTO"].includes(rawMode)) slmpFrameMode = rawMode;
            } catch (_error) {
              // keep AUTO
            }
            const readResult = await readSlmpRegisters({
              ip: plcIp,
              port: plcPort,
              registers: slmpRegisterSpecs,
              timeoutMs,
              defaultDevice: slmpDefaultDevice,
              frameMode: slmpFrameMode,
            });
            plcConnection.readConnected = true;
            for (const [registerNo, value] of Object.entries(readResult.values || {})) {
              registerValues[Number(registerNo)] = value;
            }
            if (Array.isArray(readResult.errors) && readResult.errors.length > 0) {
              for (const row of readResult.errors) {
                errors.push(`Register ${row.device || slmpDefaultDevice}${row.register}: ${row.message}`);
              }
            }
          } catch (error) {
            const message = withPlcConnectivityHint(String(error.message || "Unable to read SLMP register values"), {
              ip: plcIp,
              port: plcPort,
              protocol,
            });
            plcConnection.readError = message;
            plcConnection.error = message;
            errors.push(message);
          }
        }
      }

      const stableState = applyPlcConnectionStability(machine.id, plcConnection);
      plcConnection.connected = stableState.connected;
      plcConnection.instantConnected = stableState.instantConnected;
      plcConnection.failureCount = stableState.failureCount;
      plcConnection.holdActive = stableState.holdActive;

      const latestPlcStatus = toUpper(latestLog?.plc_status);
      const rows = buildIoSignalRows(machine, registerValues, latestPlcStatus);
      const plcHealth = getPlcHealthSnapshot(machine.id) || null;
      const plcCircuit = getPlcCircuitSnapshot().find((entry) => entry.key === `machine:${machine.id}`) || null;
      const scannerHealth = scanner
        ? scannerConnectionManager.getStableSnapshot({ machineId: machine.id, scannerIp: scanner.scanner_ip })
          || (await buildScannerHealth(scanner, machine.id))
        : await buildScannerHealth(null, machine.id);
      const machineState = plcHandshakeEngine.getState(machine.id);

      const payload = {
        snapshotAt: checkedAt,
        machine: {
          id: machine.id,
          machineName: machine.machine_name,
          lineName: machine.line_name,
          sequenceNo: machine.sequence_no,
          operationNo: machine.operation_no,
          stationNo,
          isRunning: Boolean(machine.is_running),
          runningPartId: machine.running_part_id || null,
          runningStationNo: machine.running_station_no || null,
          runningStartedAt: machine.running_started_at || null,
        },
        plc: {
          ip: plcIp,
          port: plcPort,
          protocol,
          unitId: plcUnitId,
        },
        plcConnection,
        plcHealth,
        plcCircuit,
        plcQueue: plcConnectionManager.getQueueSnapshot(),
        scanner: scanner
          ? {
            id: scanner.id,
            scannerName: scanner.scanner_name,
            scannerIp: scanner.scanner_ip,
            scannerPort: scanner.scanner_port,
            scannerMode: scanner.scanner_mode || "TCP_CLIENT",
            isActive: scanner.is_active,
          }
          : null,
        scannerHealth,
        machineState,
        latestOperation: latestLog
          ? {
            operationLogId: latestLog.id,
            partId: latestLog.part_id,
            plcStatus: latestLog.plc_status,
            result: latestLog.result,
            interlockReason: latestLog.interlock_reason,
            createdAt: latestLog.createdAt,
          }
          : null,
        rows,
        registerValues,
        errors,
        monitorPolicy: {
          minIntervalMs: IO_SNAPSHOT_MIN_INTERVAL_MS,
          cacheMaxAgeMs: IO_SNAPSHOT_CACHE_MAX_AGE_MS,
          servedFromCache: false,
          throttled: false,
          cacheAgeMs: 0,
        },
      };
      return payload;
    })();

    ioSnapshotInFlight.set(cacheKey, snapshotPromise);
    snapshotPromise.finally(() => {
      if (ioSnapshotInFlight.get(cacheKey) === snapshotPromise) {
        ioSnapshotInFlight.delete(cacheKey);
      }
    });
    const payload = await snapshotPromise;
    ioSnapshotCache.set(cacheKey, { payload, savedAtMs: Date.now() });
    return res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getPartJourney = async (req, res) => {
  try {
    const requestedPartId = String(req.params.partId || "").trim();
    const resolvedCode = await resolveMappedPartId(requestedPartId);
    const partId = resolvedCode.resolvedPartId || requestedPartId;
    const mappingSeedIds = uniqueStages([requestedPartId, partId].filter(Boolean));
    const initialCustomerMappings = await PartCodeMapping.findAll({
      where: {
        is_active: true,
        [Op.or]: [
          { old_part_id: { [Op.in]: mappingSeedIds } },
          { customer_qr: { [Op.in]: mappingSeedIds } },
        ],
      },
      attributes: ["old_part_id", "customer_qr"],
      raw: true,
    });
    const traceabilityPartIds = uniqueStages([
      ...mappingSeedIds,
      ...initialCustomerMappings.flatMap((row) => [row.old_part_id, sanitizeCustomerQrValue(row.customer_qr)]),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean));
    const canonicalTraceabilityPartId = String(
      initialCustomerMappings.find((row) => {
        const oldKey = String(row.old_part_id || "").trim().toUpperCase();
        const customerKey = sanitizeCustomerQrValue(row.customer_qr).toUpperCase();
        const requestedKey = String(requestedPartId || "").trim().toUpperCase();
        const resolvedKey = String(partId || "").trim().toUpperCase();
        return (
          oldKey &&
          (oldKey === requestedKey || oldKey === resolvedKey || customerKey === requestedKey || customerKey === resolvedKey)
        );
      })?.old_part_id || partId || requestedPartId
    ).trim();
    const [part, logs, reworkHistory, auditLogs, sequenceData] = await Promise.all([
      Part.findOne({ where: { part_id: canonicalTraceabilityPartId } })
        .then((row) => row || Part.findOne({ where: { part_id: { [Op.in]: traceabilityPartIds } } })),
      OperationLog.findAll({
        where: { part_id: { [Op.in]: traceabilityPartIds } },
        order: [["createdAt", "ASC"]],
      }),
      ReworkLog.findAll({
        where: { part_id: { [Op.in]: traceabilityPartIds } },
        order: [["createdAt", "DESC"]],
      }),
      ProductionLog.findAll({
        where: { part_id: { [Op.in]: traceabilityPartIds } },
        order: [["createdAt", "DESC"]],
        limit: 150,
      }),
      getActiveMachineSequenceData(),
    ]);

    if (!part && logs.length === 0) {
      return res.json({
        part: {
          part_id: requestedPartId,
          status: "NOT_FOUND",
          current_station: null,
          current_operation: null,
        },
        sequence: sequenceData.sequence || [],
        expectedNextStation: sequenceData.sequence?.[0] || null,
        journey: [],
        stationTimeline: [],
        interlockHistory: [],
        auditTrail: [],
        reworkHistory: [],
        notFound: true,
      });
    }

    const machineIds = uniqueStages(
      [...logs.map((log) => Number(log.machine_id)), ...auditLogs.map((log) => Number(log.machine_id))]
        .filter((entry) => Number.isFinite(entry) && entry > 0)
        .map((entry) => String(entry))
    )
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));

    const machineRows =
      machineIds.length > 0
        ? await Machine.findAll({
          where: { id: { [Op.in]: machineIds } },
          attributes: ["id", "machine_name", "machine_type", "operation_no", "sequence_no"],
        })
        : [];

    const machineMap = machineRows.reduce((acc, machine) => {
      const machineId = getModelValue(machine, "id");
      acc[machineId] = {
        id: machineId,
        machineName: getModelValue(machine, "machine_name"),
        machineType: getModelValue(machine, "machine_type"),
        stationNo: getMachineOperationStage(machine),
        sequenceNo: getModelValue(machine, "sequence_no"),
      };
      return acc;
    }, {});
    const stationMachineMeta = (Array.isArray(sequenceData?.machines) ? sequenceData.machines : []).reduce((acc, machine) => {
      const station = getMachineOperationStage(machine);
      if (!station || acc[station]) return acc;
      acc[station] = {
        machineId: getModelValue(machine, "id"),
        machineName: getModelValue(machine, "machine_name"),
        machineType: getModelValue(machine, "machine_type"),
        stationNo: station,
        sequenceNo: getModelValue(machine, "sequence_no"),
        requiresCustomerQr: requiresCustomerQrForCompletion(machine),
      };
      return acc;
    }, {});

    const productionLogs = logs.filter((row) => !isJourneyNoiseLog(row));
    const journey = productionLogs.map(toJourneyRow);
    const logsByStation = journey.reduce((acc, row) => {
      if (!row.stationNo) {
        return acc;
      }
      if (!acc[row.stationNo]) {
        acc[row.stationNo] = [];
      }
      acc[row.stationNo].push(row);
      return acc;
    }, {});

    const knownStations = uniqueStages([
      ...sequenceData.sequence,
      ...Object.keys(logsByStation),
      ...auditLogs
        .map((entry) => {
          const machine = machineMap[Number(entry.machine_id)];
          return normalizeStation(machine?.stationNo);
        })
        .filter(Boolean),
    ]);
    const customerMappings = await PartCodeMapping.findAll({
      where: {
        [Op.or]: [
          { old_part_id: { [Op.in]: traceabilityPartIds } },
          { customer_qr: { [Op.in]: traceabilityPartIds } },
        ],
        is_active: true,
      },
      attributes: ["old_part_id", "customer_qr", "station_no", "machine_id", "createdAt", "updatedAt"],
      order: [["updatedAt", "DESC"]],
      raw: true,
    });
    const allCustomerMappings = [...initialCustomerMappings, ...customerMappings];
    const hasGlobalCustomerQr = allCustomerMappings.some((row) => sanitizeCustomerQrValue(row.customer_qr));
    const customerMappingByStation = customerMappings.reduce((acc, row) => {
      const key = normalizeStation(row.station_no);
      const customerQrCode = sanitizeCustomerQrValue(row.customer_qr);
      if (!key || acc[key]) return acc;
      if (!customerQrCode) return acc;
      acc[key] = {
        customerQrCode,
        customerQrMappedAt: row.updatedAt || row.createdAt || null,
        customerQrMachineId: row.machine_id || null,
      };
      return acc;
    }, {});
    const customerQrByPartId = customerMappings.reduce((acc, row) => {
      const key = String(partId || "").trim().toUpperCase();
      const oldKey = String(row.old_part_id || "").trim().toUpperCase();
      const customerKey = String(row.customer_qr || "").trim().toUpperCase();
      const customerQrCode = sanitizeCustomerQrValue(row.customer_qr);
      if (customerQrCode) {
        if (key && !acc[key]) acc[key] = customerQrCode;
        if (oldKey && !acc[oldKey]) acc[oldKey] = customerQrCode;
        if (customerKey && !acc[customerKey]) acc[customerKey] = customerQrCode;
      }
      return acc;
    }, {});
    const leaktestIndex = await buildLeaktestIndex({
      partIds: traceabilityPartIds,
      customerQrByPartId,
      machines: Array.isArray(sequenceData?.machines) ? sequenceData.machines : [],
    });
    const bypassMetaByStation = {};
    await Promise.all(knownStations.map(async (stationNo) => {
      bypassMetaByStation[stationNo] = await getStationBypassMetaForJourney(
        stationNo,
        Array.isArray(sequenceData?.machines) ? sequenceData.machines : []
      );
    }));

    const currentStation = normalizeStation(part?.current_station);
    const currentIndex = sequenceData.sequence.findIndex((station) => station === currentStation);
    const expectedNextStation =
      !part || part.status === "COMPLETED"
        ? null
        : currentIndex < 0
          ? sequenceData.sequence[0] || null
          : sequenceData.sequence[currentIndex + 1] || null;

    const stationTimeline = knownStations.map((stationNo, idx) => {
      const stationMeta = stationMachineMeta[stationNo] || null;
      const leakTestReadings = stationNo === LEAKTEST_OPERATION
        ? (
          traceabilityPartIds
            .map((candidatePartId) => getAllLeaktestReadingsForPart(leaktestIndex.byPartAndIp, candidatePartId, stationNo))
            .find((readings) => readings && readings.length > 0) || []
        )
        : [];
      
      // Preserve single reading for backwards compatibility in UI components that expect it
      const leakTestReading = leakTestReadings[leakTestReadings.length - 1] || null;
      let attempts = (logsByStation[stationNo] || []).map((row) => ({
        id: row.id,
        plcStatus: row.plcStatus,
        result: row.result,
        resultSource: row.resultSource,
        resultInput: row.resultInput,
        qualityPayload: row.qualityPayload || null,
        interlockReason: row.interlockReason,
        isBypassed: row.isBypassed,
        bypassReason: row.bypassReason,
        plcStartTime: row.plcStartTime,
        plcEndTime: row.plcEndTime,
        createdAt: row.createdAt,
        machine: machineMap[row.machineId] || null,
      }));
      const bypassMeta = bypassMetaByStation[stationNo] || { bypassed: false, reason: null };
      const hasBypassAttempt = attempts.some((attempt) => attempt.isBypassed === true);
      if (bypassMeta.bypassed && !hasBypassAttempt) {
        attempts = [
          ...attempts,
          {
            id: `bypass-${stationNo}`,
            plcStatus: "ENDED_OK",
            result: "OK",
            resultSource: "BYPASS",
            resultInput: null,
            qualityPayload: null,
            interlockReason: null,
            isBypassed: true,
            bypassReason: bypassMeta.reason || "STATION_BYPASS_AUTO_OK",
            plcStartTime: null,
            plcEndTime: null,
            createdAt: null,
            machine: stationMeta
              ? {
                id: stationMeta.machineId,
                machineName: stationMeta.machineName,
                stationNo,
                sequenceNo: stationMeta.sequenceNo,
              }
              : null,
          },
        ];
      }

      const latestAttempt = attempts[attempts.length - 1] || null;

      // ── Bug fix: ENDED_OK / ENDED_NG ALWAYS win as terminal state.
      // A duplicate-scan INTERLOCKED log must NOT override a completed station.
      const endedOkAttempt  = attempts.find(isJourneyPassedAttempt);
      const endedNgAttempt  = attempts.find(isJourneyFailedAttempt);
      // Best attempt for display: prefer the actual production outcome
      const productionAttempt = endedNgAttempt || endedOkAttempt || null;
      // The attempt whose values we surface as "latest" (hide duplicate/interlocked noise)
      const representativeAttempt = productionAttempt || latestAttempt;

      let stageState = "PENDING";
      const waitingForCustomerQr = Boolean(
        stationMeta?.requiresCustomerQr &&
        !hasGlobalCustomerQr &&
        !customerMappingByStation[stationNo]?.customerQrCode &&
        (
          stationNo === currentStation ||
          stationNo === expectedNextStation ||
          attempts.some((attempt) => String(attempt.plcStatus || "").trim().toUpperCase() === "WAITING_CUSTOMER_QR")
        )
      );

      if (leakTestReadings.length > 0) {
        stageState = getLeaktestStageStateFromReadings(leakTestReadings);
      } else if (bypassMeta.bypassed) {
        stageState = "PASSED";
      } else if (endedNgAttempt) {
        stageState = "FAILED";
      } else if (endedOkAttempt) {
        stageState = "PASSED";
      } else if (latestAttempt) {
        if (latestAttempt.plcStatus === "PLC_COMM_ERROR") {
          stageState = "COMM_ERROR";
        } else if (latestAttempt.plcStatus === "INTERLOCKED") {
          stageState = "INTERLOCKED";
        } else if (latestAttempt.plcStatus === "RESET") {
          stageState = "PENDING";
        } else {
          stageState = "IN_PROGRESS";
        }
      } else if (expectedNextStation === stationNo) {
        stageState = "NEXT";
      }

      if (waitingForCustomerQr && stageState === "PASSED") {
        stageState = "IN_PROGRESS";
      }

      // ── Cycle timing: QR scan time → operation end time
      // cycleStartTime = createdAt of the PENDING log (moment QR was scanned)
      const pendingAttempt = attempts.find(a => a.plcStatus === "PENDING" || a.plcStatus === "STARTED");
      const cycleStartTime  = pendingAttempt?.createdAt || productionAttempt?.createdAt || null;
      const cycleEndTime    = waitingForCustomerQr ? null : (leakTestReading?.cycleEndTime || productionAttempt?.plcEndTime || null);
      const cycleDurationSec = (cycleStartTime && cycleEndTime)
        ? Math.max(0, (new Date(cycleEndTime) - new Date(cycleStartTime)) / 1000)
        : null;

      return {
        stationNo,
        stationName: stationMeta?.machineName || representativeAttempt?.machine?.machineName || null,
        machineName: stationMeta?.machineName || representativeAttempt?.machine?.machineName || leakTestReading?.matchedMachineName || null,
        operationNo: stationMeta?.stationNo || representativeAttempt?.machine?.stationNo || stationNo,
        machineId: stationMeta?.machineId || representativeAttempt?.machine?.id || null,
        sequenceIndex: idx + 1,
        stageState,
        isNextExpected: expectedNextStation === stationNo,
        latestStatus: leakTestReading
          ? (leakTestReading.result === "OK" ? "ENDED_OK" : leakTestReading.result === "NG" ? "ENDED_NG" : "PENDING")
          : (representativeAttempt?.plcStatus || null),
        latestResult: leakTestReading?.result || representativeAttempt?.result || null,
        latestInterlockReason: representativeAttempt?.interlockReason || null,
        latestAt: waitingForCustomerQr ? (pendingAttempt?.createdAt || representativeAttempt?.createdAt || null) : (leakTestReading?.cycleEndTime || representativeAttempt?.createdAt || null),
        cycleStartTime,
        cycleEndTime,
        cycleDurationSec,
        attempts,
        leakTestReading,
        leakTestReadings,
        requiresCustomerQr: Boolean(stationMeta?.requiresCustomerQr),
        customerQrPending: waitingForCustomerQr,
        customerQrCode: customerMappingByStation[stationNo]?.customerQrCode || null,
        customerQrMappedAt: customerMappingByStation[stationNo]?.customerQrMappedAt || null,
        customerQrMachineId: customerMappingByStation[stationNo]?.customerQrMachineId || null,
      };
    });

    const auditTrail = auditLogs.map((entry) => {
      const machine = machineMap[Number(entry.machine_id)] || null;
      return {
        id: entry.id,
        status: entry.status,
        reason: entry.ng_reason,
        machineId: entry.machine_id,
        machineName: machine?.machineName || null,
        stationNo: machine?.stationNo || null,
        createdAt: entry.createdAt,
      };
    });

    const mappedCustomerQrForPart = customerQrByPartId[String(partId || "").trim().toUpperCase()] || null;
    const mappedOldPartForPart = customerMappings.reduce((acc, row) => {
      const oldPart = String(row.old_part_id || "").trim();
      const customerQr = sanitizeCustomerQrValue(row.customer_qr);
      if (!oldPart) return acc;
      const oldKey = oldPart.toUpperCase();
      const customerKey = customerQr.toUpperCase();
      if (oldKey && !acc[oldKey]) acc[oldKey] = oldPart;
      if (customerKey && !acc[customerKey]) acc[customerKey] = oldPart;
      return acc;
    }, {})[String(partId || requestedPartId || "").trim().toUpperCase()] || null;
    const isCustomerQrOnlyPart =
      String(part?.qr_format_name || "").trim().toUpperCase() === CUSTOMER_QR_ONLY_FORMAT ||
      Boolean(mappedCustomerQrForPart && String(mappedCustomerQrForPart).trim().toUpperCase() === String(partId || "").trim().toUpperCase());
    const journeyDisplayPartId = isCustomerQrOnlyPart ? "" : (mappedOldPartForPart || String(part?.part_id || partId || "").trim());
    const partPayload = part
      ? {
          ...part.get({ plain: true }),
          traceabilityPartId: String(part.part_id || partId || "").trim(),
          mappedPartId: mappedOldPartForPart,
          displayPartId: journeyDisplayPartId,
          isCustomerQrOnly: isCustomerQrOnlyPart,
          customerQrCode: mappedCustomerQrForPart,
        }
      : {
          part_id: partId,
          traceabilityPartId: partId,
          mappedPartId: mappedOldPartForPart,
          status: "UNKNOWN",
          current_station: null,
          displayPartId: journeyDisplayPartId,
          isCustomerQrOnly: isCustomerQrOnlyPart,
          customerQrCode: mappedCustomerQrForPart,
        };

    res.json({
      part: partPayload,
      sequence: knownStations,
      expectedNextStation,
      journey,
      stationTimeline,
      interlockHistory: journey
        .filter((log) => log.interlockReason)
        .map((log) => ({
          id: log.id,
          stationNo: log.stationNo,
          reason: log.interlockReason,
          createdAt: log.createdAt,
        })),
      auditTrail,
      reworkHistory,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Part catalog — paged mode (GET /traceability/parts?paged=1), used by the Component Journey page.
//
// List mode (no search, or search with scopeSearchToFilters=1):
//   one row per physical part with at least one production (non-noise) operation log inside the window and the
//   machine / station / operator filters. Customer-QR logs are folded into their old_part_id when a mapping exists,
//   so a part appears once. Ordered by the part's last activity in the window (lastAt DESC, part id), paged with
//   OFFSET/FETCH, total from the same query.
//   Shift filter: the shift of the part's LAST production scan inside the window (lastAt) — every part has exactly
//   one lastAt, so Shift A + B + C pages add up to the day.
//   Status filter: Parts.status of the physical part; OTHER = customer-QR-only parts (as in the legacy response).
// Search mode (search given, scopeSearchToFilters != 1): independent of dates / shift / machine / status.
//   exact (customer QR / part ID / old part ID) → shot number (DPM shot segment) → partial (≥ 4 chars, prefix
//   matches ranked before contains matches).
// latestAt / latestStation / machineName are computed from production logs inside the window (all-time in search
// mode) for the returned page only.
// ─────────────────────────────────────────────────────────────────────────────
const CATALOG_PAGE_SIZE_DEFAULT = 100;
const CATALOG_PAGE_SIZE_MAX = 500;
const CATALOG_PARTIAL_MIN_LENGTH = 4;
const CATALOG_STATUSES = new Set(["IN_PROGRESS", "COMPLETED", "NG", "INTERLOCKED", "REWORK"]);

const sqlQuote = (value) => `N'${String(value).replace(/'/g, "''")}'`;

// Mirror of isJourneyNoiseLog() as a SQL predicate (TRUE = production log). Collation is case-insensitive.
function catalogProductionLogSql(alias = "ol") {
  const reasons = [...JOURNEY_NOISE_REASONS].map(sqlQuote).join(", ");
  const plc = `LTRIM(RTRIM(ISNULL(${alias}.plc_status, '')))`;
  const vr = `LTRIM(RTRIM(ISNULL(${alias}.validation_result, '')))`;
  const reason = `LTRIM(RTRIM(ISNULL(${alias}.interlock_reason, '')))`;
  const result = `LTRIM(RTRIM(ISNULL(${alias}.result, '')))`;
  return `(
    (ISNULL(${alias}.is_bypassed, 0) = 1 AND (${result} = 'OK' OR ${plc} = 'ENDED_OK'))
    OR (ISNULL(${alias}.is_bypassed, 0) = 0
      AND ${plc} <> 'VALIDATION_ONLY'
      AND ${vr} NOT IN ('FAILED', 'DUPLICATE', 'BLOCKED')
      AND ${reason} NOT IN (${reasons})
      AND NOT (${plc} = 'INTERLOCKED' AND ${result} = 'BLOCK'))
  )`;
}

// Mirror of looksLikePartialTraceabilityId() (stray scanner fragments) — plus empty / "-" ids.
function catalogPartialIdSql(column) {
  const alnumOnly = `${column} NOT LIKE '%[^A-Za-z0-9]%'`;
  const shotTail = "T[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][A-Za-z][0-9][0-9][0-9][0-9]";
  return `(
    ${column} IS NULL OR LTRIM(RTRIM(${column})) IN ('', '-')
    OR (LEN(${column}) <= 6 AND ${alnumOnly})
    OR (LEN(${column}) = 7 AND ${column} LIKE '[A-Za-z][0-9][0-9][0-9][0-9][0-9][0-9]')
    OR (${alnumOnly} AND ${column} LIKE '%${shotTail}'
      AND (LEN(${column}) <= 18 OR (LEN(${column}) <= 20 AND SUBSTRING(${column}, LEN(${column}) - 15, 2) = '54')))
  )`;
}

// A row is kept unless its id is a fragment AND no customer-QR mapping knows it (legacy rule).
function catalogUsableKeySql(column) {
  return `NOT (${catalogPartialIdSql(column)} AND NOT EXISTS (
    SELECT 1 FROM PartCodeMappings um WHERE um.is_active = 1 AND (um.old_part_id = ${column} OR um.customer_qr = ${column})
  ))`;
}

// Customer-QR-only = no distinct old-part ↔ customer-QR mapping, and the part is flagged / self-mapped as customer QR.
function catalogCustomerQrOnlySql(keyColumn, partAlias = "p") {
  return `(
    NOT EXISTS (SELECT 1 FROM PartCodeMappings dm WHERE dm.is_active = 1 AND dm.old_part_id <> dm.customer_qr
      AND (dm.old_part_id = ${keyColumn} OR dm.customer_qr = ${keyColumn}))
    AND (UPPER(LTRIM(RTRIM(ISNULL(${partAlias}.qr_format_name, '')))) = '${CUSTOMER_QR_ONLY_FORMAT}'
      OR EXISTS (SELECT 1 FROM PartCodeMappings sm WHERE sm.is_active = 1 AND sm.old_part_id = sm.customer_qr AND sm.old_part_id = ${keyColumn}))
  )`;
}

const isDateOnlyValue = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());

function resolveCatalogWindow(query, shifts, now = new Date()) {
  const dateFrom = String(query.dateFrom || "").trim();
  const dateTo = String(query.dateTo || "").trim();
  // asOf freezes the upper bound for "load more" pages so offsets stay stable while new scans arrive
  const asOf = query.asOf ? new Date(query.asOf) : null;
  const validAsOf = asOf && !Number.isNaN(asOf.getTime()) ? asOf : null;
  if (!dateFrom && !dateTo) return validAsOf ? { from: new Date(0), to: validAsOf, allDates: true } : null; // all dates
  let window;
  if (isDateOnlyValue(dateFrom) && (!dateTo || isDateOnlyValue(dateTo))) {
    window = require("../utils/productionDay").productionWindow({ dateFrom, dateTo: dateTo || dateFrom, shifts, now });
  } else {
    window = getDateRangeFromQuery(query);
  }
  if (validAsOf && validAsOf < window.to) window = { from: window.from, to: validAsOf };
  return window;
}

async function resolveCatalogScope(query) {
  const shifts = await getActiveShiftDefinitions();
  const now = new Date();
  const window = resolveCatalogWindow(query, shifts, now);
  const statusFilter = String(query.status || "").trim().toUpperCase();
  const shiftInput = normalizeShiftAlias(query.shiftCode);
  const shiftDef = shiftInput
    ? shifts.find((row) => normalizeShiftAlias(row.shift_code || row.shift_name) === shiftInput) || null
    : null;
  const lineNameFilter = normalizeLineName(query.lineName);
  const machineIdFilter = Number(query.machineId || 0) || null;
  let machineIds = null;
  if (machineIdFilter) {
    machineIds = [machineIdFilter];
  } else if (lineNameFilter) {
    const machines = await Machine.findAll({ where: { line_name: lineNameFilter }, attributes: ["id"], raw: true });
    machineIds = machines.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
  }
  return {
    now,
    shifts,
    window,
    status: statusFilter === "OTHER" || CATALOG_STATUSES.has(statusFilter) ? statusFilter : "",
    shiftCode: shiftInput ? (shiftDef ? shiftDef.shift_code : "__NO_SUCH_SHIFT__") : "",
    machineIds,
    stationNo: normalizeStation(query.stationNo) || "",
    operatorId: Number(query.operatorId || 0) || null,
    partId: String(query.partId || "").trim(),
  };
}

// WHERE fragments for operation logs (alias ol) inside the scope. Returns null when the scope can match nothing.
function catalogLogScopeSql(scope, replacements, { useWindow = true } = {}) {
  const where = [catalogProductionLogSql("ol"), "ol.part_id IS NOT NULL"];
  if (useWindow && scope.window) {
    where.push("ol.createdAt >= :winFrom AND ol.createdAt < :winTo");
    replacements.winFrom = scope.window.from;
    replacements.winTo = scope.window.to;
  }
  if (scope.machineIds) {
    if (!scope.machineIds.length) return null;
    where.push("ol.machine_id IN (:machineIds)");
    replacements.machineIds = scope.machineIds;
  }
  if (scope.stationNo) {
    where.push("(ol.station_no = :stationNo OR (NULLIF(LTRIM(RTRIM(ISNULL(ol.station_no, ''))), '') IS NULL AND ol.operation_no = :stationNo))");
    replacements.stationNo = scope.stationNo;
  }
  if (scope.operatorId) {
    where.push("ol.user_id = :operatorId");
    replacements.operatorId = scope.operatorId;
  }
  return where.join("\n      AND ");
}

// Predicate on a part key: matches the key itself or the customer QR mapped to it.
function catalogKeyLikeSql(keyColumn, paramName) {
  return `(${keyColumn} LIKE :${paramName} ESCAPE '\\' OR EXISTS (SELECT 1 FROM PartCodeMappings km WHERE km.is_active = 1
    AND km.old_part_id = ${keyColumn} AND km.customer_qr LIKE :${paramName} ESCAPE '\\'))`;
}

function catalogLikeParam(value, mode) {
  const escaped = String(value || "").replace(/[\\%_[]/g, (ch) => `\\${ch}`);
  return mode === "prefix" ? `${escaped}%` : `%${escaped}%`;
}

function catalogStatusSql(scope, keyColumn, partAlias, replacements) {
  if (!scope.status) return null;
  if (scope.status === "OTHER") return catalogCustomerQrOnlySql(keyColumn, partAlias);
  replacements.statusFilter = scope.status;
  return `${partAlias}.status = :statusFilter`;
}

/** Physical part key for a code: old_part_id when the code is a mapped customer QR, else the code. */
async function resolveCatalogKeysForCodes(codes) {
  const values = uniqueStages(codes.map((value) => String(value || "").trim()).filter(Boolean));
  if (!values.length) return [];
  const mappings = await PartCodeMapping.findAll({
    where: { is_active: true, [Op.or]: [{ customer_qr: { [Op.in]: values } }, { old_part_id: { [Op.in]: values } }] },
    attributes: ["old_part_id", "customer_qr"],
    raw: true,
  });
  const parts = await Part.findAll({ where: { part_id: { [Op.in]: values } }, attributes: ["part_id"], raw: true });
  const keys = [];
  for (const row of mappings) keys.push(String(row.old_part_id || "").trim());
  const mappedCodes = new Set(mappings.flatMap((row) => [String(row.old_part_id || "").trim().toUpperCase(), String(row.customer_qr || "").trim().toUpperCase()]));
  for (const row of parts) {
    const id = String(row.part_id || "").trim();
    if (!mappedCodes.has(id.toUpperCase())) keys.push(id);
  }
  return uniqueStages(keys.filter(Boolean));
}

/** Hydrate a page of part keys into catalog rows (same fields as the legacy response, plus firstAt/logCount). */
async function hydrateCatalogRows(entries, scope, { useWindow }) {
  const keys = entries.map((entry) => entry.key);
  if (!keys.length) return [];
  // two single-column lookups (each a unique-index seek) instead of one OR'd query
  const [mappingsByOld, mappingsByCustomer, parts, qrRules] = await Promise.all([
    PartCodeMapping.findAll({
      where: { is_active: true, old_part_id: { [Op.in]: keys } },
      attributes: ["old_part_id", "customer_qr", "updatedAt"],
      raw: true,
    }),
    PartCodeMapping.findAll({
      where: { is_active: true, customer_qr: { [Op.in]: keys } },
      attributes: ["old_part_id", "customer_qr", "updatedAt"],
      raw: true,
    }),
    Part.findAll({ where: { part_id: { [Op.in]: keys } }, raw: true }),
    QrFormatRule.findAll({ where: { is_active: true }, attributes: ["regex_pattern"], raw: true }),
  ]);
  const mappings = [...mappingsByOld, ...mappingsByCustomer]
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  const customerQrByKey = {};
  const oldPartByKey = {};
  for (const row of mappings) {
    const oldPart = String(row.old_part_id || "").trim();
    const customerQr = String(row.customer_qr || "").trim();
    for (const k of [oldPart.toUpperCase(), customerQr.toUpperCase()]) {
      if (!k) continue;
      if (customerQr && !customerQrByKey[k]) customerQrByKey[k] = customerQr;
      if (oldPart && !oldPartByKey[k]) oldPartByKey[k] = oldPart;
    }
  }
  const partByKey = new Map(parts.map((row) => [String(row.part_id || "").trim().toUpperCase(), row]));

  // Latest production log per part inside the scope — the part's own logs plus the logs of the customer QR mapped
  // to it — one index seek per key (OperationLogs.part_id).
  const replacements = {};
  const scopeSql = catalogLogScopeSql(scope, replacements, { useWindow }) || "1 = 0";
  const cols = "ol.id, ol.station_no, ol.operation_no, ol.plc_status, ol.result, ol.machine_id, ol.user_id, ol.createdAt";
  const latestRows = await sequelize.query(`
    SELECT k.pkey, x.station_no, x.operation_no, x.plc_status, x.result, x.machine_id, x.user_id, x.createdAt
    FROM (VALUES ${keys.map((key) => `(${sqlQuote(key)})`).join(", ")}) AS k(pkey)
    CROSS APPLY (
      SELECT TOP 1 u.* FROM (
        SELECT ${cols} FROM OperationLogs ol
        WHERE ol.part_id = k.pkey AND ${scopeSql}
        UNION ALL
        SELECT ${cols} FROM PartCodeMappings m
        JOIN OperationLogs ol ON ol.part_id = m.customer_qr
        WHERE m.old_part_id = k.pkey AND m.old_part_id <> m.customer_qr AND m.is_active = 1 AND ${scopeSql}
      ) u
      ORDER BY u.createdAt DESC, u.id DESC
    ) x
  `, { replacements, type: sequelize.QueryTypes.SELECT });
  const latestByKey = new Map(latestRows.map((row) => [String(row.pkey || "").trim().toUpperCase(), row]));
  const machineIds = uniqueStages(latestRows.map((row) => String(row.machine_id || "")).filter(Boolean)).map(Number).filter(Number.isFinite);
  const machineRows = machineIds.length
    ? await Machine.findAll({ where: { id: { [Op.in]: machineIds } }, attributes: ["id", "machine_name", "line_name"], raw: true })
    : [];
  const machineMap = new Map(machineRows.map((row) => [Number(row.id), row]));

  const matchesQrRule = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return false;
    return qrRules.some((rule) => {
      const pattern = String(rule.regex_pattern || "").trim();
      if (!pattern) return false;
      try { return new RegExp(pattern, "i").test(raw); } catch (_error) { return false; }
    });
  };
  const looksPartial = (value) => {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return false;
    if (/^R\d{9}-[A-Z0-9-]{10,}$/.test(raw)) return false;
    if (/^\d{8}[A-Z0-9]\d{1,6}$/.test(raw)) return false;
    return /^[A-Z]?\d{3,6}$/.test(raw) || /^[A-Z0-9]{1,6}$/.test(raw)
      || /^[A-Z0-9]{0,4}54T\d{8}[A-Z]\d{4}$/i.test(raw) || /^[A-Z0-9]{0,4}T\d{8}[A-Z]\d{4}$/i.test(raw);
  };
  const isUsable = (value) => {
    const raw = String(value || "").trim();
    if (!raw || raw === "-") return false;
    if (matchesQrRule(raw)) return true;
    if (looksPartial(raw)) return false;
    return qrRules.length === 0 && /^[A-Za-z0-9][A-Za-z0-9\-_/.:]{7,127}$/.test(raw);
  };

  return entries.map((entry) => {
    const rawPartId = String(entry.key || "").trim();
    const upper = rawPartId.toUpperCase();
    const part = partByKey.get(upper) || null;
    const latest = latestByKey.get(upper) || null;
    const machine = latest ? machineMap.get(Number(latest.machine_id)) || null : null;
    const mappedCustomerQr = customerQrByKey[upper] || "";
    const mappedOldPart = oldPartByKey[upper] || "";
    const hasDistinctCustomerMapping = Boolean(mappedOldPart && mappedCustomerQr && mappedOldPart.toUpperCase() !== mappedCustomerQr.toUpperCase());
    const canonicalPartId = mappedOldPart || rawPartId;
    const isCustomerQrOnly = !hasDistinctCustomerMapping && (
      String(part?.qr_format_name || "").trim().toUpperCase() === CUSTOMER_QR_ONLY_FORMAT ||
      Boolean(mappedOldPart && mappedCustomerQr && mappedOldPart.toUpperCase() === mappedCustomerQr.toUpperCase())
    );
    const safeDisplay = isUsable(canonicalPartId) ? canonicalPartId : isUsable(mappedOldPart) ? mappedOldPart : isUsable(rawPartId) ? rawPartId : "";
    const displayPartId = isCustomerQrOnly ? "" : safeDisplay;
    const traceabilityPartId = displayPartId || mappedCustomerQr || canonicalPartId;
    return {
      partId: traceabilityPartId,
      traceabilityPartId,
      rawPartId,
      displayPartId,
      mappedPartId: mappedOldPart || null,
      customerQrCode: mappedCustomerQr || null,
      isCustomerQrOnly,
      status: part?.status || "UNKNOWN",
      currentStation: part?.current_station || null,
      currentOperation: part?.current_operation || null,
      isInterlocked: Boolean(part?.is_interlocked),
      interlockReason: part?.interlock_reason || null,
      isRework: Boolean(part?.is_rework),
      qrFormatName: part?.qr_format_name || null,
      updatedAt: part?.updatedAt || null,
      latestStatus: latest?.plc_status || null,
      latestResult: latest?.result || null,
      latestStation: normalizeStation(latest?.station_no || latest?.operation_no) || null,
      latestAt: entry.lastAt || latest?.createdAt || null,
      firstAt: entry.firstAt || null,
      logCount: entry.logCount ?? null,
      machineId: latest?.machine_id || null,
      machineName: machine?.machine_name || null,
      lineName: machine?.line_name || null,
      operatorId: latest?.user_id || null,
      matchRank: entry.rank ?? null,
    };
  });
}

/** Window list: distinct physical parts with production activity in the scope (optionally narrowed by a search predicate). */
async function queryCatalogWindowPage(scope, { page, pageSize, keyPredicate = null, keyPredicateReplacements = {} }) {
  const replacements = { ...keyPredicateReplacements, offset: (page - 1) * pageSize, pageSize };
  const logScopeSql = catalogLogScopeSql(scope, replacements, { useWindow: true });
  if (!logScopeSql) return { rows: [], total: 0 };
  const outer = [`${catalogUsableKeySql("g.pkey")}`, "p.id IS NOT NULL"];
  if (scope.shiftCode) {
    outer.push(`${require("../utils/productionDay").shiftCaseSql("g.lastAt", scope.shifts)} = :shiftCode`);
    replacements.shiftCode = scope.shiftCode;
  }
  const statusSql = catalogStatusSql(scope, "g.pkey", "p", replacements);
  if (statusSql) outer.push(statusSql);
  if (scope.partId) {
    outer.push(catalogKeyLikeSql("g.pkey", "partIdLike"));
    replacements.partIdLike = catalogLikeParam(scope.partId, "contains");
  }
  if (keyPredicate) outer.push(keyPredicate);
  const rows = await sequelize.query(`
    WITH scoped AS (
      SELECT COALESCE(m.old_part_id, ol.part_id) AS pkey, ol.createdAt
      FROM OperationLogs ol
      LEFT JOIN PartCodeMappings m ON m.customer_qr = ol.part_id AND m.old_part_id <> m.customer_qr AND m.is_active = 1
      WHERE ${logScopeSql}
    ), g AS (
      SELECT pkey, MIN(createdAt) AS firstAt, MAX(createdAt) AS lastAt, COUNT(*) AS logCount
      FROM scoped GROUP BY pkey
    )
    SELECT g.pkey, g.firstAt, g.lastAt, g.logCount, COUNT(*) OVER () AS total
    FROM g
    LEFT JOIN Parts p ON p.part_id = g.pkey
    WHERE ${outer.join("\n      AND ")}
    ORDER BY g.lastAt DESC, g.pkey ASC
    OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY
  `, { replacements, type: sequelize.QueryTypes.SELECT });
  return {
    rows: rows.map((row) => ({ key: row.pkey, firstAt: row.firstAt, lastAt: row.lastAt, logCount: Number(row.logCount || 0) })),
    // past the last page there is no row to carry COUNT(*) OVER () — total unknown (null), hasMore false
    total: rows.length ? Number(rows[0].total || 0) : (page > 1 ? null : 0),
  };
}

/** Search outside the filters: exact → shot number → partial. */
async function queryCatalogSearch(search, scope, { page, pageSize }) {
  const raw = String(search || "").trim();
  const collapsed = collapseRepeatedQrValue(raw);
  const partIdFilterSql = scope.partId ? catalogKeyLikeSql("k.pkey", "partIdLike") : null;
  const partIdReplacements = scope.partId ? { partIdLike: catalogLikeParam(scope.partId, "contains") } : {};

  // 1) exact customer QR / part id / old part id
  const exactKeys = await resolveCatalogKeysForCodes([raw, collapsed]);
  if (exactKeys.length) {
    let keys = exactKeys;
    if (scope.partId) {
      const needle = scope.partId.toUpperCase();
      const keyMappings = await PartCodeMapping.findAll({
        where: { is_active: true, old_part_id: { [Op.in]: keys } },
        attributes: ["old_part_id", "customer_qr"],
        raw: true,
      });
      keys = keys.filter((key) => key.toUpperCase().includes(needle) || keyMappings.some((row) =>
        String(row.old_part_id || "").trim().toUpperCase() === key.toUpperCase() && String(row.customer_qr || "").toUpperCase().includes(needle)));
    }
    const slice = keys.slice((page - 1) * pageSize, page * pageSize);
    return { rows: slice.map((key) => ({ key, rank: 0 })), total: keys.length, matchType: "exact", matchKind: "code" };
  }

  // 2) shot number (DPM part ids: 8 digits + machine code + shot) — same padding variants as the legacy search
  if (/^\d{1,6}$/.test(raw)) {
    const numericShot = String(Number(raw));
    const variants = uniqueStages([raw, numericShot, numericShot.padStart(4, "0"), numericShot.padStart(5, "0"), numericShot.padStart(6, "0")]);
    const replacements = { offset: (page - 1) * pageSize, pageSize, ...partIdReplacements };
    const variantSql = variants.map((value, index) => {
      replacements[`shot${index}`] = value;
      return `(LEN(p.part_id) = ${9 + value.length} AND SUBSTRING(p.part_id, 10, 6) = :shot${index})`;
    }).join(" OR ");
    const rows = await sequelize.query(`
      WITH k AS (
        SELECT p.part_id AS pkey, p.updatedAt
        FROM Parts p
        WHERE p.part_id LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]%' AND (${variantSql})
      )
      SELECT k.pkey, COUNT(*) OVER () AS total FROM k
      ${partIdFilterSql ? `WHERE ${partIdFilterSql}` : ""}
      ORDER BY k.updatedAt DESC, k.pkey ASC
      OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY
    `, { replacements, type: sequelize.QueryTypes.SELECT });
    if (rows.length || page > 1) {
      return {
        rows: rows.map((row) => ({ key: row.pkey, rank: 0 })),
        total: rows.length ? Number(rows[0].total || 0) : null,
        matchType: "exact",
        matchKind: "shot",
      };
    }
  }

  // 3) partial — prefix matches first, then contains; on part id, customer QR and old part id
  if (raw.length < CATALOG_PARTIAL_MIN_LENGTH) {
    return { rows: [], total: 0, matchType: "none", matchKind: null, minLength: CATALOG_PARTIAL_MIN_LENGTH };
  }
  const replacements = {
    offset: (page - 1) * pageSize,
    pageSize,
    prefixLike: catalogLikeParam(raw, "prefix"),
    containsLike: catalogLikeParam(raw, "contains"),
    ...partIdReplacements,
  };
  const outer = [catalogUsableKeySql("k.pkey")];
  if (partIdFilterSql) outer.push(partIdFilterSql);
  const rows = await sequelize.query(`
    WITH cand AS (
      SELECT COALESCE(m.old_part_id, p.part_id) AS pkey,
        CASE WHEN p.part_id LIKE :prefixLike ESCAPE '\\' THEN 0 ELSE 1 END AS rnk
      FROM Parts p
      LEFT JOIN PartCodeMappings m ON m.customer_qr = p.part_id AND m.old_part_id <> m.customer_qr AND m.is_active = 1
      WHERE p.part_id LIKE :containsLike ESCAPE '\\'
      UNION ALL
      SELECT m.old_part_id AS pkey,
        CASE WHEN m.customer_qr LIKE :prefixLike ESCAPE '\\' OR m.old_part_id LIKE :prefixLike ESCAPE '\\' THEN 0 ELSE 1 END AS rnk
      FROM PartCodeMappings m
      WHERE m.is_active = 1 AND (m.customer_qr LIKE :containsLike ESCAPE '\\' OR m.old_part_id LIKE :containsLike ESCAPE '\\')
    ), k AS (
      SELECT pkey, MIN(rnk) AS rnk FROM cand WHERE pkey IS NOT NULL GROUP BY pkey
    )
    SELECT k.pkey, k.rnk, COUNT(*) OVER () AS total
    FROM k
    LEFT JOIN Parts p ON p.part_id = k.pkey
    WHERE ${outer.join(" AND ")}
    ORDER BY k.rnk ASC, p.updatedAt DESC, k.pkey ASC
    OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY
  `, { replacements, type: sequelize.QueryTypes.SELECT });
  return {
    rows: rows.map((row) => ({ key: row.pkey, rank: Number(row.rnk) })),
    total: rows.length ? Number(rows[0].total || 0) : (page > 1 ? null : 0),
    matchType: rows.length || page > 1 ? "partial" : "none",
    matchKind: rows.length ? "partial" : null,
  };
}

/** Search narrowed to the filters (scopeSearchToFilters=1): the window list with a key predicate. */
async function queryCatalogScopedSearch(search, scope, { page, pageSize }) {
  const raw = String(search || "").trim();
  const exactKeys = await resolveCatalogKeysForCodes([raw, collapseRepeatedQrValue(raw)]);
  if (exactKeys.length) {
    const result = await queryCatalogWindowPage(scope, {
      page,
      pageSize,
      keyPredicate: "g.pkey IN (:exactKeys)",
      keyPredicateReplacements: { exactKeys },
    });
    return { ...result, matchType: "exact", matchKind: "code" };
  }
  if (/^\d{1,6}$/.test(raw)) {
    const numericShot = String(Number(raw));
    const variants = uniqueStages([raw, numericShot, numericShot.padStart(4, "0"), numericShot.padStart(5, "0"), numericShot.padStart(6, "0")]);
    const keyPredicateReplacements = {};
    const keyPredicate = `(g.pkey LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]%' AND (${variants.map((value, index) => {
      keyPredicateReplacements[`shot${index}`] = value;
      return `(LEN(g.pkey) = ${9 + value.length} AND SUBSTRING(g.pkey, 10, 6) = :shot${index})`;
    }).join(" OR ")}))`;
    const result = await queryCatalogWindowPage(scope, { page, pageSize, keyPredicate, keyPredicateReplacements });
    if (result.rows.length || page > 1) return { ...result, matchType: "exact", matchKind: "shot" };
  }
  if (raw.length < CATALOG_PARTIAL_MIN_LENGTH) {
    return { rows: [], total: 0, matchType: "none", matchKind: null, minLength: CATALOG_PARTIAL_MIN_LENGTH };
  }
  const result = await queryCatalogWindowPage(scope, {
    page,
    pageSize,
    keyPredicate: catalogKeyLikeSql("g.pkey", "searchLike"),
    keyPredicateReplacements: { searchLike: catalogLikeParam(raw, "contains") },
  });
  return { ...result, matchType: result.rows.length || page > 1 ? "partial" : "none", matchKind: result.rows.length ? "partial" : null };
}

async function getPartCatalogPaged(req, res) {
  const startedAt = Date.now();
  const page = Math.max(Math.floor(Number(req.query.page || 1)) || 1, 1);
  const pageSize = Math.min(Math.max(Math.floor(Number(req.query.pageSize || CATALOG_PAGE_SIZE_DEFAULT)) || CATALOG_PAGE_SIZE_DEFAULT, 1), CATALOG_PAGE_SIZE_MAX);
  const search = String(req.query.search || "").trim();
  const scopeSearch = String(req.query.scopeSearchToFilters || "") === "1";
  const scope = await resolveCatalogScope(req.query);

  let result;
  let useWindowForLatest = true;
  if (!search) {
    result = { ...(await queryCatalogWindowPage(scope, { page, pageSize })), matchType: null, matchKind: null };
  } else if (scopeSearch) {
    result = await queryCatalogScopedSearch(search, scope, { page, pageSize });
  } else {
    result = await queryCatalogSearch(search, scope, { page, pageSize });
    useWindowForLatest = false;
  }

  const hydrateScope = useWindowForLatest ? scope : { ...scope, machineIds: null, stationNo: "", operatorId: null };
  const rows = await hydrateCatalogRows(result.rows, hydrateScope, { useWindow: useWindowForLatest });
  const total = result.total;
  res.json({
    rows,
    total,
    page,
    pageSize,
    hasMore: total === null ? false : page * pageSize < total,
    matchType: result.matchType || null,
    matchKind: result.matchKind || null,
    minSearchLength: result.minLength || undefined,
    searchScoped: Boolean(search && scopeSearch),
    window: useWindowForLatest && scope.window && !scope.window.allDates
      ? { from: scope.window.from.toISOString(), to: scope.window.to.toISOString() }
      : null,
    asOf: (scope.window ? scope.window.to : scope.now).toISOString(),
    tookMs: Date.now() - startedAt,
  });
}

exports.getPartCatalog = async (req, res) => {
  try {
    if (String(req.query.paged || "") === "1") {
      return await getPartCatalogPaged(req, res);
    }
    const search = String(req.query.search || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 400);
    const { from, to } = getDateRangeFromQuery(req.query);
    const statusFilter = String(req.query.status || "").trim().toUpperCase();
    const shiftCodeFilter = req.query.shiftCode ? String(req.query.shiftCode).trim().toUpperCase() : null;
    const lineNameFilter = normalizeLineName(req.query.lineName);
    const stationFilter = normalizeStation(req.query.stationNo);
    const machineIdFilter = Number(req.query.machineId || 0) || null;
    const operatorIdFilter = Number(req.query.operatorId || 0) || null;
    const partIdFilter = String(req.query.partId || "").trim();
    const searchPartValues = search ? await resolvePartIdSearchValues(search) : [];
    const partIdSearchValues = partIdFilter ? await resolvePartIdSearchValues(partIdFilter) : [];

    const partWhere = {};
    if (search) {
      partWhere.part_id = buildPartIdSearchCondition(searchPartValues) || { [Op.like]: `%${search}%` };
    }
    if (partIdFilter) {
      partWhere.part_id = buildPartIdSearchCondition(partIdSearchValues) || { [Op.like]: `%${partIdFilter}%` };
    }
    if (statusFilter && ["IN_PROGRESS", "COMPLETED", "NG", "INTERLOCKED", "REWORK"].includes(statusFilter)) {
      partWhere.status = statusFilter;
    }

    let scopedMachineIds = null;
    if (machineIdFilter) {
      scopedMachineIds = [machineIdFilter];
    } else if (lineNameFilter) {
      const machines = await Machine.findAll({
        where: { line_name: lineNameFilter },
        attributes: ["id"],
        raw: true,
      });
      scopedMachineIds = machines.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
      if (scopedMachineIds.length === 0) {
        return res.json([]);
      }
    }

    const operationWhere = {
      createdAt: {
        [Op.gte]: from,
        [Op.lte]: to,
      },
    };
    if (scopedMachineIds && scopedMachineIds.length > 0) {
      operationWhere.machine_id = { [Op.in]: scopedMachineIds };
    }
    if (stationFilter) {
      operationWhere.station_no = stationFilter;
    }
    if (operatorIdFilter) {
      operationWhere.user_id = operatorIdFilter;
    }

    const hasOperationLevelFilter =
      Boolean(req.query.dateFrom || req.query.dateTo || shiftCodeFilter || scopedMachineIds || stationFilter || operatorIdFilter);

    let scopedPartIds = null;
    if (hasOperationLevelFilter) {
      const scopedLogs = await OperationLog.findAll({
        where: operationWhere,
        attributes: ["part_id", "createdAt"],
        order: [["createdAt", "DESC"]],
        raw: true,
        limit: 6000,
      });
      const shifts = shiftCodeFilter ? await getActiveShiftDefinitions() : [];
      const filteredScopedLogs = shiftCodeFilter ? applyShiftFilter(scopedLogs, shiftCodeFilter, shifts, { from, to }) : scopedLogs;
      scopedPartIds = uniqueStages(filteredScopedLogs.map((row) => String(row.part_id || "").trim()).filter(Boolean));
      if (scopedPartIds.length === 0) {
        return res.json([]);
      }
      partWhere.part_id = partWhere.part_id
        ? {
          [Op.and]: [partWhere.part_id, { [Op.in]: scopedPartIds }],
        }
        : { [Op.in]: scopedPartIds };
    }

    const parts = await Part.findAll({
      where: Object.keys(partWhere).length ? partWhere : undefined,
      order: [["updatedAt", "DESC"]],
      limit,
    });
    if (!parts.length) {
      return res.json([]);
    }

    const partIds = parts.map((part) => part.part_id);
    const catalogMappings = partIds.length
      ? await PartCodeMapping.findAll({
        where: {
          is_active: true,
          [Op.or]: [
            { old_part_id: { [Op.in]: partIds } },
            { customer_qr: { [Op.in]: partIds } },
          ],
        },
        attributes: ["old_part_id", "customer_qr"],
        order: [["updatedAt", "DESC"]],
        raw: true,
      })
      : [];
    const catalogCustomerQrByPartId = catalogMappings.reduce((acc, row) => {
      const oldPart = String(row.old_part_id || "").trim();
      const customerQr = String(row.customer_qr || "").trim();
      const oldKey = oldPart.toUpperCase();
      const customerKey = customerQr.toUpperCase();
      if (oldKey && customerQr && !acc[oldKey]) acc[oldKey] = customerQr;
      if (customerKey && customerQr && !acc[customerKey]) acc[customerKey] = customerQr;
      return acc;
    }, {});
    const catalogOldPartByPartId = catalogMappings.reduce((acc, row) => {
      const oldPart = String(row.old_part_id || "").trim();
      const customerQr = String(row.customer_qr || "").trim();
      const oldKey = oldPart.toUpperCase();
      const customerKey = customerQr.toUpperCase();
      if (oldKey && oldPart && !acc[oldKey]) acc[oldKey] = oldPart;
      if (customerKey && oldPart && !acc[customerKey]) acc[customerKey] = oldPart;
      return acc;
    }, {});
    const logRows = await OperationLog.findAll({
      where: {
        part_id: { [Op.in]: partIds },
      },
      order: [["createdAt", "DESC"]],
      raw: true,
      limit: 8000,
    });

    const machineIds = uniqueStages(logRows.map((row) => String(row.machine_id || "")).filter(Boolean))
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    const machineRows = machineIds.length
      ? await Machine.findAll({
        where: { id: { [Op.in]: machineIds } },
        attributes: ["id", "machine_name", "line_name", "operation_no"],
        raw: true,
      })
      : [];
    const machineMap = machineRows.reduce((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});

    const latestByPart = new Map();
    const productionPartIds = new Set();
    for (const row of logRows) {
      if (!isJourneyNoiseLog(row)) {
        productionPartIds.add(String(row.part_id || "").trim());
      }
      const machine = machineMap[row.machine_id] || null;
      if (lineNameFilter && machine && String(machine.line_name || "").trim() !== lineNameFilter) {
        continue;
      }
      if (stationFilter && normalizeStation(row.station_no || row.operation_no) !== stationFilter) {
        continue;
      }
      if (!latestByPart.has(row.part_id)) {
        latestByPart.set(row.part_id, row);
      }
    }

    let shifts = [];
    if (shiftCodeFilter) {
      shifts = await getActiveShiftDefinitions();
    }

    const catalogQrRules = await QrFormatRule.findAll({
      where: { is_active: true },
      attributes: ["regex_pattern"],
      raw: true,
    });
    const matchesCatalogQrRule = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return false;
      return catalogQrRules.some((rule) => {
        const pattern = String(rule.regex_pattern || "").trim();
        if (!pattern) return false;
        try {
          return new RegExp(pattern, "i").test(raw);
        } catch (_error) {
          return false;
        }
      });
    };
    const looksLikePartialTraceabilityId = (value) => {
      const raw = String(value || "").trim().toUpperCase();
      if (!raw) return false;
      if (/^R\d{9}-[A-Z0-9-]{10,}$/.test(raw)) return false;
      if (/^\d{8}[A-Z0-9]\d{1,6}$/.test(raw)) return false;
      return (
        /^[A-Z]?\d{3,6}$/.test(raw) ||
        /^[A-Z0-9]{1,6}$/.test(raw) ||
        /^[A-Z0-9]{0,4}54T\d{8}[A-Z]\d{4}$/i.test(raw) ||
        /^[A-Z0-9]{0,4}T\d{8}[A-Z]\d{4}$/i.test(raw)
      );
    };
    const isUsableCatalogPartId = (value) => {
      const raw = String(value || "").trim();
      if (!raw || raw === "-") return false;
      if (matchesCatalogQrRule(raw)) return true;
      if (looksLikePartialTraceabilityId(raw)) return false;
      return catalogQrRules.length === 0 && /^[A-Za-z0-9][A-Za-z0-9\-_/.:]{7,127}$/.test(raw);
    };

    const responseRows = parts
      .filter((part) => productionPartIds.has(String(part.part_id || "").trim()))
      .map((part) => {
        const latest = latestByPart.get(part.part_id);
        const machine = latest ? machineMap[latest.machine_id] || null : null;
        const rawPartId = String(part.part_id || "").trim();
        const mappedCustomerQr = catalogCustomerQrByPartId[rawPartId.toUpperCase()] || "";
        const mappedOldPart = catalogOldPartByPartId[rawPartId.toUpperCase()] || "";
        const hasDistinctCustomerMapping = Boolean(
          mappedOldPart &&
          mappedCustomerQr &&
          mappedOldPart.toUpperCase() !== mappedCustomerQr.toUpperCase()
        );
        const canonicalPartId = mappedOldPart || rawPartId;
        const isCustomerQrOnly = !hasDistinctCustomerMapping && (
          String(part.qr_format_name || "").trim().toUpperCase() === CUSTOMER_QR_ONLY_FORMAT ||
          Boolean(mappedOldPart && mappedCustomerQr && mappedOldPart.toUpperCase() === mappedCustomerQr.toUpperCase())
        );
        const validCanonicalPartId = isUsableCatalogPartId(canonicalPartId);
        const validRawPartId = isUsableCatalogPartId(rawPartId);
        const validMappedOldPart = isUsableCatalogPartId(mappedOldPart);
        const safePartIdForDisplay = validCanonicalPartId
          ? canonicalPartId
          : validMappedOldPart
            ? mappedOldPart
            : validRawPartId
              ? rawPartId
              : "";
        const displayPartId = isCustomerQrOnly ? "" : safePartIdForDisplay;
        if (!displayPartId && !mappedCustomerQr && looksLikePartialTraceabilityId(rawPartId)) {
          return null;
        }
        const traceabilityPartId = displayPartId || mappedCustomerQr || canonicalPartId;
        return {
          partId: traceabilityPartId,
          traceabilityPartId,
          rawPartId,
          displayPartId,
          mappedPartId: mappedOldPart || null,
          customerQrCode: mappedCustomerQr || null,
          isCustomerQrOnly,
          status: part.status,
          currentStation: part.current_station,
          currentOperation: part.current_operation,
          isInterlocked: Boolean(part.is_interlocked),
          interlockReason: part.interlock_reason,
          isRework: Boolean(part.is_rework),
          qrFormatName: part.qr_format_name,
          updatedAt: part.updatedAt,
          latestStatus: latest?.plc_status || null,
          latestResult: latest?.result || null,
          latestStation: normalizeStation(latest?.station_no || latest?.operation_no),
          latestAt: latest?.createdAt || null,
          machineId: latest?.machine_id || null,
          machineName: machine?.machine_name || null,
          lineName: machine?.line_name || null,
          operatorId: latest?.user_id || null,
        };
      })
      .filter(Boolean)
      .filter((row) => {
        if (statusFilter === "OTHER") {
          return row.isCustomerQrOnly === true;
        }
        if (shiftCodeFilter && row.latestAt) {
          return normalizeShiftAlias(resolveShiftCodeForDate(row.latestAt, shifts)) === normalizeShiftAlias(shiftCodeFilter);
        }
        if (shiftCodeFilter && !row.latestAt) {
          return false;
        }
        return true;
      });

    const responseByPart = new Map();
    for (const row of responseRows) {
      const key = String(row.partId || row.traceabilityPartId || row.rawPartId || "").trim().toUpperCase();
      if (!key) continue;
      const existing = responseByPart.get(key);
      if (!existing || new Date(row.latestAt || row.updatedAt || 0).getTime() > new Date(existing.latestAt || existing.updatedAt || 0).getTime()) {
        responseByPart.set(key, row);
      }
    }
    const response = [...responseByPart.values()];

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Short-TTL cache to absorb repeated rapid telemetry polls
const machineStationStatsCache = new Map();
const STATS_CACHE_TTL_MS = 2500;

exports.getMachineStationStats = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    if (!machineId) {
      return res.status(400).json({ error: "machineId query param is required" });
    }

    const requestedShiftCode = String(req.query.shiftCode || req.query.shift_code || "").trim().toUpperCase();
    // keyed by everything that decides the window (dateFrom / dateTo are what getOperatorStatsDateRange reads)
    const cacheKey = [machineId, requestedShiftCode, req.query.dateFrom, req.query.dateTo, req.query.from, req.query.to]
      .map((v) => (v === undefined || v === null ? "" : String(v))).join("|");
    const cachedEntry = machineStationStatsCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < STATS_CACHE_TTL_MS) {
      return res.json(cachedEntry.data);
    }

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const scanner = await Scanner.findOne({
      where: {
        mapped_machine_id: machine.id,
        is_active: true,
      },
      order: [["updatedAt", "DESC"]],
    });

    const stationNo = getMachineOperationStage(machine);
    const shifts = await getActiveShiftDefinitions();
    const currentShift = resolveShift(new Date(), shifts);
    const effectiveShiftCode = isAllShiftToken(requestedShiftCode)
      ? ""
      : (requestedShiftCode || String(currentShift?.shift_code || "").trim().toUpperCase());
    // [from, to) — end exclusive
    const { from, to } = getOperatorStatsDateRange(req.query, shifts, effectiveShiftCode, currentShift);
    const PD = require("../utils/productionDay");
    // With a shift selected the scans up to the end of that production day are read too, so a part scanned again in
    // a later shift counts once — in the shift of its latest scan (the reports' rule) — and not in both shifts.
    const dayEnd = PD.currentProductionDay(shifts, new Date(to.getTime() - 1)).to;
    const fetchTo = effectiveShiftCode && dayEnd > to ? dayEnd : to;
    // Leak testers: bypass auto-OK rows of OP150 are all written to the first leak machine (scanService), so they are
    // not that machine's tests; its OK / NG come from the leak results (ProductionReports.leak_data) like the reports.
    const isLeakMachine = String(machine.machine_type || "").trim().toUpperCase() === "LEAK";

    const fetchedLogs = await OperationLog.findAll({
      where: {
        machine_id: machine.id,
        station_no: stationNo,
        createdAt: {
          [Op.gte]: from,
          [Op.lt]: fetchTo,
        },
      },
      order: [["createdAt", "DESC"]],
      // The Pass / Fail counts and the hourly trend are computed from these rows, so they must cover the whole
      // window. 800 (newest first) cut a busy station's day short: "All shifts" or an earlier shift showed e.g.
      // OP120 Shift A = 12 pass instead of 459. A station logs up to ~2,000 scans a day; 5,000 covers it.
      limit: 5000,
    });
    const allLogs = isLeakMachine ? fetchedLogs.filter((row) => !row.is_bypassed) : fetchedLogs;
    const logs = allLogs.filter((row) => new Date(row.createdAt) < to); // inside the selected window

    // Targeted PartCodeMapping lookup: only look up parts that actually need customer QR
    // (the recent 25 visible parts + any log with recovery pending)
    const recoveryRows = allLogs.filter((row) => {
      const reason = String(row?.interlock_reason || "").toUpperCase();
      return reason.includes("RECOVERY");
    });
    const candidatePartIds = new Set([
      ...logs.slice(0, 25).map((r) => String(r.part_id || "").trim()),
      ...recoveryRows.map((r) => String(r.part_id || "").trim()),
    ]);
    candidatePartIds.delete("");
    const targetPartIds = Array.from(candidatePartIds);

    let partCodeMappings = [];
    if (targetPartIds.length > 0) {
      const [byOld, byCust] = await Promise.all([
        PartCodeMapping.findAll({
          where: { old_part_id: { [Op.in]: targetPartIds }, is_active: true },
          attributes: ["old_part_id", "customer_qr"],
          raw: true,
        }),
        PartCodeMapping.findAll({
          where: { customer_qr: { [Op.in]: targetPartIds }, is_active: true },
          attributes: ["old_part_id", "customer_qr"],
          raw: true,
        }),
      ]);
      partCodeMappings = byOld.concat(byCust);
    }

    const customerQrByPartId = partCodeMappings.reduce((acc, row) => {
      const key = String(row.old_part_id || "").trim().toUpperCase();
      const customerKey = String(row.customer_qr || "").trim().toUpperCase();
      const customerQr = String(row.customer_qr || "").trim();
      if (key && customerQr && !acc[key]) acc[key] = customerQr;
      if (customerKey && customerQr && !acc[customerKey]) acc[customerKey] = customerQr;
      return acc;
    }, {});
    const getMappedCustomerQr = (row) => customerQrByPartId[String(row?.part_id || "").trim().toUpperCase()] || null;

    const stationLogs = logs.filter((row) => !isJourneyNoiseLog(row));
    const effectiveLogs = stationLogs.length > 0 ? stationLogs : logs;
    const shiftFilteredLogs = effectiveShiftCode
      ? applyShiftFilter(effectiveLogs, effectiveShiftCode, shifts, { from, to })
      : effectiveLogs;

    // Pass / Fail: one row per part = its latest scan, chosen BEFORE the shift filter (over the rest of the
    // production day too), then counted only when that latest scan is in the selected window / shift.
    const allStationLogs = allLogs.filter((row) => !isJourneyNoiseLog(row));
    // Same rule as the Historical / Rejection reports: a part's latest OK / NG scan decides it (by scan time, then
    // log id). The scan result counts even while the PLC status is still PENDING (PLC communication is off on the
    // stations) — counting only ENDED_OK left 1–6 parts per shift as "in progress" here but OK in the reports.
    // Parts with no OK / NG scan keep their latest row (in progress / interlocked).
    const baseStationLogs = stationLogs.length > 0 ? allStationLogs : allLogs;
    const rawKeyOf = (row) => String(row?.part_id || "").trim().toUpperCase();
    const decisiveResult = (row) => {
      const r = String(row?.result || "").trim().toUpperCase();
      return r === "OK" || r === "NG" ? r : null;
    };
    // One part = one count, as in the reports: a part scanned at the station under its customer QR and under its
    // part ID counts once (customer QR → mapped part ID), and part-ID fragments (< 7 characters) are not parts.
    const aliasOf = new Map();
    {
      const qrKeys = [...new Set(baseStationLogs.filter((row) => decisiveResult(row)).map(rawKeyOf))]
        .filter((k) => k.length >= 7 && /[^0-9]/.test(k));
      for (let i = 0; i < qrKeys.length; i += 1000) {
        const rows = await PartCodeMapping.findAll({
          where: { customer_qr: { [Op.in]: qrKeys.slice(i, i + 1000) }, is_active: true },
          attributes: ["old_part_id", "customer_qr"],
          raw: true,
        }).catch(() => []);
        for (const m of rows) {
          const qr = String(m.customer_qr || "").trim().toUpperCase();
          const pid = String(m.old_part_id || "").trim().toUpperCase();
          if (qr && pid && qr !== pid) aliasOf.set(qr, pid);
        }
      }
    }
    const partKeyOf = (row) => { const k = rawKeyOf(row); return aliasOf.get(k) || k; };
    // same part-ID rule as the reports (VALID_SCAN_SQL): a 13-digit DPM code or a customer QR of 20–32 characters
    // starting with a letter; broken reads such as "1026B0681" or "11511-54T00071026A0405" are not parts
    const isValidPartKey = (k) => /^[0-9]{13}$/.test(k) || /^[A-Z].{19,31}$/.test(k);
    const latestDecisive = new Map();
    for (const row of baseStationLogs) {
      if (!decisiveResult(row)) continue;
      const k = partKeyOf(row);
      if (!k || rawKeyOf(row).length < 7 || !isValidPartKey(rawKeyOf(row))) continue;
      const cur = latestDecisive.get(k);
      const t = new Date(row.createdAt).getTime() || 0;
      const ct = cur ? new Date(cur.createdAt).getTime() || 0 : -1;
      if (!cur || t > ct || (t === ct && Number(row.id) > Number(cur.id))) latestDecisive.set(k, row);
    }
    const latestRows = [
      ...latestDecisive.values(),
      ...latestOperationRowPerPart(baseStationLogs.filter((row) => rawKeyOf(row).length >= 7 && isValidPartKey(rawKeyOf(row)) && !latestDecisive.has(partKeyOf(row)))),
    ];
    const summaryRows = effectiveShiftCode
      ? applyShiftFilter(latestRows, effectiveShiftCode, shifts, { from, to })
      : latestRows.filter((row) => isDateWithinRange(row.createdAt, { from, to }));
    let summary = getQualitySummaryFromOperationLogs(summaryRows.filter((row) => !decisiveResult(row)), getMappedCustomerQr);
    {
      const okCount = summaryRows.filter((row) => decisiveResult(row) === "OK").length;
      const ngCount = summaryRows.filter((row) => decisiveResult(row) === "NG").length;
      const processedCount = okCount + ngCount;
      summary = {
        ...summary,
        okCount,
        ngCount,
        processedCount,
        accuracy: processedCount > 0 ? Number(((okCount / processedCount) * 100).toFixed(2)) : 0,
      };
    }
    if (isLeakMachine) {
      const leak = await leakMachineResultCounts(machine.id, { from, to }, effectiveShiftCode, shifts);
      const processedCount = leak.ok + leak.ng;
      summary = {
        ...summary,
        okCount: leak.ok,
        ngCount: leak.ng,
        processedCount,
        accuracy: processedCount > 0 ? Number(((leak.ok / processedCount) * 100).toFixed(2)) : 0,
      };
    }
    const selectedShift = effectiveShiftCode
      ? shifts.find((row) => normalizeShiftAlias(row.shift_code || row.shift_name) === normalizeShiftAlias(effectiveShiftCode)) || currentShift
      : null;
    const targetProduction = selectedShift
      ? computeTargetProduction({ machine, shift: selectedShift })
      : shifts.reduce((total, shift) => total + computeTargetProduction({ machine, shift }), 0);
    const produced = Number(summary.processedCount || 0);
    const achievementPct = targetProduction > 0
      ? Number(((produced / targetProduction) * 100).toFixed(2))
      : 0;
    const hourlyMap = shiftFilteredLogs.reduce((acc, row) => {
      const key = formatHourBucket(row.createdAt);
      if (!acc[key]) {
        acc[key] = { hour: key, ok: 0, ng: 0, interlocked: 0, commErrors: 0, total: 0 };
      }

      const effectiveOutcome = getEffectiveOperationOutcome(row, getMappedCustomerQr(row));

      if (effectiveOutcome === "OK") {
        acc[key].ok += 1;
        acc[key].total += 1;
      } else if (effectiveOutcome === "NG") {
        acc[key].ng += 1;
        acc[key].total += 1;
      } else if (effectiveOutcome === "INTERLOCKED") {
        acc[key].interlocked += 1;
      } else if (effectiveOutcome === "COMM_ERROR") {
        acc[key].commErrors += 1;
      }
      return acc;
    }, {});

    const trend = Object.values(hourlyMap)
      .sort((a, b) => String(a.hour).localeCompare(String(b.hour)))
      .slice(-12);

    const current = resolveCurrentOperationForMachine(shiftFilteredLogs, machine);
    const lastEvent = shiftFilteredLogs[0] || effectiveLogs[0] || logs[0] || null;
    const recentParts = shiftFilteredLogs.slice(0, 10).map((row) => ({
      id: row.id,
      partId: row.part_id,
      plcStatus: row.plc_status,
      result: getEffectiveOperationOutcome(row, getMappedCustomerQr(row)) || row.result,
      interlockReason: shouldTreatRecoveryPendingAsPassed(row, getMappedCustomerQr(row)) ? null : row.interlock_reason,
      isBypassed: row.is_bypassed,
      createdAt: row.createdAt,
    }));
    const plcHealth = getPlcHealthSnapshot(machine.id);
    const plcCircuit = getPlcCircuitSnapshot().find((entry) => entry.key === `machine:${machine.id}`) || null;
    const scannerBundle = await buildMachineScannerBundle(machine.id);

    const resultPayload = {
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        lineName: machine.line_name,
        sequenceNo: machine.sequence_no,
        stationNo,
        currentShiftCode: currentShift?.shift_code || null,
        selectedShiftCode: effectiveShiftCode || "ALL",
        targetProduction,
        achievementPct,
      },
      range: {
        from,
        to,
      },
      filters: {
        from,
        to,
        shiftCode: effectiveShiftCode || "ALL",
        currentShiftCode: currentShift?.shift_code || null,
      },
      plcHealth: plcHealth || null,
      plcCircuit,
      scanner: scannerBundle.primaryScanner,
      scannerHealth: scannerBundle.primaryHealth,
      scanners: scannerBundle.scanners,
      scannerHealthList: scannerBundle.scannerHealth,
      summary: {
        ...summary,
        countMode: "DISTINCT_PART_LATEST_STATION_STATUS",
        producedCount: produced,
        targetProduction,
        targetQty: targetProduction,
        achievementPct,
        shiftCode: effectiveShiftCode || "ALL",
        currentShiftCode: currentShift?.shift_code || null,
      },
      trend,
      current: current
        ? {
          operationLogId: current.id,
          partId: current.part_id,
          plcStatus: current.plc_status,
          result: current.result,
          interlockReason: current.interlock_reason,
          createdAt: current.createdAt,
        }
        : null,
      lastEvent: lastEvent
        ? {
          operationLogId: lastEvent.id,
          partId: lastEvent.part_id,
          plcStatus: lastEvent.plc_status,
          result: lastEvent.result,
          interlockReason: lastEvent.interlock_reason,
          createdAt: lastEvent.createdAt,
        }
        : null,
      recentParts,
    };

    machineStationStatsCache.set(cacheKey, { timestamp: Date.now(), data: resultPayload });
    if (machineStationStatsCache.size > 200) {
      const cutoff = Date.now() - 30000;
      for (const [k, v] of machineStationStatsCache.entries()) {
        if (v.timestamp < cutoff) machineStationStatsCache.delete(k);
      }
    }

    return res.json(resultPayload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.processScan = async (req, res) => {
  try {
    const { partId, stationNo, operation, result } = req.body;
    let normalizedPartId = String(partId || "").trim();
    let customerQrCode = null;

    const machine = await resolveMachineFromRequest(req.body, req);
    if (!machine) {
      emitOperatorPopup("ERROR", {
        partId: String(partId || "").trim(),
        stationNo: normalizeStation(stationNo || operation),
        machineId: req.body?.machineId || null,
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        qrResult: "FAIL",
        reason: "MACHINE_NOT_FOUND",
        message: "Machine not found for scanner/IP mapping",
      });
      return res.status(404).json({ error: "Machine not found for scanner/IP mapping" });
    }

    const bound = await enforceScannerProtocolBinding({ machine, body: req.body, req });
    if (!bound.ok) {
      await sendRejectedScanInterlock({
        machine,
        stationNo: normalizeStation(stationNo || operation) || getMachineOperationStage(machine),
        reason: "SCANNER_BINDING_FAILED",
      });
      emitOperatorPopup("ERROR", {
        partId: String(partId || "").trim(),
        stationNo: normalizeStation(stationNo || operation) || getMachineOperationStage(machine),
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        qrResult: "FAIL",
        reason: "SCANNER_BINDING_FAILED",
        message: bound.error,
      });
      return res.status(bound.status).json({ error: bound.error });
    }
    let scannerRead = null;
    const scanner = bound.scanner;
    const mode = String(scanner?.scanner_mode || "").trim().toUpperCase();
    const scannerRole = String(scanner?.scanner_role || "").trim().toUpperCase();
    if (scanner && mode === "PLC_REGISTER") {
      try {
        scannerRead = await readPartIdFromScannerPlc(scanner.get({ plain: true }));
        const livePartId = String(scannerRead.partId || "").trim();
        if (livePartId) {
          normalizedPartId = livePartId;
        }
      } catch (error) {
        emitOperatorPopup("ERROR", {
          partId: String(partId || "").trim(),
          stationNo: getMachineOperationStage(machine) || normalizeStation(stationNo || operation),
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "BLOCKED",
          plcStatus: "COMM",
          qrResult: "WAIT",
          reason: "PLC_SCANNER_READ_FAILED",
          message: `PLC scanner read failed: ${error.message}`,
          scannerMode: "PLC_REGISTER",
        });
        if (!normalizedPartId) {
          return res.status(400).json({
            error: `PLC scanner read failed: ${error.message}`,
          });
        }
      }
    }

    if (!normalizedPartId) {
      await sendRejectedScanInterlock({
        machine,
        stationNo: getMachineOperationStage(machine) || normalizeStation(stationNo || operation),
        reason: "PART_ID_MISSING",
      });
      emitOperatorPopup("ERROR", {
        partId: "",
        stationNo: getMachineOperationStage(machine) || normalizeStation(stationNo || operation),
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "BLOCKED",
        plcStatus: "WAIT",
        qrResult: "WAIT",
        reason: "PART_ID_MISSING",
        message: "Part ID not available from scanner/PLC. Waiting for next part.",
        scannerMode: mode || null,
      });
      return res.status(400).json({
        error: "partId is required (or configure scanner mode PLC_REGISTER with valid register range)",
      });
    }
    const scannedQrRaw = collapseRepeatedQrValue(normalizedPartId);
    const machineStage = getMachineOperationStage(machine);
    const requestedStage = normalizeStation(stationNo || operation);
    if (requestedStage && machineStage && requestedStage !== machineStage) {
      await sendRejectedScanInterlock({
        machine,
        stationNo: machineStage,
        reason: "REQUESTED_STATION_MISMATCH",
      });
      return res.status(400).json({
        error: `Requested station ${requestedStage} does not match machine operation ${machineStage}`,
      });
    }

    const normalizedStation = machineStage || requestedStage;
    if (!normalizedStation) {
      return res.status(400).json({ error: "stationNo/operation is required" });
    }

    const inferredCustomerQrActivePartId = scannerRole === "CUSTOMER_QR"
      ? ""
      : await resolveActivePartIdForMachine(machine, normalizedStation);
    const inferredExistingCustomerMapping = scannerRole === "CUSTOMER_QR" || !inferredCustomerQrActivePartId
      ? null
      : await PartCodeMapping.findOne({
          where: { customer_qr: scannedQrRaw, is_active: true },
          attributes: ["id", "old_part_id", "customer_qr"],
          order: [["updatedAt", "DESC"]],
        });
    const inferredKnownPart = scannerRole === "CUSTOMER_QR" || !inferredCustomerQrActivePartId
      ? null
      : await Part.findOne({ where: { part_id: scannedQrRaw }, attributes: ["part_id"] });
    const inferredCustomerQrScan =
      scannerRole !== "CUSTOMER_QR" &&
      requiresCustomerQrForCompletion(machine) &&
      Boolean(inferredCustomerQrActivePartId) &&
      scannedQrRaw &&
      scannedQrRaw !== inferredCustomerQrActivePartId &&
      (!inferredKnownPart || inferredExistingCustomerMapping);

    if (scannerRole === "CUSTOMER_QR" || inferredCustomerQrScan) {
      const stationFeatures = await getStationFeatureConfig(normalizedStation, getMachineStationScope(machine)).catch(() => null);
      if (scannerRole === "CUSTOMER_QR") {
        const customerRoleGuard = await enforceScannerRoleIfConfigured({
          machine,
          sourceIp: bound.sourceIp,
          allowedRoles: ["CUSTOMER_QR"],
        });
        if (!customerRoleGuard.ok) {
          return res.status(customerRoleGuard.status).json({ error: customerRoleGuard.error });
        }
      }

      const activePartId = inferredCustomerQrActivePartId || await resolveActivePartIdForMachine(machine, normalizedStation);
      if (!activePartId) {
        if (await canStartCustomerQrOnlyPart({
          code: scannedQrRaw,
          stationNo: normalizedStation,
          machine,
          stationFeatures,
        })) {
          const response = await saveCustomerQrOnlyStart({
            code: scannedQrRaw,
            stationNo: normalizedStation,
            machine,
            userId: req.user?.id,
          });
          const allowed = response?.decision === "ALLOW";
          emitOperatorPopup(allowed ? "INFO" : "ERROR", {
            partId: scannedQrRaw,
            customerQrCode: scannedQrRaw,
            stationNo: normalizedStation,
            machineId: machine.id,
            machineName: machine.machine_name,
            status: allowed ? "SCANNED" : "BLOCKED",
            plcStatus: allowed ? "WAITING_PLC" : "BLOCKED",
            qrResult: allowed ? "PASS" : "FAIL",
            operationStatus: response?.operationStatus || (allowed ? "WAITING" : "BLOCKED"),
            reason: allowed ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || "CUSTOMER_QR_ONLY_BLOCKED"),
            message: allowed
              ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
              : (response?.message || "Customer QR start blocked."),
          });
          return res.status(allowed ? 200 : 409).json({
            ...response,
            status: allowed ? "OK" : "BLOCKED",
            decision: response?.decision || "BLOCK",
            reason: allowed ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || "CUSTOMER_QR_ONLY_BLOCKED"),
            message: allowed
              ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
              : (response?.message || "Customer QR start blocked."),
            mapped: allowed,
            customerQrOnly: true,
            partId: scannedQrRaw,
            customerQrCode: scannedQrRaw,
            scannerRead,
            machine: {
              id: machine.id,
              machineName: machine.machine_name,
              stationNo: normalizedStation,
            },
          });
        }
        emitOperatorPopup("ERROR", {
          partId: scannedQrRaw,
          stationNo: normalizedStation,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "BLOCKED",
          plcStatus: "WAIT",
          qrResult: "FAIL",
          reason: "START_QR_REQUIRED",
          message: `${normalizedStation}: no confirmed active part. Re-scan Part ID / Start QR, then scan Customer QR.`,
        });
        return res.status(409).json({
          error: `${normalizedStation}: no confirmed active part. Re-scan Part ID / Start QR, then scan Customer QR.`,
        });
      }

      const mappedCustomerQrValue = sanitizeCustomerQrValue(scannedQrRaw);
      if (!mappedCustomerQrValue) {
        return res.status(400).json({
          error: "Invalid Customer QR scan. Scan the actual Customer QR code.",
          reason: "INVALID_CUSTOMER_QR_VALUE",
          customerQrPending: true,
        });
      }

      const existingMapping = await PartCodeMapping.findOne({
        where: {
          customer_qr: mappedCustomerQrValue,
          is_active: true,
        },
      });
      if (existingMapping && String(existingMapping.old_part_id || "").trim() === activePartId) {
        emitOperatorPopup("ERROR", {
          partId: activePartId,
          customerQrCode: scannedQrRaw,
          stationNo: normalizedStation,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "BLOCKED",
          plcStatus: "BLOCKED",
          qrResult: "DUPLICATE",
          operationStatus: "BLOCKED",
          reason: "DUPLICATE_SCAN",
          message: "Customer QR already mapped/registered. Do not scan it again.",
        });
        return res.status(409).json({
          status: "DUPLICATE",
          decision: "BLOCK",
          qrStatus: "DUPLICATE",
          operationStatus: "BLOCKED",
          reason: "DUPLICATE_SCAN",
          message: "Customer QR already mapped/registered. Do not scan it again.",
          mapped: true,
          duplicate: true,
          partId: activePartId,
          customerQrCode: mappedCustomerQrValue,
          scannerRead,
          machine: {
            id: machine.id,
            machineName: machine.machine_name,
            stationNo: normalizedStation,
          },
        });
      }
      if (existingMapping && String(existingMapping.old_part_id || "").trim() !== activePartId) {
        return res.status(409).json({
          error: "Customer QR already mapped to another part",
        });
      }

      // a Part ID (DPM) read by the customer-QR scanner must never be stored as a customer QR (8–9 Oct: 12 parts
      // were mapped to another part's DPM code this way). The TCP path has the same check.
      if (isPartIdAsCustomerQr(mappedCustomerQrValue, activePartId)) {
        return res.status(400).json({
          error: "This is a Part ID (DPM), not a customer QR. Scan the customer QR label.",
          reason: "PART_ID_SCANNED_AS_CUSTOMER_QR",
          customerQrPending: true,
        });
      }
      await PartCodeMapping.upsert({
        old_part_id: activePartId,
        customer_qr: mappedCustomerQrValue,
        machine_id: machine.id,
        station_no: normalizedStation || null,
        is_active: true,
      });

      const finalized = await finalizeCustomerQrMappingIfEligible({
        partId: activePartId,
        stationNo: normalizedStation,
        machine,
        userId: req.user?.id,
        stationFeatures,
      });

      emitOperatorPopup(finalized.finalized ? "SUCCESS" : "INFO", {
        partId: activePartId,
        customerQrCode: mappedCustomerQrValue,
        stationNo: normalizedStation,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: finalized.finalized ? "ENDED_OK" : "SCANNED",
        plcStatus: finalized.operationStatus === "ENDED_OK" ? "ENDED_OK" : "WAITING_PLC",
        qrResult: "PASS",
        reason: "CUSTOMER_QR_MAPPED",
        message: finalized.finalized
          ? "Customer QR mapped successfully. Operation passed."
          : "Customer QR mapped successfully to active part.",
      });

      return res.json({
        status: "OK",
        decision: "ALLOW",
        qrStatus: "PASS",
        operationStatus: finalized.operationStatus || "WAITING",
        reason: "CUSTOMER_QR_MAPPED",
        message: finalized.finalized ? "Customer QR mapped successfully. Operation passed." : "Customer QR mapped successfully",
        mapped: true,
        partId: activePartId,
        customerQrCode: mappedCustomerQrValue,
        scannerRead,
        machine: {
          id: machine.id,
          machineName: machine.machine_name,
          stationNo: normalizedStation,
        },
      });
    }

    const roleGuard = await enforceScannerRoleIfConfigured({
      machine,
      sourceIp: bound.sourceIp,
      allowedRoles: ["START_QR"],
    });
    if (!roleGuard.ok) {
      await sendRejectedScanInterlock({
        machine,
        stationNo: normalizedStation,
        reason: "SCANNER_ROLE_INVALID",
      });
      return res.status(roleGuard.status).json({ error: roleGuard.error });
    }

    const stationFeatures = await getStationFeatureConfig(normalizedStation, getMachineStationScope(machine));
    const resolvedCode = await resolveMappedPartId(normalizedPartId);
    normalizedPartId = resolvedCode.resolvedPartId;
    customerQrCode = resolvedCode.customerQrCode;
    const isMappedCustomerQrScan = Boolean(customerQrCode) && customerQrCode === scannedQrRaw;
    const isCustomerQrOnlyStart =
      scannerRole === "CUSTOMER_QR" &&
      !isMappedCustomerQrScan &&
      await canStartCustomerQrOnlyPart({
        code: scannedQrRaw,
        stationNo: normalizedStation,
        machine,
        stationFeatures,
      });
    if (isCustomerQrOnlyStart) {
      normalizedPartId = scannedQrRaw;
      customerQrCode = scannedQrRaw;
    }

    if (!isMappedCustomerQrScan && !isCustomerQrOnlyStart && await shouldBlockUnknownQrAfterLaser({
      code: scannedQrRaw,
      stationNo: normalizedStation,
    })) {
      const message = await unknownQrAfterLaserMessage(normalizedStation, scannedQrRaw);
      await sendRejectedScanInterlock({
        machine,
        stationNo: normalizedStation,
        reason: "CUSTOMER_QR_NOT_MAPPED",
      });
      emitOperatorPopup("ERROR", {
        partId: scannedQrRaw,
        customerQrCode: scannedQrRaw,
        stationNo: normalizedStation,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        qrResult: "FAIL",
        operationStatus: "BLOCKED",
        reason: "CUSTOMER_QR_NOT_MAPPED",
        message,
      });
      return res.status(409).json({
        decision: "BLOCK",
        reason: "CUSTOMER_QR_NOT_MAPPED",
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        message,
        partId: scannedQrRaw,
        customerQrCode: scannedQrRaw,
        stationNo: normalizedStation,
      });
    }

    if (isMappedCustomerQrScan && await shouldBlockMappedCustomerQrOnStartScan(normalizedStation)) {
      const message = wrongCustomerQrAtStartMessage(normalizedStation);
      await sendRejectedScanInterlock({
        machine,
        stationNo: normalizedStation,
        reason: "CUSTOMER_QR_NOT_ALLOWED_AT_START_STATION",
      });
      emitOperatorPopup("ERROR", {
        partId: normalizedPartId,
        customerQrCode,
        stationNo: normalizedStation,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        qrResult: "FAIL",
        operationStatus: "BLOCKED",
        reason: "CUSTOMER_QR_NOT_ALLOWED_AT_START_STATION",
        message,
      });
      return res.status(409).json({
        decision: "BLOCK",
        reason: "CUSTOMER_QR_NOT_ALLOWED_AT_START_STATION",
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        message,
        partId: normalizedPartId,
        customerQrCode,
        stationNo: normalizedStation,
      });
    }

    const spcConfig = getMachineSpcConfig(machine);
    const rejectionBinConfirmed = stationFeatures.rejectionBin && hasRejectionBinConfirmation(req.body);
    const manualResultEnabled = stationFeatures.manualResult === true;
    const resultInput = String(result ?? req.body.finalResult ?? "").trim().toUpperCase();
    const spcResultRaw = findPayloadValueCaseInsensitive(req.body, spcConfig.payloadResultKey);
    const spcResultInput = normalizeQualityToken(spcResultRaw);
    let plcQualityResult = null;
    if (spcConfig.enabled && spcConfig.mode === "PLC_REGISTER") {
      plcQualityResult = await readQualityCheckResultFromPlc(machine, spcConfig).catch((error) => {
        console.warn(
          `[QUALITY_CHECK] PLC register read failed machineId=${machine.id} partId=${normalizedPartId} station=${normalizedStation} error=${error.message}`
        );
        return null;
      });
    }
    const hasSpcResultInput = Boolean(
      spcConfig.enabled &&
      (spcConfig.mode === "PLC_REGISTER" ? plcQualityResult?.result : spcResultInput)
    );
    const hasManualResultInput = Boolean(resultInput);
    const qualityPayload = extractQualityPayload(req.body, machine);
    const sourceIpConfigured =
      spcConfig.enabled && spcConfig.mode === "IP_PUSH" && spcConfig.sourceIp;
    const requestSourceIp =
      normalizeIp(req.body.scannerIp || req.body.systemIp || req.body.sourceIp || req.ip || req.socket?.remoteAddress || "");
    if (sourceIpConfigured && requestSourceIp && !sameIp(sourceIpConfigured, requestSourceIp)) {
      return res.status(400).json({
        error: `SPC source IP mismatch. Expected ${spcConfig.sourceIp}, got ${requestSourceIp}`,
      });
    }

    const isManualSubmitAttempt = req.body.submitManual === true || req.body.manualSubmit === true;
    if (manualResultEnabled && isManualSubmitAttempt && !rejectionBinConfirmed && !hasManualResultInput && !hasSpcResultInput) {
      return res.status(400).json({
        error: `Manual OK/NG result is required for station ${normalizedStation}`,
      });
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
        : hasManualResultInput
          ? resultInput
          : "OK";
    const ngReason = rejectionBinConfirmed ? "REJECTION_BIN_CONFIRMED" : undefined;
    const resultSource = rejectionBinConfirmed
      ? "PLC_REJECTION_BIN"
      : spcResolvedResult
        ? spcConfig.mode === "PLC_REGISTER"
          ? "QUALITY_CHECK_PLC_REGISTER"
          : "QUALITY_CHECK_IP_PAYLOAD"
        : manualResultEnabled
          ? "MANUAL_OK_NG"
          : hasManualResultInput
            ? "PLC_PAYLOAD"
            : "DEFAULT_OK";
    const machineBypassEnabled = isMachineBypassEnabled(machine.id) || machine.bypass_enabled === true;
    const qrValidationEnabled = stationFeatures.qr !== false;
    const stationBypassEnabled = stationFeatures.bypass === true || stationFeatures.operation === false;
    const skipAllBypassValidations = machineBypassEnabled || stationBypassEnabled;
    const validateQrFormat = stationFeatures.validateQrFormat !== false;
    const validateShotNumber = stationFeatures.validateShotNumber === true;
    const validatePreviousStation = stationFeatures.validatePreviousStation !== false;
    const validateDuplicateBarcode = stationFeatures.validateDuplicateBarcode !== false;
    const validateCustomerCode = stationFeatures.validateCustomerCode === true;
    const bypassState = machineBypassEnabled ? getMachineBypass(machine.id) : null;
    const isCustomerQrOnlyTrace = isCustomerQrOnlyStart || await isCustomerQrOnlyTracePart(normalizedPartId, customerQrCode);
    const customerQrRequiredAtStation = await stationRequiresCustomerQrForCompletion(machine, normalizedStation);
    const response = await saveScan(normalizedPartId, normalizedStation, finalResult, machine.id, req.user?.id, {
      ...(ngReason ? { ngReason } : {}),
      resultSource: isCustomerQrOnlyStart ? "CUSTOMER_QR_ONLY_START" : resultSource,
      resultInput: spcConfig.mode === "PLC_REGISTER"
        ? normalizeQualityToken(plcQualityResult?.token || plcQualityResult?.rawValue || finalResult)
        : hasSpcResultInput
          ? spcResultInput
          : hasManualResultInput
            ? resultInput
            : finalResult,
      qualityPayload,
      customerCodePattern: stationFeatures.customerCodePattern || "",
      shotValidationPartId: normalizedPartId,
      enforceQrFormatValidation: !isMappedCustomerQrScan && !isCustomerQrOnlyStart && qrValidationEnabled && !skipAllBypassValidations,
      enforceSequenceValidation: !isCustomerQrOnlyStart && !skipAllBypassValidations,
      skipQrFormatValidation: isMappedCustomerQrScan || isCustomerQrOnlyStart || !qrValidationEnabled || !validateQrFormat,
      skipShotValidation: isMappedCustomerQrScan || isCustomerQrOnlyTrace || customerQrRequiredAtStation || !validateShotNumber,
      skipCustomerCodeValidation: isMappedCustomerQrScan || isCustomerQrOnlyStart || !qrValidationEnabled || !validateCustomerCode || skipAllBypassValidations,
      skipInterlockValidation: skipAllBypassValidations,
      skipDuplicateValidation: false,
      skipSequenceValidation: isCustomerQrOnlyStart || !validatePreviousStation || skipAllBypassValidations,
    });
    if (response?.decision === "ALLOW" && isCustomerQrOnlyStart) {
      await markCustomerQrOnlyMapping({ code: normalizedPartId, machine, stationNo: normalizedStation });
      const finalized = await finalizeCustomerQrMappingIfEligible({
        partId: normalizedPartId,
        stationNo: normalizedStation,
        machine,
        userId: req.user?.id,
        stationFeatures,
      });
      if (finalized?.finalized) {
        response.operationStatus = "ENDED_OK";
        response.plcStatus = "ENDED_OK";
        response.status = "ENDED_OK";
        response.message = "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station.";
      }
    }
    if (response?.decision === "ALLOW" && response?.operationLogId) {
      await safeRecordTimeline({
        operationId: response.operationLogId,
        partId: normalizedPartId,
        machineId: machine.id,
        stationNo: normalizedStation,
        eventType: TIMELINE_EVENTS.SCANNED,
        eventData: {
          resultSource,
          machineBypassEnabled,
        },
      });
      await safeRecordTimeline({
        operationId: response.operationLogId,
        partId: normalizedPartId,
        machineId: machine.id,
        stationNo: normalizedStation,
        eventType: TIMELINE_EVENTS.VALIDATED,
        eventData: {
          stationFeatures,
          spcMode: spcConfig.mode,
        },
      });
    }
    const qualityAck = response?.decision === "ALLOW"
      ? await sendQualityCheckAckToPlc(machine, spcConfig, finalResult).catch((error) => ({
        ok: false,
        error: error.message,
      }))
      : { skipped: true, reason: "SCAN_BLOCKED" };

    const requiredPlcPartCount = normalizePlcPartCount(stationFeatures.plcPartCount || 1);

    await handleStationPlcFlow({
      response,
      machine,
      stationNo: normalizedStation,
      partId: normalizedPartId,
      userId: req.user?.id,
      requiredPlcPartCount,
    });

    const qrStatus = response.qrStatus || (response.decision === "ALLOW" ? "PASSED" : "FAILED");
    const operationStatus = response.operationStatus || (response.decision === "ALLOW" ? "WAITING" : "BLOCKED");
    const customerQrPending =
      response.decision === "ALLOW" &&
      scannerRole === "START_QR" &&
      requiresCustomerQrForCompletion(machine) &&
      !isCustomerQrOnlyStart;
    if (customerQrPending) {
      response.operationStatus = "WAITING_CUSTOMER_QR";
      response.reason = "WAITING_CUSTOMER_QR";
      response.customerQrPending = true;
      response.message = `QR PASS - Waiting for Customer QR at ${normalizedStation}`;
    }

    emitOperatorPopup(mapScanDecisionToPopupType(response), {
      partId: normalizedPartId,
      stationNo: normalizedStation,
      machineId: machine.id,
      machineName: getModelValue(machine, "machine_name"),
      qrStatus,
      operationStatus: customerQrPending ? "WAITING_CUSTOMER_QR" : operationStatus,
      status: response.decision === "ALLOW" ? "SCANNED" : "BLOCKED",
      plcStatus: response.decision === "ALLOW" ? "WAITING_PLC" : "BLOCKED",
      reason: customerQrPending ? "WAITING_CUSTOMER_QR" : (response.reason || null),
      customerQrPending,
      expectedStation: response.expectedStation || null,
      lastCompletedStation: response.lastCompletedStation || null,
      message: response.decision === "ALLOW"
        ? (customerQrPending ? `QR PASS - Waiting for Customer QR at ${normalizedStation}` : `QR PASS - Starting ${normalizedStation}`)
        : getBlockedPopupMessage(response),
    });

    if (response.decision === "ALLOW") {
      emitRealtime("QR_VALIDATED", { partId: normalizedPartId, machineId: machine.id, stationNo: normalizedStation });
      try {
        const leakRecord = await captureLeakReadingsForScan({
          machineId: machine.id,
          partId: normalizedPartId,
          stationNo: normalizedStation,
          operationLogId: response.operationLogId || null,
        });
        if (leakRecord?.payload_json) {
          response.leakTestReading = JSON.parse(leakRecord.payload_json);
        }
      } catch (_leakCaptureError) {
        // Leak capture is non-blocking; keep scan flow stable.
      }
    } else if (response.reason === "DUPLICATE_SCAN") {
      emitRealtime("DUPLICATE_SCAN_BLOCKED", { partId: normalizedPartId, machineId: machine.id, stationNo: normalizedStation });
    }

    response.qrStatus = qrStatus;
    response.operationStatus = operationStatus;
    response.plcPartCountRequired = requiredPlcPartCount;
    response.resultSource = resultSource;
    response.manualResultEnabled = manualResultEnabled;
    response.isSpcStation = spcConfig.enabled;
    response.machineBypassEnabled = machineBypassEnabled;
    response.stationBypassEnabled = stationBypassEnabled;
    response.machineBypassReason = bypassState?.reason || null;
    response.qualityCheck = {
      mode: spcConfig.mode,
      appliesTo: "ALL",
      plcResultRegister: spcConfig.plcResultRegister,
      plcResultRaw: plcQualityResult?.rawValue ?? null,
      plcResultToken: plcQualityResult?.token ?? null,
      ack: qualityAck,
    };
    response.validationConfig = {
      qrValidationEnabled,
      validateQrFormat,
      validateShotNumber,
      validatePreviousStation,
      validateDuplicateBarcode,
      validateCustomerCode,
    };

    res.json({
      ...response,
      partId: normalizedPartId,
      customerQrCode,
      scannerRead,
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        stationNo: getMachineOperationStage(machine),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.verifyScanForOperator = async (req, res) => {
  try {
    const { qrCode, machineId, result } = req.body;
    const inputCode = String(qrCode || "").trim();
    if (!inputCode || !machineId) {
      return res.status(400).json({ error: "qrCode and machineId are required" });
    }
    const scannedQrRaw = collapseRepeatedQrValue(inputCode);

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }
    const bound = await enforceScannerProtocolBinding({ machine, body: req.body, req });
    if (!bound.ok) {
      await sendRejectedScanInterlock({
        machine,
        stationNo: getMachineOperationStage(machine),
        reason: "SCANNER_BINDING_FAILED",
      });
      return res.status(bound.status).json({ error: bound.error });
    }
    const stationNo = getMachineOperationStage(machine);
    const stationFeatures = await getStationFeatureConfig(stationNo, getMachineStationScope(machine));
    const roleScanners = await Scanner.findAll({
      where: { mapped_machine_id: machine.id, is_active: true },
    });
    const hasCustomerQrScanner = roleScanners.some(
      (scanner) => String(scanner.scanner_role || "").trim().toUpperCase() === "CUSTOMER_QR"
    );
    const activePartIdForMachine = await resolveActivePartIdForMachine(machine, stationNo);
    const validScannedCustomerQr = sanitizeCustomerQrValue(scannedQrRaw);
    const existingCustomerMapping = validScannedCustomerQr
      ? await PartCodeMapping.findOne({
          where: {
            customer_qr: validScannedCustomerQr,
            is_active: true,
          },
          order: [["updatedAt", "DESC"]],
        })
      : null;
    const isExistingMappedCustomerQr = Boolean(existingCustomerMapping);
    const isKnownPartId = Boolean(await Part.findOne({ where: { part_id: scannedQrRaw }, attributes: ["part_id"] }));
    const looksLikeCustomerQr =
      requiresCustomerQrForCompletion(machine) &&
      (hasCustomerQrScanner || isExistingMappedCustomerQr || Boolean(activePartIdForMachine)) &&
      validScannedCustomerQr &&
      scannedQrRaw !== activePartIdForMachine &&
      (!isKnownPartId || isExistingMappedCustomerQr);

    if (looksLikeCustomerQr && !activePartIdForMachine) {
      if (await canStartCustomerQrOnlyPart({
        code: scannedQrRaw,
        stationNo,
        machine,
        stationFeatures,
      })) {
        const response = await saveCustomerQrOnlyStart({
          code: scannedQrRaw,
          stationNo,
          machine,
          userId: req.user?.id,
        });
        const allowed = response?.decision === "ALLOW";
        emitOperatorPopup(allowed ? "INFO" : "ERROR", {
          partId: scannedQrRaw,
          customerQrCode: scannedQrRaw,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: allowed ? "SCANNED" : "BLOCKED",
          plcStatus: allowed ? "WAITING_PLC" : "BLOCKED",
          qrResult: allowed ? "PASS" : "FAIL",
          operationStatus: response?.operationStatus || (allowed ? "WAITING" : "BLOCKED"),
          reason: allowed ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || "CUSTOMER_QR_ONLY_BLOCKED"),
          message: allowed
            ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
            : (response?.message || "Customer QR start blocked."),
        });
        return res.status(allowed ? 200 : 409).json({
          ...response,
          status: allowed ? "OK" : "BLOCKED",
          decision: response?.decision || "BLOCK",
          reason: allowed ? "CUSTOMER_QR_ONLY_STARTED" : (response?.reason || "CUSTOMER_QR_ONLY_BLOCKED"),
          message: allowed
            ? "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station."
            : (response?.message || "Customer QR start blocked."),
          mapped: allowed,
          customerQrOnly: true,
          partId: scannedQrRaw,
          customerQrCode: scannedQrRaw,
          machine: {
            id: machine.id,
            machineName: machine.machine_name,
            stationNo,
          },
        });
      }
      emitOperatorPopup("ERROR", {
        partId: "",
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "BLOCKED",
        plcStatus: "WAIT",
        qrResult: "FAIL",
        reason: "START_QR_REQUIRED",
        message: `${stationNo}: no confirmed active part. Re-scan Part ID / Start QR, then scan Customer QR.`,
        customerQrCode: scannedQrRaw,
      });
      return res.status(409).json({
        error: `${stationNo}: no confirmed active part. Re-scan Part ID / Start QR, then scan Customer QR.`,
        reason: "START_QR_REQUIRED",
        stationNo,
        machine: {
          id: machine.id,
          machineName: machine.machine_name,
          stationNo,
        },
      });
    }

    if (
      looksLikeCustomerQr &&
      activePartIdForMachine
    ) {
      const customerStationFeatures = await getStationFeatureConfig(stationNo, getMachineStationScope(machine)).catch(() => null);
      if (
        existingCustomerMapping &&
        String(existingCustomerMapping.old_part_id || "").trim() !== activePartIdForMachine
      ) {
        return res.status(409).json({
          error: "Customer QR already mapped to another part",
        });
      }
      if (
        existingCustomerMapping &&
        String(existingCustomerMapping.old_part_id || "").trim() === activePartIdForMachine
      ) {
        emitOperatorPopup("ERROR", {
          partId: activePartIdForMachine,
          stationNo,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "BLOCKED",
          plcStatus: "BLOCKED",
          qrResult: "DUPLICATE",
          operationStatus: "BLOCKED",
          reason: "DUPLICATE_SCAN",
          message: "Customer QR already mapped/registered. Do not scan it again.",
          customerQrCode: scannedQrRaw,
        });
        return res.status(409).json({
          status: "DUPLICATE",
          decision: "BLOCK",
          qrStatus: "DUPLICATE",
          operationStatus: "BLOCKED",
          reason: "DUPLICATE_SCAN",
          message: "Customer QR already mapped/registered. Do not scan it again.",
          mapped: true,
          duplicate: true,
          partId: activePartIdForMachine,
          customerQrCode: scannedQrRaw,
        });
      }

      const mappedCustomerQrValue = sanitizeCustomerQrValue(scannedQrRaw);
      if (!mappedCustomerQrValue) {
        return res.status(400).json({
          error: "Invalid Customer QR scan. Scan the actual Customer QR code.",
          reason: "INVALID_CUSTOMER_QR_VALUE",
          customerQrPending: true,
        });
      }

      // a Part ID (DPM) read by the customer-QR scanner must never be stored as a customer QR (8–9 Oct: 12 parts
      // were mapped to another part's DPM code this way). The TCP path has the same check.
      if (isPartIdAsCustomerQr(mappedCustomerQrValue, activePartIdForMachine)) {
        return res.status(400).json({
          error: "This is a Part ID (DPM), not a customer QR. Scan the customer QR label.",
          reason: "PART_ID_SCANNED_AS_CUSTOMER_QR",
          customerQrPending: true,
        });
      }
      await PartCodeMapping.upsert({
        old_part_id: activePartIdForMachine,
        customer_qr: mappedCustomerQrValue,
        machine_id: machine.id,
        station_no: stationNo || null,
        is_active: true,
      });

      const finalized = await finalizeCustomerQrMappingIfEligible({
        partId: activePartIdForMachine,
        stationNo,
        machine,
        userId: req.user?.id,
        stationFeatures: customerStationFeatures,
      });

      emitOperatorPopup(finalized.finalized ? "SUCCESS" : "INFO", {
        partId: activePartIdForMachine,
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: finalized.finalized ? "ENDED_OK" : "SCANNED",
        plcStatus: finalized.operationStatus === "ENDED_OK" ? "ENDED_OK" : "WAITING_PLC",
        qrResult: "PASS",
        reason: "CUSTOMER_QR_MAPPED",
        message: finalized.finalized
          ? "Customer QR mapped successfully. Operation passed."
          : "Customer QR mapped successfully to active part.",
        customerQrCode: mappedCustomerQrValue,
      });

      return res.json({
        status: "OK",
        decision: "ALLOW",
        qrStatus: "PASS",
        operationStatus: finalized.operationStatus || "WAITING",
        reason: "CUSTOMER_QR_MAPPED",
        message: finalized.finalized ? "Customer QR mapped successfully. Operation passed." : "Customer QR mapped successfully",
        mapped: true,
        partId: activePartIdForMachine,
        customerQrCode: mappedCustomerQrValue,
        machine: {
          id: machine.id,
          machineName: machine.machine_name,
          stationNo,
        },
      });
    }

    const roleGuard = await enforceScannerRoleIfConfigured({
      machine,
      sourceIp: bound.sourceIp,
      allowedRoles: ["START_QR"],
    });
    if (!roleGuard.ok) {
      return res.status(roleGuard.status).json({ error: roleGuard.error });
    }

    const resolvedCode = await resolveMappedPartId(inputCode);
    const normalizedPartId = resolvedCode.resolvedPartId;
    let finalPartId = normalizedPartId;
    let customerQrCode = resolvedCode.customerQrCode;
    const isMappedCustomerQrScan = Boolean(customerQrCode) && customerQrCode === scannedQrRaw;
    const isCustomerQrOnlyStart =
      !isMappedCustomerQrScan &&
      await canStartCustomerQrOnlyPart({
        code: scannedQrRaw,
        stationNo,
        machine,
        stationFeatures,
      });
    if (isCustomerQrOnlyStart) {
      finalPartId = scannedQrRaw;
      customerQrCode = scannedQrRaw;
    }

    if (!isMappedCustomerQrScan && !isCustomerQrOnlyStart && await shouldBlockUnknownQrAfterLaser({
      code: scannedQrRaw,
      stationNo,
    })) {
      const message = await unknownQrAfterLaserMessage(stationNo, scannedQrRaw);
      await sendRejectedScanInterlock({
        machine,
        stationNo,
        reason: "CUSTOMER_QR_NOT_MAPPED",
      });
      emitOperatorPopup("ERROR", {
        partId: scannedQrRaw,
        customerQrCode: scannedQrRaw,
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        qrResult: "FAIL",
        operationStatus: "BLOCKED",
        reason: "CUSTOMER_QR_NOT_MAPPED",
        message,
      });
      return res.status(409).json({
        decision: "BLOCK",
        reason: "CUSTOMER_QR_NOT_MAPPED",
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        message,
        partId: scannedQrRaw,
        customerQrCode: scannedQrRaw,
        stationNo,
      });
    }

    if (isMappedCustomerQrScan && await shouldBlockMappedCustomerQrOnStartScan(stationNo)) {
      const message = wrongCustomerQrAtStartMessage(stationNo);
      await sendRejectedScanInterlock({
        machine,
        stationNo,
        reason: "CUSTOMER_QR_NOT_ALLOWED_AT_START_STATION",
      });
      emitOperatorPopup("ERROR", {
        partId: finalPartId,
        customerQrCode,
        stationNo,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "BLOCKED",
        plcStatus: "BLOCKED",
        qrResult: "FAIL",
        operationStatus: "BLOCKED",
        reason: "CUSTOMER_QR_NOT_ALLOWED_AT_START_STATION",
        message,
      });
      return res.status(409).json({
        decision: "BLOCK",
        reason: "CUSTOMER_QR_NOT_ALLOWED_AT_START_STATION",
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        message,
        partId: finalPartId,
        customerQrCode,
        stationNo,
      });
    }

    const spcConfig = getMachineSpcConfig(machine);
    const rejectionBinConfirmed = stationFeatures.rejectionBin && hasRejectionBinConfirmation(req.body);
    const manualResultEnabled = stationFeatures.manualResult === true;
    const resultInput = String(result ?? req.body.finalResult ?? "").trim().toUpperCase();
    const spcResultRaw = findPayloadValueCaseInsensitive(req.body, spcConfig.payloadResultKey);
    const spcResultInput = normalizeQualityToken(spcResultRaw);
    let plcQualityResult = null;
    if (spcConfig.enabled && spcConfig.mode === "PLC_REGISTER") {
      plcQualityResult = await readQualityCheckResultFromPlc(machine, spcConfig).catch((error) => {
        console.warn(
          `[QUALITY_CHECK] PLC register read failed machineId=${machine.id} partId=${finalPartId} station=${stationNo} error=${error.message}`
        );
        return null;
      });
    }
    const hasSpcResultInput = Boolean(
      spcConfig.enabled &&
      (spcConfig.mode === "PLC_REGISTER" ? plcQualityResult?.result : spcResultInput)
    );
    const hasManualResultInput = Boolean(resultInput);
    const qualityPayload = extractQualityPayload(req.body, machine);
    // In verifyScanForOperator (manual verification from OperatorView panel popup),
    // the operator is validating the barcode first. They will submit the OK/NG result in the next step.
    // Therefore, we do NOT require manual result input at this initial validation step.
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
        : hasManualResultInput
          ? resultInput
          : "OK";
    const ngReason = rejectionBinConfirmed ? "REJECTION_BIN_CONFIRMED" : undefined;
    const resultSource = rejectionBinConfirmed
      ? "PLC_REJECTION_BIN"
      : spcResolvedResult
        ? spcConfig.mode === "PLC_REGISTER"
          ? "QUALITY_CHECK_PLC_REGISTER"
          : "QUALITY_CHECK_IP_PAYLOAD"
        : manualResultEnabled
          ? "MANUAL_OK_NG"
          : hasManualResultInput
            ? "PLC_PAYLOAD"
            : "DEFAULT_OK";
    const machineBypassEnabled = isMachineBypassEnabled(machine.id) || machine.bypass_enabled === true;
    const qrValidationEnabled = stationFeatures.qr !== false;
    const stationBypassEnabled = stationFeatures.bypass === true || stationFeatures.operation === false;
    const skipAllBypassValidations = machineBypassEnabled || stationBypassEnabled;
    const validateQrFormat = stationFeatures.validateQrFormat !== false;
    const validateShotNumber = stationFeatures.validateShotNumber === true;
    const validatePreviousStation = stationFeatures.validatePreviousStation !== false;
    const validateDuplicateBarcode = stationFeatures.validateDuplicateBarcode !== false;
    const validateCustomerCode = stationFeatures.validateCustomerCode === true;
    const bypassState = machineBypassEnabled ? getMachineBypass(machine.id) : null;
    const isCustomerQrOnlyTrace = isCustomerQrOnlyStart || await isCustomerQrOnlyTracePart(finalPartId, customerQrCode);
    const response = await saveScan(finalPartId, stationNo, finalResult, machine.id, req.user?.id, {
      ...(ngReason ? { ngReason } : {}),
      resultSource: isCustomerQrOnlyStart ? "CUSTOMER_QR_ONLY_START" : resultSource,
      resultInput: spcConfig.mode === "PLC_REGISTER"
        ? normalizeQualityToken(plcQualityResult?.token || plcQualityResult?.rawValue || finalResult)
        : hasSpcResultInput
          ? spcResultInput
          : hasManualResultInput
            ? resultInput
            : finalResult,
      qualityPayload,
      customerCodePattern: stationFeatures.customerCodePattern || "",
      shotValidationPartId: finalPartId,
      enforceQrFormatValidation: !isMappedCustomerQrScan && !isCustomerQrOnlyStart && qrValidationEnabled && !skipAllBypassValidations,
      enforceSequenceValidation: !isCustomerQrOnlyStart && !skipAllBypassValidations,
      skipQrFormatValidation: isMappedCustomerQrScan || isCustomerQrOnlyStart || !qrValidationEnabled || !validateQrFormat,
      skipShotValidation: isMappedCustomerQrScan || isCustomerQrOnlyTrace || !validateShotNumber,
      skipCustomerCodeValidation: isMappedCustomerQrScan || isCustomerQrOnlyStart || !qrValidationEnabled || !validateCustomerCode || skipAllBypassValidations,
      skipInterlockValidation: skipAllBypassValidations,
      skipDuplicateValidation: false,
      skipSequenceValidation: isCustomerQrOnlyStart || !validatePreviousStation || skipAllBypassValidations,
    });
    if (response?.decision === "ALLOW" && isCustomerQrOnlyStart) {
      await markCustomerQrOnlyMapping({ code: finalPartId, machine, stationNo });
      const finalized = await finalizeCustomerQrMappingIfEligible({
        partId: finalPartId,
        stationNo,
        machine,
        userId: req.user?.id,
        stationFeatures,
      });
      if (finalized?.finalized) {
        response.operationStatus = "ENDED_OK";
        response.plcStatus = "ENDED_OK";
        response.status = "ENDED_OK";
        response.message = "Customer QR accepted at Laser. Part passed and traceability started. Continue to next station.";
      }
    }
    if (response?.decision === "ALLOW" && response?.operationLogId) {
      await safeRecordTimeline({
        operationId: response.operationLogId,
        partId: finalPartId,
        machineId: machine.id,
        stationNo,
        eventType: TIMELINE_EVENTS.SCANNED,
        eventData: {
          resultSource,
          machineBypassEnabled,
        },
      });
      await safeRecordTimeline({
        operationId: response.operationLogId,
        partId: finalPartId,
        machineId: machine.id,
        stationNo,
        eventType: TIMELINE_EVENTS.VALIDATED,
        eventData: {
          stationFeatures,
          spcMode: spcConfig.mode,
        },
      });
    }
    const qualityAck = response?.decision === "ALLOW"
      ? await sendQualityCheckAckToPlc(machine, spcConfig, finalResult).catch((error) => ({
        ok: false,
        error: error.message,
      }))
      : { skipped: true, reason: "SCAN_BLOCKED" };
    const requiredPlcPartCount = normalizePlcPartCount(stationFeatures.plcPartCount || 1);

    await handleStationPlcFlow({
      response,
      machine,
      stationNo,
      partId: finalPartId,
      userId: req.user?.id,
      requiredPlcPartCount,
    });

    const qrStatus = response.qrStatus || (response.decision === "ALLOW" ? "PASS" : "FAIL");
    const operationStatus = response.operationStatus || (response.decision === "ALLOW" ? "PENDING" : "WAIT");
    const popupType =
      response.decision === "ALLOW" && operationStatus === "ENDED_OK" ? "SUCCESS" : mapScanDecisionToPopupType(response);
    const popupMessage = response.decision === "ALLOW" ? (response.message || "Scan processed") : getBlockedPopupMessage(response);
    emitOperatorPopup(popupType, {
      partId: finalPartId,
      stationNo,
      machineId: machine.id,
      machineName: getModelValue(machine, "machine_name"),
      status: response.decision === "ALLOW" ? operationStatus : "BLOCKED",
      plcStatus: response.decision === "ALLOW" ? operationStatus : "BLOCKED",
      qrResult: qrStatus,
      reason: response.reason || null,
      expectedStation: response.expectedStation || null,
      lastCompletedStation: response.lastCompletedStation || null,
      qrReason: response.reason || null,
      message: popupMessage,
    });

    response.qrStatus = qrStatus;
    response.operationStatus = operationStatus;
    response.plcPartCountRequired = requiredPlcPartCount;
    response.resultSource = isCustomerQrOnlyStart ? "CUSTOMER_QR_ONLY_START" : resultSource;
    response.manualResultEnabled = manualResultEnabled;
    response.isSpcStation = spcConfig.enabled;
    response.machineBypassEnabled = machineBypassEnabled;
    response.stationBypassEnabled = stationBypassEnabled;
    response.machineBypassReason = bypassState?.reason || null;
    response.qualityCheck = {
      mode: spcConfig.mode,
      appliesTo: "ALL",
      plcResultRegister: spcConfig.plcResultRegister,
      plcResultRaw: plcQualityResult?.rawValue ?? null,
      plcResultToken: plcQualityResult?.token ?? null,
      ack: qualityAck,
    };
    response.validationConfig = {
      qrValidationEnabled,
      validateQrFormat,
      validateShotNumber,
      validatePreviousStation,
      validateDuplicateBarcode,
      validateCustomerCode,
      allowCustomerQrOnlyStart: stationFeatures.allowCustomerQrOnlyStart === true,
    };

    res.json({
      status: response.decision === "ALLOW" ? "OK" : "NG",
      ...response,
      partId: finalPartId,
      customerQrCode,
      customerQrOnly: isCustomerQrOnlyStart,
      machine: {
        id: machine.id,
        machineName: machine.machine_name,
        stationNo,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.confirmOperationStart = async (req, res) => {
  try {
    const { partId, stationNo, operation, machineId } = req.body;
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }

    const machine = machineId ? await Machine.findByPk(machineId) : await resolveMachineFromRequest(req.body, req);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const machineStage = getMachineOperationStage(machine);
    const requestedStage = normalizeStation(stationNo || operation);
    if (requestedStage && machineStage && requestedStage !== machineStage) {
      return res.status(400).json({
        error: `Requested station ${requestedStage} does not match machine operation ${machineStage}`,
      });
    }

    const station = machineStage || requestedStage;
    const opLog = await getLatestOperationLog(partId, station);
    if (!opLog) {
      return res.status(404).json({ error: "Operation log not found for this part/station" });
    }

    await markOperationStarted(opLog.id, machine.id);
    emitOperatorPopup("INFO", {
      partId,
      stationNo: station,
      machineId: machine.id,
      machineName: machine.machine_name,
      status: "STARTED",
      plcStatus: "STARTED",
      qrResult: "PASS",
      message: "Operation started by PLC",
    });

    res.json({
      message: "Operation start confirmed",
      partId,
      stationNo: station,
      plcStatus: "STARTED",
      operationLogId: opLog.id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.confirmOperationEnd = async (req, res) => {
  try {
    const { partId, stationNo, operation, machineId, finalResult } = req.body;
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }

    const machine = machineId ? await Machine.findByPk(machineId) : await resolveMachineFromRequest(req.body, req);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }

    const machineStage = getMachineOperationStage(machine);
    const requestedStage = normalizeStation(stationNo || operation);
    if (requestedStage && machineStage && requestedStage !== machineStage) {
      return res.status(400).json({
        error: `Requested station ${requestedStage} does not match machine operation ${machineStage}`,
      });
    }

    const station = machineStage || requestedStage;
    const opLog = await getLatestOperationLog(partId, station);
    if (!opLog) {
      return res.status(404).json({ error: "Operation log not found for this part/station" });
    }

    const normalized = String(finalResult || "OK").toUpperCase() === "OK" ? "OK" : "NG";
    if (normalized === "OK") {
      await markOperationEndedOk({
        operationLogId: opLog.id,
        partId,
        stationNo: station,
        machineId: machine.id,
        userId: req.user?.id,
      });
      emitOperatorPopup("SUCCESS", {
        partId,
        stationNo: station,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "ENDED_OK",
        plcStatus: "ENDED_OK",
        qrResult: "PASS",
        message: "Operation Passed",
      });
      await emitPackingReadyPopup({
        partId,
        stationNo: station,
        machineId: machine.id,
        machineName: machine.machine_name,
      });
    } else {
      await markOperationEndedNg({
        operationLogId: opLog.id,
        partId,
        stationNo: station,
        machineId: machine.id,
        userId: req.user?.id,
        reason: "PLC_END_NG",
      });
      emitOperatorPopup("ERROR", {
        partId,
        stationNo: station,
        machineId: machine.id,
        machineName: machine.machine_name,
        status: "ENDED_NG",
        plcStatus: "ENDED_NG",
        qrResult: "PASS",
        message: "Operation Failed (NG)",
      });
    }

    await clearMachineLock(machine.id);
    emitRealtime("dashboard_refresh", { reason: "PLC_CONFIRMATION" });
    res.json({
      message: "Operation end confirmed",
      partId,
      stationNo: station,
      plcStatus: normalized === "OK" ? "ENDED_OK" : "ENDED_NG",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.reworkPart = async (req, res) => {
  try {
    const { partId, stationNo, reason } = req.body;
    if (!partId || !stationNo) {
      return res.status(400).json({ error: "partId and stationNo are required" });
    }

    const part = await Part.findOne({ where: { part_id: partId } });
    if (!part) {
      return res.status(404).json({ error: "Part not found" });
    }

    const sequence = await getActiveStationSequence();
    const targetStation = normalizeStation(stationNo);
    const targetIndex = sequence.findIndex((station) => station === targetStation);
    if (targetIndex === -1) {
      return res.status(400).json({ error: "Invalid stationNo for rework" });
    }

    const previousStation = targetIndex > 0 ? sequence[targetIndex - 1] : null;

    await ReworkLog.create({
      part_id: partId,
      from_station: part.current_station || null,
      to_station: targetStation,
      reason: reason || "Manual rework",
      user_id: req.user?.id || null,
    });

    part.status = "REWORK";
    part.is_rework = true;
    part.is_interlocked = false;
    part.interlock_reason = null;
    part.current_station = previousStation;
    part.current_operation = previousStation;
    await part.save();

    emitOperatorPopup("INFO", {
      partId,
      stationNo: targetStation,
      status: "REWORK",
      message: "Part moved to rework flow",
    });
    emitRealtime("dashboard_refresh", { reason: "PART_REWORK" });

    res.json({
      message: "Part moved to rework",
      partId,
      restartFromStation: targetStation,
      previousStation,
      status: part.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resetInterlock = async (req, res) => {
  try {
    const { partId, reason } = req.body;
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }

    const part = await Part.findOne({ where: { part_id: partId } });
    if (!part) {
      return res.status(404).json({ error: "Part not found" });
    }

    part.is_interlocked = false;
    part.interlock_reason = null;
    if (part.status === "INTERLOCKED") {
      part.status = part.is_rework ? "REWORK" : "IN_PROGRESS";
    }
    await part.save();

    emitOperatorPopup("INFO", {
      partId,
      stationNo: part.current_station,
      status: "INTERLOCK_RESET",
      message: reason || "Interlock reset by admin",
    });
    emitRealtime("dashboard_refresh", { reason: "INTERLOCK_RESET" });

    res.json({
      message: "Interlock reset successful",
      partId,
      status: part.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.resetOperation = async (req, res) => {
  try {
    const partId = String(req.body.partId || "").trim();
    const targetStation = normalizeStation(req.body.stationNo || req.body.operationNo);

    if (!partId || !targetStation) {
      return res.status(400).json({ error: "partId and stationNo are required" });
    }

    const [part, opLog, sequence] = await Promise.all([
      Part.findOne({ where: { part_id: partId } }),
      getLatestOperationLog(partId, targetStation),
      getActiveStationSequence(),
    ]);

    if (!part) {
      return res.status(404).json({ error: "Part not found" });
    }

    if (!opLog) {
      return res.status(404).json({ error: "Operation log not found for this part/station" });
    }

    const targetIndex = sequence.findIndex((station) => station === targetStation);
    if (targetIndex === -1) {
      return res.status(400).json({ error: "Invalid stationNo for reset-operation" });
    }

    const previousStation = targetIndex > 0 ? sequence[targetIndex - 1] : null;

    await opLog.update({
      plc_status: "RESET",
      result: "OK",
      interlock_reason: null,
      is_bypassed: false,
      bypass_reason: null,
      plc_end_time: null,
      plc_end_at: null,
    });

    part.current_station = previousStation;
    part.current_operation = previousStation;
    part.is_interlocked = false;
    part.interlock_reason = null;
    if (part.status !== "COMPLETED") {
      part.status = part.is_rework ? "REWORK" : "IN_PROGRESS";
    }
    await part.save();

    if (opLog.machine_id) {
      // Rule: RESET must HARD RESET runtime + FSM + listeners + QR state
      await plcHandshakeEngine.hardReset(opLog.machine_id);
    }

    emitOperatorPopup("INFO", {
      partId,
      stationNo: targetStation,
      machineId: opLog.machine_id || null,
      status: "WAIT",
      plcStatus: "WAIT",
      qrResult: "WAIT",
      message: "Operation manually reset by operator. Scan again to restart.",
    });
    emitRealtime("dashboard_refresh", { reason: "OPERATION_RESET" });

    res.json({
      message: "Operation reset successful",
      partId,
      stationNo: targetStation,
      previousStation,
      operationLogId: opLog.id,
      plcStatus: "PENDING",
      partStatus: part.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * resetPlcOnly — Operator View / Global Popup reset.
 * Resets ONLY the PLC/FSM state for the machine at this station.
 * Does NOT modify any Part or OperationLog records.
 * This preserves the full part journey and all historical scan data.
 */
exports.resetPlcOnly = async (req, res) => {
  try {
    const partId       = String(req.body.partId || "").trim();
    const targetStation = normalizeStation(req.body.stationNo || req.body.operationNo);
    const machineId    = Number(req.body.machineId || 0) || null;

    if (!targetStation && !machineId) {
      return res.status(400).json({ error: "stationNo or machineId is required" });
    }

    // Resolve the machine for this station (used to target the PLC engine)
    let resolvedMachineId = machineId;
    if (!resolvedMachineId && targetStation) {
      const machine = await Machine.findOne({
        where: { operation_no: targetStation, is_active: true },
        attributes: ["id"],
      });
      resolvedMachineId = machine?.id || null;
    }

    if (!resolvedMachineId) {
      // If no machine found, still try via any recent op log for this part+station
      if (partId && targetStation) {
        const opLog = await getLatestOperationLog(partId, targetStation);
        resolvedMachineId = opLog?.machine_id || null;
      }
    }

    // Hard-reset only the PLC FSM — no DB changes to Part or OperationLog
    if (resolvedMachineId) {
      await plcHandshakeEngine.hardReset(resolvedMachineId);
    }

    // Emit a neutral wait-state popup so operator knows they can scan again
    emitOperatorPopup("INFO", {
      partId: partId || null,
      stationNo: targetStation || null,
      machineId: resolvedMachineId || null,
      status: "WAIT",
      plcStatus: "WAIT",
      qrResult: "WAIT",
      message: "Station ready. Scan the next part to continue.",
    });
    emitRealtime("RESET_COMPLETED", { partId: partId || null, stationNo: targetStation || null, machineId: resolvedMachineId || null });
    emitRealtime("dashboard_refresh", { reason: "PLC_ONLY_RESET" });

    return res.json({
      message: "PLC reset successful — part journey unchanged",
      partId: partId || null,
      stationNo: targetStation || null,
      machineId: resolvedMachineId || null,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

async function purgePartTraceabilityData(partId) {
  const normalizedPartId = String(partId || "").trim();
  const [part, opRows, prodRows, reworkRows, mappingRows, leakRows] = await Promise.all([
    Part.findOne({ where: { part_id: normalizedPartId } }),
    OperationLog.findAll({
      where: { part_id: normalizedPartId },
      attributes: ["id", "machine_id"],
      raw: true,
    }),
    ProductionLog.findAll({
      where: { part_id: normalizedPartId },
      attributes: ["id", "machine_id"],
      raw: true,
    }),
    ReworkLog.findAll({
      where: { part_id: normalizedPartId },
      attributes: ["id"],
      raw: true,
    }),
    PartCodeMapping.findAll({
      where: {
        [Op.or]: [
          { old_part_id: normalizedPartId },
          { customer_qr: normalizedPartId },
        ],
      },
      attributes: ["id"],
      raw: true,
    }),
    LeakTestReading.findAll({
      where: { part_id: normalizedPartId },
      attributes: ["id"],
      raw: true,
    }),
  ]);

  if (!part && opRows.length === 0 && prodRows.length === 0 && reworkRows.length === 0 && mappingRows.length === 0 && leakRows.length === 0) {
    return null;
  }

  await Promise.all([
    OperationLog.destroy({ where: { part_id: normalizedPartId } }),
    ProductionLog.destroy({ where: { part_id: normalizedPartId } }),
    ReworkLog.destroy({ where: { part_id: normalizedPartId } }),
    PartCodeMapping.destroy({
      where: {
        [Op.or]: [
          { old_part_id: normalizedPartId },
          { customer_qr: normalizedPartId },
        ],
      },
    }),
    LeakTestReading.destroy({ where: { part_id: normalizedPartId } }),
    Part.destroy({ where: { part_id: normalizedPartId } }),
  ]);

  const machineIds = [...new Set([...opRows, ...prodRows].map((row) => Number(row.machine_id)).filter(Number.isFinite))];
  if (machineIds.length > 0) {
    await Promise.all(machineIds.map((machineId) => clearMachineLock(machineId)));
  }

  return {
    operationLogs: opRows.length,
    productionLogs: prodRows.length,
    reworkLogs: reworkRows.length,
    customerQrMappings: mappingRows.length,
    leakTestReadings: leakRows.length,
    machineLocksCleared: machineIds.length,
  };
}

exports.resetStationOperation = async (req, res) => {
  try {
    const partId = String(req.body.partId || "").trim();
    const targetStation = normalizeStation(req.body.stationNo || req.body.operationNo);
    const reason = String(req.body.reason || "").trim();

    if (!partId || !targetStation) {
      return res.status(400).json({ error: "partId and stationNo are required" });
    }

    if (targetStation === "ALL") {
      const purgeSummary = await purgePartTraceabilityData(partId);
      if (!purgeSummary) {
        return res.status(404).json({ error: "Part not found" });
      }

      emitOperatorPopup("WARNING", {
        partId,
        status: "PART_DELETED",
        message: `Part ${partId} removed from traceability records`,
      });
      emitRealtime("dashboard_refresh", { reason: "PART_DELETED", partId });

      return res.json({
        message: "Part deleted successfully",
        partId,
        deleted: purgeSummary,
        reason: reason || "Manual full deletion",
      });
    }

    const [part, sequenceData] = await Promise.all([Part.findOne({ where: { part_id: partId } }), getActiveMachineSequenceData()]);

    if (!part) {
      return res.status(404).json({ error: "Part not found" });
    }

    const targetIndex = sequenceData.sequence.findIndex((station) => station === targetStation);
    if (targetIndex === -1) {
      return res.status(400).json({ error: "Invalid stationNo for reset" });
    }

    const targetStations = sequenceData.sequence.slice(targetIndex);
    const previousStation = targetIndex > 0 ? sequenceData.sequence[targetIndex - 1] : null;

    const logs = await OperationLog.findAll({
      where: { part_id: partId },
      order: [["createdAt", "DESC"]],
    });

    const operationLogIdsToDelete = logs
      .filter((log) => {
        const station = normalizeStation(log.station_no || log.operation_no);
        return targetStations.includes(station);
      })
      .map((log) => log.id);

    if (operationLogIdsToDelete.length > 0) {
      await OperationLog.destroy({
        where: { id: { [Op.in]: operationLogIdsToDelete } },
      });
    }

    const machineIdsForStations = targetStations.flatMap((station) => sequenceData.stationMachineMap[station] || []);
    if (machineIdsForStations.length > 0) {
      await ProductionLog.destroy({
        where: {
          part_id: partId,
          machine_id: { [Op.in]: machineIdsForStations },
        },
      });

      await Promise.all([...new Set(machineIdsForStations)].map((machineId) => clearMachineLock(machineId)));
    }

    const fromStation = part.current_station || null;
    part.current_station = previousStation;
    part.current_operation = previousStation;
    part.is_interlocked = false;
    part.interlock_reason = null;
    part.status = part.is_rework ? "REWORK" : "IN_PROGRESS";
    await part.save();

    await ReworkLog.create({
      part_id: partId,
      from_station: fromStation,
      to_station: targetStation,
      reason: reason || `Manual reset to ${targetStation}`,
      user_id: req.user?.id || null,
    });

    emitOperatorPopup("WARNING", {
      partId,
      stationNo: targetStation,
      status: "STATION_RESET",
      message: `Station reset to ${targetStation}. Re-run process from this stage.`,
    });
    emitRealtime("dashboard_refresh", { reason: "STATION_RESET" });

    res.json({
      message: "Station reset successful",
      partId,
      resetFromStation: targetStation,
      previousStation,
      deletedLogs: operationLogIdsToDelete.length,
      status: part.status,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deletePartTraceability = async (req, res) => {
  try {
    const partId = String(req.body.partId || req.body.part_id || req.params.partId || "").trim();
    const reason = String(req.body.reason || "").trim();
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }

    const purgeSummary = await purgePartTraceabilityData(partId);
    if (!purgeSummary) {
      return res.status(404).json({ error: "Part not found" });
    }

    emitOperatorPopup("WARNING", {
      partId,
      status: "PART_DELETED",
      message: `Part ${partId} removed from traceability records`,
    });
    emitRealtime("dashboard_refresh", { reason: "PART_DELETED", partId });

    res.json({
      message: "Part deleted successfully",
      partId,
      deleted: purgeSummary,
      reason: reason || "Manual deletion",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.bypassOperation = async (req, res) => {
  try {
    const { partId, machineId, stationNo, reason, bypassEnabled } = req.body;
    if (!machineId && !stationNo) {
      return res.status(400).json({ error: "machineId or stationNo is required" });
    }

    let machine = null;
    if (machineId) {
      machine = await Machine.findByPk(machineId);
    } else {
      machine = await Machine.findOne({
        where: { operation_no: normalizeStation(stationNo) },
        order: [["sequence_no", "ASC"]],
      });
    }
    if (!machine) {
      return res.status(404).json({ error: "Machine not found for bypass" });
    }

    const targetStation = normalizeStation(stationNo || getMachineOperationStage(machine));
    const normalizedPartId = String(partId || "").trim();
    const hasPartId = Boolean(normalizedPartId);

    if (!hasPartId) {
      const enabled = typeof bypassEnabled === "boolean" ? bypassEnabled : true;
      const state = setMachineBypass(
        machine.id,
        enabled,
        reason || (enabled ? "MACHINE_BYPASS_ENABLED" : "MACHINE_BYPASS_DISABLED"),
        req.user?.id || null
      );
      await machine.update({ bypass_enabled: enabled });
      emitRealtime("dashboard_refresh", { reason: "MACHINE_BYPASS_TOGGLED", machineId: machine.id, enabled });
      return res.json({
        message: enabled
          ? "Machine bypass enabled (part-level interlock checks skipped)"
          : "Machine bypass disabled",
        machineId: machine.id,
        stationNo: targetStation,
        bypassEnabled: state.enabled,
        bypassReason: state.reason,
        updatedAt: state.updatedAt,
      });
    }
    let opLog = await getLatestOperationLog(normalizedPartId, targetStation);

    if (!opLog) {
      opLog = await OperationLog.create({
        part_id: normalizedPartId,
        machine_id: machine.id,
        operation_no: targetStation,
        station_no: targetStation,
        plc_status: "PENDING",
        result: "OK",
        user_id: req.user?.id || null,
        interlock_reason: null,
      });
    }

    await opLog.update({
      plc_status: "ENDED_OK",
      plc_start_time: opLog.plc_start_time || new Date(),
      plc_start_at: opLog.plc_start_at || new Date(),
      plc_end_time: new Date(),
      plc_end_at: new Date(),
      result: "OK",
      is_bypassed: true,
      bypass_reason: reason || "MANUAL_BYPASS",
      interlock_reason: null,
      machine_id: machine.id,
    });

    const part = await Part.findOne({ where: { part_id: normalizedPartId } });
    if (part) {
      const sequence = await getActiveStationSequence();
      const isLastStation = sequence.length > 0 && targetStation === sequence[sequence.length - 1];
      part.current_station = targetStation;
      part.current_operation = targetStation;
      part.status = isLastStation ? "COMPLETED" : "IN_PROGRESS";
      part.is_interlocked = false;
      part.interlock_reason = null;
      await part.save();
    }

    await ProductionLog.create({
      part_id: normalizedPartId,
      machine_id: machine.id,
      user_id: req.user?.id || null,
      status: "OK",
      ng_reason: "BYPASS_OK",
    });

    emitOperatorPopup("WARNING", {
      partId: normalizedPartId,
      stationNo: targetStation,
      machineId: machine.id,
      machineName: machine.machine_name,
      status: "BYPASS",
      message: "Operation bypassed manually",
    });
    emitRealtime("dashboard_refresh", { reason: "BYPASS_OPERATION" });

    res.json({
      message: "Bypass successful",
      partId: normalizedPartId,
      stationNo: targetStation,
      operationLogId: opLog.id,
      status: part?.status || "IN_PROGRESS",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.submitManualResult = async (req, res) => {
  try {
    const {
      partId,
      stationNo,
      status,
      reason,
      category,
      categoryName,
      view,
      viewName,
      zone,
      zoneName,
      remark,
    } = req.body;
    if (!partId) {
      return res.status(400).json({ error: "partId is required" });
    }
    if (!stationNo) {
      return res.status(400).json({ error: "stationNo is required" });
    }
    if (!status || !["OK", "NG"].includes(String(status).toUpperCase())) {
      return res.status(400).json({ error: "status must be either OK or NG" });
    }

    const targetStation = normalizeStation(stationNo);
    const normalizedPartId = String(partId).trim();
    const normalizedStatus = String(status).toUpperCase();
    const rejectionCategory = String(categoryName || category || "").trim();
    const rejectionView = String(viewName || view || "").trim();
    const rejectionZone = String(zoneName || zone || "").trim();
    const rejectionReason = String(reason || "").trim();
    const rejectionRemark = String(remark || "").trim();
    const storedNgReason = [
      rejectionCategory ? `Category: ${rejectionCategory}` : "",
      rejectionView ? `View: ${rejectionView}` : "",
      rejectionZone ? `Zone: ${rejectionZone}` : "",
      rejectionReason ? `Reason: ${rejectionReason}` : "",
      rejectionRemark ? `Remark: ${rejectionRemark}` : "",
    ].filter(Boolean).join(" | ") || rejectionReason || "MANUAL_REJECT";

    const machine = await Machine.findOne({
      where: { operation_no: targetStation },
      order: [["sequence_no", "ASC"]],
    });
    if (!machine) {
      return res.status(404).json({ error: "Machine not found for station " + stationNo });
    }

    let opLog = await getLatestOperationLog(normalizedPartId, targetStation);
    if (!opLog) {
      opLog = await OperationLog.create({
        part_id: normalizedPartId,
        machine_id: machine.id,
        operation_no: targetStation,
        station_no: targetStation,
        plc_status: "PENDING",
        result: normalizedStatus,
        user_id: req.user?.id || null,
        interlock_reason: null,
      });
    }

    await opLog.update({
      plc_status: normalizedStatus === "OK" ? "ENDED_OK" : "ENDED_NG",
      plc_start_time: opLog.plc_start_time || new Date(),
      plc_start_at: opLog.plc_start_at || new Date(),
      plc_end_time: new Date(),
      plc_end_at: new Date(),
      result: normalizedStatus,
      result_source: "MANUAL",
      result_input: normalizedStatus === "NG" ? storedNgReason : null,
      interlock_reason: normalizedStatus === "NG" ? storedNgReason : null,
      rejection_category: normalizedStatus === "NG" ? rejectionCategory || null : null,
      rejection_view: normalizedStatus === "NG" ? rejectionView || null : null,
      rejection_zone: normalizedStatus === "NG" ? rejectionZone || null : null,
      rejection_reason: normalizedStatus === "NG" ? rejectionReason || null : null,
      rejection_remark: normalizedStatus === "NG" ? rejectionRemark || null : null,
      machine_id: machine.id,
    });

    let part = await Part.findOne({ where: { part_id: normalizedPartId } });
    if (!part) {
      part = await Part.create({
        part_id: normalizedPartId,
        current_station: targetStation,
        current_operation: targetStation,
        status: "IN_PROGRESS",
        is_interlocked: normalizedStatus === "NG",
        interlock_reason: normalizedStatus === "NG" ? storedNgReason : null,
      });
    } else {
      const sequence = await getActiveStationSequence();
      const isLastStation = sequence.length > 0 && targetStation === sequence[sequence.length - 1];
      part.current_station = targetStation;
      part.current_operation = targetStation;
      if (normalizedStatus === "OK") {
        part.status = isLastStation ? "COMPLETED" : "IN_PROGRESS";
        part.is_interlocked = false;
        part.interlock_reason = null;
      } else {
        part.status = "NG";
        part.is_interlocked = true;
        part.interlock_reason = storedNgReason;
      }
      await part.save();
    }

    await ProductionLog.create({
      part_id: normalizedPartId,
      machine_id: machine.id,
      user_id: req.user?.id || null,
      status: normalizedStatus,
      ng_reason: normalizedStatus === "NG" ? storedNgReason : null,
    });

    let autoStartedNextStation = null;
    if (normalizedStatus === "OK") {
      autoStartedNextStation = await autoStartNextCustomerQrStation({
        partId: normalizedPartId,
        completedStation: targetStation,
        userId: req.user?.id || null,
      });
    }

    emitOperatorPopup(normalizedStatus === "OK" ? "SUCCESS" : "WARNING", {
      partId: normalizedPartId,
      stationNo: targetStation,
      machineId: machine.id,
      machineName: machine.machine_name,
      status: normalizedStatus === "OK" ? "PASSED" : "COMPLETED_NG",
      operationStatus: normalizedStatus === "OK" ? "ENDED_OK" : "COMPLETED_NG",
      plcStatus: normalizedStatus === "OK" ? "ENDED_OK" : "COMPLETED_NG",
      qrStatus: "PASSED",
      message: normalizedStatus === "OK"
        ? "Manual quality check passed"
        : `Manual quality check completed with NG: ${storedNgReason || "Rejection"}`,
    });
    if (normalizedStatus === "OK") {
      await emitPackingReadyPopup({
        partId: normalizedPartId,
        stationNo: targetStation,
        machineId: machine.id,
        machineName: machine.machine_name,
      });
    }
    emitRealtime("dashboard_refresh", { reason: "MANUAL_RESULT_SUBMITTED" });

    res.json({
      success: true,
      message: `Manual quality result (${normalizedStatus}) submitted successfully.`,
      partId: normalizedPartId,
      stationNo: targetStation,
      autoStartedNextStation,
      rejection: normalizedStatus === "NG" ? {
        category: rejectionCategory,
        view: rejectionView,
        zone: rejectionZone,
        reason: rejectionReason,
        remark: rejectionRemark,
      } : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.mapCustomerQrCode = async (req, res) => {
  try {
    const oldPartId = String(req.body.oldPartId || req.body.partId || "").trim();
    const customerQrCode = sanitizeCustomerQrValue(req.body.customerQrCode || req.body.customerQr || "");
    const machineId = Number(req.body.machineId || 0) || null;
    const stationNo = normalizeStation(req.body.stationNo || req.body.operationNo || "");
    const sourceIp = normalizeIp(req.body.scannerIp || req.body.sourceIp || req.ip || req.socket?.remoteAddress || "");

    if (!oldPartId || !customerQrCode) {
      return res.status(400).json({ error: "oldPartId and customerQrCode are required" });
    }
    if (oldPartId === customerQrCode) {
      return res.status(400).json({ error: "customerQrCode must be different from oldPartId" });
    }

    const part = await Part.findOne({ where: { part_id: oldPartId } });
    if (!part) {
      return res.status(404).json({ error: `Original part not found: ${oldPartId}` });
    }

    const existing = await PartCodeMapping.findOne({ where: { customer_qr: customerQrCode, is_active: true } });
    if (existing && String(existing.old_part_id || "") !== oldPartId) {
      return res.status(409).json({ error: "Customer QR already mapped to another part" });
    }

    // Optional strict routing (non-breaking):
    // Only enforce scanner-role validation when a CUSTOMER_QR scanner is configured for this machine.
    if (machineId) {
      const roleScanners = await Scanner.findAll({
        where: {
          mapped_machine_id: machineId,
          is_active: true,
        },
      });
      const customerRoleScanners = roleScanners.filter((s) => String(s.scanner_role || "").trim().toUpperCase() === "CUSTOMER_QR");
      if (customerRoleScanners.length > 0 && sourceIp) {
        const matched = customerRoleScanners.some((s) => sameIp(s.scanner_ip, sourceIp));
        if (!matched) {
          return res.status(403).json({
            error: "Scan source is not authorized for customer QR mapping on this machine",
          });
        }
      }
    }

    // a Part ID (DPM) read by the customer-QR scanner must never be stored as a customer QR (8–9 Oct: 12 parts
    // were mapped to another part's DPM code this way). The TCP path has the same check.
    if (isPartIdAsCustomerQr(customerQrCode, oldPartId)) {
      return res.status(400).json({
        error: "This is a Part ID (DPM), not a customer QR. Scan the customer QR label.",
        reason: "PART_ID_SCANNED_AS_CUSTOMER_QR",
        customerQrPending: true,
      });
    }
    await PartCodeMapping.upsert({
      old_part_id: oldPartId,
      customer_qr: customerQrCode,
      machine_id: machineId,
      station_no: stationNo || null,
      is_active: true,
    });

    return res.json({
      success: true,
      message: "Customer QR mapped successfully",
      oldPartId,
      customerQrCode,
      machineId,
      stationNo: stationNo || null,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

exports.getOperationSequence = async (_req, res) => {
  try {
    const machines = await Machine.findAll({
      where: { is_active: true },
      order: [["sequence_no", "ASC"]],
      attributes: [
        "id",
        "machine_name",
        "line_name",
        "operation_no",
        "sequence_no",
        "plc_ip",
        "plc_port",
        "plc_protocol",
        "plc_registers",
      ],
    });

    const operations = machines.map((machine) => ({
      machineId: machine.id,
      machineName: machine.machine_name,
      lineName: machine.line_name,
      stationNo: getMachineOperationStage(machine),
      operationNo: machine.operation_no,
      sequenceNo: machine.sequence_no,
      plcIp: machine.plc_ip,
      plcPort: machine.plc_port,
      plcProtocol: machine.plc_protocol || "TCP_TEXT",
      plcRegisters: machine.plc_registers || null,
    }));

    res.json(operations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getProcessFlow = async (req, res) => {
  try {
    const lineNameFilter = normalizeLineName(req.query.lineName);
    const machineWhere = {
      is_active: true,
      ...(lineNameFilter ? { line_name: lineNameFilter } : {}),
    };
    const machines = await Machine.findAll({
      where: machineWhere,
      order: [["line_name", "ASC"], ["sequence_no", "ASC"]],
      attributes: ["id", "machine_name", "line_name", "operation_no", "sequence_no", "is_running", "running_part_id"],
      raw: true,
    });
    if (!machines.length) {
      return res.json({
        generatedAt: new Date().toISOString(),
        lines: [],
        availableLines: [],
      });
    }

    const machineIds = machines.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
    const [runtimeRows, operationRows] = await Promise.all([
      MachineRuntimeState.findAll({
        where: { machine_id: { [Op.in]: machineIds } },
        attributes: ["machine_id", "current_state", "is_locked", "updatedAt"],
        raw: true,
      }),
      OperationLog.findAll({
        where: { machine_id: { [Op.in]: machineIds } },
        attributes: ["machine_id", "plc_status", "result", "interlock_reason", "createdAt"],
        order: [["createdAt", "DESC"]],
        raw: true,
        limit: Math.max(machineIds.length * 20, 200),
      }),
    ]);

    const runtimeMap = runtimeRows.reduce((acc, row) => {
      acc[row.machine_id] = row;
      return acc;
    }, {});
    const latestOperationByMachine = new Map();
    for (const row of operationRows) {
      if (!latestOperationByMachine.has(row.machine_id)) {
        latestOperationByMachine.set(row.machine_id, row);
      }
    }

    const statusForMachine = (machine) => {
      const runtime = runtimeMap[machine.id] || null;
      const latest = latestOperationByMachine.get(machine.id) || null;
      const plcStatus = String(latest?.plc_status || "").trim().toUpperCase();
      const result = String(latest?.result || "").trim().toUpperCase();
      const runtimeState = String(runtime?.current_state || "").trim().toUpperCase();

      if (Boolean(machine.is_running) || ["RUNNING", "WAITING_END", "START_SENT", "WAITING_RUNNING"].includes(runtimeState)) {
        return "RUNNING";
      }
      if (plcStatus === "INTERLOCKED" || runtime?.is_locked) {
        return "BLOCKED";
      }
      if (plcStatus === "ENDED_OK" && result === "OK") {
        return "PASSED";
      }
      if (plcStatus === "ENDED_NG" || result === "NG" || plcStatus === "PLC_COMM_ERROR") {
        return "FAILED";
      }
      return "IDLE";
    };

    const lineMap = new Map();
    for (const machine of machines) {
      const lineName = String(machine.line_name || "UNASSIGNED").trim() || "UNASSIGNED";
      if (!lineMap.has(lineName)) {
        lineMap.set(lineName, []);
      }
      const status = statusForMachine(machine);
      lineMap.get(lineName).push({
        machineId: machine.id,
        machineName: machine.machine_name,
        stationNo: normalizeStation(machine.operation_no),
        sequenceNo: Number(machine.sequence_no || 0),
        status,
        activePartId: machine.running_part_id || null,
        runtimeState: runtimeMap[machine.id]?.current_state || null,
        interlockReason: latestOperationByMachine.get(machine.id)?.interlock_reason || null,
        lastUpdatedAt:
          runtimeMap[machine.id]?.updatedAt ||
          latestOperationByMachine.get(machine.id)?.createdAt ||
          null,
      });
    }

    const lines = Array.from(lineMap.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([lineName, nodes]) => {
        const sortedNodes = [...nodes].sort((a, b) => Number(a.sequenceNo || 0) - Number(b.sequenceNo || 0));
        const connections = sortedNodes.slice(0, -1).map((node, index) => ({
          fromMachineId: node.machineId,
          toMachineId: sortedNodes[index + 1].machineId,
          fromStation: node.stationNo,
          toStation: sortedNodes[index + 1].stationNo,
        }));
        return {
          lineName,
          nodes: sortedNodes,
          connections,
        };
      });

    res.json({
      generatedAt: new Date().toISOString(),
      availableLines: lines.map((line) => line.lineName),
      lines,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

function getDateRangeFromQuery(query) {
  const now = new Date();
  const fromCandidate = query?.dateFrom ? new Date(query.dateFrom) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const toCandidate = query?.dateTo ? new Date(query.dateTo) : now;
  let from = Number.isNaN(fromCandidate.getTime()) ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : fromCandidate;
  let to = Number.isNaN(toCandidate.getTime()) ? now : toCandidate;

  // If dateFrom is YYYY-MM-DD (date-only), start at beginning of day
  if (query?.dateFrom && typeof query.dateFrom === 'string' && query.dateFrom.length <= 10) {
    from.setHours(0, 0, 0, 0);
  }
  // If dateTo is YYYY-MM-DD (date-only), extend to end of day so current day parts aren't cut off
  if (query?.dateTo && typeof query.dateTo === 'string' && query.dateTo.length <= 10) {
    to.setHours(23, 59, 59, 999);
  }

  if (query?.dateFrom && query?.dateTo && isProductionDatePickerRange(from, to)) {
    const productionStart = new Date(from);
    productionStart.setHours(6, 0, 0, 0);
    const productionEnd = new Date(productionStart);
    productionEnd.setDate(productionEnd.getDate() + 1);
    from = productionStart;
    to = productionEnd;
  }
  const currentProductionStart = new Date(now);
  currentProductionStart.setHours(6, 0, 0, 0);
  if (now < currentProductionStart) currentProductionStart.setDate(currentProductionStart.getDate() - 1);
  if (
    getLocalDateKey(from) === getLocalDateKey(currentProductionStart) &&
    getLocalSecondOfDay(from) < 6 * 3600
  ) {
    from = currentProductionStart;
  }
  if (
    getLocalDateKey(from) === getLocalDateKey(currentProductionStart) &&
    to > now
  ) {
    to = now;
  }
  return { from, to };
}

function getLocalDateKey(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getLocalSecondOfDay(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function getLocalDayDiff(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function isProductionDatePickerRange(from, to) {
  const fromSeconds = getLocalSecondOfDay(from);
  const toSeconds = getLocalSecondOfDay(to);
  if (fromSeconds === null || toSeconds === null) return false;
  if (getLocalDateKey(from) === getLocalDateKey(to)) {
    return fromSeconds < 6 * 3600 && (toSeconds === 0 || toSeconds >= 23 * 3600);
  }
  return fromSeconds < 6 * 3600 && getLocalDayDiff(from, to) === 1 && toSeconds <= 6 * 3600;
}

function setDateSeconds(baseDate, seconds) {
  const date = new Date(baseDate);
  date.setHours(Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60, 0);
  return date;
}

// Window of `shift` in the CURRENT production day (the day containing `now`, which starts at the earliest shift
// start, e.g. 06:00): at 02:00 "Shift A" is the Shift A that ran yesterday 06:00–14:30, not tomorrow's empty one.
// Returns { from, to } with `to` EXCLUSIVE (shift end second + 1 s, end_time being the last second of the shift).
// Plant time comes from utils/productionDay, so the result does not depend on the server's time zone.
function getShiftWindowForDate(shift, now = new Date(), shifts = []) {
  const PD = require("../utils/productionDay");
  const startSeconds = toShiftSeconds(shift?.start_time);
  const endSeconds = toShiftSeconds(shift?.end_time);
  if (startSeconds === null || endSeconds === null) {
    return null;
  }
  const dayShifts = Array.isArray(shifts) && shifts.length ? shifts : [shift];
  const day = PD.currentProductionDay(dayShifts, now);
  const offsetSeconds = (startSeconds - PD.dayStartSeconds(dayShifts) + 24 * 3600) % (24 * 3600);
  const durationSeconds = startSeconds === endSeconds ? 24 * 3600 : PD.shiftDurationSeconds(shift);
  const from = new Date(day.from.getTime() + offsetSeconds * 1000);
  const to = new Date(from.getTime() + durationSeconds * 1000);
  return { from, to };
}

// The production day containing `now`: [earliest shift start, +24 h) — see utils/productionDay (time-zone safe).
function getProductionDayWindow(shifts = [], now = new Date()) {
  return require("../utils/productionDay").currentProductionDay(shifts, now);
}

// Operator page window, { from, to } with `to` EXCLUSIVE.
function getOperatorStatsDateRange(query, shifts, effectiveShiftCode, currentShift) {
  if (query?.dateFrom || query?.dateTo) {
    return getDateRangeFromQuery(query);
  }
  if (effectiveShiftCode) {
    const selectedShift = shifts.find((row) => normalizeShiftAlias(row.shift_code || row.shift_name) === normalizeShiftAlias(effectiveShiftCode)) || currentShift;
    const selectedWindow = getShiftWindowForDate(selectedShift, new Date(), shifts);
    if (selectedWindow) return selectedWindow;
  }
  return getProductionDayWindow(shifts);
}

async function finalizeCustomerQrMappingIfEligible({
  partId,
  stationNo,
  machine,
  userId,
  stationFeatures = null,
}) {
  const station = normalizeStation(stationNo);
  const features = stationFeatures || await getStationFeatureConfig(station).catch(() => null);
  if (!partId || !station || !machine?.id || !features) {
    return { finalized: false, operationStatus: "WAITING" };
  }
  const shouldAutoComplete =
    features.manualResult !== true &&
    features.plcCommunication === false;
  if (!shouldAutoComplete) {
    return { finalized: false, operationStatus: "WAITING" };
  }
  const latest = await getLatestOperationLog(partId, station);
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
    userId,
  });
  await safeRecordTimeline({
    operationId: latest.id,
    partId,
    machineId: machine.id,
    stationNo: station,
    eventType: TIMELINE_EVENTS.COMPLETED_OK,
    eventData: {
      customerQrMapped: true,
      autoCompleted: true,
    },
  });
  await emitPackingReadyPopup({
    partId,
    stationNo: station,
    machineId: machine.id,
    machineName: machine.machine_name,
  });
  return { finalized: true, operationStatus: "ENDED_OK", operationLogId: latest.id };
}

function toScannerResponse(scanner) {
  if (!scanner) return null;
  return {
    id: scanner.id,
    scannerName: scanner.scanner_name,
    scannerIp: scanner.scanner_ip,
    scannerPort: scanner.scanner_port,
    scannerMode: scanner.scanner_mode || "TCP_CLIENT",
    scannerRole: scanner.scanner_role || null,
    isActive: scanner.is_active,
    isSimulation: Boolean(scanner.is_simulation),
  };
}

async function getMachineScanners(machineId) {
  if (!machineId) return [];
  return Scanner.findAll({
    where: { mapped_machine_id: machineId, is_active: true },
    order: [["updatedAt", "DESC"], ["id", "ASC"]],
  });
}

async function buildMachineScannerBundle(machineId) {
  const scanners = await getMachineScanners(machineId);
  if (!scanners.length) {
    return {
      primaryScanner: null,
      primaryHealth: await buildScannerHealth(null, machineId),
      scanners: [],
      scannerHealth: [],
    };
  }

  const scannerRows = scanners.map((scanner) => toScannerResponse(scanner));
  const scannerHealthRows = await Promise.all(scanners.map((scanner) => buildScannerHealth(scanner, machineId)));
  const startIndex = scanners.findIndex((scanner) => String(scanner.scanner_role || "").trim().toUpperCase() === "START_QR");
  const primaryIndex = startIndex >= 0 ? startIndex : 0;

  return {
    primaryScanner: scannerRows[primaryIndex] || scannerRows[0] || null,
    primaryHealth: scannerHealthRows[primaryIndex] || scannerHealthRows[0] || null,
    scanners: scannerRows,
    scannerHealth: scannerHealthRows,
  };
}

function normalizeReportYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return year;
  if (year >= 0 && year < 100) return 2000 + year;
  return year;
}

function toSeconds(timeValue) {
  return toShiftSeconds(timeValue);
}

function getSecondsForDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function isDateInShift(dateValue, shift) {
  const currentSeconds = getSecondsForDate(dateValue);
  const start = toSeconds(shift.start_time);
  const end = toSeconds(shift.end_time);
  if (currentSeconds === null || start === null || end === null) {
    return false;
  }
  if (start === end) {
    return true;
  }
  if (start < end) {
    return currentSeconds >= start && currentSeconds <= end;
  }
  return currentSeconds >= start || currentSeconds <= end;
}

async function getActiveShiftDefinitions() {
  const rows = await Shift.findAll({
    where: { is_active: true },
    attributes: ["id", "shift_name", "shift_code", "start_time", "end_time"],
    order: [["start_time", "ASC"]],
    raw: true,
  });
  return rows;
}

function resolveShiftCodeForDate(dateValue, shifts) {
  const matches = [];
  for (const shift of shifts) {
    if (isDateInShift(dateValue, shift)) {
      const start = toSeconds(shift.start_time);
      const end = toSeconds(shift.end_time);
      const duration = start === end ? 24 * 3600 : start < end ? end - start : (24 * 3600 - start + end);
      matches.push({ code: shift.shift_code, start, duration });
    }
  }
  if (matches.length) {
    matches.sort((a, b) => (b.start - a.start) || (a.duration - b.duration));
    return matches[0].code;
  }
  return "UNASSIGNED";
}

function isDateWithinRange(dateValue, range) {
  if (!range?.from || !range?.to) return true;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  return date >= range.from && date < range.to; // end exclusive
}

function applyShiftFilter(rows, shiftCode, shifts, range = null) {
  if (!shiftCode) {
    return rows;
  }
  const target = normalizeShiftAlias(shiftCode);
  if (!target) return rows;
  return rows.filter((row) => {
    const timestamp = row.createdAt || row.firstScanAt || row.firstScanCreatedAt || row.updatedAt;
    return isDateWithinRange(timestamp, range) && normalizeShiftAlias(resolveShiftCodeForDate(timestamp, shifts)) === target;
  });
}

function isAllShiftToken(value) {
  return ["ALL", "ALL_SHIFT", "ALL_SHIFTS"].includes(String(value || "").trim().toUpperCase());
}

function normalizeShiftAlias(value) {
  const token = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!token || isAllShiftToken(token) || token === "ANY") return "";
  const parts = token.split("_").filter(Boolean);
  if (token === "A" || token === "SHIFT_A" || token === "A_SHIFT" || (parts.includes("SHIFT") && parts.includes("A"))) return "SHIFT_A";
  if (token === "B" || token === "SHIFT_B" || token === "B_SHIFT" || (parts.includes("SHIFT") && parts.includes("B"))) return "SHIFT_B";
  if (token === "C" || token === "SHIFT_C" || token === "C_SHIFT" || (parts.includes("SHIFT") && parts.includes("C"))) return "SHIFT_C";
  if (token === "S1" || token === "SHIFT_S1" || token === "S1_SHIFT" || token === "SHIFT_1") return "SHIFT_S1";
  if (token === "S2" || token === "SHIFT_S2" || token === "S2_SHIFT" || token === "SHIFT_2") return "SHIFT_S2";
  if (token === "S3" || token === "SHIFT_S3" || token === "S3_SHIFT" || token === "SHIFT_3") return "SHIFT_S3";
  return token;
}

function formatHourBucket(dateValue) {
  const date = new Date(dateValue);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:00`;
}

function normalizeLineName(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function buildMachineUniqKey(machine = {}) {
  return String(machine.machine_number || `${machine.machine_name || ""}|${machine.line_name || ""}|${machine.operation_no || ""}`)
    .trim()
    .toUpperCase();
}

function dedupeMachines(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = buildMachineUniqKey(row);
    if (!key) {
      continue;
    }
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const existingUpdatedAt = new Date(existing.updatedAt || 0).getTime();
    const candidateUpdatedAt = new Date(row.updatedAt || 0).getTime();
    if (candidateUpdatedAt >= existingUpdatedAt) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function toCsvField(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function formatReportTimestamp(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function buildReportFileTimestamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}_${hh}${mm}`;
}

exports.getDashboardSummary = async (req, res) => {
  try {
    const shifts = await getActiveShiftDefinitions();
    const now = new Date();
    const defaultWindow = getProductionDayWindow(shifts, now);
    const datePreset = String(req.query.datePreset || "").toLowerCase().trim();
    const isAllTime = datePreset === "all" || req.query.allTime === "1" || req.query.allTime === "true";
    // Production days: D = D 06:00 → D+1 06:00 (end exclusive); range D1–D2 = D1 06:00 → (D2+1) 06:00
    const requestedRange = (req.query.dateFrom || req.query.dateTo)
      ? require("../utils/productionDay").productionWindow({ dateFrom: req.query.dateFrom, dateTo: req.query.dateTo, shifts, now })
      : defaultWindow;
    const from = requestedRange.from;
    const to = requestedRange.to;

    const whereConditions = [];
    const replacements = {};

    // scanner misreads (several IDs in one read, fragments) are not parts — see VALID_SCAN_SQL

    whereConditions.push(require("../utils/productionDay").VALID_SCAN_SQL);
    whereConditions.push(require("../utils/productionDay").notStaleRowSql("id"));

    if (!isAllTime) {
      // a part belongs to the production day of its first scan (same rule as the Historical Report)
      whereConditions.push(`first_scan_at >= :from AND first_scan_at < :to`);
      replacements.from = from;
      replacements.to = to;
    }
    // Shift filter on the totals too (it used to apply only to the station counts): the part's first scan decides
    // its shift, as for the day.
    const dashShift = normalizeShiftAlias(req.query.shiftCode || req.query.shift_code || "");
    if (dashShift && shifts.length) {
      whereConditions.push(`${require("../utils/productionDay").shiftCaseSql("first_scan_at", shifts.map((s) => (s.get ? s.get({ plain: true }) : s)))} = :dashShift`);
      replacements.dashShift = dashShift;
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    // Station OK / NG by each station's own scan time and Final OK = OP160 passes in the period — the same figures
    // as Rejection Analysis and the Historical Report. Started now; runs alongside the summary queries.
    const scanCountsPromise = buildRejectionFilterContext(req.query)
      .then((ctx) => stationCountsByScan(req.query, ctx))
      .catch((err) => { console.warn("[DASHBOARD] station scan counts error:", err.message); return null; });

    let dbMachines = [];
    try {
      dbMachines = await Machine.findAll({
        attributes: ["id", "machine_name", "operation_no", "sequence_no", "line_name", "is_active"],
        order: [["sequence_no", "ASC"], ["operation_no", "ASC"]],
        raw: true,
      });
    } catch (e) {
      console.warn(`[DASHBOARD] Machine query fallback: ${e.message}`);
    }

    const stationLabelMap = {
      OP100: "DCM+DPM (OP100)",
      OP110: "Laser Marking (OP110)",
      OP120: "Casting PDi (OP120)",
      OP130: "Pre Inspection (OP130)",
      OP140: "Auto Guaging (OP140)",
      OP150: "Leak Test OP150 (Total)",
      OP160: "Final Inspection (OP160)",
    };

    if (Array.isArray(dbMachines)) {
      dbMachines.forEach((m) => {
        const op = String(m.operation_no || "").trim().toUpperCase();
        const mName = String(m.machine_name || "").trim();
        if (op && mName) {
          if (op === "OP150" && mName.toLowerCase().includes("leak")) {
            stationLabelMap["OP150"] = "Leak Test OP150 (Total)";
          } else {
            stationLabelMap[op] = `${mName} (${op})`;
          }
        }
      });
    }

    // Run parallel queries on RICO_IOT ProductionReports
    const [aggregatesRes, shiftScrapRes, recentScansRes, topDefectsRes] = await Promise.all([
      sequelize.query(`
        SELECT 
          COUNT(*) as totalParts,
          -- part status: shared definitions (PART_NG_SQL / PART_OK_SQL) — same as the rejection page and the reports
          SUM(CASE WHEN ${PART_NG_SQL} THEN 0 WHEN ${PART_OK_SQL} THEN 1 ELSE 0 END) as totalOK,
          SUM(CASE WHEN ${PART_NG_SQL} THEN 1 ELSE 0 END) as totalNG,
          SUM(CASE WHEN ${PART_NG_SQL} THEN 0 WHEN ${PART_OK_SQL} THEN 0 ELSE 1 END) as totalInProgress,
          SUM(CASE WHEN op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%DCM%' AND overall_status IN ('NG', 'FAILED')) THEN 1 ELSE 0 END) as op100_ng,
          SUM(CASE WHEN op100_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') OR (machine_name LIKE '%DCM%' AND overall_status IN ('OK', 'PASSED')) THEN 1 ELSE 0 END) as op100_ok,
          SUM(CASE WHEN op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op110_ng,
          SUM(CASE WHEN op110_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op110_ok,
          SUM(CASE WHEN op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op120_ng,
          SUM(CASE WHEN op120_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op120_ok,
          SUM(CASE WHEN op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op130_ng,
          SUM(CASE WHEN op130_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op130_ok,
          SUM(CASE WHEN op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op140_ng,
          SUM(CASE WHEN op140_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op140_ok,
          SUM(CASE WHEN (
            op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
            OR (machine_name LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (rejection_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (ng_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (rejection_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
            OR (ng_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
          ) THEN 1 ELSE 0 END) as op150_ng,
          SUM(CASE WHEN (
            op150_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK')
            OR JSON_VALUE(leak_data, '$.result') IN ('OK', 'PASS', 'PASSED')
            OR (machine_name LIKE '%Leak%' AND overall_status IN ('OK', 'PASSED'))
          ) THEN 1 ELSE 0 END) as op150_ok,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01'
            OR leak_data LIKE '%1773%'
            OR machine_name = 'Leak-Test-01'
            OR machine_name LIKE '%Leak%01%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
            OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%'))
            OR (machine_name = 'Leak-Test-01' AND overall_status IN ('NG','FAILED'))
          ) THEN 1 ELSE 0 END) as leak01_ng,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01'
            OR leak_data LIKE '%1773%'
            OR machine_name = 'Leak-Test-01'
            OR machine_name LIKE '%Leak%01%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED')
            OR (op150_status IN ('OK','PASSED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%'))
            OR (machine_name = 'Leak-Test-01' AND overall_status IN ('OK','PASSED'))
          ) THEN 1 ELSE 0 END) as leak01_ok,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02'
            OR leak_data LIKE '%1774%'
            OR machine_name = 'Leak-Test-02'
            OR machine_name LIKE '%Leak%02%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
            OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%'))
            OR (machine_name = 'Leak-Test-02' AND overall_status IN ('NG','FAILED'))
          ) THEN 1 ELSE 0 END) as leak02_ng,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02'
            OR leak_data LIKE '%1774%'
            OR machine_name = 'Leak-Test-02'
            OR machine_name LIKE '%Leak%02%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED')
            OR (op150_status IN ('OK','PASSED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%'))
            OR (machine_name = 'Leak-Test-02' AND overall_status IN ('OK','PASSED'))
          ) THEN 1 ELSE 0 END) as leak02_ok,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03'
            OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03'
            OR leak_data LIKE '%1776%'
            OR machine_name = 'Leak Test-03'
            OR machine_name LIKE '%Leak%03%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
            OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%'))
            OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('NG','FAILED'))
          ) THEN 1 ELSE 0 END) as leak03_ng,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03'
            OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03'
            OR leak_data LIKE '%1776%'
            OR machine_name = 'Leak Test-03'
            OR machine_name LIKE '%Leak%03%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED')
            OR (op150_status IN ('OK','PASSED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%'))
            OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('OK','PASSED'))
          ) THEN 1 ELSE 0 END) as leak03_ok,
          SUM(CASE WHEN op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op160_ng,
          SUM(CASE WHEN op160_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op160_ok
        FROM [RICO_IOT].[dbo].[ProductionReports] pr
        ${whereSql}
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[DASHBOARD] aggregate query error:", err.message);
        return [{}];
      }),

      sequelize.query(shiftBreakdownSql({ whereSql, shifts }), { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[DASHBOARD] shift query error:", err.message);
        return [];
      }),

      sequelize.query(`
        SELECT TOP 25
          id,
          part_id as partId,
          customer_qr as customerQr,
          machine_name as machine,
          overall_status as overallStatus,
          op100_status,
          op110_status,
          op120_status,
          op130_status,
          op140_status,
          op150_status,
          op160_status,
          cycle_time as cycleTime,
          rejection_reason as rejectionReason,
          shift_code as shiftCode,
          createdAt,
          first_scan_at as firstScanAt,
          final_scan_at as finalScanAt
        FROM [RICO_IOT].[dbo].[ProductionReports]
        ${whereSql}
        ORDER BY COALESCE(final_scan_at, first_scan_at, createdAt) DESC
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[DASHBOARD] recent scans query error:", err.message);
        return [];
      }),

      // Rejection reasons of every NG part: the operator entry in Parts ("… | Reason: Dent"), else the stored reason,
      // else the rejecting station's default — the same reasons Rejection Analysis shows. All reasons are returned so
      // Pareto shares are of all NG parts.
      sequelize.query(`
        SELECT reason, MAX(category) AS category, COUNT(*) AS count
        FROM (
          SELECT
            COALESCE(
              NULLIF(LTRIM(RTRIM(CASE WHEN CHARINDEX('Reason:', p.interlock_reason) > 0 THEN
                LEFT(SUBSTRING(p.interlock_reason, CHARINDEX('Reason:', p.interlock_reason) + 7, 200),
                     CHARINDEX('|', SUBSTRING(p.interlock_reason, CHARINDEX('Reason:', p.interlock_reason) + 7, 200) + '|') - 1) END)), ''),
              NULLIF(LTRIM(RTRIM(pr.rejection_reason)), ''),
              CASE
                WHEN pr.op130_status IN ${NG_STATUS_LIST} THEN 'Pre-Inspection Visual NG'
                WHEN pr.op120_status IN ${NG_STATUS_LIST} THEN 'Casting Visual NG'
                WHEN pr.op100_status IN ${NG_STATUS_LIST} THEN 'DCM Casting Defect'
                WHEN pr.op150_status IN ${NG_STATUS_LIST} OR (CASE WHEN ISJSON(pr.leak_data) = 1 THEN JSON_VALUE(pr.leak_data, '$.result') END) IN ('NG', 'FAIL', 'FAILED') THEN 'Pressure Leakage Fail (OP150)'
                WHEN pr.op140_status IN ${NG_STATUS_LIST} THEN 'Auto Gauging Dimension NG'
                ELSE 'Not recorded' END
            ) AS reason,
            COALESCE(
              NULLIF(LTRIM(RTRIM(CASE WHEN CHARINDEX('Category:', p.interlock_reason) > 0 THEN
                LEFT(SUBSTRING(p.interlock_reason, CHARINDEX('Category:', p.interlock_reason) + 9, 50),
                     CHARINDEX('|', SUBSTRING(p.interlock_reason, CHARINDEX('Category:', p.interlock_reason) + 9, 50) + '|') - 1) END)), ''),
              NULLIF(LTRIM(RTRIM(pr.rejection_category)), ''),
              CASE WHEN pr.op140_status IN ${NG_STATUS_LIST} THEN 'MR' WHEN pr.op120_status IN ${NG_STATUS_LIST} OR pr.op100_status IN ${NG_STATUS_LIST} THEN 'CR' ELSE 'CRAM' END
            ) AS category
          FROM [RICO_IOT].[dbo].[ProductionReports] pr
          OUTER APPLY (SELECT TOP 1 px.interlock_reason FROM Parts px WHERE px.part_id = pr.part_id AND px.interlock_reason LIKE '%Reason:%') p
          ${whereSql ? whereSql + " AND" : "WHERE"} ${PART_NG_SQL}
        ) x
        GROUP BY reason
        ORDER BY count DESC
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[DASHBOARD] top defects query error:", err.message);
        return [];
      }),
    ]);

    const agg = aggregatesRes?.[0] || {};
    const scanCounts = await scanCountsPromise;
    const castParts = Number(agg.totalParts || 0);
    // Final OK = parts that passed final inspection (OP160) in the period. The first-scan count only holds parts
    // CAST in the period that already finished, so "Today" showed e.g. 2 OK while OP160 had passed hundreds.
    const totalOK = Math.max(Number(agg.totalOK || 0), Number(scanCounts?.OP160?.ok || 0));
    const totalNG = Number(agg.totalNG || 0);
    // In progress = parts cast in the period that are still in process; Total = OK + NG + In progress. (Total used to
    // be the cast count alone, so a day that finished many earlier parts showed OK 1,186 against Total 1,028.)
    const totalInProgress = Math.max(0, castParts - Number(agg.totalOK || 0) - totalNG);
    const totalParts = totalOK + totalNG + totalInProgress;
    const scrapRate = (totalOK + totalNG) > 0 ? Number(((totalNG / (totalOK + totalNG)) * 100).toFixed(2)) : (totalParts > 0 ? Number(((totalNG / totalParts) * 100).toFixed(2)) : 0);
    const okRate = (totalOK + totalNG) > 0 ? Number(((totalOK / (totalOK + totalNG)) * 100).toFixed(2)) : 100;

    // Station-Wise Quality Gates breakdown (matching Rejection Analysis)
    let qualityGates = [
      { code: "OP100", name: stationLabelMap["OP100"] || "DCM+DPM (OP100)", okCount: Number(agg.op100_ok || 0), ngCount: Number(agg.op100_ng || 0) },
      { code: "OP110", name: stationLabelMap["OP110"] || "Laser Marking (OP110)", okCount: Number(agg.op110_ok || 0), ngCount: Number(agg.op110_ng || 0) },
      { code: "OP120", name: stationLabelMap["OP120"] || "Casting PDi (OP120)", okCount: Number(agg.op120_ok || 0), ngCount: Number(agg.op120_ng || 0) },
      { code: "OP130", name: stationLabelMap["OP130"] || "Pre Inspection (OP130)", okCount: Number(agg.op130_ok || 0), ngCount: Number(agg.op130_ng || 0) },
      { code: "OP140", name: stationLabelMap["OP140"] || "Auto Guaging (OP140)", okCount: Number(agg.op140_ok || 0), ngCount: Number(agg.op140_ng || 0) },
      { code: "OP150", name: "Leak Test OP150 (Total)", okCount: Number(agg.op150_ok || 0), ngCount: Number(agg.op150_ng || 0) },
      { code: "Leak-Test-01", name: "Leak-Test-01", okCount: Number(agg.leak01_ok || 0), ngCount: Number(agg.leak01_ng || 0) },
      { code: "Leak-Test-02", name: "Leak-Test-02", okCount: Number(agg.leak02_ok || 0), ngCount: Number(agg.leak02_ng || 0) },
      { code: "Leak Test-03", name: "Leak Test-03", okCount: Number(agg.leak03_ok || 0), ngCount: Number(agg.leak03_ng || 0) },
      { code: "OP160", name: stationLabelMap["OP160"] || "Final Inspection (OP160)", okCount: Number(agg.op160_ok || 0), ngCount: Number(agg.op160_ng || 0) },
    ];

    if (scanCounts) {
      qualityGates.forEach((gate) => {
        const c = scanCounts[gate.code];
        if (c) { gate.okCount = c.ok; gate.ngCount = c.ng; }
      });
    }

    qualityGates = qualityGates.map((gate) => {
      const inspected = gate.okCount + gate.ngCount;
      const gateScrapRate = inspected > 0 ? Number(((gate.ngCount / inspected) * 100).toFixed(2)) : 0;
      const gateOkRate = inspected > 0 ? Number(((gate.okCount / inspected) * 100).toFixed(2)) : 100;
      return { ...gate, inspected, scrapRate: gateScrapRate, okRate: gateOkRate };
    });

    // Shift Production
    const shiftProduction = (shiftScrapRes || []).reduce((acc, row) => {
      const sKey = String(row.shift || "").replace(/^SHIFT_/, "").trim() || "UNASSIGNED";
      const stats = {
        shift: sKey,
        total: Number(row.total || 0),
        ok: Number(row.ok || 0),
        ng: Number(row.ng || 0),
        scrapRate: Number(row.scrapRate || 0),
      };
      acc[sKey] = stats;
      acc[row.shift] = stats;
      return acc;
    }, { A: { shift: "A", total: 0, ok: 0, ng: 0, scrapRate: 0 }, B: { shift: "B", total: 0, ok: 0, ng: 0, scrapRate: 0 }, C: { shift: "C", total: 0, ok: 0, ng: 0, scrapRate: 0 } });

    // Recent Scans mapping
    const recentScans = (recentScansRes || []).map((row) => {
      const resVal = row.overallStatus || "OK";
      return {
        partId: row.partId || row.customerQr,
        customerQr: row.customerQr,
        machine: row.machine,
        result: resVal,
        overallStatus: resVal,
        cycleTime: row.cycleTime || null,
        rejectionReason: row.rejectionReason || null,
        shiftCode: row.shiftCode || "A",
        timestamp: row.createdAt || row.finalScanAt || row.firstScanAt,
        op100: row.op100_status,
        op110: row.op110_status,
        op120: row.op120_status,
        op130: row.op130_status,
        op140: row.op140_status,
        op150: row.op150_status,
        op160: row.op160_status,
      };
    });

    // Line OEE and OA metrics
    const hoursSpan = Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / 3600000);
    const plannedTarget = Math.max(50, Math.round(hoursSpan * 55));
    const qualityFactor = totalParts > 0 ? (totalOK / totalParts) : 1;
    const performanceFactor = totalParts > 0 ? Math.min(1.0, Math.max(0.65, totalParts / plannedTarget)) : 0.85;
    const availabilityFactor = totalParts > 0 ? Math.min(0.98, Math.max(0.72, (totalParts * 50) / (hoursSpan * 3600 * 0.85))) : 0.88;
    const lineOeeVal = Math.min(100, Math.max(0, Math.round(availabilityFactor * performanceFactor * qualityFactor * 100)));
    const lineOaVal = Math.min(100, Math.max(0, Math.round(availabilityFactor * 100)));

    const uniqueMachines = dedupeMachines(dbMachines);
    const activeCount = uniqueMachines.filter((row) => row.is_active !== false).length;
    const availableLines = uniqueStages(uniqueMachines.map((row) => String(row.line_name || "").trim()).filter(Boolean));

    res.json({
      summary: {
        totalParts,
        totalOK,
        totalNG,
        totalInProgress,
        scrapRate,
        okRate,
      },
      qualityGates,
      lineOee: {
        oee: lineOeeVal,
        oa: lineOaVal,
        quality: Math.round(qualityFactor * 100),
        performance: Math.round(performanceFactor * 100),
        availability: Math.round(availabilityFactor * 100),
        target: plannedTarget,
        actual: totalParts,
        status: lineOeeVal >= 85 ? "World Class" : lineOeeVal >= 70 ? "Optimal" : "Attention Needed",
      },
      machines: {
        total: uniqueMachines.length,
        active: activeCount,
        inactive: Math.max(uniqueMachines.length - activeCount, 0),
      },
      parts: {
        total: totalParts,
        completed: totalOK,
        inProgress: totalInProgress,
        ng: totalNG,
        scrapRate,
        okRate,
      },
      quality: {
        ok: totalOK,
        ng: totalNG,
        total: totalParts,
        scrapRate,
        okRate,
      },
      shiftProduction,
      availableShifts: shifts.map((shift) => ({
        shiftCode: shift.shift_code,
        shiftName: shift.shift_name,
        startTime: normalizeTimeValue(shift.start_time, { includeSeconds: true }),
        endTime: normalizeTimeValue(shift.end_time, { includeSeconds: true }),
      })),
      availableLines,
      recentScans,
      topDefects: topDefectsRes || [],
      dateRange: { from, to },
    });
  } catch (error) {
    console.error("[DASHBOARD] getDashboardSummary error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getDashboardTrends = async (req, res) => {
  try {
    const shifts = await getActiveShiftDefinitions();
    const now = new Date();
    const defaultWindow = getProductionDayWindow(shifts, now);
    const datePreset = String(req.query.datePreset || "").toLowerCase().trim();
    const isAllTime = datePreset === "all" || req.query.allTime === "1" || req.query.allTime === "true";
    // Production days: D = D 06:00 → D+1 06:00 (end exclusive); range D1–D2 = D1 06:00 → (D2+1) 06:00
    const requestedRange = (req.query.dateFrom || req.query.dateTo)
      ? require("../utils/productionDay").productionWindow({ dateFrom: req.query.dateFrom, dateTo: req.query.dateTo, shifts, now })
      : defaultWindow;
    const from = requestedRange.from;
    const to = requestedRange.to;

    const whereConditions = [];
    const replacements = {};

    // scanner misreads (several IDs in one read, fragments) are not parts — see VALID_SCAN_SQL

    whereConditions.push(require("../utils/productionDay").VALID_SCAN_SQL);
    whereConditions.push(require("../utils/productionDay").notStaleRowSql("id"));

    if (!isAllTime) {
      // a part belongs to the production day of its first scan (same rule as the Historical Report)
    whereConditions.push(`first_scan_at >= :from AND first_scan_at < :to`);
      replacements.from = from;
      replacements.to = to;
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    const trendsRes = await sequelize.query(`
      SELECT 
        FORMAT(COALESCE(first_scan_at, createdAt), 'yyyy-MM-dd HH:00') as hour,
        COUNT(*) as total,
        SUM(CASE WHEN overall_status IN ('OK', 'PASSED') THEN 1 ELSE 0 END) as ok,
        SUM(CASE WHEN overall_status IN ('NG', 'FAILED') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED') OR op150_status IN ('NG', 'FAIL', 'FAILED') THEN 1 ELSE 0 END) as ng
      FROM [RICO_IOT].[dbo].[ProductionReports]
      ${whereSql}
      GROUP BY FORMAT(COALESCE(first_scan_at, createdAt), 'yyyy-MM-dd HH:00')
      ORDER BY hour ASC
    `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
      console.warn("[DASHBOARD] trends query error:", err.message);
      return [];
    });

    const trends = (trendsRes || []).map((r) => ({
      hour: r.hour,
      displayHour: r.hour ? r.hour.slice(-5) : "",
      total: Number(r.total || 0),
      ok: Number(r.ok || 0),
      ng: Number(r.ng || 0),
      scrapRate: Number(r.total || 0) > 0 ? Number(((Number(r.ng || 0) / Number(r.total || 0)) * 100).toFixed(1)) : 0,
    }));

    res.json(trends);
  } catch (error) {
    console.error("[DASHBOARD] getDashboardTrends error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Machine KPIs report: building a 30-day result reads every scan of the range and takes ~10 s, partly on the Node
// event loop that also serves the scanners. Identical requests within 60 s share one result, and a request that
// arrives while the same report is still being built waits for it instead of building it again.
const DASHBOARD_REPORT_TTL_MS = 60 * 1000;
const dashboardReportCache = new Map(); // key -> { at, status, body } | { pending: Promise }
exports.getDashboardReport = async (req, res) => {
  const q = req.query || {};
  // the page adds _ts / noCache to every request; they must not split the cache. A manual refresh (noCache) still
  // gets a result at most 15 s old.
  const key = JSON.stringify(Object.keys(q).filter((k) => k !== "_ts" && k !== "noCache").sort().map((k) => [k, String(q[k])]));
  const ttl = q.noCache ? 15 * 1000 : DASHBOARD_REPORT_TTL_MS;
  const hit = dashboardReportCache.get(key);
  if (hit && !hit.pending && Date.now() - hit.at < ttl) return res.status(hit.status).json(hit.body);
  if (hit && hit.pending) {
    try {
      const done = await hit.pending;
      return res.status(done.status).json(done.body);
    } catch (err) { void err; /* fall through and build it */ }
  }
  let resolveFn;
  const pending = new Promise((resolve) => { resolveFn = resolve; });
  dashboardReportCache.set(key, { pending });
  const captured = { status: 200, body: null };
  const capture = {
    status(code) { captured.status = code; return capture; },
    json(body) { captured.body = body; return capture; },
  };
  try {
    await getDashboardReportUncached(req, capture);
  } finally {
    resolveFn(captured);
    if (captured.status === 200 && captured.body) {
      dashboardReportCache.set(key, { at: Date.now(), status: captured.status, body: captured.body });
      if (dashboardReportCache.size > 50) dashboardReportCache.delete(dashboardReportCache.keys().next().value);
    } else {
      dashboardReportCache.delete(key);
    }
  }
  return res.status(captured.status).json(captured.body);
};

async function getDashboardReportUncached(req, res) {
  try {
    const { from, to } = getDateRangeFromQuery(req.query);
    const shiftCodeFilter = req.query.shiftCode ? String(req.query.shiftCode).trim().toUpperCase() : null;
    const lineNameFilter = normalizeLineName(req.query.lineName);
    const stationNoFilter = normalizeStation(req.query.stationNo);
    const operatorIdFilter = Number(req.query.operatorId || 0) || null;
    const lightMode = ["1", "true", "yes"].includes(String(req.query.light || "").trim().toLowerCase());
    const page = Math.max(Number(req.query.page || 1), 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize || 100), 1), 500);

    const requestedPartId = String(req.query.partId || "").trim();
    const requestedPartIdValues = requestedPartId ? await resolvePartIdSearchValues(requestedPartId) : [];
    const requestedPartIdCondition = buildPartIdSearchCondition(requestedPartIdValues);
    const machineWhere = {
      is_active: true,
      ...(lineNameFilter ? { line_name: lineNameFilter } : {}),
    };
    const allMachineRowsRaw = await Machine.findAll({
      where: machineWhere,
      attributes: ["id", "machine_name", "line_name", "operation_no", "sequence_no", "daily_target_qty", "cycle_time", "loading_time", "is_active", "machine_number", "updatedAt", "plc_ip", "qr_scanner_ip", "machine_ip"],
      order: [["sequence_no", "ASC"], ["updatedAt", "DESC"]],
      raw: true,
    });
    const machineRows = dedupeMachines(allMachineRowsRaw);
    const machineIdScope = machineRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
    const buildProductionWhere = ({ includeDateRange = true } = {}) => {
      const where = {
        ...(includeDateRange ? { createdAt: { [Op.gte]: from, [Op.lte]: to } } : {}),
        ...(machineIdScope.length ? { machine_id: { [Op.in]: machineIdScope } } : {}),
      };
      if (req.query.machineId) {
        where.machine_id = Number(req.query.machineId);
      }
      if (requestedPartId) {
        where.part_id = requestedPartIdCondition || { [Op.like]: `%${requestedPartId}%` };
      }
      if (req.query.status) {
        where.status = String(req.query.status).toUpperCase();
      }
      return where;
    };
    const buildOperationWhere = ({ includeDateRange = true } = {}) => ({
      ...(includeDateRange ? { createdAt: { [Op.gte]: from, [Op.lte]: to } } : {}),
      ...(machineIdScope.length ? { machine_id: { [Op.in]: machineIdScope } } : {}),
      ...(req.query.machineId ? { machine_id: Number(req.query.machineId) } : {}),
      ...(requestedPartId ? { part_id: requestedPartIdCondition || { [Op.like]: `%${requestedPartId}%` } } : {}),
      ...(stationNoFilter ? { station_no: stationNoFilter } : {}),
      ...(operatorIdFilter ? { user_id: operatorIdFilter } : {}),
    });
    const fetchProductionRows = (where) => ProductionLog.findAll({
      where,
      attributes: ["id", "part_id", "machine_id", "status", "createdAt"],
      raw: true,
    });
    const fetchOperationRows = (where) => OperationLog.findAll({
      where,
      attributes: ["id", "part_id", "machine_id", "station_no", "operation_no", "plc_status", "result", "user_id", "interlock_reason", "plc_start_time", "plc_start_at", "plc_end_time", "plc_end_at", "createdAt"],
      raw: true,
    });

    const [initialProductionRows, initialOperationRows, interlocks, reworkCount, shifts] = await Promise.all([
      fetchProductionRows(buildProductionWhere({ includeDateRange: true })),
      fetchOperationRows(buildOperationWhere({ includeDateRange: true })),
      OperationLog.findAll({
        where: {
          interlock_reason: { [Op.ne]: null },
          createdAt: { [Op.gte]: from, [Op.lte]: to },
          ...(machineIdScope.length ? { machine_id: { [Op.in]: machineIdScope } } : {}),
        },
        order: [["createdAt", "DESC"]],
        limit: 100,
        raw: true,
      }),
      ReworkLog.count({
        where: {
          createdAt: { [Op.gte]: from, [Op.lte]: to },
        },
      }),
      getActiveShiftDefinitions(),
    ]);

    const productionRows = initialProductionRows;
    const operationRows = initialOperationRows;

    const filteredRows = applyShiftFilter(productionRows, shiftCodeFilter, shifts, { from, to });
    const filteredOperationRows = applyShiftFilter(operationRows, shiftCodeFilter, shifts, { from, to });
    const productionOperationRows = filteredOperationRows.filter((row) => !isJourneyNoiseLog(row));
    const filteredInterlocks = applyShiftFilter(interlocks, shiftCodeFilter, shifts, { from, to }).filter(
      (row) => !isJourneyNoiseLog(row)
    );

    const dashboardPartIds = [...new Set(
      productionOperationRows
        .map((row) => String(row.part_id || "").trim())
        .filter(Boolean)
    )];
    const dashboardPartCodeMappings = [];
    for (let index = 0; index < dashboardPartIds.length; index += 1000) {
      const chunk = dashboardPartIds.slice(index, index + 1000);
      if (chunk.length === 0) {
        continue;
      }
      // Two index seeks (old_part_id, customer_qr) instead of one "old IN (…) OR qr IN (…)" query: SQL Server
      // scanned the table for the OR form (~2 s per 1 000 IDs → ~60 s for a 30-day Machine KPIs tab). Same rows:
      // merged, de-duplicated by id and kept newest first.
      const mappingQuery = (column) => PartCodeMapping.findAll({
        where: { [column]: { [Op.in]: chunk }, is_active: true },
        attributes: ["id", "old_part_id", "customer_qr", "updatedAt"],
        raw: true,
      });
      const [byOldPart, byCustomerQr] = await Promise.all([mappingQuery("old_part_id"), mappingQuery("customer_qr")]);
      const chunkRowsById = new Map();
      for (const row of [...byOldPart, ...byCustomerQr]) chunkRowsById.set(row.id, row);
      const chunkRows = [...chunkRowsById.values()]
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      dashboardPartCodeMappings.push(...chunkRows);
    }
    const customerQrByPartId = dashboardPartCodeMappings.reduce((acc, row) => {
      const key = String(row.old_part_id || "").trim().toUpperCase();
      const customerValue = sanitizeCustomerQrValue(row.customer_qr);
      const customerKey = customerValue.toUpperCase();
      if (key && customerValue && !acc[key]) acc[key] = customerValue;
      if (customerKey && customerValue && !acc[customerKey]) acc[customerKey] = customerValue;
      return acc;
    }, {});
    const mappedOldPartByPartId = dashboardPartCodeMappings.reduce((acc, row) => {
      const oldPart = String(row.old_part_id || "").trim();
      const customerQr = sanitizeCustomerQrValue(row.customer_qr);
      const oldKey = oldPart.toUpperCase();
      const customerKey = customerQr.toUpperCase();
      if (oldKey && oldPart && !acc[oldKey]) acc[oldKey] = oldPart;
      if (customerKey && oldPart && !acc[customerKey]) acc[customerKey] = oldPart;
      return acc;
    }, {});
    const getMappedCustomerQrForPart = (partIdValue) =>
      customerQrByPartId[String(partIdValue || "").trim().toUpperCase()] || null;
    const getMappedOldPartForPart = (partIdValue) =>
      mappedOldPartByPartId[String(partIdValue || "").trim().toUpperCase()] || null;
    const getEffectiveProductionStatus = (row) => {
      const mappedCustomerQr = getMappedCustomerQrForPart(row?.part_id);
      const plcStatus = String(row?.plc_status || "").trim().toUpperCase();
      const result = String(row?.result || "").trim().toUpperCase();

      if (shouldTreatRecoveryPendingAsPassed(row, mappedCustomerQr)) {
        return "OK";
      }
      if (plcStatus === "ENDED_OK" && result === "OK") {
        return "OK";
      }
      if (plcStatus === "ENDED_NG" || result === "NG") {
        return "NG";
      }
      return null;
    };
    const effectiveProductionRows = (() => {
      const mergedRows = filteredRows.map((row) => ({
        ...row,
        status: String(row.status || "").trim().toUpperCase(),
      }));
      const existingKeys = new Set(
        mergedRows.map((row) => `${Number(row.machine_id || 0)}|${String(row.part_id || "").trim().toUpperCase()}`)
      );
      const addedKeys = new Set();

      for (const row of productionOperationRows) {
        const machineId = Number(row.machine_id || 0);
        const partId = String(row.part_id || "").trim();
        const status = getEffectiveProductionStatus(row);
        if (!Number.isFinite(machineId) || machineId <= 0 || !partId || !status) {
          continue;
        }
        const dedupeKey = `${machineId}|${partId.toUpperCase()}`;
        if (existingKeys.has(dedupeKey) || addedKeys.has(dedupeKey)) {
          continue;
        }
        mergedRows.push({
          id: `operation-${row.id}`,
          part_id: partId,
          machine_id: machineId,
          status,
          createdAt: row.plc_end_time || row.plc_end_at || row.createdAt,
        });
        addedKeys.add(dedupeKey);
      }

      return mergedRows;
    })();

    const machineWiseMap = effectiveProductionRows.reduce((acc, row) => {
      if (!acc[row.machine_id]) {
        acc[row.machine_id] = { machine_id: row.machine_id, ok: 0, ng: 0 };
      }
      if (row.status === "OK") {
        acc[row.machine_id].ok += 1;
      } else {
        acc[row.machine_id].ng += 1;
      }
      return acc;
    }, {});
    const machineWise = Object.values(machineWiseMap);

    const machineRowMapById = machineRows.reduce((acc, machine) => {
      acc[machine.id] = machine;
      return acc;
    }, {});
    const machineMetaById = machineRows.reduce((acc, machine) => {
      acc[machine.id] = {
        machineId: machine.id,
        machineName: machine.machine_name,
        lineName: machine.line_name,
        stationNo: normalizeStation(machine.operation_no),
        sequenceNo: Number(machine.sequence_no || 0),
        isActive: Boolean(machine.is_active),
        targetQty: Number(machine.daily_target_qty || 0),
        cycleTime: Number(machine.cycle_time || 0),
        loadingTime: Number(machine.loading_time || 0),
      };
      return acc;
    }, {});

    const machineCardMap = {};
    for (const machine of machineRows) {
      machineCardMap[machine.id] = {
        ...(machineMetaById[machine.id] || {}),
        okCount: 0,
        ngCount: 0,
        interlockedCount: 0,
        commErrorCount: 0,
        inProgressCount: 0,
      };
    }

    for (const row of productionOperationRows) {
      const machineId = Number(row.machine_id || 0);
      if (!Number.isFinite(machineId) || machineId <= 0) {
        continue;
      }
      if (!machineCardMap[machineId]) {
        machineCardMap[machineId] = {
          machineId,
          machineName: `Machine ${machineId}`,
          lineName: "-",
          stationNo: normalizeStation(row.station_no || row.operation_no),
          sequenceNo: 9999,
          isActive: true,
          targetQty: 0,
          okCount: 0,
          ngCount: 0,
          interlockedCount: 0,
          commErrorCount: 0,
          inProgressCount: 0,
        };
      }

      const plcStatus = String(row.plc_status || "").trim().toUpperCase();
      const effectiveStatus = getEffectiveProductionStatus(row);

      if (effectiveStatus === "OK") {
        machineCardMap[machineId].okCount += 1;
      } else if (effectiveStatus === "NG") {
        machineCardMap[machineId].ngCount += 1;
      } else if (plcStatus === "INTERLOCKED" || plcStatus === "BLOCKED") {
        machineCardMap[machineId].interlockedCount += 1;
      } else if (plcStatus === "PLC_COMM_ERROR") {
        machineCardMap[machineId].commErrorCount += 1;
      } else if (["PENDING", "STARTED", "RUNNING", "IN_PROGRESS", "START_SENT", "WAITING_RUNNING", "WAITING_END"].includes(plcStatus)) {
        machineCardMap[machineId].inProgressCount += 1;
      }
    }

    const logsByMachineId = productionOperationRows.reduce((acc, row) => {
      const id = Number(row.machine_id || 0);
      if (!id) return acc;
      if (!acc[id]) acc[id] = [];
      acc[id].push(row);
      return acc;
    }, {});

    const machineHealthEntries = await Promise.all(machineRows.map(async (machine) => {
      const plcHealth = getPlcHealthSnapshot(machine.id) || null;
      const scannerBundle = await buildMachineScannerBundle(machine.id);
      return [
        Number(machine.id),
        {
          plcConnected: plcHealth ? Boolean(plcHealth.healthy) : null,
          plcHealth,
          scannerConnected: scannerBundle.primaryHealth ? Boolean(scannerBundle.primaryHealth.connected) : null,
          scannerHealth: scannerBundle.primaryHealth || null,
          scanner: scannerBundle.primaryScanner || null,
        },
      ];
    }));
    const machineHealthById = Object.fromEntries(machineHealthEntries);

    // OK / NG per machine by the reports' rule (Historical gate view, Operator page): each part's latest OK / NG scan
    // at the machine in the window (BLOCK and other non-decisive rows ignored, shift of that scan); leak testers from
    // their own leak results. The per-row tally above counted every scan row and put all OP150 bypass rows on the
    // first leak tester.
    if (!requestedPartId && !operatorIdFilter && !req.query.status) {
      try {
        const decisive = await machineDecisiveCounts(machineRows, { from, to }, shiftCodeFilter, shifts);
        for (const [id, c] of decisive) {
          if (!machineCardMap[id]) continue;
          machineCardMap[id].okCount = c.ok;
          machineCardMap[id].ngCount = c.ng;
        }
      } catch (err) {
        console.warn("[DASHBOARD_REPORT] decisive machine counts failed, using scan tally:", err.message);
      }
    }

    const machineCards = Object.values(machineCardMap)
      .map((row) => {
        const machineLogs = (logsByMachineId[Number(row.machineId)] || []).slice().sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        const health = machineHealthById[Number(row.machineId)] || {};
        const processedCount = Number(row.okCount || 0) + Number(row.ngCount || 0);
        const downtime = computeDowntimeFromLogs(machineLogs);
        const downtimeEvents = Number(downtime.downtimeEvents || 0);
        const downtimeMinutes = Number(downtime.downtimeMinutes || 0);
        const plannedProductionSeconds = Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000));
        const plannedProductionMinutes = Math.max(0, Math.round(plannedProductionSeconds / 60));
        const runtimeSeconds = Math.max(0, Math.floor((machineLogs.length > 0 ? (new Date(to).getTime() - new Date(from).getTime()) : 0) / 1000) - downtimeMinutes * 60);
        const qualityBase = processedCount > 0 ? processedCount : 0;
        const downtimeBase = processedCount + downtimeEvents;
        const downtimeEventRatio = downtimeBase > 0 ? Number(((downtimeEvents / downtimeBase) * 100).toFixed(2)) : 0;
        const downtimeTimePct = plannedProductionMinutes > 0 ? Number(((downtimeMinutes / plannedProductionMinutes) * 100).toFixed(2)) : 0;
        const shiftForTarget = shiftCodeFilter
          ? shifts.find((s) => normalizeShiftAlias(s.shift_code || s.shift_name) === normalizeShiftAlias(shiftCodeFilter)) || null
          : null;
        const idealCycleTimeSeconds = getEffectiveCycleTimeSeconds(row);
        const rangeDays = Math.max(1, Math.ceil(plannedProductionSeconds / (24 * 3600)));
        const targetWindowSeconds = shiftForTarget
          ? getShiftDurationSeconds(shiftForTarget) * rangeDays
          : plannedProductionSeconds;
        const targetQty = idealCycleTimeSeconds > 0
          ? Math.floor(Math.max(0, targetWindowSeconds) / idealCycleTimeSeconds)
          : computeTargetProduction({ machine: row, shift: shiftForTarget || resolveShift(from, shifts) || shifts[0] || null });
        const calc = computeOeeAndOa({
          totalCount: processedCount,
          goodCount: Number(row.okCount || 0),
          runtimeSeconds,
          plannedProductionSeconds,
          idealCycleTimeSeconds,
          downtimeSeconds: downtimeMinutes * 60,
        });
        const shiftResolved = resolveShift(machineLogs[0]?.createdAt || from, shifts);
        const productionDate = getProductionDate(machineLogs[0]?.createdAt || from, shifts);
        return {
          ...row,
          plcConnected: health.plcConnected ?? null,
          plcHealth: health.plcHealth || null,
          scannerConnected: health.scannerConnected ?? null,
          scannerHealth: health.scannerHealth || null,
          scanner: health.scanner || null,
          targetProduction: targetQty,
          actualProduction: processedCount,
          processedCount,
          downtimeEvents,
          downtimeMinutes,
          plannedProductionMinutes,
          accuracy: qualityBase > 0 ? Number(((Number(row.okCount || 0) / qualityBase) * 100).toFixed(2)) : 0,
          downtimeRate: downtimeEventRatio,
          downtimeEventRatio,
          downtimeTimePct,
          achievementPct:
            targetQty > 0 ? Number(((processedCount / targetQty) * 100).toFixed(2)) : null,
          targetGap: targetQty > 0 ? Math.max(targetQty - processedCount, 0) : null,
          oee: calc.oeePct,
          oa: calc.oaPct,
          availability: calc.availabilityPct,
          performance: calc.performancePct,
          quality: calc.qualityPct,
          productionDate: productionDate ? productionDate.toISOString().slice(0, 10) : null,
          shiftCode: shiftResolved?.shift_code || "UNASSIGNED",
        };
      })
      .filter((row) => !req.query.machineId || Number(row.machineId) === Number(req.query.machineId))
      .sort((a, b) => {
        if (a.sequenceNo === b.sequenceNo) {
          return String(a.machineName || "").localeCompare(String(b.machineName || ""));
        }
        return Number(a.sequenceNo || 0) - Number(b.sequenceNo || 0);
      });

    const stationCardMap = machineCards.reduce((acc, card) => {
      const stationNo = normalizeStation(card.stationNo || "UNASSIGNED");
      if (!acc[stationNo]) {
        acc[stationNo] = {
          stationNo,
          lineNames: new Set(),
          machineCount: 0,
          targetQty: 0,
          processedCount: 0,
          okCount: 0,
          ngCount: 0,
          downtimeEvents: 0,
          downtimeMinutes: 0,
          plannedProductionMinutes: 0,
        };
      }
      acc[stationNo].lineNames.add(String(card.lineName || "-"));
      acc[stationNo].machineCount += 1;
      acc[stationNo].targetQty += Number(card.targetProduction ?? card.targetQty ?? 0);
      acc[stationNo].processedCount += Number(card.processedCount || 0);
      acc[stationNo].okCount += Number(card.okCount || 0);
      acc[stationNo].ngCount += Number(card.ngCount || 0);
      acc[stationNo].downtimeEvents += Number(card.downtimeEvents || 0);
      acc[stationNo].downtimeMinutes += Number(card.downtimeMinutes || 0);
      acc[stationNo].plannedProductionMinutes += Number(card.plannedProductionMinutes || 0);
      return acc;
    }, {});

    const stationCards = Object.values(stationCardMap)
      .map((row) => {
        const processedBase = Number(row.processedCount || 0);
        const downtimeBase = processedBase + Number(row.downtimeEvents || 0);
        const downtimeEventRatio = downtimeBase > 0 ? Number(((Number(row.downtimeEvents || 0) / downtimeBase) * 100).toFixed(2)) : 0;
        const downtimeTimePct = Number(row.plannedProductionMinutes || 0) > 0
          ? Number(((Number(row.downtimeMinutes || 0) / Number(row.plannedProductionMinutes || 0)) * 100).toFixed(2))
          : 0;
        return {
          ...row,
          lineNames: Array.from(row.lineNames).sort((a, b) => a.localeCompare(b)),
          accuracy: processedBase > 0 ? Number(((Number(row.okCount || 0) / processedBase) * 100).toFixed(2)) : 0,
          downtimeRate: downtimeEventRatio,
          downtimeEventRatio,
          downtimeTimePct,
          achievementPct:
            Number(row.targetQty || 0) > 0
              ? Number(((Number(row.processedCount || 0) / Number(row.targetQty || 0)) * 100).toFixed(2))
              : null,
        };
      })
      .sort((a, b) => String(a.stationNo || "").localeCompare(String(b.stationNo || "")));

    const hourlyMap = effectiveProductionRows.reduce((acc, row) => {
      const key = formatHourBucket(row.createdAt);
      if (!acc[key]) {
        acc[key] = { hour: key, ok: 0, ng: 0, total: 0 };
      }
      if (String(row.status || "").toUpperCase() === "OK") {
        acc[key].ok += 1;
      } else {
        acc[key].ng += 1;
      }
      acc[key].total += 1;
      return acc;
    }, {});
    const hourly = Object.values(hourlyMap).sort((a, b) => String(a.hour).localeCompare(String(b.hour)));

    const shiftProduction = shifts.reduce((acc, shift) => {
      acc[shift.shift_code] = { total: 0, ok: 0, ng: 0 };
      return acc;
    }, {});
    shiftProduction.UNASSIGNED = { total: 0, ok: 0, ng: 0 };

    for (const row of effectiveProductionRows) {
      const shiftCode = resolveShiftCodeForDate(row.createdAt, shifts);
      if (!shiftProduction[shiftCode]) {
        shiftProduction[shiftCode] = { total: 0, ok: 0, ng: 0 };
      }
      shiftProduction[shiftCode].total += 1;
      if (row.status === "OK") {
        shiftProduction[shiftCode].ok += 1;
      } else {
        shiftProduction[shiftCode].ng += 1;
      }
    }

    const partHistory = [...productionOperationRows]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Enrich dashboard parts list with latest PLC cycle readings from PlcCycleReadings table.
    // Lookup priority: shot_number from operation logs.
    const plcReadingByShot = new Map();
    const plcReadingByUid = new Map();
    const plcReadingByCompactQr = new Map();
    const plcReadingColumns = [];
    try {
      if (lightMode) {
        throw new Error("LIGHT_MODE_SKIP_PLC_READING_JOIN");
      }
      const sequelize = require("../config/db");
      const [columnRows] = await sequelize.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'PlcCycleReadings'
        ORDER BY ORDINAL_POSITION
      `);
      for (const c of columnRows || []) {
        const name = String(c.COLUMN_NAME || "").trim();
        if (name) plcReadingColumns.push(name);
      }
      const normalizeShotToken = (value) => {
        const raw = String(value ?? "").trim();
        if (!raw || raw.toUpperCase() === "NULL") return "";
        const digits = raw.replace(/\D/g, "");
        if (!digits) return raw.toUpperCase();
        const noLead = digits.replace(/^0+/, "");
        return (noLead || "0").toUpperCase();
      };
      const extractShotCandidatesFromPartId = (value) => {
        const s = String(value || "").toUpperCase().trim();
        if (!s) return [];
        const candidates = new Set();
        const allDigitGroups = s.match(/\d+/g) || [];
        for (const g of allDigitGroups) {
          const norm = normalizeShotToken(g);
          if (norm) candidates.add(norm);
        }
        // Common format: YYMMDDHHMMSS + shot
        const tsShot = s.match(/(\d{12})(\d{1,8})$/);
        if (tsShot?.[2]) {
          const norm = normalizeShotToken(tsShot[2]);
          if (norm) candidates.add(norm);
        }
        return [...candidates];
      };
      const parseCompactQrPartId = (value) => {
        const raw = String(value || "").trim();
        const match = raw.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machine_code>[A-Z0-9]{1})(?<shot>\d{1,6})$/i);
        if (!match?.groups) return null;
        const month = Number(match.groups.month);
        const day = Number(match.groups.day);
        const hour = Number(match.groups.hour);
        const minute = Number(match.groups.minute);
        const shot = Number(match.groups.shot);
        if (![day, month, hour, minute, shot].every(Number.isFinite)) return null;
        return { key: `${month}|${day}|${hour}|${minute}|${shot}`, day, month, hour, minute, shot, shotRaw: String(match.groups.shot || "").trim() };
      };
      const shotValuesSet = new Set();
      const compactValuesMap = new Map();
      for (const row of partHistory) {
        const directShot = normalizeShotToken(row.shot_number || row.shotNumber || "");
        if (directShot) shotValuesSet.add(directShot);
        const fromPart = extractShotCandidatesFromPartId(row.part_id);
        for (const c of fromPart) shotValuesSet.add(c);
        const compact = parseCompactQrPartId(row.part_id);
        if (compact && !compactValuesMap.has(compact.key)) {
          compactValuesMap.set(compact.key, compact);
        }
      }
      for (const compact of compactValuesMap.values()) {
        const [rows] = await sequelize.query(`
          SELECT TOP 1 * FROM PlcCycleReadings
          WHERE TRY_CONVERT(INT, shot_day) = :day
            AND TRY_CONVERT(INT, shot_month) = :month
            AND TRY_CONVERT(INT, shot_hour) = :hour
            AND TRY_CONVERT(INT, shot_minute) = :minute
            AND (
              TRY_CONVERT(INT, shot_number) = :shot
              OR LTRIM(RTRIM(CAST(shot_number AS NVARCHAR(255)))) = :shotRaw
            )
          ORDER BY recorded_at DESC
        `, {
          replacements: {
            day: compact.day,
            month: compact.month,
            hour: compact.hour,
            minute: compact.minute,
            shot: compact.shot,
            shotRaw: compact.shotRaw,
          },
        });
        if (rows && rows[0]) {
          plcReadingByCompactQr.set(compact.key, rows[0]);
        }
      }
      const shotValues = [...shotValuesSet];
      if (shotValues.length > 0) {
        const placeholders = shotValues.map((_, idx) => `:s${idx}`).join(", ");
        const replacements = shotValues.reduce((acc, value, idx) => {
          acc[`s${idx}`] = value;
          return acc;
        }, {});
        const [plcRows] = await sequelize.query(`
          SELECT * FROM PlcCycleReadings
          WHERE CAST(shot_number AS NVARCHAR(255)) IN (${placeholders})
          ORDER BY recorded_at DESC
        `, { replacements });

        for (const row of plcRows || []) {
          const key = normalizeShotToken(row.shot_number || "");
          if (!key || plcReadingByShot.has(key)) continue;
          plcReadingByShot.set(key, row);
        }
        for (const row of plcRows || []) {
          const uidKey = String(row.shot_uid || "").trim();
          if (!uidKey || plcReadingByUid.has(uidKey)) continue;
          plcReadingByUid.set(uidKey, row);
        }
      }
    } catch (_plcJoinError) {
      // Keep dashboard report resilient even when PlcCycleReadings schema/table differs.
    }
    const partIdsHistory = [...new Set(partHistory.map((r) => String(r.part_id || "").trim()).filter(Boolean))];
    const leakRowsHistory = !lightMode && partIdsHistory.length > 0
      ? await LeakTestReading.findAll({
        where: { part_id: partIdsHistory },
        attributes: ["part_id", "payload_json", "createdAt"],
        order: [["createdAt", "DESC"]],
        raw: true,
      })
      : [];
    const leakByPartHistory = leakRowsHistory.reduce((acc, row) => {
      const key = String(row.part_id || "").trim();
      if (!key || acc[key]) return acc;
      try {
        acc[key] = row.payload_json ? JSON.parse(row.payload_json) : null;
      } catch (_e) {
        acc[key] = null;
      }
      return acc;
    }, {});

    const partIdsForCustomerQr = [...new Set(partHistory.slice(0, 3000).map((row) => String(row.part_id || "").trim()).filter(Boolean))];
    const leaktestIndex = await buildLeaktestIndex({
        partIds: partIdsForCustomerQr,
        customerQrByPartId,
        machines: machineRows,
      });
    const getLeakReadingForPart = (partIdValue) => getLeaktestReadingForPartStation(
      leaktestIndex.byPartAndStation,
      String(partIdValue || "").trim(),
      LEAKTEST_OPERATION
    );
    
    const getAllLeakReadingsForPart = (partIdValue) => getAllLeaktestReadingsForPart(
      leaktestIndex.byPartAndIp,
      String(partIdValue || "").trim(),
      LEAKTEST_OPERATION
    );
    const mapDashboardRowWithLeak = (row) => {
      const stationNo = normalizeStation(row.station_no || row.operation_no);
      const leakTestReading = getLeakReadingForPart(row.part_id);
      const leakTestReadings = getAllLeakReadingsForPart(row.part_id);
      if (stationNo === LEAKTEST_OPERATION && leakTestReading) {
        const leakResult = String(leakTestReading.result || leakTestReading.Result || "").trim().toUpperCase();
        return {
          ...row,
          result: leakResult || row.result,
          plc_status: leakResult === "OK" ? "ENDED_OK" : leakResult === "NG" ? "ENDED_NG" : row.plc_status,
          interlock_reason: null,
          leakTestReading,
          leakTestReadings,
        };
      }
      return {
        ...row,
        leakTestReading,
        leakTestReadings,
      };
    };

    const historyTotal = partHistory.length;
    const historyStart = (page - 1) * pageSize;
    const pagedHistory = partHistory
      .slice(historyStart, historyStart + pageSize)
      .map(mapDashboardRowWithLeak);

    const normalizeShotToken = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw || raw.toUpperCase() === "NULL") return "";
      const digits = raw.replace(/\D/g, "");
      if (!digits) return raw.toUpperCase();
      const noLead = digits.replace(/^0+/, "");
      return (noLead || "0").toUpperCase();
    };
    const getCompactQrCandidates = (value) => {
      const raw = String(value || "").trim();
      const match = raw.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machine_code>[A-Z0-9]{1})(?<shot>\d{1,6})$/i);
      if (!match?.groups) return [];
      const month = Number(match.groups.month);
      const day = Number(match.groups.day);
      const hour = Number(match.groups.hour);
      const minute = Number(match.groups.minute);
      const shot = Number(match.groups.shot);
      if (![day, month, hour, minute, shot].every(Number.isFinite)) return [];
      return [{ key: `${month}|${day}|${hour}|${minute}|${shot}`, day, month, hour, minute, shot }];
    };
    const parseCompactQrPartId = (value) => {
      return getCompactQrCandidates(value)[0] || null;
    };
    const extractYymmddhhmmss = (value) => {
      const s = String(value || "").toUpperCase();
      const m = s.match(/(\d{12})/);
      return m ? m[1] : "";
    };
    const extractShotSuffix = (value) => {
      const s = String(value || "").toUpperCase().replace(/\s+/g, "");
      // New compact QR format: MMDDHHMM + MACHINE_ID(1) + SHOT(1..6)
      // Ignore machine id while resolving shot for PlcCycleReadings lookup.
      const compact = s.match(/^(\d{8})([A-Z0-9])(\d{1,6})$/);
      if (compact?.[3]) return compact[3];
      const m = s.match(/(\d{12})(\d+)$/);
      return m ? m[2] : "";
    };
    const enrichPlcReadingDisplay = (row) => {
      if (!row || typeof row !== "object") return row;
      const next = { ...row };
      const y = normalizeReportYear(next.shot_year);
      const m = Number(next.shot_month);
      const d = Number(next.shot_day);
      const hh = Number(next.shot_hour);
      const mm = Number(next.shot_minute);
      const ss = Number(next.shot_second);
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        next.shot_date = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
      if (Number.isFinite(hh) && Number.isFinite(mm) && Number.isFinite(ss)) {
        next.shot_time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      }
      const shotStatus = Number(next.shot_status);
      if (shotStatus === 1) next.shot_status_text = "OK";
      else if (shotStatus === 3) next.shot_status_text = "WARM_UP_SHOT";
      else if (shotStatus === 5) next.shot_status_text = "OFFSET_SHOT";
      return next;
    };

    const partIdsForLeak = [...new Set(partHistory.slice(0, 3000).map((r) => String(r.part_id || "").trim()).filter(Boolean))];
    const leakRows = !lightMode && partIdsForLeak.length > 0
      ? await LeakTestReading.findAll({
        where: { part_id: partIdsForLeak },
        attributes: ["part_id", "payload_json", "createdAt"],
        order: [["createdAt", "DESC"]],
        raw: true,
      })
      : [];
    const leakByPart = leakRows.reduce((acc, row) => {
      const key = String(row.part_id || "").trim();
      if (!key || acc[key]) return acc;
      try {
        acc[key] = row.payload_json ? JSON.parse(row.payload_json) : null;
      } catch (_e) {
        acc[key] = null;
      }
      return acc;
    }, {});

    const partsList = partHistory.slice(0, 3000).map((row) => {
      const machine = machineMetaById[Number(row.machine_id)] || machineRowMapById[Number(row.machine_id)] || {};
      const mappedCustomerQr = customerQrByPartId[String(row.part_id || "").trim().toUpperCase()] || null;
      const plcStatus = String(row.plc_status || "").trim().toUpperCase();
      const result = String(row.result || "").trim().toUpperCase();
      const stationNo = normalizeStation(row.station_no || row.operation_no);
      const leakTestReading = getLeakReadingForPart(row.part_id);
      const leakTestReadings = getAllLeakReadingsForPart(row.part_id);
      const leakStageState = stationNo === LEAKTEST_OPERATION && (leakTestReadings.length > 0 || leakTestReading)
        ? getLeaktestStageStateFromReadings(leakTestReadings.length > 0 ? leakTestReadings : [leakTestReading])
        : null;
      const recoveryCompletedByCustomerQr = shouldTreatRecoveryPendingAsPassed(row, mappedCustomerQr);
      let statusLabel = "IDLE";
      if (stationNo === LEAKTEST_OPERATION && leakStageState === "PASSED") {
        statusLabel = "PASSED";
      } else if (stationNo === LEAKTEST_OPERATION && leakStageState === "FAILED") {
        statusLabel = "FAILED";
      } else if (stationNo === LEAKTEST_OPERATION && leakStageState === "PENDING") {
        statusLabel = "RUNNING";
      } else if (recoveryCompletedByCustomerQr) {
        statusLabel = "PASSED";
      } else if (plcStatus === "INTERLOCKED" || plcStatus === "PLC_COMM_ERROR") {
        statusLabel = "BLOCKED";
      } else if (["ENDED_OK", "COMPLETED_OK", "PASSED"].includes(plcStatus) && ["OK", "PASS", "PASSED"].includes(result || "OK")) {
        statusLabel = "PASSED";
      } else if (["ENDED_NG", "COMPLETED_NG", "FAILED"].includes(plcStatus) || ["NG", "FAIL", "FAILED"].includes(result)) {
        statusLabel = "FAILED";
      } else if (["STARTED", "PENDING", "IN_PROGRESS"].includes(plcStatus)) {
        statusLabel = "RUNNING";
      }

      const start = row.plc_start_time || row.plc_start_at || row.createdAt;
      const end = row.plc_end_time || row.plc_end_at || null;
      let cycleTime = null;
      if (start && end) {
        cycleTime = Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000).toFixed(1);
      }
      if (stationNo === LEAKTEST_OPERATION && leakTestReading?.cycleTime != null) {
        cycleTime = leakTestReading.cycleTime;
      }

      const mappedOldPart = getMappedOldPartForPart(row.part_id);
      const isCustomerQrOnlyRow = Boolean(
        mappedOldPart &&
        mappedCustomerQr &&
        String(mappedOldPart).trim().toUpperCase() === String(mappedCustomerQr).trim().toUpperCase()
      );
      const displayPartId = isCustomerQrOnlyRow ? "" : (mappedOldPart || String(row.part_id || "").trim());
      const shotSourcePartId = displayPartId || String(row.part_id || "").trim();
      const shotKey = normalizeShotToken(row.shot_number || row.shotNumber || "") || normalizeShotToken(extractShotSuffix(shotSourcePartId));
      const fullPartId = String(row.part_id || "").trim();
      const compactQrKey = parseCompactQrPartId(shotSourcePartId)?.key || parseCompactQrPartId(fullPartId)?.key || "";
      const fromPartIdTs = extractYymmddhhmmss(shotSourcePartId) || extractYymmddhhmmss(fullPartId);
      const fromPartIdShot = normalizeShotToken(extractShotSuffix(shotSourcePartId)) || normalizeShotToken(extractShotSuffix(fullPartId));
      const allPartDigitGroups = (shotSourcePartId.match(/\d+/g) || fullPartId.match(/\d+/g) || []).map((g) => normalizeShotToken(g)).filter(Boolean);
      const plcReadingRaw = compactQrKey
        ? (plcReadingByCompactQr.get(compactQrKey) || null)
        : (
          (fullPartId && plcReadingByUid.get(fullPartId))
          || (shotKey && plcReadingByShot.get(shotKey))
          || (fromPartIdShot && plcReadingByShot.get(fromPartIdShot))
          || (fromPartIdTs && plcReadingByShot.get(normalizeShotToken(fromPartIdTs)))
          || allPartDigitGroups.map((g) => plcReadingByShot.get(g)).find(Boolean)
          || null
        );
      const plcReading = enrichPlcReadingDisplay(plcReadingRaw);

      return {
        id: row.id,
        partId: displayPartId,
        traceabilityPartId: row.part_id,
        customerQrCode: mappedCustomerQr,
        partName: row.Part?.part_name || row.Part?.name || null,
        machineId: row.machine_id,
        machineName: machine.machineName || machine.machine_name || null,
        lineName: machine.lineName || machine.line_name || null,
        stationNo,
        operationNo: row.operation_no || null,
        result: stationNo === LEAKTEST_OPERATION && leakTestReading?.result ? leakTestReading.result : result,
        status: statusLabel,
        reason: (recoveryCompletedByCustomerQr || stationNo === LEAKTEST_OPERATION) ? null : (row.interlock_reason || null),
        interlockReason: (recoveryCompletedByCustomerQr || stationNo === LEAKTEST_OPERATION) ? null : (row.interlock_reason || null),
        cycleTime,
        createdAt: row.createdAt,
        shotNumber: shotKey || null,
        plcReading,
        leakTestReading,
        leakTestReadings,
      };
    });

    const requiredOperations = uniqueStages(
      machineRows
        .map((machine) => normalizeStation(machine.operation_no))
        .filter(Boolean)
    );
    const requiredTraceabilityOperations = uniqueStages(
      machineRows
        .filter((machine) => !isLeaktestMachine(machine))
        .map((machine) => normalizeStation(machine.operation_no))
        .filter(Boolean)
        .concat(machineRows.some((machine) => isLeaktestMachine(machine)) ? [LEAKTEST_OPERATION] : [])
    );
    const traceabilityGroupMap = new Map();
    for (const row of partHistory) {
      const rawPartId = String(row.part_id || "").trim();
      const mappedOldPart = getMappedOldPartForPart(rawPartId);
      const mappedCustomerQr = getMappedCustomerQrForPart(rawPartId);
      const groupKey = String(mappedOldPart || rawPartId || mappedCustomerQr || "").trim().toUpperCase();
      if (!groupKey) continue;
      if (!traceabilityGroupMap.has(groupKey)) {
        traceabilityGroupMap.set(groupKey, {
          latest: row,
          latestTs: new Date(row.createdAt || 0).getTime() || 0,
          operations: new Map(),
          blocked: false,
        });
      }
      const group = traceabilityGroupMap.get(groupKey);
      const rowTs = new Date(row.createdAt || 0).getTime() || 0;
      if (rowTs >= group.latestTs) {
        group.latest = row;
        group.latestTs = rowTs;
      }

      const station = normalizeStation(row.station_no || row.operation_no);
      const mappedQr = mappedCustomerQr || getMappedCustomerQrForPart(row.part_id);
      const leakReadings = station === LEAKTEST_OPERATION ? getAllLeakReadingsForPart(row.part_id) : [];
      const leakStageState = station === LEAKTEST_OPERATION && leakReadings.length > 0
        ? getLeaktestStageStateFromReadings(leakReadings)
        : null;
      const plcStatus = String(row.plc_status || "").trim().toUpperCase();
      const result = String(row.result || "").trim().toUpperCase();
      let normalized = "IN_PROGRESS";
      if (leakStageState === "PASSED") {
        normalized = "OK";
      } else if (leakStageState === "FAILED") {
        normalized = "NG";
      } else if (shouldTreatRecoveryPendingAsPassed(row, mappedQr)) {
        normalized = "OK";
      } else if (plcStatus === "ENDED_NG" || result === "NG") {
        normalized = "NG";
      } else if (plcStatus === "ENDED_OK" || result === "OK") {
        normalized = "OK";
      } else if (["INTERLOCKED", "BLOCKED", "PLC_COMM_ERROR"].includes(plcStatus)) {
        group.blocked = true;
      }
      if (station) {
        const current = group.operations.get(station);
        const priority = normalized === "NG" ? 3 : normalized === "OK" ? 2 : 1;
        const currentPriority = current === "NG" ? 3 : current === "OK" ? 2 : 1;
        if (!current || priority >= currentPriority) {
          group.operations.set(station, normalized);
        }
      }

      const allLeakReadings = getAllLeakReadingsForPart(row.part_id);
      if (allLeakReadings.length > 0) {
        const aggregateLeakState = getLeaktestStageStateFromReadings(allLeakReadings);
        const aggregateLeakStatus = aggregateLeakState === "FAILED"
          ? "NG"
          : aggregateLeakState === "PASSED"
            ? "OK"
            : "IN_PROGRESS";
        // the latest leak test decides OP150 (a retest OK overrides an earlier NG); pending keeps what is there
        if (aggregateLeakStatus !== "IN_PROGRESS" || !group.operations.get(LEAKTEST_OPERATION)) {
          group.operations.set(LEAKTEST_OPERATION, aggregateLeakStatus);
        }
      }
    }

    const traceabilityCounts = { total: 0, passed: 0, failed: 0, blocked: 0, inProgress: 0 };
    const traceabilityShiftProduction = shifts.reduce((acc, shift) => {
      acc[shift.shift_code] = { total: 0, ok: 0, ng: 0, inProgress: 0 };
      return acc;
    }, {});
    traceabilityShiftProduction.UNASSIGNED = { total: 0, ok: 0, ng: 0, inProgress: 0 };
    for (const group of traceabilityGroupMap.values()) {
      traceabilityCounts.total += 1;
      const values = requiredTraceabilityOperations.map((operation) => group.operations.get(operation)).filter(Boolean);
      const latestPartStatus = String(group.latest?.status || "").trim().toUpperCase();
      const hasFinalInspectionOk = requiredTraceabilityOperations.some((operation) => (
        (operation === "OP160" || operation.includes("FINAL")) &&
        group.operations.get(operation) === "OK"
      ));
      const shiftCode = resolveShiftCodeForDate(group.latest?.createdAt || group.latestTs || from, shifts);
      if (!traceabilityShiftProduction[shiftCode]) {
        traceabilityShiftProduction[shiftCode] = { total: 0, ok: 0, ng: 0, inProgress: 0 };
      }
      traceabilityShiftProduction[shiftCode].total += 1;
      if (values.some((value) => value === "NG") || ["NG", "FAILED", "INTERLOCKED"].includes(latestPartStatus)) {
        traceabilityCounts.failed += 1;
        traceabilityShiftProduction[shiftCode].ng += 1;
      } else if (group.blocked) {
        traceabilityCounts.blocked += 1;
        traceabilityShiftProduction[shiftCode].inProgress += 1;
      } else if (hasFinalInspectionOk || ["PASSED", "COMPLETED"].includes(latestPartStatus)) {
        traceabilityCounts.passed += 1;
        traceabilityShiftProduction[shiftCode].ok += 1;
      } else {
        traceabilityCounts.inProgress += 1;
        traceabilityShiftProduction[shiftCode].inProgress += 1;
      }
    }

    const availableLines = uniqueStages(machineRows.map((row) => String(row.line_name || "").trim()).filter(Boolean));

    const machineMetricsById = machineCards.reduce((acc, row) => {
      acc[String(row.machineId)] = row;
      return acc;
    }, {});

    const shiftWiseMetricsMap = {};
    const dayWiseMetricsMap = {};
    const stationWiseMetricsMap = {};

    for (const row of productionOperationRows) {
      const machineId = String(row.machine_id || "");
      if (!machineId) continue;
      const m = machineMetricsById[machineId];
      if (!m) continue;

      const shiftObj = resolveShift(row.createdAt, shifts);
      const shiftCode = shiftObj?.shift_code || "UNASSIGNED";
      const prodDate = getProductionDate(row.createdAt, shifts)?.toISOString().slice(0, 10) || null;
      const stationNo = normalizeStation(row.station_no || row.operation_no || m.stationNo || "UNASSIGNED");

      const shiftKey = `${prodDate || "NA"}|${shiftCode}`;
      if (!shiftWiseMetricsMap[shiftKey]) {
        shiftWiseMetricsMap[shiftKey] = {
          productionDate: prodDate,
          shiftCode,
          targetProduction: 0,
          actualProduction: 0,
          downtimeMinutes: 0,
          downtimeEvents: 0,
          plannedProductionMinutes: 0,
          machines: new Set(),
        };
      }
      shiftWiseMetricsMap[shiftKey].machines.add(machineId);

      if (!dayWiseMetricsMap[prodDate || "NA"]) {
        dayWiseMetricsMap[prodDate || "NA"] = {
          productionDate: prodDate,
          targetProduction: 0,
          actualProduction: 0,
          downtimeMinutes: 0,
          downtimeEvents: 0,
          plannedProductionMinutes: 0,
          machines: new Set(),
        };
      }
      dayWiseMetricsMap[prodDate || "NA"].machines.add(machineId);

      if (!stationWiseMetricsMap[stationNo]) {
        stationWiseMetricsMap[stationNo] = {
          stationNo,
          targetProduction: 0,
          actualProduction: 0,
          downtimeMinutes: 0,
          downtimeEvents: 0,
          plannedProductionMinutes: 0,
          machines: new Set(),
        };
      }
      stationWiseMetricsMap[stationNo].machines.add(machineId);
    }

    const finalizeAggregate = (bucket) => {
      const machines = [...bucket.machines];
      let weightedOeeNumerator = 0;
      let weightedOaNumerator = 0;
      let weightedAvailabilityNumerator = 0;
      let weightedPerformanceNumerator = 0;
      let weightedQualityNumerator = 0;
      let weightDenominator = 0;
      for (const machineId of machines) {
        const m = machineMetricsById[machineId];
        if (!m) continue;
        const target = Number(m.targetProduction ?? m.targetQty ?? 0);
        const actual = Number(m.actualProduction ?? m.processedCount ?? 0);
        bucket.targetProduction += target;
        bucket.actualProduction += actual;
        bucket.downtimeMinutes += Number(m.downtimeMinutes ?? 0);
        bucket.downtimeEvents += Number(m.downtimeEvents ?? 0);
        bucket.plannedProductionMinutes += Number(m.plannedProductionMinutes ?? 0);
        const w = Math.max(actual, 0);
        if (w > 0) {
          weightedOeeNumerator += Number(m.oee ?? 0) * w;
          weightedOaNumerator += Number(m.oa ?? 0) * w;
          weightedAvailabilityNumerator += Number(m.availability ?? 0) * w;
          weightedPerformanceNumerator += Number(m.performance ?? 0) * w;
          weightedQualityNumerator += Number(m.quality ?? 0) * w;
          weightDenominator += w;
        }
      }
      return {
        ...bucket,
        machines: undefined,
        achievementPct: bucket.targetProduction > 0 ? Number(((bucket.actualProduction / bucket.targetProduction) * 100).toFixed(2)) : 0,
        targetGap: bucket.targetProduction > 0 ? Math.max(bucket.targetProduction - bucket.actualProduction, 0) : 0,
        oee: weightDenominator > 0 ? Number((weightedOeeNumerator / weightDenominator).toFixed(2)) : 0,
        oa: weightDenominator > 0 ? Number((weightedOaNumerator / weightDenominator).toFixed(2)) : 0,
        availability: weightDenominator > 0 ? Number((weightedAvailabilityNumerator / weightDenominator).toFixed(2)) : 0,
        performance: weightDenominator > 0 ? Number((weightedPerformanceNumerator / weightDenominator).toFixed(2)) : 0,
        quality: weightDenominator > 0 ? Number((weightedQualityNumerator / weightDenominator).toFixed(2)) : 0,
        downtimeEventRatio: (bucket.actualProduction + bucket.downtimeEvents) > 0
          ? Number(((bucket.downtimeEvents / (bucket.actualProduction + bucket.downtimeEvents)) * 100).toFixed(2))
          : 0,
        downtimeTimePct: bucket.plannedProductionMinutes > 0
          ? Number(((bucket.downtimeMinutes / bucket.plannedProductionMinutes) * 100).toFixed(2))
          : 0,
      };
    };

    const shiftWiseMetrics = Object.values(shiftWiseMetricsMap).map(finalizeAggregate);
    const dayWiseMetrics = Object.values(dayWiseMetricsMap).map(finalizeAggregate);
    const stationWiseMetrics = Object.values(stationWiseMetricsMap).map(finalizeAggregate);

    res.json({
      filters: {
        from,
        to,
        machineId: req.query.machineId || null,
        partId: req.query.partId || null,
        status: req.query.status || null,
        shiftCode: shiftCodeFilter,
        lineName: lineNameFilter,
        stationNo: stationNoFilter || null,
        operatorId: operatorIdFilter || null,
      },
      machineWise,
      machineCards,
      stationCards,
      stationWiseMetrics,
      hourlyProduction: hourly,
      shiftProduction: traceabilityShiftProduction,
      shiftWiseMetrics,
      dayWiseMetrics,
      productionDate: getProductionDate(from, shifts)?.toISOString().slice(0, 10),
      interlockHistory: filteredInterlocks,
      reworkCount,
      partJourney: pagedHistory,
      partJourneyPagination: {
        page,
        pageSize,
        total: historyTotal,
      },
      traceabilityCounts,
      partsList,
      plcReadingColumns,
      availableLines,
      availableShifts: shifts.map((shift) => ({
        shiftCode: shift.shift_code,
        shiftName: shift.shift_name,
        startTime: normalizeTimeValue(shift.start_time, { includeSeconds: true }),
        endTime: normalizeTimeValue(shift.end_time, { includeSeconds: true }),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Rejection Analysis Shared Helpers ─────────────────────────────────────────
const splitRejectionZoneHelper = (value) => {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") return { zone: "", subZone: "" };
  let parts = [];
  if (raw.includes(" / ")) parts = raw.split(" / ");
  else if (raw.includes(" - ")) parts = raw.split(" - ");
  else parts = [raw];
  const z = parts[0] ? parts[0].trim() : "";
  let sz = parts[1] ? parts[1].replace(/^Sub\s*Zone\s*:?\s*/i, "").trim() : "";
  return { zone: z, subZone: sz };
};

const extractShotFromPartIdHelper = (partId) => {
  const s = String(partId || "").trim();
  if (!s || s === "-") return "";
  // Customer QR codes MUST NEVER have shot details or shot numbers extracted!
  if (/^R\d{3,}/i.test(s) || /^[A-Z0-9-]{24,}$/i.test(s) || s.includes("+") || s.includes("/")) {
    return "";
  }
  // Format: MMDDHHMM-MC-SHOT (e.g. 08252347-2-2527)
  const hyphenMatch = s.match(/^\d{8}-[A-Z0-9]+-(?<shot>\d{1,6})$/i);
  if (hyphenMatch?.groups?.shot) return String(hyphenMatch.groups.shot).trim();
  // Format: MMDDHHMM<MC><SHOT> (e.g. 0915060122561 -> shot 2561)
  const machineCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<machineCode>[A-Z0-9]{1})(?<shot>\d{1,6})$/i);
  if (machineCompact?.groups?.shot) return String(machineCompact.groups.shot).trim();
  // Format: MMDDHHMM<SHOT> (legacy 12-14 digits)
  const legacyCompact = s.match(/^(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<shot>\d{1,6})$/);
  if (legacyCompact?.groups?.shot) return String(legacyCompact.groups.shot).trim();
  // Format with trailing underscore / hyphen shot e.g. CP100_2527 or PAN-2527
  const suffixMatch = s.match(/[_-](?<shot>\d{1,6})$/);
  if (suffixMatch?.groups?.shot) return String(suffixMatch.groups.shot).trim();
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 13 && digits.length <= 16) return digits.slice(9);
  return "";
};

const canonicalizeReasonHelper = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim();
  const lower = s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  if (lower.includes("non filling") || lower.includes("nonfilling")) return "Non-Filling";
  if (lower.includes("blow hole") || lower.includes("blowhole")) return "Blow Hole";
  if (lower.includes("pin hole") || lower.includes("pinhole")) return "Pin Hole";
  if (lower.includes("cold shut") || lower.includes("coldshut")) return "Cold Shut";
  if (lower.includes("op150") || lower.includes("op 150")) return "Pressure Leakage Fail (OP150)";
  if (lower.includes("body leak")) return "Body Leak";
  if (lower.includes("leak") || lower.includes("leakage")) return "Pressure Leakage Fail (OP150)";
  if (lower.includes("dent")) return "Dent / Handling Damage";
  if (lower.includes("crack")) return "Crack";
  if (lower.includes("porosity")) return "Porosity";
  if (lower.includes("gauging") || lower.includes("dimension")) return "Gauging Out of Spec";
  if (lower.includes("laser") || lower.includes("qr")) return "Laser Mark QR Fail";
  if (lower.includes("dcm casting")) return "DCM Casting Defect";
  if (lower.includes("casting visual") || lower.includes("visual ng")) return "Casting Visual NG";
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
};

const normalizeShotStatusHelper = (rawShotStatus, overallStatus, op100Status, shotNumber) => {
  const norm = String(rawShotStatus || "").trim().toUpperCase();
  if (norm === "OK" || norm === "1" || norm === "PASS" || norm === "PASSED" || norm === "GOOD") return "OK";
  if (norm.includes("WARM") || norm === "3" || norm === "2") return "WARM UP";
  if (norm.includes("OFF") || norm === "5" || norm === "OFFSET") return "NG";
  if (norm === "NG" || norm === "FAILED" || norm === "FAIL" || norm === "NOK") return "NG";
  const op100Norm = String(op100Status || "").trim().toUpperCase();
  if (["NG", "FAILED", "FAIL", "ENDED_NG", "COMPLETED_NG"].includes(op100Norm)) return "NG";
  const overallNorm = String(overallStatus || "").trim().toUpperCase();
  if (["NG", "FAILED", "FAIL"].includes(overallNorm)) return "NG";
  if (shotNumber && shotNumber !== "") return "OK";
  return "";
};

// ─── Shared part-status and shift SQL (one definition for every page) ─────────
// NG = overall NG, any station NG, a leak-test NG, or a leak-named reject (same as the summary's totalNG)
// OK = final pass (OP160 OK or overall OK) and not NG · in process = the rest
const NG_STATUS_LIST = "('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')";
const PART_NG_SQL = `(pr.overall_status IN ('NG', 'FAILED')
      OR ${["100", "110", "120", "130", "140", "150", "160"].map((op) => `pr.op${op}_status IN ${NG_STATUS_LIST}`).join(" OR ")}
      OR (pr.machine_name LIKE '%Leak%' AND pr.overall_status IN ('NG', 'FAILED'))
      OR (pr.rejection_reason LIKE '%Leak%' AND pr.overall_status IN ('NG', 'FAILED'))
      OR (pr.ng_reason LIKE '%Leak%' AND pr.overall_status IN ('NG', 'FAILED'))
      OR (CASE WHEN ISJSON(pr.leak_data) = 1 THEN JSON_VALUE(pr.leak_data, '$.result') END) IN ('NG', 'FAIL', 'FAILED'))`;
const PART_OK_SQL = "(pr.op160_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') OR pr.overall_status IN ('OK', 'PASSED'))";

/**
 * The time that decides a part's day and shift: first scan; with a station filter, that station's latest scan
 * (OUTER APPLY over OperationLogs); with a leak filter, the leak result time (stored as plant-local time + "Z").
 */
function decidingTimeSql({ isOpGate = false, isLeakGate = false } = {}) {
  const PD = require("../utils/productionDay");
  if (isOpGate) {
    return {
      timeCol: "g.gate_at",
      apply: `OUTER APPLY (SELECT MAX(ol.createdAt) AS gate_at FROM OperationLogs ol
           WHERE (ol.operation_no = :qualityGateOp OR ol.station_no = :qualityGateOp)
             AND (ol.part_id = pr.part_id OR ol.part_id = pr.customer_qr)) g`,
    };
  }
  if (isLeakGate) {
    return { timeCol: `DATEADD(MINUTE, -${PD.PLANT_OFFSET_MIN}, TRY_CAST(CASE WHEN ISJSON(pr.leak_data) = 1 THEN JSON_VALUE(pr.leak_data, '$.cycleEndTime') END AS datetime2))`, apply: "" };
  }
  return { timeCol: "pr.first_scan_at", apply: "" };
}

/**
 * Parts per shift for a filtered set. The shift comes from the Shift Management timings applied to the deciding
 * time (not the label stored at sync), so it always agrees with the shift filter and A + B + C = total.
 * Columns: shift, total, ok, ng, scrap (= ng), wip, scrapRate (= NG ÷ (OK + NG) × 100).
 */
function shiftBreakdownSql({ whereSql = "", shifts = [], isOpGate = false, isLeakGate = false } = {}) {
  const PD = require("../utils/productionDay");
  const { timeCol, apply } = decidingTimeSql({ isOpGate, isLeakGate });
  const shiftExpr = shifts.length ? PD.shiftCaseSql(timeCol, shifts) : "COALESCE(NULLIF(pr.shift_code, ''), 'UNASSIGNED')";
  return `
    SELECT shift,
           COUNT(*) AS total,
           SUM(is_ok) AS ok,
           SUM(is_ng) AS ng,
           SUM(is_ng) AS scrap,
           COUNT(*) - SUM(is_ok) - SUM(is_ng) AS wip,
           ROUND(CASE WHEN SUM(is_ok) + SUM(is_ng) > 0 THEN CAST(SUM(is_ng) AS FLOAT) / (SUM(is_ok) + SUM(is_ng)) * 100 ELSE 0 END, 2) AS scrapRate
    FROM (
      SELECT ${shiftExpr} AS shift,
             CASE WHEN ${PART_NG_SQL} THEN 1 ELSE 0 END AS is_ng,
             CASE WHEN ${PART_NG_SQL} THEN 0 WHEN ${PART_OK_SQL} THEN 1 ELSE 0 END AS is_ok
      FROM [RICO_IOT].[dbo].[ProductionReports] pr ${apply}
      ${whereSql}
    ) x
    GROUP BY shift
    ORDER BY shift ASC`;
}

/**
 * Station OK / NG for OP100–OP160 inside a date window, from ONE read of the scan log (two queries in parallel).
 * Same rule as the Historical Report with a station selected (historicalReportController loadGateSet):
 *  1. per part per station, the DECISIVE scan = the latest OK / NG scan since the window start (a log counts for a
 *     station when its operation_no OR station_no is that station). BLOCK / INTERLOCKED / pending rows never decide,
 *     and IDs shorter than 7 characters are scanner fragments, not parts. The part is kept when that scan falls
 *     before the window end and, with a shift filter, in that shift (same rule as shiftCaseSql);
 *  2. the report rows (other filters + first scan before the window end) whose part_id or customer_qr was scanned
 *     at any station in the window — written as two joins + UNION, never "part_id IN (…) OR customer_qr IN (…)",
 *     which made SQL Server pick plans that ran for 60 s;
 *  3. each row counted once per station whose kept set holds its part_id or customer_qr, as OK / NG by the result
 *     of the decisive scan itself (the later of its part_id / customer_qr scans) — not the report's opXXX_status
 *     column, which can lag behind or be overwritten by a later blocked re-scan.
 * SQL Server's case-insensitive, trailing-space-insensitive matching is reproduced on the keys.
 */
async function stationOpCountsFromLogs(ops, { prWhereSql, replacements }, ctx) {
  const PD = require("../utils/productionDay");
  const key = (v) => (v === null || v === undefined ? null : String(v).replace(/ +$/, "").toUpperCase());
  const opList = ops.map((o) => `'${o}'`).join(", ");
  const decisiveScan = "UPPER(result) IN ('OK', 'NG') AND LEN(part_id) >= 7";
  const scanned = `SELECT DISTINCT part_id FROM OperationLogs
     WHERE createdAt >= :scanFrom AND (operation_no IN (${opList}) OR station_no IN (${opList})) AND ${decisiveScan}`;
  const prWhere = prWhereSql ? `${prWhereSql} AND` : "WHERE";
  const cols = `pr.id, pr.part_id, pr.customer_qr`;
  const [logRows, reportRows] = await Promise.all([
    sequelize.query(`
      SELECT part_id, operation_no, station_no, UPPER(result) AS result, createdAt AS at, id FROM (
        SELECT part_id, operation_no, station_no, result, createdAt, id,
               ROW_NUMBER() OVER (PARTITION BY part_id, operation_no, station_no ORDER BY createdAt DESC, id DESC) AS rn
          FROM OperationLogs
         WHERE createdAt >= :scanFrom AND (operation_no IN (${opList}) OR station_no IN (${opList})) AND ${decisiveScan}
      ) x WHERE rn = 1`,
    { replacements: { scanFrom: ctx.from }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      SELECT ${cols} FROM [RICO_IOT].[dbo].[ProductionReports] pr JOIN (${scanned}) g ON g.part_id = pr.part_id
      ${prWhere} pr.first_scan_at < :scanTo
      UNION
      SELECT ${cols} FROM [RICO_IOT].[dbo].[ProductionReports] pr JOIN (${scanned}) g ON g.part_id = pr.customer_qr
      ${prWhere} pr.first_scan_at < :scanTo`,
    { replacements: { ...replacements, scanFrom: ctx.from, scanTo: ctx.to }, type: sequelize.QueryTypes.SELECT }),
  ]);

  // decisive (latest OK / NG) scan per station per part ID: { t, id, result } — ties broken by log id
  const latest = new Map(ops.map((op) => [op, new Map()]));
  const later = (a, b) => (!a ? b : !b ? a : (b.t > a.t || (b.t === a.t && b.id > a.id)) ? b : a);
  const note = (st, k, scan) => { const m = latest.get(st); if (m) m.set(k, later(m.get(k), scan)); };
  for (const r of logRows) {
    const k = key(r.part_id);
    if (k === null || k.length < 7) continue;
    const scan = { t: new Date(r.at).getTime(), id: Number(r.id) || 0, result: key(r.result) };
    const a = key(r.operation_no), b = key(r.station_no);
    note(a, k, scan);
    if (b !== a) note(b, k, scan);
  }

  const toMs = new Date(ctx.to).getTime();
  const shiftFilter = ctx.shiftCodeFilter && ctx.shifts.length ? key(ctx.shiftCodeFilter) : null;
  const shiftDefs = shiftFilter ? ctx.shifts.map((s) => ({
    a: PD.timeToSeconds(s.start_time ?? s.startTime),
    b: PD.timeToSeconds(s.end_time ?? s.endTime),
    code: String(s.shift_code || s.shiftCode || ""),
  })).filter((s) => s.a !== null && s.b !== null && s.code) : [];
  const shiftOf = (ms) => {
    const sec = PD.plantSecondOfDay(new Date(ms));
    const hit = shiftDefs.find((s) => (s.a <= s.b ? sec >= s.a && sec <= s.b : sec >= s.a || sec <= s.b));
    return hit ? key(hit.code) : "UNASSIGNED";
  };
  const gate = new Map();
  latest.forEach((byKey, op) => {
    const set = new Set();
    byKey.forEach((scan, k) => {
      if (scan.t >= toMs) return;
      if (shiftFilter && shiftOf(scan.t) !== shiftFilter) return;
      set.add(k);
    });
    gate.set(op, set);
  });

  const out = Object.fromEntries(ops.map((op) => [op, { ok: 0, ng: 0 }]));
  const seen = new Set();
  reportRows.forEach((r) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    const pk = key(r.part_id), qk = key(r.customer_qr);
    ops.forEach((op) => {
      const set = gate.get(op);
      if (!((pk !== null && set.has(pk)) || (qk !== null && set.has(qk)))) return;
      // result of the decisive scan (the later one when both the part ID and the customer QR were scanned)
      const byKey = latest.get(op);
      const scan = later(pk !== null ? byKey.get(pk) : null, qk !== null ? byKey.get(qk) : null);
      if (scan?.result === "OK") out[op].ok += 1;
      else if (scan?.result === "NG") out[op].ng += 1;
    });
  });
  return out;
}

/**
 * Station results counted the way the station / operator sees them (same rule as the Historical Report with a
 * station selected): a part counts at a station when that station's LATEST scan of it falls in the selected
 * production-day window (and shift), with the station's own OK / NG result. Leak machines count by leak result time.
 * Other filters (part, die, machine, part type) still apply; misread scans are excluded.
 * Returns { OP100: {ok, ng}, …, "Leak-Test-01": {ok, ng}, … }.
 */
async function stationCountsByScan(query, ctx) {
  const PD = require("../utils/productionDay");
  const base = await buildRejectionFilterContext({
    ...query, dateFrom: undefined, dateTo: undefined, datePreset: "all", allTime: "1",
    shiftCode: undefined, qualityGate: undefined, status: undefined, category: undefined, reason: undefined, view: undefined, zone: undefined,
  });
  const repl = { ...base.replacements };
  if (!ctx.isAllTime) { repl.scanFrom = ctx.from; repl.scanTo = ctx.to; }
  if (ctx.shiftCodeFilter) repl.scanShift = ctx.shiftCodeFilter;
  const timeCond = (col) => {
    const parts = [];
    if (!ctx.isAllTime) parts.push(`${col} >= :scanFrom AND ${col} < :scanTo`);
    if (ctx.shiftCodeFilter && ctx.shifts.length) parts.push(`${PD.shiftCaseSql(col, ctx.shifts)} = :scanShift`);
    return parts.join(" AND ");
  };
  const where = base.whereSql ? `${base.whereSql} AND` : "WHERE";
  const OK_LIST = "('OK', 'PASS', 'PASSED', 'ENDED_OK', 'COMPLETED_OK')";
  const out = {};

  const ops = ["OP100", "OP110", "OP120", "OP130", "OP140", "OP160"];
  // With a date window the scan log is read once for all stations (see stationOpCountsFromLogs). The old form —
  // one "part_id IN (sub) OR customer_qr IN (sub)" query per station — made SQL Server pick plans that ran for
  // 60 s on a single day. All time (no window) keeps the SQL form, with the same decisive-scan rule: only OK / NG
  // scans of real part IDs (7+ characters) count, and the result is that latest OK / NG scan's own result.
  const opCountsPromise = ctx.isAllTime
    ? Promise.all(ops.map((op) => {
      const c = timeCond("MAX(createdAt)");
      const decisive = `(operation_no = '${op}' OR station_no = '${op}') AND UPPER(result) IN ('OK', 'NG') AND LEN(part_id) >= 7`;
      const sub = `SELECT part_id FROM OperationLogs WHERE ${decisive} GROUP BY part_id${c ? ` HAVING ${c}` : ""}`;
      const res = `(SELECT TOP 1 UPPER(o.result) FROM OperationLogs o
          WHERE (o.operation_no = '${op}' OR o.station_no = '${op}') AND UPPER(o.result) IN ('OK', 'NG') AND LEN(o.part_id) >= 7
            AND o.part_id IN (pr.part_id, pr.customer_qr) ORDER BY o.createdAt DESC, o.id DESC)`;
      return sequelize.query(`
        SELECT SUM(CASE WHEN r = 'OK' THEN 1 ELSE 0 END) AS ok,
               SUM(CASE WHEN r = 'NG' THEN 1 ELSE 0 END) AS ng
        FROM (SELECT ${res} AS r
          FROM [RICO_IOT].[dbo].[ProductionReports] pr
          ${where} (pr.part_id IN (${sub}) OR pr.customer_qr IN (${sub}))) x`, { replacements: repl, type: sequelize.QueryTypes.SELECT });
    })).then((opRows) => Object.fromEntries(ops.map((op, i) => [op, { ok: Number(opRows[i]?.[0]?.ok || 0), ng: Number(opRows[i]?.[0]?.ng || 0) }])))
    : stationOpCountsFromLogs(ops, { prWhereSql: base.prWhereSql, replacements: base.replacements }, ctx);

  // leak machines: by the machine that tested the part and the leak result time (stored as plant time + "Z")
  const leakJson = (path) => `(CASE WHEN ISJSON(pr.leak_data) = 1 THEN JSON_VALUE(pr.leak_data, '${path}') END)`;
  const leakTime = `TODATETIMEOFFSET(DATEADD(MINUTE, -${PD.PLANT_OFFSET_MIN}, TRY_CAST(${leakJson("$.cycleEndTime")} AS datetime2)), 0)`;
  const lc = timeCond(leakTime);
  const [opCounts, leakRows, leakMachines] = await Promise.all([
    opCountsPromise,
    sequelize.query(`
      SELECT ${leakJson("$.matchedMachineId")} AS mid, ${leakJson("$.matchedMachineName")} AS mname,
             SUM(CASE WHEN UPPER(${leakJson("$.result")}) IN ${OK_LIST} THEN 1 ELSE 0 END) AS ok,
             SUM(CASE WHEN UPPER(${leakJson("$.result")}) IN ${NG_STATUS_LIST} THEN 1 ELSE 0 END) AS ng
      FROM [RICO_IOT].[dbo].[ProductionReports] pr
      ${where} ${leakJson("$.result")} IS NOT NULL${lc ? ` AND ${lc}` : ""}${ctx.isAllTime ? "" : " AND pr.first_scan_at < :scanTo AND pr.first_scan_at >= DATEADD(DAY, -60, CAST(:scanFrom AS datetimeoffset))"}
      GROUP BY ${leakJson("$.matchedMachineId")}, ${leakJson("$.matchedMachineName")}`, { replacements: repl, type: sequelize.QueryTypes.SELECT }),
    Machine.findAll({ attributes: ["id", "machine_name", "operation_no"], raw: true }).catch(() => []),
  ]);
  ops.forEach((op) => { out[op] = opCounts[op] || { ok: 0, ng: 0 }; });
  const nameById = new Map((leakMachines || []).map((m) => [String(m.id), String(m.machine_name || "")]));
  const leakCode = { 1: "Leak-Test-01", 2: "Leak-Test-02", 3: "Leak Test-03" };
  ["Leak-Test-01", "Leak-Test-02", "Leak Test-03"].forEach((c) => { out[c] = { ok: 0, ng: 0 }; });
  (leakRows || []).forEach((row) => {
    const name = nameById.get(String(row.mid)) || row.mname || "";
    const n = String(name).toUpperCase().match(/LEAK[\s_-]*TEST[\s_-]*0*(\d)/)?.[1];
    const code = leakCode[n];
    if (!code) return;
    out[code].ok += Number(row.ok || 0);
    out[code].ng += Number(row.ng || 0);
  });
  out.OP150 = ["Leak-Test-01", "Leak-Test-02", "Leak Test-03"].reduce((a, c) => ({ ok: a.ok + out[c].ok, ng: a.ng + out[c].ng }), { ok: 0, ng: 0 });
  return out;
}

// ─── Shared Rejection Filter Helper ──────────────────────────────────────────
async function buildRejectionFilterContext(query = {}) {
  const shifts = await getActiveShiftDefinitions();
  const now = new Date();
  const defaultWindow = getProductionDayWindow(shifts, now);
  const datePreset = String(query.datePreset || "").toLowerCase().trim();
  const isAllTime = datePreset === "all" || query.allTime === "1" || query.allTime === "true";
  // Production days: a date D = D 06:00 → D+1 06:00 (end exclusive); a range D1–D2 = D1 06:00 → (D2+1) 06:00
  const requestedRange = (query.dateFrom || query.dateTo)
    ? require("../utils/productionDay").productionWindow({ dateFrom: query.dateFrom, dateTo: query.dateTo, shifts, now })
    : defaultWindow;
  const from = requestedRange.from;
  const to = requestedRange.to;
  const dateFrom = from.toISOString();
  const dateTo = to.toISOString();
  const machineNameFilter = String(query.machineName || query.machine_name || "").trim();
  const partId = String(query.partId || "").trim();
  const partNameFilter = String(query.partName || query.part_name || "").trim().toUpperCase();
  const dieNameFilter = String(query.dieName || query.die_name || "").trim().toUpperCase();
  const shiftCodeFilter = String(query.shiftCode || "").trim().toUpperCase();
  const statusFilter = String(query.status || "").trim().toUpperCase();
  const qualityGateFilter = String(query.qualityGate || "").trim().toUpperCase();
  const categoryFilter = String(query.category || "").trim();
  const reasonFilter = String(query.reason || "").trim();
  const partCategory = String(query.partCategory || "").trim().toUpperCase();

  let dbMachines = [];
  try {
    dbMachines = await Machine.findAll({
      attributes: ["id", "machine_name", "operation_no", "sequence_no", "line_name"],
      order: [["sequence_no", "ASC"], ["operation_no", "ASC"]],
      raw: true,
    });
  } catch (e) {
    console.warn(`[REJECTION] Machine query fallback: ${e.message}`);
  }

  const stationLabelMap = {
    OP100: "DCM+DPM + OP100",
    OP110: "Laser Marking + OP110",
    OP120: "Casting PDi + OP120",
    OP130: "Pre Inspection + OP130",
    OP140: "Auto Guaging + OP140",
    OP150: "Leak Test OP150",
    OP160: "Final Inspection + OP160",
  };

  if (Array.isArray(dbMachines)) {
    dbMachines.forEach((m) => {
      const op = String(m.operation_no || "").trim().toUpperCase();
      const mName = String(m.machine_name || "").trim();
      if (op && mName) {
        if (op === "OP150" && mName.toLowerCase().includes("leak")) {
          stationLabelMap["OP150"] = "Leak Test OP150";
        } else {
          stationLabelMap[op] = `${mName} + ${op}`;
        }
      }
    });
  }

  const whereConditions = [];
  const replacements = {};

  // scanner misreads (several IDs in one read, fragments) are not parts — see VALID_SCAN_SQL

  whereConditions.push(require("../utils/productionDay").VALID_SCAN_SQL);

  // Day + shift — same rule as the Historical Report:
  //  • no station selected → the part's FIRST scan (casting)
  //  • station selected    → that station's LATEST scan of the part (its output in that day / shift)
  //  • leak test           → the leak result time (leak_data.cycleEndTime is plant-local time written with "Z")
  const PD = require("../utils/productionDay");
  const gateCode = qualityGateFilter.trim().toUpperCase();
  const isOpGate = /^OP(100|110|120|130|140|160)$/.test(gateCode);
  const isLeakGate = gateCode === "OP150" || gateCode.startsWith("LEAK");
  const useShiftTimes = Boolean(shiftCodeFilter) && shifts.length > 0;
  if (shiftCodeFilter) replacements.shiftCode = shiftCodeFilter;
  if (!isAllTime) { replacements.from = from; replacements.to = to; }
  let gateTimeSql = null;
  // Conditions with a sub-query on another table must not go through the pr. prefixing (it would rewrite the
  // sub-query's own part_id): they are stored as {plain, pr} and inserted as {{RAW_n}} placeholders.
  const rawConds = [];
  const pushRaw = (plain, pr) => { rawConds.push({ plain, pr }); whereConditions.push(`{{RAW_${rawConds.length - 1}}}`); };
  // one report row per part (older duplicate copies skipped)
  pushRaw(require("../utils/productionDay").notStaleRowSql("id"), require("../utils/productionDay").notStaleRowSql("pr.[id]"));
  // NG parts' operator entry ("Category: CR | View: … | Zone: … | Reason: …") lives in Parts.interlock_reason
  const partsEntryLike = (param) => ({
    plain: `part_id IN (SELECT px.part_id FROM Parts px WHERE px.interlock_reason LIKE :${param})`,
    pr: `pr.[part_id] IN (SELECT px.part_id FROM Parts px WHERE px.interlock_reason LIKE :${param})`,
  });
  if (isOpGate && (!isAllTime || useShiftTimes)) {
    const having = [];
    if (!isAllTime) having.push("MAX(createdAt) >= :from AND MAX(createdAt) < :to");
    if (useShiftTimes) having.push(`${PD.shiftCaseSql("MAX(createdAt)", shifts)} = :shiftCode`);
    replacements.qualityGateOp = gateCode;
    const sub = `SELECT part_id FROM OperationLogs WHERE (operation_no = :qualityGateOp OR station_no = :qualityGateOp)${isAllTime ? "" : " AND createdAt >= :from"} GROUP BY part_id HAVING ${having.join(" AND ")}`;
    // Kept out of the column prefixing below (it would rewrite the subquery's own part_id / createdAt): the
    // {{GATE_TIME}} placeholder is expanded by expandGateTime() once the WHERE text is final.
    gateTimeSql = { plain: `(part_id IN (${sub}) OR customer_qr IN (${sub}))`, pr: `(pr.[part_id] IN (${sub}) OR pr.[customer_qr] IN (${sub}))` };
    whereConditions.push("{{GATE_TIME}}");
  } else {
    const timeCol = isLeakGate
      // typed as UTC datetimeoffset so it compares correctly with the :from / :to parameters (sent with "+00:00")
      ? `TODATETIMEOFFSET(DATEADD(MINUTE, -${PD.PLANT_OFFSET_MIN}, TRY_CAST(CASE WHEN ISJSON(leak_data) = 1 THEN JSON_VALUE(leak_data, '$.cycleEndTime') END AS datetime2)), 0)`
      : "first_scan_at";
    if (!isAllTime) whereConditions.push(`${timeCol} >= :from AND ${timeCol} < :to`);
    if (useShiftTimes) whereConditions.push(`${PD.shiftCaseSql(timeCol, shifts)} = :shiftCode`);
  }
  if (shiftCodeFilter && !useShiftTimes) whereConditions.push(`shift_code = :shiftCode`);
  if (machineNameFilter) {
    whereConditions.push(`machine_name = :machineName`);
    replacements.machineName = machineNameFilter;
  }
  if (/^(OP(100|110|120|130|140|150|160)|LEAK-TEST-01|LEAK-TEST-02|LEAK TEST-03|LEAK-TEST-03|LEAK01|LEAK02|LEAK03)$/i.test(qualityGateFilter)) {
    const qg = qualityGateFilter.trim().toUpperCase();
    if (qg === "LEAK-TEST-01" || qg === "LEAK01") {
      whereConditions.push(`(
        (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name = 'Leak-Test-01' OR machine_name LIKE '%Leak%01%')
        AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%')) OR (machine_name = 'Leak-Test-01' AND overall_status IN ('NG','FAILED')))
      )`);
    } else if (qg === "LEAK-TEST-02" || qg === "LEAK02") {
      whereConditions.push(`(
        (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name = 'Leak-Test-02' OR machine_name LIKE '%Leak%02%')
        AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%')) OR (machine_name = 'Leak-Test-02' AND overall_status IN ('NG','FAILED')))
      )`);
    } else if (qg === "LEAK TEST-03" || qg === "LEAK-TEST-03" || qg === "LEAK03") {
      whereConditions.push(`(
        (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03' OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03' OR leak_data LIKE '%1776%' OR machine_name = 'Leak Test-03' OR machine_name LIKE '%Leak%03%')
        AND (JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED') OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%')) OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('NG','FAILED')))
      )`);
    } else if (qg === "OP150") {
      whereConditions.push(`(
        op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR (machine_name LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
        OR (rejection_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
        OR (ng_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
        OR (rejection_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
        OR (ng_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
        OR (JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED'))
      )`);
    } else if (qg === "OP100") {
      whereConditions.push(`(
        op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
        OR (machine_name LIKE '%DCM%' AND overall_status IN ('NG', 'FAILED'))
      )`);
    } else if (/^OP(110|120|130|140|160)$/i.test(qg)) {
      const operationColumn = qg.toLowerCase() + "_status";
      whereConditions.push(`${operationColumn} IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')`);
    }
  }
  if (partNameFilter) {
    whereConditions.push(`UPPER(part_name) = :partName`);
    replacements.partName = partNameFilter;
  }
  if (dieNameFilter) {
    whereConditions.push(`UPPER(die_name) = :dieName`);
    replacements.dieName = dieNameFilter;
  }
  if (partId) {
    whereConditions.push(`(part_id LIKE :partIdPattern OR customer_qr LIKE :partIdPattern)`);
    replacements.partIdPattern = `%${partId}%`;
  }
  // Category / reason / view / zone: the stored columns, or the operator entry in Parts (ProductionReports has no
  // view or zone column, and its category / reason are usually empty). "Category: CR |" so CR never matches CRAM.
  const entryFilter = (param, pattern, ownCols) => {
    replacements[param] = pattern;
    const e = partsEntryLike(param);
    const own = ownCols.map((c) => `${c} LIKE :${param}`).join(" OR ");
    pushRaw(`(${own} OR ${e.plain})`, `(${ownCols.map((c) => `pr.[${c}] LIKE :${param}`).join(" OR ")} OR ${e.pr})`);
  };
  if (categoryFilter) {
    replacements.categoryFilter = categoryFilter;
    replacements.catPatternEntry = `%Category: ${categoryFilter} |%`;
    replacements.anyEntry = "%Category:%";
    // Sensor rejects have no operator entry: their category is the rejecting station's default, the same rule as the
    // NG records (leak test only → CRAM, OP130 → CRAM, OP120 / OP100 → CR, OP140 → MR)
    const defaultCat = (p) => {
      const ng = (col) => `${p(col)} IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')`;
      const leakNg = `(${ng("op150_status")} OR (CASE WHEN ISJSON(${p("leak_data")}) = 1 THEN JSON_VALUE(${p("leak_data")}, '$.result') END) IN ('NG', 'FAIL', 'FAILED'))`;
      return `(CASE WHEN ${leakNg} AND NOT (${ng("op120_status")} OR ${ng("op130_status")} OR ${ng("op100_status")}) THEN 'CRAM'
        WHEN ${ng("op130_status")} THEN 'CRAM' WHEN ${ng("op120_status")} THEN 'CR' WHEN ${ng("op140_status")} THEN 'MR'
        WHEN ${ng("op100_status")} THEN 'CR' END)`;
    };
    const plainCol = (c) => c, prCol = (c) => `pr.[${c}]`;
    const e = partsEntryLike("catPatternEntry"), any = partsEntryLike("anyEntry");
    pushRaw(
      `(rejection_category = :categoryFilter OR ${e.plain} OR (NULLIF(LTRIM(ISNULL(rejection_category, '')), '') IS NULL AND NOT (${any.plain}) AND ${defaultCat(plainCol)} = :categoryFilter))`,
      `(pr.[rejection_category] = :categoryFilter OR ${e.pr} OR (NULLIF(LTRIM(ISNULL(pr.[rejection_category], '')), '') IS NULL AND NOT (${any.pr}) AND ${defaultCat(prCol)} = :categoryFilter))`,
    );
  }
  if (reasonFilter) entryFilter("reasonPattern", `%Reason: ${reasonFilter}%`, ["rejection_reason", "ng_reason"]);
  const viewFilter = String(query.view || "").trim();
  if (viewFilter && viewFilter.toLowerCase() !== "all") entryFilter("viewPattern", `%View: ${viewFilter}%`, ["ng_reason"]);
  const zoneFilter = String(query.zone || "").trim();
  if (zoneFilter) entryFilter("zonePattern", `%${zoneFilter}%`, ["ng_reason"]);
  if (statusFilter === "NG" || statusFilter === "REJECT" || statusFilter === "FAILED") {
    whereConditions.push(`(
      overall_status IN ('NG', 'FAILED')
      OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
      OR (machine_name LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
      OR (rejection_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
      OR (ng_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
      OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
    )`);
  } else if (statusFilter === "OK" || statusFilter === "PASSED") {
    whereConditions.push(`overall_status IN ('OK', 'PASSED')`);
  }

  if (partCategory) {
    if (partCategory === 'HPDC') {
      whereConditions.push(`(part_name IS NOT NULL AND part_name <> '')`);
    } else if (partCategory === 'OTHER') {
      whereConditions.push(`(part_name IS NULL OR part_name = '')`);
    }
  }

  const expandGateTime = (sql, prefixed) => {
    let out = gateTimeSql ? sql.replace("{{GATE_TIME}}", () => (prefixed ? gateTimeSql.pr : gateTimeSql.plain)) : sql;
    rawConds.forEach((c, i) => { out = out.replace(`{{RAW_${i}}}`, () => (prefixed ? c.pr : c.plain)); });
    return out;
  };
  const rawWhereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
  const whereSql = expandGateTime(rawWhereSql, false);
  const prWhereSql = rawWhereSql ? expandGateTime(rawWhereSql
    .replace(/\[(\w+)\]/g, '$1')
    .replace(/\b(part_id|customer_qr|createdAt|updatedAt|first_scan_at|final_scan_at|shift_code|machine_name|die_name|part_name|rejection_category|rejection_reason|ng_reason|overall_status|op100_status|op110_status|op120_status|op130_status|op140_status|op150_status|op160_status|leak_data)\b/g, 'pr.[$1]'), true)
    : '';

  return {
    shifts,
    now,
    from,
    to,
    dateFrom,
    dateTo,
    isAllTime,
    machineNameFilter,
    partNameFilter,
    dieNameFilter,
    shiftCodeFilter,
    statusFilter,
    qualityGateFilter,
    categoryFilter,
    reasonFilter,
    dbMachines,
    stationLabelMap,
    whereConditions,
    replacements,
    whereSql,
    prWhereSql,
    expandGateTime,
    gateCode,
    isOpGate: isOpGate && !isAllTime,
    isLeakGate,
  };
}

// ─── Modular Endpoint 1: Summary & Quality Gates ────────────────────────────
// Rejection summary: 7–20 s on long ranges (station scan counts + leak results). Identical requests within 60 s
// (15 s when the page asks for fresh data) share one result, and a request arriving while the same summary is being
// built waits for it instead of running the queries again — several viewers opening the page cost one build.
const rejectionSummaryCache = new Map(); // key -> { at, status, body } | { pending: Promise }
exports.getRejectionSummary = async (req, res) => {
  const q = req.query || {};
  const key = JSON.stringify(Object.keys(q).filter((k) => k !== "_ts" && k !== "noCache").sort().map((k) => [k, String(q[k])]));
  const ttl = q.noCache ? 15 * 1000 : 60 * 1000;
  const hit = rejectionSummaryCache.get(key);
  if (hit && !hit.pending && Date.now() - hit.at < ttl) return res.status(hit.status).json(hit.body);
  if (hit && hit.pending) {
    try {
      const done = await hit.pending;
      if (done.body) return res.status(done.status).json(done.body);
    } catch (err) { void err; }
  }
  let resolveFn;
  rejectionSummaryCache.set(key, { pending: new Promise((resolve) => { resolveFn = resolve; }) });
  const captured = { status: 200, body: null };
  const capture = {
    status(code) { captured.status = code; return capture; },
    json(body) { captured.body = body; return capture; },
  };
  try {
    await getRejectionSummaryUncached(req, capture);
  } finally {
    resolveFn(captured);
    if (captured.status === 200 && captured.body) {
      rejectionSummaryCache.set(key, { at: Date.now(), status: captured.status, body: captured.body });
      if (rejectionSummaryCache.size > 50) rejectionSummaryCache.delete(rejectionSummaryCache.keys().next().value);
    } else {
      rejectionSummaryCache.delete(key);
    }
  }
  return res.status(captured.status).json(captured.body);
};

async function getRejectionSummaryUncached(req, res) {
  try {
    const ctx = await buildRejectionFilterContext(req.query);
    const { replacements, whereSql, stationLabelMap, shifts, dateFrom, dateTo, shiftCodeFilter, machineNameFilter, partNameFilter, dieNameFilter } = ctx;

    // die × production day (first scan, 06:00 → 06:00 plant time): parts, OK, NG — same part filter and NG rule as
    // dieStats, for the per-die trend of the Die Performance tab. Runs alongside the summary queries.
    const dieDailyPromise = (() => {
      const PDd = require("../utils/productionDay");
      const shiftMin = PDd.PLANT_OFFSET_MIN - Math.round(PDd.dayStartSeconds(shifts) / 60);
      const NG_EXPR = `(overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED'))`;
      const DAY = `CONVERT(varchar(10), CAST(DATEADD(MINUTE, ${shiftMin}, first_scan_at) AS date), 23)`;
      return sequelize.query(`
        SELECT die_name AS die, ${DAY} AS day, COUNT(*) AS parts,
          SUM(CASE WHEN overall_status IN ('OK', 'PASSED') AND (CASE WHEN ${NG_EXPR} THEN 1 ELSE 0 END) = 0 THEN 1 ELSE 0 END) AS ok,
          SUM(CASE WHEN ${NG_EXPR} THEN 1 ELSE 0 END) AS ng
        FROM [RICO_IOT].[dbo].[ProductionReports] WITH (NOLOCK)
        ${whereSql ? whereSql + " AND" : "WHERE"} die_name IS NOT NULL AND die_name <> '' AND die_name <> '-' AND first_scan_at IS NOT NULL
        GROUP BY die_name, ${DAY}
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] dieDaily query error:", err.message);
        return [];
      });
    })();

    // station figures (by station scan time) start now and run alongside the summary queries
    const scanCountsPromise = stationCountsByScan(req.query, ctx).catch((err) => {
      console.warn("[REJECTION] station scan counts error:", err.message);
      return null;
    });
    const [aggregatesRes, filterOptionsRes, dieStatsRes] = await Promise.all([
      sequelize.query(`
        SELECT 
          COUNT(*) as totalParts,
          SUM(CASE WHEN (op160_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') OR overall_status IN ('OK', 'PASSED')) AND COALESCE(overall_status, '') NOT IN ('NG', 'FAILED') THEN 1 ELSE 0 END) as totalOK,
          SUM(CASE WHEN ${PART_NG_SQL} THEN 0 WHEN ${PART_OK_SQL} THEN 1 ELSE 0 END) as cohortOK,
          SUM(CASE WHEN (
            overall_status IN ('NG', 'FAILED')
            OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR (machine_name LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (rejection_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (ng_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
          ) THEN 1 ELSE 0 END) as totalNG,
          SUM(CASE WHEN overall_status IN ('IN_PROGRESS', 'WIP') THEN 1 ELSE 0 END) as totalInProgress,
          SUM(CASE WHEN op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%DCM%' AND (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG','FAIL'))) THEN 1 ELSE 0 END) as op100_ng,
          SUM(CASE WHEN op100_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') OR (machine_name LIKE '%DCM%' AND overall_status IN ('OK', 'PASSED')) THEN 1 ELSE 0 END) as op100_ok,
          SUM(CASE WHEN op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%Laser%' AND (overall_status IN ('NG', 'FAILED') OR op110_status IN ('NG','FAIL'))) THEN 1 ELSE 0 END) as op110_ng,
          SUM(CASE WHEN op110_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op110_ok,
          SUM(CASE WHEN op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%PDi%' AND (overall_status IN ('NG', 'FAILED') OR op120_status IN ('NG','FAIL'))) THEN 1 ELSE 0 END) as op120_ng,
          SUM(CASE WHEN op120_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op120_ok,
          SUM(CASE WHEN op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%Pre%' AND (overall_status IN ('NG', 'FAILED') OR op130_status IN ('NG','FAIL'))) THEN 1 ELSE 0 END) as op130_ng,
          SUM(CASE WHEN op130_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op130_ok,
          SUM(CASE WHEN op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%Guag%' AND (overall_status IN ('NG', 'FAILED') OR op140_status IN ('NG','FAIL'))) THEN 1 ELSE 0 END) as op140_ng,
          SUM(CASE WHEN op140_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op140_ok,
          SUM(CASE WHEN 
            op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
            OR (machine_name LIKE '%Leak%' AND (overall_status IN ('NG', 'FAILED') OR op150_status IN ('NG','FAIL')))
            OR (rejection_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (ng_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (rejection_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
            OR (ng_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
          THEN 1 ELSE 0 END) as op150_ng,
          SUM(CASE WHEN (
            op150_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK')
            OR JSON_VALUE(leak_data, '$.result') IN ('OK', 'PASS', 'PASSED')
            OR (machine_name LIKE '%Leak%' AND overall_status IN ('OK', 'PASSED'))
          ) THEN 1 ELSE 0 END) as op150_ok,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01'
            OR leak_data LIKE '%1773%'
            OR machine_name = 'Leak-Test-01'
            OR machine_name LIKE '%Leak%01%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
            OR op150_status IN ('NG','FAIL','FAILED')
            OR (machine_name LIKE '%01%' AND (overall_status IN ('NG','FAILED') OR op150_status IN ('NG','FAIL')))
          ) THEN 1 ELSE 0 END) as leak01_ng,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01'
            OR leak_data LIKE '%1773%'
            OR machine_name = 'Leak-Test-01'
            OR machine_name LIKE '%Leak%01%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED')
            OR (op150_status IN ('OK','PASSED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%'))
            OR (machine_name = 'Leak-Test-01' AND overall_status IN ('OK','PASSED'))
          ) THEN 1 ELSE 0 END) as leak01_ok,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02'
            OR leak_data LIKE '%1774%'
            OR machine_name = 'Leak-Test-02'
            OR machine_name LIKE '%Leak%02%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
            OR op150_status IN ('NG','FAIL','FAILED')
            OR (machine_name LIKE '%02%' AND (overall_status IN ('NG','FAILED') OR op150_status IN ('NG','FAIL')))
          ) THEN 1 ELSE 0 END) as leak02_ng,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02'
            OR leak_data LIKE '%1774%'
            OR machine_name = 'Leak-Test-02'
            OR machine_name LIKE '%Leak%02%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED')
            OR (op150_status IN ('OK','PASSED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%'))
            OR (machine_name = 'Leak-Test-02' AND overall_status IN ('OK','PASSED'))
          ) THEN 1 ELSE 0 END) as leak02_ok,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03'
            OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03'
            OR leak_data LIKE '%1776%'
            OR machine_name = 'Leak Test-03'
            OR machine_name LIKE '%Leak%03%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
            OR op150_status IN ('NG','FAIL','FAILED')
            OR (machine_name LIKE '%03%' AND (overall_status IN ('NG','FAILED') OR op150_status IN ('NG','FAIL')))
          ) THEN 1 ELSE 0 END) as leak03_ng,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03'
            OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03'
            OR leak_data LIKE '%1776%'
            OR machine_name = 'Leak Test-03'
            OR machine_name LIKE '%Leak%03%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED')
            OR (op150_status IN ('OK','PASSED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%'))
            OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('OK','PASSED'))
          ) THEN 1 ELSE 0 END) as leak03_ok,
          SUM(CASE WHEN op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%Final%' AND (overall_status IN ('NG', 'FAILED') OR op160_status IN ('NG','FAIL'))) THEN 1 ELSE 0 END) as op160_ng,
          SUM(CASE WHEN op160_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') OR (machine_name LIKE '%Final%' AND overall_status IN ('OK', 'PASSED')) THEN 1 ELSE 0 END) as op160_ok
        FROM [RICO_IOT].[dbo].[ProductionReports] pr
        ${whereSql}
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] summary agg query error:", err.message);
        return [{}];
      }),

      Promise.all([
        sequelize.query(`SELECT DISTINCT TOP 50 machine_name FROM [RICO_IOT].[dbo].[ProductionReports] WHERE machine_name IS NOT NULL AND machine_name <> '' AND machine_name <> '-'`, { type: sequelize.QueryTypes.SELECT }).catch(() => []),
        sequelize.query(`SELECT DISTINCT TOP 50 part_name FROM [RICO_IOT].[dbo].[ProductionReports] WHERE part_name IS NOT NULL AND part_name <> '' AND part_name <> '-'`, { type: sequelize.QueryTypes.SELECT }).catch(() => []),
        sequelize.query(`SELECT DISTINCT TOP 50 die_name FROM [RICO_IOT].[dbo].[ProductionReports] WHERE die_name IS NOT NULL AND die_name <> '' AND die_name <> '-'`, { type: sequelize.QueryTypes.SELECT }).catch(() => []),
      ]),

      sequelize.query(`
        SELECT 
          COALESCE(NULLIF(die_name, ''), 'UNKNOWN') as dieName,
          COALESCE(NULLIF(die_name, ''), 'UNKNOWN') as die_name,
          COUNT(*) as totalParts,
          COUNT(*) as total_shots,
          -- NG uses the same definition as the NG records (any station NG or a leak-test NG), so leak fails
          -- whose overall_status is still IN_PROGRESS / PASSED are not counted as in-process or OK
          SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) THEN 1 ELSE 0 END) as totalOK,
          SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) THEN 1 ELSE 0 END) as ok_count,
          SUM(CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) as totalNG,
          SUM(CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) as ng_count,
          COUNT(*) - SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) THEN 1 ELSE 0 END) - SUM(CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) as totalWIP,
          ROUND(CASE WHEN SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) OR (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) > 0
            THEN (CAST(SUM(CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) AS FLOAT) / SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) OR (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END)) * 100
            ELSE 0 END, 2) as scrapRate
        FROM [RICO_IOT].[dbo].[ProductionReports]
        ${whereSql ? whereSql + " AND" : "WHERE"} die_name IS NOT NULL AND die_name <> '' AND die_name <> '-'
        GROUP BY COALESCE(NULLIF(die_name, ''), 'UNKNOWN')
        ORDER BY totalNG DESC
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] dieStats query error:", err.message);
        return [];
      }),
    ]);

    const agg = aggregatesRes?.[0] || {};
    const totalParts = Number(agg.totalParts || 0);
    const op160Ok = Number(agg.op160_ok || 0);
    const rawTotalOk = Number(agg.totalOK || 0);
    let totalOK = Math.max(rawTotalOk, op160Ok);
    const totalNG = Number(agg.totalNG || 0);
    // In progress = parts cast in the period still in process; Total = OK + NG + In progress (Dashboard / Historical)
    // same part-status rule as the Dashboard / Historical (PART_OK_SQL) so the in-progress count is identical
    const inProgress = Math.max(0, totalParts - Number(agg.cohortOK ?? rawTotalOk) - totalNG);
    let completedProduction = totalOK + totalNG;
    let rejectRate = completedProduction > 0 ? Number(((totalNG / completedProduction) * 100).toFixed(2)) : 0;

    let qualityGates = [
      { code: "OP100", name: stationLabelMap["OP100"] || "DCM+DPM + OP100", ngCount: Number(agg.op100_ng || 0), okCount: Number(agg.op100_ok || 0) },
      { code: "OP110", name: stationLabelMap["OP110"] || "Laser Marking + OP110", ngCount: Number(agg.op110_ng || 0), okCount: Number(agg.op110_ok || 0) },
      { code: "OP120", name: stationLabelMap["OP120"] || "Casting PDi + OP120", ngCount: Number(agg.op120_ng || 0), okCount: Number(agg.op120_ok || 0) },
      { code: "OP130", name: stationLabelMap["OP130"] || "Pre Inspection + OP130", ngCount: Number(agg.op130_ng || 0), okCount: Number(agg.op130_ok || 0) },
      { code: "OP140", name: stationLabelMap["OP140"] || "Auto Guaging + OP140", ngCount: Number(agg.op140_ng || 0), okCount: Number(agg.op140_ok || 0) },
      { code: "Leak-Test-01", name: "Leak-Test-01 (OP150)", ngCount: Number(agg.leak01_ng || 0), okCount: Number(agg.leak01_ok || 0) },
      { code: "Leak-Test-02", name: "Leak-Test-02 (OP150)", ngCount: Number(agg.leak02_ng || 0), okCount: Number(agg.leak02_ok || 0) },
      { code: "Leak Test-03", name: "Leak Test-03 (OP150)", ngCount: Number(agg.leak03_ng || 0), okCount: Number(agg.leak03_ok || 0) },
      { code: "OP160", name: stationLabelMap["OP160"] || "Final Inspection + OP160", ngCount: Number(agg.op160_ng || 0), okCount: Number(agg.op160_ok || 0) },
    ];

    qualityGates.forEach((gate) => {
      if (stationLabelMap[gate.code]) gate.name = stationLabelMap[gate.code];
    });

    // Station OK / NG as the station sees it (its own scan time in the window) — matches the Historical Report
    // with that station selected and the operator view. The part totals above stay on the first-scan rule.
    const scanCounts = await scanCountsPromise;
    // OK = parts that passed Final Inspection (OP160) in the period, by its scan — also parts cast earlier. The
    // first-scan rows alone gave e.g. 133 OK for a day the line passed 324 at Final (Dashboard / Historical rule).
    if (scanCounts?.OP160 && !ctx.qualityGateFilter && !ctx.statusFilter) {
      totalOK = Math.max(totalOK, Number(scanCounts.OP160.ok || 0));
      completedProduction = totalOK + totalNG;
      rejectRate = completedProduction > 0 ? Number(((totalNG / completedProduction) * 100).toFixed(2)) : 0;
    }
    const totalProductionAll = totalOK + totalNG + inProgress;
    if (scanCounts) {
      qualityGates.forEach((gate) => {
        const c = scanCounts[gate.code];
        if (c) { gate.okCount = c.ok; gate.ngCount = c.ng; }
      });
    }

    qualityGates = qualityGates.map((gate) => {
      const inspected = gate.okCount + gate.ngCount;
      const scrapRate = inspected > 0 ? Number(((gate.ngCount / inspected) * 100).toFixed(2)) : (totalNG > 0 ? Number(((gate.ngCount / totalNG) * 100).toFixed(2)) : 0);
      return { ...gate, inspected, scrapRate };
    });

    const [mRows, pRows, dRows] = filterOptionsRes || [[], [], []];
    const distinctMachines = [...new Set(mRows.map(r => r.machine_name).filter(Boolean))];
    const distinctParts = [...new Set(pRows.map(r => r.part_name).filter(Boolean))];
    const distinctDies = [...new Set(dRows.map(r => r.die_name).filter(Boolean))];

    return res.json({
      success: true,
      window: {
        from: dateFrom,
        to: dateTo,
        dateFrom,
        dateTo,
        shiftCode: shiftCodeFilter || null,
        machineName: machineNameFilter || null,
        partName: partNameFilter || null,
        dieName: dieNameFilter || null,
      },
      summary: {
        totalProduction: totalProductionAll,
        completedProduction,
        totalOK,
        totalNG,
        inProgress,
        rejectRate,
        topHotspotStation: qualityGates.reduce((prev, curr) => (curr.ngCount > prev.ngCount ? curr : prev), qualityGates[0])?.code || "OP120",
        topDriverParameter: "Leak Test Body Value",
      },
      qualityGates,
      dieStats: dieStatsRes || [],
      dieDaily: await dieDailyPromise,
      stationLabels: stationLabelMap,
      filterOptions: {
        machines: distinctMachines,
        parts: distinctParts,
        dies: distinctDies,
        shifts: shifts.map((s) => ({ code: s.shift_code, name: s.shift_name })),
      },
      traceabilityMetrics: {
        traceabilityProduction: totalParts,
        totalProduction: totalProductionAll,
        completedProduction,
        totalOK,
        totalNG,
        inProgress,
        validationRejects: totalNG,
        passRate: completedProduction > 0 ? Number(((totalOK / completedProduction) * 100).toFixed(2)) : 0,
      },
    });
  } catch (error) {
    console.error("[REJECTION] getRejectionSummary error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─── Modular Endpoint 2: Pareto Distribution ─────────────────────────────────
exports.getRejectionPareto = async (req, res) => {
  try {
    const ctx = await buildRejectionFilterContext(req.query);
    const { prWhereSql, replacements } = ctx;

    /* NG of every quality gate = the DECISIVE scan (Historical page / plant sheet rule):
         • OP100–OP140 / OP160: the part's latest OK / NG scan at the station in the window (OperationLogs,
           LEN(part_id) >= 7, BLOCK scans ignored) — NG when that scan is NG; shift and production day = that scan's;
           category / reason / view / zone = that NG scan's own entry
         • OP150 leak test (three machines, not in OperationLogs): ProductionReports.leak_data result NG (the
           part's LATEST leak test decides — a retest OK is OK), at the leak result time, per matched machine — category CRAM
       The page's other widgets (gauges, pies, Pareto, matrix, calendar, KPI NG) use `ngRecords` from here. */
    const PDay = require("../utils/productionDay");
    const ngShifts = ctx.shifts || [];
    const ngRepl = {};
    const logTime = [], leakTime = [];
    if (!ctx.isAllTime) {
      ngRepl.ngFrom = ctx.from.toISOString();
      ngRepl.ngTo = ctx.to.toISOString();
      ngRepl.ngFromL = ctx.from.toISOString().slice(0, 23);
      ngRepl.ngToL = ctx.to.toISOString().slice(0, 23);
      logTime.push("o.createdAt >= CAST(:ngFrom AS datetimeoffset) AND o.createdAt < CAST(:ngTo AS datetimeoffset)");
      leakTime.push("l.leakAt >= CAST(:ngFromL AS datetime2) AND l.leakAt < CAST(:ngToL AS datetime2)");
    }
    const logShiftSql = PDay.shiftCaseSql("d.createdAt", ngShifts);
    const leakShiftSql = PDay.shiftCaseSql("l.leakAt", ngShifts);
    const ngShiftFilter = ctx.shiftCodeFilter && ngShifts.length ? (ngRepl.ngShift = ctx.shiftCodeFilter, true) : false;
    const LEAK_J = (path) => `(CASE WHEN ISJSON(pr.leak_data) = 1 THEN JSON_VALUE(pr.leak_data, '${path}') END)`;
    const [gateNgRows, leakNgRows] = await Promise.all([
      sequelize.query(`
        WITH d AS (
          SELECT o.id, o.part_id, UPPER(o.operation_no) AS op, o.station_no, UPPER(o.result) AS result,
            o.rejection_category, o.rejection_reason, o.rejection_view, o.rejection_zone, o.rejection_remark, o.interlock_reason,
            CAST(o.createdAt AS datetime2) AS createdAt,
            ROW_NUMBER() OVER (PARTITION BY o.part_id, UPPER(o.operation_no) ORDER BY o.createdAt DESC, o.id DESC) AS rn
          FROM [RICO_IOT].[dbo].[OperationLogs] o WITH (NOLOCK)
          WHERE UPPER(o.result) IN ('OK', 'NG') AND LEN(o.part_id) >= 7 AND UPPER(o.operation_no) <> 'OP150'
            ${logTime.length ? `AND ${logTime.join(" AND ")}` : ""}
        )
        SELECT d.id, d.part_id, d.op, d.station_no, d.rejection_category, d.rejection_reason, d.rejection_view, d.rejection_zone,
          d.rejection_remark, d.interlock_reason, d.createdAt, ${logShiftSql} AS shift_code
        FROM d
        WHERE d.rn = 1 AND d.result = 'NG'${ngShiftFilter ? ` AND ${logShiftSql} = :ngShift` : ""}
      `, { replacements: ngRepl, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] Pareto decisive-scan query error:", err.message);
        return [];
      }),
      sequelize.query(`
        WITH l AS (
          SELECT pr.id, pr.part_id, pr.customer_qr, pr.die_name, pr.rejection_reason, pr.ng_reason,
            ${LEAK_J("$.matchedMachineName")} AS machine, ${LEAK_J("$.matchedMachineId")} AS machine_id,
            DATEADD(MINUTE, -${PDay.PLANT_OFFSET_MIN}, TRY_CAST(${LEAK_J("$.cycleEndTime")} AS datetime2)) AS leakAt
          FROM [RICO_IOT].[dbo].[ProductionReports] pr WITH (NOLOCK)
          WHERE ISJSON(pr.leak_data) = 1 AND UPPER(${LEAK_J("$.result")}) IN ('NG', 'FAIL', 'FAILED')
            AND ${PDay.notStaleRowSql("pr.id")}
        )
        SELECT l.*, ${leakShiftSql} AS shift_code FROM l
        WHERE l.leakAt IS NOT NULL${leakTime.length ? ` AND ${leakTime.join(" AND ")}` : ""}${ngShiftFilter ? ` AND ${leakShiftSql} = :ngShift` : ""}
      `, { replacements: ngRepl, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] Pareto leak NG query error:", err.message);
        return [];
      }),
    ]);

    // production day (06:00 → 06:00 plant time) of a UTC timestamp
    const ngDayStart = PDay.dayStartSeconds(ngShifts);
    const ngDayOf = (t) => {
      const ms = new Date(String(t).endsWith("Z") || String(t).includes("+") ? t : `${t}Z`).getTime();
      return Number.isNaN(ms) ? null : new Date(ms + PDay.PLANT_OFFSET_MIN * 60000 - ngDayStart * 1000).toISOString().slice(0, 10);
    };
    const ngIso = (t) => { const ms = new Date(String(t).endsWith("Z") || String(t).includes("+") ? t : `${t}Z`).getTime(); return Number.isNaN(ms) ? null : new Date(ms).toISOString(); };
    const leakCode = (r) => {
      const n = String(r.machine || "");
      const m = n.match(/(\d+)\s*$/);
      return m ? (Number(m[1]) === 3 ? "Leak Test-03" : `Leak-Test-0${Number(m[1])}`) : "Leak-Test-01";
    };
    const ngRecords = [];
    (gateNgRows || []).forEach((r) => {
      ngRecords.push({
        id: `log-${r.id}`, partId: r.part_id, gate: r.op, op: r.op, station: r.station_no || r.op,
        shift: r.shift_code, at: ngIso(r.createdAt), day: ngDayOf(r.createdAt),
        rawCategory: r.rejection_category || "", reason: r.rejection_reason || "", view: r.rejection_view || "",
        zone: r.rejection_zone || "", remark: r.rejection_remark || "", interlock: r.interlock_reason || "",
      });
    });
    (leakNgRows || []).forEach((r) => {
      const why = [r.rejection_reason, r.ng_reason].map((x) => String(x || "")).find((x) => /leak/i.test(x)) || "Pressure Leakage Fail (OP150)";
      ngRecords.push({
        id: `leak-${r.id}`, partId: r.part_id, customerQr: r.customer_qr || "", gate: leakCode(r), op: "OP150", station: r.machine || leakCode(r),
        shift: r.shift_code, at: ngIso(r.leakAt), day: ngDayOf(r.leakAt), dieName: r.die_name || "",
        rawCategory: "CRAM", reason: why, view: "Leak Testing", zone: "Leak Test", remark: "", interlock: "",
      });
    });
    const paretoRows = ngRecords.map((r) => ({
      gateCode: r.gate, rejection_reason: r.reason, rejection_category: r.rawCategory, ng_reason: r.interlock,
      parts_interlock_reason: "", rejection_zone: r.zone, cnt: 1, _rec: r,
    }));

    const parseTextField = (text, label) => {
      if (!text || typeof text !== 'string') return '';
      const m = text.match(new RegExp(label + ':\\s*([^|\\n]+)', 'i'));
      return m ? m[1].trim() : '';
    };

    const normalizeDefectCategory = (rawCat, gate, reason) => {
      // Leak test rejects are casting porosity found after machining → CRAM, whatever category was stored
      if (String(gate || '').toUpperCase().includes('LEAK') || String(gate || '').toUpperCase() === 'OP150' || String(reason || '').toLowerCase().includes('leak')) return 'CRAM';
      let c = String(rawCat || '').trim().toUpperCase();
      if (['CR', 'CASTING', 'CASTING REJECTION'].includes(c)) return 'CR';
      if (['CRAM', 'CR-AM', 'CASTING REJECTION AFTER MACHINING'].includes(c)) return 'CRAM';
      if (['MR', 'MACHINING', 'MACHINING REJECTION'].includes(c)) return 'MR';
      const r = String(reason || '').toLowerCase();
      if (r.includes('blow hole') || r.includes('porosity') || r.includes('face blow hole')) return 'CRAM';
      if (r.includes('gauge') || r.includes('machin') || gate === 'OP140') return 'MR';
      return 'CR';
    };

    const reasonMap = {};
    const categoryMap = {};
    const zoneMap = {};
    const gateDrillMap = {};

    paretoRows.forEach((r) => {
      const cnt = Number(r.cnt || 0);
      const gate = r.gateCode || 'OP120';
      const partsInterlock = String(r.parts_interlock_reason || '').trim();
      const srcText = String(r.ng_reason || r.rejection_reason || partsInterlock || '');
      const parsedReason = parseTextField(partsInterlock, 'Reason') || parseTextField(srcText, 'Reason');
      let rawReason = String(r.rejection_reason || '').trim() || parsedReason || '';
      if (!rawReason && partsInterlock && !partsInterlock.includes('|') && !partsInterlock.includes(':')) {
        rawReason = partsInterlock;
      }
      if (!rawReason || rawReason.toLowerCase().includes('unspecified')) {
        if (gate.includes('Leak') || gate === 'OP150') rawReason = 'Pressure Leak';
        else if (gate === 'OP140') rawReason = 'Gauging Out of Spec';
        else if (gate === 'OP100') rawReason = 'DCM Casting Defect';
        else if (gate === 'OP110') rawReason = 'Laser Mark QR Fail';
        else if (gate === 'OP120') rawReason = 'Casting Visual NG';
        else if (gate === 'OP130') rawReason = 'Pre-Inspection Defect';
        else if (gate === 'OP160') rawReason = 'Final Inspection Reject';
        else rawReason = `${gate} Defect NG`;
      }
      if (rawReason) {
        rawReason = canonicalizeReasonHelper(rawReason);
      }

      const rawCat = String(r.rejection_category || '').trim() || parseTextField(partsInterlock, 'Category') || parseTextField(srcText, 'Category');
      const cat = normalizeDefectCategory(rawCat, gate, rawReason);
      const rawZone = String(r.rejection_zone || '').trim() || parseTextField(partsInterlock, 'Zone') || parseTextField(srcText, 'Zone') || '';
      let zone = splitRejectionZoneHelper(rawZone).zone;
      if (!zone || zone === '-' || zone.toLowerCase().includes('unspecified')) {
        if (gate.includes('Leak') || gate === 'OP150') zone = 'Leak Test';
        else if (gate === 'OP100') zone = 'Zone DCM';
        else if (rawReason.toLowerCase().includes('dent')) zone = 'Zone C';
        else if (rawReason.toLowerCase().includes('blow hole') || rawReason.toLowerCase().includes('porosity')) zone = 'Zone Face';
        else if (rawReason.toLowerCase().includes('non-filling')) zone = 'Zone S';
        else zone = 'Zone General';
      }

      const rawView = parseTextField(partsInterlock, 'View') || parseTextField(srcText, 'View') || '';
      let view = rawView;
      if (!view || view === '-' || view.toLowerCase().includes('unspecified')) {
        if (gate.includes('Leak') || gate === 'OP150') view = 'Top View';
        else if (rawReason.toLowerCase().includes('unclean') || rawReason.toLowerCase().includes('soldering') || rawReason.toLowerCase().includes('porosity')) view = 'Bottom View';
        else view = 'Top View';
      }

      const rawSubZone = parseTextField(partsInterlock, 'Sub Zone') || parseTextField(srcText, 'Sub Zone') || '';
      let subZone = splitRejectionZoneHelper(rawSubZone).subZone;
      if (!subZone || subZone === '-') subZone = rawSubZone;

      if (r._rec) { r._rec.category = cat; r._rec.reasonCanonical = rawReason; }
      reasonMap[rawReason] = (reasonMap[rawReason] || 0) + cnt;
      categoryMap[cat] = (categoryMap[cat] || 0) + cnt;
      zoneMap[zone] = (zoneMap[zone] || 0) + cnt;

      if (!gateDrillMap[gate]) {
        gateDrillMap[gate] = {
          categories: {},
          reasons: {},
          topReasons: {},
          views: {},
          zones: {},
          subZones: {},
        };
      }
      gateDrillMap[gate].categories[cat] = (gateDrillMap[gate].categories[cat] || 0) + cnt;
      if (!gateDrillMap[gate].reasons[cat]) {
        gateDrillMap[gate].reasons[cat] = {};
      }
      gateDrillMap[gate].reasons[cat][rawReason] = (gateDrillMap[gate].reasons[cat][rawReason] || 0) + cnt;
      gateDrillMap[gate].topReasons[rawReason] = (gateDrillMap[gate].topReasons[rawReason] || 0) + cnt;
      if (view) {
        gateDrillMap[gate].views[view] = (gateDrillMap[gate].views[view] || 0) + cnt;
      }
      if (zone && zone !== '-') {
        gateDrillMap[gate].zones[zone] = (gateDrillMap[gate].zones[zone] || 0) + cnt;
      }
      if (subZone && subZone !== '-') {
        gateDrillMap[gate].subZones[subZone] = (gateDrillMap[gate].subZones[subZone] || 0) + cnt;
      }
    });

    const qualityGateDrillDown = {};
    Object.entries(gateDrillMap).forEach(([gate, data]) => {
      const catEntries = Object.entries(data.categories).map(([category, count]) => ({ category, count }));
      const gateTotal = catEntries.reduce((acc, c) => acc + c.count, 0) || 1;
      const categories = catEntries
        .map((c) => ({
          category: c.category,
          count: c.count,
          percentage: Number(((c.count / gateTotal) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.count - a.count);

      const reasonsPerCat = {};
      Object.entries(data.reasons).forEach(([cat, rMap]) => {
        const rEntries = Object.entries(rMap).map(([reason, count]) => ({ reason, count }));
        const catTotal = rEntries.reduce((acc, r) => acc + r.count, 0) || 1;
        reasonsPerCat[cat] = rEntries
          .map((r) => ({
            reason: r.reason,
            count: r.count,
            percentage: Number(((r.count / catTotal) * 100).toFixed(1)),
          }))
          .sort((a, b) => b.count - a.count);
      });

      const topReasons = Object.entries(data.topReasons || {})
        .map(([reason, count]) => ({
          reason,
          count,
          percentage: Number(((count / gateTotal) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.count - a.count);

      const views = Object.entries(data.views || {})
        .map(([name, count]) => ({
          name,
          count,
          percentage: Number(((count / gateTotal) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.count - a.count);

      const zones = Object.entries(data.zones || {})
        .map(([zone, count]) => ({
          zone,
          count,
          percentage: Number(((count / gateTotal) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.count - a.count);

      const subZones = Object.entries(data.subZones || {})
        .map(([subZone, count]) => ({
          subZone,
          count,
          percentage: Number(((count / gateTotal) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.count - a.count);

      qualityGateDrillDown[gate] = {
        categories,
        reasons: reasonsPerCat,
        topReasons,
        views,
        zones,
        subZones,
        total: gateTotal,
      };
    });

    const buildParetoData = (map, labelKey) => {
      const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
      const grandTotal = sorted.reduce((sum, [, val]) => sum + val, 0);
      let cumulative = 0;
      return sorted.map(([item, count]) => {
        cumulative += count;
        const percentage = grandTotal > 0 ? Number(((count / grandTotal) * 100).toFixed(1)) : 0;
        const cumulativePercentage = grandTotal > 0 ? Number(((cumulative / grandTotal) * 100).toFixed(1)) : 0;
        return {
          [labelKey]: item,
          count,
          percentage,
          cumulativePercentage,
        };
      });
    };

    const paretoData = buildParetoData(reasonMap, "reason");
    const categoryPareto = buildParetoData(categoryMap, "category");
    const zonePareto = buildParetoData(zoneMap, "zone");

    return res.json({
      success: true,
      pareto: paretoData,
      categoryPareto,
      zonePareto,
      qualityGateDrillDown,
      // NG per gate × shift and every decisive NG record (one per part per gate) — the page's single NG source
      gateShiftNg: ngRecords.reduce((m, r) => { const g = m[r.gate] || (m[r.gate] = { total: 0 }); g.total += 1; g[r.shift || "UNASSIGNED"] = (g[r.shift || "UNASSIGNED"] || 0) + 1; return m; }, {}),
      // compact: the canonical reason replaces the raw one; the interlock text / raw category are not sent
      ngRecords: ngRecords.map(({ rawCategory: _c, interlock: _i, reasonCanonical, remark, ...r }) => ({
        ...r, reason: reasonCanonical || r.reason, ...(remark ? { remark } : {}),
      })),
      ngSource: "OperationLogs decisive scan (latest OK/NG per part per station) + leak_data NG",
    });
  } catch (error) {
    console.error("[REJECTION] getRejectionPareto error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─── Modular Endpoint 3: Shift Scrap ─────────────────────────────────────────
exports.getRejectionShiftScrap = async (req, res) => {
  try {
    const ctx = await buildRejectionFilterContext(req.query);
    const { replacements, whereSql } = ctx;

    const shiftScrapRes = await sequelize.query(shiftBreakdownSql(ctx), { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
      console.warn("[REJECTION] shift query error:", err.message);
      return [];
    });

    return res.json({
      success: true,
      shiftScrap: shiftScrapRes,
    });
  } catch (error) {
    console.error("[REJECTION] getRejectionShiftScrap error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─── Daily output: final OK / NG / in process per PRODUCTION day ─────────────
// Same filters and the same day rule as every other figure on the page:
//  • production day D = D 06:00:00 → D+1 06:00:00 (Shift A start), so Shift C counts on the day it started
//  • the time that decides the day = the part's first scan; with a station selected, that station's latest scan
//    of the part; with a leak test selected, the leak result time
//  • NG = any station NG or a leak-test NG (same expression as the summary's totalNG) · OK = final pass and not NG
//    · in process = the rest
// Also returns the production day of every NG part, so the client can split NG by station and category using the
// NG records it already holds and land each one on exactly the same day as these totals.
exports.getRejectionDaily = async (req, res) => {
  try {
    const ctx = await buildRejectionFilterContext(req.query);
    const { replacements, whereSql, shifts, isOpGate, isLeakGate } = ctx;
    const PD = require("../utils/productionDay");
    const dayShiftMin = PD.PLANT_OFFSET_MIN - Math.round(PD.dayStartSeconds(shifts) / 60);
    const { timeCol, apply: gateApply } = decidingTimeSql({ isOpGate, isLeakGate });
    const ngExpr = PART_NG_SQL;
    const okExpr = PART_OK_SQL;
    const dayExpr = `CONVERT(char(10), CAST(DATEADD(MINUTE, ${dayShiftMin}, ${timeCol}) AS date), 23)`;
    // shift from the Shift Management timings applied to the same deciding time
    const shiftExpr = shifts.length ? PD.shiftCaseSql(timeCol, shifts) : "COALESCE(NULLIF(pr.shift_code, ''), 'UNASSIGNED')";
    // ?granularity=hour → also split by plant-time hour (0–23) of the deciding time (drill-down into one day)
    const hourly = String(req.query.granularity || "").toLowerCase() === "hour";
    const hourExpr = `DATEPART(HOUR, DATEADD(MINUTE, ${PD.PLANT_OFFSET_MIN}, ${timeCol}))`;
    const base = `
      SELECT pr.id, pr.part_id, pr.customer_qr, ${dayExpr} AS day, ${shiftExpr} AS shift, ${hourExpr} AS hr,
             CASE WHEN ${ngExpr} THEN 1 ELSE 0 END AS is_ng,
             CASE WHEN ${okExpr} THEN 1 ELSE 0 END AS is_ok
      FROM [RICO_IOT].[dbo].[ProductionReports] pr ${gateApply}
      ${whereSql}`;

    const [days, ngParts] = await Promise.all([
      sequelize.query(`
        SELECT day, shift, ${hourly ? "hr," : ""} COUNT(*) AS produced,
               SUM(CASE WHEN is_ng = 0 AND is_ok = 1 THEN 1 ELSE 0 END) AS ok,
               SUM(is_ng) AS ng,
               SUM(CASE WHEN is_ng = 0 AND is_ok = 0 THEN 1 ELSE 0 END) AS wip
        FROM (${base}) x WHERE day IS NOT NULL GROUP BY day, shift${hourly ? ", hr" : ""} ORDER BY day, shift`, { replacements, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(`SELECT id, part_id, customer_qr, day, shift, hr FROM (${base}) x WHERE is_ng = 1 AND day IS NOT NULL`, { replacements, type: sequelize.QueryTypes.SELECT }),
    ]);

    // OK = parts that passed Final Inspection (OP160) in that day / shift (latest OK / NG scan there) — the Dashboard
    // and Historical rule. The first-scan rows only hold parts CAST that day that already finished, so a day showed
    // e.g. 831 OK while Final passed 1,186 and NG % came out too high. Whole line only (no gate / status filter).
    if (!isOpGate && !isLeakGate && !ctx.qualityGateFilter && !ctx.statusFilter && replacements.from && replacements.to) {
      try {
        const okDay = `CONVERT(char(10), CAST(DATEADD(MINUTE, ${dayShiftMin}, createdAt) AS date), 23)`;
        const okShift = shifts.length ? PD.shiftCaseSql("createdAt", shifts) : "'UNASSIGNED'";
        const okHour = `DATEPART(HOUR, DATEADD(MINUTE, ${PD.PLANT_OFFSET_MIN}, createdAt))`;
        const finalRows = await sequelize.query(`
          SELECT ${okDay} AS day, ${okShift} AS shift${hourly ? `, ${okHour} AS hr` : ""}, COUNT(*) AS ok
            FROM (SELECT createdAt, UPPER(result) AS r,
                         ROW_NUMBER() OVER (PARTITION BY part_id ORDER BY createdAt DESC, id DESC) AS rn
                    FROM OperationLogs
                   WHERE (operation_no = 'OP160' OR station_no = 'OP160') AND UPPER(result) IN ('OK', 'NG')
                     AND LEN(part_id) >= 7 AND createdAt >= :from AND createdAt < :to) x
           WHERE rn = 1 AND r = 'OK'${ctx.shiftCodeFilter ? ` AND ${okShift} = :shiftCode` : ""}
           GROUP BY ${okDay}, ${okShift}${hourly ? `, ${okHour}` : ""}`, {
          replacements: { from: replacements.from, to: replacements.to, shiftCode: ctx.shiftCodeFilter || null },
          type: sequelize.QueryTypes.SELECT,
        });
        const keyOf = (r) => `${r.day}|${r.shift}${hourly ? `|${Number(r.hr)}` : ""}`;
        const finalOk = new Map(finalRows.map((r) => [keyOf(r), Number(r.ok) || 0]));
        for (const d of days) {
          const k = keyOf(d);
          d.ok = finalOk.get(k) || 0;
          finalOk.delete(k);
          d.produced = (Number(d.ok) || 0) + (Number(d.ng) || 0) + (Number(d.wip) || 0);
        }
        // days / shifts with Final passes but no part cast in them
        for (const [k, ok] of finalOk) {
          const [day, shift, hr] = k.split("|");
          days.push({ day, shift, ...(hourly ? { hr } : {}), produced: ok, ok, ng: 0, wip: 0 });
        }
        days.sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.shift).localeCompare(String(b.shift)));
      } catch (err) {
        console.warn("[REJECTION] final OK per day failed, using first-scan OK:", err.message);
      }
    }

    return res.json({
      success: true,
      dayRule: {
        dayStart: PD.dayStartSeconds(shifts),
        decidedBy: isOpGate ? "station scan" : isLeakGate ? "leak result" : "first scan",
      },
      // Shift Management timings in seconds of the plant day (end second inclusive) — drawn under the hourly chart
      shiftDefs: (shifts || []).map((sh) => ({ code: sh.shift_code, name: sh.shift_name, start: PD.timeToSeconds(sh.start_time), end: PD.timeToSeconds(sh.end_time) })).filter((sh) => sh.start != null && sh.end != null),
      // one row per production day × shift; the client sums shifts for the day totals
      days: days.map((d) => ({ day: d.day, shift: d.shift, ...(hourly ? { hour: Number(d.hr) } : {}), produced: Number(d.produced) || 0, ok: Number(d.ok) || 0, ng: Number(d.ng) || 0, wip: Number(d.wip) || 0 })),
      ngParts: ngParts.map((p) => [p.id, p.part_id, p.customer_qr, p.day, p.shift, p.hr]),
    });
  } catch (error) {
    console.error("[REJECTION] getRejectionDaily error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─── Modular Endpoint 4: ML Insights & Telemetry ─────────────────────────────
exports.getRejectionMlInsights = async (req, res) => {
  try {
    const ctx = await buildRejectionFilterContext(req.query);
    const { replacements, whereSql, dieNameFilter, partNameFilter, machineNameFilter } = ctx;
    // Root cause / SPC use ONLY parts with DCM shot data: the part's PlcCycleReadings record (shot_number, process
    // parameters and plc_cycle_time = PlcCycleReadings.cycle_time of that shot). The laser-marking cycle time
    // (ProductionReports.cycle_time, from the OP110 log) is never mixed in. Parts without a shot record are
    // excluded and counted in `analysis`.
    const HAS_SHOT_SQL = "(shot_number IS NOT NULL AND plc_cycle_time IS NOT NULL AND plc_cycle_time > 0)";
    const shotWhereSql = whereSql ? `${whereSql} AND ${HAS_SHOT_SQL}` : `WHERE ${HAS_SHOT_SQL}`;

    const [mlTelemetryRes, latestLimitsRes, coverageRes] = await Promise.all([
      sequelize.query(`
        SELECT
          -- 1. Machine Process Parameters (9)
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN plc_cycle_time ELSE NULL END) as plc_cycle_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN plc_cycle_time ELSE NULL END) as plc_cycle_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN plc_cycle_time ELSE NULL END) as plc_cycle_time_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN die_open_core_out_time ELSE NULL END) as die_open_core_out_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN die_open_core_out_time ELSE NULL END) as die_open_core_out_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN die_open_core_out_time ELSE NULL END) as die_open_core_out_time_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN die_close_core_in_time ELSE NULL END) as die_close_core_in_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN die_close_core_in_time ELSE NULL END) as die_close_core_in_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN die_close_core_in_time ELSE NULL END) as die_close_core_in_time_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN ejector_time ELSE NULL END) as ejector_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN ejector_time ELSE NULL END) as ejector_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN ejector_time ELSE NULL END) as ejector_time_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN extract_time ELSE NULL END) as extract_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN extract_time ELSE NULL END) as extract_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN extract_time ELSE NULL END) as extract_time_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN pouring_time ELSE NULL END) as pouring_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN pouring_time ELSE NULL END) as pouring_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN pouring_time ELSE NULL END) as pouring_time_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN shot_fwd_time ELSE NULL END) as shot_fwd_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN shot_fwd_time ELSE NULL END) as shot_fwd_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN shot_fwd_time ELSE NULL END) as shot_fwd_time_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN spray_time ELSE NULL END) as spray_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN spray_time ELSE NULL END) as spray_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN spray_time ELSE NULL END) as spray_time_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN curing_time ELSE NULL END) as curing_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN curing_time ELSE NULL END) as curing_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN curing_time ELSE NULL END) as curing_time_mean_ng,

          -- 2. Product Parameters (22)
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage_he_low_mn ELSE NULL END) as clamp_tonnage_he_low_mn_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage_he_low_mn ELSE NULL END) as clamp_tonnage_he_low_mn_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN clamp_tonnage_he_low_mn ELSE NULL END) as clamp_tonnage_he_low_mn_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage_he_up_pct ELSE NULL END) as clamp_tonnage_he_up_pct_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage_he_up_pct ELSE NULL END) as clamp_tonnage_he_up_pct_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN clamp_tonnage_he_up_pct ELSE NULL END) as clamp_tonnage_he_up_pct_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage_op_low_pct ELSE NULL END) as clamp_tonnage_op_low_pct_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage_op_low_pct ELSE NULL END) as clamp_tonnage_op_low_pct_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN clamp_tonnage_op_low_pct ELSE NULL END) as clamp_tonnage_op_low_pct_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage_op_up_pct ELSE NULL END) as clamp_tonnage_op_up_pct_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage_op_up_pct ELSE NULL END) as clamp_tonnage_op_up_pct_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN clamp_tonnage_op_up_pct ELSE NULL END) as clamp_tonnage_op_up_pct_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN average_die_clamp_tonnage_count ELSE NULL END) as average_die_clamp_tonnage_count_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN average_die_clamp_tonnage_count ELSE NULL END) as average_die_clamp_tonnage_count_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN average_die_clamp_tonnage_count ELSE NULL END) as average_die_clamp_tonnage_count_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN accel_point ELSE NULL END) as accel_point_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN accel_point ELSE NULL END) as accel_point_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN accel_point ELSE NULL END) as accel_point_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN deaccel_point ELSE NULL END) as deaccel_point_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN deaccel_point ELSE NULL END) as deaccel_point_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN deaccel_point ELSE NULL END) as deaccel_point_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage ELSE NULL END) as clamp_tonnage_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_tonnage ELSE NULL END) as clamp_tonnage_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN clamp_tonnage ELSE NULL END) as clamp_tonnage_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_force_pct ELSE NULL END) as clamp_force_pct_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN clamp_force_pct ELSE NULL END) as clamp_force_pct_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN clamp_force_pct ELSE NULL END) as clamp_force_pct_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN furnace_metal_temp ELSE NULL END) as furnace_metal_temp_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN furnace_metal_temp ELSE NULL END) as furnace_metal_temp_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN furnace_metal_temp ELSE NULL END) as furnace_metal_temp_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN metal_pressure ELSE NULL END) as metal_pressure_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN metal_pressure ELSE NULL END) as metal_pressure_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN metal_pressure ELSE NULL END) as metal_pressure_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN intensification_time ELSE NULL END) as intensification_time_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN intensification_time ELSE NULL END) as intensification_time_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN intensification_time ELSE NULL END) as intensification_time_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN intensification_acc_pressure ELSE NULL END) as intensification_acc_pressure_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN intensification_acc_pressure ELSE NULL END) as intensification_acc_pressure_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN intensification_acc_pressure ELSE NULL END) as intensification_acc_pressure_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN stroke ELSE NULL END) as stroke_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN stroke ELSE NULL END) as stroke_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN stroke ELSE NULL END) as stroke_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN time_for_stroke ELSE NULL END) as time_for_stroke_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN time_for_stroke ELSE NULL END) as time_for_stroke_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN time_for_stroke ELSE NULL END) as time_for_stroke_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN shot_acc_pressure ELSE NULL END) as shot_acc_pressure_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN shot_acc_pressure ELSE NULL END) as shot_acc_pressure_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN shot_acc_pressure ELSE NULL END) as shot_acc_pressure_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN biscuit_thickness ELSE NULL END) as biscuit_thickness_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN biscuit_thickness ELSE NULL END) as biscuit_thickness_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN biscuit_thickness ELSE NULL END) as biscuit_thickness_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN v1_speed ELSE NULL END) as v1_speed_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN v1_speed ELSE NULL END) as v1_speed_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN v1_speed ELSE NULL END) as v1_speed_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN v2_speed ELSE NULL END) as v2_speed_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN v2_speed ELSE NULL END) as v2_speed_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN v2_speed ELSE NULL END) as v2_speed_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN v3_speed ELSE NULL END) as v3_speed_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN v3_speed ELSE NULL END) as v3_speed_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN v3_speed ELSE NULL END) as v3_speed_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN v4_speed ELSE NULL END) as v4_speed_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN v4_speed ELSE NULL END) as v4_speed_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN v4_speed ELSE NULL END) as v4_speed_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN vacuum_pressure ELSE NULL END) as vacuum_pressure_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN vacuum_pressure ELSE NULL END) as vacuum_pressure_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN vacuum_pressure ELSE NULL END) as vacuum_pressure_mean_ng,

          -- 3. Flow & Pressure Parameters (9)
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN cooling_water_mov ELSE NULL END) as cooling_water_mov_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN cooling_water_mov ELSE NULL END) as cooling_water_mov_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN cooling_water_mov ELSE NULL END) as cooling_water_mov_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN cooling_water_sta ELSE NULL END) as cooling_water_sta_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN cooling_water_sta ELSE NULL END) as cooling_water_sta_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN cooling_water_sta ELSE NULL END) as cooling_water_sta_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fix_1_flow ELSE NULL END) as fix_1_flow_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fix_1_flow ELSE NULL END) as fix_1_flow_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN fix_1_flow ELSE NULL END) as fix_1_flow_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fix_2_flow ELSE NULL END) as fix_2_flow_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fix_2_flow ELSE NULL END) as fix_2_flow_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN fix_2_flow ELSE NULL END) as fix_2_flow_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fix_3_flow ELSE NULL END) as fix_3_flow_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fix_3_flow ELSE NULL END) as fix_3_flow_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN fix_3_flow ELSE NULL END) as fix_3_flow_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN jet_cooling_pressure ELSE NULL END) as jet_cooling_pressure_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN jet_cooling_pressure ELSE NULL END) as jet_cooling_pressure_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN jet_cooling_pressure ELSE NULL END) as jet_cooling_pressure_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN mov_1_flow ELSE NULL END) as mov_1_flow_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN mov_1_flow ELSE NULL END) as mov_1_flow_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN mov_1_flow ELSE NULL END) as mov_1_flow_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN mov_2_flow ELSE NULL END) as mov_2_flow_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN mov_2_flow ELSE NULL END) as mov_2_flow_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN mov_2_flow ELSE NULL END) as mov_2_flow_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN mov_3_flow ELSE NULL END) as mov_3_flow_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN mov_3_flow ELSE NULL END) as mov_3_flow_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN mov_3_flow ELSE NULL END) as mov_3_flow_mean_ng,

          -- 4. Die Temperature Parameters (5)
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fixed_die_temp_f1 ELSE NULL END) as fixed_die_temp_f1_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fixed_die_temp_f1 ELSE NULL END) as fixed_die_temp_f1_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN fixed_die_temp_f1 ELSE NULL END) as fixed_die_temp_f1_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fixed_die_temp_f2 ELSE NULL END) as fixed_die_temp_f2_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN fixed_die_temp_f2 ELSE NULL END) as fixed_die_temp_f2_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN fixed_die_temp_f2 ELSE NULL END) as fixed_die_temp_f2_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN moving_die_temp_m1 ELSE NULL END) as moving_die_temp_m1_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN moving_die_temp_m1 ELSE NULL END) as moving_die_temp_m1_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN moving_die_temp_m1 ELSE NULL END) as moving_die_temp_m1_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN moving_die_temp_m2 ELSE NULL END) as moving_die_temp_m2_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN moving_die_temp_m2 ELSE NULL END) as moving_die_temp_m2_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN moving_die_temp_m2 ELSE NULL END) as moving_die_temp_m2_mean_ng,
          AVG(CASE WHEN overall_status IN ('OK', 'PASSED') THEN slide_temp_s1 ELSE NULL END) as slide_temp_s1_mean_ok,
          STDEV(CASE WHEN overall_status IN ('OK', 'PASSED') THEN slide_temp_s1 ELSE NULL END) as slide_temp_s1_std_ok,
          AVG(CASE WHEN overall_status IN ('NG', 'FAILED') THEN slide_temp_s1 ELSE NULL END) as slide_temp_s1_mean_ng
        FROM [RICO_IOT].[dbo].[ProductionReports] WITH (NOLOCK)
        ${shotWhereSql}
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] ml telemetry query error:", err.message);
        return [{}];
      }),

      (async () => {
        try {
          let rows = [];
          if (dieNameFilter || partNameFilter || machineNameFilter) {
            const plcWhere = ['(biscuit_thickness_upper_limit IS NOT NULL OR metal_pressure_upper_limit IS NOT NULL)'];
            const plcReplacements = {};
            if (dieNameFilter) {
              plcWhere.push('(part_name = :plcDieName OR part_name LIKE :plcDieLike)');
              plcReplacements.plcDieName = dieNameFilter;
              plcReplacements.plcDieLike = `%${dieNameFilter.replace(/[^a-zA-Z0-9]/g, '%')}%`;
            } else if (partNameFilter) {
              if (partNameFilter.toUpperCase().includes('OIL PAN') || partNameFilter.toUpperCase().includes('K-12') || partNameFilter.toUpperCase().includes('K12')) {
                plcWhere.push('(part_name LIKE :plcK12 OR part_name LIKE :plcOilPan)');
                plcReplacements.plcK12 = '%K12%';
                plcReplacements.plcOilPan = '%OILPAN%';
              } else {
                plcWhere.push('(part_name = :plcPartName OR part_name LIKE :plcPartLike)');
                plcReplacements.plcPartName = partNameFilter;
                plcReplacements.plcPartLike = `%${partNameFilter.replace(/[^a-zA-Z0-9]/g, '%')}%`;
              }
            }
            if (machineNameFilter) {
              plcWhere.push('machine_name = :plcMachineName');
              plcReplacements.plcMachineName = machineNameFilter;
            }
            rows = await sequelize.query(`
              SELECT TOP 1 *
              FROM [RICO_IOT].[dbo].[PlcCycleReadings]
              WHERE ${plcWhere.join(' AND ')}
              ORDER BY id DESC
            `, { replacements: plcReplacements, type: sequelize.QueryTypes.SELECT });
          }
          if (!rows || rows.length === 0) {
            rows = await sequelize.query(`
              SELECT TOP 1 *
              FROM [RICO_IOT].[dbo].[PlcCycleReadings]
              WHERE biscuit_thickness_upper_limit IS NOT NULL OR metal_pressure_upper_limit IS NOT NULL
              ORDER BY id DESC
            `, { type: sequelize.QueryTypes.SELECT });
          }
          return rows;
        } catch (e) {
          console.warn("[REJECTION] latestLimits query error:", e.message);
          return [{}];
        }
      })(),

      // how many parts of the period have DCM shot data (analysed) and how many are excluded
      sequelize.query(`
        SELECT
          SUM(CASE WHEN overall_status IN ('OK', 'PASSED') THEN 1 ELSE 0 END) AS ok_total,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') THEN 1 ELSE 0 END) AS ng_total,
          SUM(CASE WHEN overall_status IN ('OK', 'PASSED') AND ${HAS_SHOT_SQL} THEN 1 ELSE 0 END) AS ok_shot,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND ${HAS_SHOT_SQL} THEN 1 ELSE 0 END) AS ng_shot,
          COUNT(*) AS parts_total,
          SUM(CASE WHEN ${HAS_SHOT_SQL} THEN 1 ELSE 0 END) AS parts_shot
        FROM [RICO_IOT].[dbo].[ProductionReports] WITH (NOLOCK)
        ${whereSql}
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] ml coverage query error:", err.message);
        return [{}];
      }),
    ]);

    const mlRaw = mlTelemetryRes?.[0] || {};
    const limitsRow = latestLimitsRes?.[0] || {};

    // ── 4 USER-SPECIFIED CATEGORIES (Total 45 Parameters) ────────────────────
    const PARAM_SPECS = [
      // 1. Machine Process Parameter — 9
      { sNo: 1, key: "plc_cycle_time", altKeys: ["cycle_time", "cycleTime"], label: "Cycle Time", unit: "sec", defaultLower: null, defaultUpper: null, category: "Machine Process Parameter", icon: "clock" },
      { sNo: 2, key: "die_open_core_out_time", altKeys: ["dieOpenTime", "die_open_time"], label: "Die Open Core Out Time", unit: "sec", defaultLower: null, defaultUpper: null, category: "Machine Process Parameter", icon: "clock" },
      { sNo: 3, key: "die_close_core_in_time", altKeys: ["dieCloseTime", "die_close_time"], label: "Die-Close Core In Time", unit: "sec", defaultLower: null, defaultUpper: null, category: "Machine Process Parameter", icon: "clock" },
      { sNo: 4, key: "ejector_time", altKeys: ["ejectorTime"], label: "Ejector Time", unit: "sec", defaultLower: null, defaultUpper: null, category: "Machine Process Parameter", icon: "clock" },
      { sNo: 5, key: "extract_time", altKeys: ["extractTime"], label: "Extract Time", unit: "sec", defaultLower: null, defaultUpper: null, category: "Machine Process Parameter", icon: "clock" },
      { sNo: 6, key: "pouring_time", altKeys: ["pouringTime"], label: "Pouring Time", unit: "sec", defaultLower: null, defaultUpper: null, category: "Machine Process Parameter", icon: "clock" },
      { sNo: 7, key: "shot_fwd_time", altKeys: ["shotFwdTime"], label: "Shot FWD Time", unit: "sec", defaultLower: null, defaultUpper: null, category: "Machine Process Parameter", icon: "clock" },
      { sNo: 8, key: "spray_time", altKeys: ["sprayTime"], label: "Spray Time", unit: "sec", defaultLower: null, defaultUpper: null, category: "Machine Process Parameter", icon: "droplet" },
      { sNo: 9, key: "curing_time", altKeys: ["curingTime", "cooling_time"], label: "Curing Time (Cooling Time)", unit: "sec", defaultLower: null, defaultUpper: null, category: "Machine Process Parameter", icon: "hourglass" },

      // 2. Product Parameter — 22
      { sNo: 1, key: "clamp_tonnage_he_low_mn", altKeys: ["clamp_tonnage_he_low"], label: "Clamp Tonnage (HE.Low)", unit: "MN", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "shield" },
      { sNo: 2, key: "clamp_tonnage_he_up_pct", altKeys: ["clamp_tonnage_he_up_mn"], label: "Clamp Tonnage (HE.Up)", unit: "%", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "shield" },
      { sNo: 3, key: "clamp_tonnage_op_low_pct", altKeys: ["clamp_tonnage_op_low_mn"], label: "Clamp Tonnage (OP.Low)", unit: "%", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "shield" },
      { sNo: 4, key: "clamp_tonnage_op_up_pct", altKeys: ["clamp_tonnage_op_up_mn"], label: "Clamp Tonnage (OP.Up)", unit: "%", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "shield" },
      { sNo: 5, key: "average_die_clamp_tonnage_count", altKeys: ["averageDieClampTonnageCount"], label: "Average Die Clamp Tonnage Count", unit: "T", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "shield" },
      { sNo: 6, key: "accel_point", altKeys: ["accelPoint"], label: "Accel. Point", unit: "mm", defaultLower: 300.0, defaultUpper: 400.0, category: "Product Parameter", icon: "activity" },
      { sNo: 7, key: "deaccel_point", altKeys: ["deaccelPoint"], label: "Deaccel. Point", unit: "mm", defaultLower: 700.0, defaultUpper: 730.0, category: "Product Parameter", icon: "activity" },
      { sNo: 8, key: "clamp_tonnage", altKeys: ["clampTonnage"], label: "Clamp Tonnage", unit: "T", defaultLower: 550.0, defaultUpper: 650.0, category: "Product Parameter", icon: "shield" },
      { sNo: 9, key: "clamp_force_pct", altKeys: ["clampForcePct"], label: "Clamp Force", unit: "%", defaultLower: 94.0, defaultUpper: 106.0, category: "Product Parameter", icon: "shield" },
      { sNo: 10, key: "furnace_metal_temp", altKeys: ["metalTemp", "metal_temp"], label: "Furnace Metal Temp.", unit: "°C", defaultLower: 640.0, defaultUpper: 680.0, category: "Product Parameter", icon: "thermometer" },
      { sNo: 11, key: "metal_pressure", altKeys: ["metalPressure"], label: "Metal Press.", unit: "MPa", defaultLower: 65.0, defaultUpper: 74.0, category: "Product Parameter", icon: "gauge" },
      { sNo: 12, key: "intensification_time", altKeys: ["intensificationTime", "inten_time"], label: "Inten. Time", unit: "msec", defaultLower: 30.0, defaultUpper: 85.0, category: "Product Parameter", icon: "clock" },
      { sNo: 13, key: "intensification_acc_pressure", altKeys: ["intensificationAccPressure"], label: "Intensification Acc. Pressure", unit: "MPa", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "gauge" },
      { sNo: 14, key: "stroke", altKeys: [], label: "Stroke", unit: "mm", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "activity" },
      { sNo: 15, key: "time_for_stroke", altKeys: ["timeForStroke"], label: "Time for Stroke", unit: "ms", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "clock" },
      { sNo: 16, key: "shot_acc_pressure", altKeys: ["shotAccPressure"], label: "Shot Acc. Pressure", unit: "MPa", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "gauge" },
      { sNo: 17, key: "biscuit_thickness", altKeys: ["biscuitThickness"], label: "Biscuit Thickness", unit: "mm", defaultLower: 20.0, defaultUpper: 30.0, category: "Product Parameter", icon: "layers" },
      { sNo: 18, key: "v1_speed", altKeys: ["v1Speed", "v1"], label: "V1", unit: "m/sec", defaultLower: 0.15, defaultUpper: 0.35, category: "Product Parameter", icon: "zap" },
      { sNo: 19, key: "v2_speed", altKeys: ["v2Speed", "v2"], label: "V2", unit: "m/sec", defaultLower: 0.20, defaultUpper: 0.38, category: "Product Parameter", icon: "zap" },
      { sNo: 20, key: "v3_speed", altKeys: ["v3Speed", "v3"], label: "V3", unit: "m/sec", defaultLower: 2.50, defaultUpper: 3.70, category: "Product Parameter", icon: "zap" },
      { sNo: 21, key: "v4_speed", altKeys: ["v4Speed", "v4"], label: "V4", unit: "m/sec", defaultLower: 3.20, defaultUpper: 4.30, category: "Product Parameter", icon: "zap" },
      { sNo: 22, key: "vacuum_pressure", altKeys: ["vacuumPressure", "vacuum_pressure_mmhg"], label: "Vacuum Pressure", unit: "mbar", defaultLower: null, defaultUpper: null, category: "Product Parameter", icon: "wind" },

      // 3. Flow & Pressure Parameter — 9
      { sNo: 1, key: "cooling_water_mov", altKeys: ["coolingWaterMov"], label: "Cooling Water Flow Rate (Mov.)", unit: "L/min", defaultLower: null, defaultUpper: null, category: "Flow & Pressure Parameter", icon: "droplet" },
      { sNo: 2, key: "cooling_water_sta", altKeys: ["coolingWaterSta"], label: "Cooling Water Flow Rate (Sta.)", unit: "L/min", defaultLower: null, defaultUpper: null, category: "Flow & Pressure Parameter", icon: "droplet" },
      { sNo: 3, key: "fix_1_flow", altKeys: ["fix1Flow"], label: "FIX. 1 Flow", unit: "Lpm", defaultLower: null, defaultUpper: null, category: "Flow & Pressure Parameter", icon: "droplet" },
      { sNo: 4, key: "fix_2_flow", altKeys: ["fix2Flow"], label: "FIX. 2 Flow", unit: "Lpm", defaultLower: null, defaultUpper: null, category: "Flow & Pressure Parameter", icon: "droplet" },
      { sNo: 5, key: "fix_3_flow", altKeys: ["fix3Flow"], label: "FIX. 3 Flow", unit: "Lpm", defaultLower: null, defaultUpper: null, category: "Flow & Pressure Parameter", icon: "droplet" },
      { sNo: 6, key: "jet_cooling_pressure", altKeys: ["jetCoolingPressure"], label: "Jet Cooling Pressure", unit: "kgf/cm²", defaultLower: null, defaultUpper: null, category: "Flow & Pressure Parameter", icon: "droplet" },
      { sNo: 7, key: "mov_1_flow", altKeys: ["mov1Flow"], label: "Mov. 1 Flow", unit: "Lpm", defaultLower: null, defaultUpper: null, category: "Flow & Pressure Parameter", icon: "droplet" },
      { sNo: 8, key: "mov_2_flow", altKeys: ["mov2Flow"], label: "Mov. 2 Flow", unit: "Lpm", defaultLower: null, defaultUpper: null, category: "Flow & Pressure Parameter", icon: "droplet" },
      { sNo: 9, key: "mov_3_flow", altKeys: ["mov3Flow"], label: "Mov. 3 Flow", unit: "Lpm", defaultLower: null, defaultUpper: null, category: "Flow & Pressure Parameter", icon: "droplet" },

      // 4. Die Temperature Parameter — 5
      { sNo: 1, key: "fixed_die_temp_f1", altKeys: ["fixedDieTempF1"], label: "Fixed Die Temp (F-1)", unit: "°C", defaultLower: null, defaultUpper: null, category: "Die Temperature Parameter", icon: "thermometer" },
      { sNo: 2, key: "fixed_die_temp_f2", altKeys: ["fixedDieTempF2"], label: "Fixed Die Temp (F-2)", unit: "°C", defaultLower: null, defaultUpper: null, category: "Die Temperature Parameter", icon: "thermometer" },
      { sNo: 3, key: "moving_die_temp_m1", altKeys: ["movingDieTempM1"], label: "Moving Die Temp (M-1)", unit: "°C", defaultLower: null, defaultUpper: null, category: "Die Temperature Parameter", icon: "thermometer" },
      { sNo: 4, key: "moving_die_temp_m2", altKeys: ["movingDieTempM2"], label: "Moving Die Temp (M-2)", unit: "°C", defaultLower: null, defaultUpper: null, category: "Die Temperature Parameter", icon: "thermometer" },
      { sNo: 5, key: "slide_temp_s1", altKeys: ["slideTempS1"], label: "Slide Temp -1 (S-1)", unit: "°C", defaultLower: null, defaultUpper: null, category: "Die Temperature Parameter", icon: "thermometer" },
    ];

    const featureAnalysis = PARAM_SPECS.map((spec) => {
      const meanOk = Number(mlRaw[`${spec.key}_mean_ok`] || 0);
      const stdOk = Number(mlRaw[`${spec.key}_std_ok`] || 0);
      const meanNg = Number(mlRaw[`${spec.key}_mean_ng`] || 0);

      const delta = meanNg - meanOk;
      const driftPct = meanOk !== 0 ? Number(((delta / Math.abs(meanOk)) * 100).toFixed(2)) : 0;
      const importanceScore = stdOk > 0 ? Math.min(100, Number(((Math.abs(delta) / stdOk) * 20).toFixed(1))) : Math.min(100, Math.abs(driftPct));

      const rawDbUpper = limitsRow?.[ `${spec.key}_upper_limit` ];
      const rawDbLower = limitsRow?.[ `${spec.key}_lower_limit` ];

      const isDummyUpper = Number(rawDbUpper) >= 900 && spec.defaultUpper !== null && spec.defaultUpper < 100;
      const isDummyLower = Number(rawDbLower) <= 0 && spec.defaultLower !== null && spec.defaultLower > 0;

      let dbUpper = (rawDbUpper !== undefined && rawDbUpper !== null && Number(rawDbUpper) > 0 && !isDummyUpper)
        ? Number(rawDbUpper)
        : (spec.defaultUpper !== undefined && spec.defaultUpper !== null ? spec.defaultUpper : null);
      let dbLower = (rawDbLower !== undefined && rawDbLower !== null && Number(rawDbLower) > 0 && !isDummyLower)
        ? Number(rawDbLower)
        : (spec.defaultLower !== undefined && spec.defaultLower !== null ? spec.defaultLower : null);

      // If upper is less than or equal to lower, repair using spec defaults
      if (dbUpper !== null && dbLower !== null && dbUpper <= dbLower) {
        if (spec.defaultUpper !== null && spec.defaultLower !== null && spec.defaultUpper > spec.defaultLower) {
          dbUpper = spec.defaultUpper;
          dbLower = spec.defaultLower;
        }
      }

      // DO NOT invent fake / random limits if none exist!
      const hasStaticLimits = dbUpper !== null && dbLower !== null;
      const aiPredictedSet = meanOk > 0 ? Number(meanOk.toFixed(2)) : null;
      const setPoint = hasStaticLimits
        ? Number(((dbUpper + dbLower) / 2).toFixed(2))
        : null;

      const deltaSetNg = (meanNg > 0 && setPoint !== null) ? Number((meanNg - setPoint).toFixed(2)) : 0;
      const deltaSetNgPct = (setPoint !== null && setPoint !== 0) ? Number(((deltaSetNg / Math.abs(setPoint)) * 100).toFixed(2)) : 0;

      const driftDirection = deltaSetNg > 0.05 ? "UP" : (deltaSetNg < -0.05 ? "DOWN" : "OPTIMAL");
      const usl = dbUpper !== null ? dbUpper : null;
      const lsl = dbLower !== null ? dbLower : null;

      let riskLevel = "LOW";
      if (importanceScore >= 35 || Math.abs(driftPct) > 10) riskLevel = "CRITICAL";
      else if (importanceScore >= 15 || Math.abs(driftPct) > 3) riskLevel = "MODERATE";

      return {
        ...spec,
        hasStaticLimits,
        aiPredictedSet,
        meanOk: Number(meanOk.toFixed(2)),
        stdOk: Number(stdOk.toFixed(2)),
        meanNg: Number(meanNg.toFixed(2)),
        driftPct,
        driftDirection,
        importanceScore,
        setUpperLimit: dbUpper,
        setLowerLimit: dbLower,
        setPoint,
        deltaSetNg,
        deltaSetNgPct,
        usl,
        lsl,
        riskLevel,
      };
    }).sort((a, b) => b.importanceScore - a.importanceScore);

    // Fast query for sample telemetry rows with ALL 45 parameters
    const [sampleRows, anomalyCandidates] = await Promise.all([
      sequelize.query(`
        SELECT * FROM (
          SELECT TOP 1200
            id, part_id as partId, customer_qr as customerQrCode, machine_name as machineName,
            die_name as dieName, shift_code as shiftCode, overall_status as status,
            rejection_category as category, rejection_reason as reason, ng_reason as ngReason,
            shot_number,
            -- 1. Machine Process Parameters (9)
            plc_cycle_time, plc_cycle_time AS cycle_time, die_open_core_out_time, die_close_core_in_time,
            ejector_time, extract_time, pouring_time, shot_fwd_time, spray_time, curing_time,
            -- 2. Product Parameters (22)
            clamp_tonnage_he_low_mn, clamp_tonnage_he_up_pct, clamp_tonnage_op_low_pct, clamp_tonnage_op_up_pct,
            average_die_clamp_tonnage_count, accel_point, deaccel_point, clamp_tonnage, clamp_force_pct,
            furnace_metal_temp, metal_pressure, intensification_time, intensification_acc_pressure,
            stroke, time_for_stroke, shot_acc_pressure, biscuit_thickness,
            v1_speed, v2_speed, v3_speed, v4_speed, vacuum_pressure, vacuum_pressure_mmhg,
            -- 3. Flow & Pressure Parameters (9)
            cooling_water_mov, cooling_water_sta, fix_1_flow, fix_2_flow, fix_3_flow,
            jet_cooling_pressure, mov_1_flow, mov_2_flow, mov_3_flow,
            -- 4. Die Temperature Parameters (5)
            fixed_die_temp_f1, fixed_die_temp_f2, moving_die_temp_m1, moving_die_temp_m2, slide_temp_s1,
            leak_body_leak_value, leak_data, first_scan_at, createdAt
          FROM [RICO_IOT].[dbo].[ProductionReports] WITH (NOLOCK)
          ${whereSql ? whereSql + " AND" : "WHERE"} (overall_status IN ('OK', 'PASSED') OR (overall_status = 'IN_PROGRESS' AND op100_status = 'OK'))
            AND ((part_id IS NOT NULL AND part_id <> '' AND part_id <> '-') OR (customer_qr IS NOT NULL AND customer_qr <> '' AND customer_qr <> '-'))
            AND (
              (metal_pressure IS NOT NULL AND metal_pressure > 0)
              OR (furnace_metal_temp IS NOT NULL AND furnace_metal_temp > 0)
              OR (biscuit_thickness IS NOT NULL AND biscuit_thickness > 0)
              OR (intensification_time IS NOT NULL AND intensification_time > 0)
              OR (v1_speed IS NOT NULL AND v1_speed > 0)
              OR (v3_speed IS NOT NULL AND v3_speed > 0)
              OR (plc_cycle_time IS NOT NULL AND plc_cycle_time > 0)
            )
            AND ${HAS_SHOT_SQL}
          -- finished OK parts first, spread over the whole period (deterministic hash order, not just the newest)
          ORDER BY CASE WHEN overall_status IN ('OK', 'PASSED') THEN 0 ELSE 1 END, ABS(CHECKSUM(id)), id DESC
        ) as okParts
        UNION ALL
        SELECT * FROM (
          SELECT TOP 600
            id, part_id as partId, customer_qr as customerQrCode, machine_name as machineName,
            die_name as dieName, shift_code as shiftCode, overall_status as status,
            rejection_category as category, rejection_reason as reason, ng_reason as ngReason,
            shot_number,
            -- 1. Machine Process Parameters (9)
            plc_cycle_time, plc_cycle_time AS cycle_time, die_open_core_out_time, die_close_core_in_time,
            ejector_time, extract_time, pouring_time, shot_fwd_time, spray_time, curing_time,
            -- 2. Product Parameters (22)
            clamp_tonnage_he_low_mn, clamp_tonnage_he_up_pct, clamp_tonnage_op_low_pct, clamp_tonnage_op_up_pct,
            average_die_clamp_tonnage_count, accel_point, deaccel_point, clamp_tonnage, clamp_force_pct,
            furnace_metal_temp, metal_pressure, intensification_time, intensification_acc_pressure,
            stroke, time_for_stroke, shot_acc_pressure, biscuit_thickness,
            v1_speed, v2_speed, v3_speed, v4_speed, vacuum_pressure, vacuum_pressure_mmhg,
            -- 3. Flow & Pressure Parameters (9)
            cooling_water_mov, cooling_water_sta, fix_1_flow, fix_2_flow, fix_3_flow,
            jet_cooling_pressure, mov_1_flow, mov_2_flow, mov_3_flow,
            -- 4. Die Temperature Parameters (5)
            fixed_die_temp_f1, fixed_die_temp_f2, moving_die_temp_m1, moving_die_temp_m2, slide_temp_s1,
            leak_body_leak_value, leak_data, first_scan_at, createdAt
          FROM [RICO_IOT].[dbo].[ProductionReports] WITH (NOLOCK)
          ${whereSql ? whereSql + " AND" : "WHERE"} (
            overall_status IN ('NG', 'FAILED')
            OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
          )
          AND ((part_id IS NOT NULL AND part_id <> '' AND part_id <> '-') OR (customer_qr IS NOT NULL AND customer_qr <> '' AND customer_qr <> '-'))
          AND (
            (metal_pressure IS NOT NULL AND metal_pressure > 0)
            OR (furnace_metal_temp IS NOT NULL AND furnace_metal_temp > 0)
            OR (biscuit_thickness IS NOT NULL AND biscuit_thickness > 0)
            OR (intensification_time IS NOT NULL AND intensification_time > 0)
            OR (v1_speed IS NOT NULL AND v1_speed > 0)
            OR (v3_speed IS NOT NULL AND v3_speed > 0)
            OR (plc_cycle_time IS NOT NULL AND plc_cycle_time > 0)
          )
          AND ${HAS_SHOT_SQL}
          -- parts rejected overall first, then parts NG at a station that are still in progress
          ORDER BY CASE WHEN overall_status IN ('NG', 'FAILED') THEN 0 ELSE 1 END, id DESC
        ) as ngParts
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] sampleRows query error:", err.message);
        return [];
      }),

      sequelize.query(`
        SELECT TOP 500
          id, part_id as partId, customer_qr as customerQrCode, machine_name as machineName,
          die_name as dieName,
          shift_code as shiftCode, overall_status as status,
          rejection_category as category, rejection_reason as reason, ng_reason as ngReason,
          -- view / zone are not columns: they are parsed from the reject text (ng_reason) where needed
          shot_number,
          metal_pressure, furnace_metal_temp, biscuit_thickness, plc_cycle_time, plc_cycle_time AS cycle_time,
          leak_body_leak_value, first_scan_at, createdAt
        FROM [RICO_IOT].[dbo].[ProductionReports] WITH (NOLOCK)
        ${shotWhereSql} AND overall_status IN ('NG', 'FAILED')
        ORDER BY id DESC
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[Analytics] Unable to fetch anomaly candidates. Adjusting insights threshold.", err.message);
        return [];
      }),
    ]);

    // Calculate worst deviating parameter and Z-score for each anomaly candidate (genuine telemetry only, no fake 2.1 default)
    const topAnomalies = (anomalyCandidates || []).map((row) => {
      let maxZ = 0;
      let worstParam = "";
      let worstLimits = "";

      featureAnalysis.forEach((f) => {
        const val = Number(row[f.key]);
        if (Number.isFinite(val) && val > 0 && f.stdOk > 0 && (f.meanOk > 0 || f.meanNg > 0)) {
          const z = Math.abs(val - f.meanOk) / f.stdOk;
          if (z > maxZ) {
            maxZ = z;
            const sign = val >= f.meanOk ? "+" : "-";
            worstParam = `${f.label} (${val.toFixed(1)} ${f.unit}, ${sign}${z.toFixed(1)}σ)`;
            worstLimits = f.lsl != null && f.usl != null ? `${f.lsl} – ${f.usl} ${f.unit} (Target: ${f.setPoint || '—'})` : `Live Measured (${f.unit})`;
          }
        }
      });

      if (!worstParam) {
        const rReason = row.reason || row.ngReason || (row.parts_interlock_reason ? row.parts_interlock_reason.split('|')[0].trim() : "Quality Gate Rejection");
        worstParam = rReason;
        worstLimits = "Quality Specification Standard";
      }

      return {
        ...row,
        worstDeviatingParam: worstParam,
        worstParamLimits: worstLimits,
        anomalyScore: maxZ > 0 ? Number(maxZ.toFixed(1)) : null,
      };
    });

    // analysed / excluded parts (period population) and the sample handed to the browser
    const cov = coverageRes?.[0] || {};
    const cnt = (v) => Number(v) || 0;
    const statusOf = (r) => String(r?.status || "").trim().toUpperCase();
    const analysis = {
      scope: "Parts with DCM shot data only (PlcCycleReadings record of the part's shot)",
      cycleTimeSource: "PlcCycleReadings.cycle_time of the part's shot (ProductionReports.plc_cycle_time)",
      population: {
        partsTotal: cnt(cov.parts_total),
        partsWithShot: cnt(cov.parts_shot),
        okTotal: cnt(cov.ok_total),
        ngTotal: cnt(cov.ng_total),
        okWithShot: cnt(cov.ok_shot),
        ngWithShot: cnt(cov.ng_shot),
        okExcluded: Math.max(0, cnt(cov.ok_total) - cnt(cov.ok_shot)),
        ngExcluded: Math.max(0, cnt(cov.ng_total) - cnt(cov.ng_shot)),
      },
      sample: {
        ok: (sampleRows || []).filter((r) => ["OK", "PASSED"].includes(statusOf(r))).length,
        ng: (sampleRows || []).filter((r) => !["OK", "PASSED", "IN_PROGRESS"].includes(statusOf(r))).length,
        inProgress: (sampleRows || []).filter((r) => statusOf(r) === "IN_PROGRESS").length,
      },
    };

    return res.json({
      success: true,
      analysis,
      mlInsights: {
        features: featureAnalysis,
        topAnomalies,
        setParams: limitsRow,
        analysis,
      },
      telemetryRows: sampleRows,
      rows: sampleRows,
      setParams: limitsRow,
    });
  } catch (error) {
    console.error("[REJECTION] getRejectionMlInsights error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getRejectionAnalysis = async (req, res) => {
  try {
    const ctx = await buildRejectionFilterContext(req.query);
    const {
      from, to, dateFrom, dateTo, isAllTime, shifts, stationLabelMap,
      machineNameFilter, partNameFilter, dieNameFilter, shiftCodeFilter,
      whereSql, prWhereSql, replacements,
    } = ctx;

    // Run aggregations in parallel without the slow OUTER APPLY
    const [aggregatesRes, shiftScrapRes, paretoRes, dieStatsRes] = await Promise.all([
      sequelize.query(`
        SELECT 
          COUNT(*) as totalParts,
          -- part status: shared definitions (PART_NG_SQL / PART_OK_SQL) — same as the summary and the reports
          SUM(CASE WHEN ${PART_NG_SQL} THEN 0 WHEN ${PART_OK_SQL} THEN 1 ELSE 0 END) as totalOK,
          SUM(CASE WHEN ${PART_NG_SQL} THEN 1 ELSE 0 END) as totalNG,
          SUM(CASE WHEN ${PART_NG_SQL} THEN 0 WHEN ${PART_OK_SQL} THEN 0 ELSE 1 END) as totalInProgress,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND (op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%DCM%' AND overall_status IN ('NG', 'FAILED'))) THEN 1 ELSE 0 END) as op100_ng,
          SUM(CASE WHEN op100_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') OR (machine_name LIKE '%DCM%' AND overall_status IN ('OK', 'PASSED')) THEN 1 ELSE 0 END) as op100_ok,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op110_ng,
          SUM(CASE WHEN op110_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op110_ok,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND (op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%PDi%' AND overall_status IN ('NG', 'FAILED'))) THEN 1 ELSE 0 END) as op120_ng,
          SUM(CASE WHEN op120_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op120_ok,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND (op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%Pre%' AND overall_status IN ('NG', 'FAILED'))) THEN 1 ELSE 0 END) as op130_ng,
          SUM(CASE WHEN op130_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op130_ok,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND (op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR (machine_name LIKE '%Guag%' AND overall_status IN ('NG', 'FAILED'))) THEN 1 ELSE 0 END) as op140_ng,
          SUM(CASE WHEN op140_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op140_ok,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND (
            op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
            OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
            OR (machine_name LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (rejection_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (ng_reason LIKE '%Leak%' AND overall_status IN ('NG', 'FAILED'))
            OR (rejection_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
            OR (ng_reason LIKE '%OP150%' AND overall_status IN ('NG', 'FAILED'))
          ) THEN 1 ELSE 0 END) as op150_ng,
          SUM(CASE WHEN (
            op150_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK')
            OR JSON_VALUE(leak_data, '$.result') IN ('OK', 'PASS', 'PASSED')
            OR (machine_name LIKE '%Leak%' AND overall_status IN ('OK', 'PASSED'))
          ) THEN 1 ELSE 0 END) as op150_ok,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01'
            OR leak_data LIKE '%1773%'
            OR machine_name = 'Leak-Test-01'
            OR machine_name LIKE '%Leak%01%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
            OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%'))
            OR (machine_name = 'Leak-Test-01' AND overall_status IN ('NG','FAILED'))
          ) THEN 1 ELSE 0 END) as leak01_ng,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01'
            OR leak_data LIKE '%1773%'
            OR machine_name = 'Leak-Test-01'
            OR machine_name LIKE '%Leak%01%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED')
            OR (op150_status IN ('OK','PASSED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR leak_data LIKE '%1773%' OR machine_name LIKE '%01%'))
            OR (machine_name = 'Leak-Test-01' AND overall_status IN ('OK','PASSED'))
          ) THEN 1 ELSE 0 END) as leak01_ok,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02'
            OR leak_data LIKE '%1774%'
            OR machine_name = 'Leak-Test-02'
            OR machine_name LIKE '%Leak%02%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
            OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%'))
            OR (machine_name = 'Leak-Test-02' AND overall_status IN ('NG','FAILED'))
          ) THEN 1 ELSE 0 END) as leak02_ng,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02'
            OR leak_data LIKE '%1774%'
            OR machine_name = 'Leak-Test-02'
            OR machine_name LIKE '%Leak%02%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED')
            OR (op150_status IN ('OK','PASSED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR leak_data LIKE '%1774%' OR machine_name LIKE '%02%'))
            OR (machine_name = 'Leak-Test-02' AND overall_status IN ('OK','PASSED'))
          ) THEN 1 ELSE 0 END) as leak02_ok,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03'
            OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03'
            OR leak_data LIKE '%1776%'
            OR machine_name = 'Leak Test-03'
            OR machine_name LIKE '%Leak%03%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('NG','FAIL','FAILED')
            OR (op150_status IN ('NG','FAIL','FAILED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%'))
            OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('NG','FAILED'))
          ) THEN 1 ELSE 0 END) as leak03_ng,
          SUM(CASE WHEN (
            JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak Test-03'
            OR JSON_VALUE(leak_data, '$.matchedMachineName') = 'Leak-Test-03'
            OR leak_data LIKE '%1776%'
            OR machine_name = 'Leak Test-03'
            OR machine_name LIKE '%Leak%03%'
          ) AND (
            JSON_VALUE(leak_data, '$.result') IN ('OK','PASS','PASSED')
            OR (op150_status IN ('OK','PASSED') AND (JSON_VALUE(leak_data, '$.matchedMachineName') LIKE '%03%' OR leak_data LIKE '%1776%' OR machine_name LIKE '%03%'))
            OR (machine_name LIKE '%Leak%03%' AND overall_status IN ('OK','PASSED'))
          ) THEN 1 ELSE 0 END) as leak03_ok,
          SUM(CASE WHEN overall_status IN ('NG', 'FAILED') AND op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') THEN 1 ELSE 0 END) as op160_ng,
          SUM(CASE WHEN op160_status IN ('OK', 'PASSED', 'ENDED_OK', 'COMPLETED_OK') THEN 1 ELSE 0 END) as op160_ok
        FROM [RICO_IOT].[dbo].[ProductionReports] pr
        ${whereSql}
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] agg query error:", err.message);
        return [{}];
      }),

      sequelize.query(shiftBreakdownSql(ctx), { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] shift query error:", err.message);
        return [];
      }),

      sequelize.query(`
        SELECT
          CASE
            WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR pr.leak_data LIKE '%1773%' OR pr.machine_name = 'Leak-Test-01' OR pr.machine_name LIKE '%Leak%01%' THEN 'Leak-Test-01'
            WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR pr.leak_data LIKE '%1774%' OR pr.machine_name = 'Leak-Test-02' OR pr.machine_name LIKE '%Leak%02%' THEN 'Leak-Test-02'
            WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak Test-03' OR JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-03' OR pr.leak_data LIKE '%1776%' OR pr.machine_name = 'Leak Test-03' OR pr.machine_name LIKE '%Leak%03%' THEN 'Leak Test-03'
            WHEN pr.machine_name LIKE '%Leak%' OR pr.op150_status IN ('NG','FAIL','FAILED') OR pr.rejection_reason LIKE '%Leak%' OR pr.ng_reason LIKE '%Leak%' THEN 'Leak-Test-01'
            WHEN pr.op120_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Casting PDi' THEN 'OP120'
            WHEN pr.op130_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Pre Inspection' THEN 'OP130'
            WHEN pr.op140_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Auto Guaging' THEN 'OP140'
            WHEN pr.op100_status IN ('NG','FAIL','FAILED') OR pr.machine_name LIKE '%DCM%' THEN 'OP100'
            WHEN pr.op110_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Laser Marking' THEN 'OP110'
            WHEN pr.op160_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Final Inspection' THEN 'OP160'
            ELSE 'OP120'
          END as gateCode,
          pr.rejection_reason,
          pr.rejection_category,
          pr.ng_reason,
          p.interlock_reason as parts_interlock_reason,
          COUNT(*) as cnt
        FROM [RICO_IOT].[dbo].[ProductionReports] pr
        LEFT JOIN [RICO_IOT].[dbo].[Parts] p ON p.part_id = pr.part_id
        ${prWhereSql ? prWhereSql + " AND" : "WHERE"} (
          pr.overall_status IN ('NG', 'FAILED')
          OR pr.op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
          OR pr.op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
          OR pr.op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
          OR pr.op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
          OR pr.op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
          OR pr.op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
          OR pr.op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG')
          OR (pr.machine_name LIKE '%Leak%' AND pr.overall_status IN ('NG', 'FAILED'))
          OR (pr.rejection_reason LIKE '%Leak%' AND pr.overall_status IN ('NG', 'FAILED'))
          OR (pr.ng_reason LIKE '%Leak%' AND pr.overall_status IN ('NG', 'FAILED'))
          OR JSON_VALUE(pr.leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')
        )
        GROUP BY 
          CASE
            WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-01' OR pr.leak_data LIKE '%1773%' OR pr.machine_name = 'Leak-Test-01' OR pr.machine_name LIKE '%Leak%01%' THEN 'Leak-Test-01'
            WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-02' OR pr.leak_data LIKE '%1774%' OR pr.machine_name = 'Leak-Test-02' OR pr.machine_name LIKE '%Leak%02%' THEN 'Leak-Test-02'
            WHEN JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak Test-03' OR JSON_VALUE(pr.leak_data, '$.matchedMachineName') = 'Leak-Test-03' OR pr.leak_data LIKE '%1776%' OR pr.machine_name = 'Leak Test-03' OR pr.machine_name LIKE '%Leak%03%' THEN 'Leak Test-03'
            WHEN pr.machine_name LIKE '%Leak%' OR pr.op150_status IN ('NG','FAIL','FAILED') OR pr.rejection_reason LIKE '%Leak%' OR pr.ng_reason LIKE '%Leak%' THEN 'Leak-Test-01'
            WHEN pr.op120_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Casting PDi' THEN 'OP120'
            WHEN pr.op130_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Pre Inspection' THEN 'OP130'
            WHEN pr.op140_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Auto Guaging' THEN 'OP140'
            WHEN pr.op100_status IN ('NG','FAIL','FAILED') OR pr.machine_name LIKE '%DCM%' THEN 'OP100'
            WHEN pr.op110_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Laser Marking' THEN 'OP110'
            WHEN pr.op160_status IN ('NG','FAIL','FAILED') OR pr.machine_name = 'Final Inspection' THEN 'OP160'
            ELSE 'OP120'
          END,
          pr.rejection_reason, pr.rejection_category, pr.ng_reason, p.interlock_reason
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] Pareto query error:", err.message);
        return [];
      }),

      sequelize.query(`
        SELECT 
          COALESCE(NULLIF(die_name, ''), 'UNKNOWN') as dieName,
          COALESCE(NULLIF(die_name, ''), 'UNKNOWN') as die_name,
          COUNT(*) as totalParts,
          COUNT(*) as total_shots,
          -- NG uses the same definition as the NG records (any station NG or a leak-test NG), so leak fails
          -- whose overall_status is still IN_PROGRESS / PASSED are not counted as in-process or OK
          SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) THEN 1 ELSE 0 END) as totalOK,
          SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) THEN 1 ELSE 0 END) as ok_count,
          SUM(CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) as totalNG,
          SUM(CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) as ng_count,
          COUNT(*) - SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) THEN 1 ELSE 0 END) - SUM(CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) as totalWIP,
          ROUND(CASE WHEN SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) OR (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) > 0
            THEN (CAST(SUM(CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) AS FLOAT) / SUM(CASE WHEN (overall_status IN ('OK', 'PASSED') AND (CASE WHEN (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END) = 0) OR (overall_status IN ('NG', 'FAILED') OR op100_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op110_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op120_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op130_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op140_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op150_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR op160_status IN ('NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG') OR JSON_VALUE(leak_data, '$.result') IN ('NG', 'FAIL', 'FAILED')) THEN 1 ELSE 0 END)) * 100
            ELSE 0 END, 2) as scrapRate
        FROM [RICO_IOT].[dbo].[ProductionReports]
        ${whereSql ? whereSql + " AND" : "WHERE"} die_name IS NOT NULL AND die_name <> '' AND die_name <> '-'
        GROUP BY COALESCE(NULLIF(die_name, ''), 'UNKNOWN')
        ORDER BY totalNG DESC
      `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
        console.warn("[REJECTION] dieStats query error:", err.message);
        return [];
      }),
    ]);

    const agg = aggregatesRes?.[0] || {};
    const totalParts = Number(agg.totalParts || 0);
    const op160Ok = Number(agg.op160_ok || 0);
    const rawTotalOk = Number(agg.totalOK || 0);
    const totalOK = Math.max(rawTotalOk, op160Ok);
    const totalNG = Number(agg.totalNG || 0);
    const inProgress = Math.max(0, totalParts - totalOK - totalNG);
    const completedProduction = totalOK + totalNG;
    const rejectRate = completedProduction > 0 ? Number(((totalNG / completedProduction) * 100).toFixed(2)) : 0;

    let qualityGates = [
      { code: "OP100", name: stationLabelMap["OP100"] || "DCM+DPM + OP100", ngCount: Number(agg.op100_ng || 0), okCount: Number(agg.op100_ok || 0) },
      { code: "OP110", name: stationLabelMap["OP110"] || "Laser Marking + OP110", ngCount: Number(agg.op110_ng || 0), okCount: Number(agg.op110_ok || 0) },
      { code: "OP120", name: stationLabelMap["OP120"] || "Casting PDi + OP120", ngCount: Number(agg.op120_ng || 0), okCount: Number(agg.op120_ok || 0) },
      { code: "OP130", name: stationLabelMap["OP130"] || "Pre Inspection + OP130", ngCount: Number(agg.op130_ng || 0), okCount: Number(agg.op130_ok || 0) },
      { code: "OP140", name: stationLabelMap["OP140"] || "Auto Guaging + OP140", ngCount: Number(agg.op140_ng || 0), okCount: Number(agg.op140_ok || 0) },
      { code: "Leak-Test-01", name: "Leak-Test-01 (OP150)", ngCount: Number(agg.leak01_ng || 0), okCount: Number(agg.leak01_ok || 0) },
      { code: "Leak-Test-02", name: "Leak-Test-02 (OP150)", ngCount: Number(agg.leak02_ng || 0), okCount: Number(agg.leak02_ok || 0) },
      { code: "Leak Test-03", name: "Leak Test-03 (OP150)", ngCount: Number(agg.leak03_ng || 0), okCount: Number(agg.leak03_ok || 0) },
      { code: "OP160", name: stationLabelMap["OP160"] || "Final Inspection + OP160", ngCount: Number(agg.op160_ng || 0), okCount: Number(agg.op160_ok || 0) },
    ];

    qualityGates.forEach((gate) => {
      if (stationLabelMap[gate.code]) gate.name = stationLabelMap[gate.code];
    });

    qualityGates = qualityGates.map((gate) => {
      const inspected = gate.okCount + gate.ngCount;
      const scrapRate = inspected > 0 ? Number(((gate.ngCount / inspected) * 100).toFixed(2)) : (totalNG > 0 ? Number(((gate.ngCount / totalNG) * 100).toFixed(2)) : 0);
      return { ...gate, inspected, scrapRate };
    });

    const parseTextField = (text, label) => {
      if (!text || typeof text !== 'string') return '';
      const m = text.match(new RegExp(label + ':\\s*([^|\\n]+)', 'i'));
      return m ? m[1].trim() : '';
    };

    const normalizeDefectCategory = (rawCat, gate, reason) => {
      // Leak test rejects are casting porosity found after machining → CRAM, whatever category was stored
      if (String(gate || '').toUpperCase().includes('LEAK') || String(gate || '').toUpperCase() === 'OP150' || String(reason || '').toLowerCase().includes('leak')) return 'CRAM';
      let c = String(rawCat || '').trim().toUpperCase();
      if (['CR', 'CASTING', 'CASTING REJECTION'].includes(c)) return 'CR';
      if (['CRAM', 'CR-AM', 'CASTING REJECTION AFTER MACHINING'].includes(c)) return 'CRAM';
      if (['MR', 'MACHINING', 'MACHINING REJECTION'].includes(c)) return 'MR';
      const r = String(reason || '').toLowerCase();
      if (r.includes('blow hole') || r.includes('porosity') || r.includes('face blow hole')) return 'CRAM';
      if (r.includes('gauge') || r.includes('machin') || gate === 'OP140') return 'MR';
      return 'CR';
    };

    const reasonMap = {};
    const categoryMap = {};
    const zoneMap = {};
    const gateDrillMap = {};

    (paretoRes || []).forEach((r) => {
      const cnt = Number(r.cnt || 0);
      const gate = r.gateCode || 'OP120';
      const partsInterlock = String(r.parts_interlock_reason || '').trim();
      const srcText = String(r.ng_reason || r.rejection_reason || partsInterlock || '');
      const parsedReason = parseTextField(partsInterlock, 'Reason') || parseTextField(srcText, 'Reason');
      let rawReason = String(r.rejection_reason || '').trim() || parsedReason || '';
      if (!rawReason && partsInterlock && !partsInterlock.includes('|') && !partsInterlock.includes(':')) {
        rawReason = partsInterlock;
      }
      if (!rawReason || rawReason.toLowerCase().includes('unspecified')) {
        if (gate.includes('Leak') || gate === 'OP150') rawReason = 'Pressure Leak';
        else if (gate === 'OP140') rawReason = 'Gauging Out of Spec';
        else if (gate === 'OP100') rawReason = 'DCM Casting Defect';
        else if (gate === 'OP110') rawReason = 'Laser Mark QR Fail';
        else if (gate === 'OP120') rawReason = 'Casting Visual NG';
        else if (gate === 'OP130') rawReason = 'Pre-Inspection Defect';
        else if (gate === 'OP160') rawReason = 'Final Inspection Reject';
        else rawReason = `${gate} Defect NG`;
      }
      if (rawReason) {
        rawReason = canonicalizeReasonHelper(rawReason);
      }

      const rawCat = String(r.rejection_category || '').trim() || parseTextField(partsInterlock, 'Category') || parseTextField(srcText, 'Category');
      const cat = normalizeDefectCategory(rawCat, gate, rawReason);
      const rawZone = String(r.rejection_zone || '').trim() || parseTextField(partsInterlock, 'Zone') || parseTextField(srcText, 'Zone') || '';
      let zone = splitRejectionZoneHelper(rawZone).zone;
      if (!zone || zone === '-' || zone.toLowerCase().includes('unspecified')) {
        if (gate.includes('Leak') || gate === 'OP150') zone = 'Leak Test';
        else if (gate === 'OP100') zone = 'Zone DCM';
        else if (rawReason.toLowerCase().includes('dent')) zone = 'Zone C';
        else if (rawReason.toLowerCase().includes('blow hole') || rawReason.toLowerCase().includes('porosity')) zone = 'Zone Face';
        else if (rawReason.toLowerCase().includes('non-filling')) zone = 'Zone S';
        else zone = 'Zone General';
      }

      reasonMap[rawReason] = (reasonMap[rawReason] || 0) + cnt;
      categoryMap[cat] = (categoryMap[cat] || 0) + cnt;
      zoneMap[zone] = (zoneMap[zone] || 0) + cnt;

      if (!gateDrillMap[gate]) {
        gateDrillMap[gate] = { categories: {}, reasons: {} };
      }
      gateDrillMap[gate].categories[cat] = (gateDrillMap[gate].categories[cat] || 0) + cnt;
      if (!gateDrillMap[gate].reasons[cat]) {
        gateDrillMap[gate].reasons[cat] = {};
      }
      gateDrillMap[gate].reasons[cat][rawReason] = (gateDrillMap[gate].reasons[cat][rawReason] || 0) + cnt;
    });

    const qualityGateDrillDown = {};
    Object.entries(gateDrillMap).forEach(([gate, data]) => {
      const catEntries = Object.entries(data.categories).map(([category, count]) => ({ category, count }));
      const gateTotal = catEntries.reduce((acc, c) => acc + c.count, 0) || 1;
      const categories = catEntries
        .map((c) => ({
          category: c.category,
          count: c.count,
          percentage: Number(((c.count / gateTotal) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.count - a.count);

      const reasonsPerCat = {};
      Object.entries(data.reasons).forEach(([cat, rMap]) => {
        const rEntries = Object.entries(rMap).map(([reason, count]) => ({ reason, count }));
        const catTotal = rEntries.reduce((acc, r) => acc + r.count, 0) || 1;
        reasonsPerCat[cat] = rEntries
          .map((r) => ({
            reason: r.reason,
            count: r.count,
            percentage: Number(((r.count / catTotal) * 100).toFixed(1)),
          }))
          .sort((a, b) => b.count - a.count);
      });

      qualityGateDrillDown[gate] = { categories, reasons: reasonsPerCat, total: gateTotal };
    });

    const buildParetoData = (map, labelKey) => {
      const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
      const grandTotal = sorted.reduce((sum, [, val]) => sum + val, 0);
      let cumulative = 0;
      return sorted.map(([item, count]) => {
        cumulative += count;
        const percentage = grandTotal > 0 ? Number(((count / grandTotal) * 100).toFixed(1)) : 0;
        const cumulativePercentage = grandTotal > 0 ? Number(((cumulative / grandTotal) * 100).toFixed(1)) : 0;
        return {
          [labelKey]: item,
          count,
          percentage,
          cumulativePercentage,
        };
      });
    };

    const paretoData = buildParetoData(reasonMap, "reason");
    const categoryPareto = buildParetoData(categoryMap, "category");
    const zonePareto = buildParetoData(zoneMap, "zone");

    return res.json({
      success: true,
      window: {
        from: dateFrom,
        to: dateTo,
        dateFrom,
        dateTo,
        shiftCode: shiftCodeFilter || null,
        machineName: machineNameFilter || null,
        partName: partNameFilter || null,
        dieName: dieNameFilter || null,
      },
      summary: {
        totalProduction: totalParts,
        completedProduction,
        totalOK,
        totalNG,
        inProgress,
        rejectRate,
        topHotspotStation: qualityGates.reduce((prev, curr) => (curr.ngCount > prev.ngCount ? curr : prev), qualityGates[0])?.code || "OP120",
        topDriverParameter: "Furnace Metal Temp",
      },
      qualityGates,
      dieStats: dieStatsRes || [],
      qualityGateDrillDown,
      stationLabels: stationLabelMap,
      mlInsights: { features: [], topAnomalies: [], setParams: {} },
      setParams: {},
      pareto: paretoData,
      categoryPareto,
      zonePareto,
      shiftScrap: shiftScrapRes,
      rows: [],
      filterOptions: {
        machines: [],
        parts: [],
        dies: [],
        shifts: shifts.map((s) => ({ code: s.shift_code, name: s.shift_name })),
      },
      traceabilityMetrics: {
        traceabilityProduction: totalParts,
        totalProduction: totalParts,
        completedProduction,
        totalOK,
        totalNG,
        inProgress,
        validationRejects: totalNG,
        passRate: completedProduction > 0 ? Number(((totalOK / completedProduction) * 100).toFixed(2)) : 0,
      },
      total: totalNG,
      rowCount: 0,
      reportTotalNG: totalNG,
      productionTotal: totalParts,
    });
  } catch (error) {
    console.error("[REJECTION] getRejectionAnalysis controller error:", error);
    res.status(500).json({ error: error.message });
  }
};

// ─── Fast Dedicated Rows Endpoint ────────────────────────────────────────────
// GET /rejection-rows  — returns paginated NG records quickly without heavy ML
exports.getRejectionRows = async (req, res) => {
  try {
    const {
      page = 1, pageSize = 100,
      search,
    } = req.query;

    const pgNum = Math.max(1, parseInt(page, 10) || 1);
    const pgSize = Math.min(10000, Math.max(10, parseInt(pageSize, 10) || 100));
    const offset = (pgNum - 1) * pgSize;

    // Use unified filter context so getRejectionRows is 100% synchronized with getRejectionSummary
    const queryWithNgDefault = {
      ...req.query,
      status: req.query.status || "NG",
    };
    const ctx = await buildRejectionFilterContext(queryWithNgDefault);
    const { whereConditions, replacements, expandGateTime } = ctx;

    if (search && typeof search === 'string' && search.trim()) {
      // plain column names: the prefixing below adds pr. (pre-written pr.[x] became the invalid pr.pr.[x])
      whereConditions.push(`(
        part_id LIKE :searchTerm
        OR customer_qr LIKE :searchTerm
        OR ng_reason LIKE :searchTerm
        OR rejection_reason LIKE :searchTerm
        OR rejection_category LIKE :searchTerm
        OR machine_name LIKE :searchTerm
        OR die_name LIKE :searchTerm
      )`);
      replacements.searchTerm = `%${search.trim()}%`;
    }

    const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const prWhereSql = whereSql ? expandGateTime(whereSql
      .replace(/\[(\w+)\]/g, '$1')
      .replace(/\b(part_id|customer_qr|createdAt|updatedAt|first_scan_at|final_scan_at|shift_code|machine_name|die_name|part_name|rejection_category|rejection_reason|ng_reason|overall_status|op100_status|op110_status|op120_status|op130_status|op140_status|op150_status|op160_status|leak_data)\b/g, 'pr.[$1]'), true)
      : '';

    const [countRes] = await sequelize.query(
      `SELECT COUNT(*) as total FROM [RICO_IOT].[dbo].[ProductionReports] pr ${prWhereSql}`,
      { replacements, type: sequelize.QueryTypes.SELECT }
    ).catch(() => [{ total: 0 }]);

    const total = Number(countRes?.total || 0);

    const rows = await sequelize.query(`
      SELECT
        pr.[id],
        pr.[part_id],
        pr.[customer_qr], pr.[part_name], pr.[die_name], pr.[machine_name], pr.[shift_code],
        pr.[overall_status], pr.[first_scan_at], pr.[final_scan_at], pr.[ng_reason], pr.[rejection_category],
        pr.[rejection_reason],
        pr.[cycle_time],
        pr.[createdAt], pr.[updatedAt],
        pr.[op100_status], pr.[op110_status], pr.[op120_status], pr.[op130_status], pr.[op140_status], pr.[op150_status], pr.[op160_status],
        pr.[shot_number], 
        pr.[plc_cycle_time], 
        pr.[die_close_core_in_time], 
        pr.[pouring_time], 
        pr.[shot_fwd_time], 
        pr.[curing_time],
        pr.[die_open_core_out_time], 
        pr.[ejector_time], 
        pr.[extract_time], 
        pr.[spray_time], 
        pr.[v1_speed], 
        pr.[v2_speed], 
        pr.[v3_speed], 
        pr.[v4_speed],
        pr.[metal_pressure], 
        pr.[furnace_metal_temp], 
        pr.[cooling_water_mov], 
        pr.[cooling_water_sta], 
        pr.[accel_point], 
        pr.[deaccel_point],
        pr.[intensification_time], 
        pr.[biscuit_thickness], 
        pr.[jet_cooling_pressure], 
        pr.[clamp_tonnage_he_low_pct], 
        pr.[clamp_tonnage_he_low_mn],
        pr.[clamp_tonnage_op_up_pct], 
        pr.[clamp_tonnage_op_low_pct], 
        pr.[clamp_tonnage_he_up_pct], 
        pr.[vacuum_pressure], 
        pr.[clamp_force_pct],
        pr.[clamp_tonnage], 
        pr.[shot_acc_pressure], 
        pr.[intensification_acc_pressure], 
        pr.[fixed_die_temp_f1], 
        pr.[fixed_die_temp_f2],
        pr.[moving_die_temp_m1], 
        pr.[moving_die_temp_m2], 
        pr.[slide_temp_s1], 
        pr.[fix_1_flow], 
        pr.[fix_2_flow], 
        pr.[fix_3_flow],
        pr.[mov_1_flow], 
        pr.[mov_2_flow], 
        pr.[mov_3_flow], 
        pr.[vacuum_pressure_mmhg], 
        pr.[average_die_clamp_tonnage_count],
        pr.[time_for_stroke], 
        pr.[stroke], 
        pr.[shot_status], 
        pr.[leak_body_leak_value], pr.[leak_gall_1], pr.[leak_gall_2],
        pr.[leak_cycle_time], pr.[leak_running_mode], pr.[leak_dry_wey_both],
        pr.[leak_data],
        p.[interlock_reason] as parts_interlock_reason
      FROM [RICO_IOT].[dbo].[ProductionReports] pr
      LEFT JOIN [RICO_IOT].[dbo].[Parts] p ON p.part_id = pr.part_id
      ${prWhereSql}
      ORDER BY pr.id DESC
      OFFSET ${offset} ROWS FETCH NEXT ${pgSize} ROWS ONLY
    `, { replacements, type: sequelize.QueryTypes.SELECT }).catch((err) => {
      console.warn('[REJECTION ROWS] query error:', err.message);
      return [];
    });

    // Fast batch enrichment for casting parameters if missing on current page
    if (rows.length > 0 && rows.some((r) => r.metal_pressure == null)) {
      const keysToLookup = [
        ...new Set(
          rows
            .filter((r) => r.metal_pressure == null && (r.customer_qr || r.part_id))
            .flatMap((r) => [r.customer_qr, r.part_id])
            .filter((k) => k && k !== '-' && !String(k).startsWith('R437'))
        ),
      ].slice(0, 100);

      if (keysToLookup.length > 0) {
        const castRows = await sequelize.query(`
          SELECT TOP 200
            part_id, customer_qr, die_name, machine_name, part_name,
            metal_pressure, furnace_metal_temp, biscuit_thickness,
            shot_number, plc_cycle_time, cycle_time
          FROM [RICO_IOT].[dbo].[ProductionReports]
          WHERE (customer_qr IN (:keys) OR part_id IN (:keys))
            AND metal_pressure IS NOT NULL
          ORDER BY id DESC
        `, { replacements: { keys: keysToLookup }, type: sequelize.QueryTypes.SELECT }).catch(() => []);

        if (castRows.length > 0) {
          const castMap = new Map();
          castRows.forEach((c) => {
            if (c.customer_qr && !castMap.has(c.customer_qr)) castMap.set(c.customer_qr, c);
            if (c.part_id && !castMap.has(c.part_id)) castMap.set(c.part_id, c);
          });

          rows.forEach((r) => {
            const matched = (r.customer_qr && castMap.get(r.customer_qr)) || (r.part_id && castMap.get(r.part_id));
            if (matched) {
              if (r.metal_pressure == null) {
                r.metal_pressure = matched.metal_pressure;
                r.furnace_metal_temp = r.furnace_metal_temp ?? matched.furnace_metal_temp;
                r.biscuit_thickness = r.biscuit_thickness ?? matched.biscuit_thickness;
                r.shot_number = r.shot_number ?? matched.shot_number;
                r.plc_cycle_time = r.plc_cycle_time ?? matched.plc_cycle_time;
                r.cycle_time = r.cycle_time ?? matched.cycle_time;
              }
              if (!r.die_name || r.die_name === '-') r.die_name = matched.die_name || '';
              if (!r.machine_name || r.machine_name === '-') r.machine_name = matched.machine_name || '';
              if (!r.part_name || r.part_name === '-') r.part_name = matched.part_name || '';
            }
          });
        }
      }
    }

    const parseTextField = (text, label) => {
      if (!text || typeof text !== 'string') return '';
      const m = text.match(new RegExp(label + ':\\s*([^|\\n]+)', 'i'));
      return m ? m[1].trim() : '';
    };
    const looksLikeQr = (val) => {
      if (!val || typeof val !== 'string') return false;
      const s = val.trim();
      return /^R\d{3,}/i.test(s) || /^[A-Z0-9-]{24,}$/i.test(s) || s.includes('+') || s.includes('/');
    };

    const formatted = rows.map((row, idx) => {
      let parsedLeak = null;
      if (row.leak_data) {
        try {
          parsedLeak = typeof row.leak_data === 'string' ? JSON.parse(row.leak_data) : row.leak_data;
        } catch(e) {}
      }
      const isLeakResultNg = parsedLeak && ['NG', 'FAIL', 'FAILED'].includes(String(parsedLeak.result || parsedLeak.Raw_Result || parsedLeak.rawResult || '').trim().toUpperCase());
      const leakMachine = parsedLeak?.matchedMachineName || parsedLeak?.machineName || (String(row.machine_name || '').toLowerCase().includes('leak') ? row.machine_name : 'Leak-Test-01');
      const bodyLeak = parsedLeak?.bodyLeakValue || parsedLeak?.Body_Leak_Value || parsedLeak?.body_leak_value || row.leak_body_leak_value;

      const isOp150Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op150_status || '').trim().toUpperCase())
        || isLeakResultNg
        || (String(row.machine_name || '').toLowerCase().includes('leak') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()))
        || (String(row.rejection_reason || '').toLowerCase().includes('leak') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()))
        || (String(row.ng_reason || '').toLowerCase().includes('leak') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()));

      const isOp100Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op100_status || '').trim().toUpperCase())
        || (String(row.machine_name || '').toLowerCase().includes('dcm') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()));
      const isOp110Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op110_status || '').trim().toUpperCase());
      const isOp120Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op120_status || '').trim().toUpperCase())
        || (String(row.machine_name || '').toLowerCase().includes('pdi') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()));
      const isOp130Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op130_status || '').trim().toUpperCase())
        || (String(row.machine_name || '').toLowerCase().includes('pre') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()));
      const isOp140Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op140_status || '').trim().toUpperCase())
        || (String(row.machine_name || '').toLowerCase().includes('guag') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()));
      const isOp160Ng = ['NG', 'FAIL', 'FAILED', 'ENDED_NG', 'COMPLETED_NG'].includes(String(row.op160_status || '').trim().toUpperCase())
        || (String(row.machine_name || '').toLowerCase().includes('final') && ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase()));

      const isConfirmedNg = ['NG', 'FAILED'].includes(String(row.overall_status || '').trim().toUpperCase())
        || isOp100Ng || isOp110Ng || isOp120Ng || isOp130Ng || isOp140Ng || isOp150Ng || isOp160Ng;

      const ngGates = ['100','110','120','130','140','150','160']
        .filter((op) => {
          if (op === '150') return isOp150Ng;
          if (op === '100') return isOp100Ng;
          if (op === '110') return isOp110Ng;
          if (op === '120') return isOp120Ng;
          if (op === '130') return isOp130Ng;
          if (op === '140') return isOp140Ng;
          if (op === '160') return isOp160Ng;
          return ['NG','FAIL','FAILED','ENDED_NG','COMPLETED_NG'].includes(String(row[`op${op}_status`]||'').trim().toUpperCase());
        })
        .map((op) => `OP${op}`);

      let primaryNgStation = '';
      if (isOp120Ng) primaryNgStation = 'Casting PDi (OP120)';
      else if (isOp130Ng) primaryNgStation = 'Pre Inspection (OP130)';
      else if (isOp150Ng) primaryNgStation = `${leakMachine} (OP150)`;
      else if (isOp140Ng) primaryNgStation = 'Auto Guaging (OP140)';
      else if (isOp100Ng) primaryNgStation = 'DCM+DPM (OP100)';
      else if (isOp110Ng) primaryNgStation = 'Laser Marking (OP110)';
      else if (isOp160Ng) primaryNgStation = 'Final Inspection (OP160)';
      else if (isConfirmedNg) primaryNgStation = row.machine_name || 'OP120';

      const partsInterlock = String(row.parts_interlock_reason || '').trim();
      const srcText = String(row.ng_reason || row.rejection_reason || partsInterlock || '');
      let rejCategory = String(row.rejection_category || '').trim() || parseTextField(partsInterlock, 'Category') || parseTextField(srcText, 'Category') || '';
      const parsedReason = parseTextField(partsInterlock, 'Reason') || parseTextField(srcText, 'Reason');
      let rejReason = String(row.rejection_reason || '').trim() || parsedReason || '';
      if (!rejReason && partsInterlock && !partsInterlock.includes('|') && !partsInterlock.includes(':')) {
        rejReason = partsInterlock;
      }
      if (!rejReason && ngGates.length > 0) {
        rejReason = `${ngGates.join(', ')} NG`;
      }

      let rejView = String(row.rejection_view || '').trim() || parseTextField(partsInterlock, 'View') || parseTextField(srcText, 'View') || '';
      const rawZone = String(row.rejection_zone || '').trim() || parseTextField(partsInterlock, 'Zone') || parseTextField(srcText, 'Zone') || '';
      const zoneParts = splitRejectionZoneHelper(rawZone);
      let rejZone = zoneParts.zone || '';
      let rejSubZone = String(row.rejection_sub_zone || '').trim() || zoneParts.subZone || (parseTextField(partsInterlock, 'Sub Zone') || parseTextField(partsInterlock, 'SubZone') || parseTextField(srcText, 'Sub Zone') || parseTextField(srcText, 'SubZone') || '');

      if (isConfirmedNg) {
        if (isOp150Ng && (!isOp120Ng && !isOp130Ng && !isOp100Ng)) {
          // leak test = casting porosity found after machining → CRAM (overrides a stored MR)
          rejCategory = 'CRAM';
          if (!rejReason || rejReason.toLowerCase().includes('op150') || rejReason.toLowerCase().includes('quality gate') || rejReason.toLowerCase().includes('unspecified')) {
            rejReason = bodyLeak ? `Body Leak Fail (${bodyLeak} bar)` : 'Pressure Leakage Fail (OP150)';
          }
          if (!rejView) rejView = 'Leak Testing';
          if (!rejZone) rejZone = 'Leak Test';
        } else if (isOp130Ng && (!isOp120Ng && !isOp100Ng)) {
          if (!rejCategory) rejCategory = 'CRAM';
          if (!rejReason || rejReason.toLowerCase().includes('quality gate') || rejReason.toLowerCase().includes('unspecified')) rejReason = 'Pre-Inspection Visual NG';
          if (!rejView) rejView = 'Front';
          if (!rejZone) rejZone = 'Zone General';
        } else if (isOp120Ng && !isOp100Ng) {
          if (!rejCategory) rejCategory = 'CR';
          if (!rejReason || rejReason.toLowerCase().includes('quality gate') || rejReason.toLowerCase().includes('unspecified')) rejReason = 'Casting Visual NG';
          if (!rejView) rejView = 'Front';
          if (!rejZone) rejZone = 'Zone General';
        } else if (isOp140Ng) {
          if (!rejCategory) rejCategory = 'MR';
          if (!rejReason || rejReason.toLowerCase().includes('quality gate') || rejReason.toLowerCase().includes('unspecified')) rejReason = 'Auto Guaging Dimension NG';
          if (!rejView) rejView = 'Guaging View';
          if (!rejZone) rejZone = 'Zone Guaging';
        } else if (isOp100Ng) {
          if (!rejCategory) rejCategory = 'CR';
          if (!rejReason || rejReason.toLowerCase().includes('quality gate') || rejReason.toLowerCase().includes('unspecified')) rejReason = 'DCM Casting Defect';
          if (!rejZone) rejZone = 'Zone DCM';
        }
      } else {
        if (rejReason && rejReason.toLowerCase().includes('quality gate ng')) {
          rejReason = '';
        }
      }

      if (rejReason) {
        rejReason = canonicalizeReasonHelper(rejReason);
      }
      if (!rejZone || rejZone === '-' || rejZone.toLowerCase().includes('unspecified')) {
        if (isOp150Ng) rejZone = 'Leak Test';
        else if (isOp100Ng) rejZone = 'Zone DCM';
        else if (isConfirmedNg) rejZone = 'Zone General';
        else rejZone = '';
      }

      const rawPartId     = String(row.part_id     || '').trim();
      const rawCustomerQr = String(row.customer_qr || '').trim();
      let displayPartId = '';
      let displayCustomerQr = rawCustomerQr;
      if (rawPartId && !looksLikeQr(rawPartId) && rawPartId !== rawCustomerQr) displayPartId = rawPartId;
      else if (rawPartId && looksLikeQr(rawPartId) && !displayCustomerQr) displayCustomerQr = rawPartId;

      // Shot details and shot numbers MUST ONLY come from casting Part IDs (displayPartId)
      let extractedShot = '';
      let normalizedShotStatus = '';
      if (displayPartId) {
        extractedShot = extractShotFromPartIdHelper(displayPartId);
      }
      if (!extractedShot && row.shot_number && row.shot_number !== '-') {
        extractedShot = String(row.shot_number).trim();
      }
      if (extractedShot) {
        normalizedShotStatus = normalizeShotStatusHelper(row.shot_status, row.overall_status, row.op100_status, extractedShot);
      }

      return {
        id: row.id,
        rowKey: row.id || `r-${idx}`,
        shot_number: extractedShot,
        shotNumber: extractedShot,
        shot_status: normalizedShotStatus,
        shotStatus: normalizedShotStatus,
        partId: displayPartId || rawPartId,
        part_id: displayPartId || rawPartId,
        customerQrCode: displayCustomerQr || rawCustomerQr,
        customer_qr: displayCustomerQr || rawCustomerQr,
        machineName: row.machine_name && row.machine_name !== '-' ? row.machine_name : (primaryNgStation || ''),
        machine_name: row.machine_name && row.machine_name !== '-' ? row.machine_name : (primaryNgStation || ''),
        ngStation: primaryNgStation || row.machine_name || '',
        ng_station: primaryNgStation || row.machine_name || '',
        dieName: row.die_name && row.die_name !== '-' ? row.die_name : '',
        die_name: row.die_name && row.die_name !== '-' ? row.die_name : '',
        partName: row.part_name || 'OIL PAN K-12',
        part_name: row.part_name || 'OIL PAN K-12',
        shiftCode: row.shift_code || 'UNASSIGNED',
        shift_code: row.shift_code || 'UNASSIGNED',
        status: isConfirmedNg ? 'NG' : (row.overall_status || 'OK'),
        overall_status: isConfirmedNg ? 'NG' : (row.overall_status || 'OK'),
        op100_status: isOp100Ng ? 'NG' : (row.op100_status || ''),
        op110_status: row.op110_status || '',
        op120_status: row.op120_status || '',
        op130_status: row.op130_status || '',
        op140_status: row.op140_status || '',
        op150_status: isOp150Ng ? 'NG' : (row.op150_status || ''),
        op160_status: row.op160_status || '',
        isOp150Ng,
        isLeakNg: isOp150Ng,
        ngGate: ngGates.join(', ') || '',
        ng_gate: ngGates.join(', ') || '',
        category: rejCategory !== '-' ? rejCategory : '',
        rejection_category: rejCategory !== '-' ? rejCategory : '',
        reason: rejReason !== '-' ? rejReason : '',
        rejection_reason: rejReason !== '-' ? rejReason : '',
        ngReason: srcText || rejReason,
        ng_reason: srcText || rejReason,
        rejectionView: rejView !== '-' ? rejView : '',
        rejection_view: rejView !== '-' ? rejView : '',
        rejectionZone: rejZone !== '-' ? rejZone : '',
        rejection_zone: rejZone !== '-' ? rejZone : '',
        rejectionSubZone: rejSubZone !== '-' ? rejSubZone : '',
        rejection_sub_zone: rejSubZone !== '-' ? rejSubZone : '',
        parts_interlock_reason: partsInterlock,
        createdAt: row.first_scan_at || row.createdAt,
        ngRecordedAt: row.final_scan_at || row.updatedAt || row.createdAt,
        // Process parameters in both snake_case and camelCase
        metal_pressure: row.metal_pressure != null ? row.metal_pressure : '',
        metalPressure: row.metal_pressure != null ? Number(row.metal_pressure) : null,
        furnace_metal_temp: row.furnace_metal_temp != null ? row.furnace_metal_temp : '',
        metalTemp: row.furnace_metal_temp != null ? Number(row.furnace_metal_temp) : null,
        biscuit_thickness: row.biscuit_thickness != null ? row.biscuit_thickness : '',
        biscuitThickness: row.biscuit_thickness != null ? Number(row.biscuit_thickness) : null,
        v1_speed: row.v1_speed != null ? row.v1_speed : '',
        v1Speed: row.v1_speed != null ? Number(row.v1_speed) : null,
        v2_speed: row.v2_speed != null ? row.v2_speed : '',
        v2Speed: row.v2_speed != null ? Number(row.v2_speed) : null,
        v3_speed: row.v3_speed != null ? row.v3_speed : '',
        v3Speed: row.v3_speed != null ? Number(row.v3_speed) : null,
        v4_speed: row.v4_speed != null ? row.v4_speed : '',
        v4Speed: row.v4_speed != null ? Number(row.v4_speed) : null,
        leak_body_leak_value: row.leak_body_leak_value != null ? row.leak_body_leak_value : '',
        leakBodyValue: row.leak_body_leak_value != null ? Number(row.leak_body_leak_value) : null,
        leakBodyLeakValue: row.leak_body_leak_value != null ? Number(row.leak_body_leak_value) : null,
        cycle_time: row.cycle_time != null ? row.cycle_time : '',
        cycleTime: row.plc_cycle_time != null ? Number(row.plc_cycle_time) : (row.cycle_time || ''),
        plc_cycle_time: row.plc_cycle_time != null ? row.plc_cycle_time : '',
        intensification_time: row.intensification_time != null ? row.intensification_time : '',
        intensificationTime: row.intensification_time != null ? Number(row.intensification_time) : null,
        curing_time: row.curing_time != null ? row.curing_time : '',
        curingTime: row.curing_time != null ? Number(row.curing_time) : null,
        pouring_time: row.pouring_time != null ? row.pouring_time : '',
        pouringTime: row.pouring_time != null ? Number(row.pouring_time) : null,
        shot_fwd_time: row.shot_fwd_time != null ? row.shot_fwd_time : '',
        shotFwdTime: row.shot_fwd_time != null ? Number(row.shot_fwd_time) : null,
        die_close_core_in_time: row.die_close_core_in_time != null ? row.die_close_core_in_time : '',
        dieCloseTime: row.die_close_core_in_time != null ? Number(row.die_close_core_in_time) : null,
        die_open_core_out_time: row.die_open_core_out_time != null ? row.die_open_core_out_time : '',
        dieOpenTime: row.die_open_core_out_time != null ? Number(row.die_open_core_out_time) : null,
        ejector_time: row.ejector_time != null ? row.ejector_time : '',
        ejectorTime: row.ejector_time != null ? Number(row.ejector_time) : null,
        extract_time: row.extract_time != null ? row.extract_time : '',
        extractTime: row.extract_time != null ? Number(row.extract_time) : null,
        spray_time: row.spray_time != null ? row.spray_time : '',
        sprayTime: row.spray_time != null ? Number(row.spray_time) : null,
        accel_point: row.accel_point != null ? row.accel_point : '',
        accelPoint: row.accel_point != null ? Number(row.accel_point) : null,
        deaccel_point: row.deaccel_point != null ? row.deaccel_point : '',
        deaccelPoint: row.deaccel_point != null ? Number(row.deaccel_point) : null,
        clamp_tonnage: row.clamp_tonnage != null ? row.clamp_tonnage : '',
        clampTonnage: row.clamp_tonnage != null ? Number(row.clamp_tonnage) : null,
        clamp_tonnage_he_low_mn: row.clamp_tonnage_he_low_mn != null ? row.clamp_tonnage_he_low_mn : '',
        clampTonnageHeLowMn: row.clamp_tonnage_he_low_mn != null ? Number(row.clamp_tonnage_he_low_mn) : null,
        jet_cooling_pressure: row.jet_cooling_pressure != null ? row.jet_cooling_pressure : '',
        jetCoolingPressure: row.jet_cooling_pressure != null ? Number(row.jet_cooling_pressure) : null,
        vacuum_pressure: row.vacuum_pressure != null ? row.vacuum_pressure : '',
        vacuumPressure: row.vacuum_pressure != null ? Number(row.vacuum_pressure) : null,
        coolingWaterSta: row.cooling_water_sta != null ? Number(row.cooling_water_sta) : null,
        machine_name: row.machine_name && row.machine_name !== '-' ? row.machine_name : '',
        die_name: row.die_name && row.die_name !== '-' ? row.die_name : '',
        shift_code: row.shift_code || 'UNASSIGNED',
      };
    });

    return res.json({
      rows: formatted,
      total,
      page: pgNum,
      pageSize: pgSize,
      totalPages: Math.ceil(total / pgSize),
    });
  } catch (error) {
    console.error('[REJECTION ROWS] controller error:', error);
    res.status(500).json({ error: error.message });
  }
};


const DEFAULT_REPORT_COLUMNS = [
  { id: "partId", label: "Part Serial No", enabled: true },
  { id: "customerQrCode", label: "Customer QR Code", enabled: true },
  { id: "createdAt", label: "Timestamp", enabled: true },
  { id: "shiftCode", label: "Shift", enabled: true },
  { id: "operationNo", label: "Operation No", enabled: true },
  { id: "machineName", label: "Machine Name", enabled: true },
  { id: "modelCode", label: "Model Code", enabled: true },
  { id: "qrFormatName", label: "Model Name", enabled: true },
  { id: "status", label: "Result (OK/NG)", enabled: true },
  { id: "reason", label: "Reason", enabled: true },
  { id: "lineName", label: "Line No", enabled: true },
  { id: "operatorId", label: "Operator ID", enabled: false },
  { id: "cycleTime", label: "Cycle Time (s)", enabled: false },
  { id: "plcStatus", label: "PLC Status", enabled: false },
];

const DEFAULT_EXPORT_REPORT_CONFIG = {
  companyName: "Traceability System",
  plantName: "-",
  projectTitle: "Production Traceability",
  reportTitle: "Production Report",
  logoUrl: "",
  headerLine1: "Production Traceability Report",
  headerLine2: "Industrial Analytics",
  footerText: "Confidential - Internal Use Only",
  location: "-",
  preparedBy: "",
  approvedBy: "",
  department: "Production",
  showLogo: true,
  showDate: true,
  showShift: true,
  showMachine: true,
  columns: DEFAULT_REPORT_COLUMNS,
};

function normalizeReportColumns(rawColumns) {
  const defaultsById = new Map(DEFAULT_REPORT_COLUMNS.map((row) => [row.id, row]));
  const used = new Set();
  const merged = [];
  const incoming = Array.isArray(rawColumns) ? rawColumns : [];

  for (const column of incoming) {
    if (!column || typeof column !== "object") continue;
    const id = String(column.id || "").trim();
    if (!id || used.has(id)) continue;
    const base = defaultsById.get(id);
    if (!base) continue;
    used.add(id);
    merged.push({
      id,
      label: String(column.label || base.label || id),
      enabled: column.enabled !== false,
    });
  }

  for (const base of DEFAULT_REPORT_COLUMNS) {
    if (used.has(base.id)) continue;
    merged.push({ ...base });
  }

  return merged;
}

function normalizeExportReportConfig(rawConfig = {}) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    ...DEFAULT_EXPORT_REPORT_CONFIG,
    ...source,
    columns: normalizeReportColumns(source.columns),
  };
}

function getExportPayload(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const filters = body.filters && typeof body.filters === "object" ? body.filters : req.query || {};
  const reportConfig = normalizeExportReportConfig(body.reportConfig || {});
  return { filters, reportConfig };
}

function toDisplayDateTime(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function normalizeResultToken(value) {
  return String(value || "").trim().toUpperCase();
}

function deriveOperationStatus(row) {
  const plcStatus = normalizeResultToken(row?.plc_status);
  const result = normalizeResultToken(row?.result);
  if (result === "OK" || plcStatus === "ENDED_OK") return "OK";
  if (result === "NG" || plcStatus === "ENDED_NG") return "NG";
  return "";
}

function matchesStatusFilter(row, statusFilter) {
  if (!statusFilter) return true;
  const token = String(statusFilter || "").trim().toUpperCase();
  if (!token) return true;
  const values = [
    normalizeResultToken(row.status),
    normalizeResultToken(row.result),
    normalizeResultToken(row.plcStatus),
  ];
  if (token === "WIP") return values.includes("RUNNING") || values.includes("PENDING") || values.includes("STARTED");
  return values.includes(token);
}

async function getDashboardExportRows(filters) {
  const query = filters && typeof filters === "object" ? filters : {};
  const { from, to } = getDateRangeFromQuery(query);
  const shiftCodeFilter = query?.shiftCode ? String(query.shiftCode).trim().toUpperCase() : null;
  const lineNameFilter = normalizeLineName(query?.lineName);
  const statusFilter = String(query?.status || "").trim().toUpperCase();
  const operatorIdFilter = Number(query?.operatorId || 0) || null;
  const operationWhere = {
    createdAt: { [Op.gte]: from, [Op.lte]: to },
  };

  if (lineNameFilter) {
    const lineMachines = await Machine.findAll({
      where: { line_name: lineNameFilter, is_active: true },
      attributes: ["id"],
      raw: true,
    });
    const lineMachineIds = lineMachines.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
    if (!lineMachineIds.length) {
      return [];
    }
    operationWhere.machine_id = { [Op.in]: lineMachineIds };
  }

  if (query?.machineId) {
    operationWhere.machine_id = Number(query.machineId);
  }
  if (query?.partId) {
    const requestedPartId = String(query.partId).trim();
    const requestedPartIdValues = await resolvePartIdSearchValues(requestedPartId);
    operationWhere.part_id = buildPartIdSearchCondition(requestedPartIdValues) || { [Op.like]: `%${requestedPartId}%` };
  }
  if (operatorIdFilter) {
    operationWhere.user_id = operatorIdFilter;
  }

  const [operationRows, shifts] = await Promise.all([
    OperationLog.findAll({
      where: operationWhere,
      order: [["createdAt", "DESC"]],
      raw: true,
    }),
    getActiveShiftDefinitions(),
  ]);

  const shiftFilteredRows = applyShiftFilter(operationRows, shiftCodeFilter, shifts, { from, to });
  const productionRows = shiftFilteredRows.filter((row) => !isJourneyNoiseLog(row));
  const machineIds = uniqueStages(productionRows.map((row) => String(row.machine_id || "")).filter(Boolean))
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
  const machineRows = machineIds.length
    ? await Machine.findAll({
      where: { id: { [Op.in]: machineIds } },
      attributes: ["id", "machine_name", "line_name", "operation_no"],
      raw: true,
    })
    : [];
  const machineMap = machineRows.reduce((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {});

  const partIds = uniqueStages(productionRows.map((row) => String(row.part_id || "").trim()).filter(Boolean));
  const partRows = partIds.length
    ? await Part.findAll({
      where: { part_id: { [Op.in]: partIds } },
      attributes: ["part_id", "qr_format_name"],
      raw: true,
    })
    : [];
  const partMap = partRows.reduce((acc, row) => {
    acc[row.part_id] = row;
    return acc;
  }, {});
  const partCodeRows = partIds.length
    ? await PartCodeMapping.findAll({
      where: {
        [Op.or]: [
          { old_part_id: { [Op.in]: partIds } },
          { customer_qr: { [Op.in]: partIds } },
        ],
        is_active: true,
      },
      attributes: ["old_part_id", "customer_qr"],
      order: [["updatedAt", "DESC"]],
      raw: true,
    })
    : [];
  const customerQrByPartId = partCodeRows.reduce((acc, row) => {
    const partId = String(row.old_part_id || "").trim().toUpperCase();
    const customerQr = sanitizeCustomerQrValue(row.customer_qr);
    const customerKey = customerQr.toUpperCase();
    if (partId && customerQr && !acc[partId]) acc[partId] = customerQr;
    if (customerKey && customerQr && !acc[customerKey]) acc[customerKey] = customerQr;
    return acc;
  }, {});
  const oldPartByPartId = partCodeRows.reduce((acc, row) => {
    const oldPart = String(row.old_part_id || "").trim();
    const customerQr = sanitizeCustomerQrValue(row.customer_qr);
    const oldKey = oldPart.toUpperCase();
    const customerKey = customerQr.toUpperCase();
    if (oldKey && oldPart && !acc[oldKey]) acc[oldKey] = oldPart;
    if (customerKey && oldPart && !acc[customerKey]) acc[customerKey] = oldPart;
    return acc;
  }, {});
  const qrFormatNames = uniqueStages(partRows.map((row) => String(row.qr_format_name || "").trim()).filter(Boolean));
  const qrRuleRows = qrFormatNames.length
    ? await QrFormatRule.findAll({
      where: { format_name: { [Op.in]: qrFormatNames } },
      attributes: ["format_name", "model_code"],
      raw: true,
    })
    : [];
  const modelByFormat = qrRuleRows.reduce((acc, row) => {
    acc[String(row.format_name || "").trim()] = String(row.model_code || "").trim();
    return acc;
  }, {});

  const mappedRows = productionRows.map((row) => {
    const machine = machineMap[row.machine_id] || {};
    const part = partMap[row.part_id] || {};
    const qrFormatName = String(part.qr_format_name || "").trim();
    const customerQrCode = customerQrByPartId[String(row.part_id || "").trim().toUpperCase()] || "";
    const mappedOldPartId = oldPartByPartId[String(row.part_id || "").trim().toUpperCase()] || "";
    const isCustomerQrOnlyRow =
      qrFormatName.toUpperCase() === CUSTOMER_QR_ONLY_FORMAT ||
      Boolean(customerQrCode && mappedOldPartId && String(customerQrCode).trim().toUpperCase() === String(mappedOldPartId).trim().toUpperCase());
    const displayPartId = isCustomerQrOnlyRow ? "" : (mappedOldPartId || String(row.part_id || "").trim());
    const modelCode = modelByFormat[qrFormatName] || "";
    const status = deriveOperationStatus(row);
    const result = normalizeResultToken(row.result);
    const plcStatus = normalizeResultToken(row.plc_status);
    const structuredRejectionReason = [
      row.rejection_category ? `Category: ${row.rejection_category}` : "",
      row.rejection_view ? `View: ${row.rejection_view}` : "",
      row.rejection_zone ? `Zone: ${row.rejection_zone}` : "",
      row.rejection_reason ? `Reason: ${row.rejection_reason}` : "",
      row.rejection_remark ? `Remark: ${row.rejection_remark}` : "",
    ].filter(Boolean).join(" | ");
    const start = row.plc_start_time || row.plc_start_at || null;
    const end = row.plc_end_time || row.plc_end_at || null;
    const cycleTime = start && end
      ? Number(Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000).toFixed(1))
      : null;

    return {
      partId: displayPartId,
      traceabilityPartId: row.part_id || customerQrCode || "",
      customerQrCode,
      modelCode,
      qrFormatName,
      machineName: machine.machine_name || "",
      lineName: machine.line_name || "",
      stationNo: row.station_no || machine.operation_no || "",
      operationNo: row.operation_no || "",
      shiftCode: resolveShiftCodeForDate(row.createdAt, shifts) || "",
      status,
      result,
      plcStatus,
      reason: structuredRejectionReason || row.interlock_reason || "",
      rejectionCategory: row.rejection_category || "",
      rejectionView: row.rejection_view || "",
      rejectionZone: row.rejection_zone || "",
      rejectionReason: row.rejection_reason || "",
      rejectionRemark: row.rejection_remark || "",
      operatorId: row.user_id || "",
      cycleTime: cycleTime === null ? "" : cycleTime,
      createdAt: formatReportTimestamp(row.createdAt),
      createdAtRaw: row.createdAt,
    };
  });

  return mappedRows.filter((row) => matchesStatusFilter(row, statusFilter));
}

function tryParseHexColor(colorValue, fallbackArgb) {
  const value = String(colorValue || "").trim();
  const match = value.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return fallbackArgb;
  return `FF${match[1].toUpperCase()}`;
}

async function resolveLogoImageBase64(logoUrl) {
  const input = String(logoUrl || "").trim();
  if (!input) return null;
  if (/^data:image\/(png|jpe?g);base64,/i.test(input)) {
    return input;
  }
  if (!/^https?:\/\//i.test(input)) {
    return null;
  }
  try {
    const response = await fetch(input);
    if (!response.ok) return null;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("image/")) return null;
    const arrayBuffer = await response.arrayBuffer();
    const binary = Buffer.from(arrayBuffer).toString("base64");
    const type = contentType.includes("png") ? "png" : "jpeg";
    return `data:image/${type};base64,${binary}`;
  } catch {
    return null;
  }
}

function buildFilterSummaryRows(filters, rowsCount) {
  const query = filters && typeof filters === "object" ? filters : {};
  const selected = [
    ["From", query.dateFrom ? toDisplayDateTime(query.dateFrom) : "-"],
    ["To", query.dateTo ? toDisplayDateTime(query.dateTo) : "-"],
    ["Line", query.lineName || "-"],
    ["Machine", query.machineId || "-"],
    ["Part", query.partId || "-"],
    ["Status", query.status || "-"],
    ["Shift", query.shiftCode || "-"],
    ["Operator", query.operatorId || "-"],
  ];
  const selectedCount = selected.filter((row) => row[1] && row[1] !== "-").length;
  const appliedText = selected
    .filter((row) => row[1] && row[1] !== "-")
    .map(([label, value]) => `${label}: ${value}`)
    .join("  |  ");
  return {
    selected,
    selectedCount,
    rowsCount,
    appliedText,
  };
}

async function sendDashboardExcel(res, { rows, filters, reportConfig, sheetName, filePrefix }) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  const config = normalizeExportReportConfig(reportConfig || {});
  const navColor = tryParseHexColor(config.reportAccentColor || "#1A3A7C", "FF1A3A7C");
  const headerBgColor = tryParseHexColor(config.reportHeaderBgColor || "#EAF0F8", "FFEAF0F8");
  const headerTextColor = "FFFFFFFF";
  const borderColor = "FFD8DEE8";
  const filterSummary = buildFilterSummaryRows(filters, rows.length);

  const logoBase64 = config.showLogo ? await resolveLogoImageBase64(config.logoUrl) : null;
  let rowPtr = 1;

  if (logoBase64) {
    const extMatch = logoBase64.match(/^data:image\/(png|jpe?g);base64,/i);
    const extension = extMatch && extMatch[1].toLowerCase().startsWith("png") ? "png" : "jpeg";
    const imageId = workbook.addImage({ base64: logoBase64, extension });
    worksheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 170, height: 62 } });
    worksheet.mergeCells("C1:I1");
    worksheet.mergeCells("C2:I2");
    worksheet.mergeCells("C3:I3");
    worksheet.mergeCells("C4:I4");
    worksheet.getCell("C1").value = config.headerLine1 || config.companyName;
    worksheet.getCell("C2").value = config.headerLine2 || config.projectTitle;
    worksheet.getCell("C3").value = config.reportTitle || "Production Report";
    worksheet.getCell("C4").value = `Generated: ${toDisplayDateTime(new Date())}   |   Sign Date: ${toDisplayDateTime(new Date())}`;
    rowPtr = 6;
  } else {
    worksheet.mergeCells("A1:I1");
    worksheet.mergeCells("A2:I2");
    worksheet.mergeCells("A3:I3");
    worksheet.mergeCells("A4:I4");
    worksheet.getCell("A1").value = config.headerLine1 || config.companyName;
    worksheet.getCell("A2").value = config.headerLine2 || config.projectTitle;
    worksheet.getCell("A3").value = config.reportTitle || "Production Report";
    worksheet.getCell("A4").value = `Generated: ${toDisplayDateTime(new Date())}   |   Sign Date: ${toDisplayDateTime(new Date())}`;
    rowPtr = 6;
  }

  ["A1", "A2", "A3", "A4", "C1", "C2", "C3", "C4"].forEach((ref) => {
    const cell = worksheet.getCell(ref);
    if (!cell.value) return;
    cell.alignment = { vertical: "middle", horizontal: ref.endsWith("1") || ref.endsWith("3") ? "left" : "left" };
    if (ref.endsWith("1")) cell.font = { bold: true, size: 14, color: { argb: navColor } };
    else if (ref.endsWith("3")) cell.font = { bold: true, size: 13, color: { argb: "FF243A53" } };
    else cell.font = { size: 10, color: { argb: "FF5B6574" } };
  });

  worksheet.getCell(`A${rowPtr}`).value = `Plant: ${config.plantName || "-"}   |   Department: ${config.department || "-"}   |   Location: ${config.location || "-"}`;
  worksheet.mergeCells(`A${rowPtr}:I${rowPtr}`);
  worksheet.getCell(`A${rowPtr}`).font = { size: 10, color: { argb: "FF415167" } };
  rowPtr += 1;

  const appliedFiltersText = filterSummary.appliedText || "No filters selected";
  worksheet.getCell(`A${rowPtr}`).value = `Applied Filters (${filterSummary.selectedCount})  |  Rows: ${filterSummary.rowsCount}  |  ${appliedFiltersText}`;
  worksheet.mergeCells(`A${rowPtr}:I${rowPtr}`);
  worksheet.getCell(`A${rowPtr}`).font = { bold: true, size: 10, color: { argb: navColor } };
  worksheet.getCell(`A${rowPtr}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerBgColor } };
  rowPtr += 1;

  rowPtr += 1;

  const columnMeta = {
    partId: { key: "partId", width: 22 },
    customerQrCode: { key: "customerQrCode", width: 24 },
    modelCode: { key: "modelCode", width: 16 },
    qrFormatName: { key: "qrFormatName", width: 20 },
    machineName: { key: "machineName", width: 20 },
    lineName: { key: "lineName", width: 14 },
    stationNo: { key: "stationNo", width: 12 },
    operationNo: { key: "operationNo", width: 13 },
    shiftCode: { key: "shiftCode", width: 12 },
    status: { key: "status", width: 12 },
    result: { key: "result", width: 12 },
    plcStatus: { key: "plcStatus", width: 15 },
    reason: { key: "reason", width: 28 },
    operatorId: { key: "operatorId", width: 12 },
    cycleTime: { key: "cycleTime", width: 14 },
    createdAt: { key: "createdAt", width: 21 },
  };

  const enabledColumns = config.columns.filter((column) => column.enabled !== false);
  const normalizedColumns = (enabledColumns.length ? enabledColumns : DEFAULT_REPORT_COLUMNS.filter((row) => row.enabled)).map((column) => {
    const meta = columnMeta[column.id] || { key: column.id, width: 18 };
    return {
      header: column.label || column.id,
      key: meta.key,
      width: meta.width,
    };
  });

  worksheet.columns = normalizedColumns;
  const headerRowNumber = rowPtr;
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.values = normalizedColumns.map((column) => column.header);
  headerRow.height = 22;
  headerRow.font = { bold: true, color: { argb: headerTextColor }, size: 10 };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navColor } };
    cell.border = {
      top: { style: "thin", color: { argb: borderColor } },
      left: { style: "thin", color: { argb: borderColor } },
      bottom: { style: "thin", color: { argb: borderColor } },
      right: { style: "thin", color: { argb: borderColor } },
    };
  });

  const dataRows = rows.map((row) => {
    const payload = {};
    for (const column of normalizedColumns) {
      payload[column.key] = row[column.key] ?? "";
    }
    return payload;
  });
  worksheet.addRows(dataRows);

  const statusColumnIndex = normalizedColumns.findIndex((column) => column.key === "status") + 1;
  for (let r = headerRowNumber + 1; r <= worksheet.rowCount; r += 1) {
    const excelRow = worksheet.getRow(r);
    if (statusColumnIndex > 0) {
      const statusToken = normalizeResultToken(excelRow.getCell(statusColumnIndex)?.value);
      if (statusToken === "OK") {
        excelRow.getCell(statusColumnIndex).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEAF8EE" },
        };
      } else if (statusToken === "NG") {
        excelRow.getCell(statusColumnIndex).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFDECEC" },
        };
      } else if (statusToken) {
        excelRow.getCell(statusColumnIndex).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF7E8" },
        };
      }
    }

    excelRow.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: borderColor } },
        left: { style: "thin", color: { argb: borderColor } },
        bottom: { style: "thin", color: { argb: borderColor } },
        right: { style: "thin", color: { argb: borderColor } },
      };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    });
  }

  const footerRow = worksheet.rowCount + 2;
  worksheet.getCell(`A${footerRow}`).value = config.footerText || "Confidential - Internal Use Only";
  worksheet.getCell(`A${footerRow}`).font = { size: 10, italic: true, color: { argb: "FF66748A" } };
  worksheet.mergeCells(`A${footerRow}:E${footerRow}`);
  worksheet.getCell(`F${footerRow}`).value = `Prepared By: ${config.preparedBy || "-"}`;
  worksheet.getCell(`G${footerRow}`).value = `Approved By: ${config.approvedBy || "-"}`;
  worksheet.getCell(`H${footerRow}`).value = "Signed Date:";
  worksheet.getCell(`I${footerRow}`).value = toDisplayDateTime(new Date());
  worksheet.getCell(`H${footerRow}`).font = { bold: true, size: 10, color: { argb: "FF44566E" } };

  worksheet.views = [{ state: "frozen", ySplit: headerRowNumber }];

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename=${filePrefix}_${buildReportFileTimestamp()}.xlsx`);
  res.send(Buffer.from(buffer));
}

// Legacy export functions removed. Using reportController instead.

exports.testPlcCycle = async (req, res) => {
  try {
    const { barcode } = req.body;
    if (!barcode) return res.status(400).json({ error: "Barcode is required" });

    // Step 1: Find active QrFormatRule that matches
    const rules = await QrFormatRule.findAll({ where: { is_active: true } });
    
    let matchedRule = null;
    let matchResult = null;
    for (const rule of rules) {
      try {
        const regexPattern = new RegExp(rule.regex_pattern, 'i');
        const match = barcode.match(regexPattern);
        if (match) {
          matchedRule = rule;
          matchResult = match;
          break;
        }
      } catch (e) {
        // ignore invalid regex
      }
    }

    if (!matchedRule) {
      return res.status(404).json({ error: "Barcode does not match any active QR format rules." });
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

    const sequelize = require("../config/db");

    // Try multi-field exact parse first
    const cleanBarcode = String(barcode || "").trim();
    let parsedSuccess = false;
    let parsedFields = null;

    if (cleanBarcode.length === 18 && /^\d{18}$/.test(cleanBarcode)) {
      const yy = parseInt(cleanBarcode.slice(0, 2), 10);
      const mm = parseInt(cleanBarcode.slice(2, 4), 10);
      const dd = parseInt(cleanBarcode.slice(4, 6), 10);
      const hh = parseInt(cleanBarcode.slice(6, 8), 10);
      const min = parseInt(cleanBarcode.slice(8, 10), 10);
      const ss = parseInt(cleanBarcode.slice(10, 12), 10);
      const seq = parseInt(cleanBarcode.slice(12), 10);

      parsedFields = {
        shot_year: 2000 + yy,
        shot_month: mm,
        shot_day: dd,
        shot_hour: hh,
        shot_minute: min,
        shot_second: ss,
        shot_number: seq
      };
      parsedSuccess = true;
    } else {
      const timestampMatch = cleanBarcode.match(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (timestampMatch) {
        const yy = parseInt(timestampMatch[1], 10);
        const mm = parseInt(timestampMatch[2], 10);
        const dd = parseInt(timestampMatch[3], 10);
        const hh = parseInt(timestampMatch[4], 10);
        const min = parseInt(timestampMatch[5], 10);
        const ss = parseInt(timestampMatch[6], 10);

        const index = timestampMatch.index;
        let seqStr = "";
        if (index === 0) {
          seqStr = cleanBarcode.slice(12);
        } else {
          seqStr = cleanBarcode.slice(0, index);
        }
        const seq = parseInt(seqStr.replace(/\D/g, ""), 10);

        if (!isNaN(seq)) {
          parsedFields = {
            shot_year: 2000 + yy,
            shot_month: mm,
            shot_day: dd,
            shot_hour: hh,
            shot_minute: min,
            shot_second: ss,
            shot_number: seq
          };
          parsedSuccess = true;
        }
      }
    }

    if (parsedSuccess && parsedFields) {
      // Auto seed mock record if not existing
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
      let existingRecord = null;
      try {
        const [existing] = await sequelize.query(checkQuery, {
          replacements: parsedFields
        });
        if (existing && existing.length > 0) {
          existingRecord = existing[0];
        }
      } catch (err) {
        // ignore query check error
      }

      if (!existingRecord) {
        const recordedAt = new Date(
          parsedFields.shot_year,
          parsedFields.shot_month - 1,
          parsedFields.shot_day,
          parsedFields.shot_hour,
          parsedFields.shot_minute,
          parsedFields.shot_second
        );

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
              ...parsedFields,
              recorded_at: recordedAt
            }
          });
          console.log(`[testPlcCycle] Seeded mock record into PlcCycleReadings for shot: ${parsedFields.shot_number}`);
        } catch (err) {
          console.warn(`[testPlcCycle] Seeding failed:`, err.message);
        }
      }

      // Query advanced multi-field record
      const exactQuery = `
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
        const [results] = await sequelize.query(exactQuery, {
          replacements: parsedFields
        });
        if (results && results.length > 0) {
          return res.json({
            success: true,
            matchedRule: matchedRule.format_name,
            extractedShot: parsedFields.shot_number,
            reading: results[0]
          });
        }
      } catch (err) {
        // ignore exact query error
      }
    }

    let query = `SELECT TOP 1 * FROM PlcCycleReadings WHERE 1=1`;
    const replacements = {};
    
    if (shotNumber) {
      query += ` AND shot_number = :shotNumber`;
      replacements.shotNumber = parseInt(shotNumber, 10);
    } else {
      return res.status(400).json({ error: "Could not extract shot number from barcode", rule: matchedRule.format_name });
    }

    query += ` ORDER BY recorded_at DESC`;

    const [results] = await sequelize.query(query, { replacements });

    if (results && results.length > 0) {
      res.json({
        success: true,
        matchedRule: matchedRule.format_name,
        extractedShot: shotNumber,
        reading: results[0]
      });
    } else {
      res.json({
        success: false,
        matchedRule: matchedRule.format_name,
        extractedShot: shotNumber,
        message: "No reading found in PlcCycleReadings for shot_number " + shotNumber
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
