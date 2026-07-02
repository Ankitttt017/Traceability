const { Op, fn, col } = require("sequelize");
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
const { saveScan } = require("../services/scanService");
const { captureLeakReadingsForScan } = require("../services/leakTestCaptureService");
const LeakTestReading = require("../models/LeakTestReading");
const {
  LEAKTEST_OPERATION,
  buildLeaktestIndex,
  getLeaktestReadingForPartStation,
  getLeaktestStageState,
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
const { normalizeTimeValue, toMinutes: toShiftMinutes } = require("../utils/time");
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
  Number(process.env.CUSTOMER_QR_ACTIVE_WINDOW_MS || 10 * 60 * 1000),
  30 * 1000
);
const CUSTOMER_QR_ONLY_FORMAT = "CUSTOMER_QR_ONLY";

function normalizeStation(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

async function resolveMappedPartId(inputCode) {
  const raw = String(inputCode || "").trim();
  if (!raw) return { resolvedPartId: "", customerQrCode: null };
  const row = await PartCodeMapping.findOne({
    where: { customer_qr: raw, is_active: true },
    order: [["updatedAt", "DESC"]],
  });
  if (!row) return { resolvedPartId: raw, customerQrCode: null };
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
  if (formatName === CUSTOMER_QR_ONLY_FORMAT) return false;
  if (oldPartId && customerQr && oldPartId === customerQr) return false;
  return Boolean(part || mapping);
}

async function canStartCustomerQrOnlyPart({ code, stationNo, machine, stationFeatures = null }) {
  const raw = String(code || "").trim();
  const station = normalizeStation(stationNo);
  if (!raw || !station || !machine || !requiresCustomerQrForCompletion(machine)) return false;
  const features = stationFeatures || await getStationFeatureConfig(station).catch(() => null);
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

  return uniquePartIds.length === 1 ? uniquePartIds[0] : "";
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

const CUSTOMER_QR_WAITING_OPERATIONS = new Set(["LASER", "LASER_MARKING", "LASER MARKING", "OP_LASER", "OP110", "OP160", "OP170"]);

function requiresCustomerQrForCompletion(machine = {}) {
  const tokens = [
    getModelValue(machine, "operation_no"),
    getModelValue(machine, "machine_name"),
  ].map((value) => String(value || "").trim().toUpperCase());
  return tokens.some((token) => CUSTOMER_QR_WAITING_OPERATIONS.has(token) || token.includes("LASER"));
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

function getQualitySummaryFromOperationLogs(rows, getMappedCustomerQr = null) {
  const summary = {
    okCount: 0,
    ngCount: 0,
    interlockedCount: 0,
    commErrorCount: 0,
    inProgressCount: 0,
  };

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

  for (const row of latestByPart.values()) {
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

  // Prioritize quality outcomes (PASS/NG) over administrative blocks (DUPLICATE/SEQUENCE)
  const success = logs.find(l => ["ENDED_OK", "PASSED", "OK"].includes(toUpper(l.plc_status)) || ["PASS", "OK"].includes(toUpper(l.result)));
  const ng = logs.find(l => ["ENDED_NG", "NG"].includes(toUpper(l.plc_status)) || ["FAIL", "NG"].includes(toUpper(l.result)));

  return success || ng || logs[0];
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
    message: `Part ready for packing from ${station}.`,
  });
  emitRealtime("packing_update", {
    event: "PART_READY_FOR_PACKING",
    partId,
    stationNo: "PACKING",
    sourceStationNo: station,
    machineId,
    machineName,
    finalPackingEligible: true,
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
    let connected = Boolean(byIpHealth.connected) || connectionConnected;
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
      let connected = Boolean(match.connected) || connectionConnected;
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
    let connected = Boolean(connectionSnapshot.connected);
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
  const stationFeatures = await getStationFeatureConfig(stationNo).catch(() => ({ operation: true }));
  const plcConfigured = Boolean(machine.plc_ip);
  const plcCommunicationEnabled = stationFeatures.plcCommunication !== false;

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
    // Rule: Send interlock signal for duplicates or invalid sequences
    plcHandshakeEngine.signalInterlock(machine.id, response.reason || "REJECTED_SCAN")
      .catch(err => console.error("[PLC:INTERLOCK_TRIGGER_FAILED]", err.message));
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
      ...initialCustomerMappings.flatMap((row) => [row.old_part_id, row.customer_qr]),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean));
    const [part, logs, reworkHistory, auditLogs, sequenceData] = await Promise.all([
      Part.findOne({ where: { part_id: { [Op.in]: traceabilityPartIds } } }),
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
          attributes: ["id", "machine_name", "operation_no", "sequence_no"],
        })
        : [];

    const machineMap = machineRows.reduce((acc, machine) => {
      const machineId = getModelValue(machine, "id");
      acc[machineId] = {
        id: machineId,
        machineName: getModelValue(machine, "machine_name"),
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
    const customerMappingByStation = customerMappings.reduce((acc, row) => {
      const key = normalizeStation(row.station_no);
      if (!key || acc[key]) return acc;
      acc[key] = {
        customerQrCode: String(row.customer_qr || "").trim() || null,
        customerQrMappedAt: row.updatedAt || row.createdAt || null,
        customerQrMachineId: row.machine_id || null,
      };
      return acc;
    }, {});
    const customerQrByPartId = customerMappings.reduce((acc, row) => {
      const key = String(partId || "").trim().toUpperCase();
      const oldKey = String(row.old_part_id || "").trim().toUpperCase();
      const customerKey = String(row.customer_qr || "").trim().toUpperCase();
      const customerQrCode = String(row.customer_qr || "").trim();
      if (customerQrCode) {
        if (key && !acc[key]) acc[key] = customerQrCode;
        if (oldKey && !acc[oldKey]) acc[oldKey] = customerQrCode;
        if (customerKey && !acc[customerKey]) acc[customerKey] = customerQrCode;
      }
      return acc;
    }, {});
    const leaktestIndex = (
      await buildLeaktestIndex({
        partIds: traceabilityPartIds,
        customerQrByPartId,
        machines: Array.isArray(sequenceData?.machines) ? sequenceData.machines : [],
      })
    ).byPartAndStation;
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
      const leakTestReading = stationNo === LEAKTEST_OPERATION
        ? (
          traceabilityPartIds
            .map((candidatePartId) => getLeaktestReadingForPartStation(leaktestIndex, candidatePartId, stationNo))
            .find(Boolean) || null
        )
        : null;
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
      const endedOkAttempt  = attempts.find(a => a.plcStatus === "ENDED_OK");
      const endedNgAttempt  = attempts.find(a => a.plcStatus === "ENDED_NG");
      // Best attempt for display: prefer the actual production outcome
      const productionAttempt = endedOkAttempt || endedNgAttempt || null;
      // The attempt whose values we surface as "latest" (hide duplicate/interlocked noise)
      const representativeAttempt = productionAttempt || latestAttempt;

      let stageState = "PENDING";
      const waitingForCustomerQr = Boolean(
        stationMeta?.requiresCustomerQr &&
        !customerMappingByStation[stationNo]?.customerQrCode
      );

      if (leakTestReading) {
        stageState = getLeaktestStageState(leakTestReading);
      } else if (bypassMeta.bypassed) {
        stageState = "PASSED";
      } else if (endedOkAttempt) {
        stageState = "PASSED";
      } else if (endedNgAttempt) {
        stageState = "FAILED";
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
      const cycleEndTime    = leakTestReading?.cycleEndTime || productionAttempt?.plcEndTime || null;
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
        latestAt: leakTestReading?.cycleEndTime || representativeAttempt?.createdAt || null,
        cycleStartTime,
        cycleEndTime,
        cycleDurationSec,
        attempts,
        leakTestReading,
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
    const isCustomerQrOnlyPart =
      String(part?.qr_format_name || "").trim().toUpperCase() === CUSTOMER_QR_ONLY_FORMAT ||
      Boolean(mappedCustomerQrForPart && String(mappedCustomerQrForPart).trim().toUpperCase() === String(partId || "").trim().toUpperCase());
    const partPayload = part
      ? {
          ...part.get({ plain: true }),
          displayPartId: String(part.part_id || partId || "").trim(),
          isCustomerQrOnly: isCustomerQrOnlyPart,
          customerQrCode: mappedCustomerQrForPart,
        }
      : {
          part_id: partId,
          status: "UNKNOWN",
          current_station: null,
          displayPartId: String(partId || "").trim(),
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

exports.getPartCatalog = async (req, res) => {
  try {
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
      const filteredScopedLogs = shiftCodeFilter ? applyShiftFilter(scopedLogs, shiftCodeFilter, shifts) : scopedLogs;
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

    const response = parts
      .filter((part) => productionPartIds.has(String(part.part_id || "").trim()))
      .map((part) => {
        const latest = latestByPart.get(part.part_id);
        const machine = latest ? machineMap[latest.machine_id] || null : null;
        return {
          partId: part.part_id,
          displayPartId: part.part_id,
          isCustomerQrOnly: String(part.qr_format_name || "").trim().toUpperCase() === CUSTOMER_QR_ONLY_FORMAT,
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
      .filter((row) => {
        if (shiftCodeFilter && row.latestAt) {
          return resolveShiftCodeForDate(row.latestAt, shifts) === shiftCodeFilter;
        }
        if (shiftCodeFilter && !row.latestAt) {
          return false;
        }
        return true;
      });

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getMachineStationStats = async (req, res) => {
  try {
    const machineId = Number(req.query.machineId || 0);
    if (!machineId) {
      return res.status(400).json({ error: "machineId query param is required" });
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
    const requestedShiftCode = String(req.query.shiftCode || req.query.shift_code || "").trim().toUpperCase();
    const effectiveShiftCode = isAllShiftToken(requestedShiftCode)
      ? ""
      : (requestedShiftCode || String(currentShift?.shift_code || "").trim().toUpperCase());
    const { from, to } = getOperatorStatsDateRange(req.query, shifts, effectiveShiftCode, currentShift);

    const logs = await OperationLog.findAll({
      where: {
        machine_id: machine.id,
        station_no: stationNo,
        createdAt: {
          [Op.gte]: from,
          [Op.lte]: to,
        },
      },
      order: [["createdAt", "DESC"]],
      limit: 800,
    });

    const partIdsForCustomerQr = [...new Set(logs.map((row) => String(row.part_id || "").trim()).filter(Boolean))];
    const partCodeMappings = partIdsForCustomerQr.length > 0
      ? await PartCodeMapping.findAll({
          where: {
            [Op.or]: [
              { old_part_id: { [Op.in]: partIdsForCustomerQr } },
              { customer_qr: { [Op.in]: partIdsForCustomerQr } },
            ],
            is_active: true,
          },
          attributes: ["old_part_id", "customer_qr"],
          order: [["updatedAt", "DESC"]],
          raw: true,
        })
      : [];
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
      ? applyShiftFilter(effectiveLogs, effectiveShiftCode, shifts)
      : effectiveLogs;

    const summary = getQualitySummaryFromOperationLogs(shiftFilteredLogs, getMappedCustomerQr);
    const selectedShift = effectiveShiftCode
      ? shifts.find((row) => String(row.shift_code || "").trim().toUpperCase() === effectiveShiftCode) || currentShift
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

    res.json({
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
    });
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
    const scannedQrRaw = String(normalizedPartId || "").trim();
    const machineStage = getMachineOperationStage(machine);
    const requestedStage = normalizeStation(stationNo || operation);
    if (requestedStage && machineStage && requestedStage !== machineStage) {
      return res.status(400).json({
        error: `Requested station ${requestedStage} does not match machine operation ${machineStage}`,
      });
    }

    const normalizedStation = machineStage || requestedStage;
    if (!normalizedStation) {
      return res.status(400).json({ error: "stationNo/operation is required" });
    }

    if (scannerRole === "CUSTOMER_QR") {
      const stationFeatures = await getStationFeatureConfig(normalizedStation).catch(() => null);
      const customerRoleGuard = await enforceScannerRoleIfConfigured({
        machine,
        sourceIp: bound.sourceIp,
        allowedRoles: ["CUSTOMER_QR"],
      });
      if (!customerRoleGuard.ok) {
        return res.status(customerRoleGuard.status).json({ error: customerRoleGuard.error });
      }

      const activePartId = await resolveActivePartIdForMachine(machine, normalizedStation);
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

      const existingMapping = await PartCodeMapping.findOne({
        where: {
          customer_qr: scannedQrRaw,
          is_active: true,
        },
      });
      if (existingMapping && String(existingMapping.old_part_id || "").trim() === activePartId) {
        emitOperatorPopup("WARNING", {
          partId: activePartId,
          customerQrCode: scannedQrRaw,
          stationNo: normalizedStation,
          machineId: machine.id,
          machineName: machine.machine_name,
          status: "DUPLICATE",
          plcStatus: "WAITING_PLC",
          qrResult: "DUPLICATE",
          operationStatus: "WAITING",
          reason: "CUSTOMER_QR_ALREADY_MAPPED_SAME_PART",
          message: "Customer QR already mapped to this part. Continue to next station.",
        });
        return res.status(200).json({
          status: "DUPLICATE",
          decision: "ALLOW",
          qrStatus: "DUPLICATE",
          operationStatus: "WAITING",
          reason: "CUSTOMER_QR_ALREADY_MAPPED_SAME_PART",
          message: "Customer QR already mapped to this part. Continue to next station.",
          mapped: true,
          duplicate: true,
          partId: activePartId,
          customerQrCode: scannedQrRaw,
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

      await PartCodeMapping.upsert({
        old_part_id: activePartId,
        customer_qr: scannedQrRaw,
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
        customerQrCode: scannedQrRaw,
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
        customerQrCode: scannedQrRaw,
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
      return res.status(roleGuard.status).json({ error: roleGuard.error });
    }

    const stationFeatures = await getStationFeatureConfig(normalizedStation);
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
      const message = await unknownQrAfterLaserMessage(normalizedStation);
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
    const validateShotNumber = stationFeatures.validateShotNumber !== false;
    const validatePreviousStation = stationFeatures.validatePreviousStation !== false;
    const validateDuplicateBarcode = stationFeatures.validateDuplicateBarcode !== false;
    const validateCustomerCode = stationFeatures.validateCustomerCode === true;
    const bypassState = machineBypassEnabled ? getMachineBypass(machine.id) : null;
    const isCustomerQrOnlyTrace = isCustomerQrOnlyStart || await isCustomerQrOnlyTracePart(normalizedPartId, customerQrCode);
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
      skipQrFormatValidation: isMappedCustomerQrScan || isCustomerQrOnlyStart || !qrValidationEnabled || !validateQrFormat,
      skipShotValidation: isMappedCustomerQrScan || isCustomerQrOnlyTrace || !validateShotNumber,
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
    const qualityAck = await sendQualityCheckAckToPlc(machine, spcConfig, finalResult).catch((error) => ({
      ok: false,
      error: error.message,
    }));

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

    emitOperatorPopup(response.decision === "ALLOW" ? "INFO" : "ERROR", {
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
    const scannedQrRaw = String(inputCode || "").trim();

    const machine = await Machine.findByPk(machineId);
    if (!machine) {
      return res.status(404).json({ error: "Machine not found" });
    }
    const bound = await enforceScannerProtocolBinding({ machine, body: req.body, req });
    if (!bound.ok) {
      return res.status(bound.status).json({ error: bound.error });
    }
    const stationNo = getMachineOperationStage(machine);
    const stationFeatures = await getStationFeatureConfig(stationNo);
    const roleScanners = await Scanner.findAll({
      where: { mapped_machine_id: machine.id, is_active: true },
    });
    const hasCustomerQrScanner = roleScanners.some(
      (scanner) => String(scanner.scanner_role || "").trim().toUpperCase() === "CUSTOMER_QR"
    );
    const activePartIdForMachine = await resolveActivePartIdForMachine(machine, stationNo);
    const existingCustomerMapping = await PartCodeMapping.findOne({
      where: {
        customer_qr: scannedQrRaw,
        is_active: true,
      },
      order: [["updatedAt", "DESC"]],
    });
    const isExistingMappedCustomerQr = Boolean(existingCustomerMapping);
    const isKnownPartId = Boolean(await Part.findOne({ where: { part_id: scannedQrRaw }, attributes: ["part_id"] }));
    const looksLikeCustomerQr =
      requiresCustomerQrForCompletion(machine) &&
      (hasCustomerQrScanner || isExistingMappedCustomerQr) &&
      scannedQrRaw &&
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
      const customerStationFeatures = await getStationFeatureConfig(stationNo).catch(() => null);
      if (
        existingCustomerMapping &&
        String(existingCustomerMapping.old_part_id || "").trim() !== activePartIdForMachine
      ) {
        return res.status(409).json({
          error: "Customer QR already mapped to another part",
        });
      }

      await PartCodeMapping.upsert({
        old_part_id: activePartIdForMachine,
        customer_qr: scannedQrRaw,
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
        customerQrCode: scannedQrRaw,
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
        customerQrCode: scannedQrRaw,
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
      const message = await unknownQrAfterLaserMessage(stationNo);
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
    const validateShotNumber = stationFeatures.validateShotNumber !== false;
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
    const qualityAck = await sendQualityCheckAckToPlc(machine, spcConfig, finalResult).catch((error) => ({
      ok: false,
      error: error.message,
    }));
    const requiredPlcPartCount = normalizePlcPartCount(stationFeatures.plcPartCount || 1);

    await handleStationPlcFlow({
      response,
      machine,
      stationNo,
      partId: finalPartId,
      userId: req.user?.id,
      requiredPlcPartCount,
    });

    const qrStatus = response.decision === "ALLOW" ? "PASS" : "FAIL";
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
    const customerQrCode = String(req.body.customerQrCode || req.body.customerQr || "").trim();
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
  const from = Number.isNaN(fromCandidate.getTime()) ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : fromCandidate;
  const to = Number.isNaN(toCandidate.getTime()) ? now : toCandidate;
  return { from, to };
}

function setDateMinutes(baseDate, minutes) {
  const date = new Date(baseDate);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function getShiftWindowForDate(shift, now = new Date()) {
  const startMinutes = toMinutes(shift?.start_time);
  const endMinutes = toMinutes(shift?.end_time);
  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  const currentMinutes = getMinutesForDate(now);
  let from = setDateMinutes(now, startMinutes);
  let to = setDateMinutes(now, endMinutes);

  if (startMinutes === endMinutes) {
    to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  } else if (startMinutes > endMinutes) {
    if (currentMinutes < endMinutes) {
      from.setDate(from.getDate() - 1);
    } else {
      to.setDate(to.getDate() + 1);
    }
  }

  return { from, to };
}

function getProductionDayWindow(shifts = [], now = new Date()) {
  const starts = shifts
    .map((shift) => toMinutes(shift?.start_time))
    .filter((value) => value !== null);
  const startMinutes = starts.length ? Math.min(...starts) : 6 * 60;
  let from = setDateMinutes(now, startMinutes);
  if (getMinutesForDate(now) < startMinutes) {
    from.setDate(from.getDate() - 1);
  }
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

function getOperatorStatsDateRange(query, shifts, effectiveShiftCode, currentShift) {
  if (query?.dateFrom || query?.dateTo) {
    return getDateRangeFromQuery(query);
  }
  if (effectiveShiftCode) {
    const selectedShift = shifts.find((row) => String(row.shift_code || "").trim().toUpperCase() === effectiveShiftCode) || currentShift;
    const selectedWindow = getShiftWindowForDate(selectedShift);
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

function toMinutes(timeValue) {
  return toShiftMinutes(timeValue);
}

function getMinutesForDate(dateValue) {
  const date = new Date(dateValue);
  return date.getHours() * 60 + date.getMinutes();
}

function isDateInShift(dateValue, shift) {
  const currentMinutes = getMinutesForDate(dateValue);
  const start = toMinutes(shift.start_time);
  const end = toMinutes(shift.end_time);
  if (start === null || end === null) {
    return false;
  }
  if (start === end) {
    return true;
  }
  if (start < end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
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
  for (const shift of shifts) {
    if (isDateInShift(dateValue, shift)) {
      return shift.shift_code;
    }
  }
  return "UNASSIGNED";
}

function applyShiftFilter(rows, shiftCode, shifts) {
  if (!shiftCode) {
    return rows;
  }
  const target = String(shiftCode).trim().toUpperCase();
  return rows.filter((row) => resolveShiftCodeForDate(row.createdAt, shifts) === target);
}

function isAllShiftToken(value) {
  return ["ALL", "ALL_SHIFT", "ALL_SHIFTS"].includes(String(value || "").trim().toUpperCase());
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
    const { from, to } = getDateRangeFromQuery(req.query);
    const lineNameFilter = normalizeLineName(req.query.lineName);
    const machineIdFilter = Number(req.query.machineId || 0) || null;
    const shiftCodeFilter = req.query.shiftCode ? String(req.query.shiftCode).trim().toUpperCase() : null;
    const machineWhere = {};
    if (lineNameFilter) {
      machineWhere.line_name = lineNameFilter;
    }

    const machineRows = await Machine.findAll({
      where: Object.keys(machineWhere).length > 0 ? machineWhere : undefined,
      attributes: ["id", "machine_name", "operation_no", "line_name", "machine_number", "is_active", "updatedAt"],
      raw: true,
    });
    const uniqueMachines = dedupeMachines(machineRows);
    const scopedMachineIds = uniqueMachines
      .filter((row) => row.is_active !== false)
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    const filteredMachineIds = machineIdFilter ? [machineIdFilter] : scopedMachineIds;

    const logWhere = {
      createdAt: { [Op.gte]: from, [Op.lte]: to },
      ...(filteredMachineIds.length > 0 ? { machine_id: { [Op.in]: filteredMachineIds } } : {}),
    };

    const [partCounts, recentRows, qualityRows, shifts] = await Promise.all([
      Part.findAll({
        attributes: ["status", [fn("COUNT", col("id")), "count"]],
        group: ["status"],
        raw: true,
      }),
      OperationLog.findAll({
        where: logWhere,
        order: [["createdAt", "DESC"]],
        limit: 50,
        raw: true,
      }),
      ProductionLog.findAll({
        where: logWhere,
        attributes: ["status", "createdAt", "machine_id"],
        raw: true,
      }),
      getActiveShiftDefinitions(),
    ]);

    const filteredQualityRows = applyShiftFilter(qualityRows, shiftCodeFilter, shifts);
    const filteredRecentRows = applyShiftFilter(recentRows, shiftCodeFilter, shifts).slice(0, 20);
    const okLogs = filteredQualityRows.filter((row) => row.status === "OK").length;
    const ngLogs = filteredQualityRows.filter((row) => row.status === "NG").length;

    const statusMap = partCounts.reduce((acc, row) => {
      acc[row.status] = Number(row.count) || 0;
      return acc;
    }, {});

    const shiftProduction = shifts.reduce((acc, shift) => {
      acc[shift.shift_code] = { total: 0, ok: 0, ng: 0 };
      return acc;
    }, {});
    shiftProduction.UNASSIGNED = { total: 0, ok: 0, ng: 0 };

    for (const row of filteredQualityRows) {
      const code = resolveShiftCodeForDate(row.createdAt, shifts);
      if (!shiftProduction[code]) {
        shiftProduction[code] = { total: 0, ok: 0, ng: 0 };
      }
      shiftProduction[code].total += 1;
      if (row.status === "OK") {
        shiftProduction[code].ok += 1;
      } else {
        shiftProduction[code].ng += 1;
      }
    }

    const machineMap = uniqueMachines.reduce((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});

    const recentScans = filteredRecentRows.map((row) => {
      const machine = machineMap[row.machine_id] || {};
      const start = row.plc_start_time || row.plc_start_at || row.createdAt;
      const end = row.plc_end_time || row.plc_end_at || null;
      let cycleTime = null;
      if (start && end) {
        cycleTime = Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000).toFixed(1);
      }
      return {
        partId: row.part_id,
        stationNo: row.station_no || machine.operation_no || null,
        station: row.station_no || machine.operation_no || null,
        machine: machine.machine_name || null,
        lineName: machine.line_name || null,
        result: row.result || (["STARTED", "PENDING"].includes(String(row.plc_status).toUpperCase()) ? "WIP" : row.plc_status),
        plcStatus: row.plc_status,
        cycleTime,
        timestamp: row.createdAt,
      };
    });

    const interlockedCount = Number(statusMap.INTERLOCKED || 0);
    const reworkCount = Number(statusMap.REWORK || 0);
    const activeCount = uniqueMachines.filter((row) => row.is_active !== false).length;
    const availableLines = uniqueStages(uniqueMachines.map((row) => String(row.line_name || "").trim()).filter(Boolean));

    res.json({
      machines: {
        total: uniqueMachines.length,
        active: activeCount,
        inactive: Math.max(uniqueMachines.length - activeCount, 0),
      },
      parts: {
        inProgress: statusMap.IN_PROGRESS || 0,
        completed: statusMap.COMPLETED || 0,
        ng: statusMap.NG || 0,
        interlocked: interlockedCount,
        rework: reworkCount,
      },
      quality: {
        ok: okLogs,
        ng: ngLogs,
        interlocked: interlockedCount,
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
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDashboardTrends = async (req, res) => {
  try {
    const { from, to } = getDateRangeFromQuery(req.query);
    const lineNameFilter = normalizeLineName(req.query.lineName);
    const machineIdFilter = Number(req.query.machineId || 0) || null;
    const shiftCodeFilter = req.query.shiftCode ? String(req.query.shiftCode).trim().toUpperCase() : null;
    const machineWhere = {};
    if (lineNameFilter) {
      machineWhere.line_name = lineNameFilter;
    }
    const machineRows = await Machine.findAll({
      where: Object.keys(machineWhere).length ? machineWhere : undefined,
      attributes: ["id", "machine_number", "machine_name", "line_name", "operation_no", "updatedAt", "is_active"],
      raw: true,
    });
    const uniqueMachines = dedupeMachines(machineRows).filter((row) => row.is_active !== false);
    const scopedIds = machineIdFilter
      ? [machineIdFilter]
      : uniqueMachines.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

    const [rows, shifts] = await Promise.all([
      ProductionLog.findAll({
        where: {
          createdAt: { [Op.gte]: from, [Op.lte]: to },
          ...(scopedIds.length ? { machine_id: { [Op.in]: scopedIds } } : {}),
        },
        attributes: ["status", "createdAt"],
        raw: true,
      }),
      getActiveShiftDefinitions(),
    ]);

    const filteredRows = applyShiftFilter(rows, shiftCodeFilter, shifts);
    const map = filteredRows.reduce((acc, row) => {
      const key = formatHourBucket(row.createdAt);
      if (!acc[key]) {
        acc[key] = { hour: key, ok: 0, ng: 0, total: 0 };
      }
      if (row.status === "OK") {
        acc[key].ok += 1;
      } else {
        acc[key].ng += 1;
      }
      acc[key].total += 1;
      return acc;
    }, {});

    const trends = Object.values(map).sort((a, b) => String(a.hour).localeCompare(String(b.hour)));

    res.json(trends);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getDashboardReport = async (req, res) => {
  try {
    const { from, to } = getDateRangeFromQuery(req.query);
    const shiftCodeFilter = req.query.shiftCode ? String(req.query.shiftCode).trim().toUpperCase() : null;
    const lineNameFilter = normalizeLineName(req.query.lineName);
    const stationNoFilter = normalizeStation(req.query.stationNo);
    const operatorIdFilter = Number(req.query.operatorId || 0) || null;
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

    const filteredRows = applyShiftFilter(productionRows, shiftCodeFilter, shifts);
    const filteredOperationRows = applyShiftFilter(operationRows, shiftCodeFilter, shifts);
    const productionOperationRows = filteredOperationRows.filter((row) => !isJourneyNoiseLog(row));
    const filteredInterlocks = applyShiftFilter(interlocks, shiftCodeFilter, shifts).filter(
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
      const chunkRows = await PartCodeMapping.findAll({
        where: {
          [Op.or]: [
            { old_part_id: { [Op.in]: chunk } },
            { customer_qr: { [Op.in]: chunk } },
          ],
          is_active: true,
        },
        attributes: ["old_part_id", "customer_qr"],
        order: [["updatedAt", "DESC"]],
        raw: true,
      });
      dashboardPartCodeMappings.push(...chunkRows);
    }
    const customerQrByPartId = dashboardPartCodeMappings.reduce((acc, row) => {
      const key = String(row.old_part_id || "").trim().toUpperCase();
      const customerKey = String(row.customer_qr || "").trim().toUpperCase();
      const customerValue = String(row.customer_qr || "").trim();
      if (key && customerValue && !acc[key]) acc[key] = customerValue;
      if (customerKey && customerValue && !acc[customerKey]) acc[customerKey] = customerValue;
      return acc;
    }, {});
    const getMappedCustomerQrForPart = (partIdValue) =>
      customerQrByPartId[String(partIdValue || "").trim().toUpperCase()] || null;
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
          ? shifts.find((s) => String(s.shift_code || "").toUpperCase() === String(shiftCodeFilter || "").toUpperCase()) || null
          : null;
        const targetQty = computeTargetProduction({ machine: row, shift: shiftForTarget || resolveShift(from, shifts) || shifts[0] || null });
        const idealCycleTimeSeconds = getEffectiveCycleTimeSeconds(row);
        const calc = computeOeeAndOa({
          totalCount: processedCount,
          goodCount: Number(row.okCount || 0),
          runtimeSeconds,
          plannedProductionSeconds,
          idealCycleTimeSeconds,
          downtimeSeconds: downtimeMinutes * 60,
        });
        const shiftResolved = resolveShift(machineLogs[0]?.createdAt || from, shifts);
        const productionDate = getProductionDate(machineLogs[0]?.createdAt || from);
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
    const leakRowsHistory = partIdsHistory.length > 0
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
    const leaktestIndex = (
      await buildLeaktestIndex({
        partIds: partIdsForCustomerQr,
        customerQrByPartId,
        machines: machineRows,
      })
    ).byPartAndStation;
    const getLeakReadingForPart = (partIdValue) => getLeaktestReadingForPartStation(
      leaktestIndex,
      String(partIdValue || "").trim(),
      LEAKTEST_OPERATION
    );
    const mapDashboardRowWithLeak = (row) => {
      const stationNo = normalizeStation(row.station_no || row.operation_no);
      const leakTestReading = getLeakReadingForPart(row.part_id);
      if (stationNo === LEAKTEST_OPERATION && leakTestReading) {
        const leakResult = String(leakTestReading.result || leakTestReading.Result || "").trim().toUpperCase();
        return {
          ...row,
          result: leakResult || row.result,
          plc_status: leakResult === "OK" ? "ENDED_OK" : leakResult === "NG" ? "ENDED_NG" : row.plc_status,
          interlock_reason: null,
          leakTestReading,
        };
      }
      return {
        ...row,
        leakTestReading,
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
      return {
        key: `${month}|${day}|${hour}|${minute}|${shot}`,
        day,
        month,
        hour,
        minute,
        shot,
      };
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
    const leakRows = partIdsForLeak.length > 0
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
      const leakStageState = stationNo === LEAKTEST_OPERATION && leakTestReading
        ? getLeaktestStageState(leakTestReading)
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

      const shotKey = normalizeShotToken(row.shot_number || row.shotNumber || "");
      const fullPartId = String(row.part_id || "").trim();
      const compactQrKey = parseCompactQrPartId(fullPartId)?.key || "";
      const fromPartIdTs = extractYymmddhhmmss(fullPartId);
      const fromPartIdShot = normalizeShotToken(extractShotSuffix(fullPartId));
      const allPartDigitGroups = (fullPartId.match(/\d+/g) || []).map((g) => normalizeShotToken(g)).filter(Boolean);
      const plcReadingRaw = (compactQrKey && plcReadingByCompactQr.get(compactQrKey))
        || (fullPartId && plcReadingByUid.get(fullPartId))
        || (shotKey && plcReadingByShot.get(shotKey))
        || (fromPartIdShot && plcReadingByShot.get(fromPartIdShot))
        || (fromPartIdTs && plcReadingByShot.get(normalizeShotToken(fromPartIdTs)))
        || allPartDigitGroups.map((g) => plcReadingByShot.get(g)).find(Boolean)
        || null;
      const plcReading = enrichPlcReadingDisplay(plcReadingRaw);

      return {
        id: row.id,
        partId: row.part_id,
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
      };
    });

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
      const prodDate = getProductionDate(row.createdAt)?.toISOString().slice(0, 10) || null;
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
      shiftProduction,
      shiftWiseMetrics,
      dayWiseMetrics,
      productionDate: getProductionDate(from)?.toISOString().slice(0, 10),
      interlockHistory: filteredInterlocks,
      reworkCount,
      partJourney: pagedHistory,
      partJourneyPagination: {
        page,
        pageSize,
        total: historyTotal,
      },
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

  const shiftFilteredRows = applyShiftFilter(operationRows, shiftCodeFilter, shifts);
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
    const customerQr = String(row.customer_qr || "").trim();
    const customerKey = customerQr.toUpperCase();
    if (partId && customerQr && !acc[partId]) acc[partId] = customerQr;
    if (customerKey && customerQr && !acc[customerKey]) acc[customerKey] = customerQr;
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
    const isCustomerQrOnlyRow =
      qrFormatName.toUpperCase() === CUSTOMER_QR_ONLY_FORMAT ||
      Boolean(customerQrCode && String(customerQrCode).trim().toUpperCase() === String(row.part_id || "").trim().toUpperCase());
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
      partId: row.part_id || customerQrCode || "",
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
