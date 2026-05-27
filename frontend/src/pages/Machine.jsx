// MachinePage.jsx — Professional MES Machine Registry
// Redesigned: dynamic register mapping, signal sequencing, data register ranges

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu, Plus, Save, Trash2, Edit, RefreshCw, Search, X,
  Network, Settings, Layout, Database, ChevronRight, Info,
  AlertTriangle, Eye, CheckCircle2, XCircle, ShieldOff, ShieldCheck,
  ArrowUp, ArrowDown, ArrowDownUp, GripVertical, Copy, Download,
  Zap, Signal, Activity, Hash, ToggleLeft, ToggleRight,
  TableProperties, ScanLine, Gauge,
} from "lucide-react";
import toast from "react-hot-toast";
import ConfirmModal from "../components/ConfirmModal";
import { machineApi, plcConfigApi, traceabilityApi } from "../api/services";

// ─── Constants ────────────────────────────────────────────────────────────────

const PROTOCOLS = [
  { value: "TCP_TEXT",   label: "Generic TCP Text",      port: 9001 },
  { value: "MODBUS_TCP", label: "Modbus TCP",             port: 502  },
  { value: "SLMP",       label: "SLMP (Mitsubishi)",      port: 5000 },
];

const DEVICES = ["D", "W", "R", "M", "ZR", "X", "Y"];

const DATA_TYPES = ["INT16", "UINT16", "INT32", "UINT32", "FLOAT32", "BOOL", "STRING"];

const MACHINE_TYPES = [
  { value: "HPDC",    label: "HPDC / Die Cast Machine" },
  { value: "CMM",     label: "CMM / Gauge / Measurement" },
  { value: "ASSEMBLY",label: "Assembly Station"          },
  { value: "PRESS",   label: "Press / Forming"           },
  { value: "LASER",   label: "Laser / Marking"           },
  { value: "LEAK",    label: "Leak Test Machine"         },
  { value: "VISION",  label: "Vision / Camera System"   },
  { value: "ROBOT",   label: "Robot / Extractor"         },
  { value: "OTHER",   label: "Other"                     },
];

// Default handshake signals — user can modify freely
const DEFAULT_HANDSHAKE = [
  { id: "hs1", seq: 1, signal: "Start",          direction: "WRITE", device: "D", register: "", value: "1",  meaning: "Send 1 to start cycle",          category: "control",  required: true  },
  { id: "hs2", seq: 2, signal: "Block/Interlock", direction: "WRITE", device: "D", register: "", value: "2",  meaning: "Send 2 to block/hold cycle",      category: "control",  required: true  },
  { id: "hs3", seq: 3, signal: "Running",         direction: "READ",  device: "D", register: "", value: "2",  meaning: "PLC returns 2 when running",       category: "feedback", required: true  },
  { id: "hs4", seq: 4, signal: "End OK",          direction: "READ",  device: "D", register: "", value: "3",  meaning: "PLC returns 3 on cycle OK",        category: "feedback", required: true  },
  { id: "hs5", seq: 5, signal: "End NG",          direction: "READ",  device: "D", register: "", value: "4",  meaning: "PLC returns 4 on cycle NG",        category: "feedback", required: true  },
  { id: "hs6", seq: 6, signal: "Reset",           direction: "WRITE", device: "D", register: "", value: "9",  meaning: "Send 9 to reset machine state",    category: "control",  required: true  },
  { id: "hs7", seq: 7, signal: "Bypass",          direction: "BOTH",  device: "D", register: "", value: "1",  meaning: "Bypass enable/status register",    category: "bypass",   required: false },
];

const SIGNAL_CATEGORIES = [
  { id: "control",   label: "Control",     color: "#185FA5", bg: "#dbeafe" },
  { id: "feedback",  label: "Feedback",    color: "#15803d", bg: "#dcfce7" },
  { id: "bypass",    label: "Bypass",      color: "#b45309", bg: "#fef3c7" },
  { id: "rejection", label: "Rejection",   color: "#dc2626", bg: "#fee2e2" },
  { id: "quality",   label: "Quality",     color: "#0f766e", bg: "#ccfbf1" },
  { id: "custom",    label: "Custom",      color: "#7c3aed", bg: "#ede9fe" },
];

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:      "#f8fafc",
  card:    "#ffffff",
  muted:   "#f1f5f9",
  border:  "#e2e8f0",
  text:    "#0f172a",
  sec:     "#475569",
  hint:    "#94a3b8",
  blue:    "#185FA5",
  blueLt:  "#dbeafe",
  blueBd:  "#bfdbfe",
  green:   "#15803d",
  greenLt: "#dcfce7",
  greenBd: "#86efac",
  red:     "#dc2626",
  redLt:   "#fee2e2",
  redBd:   "#fca5a5",
  amber:   "#b45309",
  amberLt: "#fef3c7",
  amberBd: "#fcd34d",
  teal:    "#0f766e",
  tealLt:  "#ccfbf1",
  tealBd:  "#5eead4",
};

const SPC_MODE_FIELDS = {
  IP_PUSH: {
    label1: "Source IP / Endpoint",
    placeholder1: "192.168.1.50",
    label2: "Port",
    placeholder2: "5000",
    type2: "number",
    label3: "Result key in payload",
    placeholder3: "",
    label4: "values",
    placeholder4: "",
    hint3: "JSON key in the payload that contains the result",
    hint4: "Comma-separated values that mean NG/fail",
  },
  PLC_REGISTER: {
    label1: "PLC IP Address",
    placeholder1: "192.168.1.100",
    label2: "Port",
    placeholder2: "502",
    type2: "number",
    label3: "Quality Register",
    placeholder3: "2065",
    label4: " Value",
    placeholder4: "2",
    hint3: "PLC register address where quality result is stored",
    hint4: "Register value that signifies NG (e.g. 2)",
  },
  HTTP_API: {
    label1: "API Endpoint URL",
    placeholder1: "http://192.168.1.50/api/quality",
    label2: "Poll Interval (sec)",
    placeholder2: "5",
    type2: "number",
    label3: "JSON Result Key",
    placeholder3: "RESULT",
    label4: "Values",
    placeholder4: "NG, FAIL, 0",
    hint3: "Key name in JSON response containing result",
    hint4: "Values representing NG/failure",
  },
  FOLDER: {
    label1: "Folder Path",
    placeholder1: "C:\\QualityData",
    label2: "File Extension",
    placeholder2: ".json",
    type2: "text",
    label3: "Result key / pattern",
    placeholder3: "RESULT",
    label4: "Values",
    placeholder4: "NG, FAIL, 0",
    hint3: "Result key inside the written files",
    hint4: "Values representing NG/failure",
  },
  TCP_CLIENT: {
    label1: " IP",
    placeholder1: "192.168.1.120",
    label2: "Port",
    placeholder2: "9001",
    type2: "number",
    label3: "Result key / parser key",
    placeholder3: "RESULT",
    label4: "Values",
    placeholder4: "NG, FAIL, 0",
    hint3: "Key to evaluate quality from incoming TCP payload",
    hint4: "Values representing NG/failure",
  },
  TCP_SERVER: {
    label1: "Listener Bind IP",
    placeholder1: "0.0.0.0",
    label2: "Listener Port",
    placeholder2: "9001",
    type2: "number",
    label3: "Result key / parser key",
    placeholder3: "RESULT",
    label4: "Values",
    placeholder4: "",
    hint3: "Key to evaluate quality from incoming payload",
    hint4: "Values representing NG/failure",
  },
  SERIAL: {
    label1: "COM Port",
    placeholder1: "COM3",
    label2: "Baud Rate",
    placeholder2: "9600",
    type2: "number",
    label3: "Result key / parser key",
    placeholder3: "RESULT",
    label4: "Values",
    placeholder4: "",
    hint3: "Key used to parse quality result from serial payload",
    hint4: "Values representing NG/failure",
  },
};

const ACQUISITION_PROTOCOLS = [
  { id: "IP_PUSH", label: "IP Push"  },
  { id: "PLC_REGISTER", label: "PLC Register" },
  { id: "HTTP_API", label: "HTTP API" },
  { id: "FOLDER", label: "File / Folder" },
  { id: "TCP_CLIENT", label: "TCP Client" },
  { id: "TCP_SERVER", label: "TCP Server" },
  { id: "SERIAL", label: "Serial / USB", hint: "COM scanner input via serial adapter provision" },
];

const PARSER_TYPES = ["JSON", "CSV", "XML", "KEYVALUE", "RAW"];

// ─── Small helpers ────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

const toNum = (v, fallback = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const catColor = (cat) =>
  SIGNAL_CATEGORIES.find((c) => c.id === cat) || SIGNAL_CATEGORIES[5];

// ─── Atomic input components ──────────────────────────────────────────────────

const inp = {
  width: "100%", boxSizing: "border-box", height: 34, padding: "0 10px",
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
  fontSize: 12, color: C.text, outline: "none",
  transition: "border-color .15s, box-shadow .15s",
};

function FInput({ value, onChange, placeholder, type = "text", mono, readOnly, style: sx = {}, ...rest }) {
  const [f, setF] = useState(false);
  return (
    <input
      type={type} value={value ?? ""} onChange={onChange}
      placeholder={placeholder} readOnly={readOnly}
      style={{
        ...inp,
        fontFamily: mono ? "ui-monospace,monospace" : "inherit",
        background: readOnly ? C.muted : C.card,
        borderColor: f ? C.blue : C.border,
        boxShadow: f ? `0 0 0 3px ${C.blueLt}` : "none",
        ...sx,
      }}
      onFocus={() => setF(true)} onBlur={() => setF(false)}
      {...rest}
    />
  );
}

function FSelect({ value, onChange, children, mono, style: sx = {} }) {
  const [f, setF] = useState(false);
  return (
    <select
      value={value ?? ""} onChange={onChange}
      style={{
        ...inp,
        fontFamily: mono ? "ui-monospace,monospace" : "inherit",
        borderColor: f ? C.blue : C.border,
        boxShadow: f ? `0 0 0 3px ${C.blueLt}` : "none",
        cursor: "pointer", ...sx,
      }}
      onFocus={() => setF(true)} onBlur={() => setF(false)}
    >
      {children}
    </select>
  );
}

const Label = ({ children, required, hint }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: C.hint }}>
      {children}{required && <span style={{ color: C.red, marginLeft: 2 }}>*</span>}
    </p>
    {hint && (
      <span title={hint} style={{ cursor: "help", fontSize: 10, color: C.hint }}>
        <Info size={10} />
      </span>
    )}
  </div>
);

const Badge = ({ label, color, bg, border }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", padding: "2px 8px",
    borderRadius: 99, fontSize: 9, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.06em", color, background: bg,
    border: `1px solid ${border || bg}`,
  }}>
    {label}
  </span>
);

const DirBadge = ({ dir }) => {
  const map = {
    READ:  { bg: C.greenLt, color: C.green, bd: C.greenBd, icon: <ArrowUp size={9} />,     label: "READ" },
    WRITE: { bg: C.blueLt,  color: C.blue,  bd: C.blueBd,  icon: <ArrowDown size={9} />,   label: "WRITE" },
    BOTH:  { bg: C.tealLt,  color: C.teal,  bd: C.tealBd,  icon: <ArrowDownUp size={9} />, label: "BOTH" },
  };
  const d = map[dir] || map.READ;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px",
      borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: "0.06em",
      color: d.color, background: d.bg, border: `1px solid ${d.bd}`,
    }}>
      {d.icon}{d.label}
    </span>
  );
};

// ─── Section card wrapper ─────────────────────────────────────────────────────

