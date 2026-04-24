import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu, Plus, Save, Trash2, Edit, RefreshCw, Search,
  X, Network, Activity, Settings,
  Layout, Database, ChevronRight, Info, AlertTriangle, Eye,
  CheckCircle2, XCircle, ShieldOff, ShieldCheck,
  ArrowDownUp, ArrowDown, ArrowUp, Hash, FlaskConical, Zap,
  ToggleLeft, ToggleRight,
} from "lucide-react";
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
  { id: "handshake",  label: "Handshake",      color: "blue",   desc: "Core PLC cycle control signals" },
  { id: "bypass",     label: "Bypass",          color: "amber",  desc: "Bypass/interlock override registers" },
  { id: "rejection",  label: "Rejection Bin",   color: "red",    desc: "Rejection bin open/close/status" },
  { id: "result",     label: "Result / Quality", color: "green",  desc: "Quality result and ACK registers" },
  { id: "live",       label: "Live Data",        color: "teal",   desc: "Monitoring-only registers" },
];

function buildDefaultHandshakeRows(cfg = {}) {
  return [
    createHandshakeRow({ signal: "Start", direction: "WRITE", register: toFormValue(cfg.startRegister, ""), value: toFormValue(cfg.startValue, "1"), meaning: "Start machine cycle", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "Block / Interlock", direction: "WRITE", register: toFormValue(cfg.blockRegister, ""), value: toFormValue(cfg.blockValue, "2"), meaning: "Block cycle on NG / duplicate / interlock", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "Running", direction: "READ", register: toFormValue(cfg.runningRegister, ""), value: toFormValue(cfg.startedValue, "2"), meaning: "Machine is running", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "End OK", direction: "READ", register: toFormValue(cfg.endOkRegister, ""), value: toFormValue(cfg.endOkValue, "3"), meaning: "Cycle completed OK", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "End NG", direction: "READ", register: toFormValue(cfg.endNgRegister, ""), value: toFormValue(cfg.endNgValue, "4"), meaning: "Cycle completed NG", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "Reset", direction: "WRITE", register: toFormValue(cfg.resetRegister, ""), value: toFormValue(cfg.resetValue, "9"), meaning: "Reset/clear machine state", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "Confirmation", direction: "BOTH", register: toFormValue(cfg.heartbeatRegister, ""), value: "1", meaning: "Confirmation / Heartbeat", required: true, category: "handshake" }),
    createHandshakeRow({ signal: "Bypass Enable", direction: "WRITE", register: toFormValue(cfg.bypassRegister, ""), value: "1", meaning: "Write 1 to enable bypass mode in PLC", required: false, category: "bypass" }),
    createHandshakeRow({ signal: "Bypass Status", direction: "READ", register: "", value: "1", meaning: "PLC confirms bypass is active", required: false, category: "bypass" }),
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
  if (["BYPASS_ENABLE", "BYPASS"].includes(normalized)) return "BYPASS_GROUP";
  if (["BYPASS_STATUS", "BYPASS_ACK"].includes(normalized)) return "BYPASS_GROUP";
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

const STANDARD_HANDSHAKE_SIGNAL_META = {
  START: { signal: "Start", direction: "WRITE", registerKey: "startRegister", valueKey: "startValue", defaultValue: "1", defaultMeaning: "Start machine cycle" },
  BLOCK_INTERLOCK: { signal: "Block / Interlock", direction: "WRITE", registerKey: "blockRegister", valueKey: "blockValue", defaultValue: "2", defaultMeaning: "Block cycle on NG / duplicate / interlock" },
  RUNNING: { signal: "Running", direction: "READ", registerKey: "runningRegister", valueKey: "startedValue", defaultValue: "2", defaultMeaning: "Machine is running" },
  END_OK: { signal: "End OK", direction: "READ", registerKey: "endOkRegister", valueKey: "endOkValue", defaultValue: "3", defaultMeaning: "Cycle completed OK" },
  END_NG: { signal: "End NG", direction: "READ", registerKey: "endNgRegister", valueKey: "endNgValue", defaultValue: "4", defaultMeaning: "Cycle completed NG" },
  RESET: { signal: "Reset", direction: "WRITE", registerKey: "resetRegister", valueKey: "resetValue", defaultValue: "9", defaultMeaning: "Reset/clear machine state" },
  CONFIRMATION: { signal: "Confirmation", direction: "BOTH", registerKey: "heartbeatRegister", valueKey: null, defaultValue: "1", defaultMeaning: "Confirmation" },
};

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
    mode: String(source.mode || source.resultMode || "IP_PUSH").toUpperCase() === "PLC_REGISTER" ? "PLC_REGISTER" : "IP_PUSH",
    sourceIp: String(source.sourceIp || ""), sourcePort: toFormValue(source.sourcePort, ""),
    payloadResultKey: String(source.payloadResultKey || "RESULT"), payloadResultNgValues: ngValues.join(", "),
    qualityPayloadKeys: qualityKeys.join(", "),
    plcResultRegister: toFormValue(source.plcResultRegister ?? source.resultRegister, ""),
    plcResultDevice: String(source.plcResultDevice || source.resultDevice || "D").toUpperCase(),
    plcResultOkValues: plcOkValues.join(", "), plcResultNgValues: plcNgValues.join(", "),
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
    mode: String(rawSpc.mode || "IP_PUSH").trim().toUpperCase() === "PLC_REGISTER" ? "PLC_REGISTER" : "IP_PUSH",
    appliesTo: "ALL",
    sourceIp: String(rawSpc.sourceIp || "").trim() || null,
    sourcePort: toNullableNumber(rawSpc.sourcePort),
    payloadResultKey: String(rawSpc.payloadResultKey || "RESULT").trim() || "RESULT",
    payloadResultNgValues, qualityPayloadKeys,
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
  CONFIRMATION_GROUP: "heartbeatRegister",
};

const REGISTER_IO_HELP = {
  startRegister:     { action: "WRITE", flow: "PC → PLC", purpose: "Start command sent to PLC" },
  blockRegister:     { action: "WRITE", flow: "PC → PLC", purpose: "Block/interlock command sent to PLC" },
  runningRegister:   { action: "READ",  flow: "PLC → PC", purpose: "Machine running status feedback" },
  endOkRegister:     { action: "READ",  flow: "PLC → PC", purpose: "Cycle completed OK feedback" },
  endNgRegister:     { action: "READ",  flow: "PLC → PC", purpose: "Cycle completed NG feedback" },
  partRegister:      { action: "WRITE", flow: "PC → PLC", purpose: "Optional part/hash payload register" },
  stationRegister:   { action: "WRITE", flow: "PC → PLC", purpose: "Optional station/hash payload register" },
  resetRegister:     { action: "WRITE", flow: "PC → PLC", purpose: "Reset/fault clear command register" },
  heartbeatRegister: { action: "BOTH",  flow: "PLC ↔ PC", purpose: "Confirmation / heartbeat register" },
  bypassRegister:    { action: "WRITE", flow: "PC → PLC", purpose: "Bypass enable command register" },
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
  handshake: { bg: T.blueLight,   border: T.blueBorder,   text: T.blue,   label: "Handshake"       },
  bypass:    { bg: T.amberLight,  border: T.amberBorder,  text: T.amber,  label: "Bypass"          },
  rejection: { bg: T.redLight,    border: T.redBorder,    text: T.red,    label: "Rejection Bin"   },
  result:    { bg: T.greenLight,  border: T.greenBorder,  text: T.green,  label: "Result/Quality"  },
  live:      { bg: T.tealLight,   border: T.tealBorder,   text: T.teal,   label: "Live Data"       },
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
  { key: "qr",              label: "QR / Barcode Scan",    note: "Require QR or barcode scan before cycle", color: T.blue,   hasRegister: false },
  { key: "operation",       label: "Sequence Validation",  note: "Enforce previous station sequence check",  color: T.blue,   hasRegister: false },
  { key: "plcConfirmation", label: "PLC Confirmation",     note: "Wait for PLC end-of-cycle confirmation",  color: T.teal,   hasRegister: false },
  { key: "manualResult",    label: "Manual Result Entry",  note: "Operator can enter OK/NG result manually", color: T.purple, hasRegister: true,  registerKey: "manualResultRegister",  registerNote: "Write register: operator result value" },
  { key: "rejectionBin",    label: "Rejection Bin",        note: "Use rejection/rework bin signal",          color: T.red,    hasRegister: true,  registerKey: "rejectionBinRegister",  registerNote: "Write register: open bin command" },
  { key: "rejectionBinStatus", label: "Bin Full Status",  note: "Read bin-full feedback from PLC",           color: T.red,    hasRegister: true,  registerKey: "rejectionBinStatusReg", registerNote: "Read register: bin-full signal from PLC" },
  { key: "finalPacking",    label: "Final Packing Station", note: "Mark as last station before dispatch",     color: T.green,  hasRegister: false },
  { key: "rework",          label: "Rework Station",       note: "Allow re-scanning reworked parts",          color: T.amber,  hasRegister: false },
  { key: "labelPrint",      label: "Label Printing",       note: "Trigger label/tag print on cycle OK",       color: T.navy,   hasRegister: true,  registerKey: "labelPrintRegister",    registerNote: "Write register: trigger label print" },
  { key: "camera",          label: "Camera / Vision",      note: "Integrate camera/vision system result",     color: T.purple, hasRegister: true,  registerKey: "cameraResultRegister",  registerNote: "Read register: camera pass/fail result" },
  { key: "torque",          label: "Torque / Force Check",  note: "Include torque/force measurement",          color: T.teal,   hasRegister: true,  registerKey: "torqueRegister",        registerNote: "Read register: torque/force measurement" },
  { key: "partPresence",    label: "Part Presence Check",  note: "Verify part is seated before starting",    color: T.blue,   hasRegister: true,  registerKey: "partPresenceRegister",  registerNote: "Read register: part sensor signal" },
];

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
    for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
      const base = toWholeNumberOrNull(cfg[field.key]);
      if (base === null) continue;
      const words = expandRegisterWindow(base, field.key, normalizedProtocol);
      for (const word of words) {
        if (range && (word < Number(range.rangeStart) || word > Number(range.rangeEnd))) { conflicts.push(`${field.label} uses R${word}, outside range.`); continue; }
        if (selfOccupancy.has(word) && selfOccupancy.get(word) !== field.label) { conflicts.push(`R${word} overlaps between ${selfOccupancy.get(word)} and ${field.label}.`); }
        else { selfOccupancy.set(word, field.label); }
      }
    }
    for (const entry of auxiliaryEntries) {
      const words = expandRegisterWindow(entry.register, null, normalizedProtocol);
      for (const word of words) {
        if (range && (word < Number(range.rangeStart) || word > Number(range.rangeEnd))) { conflicts.push(`${entry.label} uses R${word}, outside range.`); continue; }
        if (selfOccupancy.has(word) && selfOccupancy.get(word) !== entry.label) { conflicts.push(`R${word} overlaps between ${selfOccupancy.get(word)} and ${entry.label}.`); }
        else { selfOccupancy.set(word, entry.label); }
      }
    }
    handshakeEntries.forEach(entry => {
      if (entry.register === null) return;
      expandRegisterWindow(entry.register, null, normalizedProtocol).forEach(word => {
        if (range && (word < Number(range.rangeStart) || word > Number(range.rangeEnd))) conflicts.push(`${entry.label} R${word} outside range.`);
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
    rows[index] = { ...rows[index], [key]: value };
    const nextCfg = applyStandardHandshakeRowToCoreCfg(currentCfg, rows[index]);
    const syncedRows = syncStandardHandshakeRowsWithCore(rows, nextCfg);
    return { ...p, plcConfig: { ...nextCfg, handshakeMap: syncedRows } };
  });

  const removeHandshakeRow = (index) => setFormData(p => {
    const rows = [...normalizeHandshakeRows(p?.plcConfig?.handshakeMap, p.plcConfig)];
    rows.splice(index, 1);
    return { ...p, plcConfig: { ...(p.plcConfig || {}), handshakeMap: rows } };
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
    try { await navigator.clipboard.writeText(guide); toast.success("PLC guide copied"); }
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
      toast.success("Signal map downloaded");
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validateCurrentTab(activeTab);
    if (err) { toast.error(err); return; }
    if (!isLastTab) { saveAndNext(); return; }
    setSaving(true);
    try {
      if (registerConflicts.length > 0) { toast.error(registerConflicts[0]); return; }
      const payload = toSubmitPayload(formData);
      if (editingMachine) await machineApi.update(editingMachine.id, payload);
      else await machineApi.create(payload);
      toast.success(editingMachine ? "Machine updated" : "Machine created");
      closeModal(); await loadData();
    } catch (err) { toast.error(err.response?.data?.error || "Failed to save machine"); }
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

  /* ─── Category counts for tuning tab ──────────────────────── */
  const categoryCounts = useMemo(() => {
    const counts = {};
    handshakeRows.forEach(r => { const cat = r.category || "handshake"; counts[cat] = (counts[cat] || 0) + 1; });
    return counts;
  }, [handshakeRows]);

  /* ─── Station feature register helper ─────────────────────── */
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
                          <span style={{ padding: "2px 8px", background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 4, fontSize: 11, fontFamily: "ui-monospace,monospace", color: T.blue, fontWeight: 600 }}>R{range.rangeStart}-R{range.rangeEnd}</span>
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
          <div style={{ position: "relative", width: "100%", maxWidth: 920, background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "94vh", boxShadow: "0 24px 60px rgba(15,23,42,.22)" }}>
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
            <form id="machine-form" onSubmit={handleSubmit} style={{ flex: 1, overflowY: "auto", padding: 24, background: T.bg }}>

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
                          <div><span style={{ color: T.textMuted }}>Start: </span><span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: T.blue }}>R{rangeById[formData.plcRangeId].rangeStart}</span></div>
                          <div><span style={{ color: T.textMuted }}>End: </span><span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: T.blue }}>R{rangeById[formData.plcRangeId].rangeEnd}</span></div>
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
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                  {/* Toolbar */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "12px 14px", background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 10 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {[
                        { label: "Auto Assign All", onClick: autoAssignAllHandshakeRegisters, color: T.teal, border: T.tealBorder },
                        { label: "Sync From Registers", onClick: syncHandshakeRowsFromRegisters, color: T.slate, border: T.border },
                        { label: "Standard 1/2/3/4", onClick: applyStandardTuning, color: T.blue, border: T.blueBorder },
                        { label: "Copy PLC Guide", onClick: copyPlcGuide, color: T.navyMid, border: T.navyLight },
                        { label: "Download CSV", onClick: downloadCurrentPlcSpec, color: T.purple, border: T.purpleBorder },
                      ].map(({ label, onClick, color, border }) => (
                        <button key={label} type="button" onClick={onClick}
                          style={{ padding: "6px 11px", fontSize: 11, fontWeight: 700, borderRadius: 7, border: `1px solid ${border}`, color, background: "transparent", cursor: "pointer" }}
                          onMouseEnter={e => e.currentTarget.style.background = color + "14"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Quick add per category */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, alignSelf: "center" }}>+ ADD:</span>
                      {SIGNAL_CATEGORIES.map(cat => {
                        const cc = CAT_COLORS[cat.id] || CAT_COLORS.handshake;
                        return (
                          <button key={cat.id} type="button" onClick={() => addHandshakeRow(cat.id)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: `1px solid ${cc.border}`, color: cc.text, background: cc.bg, cursor: "pointer" }}>
                            <Plus size={10} />{cat.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Category filter tabs */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[{ id: "all", label: "All", count: handshakeRows.length }, ...SIGNAL_CATEGORIES.map(c => ({ ...c, count: categoryCounts[c.id] || 0 }))].map(cat => {
                      const isActive = activeTuningCategory === cat.id;
                      const cc = cat.id === "all" ? { bg: T.bgMuted, border: T.border, text: T.textSec } : CAT_COLORS[cat.id] || CAT_COLORS.handshake;
                      return (
                        <button key={cat.id} type="button" onClick={() => setActiveTuningCategory(cat.id)}
                          style={{ padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 99, border: `1.5px solid ${isActive ? cc.border : T.borderLight}`, background: isActive ? cc.bg : "transparent", color: isActive ? cc.text : T.textMuted, cursor: "pointer", transition: "all .15s" }}>
                          {cat.label} {cat.count > 0 && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>{cat.count}</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Signal rows */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {filteredHandshakeRows.length === 0 && (
                      <div style={{ padding: "40px 24px", textAlign: "center", border: `2px dashed ${T.border}`, borderRadius: 10, color: T.textMuted }}>
                        <p style={{ fontWeight: 600, fontSize: 13 }}>No signals in this category.</p>
                        <p style={{ fontSize: 12, marginTop: 4 }}>Use the "+ ADD" buttons above to add signals.</p>
                      </div>
                    )}
                    {filteredHandshakeRows.map((row) => {
                      const actualIndex = handshakeRows.findIndex(r => r.id === row.id);
                      const isWrite = row.direction === "WRITE";
                      const isBoth = row.direction === "BOTH";
                      const cat = row.category || "handshake";
                      const cc = CAT_COLORS[cat] || CAT_COLORS.handshake;
                      const accentColor = isWrite ? T.blue : isBoth ? T.teal : T.green;
                      const registerIssue = handshakeInputIssues.get(actualIndex);
                      const rangeBounds = getHandshakeRangeBounds();

                      return (
                        <div key={row.id || `${row.signal}-${actualIndex}`}
                          style={{ background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 10, overflow: "hidden" }}>
                          {/* Row header */}
                          <div style={{ display: "flex", alignItems: "center", padding: "8px 12px 8px 0", borderBottom: `1px solid ${T.borderLight}`, background: T.bgMuted }}>
                            <div style={{ width: 4, alignSelf: "stretch", background: cc.text, flexShrink: 0, marginRight: 12 }} />
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: cc.bg, color: cc.text, border: `1px solid ${cc.border}` }}>{cc.label}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: T.text }}>{row.signal || `Signal ${actualIndex + 1}`}</span>
                              <ActionBadge action={row.direction || "READ"} />
                              {row.register && (
                                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: T.blue, fontWeight: 700, background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 4, padding: "1px 6px" }}>R{row.register}</span>
                              )}
                              {row.value !== undefined && row.value !== "" && (
                                <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: T.navy, fontWeight: 700 }}>= {row.value}</span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", paddingRight: 4 }}>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: T.textMuted, cursor: "pointer" }}>
                                <input type="checkbox" checked={row.required !== false} onChange={e => updateHandshakeRow(actualIndex, "required", e.target.checked)} style={{ accentColor: T.blue }} />
                                Required
                              </label>
                              <button type="button" onClick={() => autoAssignHandshakeRegister(actualIndex)}
                                style={{ height: 26, border: `1px solid ${T.tealBorder}`, borderRadius: 6, background: T.tealLight, display: "flex", alignItems: "center", cursor: "pointer", color: T.teal, padding: "0 8px", fontSize: 10, fontWeight: 700 }}>
                                Auto
                              </button>
                              <button type="button" onClick={() => removeHandshakeRow(actualIndex)}
                                style={{ width: 26, height: 26, border: `1px solid ${T.redBorder}`, borderRadius: 6, background: T.redLight, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: T.red }}>
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>

                          {/* Row fields */}
                          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 80px 80px 110px 70px 1fr", gap: 10, padding: "12px 14px", alignItems: "end" }}>
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
                                <option value="READ">READ</option>
                                <option value="WRITE">WRITE</option>
                                <option value="BOTH">BOTH</option>
                              </FieldSelect>
                            </div>
                            <div>
                              <Label>Register</Label>
                              {usesRange && rangeBounds ? (
                                <FieldSelect value={row.register ?? ""} onChange={e => updateHandshakeRow(actualIndex, "register", e.target.value)} mono
                                  style={registerIssue ? { borderColor: T.red, background: T.redLight } : {}}>
                                  <option value="">- Select -</option>
                                  {Array.from({ length: rangeBounds.end - rangeBounds.start + 1 }, (_, i) => rangeBounds.start + i).map(n => (
                                    <option key={n} value={n}>R{n}</option>
                                  ))}
                                </FieldSelect>
                              ) : (
                                <FieldInput type="number" value={row.register ?? ""} onChange={e => updateHandshakeRow(actualIndex, "register", e.target.value)} placeholder="101" mono
                                  style={registerIssue ? { borderColor: T.red, background: T.redLight } : {}} />
                              )}
                              {registerIssue && <p style={{ margin: "4px 0 0", fontSize: 10, color: T.red }}>{registerIssue}</p>}
                            </div>
                            <div>
                              <Label>Value</Label>
                              <FieldInput type="number" value={row.value ?? ""} onChange={e => updateHandshakeRow(actualIndex, "value", e.target.value)} placeholder="1" mono
                                style={{ background: row.value !== "" && row.value !== null && row.value !== undefined ? T.blueLight : "", borderColor: row.value !== "" && row.value !== null ? T.blueBorder : T.border, fontWeight: 700, color: T.navy }} />
                            </div>
                            <div>
                              <Label>Meaning / Purpose</Label>
                              <FieldInput value={row.meaning || ""} onChange={e => updateHandshakeRow(actualIndex, "meaning", e.target.value)} placeholder="Describe this signal" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary table */}
                  {handshakeRows.length > 0 && (
                    <div style={{ background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px", background: T.bgMuted, borderBottom: `1px solid ${T.borderLight}`, display: "flex", alignItems: "center", gap: 8 }}>
                        <FlaskConical size={13} color={T.blue} />
                        <p style={{ fontSize: 11, fontWeight: 700, color: T.text, margin: 0, textTransform: "uppercase", letterSpacing: "0.07em" }}>Signal Summary — All Categories</p>
                        <span style={{ marginLeft: "auto", fontSize: 10, color: T.textMuted }}>{handshakeRows.length} total signals</span>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: T.bgMuted, borderBottom: `1px solid ${T.borderLight}` }}>
                              {["#", "Category", "Signal", "Dir", "Register", "Value", "Meaning", "Req"].map(h => (
                                <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: T.textMuted, whiteSpace: "nowrap" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {handshakeRows.map((row, i) => {
                              const cc = CAT_COLORS[row.category || "handshake"] || CAT_COLORS.handshake;
                              return (
                                <tr key={row.id || i} style={{ borderBottom: `1px solid ${T.borderLight}`, background: i % 2 === 1 ? T.bgMuted : T.bgCard }}>
                                  <td style={{ padding: "8px 12px", color: T.textMuted, fontSize: 11, fontFamily: "ui-monospace,monospace" }}>{i + 1}</td>
                                  <td style={{ padding: "8px 12px" }}>
                                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: cc.bg, color: cc.text, border: `1px solid ${cc.border}` }}>{cc.label}</span>
                                  </td>
                                  <td style={{ padding: "8px 12px", fontWeight: 600, color: T.text }}>{row.signal || "-"}</td>
                                  <td style={{ padding: "8px 12px" }}><ActionBadge action={row.direction || "READ"} /></td>
                                  <td style={{ padding: "8px 12px", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: row.register ? T.blue : T.textMuted }}>{row.register ? `R${row.register}` : "-"}</td>
                                  <td style={{ padding: "8px 12px", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: T.navy }}>{row.value ?? "-"}</td>
                                  <td style={{ padding: "8px 12px", color: T.textSec, fontSize: 11 }}>{row.meaning || "-"}</td>
                                  <td style={{ padding: "8px 12px" }}><Chip label={row.required !== false ? "Must" : "Optional"} color={row.required !== false ? "blue" : "gray"} /></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {registerConflicts.length > 0 && (
                    <div style={{ padding: "10px 14px", background: T.redLight, border: `1px solid ${T.redBorder}`, borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <AlertTriangle size={14} color={T.red} style={{ flexShrink: 0, marginTop: 1 }} />
                      <div>{registerConflicts.slice(0, 3).map(c => <p key={c} style={{ fontSize: 11, color: T.red, margin: 0, lineHeight: 1.5 }}>{c}</p>)}</div>
                    </div>
                  )}

                  <div style={{ padding: "10px 14px", background: T.amberLight, border: `1px solid ${T.amberBorder}`, borderRadius: 8, display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <AlertTriangle size={14} color={T.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 12, color: T.textSec, margin: 0, lineHeight: 1.5 }}>Changing register addresses or values requires matching updates in the PLC program. Coordinate with your PLC programmer.</p>
                  </div>
                </div>
              )}

              {/* ─── STATION CONTROL ──────────────────────────── */}
              {activeTab === "live" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                  {/* Station info bar */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
                    {[
                      { label: "Station", value: currentStationNo || "-" },
                      { label: "Step", value: operationSequenceSummary.operationIndex ? `${operationSequenceSummary.operationIndex}/${operationSequenceSummary.totalOperations}` : "-" },
                      { label: "Sequence No", value: formData?.sequenceNo || "-" },
                      { label: "Total Ops", value: operationSequenceSummary.totalOperations || 0 },
                    ].map(item => (
                      <div key={item.label} style={{ padding: "10px 14px", background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 10 }}>
                        <p style={{ margin: 0, fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{item.label}</p>
                        <p style={{ margin: "4px 0 0", fontSize: 14, fontWeight: 700, color: T.text }}>{String(item.value)}</p>
                      </div>
                    ))}
                  </div>

                  {/* Quality check station toggle */}
                  <div style={{ background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", background: T.bgMuted, borderBottom: `1px solid ${T.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T.text }}>Quality Check Station</p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: T.textMuted }}>Configure result source for quality checks — IP push or PLC register polling</p>
                      </div>
                      <Toggle
                        checked={Boolean(formData?.spcConfig?.enabled)}
                        onChange={(v) => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), enabled: v, plcAckEnabled: v } }))}
                        label="" color={T.green}
                      />
                    </div>
                    {Boolean(formData?.spcConfig?.enabled) && (
                      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                        <div>
                          <Label>Quality Result Mode</Label>
                          <FieldSelect value={formData?.spcConfig?.mode || "IP_PUSH"} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), mode: e.target.value } }))}>
                            <option value="IP_PUSH">IP Push (from Quality software)</option>
                            <option value="PLC_REGISTER">PLC Register Poll</option>
                          </FieldSelect>
                        </div>
                        {(formData?.spcConfig?.mode || "IP_PUSH") === "IP_PUSH" ? (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 10 }}>
                            <div><Label>Quality System IP</Label><FieldInput value={formData?.spcConfig?.sourceIp || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), sourceIp: e.target.value } }))} placeholder="192.168.3.200" mono /></div>
                            <div><Label>Quality Port</Label><FieldInput type="number" value={formData?.spcConfig?.sourcePort || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), sourcePort: e.target.value } }))} placeholder="5000" mono /></div>
                            <div><Label>Result Key</Label><FieldInput value={formData?.spcConfig?.payloadResultKey || "RESULT"} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), payloadResultKey: e.target.value.toUpperCase() } }))} placeholder="RESULT" mono /></div>
                            <div><Label>NG Values (comma separated)</Label><FieldInput value={formData?.spcConfig?.payloadResultNgValues || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), payloadResultNgValues: e.target.value } }))} placeholder="NG, FAIL, 0" /></div>
                          </div>
                        ) : (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 10 }}>
                            <div><Label>Result Register</Label><FieldInput type="number" value={formData?.spcConfig?.plcResultRegister || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), plcResultRegister: e.target.value } }))} placeholder="103" mono /></div>
                            <div><Label>OK Values</Label><FieldInput value={formData?.spcConfig?.plcResultOkValues || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), plcResultOkValues: e.target.value } }))} placeholder="1, OK" /></div>
                            <div><Label>NG Values</Label><FieldInput value={formData?.spcConfig?.plcResultNgValues || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), plcResultNgValues: e.target.value } }))} placeholder="0, NG" /></div>
                          </div>
                        )}
                        <div style={{ padding: "10px 14px", background: T.blueLight + "44", border: `1px solid ${T.blueBorder}`, borderRadius: 8, fontSize: 12, color: T.textSec }}>
                          <Info size={12} style={{ display: "inline", marginRight: 6, verticalAlign: "middle" }} color={T.blue} />
                          Confirmation register (mapped in Mapping & Tuning) handles ACK. No separate ACK register needed.
                        </div>
                        <div>
                          <Label>Quality Payload Keys (comma separated)</Label>
                          <FieldInput value={formData?.spcConfig?.qualityPayloadKeys || ""} onChange={e => setFormData(prev => ({ ...prev, spcConfig: { ...(prev.spcConfig || {}), qualityPayloadKeys: e.target.value } }))} placeholder="diameter, reasonCode, height" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Station feature toggles */}
                  <div style={{ background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", background: T.bgMuted, borderBottom: `1px solid ${T.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T.text }}>Station Features & Register Mapping</p>
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: T.textMuted }}>Enable features and assign PLC data registers for each — only enabled features show register fields</p>
                      </div>
                      <button type="button" onClick={saveCurrentStationSettings} disabled={savingStationSettings || !currentStationNo}
                        style={{ padding: "7px 14px", background: savingStationSettings || !currentStationNo ? T.slateLight : T.green, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: savingStationSettings || !currentStationNo ? "not-allowed" : "pointer", opacity: savingStationSettings || !currentStationNo ? 0.7 : 1 }}>
                        {savingStationSettings ? "Saving..." : "Save Station Settings"}
                      </button>
                    </div>
                    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 0 }}>
                      {STATION_FEATURES.map((feature, fi) => {
                        const isEnabled = Boolean(currentStationFeatures?.[feature.key]);
                        const isLast = fi === STATION_FEATURES.length - 1;
                        return (
                          <div key={feature.key} style={{ borderBottom: isLast ? "none" : `1px solid ${T.borderLight}`, padding: "12px 0" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                              <div style={{ flex: 1 }}>
                                <Toggle
                                  checked={isEnabled}
                                  onChange={(v) => updateCurrentStationFeature(feature.key, v)}
                                  label={feature.label}
                                  note={feature.note}
                                  color={feature.color}
                                />
                              </div>
                              {isEnabled && feature.hasRegister && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200 }}>
                                  <Label>PLC Data Register</Label>
                                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                    <FieldInput
                                      type="number"
                                      value={getStationRegisterValue(feature.registerKey)}
                                      onChange={e => updateStationRegister(feature.registerKey, e.target.value)}
                                      placeholder="e.g. 120"
                                      mono
                                      style={{ flex: 1 }}
                                    />
                                    <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, fontWeight: 700, color: getStationRegisterValue(feature.registerKey) ? T.blue : T.textMuted }}>
                                      {getStationRegisterValue(feature.registerKey) ? `R${getStationRegisterValue(feature.registerKey)}` : "-"}
                                    </span>
                                  </div>
                                  <p style={{ fontSize: 10, color: T.textMuted, margin: 0 }}>{feature.registerNote}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Parts per cycle */}
                      <div style={{ borderTop: `1px solid ${T.borderLight}`, paddingTop: 12, display: "flex", alignItems: "center", gap: 16 }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: T.text }}>Parts per Cycle</p>
                          <p style={{ margin: "2px 0 0", fontSize: 10, color: T.textMuted }}>Number of parts processed per PLC cycle (1–20)</p>
                        </div>
                        <div style={{ minWidth: 120 }}>
                          <FieldInput type="number" value={currentStationFeatures?.plcPartCount ?? 1} onChange={e => updateCurrentStationFeature("plcPartCount", Number(e.target.value || 1))} min={1} max={20} mono />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Data source matrix */}
                  <div style={{ background: T.bgCard, border: `1px solid ${T.borderLight}`, borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", background: T.bgMuted, borderBottom: `1px solid ${T.borderLight}` }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T.text }}>Data Source Matrix</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: T.textMuted }}>Summary of what data comes from where for this machine</p>
                    </div>
                    <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: 0 }}>
                      {[
                        { label: "Quality Result", source: (formData?.spcConfig?.mode || "IP_PUSH") === "PLC_REGISTER" ? "PLC Register Poll" : "IP Push Payload", value: (formData?.spcConfig?.mode || "IP_PUSH") === "PLC_REGISTER" ? `R${formData?.spcConfig?.plcResultRegister || "-"}` : formData?.spcConfig?.payloadResultKey || "RESULT" },
                        { label: "Handshake / Confirmation", source: "PLC Register (Tuning tab)", value: `R${formData?.plcConfig?.heartbeatRegister || "-"}` },
                        { label: "Bypass Enable", source: "PLC Register (Tuning tab)", value: `R${formData?.plcConfig?.bypassRegister || "-"}` },
                        { label: "Rejection Bin", source: currentStationFeatures?.rejectionBin ? "Enabled + PLC Register" : "Disabled", value: currentStationFeatures?.rejectionBin ? (currentStationFeatures?.rejectionBinRegister ? `R${currentStationFeatures.rejectionBinRegister}` : "No reg set") : "-" },
                        { label: "Manual Result", source: currentStationFeatures?.manualResult ? "Enabled + PLC Register" : "Disabled", value: currentStationFeatures?.manualResult ? (currentStationFeatures?.manualResultRegister ? `R${currentStationFeatures.manualResultRegister}` : "No reg set") : "-" },
                        { label: "Camera / Vision", source: currentStationFeatures?.camera ? "Enabled + PLC Register" : "Disabled", value: currentStationFeatures?.camera ? (currentStationFeatures?.cameraResultRegister ? `R${currentStationFeatures.cameraResultRegister}` : "No reg set") : "-" },
                      ].map((row, i) => (
                        <div key={row.label} style={{ display: "contents" }}>
                          <div style={{ padding: "8px 0", borderBottom: i < 5 ? `1px solid ${T.borderLight}` : "none", fontSize: 11, color: T.text, fontWeight: 600 }}>{row.label}</div>
                          <div style={{ padding: "8px 0", borderBottom: i < 5 ? `1px solid ${T.borderLight}` : "none", fontSize: 10, color: T.textMuted }}>{row.source}</div>
                          <div style={{ padding: "8px 0", borderBottom: i < 5 ? `1px solid ${T.borderLight}` : "none", fontSize: 11, color: T.navy, fontWeight: 700, fontFamily: "ui-monospace,monospace" }}>{row.value}</div>
                        </div>
                      ))}
                    </div>
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
                    <Save size={13} />{saving ? "Saving..." : editingMachine ? "Update Machine" : "Create Machine"}
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

              {/* Bypass register info */}
              {formData?.plcConfig?.bypassRegister && (
                <div style={{ padding: "10px 12px", background: T.amberLight, border: `1px solid ${T.amberBorder}`, borderRadius: 8, fontSize: 12, color: T.amber, display: "flex", alignItems: "center", gap: 8 }}>
                  <Info size={12} />
                  Bypass signal will be written to <strong style={{ fontFamily: "ui-monospace,monospace" }}>R{formData.plcConfig.bypassRegister}</strong> (configured in Mapping & Tuning tab).
                </div>
              )}

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
                {bypassEnabled ? `Bypass will be enabled — interlock checks skipped.` : `Bypass will be disabled — normal checks resume.`}
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
                  {bypassing ? "Saving..." : (bypassEnabled ? "Enable Bypass" : "Disable Bypass")}
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