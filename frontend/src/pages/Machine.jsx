import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu, Plus, Save, Trash2, Edit, RefreshCw, Search,
  X, Network, Activity, Settings,
  Layout, Database, ChevronRight, Info, AlertTriangle, Eye,
  CheckCircle2, XCircle, ShieldOff, ShieldCheck,
  ArrowDownUp, ArrowDown, ArrowUp, Hash, FlaskConical, Zap,
  ToggleLeft, ToggleRight, Download, Copy, Wand2, RotateCcw,
  ScanLine, GitBranch, Cpu as CpuIcon, Pencil,
  CheckSquare, Package, Wrench, Tag, Camera, Gauge, Eye as EyeIcon,
  ListChecks, ChevronDown, ChevronUp, Layers, Radio, Signal,
  ClipboardList, FileDown, ClipboardCopy, Sparkles, RefreshCcw,
  Globe, FileCode, FileSearch,
} from "lucide-react";
import * as LucideIcons from "lucide-react"; // Fallback for dynamic icon resolution if needed
import toast from "react-hot-toast";
import ConfirmModal from "../components/ConfirmModal";
import { machineApi, plcConfigApi, stationSettingsApi, traceabilityApi } from "../api/services";
import {
  MACHINE_MODBUS_TUNING_FIELD_CONFIG,
  MACHINE_REGISTER_ROLE_FIELDS,
} from "../utils/machineFields";
import { loadReportConfig } from "../utils/reportConfig";
import { DEFAULT_STATION_FEATURES, normalizeStationKey } from "../utils/stationSettings";