function SectionCard({ title, subtitle, icon: Icon, iconColor = C.blue, action, children, collapsible }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div
        style={{
          padding: "10px 14px", background: C.muted, borderBottom: open ? `1px solid ${C.border}` : "none",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: collapsible ? "pointer" : "default",
        }}
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {Icon && (
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: iconColor + "18",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Icon size={14} color={iconColor} />
            </div>
          )}
          <div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.text }}>{title}</p>
            {subtitle && <p style={{ margin: "1px 0 0", fontSize: 10, color: C.hint }}>{subtitle}</p>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {action}
          {collapsible && (
            <span style={{ color: C.hint, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
          )}
        </div>
      </div>
      {open && <div style={{ padding: 14 }}>{children}</div>}
    </div>
  );
}

// ─── Pill tabs ────────────────────────────────────────────────────────────────

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.border}`, padding: "0 20px", background: C.muted }}>
      {tabs.map((t) => {
        const isActive = active === t.id;
        const TI = t.icon;
        return (
          <button
            key={t.id} type="button" onClick={() => onChange(t.id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "10px 12px", border: "none", background: "transparent",
              fontSize: 12, fontWeight: isActive ? 700 : 500,
              color: isActive ? C.blue : C.sec,
              borderBottom: `2px solid ${isActive ? C.blue : "transparent"}`,
              cursor: "pointer", transition: "all .12s", whiteSpace: "nowrap",
            }}
          >
            {TI && <TI size={13} />}{t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, color = C.blue }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
      <span
        onClick={() => onChange(!checked)}
        style={{
          display: "inline-flex", alignItems: "center",
          width: 36, height: 20, borderRadius: 99, flexShrink: 0,
          background: checked ? color : C.border, transition: "background .2s",
          position: "relative", cursor: "pointer",
        }}
      >
        <span style={{
          position: "absolute", left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: "50%",
          background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)",
          transition: "left .2s",
        }} />
      </span>
      {label && <span style={{ fontSize: 12, fontWeight: 600, color: C.sec }}>{label}</span>}
    </label>
  );
}

// ─── Icon button ───────────────────────────────────────────────────────────────

function IconBtn({ icon: Icon, title, onClick, color = C.sec, hoverColor, hoverBg, disabled }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick} title={title} disabled={disabled}
      style={{
        width: 28, height: 28, border: `1px solid ${hov ? (hoverColor || color) : C.border}`,
        borderRadius: 6, background: hov ? (hoverBg || color + "18") : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        color: hov ? (hoverColor || color) : C.hint,
        transition: "all .12s", opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
    >
      <Icon size={12} />
    </button>
  );
}

// ─── Empty form factory ────────────────────────────────────────────────────────

function emptyForm() {
  return {
    machineName: "", lineName: "", machineType: "HPDC",
    sequenceNo: "", operationNo: "", status: "ACTIVE",
    cycleTime: "0", loadingTime: "0", dailyTargetQty: "0",
    plcEnabled: true,
    plcIp: "", plcPort: "", plcProtocol: "TCP_TEXT",
    plcDevice: "D", plcFrameMode: "AUTO", plcRangeId: "",
    // Handshake signals (ordered by seq)
    handshakeSignals: DEFAULT_HANDSHAKE.map((h) => ({ ...h, id: uid(), frameMode: "AUTO" })),
    // Data register ranges (for reading blocks of data — CMM, live params, etc.)
    dataRegisterRanges: [],
    // Quality / SPC
    spcEnabled: false,
    spcMode: "IP_PUSH",
    spcSourceIp: "", spcSourcePort: "",
    spcPayloadKey: "RESULT", spcNgValues: "NG,FAIL,0",
    spcActiveProtocols: ["IP_PUSH"],
    spcPriority: ["IP_PUSH"],
    spcFolderPath: "",
    spcFolderPattern: "*.json",
    spcFolderParser: "JSON",
    spcFolderDeleteAfterRead: true,
    markingEnabled: false,
    markingSecondaryProtocol: "TCP_CLIENT",
    markingSecondaryIp: "",
    markingSecondaryPort: "",
    markingSecondaryComPort: "",
    markingCustomerQrKey: "customer_qr",
    spcDynamicRegisters: [],
    spcRetryCount: "4",
    spcRetryDelayMs: "1500",
    spcTimeoutMs: "12000",
    sourceConfigNotes: "",
    // Description
    description: "",
  };
}

// ─── Build from existing machine record ───────────────────────────────────────

function formFromMachine(m) {
  const cfg = m.plcConfig || {};
  const spc = m.spcConfig || {};

  // Rebuild handshake signals from handshakeMap or legacy fields
  let signals = [];
  if (Array.isArray(cfg.handshakeMap) && cfg.handshakeMap.length) {
    signals = cfg.handshakeMap.map((row, i) => ({
      id: row.id || uid(),
      seq: row.seq ?? i + 1,
      signal: row.signal || "",
      direction: row.direction || "READ",
      device: row.device || m.plcDevice || "D",
      register: String(row.register ?? ""),
      value: String(row.value ?? ""),
      meaning: row.meaning || "",
      category: row.category || "control",
      required: row.required !== false,
      frameMode: row.frameMode || row.slmpFrameMode || cfg.slmpFrameMode || m.plcSlmpFrameMode || "AUTO",
    }));
  } else {
    // Legacy flat fields → build default with values
    signals = DEFAULT_HANDSHAKE.map((def) => {
      const keyMap = {
        "Start":          { reg: cfg.startRegister,    val: cfg.startValue    },
        "Block/Interlock":{ reg: cfg.blockRegister,    val: cfg.blockValue    },
        "Running":        { reg: cfg.runningRegister,  val: cfg.startedValue  },
        "End OK":         { reg: cfg.endOkRegister,    val: cfg.endOkValue    },
        "End NG":         { reg: cfg.endNgRegister,    val: cfg.endNgValue    },
        "Reset":          { reg: cfg.resetRegister,    val: cfg.resetValue    },
        "Bypass":         { reg: cfg.bypassRegister,   val: "1"               },
      };
      const kv = keyMap[def.signal] || {};
      return {
        ...def,
        id: uid(),
        device: m.plcDevice || "D",
        register: String(kv.reg ?? ""),
        value: String(kv.val ?? def.value),
        frameMode: cfg.slmpFrameMode || m.plcSlmpFrameMode || "AUTO",
      };
    });
  }

  // Data register ranges
  const ranges = Array.isArray(cfg.dataRegisterRanges)
    ? cfg.dataRegisterRanges.map((r) => ({
        ...r,
        endReg: r.endReg || String(toNum(r.startReg) + toNum(r.count, 1) - 1),
        formula: r.formula || "",
        frameMode: r.frameMode || r.slmpFrameMode || cfg.slmpFrameMode || m.plcSlmpFrameMode || "AUTO",
      }))
    : (Array.isArray(m.plcSignalMap)
        ? m.plcSignalMap.map((r, i) => ({
            id: uid(),
            name: r.label || r.key || `Range ${i + 1}`,
            device: r.device || "D",
            startReg: String(r.register || ""),
            endReg: String(r.register || ""),
            count: "1",
            dataType: "INT16",
            scale: "1",
            unit: r.unit || "",
            purpose: r.meaning || "",
            formula: "",
            toleranceMin: "",
            toleranceMax: "",
            frameMode: cfg.slmpFrameMode || m.plcSlmpFrameMode || "AUTO",
          }))
        : []);

  return {
    machineName: m.machineName || "",
    lineName: m.lineName || "",
    machineType: m.machineType || "HPDC",
    sequenceNo: String(m.sequenceNo ?? ""),
    operationNo: m.operationNo || "",
    status: m.status || "ACTIVE",
    cycleTime: String(m.cycleTime ?? "0"),
    loadingTime: String(m.loadingTime ?? "0"),
    dailyTargetQty: String(m.dailyTargetQty ?? "0"),
    plcEnabled: m.plcEnabled !== false,
    plcIp: m.plcIp || "",
    plcPort: String(m.plcPort ?? ""),
    plcProtocol: m.plcProtocol || "TCP_TEXT",
    plcDevice: m.plcDevice || cfg.slmpDevice || "D",
    plcFrameMode: m.plcSlmpFrameMode || cfg.slmpFrameMode || "AUTO",
    plcRangeId: String(m.plcRangeId || cfg.rangeId || ""),
    handshakeSignals: signals,
    dataRegisterRanges: ranges,
    spcEnabled: spc.enabled === true,
    spcMode: spc.mode || "IP_PUSH",
    spcSourceIp: spc.sourceIp || "",
    spcSourcePort: String(spc.sourcePort ?? ""),
    spcPayloadKey: spc.payloadResultKey || "RESULT",
    spcNgValues: Array.isArray(spc.payloadResultNgValues)
      ? spc.payloadResultNgValues.join(", ")
      : String(spc.payloadResultNgValues || "NG,FAIL,0"),
    spcActiveProtocols: [spc.mode || "IP_PUSH"],
    spcPriority: [spc.mode || "IP_PUSH"],
    spcFolderPath: spc.folderConfig?.path || "",
    spcFolderPattern: spc.folderConfig?.pattern || "*.json",
    spcFolderParser: spc.folderConfig?.parser || "JSON",
    spcFolderDeleteAfterRead: spc.folderConfig?.deleteAfterRead !== false,
    markingEnabled: spc.protocolConfig?.markingEnabled === true,
    markingSecondaryProtocol: spc.protocolConfig?.markingSecondaryProtocol || "TCP_CLIENT",
    markingSecondaryIp: spc.protocolConfig?.markingSecondaryIp || "",
    markingSecondaryPort: String(spc.protocolConfig?.markingSecondaryPort ?? ""),
    markingSecondaryComPort: spc.protocolConfig?.markingSecondaryComPort || "",
    markingCustomerQrKey: spc.protocolConfig?.markingCustomerQrKey || "customer_qr",
    spcDynamicRegisters: Array.isArray(spc.dynamicRegisters)
      ? spc.dynamicRegisters.map((r) => ({
          id: uid(),
          name: r.name || "",
          register: String(r.register ?? ""),
          device: r.device || "D",
          type: r.type || "INT16",
          scale: String(r.scale ?? "1"),
          unit: r.unit || "",
        }))
      : [],
    spcRetryCount: String(spc.retryCount ?? 4),
    spcRetryDelayMs: String(spc.retryDelayMs ?? 1500),
    spcTimeoutMs: String(spc.timeoutMs ?? 12000),
    sourceConfigNotes: spc.sourceConfigNotes || "",
    description: m.description || "",
  };
}

// ─── Build submit payload ──────────────────────────────────────────────────────

function buildPayload(f) {
  const signals = [...f.handshakeSignals].sort((a, b) => a.seq - b.seq);

  // Also write legacy flat fields for backward compat
  const findVal = (name, field) => {
    const row = signals.find((s) => s.signal.toLowerCase().includes(name.toLowerCase()));
    return row ? (field === "register" ? toNum(row.register) : toNum(row.value, undefined)) : undefined;
  };

  const plcConfig = {
    handshakeMap: signals.map((s) => ({
      id: s.id,
      seq: s.seq,
      signal: s.signal,
      direction: s.direction,
      device: f.plcDevice,
      register: toNum(s.register),
      value: toNum(s.value),
      meaning: s.meaning,
      category: s.category,
      required: s.required,
      frameMode: s.frameMode || f.plcFrameMode || "AUTO",
    })),
    dataRegisterRanges: f.dataRegisterRanges.map((r) => ({
      id: r.id,
      name: r.name,
      device: r.device,
      startReg: toNum(r.startReg),
      endReg: toNum(r.endReg) || (toNum(r.startReg) + toNum(r.count, 1) - 1),
      count: toNum(r.count, 1),
      dataType: r.dataType,
      scale: parseFloat(r.scale) || 1,
      unit: r.unit,
      purpose: r.purpose,
      formula: r.formula || "",
      toleranceMin: r.toleranceMin !== "" ? toNum(r.toleranceMin) : null,
      toleranceMax: r.toleranceMax !== "" ? toNum(r.toleranceMax) : null,
      frameMode: r.frameMode || f.plcFrameMode || "AUTO",
    })),
    // Legacy fields
    startRegister:   findVal("start", "register"),
    blockRegister:   findVal("block", "register"),
    runningRegister: findVal("running", "register"),
    endOkRegister:   findVal("end ok", "register"),
    endNgRegister:   findVal("end ng", "register"),
    resetRegister:   findVal("reset", "register"),
    bypassRegister:  findVal("bypass", "register"),
    startValue:      findVal("start", "value"),
    blockValue:      findVal("block", "value"),
    startedValue:    findVal("running", "value"),
    endOkValue:      findVal("end ok", "value"),
    endNgValue:      findVal("end ng", "value"),
    resetValue:      findVal("reset", "value"),
    slmpDevice:      f.plcDevice,
    slmpFrameMode:   f.plcFrameMode,
    rangeId:         toNum(f.plcRangeId),
  };

  const spcConfig = {
    enabled: f.spcEnabled,
    mode: f.spcMode,
    activeProtocols: [f.spcMode || "IP_PUSH"],
    priority: [f.spcMode || "IP_PUSH"],
    sourceIp: f.spcSourceIp || null,
    sourcePort: toNum(f.spcSourcePort),
    payloadResultKey: f.spcPayloadKey || "RESULT",
    payloadResultNgValues: f.spcNgValues.split(/[,;|]/).map((v) => v.trim().toUpperCase()).filter(Boolean),
    retryCount: Math.max(0, toNum(f.spcRetryCount, 4)),
    retryDelayMs: Math.max(0, toNum(f.spcRetryDelayMs, 1500)),
    timeoutMs: Math.max(1000, toNum(f.spcTimeoutMs, 12000)),
    folderConfig: {
      path: f.spcFolderPath || "",
      pattern: f.spcFolderPattern || "*.*",
      parser: (f.spcFolderParser || "JSON").toUpperCase(),
      deleteAfterRead: f.spcFolderDeleteAfterRead !== false,
    },
    dynamicRegisters: (f.spcDynamicRegisters || []).map((r) => ({
      name: r.name || "PARAM",
      register: toNum(r.register),
      device: (r.device || "D").toUpperCase(),
      type: (r.type || "INT16").toUpperCase(),
      scale: parseFloat(r.scale) || 1,
      unit: r.unit || "",
      saveAs: r.saveAs || "",
      required: Boolean(r.required),
      okValues: String(r.okValues || "").split(/[,;|]/).map((v) => v.trim()).filter(Boolean),
      ngValues: String(r.ngValues || "").split(/[,;|]/).map((v) => v.trim()).filter(Boolean),
      pendingValues: String(r.pendingValues || "").split(/[,;|]/).map((v) => v.trim()).filter(Boolean),
      validationRule: r.validationRule || "",
    })).filter((r) => r.register !== null),
    sourceConfigNotes: (f.sourceConfigNotes || "").trim() || null,
    protocolConfig: {
      markingEnabled: f.markingEnabled === true,
      markingSecondaryProtocol: String(f.markingSecondaryProtocol || "TCP_CLIENT").toUpperCase(),
      markingSecondaryIp: (f.markingSecondaryIp || "").trim() || null,
      markingSecondaryPort: toNum(f.markingSecondaryPort),
      markingSecondaryComPort: (f.markingSecondaryComPort || "").trim() || null,
      markingCustomerQrKey: (f.markingCustomerQrKey || "customer_qr").trim() || "customer_qr",
    },
  };

  return {
    machineName: f.machineName.trim(),
    lineName: f.lineName.trim(),
    machineType: f.machineType,
    sequenceNo: toNum(f.sequenceNo),
    operationNo: f.operationNo.trim().toUpperCase(),
    status: f.status,
    cycleTime: Math.max(toNum(f.cycleTime, 0), 0),
    loadingTime: Math.max(toNum(f.loadingTime, 0), 0),
    dailyTargetQty: Math.max(toNum(f.dailyTargetQty, 0), 0),
    plcEnabled: f.plcEnabled,
    plcIp: f.plcIp.trim(),
    plcPort: toNum(f.plcPort),
    plcProtocol: f.plcProtocol,
    plcDevice: f.plcDevice,
    plcSlmpFrameMode: f.plcFrameMode,
    plcRangeId: toNum(f.plcRangeId),
    plcConfig,
    spcConfig,
    description: f.description,
    // Legacy
    plcSignalMap: f.dataRegisterRanges.map((r) => ({
      label: r.name, register: toNum(r.startReg),
      device: r.device, unit: r.unit, meaning: r.purpose,
      frameMode: r.frameMode || f.plcFrameMode || "AUTO",
    })),
  };
}

// ─── SIGNAL EDITOR ROW ────────────────────────────────────────────────────────

function SignalRow({ row, index, total, onUpdate, onRemove, onMove, device }) {
  const cc = catColor(row.category);
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "28px 28px 140px 90px 70px 80px 85px 70px 70px 1fr 28px",
      gap: 6, alignItems: "center",
      padding: "7px 10px",
      background: C.card,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${cc.color}`,
      borderRadius: 7,
    }}>
      {/* Seq */}
      <span style={{ fontSize: 10, fontWeight: 800, color: C.hint, textAlign: "center",
        fontFamily: "ui-monospace,monospace" }}>{row.seq}</span>

      {/* Move up/down */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <button type="button" disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
          style={{ border: "none", background: "none", cursor: "pointer", padding: 1, color: C.hint, opacity: index === 0 ? 0.3 : 1 }}>
          <ArrowUp size={9} />
        </button>
        <button type="button" disabled={index === total - 1}
          onClick={() => onMove(index, index + 1)}
          style={{ border: "none", background: "none", cursor: "pointer", padding: 1, color: C.hint, opacity: index === total - 1 ? 0.3 : 1 }}>
          <ArrowDown size={9} />
        </button>
      </div>

      {/* Signal name */}
      <FInput value={row.signal} onChange={(e) => onUpdate(index, "signal", e.target.value)}
        placeholder="Signal name" style={{ fontSize: 12 }} />

      {/* Category */}
      <FSelect value={row.category} onChange={(e) => onUpdate(index, "category", e.target.value)}>
        {SIGNAL_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </FSelect>

      {/* Direction */}
      <FSelect value={row.direction} onChange={(e) => onUpdate(index, "direction", e.target.value)}>
        <option value="READ">READ</option>
        <option value="WRITE">WRITE</option>
        <option value="BOTH">BOTH</option>
      </FSelect>

      {/* Device */}
      <FSelect value={row.device || device} onChange={(e) => onUpdate(index, "device", e.target.value)} mono>
        {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
      </FSelect>

      {/* Frame Mode */}
      <FSelect value={row.frameMode || "AUTO"} onChange={(e) => onUpdate(index, "frameMode", e.target.value)}>
        <option value="AUTO">AUTO</option>
        <option value="ASCII">ASCII</option>
        <option value="BINARY">BINARY</option>
      </FSelect>

      {/* Register */}
      <FInput value={row.register} onChange={(e) => onUpdate(index, "register", e.target.value)}
        placeholder="e.g. 100" mono type="number" />

      {/* Value */}
      <FInput value={row.value} onChange={(e) => onUpdate(index, "value", e.target.value)}
        placeholder="e.g. 1" mono type="number" />

      {/* Meaning */}
      <FInput value={row.meaning} onChange={(e) => onUpdate(index, "meaning", e.target.value)}
        placeholder="Purpose / description" />

      {/* Remove */}
      <IconBtn icon={Trash2} title="Remove signal" onClick={() => onRemove(index)}
        color={C.red} hoverColor={C.red} hoverBg={C.redLt} />
    </div>
  );
}

// ─── DATA REGISTER RANGE ROW ──────────────────────────────────────────────────

function DataRangeRow({ row, index, onUpdate, onRemove, device }) {
  // Computed: list of registers in this range
  const start = toNum(row.startReg);
  const end = toNum(row.endReg) || (start !== null ? start + toNum(row.count, 1) - 1 : null);
  const regs = start !== null && end !== null && end >= start
    ? Array.from({ length: end - start + 1 }, (_, i) => `${row.device || device}${start + i}`)
    : [];
  const count = regs.length;

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 12px",
    }}>
      {/* Row 1: name + device + start + end + datatype + scale + unit */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 65px 85px 85px 100px 90px 70px 70px 28px", gap: 6, alignItems: "end" }}>
        <div>
          <Label>Name / Label</Label>
          <FInput value={row.name} onChange={(e) => onUpdate(index, "name", e.target.value)} placeholder="e.g. Bore Diameter" />
        </div>
        <div>
          <Label>Device</Label>
          <FSelect value={row.device || device} onChange={(e) => onUpdate(index, "device", e.target.value)} mono>
            {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
          </FSelect>
        </div>
        <div>
          <Label hint="First register number in the range">Start Reg</Label>
          <FInput value={row.startReg} onChange={(e) => {
            const startVal = e.target.value;
            const endVal = row.endReg || startVal;
            const newCount = Math.max(1, toNum(endVal) - toNum(startVal) + 1);
            onUpdate(index, "startReg", startVal);
            onUpdate(index, "count", String(newCount));
            onUpdate(index, "endReg", String(toNum(startVal) + newCount - 1));
          }} placeholder="e.g. 2060" mono type="number" />
        </div>
        <div>
          <Label hint="Last register number in the range">End Reg</Label>
          <FInput value={row.endReg || (start !== null ? String(start + toNum(row.count, 1) - 1) : "")} onChange={(e) => {
            const endVal = e.target.value;
            const startVal = row.startReg;
            const newCount = Math.max(1, toNum(endVal) - toNum(startVal) + 1);
            onUpdate(index, "endReg", endVal);
            onUpdate(index, "count", String(newCount));
          }} placeholder="e.g. 2064" mono type="number" />
        </div>
        <div>
          <Label>Data Type</Label>
          <FSelect value={row.dataType} onChange={(e) => onUpdate(index, "dataType", e.target.value)}>
            {DATA_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
          </FSelect>
        </div>
        <div>
          <Label>Frame Mode</Label>
          <FSelect value={row.frameMode || "AUTO"} onChange={(e) => onUpdate(index, "frameMode", e.target.value)}>
            <option value="AUTO">AUTO</option>
            <option value="ASCII">ASCII</option>
            <option value="BINARY">BINARY</option>
          </FSelect>
        </div>
        <div>
          <Label hint="Multiply raw value by this factor">Scale</Label>
          <FInput value={row.scale} onChange={(e) => onUpdate(index, "scale", e.target.value)}
            placeholder="1.0" mono />
        </div>
        <div>
          <Label>Unit</Label>
          <FInput value={row.unit} onChange={(e) => onUpdate(index, "unit", e.target.value)}
            placeholder="mm / MPa" />
        </div>
        <div style={{ paddingTop: 18 }}>
          <IconBtn icon={Trash2} title="Remove range" onClick={() => onRemove(index)}
            color={C.red} hoverColor={C.red} hoverBg={C.redLt} />
        </div>
      </div>

      {/* Register preview */}
      {regs.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyBetween: "space-between", flexWrap: "wrap", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, flex: 1 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.hint, textTransform: "uppercase", marginRight: 2 }}>Registers:</span>
            {regs.map((r) => (
              <span key={r} style={{
                fontSize: 9, fontFamily: "ui-monospace,monospace", fontWeight: 700,
                padding: "1px 6px", borderRadius: 3,
                background: C.blueLt, color: C.blue,
                border: `1px solid ${C.blueBd}`,
              }}>{r}</span>
            ))}
            {count > 32 && <span style={{ fontSize: 9, color: C.red }}>Max 32 registers per range</span>}
          </div>
          <span style={{ fontSize: 10, fontWeight: 600, color: C.hint }}>
            Values Merged Value: <code style={{ fontFamily: "ui-monospace,monospace", color: C.blue, fontWeight: 700 }}>[Concatenated String]</code>
          </span>
        </div>
      )}
    </div>
  );
}

