import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu, Plus, Save, Trash2, Edit, RefreshCw, Search,
  X, Network, Terminal, Activity, Settings,
  Layout, Database, ChevronRight, Info, AlertTriangle, Eye, Zap, Copy,
  CheckCircle2, XCircle, ShieldOff, ShieldCheck, ToggleLeft, ToggleRight,
  ArrowDownUp, ArrowDown, ArrowUp, Hash, FlaskConical
} from "lucide-react";
import toast from "react-hot-toast";
import ConfirmModal from "../components/ConfirmModal";
import { machineApi, plcConfigApi, traceabilityApi } from "../api/services";
import {
  MACHINE_MODBUS_TUNING_FIELD_CONFIG,
  MACHINE_REGISTER_ROLE_FIELDS,
} from "../utils/machineFields";
import { loadReportConfig } from "../utils/reportConfig";

/* --- helpers ----------------------------------------------- */
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
    signal: "", direction: "READ", register: "", value: "", meaning: "", required: true,
    ...overrides,
  };
}
function buildDefaultHandshakeRows(cfg = {}) {
  return [
    createHandshakeRow({ signal: "Start", direction: "WRITE", register: toFormValue(cfg.startRegister, ""), value: toFormValue(cfg.startValue, "1"), meaning: "Start machine cycle", required: true }),
    createHandshakeRow({ signal: "Block / Interlock", direction: "WRITE", register: toFormValue(cfg.blockRegister, ""), value: toFormValue(cfg.blockValue, "2"), meaning: "Block cycle on NG / duplicate / interlock", required: true }),
    createHandshakeRow({ signal: "Running", direction: "READ", register: toFormValue(cfg.runningRegister, ""), value: toFormValue(cfg.startedValue, "2"), meaning: "Machine is running", required: true }),
    createHandshakeRow({ signal: "End OK", direction: "READ", register: toFormValue(cfg.endOkRegister, ""), value: toFormValue(cfg.endOkValue, "3"), meaning: "Cycle completed OK", required: true }),
    createHandshakeRow({ signal: "End NG", direction: "READ", register: toFormValue(cfg.endNgRegister, ""), value: toFormValue(cfg.endNgValue, "4"), meaning: "Cycle completed NG", required: true }),
    createHandshakeRow({ signal: "Reset", direction: "WRITE", register: toFormValue(cfg.resetRegister, ""), value: toFormValue(cfg.resetValue, "9"), meaning: "Reset/clear machine state", required: true }),
    createHandshakeRow({ signal: "Confirmation", direction: "BOTH", register: toFormValue(cfg.heartbeatRegister, ""), value: "1", meaning: "Confirmation", required: true }),
  ];
}
function normalizeHandshakeRows(rows, cfg = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return buildDefaultHandshakeRows(cfg);
  return rows.map((row) => createHandshakeRow({
    id: row?.id || row?.key || undefined,
    signal: toFormValue(row?.signal ?? row?.label, ""),
    direction: String(row?.direction || "READ").toUpperCase(),
    register: toFormValue(row?.register, ""),
    value: toFormValue(row?.value, ""),
    meaning: toFormValue(row?.meaning ?? row?.purpose ?? row?.description, ""),
    required: row?.required === undefined ? true : Boolean(row.required),
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
  return `CUSTOM_${normalized || "UNNAMED"}`;
}
function normalizeStandardHandshakeSignalKey(signal) {
  const normalized = String(signal || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (normalized === "START") return "START";
  if (["BLOCK", "BLOCK_INTERLOCK", "INTERLOCK", "BLOCK_INTERLOCK_SIGNAL"].includes(normalized)) return "BLOCK_INTERLOCK";
  if (["RUNNING", "STARTED"].includes(normalized)) return "RUNNING";
  if (["END_OK", "OK_END", "ENDED_OK"].includes(normalized)) return "END_OK";
  if (["END_NG", "NG_END", "ENDED_NG"].includes(normalized)) return "END_NG";
  if (normalized === "RESET") return "RESET";
  if (["CONFIRMATION", "CONFIRM", "ACK", "ACKNOWLEDGE", "ACKNOWLEDGEMENT"].includes(normalized)) return "CONFIRMATION";
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
  const indexByKey = new Map();
  for (let i = 0; i < nextRows.length; i += 1) {
    const key = normalizeStandardHandshakeSignalKey(nextRows[i]?.signal);
    if (key && !indexByKey.has(key)) {
      indexByKey.set(key, i);
    }
  }
  for (const [standardKey, meta] of Object.entries(STANDARD_HANDSHAKE_SIGNAL_META)) {
    const registerText = toFormValue(cfg?.[meta.registerKey], "");
    const valueText = meta.valueKey
      ? toFormValue(cfg?.[meta.valueKey], meta.defaultValue)
      : toFormValue(meta.defaultValue, "1");
    const rowDefaults = {
      signal: meta.signal,
      direction: meta.direction,
      register: registerText,
      value: valueText,
      meaning: meta.defaultMeaning,
      required: true,
    };
    if (indexByKey.has(standardKey)) {
      const idx = indexByKey.get(standardKey);
      const current = nextRows[idx] || {};
      const resolvedRegister = registerText === "" ? toFormValue(current.register, "") : registerText;
      nextRows[idx] = createHandshakeRow({
        ...current,
        ...rowDefaults,
        register: resolvedRegister,
        meaning: toFormValue(current.meaning, "") || meta.defaultMeaning,
        required: current.required === undefined ? true : Boolean(current.required),
      });
    } else {
      nextRows.push(createHandshakeRow(rowDefaults));
    }
  }
  return nextRows;
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
function isStandardHandshakeSignal(signal) {
  return Boolean(normalizeStandardHandshakeSignalKey(signal));
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
function buildMachinePlcSpecCsv(formData, reportConfig = null) {
  const cfg = formData?.plcConfig || {};
  const protocol = normalizeProtocol(formData?.plcProtocol, "TCP_TEXT");
  const machineName = escapeLine(formData?.machineName || "Machine");
  const op = escapeLine(formData?.operationNo || "-");
  const line = escapeLine(formData?.lineName || "-");
  const ip = escapeLine(formData?.plcIp || "-");
  const port = escapeLine(formData?.plcPort || "-");
  const slmpDevice = escapeLine(formData?.plcSlmpDevice || "D");
  const rows = [];
  rows.push(["SECTION","FIELD","REGISTER_NO","DEVICE","DIRECTION","VALUES","PURPOSE","MACHINE","LINE","OPERATION"]);
  const pushRow = ({ section, field, registerNo, device, direction, values, purpose }) => {
    rows.push([section||"",field||"",registerNo===null||registerNo===undefined?"":String(registerNo),protocol==="SLMP"?String(device||slmpDevice||"D"):"",direction||"",values||"",purpose||"",machineName,line,op]);
  };
  const reportMeta = reportConfig || loadReportConfig();
  pushRow({ section:"REPORT_HEADER",field:"headerLine1",registerNo:escapeLine(reportMeta.headerLine1||reportMeta.companyName||"Traceability Report") });
  pushRow({ section:"REPORT_HEADER",field:"headerLine2",registerNo:escapeLine(reportMeta.headerLine2||reportMeta.projectTitle||"") });
  pushRow({ section:"REPORT_HEADER",field:"reportTitle",registerNo:escapeLine(reportMeta.reportTitle||"PLC Register Specification") });
  pushRow({ section:"REPORT_HEADER",field:"plant",registerNo:escapeLine(reportMeta.plantName||"-") });
  pushRow({ section:"REPORT_HEADER",field:"department",registerNo:escapeLine(reportMeta.department||"-") });
  pushRow({ section:"REPORT_HEADER",field:"location",registerNo:escapeLine(reportMeta.location||"-") });
  pushRow({ section:"REPORT_HEADER",field:"generatedAt",registerNo:new Date().toLocaleString("en-IN") });
  pushRow({ section:"META",field:"protocol",registerNo:protocol });
  pushRow({ section:"META",field:"ip",registerNo:ip });
  pushRow({ section:"META",field:"port",registerNo:port });
  if (protocol==="SLMP") {
    pushRow({ section:"META",field:"slmpDevice",registerNo:slmpDevice,device:slmpDevice });
    pushRow({ section:"META",field:"slmpFrameMode",registerNo:escapeLine(formData?.plcSlmpFrameMode||"AUTO"),device:slmpDevice });
  }
  const coreRows = [
    { key:"startRegister",field:"startRegister",direction:"WRITE",values:`${toFormValue(cfg.startValue,"1")}=Start`,purpose:"PLC start command register" },
    { key:"blockRegister",field:"blockRegister",direction:"WRITE",values:`${toFormValue(cfg.blockValue,"2")}=Block`,purpose:"PLC block/interlock command register" },
    { key:"runningRegister",field:"runningRegister",direction:"READ",values:`${toFormValue(cfg.startedValue,"2")}=Running`,purpose:"PLC running status feedback register" },
    { key:"endOkRegister",field:"endOkRegister",direction:"READ",values:`${toFormValue(cfg.endOkValue,"3")}=End OK`,purpose:"PLC cycle completed OK feedback register" },
    { key:"endNgRegister",field:"endNgRegister",direction:"READ",values:`${toFormValue(cfg.endNgValue,"4")}=End NG`,purpose:"PLC cycle completed NG feedback register" },
    { key:"stationRegister",field:"stationRegister",direction:"WRITE",values:"Station/Hash payload (optional)",purpose:"Station hash payload register" },
    { key:"partRegister",field:"partRegister",direction:"WRITE",values:"Part/Hash payload (optional)",purpose:"Part hash payload register" },
    { key:"resetRegister",field:"resetRegister",direction:"WRITE",values:`${toFormValue(cfg.resetValue,"9")}=Reset`,purpose:"PLC reset command register" },
  ];
  for (const row of coreRows) {
    const registerNo = toRegNumberText(cfg?.[row.key]);
    if (!registerNo) continue;
    pushRow({ section:"CORE_REGISTER",field:row.field,registerNo,device:slmpDevice,direction:row.direction,values:row.values,purpose:row.purpose });
  }
  if (toRegNumberText(cfg?.heartbeatRegister)) {
    pushRow({ section:"CORE_REGISTER",field:"heartbeatRegister",registerNo:toRegNumberText(cfg.heartbeatRegister),device:slmpDevice,direction:"BOTH",values:"Heartbeat signal (optional)",purpose:"PLC communication health register" });
  }
  const syncedHandshakeRows = syncStandardHandshakeRowsWithCore(formData?.plcConfig?.handshakeMap, cfg);
  for (const row of syncedHandshakeRows) {
    const registerNo = toRegNumberText(row?.register);
    if (!registerNo) continue;
    pushRow({ section:"HANDSHAKE",field:escapeLine(row?.signal||"Signal"),registerNo,device:slmpDevice,direction:String(row?.direction||"READ").toUpperCase(),values:row?.value===""||row?.value===null||row?.value===undefined?"":String(row.value),purpose:escapeLine(row?.meaning||"Handshake signal") });
  }
  if (Array.isArray(formData?.plcSignalMap)) {
    for (const row of formData.plcSignalMap) {
      const registerNo = toRegNumberText(row?.register);
      if (!registerNo) continue;
      pushRow({ section:"LIVE_REGISTER",field:escapeLine(row?.label||row?.key||"liveRegister"),registerNo,device:row?.device||slmpDevice||"D",direction:normalizeDirectionLabel(row?.direction),values:"",purpose:escapeLine(row?.description||"Live signal") });
    }
  }
  const tuningRows = [["startValue",toFormValue(cfg.startValue,"1")],["startedValue",toFormValue(cfg.startedValue,"2")],["endOkValue",toFormValue(cfg.endOkValue,"3")],["endNgValue",toFormValue(cfg.endNgValue,"4")],["blockValue",toFormValue(cfg.blockValue,"2")],["resetValue",toFormValue(cfg.resetValue,"9")]];
  for (const [field,value] of tuningRows) {
    pushRow({ section:"TUNING",field,registerNo:value,device:slmpDevice });
  }
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}
const SLMP_DOUBLE_WORD_KEYS = new Set(["partRegister","stationRegister"]);
function toWholeNumberOrNull(value) {
  if (value===null||value===undefined||value==="") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function getRegisterSpanWords(registerKey, protocol) {
  if (String(protocol||"").toUpperCase()!=="SLMP") return 1;
  return SLMP_DOUBLE_WORD_KEYS.has(String(registerKey||"")) ? 2 : 1;
}
function expandRegisterWindow(registerNo, registerKey, protocol) {
  const base = toWholeNumberOrNull(registerNo);
  if (base===null) return [];
  const width = getRegisterSpanWords(registerKey, protocol);
  return Array.from({ length:width }, (_,index) => base+index);
}
function getConfigOccupiedRegisters(cfg={}, protocol="MODBUS_TCP", excludeKey=null) {
  const occupied = new Set();
  for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
    if (excludeKey && field.key===excludeKey) continue;
    const words = expandRegisterWindow(cfg?.[field.key], field.key, protocol);
    words.forEach((w) => occupied.add(w));
  }
  return occupied;
}
function getAuxiliaryRegisterEntries(source={}) {
  const entries = [];
  const signalRows = Array.isArray(source?.plcSignalMap) ? source.plcSignalMap : [];
  signalRows.forEach((row, index) => {
    const register = toWholeNumberOrNull(row?.register);
    if (register===null) return;
    const label = String(row?.label||row?.key||`Live Register ${index+1}`).trim();
    entries.push({ register, label:label||`Live Register ${index+1}` });
  });
  const spc = source?.spcConfig||{};
  const isSpcPlcMode = Boolean(spc?.enabled) && String(spc?.mode||"").toUpperCase()==="PLC_REGISTER";
  if (isSpcPlcMode) {
    const resultRegister = toWholeNumberOrNull(spc?.plcResultRegister);
    if (resultRegister!==null) entries.push({ register:resultRegister, label:"SPC Result Register" });
    if (spc?.plcAckEnabled) {
      const ackRegister = toWholeNumberOrNull(spc?.plcAckRegister);
      if (ackRegister!==null) entries.push({ register:ackRegister, label:"SPC ACK Register" });
    }
  }
  return entries;
}
function getMachineOccupiedRegisterWords(machine={}, protocol="MODBUS_TCP") {
  const occupied = new Map();
  const cfg = machine?.plcConfig||{};
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
function normalizeSpcConfigForForm(raw={}) {
  const source = raw&&typeof raw==="object" ? raw : {};
  const plcOkValues = Array.isArray(source.plcResultOkValues) ? source.plcResultOkValues : String(source.plcResultOkValues||"").split(/[,\n;|]/).map((e)=>e.trim()).filter(Boolean);
  const plcNgValues = Array.isArray(source.plcResultNgValues) ? source.plcResultNgValues : String(source.plcResultNgValues||"").split(/[,\n;|]/).map((e)=>e.trim()).filter(Boolean);
  const qualityKeys = Array.isArray(source.qualityPayloadKeys) ? source.qualityPayloadKeys : String(source.qualityPayloadKeys||"").split(/[,\n;|]/).map((e)=>e.trim()).filter(Boolean);
  const ngValues = Array.isArray(source.payloadResultNgValues) ? source.payloadResultNgValues : String(source.payloadResultNgValues||"").split(/[,\n;|]/).map((e)=>e.trim()).filter(Boolean);
  return {
    enabled:source.enabled===true, mode:String(source.mode||source.resultMode||"IP_PUSH").toUpperCase()==="PLC_REGISTER"?"PLC_REGISTER":"IP_PUSH",
    sourceIp:String(source.sourceIp||""), sourcePort:toFormValue(source.sourcePort,""),
    payloadResultKey:String(source.payloadResultKey||"RESULT"), payloadResultNgValues:ngValues.join(", "),
    qualityPayloadKeys:qualityKeys.join(", "), plcResultRegister:toFormValue(source.plcResultRegister??source.resultRegister,""),
    plcResultDevice:String(source.plcResultDevice||source.resultDevice||"D").toUpperCase(),
    plcResultOkValues:plcOkValues.join(", "), plcResultNgValues:plcNgValues.join(", "),
    plcAckEnabled:source.plcAckEnabled===true, plcAckRegister:toFormValue(source.plcAckRegister??source.ackRegister,""),
    plcAckDevice:String(source.plcAckDevice||source.ackDevice||"D").toUpperCase(),
    plcAckOkValue:toFormValue(source.plcAckOkValue??source.ackOkValue??"101","101"),
    plcAckNgValue:toFormValue(source.plcAckNgValue??source.ackNgValue??"102","102"),
    plcAckErrorValue:toFormValue(source.plcAckErrorValue??source.ackErrorValue??"199","199"),
  };
}
function createEmptyForm() {
  const plcConfig = { rangeId:"",startRegister:"",statusRegister:"",blockRegister:"",runningRegister:"",endOkRegister:"",endNgRegister:"",partRegister:"",stationRegister:"",resetRegister:"",heartbeatRegister:"",startValue:"1",startedValue:"2",endOkValue:"3",endNgValue:"4",blockValue:"2",resetValue:"9" };
  return { machineName:"",lineName:"",sequenceNo:"",operationNo:"",cycleTimeSec:"0",loadingTimeSec:"0",dailyTargetQty:"0",plcIp:"",plcPort:"",plcProtocol:"TCP_TEXT",plcRangeId:"",plcSlmpDevice:"D",plcSlmpFrameMode:"AUTO",status:"ACTIVE",plcConfig:{...plcConfig,handshakeMap:buildDefaultHandshakeRows(plcConfig)},plcSignalMap:[],spcConfig:normalizeSpcConfigForForm({}) };
}
function buildFormFromMachine(m) {
  const cfg = m.plcConfig||{};
  const plcRangeId = cfg.rangeId??m.plcRangeId??"";
  const spcConfig = normalizeSpcConfigForForm(m.spcConfig||m.plcConfig?.spcConfig||{});
  const baseCfg = {
    startRegister: cfg.startRegister??m.plcStartRegister,
    statusRegister: cfg.statusRegister??cfg.runningRegister??m.plcStatusRegister??m.plcRunningRegister,
    blockRegister: cfg.blockRegister??m.plcBlockRegister,
    runningRegister: cfg.runningRegister??m.plcRunningRegister,
    endOkRegister: cfg.endOkRegister??m.plcEndOkRegister,
    endNgRegister: cfg.endNgRegister??m.plcEndNgRegister,
    resetRegister: cfg.resetRegister??m.plcResetRegister,
    heartbeatRegister: cfg.heartbeatRegister??m.plcHeartbeatRegister,
    startValue: cfg.startValue??m.plcStartValue,
    startedValue: cfg.startedValue??m.plcStartedValue,
    endOkValue: cfg.endOkValue??m.plcEndOkValue,
    endNgValue: cfg.endNgValue??m.plcEndNgValue,
    blockValue: cfg.blockValue??m.plcBlockValue,
    resetValue: cfg.resetValue??m.plcResetValue,
  };
  const syncedHandshakeMap = syncStandardHandshakeRowsWithCore(
    normalizeHandshakeRows(cfg.handshakeMap, baseCfg),
    baseCfg
  );
  return {
    machineName:m.machineName||"",lineName:m.lineName||"",sequenceNo:toFormValue(m.sequenceNo,""),operationNo:m.operationNo||"",
    cycleTimeSec:toFormValue(m.cycleTimeSec,"0"),loadingTimeSec:toFormValue(m.loadingTimeSec,"0"),dailyTargetQty:toFormValue(m.dailyTargetQty,"0"),
    plcIp:m.plcIp||"",plcPort:toFormValue(m.plcPort,""),plcProtocol:m.plcProtocol||"TCP_TEXT",plcRangeId:toFormValue(plcRangeId,""),
    plcSlmpDevice:m.plcSlmpDevice||"D",plcSlmpFrameMode:m.plcSlmpFrameMode||m.plcConfig?.slmpFrameMode||"AUTO",status:m.status||"ACTIVE",
    plcConfig:{
      rangeId:toFormValue(plcRangeId,""),startRegister:toFormValue(cfg.startRegister??m.plcStartRegister,""),blockRegister:toFormValue(cfg.blockRegister??m.plcBlockRegister,""),
      statusRegister:toFormValue(cfg.statusRegister??cfg.runningRegister??m.plcStatusRegister??m.plcRunningRegister,""),
      runningRegister:toFormValue(cfg.runningRegister??m.plcRunningRegister,""),endOkRegister:toFormValue(cfg.endOkRegister??m.plcEndOkRegister,""),
      endNgRegister:toFormValue(cfg.endNgRegister??m.plcEndNgRegister,""),partRegister:toFormValue(cfg.partRegister??m.plcPartRegister,""),
      stationRegister:toFormValue(cfg.stationRegister??m.plcStationRegister,""),resetRegister:toFormValue(cfg.resetRegister??m.plcResetRegister,""),
      heartbeatRegister:toFormValue(cfg.heartbeatRegister??m.plcHeartbeatRegister,""),
      startValue:toFormValue(cfg.startValue??m.plcStartValue,"1"),startedValue:toFormValue(cfg.startedValue??m.plcStartedValue,"2"),
      endOkValue:toFormValue(cfg.endOkValue??m.plcEndOkValue,"3"),endNgValue:toFormValue(cfg.endNgValue??m.plcEndNgValue,"4"),
      blockValue:toFormValue(cfg.blockValue??m.plcBlockValue,"2"),resetValue:toFormValue(cfg.resetValue??m.plcResetValue,"9"),
      handshakeMap:syncedHandshakeMap,
    },
    plcSignalMap:m.plcSignalMap||[], spcConfig,
  };
}
function toSubmitPayload(f) {
  const plcIp = String(f.plcIp||"").trim();
  const plcPort = toNullableNumber(f.plcPort);
  const plcRangeId = toNullableNumber(f.plcRangeId);
  const cfg = { ...(f.plcConfig || {}) };
  const normalizedRows = normalizeHandshakeRows(cfg.handshakeMap, cfg);
  let mergedCfg = { ...cfg };
  for (const row of normalizedRows) {
    mergedCfg = applyStandardHandshakeRowToCoreCfg(mergedCfg, row);
  }
  const syncedRows = syncStandardHandshakeRowsWithCore(normalizedRows, mergedCfg);
  const plcConfig = { rangeId:plcRangeId,startRegister:toNullableNumber(mergedCfg.startRegister),statusRegister:toNullableNumber(mergedCfg.runningRegister??mergedCfg.statusRegister),blockRegister:toNullableNumber(mergedCfg.blockRegister),runningRegister:toNullableNumber(mergedCfg.runningRegister),endOkRegister:toNullableNumber(mergedCfg.endOkRegister),endNgRegister:toNullableNumber(mergedCfg.endNgRegister),partRegister:toNullableNumber(mergedCfg.partRegister),stationRegister:toNullableNumber(mergedCfg.stationRegister),resetRegister:toNullableNumber(mergedCfg.resetRegister),heartbeatRegister:toNullableNumber(mergedCfg.heartbeatRegister),startValue:toNumberWithDefault(mergedCfg.startValue,1),startedValue:toNumberWithDefault(mergedCfg.startedValue,2),endOkValue:toNumberWithDefault(mergedCfg.endOkValue,3),endNgValue:toNumberWithDefault(mergedCfg.endNgValue,4),blockValue:toNumberWithDefault(mergedCfg.blockValue,2),resetValue:toNumberWithDefault(mergedCfg.resetValue,9),handshakeMap:syncedRows.map((row)=>({ id:row.id||null,signal:String(row.signal||"").trim(),direction:String(row.direction||"READ").trim().toUpperCase(),register:toNullableNumber(row.register),value:toNullableNumber(row.value),meaning:String(row.meaning||"").trim(),required:row.required!==false })).filter((row)=>row.signal||row.register!==null),slmpFrameMode:String(f.plcSlmpFrameMode||"AUTO").trim().toUpperCase() };
  const rawSpc = f.spcConfig||{};
  const payloadResultNgValues = String(rawSpc.payloadResultNgValues||"").split(/[,\n;|]/).map((e)=>e.trim().toUpperCase()).filter(Boolean).slice(0,20);
  const qualityPayloadKeys = String(rawSpc.qualityPayloadKeys||"").split(/[,\n;|]/).map((e)=>e.trim()).filter(Boolean).slice(0,40);
  const spcConfig = { enabled:rawSpc.enabled===true,mode:String(rawSpc.mode||"IP_PUSH").trim().toUpperCase()==="PLC_REGISTER"?"PLC_REGISTER":"IP_PUSH",appliesTo:"ALL",sourceIp:String(rawSpc.sourceIp||"").trim()||null,sourcePort:toNullableNumber(rawSpc.sourcePort),payloadResultKey:String(rawSpc.payloadResultKey||"RESULT").trim()||"RESULT",payloadResultNgValues,qualityPayloadKeys,plcResultRegister:toNullableNumber(rawSpc.plcResultRegister),plcResultDevice:String(rawSpc.plcResultDevice||"D").trim().toUpperCase()||"D",plcResultOkValues:String(rawSpc.plcResultOkValues||"").split(/[,\n;|]/).map((e)=>e.trim().toUpperCase()).filter(Boolean).slice(0,20),plcResultNgValues:String(rawSpc.plcResultNgValues||"").split(/[,\n;|]/).map((e)=>e.trim().toUpperCase()).filter(Boolean).slice(0,20),plcAckEnabled:rawSpc.plcAckEnabled===true,plcAckRegister:toNullableNumber(rawSpc.plcAckRegister),plcAckDevice:String(rawSpc.plcAckDevice||"D").trim().toUpperCase()||"D",plcAckOkValue:toNumberWithDefault(rawSpc.plcAckOkValue,101),plcAckNgValue:toNumberWithDefault(rawSpc.plcAckNgValue,102),plcAckErrorValue:toNumberWithDefault(rawSpc.plcAckErrorValue,199) };
  return { machineName:String(f.machineName||"").trim(),lineName:String(f.lineName||"").trim(),sequenceNo:toNullableNumber(f.sequenceNo),operationNo:String(f.operationNo||"").trim().toUpperCase(),cycleTimeSec:Math.max(toNullableNumber(f.cycleTimeSec)??0,0),loadingTimeSec:Math.max(toNullableNumber(f.loadingTimeSec)??0,0),dailyTargetQty:Math.max(toNullableNumber(f.dailyTargetQty)??0,0),plcIp,plcPort,plcProtocol:f.plcProtocol,plcRangeId,plcStatusRegister:plcConfig.statusRegister??plcConfig.runningRegister,plcConfig,plcBlockValue:plcConfig.blockValue,plcSlmpDevice:String(f.plcSlmpDevice||"").trim().toUpperCase()||null,plcSlmpFrameMode:plcConfig.slmpFrameMode,status:f.status||"ACTIVE",machineIp:plcIp,machinePort:plcPort,plcSignalMap:f.plcSignalMap||[],spcConfig };
}

const FORM_TABS = [
  { id:"general",   label:"Identity",       icon:Layout   },
  { id:"network",   label:"Network & PLC",  icon:Network  },
  { id:"tuning",    label:"Mapping & Tuning", icon:Settings },
  { id:"live",      label:"Live Registers", icon:Eye      },
];

const HANDSHAKE_GROUP_CORE_KEY_MAP = {
  START_GROUP: "startRegister",
  BLOCK_GROUP: "blockRegister",
  RUNNING_GROUP: "runningRegister",
  END_OK_GROUP: "endOkRegister",
  END_NG_GROUP: "endNgRegister",
  RESET_GROUP: "resetRegister",
  CONFIRMATION_GROUP: "heartbeatRegister",
};

const REGISTER_IO_HELP = {
  startRegister:     { action:"WRITE", flow:"PC → PLC", purpose:"Start command sent to PLC" },
  blockRegister:     { action:"WRITE", flow:"PC → PLC", purpose:"Block/interlock command sent to PLC" },
  runningRegister:   { action:"READ",  flow:"PLC → PC", purpose:"Machine running status feedback" },
  endOkRegister:     { action:"READ",  flow:"PLC → PC", purpose:"Cycle completed OK feedback" },
  endNgRegister:     { action:"READ",  flow:"PLC → PC", purpose:"Cycle completed NG feedback" },
  partRegister:      { action:"WRITE", flow:"PC → PLC", purpose:"Optional part/hash payload register" },
  stationRegister:   { action:"WRITE", flow:"PC → PLC", purpose:"Optional station/hash payload register" },
  resetRegister:     { action:"WRITE", flow:"PC → PLC", purpose:"Reset/fault clear command register" },
  heartbeatRegister: { action:"BOTH",  flow:"PLC ↔ PC", purpose:"Heartbeat communication check (optional)" },
};

const TUNING_VALUE_HELP = {
  startValue:   { label:"Start Value",   direction:"WRITE", usage:"Written to Start Register to trigger cycle start",        registerKey:"startRegister"  },
  blockValue:   { label:"Block Value",   direction:"WRITE", usage:"Written to Block Register to block on NG / interlock",    registerKey:"blockRegister"  },
  startedValue: { label:"Running Value", direction:"READ",  usage:"Read from Running Register as running acknowledgment",     registerKey:"runningRegister" },
  endOkValue:   { label:"End OK Value",  direction:"READ",  usage:"Read from End OK Register when cycle completes OK",       registerKey:"endOkRegister" },
  endNgValue:   { label:"End NG Value",  direction:"READ",  usage:"Read from End NG Register when cycle completes NG",       registerKey:"endNgRegister" },
  resetValue:   { label:"Reset Value",   direction:"WRITE", usage:"Written to Reset Register to clear fault or reset state", registerKey:"resetRegister"  },
};

/* -- Design tokens ------------------------------------------- */
const T = {
  navy:       "#0f172a",
  navyMid:    "#1e293b",
  navyLight:  "#334155",
  slate:      "#475569",
  slateLight: "#64748b",
  border:     "#cbd5e1",
  borderLight:"#e2e8f0",
  bg:         "#f8fafc",
  bgCard:     "#ffffff",
  bgMuted:    "#f1f5f9",
  text:       "#0f172a",
  textSec:    "#334155",
  textMuted:  "#64748b",
  blue:       "#1d4ed8",
  blueMid:    "#2563eb",
  blueLight:  "#dbeafe",
  blueBorder: "#bfdbfe",
  green:      "#15803d",
  greenLight: "#dcfce7",
  greenBorder:"#86efac",
  red:        "#dc2626",
  redLight:   "#fee2e2",
  redBorder:  "#fca5a5",
  teal:       "#0f766e",
  tealLight:  "#ccfbf1",
  tealBorder: "#5eead4",
  amber:      "#b45309",
  amberLight: "#fef3c7",
  amberBorder:"#fcd34d",
  purple:     "#7c3aed",
  purpleLight:"#ede9fe",
  purpleBorder:"#c4b5fd",
};

const inp = {
  width:"100%", boxSizing:"border-box",
  height:36, padding:"0 10px",
  background:T.bgCard,
  border:`1px solid ${T.border}`,
  borderRadius:7,
  fontSize:13, color:T.text,
  outline:"none",
  transition:"border-color .15s, box-shadow .15s",
};

const Label = ({ children, required }) => (
  <p style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:T.textMuted, marginBottom:5, display:"flex", alignItems:"center", gap:3 }}>
    {children}{required && <span style={{ color:T.red }}>*</span>}
  </p>
);

const FieldInput = ({ value, onChange, placeholder, type="text", mono, readOnly, style:sx={}, ...rest }) => {
  const [focus, setFocus] = useState(false);
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} readOnly={readOnly}
      style={{ ...inp, fontFamily:mono?"ui-monospace, monospace":"inherit", background:readOnly?T.bgMuted:T.bgCard, boxShadow:focus?`0 0 0 3px ${T.blueLight}`:"none", borderColor:focus?T.blueMid:T.border, ...sx }}
      onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)} {...rest} />
  );
};

const FieldSelect = ({ value, onChange, children, mono, style:sx={} }) => {
  const [focus, setFocus] = useState(false);
  return (
    <select value={value} onChange={onChange}
      style={{ ...inp, fontFamily:mono?"ui-monospace, monospace":"inherit", boxShadow:focus?`0 0 0 3px ${T.blueLight}`:"none", borderColor:focus?T.blueMid:T.border, cursor:"pointer", ...sx }}
      onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}>
      {children}
    </select>
  );
};