/* ─── helpers ──────────────────────────────────────────────── */
function toFormValue(v, fallback = "") {
  if (v === null || v === undefined) return fallback;
  return String(v);
}
function toNullableNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toNumberWithDefault(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function normalizeProtocol(value, fallback = "TCP_TEXT") {
  const n = String(value || "").trim().toUpperCase();
  if (!n) return fallback;
  if (n === "MODBUS") return "MODBUS_TCP";
  if (["TCP", "TEXT"].includes(n)) return "TCP_TEXT";
  return n;
}
function normalizeDirectionLabel(direction) {
  const v = String(direction || "").trim().toUpperCase();
  if (v === "PC -> PLC" || v === "PC_TO_PLC" || v === "PC->PLC" || v === "WRITE") return "WRITE  SW->PLC";
  if (v === "PLC -> PC" || v === "PLC_TO_PC" || v === "PLC->PC" || v === "READ") return "READ   PLC->SW";
  if (v === "BIDIRECTIONAL" || v === "BOTH") return "BOTH   PLC<->SW";
  return "READ   PLC->SW";
}
function toRegNumberText(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.trunc(n)) : "";
}
function escapeLine(value) {
  return String(value || "").replace(/\r?\n/g, " ").trim();
}
function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
function createHandshakeRow(overrides = {}) {
  return {
    id: `HS_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    signal: "", direction: "READ", register: "", value: "", meaning: "",
    required: true, category: "handshake",
    ...overrides,
  };
}

/* ─── Signal categories ─────────────────────────────────────── */
const SIGNAL_CATEGORIES = [
  { id: "handshake", label: "Handshake", color: "blue", desc: "Core PLC cycle control signals" },
  { id: "bypass", label: "Bypass", color: "amber", desc: "Bypass/interlock override registers" },
  { id: "rejection", label: "Rejection Bin", color: "red", desc: "Rejection bin open/close/status" },
  { id: "result", label: "Result / Quality", color: "green", desc: "Quality result and ACK registers" },
  { id: "live", label: "Live Data", color: "teal", desc: "Monitoring-only registers" },
];

function buildDefaultHandshakeRows(cfg = {}) {
  return [
    createHandshakeRow({ signal: "Start", direction: "WRITE", register: toFormValue(cfg.startRegister, ""), value: toFormValue(cfg.startValue, "1"), meaning: "Start machine cycle", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "Block / Interlock", direction: "WRITE", register: toFormValue(cfg.blockRegister, ""), value: toFormValue(cfg.blockValue, "2"), meaning: "Block cycle on NG / duplicate / interlock", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "Running", direction: "READ", register: toFormValue(cfg.runningRegister, ""), value: toFormValue(cfg.startedValue, "2"), meaning: "Machine is running", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "End OK", direction: "READ", register: toFormValue(cfg.endOkRegister, ""), value: toFormValue(cfg.endOkValue, "3"), meaning: "Cycle completed OK", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "End NG", direction: "READ", register: toFormValue(cfg.endNgRegister, ""), value: toFormValue(cfg.endNgValue, "4"), meaning: "Cycle completed NG", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "Reset", direction: "WRITE", register: toFormValue(cfg.resetRegister, ""), value: toFormValue(cfg.resetValue, "9"), meaning: "Reset/clear machine state", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "Bypass", direction: "BOTH", register: toFormValue(cfg.bypassRegister, ""), value: "1", meaning: "Bypass Enable (Write) and Status (Read)", required: false, category: "bypass" }),
    createHandshakeRow({ signal: "Rejection Bin", direction: "WRITE", register: "", value: "1", meaning: "Write 1 to open rejection bin", required: false, category: "rejection" }),
  ];
}

function normalizeHandshakeRows(rows, cfg = {}) {
  if (!Array.isArray(rows)) return buildDefaultHandshakeRows(cfg);
  if (rows.length === 0) return [];
  return rows.map((row) => createHandshakeRow({
    id: row?.id || row?.key || undefined,
    signal: toFormValue(row?.signal ?? row?.label, ""),
    direction: String(row?.direction || "READ").toUpperCase(),
    register: toFormValue(row?.register, ""),
    value: toFormValue(row?.value, ""),
    meaning: toFormValue(row?.meaning ?? row?.purpose ?? row?.description, ""),
    required: row?.required === undefined ? true : Boolean(row.required),
    category: row?.category || "handshake",
  }));
}

function getHandshakeSignalGroup(signal) {
  const normalized = String(signal || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (normalized === "START") return "START_GROUP";
  if (normalized === "BLOCK_INTERLOCK") return "BLOCK_GROUP";
  if (normalized === "RUNNING") return "RUNNING_GROUP";
  if (normalized === "END_OK") return "END_OK_GROUP";
  if (normalized === "END_NG") return "END_NG_GROUP";
  if (normalized === "RESET") return "RESET_GROUP";
  if (["CONFIRMATION", "CONFIRM", "ACK", "ACKNOWLEDGE", "ACKNOWLEDGEMENT"].includes(normalized)) return "CONFIRMATION_GROUP";
  if (["BYPASS_ENABLE", "BYPASS", "BYPASS_STATUS"].includes(normalized)) return "BYPASS_GROUP";
  if (["REJECTION_BIN", "REJECTION_BIN_OPEN", "REJECTION"].includes(normalized)) return "REJECTION_GROUP";
  if (["REJECTION_BIN_STATUS", "BIN_FULL"].includes(normalized)) return "REJECTION_GROUP";
  return `CUSTOM_${normalized || "UNNAMED"}`;
}

function normalizeStandardHandshakeSignalKey(signal) {
  const normalized = String(signal || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (normalized === "START") return "START";
  if (["BLOCK", "BLOCK_INTERLOCK", "INTERLOCK"].includes(normalized)) return "BLOCK_INTERLOCK";
  if (["RUNNING", "STARTED"].includes(normalized)) return "RUNNING";
  if (["END_OK", "OK_END", "ENDED_OK"].includes(normalized)) return "END_OK";
  if (["END_NG", "NG_END", "ENDED_NG"].includes(normalized)) return "END_NG";
  if (normalized === "RESET") return "RESET";
  if (["CONFIRMATION", "CONFIRM", "ACK", "ACKNOWLEDGE"].includes(normalized)) return "CONFIRMATION";
  return null;
}

const FAMILIES = {
  CONTROL: ["START", "INTERLOCK", "BLOCK_INTERLOCK", "START_SENT", "WAITING_ACK", "START REGISTER", "BLOCK REGISTER", "INTERLOCK REGISTER"],
  FEEDBACK: ["RUNNING", "END_OK", "END_NG", "COMPLETE", "WAITING_END", "RUNNING REGISTER", "END OK REGISTER", "END NG REGISTER", "COMPLETE REGISTER"],
  BYPASS: ["BYPASS", "BYPASS ENABLE", "BYPASS STATUS", "BYPASS REGISTER"],
  REJECTION: ["REJECTION BIN", "REJECTION BIN STATUS", "REJECTION BIN REGISTER", "BIN OPEN", "BIN STATUS"],
  RESET: ["RESET", "CLEAR", "RESET REGISTER", "RESET SIGNAL"]
};

const getFamily = (label) => {
  const s = String(label || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (s.includes("START")) return "CONTROL";
  if (s.includes("BLOCK") || s.includes("INTERLOCK") || s.includes("HOLD")) return "CONTROL";
  if (s.includes("RUNNING") || s.includes("COMPLETE") || s.includes("STARTED") || s.includes("PROGRESS")) return "FEEDBACK";
  if (s.includes("ENDOK") || s.includes("ENDEDOK") || s.includes("FINISHOK")) return "FEEDBACK";
  if (s.includes("ENDNG") || s.includes("ENDEDNG") || s.includes("FINISHNG")) return "FEEDBACK";
  if (s.includes("BYPASS")) return "BYPASS";
  if (s.includes("REJECTION") || s.includes("BIN") || s.includes("SCRAP")) return "REJECTION";
  if (s.includes("RESET") || s.includes("CLEAR")) return "RESET";
  return `RAW_${s}`;
};

const isCompatible = (labelA, labelB) => {
  if (labelA === labelB) return true;
  const famA = getFamily(labelA);
  const famB = getFamily(labelB);
  if (famA.startsWith("RAW_") || famB.startsWith("RAW_")) return false;
  return famA === famB;
};

const STANDARD_HANDSHAKE_SIGNAL_META = {
  START: { signal: "Start", direction: "WRITE", registerKey: "startRegister", valueKey: "startValue", defaultValue: "1", defaultMeaning: "Start machine cycle" },
  BLOCK_INTERLOCK: { signal: "Block / Interlock", direction: "WRITE", registerKey: "blockRegister", valueKey: "blockValue", defaultValue: "2", defaultMeaning: "Block cycle on NG / duplicate / interlock" },
  RUNNING: { signal: "Running", direction: "READ", registerKey: "runningRegister", valueKey: "startedValue", defaultValue: "2", defaultMeaning: "Machine is running" },
  END_OK: { signal: "End OK", direction: "READ", registerKey: "endOkRegister", valueKey: "endOkValue", defaultValue: "3", defaultMeaning: "Cycle completed OK" },
  END_NG: { signal: "End NG", direction: "READ", registerKey: "endNgRegister", valueKey: "endNgValue", defaultValue: "4", defaultMeaning: "Cycle completed NG" },
  RESET: { signal: "Reset", direction: "WRITE", registerKey: "resetRegister", valueKey: "resetValue", defaultValue: "9", defaultMeaning: "Reset/clear machine state" },
  CONFIRMATION: { signal: "Confirmation", direction: "BOTH", registerKey: "heartbeatRegister", valueKey: null, defaultValue: "1", defaultMeaning: "Confirmation" },
  HEARTBEAT: { signal: "Heartbeat", direction: "BOTH", registerKey: null, valueKey: null, defaultValue: "1", defaultMeaning: "Heartbeat" },
  BYPASS: { signal: "Bypass", direction: "BOTH", registerKey: "bypassRegister", valueKey: null, defaultValue: "1", defaultMeaning: "Bypass Enable (Write) & Status (Read)" },
  REJECTION_BIN: { signal: "Rejection Bin", direction: "WRITE", registerKey: null, valueKey: "1", defaultValue: "1", defaultMeaning: "Open rejection bin" },
  REJECTION_BIN_STATUS: { signal: "Rejection Bin Status", direction: "READ", registerKey: null, valueKey: "1", defaultValue: "1", defaultMeaning: "Rejection bin status" },
};
const REQUIRED_HANDSHAKE_KEYS = ["START", "RUNNING", "END_OK", "END_NG", "RESET"];

function syncStandardHandshakeRowsWithCore(rows, cfg = {}) {
  const nextRows = normalizeHandshakeRows(rows, cfg);
  return nextRows.map((row) => {
    const key = normalizeStandardHandshakeSignalKey(row?.signal);
    if (!key) return row;
    const meta = STANDARD_HANDSHAKE_SIGNAL_META[key];
    if (!meta) return row;
    const synced = { ...row };
    if (meta.registerKey) synced.register = toFormValue(cfg?.[meta.registerKey], row?.register ?? "");
    if (meta.valueKey) synced.value = toFormValue(cfg?.[meta.valueKey], row?.value ?? meta.defaultValue ?? "");
    return createHandshakeRow(synced);
  });
}

function applyStandardHandshakeRowToCoreCfg(cfg = {}, row = {}) {
  const key = normalizeStandardHandshakeSignalKey(row?.signal);
  if (!key) return { ...cfg };
  const meta = STANDARD_HANDSHAKE_SIGNAL_META[key];
  if (!meta) return { ...cfg };
  const nextCfg = { ...cfg };
  if (meta.registerKey) nextCfg[meta.registerKey] = toFormValue(row?.register, nextCfg?.[meta.registerKey] ?? "");
  if (meta.valueKey) nextCfg[meta.valueKey] = toFormValue(row?.value, nextCfg?.[meta.valueKey] ?? meta.defaultValue ?? "");
  return nextCfg;
}

function getHandshakeRegisterEntries(cfg = {}) {
  return normalizeHandshakeRows(cfg?.handshakeMap, cfg).map((row, index) => ({
    register: toWholeNumberOrNull(row?.register),
    direction: String(row?.direction || "READ").trim().toUpperCase(),
    value: toWholeNumberOrNull(row?.value),
    signal: String(row?.signal || "").trim(),
    group: getHandshakeSignalGroup(row?.signal),
    label: `Handshake ${String(row?.signal || `Row ${index + 1}`).trim() || `Row ${index + 1}`}`,
  }));
}

function getHandshakeOccupancyEntries(cfg = {}) {
  const entries = [];
  const seen = new Set();
  const rows = getHandshakeRegisterEntries(cfg);
  for (const row of rows) {
    if (row.register === null) continue;
    const token = `${row.group}:${row.register}`;
    if (seen.has(token)) continue;
    seen.add(token);
    entries.push({ register: row.register, label: row.label });
  }
  return entries;
}

const SLMP_DOUBLE_WORD_KEYS = new Set(["partRegister", "stationRegister"]);

function toWholeNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function getRegisterSpanWords(registerKey, protocol) {
  if (String(protocol || "").toUpperCase() !== "SLMP") return 1;
  return SLMP_DOUBLE_WORD_KEYS.has(String(registerKey || "")) ? 2 : 1;
}
function expandRegisterWindow(registerNo, registerKey, protocol) {
  const base = toWholeNumberOrNull(registerNo);
  if (base === null) return [];
  const width = getRegisterSpanWords(registerKey, protocol);
  return Array.from({ length: width }, (_, index) => base + index);
}
function getConfigOccupiedRegisters(cfg = {}, protocol = "MODBUS_TCP", excludeKey = null) {
  const occupied = new Set();
  for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
    if (excludeKey && field.key === excludeKey) continue;
    const words = expandRegisterWindow(cfg?.[field.key], field.key, protocol);
    words.forEach((w) => occupied.add(w));
  }
  return occupied;
}
function getAuxiliaryRegisterEntries(source = {}) {
  const entries = [];
  const signalRows = Array.isArray(source?.plcSignalMap) ? source.plcSignalMap : [];
  signalRows.forEach((row, index) => {
    const register = toWholeNumberOrNull(row?.register);
    if (register === null) return;
    const label = String(row?.label || row?.key || `Live Register ${index + 1}`).trim();
    entries.push({ register, label: label || `Live Register ${index + 1}` });
  });
  const spc = source?.spcConfig || {};
  const isSpcPlcMode = Boolean(spc?.enabled) && String(spc?.mode || "").toUpperCase() === "PLC_REGISTER";
  if (isSpcPlcMode) {
    const resultRegister = toWholeNumberOrNull(spc?.plcResultRegister);
    if (resultRegister !== null) entries.push({ register: resultRegister, label: "SPC Result Register" });
    const ackRegister = toWholeNumberOrNull(spc?.plcAckRegister);
    if (ackRegister !== null) entries.push({ register: ackRegister, label: "SPC ACK Register" });
  }
  return entries;
}
function getMachineOccupiedRegisterWords(machine = {}, protocol = "MODBUS_TCP") {
  const occupied = new Map();
  const cfg = machine?.plcConfig || {};
  for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
    const words = expandRegisterWindow(cfg?.[field.key], field.key, protocol);
    words.forEach((word) => { if (!occupied.has(word)) occupied.set(word, field.label); });
  }
  getAuxiliaryRegisterEntries(machine).forEach((entry) => {
    expandRegisterWindow(entry.register, null, protocol).forEach((word) => { if (!occupied.has(word)) occupied.set(word, entry.label); });
  });
  getHandshakeOccupancyEntries(cfg).forEach((entry) => {
    expandRegisterWindow(entry.register, null, protocol).forEach((word) => { if (!occupied.has(word)) occupied.set(word, entry.label); });
  });
  return occupied;
}

function normalizeSpcConfigForForm(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const plcOkValues = Array.isArray(source.plcResultOkValues) ? source.plcResultOkValues : String(source.plcResultOkValues || "").split(/[,\n;|]/).map((e) => e.trim()).filter(Boolean);
  const plcNgValues = Array.isArray(source.plcResultNgValues) ? source.plcResultNgValues : String(source.plcResultNgValues || "").split(/[,\n;|]/).map((e) => e.trim()).filter(Boolean);
  const qualityKeys = Array.isArray(source.qualityPayloadKeys) ? source.qualityPayloadKeys : String(source.qualityPayloadKeys || "").split(/[,\n;|]/).map((e) => e.trim()).filter(Boolean);
  const ngValues = Array.isArray(source.payloadResultNgValues) ? source.payloadResultNgValues : String(source.payloadResultNgValues || "").split(/[,\n;|]/).map((e) => e.trim()).filter(Boolean);
  
  return {
    enabled: source.enabled === true,
    mode: String(source.mode || "IP_PUSH").toUpperCase(),
    activeProtocols: Array.isArray(source.activeProtocols) ? source.activeProtocols : [String(source.mode || "IP_PUSH").toUpperCase()],
    priority: Array.isArray(source.priority) ? source.priority : ["HTTP_API", "PLC_REGISTER", "IP_PUSH", "FOLDER", "FTP_FILE"],
    
    // Core acquisition settings
    sourceIp: String(source.sourceIp || ""), 
    sourcePort: toFormValue(source.sourcePort, ""),
    payloadResultKey: String(source.payloadResultKey || "RESULT"),
    payloadResultNgValues: ngValues.join(", "),
    qualityPayloadKeys: qualityKeys.join(", "),

    // Reliability & Parser (Requirement 2 & 5)
    retryCount: toFormValue(source.retryCount ?? 3, "3"),
    retryDelayMs: toFormValue(source.retryDelayMs ?? 1000, "1000"),
    timeoutMs: toFormValue(source.timeoutMs ?? 5000, "5000"),
    parserType: String(source.parserType || "JSON").toUpperCase(),

    // Dynamic Register Mapping (Requirement 21)
    dynamicRegisters: Array.isArray(source.dynamicRegisters) ? source.dynamicRegisters : [],

    // Folder Watcher Config (Requirement 1)
    folderConfig: {
      path: String(source.folderConfig?.path || ""),
      pattern: String(source.folderConfig?.pattern || "*.*"),
      parser: String(source.folderConfig?.parser || "JSON").toUpperCase(),
      deleteAfterRead: source.folderConfig?.deleteAfterRead !== false
    },

    // Legacy/Standard fields
    plcResultRegister: toFormValue(source.plcResultRegister ?? source.resultRegister, ""),
    plcResultDevice: String(source.plcResultDevice || source.resultDevice || "D").toUpperCase(),
    plcResultOkValues: plcOkValues.join(", "), 
    plcResultNgValues: plcNgValues.join(", "),
    plcAckEnabled: source.plcAckEnabled !== false,
    plcAckRegister: toFormValue(source.plcAckRegister ?? source.ackRegister, ""),
    plcAckDevice: String(source.plcAckDevice || source.ackDevice || "D").toUpperCase(),
    plcAckOkValue: toFormValue(source.plcAckOkValue ?? source.ackOkValue ?? "101", "101"),
    plcAckNgValue: toFormValue(source.plcAckNgValue ?? source.ackNgValue ?? "102", "102"),
    plcAckErrorValue: toFormValue(source.plcAckErrorValue ?? source.ackErrorValue ?? "199", "199"),
  };
}

function createEmptyForm() {
  const plcConfig = {
    rangeId: "", startRegister: "", statusRegister: "", blockRegister: "", runningRegister: "",
    endOkRegister: "", endNgRegister: "", partRegister: "", stationRegister: "", resetRegister: "",
    heartbeatRegister: "", bypassRegister: "", startValue: "1", startedValue: "2",
    endOkValue: "3", endNgValue: "4", blockValue: "2", resetValue: "9",
  };
  return {
    machineName: "", lineName: "", sequenceNo: "", operationNo: "", cycleTimeSec: "0",
    loadingTimeSec: "0", dailyTargetQty: "0", plcIp: "", plcPort: "", plcProtocol: "TCP_TEXT",
    plcRangeId: "", plcSlmpDevice: "D", plcSlmpFrameMode: "AUTO", status: "ACTIVE",
    plcConfig: { ...plcConfig, handshakeMap: buildDefaultHandshakeRows(plcConfig) },
    plcSignalMap: [], spcConfig: normalizeSpcConfigForForm({}),
  };
}

function buildFormFromMachine(m) {
  const cfg = m.plcConfig || {};
  const plcRangeId = cfg.rangeId ?? m.plcRangeId ?? "";
  const spcConfig = normalizeSpcConfigForForm(m.spcConfig || m.plcConfig?.spcConfig || {});
  const baseCfg = {
    startRegister: cfg.startRegister ?? m.plcStartRegister,
    statusRegister: cfg.statusRegister ?? cfg.runningRegister ?? m.plcStatusRegister ?? m.plcRunningRegister,
    blockRegister: cfg.blockRegister ?? m.plcBlockRegister,
    runningRegister: cfg.runningRegister ?? m.plcRunningRegister,
    endOkRegister: cfg.endOkRegister ?? m.plcEndOkRegister,
    endNgRegister: cfg.endNgRegister ?? m.plcEndNgRegister,
    resetRegister: cfg.resetRegister ?? m.plcResetRegister,
    heartbeatRegister: cfg.heartbeatRegister ?? m.plcHeartbeatRegister,
    bypassRegister: cfg.bypassRegister ?? m.plcBypassRegister,
    startValue: cfg.startValue ?? m.plcStartValue,
    startedValue: cfg.startedValue ?? m.plcStartedValue,
    endOkValue: cfg.endOkValue ?? m.plcEndOkValue,
    endNgValue: cfg.endNgValue ?? m.plcEndNgValue,
    blockValue: cfg.blockValue ?? m.plcBlockValue,
    resetValue: cfg.resetValue ?? m.plcResetValue,
  };
  const syncedHandshakeMap = syncStandardHandshakeRowsWithCore(
    normalizeHandshakeRows(cfg.handshakeMap, baseCfg), baseCfg
  );
  return {
    machineName: m.machineName || "", lineName: m.lineName || "",
    sequenceNo: toFormValue(m.sequenceNo, ""), operationNo: m.operationNo || "",
    cycleTimeSec: toFormValue(m.cycleTimeSec, "0"), loadingTimeSec: toFormValue(m.loadingTimeSec, "0"),
    dailyTargetQty: toFormValue(m.dailyTargetQty, "0"),
    plcIp: m.plcIp || "", plcPort: toFormValue(m.plcPort, ""),
    plcProtocol: m.plcProtocol || "TCP_TEXT", plcRangeId: toFormValue(plcRangeId, ""),
    plcSlmpDevice: m.plcSlmpDevice || "D",
    plcSlmpFrameMode: m.plcSlmpFrameMode || m.plcConfig?.slmpFrameMode || "AUTO",
    status: m.status || "ACTIVE",
    plcConfig: {
      rangeId: toFormValue(plcRangeId, ""),
      startRegister: toFormValue(cfg.startRegister ?? m.plcStartRegister, ""),
      blockRegister: toFormValue(cfg.blockRegister ?? m.plcBlockRegister, ""),
      statusRegister: toFormValue(cfg.statusRegister ?? cfg.runningRegister ?? m.plcStatusRegister ?? m.plcRunningRegister, ""),
      runningRegister: toFormValue(cfg.runningRegister ?? m.plcRunningRegister, ""),
      endOkRegister: toFormValue(cfg.endOkRegister ?? m.plcEndOkRegister, ""),
      endNgRegister: toFormValue(cfg.endNgRegister ?? m.plcEndNgRegister, ""),
      partRegister: toFormValue(cfg.partRegister ?? m.plcPartRegister, ""),
      stationRegister: toFormValue(cfg.stationRegister ?? m.plcStationRegister, ""),
      resetRegister: toFormValue(cfg.resetRegister ?? m.plcResetRegister, ""),
      heartbeatRegister: toFormValue(cfg.heartbeatRegister ?? m.plcHeartbeatRegister, ""),
      bypassRegister: toFormValue(cfg.bypassRegister ?? m.plcBypassRegister, ""),
      startValue: toFormValue(cfg.startValue ?? m.plcStartValue, "1"),
      startedValue: toFormValue(cfg.startedValue ?? m.plcStartedValue, "2"),
      endOkValue: toFormValue(cfg.endOkValue ?? m.plcEndOkValue, "3"),
      endNgValue: toFormValue(cfg.endNgValue ?? m.plcEndNgValue, "4"),
      blockValue: toFormValue(cfg.blockValue ?? m.plcBlockValue, "2"),
      resetValue: toFormValue(cfg.resetValue ?? m.plcResetValue, "9"),
      handshakeMap: syncedHandshakeMap,
    },
    plcSignalMap: m.plcSignalMap || [], spcConfig,
  };
}

function toSubmitPayload(f) {
  const plcIp = String(f.plcIp || "").trim();
  const plcPort = toNullableNumber(f.plcPort);
  const plcRangeId = toNullableNumber(f.plcRangeId);
  const cfg = { ...(f.plcConfig || {}) };
  const normalizedRows = normalizeHandshakeRows(cfg.handshakeMap, cfg);
  let mergedCfg = { ...cfg };
  for (const row of normalizedRows) {
    mergedCfg = applyStandardHandshakeRowToCoreCfg(mergedCfg, row);
  }
  const syncedRows = syncStandardHandshakeRowsWithCore(normalizedRows, mergedCfg);
  const plcConfig = {
    rangeId: plcRangeId,
    startRegister: toNullableNumber(mergedCfg.startRegister),
    statusRegister: toNullableNumber(mergedCfg.runningRegister ?? mergedCfg.statusRegister),
    blockRegister: toNullableNumber(mergedCfg.blockRegister),
    runningRegister: toNullableNumber(mergedCfg.runningRegister),
    endOkRegister: toNullableNumber(mergedCfg.endOkRegister),
    endNgRegister: toNullableNumber(mergedCfg.endNgRegister),
    partRegister: toNullableNumber(mergedCfg.partRegister),
    stationRegister: toNullableNumber(mergedCfg.stationRegister),
    resetRegister: toNullableNumber(mergedCfg.resetRegister),
    heartbeatRegister: toNullableNumber(mergedCfg.heartbeatRegister),
    bypassRegister: toNullableNumber(mergedCfg.bypassRegister),
    startValue: toNumberWithDefault(mergedCfg.startValue, 1),
    startedValue: toNumberWithDefault(mergedCfg.startedValue, 2),
    endOkValue: toNumberWithDefault(mergedCfg.endOkValue, 3),
    endNgValue: toNumberWithDefault(mergedCfg.endNgValue, 4),
    blockValue: toNumberWithDefault(mergedCfg.blockValue, 2),
    resetValue: toNumberWithDefault(mergedCfg.resetValue, 9),
    handshakeMap: syncedRows.map((row) => ({
      id: row.id || null,
      signal: String(row.signal || "").trim(),
      direction: String(row.direction || "READ").trim().toUpperCase(),
      register: toNullableNumber(row.register),
      value: toNullableNumber(row.value),
      meaning: String(row.meaning || "").trim(),
      required: row.required !== false,
      category: row.category || "handshake",
    })).filter((row) => row.signal || row.register !== null),
    slmpFrameMode: String(f.plcSlmpFrameMode || "AUTO").trim().toUpperCase(),
  };
  const rawSpc = f.spcConfig || {};
  const payloadResultNgValues = String(rawSpc.payloadResultNgValues || "").split(/[,\n;|]/).map((e) => e.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  const qualityPayloadKeys = String(rawSpc.qualityPayloadKeys || "").split(/[,\n;|]/).map((e) => e.trim()).filter(Boolean).slice(0, 40);
  const spcConfig = {
    enabled: rawSpc.enabled === true,
    mode: String(rawSpc.mode || "IP_PUSH").trim().toUpperCase(),
    activeProtocols: rawSpc.activeProtocols || [String(rawSpc.mode || "IP_PUSH").toUpperCase()],
    priority: rawSpc.priority || ["HTTP_API", "PLC_REGISTER", "IP_PUSH", "FOLDER", "FTP_FILE"],
    
    sourceIp: String(rawSpc.sourceIp || "").trim() || null,
    sourcePort: toNullableNumber(rawSpc.sourcePort),
    payloadResultKey: String(rawSpc.payloadResultKey || "RESULT").trim() || "RESULT",
    payloadResultNgValues, 
    qualityPayloadKeys,

    // Reliability & Parser
    retryCount: toNullableNumber(rawSpc.retryCount) ?? 3,
    retryDelayMs: toNullableNumber(rawSpc.retryDelayMs) ?? 1000,
    timeoutMs: toNullableNumber(rawSpc.timeoutMs) ?? 5000,
    parserType: rawSpc.parserType || "JSON",

    // Dynamic Registers
    dynamicRegisters: (rawSpc.dynamicRegisters || []).map(r => ({
      name: String(r.name || "").trim(),
      register: toNullableNumber(r.register),
      device: String(r.device || "D").toUpperCase(),
      type: String(r.type || "INT16").toUpperCase(),
      scale: parseFloat(r.scale) || 1.0,
      unit: String(r.unit || "").trim()
    })).filter(r => r.name && r.register !== null),

    // Folder Watcher
    folderConfig: {
      path: String(rawSpc.folderConfig?.path || "").trim(),
      pattern: String(rawSpc.folderConfig?.pattern || "*.*").trim(),
      parser: String(rawSpc.folderConfig?.parser || "JSON").toUpperCase(),
      deleteAfterRead: rawSpc.folderConfig?.deleteAfterRead !== false
    },

    plcResultRegister: toNullableNumber(rawSpc.plcResultRegister),
    plcResultDevice: String(rawSpc.plcResultDevice || "D").trim().toUpperCase() || "D",
    plcResultOkValues: String(rawSpc.plcResultOkValues || "").split(/[,\n;|]/).map((e) => e.trim().toUpperCase()).filter(Boolean).slice(0, 20),
    plcResultNgValues: String(rawSpc.plcResultNgValues || "").split(/[,\n;|]/).map((e) => e.trim().toUpperCase()).filter(Boolean).slice(0, 20),
    plcAckEnabled: rawSpc.enabled === true,
    plcAckRegister: toNullableNumber(rawSpc.plcAckRegister),
    plcAckDevice: String(rawSpc.plcAckDevice || "D").trim().toUpperCase() || "D",
    plcAckOkValue: toNumberWithDefault(rawSpc.plcAckOkValue, 101),
    plcAckNgValue: toNumberWithDefault(rawSpc.plcAckNgValue, 102),
    plcAckErrorValue: toNumberWithDefault(rawSpc.plcAckErrorValue, 199),
  };
  return {
    machineName: String(f.machineName || "").trim(), lineName: String(f.lineName || "").trim(),
    sequenceNo: toNullableNumber(f.sequenceNo), operationNo: String(f.operationNo || "").trim().toUpperCase(),
    cycleTimeSec: Math.max(toNullableNumber(f.cycleTimeSec) ?? 0, 0),
    loadingTimeSec: Math.max(toNullableNumber(f.loadingTimeSec) ?? 0, 0),
    dailyTargetQty: Math.max(toNullableNumber(f.dailyTargetQty) ?? 0, 0),
    plcIp, plcPort, plcProtocol: f.plcProtocol, plcRangeId,
    plcStatusRegister: plcConfig.statusRegister ?? plcConfig.runningRegister,
    plcConfig, plcBlockValue: plcConfig.blockValue,
    plcSlmpDevice: String(f.plcSlmpDevice || "").trim().toUpperCase() || null,
    plcSlmpFrameMode: plcConfig.slmpFrameMode,
    status: f.status || "ACTIVE",
    machineIp: plcIp, machinePort: plcPort,
    plcSignalMap: f.plcSignalMap || [], spcConfig,
  };
}

const FORM_TABS = [
  { id: "general", label: "Identity", icon: Layout },
  { id: "network", label: "Network & PLC", icon: Network },
  { id: "tuning", label: "Mapping & Tuning", icon: Settings },
  { id: "live", label: "Station Control", icon: Zap },
];

const HANDSHAKE_GROUP_CORE_KEY_MAP = {
  START_GROUP: "startRegister", BLOCK_GROUP: "blockRegister", RUNNING_GROUP: "runningRegister",
  END_OK_GROUP: "endOkRegister", END_NG_GROUP: "endNgRegister", RESET_GROUP: "resetRegister",
};

/* ─── Design tokens ─────────────────────────────────────────── */
const T = {
  navy: "#0f172a", navyMid: "#1e293b", navyLight: "#334155",
  slate: "#475569", slateLight: "#64748b",
  border: "#cbd5e1", borderLight: "#e2e8f0",
  bg: "#f8fafc", bgCard: "#ffffff", bgMuted: "#f1f5f9",
  text: "#0f172a", textSec: "#334155", textMuted: "#64748b",
  blue: "#1d4ed8", blueMid: "#2563eb", blueLight: "#dbeafe", blueBorder: "#bfdbfe",
  green: "#15803d", greenLight: "#dcfce7", greenBorder: "#86efac",
  red: "#dc2626", redLight: "#fee2e2", redBorder: "#fca5a5",
  teal: "#0f766e", tealLight: "#ccfbf1", tealBorder: "#5eead4",
  amber: "#b45309", amberLight: "#fef3c7", amberBorder: "#fcd34d",
  purple: "#7c3aed", purpleLight: "#ede9fe", purpleBorder: "#c4b5fd",
};

const CAT_COLORS = {
  handshake: { bg: T.blueLight, border: T.blueBorder, text: T.blue, label: "Handshake" },
  bypass: { bg: T.amberLight, border: T.amberBorder, text: T.amber, label: "Bypass" },
  rejection: { bg: T.redLight, border: T.redBorder, text: T.red, label: "Rejection Bin" },
  result: { bg: T.greenLight, border: T.greenBorder, text: T.green, label: "Result/Quality" },
  live: { bg: T.tealLight, border: T.tealBorder, text: T.teal, label: "Live Data" },
};

const inp = {
  width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px",
  background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 7,
  fontSize: 13, color: T.text, outline: "none", transition: "border-color .15s, box-shadow .15s",
};

const Label = ({ children, required }) => (
  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 5, display: "flex", alignItems: "center", gap: 3 }}>
    {children}{required && <span style={{ color: T.red }}>*</span>}
  </p>
);

const FieldInput = ({ value, onChange, placeholder, type = "text", mono, readOnly, style: sx = {}, ...rest }) => {
  const [focus, setFocus] = useState(false);
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} readOnly={readOnly}
      style={{ ...inp, fontFamily: mono ? "ui-monospace, monospace" : "inherit", background: readOnly ? T.bgMuted : T.bgCard, boxShadow: focus ? `0 0 0 3px ${T.blueLight}` : "none", borderColor: focus ? T.blueMid : T.border, ...sx }}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} {...rest} />
  );
};

const FieldSelect = ({ value, onChange, children, mono, style: sx = {} }) => {
  const [focus, setFocus] = useState(false);
  return (
    <select value={value} onChange={onChange}
      style={{ ...inp, fontFamily: mono ? "ui-monospace, monospace" : "inherit", boxShadow: focus ? `0 0 0 3px ${T.blueLight}` : "none", borderColor: focus ? T.blueMid : T.border, cursor: "pointer", ...sx }}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}>
      {children}
    </select>
  );
};

/* ─── Toggle switch ──────────────────────────────────────────── */
const Toggle = ({ checked, onChange, label, note, color = T.blue }) => (
  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", userSelect: "none" }}>
    <span onClick={() => onChange(!checked)} style={{
      display: "inline-flex", alignItems: "center", flexShrink: 0,
      width: 40, height: 22, borderRadius: 999, marginTop: 2,
      background: checked ? color : T.borderLight, transition: "background .2s", position: "relative", cursor: "pointer",
    }}>
      <span style={{
        position: "absolute", left: checked ? 20 : 2, width: 18, height: 18,
        borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)",
        transition: "left .2s",
      }} />
    </span>
    <span>
      <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.text }}>{label}</span>
      {note && <span style={{ display: "block", fontSize: 10, color: T.textMuted, marginTop: 2 }}>{note}</span>}
    </span>
  </label>
);

const DirectionIcon = ({ direction, size = 10 }) => {
  if (direction === "WRITE") return <ArrowDown size={size} />;
  if (direction === "BOTH") return <ArrowDownUp size={size} />;
  return <ArrowUp size={size} />;
};

const ActionBadge = ({ action }) => {
  const isWrite = action === "WRITE";
  const isBoth = action === "BOTH";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 800, letterSpacing: "0.07em", padding: "2px 7px", borderRadius: 4, background: isWrite ? T.blueLight : isBoth ? T.tealLight : T.greenLight, color: isWrite ? T.blue : isBoth ? T.teal : T.green, border: `1px solid ${isWrite ? T.blueBorder : isBoth ? T.tealBorder : T.greenBorder}`, whiteSpace: "nowrap" }}>
      <DirectionIcon direction={action} size={9} />
      {action}
    </span>
  );
};

const Chip = ({ label, color = "blue" }) => {
  const map = {
    blue: { bg: T.blueLight, text: T.blue, border: T.blueBorder },
    green: { bg: T.greenLight, text: T.green, border: T.greenBorder },
    red: { bg: T.redLight, text: T.red, border: T.redBorder },
    teal: { bg: T.tealLight, text: T.teal, border: T.tealBorder },
    amber: { bg: T.amberLight, text: T.amber, border: T.amberBorder },
    purple: { bg: T.purpleLight, text: T.purple, border: T.purpleBorder },
    gray: { bg: T.bgMuted, text: T.slate, border: T.border },
  };
  const c = map[color] || map.gray;
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: c.bg, color: c.text, border: `1px solid ${c.border}`, whiteSpace: "nowrap", letterSpacing: "0.05em" }}>
      {label}
    </span>
  );
};

const IconBtn = ({ icon: Icon, title, onClick, color, hoverBg, hoverColor, hoverBorder }) => {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} title={title}
      style={{ width: 30, height: 30, border: `1px solid ${hov ? (hoverBorder || color || T.border) : T.border}`, borderRadius: 7, background: hov ? (hoverBg || color + "18") : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: hov ? (hoverColor || color || T.textMuted) : T.textMuted, transition: "all .12s" }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <Icon size={13} />
    </button>
  );
};

/* ─── Toolbar Action Button ─────────────────────────────────── */
const ToolbarBtn = ({ icon: Icon, label, onClick, color = T.navy, bg, border, title }) => {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" onClick={onClick} title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px",
        fontSize: 12, fontWeight: 600, borderRadius: 8,
        border: `1px solid ${hov ? (border || color) : T.border}`,
        background: hov ? (bg || color + "12") : T.bgCard,
        color: hov ? color : T.textSec,
        cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap",
      }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      <Icon size={13} />{label}
    </button>
  );
};

const BypassBadge = ({ enabled, reason }) => (
  <div>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: enabled ? T.amberLight : T.bgMuted, color: enabled ? T.amber : T.textMuted, border: `1px solid ${enabled ? T.amberBorder : T.border}` }}>
      {enabled ? <ShieldOff size={10} /> : <ShieldCheck size={10} />}
      {enabled ? "Bypassed" : "Normal"}
    </span>
    {enabled && reason && (
      <p style={{ fontSize: 10, color: T.amber, margin: "3px 0 0", maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={reason}>{reason}</p>
    )}
  </div>
);

const StatusBadge = ({ status }) => {
  const isActive = status === "ACTIVE";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: isActive ? T.greenLight : T.bgMuted, color: isActive ? T.green : T.textMuted, border: `1px solid ${isActive ? T.greenBorder : T.border}` }}>
      {isActive ? <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.green }} /> : <XCircle size={9} />}
      {isActive ? "Active" : "Offline"}
    </span>
  );
};

const modalOverlay = { position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(15,23,42,0.65)", backdropFilter: "blur(4px)" };

/* ─── Station feature definitions ───────────────────────────── */
const STATION_FEATURES = [
  { key: "qr", label: "QR / Barcode Scan", note: "Require QR or barcode scan before cycle", color: T.blue, hasRegister: false },
  { key: "operation", label: "Sequence Validation", note: "Enforce previous station sequence check", color: T.blue, hasRegister: false },
  { key: "manualResult", label: "Manual Result Entry", note: "Operator can enter OK/NG result manually", color: T.purple, hasRegister: false },
  { key: "rejectionBin", label: "Rejection Bin", note: "Use rejection/rework bin signal", color: T.red, hasRegister: false },
  { key: "rejectionBinStatus", label: "Bin Full Status", note: "Read bin-full feedback from PLC", color: T.red, hasRegister: false },
  { key: "finalPacking", label: "Final Packing Station", note: "Mark as last station before dispatch", color: T.green, hasRegister: false },
  { key: "rework", label: "Rework Station", note: "Allow re-scanning reworked parts", color: T.amber, hasRegister: false },
  { key: "labelPrint", label: "Label Printing", note: "Trigger label/tag print on cycle OK", color: T.navy, hasRegister: true, registerKey: "labelPrintRegister", registerNote: "Write register: trigger label print" },
  { key: "camera", label: "Camera / Vision", note: "Integrate camera/vision system result", color: T.purple, hasRegister: true, registerKey: "cameraResultRegister", registerNote: "Read register: camera pass/fail result" },
  { key: "torque", label: "Torque / Force Check", note: "Include torque/force measurement", color: T.teal, hasRegister: true, registerKey: "torqueRegister", registerNote: "Read register: torque/force measurement" },
  { key: "partPresence", label: "Part Presence Check", note: "Verify part is seated before starting", color: T.blue, hasRegister: true, registerKey: "partPresenceRegister", registerNote: "Read register: part sensor signal" },
];

/* ─── Section Card component ────────────────────────────────── */
const SectionCard = ({ title, subtitle, icon: Icon, iconColor = T.blue, iconBg = T.blueLight, iconBorder = T.blueBorder, action, children, noPad }) => (
  <div style={{ background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 12, overflow: "hidden" }}>
    <div style={{ padding: "12px 16px", background: T.bgMuted, borderBottom: `1px solid ${T.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {Icon && (
          <div style={{ width: 30, height: 30, borderRadius: 8, background: iconBg, border: `1px solid ${iconBorder}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon size={14} color={iconColor} />
          </div>
        )}
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T.text }}>{title}</p>
          {subtitle && <p style={{ margin: "2px 0 0", fontSize: 11, color: T.textMuted }}>{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
    {!noPad && <div style={{ padding: 16 }}>{children}</div>}
    {noPad && children}
  </div>
);

/* ─── Protocol Icon Helper ──────────────────────────────────── */
const ProtocolIcon = ({ icon: Icon, size = 14, color = T.blue }) => {
  const Target = Icon || LucideIcons.HelpCircle;
  return <Target size={size} color={color} />;
};

/* ============================================================ */
/*  MAIN COMPONENT                                              */
/* ============================================================ */
const MachinePage = () => {
  const [machines, setMachines] = useState([]);
  const [plcRanges, setPlcRanges] = useState([]);
  const [stationSettingsMap, setStationSettingsMap] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [viewMachine, setViewMachine] = useState(null);
  const [editingMachine, setEditingMachine] = useState(null);
  const [formData, setFormData] = useState(() => createEmptyForm());
  const [searchTerm, setSearchTerm] = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [bypassModalMachine, setBypassModalMachine] = useState(null);
  const [bypassEnabled, setBypassEnabled] = useState(false);
  const [bypassReason, setBypassReason] = useState("");
  const [bypassing, setBypassing] = useState(false);
  const [savingStationSettings, setSavingStationSettings] = useState(false);
  const [activeTuningCategory, setActiveTuningCategory] = useState("all");

  const loadData = useCallback(async () => {
    try {
      const [machineRows, rangeRows, stationRows] = await Promise.all([
        machineApi.list(),
        plcConfigApi.listRanges().catch(() => []),
        stationSettingsApi.list().catch(() => ({})),
      ]);
      setMachines(machineRows || []);
      setPlcRanges(rangeRows || []);
      setStationSettingsMap(stationRows && typeof stationRows === "object" ? stationRows : {});
    } catch { toast.error("Failed to load machine data"); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const rangeById = useMemo(() => plcRanges.reduce((acc, r) => { acc[r.id] = r; return acc; }, {}), [plcRanges]);
  const normalizedProtocol = normalizeProtocol(formData.plcProtocol, "TCP_TEXT");
  const isModbus = normalizedProtocol === "MODBUS_TCP";
  const isSlmp = normalizedProtocol === "SLMP";
  const usesRange = isModbus || isSlmp;

  const selectableRanges = useMemo(() => {
    const selectedIp = String(formData.plcIp || "").trim();
    const pool = plcRanges.filter(r => String(r.status || "").toUpperCase() === "ACTIVE" && (!usesRange || normalizeProtocol(r.plcProtocol, "MODBUS_TCP") === normalizedProtocol) && (!selectedIp || String(r.plcIp || "").trim() === selectedIp));
    const map = new Map(pool.map(r => [String(r.id), r]));
    const editRangeId = toNullableNumber(editingMachine?.plcRangeId || editingMachine?.plcConfig?.rangeId);
    if (editRangeId && rangeById[editRangeId]) map.set(String(editRangeId), rangeById[editRangeId]);
    return Array.from(map.values());
  }, [plcRanges, editingMachine, formData.plcIp, normalizedProtocol, usesRange, rangeById]);

  const filteredMachines = useMemo(() => {
    const s = searchTerm.trim().toLowerCase();
    return machines.filter(m => {
      const ms = !s || [m.machineName, m.lineName, m.operationNo, m.plcIp].some(v => String(v || "").toLowerCase().includes(s));
      const ml = lineFilter === "all" || m.lineName === lineFilter;
      const mst = statusFilter === "all" || m.status === statusFilter;
      return ms && ml && mst;
    }).sort((a, b) => (Number(a.sequenceNo) || 0) - (Number(b.sequenceNo) || 0));
  }, [machines, searchTerm, lineFilter, statusFilter]);

  const lines = useMemo(() => [...new Set(machines.map(m => m.lineName).filter(Boolean))].sort(), [machines]);

  const stats = useMemo(() => ({
    total: machines.length,
    active: machines.filter(m => m.status === "ACTIVE").length,
    configured: machines.filter(m => m.plcIp).length,
    bypassed: machines.filter(m => Boolean(m.machineBypassEnabled)).length,
  }), [machines]);

  const handshakeRows = useMemo(
    () => normalizeHandshakeRows(formData?.plcConfig?.handshakeMap, formData?.plcConfig || {}),
    [formData?.plcConfig]
  );
  const filteredHandshakeRows = useMemo(() => {
    if (activeTuningCategory === "all") return handshakeRows;
    return handshakeRows.filter(r => (r.category || "handshake") === activeTuningCategory);
  }, [handshakeRows, activeTuningCategory]);

  const currentStationNo = useMemo(
    () => normalizeStationKey(formData?.operationNo || editingMachine?.operationNo || ""),
    [formData?.operationNo, editingMachine?.operationNo]
  );

  const currentStationFeatures = useMemo(() => {
    if (!currentStationNo) return { ...DEFAULT_STATION_FEATURES };
    return { ...DEFAULT_STATION_FEATURES, ...(stationSettingsMap?.[currentStationNo] || {}) };
  }, [stationSettingsMap, currentStationNo]);

  const operationSequenceSummary = useMemo(() => {
    const rows = (machines || []).filter(m => String(m?.status || "ACTIVE").toUpperCase() === "ACTIVE").sort((a, b) => Number(a?.sequenceNo || 0) - Number(b?.sequenceNo || 0));
    const ops = [];
    const seen = new Set();
    for (const row of rows) {
      const op = normalizeStationKey(row?.operationNo);
      if (!op || seen.has(op)) continue;
      seen.add(op);
      ops.push(op);
    }
    const currentIndex = currentStationNo ? ops.findIndex(e => e === currentStationNo) : -1;
    return { totalOperations: ops.length, operationIndex: currentIndex >= 0 ? currentIndex + 1 : null, operations: ops };
  }, [machines, currentStationNo]);

  const registerConflicts = useMemo(() => {
    if (!usesRange) return [];
    const cfg = formData?.plcConfig || {};
    const auxiliaryEntries = getAuxiliaryRegisterEntries(formData);
    const handshakeEntries = getHandshakeRegisterEntries(cfg);
    const conflicts = [];
    const range = rangeById[formData?.plcRangeId];
    const selfOccupancy = new Map();

    // FAMILIES, getFamily, and isCompatible moved to global scope

    for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
      const base = toWholeNumberOrNull(cfg[field.key]);
      if (base === null) continue;
      const words = expandRegisterWindow(base, field.key, normalizedProtocol);
      for (const word of words) {
        if (range && (word < Number(range.rangeStart) || word > Number(range.rangeEnd))) { conflicts.push(`${field.label} uses R${word}, outside range.`); continue; }
        selfOccupancy.set(word, field.label);
      }
    }
    for (const entry of auxiliaryEntries) {
      const words = expandRegisterWindow(entry.register, null, normalizedProtocol);
      for (const word of words) {
        if (range && (word < Number(range.rangeStart) || word > Number(range.rangeEnd))) { conflicts.push(`${entry.label} uses R${word}, outside range.`); continue; }
        selfOccupancy.set(word, entry.label);
      }
    }
    handshakeEntries.forEach(entry => {
      if (entry.register === null) return;
      expandRegisterWindow(entry.register, null, normalizedProtocol).forEach(word => {
        if (range && (word < Number(range.rangeStart) || word > Number(range.rangeEnd))) conflicts.push(`${entry.label} R${word} outside range.`);
        selfOccupancy.set(word, entry.label);
      });
    });
    if (!formData?.plcRangeId) return [...new Set(conflicts)];
    const currentMachineId = Number(editingMachine?.id || 0);
    const peerOccupied = new Map();
    for (const machine of machines) {
      if (Number(machine?.id || 0) === currentMachineId) continue;
      if (Number(machine?.plcRangeId || machine?.plcConfig?.rangeId || 0) !== Number(formData.plcRangeId)) continue;
      const peerProtocol = normalizeProtocol(machine?.plcProtocol, "MODBUS_TCP");
      const occupied = getMachineOccupiedRegisterWords(machine, peerProtocol);
      occupied.forEach((label, registerNo) => { peerOccupied.set(registerNo, `${machine.machineName || "Machine"} - ${label}`); });
    }
    selfOccupancy.forEach((_label, word) => { if (peerOccupied.has(word)) conflicts.push(`R${word} conflicts with ${peerOccupied.get(word)}.`); });
    return [...new Set(conflicts)];
  }, [usesRange, formData?.plcConfig, formData?.plcSignalMap, formData?.spcConfig, formData?.plcRangeId, rangeById, normalizedProtocol, machines, editingMachine?.id]);

  const handshakeInputIssues = useMemo(() => {
    const issues = new Map();
    const cfg = formData?.plcConfig || {};
    const entries = getHandshakeRegisterEntries(cfg);
    if (entries.length === 0) return issues;
    const range = rangeById[formData?.plcRangeId];
    entries.forEach((entry, index) => {
      if (entry.register === null) return;
      const registerNo = entry.register;
      if (range && (registerNo < Number(range.rangeStart) || registerNo > Number(range.rangeEnd))) {
        issues.set(index, `R${registerNo} is outside selected range.`);
      }
    });
    return issues;
  }, [formData?.plcConfig, formData?.plcRangeId, rangeById]);

  const industrialMappingIssues = useMemo(() => {
    const issues = [];
    const rows = normalizeHandshakeRows(formData?.plcConfig?.handshakeMap, formData?.plcConfig || {});
    const normalizedRows = rows
      .map((row) => {
        const key = normalizeStandardHandshakeSignalKey(row?.signal);
        return { key, signal: String(row?.signal || "").trim(), direction: String(row?.direction || "").trim().toUpperCase(), register: toWholeNumberOrNull(row?.register), value: toWholeNumberOrNull(row?.value) };
      })
      .filter((row) => row.key);
    for (const requiredKey of REQUIRED_HANDSHAKE_KEYS) {
      const entry = normalizedRows.find((row) => row.key === requiredKey);
      if (!entry) { issues.push(`Missing required handshake signal: ${requiredKey}.`); continue; }
      if (entry.register === null) { issues.push(`${requiredKey}: register is required.`); }
      if (entry.value === null) { issues.push(`${requiredKey}: value is required.`); }
    }
    const directionExpectations = { START: "WRITE", RUNNING: "READ", END_OK: "READ", END_NG: "READ", RESET: "WRITE" };
    for (const [key, expectedDirection] of Object.entries(directionExpectations)) {
      const entry = normalizedRows.find((row) => row.key === key);
      if (!entry) continue;
      if (entry.direction !== expectedDirection) { issues.push(`${key}: direction must be ${expectedDirection}.`); }
    }
    return [...new Set(issues)];
  }, [formData?.plcConfig]);

  const activeTabIndex = useMemo(() => Math.max(FORM_TABS.findIndex(tab => tab.id === activeTab), 0), [activeTab]);
  const isLastTab = activeTabIndex >= FORM_TABS.length - 1;
  const goToTabByIndex = (nextIndex) => { if (nextIndex < 0 || nextIndex >= FORM_TABS.length) return; setActiveTab(FORM_TABS[nextIndex].id); };

  const validateCurrentTab = (tabId = activeTab) => {
    if (tabId === "general") {
      if (!String(formData.machineName || "").trim()) return "Machine name is required.";
      if (!String(formData.operationNo || "").trim()) return "Operation code is required.";
      if (!String(formData.sequenceNo || "").trim()) return "Sequence number is required.";
    }
    if (tabId === "network") {
      if (!String(formData.plcIp || "").trim()) return "PLC IP address is required.";
      if (usesRange && !String(formData.plcRangeId || "").trim()) return "Select a PLC range before continuing.";
    }
    if (tabId === "tuning") {
      if (registerConflicts.length > 0) return registerConflicts[0];
      if (industrialMappingIssues.length > 0) return industrialMappingIssues[0];
    }
    return null;
  };

  const saveAndNext = () => {
    const err = validateCurrentTab(activeTab);
    if (err) { toast.error(err); return; }
    if (!isLastTab) { goToTabByIndex(activeTabIndex + 1); toast.success(`Step saved. Continue with ${FORM_TABS[activeTabIndex + 1].label}.`); }
  };
  const goPrevious = () => goToTabByIndex(activeTabIndex - 1);

  const getHandshakeRangeBounds = () => {
    const range = rangeById[formData?.plcRangeId];
    if (!range) return null;
    return { start: Number(range.rangeStart), end: Number(range.rangeEnd) };
  };

  const buildHandshakeBlockedRegisters = (ignoreRowIndex = null, rows = handshakeRows, includeHandshakeRows = true) => {
    const blocked = new Set();
    const currentMachineId = Number(editingMachine?.id || 0);
    for (const machine of machines) {
      if (Number(machine?.id || 0) === currentMachineId) continue;
      if (Number(machine?.plcRangeId || machine?.plcConfig?.rangeId || 0) !== Number(formData?.plcRangeId || 0)) continue;
      const peerProtocol = normalizeProtocol(machine?.plcProtocol, "MODBUS_TCP");
      getMachineOccupiedRegisterWords(machine, peerProtocol).forEach((_label, registerNo) => blocked.add(registerNo));
    }
    const cfg = formData?.plcConfig || {};
    for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
      expandRegisterWindow(cfg?.[field.key], field.key, normalizedProtocol).forEach(word => blocked.add(word));
    }
    getAuxiliaryRegisterEntries(formData).forEach(entry => {
      expandRegisterWindow(entry.register, null, normalizedProtocol).forEach(word => blocked.add(word));
    });
    if (includeHandshakeRows) {
      rows.forEach((row, index) => {
        if (ignoreRowIndex !== null && index === ignoreRowIndex) return;
        const registerNo = toWholeNumberOrNull(row?.register);
        if (registerNo === null) return;
        expandRegisterWindow(registerNo, null, normalizedProtocol).forEach(word => blocked.add(word));
      });
    }
    return blocked;
  };

  const findNextFreeHandshakeRegister = (rowIndex, rows = handshakeRows) => {
    const bounds = getHandshakeRangeBounds();
    if (!bounds) return null;
    const blocked = buildHandshakeBlockedRegisters(rowIndex, rows, true);
    for (let registerNo = bounds.start; registerNo <= bounds.end; registerNo += 1) {
      if (!blocked.has(registerNo)) return registerNo;
    }
    return null;
  };

  const autoAssignHandshakeRegister = (rowIndex) => {
    if (!usesRange || !String(formData?.plcRangeId || "").trim()) { toast.error("Select PLC range first."); return; }
    const rows = normalizeHandshakeRows(formData?.plcConfig?.handshakeMap, formData?.plcConfig || {});
    const nextRegister = findNextFreeHandshakeRegister(rowIndex, rows);
    if (nextRegister === null) { toast.error("No free register found in range."); return; }
    const targetLabel = rows?.[rowIndex]?.signal || `Signal ${rowIndex + 1}`;
    rows[rowIndex] = { ...rows[rowIndex], register: String(nextRegister) };
    let nextCfg = { ...(formData?.plcConfig || {}) };
    nextCfg = applyStandardHandshakeRowToCoreCfg(nextCfg, rows[rowIndex]);
    const syncedRows = syncStandardHandshakeRowsWithCore(rows, nextCfg);
    setFormData(p => ({ ...p, plcConfig: { ...nextCfg, handshakeMap: syncedRows } }));
    toast.success(`${targetLabel}: assigned R${nextRegister}`);
  };

  const autoAssignAllHandshakeRegisters = () => {
    if (!usesRange || !String(formData?.plcRangeId || "").trim()) { toast.error("Select PLC range first."); return; }
    const bounds = getHandshakeRangeBounds();
    if (!bounds) { toast.error("Selected range not found."); return; }
    const rows = normalizeHandshakeRows(formData?.plcConfig?.handshakeMap, formData?.plcConfig || {});
    if (!rows.length) { toast.error("No rows to assign."); return; }
    const blocked = buildHandshakeBlockedRegisters(null, [], false);
    let pointer = bounds.start;
    let assignedCount = 0;
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index]?.register) continue;
      while (pointer <= bounds.end && blocked.has(pointer)) pointer++;
      if (pointer > bounds.end) { toast.error(`No free register for row ${index + 1}.`); return; }
      rows[index] = { ...rows[index], register: String(pointer) };
      blocked.add(pointer);
      pointer++;
      assignedCount++;
    }
    let nextCfg = { ...(formData?.plcConfig || {}) };
    rows.forEach(row => { nextCfg = applyStandardHandshakeRowToCoreCfg(nextCfg, row); });
    const syncedRows = syncStandardHandshakeRowsWithCore(rows, nextCfg);
    setFormData(p => ({ ...p, plcConfig: { ...nextCfg, handshakeMap: syncedRows } }));
    toast.success(`Auto-assigned ${assignedCount} registers.`);
  };

  const updateField = (key, value) => {
    if (key === "plcProtocol") {
      setFormData(prev => ({ ...prev, plcProtocol: String(value).toUpperCase(), plcRangeId: "", plcConfig: { ...prev.plcConfig, rangeId: "", startRegister: "", statusRegister: "", blockRegister: "", runningRegister: "", endOkRegister: "", endNgRegister: "", partRegister: "", stationRegister: "", resetRegister: "", heartbeatRegister: "", bypassRegister: "" } }));
      return;
    }
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handshakeCoreSyncKeys = new Set(["startRegister", "blockRegister", "runningRegister", "endOkRegister", "endNgRegister", "resetRegister", "heartbeatRegister", "bypassRegister", "startValue", "blockValue", "startedValue", "endOkValue", "endNgValue", "resetValue"]);

  const updateCfg = (k, v) => setFormData(p => {
    const baseCfg = { ...(p.plcConfig || {}) };
    const nextCfg = { ...baseCfg, [k]: v };
    const rows = normalizeHandshakeRows(baseCfg.handshakeMap, baseCfg);
    nextCfg.handshakeMap = handshakeCoreSyncKeys.has(k) ? syncStandardHandshakeRowsWithCore(rows, nextCfg) : rows;
    return { ...p, plcConfig: nextCfg };
  });

  const addHandshakeRow = (category = "handshake") => setFormData(p => ({
    ...p, plcConfig: {
      ...(p.plcConfig || {}),
      handshakeMap: [...normalizeHandshakeRows(p?.plcConfig?.handshakeMap, p.plcConfig), createHandshakeRow({ signal: "New Signal", category })]
    }
  }));

  const updateHandshakeRow = (index, key, value) => setFormData(p => {
    const currentCfg = { ...(p.plcConfig || {}) };
    const rows = [...normalizeHandshakeRows(currentCfg.handshakeMap, currentCfg)];
    
    // Clean up old core register mapping if the signal type changes
    if (key === "signal") {
      const oldKey = normalizeStandardHandshakeSignalKey(rows[index]?.signal);
      if (oldKey && STANDARD_HANDSHAKE_SIGNAL_META[oldKey]) {
        const meta = STANDARD_HANDSHAKE_SIGNAL_META[oldKey];
        if (meta.registerKey) currentCfg[meta.registerKey] = "";
        if (meta.valueKey) currentCfg[meta.valueKey] = "";
      }
    }
    
    rows[index] = { ...rows[index], [key]: value };
    const nextCfg = applyStandardHandshakeRowToCoreCfg(currentCfg, rows[index]);
    const syncedRows = syncStandardHandshakeRowsWithCore(rows, nextCfg);
    return { ...p, plcConfig: { ...nextCfg, handshakeMap: syncedRows } };
  });

  const removeHandshakeRow = (index) => setFormData(p => {
    const currentCfg = { ...(p.plcConfig || {}) };
    const rows = [...normalizeHandshakeRows(currentCfg.handshakeMap, currentCfg)];
    
    // Clean up corresponding core register mapping
    const rowToRemove = rows[index];
    const key = normalizeStandardHandshakeSignalKey(rowToRemove?.signal);
    if (key && STANDARD_HANDSHAKE_SIGNAL_META[key]) {
      const meta = STANDARD_HANDSHAKE_SIGNAL_META[key];
      if (meta.registerKey) currentCfg[meta.registerKey] = "";
      if (meta.valueKey) currentCfg[meta.valueKey] = "";
    }
    
    rows.splice(index, 1);
    return { ...p, plcConfig: { ...currentCfg, handshakeMap: rows } };
  });

  const syncHandshakeRowsFromRegisters = () => setFormData(p => {
    const currentCfg = { ...(p.plcConfig || {}) };
    const rows = syncStandardHandshakeRowsWithCore(normalizeHandshakeRows(currentCfg.handshakeMap, currentCfg), currentCfg);
    return { ...p, plcConfig: { ...currentCfg, handshakeMap: rows } };
  });

  const applyStandardTuning = () => setFormData(p => ({
    ...p, plcConfig: (() => {
      const nextCfg = { ...(p.plcConfig || {}), startValue: "1", startedValue: "2", endOkValue: "3", endNgValue: "4", blockValue: "2", resetValue: "9" };
      return { ...nextCfg, handshakeMap: syncStandardHandshakeRowsWithCore(normalizeHandshakeRows(nextCfg.handshakeMap, nextCfg), nextCfg) };
    })()
  }));

  const updateCurrentStationFeature = (key, value) => {
    if (!currentStationNo) { toast.error("Enter Operation code to map station settings."); return; }
    const normalizedValue = key === "plcPartCount" ? Math.min(Math.max(Math.trunc(Number(value) || 1), 1), 20) : value;
    setStationSettingsMap(prev => ({
      ...prev,
      [currentStationNo]: { ...DEFAULT_STATION_FEATURES, ...(prev?.[currentStationNo] || {}), [key]: normalizedValue },
    }));
  };

  const saveCurrentStationSettings = async () => {
    if (!currentStationNo) { toast.error("Operation code is required."); return; }
    const payload = { [currentStationNo]: { ...DEFAULT_STATION_FEATURES, ...(stationSettingsMap?.[currentStationNo] || {}) } };
    setSavingStationSettings(true);
    try {
      const res = await stationSettingsApi.save(payload);
      if (res?.settings && typeof res.settings === "object") setStationSettingsMap(prev => ({ ...prev, ...res.settings }));
      toast.success(`Station settings saved for ${currentStationNo}`);
    } catch (error) { toast.error(error?.response?.data?.error || "Unable to save station settings."); }
    finally { setSavingStationSettings(false); }
  };

  const copyPlcGuide = async () => {
    const cfg = formData.plcConfig || {};
    const syncedRows = syncStandardHandshakeRowsWithCore(cfg.handshakeMap, cfg);
    const guide = [
      `MACHINE: ${formData.machineName || "-"} | LINE: ${formData.lineName || "-"} | OP: ${formData.operationNo || "-"}`,
      `IP: ${formData.plcIp || "-"}  PORT: ${formData.plcPort || "-"}`, "",
      "SIGNAL MAP",
      ...syncedRows.map(row => `[${row.category?.toUpperCase() || "HANDSHAKE"}] ${row.signal} | ${row.direction} | R${row.register || "-"} | V:${row.value || "-"} | ${row.meaning}`),
    ].join("\n");
    try { await navigator.clipboard.writeText(guide); toast.success("PLC guide copied to clipboard"); }
    catch { toast.error("Unable to copy PLC guide"); }
  };

  const downloadCurrentPlcSpec = () => {
    try {
      const cfg = formData.plcConfig || {};
      const rows = [["Category", "Signal", "Direction", "Register", "Value", "Purpose", "Required"]];
      normalizeHandshakeRows(cfg.handshakeMap, cfg).forEach(row => {
        rows.push([row.category || "handshake", row.signal, row.direction, row.register ? `R${row.register}` : "", row.value || "", row.meaning, row.required ? "Yes" : "No"]);
      });
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const a = document.createElement("a");
      a.href = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csv);
      a.download = `${String(formData.machineName || "machine").replace(/[^\w-]+/g, "_")}_signal_map.csv`;
      a.click();
      toast.success("Signal map CSV downloaded");
    } catch { toast.error("Unable to generate CSV"); }
  };

  const openCreate = () => { setFormData(createEmptyForm()); setEditingMachine(null); setActiveTab("general"); setShowModal(true); };
  const openEdit = (m) => { setFormData(buildFormFromMachine(m)); setEditingMachine(m); setActiveTab("general"); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditingMachine(null); };

  const openBypassModal = (machine) => {
    const currentlyEnabled = Boolean(machine?.machineBypassEnabled);
    setBypassModalMachine(machine);
    setBypassEnabled(!currentlyEnabled);
    setBypassReason(String(machine?.machineBypassReason || "").trim() || "MANUAL_BYPASS");
  };
  const closeBypassModal = () => { setBypassModalMachine(null); setBypassEnabled(false); setBypassReason(""); };

  const getSaveErrorMessage = (err) => {
    const data = err?.response?.data || {};
    const details = Array.isArray(data?.details) ? data.details : [];
    if (details.includes("qrScannerIp")) return "Duplicate Scanner IP detected. Keep Scanner IP empty or use a unique value.";
    if (details.includes("machineNumber")) return "Machine Number already exists. Please change operation/sequence or use a different machine number.";
    
    if (data.error === "Invalid machine PLC mapping" && details.length > 0) {
      return `Mapping Error: ${details[0]}`;
    }

    return data?.error || "Failed to save machine";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validateCurrentTab(activeTab);
    if (err) { toast.error(err); return; }
    if (!isLastTab) { saveAndNext(); return; }
    setSaving(true);
    try {
      if (registerConflicts.length > 0) { toast.error(registerConflicts[0]); return; }
      if (industrialMappingIssues.length > 0) { toast.error(industrialMappingIssues[0]); return; }
      const payload = toSubmitPayload(formData);
      if (editingMachine) await machineApi.update(editingMachine.id, payload);
      else await machineApi.create(payload);
      
      // Also save station features if operation code is present
      if (currentStationNo) {
        try {
          await saveCurrentStationSettings();
        } catch (sErr) {
          console.warn("Machine saved but station settings failed:", sErr);
        }
      }

      toast.success(editingMachine ? "Machine updated" : "Machine created");
      closeModal(); await loadData();
    } catch (err) { toast.error(getSaveErrorMessage(err)); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    try { await machineApi.remove(deleteConfirmId); toast.success("Machine removed"); await loadData(); }
    catch { toast.error("Failed to remove machine"); }
    finally { setDeleteConfirmId(null); }
  };

  const submitBypass = async (e) => {
    e.preventDefault();
    if (!bypassModalMachine) return;
    try {
      setBypassing(true);
      const response = await traceabilityApi.bypass({
        machineId: bypassModalMachine.id, stationNo: bypassModalMachine.operationNo,
        reason: String(bypassReason || "").trim() || "MANUAL_BYPASS", bypassEnabled,
      });
      const newBypassEnabled = response?.bypassEnabled !== undefined ? Boolean(response.bypassEnabled) : bypassEnabled;
      const newBypassReason = response?.bypassReason ?? (bypassEnabled ? bypassReason : null);
      toast.success(newBypassEnabled ? `Bypass enabled for ${bypassModalMachine.machineName}` : `Bypass disabled for ${bypassModalMachine.machineName}`);
      setMachines(prev => (prev || []).map(row => Number(row?.id) === Number(bypassModalMachine.id) ? { ...row, machineBypassEnabled: newBypassEnabled, machineBypassReason: newBypassReason } : row));
      await loadData();
      closeBypassModal();
    } catch (err) { toast.error(err.response?.data?.error || "Bypass failed"); }
    finally { setBypassing(false); }
  };

  const statCards = [
    { label: "Total Machines", value: stats.total, color: T.navy, border: T.borderLight, icon: Database },
    { label: "Active", value: stats.active, color: T.green, border: T.greenBorder, icon: CheckCircle2 },
    { label: "PLC Configured", value: stats.configured, color: T.blue, border: T.blueBorder, icon: Network },
    { label: "Bypassed", value: stats.bypassed, color: T.amber, border: T.amberBorder, icon: ShieldOff },
  ];

  const categoryCounts = useMemo(() => {
    const counts = {};
    handshakeRows.forEach(r => { const cat = r.category || "handshake"; counts[cat] = (counts[cat] || 0) + 1; });
    return counts;
  }, [handshakeRows]);

  const getStationRegisterValue = (registerKey) => currentStationFeatures?.[registerKey] || "";
  const updateStationRegister = (registerKey, value) => updateCurrentStationFeature(registerKey, value);

  /* ═══════════════════════════════════════════════════════════ */
  /*  RENDER                                                     */
  /* ═══════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6 rise-in">
      {/* Header */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box"><Cpu size={22} /></div>
            <div>
              <h1 className="db-header-title">Machine Registry</h1>
              <p className="db-header-subtitle">Manage production equipment, PLC connections &amp; register mapping</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadData} className="db-secondary-btn"><RefreshCw size={13} /> Refresh</button>
            <button onClick={openCreate} className="db-action-btn"><Plus size={14} /> Add Machine</button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 12 }}>
        {statCards.map(s => {
          const IC = s.icon;
          return (
            <div key={s.label} style={{ background: T.bgCard, border: `1px solid ${s.border}`, borderRadius: 12, padding: "16px 18px", borderLeft: `3px solid ${s.color}`, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, margin: 0 }}>{s.label}</p>
                <IC size={14} color={s.color} />
              </div>
              <p style={{ fontSize: 26, fontWeight: 800, color: s.color, fontFamily: "ui-monospace, monospace", lineHeight: 1, margin: 0 }}>{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.textMuted }} />
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search by name, line, IP or operation..."
            style={{ ...inp, height: 38, paddingLeft: 36, width: "100%", boxSizing: "border-box" }} />
        </div>
        <FieldSelect value={lineFilter} onChange={e => setLineFilter(e.target.value)} style={{ width: 160 }}>
          <option value="all">All Lines</option>
          {lines.map(l => <option key={l} value={l}>{l}</option>)}
        </FieldSelect>
        <FieldSelect value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 140 }}>
          <option value="all">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </FieldSelect>
      </div>

      {/* Table */}
      <div style={{ background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.borderLight}`, background: T.bgMuted, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Database size={14} color={T.blue} />
            <p style={{ fontSize: 11, fontWeight: 700, color: T.text, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 }}>Machine Registry</p>
          </div>
          <span style={{ fontSize: 11, color: T.textMuted, background: T.bg, border: `1px solid ${T.border}`, padding: "3px 10px", borderRadius: 6 }}>
            {filteredMachines.length} machine{filteredMachines.length !== 1 ? "s" : ""}
          </span>
        </div>
        {filteredMachines.length === 0 ? (
          <div style={{ padding: "60px 24px", textAlign: "center", color: T.textMuted }}>
            <Database size={36} style={{ margin: "0 auto 12px", opacity: 0.2 }} />
            <p style={{ fontWeight: 600, fontSize: 13 }}>No machines found</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: T.bgMuted, borderBottom: `1px solid ${T.borderLight}` }}>
                  {["Seq", "Machine", "Line", "Operation", "PLC / Protocol", "Range", "Target", "Status", "Bypass", "Actions"].map(h => (
                    <th key={h} style={{ padding: "10px 16px", textAlign: h === "Actions" ? "right" : "left", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: T.textMuted, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMachines.map((m, idx) => {
                  const range = rangeById[m.plcRangeId || m.plcConfig?.rangeId];
                  const isBypassEnabled = Boolean(m.machineBypassEnabled);
                  return (
                    <tr key={m.id} style={{ borderBottom: `1px solid ${T.borderLight}`, background: idx % 2 === 1 ? T.bgMuted : T.bgCard, transition: "background .1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = T.blueLight + "55"}
                      onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 1 ? T.bgMuted : T.bgCard}>
                      <td style={{ padding: "12px 16px", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: T.textMuted, fontSize: 12 }}>{String(m.sequenceNo || 0).padStart(2, "0")}</td>
                      <td style={{ padding: "12px 16px" }}><p style={{ fontWeight: 700, color: T.text, margin: 0 }}>{m.machineName}</p></td>
                      <td style={{ padding: "12px 16px", color: T.textSec }}>{m.lineName || "-"}</td>
                      <td style={{ padding: "12px 16px" }}><span style={{ fontFamily: "ui-monospace,monospace", color: T.blue, fontWeight: 700 }}>{m.operationNo || "-"}</span></td>
                      <td style={{ padding: "12px 16px" }}>
                        <p style={{ fontFamily: "ui-monospace,monospace", fontSize: 12, color: T.blue, margin: 0 }}>{m.plcIp || "Not set"}{m.plcPort ? `:${m.plcPort}` : ""}</p>
                        <p style={{ fontSize: 10, color: T.textMuted, margin: "2px 0 0", textTransform: "uppercase" }}>{m.plcProtocol || "-"}</p>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        {range ? (
                          <span style={{ padding: "2px 8px", background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 4, fontSize: 11, fontFamily: "ui-monospace,monospace", color: T.blue, fontWeight: 600 }}>{(m.plcSlmpDevice || "D")}{range.rangeStart}-{(m.plcSlmpDevice || "D")}{range.rangeEnd}</span>
                        ) : <span style={{ color: T.textMuted, fontSize: 12 }}>-</span>}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <p style={{ fontWeight: 700, color: T.text, margin: 0 }}>{m.dailyTargetQty || 0}</p>
                        <p style={{ fontSize: 10, color: T.textMuted, margin: "2px 0 0" }}>CT {Number(m.cycleTimeSec || 0)}s / LT {Number(m.loadingTimeSec || 0)}s</p>
                      </td>
                      <td style={{ padding: "12px 16px" }}><StatusBadge status={m.status} /></td>
                      <td style={{ padding: "12px 16px" }}><BypassBadge enabled={isBypassEnabled} reason={m.machineBypassReason} /></td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                          <IconBtn icon={Eye} title="View Config" onClick={() => setViewMachine(m)} color={T.blue} hoverBg={T.blueLight} hoverColor={T.blue} hoverBorder={T.blueBorder} />
                          <IconBtn icon={isBypassEnabled ? ShieldCheck : ShieldOff} title={isBypassEnabled ? "Disable Bypass" : "Enable Bypass"} onClick={() => openBypassModal(m)} color={T.amber} hoverBg={T.amberLight} hoverColor={T.amber} hoverBorder={T.amberBorder} />
                          <IconBtn icon={Edit} title="Edit" onClick={() => openEdit(m)} color={T.navyMid} hoverBg={T.bgMuted} hoverColor={T.navy} hoverBorder={T.navyLight} />
                          <IconBtn icon={Trash2} title="Delete" onClick={() => setDeleteConfirmId(m.id)} color={T.red} hoverBg={T.redLight} hoverColor={T.red} hoverBorder={T.redBorder} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ADD / EDIT MODAL                                        */}
      {/* ═══════════════════════════════════════════════════════ */}
      {showModal && (
        <div style={modalOverlay}>
          <div style={{ position: "absolute", inset: 0 }} onClick={closeModal} />
          <div style={{ position: "relative", width: "100%", maxWidth: 960, background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "94vh", boxShadow: "0 24px 60px rgba(15,23,42,.22)" }}>
            <div style={{ height: 3, background: `linear-gradient(90deg, ${T.navy}, ${T.blue})` }} />
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${T.borderLight}`, background: T.bgCard, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: T.blueLight, border: `1px solid ${T.blueBorder}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Cpu size={18} color={T.blue} />
                </div>
                <div>
                  <h2 style={{ fontWeight: 700, color: T.text, margin: 0, fontSize: 15 }}>{editingMachine ? "Edit Machine" : "Add New Machine"}</h2>
                  <p style={{ fontSize: 11, color: T.textMuted, margin: "2px 0 0" }}>{editingMachine ? `Machine ID: ${editingMachine.id}` : "Fill in the details to register a new machine"}</p>
                </div>
              </div>
              <button onClick={closeModal} style={{ width: 32, height: 32, border: `1px solid ${T.border}`, borderRadius: 8, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.textMuted }}>
                <X size={16} />
              </button>
            </div>

            {/* Tabs */}
            <div style={{ padding: "0 24px", borderBottom: `1px solid ${T.borderLight}`, background: T.bgMuted, display: "flex", gap: 0 }}>
              {FORM_TABS.map(tab => {
                const active = activeTab === tab.id;
                const TI = tab.icon;
                return (
                  <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "12px 14px", border: "none", borderBottom: `2px solid ${active ? T.blue : "transparent"}`, background: "transparent", color: active ? T.blue : T.textMuted, fontSize: 12, fontWeight: active ? 700 : 600, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s" }}>
                    <TI size={13} />{tab.label}
                  </button>
                );
              })}
            </div>

            {/* Form body */}
            <form id="machine-form" onSubmit={handleSubmit} onKeyDown={e => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") e.preventDefault(); }} style={{ flex: 1, overflowY: "auto", padding: 24, background: T.bg }}>

              {/* ─── GENERAL ───────────────────────────────────── */}
              {activeTab === "general" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <Label required>Machine Name</Label>
                    <FieldInput required value={formData.machineName} onChange={e => updateField("machineName", e.target.value)} placeholder="e.g. OP-010 Press" />
                  </div>
                  <div><Label>Line / Department</Label><FieldInput value={formData.lineName} onChange={e => updateField("lineName", e.target.value)} placeholder="Assembly Line A" /></div>
                  <div><Label>Status</Label><FieldSelect value={formData.status} onChange={e => updateField("status", e.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></FieldSelect></div>
                  <div><Label>Sequence No</Label><FieldInput type="number" value={formData.sequenceNo} onChange={e => updateField("sequenceNo", e.target.value)} placeholder="1" mono /></div>
                  <div>
                    <Label>Operation Codes</Label>
                    <FieldInput value={formData.operationNo} onChange={e => updateField("operationNo", e.target.value.toUpperCase())} placeholder="e.g. OP010, OP020" mono />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                      {(formData.operationNo || "").split(/[,\s]+/).filter(Boolean).map(op => <Chip key={op} label={op} color="blue" />)}
                    </div>
                  </div>
                  <div><Label>Daily Target</Label><FieldInput type="number" value={formData.dailyTargetQty} onChange={e => updateField("dailyTargetQty", e.target.value)} placeholder="480" mono /></div>
                  <div><Label>Cycle Time (sec)</Label><FieldInput type="number" value={formData.cycleTimeSec} onChange={e => updateField("cycleTimeSec", e.target.value)} placeholder="45" mono /></div>
                  <div><Label>Loading Time (sec)</Label><FieldInput type="number" value={formData.loadingTimeSec} onChange={e => updateField("loadingTimeSec", e.target.value)} placeholder="15" mono /></div>
                </div>
              )}

              {/* ─── NETWORK ──────────────────────────────────── */}
              {activeTab === "network" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  <div>
                    <Label>PLC Protocol</Label>
                    <FieldSelect value={formData.plcProtocol} onChange={e => updateField("plcProtocol", e.target.value)}>
                      <option value="TCP_TEXT">Generic TCP Text</option>
                      <option value="MODBUS_TCP">Modbus TCP</option>
                      <option value="SLMP">SLMP - Mitsubishi</option>
                    </FieldSelect>
                  </div>
                  {isSlmp && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <div>
                        <Label>SLMP Device Family</Label>
                        <FieldInput value={formData.plcSlmpDevice} onChange={e => updateField("plcSlmpDevice", String(e.target.value || "").toUpperCase())} placeholder="D" mono />
                      </div>
                      <div>
                        <Label>SLMP Frame Mode</Label>
                        <FieldSelect value={formData.plcSlmpFrameMode} onChange={e => updateField("plcSlmpFrameMode", String(e.target.value || "AUTO").toUpperCase())} mono>
                          <option value="AUTO">AUTO</option><option value="ASCII">ASCII</option><option value="BINARY">BINARY</option>
                        </FieldSelect>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div>
                      <Label required>PLC IP Address</Label>
                      <FieldSelect value={formData.plcIp} onChange={e => { const newIp = e.target.value; updateField("plcIp", newIp); const matching = plcRanges.find(r => String(r.plcIp).trim() === newIp); if (matching && matching.plcPort) updateField("plcPort", String(matching.plcPort)); }} mono>
                        <option value="">- Select IP Address -</option>
                        {[...new Set(plcRanges.map(r => String(r.plcIp).trim()).filter(Boolean))].map(ip => <option key={ip} value={ip}>{ip}</option>)}
                      </FieldSelect>
                    </div>
                    <div><Label>Port</Label><FieldInput type="number" value={formData.plcPort} onChange={e => updateField("plcPort", e.target.value)} placeholder="502" mono /></div>
                  </div>
                  {usesRange && (
                    <div style={{ padding: 16, background: T.blueLight + "55", border: `1px solid ${T.blueBorder}`, borderRadius: 10 }}>
                      <Label>PLC Register Block (Range)</Label>
                      <FieldSelect value={formData.plcRangeId} onChange={e => updateField("plcRangeId", e.target.value)}>
                        <option value="">- Select PLC Range -</option>
                        {selectableRanges.map(r => <option key={r.id} value={r.id}>R{r.rangeStart}-R{r.rangeEnd} ({r.plcIp})</option>)}
                      </FieldSelect>
                      {formData.plcRangeId && rangeById[formData.plcRangeId] && (
                        <div style={{ marginTop: 10, padding: "10px 12px", background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
                          <div><span style={{ color: T.textMuted }}>Start: </span><span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: T.blue }}>{(formData.plcSlmpDevice || "D")}{rangeById[formData.plcRangeId].rangeStart}</span></div>
                          <div><span style={{ color: T.textMuted }}>End: </span><span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: T.blue }}>{(formData.plcSlmpDevice || "D")}{rangeById[formData.plcRangeId].rangeEnd}</span></div>
                          <div><span style={{ color: T.textMuted }}>IP: </span><span style={{ fontFamily: "ui-monospace,monospace", color: T.blue }}>{rangeById[formData.plcRangeId].plcIp}</span></div>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ padding: "12px 14px", background: T.bgMuted, border: `1px solid ${T.border}`, borderRadius: 9, display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <Info size={14} color={T.textMuted} style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 12, color: T.textSec, lineHeight: 1.6, margin: 0 }}>
                      Modbus TCP default port: <code style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: T.blue }}>502</code>. SLMP: <code style={{ fontFamily: "ui-monospace,monospace", color: T.blue }}>5000/5006</code>. Generic TCP: <code style={{ fontFamily: "ui-monospace,monospace", color: T.blue }}>9001</code>.
                    </p>
                  </div>
                </div>
              )}

              {/* ─── MAPPING & TUNING ─────────────────────────── */}
              {activeTab === "tuning" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

                  {/* ── Toolbar ─────────────────────────────── */}
                  <div style={{ background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 12, padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${T.borderLight}` }}>
                      <Layers size={14} color={T.blue} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Signal Actions</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                      {/* Left: actions */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <ToolbarBtn icon={Wand2} label="Auto-Assign All" onClick={autoAssignAllHandshakeRegisters} color={T.teal} border={T.tealBorder} title="Auto-assign registers to all unassigned signals" />
                        <ToolbarBtn icon={RefreshCcw} label="Sync Registers" onClick={syncHandshakeRowsFromRegisters} color={T.slate} title="Re-sync handshake rows from core register values" />
                        <ToolbarBtn icon={Sparkles} label="Apply Standard Values" onClick={applyStandardTuning} color={T.blue} border={T.blueBorder} title="Apply default 1/2/3/4/9 value scheme" />
                        <div style={{ width: 1, height: 28, background: T.borderLight, alignSelf: "center" }} />
                        <ToolbarBtn icon={ClipboardCopy} label="Copy PLC Guide" onClick={copyPlcGuide} color={T.navyMid} title="Copy full signal map to clipboard as text" />
                        <ToolbarBtn icon={FileDown} label="Export CSV" onClick={downloadCurrentPlcSpec} color={T.purple} border={T.purpleBorder} title="Download signal map as CSV file" />
                      </div>
                      {/* Right: add signal */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.07em" }}>Add Signal:</span>
                        {SIGNAL_CATEGORIES.map(cat => {
                          const cc = CAT_COLORS[cat.id] || CAT_COLORS.handshake;
                          return (
                            <button key={cat.id} type="button" onClick={() => addHandshakeRow(cat.id)}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: `1px solid ${cc.border}`, color: cc.text, background: cc.bg, cursor: "pointer", whiteSpace: "nowrap" }}>
                              <Plus size={10} />{cat.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ── Category filter ──────────────────────── */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>Show:</span>
                    {[{ id: "all", label: "All Signals", count: handshakeRows.length }, ...SIGNAL_CATEGORIES.map(c => ({ ...c, count: categoryCounts[c.id] || 0 }))].map(cat => {
                      const isActive = activeTuningCategory === cat.id;
                      const cc = cat.id === "all" ? { bg: T.bgMuted, border: T.border, text: T.textSec } : CAT_COLORS[cat.id] || CAT_COLORS.handshake;
                      return (
                        <button key={cat.id} type="button" onClick={() => setActiveTuningCategory(cat.id)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 99, border: `1.5px solid ${isActive ? cc.border : T.borderLight}`, background: isActive ? cc.bg : "transparent", color: isActive ? cc.text : T.textMuted, cursor: "pointer", transition: "all .15s" }}>
                          {cat.label}
                          {cat.count > 0 && (
                            <span style={{ minWidth: 18, height: 18, borderRadius: 99, background: isActive ? cc.text : T.border, color: isActive ? cc.bg : T.textMuted, fontSize: 9, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{cat.count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Signal rows ──────────────────────────── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {filteredHandshakeRows.length === 0 && (
                      <div style={{ padding: "48px 24px", textAlign: "center", border: `2px dashed ${T.border}`, borderRadius: 12, color: T.textMuted, background: T.bgMuted }}>
                        <Signal size={28} style={{ margin: "0 auto 10px", opacity: 0.3 }} />
                        <p style={{ fontWeight: 700, fontSize: 13, margin: "0 0 4px" }}>No signals in this category</p>
                        <p style={{ fontSize: 12, margin: 0 }}>Use the "Add Signal" buttons above to get started.</p>
                      </div>
                    )}

                    {filteredHandshakeRows.map((row) => {
                      const actualIndex = handshakeRows.findIndex(r => r.id === row.id);
                      const isWrite = row.direction === "WRITE";
                      const isBoth = row.direction === "BOTH";
                      const cat = row.category || "handshake";
                      const cc = CAT_COLORS[cat] || CAT_COLORS.handshake;
                      const registerIssue = handshakeInputIssues.get(actualIndex);
                      const rangeBounds = getHandshakeRangeBounds();

                      return (
                        <div key={row.id || `${row.signal}-${actualIndex}`}
                          style={{ background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 10, overflow: "hidden", transition: "box-shadow .15s" }}
                          onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(15,23,42,.07)"}
                          onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>

                          {/* Row header bar */}
                          <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", background: cc.bg + "88", borderBottom: `1px solid ${cc.border}` }}>
                            <div style={{ width: 3, height: 22, borderRadius: 2, background: cc.text, marginRight: 10, flexShrink: 0 }} />
                            <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 99, background: cc.bg, color: cc.text, border: `1px solid ${cc.border}`, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: 8 }}>{cc.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: T.text, flex: 1, marginRight: 8 }}>{row.signal || `Signal ${actualIndex + 1}`}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                              <ActionBadge action={row.direction || "READ"} />
                              {row.register && (
                                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: T.blue, fontWeight: 800, background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 4, padding: "1px 7px" }}>{(row.device || formData.plcSlmpDevice || "D")}{row.register}</span>
                              )}
                              {row.value !== "" && row.value !== null && row.value !== undefined && (
                                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: T.navy, fontWeight: 700, background: T.bgMuted, border: `1px solid ${T.border}`, borderRadius: 4, padding: "1px 6px" }}>={row.value}</span>
                              )}
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: T.textMuted, cursor: "pointer", marginLeft: 8 }}>
                                <input type="checkbox" checked={row.required !== false} onChange={e => updateHandshakeRow(actualIndex, "required", e.target.checked)} style={{ accentColor: T.blue }} />
                                <span>Required</span>
                              </label>
                              {/* Auto-assign button */}
                              <button type="button" onClick={() => autoAssignHandshakeRegister(actualIndex)} title="Auto-assign next free register"
                                style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 9px", border: `1px solid ${T.tealBorder}`, borderRadius: 6, background: T.tealLight, color: T.teal, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                                <Wand2 size={10} /> Auto
                              </button>
                              {/* Remove button */}
                              <button type="button" onClick={() => removeHandshakeRow(actualIndex)} title="Remove this signal"
                                style={{ width: 26, height: 26, border: `1px solid ${T.redBorder}`, borderRadius: 6, background: T.redLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.red }}>
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>

                          {/* Row fields */}
                          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 100px 100px 120px 80px 1fr", gap: 10, padding: "12px 14px", alignItems: "end" }}>
                            <div>
                              <Label>Signal Name</Label>
                              <FieldInput value={row.signal || ""} onChange={e => updateHandshakeRow(actualIndex, "signal", e.target.value)} placeholder="e.g. Start, Bin Open" />
                            </div>
                            <div>
                              <Label>Category</Label>
                              <FieldSelect value={row.category || "handshake"} onChange={e => updateHandshakeRow(actualIndex, "category", e.target.value)}>
                                {SIGNAL_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                              </FieldSelect>
                            </div>
                            <div>
                              <Label>Direction</Label>
                              <FieldSelect value={row.direction || "READ"} onChange={e => updateHandshakeRow(actualIndex, "direction", e.target.value)}>
                                <option value="READ">READ (PLC→SW)</option>
                                <option value="WRITE">WRITE (SW→PLC)</option>
                                <option value="BOTH">BOTH (PLC↔SW)</option>
                              </FieldSelect>
                            </div>
                            <div>
                              <Label>
                                Register
                                {registerIssue && <span style={{ color: T.red, fontWeight: 700, marginLeft: 4 }}>[CONFLICT]</span>}
                              </Label>
                              {usesRange && rangeBounds ? (
                                <FieldSelect value={row.register ?? ""} onChange={e => updateHandshakeRow(actualIndex, "register", e.target.value)} mono
                                  style={registerIssue ? { borderColor: T.red, background: T.redLight } : {}}>
                                  <option value="">— Select —</option>
                                  {Array.from({ length: rangeBounds.end - rangeBounds.start + 1 }, (_, i) => rangeBounds.start + i).map(n => (
                                    <option key={n} value={n}>{(formData.plcSlmpDevice || "D")}{n}</option>
                                  ))}
                                </FieldSelect>
                              ) : (
                                <FieldInput type="number" value={row.register ?? ""} onChange={e => updateHandshakeRow(actualIndex, "register", e.target.value)} placeholder="101" mono
                                  style={registerIssue ? { borderColor: T.red, background: T.redLight } : {}} />
                              )}
                              {registerIssue && (
                                <p style={{ fontSize: 9, color: T.red, fontWeight: 700, marginTop: 4, textTransform: "none", lineHeight: 1.2 }}>{registerIssue}</p>
                              )}
                            </div>
                            <div>
                              <Label>Value</Label>
                              <FieldInput type="number" value={row.value ?? ""} onChange={e => updateHandshakeRow(actualIndex, "value", e.target.value)} placeholder="1" mono
                                style={{ background: row.value !== "" && row.value !== null && row.value !== undefined ? T.blueLight : "", borderColor: row.value !== "" && row.value !== null ? T.blueBorder : T.border, fontWeight: 700, color: T.navy }} />
                            </div>
                            <div>
                              <Label>Purpose / Meaning</Label>
                              <FieldInput value={row.meaning || ""} onChange={e => updateHandshakeRow(actualIndex, "meaning", e.target.value)} placeholder="Describe this signal's purpose" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Summary Table ────────────────────────── */}
                  {handshakeRows.length > 0 && (
                    <SectionCard title="Signal Summary" subtitle={`${handshakeRows.length} total signals configured`} icon={ClipboardList} iconColor={T.blue} iconBg={T.blueLight} iconBorder={T.blueBorder}
                      action={
                        <div style={{ display: "flex", gap: 6 }}>
                          <ToolbarBtn icon={ClipboardCopy} label="Copy" onClick={copyPlcGuide} color={T.navy} title="Copy to clipboard" />
                          <ToolbarBtn icon={FileDown} label="CSV" onClick={downloadCurrentPlcSpec} color={T.purple} border={T.purpleBorder} title="Export as CSV" />
                        </div>
                      }
                      noPad>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: T.bgMuted, borderBottom: `1px solid ${T.borderLight}` }}>
                              {["#", "Category", "Signal", "Dir", "Register", "Value", "Meaning", "Req"].map(h => (
                                <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: T.textMuted, whiteSpace: "nowrap" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {handshakeRows.map((row, i) => {
                              const cc = CAT_COLORS[row.category || "handshake"] || CAT_COLORS.handshake;
                              return (
                                <tr key={row.id || i} style={{ borderBottom: `1px solid ${T.borderLight}`, background: i % 2 === 1 ? T.bgMuted : T.bgCard }}>
                                  <td style={{ padding: "8px 14px", color: T.textMuted, fontSize: 11, fontFamily: "ui-monospace,monospace" }}>{i + 1}</td>
                                  <td style={{ padding: "8px 14px" }}>
                                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: cc.bg, color: cc.text, border: `1px solid ${cc.border}` }}>{cc.label}</span>
                                  </td>
                                  <td style={{ padding: "8px 14px", fontWeight: 600, color: T.text }}>{row.signal || "-"}</td>
                                  <td style={{ padding: "8px 14px" }}><ActionBadge action={row.direction || "READ"} /></td>
                                  <td style={{ padding: "8px 14px", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: row.register ? T.blue : T.textMuted }}>{row.register ? `${row.device || formData.plcSlmpDevice || "D"}${row.register}` : "—"}</td>
                                  <td style={{ padding: "8px 14px", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: T.navy }}>{row.value ?? "—"}</td>
                                  <td style={{ padding: "8px 14px", color: T.textSec, fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.meaning || "—"}</td>
                                  <td style={{ padding: "8px 14px" }}><Chip label={row.required !== false ? "Must" : "Optional"} color={row.required !== false ? "blue" : "gray"} /></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </SectionCard>
                  )}

                  {/* Conflict warnings */}
                  {registerConflicts.length > 0 && (
                    <div style={{ padding: "12px 14px", background: T.redLight, border: `1px solid ${T.redBorder}`, borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <AlertTriangle size={14} color={T.red} style={{ flexShrink: 0, marginTop: 1 }} />
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, color: T.red }}>Register Conflicts Detected</p>
                        {registerConflicts.slice(0, 4).map(c => <p key={c} style={{ fontSize: 11, color: T.red, margin: 0, lineHeight: 1.6 }}>• {c}</p>)}
                      </div>
                    </div>
                  )}

                  <div style={{ padding: "10px 14px", background: T.amberLight, border: `1px solid ${T.amberBorder}`, borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <AlertTriangle size={14} color={T.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 12, color: T.textSec, margin: 0, lineHeight: 1.5 }}>Changing register addresses or values requires matching updates in the PLC program. Coordinate with your PLC programmer before saving.</p>
                  </div>
                </div>
              )}

              {/* ─── STATION CONTROL ──────────────────────────── */}
              {activeTab === "live" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

                  {/* ── Station info cards ───────────────────── */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                    {[
                      { label: "Station Code", value: currentStationNo || "—", color: T.blue, bg: T.blueLight, border: T.blueBorder },
                      { label: "Station Step", value: operationSequenceSummary.operationIndex ? `${operationSequenceSummary.operationIndex} of ${operationSequenceSummary.totalOperations}` : "—", color: T.navy, bg: T.bgCard, border: T.borderLight },
                      { label: "Sequence No", value: formData?.sequenceNo || "—", color: T.navy, bg: T.bgCard, border: T.borderLight },
                      { label: "Active Operations", value: operationSequenceSummary.totalOperations || 0, color: T.teal, bg: T.tealLight, border: T.tealBorder },
                    ].map(item => (
                      <div key={item.label} style={{ padding: "12px 14px", background: item.bg, border: `1px solid ${item.border}`, borderRadius: 10 }}>
                        <p style={{ margin: 0, fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{item.label}</p>
                        <p style={{ margin: "5px 0 0", fontSize: 18, fontWeight: 800, color: item.color, fontFamily: "ui-monospace,monospace", lineHeight: 1 }}>{String(item.value)}</p>
                      </div>
                    ))}
                  </div>

                  {/* ── Quality Check Section ────────────────── */}
                  <SectionCard
                    title="Quality Check Integration"
                    subtitle="Configure how quality results reach this station — IP push or PLC register polling"
                    icon={CheckCircle2}
                    iconColor={formData?.spcConfig?.enabled ? T.green : T.textMuted}
                    iconBg={formData?.spcConfig?.enabled ? T.greenLight : T.bgMuted}
                    iconBorder={formData?.spcConfig?.enabled ? T.greenBorder : T.border}
                    action={
                      <Toggle
                        onChange={(v) => {
                          setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), enabled: v, plcAckEnabled: v } }));
                          if (currentStationNo) updateCurrentStationFeature("qualityCheck", v);
                        }}
                        label="" color={T.green}
                      />
                    }>
                    {Boolean(formData?.spcConfig?.enabled) ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                        
                        {/* Multi-Protocol Hub Selector */}
                        <div>
                          <Label style={{ marginBottom: 10, display: "block", color: T.navy }}>Data Acquisition Hub (Multi-Protocol enabled)</Label>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                            {[
                              { id: "IP_PUSH", label: "IP Push", icon: LucideIcons.Radio || Radio },
                              { id: "PLC_REGISTER", label: "PLC Reg", icon: LucideIcons.Layers || Layers },
                              { id: "HTTP_API", label: "HTTP API", icon: LucideIcons.Globe || Globe },
                              { id: "FOLDER", label: "Folder", icon: LucideIcons.FileSearch || FileSearch },
                              { id: "FTP_FILE", label: "FTP / File", icon: LucideIcons.FileCode || FileCode },
                            ].map(opt => {
                              const active = (formData?.spcConfig?.activeProtocols || []).includes(opt.id) || (formData?.spcConfig?.mode === opt.id);
                              return (
                                <button key={opt.id} type="button"
                                  onClick={() => {
                                    setFormData(prev => {
                                      const spc = prev.spcConfig || { enabled: true, mode: "IP_PUSH" };
                                      return { 
                                        ...prev, 
                                        spcConfig: { 
                                          ...spc, 
                                          activeProtocols: [opt.id], 
                                          mode: opt.id 
                                        } 
                                      };
                                    });
                                  }}
                                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 8, border: `1px solid ${active ? T.blue : T.border}`, background: active ? T.blueLight : T.bgCard, color: active ? T.blue : T.textSec, cursor: "pointer", transition: "all .15s", textAlign: "left" }}>
                                  <ProtocolIcon icon={opt.icon} size={14} color={active ? T.blue : T.textSec} />
                                  <span style={{ fontSize: 11, fontWeight: 700 }}>{opt.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Single Mode Config Panel (Requirement: Show single) */}
                        {(() => {
                          const mode = formData?.spcConfig?.mode || "IP_PUSH";
                          return (
                            <div key={mode} style={{ padding: "16px", background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, display: "flex", flexDirection: "column", gap: 14 }}>
                               <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${T.borderLight}`, paddingBottom: 10 }}>
                                 <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                   {mode === "IP_PUSH" && <ProtocolIcon icon={LucideIcons.Radio || Radio} size={14} />}
                                   {mode === "PLC_REGISTER" && <ProtocolIcon icon={LucideIcons.Layers || Layers} size={14} />}
                                   {mode === "HTTP_API" && <ProtocolIcon icon={LucideIcons.Globe || Globe} size={14} />}
                                   {mode === "FOLDER" && <ProtocolIcon icon={LucideIcons.FileSearch || FileSearch} size={14} />}
                                   {mode === "FTP_FILE" && <ProtocolIcon icon={LucideIcons.FileCode || FileCode} size={14} />}
                                   <span style={{ fontSize: 12, fontWeight: 800, color: T.navy, textTransform: "uppercase", letterSpacing: "0.05em" }}>{mode.replace("_", " ")} Configuration</span>
                                 </div>
                                 <ToolbarBtn 
                                   icon={Activity} 
                                   label="Test Connection" 
                                   onClick={async () => {
                                     const load = toast.loading(`Testing ${mode} connection...`);
                                     try {
                                       const res = await machineApi.testConnection({ ...formData.spcConfig, mode });
                                       toast.success(res.message || "Connection successful", { id: load });
                                     } catch (err) {
                                       toast.error(err.response?.data?.error || err.message || "Connection failed", { id: load });
                                     }
                                   }} 
                                   color={T.teal} 
                                   border={T.tealBorder} 
                                 />
                               </div>

                              {mode === "IP_PUSH" && (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 1fr", gap: 12 }}>
                                  <div><Label>Source IP</Label><FieldInput value={formData?.spcConfig?.sourceIp || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), sourceIp: e.target.value } }))} placeholder="192.168.1.50" mono /></div>
                                  <div><Label>Port</Label><FieldInput type="number" value={formData?.spcConfig?.sourcePort || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), sourcePort: e.target.value } }))} placeholder="5000" mono /></div>
                                  <div><Label>Result Key</Label><FieldInput value={formData?.spcConfig?.payloadResultKey || "RESULT"} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), payloadResultKey: e.target.value.toUpperCase() } }))} placeholder="RESULT" mono /></div>
                                  <div><Label>NG Values</Label><FieldInput value={formData?.spcConfig?.payloadResultNgValues || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), payloadResultNgValues: e.target.value } }))} placeholder="NG, FAIL, 0" /></div>
                                </div>
                              )}

                              {mode === "PLC_REGISTER" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", gap: 12 }}>
                                    <div><Label>Target PLC IP</Label><FieldInput value={formData?.spcConfig?.sourceIp || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), sourceIp: e.target.value } }))} placeholder="Override main PLC IP (optional)" mono /></div>
                                    <div><Label>Port</Label><FieldInput type="number" value={formData?.spcConfig?.sourcePort || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), sourcePort: e.target.value } }))} placeholder="502" mono /></div>
                                    <div />
                                  </div>
                                  {/* Main Result (Standardized Grid) */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <Label style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: "uppercase" }}>Primary Result Map</Label>
                                    <div style={{ padding: "12px", background: T.bgMuted, borderRadius: 10, border: `1px solid ${T.borderLight}` }}>
                                       <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 80px 120px 120px 30px", gap: 8, alignItems: "center" }}>
                                          <div style={{ fontSize: 11, fontWeight: 700, color: T.navy }}>Quality Result</div>
                                          <FieldInput value={formData?.spcConfig?.plcResultRegister || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), plcResultRegister: e.target.value } }))} placeholder="Reg" sx={{ height: 28, fontSize: 11 }} mono />
                                          <FieldSelect value={formData?.spcConfig?.plcResultDevice || "D"} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), plcResultDevice: e.target.value } }))} sx={{ height: 28, fontSize: 11 }}>
                                            {["D", "W", "R", "ZR", "M"].map(d => <option key={d} value={d}>{d}</option>)}
                                          </FieldSelect>
                                          <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textAlign: "center", background: T.bgCard, padding: "2px 4px", borderRadius: 4, border: `1px solid ${T.borderLight}` }}>STATUS</div>
                                          <FieldInput value={formData?.spcConfig?.plcResultOkValues || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), plcResultOkValues: e.target.value } }))} placeholder="OK Vals (1,2)" sx={{ height: 28, fontSize: 11 }} />
                                          <FieldInput value={formData?.spcConfig?.plcResultNgValues || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), plcResultNgValues: e.target.value } }))} placeholder="NG Vals (0,4)" sx={{ height: 28, fontSize: 11 }} />
                                          <div />
                                       </div>
                                       <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 80px 120px 120px 30px", gap: 8, marginTop: 6, opacity: 0.6 }}>
                                          <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Signal Name</div>
                                          <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Register</div>
                                          <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Device</div>
                                          <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Type</div>
                                          <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Acceptance (OK)</div>
                                          <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Rejection (NG)</div>
                                       </div>
                                    </div>
                                  </div>
                                  
                                  {/* Dynamic PLC Registers */}
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                      <Label style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: "uppercase" }}>Additional Data Signals (Requirement 21)</Label>
                                      <button type="button" onClick={() => setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, dynamicRegisters: [...(prev.spcConfig.dynamicRegisters || []), { name: "", register: "", device: "D", type: "INT16", scale: "1.0", unit: "" }] }}))} style={{ padding: "4px 12px", background: T.blue, color: "#fff", border: "none", borderRadius: 4, fontSize: 10, cursor: "pointer", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                                        <Plus size={12} /> Add Signal
                                      </button>
                                    </div>
                                    <div style={{ padding: "12px", background: T.bgCard, borderRadius: 10, border: `1px solid ${T.borderLight}`, minHeight: 60 }}>
                                      {(formData?.spcConfig?.dynamicRegisters || []).length > 0 ? (
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                          {formData.spcConfig.dynamicRegisters.map((reg, idx) => (
                                            <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 80px 60px 40px 30px", gap: 8, alignItems: "center" }}>
                                              <FieldInput value={reg.name} onChange={e => { const dr = [...formData.spcConfig.dynamicRegisters]; dr[idx].name = e.target.value; setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, dynamicRegisters: dr } })) }} placeholder="Signal Name" sx={{ height: 28, fontSize: 11 }} />
                                              <FieldInput value={reg.register} onChange={e => { const dr = [...formData.spcConfig.dynamicRegisters]; dr[idx].register = e.target.value; setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, dynamicRegisters: dr } })) }} placeholder="Reg" sx={{ height: 28, fontSize: 11 }} mono />
                                              <FieldSelect value={reg.device} onChange={e => { const dr = [...formData.spcConfig.dynamicRegisters]; dr[idx].device = e.target.value; setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, dynamicRegisters: dr } })) }} sx={{ height: 28, fontSize: 11 }}>
                                                {["D", "W", "R", "ZR", "M"].map(d => <option key={d} value={d}>{d}</option>)}
                                              </FieldSelect>
                                              <FieldSelect value={reg.type} onChange={e => { const dr = [...formData.spcConfig.dynamicRegisters]; dr[idx].type = e.target.value; setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, dynamicRegisters: dr } })) }} sx={{ height: 28, fontSize: 11 }}>
                                                {["BOOL", "INT16", "UINT16", "INT32", "FLOAT", "STRING"].map(t => <option key={t} value={t}>{t}</option>)}
                                              </FieldSelect>
                                              <FieldInput value={reg.scale} onChange={e => { const dr = [...formData.spcConfig.dynamicRegisters]; dr[idx].scale = e.target.value; setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, dynamicRegisters: dr } })) }} placeholder="Scale" sx={{ height: 28, fontSize: 11 }} />
                                              <FieldInput value={reg.unit} onChange={e => { const dr = [...formData.spcConfig.dynamicRegisters]; dr[idx].unit = e.target.value; setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, dynamicRegisters: dr } })) }} placeholder="Unit" sx={{ height: 28, fontSize: 11 }} />
                                              <button type="button" onClick={() => setFormData(prev => { const dr = prev.spcConfig.dynamicRegisters.filter((_, i) => i !== idx); return { ...prev, spcConfig: { ...prev.spcConfig, dynamicRegisters: dr } }; })} style={{ border: "none", background: "none", color: T.red, cursor: "pointer" }}><Trash2 size={12} /></button>
                                            </div>
                                          ))}
                                          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 80px 60px 40px 30px", gap: 8, marginTop: 4, opacity: 0.6 }}>
                                             <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Signal Name</div>
                                             <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Register</div>
                                             <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Device</div>
                                             <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Type</div>
                                             <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Scale</div>
                                             <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600 }}>Unit</div>
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0" }}>
                                          <p style={{ margin: 0, fontSize: 10, color: T.textMuted }}>No additional signals configured.</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {mode === "FOLDER" && (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 100px 120px", gap: 12 }}>
                                  <div><Label>Folder Path (Local/Network)</Label><FieldInput value={formData?.spcConfig?.folderConfig?.path || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, folderConfig: { ...(prev.spcConfig.folderConfig || {}), path: e.target.value } } }))} placeholder="C:\QualityResults\LineA" mono /></div>
                                  <div><Label>Pattern</Label><FieldInput value={formData?.spcConfig?.folderConfig?.pattern || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, folderConfig: { ...(prev.spcConfig.folderConfig || {}), pattern: e.target.value } } }))} placeholder="*.csv" mono /></div>
                                  <div><Label>Parser</Label><FieldSelect value={formData?.spcConfig?.folderConfig?.parser || "JSON"} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, folderConfig: { ...(prev.spcConfig.folderConfig || {}), parser: e.target.value } } }))}>
                                    {["JSON", "CSV", "XML", "KEYVALUE", "RAW"].map(p => <option key={p} value={p}>{p}</option>)}
                                  </FieldSelect></div>
                                  <div style={{ paddingTop: 20 }}><Toggle checked={formData?.spcConfig?.folderConfig?.deleteAfterRead !== false} onChange={v => setFormData(prev => ({ ...prev, spcConfig: { ...prev.spcConfig, folderConfig: { ...(prev.spcConfig.folderConfig || {}), deleteAfterRead: v } } }))} label="Delete File" note="After reading" /></div>
                                </div>
                              )}

                              {(mode === "HTTP_API" || mode === "FTP_FILE") && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12, alignItems: "end" }}>
                                    <div>
                                      <Label style={{ display: "flex", alignItems: "center", gap: 6 }}><ProtocolIcon icon={LucideIcons.Globe || Globe} size={13} /> {mode === "FTP_FILE" ? "Remote File Path / Pattern" : "REST API Endpoint URL"}</Label>
                                      <FieldInput
                                        value={formData?.spcConfig?.endpoint || ""}
                                        onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), endpoint: e.target.value } }))}
                                        placeholder={mode === "FTP_FILE" ? "ftp://user:pass@host/path/*.csv" : "http://host:port/api/quality"}
                                        mono
                                      />
                                    </div>
                                    <ToolbarBtn icon={FileSearch} label="Browse" onClick={() => toast.info("Scanning...")} color={T.blue} border={T.blueBorder} />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Parameter Mapping Section */}
                        <div style={{ padding: "14px", background: T.tealLight + "22", border: `1px solid ${T.tealBorder}`, borderRadius: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                            <ClipboardList size={14} color={T.teal} />
                            <span style={{ fontSize: 12, fontWeight: 800, color: T.teal, textTransform: "uppercase" }}>Quality Parameter & Reason Mapping</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <Label>Rejection Reason Keys (e.g. CRAM, MR, REASON_CODE)</Label>
                            <FieldInput value={formData?.spcConfig?.qualityPayloadKeys || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), qualityPayloadKeys: e.target.value } }))} placeholder="diameter, reasonCode, error_id, CRAM, MR" />
                            <p style={{ margin: 0, fontSize: 10, color: T.textMuted }}>Specify keys that contain the rejection parameters or failure reasons from your quality sources.</p>
                          </div>
                        </div>

                        {/* Integration Log */}
                        <div style={{ background: T.navy, borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.1)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>Hub Status: { (formData?.spcConfig?.activeProtocols || []).length } Active Sources</span>
                            <span style={{ fontSize: 9, color: T.teal, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                              <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.teal, boxShadow: `0 0 6px ${T.teal}` }} /> Aggregating
                            </span>
                          </div>
                          <div style={{ height: 60, overflowY: "auto", fontFamily: "ui-monospace, monospace", fontSize: 10, color: "rgba(255,255,255,0.8)", display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ display: "flex", gap: 8 }}><span style={{ color: "rgba(255,255,255,0.2)" }}>[LOG]</span> <span>Multi-source quality acquisition initialized.</span></div>
                            <div style={{ display: "flex", gap: 8 }}><span style={{ color: "rgba(255,255,255,0.2)" }}>[LOG]</span> <span style={{ color: T.blue }}>Ready to receive data from all configured endpoints.</span></div>
                          </div>
                        </div>

                        <div style={{ padding: "10px 12px", background: T.blueLight + "55", border: `1px solid ${T.blueBorder}`, borderRadius: 8, fontSize: 12, color: T.textSec, display: "flex", alignItems: "center", gap: 8 }}>
                          <Info size={13} color={T.blue} style={{ flexShrink: 0 }} />
                          ACK is handled automatically by the Confirmation register (configured in Mapping & Tuning). No additional register needed.
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding: "20px 0 8px", textAlign: "center", color: T.textMuted }}>
                        <CheckCircle2 size={28} style={{ margin: "0 auto 8px", opacity: 0.2 }} />
                        <p style={{ fontSize: 12, margin: 0 }}>Enable quality check to configure result integration</p>
                      </div>
                    )}
                  </SectionCard>

                  {/* ── Station Features ─────────────────────── */}
                  <SectionCard
                    title="Station Features & Register Mapping"
                    subtitle="Toggle features for this station and assign PLC registers where applicable"
                    icon={Zap}
                    iconColor={T.blue}
                    iconBg={T.blueLight}
                    iconBorder={T.blueBorder}
                    action={
                      <button type="button" onClick={saveCurrentStationSettings} disabled={savingStationSettings || !currentStationNo}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", background: savingStationSettings || !currentStationNo ? T.bgMuted : T.navy, color: savingStationSettings || !currentStationNo ? T.textMuted : "#fff", border: `1px solid ${savingStationSettings || !currentStationNo ? T.border : T.navy}`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: savingStationSettings || !currentStationNo ? "not-allowed" : "pointer", opacity: savingStationSettings || !currentStationNo ? 0.7 : 1, transition: "all .15s" }}>
                        <Save size={13} />{savingStationSettings ? "Saving…" : "Save Station Settings"}
                      </button>
                    }
                    noPad>
                    <div>
                      {STATION_FEATURES.map((feature, fi) => {
                        const isEnabled = Boolean(currentStationFeatures?.[feature.key]);
                        const isLast = fi === STATION_FEATURES.length - 1;
                        return (
                          <div key={feature.key} style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 16px", borderBottom: isLast ? "none" : `1px solid ${T.borderLight}`, transition: "background .1s", background: isEnabled ? feature.color + "06" : "transparent" }}>
                            {/* Toggle area */}
                            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                              <div style={{ width: 32, height: 32, borderRadius: 8, background: isEnabled ? feature.color + "18" : T.bgMuted, border: `1px solid ${isEnabled ? feature.color + "44" : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all .2s" }}>
                                {isEnabled
                                  ? <CheckCircle2 size={14} color={feature.color} />
                                  : <XCircle size={14} color={T.textMuted} />
                                }
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ margin: 0, fontSize: 13, fontWeight: isEnabled ? 700 : 600, color: isEnabled ? T.text : T.textSec }}>{feature.label}</p>
                                <p style={{ margin: "2px 0 0", fontSize: 11, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{feature.note}</p>
                              </div>
                            </div>

                            {/* Register mapping status */}
                            {isEnabled && (
                              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                                {feature.hasRegister ? (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                    <Label style={{ margin: 0, fontSize: 9 }}>{feature.registerNote || "Assigned Register"}</Label>
                                    <FieldInput
                                      type="number"
                                      value={currentStationFeatures?.[feature.registerKey] || ""}
                                      onChange={e => updateStationRegister(feature.registerKey, e.target.value)}
                                      placeholder="Reg #"
                                      style={{ width: 80, height: 28, fontSize: 11 }}
                                      mono
                                    />
                                  </div>
                                ) : (
                                  (() => {
                                    // Only show mapping status for features that optionally integrate with PLC registers
                                    // but aren't strictly required to have one if another signal handles it (e.g. handshake)
                                    const featuresRequiringMappingInfo = ["rejectionBin", "rejectionBinStatus", "manualResult", "labelPrint", "camera", "torque", "partPresence"];
                                    if (!featuresRequiringMappingInfo.includes(feature.key)) return null;

                                    const mappedRow = handshakeRows.find(r => 
                                      getFamily(r.signal) === getFamily(feature.label) || 
                                      getFamily(r.signal) === getFamily(feature.key)
                                    );
                                    return (
                                      <div style={{ textAlign: "right" }}>
                                        <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: mappedRow ? T.green : T.amber, textTransform: "uppercase" }}>
                                          {mappedRow ? "Mapped in Tuning" : "Not Mapped"}
                                        </p>
                                        <p style={{ margin: "1px 0 0", fontSize: 11, fontFamily: "ui-monospace,monospace", fontWeight: 700, color: mappedRow ? T.text : T.textMuted }}>
                                          {mappedRow ? `Register ${mappedRow.device || formData.plcSlmpDevice || "D"}${mappedRow.register}` : "No register assigned"}
                                        </p>
                                      </div>
                                    );
                                  })()
                                )}
                              </div>
                            )}

                            {/* Toggle button */}
                            <button type="button" onClick={() => updateCurrentStationFeature(feature.key, !isEnabled)}
                              style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, border: `1px solid ${isEnabled ? feature.color + "55" : T.border}`, background: isEnabled ? feature.color + "12" : T.bgMuted, color: isEnabled ? feature.color : T.textMuted, fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all .15s" }}>
                              {isEnabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                              {isEnabled ? "Enabled" : "Disabled"}
                            </button>
                          </div>
                        );
                      })}

                      {/* Parts per cycle */}
                      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 16px", borderTop: `1px solid ${T.borderLight}`, background: T.bgMuted }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: T.blueLight, border: `1px solid ${T.blueBorder}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Hash size={14} color={T.blue} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T.text }}>Parts per Cycle</p>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: T.textMuted }}>How many parts are processed per PLC cycle (1–20)</p>
                        </div>
                        <div style={{ minWidth: 120 }}>
                          <FieldInput type="number" value={currentStationFeatures?.plcPartCount ?? 1} onChange={e => updateCurrentStationFeature("plcPartCount", Number(e.target.value || 1))} min={1} max={20} mono />
                        </div>
                      </div>
                    </div>
                  </SectionCard>

                  {/* ── Data Source Matrix ───────────────────── */}
                  <SectionCard
                    title="Data Source Summary"
                    subtitle="Overview of where each data type originates for this station"
                    icon={Database}
                    iconColor={T.navy}
                    iconBg={T.bgMuted}
                    iconBorder={T.border}
                    noPad>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: T.bgMuted, borderBottom: `1px solid ${T.borderLight}` }}>
                          {["Data Type", "Source", "Register / Key"].map((h, i) => (
                            <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: T.textMuted, borderBottom: `1px solid ${T.borderLight}`, width: i === 0 ? "35%" : i === 1 ? "40%" : "25%" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { label: "Quality Result", source: (formData?.spcConfig?.activeProtocols || ["IP_PUSH"]).join(" + "), value: (formData?.spcConfig?.mode || "IP_PUSH") === "PLC_REGISTER" ? `R${formData?.spcConfig?.plcResultRegister || "—"}` : formData?.spcConfig?.payloadResultKey || "RESULT", active: formData?.spcConfig?.enabled },
                          { label: "Handshake / Confirmation", source: "PLC Register (Tuning tab)", value: formData?.plcConfig?.heartbeatRegister ? `R${formData.plcConfig.heartbeatRegister}` : "—", active: Boolean(formData?.plcConfig?.heartbeatRegister) },
                          { label: "Bypass Enable", source: "PLC Register (Tuning tab)", value: formData?.plcConfig?.bypassRegister ? `R${formData.plcConfig.bypassRegister}` : "—", active: Boolean(formData?.plcConfig?.bypassRegister) },
                          { label: "Additional Parameters", source: "PLC Dynamic Mapping", value: (formData?.spcConfig?.dynamicRegisters || []).length > 0 ? `${formData.spcConfig.dynamicRegisters.length} Dynamic Regs` : "None", active: (formData?.spcConfig?.dynamicRegisters || []).length > 0 },
                        ].map((row, i, arr) => (
                          <tr key={row.label} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${T.borderLight}` : "none", background: i % 2 === 1 ? T.bgMuted : T.bgCard }}>
                            <td style={{ padding: "10px 14px", fontWeight: 600, color: T.text, fontSize: 12 }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: row.active ? T.green : T.border, flexShrink: 0 }} />
                                {row.label}
                              </span>
                            </td>
                            <td style={{ padding: "10px 14px", fontSize: 11, color: T.textMuted }}>{row.source}</td>
                            <td style={{ padding: "10px 14px", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: row.active ? T.navy : T.textMuted, fontSize: 12 }}>{row.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </SectionCard>

                  {/* ── Industrial Diagnostics & Timeline (Req 11, 12, 20) ── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <SectionCard title="Middleware Diagnostics" icon={Activity} iconColor={T.purple} iconBg={T.purpleLight} iconBorder={T.purpleBorder}>
                       <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                         <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <div style={{ padding: 10, background: T.bgMuted, borderRadius: 8 }}>
                               <Label>Last Packet</Label>
                               <span style={{ fontSize: 12, fontWeight: 800, color: T.navy }}>14:55:02</span>
                            </div>
                            <div style={{ padding: 10, background: T.bgMuted, borderRadius: 8 }}>
                               <Label>Packets / Hour</Label>
                               <span style={{ fontSize: 12, fontWeight: 800, color: T.green }}>1,240</span>
                            </div>
                         </div>
                         <div style={{ padding: "10px 12px", background: T.navy, borderRadius: 8, color: "#fff" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                               <span style={{ fontSize: 9, fontWeight: 800, opacity: 0.5 }}>ACQUISITION LATENCY</span>
                               <span style={{ fontSize: 10, fontWeight: 800, color: T.teal }}>12ms</span>
                            </div>
                            <div style={{ height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2 }}>
                               <div style={{ width: "35%", height: "100%", background: T.teal, borderRadius: 2 }} />
                            </div>
                         </div>
                       </div>
                    </SectionCard>

                    <SectionCard title="Acquisition Event Timeline" icon={ScanLine} iconColor={T.blue} iconBg={T.blueLight} iconBorder={T.blueBorder} noPad>
                       <div style={{ height: 120, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                          {[
                            { time: "14:55:02", event: "SOURCE_CONNECTED", protocol: "HTTP_API", status: "OK" },
                            { time: "14:55:01", event: "PAYLOAD_RECEIVED", protocol: "PLC_REG", status: "OK" },
                            { time: "14:54:58", event: "PARSE_SUCCESS", protocol: "FOLDER", status: "OK" },
                            { time: "14:54:45", event: "RETRY_STARTED", protocol: "HTTP_API", status: "PENDING" },
                          ].map((log, i) => (
                            <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 10, borderLeft: `2px solid ${log.status === "OK" ? T.green : T.amber}`, paddingLeft: 8 }}>
                               <span style={{ color: T.textMuted, fontFamily: "monospace" }}>{log.time}</span>
                               <span style={{ fontWeight: 800, color: T.navy }}>{log.event}</span>
                               <Chip label={log.protocol} color="gray" />
                            </div>
                          ))}
                       </div>
                    </SectionCard>
                  </div>
                </div>
              )}
            </form>

            {/* Modal footer */}
            <div style={{ padding: "14px 24px", borderTop: `1px solid ${T.borderLight}`, background: T.bgCard, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: T.textMuted }}>
                <ChevronRight size={12} />
                <span>Step {activeTabIndex + 1} of {FORM_TABS.length} — {FORM_TABS[activeTabIndex]?.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {activeTabIndex > 0 && (
                  <button type="button" onClick={goPrevious}
                    style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textSec, cursor: "pointer" }}>
                    Previous
                  </button>
                )}
                <button type="button" onClick={closeModal}
                  style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textSec, cursor: "pointer" }}>
                  Cancel
                </button>
                {!isLastTab ? (
                  <button type="button" onClick={saveAndNext}
                    style={{ padding: "8px 18px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", background: T.navy, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                    <ChevronRight size={13} /> Save & Next
                  </button>
                ) : (
                  <button type="submit" form="machine-form" disabled={saving}
                    style={{ padding: "8px 20px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", background: saving ? T.slateLight : T.navy, color: "#fff", cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, opacity: saving ? 0.6 : 1 }}>
                    <Save size={13} />{saving ? "Saving…" : editingMachine ? "Update Machine" : "Create Machine"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* VIEW CONFIG MODAL                                       */}
      {/* ═══════════════════════════════════════════════════════ */}
      {viewMachine && (
        <div style={modalOverlay}>
          <div style={{ position: "absolute", inset: 0 }} onClick={() => setViewMachine(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 780, background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(15,23,42,.22)" }}>
            <div style={{ height: 3, background: `linear-gradient(90deg, ${T.navy}, ${T.blue})` }} />
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.borderLight}`, background: T.bgCard, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: T.blueLight, border: `1px solid ${T.blueBorder}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Eye size={15} color={T.blue} />
                </div>
                <div>
                  <h2 style={{ fontWeight: 700, color: T.text, margin: 0, fontSize: 14 }}>Machine Configuration</h2>
                  <p style={{ fontSize: 11, color: T.textMuted, margin: "2px 0 0" }}>{viewMachine.machineName} | {viewMachine.operationNo || "-"}</p>
                </div>
              </div>
              <button onClick={() => setViewMachine(null)} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 7, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.textMuted }}>
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 20, maxHeight: "70vh", overflowY: "auto", background: T.bg, display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
                {[
                  { label: "Line", value: viewMachine.lineName || "-", bg: T.bgCard, border: T.borderLight, text: T.text },
                  { label: "PLC", value: `${viewMachine.plcIp || "-"}${viewMachine.plcPort ? `:${viewMachine.plcPort}` : ""}`, bg: T.blueLight, border: T.blueBorder, text: T.blue },
                  { label: "Protocol", value: viewMachine.plcProtocol || "-", bg: T.tealLight, border: T.tealBorder, text: T.teal },
                  { label: "Status", value: viewMachine.status || "-", bg: viewMachine.status === "ACTIVE" ? T.greenLight : T.redLight, border: viewMachine.status === "ACTIVE" ? T.greenBorder : T.redBorder, text: viewMachine.status === "ACTIVE" ? T.green : T.red },
                  { label: "Bypass", value: viewMachine.machineBypassEnabled ? "Bypassed" : "Normal", bg: viewMachine.machineBypassEnabled ? T.amberLight : T.bgMuted, border: viewMachine.machineBypassEnabled ? T.amberBorder : T.border, text: viewMachine.machineBypassEnabled ? T.amber : T.textMuted },
                ].map(item => (
                  <div key={item.label} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${item.border}`, background: item.bg }}>
                    <p style={{ margin: 0, fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>{item.label}</p>
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: item.text, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{String(item.value)}</p>
                  </div>
                ))}
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${T.borderLight}`, background: T.bgCard }}>
                <p style={{ margin: "0 0 8px", fontSize: 11, color: T.text, fontWeight: 700 }}>Signal Map</p>
                <div style={{ display: "grid", gap: 6 }}>
                  {normalizeHandshakeRows(viewMachine.plcConfig?.handshakeMap, viewMachine.plcConfig || {}).map((row, idx) => {
                    const cc = CAT_COLORS[row.category || "handshake"] || CAT_COLORS.handshake;
                    const isW = row.direction === "WRITE";
                    const isB = row.direction === "BOTH";
                    return (
                      <div key={row.id || `${row.signal}-${idx}`} style={{ fontSize: 11, color: T.textSec, fontFamily: "ui-monospace,monospace", padding: "6px 10px", borderRadius: 6, border: `1px solid ${isW ? T.blueBorder : isB ? T.tealBorder : T.greenBorder}`, background: isW ? T.blueLight : isB ? T.tealLight : T.greenLight, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 99, background: cc.bg, color: cc.text, border: `1px solid ${cc.border}` }}>{cc.label}</span>
                        <DirectionIcon direction={row.direction} size={11} />
                        <strong>{row.signal || `Row ${idx + 1}`}</strong>
                        <span style={{ color: T.textMuted }}>|</span>
                        <span>R{row.register || "-"}</span>
                        <span style={{ color: T.textMuted }}>V:{row.value || "-"}</span>
                        <span style={{ fontFamily: "inherit", color: T.textSec, fontSize: 10 }}>{row.meaning || "-"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* BYPASS MODAL                                            */}
      {/* ═══════════════════════════════════════════════════════ */}
      {bypassModalMachine && (
        <div style={modalOverlay}>
          <div style={{ position: "absolute", inset: 0 }} onClick={closeBypassModal} />
          <div style={{ position: "relative", width: "100%", maxWidth: 520, background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(15,23,42,.22)" }}>
            <div style={{ height: 3, background: `linear-gradient(90deg, ${T.navy}, ${T.amber})` }} />
            <div style={{ padding: "18px 24px", borderBottom: `1px solid ${T.borderLight}`, background: T.bgCard, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: T.amberLight, border: `1px solid ${T.amberBorder}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ShieldOff size={16} color={T.amber} />
                </div>
                <div>
                  <h2 style={{ fontWeight: 700, color: T.text, margin: 0, fontSize: 15 }}>Machine Bypass</h2>
                  <p style={{ fontSize: 11, color: T.textMuted, margin: "2px 0 0" }}>{bypassModalMachine.machineName} | {bypassModalMachine.operationNo || "-"}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: T.textMuted }}>Current:</span>
                    <BypassBadge enabled={Boolean(bypassModalMachine.machineBypassEnabled)} />
                  </div>
                </div>
              </div>
              <button onClick={closeBypassModal} style={{ width: 30, height: 30, border: `1px solid ${T.border}`, borderRadius: 7, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.textMuted }}>
                <X size={14} />
              </button>
            </div>
            <form onSubmit={submitBypass} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, background: T.bg }}>
              <div>
                <Label>Set Bypass To</Label>
                <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
                  {[
                    { value: true, label: "Enable Bypass", icon: ShieldOff, color: T.amber, bg: T.amberLight, border: T.amberBorder },
                    { value: false, label: "Disable Bypass", icon: ShieldCheck, color: T.green, bg: T.greenLight, border: T.greenBorder },
                  ].map(opt => {
                    const OI = opt.icon;
                    const selected = bypassEnabled === opt.value;
                    return (
                      <button key={String(opt.value)} type="button" onClick={() => setBypassEnabled(opt.value)}
                        style={{ flex: 1, padding: "10px 14px", borderRadius: 9, border: `2px solid ${selected ? opt.border : T.border}`, background: selected ? opt.bg : T.bgCard, color: selected ? opt.color : T.textMuted, fontWeight: 700, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all .15s" }}>
                        <OI size={14} />{opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><Label>Station</Label><FieldInput readOnly value={bypassModalMachine.operationNo || ""} mono /></div>
                <div><Label>Machine ID</Label><FieldInput readOnly value={String(bypassModalMachine.id || "")} mono /></div>
              </div>
              <div>
                <Label>Reason</Label>
                <FieldInput value={bypassReason} onChange={e => setBypassReason(e.target.value)} placeholder="MANUAL_BYPASS" />
              </div>
              <div style={{ padding: "10px 12px", background: bypassEnabled ? T.amberLight : T.greenLight, border: `1px solid ${bypassEnabled ? T.amberBorder : T.greenBorder}`, borderRadius: 8, fontSize: 12, color: bypassEnabled ? T.amber : T.green, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                {bypassEnabled ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                {bypassEnabled ? "Bypass will be enabled — interlock checks skipped." : "Bypass will be disabled — normal checks resume."}
              </div>
              <p style={{ fontSize: 11, color: T.textMuted, margin: 0, padding: "8px 10px", background: T.bgMuted, border: `1px solid ${T.border}`, borderRadius: 7 }}>
                Machine bypass is station-specific. Use only with supervisor approval.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 4 }}>
                <button type="button" onClick={closeBypassModal}
                  style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bgCard, color: T.textSec, cursor: "pointer" }}>
                  Cancel
                </button>
                <button type="submit" disabled={bypassing}
                  style={{ padding: "8px 18px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", background: bypassing ? T.slateLight : bypassEnabled ? T.amber : T.green, color: "#fff", cursor: bypassing ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, opacity: bypassing ? 0.6 : 1 }}>
                  {bypassEnabled ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                  {bypassing ? "Saving…" : (bypassEnabled ? "Enable Bypass" : "Disable Bypass")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteConfirmId}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={confirmDelete}
        title="Remove Machine?"
        message="This will remove the machine from the registry. Historical data is preserved."
      />
    </div>
  );
};

export default MachinePage;