// ─── STATUS & BYPASS BADGES ───────────────────────────────────────────────────

const StatusBadge = ({ status }) => {
  const on = status === "ACTIVE";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px",
      borderRadius: 99, fontSize: 10, fontWeight: 700,
      background: on ? C.greenLt : C.muted, color: on ? C.green : C.hint,
      border: `1px solid ${on ? C.greenBd : C.border}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: on ? C.green : C.hint }} />
      {on ? "Active" : "Inactive"}
    </span>
  );
};

const BypassBadge = ({ enabled }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px",
    borderRadius: 99, fontSize: 10, fontWeight: 700,
    background: enabled ? C.amberLt : C.muted, color: enabled ? C.amber : C.hint,
    border: `1px solid ${enabled ? C.amberBd : C.border}`,
  }}>
    {enabled ? <ShieldOff size={10} /> : <ShieldCheck size={10} />}
    {enabled ? "Bypassed" : "Normal"}
  </span>
);

// ─── MODAL OVERLAY ────────────────────────────────────────────────────────────

const modalOv = {
  position: "fixed", inset: 0, zIndex: 50,
  display: "flex", alignItems: "flex-start", justifyContent: "center",
  padding: "16px 16px 32px", paddingTop: 40,
  background: "rgba(15,23,42,.65)", backdropFilter: "blur(4px)",
  overflowY: "auto",
};

// ─── TABS CONFIG ──────────────────────────────────────────────────────────────

const FORM_TABS = [
  { id: "identity", label: "Identity", icon: Layout },
  { id: "network", label: "Network / PLC", icon: Network },
  { id: "signals", label: "Signals", icon: Signal },
  { id: "data", label: "Data Registers", icon: TableProperties },
  { id: "acquisition", label: "Acquisition + Quality", icon: ScanLine },
];

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function MachinePage() {
  const [machines,  setMachines]  = useState([]);
  const [plcRanges, setPlcRanges] = useState([]);
  const [plcEndpoints, setPlcEndpoints] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewMachine, setViewMachine] = useState(null);
  const [deleteId,  setDeleteId]  = useState(null);
  const [bypassMachine, setBypassMachine] = useState(null);
  const [bypassing, setBypassing] = useState(false);
  const [bypassReason, setBypassReason] = useState("");
  const [bypassEnabled, setBypassEnabled] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [search,    setSearch]    = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("identity");
  const [form, setForm] = useState(() => emptyForm());

  const [customIp, setCustomIp] = useState(false);
  const [customPort, setCustomPort] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showSourceFieldGuide, setShowSourceFieldGuide] = useState(false);

  const uniqueIps = useMemo(() => {
    const ips = new Set();
    (plcRanges || []).forEach(r => { if (r.plcIp) ips.add(r.plcIp); });
    (machines || []).forEach(m => { if (m.plcIp) ips.add(m.plcIp); });
    (plcEndpoints || []).forEach(e => { if (e.plcIp) ips.add(e.plcIp); });
    return [...ips].sort();
  }, [plcRanges, machines, plcEndpoints]);

  const uniquePorts = useMemo(() => {
    const ports = new Set();
    (plcRanges || []).forEach(r => { if (r.plcPort) ports.add(String(r.plcPort)); });
    (machines || []).forEach(m => { if (m.plcPort) ports.add(String(m.plcPort)); });
    (plcEndpoints || []).forEach(e => { if (e.plcPort) ports.add(String(e.plcPort)); });
    return [...ports].sort((a, b) => Number(a) - Number(b));
  }, [plcRanges, machines, plcEndpoints]);

  const handleTestDataRegisters = async () => {
    if (!form.plcIp || !form.plcPort) {
      toast.error("Please provide PLC IP and Port in Network Tab first");
      return;
    }
    if (form.dataRegisterRanges.length === 0) {
      toast.error("No data registers to test");
      return;
    }
    
    setShowTestModal(true);
    setTesting(true);
    setTestResult(null);
    try {
      const allRegisters = [];
      form.dataRegisterRanges.forEach(r => {
        const start = Number(r.startReg);
        const end = Number(r.endReg) || start;
        const count = Math.max(1, end - start + 1);
        const device = r.device || form.plcDevice || "D";
        const frameMode = r.frameMode || form.plcFrameMode || "AUTO";
        
        if (!isNaN(start)) {
          for (let i = 0; i < count; i++) {
            allRegisters.push({
              register: start + i,
              device: device,
              frameMode: frameMode,
            });
          }
        }
      });
      
      if (allRegisters.length === 0) {
        toast.error("Invalid register map");
        setTesting(false);
        return;
      }
      
      // Group by device type class: D/W/R/ZR vs M/X/Y
      const wordGroup = [];
      const bitGroup = [];
      
      allRegisters.forEach(reg => {
        const dev = String(reg.device).toUpperCase();
        if (["M", "X", "Y"].includes(dev)) {
          bitGroup.push(reg);
        } else {
          wordGroup.push(reg);
        }
      });
      
      const blocks = [];
      
      // Helper to split a group of registers into contiguous blocks of max 60
      const splitIntoBlocks = (regs) => {
        // Group by actual device name first (e.g. "D" vs "W" vs "ZR")
        const byDeviceName = {};
        regs.forEach(r => {
          const name = String(r.device).toUpperCase();
          if (!byDeviceName[name]) byDeviceName[name] = [];
          byDeviceName[name].push(r);
        });
        
        Object.keys(byDeviceName).forEach(deviceName => {
          const subRegs = byDeviceName[deviceName];
          // Sort numerically by register address
          subRegs.sort((a, b) => a.register - b.register);
          
          let currentBlock = [];
          for (let i = 0; i < subRegs.length; i++) {
            const regObj = subRegs[i];
            if (currentBlock.length === 0) {
              currentBlock.push(regObj);
            } else {
              const prevReg = currentBlock[currentBlock.length - 1].register;
              if (regObj.register - prevReg > 1 || currentBlock.length >= 60) {
                blocks.push({
                  device: deviceName,
                  registers: currentBlock
                });
                currentBlock = [regObj];
              } else {
                currentBlock.push(regObj);
              }
            }
          }
          if (currentBlock.length > 0) {
            blocks.push({
              device: deviceName,
              registers: currentBlock
            });
          }
        });
      };
      
      splitIntoBlocks(wordGroup);
      splitIntoBlocks(bitGroup);
      
      if (blocks.length === 0) {
        toast.error("Invalid register map");
        setTesting(false);
        return;
      }
      
      const mergedValues = {};
      
      // Call readPlcRegisters for each block
      for (const block of blocks) {
        const isBitDevice = ["M", "X", "Y"].includes(block.device.toUpperCase());
        const payload = {
          machineId: editingId,
          ip: form.plcIp,
          port: Number(form.plcPort),
          protocol: form.plcProtocol,
          registers: block.registers,
          timeoutMs: 8000,
          plcSlmpDevice: block.device,
          plcSlmpFrameMode: isBitDevice ? "BINARY" : (form.plcFrameMode || "ASCII"),
        };
        
        const res = await machineApi.readPlcRegisters(payload);
        const vals = res.values || res.read?.value || {};
        Object.assign(mergedValues, vals);
      }
      
      // Group the merged values by range names
      const groupedResult = {};
      form.dataRegisterRanges.forEach(r => {
        const start = Number(r.startReg);
        const end = Number(r.endReg) || start;
        const count = Math.max(1, end - start + 1);
        const device = r.device || form.plcDevice || "D";
        const rangeName = r.name || `Range (${device}${start})`;
        
        if (count === 1) {
          const val = mergedValues[start];
          if (val !== undefined) {
            groupedResult[rangeName] = val;
          }
        } else {
          const vals = [];
          for (let i = 0; i < count; i++) {
            const val = mergedValues[start + i];
            if (val !== undefined) {
              vals.push(val);
            }
          }
          if (vals.length > 0) {
            groupedResult[rangeName] = vals;
          }
        }
      });
      
      const finalPayload = Object.keys(groupedResult).length > 0 ? groupedResult : mergedValues;
      
      setTestResult({
        message: "Data registers read successfully from PLC",
        payload: finalPayload,
        outcome: "PASS"
      });
      toast.success("Registers read successfully!");
    } catch (err) {
      console.error(err);
      setTestResult({
        message: err.response?.data?.error || err.message || "Failed to read registers",
        payload: err.response?.data?.details || err,
        outcome: "FAIL"
      });
      toast.error("PLC read failed");
    } finally {
      setTesting(false);
    }
  };

  const handleTestConnection = async ({ useMarking = false } = {}) => {
    setShowTestModal(true);
    setTesting(true);
    setTestResult(null);
    try {
      const uiMode = useMarking
        ? String(form.markingSecondaryProtocol || "TCP_CLIENT").toUpperCase()
        : String(form.spcMode || "TCP_CLIENT").toUpperCase();
      const modeMap = {
        TCP_CLIENT: "TCP_CLIENT",
        TCP_SERVER: "TCP_SERVER",
        USB_SCANNER: "USB_SCANNER",
        SERIAL: "SERIAL",
        PLC_SLMP: "PLC_REGISTER",
        MODBUS_TCP: "PLC_REGISTER",
        FILE_WATCHER: "FILE_WATCH",
        HTTP_PUSH: "HTTP_API",
        SIMULATION: "SIMULATION",
      };
      const mode = modeMap[uiMode] || "TCP_CLIENT";
      const endpoint = mode === "HTTP_API"
        ? (useMarking ? form.markingSecondaryIp : form.spcSourceIp)
        : mode === "FILE_WATCH"
          ? null
          : undefined;
      const sourceIp = mode === "SERIAL"
        ? (useMarking ? (form.markingSecondaryComPort || form.markingSecondaryIp || "") : (form.spcSourceIp || ""))
        : (useMarking ? (form.markingSecondaryIp || form.plcIp || "") : (form.spcSourceIp || form.plcIp || ""));
      const sourcePort = mode === "USB_SCANNER" ? null : toNum(useMarking ? (form.markingSecondaryPort || form.plcPort) : (form.spcSourcePort || form.plcPort));

      if (mode === "TCP_CLIENT" && !sourceIp) {
        throw new Error("Source IP is required for TCP Client test");
      }
      if (mode === "TCP_SERVER" && !sourcePort) {
        throw new Error("Listener Port is required for TCP Server test");
      }
      if (mode === "PLC_REGISTER" && (!sourceIp || !sourcePort)) {
        throw new Error("PLC IP and PLC Port are required for PLC protocol test");
      }

      const folderConfig = {
        path: form.spcFolderPath || form.spcSourceIp,
        pattern: form.spcFolderPattern || form.spcPayloadKey || "*.*",
        parser: (form.spcFolderParser || "JSON").toUpperCase(),
        deleteAfterRead: form.spcFolderDeleteAfterRead !== false,
      };

      const connection = await machineApi.testConnection({
        mode,
        sourceIp,
        sourcePort,
        endpoint,
        folderConfig,
        plcProtocol: form.plcProtocol,
        payloadResultKey: form.spcPayloadKey,
        plcSlmpDevice: form.plcDevice || "D",
        plcSlmpFrameMode: form.plcFrameMode || "AUTO",
        timeoutMs: toNum(form.spcTimeoutMs, 12000),
      });

      const payload = {
        mode: useMarking ? `MARKING_${uiMode}` : uiMode,
        connectivity: connection,
      };

      if (mode === "PLC_REGISTER" && form.spcPayloadKey && /^\d+$/.test(String(form.spcPayloadKey).trim())) {
        try {
          const read = await machineApi.readPlcValue({
            machineId: editingId || undefined,
            ip: form.plcIp || form.spcSourceIp,
            port: toNum(form.plcPort || form.spcSourcePort),
            protocol: form.plcProtocol,
            registerNo: toNum(form.spcPayloadKey),
            plcSlmpDevice: form.plcDevice || "D",
            plcSlmpFrameMode: form.plcFrameMode || "AUTO",
            timeoutMs: toNum(form.spcTimeoutMs, 12000),
          });
          payload.plcRegisterRead = read;
        } catch (readError) {
          payload.plcRegisterRead = {
            error: readError?.response?.data?.error || readError?.message || "PLC register read failed",
            details: readError?.response?.data || null,
          };
        }
      }

      setTestResult({
        message: connection?.message || "Connection test completed",
        payload,
        outcome: "PASS",
      });
      toast.success("Connection test passed");
    } catch (err) {
      setTestResult({
        message: err?.response?.data?.error || err?.message || "Connection test failed",
        payload: err?.response?.data || null,
        outcome: "FAIL",
      });
      toast.error("Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  // ── Load data ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r, ep] = await Promise.all([
        machineApi.list(),
        plcConfigApi.listRanges().catch(() => []),
        plcConfigApi.listEndpoints().catch(() => []),
      ]);
      setMachines(m || []);
      setPlcRanges(r || []);
      setPlcEndpoints(ep || []);
    } catch { toast.error("Failed to load machines"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const lines = useMemo(() => [...new Set((machines || []).map((m) => m.lineName).filter(Boolean))].sort(), [machines]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (machines || []).filter((m) => {
      const ms = !s || [m.machineName, m.lineName, m.operationNo, m.plcIp].some((v) => String(v || "").toLowerCase().includes(s));
      const ml = lineFilter === "all" || m.lineName === lineFilter;
      return ms && ml;
    }).sort((a, b) => (Number(a.sequenceNo) || 0) - (Number(b.sequenceNo) || 0));
  }, [machines, search, lineFilter]);

  const stats = useMemo(() => ({
    total:     machines.length,
    active:    machines.filter((m) => m.status === "ACTIVE").length,
    plcOn:     machines.filter((m) => m.plcEnabled !== false && m.plcIp).length,
    bypassed:  machines.filter((m) => Boolean(m.machineBypassEnabled)).length,
  }), [machines]);

  // ── Form helpers ────────────────────────────────────────────────────────────
  const setF = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const addDynamicRegister = () => {
    setForm((p) => ({
      ...p,
      spcDynamicRegisters: [
        ...(Array.isArray(p.spcDynamicRegisters) ? p.spcDynamicRegisters : []),
        { id: uid(), name: "", register: "", device: p.plcDevice || "D", type: "INT16", scale: "1", unit: "", saveAs: "", required: false, okValues: "", ngValues: "", validationRule: "" },
      ],
    }));
  };

  const updateDynamicRegister = (index, key, value) => {
    setForm((p) => {
      const arr = Array.isArray(p.spcDynamicRegisters) ? [...p.spcDynamicRegisters] : [];
      if (!arr[index]) return p;
      arr[index] = { ...arr[index], [key]: value };
      return { ...p, spcDynamicRegisters: arr };
    });
  };

  const removeDynamicRegister = (index) => {
    setForm((p) => ({
      ...p,
      spcDynamicRegisters: (Array.isArray(p.spcDynamicRegisters) ? p.spcDynamicRegisters : [])
        .filter((_, i) => i !== index),
    }));
  };

  // Signals
  const addSignal = (preset) => {
    const maxSeq = form.handshakeSignals.reduce((m, s) => Math.max(m, s.seq), 0);
    setForm((p) => ({
      ...p,
      handshakeSignals: [
        ...p.handshakeSignals,
        {
          id: uid(), seq: maxSeq + 1,
          signal: "", direction: "READ",
          device: p.plcDevice || "D",
          frameMode: p.plcFrameMode || "AUTO",
          register: "", value: "", meaning: "",
          category: "control", required: true,
          ...(preset || {}),
        },
      ],
    }));
  };

  const updateSignal = (i, key, val) => {
    setForm((p) => {
      const arr = [...p.handshakeSignals];
      arr[i] = { ...arr[i], [key]: val };
      return { ...p, handshakeSignals: arr };
    });
  };

  const removeSignal = (i) => {
    setForm((p) => {
      const arr = p.handshakeSignals.filter((_, idx) => idx !== i)
        .map((s, idx) => ({ ...s, seq: idx + 1 }));
      return { ...p, handshakeSignals: arr };
    });
  };

  const moveSignal = (from, to) => {
    if (to < 0 || to >= form.handshakeSignals.length) return;
    setForm((p) => {
      const arr = [...p.handshakeSignals];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return { ...p, handshakeSignals: arr.map((s, i) => ({ ...s, seq: i + 1 })) };
    });
  };

  // Data ranges
  const addRange = () => {
    setForm((p) => ({
      ...p,
      dataRegisterRanges: [
        ...p.dataRegisterRanges,
        {
          id: uid(), name: "", device: p.plcDevice || "D",
          frameMode: p.plcFrameMode || "AUTO",
          startReg: "", endReg: "", count: "1", dataType: "INT16",
          scale: "1", unit: "", purpose: "", formula: "",
          toleranceMin: "", toleranceMax: "",
        },
      ],
    }));
  };

  const updateRange = (i, key, val) => {
    setForm((p) => {
      const arr = [...p.dataRegisterRanges];
      arr[i] = { ...arr[i], [key]: val };
      return { ...p, dataRegisterRanges: arr };
    });
  };

  const removeRange = (i) => {
    setForm((p) => ({ ...p, dataRegisterRanges: p.dataRegisterRanges.filter((_, idx) => idx !== i) }));
  };

  // ── Open / close modal ──────────────────────────────────────────────────────
  const openCreate = () => { setForm(emptyForm()); setEditingId(null); setActiveTab("identity"); setShowModal(true); };
  const openEdit   = (m) => { setForm(formFromMachine(m)); setEditingId(m.id); setActiveTab("identity"); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditingId(null); };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.machineName.trim()) { toast.error("Machine name is required"); return; }
    if (!form.operationNo.trim()) { toast.error("Operation code is required"); return; }
    setSaving(true);
    try {
      const payload = buildPayload(form);
      if (editingId) { await machineApi.update(editingId, payload); toast.success("Machine updated"); }
      else           { await machineApi.create(payload); toast.success("Machine created"); }
      closeModal(); await load();
    } catch (err) { toast.error(err.response?.data?.error || "Save failed"); }
    finally { setSaving(false); }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteId) return;
    try { await machineApi.remove(deleteId); toast.success("Machine removed"); await load(); }
    catch { toast.error("Delete failed"); }
    finally { setDeleteId(null); }
  };

  // ── Bypass ──────────────────────────────────────────────────────────────────
  const openBypass = (m) => {
    setBypassMachine(m);
    setBypassEnabled(Boolean(m.machineBypassEnabled));
    setBypassReason(m.machineBypassReason || "MANUAL_BYPASS");
  };

  const submitBypass = async (e) => {
    e.preventDefault();
    if (!bypassMachine) return;
    setBypassing(true);
    try {
      await traceabilityApi.bypass({
        machineId: bypassMachine.id, stationNo: bypassMachine.operationNo,
        reason: bypassReason || "MANUAL_BYPASS", bypassEnabled,
      });
      toast.success(bypassEnabled ? "Bypass enabled" : "Bypass disabled");
      await load();
      setBypassMachine(null);
    } catch (err) { toast.error(err.response?.data?.error || "Bypass failed"); }
    finally { setBypassing(false); }
  };

  // ── Export signal map ───────────────────────────────────────────────────────
  const exportSignalMap = () => {
    const rows = [["Seq", "Signal", "Category", "Direction", "Device", "Register", "Value", "Meaning", "Required"]];
    [...form.handshakeSignals].sort((a, b) => a.seq - b.seq).forEach((s) => {
      rows.push([s.seq, s.signal, s.category, s.direction, s.device || form.plcDevice, s.register, s.value, s.meaning, s.required ? "Yes" : "No"]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csv);
    a.download = `${form.machineName || "machine"}_signal_map.csv`;
    a.click();
    toast.success("Signal map exported");
  };

  // ── Protocol helper ─────────────────────────────────────────────────────────
  const isModbus = form.plcProtocol === "MODBUS_TCP";
  const isSlmp   = form.plcProtocol === "SLMP";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 rise-in" style={{ fontFamily: "var(--font-outfit)" }}>

      {/* ── Page Header ───────────────────────────────────────────────────── */}
      <div className="db-header-card">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box"><Cpu size={22} /></div>
            <div>
              <h1 className="db-header-title">Machine Registry</h1>
              <p className="db-header-subtitle">PLC mapping · Signal sequences · Data register ranges</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={load} className="db-secondary-btn"><RefreshCw size={13} /> Refresh</button>
            <button onClick={openCreate} className="db-action-btn"><Plus size={14} /> Add Machine</button>
          </div>
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
        {[
          { label: "Total",    value: stats.total,    color: C.text,  border: C.border  },
          { label: "Active",   value: stats.active,   color: C.green, border: C.greenBd },
          { label: "PLC Live", value: stats.plcOn,    color: C.blue,  border: C.blueBd  },
          { label: "Bypassed", value: stats.bypassed, color: C.amber, border: C.amberBd },
        ].map((s) => (
          <div key={s.label} style={{
            background: C.card, border: `1px solid ${s.border}`,
            borderLeft: `3px solid ${s.color}`,
            borderRadius: 10, padding: "12px 14px",
          }}>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.hint }}>{s.label}</p>
            <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 800, color: s.color, fontFamily: "ui-monospace,monospace", lineHeight: 1 }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.hint }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search machine, line, operation, IP…"
            style={{ ...inp, height: 36, paddingLeft: 30, width: "100%", boxSizing: "border-box", fontSize: 12 }} />
        </div>
        <FSelect value={lineFilter} onChange={(e) => setLineFilter(e.target.value)} style={{ width: 150 }}>
          <option value="all">All Lines</option>
          {lines.map((l) => <option key={l} value={l}>{l}</option>)}
        </FSelect>
      </div>

      {/* ── Machine Table ─────────────────────────────────────────────────── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: C.muted, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Database size={14} color={C.blue} />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.text, textTransform: "uppercase", letterSpacing: "0.07em" }}>Machine Registry</span>
          </div>
          <span style={{ fontSize: 11, color: C.hint, padding: "2px 8px", background: C.muted, border: `1px solid ${C.border}`, borderRadius: 5 }}>
            {filtered.length} machines
          </span>
        </div>

        {loading ? (
          <div style={{ padding: "60px 24px", textAlign: "center", color: C.hint }}>
            <RefreshCw size={28} style={{ margin: "0 auto 10px", opacity: 0.3, animation: "spin 1s linear infinite" }} />
            <p style={{ fontSize: 12 }}>Loading…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "60px 24px", textAlign: "center", color: C.hint }}>
            <Cpu size={32} style={{ margin: "0 auto 10px", opacity: 0.2 }} />
            <p style={{ fontSize: 13, fontWeight: 600 }}>No machines found</p>
            <p style={{ fontSize: 11, marginTop: 4 }}>Add a machine to get started</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 780 }}>
              <thead>
                <tr style={{ background: C.muted, borderBottom: `1px solid ${C.border}` }}>
                  {["Seq", "Machine", "Type", "Operation", "PLC", "Signals", "Status", "Bypass", ""].map((h) => (
                    <th key={h} style={{
                      padding: "9px 14px", textAlign: h === "" ? "right" : "left",
                      fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                      letterSpacing: "0.09em", color: C.hint, whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m, idx) => {
                  const sigCount = m.plcConfig?.handshakeMap?.length || 0;
                  const regCount = m.plcConfig?.dataRegisterRanges?.length || 0;
                  return (
                    <tr key={m.id}
                      style={{ borderBottom: `1px solid ${C.border}`, background: idx % 2 === 1 ? C.muted : C.card, transition: "background .1s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.blueLt + "55"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 1 ? C.muted : C.card; }}
                    >
                      <td style={{ padding: "11px 14px", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: C.hint, fontSize: 11 }}>
                        {String(m.sequenceNo || 0).padStart(2, "0")}
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        <p style={{ fontWeight: 700, color: C.text, margin: 0 }}>{m.machineName}</p>
                        <p style={{ fontSize: 10, color: C.hint, margin: "2px 0 0" }}>{m.lineName || "—"}</p>
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontSize: 10, color: C.sec, background: C.muted, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>
                          {m.machineType || "—"}
                        </span>
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        <span style={{ fontFamily: "ui-monospace,monospace", color: C.blue, fontWeight: 700, fontSize: 12 }}>{m.operationNo || "—"}</span>
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        {m.plcEnabled !== false && m.plcIp ? (
                          <>
                            <p style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: C.blue, margin: 0 }}>{m.plcIp}:{m.plcPort || "—"}</p>
                            <p style={{ fontSize: 9, color: C.hint, margin: "2px 0 0", textTransform: "uppercase" }}>{m.plcProtocol}</p>
                          </>
                        ) : (
                          <span style={{ fontSize: 10, color: C.hint }}>PLC disabled</span>
                        )}
                      </td>
                      <td style={{ padding: "11px 14px" }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {sigCount > 0 && <span style={{ fontSize: 9, fontWeight: 700, background: C.blueLt, color: C.blue, padding: "2px 6px", borderRadius: 3 }}>{sigCount} signals</span>}
                          {regCount > 0 && <span style={{ fontSize: 9, fontWeight: 700, background: C.tealLt, color: C.teal, padding: "2px 6px", borderRadius: 3 }}>{regCount} ranges</span>}
                          {!sigCount && !regCount && <span style={{ fontSize: 10, color: C.hint }}>—</span>}
                        </div>
                      </td>
                      <td style={{ padding: "11px 14px" }}><StatusBadge status={m.status} /></td>
                      <td style={{ padding: "11px 14px" }}><BypassBadge enabled={Boolean(m.machineBypassEnabled)} /></td>
                      <td style={{ padding: "11px 14px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                          <IconBtn icon={Eye} title="View" onClick={() => setViewMachine(m)} color={C.blue} hoverBg={C.blueLt} hoverColor={C.blue} />
                          <IconBtn icon={m.machineBypassEnabled ? ShieldCheck : ShieldOff} title={m.machineBypassEnabled ? "Disable Bypass" : "Enable Bypass"} onClick={() => openBypass(m)} color={C.amber} hoverBg={C.amberLt} hoverColor={C.amber} />
                          <IconBtn icon={Edit} title="Edit" onClick={() => openEdit(m)} color={C.text} />
                          <IconBtn icon={Trash2} title="Delete" onClick={() => setDeleteId(m.id)} color={C.red} hoverBg={C.redLt} hoverColor={C.red} />
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

      {/* ════════════════════════════════════════════════════════════════════
          ADD / EDIT MODAL
      ════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <div style={modalOv}>
          <div style={{ position: "absolute", inset: 0 }} onClick={closeModal} />
          <div style={{
            position: "relative", width: "100%", maxWidth: 900,
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 14, overflow: "hidden",
            display: "flex", flexDirection: "column",
            boxShadow: "0 24px 60px rgba(15,23,42,.20)",
          }}>
            {/* Accent bar */}
            <div style={{ height: 3, background: `linear-gradient(90deg,${C.text},${C.blue})` }} />

            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 9, background: C.blueLt, border: `1px solid ${C.blueBd}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Cpu size={17} color={C.blue} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>
                    {editingId ? "Edit Machine" : "Add New Machine"}
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: C.hint }}>
                    {editingId ? `Editing ID ${editingId}` : "Fill details to register a new machine"}
                  </p>
                </div>
              </div>
              <button onClick={closeModal} style={{ width: 30, height: 30, border: `1px solid ${C.border}`, borderRadius: 7, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.hint }}>
                <X size={14} />
              </button>
            </div>

            {/* Tabs */}
            <Tabs tabs={FORM_TABS} active={activeTab} onChange={setActiveTab} />

            {/* Form body */}
            <form id="mf" onSubmit={handleSubmit}
              style={{ flex: 1, overflowY: "auto", padding: 20, background: C.bg, display: "flex", flexDirection: "column", gap: 16 }}
              onKeyDown={(e) => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") e.preventDefault(); }}
            >

              {/* ── IDENTITY TAB ─────────────────────────────────────────── */}
              {activeTab === "identity" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div style={{ gridColumn: "1/-1" }}>
                    <Label required>Machine name</Label>
                    <FInput required value={form.machineName} onChange={(e) => setF("machineName", e.target.value)} placeholder="e.g. RICO UBE 850T-2" />
                  </div>
                  <div>
                    <Label>Machine type</Label>
                    <FSelect value={form.machineType} onChange={(e) => setF("machineType", e.target.value)}>
                      {MACHINE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </FSelect>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <FSelect value={form.status} onChange={(e) => setF("status", e.target.value)}>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </FSelect>
                  </div>
                  <div>
                    <Label>Line / Department</Label>
                    <FInput value={form.lineName} onChange={(e) => setF("lineName", e.target.value)} placeholder="e.g. Assembly Line A" />
                  </div>
                  <div>
                    <Label required>Operation code</Label>
                    <FInput required value={form.operationNo} onChange={(e) => setF("operationNo", e.target.value.toUpperCase())} placeholder="e.g. OP010" mono />
                  </div>
                  <div>
                    <Label>Sequence no.</Label>
                    <FInput type="number" value={form.sequenceNo} onChange={(e) => setF("sequenceNo", e.target.value)} placeholder="1" mono />
                  </div>
                  <div>
                    <Label>Daily target qty</Label>
                    <FInput type="number" value={form.dailyTargetQty} onChange={(e) => setF("dailyTargetQty", e.target.value)} placeholder="480" mono />
                  </div>
                  <div>
                    <Label>Cycle time (sec)</Label>
                    <FInput type="number" value={form.cycleTime} onChange={(e) => setF("cycleTime", e.target.value)} placeholder="45" mono />
                  </div>
                  <div>
                    <Label>Loading time (sec)</Label>
                    <FInput type="number" value={form.loadingTime} onChange={(e) => setF("loadingTime", e.target.value)} placeholder="15" mono />
                  </div>
                  <div style={{ gridColumn: "1/-1" }}>
                    <Label>Description / notes</Label>
                    <textarea value={form.description} onChange={(e) => setF("description", e.target.value)}
                      placeholder="Optional machine description or notes"
                      style={{ ...inp, height: 60, padding: 10, resize: "vertical", fontFamily: "inherit" }} />
                  </div>
                </div>
              )}

              {/* ── NETWORK / PLC TAB ─────────────────────────────────────── */}
              {activeTab === "network" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>PLC Communication</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: C.hint }}>Enable to use PLC signals and register polling</p>
                    </div>
                    <Toggle checked={form.plcEnabled} onChange={(v) => setF("plcEnabled", v)} color={C.blue} />
                  </div>

                  {form.plcEnabled && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                        <div>
                          <Label required>Protocol</Label>
                          <FSelect value={form.plcProtocol} onChange={(e) => {
                            const p = PROTOCOLS.find((r) => r.value === e.target.value);
                            setForm((prev) => ({ ...prev, plcProtocol: e.target.value, plcPort: String(p?.port || "") }));
                          }}>
                            {PROTOCOLS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                          </FSelect>
                        </div>
                        <div>
                          <Label required>PLC IP Address</Label>
                          {!customIp && uniqueIps.includes(form.plcIp || "192.168.1.100") ? (
                            <div style={{ display: "flex", gap: 4 }}>
                              <FSelect value={form.plcIp} onChange={(e) => {
                                if (e.target.value === "custom") {
                                  setCustomIp(true);
                                  setF("plcIp", "");
                                } else {
                                  setF("plcIp", e.target.value);
                                }
                              }}>
                                <option value="">— Select IP —</option>
                                {uniqueIps.map(ip => <option key={ip} value={ip}>{ip}</option>)}
                                <option value="custom">✏️ Custom IP...</option>
                              </FSelect>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 4 }}>
                              <FInput value={form.plcIp} onChange={(e) => setF("plcIp", e.target.value)} placeholder="192.168.1.100" mono style={{ flex: 1 }} />
                              <button type="button" onClick={() => { setCustomIp(false); setF("plcIp", uniqueIps[0]); }} style={{ padding: "0 8px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, cursor: "pointer", fontSize: 11 }}>List</button>
                            </div>
                          )}
                        </div>
                        <div>
                          <Label required>Port</Label>
                          {!customPort && uniquePorts.includes(form.plcPort || "502") ? (
                            <div style={{ display: "flex", gap: 4 }}>
                              <FSelect value={form.plcPort} onChange={(e) => {
                                if (e.target.value === "custom") {
                                  setCustomPort(true);
                                  setF("plcPort", "");
                                } else {
                                  setF("plcPort", e.target.value);
                                }
                              }}>
                                <option value="">— Select Port —</option>
                                {uniquePorts.map(p => <option key={p} value={p}>{p}</option>)}
                                <option value="custom">✏️ Custom Port...</option>
                              </FSelect>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 4 }}>
                              <FInput type="number" value={form.plcPort} onChange={(e) => setF("plcPort", e.target.value)} placeholder="502" mono style={{ flex: 1 }} />
                              <button type="button" onClick={() => { setCustomPort(false); setF("plcPort", uniquePorts[0]); }} style={{ padding: "0 8px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, cursor: "pointer", fontSize: 11 }}>List</button>
                            </div>
                          )}
                        </div>
                      </div>


                      {/* Register range (Modbus/SLMP) */}
                      {(isModbus || isSlmp) && (
                        <div>
                          <Label hint="Assign a pre-configured register block to this machine">PLC Register Range</Label>
                          <FSelect value={form.plcRangeId} onChange={(e) => setF("plcRangeId", e.target.value)}>
                            <option value="">— No range assigned —</option>
                            {plcRanges.filter((r) => r.status === "ACTIVE").map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.plcIp} — {form.plcDevice || "D"}{r.rangeStart} to {form.plcDevice || "D"}{r.rangeEnd}
                              </option>
                            ))}
                          </FSelect>
                        </div>
                      )}
                    </>
                  )}

                  {/* Port guide */}
                  <div style={{ padding: "10px 12px", background: C.muted, border: `1px solid ${C.border}`, borderRadius: 7, display: "flex", gap: 8 }}>
                    <Info size={13} color={C.hint} style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ margin: 0, fontSize: 11, color: C.sec, lineHeight: 1.6 }}>
                      Default ports — Modbus TCP: <code style={{ fontFamily: "ui-monospace,monospace", color: C.blue }}>502</code> ·
                      SLMP: <code style={{ fontFamily: "ui-monospace,monospace", color: C.blue }}>5000 / 5006</code> ·
                      Generic TCP: <code style={{ fontFamily: "ui-monospace,monospace", color: C.blue }}>9001</code>
                    </p>
                  </div>
                </div>
              )}

              {/* ── SIGNALS TAB ───────────────────────────────────────────── */}
              {activeTab === "signals" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                
                  

                  {/* Column headers */}
                  {form.handshakeSignals.length > 0 && (
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "28px 28px 140px 90px 70px 80px 85px 70px 70px 1fr 28px",
                      gap: 6, padding: "0 10px",
                    }}>
                      {["Seq", "", "Signal Name", "Category", "Direction", "Device", "Frame", "Register", "Value", "Meaning / Purpose", ""].map((h, i) => (
                        <span key={i} style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: C.hint }}>{h}</span>
                      ))}
                    </div>
                  )}

                  {/* Signal rows */}
                  {form.handshakeSignals.length === 0 ? (
                    <div style={{ padding: "40px 20px", textAlign: "center", border: `2px dashed ${C.border}`, borderRadius: 8, color: C.hint }}>
                      <Signal size={28} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
                      <p style={{ fontSize: 12, fontWeight: 600 }}>No signals defined</p>
                      <p style={{ fontSize: 11 }}>Use "Add Signal" below to start</p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {form.handshakeSignals.map((row, i) => (
                        <SignalRow
                          key={row.id} row={row} index={i}
                          total={form.handshakeSignals.length}
                          onUpdate={updateSignal} onRemove={removeSignal} onMove={moveSignal}
                          device={form.plcDevice}
                        />
                      ))}
                    </div>
                  )}

                  {/* Add signal buttons */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: C.hint, textTransform: "uppercase", alignSelf: "center", marginRight: 2 }}>Add signal:</span>
                    {SIGNAL_CATEGORIES.map((cat) => (
                      <button key={cat.id} type="button"
                        onClick={() => addSignal({ category: cat.id, signal: cat.label })}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "5px 10px", borderRadius: 6, border: `1px solid ${cat.bg}`,
                          background: cat.bg, color: cat.color, fontSize: 11, fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <Plus size={10} />{cat.label}
                      </button>
                    ))}
                  </div>

                  {/* Export */}
                  {form.handshakeSignals.length > 0 && (
                    <button type="button" onClick={exportSignalMap}
                      style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.sec, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                      <Download size={11} /> Export signal map CSV
                    </button>
                  )}
                </div>
              )}

              {/* ── DATA REGISTERS TAB ───────────────────────────────────── */}
              {activeTab === "data" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
               
                  

                  {form.dataRegisterRanges.length === 0 ? (
                    <div style={{ padding: "40px 20px", textAlign: "center", border: `2px dashed ${C.border}`, borderRadius: 8, color: C.hint }}>
                      <TableProperties size={28} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
                      <p style={{ fontSize: 12, fontWeight: 600 }}>No data register ranges defined</p>
                      <p style={{ fontSize: 11 }}>Click "Add Range" to define register blocks to read</p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {form.dataRegisterRanges.map((row, i) => (
                        <DataRangeRow key={row.id} row={row} index={i}
                          onUpdate={updateRange} onRemove={removeRange}
                          device={form.plcDevice} />
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={addRange}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.sec, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      <Plus size={12} /> Add Register Range
                    </button>
                    {/* Quick presets for common machine types */}
                    {form.machineType === "CMM" && (
                      <button type="button"
                        onClick={() => {
                          ["Bore Diameter", "Depth", "Flatness", "Perpendicularity"].forEach((name, i) => {
                            setForm((p) => ({
                              ...p, dataRegisterRanges: [
                                ...p.dataRegisterRanges,
                                { id: uid(), name, device: p.plcDevice || "D", frameMode: p.plcFrameMode || "AUTO", startReg: String(2060 + i * 2), count: "1", dataType: "INT16", scale: "0.01", unit: "mm", purpose: `${name} measurement`, toleranceMin: "", toleranceMax: "" },
                              ],
                            }));
                          });
                        }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 7, border: `1px solid ${C.tealBd}`, background: C.tealLt, color: C.teal, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                        <Gauge size={12} /> Add CMM preset
                      </button>
                    )}
                    <button type="button" onClick={handleTestDataRegisters}
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 7, border: `1px solid ${C.greenBd}`, background: C.greenLt, color: C.green, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      <Zap size={12} /> Test Connection & Review Data
                    </button>
                  </div>

                  {/* Live summary table */}
                  {form.dataRegisterRanges.length > 0 && (
                    <div style={{ marginTop: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ padding: "8px 12px", background: C.muted, borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: C.hint, textTransform: "uppercase", letterSpacing: "0.07em" }}>Register map summary</span>
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead>
                          <tr style={{ background: C.muted, borderBottom: `1px solid ${C.border}` }}>
                            {["Name", "Registers", "Type", "Frame", "Scale", "Unit", "Tolerance"].map((h) => (
                              <th key={h} style={{ padding: "6px 12px", textAlign: "left", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: C.hint }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {form.dataRegisterRanges.map((r, i) => {
                            const start = toNum(r.startReg);
                            const count = Math.min(toNum(r.count, 1), 32);
                            const regList = start !== null ? `${r.device || form.plcDevice}${start}${count > 1 ? ` – ${r.device || form.plcDevice}${start + count - 1}` : ""}` : "—";
                            const hasTol = r.toleranceMin !== "" || r.toleranceMax !== "";
                            return (
                              <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 1 ? C.muted : C.card }}>
                                <td style={{ padding: "7px 12px", fontWeight: 600, color: C.text }}>{r.name || "—"}</td>
                                <td style={{ padding: "7px 12px", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: C.blue }}>{regList}</td>
                                <td style={{ padding: "7px 12px", color: C.sec }}>{r.dataType}</td>
                                <td style={{ padding: "7px 12px", color: C.sec, fontFamily: "ui-monospace,monospace" }}>{r.frameMode || form.plcFrameMode || "AUTO"}</td>
                                <td style={{ padding: "7px 12px", fontFamily: "ui-monospace,monospace", color: C.sec }}>×{r.scale || "1"}</td>
                                <td style={{ padding: "7px 12px", color: C.sec }}>{r.unit || "—"}</td>
                                <td style={{ padding: "7px 12px" }}>
                                  {hasTol ? (
                                    <span style={{ fontSize: 10, color: C.teal, fontFamily: "ui-monospace,monospace" }}>
                                      {r.toleranceMin || "—"} … {r.toleranceMax || "—"}
                                    </span>
                                  ) : <span style={{ color: C.hint, fontSize: 10 }}>None</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}


              {activeTab === "acquisition" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>Acquisition + Quality Integration</p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: C.hint }}>Use one protocol profile at a time for stable MES traceability communication</p>
                    </div>
                    <Toggle checked={form.spcEnabled} onChange={(v) => setF("spcEnabled", v)} color={C.green} />
                  </div>

                  

                  {form.spcEnabled && (
                    <>
                      <div>
                    
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "end" }}>
                          <div>
                            <Label>Protocol</Label>
                            <FSelect
                              value={form.spcMode}
                              onChange={(e) => {
                                const nextMode = e.target.value;
                                setF("spcMode", nextMode);
                                setF("spcActiveProtocols", [nextMode]);
                                setF("spcPriority", [nextMode]);
                              }}
                            >
                              {ACQUISITION_PROTOCOLS.map((m) => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                              ))}
                            </FSelect>
                          </div>
                          <div style={{ paddingBottom: 6 }}>
                            
                            
                          </div>
                        </div>
                        
                      </div>

                      {(() => {
                        const mode = String(form.spcMode || "TCP_CLIENT").toUpperCase();
                        const cfg = SPC_MODE_FIELDS[form.spcMode || "TCP_CLIENT"] || SPC_MODE_FIELDS.TCP_CLIENT;
                        const showEndpointFields = !["USB_SCANNER", "FILE_WATCHER", "SIMULATION"].includes(mode);
                        return (
                          <>
                            {["PLC_SLMP", "MODBUS_TCP"].includes(mode) ? (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                <div style={{ gridColumn: "1 / -1", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: C.card }}>
                                  <p style={{ margin: 0, fontSize: 10, color: C.hint }}>
                                    PLC endpoint will be taken from Network/PLC tab: {form.plcIp || "—"}:{form.plcPort || "—"} ({form.plcProtocol || "TCP_TEXT"})
                                  </p>
                                </div>
                                <div>
                                  <Label hint={cfg.hint3}>{cfg.label3}</Label>
                                  <FInput type="number" value={form.spcPayloadKey} onChange={(e) => setF("spcPayloadKey", e.target.value)} placeholder={cfg.placeholder3} mono />
                                </div>
                                <div>
                                  <Label hint="Optional default NG list. Prefer per-field mapping below.">{cfg.label4}</Label>
                                  <FInput value={form.spcNgValues} onChange={(e) => setF("spcNgValues", e.target.value)} placeholder={cfg.placeholder4} mono />
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 1fr 1fr", gap: 12 }}>
                                {showEndpointFields ? (
                                  <>
                                    <div>
                                      <Label>{cfg.label1}</Label>
                                      <FInput value={form.spcSourceIp} onChange={(e) => setF("spcSourceIp", e.target.value)} placeholder={cfg.placeholder1} mono />
                                    </div>
                                    <div>
                                      <Label>{cfg.label2}</Label>
                                      <FInput type={cfg.type2 || "text"} value={form.spcSourcePort} onChange={(e) => setF("spcSourcePort", e.target.value)} placeholder={cfg.placeholder2} mono />
                                    </div>
                                  </>
                                ) : (
                                  <div style={{ gridColumn: "1 / span 2", paddingTop: 6 }}>
                                    <p style={{ margin: 0, fontSize: 10, color: C.hint }}>
                                      Endpoint fields are not required here. Use folder settings below.
                                    </p>
                                  </div>
                                )}
                                <div>
                                  <Label hint={cfg.hint3}>{cfg.label3}</Label>
                                  <FInput value={form.spcPayloadKey} onChange={(e) => setF("spcPayloadKey", e.target.value)} placeholder={cfg.placeholder3} mono />
                                </div>
                                <div>
                                  <Label hint="Optional default NG list. Prefer per-field mapping below.">{cfg.label4}</Label>
                                  <FInput value={form.spcNgValues} onChange={(e) => setF("spcNgValues", e.target.value)} placeholder={cfg.placeholder4} />
                                </div>
                              </div>
                            )}

                            {/* Test Connection Button */}
                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <button type="button" onClick={handleTestConnection}
                                title="Tests selected source configuration and optional PLC register read"
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 6,
                                  padding: "8px 16px", borderRadius: 8,
                                  border: `1px solid ${C.greenBd}`,
                                  background: C.greenLt, color: C.green,
                                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                                  transition: "all .15s",
                                }}
                              >
                                <Zap size={13} /> Test Connection & Review Data
                              </button>
                            </div>
                          </>
                        );
                      })()}

                      <SectionCard title="Marking QR Capture" subtitle="Optional secondary scanner/customer QR mapping config" icon={ScanLine}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.card }}>
                            <div>
                              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.text }}>Enable Marking Mode</p>
                              <p style={{ margin: "2px 0 0", fontSize: 10, color: C.hint }}>When enabled, machine can capture second customer QR for old-to-new mapping.</p>
                            </div>
                            <Toggle checked={form.markingEnabled === true} onChange={(v) => setF("markingEnabled", v)} color={C.amber} />
                          </div>

                          {form.markingEnabled && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                              <div>
                                <Label>Secondary Protocol</Label>
                                <FSelect value={form.markingSecondaryProtocol} onChange={(e) => setF("markingSecondaryProtocol", e.target.value)}>
                                  <option value="TCP_CLIENT">TCP Client</option>
                                  <option value="TCP_SERVER">TCP Server</option>
                                  <option value="USB_SERIAL">USB Serial</option>
                                  <option value="USB_HID">USB HID</option>
                                  <option value="PLC_REGISTER">PLC Register</option>
                                </FSelect>
                              </div>
                              <div>
                                <Label>{["USB_SERIAL", "SERIAL"].includes(String(form.markingSecondaryProtocol || "").toUpperCase()) ? "Secondary COM / Host" : "Secondary IP / Host"}</Label>
                                <FInput value={form.markingSecondaryIp} onChange={(e) => setF("markingSecondaryIp", e.target.value)} placeholder={["USB_SERIAL", "SERIAL"].includes(String(form.markingSecondaryProtocol || "").toUpperCase()) ? "COM5" : "192.168.1.60"} mono />
                              </div>
                              <div>
                                <Label>{["USB_SERIAL", "SERIAL"].includes(String(form.markingSecondaryProtocol || "").toUpperCase()) ? "Baud / Port (optional)" : "Secondary Port"}</Label>
                                <FInput value={form.markingSecondaryPort} onChange={(e) => setF("markingSecondaryPort", e.target.value)} placeholder={["USB_SERIAL", "SERIAL"].includes(String(form.markingSecondaryProtocol || "").toUpperCase()) ? "9600" : "9001"} mono />
                              </div>
                              <div>
                                <Label>Customer QR Key</Label>
                                <FInput value={form.markingCustomerQrKey} onChange={(e) => setF("markingCustomerQrKey", e.target.value)} placeholder="customer_qr" mono />
                              </div>
                              <div>
                                <Label>Secondary COM Port (if serial)</Label>
                                <FInput value={form.markingSecondaryComPort} onChange={(e) => setF("markingSecondaryComPort", e.target.value)} placeholder="COM5" mono />
                              </div>
                              <div style={{ display: "flex", alignItems: "flex-end" }}>
                                <button
                                  type="button"
                                  onClick={() => handleTestConnection({ useMarking: true })}
                                  style={{
                                    display: "inline-flex", alignItems: "center", gap: 6,
                                    padding: "8px 12px", borderRadius: 8,
                                    border: `1px solid ${C.greenBd}`, background: C.greenLt, color: C.green,
                                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                                  }}
                                >
                                  <Zap size={12} /> Test Marking Source
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </SectionCard>

                      

                      {String(form.spcMode || "").toUpperCase() === "FOLDER" && (
                        <SectionCard title="Folder Source Settings" subtitle="TXT/CSV/LOG/JSON from machine software" icon={Database}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 140px 170px", gap: 10 }}>
                            <div>
                              <Label>Folder Path</Label>
                              <FInput value={form.spcFolderPath} onChange={(e) => setF("spcFolderPath", e.target.value)} placeholder="C:\\MachineData\\Output" mono />
                            </div>
                            <div>
                              <Label>Pattern</Label>
                              <FInput value={form.spcFolderPattern} onChange={(e) => setF("spcFolderPattern", e.target.value)} placeholder="*.csv" mono />
                            </div>
                            <div>
                              <Label>Parser</Label>
                              <FSelect value={form.spcFolderParser} onChange={(e) => setF("spcFolderParser", e.target.value)}>
                                {PARSER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </FSelect>
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
                              <Toggle
                                checked={form.spcFolderDeleteAfterRead !== false}
                                onChange={(v) => setF("spcFolderDeleteAfterRead", v)}
                                label="Delete After Read"
                                color={C.amber}
                              />
                            </div>
                          </div>
                        </SectionCard>
                      )}

               

                    

                  

                   
                    </>
                  )}
                </div>
              )}

            </form>

            {/* Modal footer */}
            <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, background: C.card, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: 11, color: C.hint, margin: 0 }}>
                {FORM_TABS.find((t) => t.id === activeTab)?.label} · {editingId ? "Editing" : "New machine"}
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={closeModal}
                  style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.sec, cursor: "pointer" }}>
                  Cancel
                </button>
                <button type="submit" form="mf" disabled={saving}
                  style={{ padding: "8px 20px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", background: saving ? C.hint : C.text, color: "#fff", cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, opacity: saving ? 0.6 : 1 }}>
                  <Save size={13} />{saving ? "Saving…" : editingId ? "Update Machine" : "Create Machine"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TEST CONNECTION MODAL ─────────────────────────────────────────── */}
      {showTestModal && (
        <div style={modalOv}>
          <div style={{ position: "absolute", inset: 0 }} onClick={() => setShowTestModal(false)} />
          <div style={{
            position: "relative", width: "100%", maxWidth: 500,
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, overflow: "hidden",
            boxShadow: "0 20px 50px rgba(15,23,42,.18)",
            maxHeight: "82vh",
          }}>
            <div style={{ height: 3, background: `linear-gradient(90deg,${C.green},${C.blue})` }} />
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Zap size={14} color={C.green} />
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Test Connection & Review Data</h2>
              </div>
              <button onClick={() => setShowTestModal(false)} style={{ width: 28, height: 28, border: `1px solid ${C.border}`, borderRadius: 6, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.hint }}>
                <X size={13} />
              </button>
            </div>
            <div style={{ padding: 18, background: C.bg, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", maxHeight: "60vh" }}>
              {testing ? (
                <div style={{ padding: "40px 20px", textAlign: "center", color: C.hint }}>
                  <RefreshCw size={28} style={{ margin: "0 auto 10px", opacity: 0.8, animation: "spin 1s linear infinite" }} color={C.blue} />
                  <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Connecting to quality data source...</p>
                  <p style={{ fontSize: 11, color: C.hint, marginTop: 4 }}>Mode: {form.spcMode} · Endpoint: {form.spcSourceIp || "Localhost"}</p>
                </div>
              ) : testResult ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{
                    padding: "10px 12px",
                    background: testResult.outcome === "FAIL" ? C.redLt : C.greenLt,
                    border: `1px solid ${testResult.outcome === "FAIL" ? C.redBd : C.greenBd}`,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}>
                    {testResult.outcome === "FAIL" ? <XCircle size={16} color={C.red} /> : <CheckCircle2 size={16} color={C.green} />}
                    <div>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: testResult.outcome === "FAIL" ? C.red : C.green }}>
                        {testResult.outcome === "FAIL" ? "Connection Failed" : "Connection Successful"}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: 10, color: C.sec }}>{testResult.message}</p>
                    </div>
                  </div>

                  <div>
                    <Label>Sample Payload Received</Label>
                    <pre style={{
                      margin: "4px 0 0", padding: 12,
                      background: "#0f172a", color: "#38bdf8",
                      borderRadius: 8, border: "1px solid #334155",
                      fontFamily: "ui-monospace,monospace", fontSize: 11,
                      overflowX: "auto",
                      overflowY: "auto",
                      maxHeight: 220,
                    }}>
                      {JSON.stringify(testResult.payload, null, 2)}
                    </pre>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.text }}>Parsed Quality Outcome</p>
                      <p style={{ margin: "2px 0 0", fontSize: 9, color: C.hint }}>Evaluated using key: "{form.spcPayloadKey}" and NG values: [{form.spcNgValues}]</p>
                    </div>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 800,
                      background: testResult.outcome === "FAIL" ? C.redLt : C.greenLt,
                      color: testResult.outcome === "FAIL" ? C.red : C.green,
                      border: `1px solid ${testResult.outcome === "FAIL" ? C.redBd : C.greenBd}`
                    }}>
                      {testResult.outcome === "FAIL" ? <XCircle size={12} /> : <CheckCircle2 size={12} />} {testResult.outcome}
                    </span>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: C.red }}>No test data available.</p>
              )}
            </div>
            <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.border}`, background: C.card, display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowTestModal(false)}
                style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", background: C.text, color: "#fff", cursor: "pointer" }}>
                Close Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW MODAL ─────────────────────────────────────────────────────── */}
      {viewMachine && (
        <div style={modalOv}>
          <div style={{ position: "absolute", inset: 0 }} onClick={() => setViewMachine(null)} />
          <div style={{
            position: "relative", width: "100%", maxWidth: 700,
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, overflow: "hidden",
            boxShadow: "0 20px 50px rgba(15,23,42,.18)",
          }}>
            <div style={{ height: 3, background: `linear-gradient(90deg,${C.text},${C.blue})` }} />
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>{viewMachine.machineName}</h2>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: C.hint }}>
                  {viewMachine.operationNo} · {viewMachine.machineType || "—"} · {viewMachine.lineName || "—"}
                </p>
              </div>
              <button onClick={() => setViewMachine(null)} style={{ width: 28, height: 28, border: `1px solid ${C.border}`, borderRadius: 6, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.hint }}>
                <X size={13} />
              </button>
            </div>
            <div style={{ padding: 18, maxHeight: "70vh", overflowY: "auto", background: C.bg, display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Network summary */}
              <SectionCard title="Network & PLC" icon={Network} collapsible>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, fontSize: 12 }}>
                  {[
                    ["IP", viewMachine.plcIp || "—"],
                    ["Port", viewMachine.plcPort || "—"],
                    ["Protocol", viewMachine.plcProtocol || "—"],
                    ["Device", viewMachine.plcDevice || "D"],
                    ["Status", viewMachine.status],
                    ["PLC Enabled", viewMachine.plcEnabled !== false ? "Yes" : "No"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ padding: "8px 10px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                      <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: C.hint }}>{k}</p>
                      <p style={{ margin: "3px 0 0", fontFamily: "ui-monospace,monospace", fontWeight: 700, color: C.blue }}>{String(v)}</p>
                    </div>
                  ))}
                </div>
              </SectionCard>

              {/* Signal map */}
              {Array.isArray(viewMachine.plcConfig?.handshakeMap) && viewMachine.plcConfig.handshakeMap.length > 0 && (
                <SectionCard title={`Signal Map (${viewMachine.plcConfig.handshakeMap.length})`} icon={Signal} collapsible>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {[...viewMachine.plcConfig.handshakeMap].sort((a, b) => (a.seq || 0) - (b.seq || 0)).map((s, i) => {
                      const cc = catColor(s.category || "control");
                      return (
                        <div key={s.id || i} style={{
                          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                          padding: "6px 10px", borderRadius: 6,
                          background: C.card, border: `1px solid ${C.border}`,
                          borderLeft: `3px solid ${cc.color}`,
                          fontSize: 11,
                        }}>
                          <span style={{ fontSize: 9, fontWeight: 800, color: C.hint, fontFamily: "ui-monospace,monospace", minWidth: 18 }}>{s.seq}</span>
                          <DirBadge dir={s.direction || "READ"} />
                          <strong style={{ color: C.text }}>{s.signal || `Signal ${i + 1}`}</strong>
                          <span style={{ color: C.hint }}>|</span>
                          <span style={{ fontFamily: "ui-monospace,monospace", color: C.blue, fontWeight: 700 }}>
                            {s.device || viewMachine.plcDevice || "D"}{s.register || "—"}
                          </span>
                          <span style={{ fontFamily: "ui-monospace,monospace", color: C.text }}>= {s.value ?? "—"}</span>
                          <span style={{ color: C.sec, flex: 1 }}>{s.meaning || ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}

              {/* Data register ranges */}
              {Array.isArray(viewMachine.plcConfig?.dataRegisterRanges) && viewMachine.plcConfig.dataRegisterRanges.length > 0 && (
                <SectionCard title={`Data Register Ranges (${viewMachine.plcConfig.dataRegisterRanges.length})`} icon={TableProperties} collapsible>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {viewMachine.plcConfig.dataRegisterRanges.map((r, i) => {
                      const start = toNum(r.startReg);
                      const count = Math.min(toNum(r.count, 1), 32);
                      const regStr = start !== null ? `${r.device || "D"}${start}${count > 1 ? ` – ${r.device || "D"}${start + count - 1}` : ""}` : "—";
                      return (
                        <div key={r.id || i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }}>
                          <span style={{ fontFamily: "ui-monospace,monospace", fontWeight: 700, color: C.blue, minWidth: 90 }}>{regStr}</span>
                          <strong style={{ color: C.text }}>{r.name || "—"}</strong>
                          <span style={{ color: C.hint }}>×{r.scale || "1"} {r.unit || ""}</span>
                          {(r.toleranceMin !== "" && r.toleranceMin !== null) && (
                            <span style={{ color: C.teal, fontFamily: "ui-monospace,monospace" }}>tol: {r.toleranceMin}…{r.toleranceMax}</span>
                          )}
                          <span style={{ color: C.sec, flex: 1 }}>{r.purpose || ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── BYPASS MODAL ──────────────────────────────────────────────────── */}
      {bypassMachine && (
        <div style={modalOv}>
          <div style={{ position: "absolute", inset: 0 }} onClick={() => setBypassMachine(null)} />
          <div style={{ position: "relative", width: "100%", maxWidth: 460, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 20px 50px rgba(15,23,42,.18)" }}>
            <div style={{ height: 3, background: `linear-gradient(90deg,${C.text},${C.amber})` }} />
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Machine Bypass — {bypassMachine.machineName}</h2>
              <button onClick={() => setBypassMachine(null)} style={{ width: 28, height: 28, border: `1px solid ${C.border}`, borderRadius: 6, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.hint }}><X size={13} /></button>
            </div>
            <form onSubmit={submitBypass} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, background: C.bg }}>
              <div style={{ display: "flex", gap: 10 }}>
                {[
                  { v: true,  icon: <ShieldOff size={14} />,  label: "Enable Bypass",  color: C.amber, bg: C.amberLt, bd: C.amberBd },
                  { v: false, icon: <ShieldCheck size={14} />, label: "Disable Bypass", color: C.green, bg: C.greenLt, bd: C.greenBd },
                ].map((opt) => (
                  <button key={String(opt.v)} type="button" onClick={() => setBypassEnabled(opt.v)}
                    style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: `2px solid ${bypassEnabled === opt.v ? opt.bd : C.border}`, background: bypassEnabled === opt.v ? opt.bg : C.card, color: bypassEnabled === opt.v ? opt.color : C.sec, fontWeight: 700, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    {opt.icon}{opt.label}
                  </button>
                ))}
              </div>
              <div>
                <Label>Reason</Label>
                <FInput value={bypassReason} onChange={(e) => setBypassReason(e.target.value)} placeholder="MANUAL_BYPASS" />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" onClick={() => setBypassMachine(null)}
                  style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.sec, cursor: "pointer" }}>
                  Cancel
                </button>
                <button type="submit" disabled={bypassing}
                  style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, borderRadius: 7, border: "none", background: bypassEnabled ? C.amber : C.green, color: "#fff", cursor: "pointer", opacity: bypassing ? 0.6 : 1 }}>
                  {bypassing ? "Saving…" : bypassEnabled ? "Enable Bypass" : "Disable Bypass"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CONFIRM DELETE ────────────────────────────────────────────────── */}
      <ConfirmModal
        isOpen={Boolean(deleteId)} title="Remove machine?"
        message="This will remove the machine from the registry. Historical data is preserved."
        confirmText="Delete" cancelText="Cancel" variant="danger"
        onConfirm={handleDelete} onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