/* Direction badge with icon */
const DirectionIcon = ({ direction, size=10 }) => {
  if (direction==="WRITE") return <ArrowDown size={size} />;
  if (direction==="BOTH")  return <ArrowDownUp size={size} />;
  return <ArrowUp size={size} />;
};

const ActionBadge = ({ action }) => {
  const isWrite = action==="WRITE";
  const isBoth  = action==="BOTH";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:9, fontWeight:800, letterSpacing:"0.07em", padding:"2px 7px", borderRadius:4, background:isWrite?T.blueLight:isBoth?T.tealLight:T.greenLight, color:isWrite?T.blue:isBoth?T.teal:T.green, border:`1px solid ${isWrite?T.blueBorder:isBoth?T.tealBorder:T.greenBorder}`, whiteSpace:"nowrap" }}>
      <DirectionIcon direction={action} size={9} />
      {action}
    </span>
  );
};

const Chip = ({ label, color="blue" }) => {
  const map = {
    blue:   { bg:T.blueLight,   text:T.blue,   border:T.blueBorder   },
    green:  { bg:T.greenLight,  text:T.green,  border:T.greenBorder  },
    red:    { bg:T.redLight,    text:T.red,    border:T.redBorder    },
    teal:   { bg:T.tealLight,   text:T.teal,   border:T.tealBorder   },
    amber:  { bg:T.amberLight,  text:T.amber,  border:T.amberBorder  },
    purple: { bg:T.purpleLight, text:T.purple, border:T.purpleBorder },
    gray:   { bg:T.bgMuted,     text:T.slate,  border:T.border       },
  };
  const c = map[color]||map.gray;
  return (
    <span style={{ fontSize:9, fontWeight:700, padding:"2px 8px", borderRadius:999, background:c.bg, color:c.text, border:`1px solid ${c.border}`, whiteSpace:"nowrap", letterSpacing:"0.05em" }}>
      {label}
    </span>
  );
};

/* Icon button with hover effect */
const IconBtn = ({ icon:Icon, title, onClick, color, hoverBg, hoverColor, hoverBorder }) => {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick} title={title}
      style={{ width:30, height:30, border:`1px solid ${hov?(hoverBorder||color||T.border):T.border}`, borderRadius:7, background:hov?(hoverBg||color+"18"):"transparent", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:hov?(hoverColor||color||T.textMuted):T.textMuted, transition:"all .12s" }}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
      <Icon size={13} />
    </button>
  );
};

/* ---- Bypass status badge ------------------------------------ */
const BypassBadge = ({ enabled, reason }) => (
  <div>
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:999, fontSize:10, fontWeight:700,
      background:enabled?T.amberLight:T.bgMuted, color:enabled?T.amber:T.textMuted,
      border:`1px solid ${enabled?T.amberBorder:T.border}` }}>
      {enabled ? <ShieldOff size={10} /> : <ShieldCheck size={10} />}
      {enabled ? "Bypassed" : "Normal"}
    </span>
    {enabled && reason && (
      <p style={{ fontSize:10, color:T.amber, margin:"3px 0 0", maxWidth:160, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }} title={reason}>
        {reason}
      </p>
    )}
  </div>
);

/* ---- Status badge ------------------------------------------- */
const StatusBadge = ({ status }) => {
  const isActive = status==="ACTIVE";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:999, fontSize:10, fontWeight:700,
      background:isActive?T.greenLight:T.bgMuted, color:isActive?T.green:T.textMuted,
      border:`1px solid ${isActive?T.greenBorder:T.border}` }}>
      {isActive
        ? <span style={{ width:5, height:5, borderRadius:"50%", background:T.green, animation:"pulse 2s infinite" }} />
        : <XCircle size={9} />}
      {isActive ? "Active" : "Offline"}
    </span>
  );
};

const modalOverlay = { position:"fixed", inset:0, zIndex:50, display:"flex", alignItems:"center", justifyContent:"center", padding:16, background:"rgba(15,23,42,0.65)", backdropFilter:"blur(4px)" };

/* ============================================================ */
/*  MAIN COMPONENT                                              */
/* ============================================================ */
const MachinePage = () => {
  const [machines, setMachines] = useState([]);
  const [plcRanges, setPlcRanges] = useState([]);
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

  /* ---- data load ------------------------------------------ */
  const loadData = useCallback(async () => {
    try {
      const [machineRows, rangeRows] = await Promise.all([machineApi.list(), plcConfigApi.listRanges().catch(()=>[])]);
      setMachines(machineRows||[]);
      setPlcRanges(rangeRows||[]);
    } catch { toast.error("Failed to load machine data"); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const rangeById = useMemo(() => plcRanges.reduce((acc,r)=>{ acc[r.id]=r; return acc; },{}), [plcRanges]);
  const normalizedProtocol = normalizeProtocol(formData.plcProtocol, "TCP_TEXT");
  const isModbus = normalizedProtocol==="MODBUS_TCP";
  const isSlmp   = normalizedProtocol==="SLMP";
  const usesRange = isModbus||isSlmp;

  const selectableRanges = useMemo(() => {
    const selectedIp = String(formData.plcIp||"").trim();
    const pool = plcRanges.filter(r=>String(r.status||"").toUpperCase()==="ACTIVE"&&(!usesRange||normalizeProtocol(r.plcProtocol,"MODBUS_TCP")===normalizedProtocol)&&(!selectedIp||String(r.plcIp||"").trim()===selectedIp));
    const map = new Map(pool.map(r=>[String(r.id),r]));
    const editRangeId = toNullableNumber(editingMachine?.plcRangeId||editingMachine?.plcConfig?.rangeId);
    if (editRangeId&&rangeById[editRangeId]) map.set(String(editRangeId),rangeById[editRangeId]);
    return Array.from(map.values());
  }, [plcRanges,editingMachine,formData.plcIp,normalizedProtocol,usesRange,rangeById]);

  const filteredMachines = useMemo(() => {
    const s = searchTerm.trim().toLowerCase();
    return machines.filter(m => {
      const ms = !s||[m.machineName,m.lineName,m.operationNo,m.plcIp].some(v=>String(v||"").toLowerCase().includes(s));
      const ml = lineFilter==="all"||m.lineName===lineFilter;
      const mst = statusFilter==="all"||m.status===statusFilter;
      return ms&&ml&&mst;
    }).sort((a,b)=>(Number(a.sequenceNo)||0)-(Number(b.sequenceNo)||0));
  }, [machines,searchTerm,lineFilter,statusFilter]);

  const lines = useMemo(() => [...new Set(machines.map(m=>m.lineName).filter(Boolean))].sort(), [machines]);

  const stats = useMemo(() => ({
    total: machines.length,
    active: machines.filter(m=>m.status==="ACTIVE").length,
    configured: machines.filter(m=>m.plcIp).length,
    bypassed: machines.filter(m=>Boolean(m.machineBypassEnabled)).length,
  }), [machines]);

  const handshakeRows = useMemo(
    () => syncStandardHandshakeRowsWithCore(formData?.plcConfig?.handshakeMap, formData?.plcConfig||{}),
    [formData?.plcConfig]
  );

  const registerConflicts = useMemo(() => {
    if (!usesRange) return [];
    const cfg = formData?.plcConfig||{};
    const auxiliaryEntries = getAuxiliaryRegisterEntries(formData);
    const handshakeEntries = getHandshakeRegisterEntries(cfg);
    const conflicts = [];
    const range = rangeById[formData?.plcRangeId];
    const selfOccupancy = new Map();
    for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
      const base = toWholeNumberOrNull(cfg[field.key]);
      if (base===null) continue;
      const words = expandRegisterWindow(base,field.key,normalizedProtocol);
      for (const word of words) {
        if (range&&(word<Number(range.rangeStart)||word>Number(range.rangeEnd))) { conflicts.push(`${field.label} uses R${word}, outside selected range R${range.rangeStart}-R${range.rangeEnd}.`); continue; }
        if (selfOccupancy.has(word)&&selfOccupancy.get(word)!==field.label) { const otherKey=selfOccupancy.get(word); const otherField=MACHINE_REGISTER_ROLE_FIELDS.find((f)=>f.key===otherKey); conflicts.push(`R${word} overlaps between ${otherField?.label||otherKey} and ${field.label}.`); }
        else { selfOccupancy.set(word,field.label); }
      }
    }
    for (const entry of auxiliaryEntries) {
      const words = expandRegisterWindow(entry.register,null,normalizedProtocol);
      for (const word of words) {
        if (range&&(word<Number(range.rangeStart)||word>Number(range.rangeEnd))) { conflicts.push(`${entry.label} uses R${word}, outside selected range R${range.rangeStart}-${range.rangeEnd}.`); continue; }
        if (selfOccupancy.has(word)&&selfOccupancy.get(word)!==entry.label) { conflicts.push(`R${word} overlaps between ${selfOccupancy.get(word)} and ${entry.label}.`); }
        else { selfOccupancy.set(word,entry.label); }
      }
    }
    const handshakeSignalSet = new Set();
    const handshakeExactSet = new Set();
    const handshakeRegisterGroups = new Map();
    const handshakePeerOccupancy = new Map();
    for (const entry of handshakeEntries) {
      if (!entry.signal) continue;
      const signalKey = entry.signal.toUpperCase();
      if (handshakeSignalSet.has(signalKey)) { conflicts.push(`Handshake signal "${entry.signal}" is duplicated.`); } else { handshakeSignalSet.add(signalKey); }
      const exactKey = `${entry.signal.toUpperCase()}|${entry.direction}|${entry.register??"NA"}|${entry.value??"NA"}`;
      if (handshakeExactSet.has(exactKey)) { conflicts.push(`Handshake row "${entry.signal}" is duplicated.`); } else { handshakeExactSet.add(exactKey); }
      if (entry.register===null) continue;
      const words = expandRegisterWindow(entry.register,null,normalizedProtocol);
      for (const word of words) {
        if (range&&(word<Number(range.rangeStart)||word>Number(range.rangeEnd))) { conflicts.push(`${entry.label} uses R${word}, outside selected range R${range.rangeStart}-${range.rangeEnd}.`); continue; }
        const groups = handshakeRegisterGroups.get(word)||new Set();
        groups.add(entry.group);
        handshakeRegisterGroups.set(word,groups);
        if (!handshakePeerOccupancy.has(word)) handshakePeerOccupancy.set(word,entry.label);
      }
    }
    handshakeRegisterGroups.forEach((groups,registerNo) => {
      if (groups.size>1) {
        conflicts.push(`Handshake register R${registerNo} overlaps across different signal groups.`);
      }
    });
    handshakePeerOccupancy.forEach((label,registerNo) => { if (!selfOccupancy.has(registerNo)) selfOccupancy.set(registerNo,label); });
    if (!formData?.plcRangeId) return [...new Set(conflicts)];
    const currentMachineId = Number(editingMachine?.id||0);
    const peerOccupied = new Map();
    for (const machine of machines) {
      if (Number(machine?.id||0)===currentMachineId) continue;
      if (Number(machine?.plcRangeId||machine?.plcConfig?.rangeId||0)!==Number(formData.plcRangeId)) continue;
      const peerProtocol = normalizeProtocol(machine?.plcProtocol,"MODBUS_TCP");
      const occupied = getMachineOccupiedRegisterWords(machine,peerProtocol);
      occupied.forEach((label,registerNo) => { peerOccupied.set(registerNo,`${machine.machineName||"Machine"} (${machine.operationNo||"-"}) - ${label}`); });
    }
    selfOccupancy.forEach((_label,word) => { if (peerOccupied.has(word)) conflicts.push(`R${word} conflicts with ${peerOccupied.get(word)}.`); });
    return [...new Set(conflicts)];
  }, [usesRange,formData?.plcConfig,formData?.plcSignalMap,formData?.spcConfig,formData?.plcRangeId,rangeById,normalizedProtocol,machines,editingMachine?.id]);

  const handshakeInputIssues = useMemo(() => {
    const issues = new Map();
    const cfg = formData?.plcConfig || {};
    const entries = getHandshakeRegisterEntries(cfg);
    if (entries.length === 0) {
      return issues;
    }

    const range = rangeById[formData?.plcRangeId];
    const coreAuxOccupancy = new Map();
    for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
      const registerNo = toWholeNumberOrNull(cfg?.[field.key]);
      if (registerNo === null) continue;
      if (!coreAuxOccupancy.has(registerNo)) {
        coreAuxOccupancy.set(registerNo, { label: field.label, key: field.key });
      }
    }
    getAuxiliaryRegisterEntries(formData).forEach((entry) => {
      const registerNo = toWholeNumberOrNull(entry.register);
      if (registerNo === null) return;
      if (!coreAuxOccupancy.has(registerNo)) {
        coreAuxOccupancy.set(registerNo, { label: entry.label || "Aux Register", key: null });
      }
    });

    const groupsByRegister = new Map();
    entries.forEach((entry) => {
      if (entry.register === null) return;
      const groups = groupsByRegister.get(entry.register) || new Set();
      groups.add(entry.group);
      groupsByRegister.set(entry.register, groups);
    });

    const peerOccupied = new Map();
    if (usesRange && formData?.plcRangeId) {
      const currentMachineId = Number(editingMachine?.id || 0);
      for (const machine of machines) {
        if (Number(machine?.id || 0) === currentMachineId) continue;
        if (Number(machine?.plcRangeId || machine?.plcConfig?.rangeId || 0) !== Number(formData.plcRangeId)) continue;
        const peerProtocol = normalizeProtocol(machine?.plcProtocol, "MODBUS_TCP");
        const occupied = getMachineOccupiedRegisterWords(machine, peerProtocol);
        occupied.forEach((label, registerNo) => {
          peerOccupied.set(registerNo, `${machine.machineName || "Machine"} (${machine.operationNo || "-"}) - ${label}`);
        });
      }
    }

    entries.forEach((entry, index) => {
      if (entry.register === null) return;
      const registerNo = entry.register;
      const rowIssues = [];

      if (range && (registerNo < Number(range.rangeStart) || registerNo > Number(range.rangeEnd))) {
        rowIssues.push(`R${registerNo} is outside selected range R${range.rangeStart}-R${range.rangeEnd}.`);
      }

      const groups = groupsByRegister.get(registerNo);
      if (groups && groups.size > 1) {
        rowIssues.push(`R${registerNo} is shared across different handshake groups.`);
      }

      const allowedCoreKey = HANDSHAKE_GROUP_CORE_KEY_MAP[entry.group];
      const allowedCoreRegister = allowedCoreKey ? toWholeNumberOrNull(cfg?.[allowedCoreKey]) : null;
      const ownCore = coreAuxOccupancy.get(registerNo);
      if (ownCore && registerNo !== allowedCoreRegister) {
        rowIssues.push(`R${registerNo} already mapped to ${ownCore.label}.`);
      }

      if (peerOccupied.has(registerNo)) {
        rowIssues.push(`R${registerNo} used by ${peerOccupied.get(registerNo)}.`);
      }

      if (rowIssues.length > 0) {
        issues.set(index, rowIssues[0]);
      }
    });

    return issues;
  }, [
    formData?.plcConfig,
    formData?.plcSignalMap,
    formData?.spcConfig,
    formData?.plcRangeId,
    rangeById,
    usesRange,
    machines,
    editingMachine?.id,
  ]);

  const activeTabIndex = useMemo(() => Math.max(FORM_TABS.findIndex((tab)=>tab.id===activeTab),0), [activeTab]);
  const isLastTab = activeTabIndex>=FORM_TABS.length-1;
  const goToTabByIndex = (nextIndex) => { if (nextIndex<0||nextIndex>=FORM_TABS.length) return; setActiveTab(FORM_TABS[nextIndex].id); };

  const validateCurrentTab = (tabId=activeTab) => {
    if (tabId==="general") {
      if (!String(formData.machineName||"").trim()) return "Machine name is required.";
      if (!String(formData.operationNo||"").trim()) return "Operation code is required.";
      if (!String(formData.sequenceNo||"").trim()) return "Sequence number is required.";
    }
    if (tabId==="network") {
      if (!String(formData.plcIp||"").trim()) return "PLC IP address is required.";
      if (usesRange&&!String(formData.plcRangeId||"").trim()) return "Select a PLC range before continuing.";
    }
    if (tabId==="tuning") {
      if (!String(formData?.plcConfig?.startRegister||"").trim()) return "Start register is required.";
      if (!String(formData?.plcConfig?.blockRegister||"").trim()) return "Block register is required.";
      if (!String(formData?.plcConfig?.runningRegister||"").trim()) return "Running register is required.";
      if (!String(formData?.plcConfig?.endOkRegister||"").trim()) return "End OK register is required.";
      if (!String(formData?.plcConfig?.endNgRegister||"").trim()) return "End NG register is required.";
      if (handshakeInputIssues.size>0) return Array.from(handshakeInputIssues.values())[0];
      if (registerConflicts.length>0) return registerConflicts[0];
    }
    return null;
  };

  const saveAndNext = () => {
    const err = validateCurrentTab(activeTab);
    if (err) { toast.error(err); return; }
    if (!isLastTab) { goToTabByIndex(activeTabIndex+1); toast.success(`Step saved. Continue with ${FORM_TABS[activeTabIndex+1].label}.`); }
  };
  const goPrevious = () => goToTabByIndex(activeTabIndex-1);

  const getVisibleTuningFields = useMemo(() => {
    const fieldsByKey = new Map(MACHINE_MODBUS_TUNING_FIELD_CONFIG.map((f)=>[f.key,f]));
    const fallbackKeys = Object.keys(TUNING_VALUE_HELP);
    fallbackKeys.forEach((key) => { if (fieldsByKey.has(key)) return; fieldsByKey.set(key,{ key, label:TUNING_VALUE_HELP[key]?.label||key, type:"number", required:true }); });
    return Array.from(fieldsByKey.values());
  }, []);

  const getHandshakeRangeBounds = () => {
    const range = rangeById[formData?.plcRangeId];
    if (!range) return null;
    return {
      start: Number(range.rangeStart),
      end: Number(range.rangeEnd),
    };
  };

  const getCoreRegisterOptions = (fieldKey) => {
    const range = rangeById[formData?.plcRangeId];
    if (!range) return [];
    const start = Number(range.rangeStart || 0);
    const end = Number(range.rangeEnd || 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
    const usedRegisters = new Set();
    machines.forEach((m) => {
      if (Number(m?.id || 0) === Number(editingMachine?.id || 0)) return;
      if (Number(m?.plcRangeId || m?.plcConfig?.rangeId || 0) !== Number(formData?.plcRangeId || 0)) return;
      const peerProtocol = normalizeProtocol(m?.plcProtocol, "MODBUS_TCP");
      getMachineOccupiedRegisterWords(m, peerProtocol).forEach((_label, word) => usedRegisters.add(word));
    });
    const ownUsed = getConfigOccupiedRegisters(formData?.plcConfig || {}, normalizedProtocol, fieldKey);
    ownUsed.forEach((word) => usedRegisters.add(word));
    getAuxiliaryRegisterEntries(formData).forEach((entry) => {
      expandRegisterWindow(entry.register, null, normalizedProtocol).forEach((word) => usedRegisters.add(word));
    });
    const currentValue = toWholeNumberOrNull(formData?.plcConfig?.[fieldKey]);
    const requiredWidth = getRegisterSpanWords(fieldKey, normalizedProtocol);
    const options = [];
    for (let r = start; r <= end; r += 1) {
      const words = Array.from({ length: requiredWidth }, (_, index) => r + index);
      const inRange = words.every((w) => w >= start && w <= end);
      const blocked = words.some((w) => usedRegisters.has(w));
      if ((!blocked && inRange) || currentValue === r) options.push(r);
    }
    return options;
  };

  const getHandshakeRegisterOptions = (rowIndex, rows = handshakeRows) => {
    const bounds = getHandshakeRangeBounds();
    if (!bounds) return [];
    const blocked = new Set();
    const currentMachineId = Number(editingMachine?.id || 0);
    for (const machine of machines) {
      if (Number(machine?.id || 0) === currentMachineId) continue;
      if (Number(machine?.plcRangeId || machine?.plcConfig?.rangeId || 0) !== Number(formData?.plcRangeId || 0)) continue;
      const peerProtocol = normalizeProtocol(machine?.plcProtocol, "MODBUS_TCP");
      const occupied = getMachineOccupiedRegisterWords(machine, peerProtocol);
      occupied.forEach((_label, registerNo) => blocked.add(registerNo));
    }
    const cfg = formData?.plcConfig || {};
    for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
      expandRegisterWindow(cfg?.[field.key], field.key, normalizedProtocol).forEach((word) => blocked.add(word));
    }
    getAuxiliaryRegisterEntries(formData).forEach((entry) => {
      expandRegisterWindow(entry.register, null, normalizedProtocol).forEach((word) => blocked.add(word));
    });
    const current = rows?.[rowIndex] || {};
    const currentGroup = getHandshakeSignalGroup(current.signal);
    rows.forEach((row, index) => {
      if (index === rowIndex) return;
      const registerNo = toWholeNumberOrNull(row?.register);
      if (registerNo === null) return;
      const group = getHandshakeSignalGroup(row?.signal);
      if (group === currentGroup) return;
      blocked.add(registerNo);
    });
    const currentRegister = toWholeNumberOrNull(current?.register);
    const options = [];
    for (let registerNo = bounds.start; registerNo <= bounds.end; registerNo += 1) {
      if (!blocked.has(registerNo) || registerNo === currentRegister) options.push(registerNo);
    }
    return options;
  };

  const buildHandshakeBlockedRegisters = (ignoreRowIndex = null, rows = handshakeRows, includeHandshakeRows = true) => {
    const blocked = new Set();

    const currentMachineId = Number(editingMachine?.id || 0);
    for (const machine of machines) {
      if (Number(machine?.id || 0) === currentMachineId) continue;
      if (Number(machine?.plcRangeId || machine?.plcConfig?.rangeId || 0) !== Number(formData?.plcRangeId || 0)) continue;
      const peerProtocol = normalizeProtocol(machine?.plcProtocol, "MODBUS_TCP");
      const occupied = getMachineOccupiedRegisterWords(machine, peerProtocol);
      occupied.forEach((_label, registerNo) => blocked.add(registerNo));
    }

    const cfg = formData?.plcConfig || {};
    for (const field of MACHINE_REGISTER_ROLE_FIELDS) {
      expandRegisterWindow(cfg?.[field.key], field.key, normalizedProtocol).forEach((word) => blocked.add(word));
    }
    getAuxiliaryRegisterEntries(formData).forEach((entry) => {
      expandRegisterWindow(entry.register, null, normalizedProtocol).forEach((word) => blocked.add(word));
    });

    if (includeHandshakeRows) {
      rows.forEach((row, index) => {
        if (ignoreRowIndex !== null && index === ignoreRowIndex) return;
        const registerNo = toWholeNumberOrNull(row?.register);
        if (registerNo === null) return;
        expandRegisterWindow(registerNo, null, normalizedProtocol).forEach((word) => blocked.add(word));
      });
    }

    return blocked;
  };

  const findNextFreeHandshakeRegister = (rowIndex, rows = handshakeRows) => {
    const bounds = getHandshakeRangeBounds();
    if (!bounds) return null;
    const blocked = buildHandshakeBlockedRegisters(rowIndex, rows, true);
    const current = toWholeNumberOrNull(rows?.[rowIndex]?.register);
    const searchStart = current === null ? bounds.start : Math.max(bounds.start, current + 1);

    for (let registerNo = searchStart; registerNo <= bounds.end; registerNo += 1) {
      if (!blocked.has(registerNo)) return registerNo;
    }
    for (let registerNo = bounds.start; registerNo < searchStart; registerNo += 1) {
      if (!blocked.has(registerNo)) return registerNo;
    }
    return null;
  };

  const autoAssignHandshakeRegister = (rowIndex) => {
    if (!usesRange || !String(formData?.plcRangeId || "").trim()) {
      toast.error("Select PLC range first to auto-assign register.");
      return;
    }
    const rows = normalizeHandshakeRows(formData?.plcConfig?.handshakeMap, formData?.plcConfig || {});
    const nextRegister = findNextFreeHandshakeRegister(rowIndex, rows);
    if (nextRegister === null) {
      toast.error("No free register found in selected range.");
      return;
    }
    const targetLabel = rows?.[rowIndex]?.signal || `Signal ${rowIndex + 1}`;
    rows[rowIndex] = { ...rows[rowIndex], register: String(nextRegister) };
    let nextCfg = { ...(formData?.plcConfig || {}) };
    nextCfg = applyStandardHandshakeRowToCoreCfg(nextCfg, rows[rowIndex]);
    const syncedRows = syncStandardHandshakeRowsWithCore(rows, nextCfg);
    setFormData((p) => ({
      ...p,
      plcConfig: { ...nextCfg, handshakeMap: syncedRows },
    }));
    toast.success(`${targetLabel}: assigned R${nextRegister}`);
  };

  const autoAssignAllHandshakeRegisters = () => {
    if (!usesRange || !String(formData?.plcRangeId || "").trim()) {
      toast.error("Select PLC range first to auto-assign registers.");
      return;
    }
    const bounds = getHandshakeRangeBounds();
    if (!bounds) {
      toast.error("Selected range not found.");
      return;
    }
    const rows = normalizeHandshakeRows(formData?.plcConfig?.handshakeMap, formData?.plcConfig || {});
    if (!rows.length) {
      toast.error("No handshake rows to assign.");
      return;
    }

    const blocked = buildHandshakeBlockedRegisters(null, [], false);
    const groupToRegister = new Map();
    let assignedCount = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const groupKey = getHandshakeSignalGroup(rows[index]?.signal);
      let picked = groupToRegister.get(groupKey) ?? null;
      if (picked === null) {
        for (let registerNo = bounds.start; registerNo <= bounds.end; registerNo += 1) {
          if (blocked.has(registerNo)) continue;
          picked = registerNo;
          break;
        }
        if (picked !== null) {
          groupToRegister.set(groupKey, picked);
          blocked.add(picked);
        }
      }
      if (picked === null) {
        toast.error(`No free register left for row ${index + 1}.`);
        return;
      }
      rows[index] = { ...rows[index], register: String(picked) };
      assignedCount += 1;
    }

    let nextCfg = { ...(formData?.plcConfig || {}) };
    rows.forEach((row) => {
      nextCfg = applyStandardHandshakeRowToCoreCfg(nextCfg, row);
    });
    const syncedRows = syncStandardHandshakeRowsWithCore(rows, nextCfg);
    setFormData((p) => ({
      ...p,
      plcConfig: { ...nextCfg, handshakeMap: syncedRows },
    }));
    toast.success(`Auto-assigned ${assignedCount} handshake registers.`);
  };

  const updateField = (key, value) => {
    if (key==="plcProtocol") {
      setFormData(prev=>({ ...prev,plcProtocol:String(value).toUpperCase(),plcRangeId:"",plcConfig:{ ...prev.plcConfig,rangeId:"",startRegister:"",statusRegister:"",blockRegister:"",runningRegister:"",endOkRegister:"",endNgRegister:"",partRegister:"",stationRegister:"",resetRegister:"",heartbeatRegister:"" } }));
      return;
    }
    setFormData(prev=>({ ...prev,[key]:value }));
  };
  const handshakeCoreSyncKeys = new Set([
    "startRegister",
    "blockRegister",
    "runningRegister",
    "endOkRegister",
    "endNgRegister",
    "resetRegister",
    "heartbeatRegister",
    "startValue",
    "blockValue",
    "startedValue",
    "endOkValue",
    "endNgValue",
    "resetValue",
  ]);
  const updateCfg = (k,v) => setFormData((p) => {
    const baseCfg = { ...(p.plcConfig||{}) };
    const nextCfg = { ...baseCfg, [k]:v };
    const rows = normalizeHandshakeRows(baseCfg.handshakeMap, baseCfg);
    if (handshakeCoreSyncKeys.has(k)) {
      nextCfg.handshakeMap = syncStandardHandshakeRowsWithCore(rows, nextCfg);
    } else {
      nextCfg.handshakeMap = rows;
    }
    return { ...p, plcConfig: nextCfg };
  });
  const addHandshakeRow = () => setFormData((p)=>({ ...p,plcConfig:{ ...(p.plcConfig||{}),handshakeMap:[...normalizeHandshakeRows(p?.plcConfig?.handshakeMap,p.plcConfig),createHandshakeRow({ signal:"New Signal" })] } }));
  const updateHandshakeRow = (index,key,value) => setFormData((p)=>{
    const currentCfg = { ...(p.plcConfig||{}) };
    const rows = [...normalizeHandshakeRows(currentCfg.handshakeMap, currentCfg)];
    rows[index] = { ...rows[index], [key]:value };
    const nextCfg = applyStandardHandshakeRowToCoreCfg(currentCfg, rows[index]);
    const syncedRows = syncStandardHandshakeRowsWithCore(rows, nextCfg);
    return { ...p, plcConfig:{ ...nextCfg, handshakeMap:syncedRows } };
  });
  const removeHandshakeRow = (index) => setFormData((p)=>{ const rows=[...normalizeHandshakeRows(p?.plcConfig?.handshakeMap,p.plcConfig)]; rows.splice(index,1); return { ...p,plcConfig:{ ...(p.plcConfig||{}),handshakeMap:rows.length>0?rows:buildDefaultHandshakeRows(p.plcConfig||{}) } }; });
  const syncHandshakeRowsFromRegisters = () => setFormData((p)=> {
    const currentCfg = { ...(p.plcConfig||{}) };
    const rows = syncStandardHandshakeRowsWithCore(normalizeHandshakeRows(currentCfg.handshakeMap,currentCfg), currentCfg);
    return { ...p, plcConfig:{ ...currentCfg, handshakeMap:rows } };
  });
  const addSignal = () => setFormData(p=>({ ...p,plcSignalMap:[...(p.plcSignalMap||[]),{ key:`SIG_${Date.now()}`,label:"New Register",register:"",description:"",direction:"PLC -> PC",device:p.plcProtocol==="SLMP"?(p.plcSlmpDevice||"D"):"" }] }));
  const updateSignal = (index,field,value) => setFormData(p=>{ const list=[...(p.plcSignalMap||[])]; list[index]={ ...list[index],[field]:value }; if (field==="label"&&(!list[index].key||list[index].key.startsWith("SIG_"))) list[index].key=value.replace(/\s+/g,"_").toUpperCase(); return { ...p,plcSignalMap:list }; });
  const removeSignal = (index) => setFormData(p=>{ const list=[...(p.plcSignalMap||[])]; list.splice(index,1); return { ...p,plcSignalMap:list }; });
  const applyStandardTuning = () => setFormData((p)=>({ ...p,plcConfig:(()=>{ const nextCfg={ ...(p.plcConfig||{}),startValue:"1",startedValue:"2",endOkValue:"3",endNgValue:"4",blockValue:"2",resetValue:"9" }; return { ...nextCfg,handshakeMap:syncStandardHandshakeRowsWithCore(normalizeHandshakeRows(nextCfg.handshakeMap,nextCfg),nextCfg) }; })() }));

  const copyPlcGuide = async () => {
    const cfg = formData.plcConfig||{};
    const syncedHandshakeRows = syncStandardHandshakeRowsWithCore(cfg.handshakeMap,cfg);
    const guide = [
      `MACHINE: ${formData.machineName||"-"} | LINE: ${formData.lineName||"-"} | OP: ${formData.operationNo||"-"}`,
      `IP: ${formData.plcIp||"-"}  PORT: ${formData.plcPort||"-"}`, "",
      "REGISTER ROLE MATRIX (RUNTIME)",
      ...MACHINE_REGISTER_ROLE_FIELDS.map((field)=>{ const io=REGISTER_IO_HELP[field.key]||{}; const reg=cfg?.[field.key]?`R${cfg[field.key]}`:"-"; const must=field.required?"Must":"Optional"; return `${field.label} | ${io.action||"-"} | ${io.flow||"-"} | ${reg} | ${must} | ${io.purpose||field.description||"-"}`; }),
      "", "HANDSHAKE COMMAND MATRIX",
      ...syncedHandshakeRows.map((row)=>{ const reg=row.register?`R${row.register}`:"-"; const val=row.value===""?"-":String(row.value); return `${row.signal||"Signal"} | ${row.direction||"READ"} | ${reg} | ${val} | ${row.meaning||"-"} | ${row.required?"Must":"Optional"}`; }),
      "", "NG / DUPLICATE FLOW",
      `On NG/duplicate, writes BLOCK value (${cfg.blockValue||2}) to Start Register (${cfg.startRegister||"-"})`,
    ].join("\n");
    try { await navigator.clipboard.writeText(guide); toast.success("PLC guide copied"); }
    catch { toast.error("Unable to copy PLC guide"); }
  };

  const downloadCurrentPlcSpec = () => {
    try {
      const reportConfig = loadReportConfig();
      const csv = buildMachinePlcSpecCsv(formData,reportConfig);
      const blob = new Blob(["\uFEFF",csv],{ type:"text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const base = String(formData.machineName||"machine").trim().replace(/[^\w-]+/g,"_");
      a.href=url; a.download=`${base||"machine"}_plc_register_spec.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      toast.success("PLC register spec downloaded");
    } catch { toast.error("Unable to generate PLC register spec"); }
  };

  const openCreate = () => { setFormData(createEmptyForm()); setEditingMachine(null); setActiveTab("general"); setShowModal(true); };
  const openEdit   = (m) => { setFormData(buildFormFromMachine(m)); setEditingMachine(m); setActiveTab("general"); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditingMachine(null); };

  /* FIX: bypass modal — correctly set bypassEnabled to what we WANT to apply */
  const openBypassModal = (machine) => {
    const currentlyEnabled = Boolean(machine?.machineBypassEnabled);
    setBypassModalMachine(machine);
    // bypassEnabled = what we want to set next (toggle from current)
    setBypassEnabled(!currentlyEnabled);
    setBypassReason(String(machine?.machineBypassReason||"").trim()||"MANUAL_BYPASS_FROM_MACHINE_PAGE");
  };
  const closeBypassModal = () => { setBypassModalMachine(null); setBypassEnabled(false); setBypassReason(""); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const err = validateCurrentTab(activeTab);
    if (err) { toast.error(err); return; }
    if (!isLastTab) { saveAndNext(); return; }
    setSaving(true);
    try {
      if (registerConflicts.length>0) { toast.error(registerConflicts[0]); return; }
      const payload = toSubmitPayload(formData);
      if (editingMachine) await machineApi.update(editingMachine.id,payload);
      else await machineApi.create(payload);
      toast.success(editingMachine?"Machine updated":"Machine created");
      closeModal(); await loadData();
    } catch(err) { toast.error(err.response?.data?.error||"Failed to save machine"); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    try { await machineApi.remove(deleteConfirmId); toast.success("Machine removed"); await loadData(); }
    catch { toast.error("Failed to remove machine"); }
    finally { setDeleteConfirmId(null); }
  };

  /* FIX: submitBypass — optimistic update uses actual returned value, fallback to what we sent */
  const submitBypass = async (e) => {
    e.preventDefault();
    if (!bypassModalMachine) return;
    try {
      setBypassing(true);
      const response = await traceabilityApi.bypass({
        machineId: bypassModalMachine.id,
        stationNo: bypassModalMachine.operationNo,
        reason: String(bypassReason||"").trim()||"MANUAL_BYPASS_FROM_MACHINE_PAGE",
        bypassEnabled,
      });
      // Use returned value if present, else fall back to what we intended
      const newBypassEnabled = response?.bypassEnabled !== undefined
        ? Boolean(response.bypassEnabled)
        : bypassEnabled;
      const newBypassReason = response?.bypassReason ?? (bypassEnabled ? bypassReason : null);

      toast.success(
        newBypassEnabled
          ? `Bypass enabled for ${bypassModalMachine.machineName}`
          : `Bypass disabled for ${bypassModalMachine.machineName}`
      );

      setMachines((prev) =>
        (prev||[]).map((row) =>
          Number(row?.id)===Number(bypassModalMachine.id)
            ? { ...row, machineBypassEnabled:newBypassEnabled, machineBypassReason:newBypassReason }
            : row
        )
      );
      await loadData();
      closeBypassModal();
    } catch(err) { toast.error(err.response?.data?.error||"Bypass failed"); }
    finally { setBypassing(false); }
  };

  /* -- STAT CARDS -- */
  const statCards = [
    { label:"Total Machines",  value:stats.total,     color:T.navy,  border:T.borderLight, icon:Database   },
    { label:"Active",          value:stats.active,    color:T.green, border:T.greenBorder, icon:CheckCircle2 },
    { label:"PLC Configured",  value:stats.configured,color:T.blue,  border:T.blueBorder,  icon:Network    },
    { label:"Bypassed",        value:stats.bypassed,  color:T.amber, border:T.amberBorder, icon:ShieldOff  },
  ];

  /* ========================================================= */
  /*  RENDER                                                    */
  /* ========================================================= */
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
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px,1fr))", gap:12 }}>
        {statCards.map((s) => {
          const IC = s.icon;
          return (
            <div key={s.label} style={{ background:T.bgCard, border:`1px solid ${s.border}`, borderRadius:12, padding:"16px 18px", borderLeft:`3px solid ${s.color}`, display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <p style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:T.textMuted, margin:0 }}>{s.label}</p>
                <IC size={14} color={s.color} />
              </div>
              <p style={{ fontSize:26, fontWeight:800, color:s.color, fontFamily:"ui-monospace, monospace", lineHeight:1, margin:0 }}>{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
        <div style={{ position:"relative", flex:1, minWidth:220 }}>
          <Search size={14} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:T.textMuted }} />
          <input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Search by name, line, IP or operation..."
            style={{ ...inp, height:38, paddingLeft:36, width:"100%", boxSizing:"border-box" }} />
        </div>
        <FieldSelect value={lineFilter} onChange={e=>setLineFilter(e.target.value)} style={{ width:160 }}>
          <option value="all">All Lines</option>
          {lines.map(l=><option key={l} value={l}>{l}</option>)}
        </FieldSelect>
        <FieldSelect value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{ width:140 }}>
          <option value="all">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </FieldSelect>
      </div>

      {/* Table */}
      <div style={{ background:T.bgCard, border:`1px solid ${T.borderLight}`, borderRadius:14, overflow:"hidden" }}>
        <div style={{ padding:"14px 20px", borderBottom:`1px solid ${T.borderLight}`, background:T.bgMuted, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <Database size={14} color={T.blue} />
            <p style={{ fontSize:11, fontWeight:700, color:T.text, textTransform:"uppercase", letterSpacing:"0.07em", margin:0 }}>Machine Registry</p>
          </div>
          <span style={{ fontSize:11, color:T.textMuted, background:T.bg, border:`1px solid ${T.border}`, padding:"3px 10px", borderRadius:6 }}>
            {filteredMachines.length} machine{filteredMachines.length!==1?"s":""}
          </span>
        </div>

        {filteredMachines.length===0 ? (
          <div style={{ padding:"60px 24px", textAlign:"center", color:T.textMuted }}>
            <Database size={36} style={{ margin:"0 auto 12px", opacity:0.2 }} />
            <p style={{ fontWeight:600, fontSize:13 }}>No machines found</p>
            <p style={{ fontSize:12, marginTop:4, opacity:0.6 }}>Try adjusting your search or filters</p>
          </div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:T.bgMuted, borderBottom:`1px solid ${T.borderLight}` }}>
                  {["Seq","Machine","Line","Operation","PLC / Protocol","Range","Target","Status","Bypass","Actions"].map(h=>(
                    <th key={h} style={{ padding:"10px 16px", textAlign:h==="Actions"?"right":"left", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.09em", color:T.textMuted, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMachines.map((m, idx) => {
                  const range = rangeById[m.plcRangeId||m.plcConfig?.rangeId];
                  const isBypassEnabled = Boolean(m.machineBypassEnabled);
                  return (
                    <tr key={m.id} style={{ borderBottom:`1px solid ${T.borderLight}`, background:idx%2===1?T.bgMuted:T.bgCard, transition:"background .1s" }}
                      onMouseEnter={e=>e.currentTarget.style.background=T.blueLight+"55"}
                      onMouseLeave={e=>e.currentTarget.style.background=idx%2===1?T.bgMuted:T.bgCard}>
                      <td style={{ padding:"12px 16px", fontFamily:"ui-monospace,monospace", fontWeight:700, color:T.textMuted, fontSize:12 }}>{String(m.sequenceNo||0).padStart(2,"0")}</td>
                      <td style={{ padding:"12px 16px" }}>
                        <p style={{ fontWeight:700, color:T.text, margin:0 }}>{m.machineName}</p>
                      </td>
                      <td style={{ padding:"12px 16px", color:T.textSec }}>{m.lineName||"-"}</td>
                      <td style={{ padding:"12px 16px" }}>
                        <span style={{ fontFamily:"ui-monospace,monospace", color:T.blue, fontWeight:700 }}>{m.operationNo||"-"}</span>
                      </td>
                      <td style={{ padding:"12px 16px" }}>
                        <p style={{ fontFamily:"ui-monospace,monospace", fontSize:12, color:T.blue, margin:0 }}>{m.plcIp||"Not set"}{m.plcPort?`:${m.plcPort}`:""}</p>
                        <p style={{ fontSize:10, color:T.textMuted, margin:"2px 0 0", textTransform:"uppercase" }}>{m.plcProtocol||"-"}</p>
                      </td>
                      <td style={{ padding:"12px 16px" }}>
                        {range ? (
                          <span style={{ padding:"2px 8px", background:T.blueLight, border:`1px solid ${T.blueBorder}`, borderRadius:4, fontSize:11, fontFamily:"ui-monospace,monospace", color:T.blue, fontWeight:600 }}>
                            R{range.rangeStart}-R{range.rangeEnd}
                          </span>
                        ) : <span style={{ color:T.textMuted, fontSize:12 }}>-</span>}
                      </td>
                      <td style={{ padding:"12px 16px" }}>
                        <p style={{ fontWeight:700, color:T.text, margin:0 }}>{m.dailyTargetQty||0}</p>
                        <p style={{ fontSize:10, color:T.textMuted, margin:"2px 0 0" }}>CT {Number(m.cycleTimeSec||0)}s / LT {Number(m.loadingTimeSec||0)}s</p>
                      </td>
                      <td style={{ padding:"12px 16px" }}><StatusBadge status={m.status} /></td>
                      <td style={{ padding:"12px 16px" }}>
                        <BypassBadge enabled={isBypassEnabled} reason={m.machineBypassReason} />
                      </td>
                      <td style={{ padding:"12px 16px", textAlign:"right" }}>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:4 }}>
                          <IconBtn icon={Eye}    title="View Config" onClick={()=>setViewMachine(m)}   color={T.blue}   hoverBg={T.blueLight}  hoverColor={T.blue}  hoverBorder={T.blueBorder} />
                          <IconBtn icon={isBypassEnabled?ShieldCheck:ShieldOff} title={isBypassEnabled?"Disable Bypass":"Enable Bypass"} onClick={()=>openBypassModal(m)} color={T.amber} hoverBg={T.amberLight} hoverColor={T.amber} hoverBorder={T.amberBorder} />
                          <IconBtn icon={Edit}   title="Edit"        onClick={()=>openEdit(m)}          color={T.navyMid} hoverBg={T.bgMuted}   hoverColor={T.navy}  hoverBorder={T.navyLight} />
                          <IconBtn icon={Trash2} title="Delete"      onClick={()=>setDeleteConfirmId(m.id)} color={T.red} hoverBg={T.redLight} hoverColor={T.red}   hoverBorder={T.redBorder} />
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

      {/* ====================================================== */}
      {/* ADD / EDIT MODAL                                        */}
      {/* ====================================================== */}
      {showModal && (
        <div style={modalOverlay}>
          <div style={{ position:"absolute", inset:0 }} onClick={closeModal} />
          <div style={{ position:"relative", width:"100%", maxWidth:880, background:T.bgCard, border:`1px solid ${T.borderLight}`, borderRadius:16, overflow:"hidden", display:"flex", flexDirection:"column", maxHeight:"94vh", boxShadow:"0 24px 60px rgba(15,23,42,.22)" }}>
            <div style={{ height:3, background:`linear-gradient(90deg, ${T.navy}, ${T.blue})` }} />
            <div style={{ padding:"18px 24px", borderBottom:`1px solid ${T.borderLight}`, background:T.bgCard, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:40, height:40, borderRadius:10, background:T.blueLight, border:`1px solid ${T.blueBorder}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Cpu size={18} color={T.blue} />
                </div>
                <div>
                  <h2 style={{ fontWeight:700, color:T.text, margin:0, fontSize:15 }}>{editingMachine?"Edit Machine":"Add New Machine"}</h2>
                  <p style={{ fontSize:11, color:T.textMuted, margin:"2px 0 0" }}>{editingMachine?`Machine ID: ${editingMachine.id}`:"Fill in the details to register a new machine"}</p>
                </div>
              </div>
              <button onClick={closeModal} style={{ width:32, height:32, border:`1px solid ${T.border}`, borderRadius:8, background:"transparent", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:T.textMuted }}
                onMouseEnter={e=>e.currentTarget.style.background=T.bgMuted} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <X size={16} />
              </button>
            </div>

            {/* Tabs */}
            <div style={{ padding:"0 24px", borderBottom:`1px solid ${T.borderLight}`, background:T.bgMuted, display:"flex", gap:0 }}>
              {FORM_TABS.map(tab => {
                const active = activeTab===tab.id;
                const TI = tab.icon;
                return (
                  <button key={tab.id} type="button" onClick={()=>setActiveTab(tab.id)}
                    style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"12px 14px", border:"none", borderBottom:`2px solid ${active?T.blue:"transparent"}`, background:"transparent", color:active?T.blue:T.textMuted, fontSize:12, fontWeight:active?700:600, cursor:"pointer", whiteSpace:"nowrap", transition:"all .15s" }}>
                    <TI size={13} />{tab.label}
                  </button>
                );
              })}
            </div>

            {/* Form body */}
            <form id="machine-form" onSubmit={handleSubmit} style={{ flex:1, overflowY:"auto", padding:24, background:T.bg }}>

              {/* GENERAL */}
              {activeTab==="general" && (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                  <div style={{ gridColumn:"1 / -1" }}>
                    <Label required>Machine Name</Label>
                    <FieldInput required value={formData.machineName} onChange={e=>updateField("machineName",e.target.value)} placeholder="e.g. OP-010 Press" />
                  </div>
                  <div><Label>Line / Department</Label><FieldInput value={formData.lineName} onChange={e=>updateField("lineName",e.target.value)} placeholder="Assembly Line A" /></div>
                  <div><Label>Status</Label><FieldSelect value={formData.status} onChange={e=>updateField("status",e.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></FieldSelect></div>
                  <div><Label>Sequence No</Label><FieldInput type="number" value={formData.sequenceNo} onChange={e=>updateField("sequenceNo",e.target.value)} placeholder="1" mono /></div>
                  <div>
                    <Label>Operation Codes (Multiple)</Label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <FieldInput 
                        value={formData.operationNo} 
                        onChange={e=>updateField("operationNo", e.target.value.toUpperCase())} 
                        placeholder="e.g. OP010, OP020, OP030" 
                        mono 
                      />
                      <p style={{ fontSize: 10, color: T.textMuted, margin: 0 }}>
                        Enter multiple operation codes separated by commas for shared machines.
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {(formData.operationNo || "").split(/[,\s]+/).filter(Boolean).map(op => (
                          <Chip key={op} label={op} color="blue" />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div><Label>Daily Target</Label><FieldInput type="number" value={formData.dailyTargetQty} onChange={e=>updateField("dailyTargetQty",e.target.value)} placeholder="480" mono /></div>
                  <div><Label>Cycle Time (sec)</Label><FieldInput type="number" value={formData.cycleTimeSec} onChange={e=>updateField("cycleTimeSec",e.target.value)} placeholder="45" mono /></div>
                  <div><Label>Loading Time (sec)</Label><FieldInput type="number" value={formData.loadingTimeSec} onChange={e=>updateField("loadingTimeSec",e.target.value)} placeholder="15" mono /></div>
                </div>
              )}

              {/* NETWORK */}
              {activeTab==="network" && (
                <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
                  <div>
                    <Label>PLC Protocol</Label>
                    <FieldSelect value={formData.plcProtocol} onChange={e=>updateField("plcProtocol",e.target.value)}>
                      <option value="TCP_TEXT">Generic TCP Text</option>
                      <option value="MODBUS_TCP">Modbus TCP</option>
                      <option value="SLMP">SLMP - Mitsubishi</option>
                    </FieldSelect>
                  </div>
                  {isSlmp && (
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                      <div>
                        <Label>SLMP Device Family</Label>
                        <FieldInput value={formData.plcSlmpDevice} onChange={e=>updateField("plcSlmpDevice",String(e.target.value||"").toUpperCase())} placeholder="D" mono />
                        <p style={{ fontSize:10, color:T.textMuted, marginTop:5 }}>Example: D, W, R - must match PLC memory device type.</p>
                      </div>
                      <div>
                        <Label>SLMP Frame Mode</Label>
                        <FieldSelect value={formData.plcSlmpFrameMode} onChange={e=>updateField("plcSlmpFrameMode",String(e.target.value||"AUTO").toUpperCase())} mono>
                          <option value="AUTO">AUTO (ASCII then Binary)</option>
                          <option value="ASCII">ASCII</option>
                          <option value="BINARY">BINARY</option>
                        </FieldSelect>
                        <p style={{ fontSize:10, color:T.textMuted, marginTop:5 }}>Use ASCII if PLC Ethernet open setting is configured for ASCII MC/SLMP.</p>
                      </div>
                    </div>
                  )}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                    <div>
                      <Label required>PLC IP Address</Label>
                      <FieldSelect value={formData.plcIp} onChange={e=>{ const newIp=e.target.value; updateField("plcIp",newIp); const matching=plcRanges.find(r=>String(r.plcIp).trim()===newIp); if (matching&&matching.plcPort) updateField("plcPort",String(matching.plcPort)); }} mono>
                        <option value="">- Select IP Address -</option>
                        {[...new Set(plcRanges.map(r=>String(r.plcIp).trim()).filter(Boolean))].map(ip=><option key={ip} value={ip}>{ip}</option>)}
                      </FieldSelect>
                    </div>
                    <div><Label>Port</Label><FieldInput type="number" value={formData.plcPort} onChange={e=>updateField("plcPort",e.target.value)} placeholder="502" mono /></div>
                  </div>
                  {usesRange && (
                    <div style={{ padding:16, background:T.blueLight+"55", border:`1px solid ${T.blueBorder}`, borderRadius:10 }}>
                      <Label>PLC Register Block (Range)</Label>
                      <FieldSelect value={formData.plcRangeId} onChange={e=>updateField("plcRangeId",e.target.value)}>
                        <option value="">- Select PLC Range -</option>
                        {selectableRanges.map(r=><option key={r.id} value={r.id}>R{r.rangeStart}-R{r.rangeEnd} ({r.plcIp})</option>)}
                      </FieldSelect>
                      {formData.plcRangeId&&rangeById[formData.plcRangeId]&&(
                        <div style={{ marginTop:10, padding:"10px 12px", background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:8, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, fontSize:12 }}>
                          <div><span style={{ color:T.textMuted }}>Start: </span><span style={{ fontFamily:"ui-monospace,monospace", fontWeight:700, color:T.blue }}>R{rangeById[formData.plcRangeId].rangeStart}</span></div>
                          <div><span style={{ color:T.textMuted }}>End: </span><span style={{ fontFamily:"ui-monospace,monospace", fontWeight:700, color:T.blue }}>R{rangeById[formData.plcRangeId].rangeEnd}</span></div>
                          <div><span style={{ color:T.textMuted }}>IP: </span><span style={{ fontFamily:"ui-monospace,monospace", color:T.blue }}>{rangeById[formData.plcRangeId].plcIp}</span></div>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ padding:"12px 14px", background:T.bgMuted, border:`1px solid ${T.border}`, borderRadius:9, display:"flex", alignItems:"flex-start", gap:10 }}>
                    <Info size={14} color={T.textMuted} style={{ flexShrink:0, marginTop:1 }} />
                    <p style={{ fontSize:12, color:T.textSec, lineHeight:1.6, margin:0 }}>
                      Modbus TCP default port: <code style={{ fontFamily:"ui-monospace,monospace", fontWeight:700, color:T.blue }}>502</code>. SLMP common ports: <code style={{ fontFamily:"ui-monospace,monospace", fontWeight:700, color:T.blue }}>5000 / 5006 / 1000</code>. Generic TCP scanners: <code style={{ fontFamily:"ui-monospace,monospace", fontWeight:700, color:T.blue }}>9001</code>.
                    </p>
                  </div>
                </div>
              )}

              {/* REGISTERS */}
              {activeTab==="registers" && (
                <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
                  {!formData.plcRangeId ? (
                    <div style={{ padding:"60px 24px", border:`2px dashed ${T.border}`, borderRadius:12, textAlign:"center", color:T.textMuted }}>
                      <Network size={28} style={{ margin:"0 auto 12px", opacity:0.25 }} />
                      <p style={{ fontWeight:600, fontSize:13, marginBottom:4, color:T.textSec }}>Select a PLC range first</p>
                      <p style={{ fontSize:12 }}>Go to the "Network & PLC" tab and assign a register block</p>
                    </div>
                  ) : (
                    <>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px,1fr))", gap:12 }}>
                        {MACHINE_REGISTER_ROLE_FIELDS.map(field => {
                          const range = rangeById[formData.plcRangeId];
                          const start = range?.rangeStart||0;
                          const end   = range?.rangeEnd||0;
                          const usedRegisters = new Set();
                          machines.forEach(m => {
                            if (m.id===editingMachine?.id) return;
                            if (Number(m.plcRangeId)!==Number(formData.plcRangeId)) return;
                            const pp = normalizeProtocol(m?.plcProtocol,"MODBUS_TCP");
                            getMachineOccupiedRegisterWords(m,pp).forEach((_label,word)=>usedRegisters.add(word));
                          });
                          const ownUsed = getConfigOccupiedRegisters(formData.plcConfig||{},normalizedProtocol,field.key);
                          ownUsed.forEach((word)=>usedRegisters.add(word));
                          getAuxiliaryRegisterEntries(formData).forEach((entry)=>{ expandRegisterWindow(entry.register,null,normalizedProtocol).forEach((word)=>usedRegisters.add(word)); });
                          const options = [];
                          const currentValue = toWholeNumberOrNull(formData.plcConfig?.[field.key]);
                          const requiredWidth = getRegisterSpanWords(field.key,normalizedProtocol);
                          for (let r=start; r<=end; r++) {
                            const words = Array.from({ length:requiredWidth },(_,index)=>r+index);
                            const inRange = words.every((w)=>w>=start&&w<=end);
                            const blocked = words.some((w)=>usedRegisters.has(w));
                            if ((!blocked&&inRange)||currentValue===r) options.push(r);
                          }
                          const ioHelp = REGISTER_IO_HELP[field.key]||null;
                          return (
                            <div key={field.key} style={{ background:T.bgCard, border:`1px solid ${T.borderLight}`, borderRadius:10, padding:14 }}>
                              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                                <p style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", color:T.textMuted, margin:0 }}>{field.label}</p>
                                {ioHelp && <ActionBadge action={ioHelp.action} />}
                              </div>
                              <FieldSelect required={Boolean(field.required)} value={formData.plcConfig?.[field.key]??""} onChange={e=>updateCfg(field.key,e.target.value)} mono>
                                <option value="">- Select -</option>
                                {options.map(o=><option key={o} value={o}>R{o}</option>)}
                              </FieldSelect>
                              {ioHelp && <p style={{ fontSize:10, color:T.textMuted, marginTop:6, lineHeight:1.4 }}>{ioHelp.flow}  |  {ioHelp.purpose}</p>}
                              {isSlmp&&getRegisterSpanWords(field.key,normalizedProtocol)>1&&<p style={{ fontSize:9, color:T.textMuted, marginTop:4 }}>Uses 2 words: Rn and Rn+1</p>}
                              {range&&<p style={{ fontSize:9, color:T.textMuted, opacity:0.6, marginTop:4 }}>Range: R{range.rangeStart}-R{range.rangeEnd}</p>}
                            </div>
                          );
                        })}
                      </div>

                      {/* Summary table */}
                      <div style={{ background:T.bgCard, border:`1px solid ${T.borderLight}`, borderRadius:10, overflow:"hidden" }}>
                        <div style={{ padding:"10px 14px", background:T.bgMuted, borderBottom:`1px solid ${T.borderLight}` }}>
                          <p style={{ fontSize:11, fontWeight:700, color:T.text, margin:0, textTransform:"uppercase", letterSpacing:"0.07em" }}>Register Summary</p>
                        </div>
                        <div style={{ overflowX:"auto" }}>
                          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                            <thead>
                              <tr style={{ background:T.bgMuted, borderBottom:`1px solid ${T.borderLight}` }}>
                                {["Role","Action","Flow","Register","Required","Purpose"].map(h=>(
                                  <th key={h} style={{ padding:"8px 12px", textAlign:"left", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.09em", color:T.textMuted }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {MACHINE_REGISTER_ROLE_FIELDS.map((field,i)=>{
                                const ioHelp = REGISTER_IO_HELP[field.key]||{};
                                const reg = formData.plcConfig?.[field.key];
                                return (
                                  <tr key={field.key} style={{ borderBottom:`1px solid ${T.borderLight}`, background:i%2===1?T.bgMuted:T.bgCard }}>
                                    <td style={{ padding:"9px 12px", fontWeight:600, color:T.text }}>{field.label}</td>
                                    <td style={{ padding:"9px 12px" }}>{ioHelp.action?<ActionBadge action={ioHelp.action} />:"-"}</td>
                                    <td style={{ padding:"9px 12px", color:T.textSec }}>{ioHelp.flow||"-"}</td>
                                    <td style={{ padding:"9px 12px", fontFamily:"ui-monospace,monospace", fontWeight:700, color:reg?T.blue:T.textMuted }}>{reg?`R${reg}`:"-"}</td>
                                    <td style={{ padding:"9px 12px" }}><Chip label={field.required?"Must":"Optional"} color={field.required?"blue":"gray"} /></td>
                                    <td style={{ padding:"9px 12px", color:T.textSec, fontSize:11 }}>{ioHelp.purpose||"-"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div style={{ padding:"10px 14px", background:T.greenLight, border:`1px solid ${T.greenBorder}`, borderRadius:8, display:"flex", alignItems:"flex-start", gap:10 }}>
                        <Activity size={14} color={T.green} style={{ flexShrink:0, marginTop:1 }} />
                        <p style={{ fontSize:12, color:T.textSec, margin:0, lineHeight:1.5 }}>Registers already used by other machines on this block are filtered out to prevent collision.</p>
                      </div>
                      {registerConflicts.length>0 && (
                        <div style={{ padding:"10px 14px", background:T.redLight, border:`1px solid ${T.redBorder}`, borderRadius:8, display:"flex", alignItems:"flex-start", gap:10 }}>
                          <AlertTriangle size={14} color={T.red} style={{ flexShrink:0, marginTop:1 }} />
                          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                            <p style={{ fontSize:12, color:T.textSec, margin:0 }}>Resolve register conflicts before saving.</p>
                            {registerConflicts.slice(0,4).map((item)=>(
                              <p key={item} style={{ fontSize:11, color:T.red, margin:0, lineHeight:1.4 }}>{item}</p>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* =============================================== */}
              {/* TUNING — Flexible per-signal value editor        */}
              {/* =============================================== */}
              {activeTab==="tuning" && (
                <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
                  {/* Action bar */}
                  <div style={{ padding:"12px 14px", background:T.blueLight+"55", border:`1px solid ${T.blueBorder}`, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
                    <p style={{ fontSize:12, color:T.textSec, margin:0 }}>Configure handshake mapping. Standard rows stay linked with Registers tab so PLC read/write always matches runtime mapping.</p>
                    <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                      {[
                        { label:"+ Add Signal Row",        onClick:addHandshakeRow,                color:T.green,   border:T.greenBorder  },
                        { label:"Auto Assign All",         onClick:autoAssignAllHandshakeRegisters, color:T.teal,    border:T.tealBorder   },
                        { label:"Reset From Registers",    onClick:syncHandshakeRowsFromRegisters, color:T.slate,   border:T.border       },
                        { label:"Apply Standard 1/2/3/4",  onClick:applyStandardTuning,           color:T.blue,    border:T.blueBorder   },
                        { label:"Copy PLC Guide",          onClick:copyPlcGuide,                  color:T.navyMid, border:T.navyLight    },
                      ].map(({ label,onClick,color,border })=>(
                        <button key={label} type="button" onClick={onClick}
                          style={{ padding:"6px 12px", fontSize:11, fontWeight:700, borderRadius:7, border:`1px solid ${border}`, color, background:"transparent", cursor:"pointer", transition:"background .12s" }}
                          onMouseEnter={e=>e.currentTarget.style.background=color+"14"}
                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Per-signal handshake map — enhanced */}
                  <div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                      <p style={{ fontSize:11, fontWeight:700, color:T.text, textTransform:"uppercase", letterSpacing:"0.07em", margin:0 }}>
                        Per-Signal Handshake Map
                      </p>
                      <span style={{ fontSize:10, color:T.textMuted, background:T.bgMuted, border:`1px solid ${T.border}`, padding:"2px 8px", borderRadius:6 }}>
                        {handshakeRows.length} signal{handshakeRows.length!==1?"s":""}
                      </span>
                    </div>

                    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                      {handshakeRows.map((row, index) => {
                        const isWrite = row.direction==="WRITE";
                        const isBoth  = row.direction==="BOTH";
                        const isStandardRow = isStandardHandshakeSignal(row.signal);
                        const accentColor = isWrite?T.blue:isBoth?T.teal:T.green;
                        const accentBg    = isWrite?T.blueLight:isBoth?T.tealLight:T.greenLight;
                        const accentBorder= isWrite?T.blueBorder:isBoth?T.tealBorder:T.greenBorder;
                        const registerIssue = handshakeInputIssues.get(index);
                        const registerOptions = getHandshakeRegisterOptions(index, handshakeRows);
                        return (
                          <div key={row.id||`${row.signal}-${index}`}
                            style={{ background:T.bgCard, border:`1px solid ${T.borderLight}`, borderRadius:10, overflow:"hidden" }}>
                            {/* Row header — color accent left bar */}
                            <div style={{ display:"flex", alignItems:"center", gap:0, padding:"8px 12px 8px 0", borderBottom:`1px solid ${T.borderLight}`, background:T.bgMuted }}>
                              {/* left color accent bar */}
                              <div style={{ width:4, alignSelf:"stretch", background:accentColor, borderRadius:"0 0 0 0", flexShrink:0, marginRight:12 }} />
                              <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, flexWrap:"wrap" }}>
                                <Hash size={12} color={T.textMuted} />
                                <span style={{ fontSize:11, fontWeight:700, color:T.text }}>{row.signal||`Signal ${index+1}`}</span>
                                {isStandardRow && (
                                  <span style={{ display:"inline-flex", alignItems:"center", fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:4, background:T.bgMuted, color:T.textMuted, border:`1px solid ${T.border}` }}>
                                    Linked
                                  </span>
                                )}
                                <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:9, fontWeight:700, padding:"2px 7px", borderRadius:4, background:accentBg, color:accentColor, border:`1px solid ${accentBorder}` }}>
                                  <DirectionIcon direction={row.direction} size={9} />
                                  {row.direction}
                                </span>
                                {row.register && (
                                  <span style={{ fontFamily:"ui-monospace,monospace", fontSize:10, color:T.blue, fontWeight:700, background:T.blueLight, border:`1px solid ${T.blueBorder}`, borderRadius:4, padding:"1px 6px" }}>
                                    R{row.register}
                                  </span>
                                )}
                                {row.value!==undefined&&row.value!==""&&(
                                  <span style={{ fontFamily:"ui-monospace,monospace", fontSize:10, color:T.navy, fontWeight:700 }}>
                                    = {row.value}
                                  </span>
                                )}
                              </div>
                              <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:"auto", paddingRight:4 }}>
                                <label style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:10, color:T.textMuted, cursor:"pointer" }}>
                                  <input type="checkbox" checked={row.required!==false} onChange={e=>updateHandshakeRow(index,"required",e.target.checked)} style={{ accentColor:T.blue }} />
                                  Required
                                </label>
                                <button
                                  type="button"
                                  onClick={() => autoAssignHandshakeRegister(index)}
                                  title="Auto assign free register"
                                  style={{ height:26, border:`1px solid ${T.tealBorder}`, borderRadius:6, background:T.tealLight, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:T.teal, padding:"0 8px", fontSize:10, fontWeight:700 }}
                                >
                                  Auto
                                </button>
                                <button type="button" onClick={()=>removeHandshakeRow(index)}
                                  disabled={isStandardRow}
                                  title={isStandardRow ? "Standard signal cannot be removed" : "Remove signal"}
                                  style={{ width:26, height:26, border:`1px solid ${T.redBorder}`, borderRadius:6, background:isStandardRow?T.bgMuted:T.redLight, display:"flex", alignItems:"center", justifyContent:"center", cursor:isStandardRow?"not-allowed":"pointer", color:isStandardRow?T.textMuted:T.red, opacity:isStandardRow?0.7:1 }}>
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>

                            {/* Row fields — individual per-register inputs */}
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 100px 120px 90px 1fr", gap:10, padding:"12px 14px", alignItems:"end" }}>
                              <div>
                                <Label>Signal Name</Label>
                                <FieldInput value={row.signal||""} onChange={e=>updateHandshakeRow(index,"signal",e.target.value)} placeholder="e.g. Start, End OK" readOnly={isStandardRow} style={isStandardRow ? { background:T.bgMuted, color:T.textMuted, cursor:"not-allowed" } : {}} />
                              </div>
                              <div>
                                <Label>Direction</Label>
                                <FieldSelect value={row.direction||"READ"} onChange={e=>updateHandshakeRow(index,"direction",e.target.value)} disabled={isStandardRow} style={isStandardRow ? { background:T.bgMuted, color:T.textMuted, cursor:"not-allowed" } : {}}>
                                  <option value="READ">READ</option>
                                  <option value="WRITE">WRITE</option>
                                  <option value="BOTH">BOTH</option>
                                </FieldSelect>
                              </div>
                              <div>
                                <Label>Register Address</Label>
                                {usesRange ? (
                                  <FieldSelect
                                    value={row.register??""}
                                    onChange={e=>updateHandshakeRow(index,"register",e.target.value)}
                                    mono
                                    style={registerIssue ? { borderColor:T.red, background:T.redLight } : {}}
                                  >
                                    <option value="">- Select -</option>
                                    {registerOptions.map((registerNo)=><option key={registerNo} value={registerNo}>R{registerNo}</option>)}
                                  </FieldSelect>
                                ) : (
                                  <FieldInput
                                    type="number"
                                    value={row.register??""}
                                    onChange={e=>updateHandshakeRow(index,"register",e.target.value)}
                                    placeholder="e.g. 101"
                                    mono
                                    title={registerIssue || ""}
                                    style={registerIssue ? { borderColor:T.red, background:T.redLight } : {}}
                                  />
                                )}
                                {registerIssue && (
                                  <p style={{ margin:"4px 0 0", fontSize:10, color:T.red, lineHeight:1.35 }}>
                                    {registerIssue}
                                  </p>
                                )}
                              </div>
                              <div>
                                <Label>Trigger Value</Label>
                                <FieldInput type="number" value={row.value??""} onChange={e=>updateHandshakeRow(index,"value",e.target.value)} placeholder="1" mono
                                  style={{ background:row.value!==""&&row.value!==null&&row.value!==undefined?T.blueLight:"", borderColor:row.value!==""&&row.value!==null&&row.value!==undefined?T.blueBorder:T.border, fontWeight:700, color:T.navy }} />
                              </div>
                              <div>
                                <Label>Meaning / Purpose</Label>
                                <FieldInput value={row.meaning||""} onChange={e=>updateHandshakeRow(index,"meaning",e.target.value)} placeholder="Describe what this signal does" />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {handshakeRows.length===0 && (
                      <div style={{ padding:"40px 24px", textAlign:"center", border:`2px dashed ${T.border}`, borderRadius:10, color:T.textMuted }}>
                        <p style={{ fontWeight:600, fontSize:13 }}>No handshake signals defined.</p>
                        <p style={{ fontSize:12, marginTop:4 }}>Click "+ Add Signal Row" above to define signals.</p>
                      </div>
                    )}
                  </div>

                  {/* Tuning map summary table */}
                  {handshakeRows.length>0 && (
                    <div style={{ background:T.bgCard, border:`1px solid ${T.borderLight}`, borderRadius:10, overflow:"hidden" }}>
                      <div style={{ padding:"10px 14px", background:T.bgMuted, borderBottom:`1px solid ${T.borderLight}`, display:"flex", alignItems:"center", gap:8 }}>
                        <FlaskConical size={13} color={T.blue} />
                        <p style={{ fontSize:11, fontWeight:700, color:T.text, margin:0, textTransform:"uppercase", letterSpacing:"0.07em" }}>Signal Summary</p>
                        <span style={{ marginLeft:"auto", fontSize:10, color:T.textMuted }}>Configuration read-only (Edit in cards above)</span>
                      </div>
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                          <thead>
                            <tr style={{ background:T.bgMuted, borderBottom:`1px solid ${T.borderLight}` }}>
                              {["#","Signal","Direction","Register","Value","Meaning","Required"].map(h=>(
                                <th key={h} style={{ padding:"10px 12px", textAlign:"left", fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.09em", color:T.textMuted, whiteSpace:"nowrap" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {handshakeRows.map((row,i)=>(
                              <tr key={row.id||i} style={{ borderBottom:`1px solid ${T.borderLight}`, background:i%2===1?T.bgMuted:T.bgCard }}>
                                <td style={{ padding:"10px 12px", color:T.textMuted, fontSize:11, fontFamily:"ui-monospace,monospace" }}>{i+1}</td>
                                <td style={{ padding:"10px 12px", fontWeight:600, color:T.text }}>{row.signal||"-"}</td>
                                <td style={{ padding:"10px 12px" }}><ActionBadge action={row.direction||"READ"} /></td>
                                <td style={{ padding:"10px 12px", fontFamily:"ui-monospace,monospace", fontWeight:700, color:row.register?T.blue:T.textMuted }}>{row.register?`R${row.register}`:"-"}</td>
                                <td style={{ padding:"10px 12px", fontFamily:"ui-monospace,monospace", fontWeight:700, color:T.navy }}>{row.value ?? "-"}</td>
                                <td style={{ padding:"10px 12px", color:T.textSec, fontSize:11 }}>{row.meaning||"-"}</td>
                                <td style={{ padding:"10px 12px" }}><Chip label={row.required!==false?"Must":"Optional"} color={row.required!==false?"blue":"gray"} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div style={{ padding:"10px 14px", background:T.amberLight, border:`1px solid ${T.amberBorder}`, borderRadius:8, display:"flex", alignItems:"flex-start", gap:10 }}>
                    <AlertTriangle size={14} color={T.amber} style={{ flexShrink:0, marginTop:1 }} />
                    <p style={{ fontSize:12, color:T.textSec, margin:0, lineHeight:1.5 }}>Changing handshake values will break PLC communication unless the PLC program is updated. Coordinate with your PLC programmer.</p>
                  </div>
                </div>
              )}

              {/* LIVE REGISTERS */}
              {activeTab==="live" && (
                <div>
                  <div style={{ padding:16, background:T.bgMuted, border:`1px solid ${T.borderLight}`, borderRadius:12, marginBottom:16 }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap", marginBottom:12 }}>
                      <div>
                        <p style={{ fontWeight:700, color:T.text, margin:0, fontSize:13 }}>Quality Check Station Source</p>
                        <p style={{ fontSize:11, color:T.textMuted, margin:"2px 0 0" }}>Configure result source for quality check: system IP push or PLC register polling.</p>
                      </div>
                      <label style={{ display:"inline-flex", alignItems:"center", gap:8, fontSize:12, color:T.textSec, fontWeight:700 }}>
                        <input type="checkbox" checked={Boolean(formData?.spcConfig?.enabled)} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),enabled:e.target.checked } }))} style={{ accentColor:T.blue }} />
                        This is Quality Check Station
                      </label>
                    </div>
                    {Boolean(formData?.spcConfig?.enabled) && (
                      <>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px,1fr))", gap:10 }}>
                          <div>
                            <Label>Quality Result Mode</Label>
                            <FieldSelect value={formData?.spcConfig?.mode||"IP_PUSH"} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),mode:e.target.value } }))}>
                              <option value="IP_PUSH">IP Push (from Quality software)</option>
                              <option value="PLC_REGISTER">PLC Register Poll</option>
                            </FieldSelect>
                          </div>
                        </div>
                        {(formData?.spcConfig?.mode||"IP_PUSH")==="IP_PUSH" ? (
                          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px,1fr))", gap:10, marginTop:10 }}>
                            <div><Label>Quality System IP</Label><FieldInput value={formData?.spcConfig?.sourceIp||""} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),sourceIp:e.target.value } }))} placeholder="192.168.3.200" mono /></div>
                            <div><Label>Quality Port (optional)</Label><FieldInput type="number" value={formData?.spcConfig?.sourcePort||""} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),sourcePort:e.target.value } }))} placeholder="5000" mono /></div>
                            <div><Label>Result Key In Payload</Label><FieldInput value={formData?.spcConfig?.payloadResultKey||"RESULT"} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),payloadResultKey:e.target.value.toUpperCase() } }))} placeholder="RESULT" mono /></div>
                            <div><Label>NG Values (comma separated)</Label><FieldInput value={formData?.spcConfig?.payloadResultNgValues||""} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),payloadResultNgValues:e.target.value } }))} placeholder="NG, FAIL, 0" /></div>
                          </div>
                        ) : (
                          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px,1fr))", gap:10, marginTop:10 }}>
                            <div><Label>Result Register</Label><FieldInput type="number" value={formData?.spcConfig?.plcResultRegister||""} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcResultRegister:e.target.value } }))} placeholder="103" mono /></div>
                            <div><Label>Result Device (SLMP)</Label><FieldInput value={formData?.spcConfig?.plcResultDevice||"D"} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcResultDevice:e.target.value.toUpperCase() } }))} placeholder="D" mono /></div>
                            <div><Label>OK Values</Label><FieldInput value={formData?.spcConfig?.plcResultOkValues||""} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcResultOkValues:e.target.value } }))} placeholder="1, 3, OK, PASS" /></div>
                            <div><Label>NG Values</Label><FieldInput value={formData?.spcConfig?.plcResultNgValues||""} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcResultNgValues:e.target.value } }))} placeholder="0, 2, NG, FAIL" /></div>
                          </div>
                        )}
                        <div style={{ marginTop:10 }}>
                          <Label>Quality Payload Keys (comma separated)</Label>
                          <FieldInput value={formData?.spcConfig?.qualityPayloadKeys||""} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),qualityPayloadKeys:e.target.value } }))} placeholder="diameter, reasonCode, height, cameraNgCode" />
                        </div>
                        <div style={{ marginTop:12, padding:12, borderRadius:10, border:`1px solid ${T.borderLight}`, background:T.bgCard }}>
                          <label style={{ display:"inline-flex", alignItems:"center", gap:8, fontSize:12, color:T.textSec, fontWeight:700 }}>
                            <input type="checkbox" checked={Boolean(formData?.spcConfig?.plcAckEnabled)} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcAckEnabled:e.target.checked } }))} style={{ accentColor:T.blue }} />
                            Send PLC confirmation when quality result is received
                          </label>
                          {Boolean(formData?.spcConfig?.plcAckEnabled) && (
                            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px,1fr))", gap:10, marginTop:10 }}>
                              <div><Label>ACK Register</Label><FieldInput type="number" value={formData?.spcConfig?.plcAckRegister||""} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcAckRegister:e.target.value } }))} placeholder="105" mono /></div>
                              <div><Label>ACK Device</Label><FieldInput value={formData?.spcConfig?.plcAckDevice||"D"} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcAckDevice:e.target.value.toUpperCase() } }))} placeholder="D" mono /></div>
                              <div><Label>ACK OK Value</Label><FieldInput type="number" value={formData?.spcConfig?.plcAckOkValue||"101"} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcAckOkValue:e.target.value } }))} placeholder="101" mono /></div>
                              <div><Label>ACK NG Value</Label><FieldInput type="number" value={formData?.spcConfig?.plcAckNgValue||"102"} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcAckNgValue:e.target.value } }))} placeholder="102" mono /></div>
                              <div><Label>ACK Error Value</Label><FieldInput type="number" value={formData?.spcConfig?.plcAckErrorValue||"199"} onChange={(e)=>setFormData((prev)=>({ ...prev,spcConfig:{ ...(prev.spcConfig||{}),plcAckErrorValue:e.target.value } }))} placeholder="199" mono /></div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ padding:16, background:T.blueLight+"44", border:`1px solid ${T.blueBorder}`, borderRadius:12, marginBottom:16, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <Activity size={16} color={T.blue} />
                      <div>
                        <p style={{ fontWeight:700, color:T.text, margin:0, fontSize:13 }}>Live Data Registers</p>
                        <p style={{ fontSize:11, color:T.textMuted, margin:"2px 0 0" }}>Define registers for live monitoring — Temperature, Pressure, Torque, etc.</p>
                      </div>
                    </div>
                    <button type="button" onClick={addSignal}
                      style={{ padding:"7px 14px", background:T.blue, color:"#fff", border:"none", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
                      <Plus size={12} /> Add Register
                    </button>
                  </div>

                  {(!formData.plcSignalMap||formData.plcSignalMap.length===0) ? (
                    <div style={{ padding:"40px 24px", textAlign:"center", border:`2px dashed ${T.border}`, borderRadius:10, color:T.textMuted }}>
                      <p style={{ fontWeight:600, fontSize:13 }}>No live registers defined.</p>
                      <p style={{ fontSize:12, marginTop:4 }}>Click "Add Register" to define a live monitoring register.</p>
                    </div>
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                      {formData.plcSignalMap.map((sig,idx)=>(
                        <div key={idx} style={{ background:T.bgCard, border:`1px solid ${T.borderLight}`, borderRadius:10, padding:"12px 14px", display:"flex", alignItems:"flex-end", gap:12 }}>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 80px 1fr", gap:10, flex:1 }}>
                            {[
                              { label:"Label",            field:"label",       type:"text",   placeholder:"Temperature" },
                              { label:"Register Address", field:"register",    type:"number", placeholder:"40001", mono:true },
                              { label:"Description/Unit", field:"description", type:"text",   placeholder:"Unit: deg C" },
                            ].map(({ label,field,type,placeholder,mono })=>(
                              <div key={field}>
                                <Label>{label}</Label>
                                <FieldInput type={type} value={sig[field]||""} onChange={e=>updateSignal(idx,field,e.target.value)} placeholder={placeholder} mono={mono} />
                              </div>
                            ))}
                            <div>
                              <Label>Device</Label>
                              <FieldInput value={sig.device||""} onChange={e=>updateSignal(idx,"device",String(e.target.value||"").toUpperCase())} placeholder={formData.plcProtocol==="SLMP"?"D":"Opt."} mono style={{ textTransform:"uppercase" }} />
                            </div>
                            <div>
                              <Label>Direction</Label>
                              <FieldSelect value={sig.direction||"PLC -> PC"} onChange={e=>updateSignal(idx,"direction",e.target.value)}>
                                <option value="PLC -> PC">Read (PLC to PC)</option>
                                <option value="PC -> PLC">Write (PC to PLC)</option>
                                <option value="BIDIRECTIONAL">Both</option>
                              </FieldSelect>
                            </div>
                          </div>
                          <button type="button" onClick={()=>removeSignal(idx)}
                            style={{ width:32, height:32, border:`1px solid ${T.redBorder}`, borderRadius:7, background:T.redLight, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:T.red, flexShrink:0 }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </form>

            {/* Modal footer */}
            <div style={{ padding:"14px 24px", borderTop:`1px solid ${T.borderLight}`, background:T.bgCard, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:T.textMuted }}>
                <ChevronRight size={12} />
                <span>Step {activeTabIndex+1} of {FORM_TABS.length} — {FORM_TABS[activeTabIndex]?.label}</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <button type="button" onClick={downloadCurrentPlcSpec}
                  style={{ padding:"8px 14px", fontSize:12, fontWeight:700, borderRadius:8, border:`1px solid ${T.border}`, background:T.bgCard, color:T.textSec, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
                  Download CSV
                </button>
                {activeTabIndex>0 && (
                  <button type="button" onClick={goPrevious}
                    style={{ padding:"8px 16px", fontSize:12, fontWeight:700, borderRadius:8, border:`1px solid ${T.border}`, background:T.bgCard, color:T.textSec, cursor:"pointer" }}>
                    Previous
                  </button>
                )}
                <button type="button" onClick={closeModal}
                  style={{ padding:"8px 16px", fontSize:12, fontWeight:700, borderRadius:8, border:`1px solid ${T.border}`, background:T.bgCard, color:T.textSec, cursor:"pointer" }}>
                  Cancel
                </button>
                {!isLastTab ? (
                  <button type="button" onClick={saveAndNext}
                    style={{ padding:"8px 18px", fontSize:12, fontWeight:700, borderRadius:8, border:"none", background:T.navy, color:"#fff", cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
                    <ChevronRight size={13} /> Save & Next
                  </button>
                ) : (
                  <button type="submit" form="machine-form" disabled={saving}
                    style={{ padding:"8px 20px", fontSize:12, fontWeight:700, borderRadius:8, border:"none", background:saving?T.slateLight:T.navy, color:"#fff", cursor:saving?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:6, opacity:saving?0.6:1 }}>
                    <Save size={13} />{saving?"Saving...":editingMachine?"Update Machine":"Create Machine"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* VIEW CONFIG MODAL                                       */}
      {/* ====================================================== */}
      {viewMachine && (
        <div style={modalOverlay}>
          <div style={{ position:"absolute", inset:0 }} onClick={()=>setViewMachine(null)} />
          <div style={{ position:"relative", width:"100%", maxWidth:780, background:T.bgCard, border:`1px solid ${T.borderLight}`, borderRadius:16, overflow:"hidden", boxShadow:"0 24px 60px rgba(15,23,42,.22)" }}>
            <div style={{ height:3, background:`linear-gradient(90deg, ${T.navy}, ${T.blue})` }} />
            <div style={{ padding:"16px 20px", borderBottom:`1px solid ${T.borderLight}`, background:T.bgCard, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:34, height:34, borderRadius:9, background:T.blueLight, border:`1px solid ${T.blueBorder}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <Eye size={15} color={T.blue} />
                </div>
                <div>
                  <h2 style={{ fontWeight:700, color:T.text, margin:0, fontSize:14 }}>Machine Configuration View</h2>
                  <p style={{ fontSize:11, color:T.textMuted, margin:"2px 0 0" }}>{viewMachine.machineName} | {viewMachine.operationNo||"-"}</p>
                </div>
              </div>
              <button onClick={()=>setViewMachine(null)} style={{ width:30, height:30, border:`1px solid ${T.border}`, borderRadius:7, background:"transparent", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:T.textMuted }}>
                <X size={14} />
              </button>
            </div>
            <div style={{ padding:20, maxHeight:"70vh", overflowY:"auto", background:T.bg, display:"grid", gap:12 }}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:10 }}>
                {[
                  { label:"Line",     value:viewMachine.lineName||"-",          bg:T.bgCard,     border:T.borderLight, text:T.text  },
                  { label:"Sequence", value:viewMachine.sequenceNo||"-",        bg:T.bgCard,     border:T.borderLight, text:T.text  },
                  { label:"PLC",      value:`${viewMachine.plcIp||"-"}${viewMachine.plcPort?`:${viewMachine.plcPort}`:""}`, bg:T.blueLight, border:T.blueBorder, text:T.blue },
                  { label:"Protocol", value:viewMachine.plcProtocol||"-",      bg:T.tealLight,  border:T.tealBorder,  text:T.teal  },
                  { label:"Range",    value:viewMachine.plcRangeId||"-",        bg:T.bgCard,     border:T.borderLight, text:T.text  },
                  { label:"Status",   value:viewMachine.status||"-",            bg:viewMachine.status==="ACTIVE"?T.greenLight:T.redLight, border:viewMachine.status==="ACTIVE"?T.greenBorder:T.redBorder, text:viewMachine.status==="ACTIVE"?T.green:T.red },
                  { label:"Bypass",   value:viewMachine.machineBypassEnabled?"Bypassed":"Normal", bg:viewMachine.machineBypassEnabled?T.amberLight:T.bgMuted, border:viewMachine.machineBypassEnabled?T.amberBorder:T.border, text:viewMachine.machineBypassEnabled?T.amber:T.textMuted },
                ].map((item)=>(
                  <div key={item.label} style={{ padding:"10px 12px", borderRadius:8, border:`1px solid ${item.border}`, background:item.bg }}>
                    <p style={{ margin:0, fontSize:10, color:T.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:700 }}>{item.label}</p>
                    <p style={{ margin:"4px 0 0", fontSize:12, color:item.text, fontWeight:700, fontFamily:"ui-monospace,monospace" }}>{String(item.value)}</p>
                  </div>
                ))}
              </div>
              <div style={{ padding:"10px 12px", borderRadius:8, border:`1px solid ${T.borderLight}`, background:T.bgCard }}>
                <p style={{ margin:0, fontSize:11, color:T.text, fontWeight:700, marginBottom:8 }}>Core Registers</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, fontSize:11, color:T.textSec, fontFamily:"ui-monospace,monospace", lineHeight:1.8 }}>
                  <div><span style={{ color:T.textMuted }}>Start:</span> <strong style={{ color:T.blue }}>R{viewMachine.plcConfig?.startRegister??"-"}</strong></div>
                  <div><span style={{ color:T.textMuted }}>Block:</span> <strong style={{ color:T.blue }}>R{viewMachine.plcConfig?.blockRegister??"-"}</strong></div>
                  <div><span style={{ color:T.textMuted }}>Running:</span> <strong style={{ color:T.green }}>R{viewMachine.plcConfig?.runningRegister??"-"}</strong></div>
                  <div><span style={{ color:T.textMuted }}>End OK:</span> <strong style={{ color:T.green }}>R{viewMachine.plcConfig?.endOkRegister??"-"}</strong></div>
                  <div><span style={{ color:T.textMuted }}>End NG:</span> <strong style={{ color:T.green }}>R{viewMachine.plcConfig?.endNgRegister??"-"}</strong></div>
                  <div><span style={{ color:T.textMuted }}>Reset:</span> <strong style={{ color:T.blue }}>R{viewMachine.plcConfig?.resetRegister??"-"}</strong></div>
                  <div><span style={{ color:T.textMuted }}>Part:</span> <strong style={{ color:T.navy }}>R{viewMachine.plcConfig?.partRegister??"-"}</strong></div>
                  <div><span style={{ color:T.textMuted }}>Station:</span> <strong style={{ color:T.navy }}>R{viewMachine.plcConfig?.stationRegister??"-"}</strong></div>
                  <div><span style={{ color:T.textMuted }}>Heartbeat:</span> <strong style={{ color:T.teal }}>R{viewMachine.plcConfig?.heartbeatRegister??"-"}</strong></div>
                </div>
              </div>
              <div style={{ padding:"10px 12px", borderRadius:8, border:`1px solid ${T.borderLight}`, background:T.bgCard }}>
                <p style={{ margin:"0 0 8px", fontSize:11, color:T.text, fontWeight:700 }}>Handshake Signal Map</p>
                <div style={{ display:"grid", gap:6 }}>
                  {normalizeHandshakeRows(viewMachine.plcConfig?.handshakeMap,viewMachine.plcConfig||{}).map((row,idx)=>{
                    const isW = row.direction==="WRITE";
                    const isB = row.direction==="BOTH";
                    return (
                      <div key={row.id||`${row.signal}-${idx}`} style={{ fontSize:11, color:T.textSec, fontFamily:"ui-monospace,monospace", padding:"6px 10px", borderRadius:6, border:`1px solid ${isW?T.blueBorder:isB?T.tealBorder:T.greenBorder}`, background:isW?T.blueLight:isB?T.tealLight:T.greenLight, display:"flex", alignItems:"center", gap:8 }}>
                        <DirectionIcon direction={row.direction} size={11} />
                        <strong>{row.signal||`Row ${idx+1}`}</strong>
                        <span style={{ color:T.textMuted }}>|</span>
                        <span>{row.direction}</span>
                        <span style={{ color:T.textMuted }}>|</span>
                        <span>R{row.register||"-"}</span>
                        <span style={{ color:T.textMuted }}>|</span>
                        <span>V:{row.value||"-"}</span>
                        <span style={{ color:T.textMuted }}>|</span>
                        <span style={{ fontFamily:"inherit", color:T.textSec }}>{row.meaning||"-"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* BYPASS MODAL — Fixed                                    */}
      {/* ====================================================== */}
      {bypassModalMachine && (
        <div style={modalOverlay}>
          <div style={{ position:"absolute", inset:0 }} onClick={closeBypassModal} />
          <div style={{ position:"relative", width:"100%", maxWidth:520, background:T.bgCard, border:`1px solid ${T.borderLight}`, borderRadius:16, overflow:"hidden", boxShadow:"0 24px 60px rgba(15,23,42,.22)" }}>
            <div style={{ height:3, background:`linear-gradient(90deg, ${T.navy}, ${T.amber})` }} />
            <div style={{ padding:"18px 24px", borderBottom:`1px solid ${T.borderLight}`, background:T.bgCard, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:38, height:38, borderRadius:10, background:T.amberLight, border:`1px solid ${T.amberBorder}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <ShieldOff size={16} color={T.amber} />
                </div>
                <div>
                  <h2 style={{ fontWeight:700, color:T.text, margin:0, fontSize:15 }}>Machine Bypass</h2>
                  <p style={{ fontSize:11, color:T.textMuted, margin:"2px 0 0" }}>{bypassModalMachine.machineName} | {bypassModalMachine.operationNo||"-"}</p>
                  {/* Show current bypass state clearly */}
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4 }}>
                    <span style={{ fontSize:10, color:T.textMuted }}>Current status:</span>
                    <BypassBadge enabled={Boolean(bypassModalMachine.machineBypassEnabled)} />
                  </div>
                </div>
              </div>
              <button onClick={closeBypassModal} style={{ width:30, height:30, border:`1px solid ${T.border}`, borderRadius:7, background:"transparent", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:T.textMuted }}>
                <X size={14} />
              </button>
            </div>
            <form onSubmit={submitBypass} style={{ padding:24, display:"flex", flexDirection:"column", gap:16, background:T.bg }}>
              {/* Toggle: what will we set */}
              <div>
                <Label>Set Bypass To</Label>
                <div style={{ display:"flex", gap:10, marginTop:2 }}>
                  {[
                    { value:true,  label:"Enable Bypass",  icon:ShieldOff,   color:T.amber, bg:T.amberLight, border:T.amberBorder  },
                    { value:false, label:"Disable Bypass", icon:ShieldCheck, color:T.green, bg:T.greenLight, border:T.greenBorder  },
                  ].map(opt => {
                    const OI = opt.icon;
                    const selected = bypassEnabled===opt.value;
                    return (
                      <button key={String(opt.value)} type="button" onClick={()=>setBypassEnabled(opt.value)}
                        style={{ flex:1, padding:"10px 14px", borderRadius:9, border:`2px solid ${selected?opt.border:T.border}`, background:selected?opt.bg:T.bgCard, color:selected?opt.color:T.textMuted, fontWeight:700, fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"all .15s" }}>
                        <OI size={14} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div><Label>Station</Label><FieldInput readOnly value={bypassModalMachine.operationNo||""} mono /></div>
                <div><Label>Machine ID</Label><FieldInput readOnly value={String(bypassModalMachine.id||"")} mono /></div>
              </div>
              <div>
                <Label>Reason</Label>
                <FieldInput value={bypassReason} onChange={e=>setBypassReason(e.target.value)} placeholder="MANUAL_BYPASS_FROM_MACHINE_PAGE" />
              </div>

              {/* Preview of what action will happen */}
              <div style={{ padding:"10px 12px", background:bypassEnabled?T.amberLight:T.greenLight, border:`1px solid ${bypassEnabled?T.amberBorder:T.greenBorder}`, borderRadius:8, fontSize:12, color:bypassEnabled?T.amber:T.green, fontWeight:600, display:"flex", alignItems:"center", gap:8 }}>
                {bypassEnabled ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                {bypassEnabled
                  ? `This will enable bypass on ${bypassModalMachine.machineName} — interlock checks will be skipped.`
                  : `This will disable bypass on ${bypassModalMachine.machineName} — normal interlock checks will resume.`}
              </div>

              <p style={{ fontSize:11, color:T.textMuted, margin:0, padding:"8px 10px", background:T.bgMuted, border:`1px solid ${T.border}`, borderRadius:7 }}>
                Machine bypass is station-specific. Use only with supervisor approval.
              </p>

              <div style={{ display:"flex", justifyContent:"flex-end", gap:10, paddingTop:4 }}>
                <button type="button" onClick={closeBypassModal}
                  style={{ padding:"8px 16px", fontSize:12, fontWeight:700, borderRadius:8, border:`1px solid ${T.border}`, background:T.bgCard, color:T.textSec, cursor:"pointer" }}>
                  Cancel
                </button>
                <button type="submit" disabled={bypassing}
                  style={{ padding:"8px 18px", fontSize:12, fontWeight:700, borderRadius:8, border:"none", background:bypassing?T.slateLight:bypassEnabled?T.amber:T.green, color:"#fff", cursor:bypassing?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:6, opacity:bypassing?0.6:1 }}>
                  {bypassEnabled ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
                  {bypassing?"Saving...":(bypassEnabled?"Enable Bypass":"Disable Bypass")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteConfirmId}
        onCancel={()=>setDeleteConfirmId(null)}
        onConfirm={confirmDelete}
        title="Remove Machine?"
        message="This will remove the machine from the registry. Historical data is preserved."
      />
    </div>
  );
};

export default MachinePage;
