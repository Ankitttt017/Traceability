import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL } from "../constants/network";
import {
  AlertTriangle, CheckCircle2, Clock3, Factory,
  Gauge, RefreshCw, ShieldCheck, Wrench,
  Wifi, WifiOff, Activity, TrendingUp,
  BarChart2, Target, Cpu, Radio, Maximize2, Minimize2,
  ChevronDown, ChevronUp, Menu, X
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line,
} from "recharts";
import SafeChart from "../components/charts/SafeChart";
import { machineApi, scannerApi, stationSettingsApi, traceabilityApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import ConfirmModal from "../components/ConfirmModal";
import { getMachineStage } from "../utils/machineFields";
import { getStationFeatureSettings, getStationFeatures, saveStationFeatureSettings } from "../utils/stationSettings";


const LIVE_REFRESH_COOLDOWN = 350;
const QR_EVENT_DEDUPE_MS = 3000;
const POPUP_EVENT_DEDUPE_MS = 1800;
const QR_STORAGE_KEY = "operator-last-qr-signal";
const OPERATOR_STATION_LOCK_KEY = "operator-view-station-lock-v1";
const OPERATOR_FULLSCREEN_KEY = "operator-view-fullscreen-v1";
const USB_FOCUS_INTERVAL_MS = 300;
const USB_IDLE_FLUSH_MS = 120;
const USB_SCAN_MAX_GAP_MS = 80;
const POPUP_STARTUP_GRACE_MS = 1500;
const POPUP_STALE_EVENT_MS = 12000;
const SOCKET_EVENT_DEDUPE_MS = 800;

// ── Design tokens & responsive breakpoints ───────────────────────────────
const DS = `
  @keyframes ovSpin   { to{transform:rotate(360deg)} }
  @keyframes ovFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes ovPulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes ovPing   { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.2);opacity:0} }
  @keyframes ovSlideIn { from{opacity:0;transform:translateX(-12px)} to{opacity:1;transform:translateX(0)} }
  
  :root{
    --ov-navy:  26,50,99;   --ov-steel: 84,119,146;
    --ov-amber: 250,185,91; --ov-linen: 232,226,219;
    --ov-ok:    34,197,94;  --ov-ng:    239,68,68;
    --ov-wip:   249,115,22; --ov-idle:  148,163,184;
    --ov-breakpoint-sm: 640px;
    --ov-breakpoint-md: 768px;
    --ov-breakpoint-lg: 1024px;
    --ov-breakpoint-xl: 1280px;
    --ov-breakpoint-2xl: 1536px;
  }
  [data-theme="light"]{
    --ov-bg-card:   255,255,255; --ov-bg-surf:  244,247,252;
    --ov-bg-input:  255,255,255;
    --ov-txt-pri:   23,37,66;    --ov-txt-sec:  64,89,120;
    --ov-txt-muted: 88,110,140;
    --ov-bdr: 84,119,146; --ov-bop: 0.18;
  }
  [data-theme="dark"]{
    --ov-bg-card:   20,32,56;  --ov-bg-surf:  16,26,46;
    --ov-bg-input:  12,21,39;
    --ov-txt-pri:   238,244,252; --ov-txt-sec: 180,203,228;
    --ov-txt-muted: 136,161,189;
    --ov-bdr: 112,144,178; --ov-bop: 0.28;
  }
  
  /* Responsive base */
  * {
    box-sizing: border-box;
  }
  
  @media (max-width: 640px) {
    .ov-hide-sm { display: none !important; }
    .ov-stack-sm { flex-direction: column !important; align-items: stretch !important; }
  }
  
  @media (min-width: 641px) and (max-width: 1023px) {
    .ov-hide-md { display: none !important; }
  }
`;
let _ovDS = false;
function injectDS() {
  if (_ovDS || typeof document === "undefined") return;
  _ovDS = true;
  const el = document.createElement("style"); el.textContent = DS; document.head.appendChild(el);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme", "dark");
}

const C = {
  navy: (o = 1) => `rgba(var(--ov-navy),${o})`,
  steel: (o = 1) => `rgba(var(--ov-steel),${o})`,
  amber: (o = 1) => `rgba(var(--ov-amber),${o})`,
  linen: (o = 1) => `rgba(var(--ov-linen),${o})`,
  ok: (o = 1) => `rgba(var(--ov-ok),${o})`,
  ng: (o = 1) => `rgba(var(--ov-ng),${o})`,
  wip: (o = 1) => `rgba(var(--ov-wip),${o})`,
  idle: (o = 1) => `rgba(var(--ov-idle),${o})`,
  bg: (v = "card") => `rgb(var(--ov-bg-${v}))`,
  txt: (v = "pri") => `rgb(var(--ov-txt-${v}))`,
  bdr: (o) => `rgba(var(--ov-bdr),${o || "var(--ov-bop)"})`,
};
const SH = `0 8px 22px rgba(var(--ov-navy),.16),0 2px 8px rgba(0,0,0,.12)`;
const SHM = `0 14px 34px rgba(var(--ov-navy),.2),0 4px 12px rgba(0,0,0,.16)`;

// ── Utility functions ────────────────────────────────────────────────────
function normalizePartId(v) { return String(v || "").trim(); }
function extractQrDecision(payload = {}) {
  const p = String(payload.qrResult || payload.decision || payload.outcome || payload.scanOutcome || payload.qrDecision || payload.qrStatus || "").trim().toUpperCase();
  if (p) return p;
  const f = String(payload.reason || payload.result || payload.validationResult || "").trim().toUpperCase();
  if (["PASS", "OK", "ALLOW"].includes(f)) return "ALLOW";
  if (["FAIL", "NG", "BLOCK", "REJECT"].includes(f)) return "BLOCK";
  // Validation failure reasons should still be treated as BLOCK for popup + operator visibility.
  if (
    [
      "INVALID_QR_FORMAT",
      "QR_RULE_CONFIG_ERROR",
      "PART_NOT_FOUND",
      "PREVIOUS_STATION_NOT_COMPLETED",
      "CUSTOMER_CODE_INVALID",
      "CUSTOMER_CODE_RULE_INVALID",
      "INVALID_INPUT",
      "STATION_NOT_CONFIGURED",
      "STATION_NOT_FOUND",
      "PART_INTERLOCKED",
      "MACHINE_RUNNING",
      "DUPLICATE_SCAN",
      "ALREADY_COMPLETED",
      "DUPLICATE_SCAN_IN_FLIGHT",
      "SCAN_RESULT_NG",
    ].includes(f)
  ) {
    return "BLOCK";
  }
  return "";
}
function hasQrDecision(payload = {}) {
  return ["ALLOW", "PASS", "OK", "ACCEPT", "VALID", "BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(extractQrDecision(payload));
}
function toQrSignal(payload = {}) {
  const d = extractQrDecision(payload);
  const isPass = ["ALLOW", "PASS", "OK", "ACCEPT", "VALID"].includes(d);
  const isFail = ["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(d);
  return {
    id: `${Date.now()}-${Math.random()}`,
    label: isPass ? "QR PASS" : isFail ? "QR FAIL" : "QR WAIT",
    variant: isPass ? "ok" : isFail ? "ng" : "idle",
    partId: normalizePartId(payload.partId || payload.part_id),
    stationNo: String(payload.stationNo || payload.station_no || "").trim().toUpperCase(),
    decision: d,
    reason: String(payload.reason || payload.qrReason || "").trim(),
    message: String(payload.message || "").trim(),
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}
function formatScanErrorMessage(payload = {}) {
  const reason = String(payload.reason || "").trim().toUpperCase();
  const station = String(payload.stationNo || payload.station_no || "").trim().toUpperCase();
  const expected = String(payload.expectedStation || payload.expected_station || "").trim().toUpperCase();
  const rawMessage = String(payload.message || payload.error || "").trim();
  const msgUpper = rawMessage.toUpperCase();
  if (reason === "DUPLICATE_SCAN") return "Duplicate scan. Operation has already passed.";
  if (reason === "ALREADY_COMPLETED") return "Duplicate scan. Operation has already passed.";
  if (reason === "DUPLICATE_SCAN_IN_FLIGHT") return "Scan already in progress. Wait for current cycle processing.";
  if (reason === "RESET_REQUIRED_AFTER_PLC_COMM_ERROR") return `Previous PLC cycle timed out at ${station || "station"}. Use Reset Operation, then scan again.`;
  if (reason.startsWith("PLC_TIMEOUT")) return "PLC response timeout. Use Reset Operation, then scan again.";
  if (reason === "PREVIOUS_STATION_NOT_COMPLETED") {
    const lastCompleted = String(payload.lastCompletedStation || payload.last_completed_station || "").trim().toUpperCase();
    if (expected && lastCompleted) return `Sequence mismatch. Scan at ${expected} first. Last completed station: ${lastCompleted}.`;
    if (expected) return `Sequence mismatch. Scan at ${expected} first.`;
    return "Station sequence error. Previous station is not completed.";
  }
  if (reason === "INVALID_QR_FORMAT") return rawMessage || "Invalid QR format. Scan correct component code.";
  if (reason === "PART_NOT_FOUND" || msgUpper.includes("PART NOT FOUND") || msgUpper.includes("NOT FOUND IN MOULDING")) {
    return "Part not found in moulding records. Verify scanned QR and bridge source data.";
  }
  if (reason === "QR_RULE_CONFIG_ERROR") return String(payload.message || "").trim() || "QR rule configuration is invalid. Contact supervisor.";
  if (reason === "PART_INTERLOCKED") return "Part is NG. Please reject this part and send to rejection flow.";
  if (reason === "MACHINE_RUNNING") return String(payload.message || "").trim() || "Machine is currently busy with another cycle.";
  if (reason === "STATION_NOT_CONFIGURED" || reason === "STATION_NOT_FOUND" || msgUpper.includes("STATION NOT FOUND")) {
    return `Station ${station || "selected station"} is not configured in active route. Check Machine + Station Control mapping.`;
  }
  if (reason === "CUSTOMER_CODE_INVALID") return "Customer code mismatch in scanned QR.";
  if (reason === "CUSTOMER_CODE_RULE_INVALID") return "Customer code rule configuration is invalid. Contact supervisor.";
  if (reason === "INVALID_INPUT") return "Invalid scan input. Re-scan the QR code.";
  if (reason === "SCAN_RESULT_NG") return "This part is marked NG. Please reject this part and send to rejection flow.";
  if (msgUpper.includes("PREVIOUS_STATION_NOT_COMPLETED")) return expected ? `Previous station not completed with OP number ${expected}.` : "Station sequence error. Previous station not completed.";
  if (msgUpper.includes("INVALID_QR_FORMAT") || msgUpper.includes("QR FORMAT MISMATCH")) return "QR format mismatch. Scan correct component code.";
  if (msgUpper.includes("DUPLICATE_SCAN") || msgUpper.includes("ALREADY_COMPLETED")) return "Duplicate scan. Operation has already passed.";
  if (msgUpper.includes("SCAN_RESULT_NG")) return "This part is marked NG. Send it to rejection flow.";
  if (reason) return reason.replaceAll("_", " ");
  return rawMessage.replace(/\s+/g, " ").trim() || "Process blocked. Contact supervisor.";
}
function shouldSuppressPopupPayload(payload = {}) {
  const partId = normalizePartId(payload.partId || payload.part_id);
  const station = String(payload.stationNo || payload.station_no || "").trim();
  const message = String(payload.message || payload.error || "").trim().toUpperCase();
  if (!partId && !station && !message) return true;
  return false;
}
function normalizeDecisionState(value) {
  const n = String(value || "").trim().toUpperCase();
  if (["ALLOW", "PASS", "OK", "ACCEPT", "VALID"].includes(n)) return "PASS";
  if (["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(n)) return "FAIL";
  if (n === "WAIT") return "WAIT";
  return "";
}
function isResetLikePayload(payload = {}) {
  const status = String(payload.status || payload.plcStatus || payload.plc_status || "").trim().toUpperCase();
  const reason = String(payload.reason || payload.qrReason || "").trim().toUpperCase();
  const message = String(payload.message || "").trim().toUpperCase();
  return status === "RESET" || reason.includes("RESET") || message.includes("RESET");
}
function normalizeOperationState(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (["PASSED", "PASS", "ENDED_OK", "COMPLETED", "COMPLETED_OK", "COMPLETED_NG"].includes(raw)) return "PASS";
  if (["FAILED", "FAIL", "ENDED_NG", "NG"].includes(raw)) return "FAIL";
  if (["RUNNING", "STARTED", "IN_PROGRESS", "IN PROCESS"].includes(raw)) return "RUN";
  if (["WAITING_MACHINE", "START_SENT", "WAITING_RUNNING", "WAITING_PLC", "WAITING", "OP_WAIT", "SCANNED", "VALIDATED", "PENDING"].includes(raw)) return "WAIT";
  if (["PLC_TIMEOUT", "TIMEOUT", "COMM_ERROR", "PLC_COMM_ERROR"].includes(raw)) return "COMM";
  if (["INTERLOCKED", "BLOCKED"].includes(raw)) return "BLOCKED";
  return "";
}
function makeEventIdentityKey(payload = {}) {
  const partId = normalizePartId(payload.partId || payload.part_id);
  const stationNo = String(payload.stationNo || payload.station_no || "").trim().toUpperCase();
  const machineId = String(payload.machineId || payload.machine_id || "").trim();
  const decision = normalizeDecisionState(payload.qrResult || payload.qr_result || payload.decision || payload.qrStatus);
  const opState = normalizeOperationState(payload.operationStatus || payload.plcStatus || payload.plc_status || payload.status);
  const reason = String(payload.reason || payload.qrReason || "").trim().toUpperCase();
  return [partId, stationNo, machineId, decision, opState, reason].join("|");
}

function parsePayloadTimeMs(payload = {}) {
  const tokens = [
    payload.timestamp,
    payload.createdAt,
    payload.updatedAt,
    payload._shownAtMs,
  ];
  for (const token of tokens) {
    if (token === undefined || token === null || token === "") continue;
    const n = Number(token);
    if (Number.isFinite(n) && n > 0) return n;
    const t = new Date(token).getTime();
    if (Number.isFinite(t) && t > 0) return t;
  }
  return 0;
}
function getOperationVariant(status) {
  const s = String(status || "").trim().toUpperCase();
  if (["ENDED_OK", "PASSED", "COMPLETED", "COMPLETED_OK"].includes(s)) return "ok";
  if (["ENDED_NG", "COMPLETED_NG", "FAILED", "NG"].includes(s)) return "ng";
  if (["PLC_TIMEOUT", "TIMEOUT", "PLC_ERROR", "COMM_ERROR", "PLC_COMM_ERROR"].includes(s)) return "ng";
  if (["RUNNING", "STARTED", "IN_PROGRESS"].includes(s)) return "wip";
  if (["WAITING_MACHINE", "START_SENT", "WAITING_RUNNING", "WAITING_PLC"].includes(s)) return "wip";
  if (["SCANNED", "VALIDATED", "PENDING", "WAITING_OP"].includes(s)) return "idle";
  return "idle";
}
function getOperationLabel(status) {
  const s = String(status || "").trim().toUpperCase();
  if (["ENDED_OK", "PASSED", "COMPLETED", "COMPLETED_OK"].includes(s)) return "Pass";
  if (["ENDED_NG", "COMPLETED_NG", "FAILED", "NG"].includes(s)) return "Fail";
  if (["RUNNING", "STARTED", "IN_PROGRESS"].includes(s)) return "OP RUNNING";
  if (["WAITING_MACHINE", "START_SENT", "WAITING_RUNNING", "WAITING_PLC"].includes(s)) return "WAITING MACHINE";
  if (["SCANNED", "VALIDATED", "PENDING", "WAITING_OP", "WAITING"].includes(s)) return "OP WAIT";
  if (["PLC_TIMEOUT", "TIMEOUT", "PLC_ERROR", "COMM_ERROR", "PLC_COMM_ERROR"].includes(s)) return "PLC FAULT";
  if (["INTERLOCKED", "BLOCKED"].includes(s)) return "BLOCKED";
  if (s === "RECOVERING" || s === "RESETTING") return "Resetting";
  return "Idle";
}

function getPassOperationStatusForStation(stationNo, stationSettings) {
  const station = String(stationNo || "").trim().toUpperCase();
  const features = getStationFeatures(station, stationSettings);
  return features?.manualResult === true ? "WAITING_MACHINE" : "PASSED";
}
function fmtTime(v) { if (!v) return "—"; const d = new Date(v); return isNaN(d) ? "—" : d.toLocaleTimeString(); }
function fmtDT(v) { if (!v) return "—"; const d = new Date(v); return isNaN(d) ? "—" : d.toLocaleString(); }
function formatElapsed(timestamp, now) {
  if (!timestamp) return "0m 00s";
  const s = String(timestamp || ""); if (!s) return "0m 00s";
  const start = new Date(s).getTime(); if (isNaN(start)) return "0m 00s";
  const diff = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), sec = diff % 60;
  if (h > 0) return `${h}h ${m}m ${String(sec).padStart(2, "0")}s`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

// ── Responsive Atoms ─────────────────────────────────────────────────────
const STATUS_MAP = {
  ok: { fg: C.ok(), bg: C.ok(0.16), bd: C.ok(0.38) },
  ng: { fg: C.ng(), bg: C.ng(0.16), bd: C.ng(0.38) },
  wip: { fg: C.wip(), bg: C.wip(0.16), bd: C.wip(0.38) },
  idle: { fg: C.idle(), bg: C.idle(0.14), bd: C.idle(0.3) },
};

const Badge = ({ variant = "idle", label, pulse, size = "sm" }) => {
  const s = STATUS_MAP[variant] || STATUS_MAP.idle;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: size === "lg" ? "5px 14px" : "3px 10px",
      borderRadius: 99,
      fontSize: size === "lg" ? 13 : 11, fontWeight: 700,
      letterSpacing: "0.04em",
      color: s.fg, background: s.bg, border: `1px solid ${s.bd}`,
      whiteSpace: "nowrap",
    }}>
      <span style={{
        width: size === "lg" ? 8 : 5, height: size === "lg" ? 8 : 5,
        borderRadius: "50%", background: s.fg, flexShrink: 0,
        animation: pulse ? "ovPulse 1.2s ease-in-out infinite" : "none"
      }} />
      {label}
    </span>
  );
};

const ConnDot = ({ connected }) => (
  <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
    {connected && (
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: C.ok(0.4), animation: "ovPing 1.8s ease-out infinite"
      }} />
    )}
    <div style={{
      width: 10, height: 10, borderRadius: "50%", position: "relative",
      background: connected ? C.ok() : C.ng()
    }} />
  </div>
);

const InfoRow = ({ label, value, mono, valueColor }) => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.bdr(0.35)}`,
    flexWrap: "wrap", minWidth: 0,
  }}>
    <span style={{ fontSize: 11, color: C.txt("sec"), fontWeight: 700, flexShrink: 0 }}>{label}</span>
    <span style={{
      fontSize: 11, fontWeight: 800,
      color: valueColor || C.txt("pri"),
      fontFamily: mono ? "'DM Mono',monospace" : "inherit",
      textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      maxWidth: "min(220px, 100%)",
    }}>{value || "—"}</span>
  </div>
);

const Card = ({ title, icon: Icon, accent, children, right, noPad, collapsible, defaultCollapsed = false }) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const isCollapsible = !!collapsible;

  return (
    <div style={{
      background: C.bg("card"), border: `1px solid ${C.bdr(0.45)}`,
      borderRadius: 14, overflow: "hidden", boxShadow: SH,
      borderLeft: accent ? `4px solid ${accent}` : "none",
      height: collapsed && isCollapsible ? "auto" : "auto",
    }}>
      {(title || right) && (
        <div style={{
          padding: "12px 16px", borderBottom: !collapsed || !isCollapsible ? `1px solid ${C.bdr()}` : "none",
          background: `linear-gradient(180deg, ${C.bg("surf")} 0%, ${C.bg("card")} 100%)`, display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 8,
          cursor: isCollapsible ? "pointer" : "default",
        }} onClick={() => isCollapsible && setCollapsed(!collapsed)}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {Icon && <Icon size={14} color={accent || C.steel()} />}
            <p style={{ fontSize: 13, fontWeight: 800, color: C.txt("pri"), letterSpacing: "0.01em" }}>{title}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {right}
            {isCollapsible && (collapsed ? <ChevronDown size={14} color={C.steel()} /> : <ChevronUp size={14} color={C.steel()} />)}
          </div>
        </div>
      )}
      {(!collapsed || !isCollapsible) && (
        <div style={noPad ? {} : { padding: 16 }}>{children}</div>
      )}
    </div>
  );
};

const FeatureRow = ({ label, enabled }) => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 12px", borderRadius: 8,
    background: C.bg("surf"), border: `1px solid ${C.bdr()}`,
    marginBottom: 5,
  }}>
    <span style={{ fontSize: 12, color: C.txt("pri") }}>{label}</span>
    <span style={{
      fontSize: 11, fontWeight: 700,
      color: enabled ? C.ok() : C.txt("muted"),
      padding: "2px 8px", borderRadius: 99,
      background: enabled ? C.ok(0.1) : C.idle(0.08),
      border: `1px solid ${enabled ? C.ok(0.25) : C.bdr()}`,
    }}>
      {enabled ? "Enabled" : "Disabled"}
    </span>
  </div>
);

const DecisionDisplay = ({ label, variant, sub1, sub2, accent, compact = false }) => {
  const s = STATUS_MAP[variant] || STATUS_MAP.idle;
  const stateText = variant === "ok" ? "PASS" : variant === "ng" ? "FAIL" : variant === "wip" ? "RUNNING" : "WAITING";
  return (
    <div style={{
      borderRadius: 12, padding: compact ? "10px 12px" : "14px 16px",
      background: s.bg, border: `1px solid ${s.bd}`,
      borderLeft: accent ? `3px solid ${s.fg}` : "none",
      boxShadow: `inset 0 0 0 1px ${s.bd}`,
    }}>
      <p style={{
        fontSize: 10, fontWeight: 800, textTransform: "uppercase",
        letterSpacing: "0.1em", color: C.txt("sec"), marginBottom: 6
      }}>{label}</p>
      <p style={{
        fontSize: compact ? 18 : 24, fontWeight: 900, color: s.fg, lineHeight: 1,
        fontFamily: "DM Mono, monospace", marginBottom: 6
      }}>
        {stateText}
      </p>
      {sub1 && <p style={{ fontSize: 11, color: C.txt("pri"), fontFamily: "DM Mono, monospace", fontWeight: 700, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub1}</p>}
      {sub2 && <p style={{ fontSize: 10, color: C.txt("sec"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub2}</p>}
    </div>
  );
};

// Responsive Gauge Component
const ResponsiveGauge = ({ progressPct, qualityPct, producedCount, expectedCount, compact }) => {
  const size = compact ? 120 : 160;
  const strokeWidth = compact ? 10 : 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progressPct / 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: compact ? "4px 0 8px" : "8px 0 16px" }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke={C.bdr(0.3)} strokeWidth={strokeWidth} />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke={qualityPct >= 85 ? C.ok() : qualityPct >= 60 ? C.amber() : C.ng()}
            strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dashoffset .8s ease" }} />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center"
        }}>
          <p style={{
            fontSize: compact ? 28 : 36, fontWeight: 900, color: C.txt("pri"),
            fontFamily: "'DM Mono',monospace", lineHeight: 1
          }}>{progressPct}%</p>
          <p style={{
            fontSize: compact ? 8 : 10, color: C.txt("muted"), marginTop: 2,
            textTransform: "uppercase", letterSpacing: "0.08em"
          }}>Progress</p>
          <p style={{ fontSize: compact ? 10 : 12, fontWeight: 700, color: C.steel(), marginTop: 2 }}>
            Quality {qualityPct}%
          </p>
        </div>
      </div>
      <div style={{ width: "100%", maxWidth: compact ? 280 : 360, marginTop: compact ? 8 : 12 }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontSize: compact ? 9 : 11, color: C.txt("muted"), marginBottom: 4
        }}>
          <span>Produced: {producedCount}</span>
          <span>Expected: {expectedCount}</span>
        </div>
        <div style={{
          height: compact ? 6 : 8, borderRadius: 99,
          background: C.bdr(0.2), overflow: "hidden"
        }}>
          <div style={{
            height: "100%", borderRadius: 99,
            background: `linear-gradient(90deg,${C.ok()},${C.steel()})`,
            width: `${progressPct}%`, transition: "width .5s ease"
          }} />
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
const OperatorView = () => {
  injectDS();

  const user = useMemo(() => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; } }, []);

  const [machines, setMachines] = useState([]);
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [liveState, setLiveState] = useState(null);
  const [stationStats, setStationStats] = useState(null);
  const [stationSettings, setStationSettings] = useState(() => getStationFeatureSettings());
  const [loadingMachines, setLoadingMachines] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [popup, setPopup] = useState(null);
  const [scanState, setScanState] = useState({
    inputQr: "",
    activePartId: "",
    failedQr: "",
    qrStatus: "IDLE", // IDLE | VERIFYING | PASS | FAIL | BLOCKED
    operationStatus: "WAIT", // WAIT | RUNNING | PASS | FAIL | COMM_ERROR
    manualResultStatus: "IDLE", // IDLE | REQUIRED | SUBMITTING | SUBMITTED
  });
  const usbScannerInputRef = useRef(null);
  const usbBufferRef = useRef("");
  const usbFlushTimerRef = useRef(null);
  const usbLastKeyAtRef = useRef(0);
  const [suppressReadyPopup, setSuppressReadyPopup] = useState(false);
  const [qrSignal, setQrSignal] = useState(null);
  const [qrFeed, setQrFeed] = useState([]);
  const [resetConfirm, setResetConfirm] = useState(null);
  const [clockTick, setClockTick] = useState(Date.now());
  const [stationLock, setStationLock] = useState(() => {
    try {
      const raw = localStorage.getItem(OPERATOR_STATION_LOCK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [showStationSelectModal, setShowStationSelectModal] = useState(false);
  const [pendingMachineId, setPendingMachineId] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(() => {
    if (typeof document === "undefined") return false;
    return Boolean(document.fullscreenElement);
  });
  const [, setUsbDebug] = useState("");

  // Responsive breakpoints
  const [breakpoint, setBreakpoint] = useState(() => {
    if (typeof window === "undefined") return "xl";
    const w = window.innerWidth;
    if (w < 640) return "sm";
    if (w < 768) return "md";
    if (w < 1024) return "lg";
    if (w < 1280) return "xl";
    return "2xl";
  });

  const selectedMachineIdRef = useRef("");
  const selectedStationRef = useRef("");
  const machinesRef = useRef([]);
  const operatorViewRootRef = useRef(null);
  const liveRefreshTimerRef = useRef(null);
  const operatorViewBootAtRef = useRef(Date.now());
  const lastLiveRefreshRef = useRef(0);
  const lastQrEventRef = useRef({ key: "", at: 0 });
  const lastPopupEventRef = useRef({ key: "", at: 0 });
  const lastSocketIdentityRef = useRef({ key: "", at: 0 });

  const isMobile = breakpoint === "sm" || breakpoint === "md";
  const isTablet = breakpoint === "lg";
  const isCompact = isMobile || isTablet;
  const isTouchDevice =
    typeof window !== "undefined" &&
    (
      ("ontouchstart" in window) ||
      (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0) ||
      window.matchMedia?.("(pointer: coarse)")?.matches
    );
  const isAppDisplayMode = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)")?.matches;
  const isIosStandalone = typeof window !== "undefined" && typeof window.navigator !== "undefined" && window.navigator.standalone === true;
  const isStandaloneAppMode = Boolean(isAppDisplayMode || isIosStandalone);
  const enforceStationLockMode = isCompact || isStandaloneAppMode || isTouchDevice;
  const hasLockedSelection = Boolean(stationLock?.machineId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const w = window.innerWidth;
      if (w < 640) setBreakpoint("sm");
      else if (w < 768) setBreakpoint("md");
      else if (w < 1024) setBreakpoint("lg");
      else if (w < 1280) setBreakpoint("xl");
      else setBreakpoint("2xl");
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);


  const selectedMachine = useMemo(() => machines.find(e => e.id === Number(selectedMachineId)) || null, [machines, selectedMachineId]);
  const selectedStation = useMemo(() => getMachineStage(selectedMachine), [selectedMachine]);

  useEffect(() => { selectedMachineIdRef.current = String(selectedMachineId || ""); }, [selectedMachineId]);
  useEffect(() => { selectedStationRef.current = String(selectedStation || "").toUpperCase(); }, [selectedStation]);
  useEffect(() => { machinesRef.current = Array.isArray(machines) ? machines : []; }, [machines]);

  useEffect(() => {
    try {
      if (stationLock) localStorage.setItem(OPERATOR_STATION_LOCK_KEY, JSON.stringify(stationLock));
      else localStorage.removeItem(OPERATOR_STATION_LOCK_KEY);
    } catch {
      // ignore storage errors
    }
  }, [stationLock]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === operatorViewRootRef.current;
      setIsFullscreen(active);
      try {
        localStorage.setItem(OPERATOR_FULLSCREEN_KEY, active ? "1" : "0");
      } catch {
        // ignore storage errors
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    try {
      if (localStorage.getItem(OPERATOR_FULLSCREEN_KEY) !== "1") return;
    } catch {
      return;
    }
    if (document.fullscreenElement) return;
    const root = operatorViewRootRef.current;
    if (typeof root?.requestFullscreen !== "function") return;
    root.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    if (!enforceStationLockMode) return;
    if (!Array.isArray(machines) || machines.length === 0) return;

    const lockedMachineId = String(stationLock?.machineId || "");
    if (lockedMachineId && machines.some((m) => String(m.id) === lockedMachineId)) {
      if (String(selectedMachineId || "") !== lockedMachineId) {
        setSelectedMachineId(lockedMachineId);
      }
      setShowStationSelectModal(false);
      return;
    }

    if (!stationLock) {
      const fallbackMachineId = String(selectedMachineId || machines[0]?.id || "");
      setPendingMachineId(fallbackMachineId);
      setShowStationSelectModal(true);
    } else {
      setStationLock(null);
      setPendingMachineId(String(machines[0]?.id || ""));
      setShowStationSelectModal(true);
    }
  }, [enforceStationLockMode, machines, selectedMachineId, stationLock]);

  const stationFeatureConfig = useMemo(() => getStationFeatures(selectedStation, stationSettings), [selectedStation, stationSettings]);

  const qualitySummary = stationStats?.summary || { okCount: 0, ngCount: 0, interlockedCount: 0, inProgressCount: 0, processedCount: 0, accuracy: 0 };
  const expectedCount = Math.max(Number(qualitySummary.processedCount || 0) + Number(qualitySummary.inProgressCount || 0) + Number(qualitySummary.interlockedCount || 0), 1);
  const producedCount = Number(qualitySummary.processedCount || 0);
  const progressPct = Math.min(100, Math.round((producedCount / expectedCount) * 100));
  const qualityPct = Number(qualitySummary.accuracy || 0);
  const backendMachineState = String(liveState?.machineState?.state || "").trim().toUpperCase();
  const machineMode =
    ["RUNNING"].includes(backendMachineState)
      ? "Running"
      : ["WAITING_RUNNING", "WAITING_END", "START_SENT", "VALIDATED", "SCANNED", "MACHINE_BUSY", "RECOVERING", "RESETTING"].includes(backendMachineState)
        ? "Waiting"
        : ["PLC_TIMEOUT", "PLC_ERROR", "INTERLOCKED"].includes(backendMachineState)
          ? "Error"
          : liveState?.lastEvent
            ? "Idle"
            : "Waiting";
  const machineClock = formatElapsed(liveState?.current?.createdAt || liveState?.lastEvent?.createdAt, clockTick);

  const currentContext = liveState?.current || stationStats?.current || liveState?.lastEvent || stationStats?.lastEvent || null;
  const hasLiveState = Boolean(liveState);
  const plcHealth = hasLiveState ? liveState?.plcHealth || null : stationStats?.plcHealth || null;
  const scannerHealth = hasLiveState ? liveState?.scannerHealth || null : stationStats?.scannerHealth || null;
  const scannerInfo = hasLiveState ? liveState?.scanner || null : stationStats?.scanner || null;
  const scannerListRaw = hasLiveState ? liveState?.scanners || [] : stationStats?.scanners || [];
  const scannerHealthListRaw = hasLiveState ? liveState?.scannerHealthList || [] : stationStats?.scannerHealthList || [];
  const scannerEntries = useMemo(() => {
    const rows = Array.isArray(scannerListRaw) ? scannerListRaw : [];
    const healthRows = Array.isArray(scannerHealthListRaw) ? scannerHealthListRaw : [];
    const merged = rows.map((scanner) => {
      const health =
        healthRows.find((row) => Number(row?.scannerId || 0) === Number(scanner?.id || 0)) ||
        healthRows.find((row) => String(row?.scannerIp || "").trim() === String(scanner?.scannerIp || "").trim()) ||
        null;
      const scannerModeLocal = String(scanner?.scannerMode || scanner?.mode || "").trim().toUpperCase();
      const usbLike = ["USB_SERIAL", "USB", "USB_HID", "HID"].includes(scannerModeLocal);
      const lastSeenAtRaw = health?.lastSeenAt || health?.lastDataAt || scanner?.lastSeenAt || scanner?.lastDataAt || null;
      const lastSeenAtMs = lastSeenAtRaw ? new Date(lastSeenAtRaw).getTime() : 0;
      const usbActivityGraceMs = 90 * 1000;
      const usbConnectedLocal = Boolean(lastSeenAtMs && (Date.now() - lastSeenAtMs) <= usbActivityGraceMs);
      const connected = usbLike ? usbConnectedLocal : Boolean(health?.connected);
      const configured = String(health?.status || "CONFIGURED").toUpperCase() !== "NOT_CONFIGURED";
      return {
        scanner,
        health,
        configured,
        connected,
        scannerMode: scannerModeLocal,
        statusLabel: !configured ? "Not Set" : usbLike ? (connected ? "USB Active" : "USB Idle") : (connected ? "Online" : "Offline"),
      };
    });
    if (!merged.length && (scannerInfo || scannerHealth)) {
      const scannerModeLocal = String(scannerInfo?.scannerMode || scannerInfo?.mode || "").trim().toUpperCase();
      const usbLike = ["USB_SERIAL", "USB", "USB_HID", "HID"].includes(scannerModeLocal);
      const lastSeenAtRaw = scannerHealth?.lastSeenAt || scannerHealth?.lastDataAt || scannerInfo?.lastSeenAt || scannerInfo?.lastDataAt || null;
      const lastSeenAtMs = lastSeenAtRaw ? new Date(lastSeenAtRaw).getTime() : 0;
      const usbActivityGraceMs = 90 * 1000;
      const connected = usbLike
        ? Boolean(lastSeenAtMs && (Date.now() - lastSeenAtMs) <= usbActivityGraceMs)
        : Boolean(scannerHealth?.connected);
      merged.push({
        scanner: scannerInfo || null,
        health: scannerHealth || null,
        configured: String(scannerHealth?.status || "").toUpperCase() !== "NOT_CONFIGURED",
        connected,
        scannerMode: scannerModeLocal,
        statusLabel: usbLike ? (connected ? "USB Active" : "USB Idle") : (connected ? "Online" : "Offline"),
      });
    }
    return merged;
  }, [hasLiveState, scannerListRaw, scannerHealthListRaw, scannerInfo, scannerHealth]);
  const primaryScannerEntry = scannerEntries.find((entry) => String(entry?.scanner?.scannerRole || "").trim().toUpperCase() === "START_QR") || scannerEntries[0] || null;
  const secondaryScannerEntries = useMemo(() => {
    if (!primaryScannerEntry) return scannerEntries;
    return scannerEntries.filter((entry) => {
      const primaryId = Number(primaryScannerEntry?.scanner?.id || 0);
      const entryId = Number(entry?.scanner?.id || 0);
      if (primaryId && entryId) return entryId !== primaryId;
      return String(entry?.scanner?.scannerIp || "") !== String(primaryScannerEntry?.scanner?.scannerIp || "");
    });
  }, [scannerEntries, primaryScannerEntry]);
  const plcHealthKnown = typeof plcHealth?.healthy === "boolean";
  const plcConnected = plcHealthKnown ? Boolean(plcHealth?.healthy) : null;
  const scannerConfigured = scannerEntries.length > 0 ? scannerEntries.some((entry) => entry.configured) : String(scannerHealth?.status || "").toUpperCase() !== "NOT_CONFIGURED";
  const scannerConnected = scannerEntries.length > 0 ? scannerEntries.some((entry) => entry.connected) : Boolean(scannerHealth?.connected);
  const scannerMode = String(primaryScannerEntry?.scanner?.scannerMode || scannerInfo?.scannerMode || scannerInfo?.mode || "").trim().toUpperCase();
  const isUsbScannerMode = ["USB_SERIAL", "USB", "USB_HID", "HID"].includes(scannerMode);
  const scannerLastSeenAtRaw = primaryScannerEntry?.health?.lastSeenAt || primaryScannerEntry?.health?.lastDataAt || scannerHealth?.lastSeenAt || scannerHealth?.lastDataAt || scannerInfo?.lastSeenAt || scannerInfo?.lastDataAt || null;
  const scannerLastSeenAtMs = scannerLastSeenAtRaw ? new Date(scannerLastSeenAtRaw).getTime() : 0;
  const usbActivityGraceMs = 90 * 1000;
  const usbConnected = Boolean(scannerConfigured && scannerLastSeenAtMs && (Date.now() - scannerLastSeenAtMs) <= usbActivityGraceMs);
  const effectiveScannerConnected = scannerEntries.length > 0 ? scannerConnected : (isUsbScannerMode ? usbConnected : scannerConnected);
  const scannerStatusLabel = !scannerConfigured ? "Not Set" : isUsbScannerMode ? (usbConnected ? "USB Active" : "USB Idle") : (scannerConnected ? "Online" : "Offline");
  const fullscreenGap = isTablet ? 8 : (isCompact ? 10 : 14);
  const fullscreenBottomPadding = isTablet ? 10 : (isCompact ? 14 : 18);
  const contentGap = isFullscreen ? fullscreenGap : (isTablet ? 10 : (isCompact ? 12 : 20));
  const contentBottomPadding = isFullscreen ? fullscreenBottomPadding : (isTablet ? 16 : (isCompact ? 24 : 32));
  const overviewGridColumns = isMobile ? "1fr" : (isTablet ? "repeat(2, 1fr)" : (isFullscreen ? "250px 1fr 240px" : "280px 1fr 260px"));
  const overviewGridGap = isFullscreen ? (isTablet ? 8 : (isCompact ? 10 : 12)) : (isTablet ? 10 : (isCompact ? 12 : 16));
  const headerPadding = isTablet ? "12px 14px" : (isCompact ? "12px 16px" : "16px 20px");
  const headerStripeMargin = isTablet ? "-12px -14px 12px" : (isCompact ? "-12px -16px 12px" : "-16px -20px 14px");
  const headerDirection = isMobile ? "column" : (isTablet ? "column" : "row");
  const headerControlsWidth = isMobile || isTablet ? "100%" : "auto";
  const metricGridColumns = isMobile ? "repeat(2,1fr)" : ((isTablet && isFullscreen) ? "repeat(2,1fr)" : "repeat(4,1fr)");
  const operatorInfoColumns = (isMobile || (isTablet && isFullscreen)) ? "1fr" : "repeat(2,1fr)";
  const bottomSectionColumns = (isMobile || (isTablet && isFullscreen)) ? "1fr" : "1fr 1fr";
  const trendChartHeight = isFullscreen ? (isTablet ? 220 : (isCompact ? 230 : 260)) : (isTablet ? 190 : (isCompact ? 220 : 250));
  const recentEventsMaxHeight = isFullscreen ? (isTablet ? 280 : (isCompact ? 300 : 340)) : (isTablet ? 220 : (isCompact ? 280 : 320));
  const recentEventsVisibleRows = isMobile ? 4 : ((isTablet && isFullscreen) ? 6 : 8);
  const fullscreenPadding = isCompact ? 12 : 20;
  const fullscreenTopPadding = isCompact ? 20 : 28;

  useEffect(() => {
    if (!selectedMachineId || scannerConfigured) return;
    setQrSignal(null);
    setQrFeed([]);
    try {
      const saved = JSON.parse(localStorage.getItem(QR_STORAGE_KEY) || "{}");
      if (Object.prototype.hasOwnProperty.call(saved, String(selectedMachineId))) {
        delete saved[String(selectedMachineId)];
        localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(saved));
      }
    } catch {
      // ignore storage errors
    }
  }, [selectedMachineId, scannerConfigured]);

  const isManualResultStation = useMemo(() => stationFeatureConfig?.manualResult === true, [stationFeatureConfig]);
  const isOperationEnabled = useMemo(() => stationFeatureConfig?.operation !== false, [stationFeatureConfig]);

  const opStatusSource = useMemo(() => {
    if (!isOperationEnabled || isManualResultStation) {
      return currentContext?.plcStatus || "WAIT";
    }
    return liveState?.machineState?.state || currentContext?.plcStatus || "WAIT";
  }, [isOperationEnabled, isManualResultStation, liveState?.machineState?.state, currentContext?.plcStatus]);

  const opVariant = useMemo(() => getOperationVariant(opStatusSource), [opStatusSource]);

  const openScannerReadyPopup = useCallback(() => {
    if (!selectedMachineId || !selectedStation) return;
    const scannerMode = String(scannerInfo?.scannerMode || scannerInfo?.mode || "").trim().toUpperCase();
    const isUsbScannerMode = ["USB_SERIAL", "USB", "USB_HID", "HID"].includes(scannerMode);
    const shouldOpenUsbOrSimulationPopup = Boolean(scannerInfo?.isSimulation) || isUsbScannerMode;
    if (!shouldOpenUsbOrSimulationPopup) return;

    setPopup((prev) => {
      const isActiveScanPopup =
        prev &&
        prev.isSimulationPlaceholder !== true &&
        Boolean(String(prev.partId || prev.part_id || "").trim());
      if (isActiveScanPopup) return prev;

      const nextPopup = {
        partId: "",
        stationNo: selectedStation,
        machineId: selectedMachineId,
        machineName: selectedMachine?.machineName || "",
        type: "INFO",
        title: isUsbScannerMode ? "USB Scanner Active" : "Simulation Active",
        message: isUsbScannerMode
          ? `USB scanner ready at ${selectedStation}. Scan QR to validate.`
          : "Scan Simulation Active. Enter QR code below to validate.",
        isSimulationPlaceholder: true,
        manualScanMode: true,
      };

      const same =
        prev &&
        prev.isSimulationPlaceholder === true &&
        String(prev.stationNo || prev.station_no || "").toUpperCase() === String(nextPopup.stationNo || "").toUpperCase() &&
        String(prev.title || "") === String(nextPopup.title || "") &&
        String(prev.message || "") === String(nextPopup.message || "");

      return same ? prev : nextPopup;
    });
  }, [selectedMachineId, selectedStation, selectedMachine?.machineName, scannerInfo?.isSimulation, scannerInfo?.scannerMode, scannerInfo?.mode]);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      if (document.fullscreenElement) {
        if (typeof document.exitFullscreen === "function") {
          await document.exitFullscreen();
        }
        return;
      }
      const root = operatorViewRootRef.current;
      if (typeof root?.requestFullscreen === "function") {
        await root.requestFullscreen();
      }
    } catch {
      const next = !isFullscreen;
      setIsFullscreen(next);
      try {
        localStorage.setItem(OPERATOR_FULLSCREEN_KEY, next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (!selectedMachineId || !selectedStation) return;
    if (suppressReadyPopup) return;

    // Event-driven popup mode:
    // Do not auto-open popup on initial load/station selection.
    // Popup is opened only on explicit refresh action or live scan trigger events.
    setPopup((prev) => (prev?.isSimulationPlaceholder ? null : prev));
  }, [selectedMachineId, selectedStation, popup, suppressReadyPopup]);

  const quickResetPartId = useMemo(
    () => normalizePartId(currentContext?.partId || popup?.partId || popup?.part_id),
    [currentContext?.partId, popup?.partId, popup?.part_id]
  );
  const quickResetStation = useMemo(
    () => String(popup?.stationNo || popup?.station_no || selectedStation || "").trim().toUpperCase(),
    [popup?.stationNo, popup?.station_no, selectedStation]
  );

  const canQuickReset = useMemo(() => {
    if (!quickResetPartId || !quickResetStation) return false;
    const s = String(currentContext?.plcStatus || "").trim().toUpperCase();
    const r = String(popup?.reason || popup?.qrReason || "").trim().toUpperCase();
    if (["ENDED_NG", "FAILED", "NG", "INTERLOCKED", "BLOCKED", "PLC_COMM_ERROR", "COMM_ERROR", "TIMEOUT", "PLC_TIMEOUT"].includes(s)) return true;
    return ["DUPLICATE_SCAN", "PREVIOUS_STATION_NOT_COMPLETED", "RESET_REQUIRED_AFTER_PLC_COMM_ERROR"].includes(r) || r.startsWith("PLC_TIMEOUT");
  }, [quickResetPartId, quickResetStation, currentContext?.plcStatus, popup?.reason, popup?.qrReason]);

  const rejectionSummary = useMemo(() => {
    const rows = stationStats?.recentParts || [];
    const grouped = rows.reduce((acc, row) => {
      const hasR = Boolean(row.interlockReason) || String(row.result || "").toUpperCase() === "NG";
      const reason = hasR ? row.interlockReason || "NG without reason" : null;
      if (!reason) return acc;
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [stationStats?.recentParts]);

  const trendRows = useMemo(() => [...(stationStats?.trend || [])].slice(-6), [stationStats?.trend]);
  const trendChartData = useMemo(
    () =>
      trendRows.map((row) => {
        const total = Number(row.total || 0);
        const ok = Number(row.ok || 0);
        const ng = Number(row.ng || 0);
        const interlocked = Number(row.interlocked || 0);
        const commErrors = Number(row.commErrors || 0);
        const denominator = total + interlocked + commErrors;
        const utilization = denominator > 0 ? Math.round((total / denominator) * 100) : 0;
        const hourToken = String(row.hour || "");
        const hourLabel = hourToken.length >= 13 ? `${hourToken.slice(11, 13)}:00` : hourToken;
        return {
          hour: hourLabel,
          ok,
          ng,
          total,
          utilization,
        };
      }),
    [trendRows]
  );

  // ── Data fetching (unchanged logic) ──────────────────────────────────
  const loadMachines = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingMachines(true);
    try {
      const rows = await machineApi.list();
      const list = rows || [];
      setMachines(list);
      setSelectedMachineId((current) => {
        if (list.length === 0) return "";
        if (current && list.some((item) => String(item.id) === String(current))) return String(current);
        return String(list[0].id);
      });
    } catch (e) {
      if (!silent) setPopup({ type: "ERROR", title: "Machine Load Failed", message: e.response?.data?.error || "Unable to load machines" });
    }
    finally { if (!silent) setLoadingMachines(false); }
  }, []);

  const loadMachineTelemetry = useCallback(async (machineId, showLoader = true) => {
    const id = Number(machineId || 0);
    if (!id) { setLiveState(null); setStationStats(null); return; }
    if (showLoader) setLoadingStats(true); else setRefreshing(true);
    try {
      const [live, stats] = await Promise.all([traceabilityApi.liveState(id), traceabilityApi.machineStats(id)]);
      setLiveState(live || null); setStationStats(stats || null);
      if (live?.stationSettings) {
        setStationSettings(prev => ({
          ...prev,
          [String(live.machine?.stationNo || "").trim().toUpperCase()]: live.stationSettings
        }));
      }
    } catch (e) { if (showLoader) setPopup({ type: "ERROR", title: "Station Data Error", message: e.response?.data?.error || "Unable to load machine telemetry" }); }
    finally { setLoadingStats(false); setRefreshing(false); }
  }, []);

  const scheduleLiveRefresh = useCallback(() => {
    const active = selectedMachineIdRef.current; if (!active) return;
    const elapsed = Date.now() - lastLiveRefreshRef.current;
    const delay = Math.max(0, LIVE_REFRESH_COOLDOWN - elapsed);
    if (liveRefreshTimerRef.current) return;
    liveRefreshTimerRef.current = setTimeout(() => {
      liveRefreshTimerRef.current = null; lastLiveRefreshRef.current = Date.now();
      loadMachineTelemetry(active, false);
    }, delay);
  }, [loadMachineTelemetry]);

  const isDuplicatePopupEvent = useCallback((payload = {}) => {
    // Allow first error immediately, but dedupe identical error bursts in short window
    // to avoid visual blinking/flooding from repeated backend emits.
    const key = [String(payload.type || "").trim().toUpperCase(), normalizePartId(payload.partId || payload.part_id),
    String(payload.stationNo || payload.station_no || "").trim().toUpperCase(),
    normalizeDecisionState(payload.qrResult || payload.qr_result),
    String(payload.plcStatus || payload.plc_status || "").trim().toUpperCase(),
    String(payload.reason || payload.qrReason || "").trim().toUpperCase(),
    String(payload.message || "").trim().toUpperCase()].join("|");
    if (!key.replaceAll("|", "")) return false;
    const now = Date.now();
    if (lastPopupEventRef.current.key === key && now - lastPopupEventRef.current.at < POPUP_EVENT_DEDUPE_MS) return true;
    lastPopupEventRef.current = { key, at: now }; return false;
  }, []);

  const isPayloadForActiveMachine = useCallback((payload = {}) => {
    const payloadMachineId = String(payload.machineId || payload.machine_id || "").trim();
    const payloadStation = String(payload.stationNo || payload.station_no || "").trim().toUpperCase();
    const activeMachineId = String(selectedMachineIdRef.current || "").trim();
    const activeStation = String(selectedStationRef.current || "").trim().toUpperCase();

    if (payloadMachineId) {
      if (payloadMachineId === activeMachineId) return true;
      // Keep operator feedback visible when backend emits partial/mismatched tags
      // but the payload clearly contains a scan result for current workflow.
      if (hasQrDecision(payload) && normalizePartId(payload.partId || payload.part_id)) return true;
      return false;
    }
    if (payloadStation) {
      if (payloadStation === activeStation) return true;
      if (hasQrDecision(payload) && normalizePartId(payload.partId || payload.part_id)) return true;
      return false;
    }
    // If backend payload does not include machine/station identity,
    // allow it for active Operator screen instead of dropping messages.
    return true;
  }, []);

  const shouldIgnoreStartupPopup = useCallback((payload = {}) => {
    const now = Date.now();
    const bootAge = now - operatorViewBootAtRef.current;
    if (bootAge > POPUP_STARTUP_GRACE_MS) return false;
    const hasDecision = hasQrDecision(payload);
    if (!hasDecision) return true;
    const payloadMs = parsePayloadTimeMs(payload);
    if (!payloadMs) return true;
    return (now - payloadMs) > POPUP_STALE_EVENT_MS;
  }, []);

  useEffect(() => {
    if (!suppressReadyPopup) return undefined;
    const timer = setTimeout(() => setSuppressReadyPopup(false), 15000);
    return () => clearTimeout(timer);
  }, [suppressReadyPopup]);

  const processQrSignal = useCallback((payload = {}) => {
    if (!hasQrDecision(payload)) return false;
    if (!isPayloadForActiveMachine(payload)) return false;
    const sig = toQrSignal(payload);
    const dedupeR = ["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(sig.decision) ? sig.reason : "";
    const key = [sig.partId, sig.stationNo, sig.decision, dedupeR].join("|");
    const now = Date.now();
    if (lastQrEventRef.current.key === key && now - lastQrEventRef.current.at < QR_EVENT_DEDUPE_MS) return false;
    lastQrEventRef.current = { key, at: now };
    setScanState((prev) => {
      const decision = String(sig.decision || "").toUpperCase();
      const failed = ["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(decision);
      const passed = ["ALLOW", "PASS", "OK", "ACCEPT", "VALID"].includes(decision);
      const nextQrStatus = failed ? (String(payload.reason || "").toUpperCase() === "PREVIOUS_STATION_NOT_COMPLETED" ? "BLOCKED" : "FAIL") : passed ? "PASS" : "IDLE";
      const stationKey = String(sig.stationNo || selectedStationRef.current || "").trim().toUpperCase();
      const stationFeatures = getStationFeatures(stationKey, stationSettings);
      const manualRequired = passed && stationFeatures?.manualResult === true;
      const previousOp = String(prev.operationStatus || "WAIT").toUpperCase();
      const nextOp = failed ? "FAIL" : manualRequired ? "WAIT" : (previousOp && previousOp !== "FAIL" ? previousOp : "WAIT");
      return {
        ...prev,
        inputQr: sig.partId || prev.inputQr,
        // Important: failed/blocked QR must never become active part.
        activePartId: passed ? (sig.partId || prev.activePartId) : "",
        failedQr: failed ? (sig.partId || prev.failedQr) : "",
        qrStatus: nextQrStatus,
        operationStatus: nextOp,
        manualResultStatus: manualRequired ? "REQUIRED" : "IDLE",
      };
    });
    setQrSignal(sig); setQrFeed(prev => [sig, ...prev].slice(0, 6));
    // Failsafe: always raise/update popup when a valid QR decision is received,
    // even if the event arrived from a path that didn't emit operator_popup.
    const decision = String(sig.decision || "").trim().toUpperCase();
    const isBlockedDecision = ["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(decision);
    const signalStation = String(sig.stationNo || selectedStationRef.current || "").trim().toUpperCase();
    const signalFeatures = getStationFeatures(signalStation, stationSettings);
    const isFinalPackingStation = Boolean(signalFeatures?.finalPacking);
    const fallbackMessage = isBlockedDecision
      ? (isFinalPackingStation
        ? `${formatScanErrorMessage(payload)} Not eligible for packing.`
        : formatScanErrorMessage(payload))
      : (isFinalPackingStation
        ? `Final station PASS: Eligible for packing (${sig.stationNo || "Station"}).`
        : `Scan accepted at ${sig.stationNo || "Station"}`);
    const passOperationStatus = getPassOperationStatusForStation(sig.stationNo, stationSettings);
    setPopup((prev) => {
      const nextPartId = sig.partId || prev?.partId || prev?.part_id || "";
      const nextStationNo = sig.stationNo || prev?.stationNo || prev?.station_no || "";
      const nextType = isBlockedDecision ? "ERROR" : "INFO";
      const prevPartId = prev?.partId || prev?.part_id || "";
      const prevStationNo = prev?.stationNo || prev?.station_no || "";
      const prevType = prev?.type || "";
      const isIdentityChanged = String(nextPartId) !== String(prevPartId) || String(nextStationNo) !== String(prevStationNo) || String(nextType) !== String(prevType);
      return ({
      ...prev,
      type: nextType,
      title: isBlockedDecision ? "Scan Blocked" : "Scan Passed",
      message: fallbackMessage,
      reason: String(payload.reason || payload.qrReason || "").trim(),
      partId: nextPartId,
      stationNo: nextStationNo,
      machineId: payload.machineId || payload.machine_id || prev?.machineId || prev?.machine_id || "",
      machineName: payload.machineName || prev?.machineName || "",
      qrStatus: isBlockedDecision ? "FAILED" : "PASSED",
      operationStatus: isBlockedDecision ? "BLOCKED" : passOperationStatus,
      timestamp: payload.timestamp || new Date().toISOString(),
      _shownAtMs: isIdentityChanged ? Date.now() : (prev?._shownAtMs || Date.now()),
    })});
    setSuppressReadyPopup(false);
    const mk = selectedMachineIdRef.current;
    if (mk) {
      try {
        const c = JSON.parse(localStorage.getItem(QR_STORAGE_KEY) || "{}");
        c[mk] = sig;
        localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(c));
      } catch (err) { void err; }
    }
    return true;
  }, [isPayloadForActiveMachine, stationSettings]);

  const processIncomingSocketScanEvent = useCallback((payload = {}, source = "") => {
    if (shouldIgnoreStartupPopup(payload)) return false;
    if (!isPayloadForActiveMachine(payload)) return false;
    const now = Date.now();
    const identityKey = makeEventIdentityKey(payload);
    if (lastSocketIdentityRef.current.key === identityKey && now - lastSocketIdentityRef.current.at < SOCKET_EVENT_DEDUPE_MS) {
      return false;
    }
    lastSocketIdentityRef.current = { key: identityKey, at: now };
    const hasDecision = hasQrDecision(payload);
    if (hasDecision) processQrSignal(payload);
    return hasDecision;
  }, [isPayloadForActiveMachine, processQrSignal, shouldIgnoreStartupPopup]);

  useEffect(() => {
    setPopup((prev) => {
      if (!prev) return prev;
      if (prev.isSimulationPlaceholder) return prev;
      return isPayloadForActiveMachine(prev) ? prev : null;
    });
  }, [selectedMachineId, selectedStation, isPayloadForActiveMachine]);

  const mergePopupPayload = useCallback((payload = {}) => {
    setPopup(prev => {
      const nextPartId = payload.partId || payload.part_id || prev?.partId || "";
      const nextStationNo = payload.stationNo || payload.station_no || prev?.stationNo || "";
      const nextType = payload.type || prev?.type || "";
      const prevPartId = prev?.partId || prev?.part_id || "";
      const prevStationNo = prev?.stationNo || prev?.station_no || "";
      const prevType = prev?.type || "";
      const isIdentityChanged = String(nextPartId) !== String(prevPartId) || String(nextStationNo) !== String(prevStationNo) || String(nextType) !== String(prevType);
      const iqr = payload.qrResult || payload.qr_result || "", iqrS = normalizeDecisionState(iqr), pqrS = normalizeDecisionState(prev?.qrResult || prev?.qr_result || "");
      const iplc = payload.plcStatus || payload.plc_status || "", iplcS = String(iplc || "").trim().toUpperCase(), pplcS = String(prev?.plcStatus || prev?.plc_status || "").trim().toUpperCase();
      const rl = isResetLikePayload(payload);
      const applyQr = Boolean(iqr) && (iqrS !== "WAIT" || !pqrS || pqrS === "WAIT" || rl);
      const prevOpNorm = normalizeOperationState(pplcS);
      const incomingOpNorm = normalizeOperationState(iplcS);
      const isDowngradeToWait =
        incomingOpNorm === "WAIT" &&
        ["PASS", "RUN", "FAIL", "COMM", "BLOCKED"].includes(prevOpNorm);
      const applyPlc =
        Boolean(iplc) &&
        !isDowngradeToWait &&
        (iplcS !== "WAIT" || !pplcS || pplcS === "WAIT" || rl);
      return {
        ...prev, ...(payload.type && { type: payload.type }), ...(payload.title && { title: payload.title }),
        ...(applyQr && { qrResult: iqr }), ...(applyPlc && { plcStatus: iplc }),
        ...(payload.operationStatus && { operationStatus: payload.operationStatus }),
        ...(payload.status && { status: payload.status }),
        ...(payload.message && { message: payload.message }), ...(payload.reason && { reason: payload.reason }),
        ...(payload.expectedStation && { expectedStation: payload.expectedStation }),
        ...(payload.lastCompletedStation && { lastCompletedStation: payload.lastCompletedStation }),
        ...((payload.partId || payload.part_id) && { partId: payload.partId || payload.part_id }),
        ...((payload.stationNo || payload.station_no) && { stationNo: payload.stationNo || payload.station_no }),
        ...((payload.machineId || payload.machine_id) && { machineId: payload.machineId || payload.machine_id }),
        ...(payload.machineName && { machineName: payload.machineName }),
        ...(payload.timestamp && { timestamp: payload.timestamp }),
        _shownAtMs: isIdentityChanged ? Date.now() : (prev?._shownAtMs || Date.now()),
      };
    });
  }, []);

  const handleResetOperation = useCallback(async (partId, stationNo) => {
    const pid = normalizePartId(partId), sno = String(stationNo || "").trim().toUpperCase();
    if (!pid || !sno) return false;
    // PLC-only reset: clears machine FSM without touching part journey records
    const mId = String(selectedMachineIdRef.current || "");
    await traceabilityApi.resetPlcOnly({ partId: pid, stationNo: sno, machineId: mId || undefined });
    const mk = selectedMachineIdRef.current;
    if (mk) {
      try {
        const c = JSON.parse(localStorage.getItem(QR_STORAGE_KEY) || "{}");
        delete c[mk];
        localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(c));
      } catch (err) { void err; }
    }
    setQrSignal(null); setQrFeed([]);
    setPopup(null);
    setScanState({
      inputQr: "",
      activePartId: "",
      failedQr: "",
      qrStatus: "IDLE",
      operationStatus: "WAIT",
      manualResultStatus: "IDLE",
    });
    setLiveState(prev => prev ? { ...prev, machineState: { ...prev.machineState, state: "IDLE" }, current: null } : null);
    scheduleLiveRefresh(); return true;
  }, [scheduleLiveRefresh]);

  const openResetConfirm = useCallback((partId, stationNo) => {
    const pid = normalizePartId(partId);
    const sno = String(stationNo || "").trim().toUpperCase();
    if (!pid || !sno) return;
    setResetConfirm({ partId: pid, stationNo: sno });
  }, []);

  const confirmResetOperation = useCallback(async () => {
    const pid = normalizePartId(resetConfirm?.partId);
    const sno = String(resetConfirm?.stationNo || "").trim().toUpperCase();
    if (!pid || !sno) {
      setResetConfirm(null);
      return;
    }
    try {
      await handleResetOperation(pid, sno, { confirmed: true });
    } catch (e) {
      mergePopupPayload({
        type: "ERROR",
        title: "Reset Failed",
        message: e.response?.data?.error || "Unable to reset",
        partId: pid,
        stationNo: sno,
      });
    } finally {
      setResetConfirm(null);
    }
  }, [handleResetOperation, mergePopupPayload, resetConfirm]);

  useEffect(() => { loadMachines(); }, [loadMachines]);
  useEffect(() => {
    const timer = setInterval(() => loadMachines({ silent: true }), 10000);
    return () => clearInterval(timer);
  }, [loadMachines]);
  useEffect(() => {
    if (!selectedMachineId) return;
    setLiveState(null);
    setStationStats(null);
    loadMachineTelemetry(selectedMachineId, true);
  }, [selectedMachineId, loadMachineTelemetry]);
  useEffect(() => {
    setPopup(null);
    setSuppressReadyPopup(false);
  }, [selectedMachineId, selectedStation]);
  useEffect(() => { const t = setInterval(() => { if (selectedMachineIdRef.current) loadMachineTelemetry(selectedMachineIdRef.current, false); }, 15000); return () => clearInterval(t); }, [loadMachineTelemetry]);
  useEffect(() => { const t = setInterval(() => setClockTick(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const sync = async () => {
      try { const r = await stationSettingsApi.list(); if (r && Object.keys(r).length > 0) { setStationSettings(r); saveStationFeatureSettings(r); return; } } catch (err) { void err; }
      setStationSettings(getStationFeatureSettings());
    };
    sync();
    const onFocus = () => sync(), onStorage = () => setStationSettings(getStationFeatureSettings());
    window.addEventListener("focus", onFocus); window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("focus", onFocus); window.removeEventListener("storage", onStorage); };
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["polling"], upgrade: false,
      autoConnect: false,
    });
    const connectTimer = setTimeout(() => {
      socket.connect();
    }, 0);
    const handleUnifiedScanPayload = (p = {}) => {
      const rel = processIncomingSocketScanEvent(p, "unified");
      const d = extractQrDecision(p);
      if (d) {
        setSuppressReadyPopup(false);
        if (d === "BLOCK") {
          if (shouldSuppressPopupPayload(p)) { scheduleLiveRefresh(); return; }
          mergePopupPayload({
            type: "ERROR",
            title: "Scan Blocked",
            message: formatScanErrorMessage(p),
            reason: p.reason || "",
            partId: p.partId || p.part_id,
            stationNo: p.stationNo || p.station_no,
            machineId: p.machineId || p.machine_id,
            qrStatus: "FAILED",
            operationStatus: "BLOCKED",
            timestamp: p.timestamp
          });
        } else {
          mergePopupPayload({
            type: "INFO",
            title: "Scan Passed",
            message: `QR Validated at ${p.stationNo || "Station"}`,
            partId: p.partId || p.part_id,
            stationNo: p.stationNo || p.station_no,
            qrStatus: "PASSED",
            operationStatus: getPassOperationStatusForStation(p.stationNo || p.station_no, stationSettings)
          });
        }
      }
      if (rel || d) scheduleLiveRefresh();
    };
    socket.on("scan_event", handleUnifiedScanPayload);
    socket.on("QR_VALIDATED", handleUnifiedScanPayload);
    socket.on("PLC_RUNNING", () => { scheduleLiveRefresh(); });
    socket.on("PLC_COMPLETED_OK", () => { scheduleLiveRefresh(); });
    socket.on("PLC_COMPLETED_NG", () => { scheduleLiveRefresh(); });
    socket.on("RESET_COMPLETED", () => { setQrSignal(null); setQrFeed([]); scheduleLiveRefresh(); });
    
    socket.on("journey_update", (p = {}) => {
      if (String(p.sourceEvent || "").toLowerCase() === "scan_event") return;
      handleUnifiedScanPayload(p);
    });
    socket.on("operator_popup", (p = {}) => {
      if (shouldSuppressPopupPayload(p) || isDuplicatePopupEvent(p)) return;
      processIncomingSocketScanEvent(p, "operator_popup");
      if (!isPayloadForActiveMachine(p)) return;
      if (String(p.partId || p.part_id || "").trim()) {
        setSuppressReadyPopup(false);
      }
      const nm = String(p.type || "").toUpperCase() === "ERROR"
        ? formatScanErrorMessage({ ...p, reason: p.reason || p.qrReason })
        : p.message;
      mergePopupPayload({ ...p, ...(nm ? { message: nm } : {}) });
      scheduleLiveRefresh();
    });
    socket.on("dashboard_refresh", () => scheduleLiveRefresh());
    // Avoid noisy refresh storms caused by transient health flaps.
    // Operator telemetry already refreshes on interval and on scan/popup events.
    return () => {
      clearTimeout(connectTimer);
      if (liveRefreshTimerRef.current) {
        clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
      socket.removeAllListeners();
      if (socket.connected || socket.active) {
        socket.disconnect();
      }
    };
  }, [scheduleLiveRefresh, processQrSignal, processIncomingSocketScanEvent, mergePopupPayload, isDuplicatePopupEvent, isPayloadForActiveMachine, shouldIgnoreStartupPopup]);

  const handleClosePopup = useCallback((reason = "manual") => {
    setPopup((prev) => {
      if (prev?.isSimulationPlaceholder) {
        setSuppressReadyPopup(reason === "manual");
      } else {
        setSuppressReadyPopup(false);
      }
      return null;
    });
  }, []);

  const handleRefreshWithPopup = useCallback(async () => {
    if (!selectedMachineId) return;
    setSuppressReadyPopup(false);
    await loadMachineTelemetry(selectedMachineId, false);
    openScannerReadyPopup();
  }, [selectedMachineId, loadMachineTelemetry, openScannerReadyPopup]);

  const submitUsbScan = useCallback(async (rawValue) => {
    const code = String(rawValue || "").trim();
    if (!code || !selectedMachineIdRef.current) return;
    setUsbDebug(`Captured: ${code}`);
    try {
      const machineRows = machinesRef.current || [];
      const currentMachine = machineRows.find((m) => String(m.id) === String(selectedMachineIdRef.current));
      const stationNo = String(getMachineStage(currentMachine) || selectedStationRef.current || "").trim().toUpperCase();
      if (!stationNo) return;

      const payload = await traceabilityApi.verify({
        machineId: selectedMachineIdRef.current,
        qrCode: code,
        partId: code,
        stationNo,
      });
      await scannerApi.markUsbActivity({ machineId: selectedMachineIdRef.current }).catch(() => null);
      processQrSignal({ ...payload, partId: code, stationNo, machineId: selectedMachineIdRef.current, sourceEvent: "usb_hidden_input" });
      setUsbDebug(`Submitted OK: ${code}`);
      scheduleLiveRefresh();
    } catch (error) {
      await scannerApi.markUsbActivity({ machineId: selectedMachineIdRef.current }).catch(() => null);
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.message || "USB scan validation failed";
      setUsbDebug(`Submit failed: ${errorMessage}`);
      setScanState((prev) => ({
        ...prev,
        inputQr: code,
        activePartId: "",
        failedQr: code,
        qrStatus: "FAIL",
        operationStatus: "FAIL",
        manualResultStatus: "IDLE",
      }));
      setPopup((prev) => ({
        ...prev,
        type: "ERROR",
        title: "Scan Blocked",
        message: errorMessage,
        partId: code,
        stationNo: selectedStationRef.current || "",
        machineId: selectedMachineIdRef.current || "",
        qrStatus: "FAILED",
        operationStatus: "BLOCKED",
        timestamp: new Date().toISOString(),
        _shownAtMs: Date.now(),
      }));
    }
  }, [processQrSignal, scheduleLiveRefresh]);

  useEffect(() => {
    const isUsbMode = ["USB_SERIAL", "USB", "USB_HID", "HID"].includes(String(scannerInfo?.scannerMode || scannerInfo?.mode || "").trim().toUpperCase());
    if (!isUsbMode) return undefined;

    const shouldSkipFocusSteal = () => {
      const active = document.activeElement;
      if (!active) return false;
      const tag = String(active.tagName || "").toUpperCase();
      return ["SELECT", "INPUT", "TEXTAREA", "BUTTON"].includes(tag);
    };

    const keepFocus = () => {
      const el = usbScannerInputRef.current;
      if (!el) return;
      if (shouldSkipFocusSteal()) return;
      if (document.activeElement !== el) el.focus();
    };

    keepFocus();
    const focusInterval = setInterval(keepFocus, USB_FOCUS_INTERVAL_MS);
    window.addEventListener("click", keepFocus, true);
    window.addEventListener("touchstart", keepFocus, true);

    const flush = () => {
      const value = usbBufferRef.current.trim();
      usbBufferRef.current = "";
      if (value) submitUsbScan(value);
    };

    const onKeyDown = (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      const tag = String(target?.tagName || "").toUpperCase();
      const isEditableTarget =
        target?.isContentEditable === true ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      // Do not treat normal typing in search/manual fields as scanner input.
      if (isEditableTarget && target !== usbScannerInputRef.current) return;
      const now = Date.now();
      if (now - Number(usbLastKeyAtRef.current || 0) > USB_SCAN_MAX_GAP_MS) {
        usbBufferRef.current = "";
      }
      usbLastKeyAtRef.current = now;

      if (event.key === "Enter") {
        event.preventDefault();
        if (usbFlushTimerRef.current) clearTimeout(usbFlushTimerRef.current);
        flush();
        return;
      }
      if (event.key.length === 1) {
        event.preventDefault();
        usbBufferRef.current += event.key;
        if (usbFlushTimerRef.current) clearTimeout(usbFlushTimerRef.current);
        usbFlushTimerRef.current = setTimeout(flush, USB_IDLE_FLUSH_MS);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      clearInterval(focusInterval);
      window.removeEventListener("click", keepFocus, true);
      window.removeEventListener("touchstart", keepFocus, true);
      window.removeEventListener("keydown", onKeyDown, true);
      if (usbFlushTimerRef.current) clearTimeout(usbFlushTimerRef.current);
      usbBufferRef.current = "";
    };
  }, [scannerInfo?.scannerMode, scannerInfo?.mode, submitUsbScan]);

  useEffect(() => {
    const mk = String(selectedMachineId || "");
    if (!mk) { setQrSignal(null); setQrFeed([]); return; }
    try { const saved = JSON.parse(localStorage.getItem(QR_STORAGE_KEY) || "{}"); const r = saved[mk] || null; if (r) { setQrSignal(r); setQrFeed([r]); return; } } catch { }
    setQrSignal(null); setQrFeed([]);
  }, [selectedMachineId]);

  const handleConfirmStationSelection = useCallback(() => {
    const machineId = String(pendingMachineId || "");
    if (!machineId) return;
    const machine = machines.find((m) => String(m.id) === machineId);
    if (!machine) return;
    const lockedStation = String(getMachineStage(machine) || "").trim().toUpperCase();
    setStationLock({
      machineId,
      stationNo: lockedStation,
      lockedAt: new Date().toISOString(),
    });
    setSelectedMachineId(machineId);
    setShowStationSelectModal(false);
  }, [machines, pendingMachineId]);

  // Do not infer QR PASS/FAIL from PLC status.
  // Backend scan + PLC pipeline is the single source of truth.

  // ─────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div ref={operatorViewRootRef} style={{
      display: "flex", flexDirection: "column", gap: contentGap,
      paddingBottom: contentBottomPadding,
      animation: "ovFadeIn .3s ease",
      maxWidth: "100%", overflowX: "hidden",
      background: C.bg("surf"),
      minHeight: isFullscreen ? "100vh" : undefined,
      padding: isFullscreen ? `${fullscreenTopPadding}px ${fullscreenPadding}px ${fullscreenPadding}px` : undefined,
    }}>
      <input
        ref={usbScannerInputRef}
        autoFocus
        type="text"
        inputMode="none"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="fixed opacity-0 pointer-events-none"
        style={{ left: -10000, top: 0, width: 1, height: 1 }}
        onFocus={(e) => {
          e.target.setAttribute("readonly", "true");
          setTimeout(() => e.target.removeAttribute("readonly"), 100);
        }}
        onChange={() => {}}
        onInput={(e) => {
          const v = String(e.currentTarget.value || "").trim();
          if (!v) return;
          submitUsbScan(v);
          e.currentTarget.value = "";
        }}
      />
      <GlobalPopup popup={popup} onClose={handleClosePopup}
        onResetOperation={handleResetOperation}
        autoCloseMs={12000} criticalAutoCloseMs={18000} showAcknowledge={false}
        machineId={selectedMachineId}
        scannerInfo={scannerInfo}
        showJourney
        journeyScope="station" />

      {showStationSelectModal && enforceStationLockMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "rgba(2, 6, 23, 0.8)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 460,
              background: C.bg("card"),
              border: `1px solid ${C.bdr()}`,
              borderRadius: 14,
              boxShadow: SHM,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.bdr()}`, background: C.bg("surf") }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: C.txt("pri") }}>
                {hasLockedSelection ? "Change Machine / Station" : "Select Machine / Station"}
              </p>
              <p style={{ fontSize: 11, color: C.txt("muted"), marginTop: 3 }}>
                This selection will stay fixed on this device for Operator View.
              </p>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ fontSize: 11, color: C.txt("muted"), fontWeight: 700 }}>Machine</label>
              <select
                value={pendingMachineId}
                onChange={(e) => setPendingMachineId(e.target.value)}
                style={{
                  height: 38,
                  padding: "0 10px",
                  width: "100%",
                  background: C.bg("input"),
                  border: `1px solid ${C.bdr()}`,
                  borderRadius: 9,
                  fontSize: 13,
                  color: C.txt("pri"),
                  outline: "none",
                }}
              >
                <option value="">Select Machine</option>
                {machines.map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.machineName} - {getMachineStage(m) || "N/A"}
                  </option>
                ))}
              </select>
              <div
                style={{
                  borderRadius: 10,
                  background: C.bg("surf"),
                  border: `1px solid ${C.bdr()}`,
                  padding: "10px 12px",
                  fontSize: 12,
                  color: C.txt("sec"),
                }}
              >
                Station:{" "}
                <strong style={{ color: C.amber() }}>
                  {getMachineStage(machines.find((m) => String(m.id) === String(pendingMachineId))) || "-"}
                </strong>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {hasLockedSelection && (
                  <button
                    type="button"
                    onClick={() => setShowStationSelectModal(false)}
                    style={{
                      height: 38,
                      borderRadius: 9,
                      border: `1px solid ${C.bdr()}`,
                      background: "transparent",
                      color: C.txt("sec"),
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: "0 12px",
                    }}
                  >
                    Keep Current
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleConfirmStationSelection}
                  disabled={!pendingMachineId}
                  style={{
                    flex: 1,
                    height: 38,
                    borderRadius: 9,
                    border: "none",
                    background: !pendingMachineId ? C.idle(0.25) : C.navy(),
                    color: "#fff",
                    fontWeight: 700,
                    cursor: !pendingMachineId ? "not-allowed" : "pointer",
                  }}
                >
                  {hasLockedSelection ? "Save & Switch" : "Confirm & Continue"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Page Header ───────────────────────────────────────────── */}
      <div style={{
        background: C.bg("card"), border: `1px solid ${C.bdr()}`,
        borderRadius: isCompact ? 12 : 16, padding: headerPadding,
        boxShadow: SH, overflow: "visible",
        minHeight: isTablet ? 96 : undefined,
      }}>
        <div style={{
          height: 3, background: `linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`,
          margin: headerStripeMargin,
          marginBottom: isCompact ? 12 : 14,
        }} />

        <div style={{
          display: "flex", alignItems: isCompact ? "flex-start" : "center",
          justifyContent: "space-between", flexWrap: "wrap", gap: 12,
          flexDirection: headerDirection,
        }}>
          {/* Machine info */}
          <div style={{ display: "flex", alignItems: "center", gap: isCompact ? 10 : 14, flex: 1, minWidth: 0 }}>
            <div style={{
              width: isCompact ? 40 : 48, height: isCompact ? 40 : 48, borderRadius: isCompact ? 10 : 13, flexShrink: 0,
              background: `linear-gradient(135deg,${C.navy()},${C.steel(0.8)})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 4px 12px ${C.navy(0.35)}`,
            }}>
              <Factory size={isCompact ? 18 : 22} color={C.linen()} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 style={{
                fontSize: isTablet ? 17 : (isCompact ? 16 : 18), fontWeight: 800, color: C.txt("pri"),
                letterSpacing: "-0.02em", lineHeight: 1.2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isTablet ? "normal" : "nowrap",
              }}>
                {selectedMachine?.machineName || "Select a Machine"}
              </h1>
              <p style={{
                fontSize: isTablet ? 11 : (isCompact ? 10 : 12), color: C.txt("muted"), marginTop: 3,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isTablet ? "normal" : "nowrap",
                lineHeight: isTablet ? 1.45 : 1.2,
              }}>
                {selectedMachine?.lineName || "—"}
                {selectedStation && <> · Station <span style={{ color: C.amber(), fontWeight: 700 }}>{selectedStation}</span></>}
                {stationFeatureConfig && (
                  <>
                    {" · "}
                    <span style={{ color: stationFeatureConfig.qr ? C.ok() : C.idle(), fontWeight: 700 }}>
                      QR: {stationFeatureConfig.qr ? "ON" : "OFF"}
                    </span>
                    {" · "}
                    <span style={{ color: stationFeatureConfig.operation ? C.ok() : C.idle(), fontWeight: 700 }}>
                      OP: {stationFeatureConfig.operation ? "ON" : "OFF"}
                    </span>
                  </>
                )}
                {selectedMachine && (
                  <>
                    {" · "}
                    <span
                      style={{
                        color: selectedMachine.machineBypassEnabled ? C.amber() : C.ok(),
                        fontWeight: 700,
                      }}
                      title={selectedMachine.machineBypassReason || ""}
                    >
                      {selectedMachine.machineBypassEnabled ? "Bypass ON" : "Bypass OFF"}
                    </span>
                  </>
                )}
                {" · "}
                <span style={{ color: machineMode === "Running" ? C.ok() : machineMode === "Idle" ? C.amber() : C.idle() }}>
                  {machineMode}
                </span>
                {!isMobile && <> · {machineClock}</>}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            width: headerControlsWidth,
            justifyContent: isMobile ? "stretch" : (isTablet ? "space-between" : "flex-end"),
          }}>
            {/* Machine selector - always visible for stable behavior on all screens */}
            <div style={{
              minWidth: isMobile ? "100%" : (isTablet ? 0 : 220),
              maxWidth: isMobile ? "100%" : (isTablet ? "calc(100% - 96px)" : 360),
              flex: isTablet ? 1 : undefined,
              display: "block",
            }}>
              <select value={selectedMachineId}
                onChange={e => {
                  const nextId = String(e.target.value || "");
                  if (enforceStationLockMode) {
                    if (!nextId || nextId === String(selectedMachineId || "")) {
                      return;
                    }
                    setPendingMachineId(nextId);
                    setShowStationSelectModal(true);
                    return;
                  }
                  setSelectedMachineId(nextId);
                }}
                disabled={loadingMachines}
                style={{
                  height: isMobile ? 36 : 38, padding: "0 10px", width: "100%",
                  background: C.bg("input"), border: `1px solid ${C.bdr()}`,
                  borderRadius: 9, fontSize: isTablet ? 12 : (isMobile ? 12 : 13), color: C.txt("pri"),
                  outline: "none", fontFamily: "'DM Sans',sans-serif",
                  minWidth: 0,
                }}>
                {machines.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.machineName} — {m.operationNo}
                  </option>
                ))}
                {machines.length === 0 && <option value="">No machine available</option>}
              </select>
            </div>

            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                height: isMobile ? 36 : 38, width: isMobile ? 36 : 38, borderRadius: 9,
                cursor: "pointer", background: "transparent", border: `1px solid ${C.bdr()}`,
                color: C.txt("sec"), transition: "all .15s",
              }}
            >
              {isFullscreen ? <Minimize2 size={isMobile ? 14 : 15} /> : <Maximize2 size={isMobile ? 14 : 15} />}
            </button>

            {/* Refresh button */}
            <button onClick={handleRefreshWithPopup}
              disabled={loadingStats || refreshing || !selectedMachineId}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                height: isMobile ? 36 : 38, padding: "0 12px", borderRadius: 9,
                fontSize: isMobile ? 11 : 12, fontWeight: 700, cursor: "pointer",
                background: "transparent", border: `1px solid ${C.bdr()}`,
                color: C.txt("sec"), transition: "all .15s",
                opacity: loadingStats || !selectedMachineId ? 0.5 : 1,
              }}>
              <RefreshCw size={isMobile ? 12 : 13} style={{ animation: refreshing ? "ovSpin .9s linear infinite" : "none" }} />
              {isMobile ? "" : (refreshing ? "Updating…" : "Refresh")}
            </button>

          </div>
        </div>

        {/* Mobile clock display */}
        {isMobile && (
          <div style={{ marginTop: 8, fontSize: 10, color: C.txt("muted"), textAlign: "center" }}>
            {machineClock}
          </div>
        )}
      </div>

      {/* Loading */}
      {(loadingStats || loadingMachines) && (
        <div style={{
          padding: "32px 24px", textAlign: "center",
          background: C.bg("card"), border: `1px solid ${C.bdr()}`, borderRadius: 14,
          color: C.txt("muted"), fontSize: 13
        }}>
          <RefreshCw size={20} color={C.txt("muted")}
            style={{ margin: "0 auto 12px", animation: "ovSpin .9s linear infinite" }} />
          Loading station data…
        </div>
      )}

      {!loadingStats && !loadingMachines && (
        <>
          {/* ── Row 1: Status + Gauge + Station Rules (Responsive Grid) ── */}
          <div style={{
            display: "grid",
            gridTemplateColumns: overviewGridColumns,
            gap: overviewGridGap,
            alignItems: "start",
          }}>
            {/* ── Left: Station Status (Connections + QR + Operation) ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: isCompact ? 10 : 12 }}>
              <Card title="Connections" icon={Wifi} accent={C.steel()} collapsible={isMobile}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* PLC */}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 10px", borderRadius: 9,
                    background: plcConnected === null ? C.idle(0.07) : plcConnected ? C.ok(0.07) : C.ng(0.07),
                    border: `1px solid ${plcConnected === null ? C.bdr() : plcConnected ? C.ok(0.22) : C.ng(0.22)}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <ConnDot connected={Boolean(plcConnected)} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: isCompact ? 11 : 12, fontWeight: 700, color: C.txt("pri") }}>PLC Controller</p>
                          <p style={{ fontSize: 9, color: C.txt("muted"), fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {plcHealth?.plcIp || selectedMachine?.plcIp || liveState?.machine?.plcIp || "—"}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={plcConnected === null ? "idle" : plcConnected ? "ok" : "ng"}
                      label={plcConnected === null ? "Checking" : plcConnected ? "Online" : "Offline"}
                      pulse={Boolean(plcConnected)}
                      size={isCompact ? "sm" : "sm"}
                    />
                  </div>

                  {/* Scanner */}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 10px", borderRadius: 9,
                    background: !scannerConfigured ? C.idle(0.07) : effectiveScannerConnected ? C.ok(0.07) : C.ng(0.07),
                    border: `1px solid ${!scannerConfigured ? C.bdr() : effectiveScannerConnected ? C.ok(0.22) : C.ng(0.22)}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <ConnDot connected={effectiveScannerConnected} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: isCompact ? 11 : 12, fontWeight: 700, color: C.txt("pri") }}>
                          {primaryScannerEntry?.scanner?.scannerName || scannerInfo?.scannerName || "Scanner"}
                        </p>
                          <p style={{ fontSize: 9, color: C.txt("muted"), fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {primaryScannerEntry?.scanner?.scannerIp || primaryScannerEntry?.health?.scannerIp || scannerInfo?.scannerIp || scannerHealth?.scannerIp || "—"}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={!scannerConfigured ? "idle" : effectiveScannerConnected ? "ok" : "ng"}
                      label={scannerStatusLabel}
                      pulse={effectiveScannerConnected}
                      size={isCompact ? "sm" : "sm"}
                    />
                  </div>
                  {secondaryScannerEntries.length > 0 && (
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      {secondaryScannerEntries.map((entry, idx) => (
                        <div
                          key={`${entry?.scanner?.id || entry?.scanner?.scannerIp || idx}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            padding: "7px 9px",
                            borderRadius: 8,
                            background: entry.connected ? C.ok(0.05) : C.idle(0.06),
                            border: `1px solid ${entry.connected ? C.ok(0.18) : C.bdr()}`,
                          }}
                        >
                          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                            <ConnDot connected={entry.connected} />
                            <div style={{ minWidth: 0 }}>
                              <p style={{ fontSize: 10, fontWeight: 700, color: C.txt("pri"), display: "flex", gap: 6, alignItems: "center" }}>
                                <span>{entry?.scanner?.scannerName || "Scanner"}</span>
                                <span style={{ fontSize: 9, color: C.txt("muted"), fontFamily: "'DM Mono',monospace" }}>
                                  {entry?.scanner?.scannerRole || "GENERAL"}
                                </span>
                              </p>
                              <p style={{ fontSize: 9, color: C.txt("muted"), fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {entry?.scanner?.scannerIp || entry?.health?.scannerIp || "—"}
                              </p>
                            </div>
                          </div>
                          <Badge
                            variant={entry.connected ? "ok" : "ng"}
                            label={entry.statusLabel}
                            pulse={entry.connected}
                            size={isCompact ? "sm" : "sm"}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              {/* QR Decision */}
              <Card title="QR Result" icon={Radio} accent={STATUS_MAP[qrSignal?.variant || "idle"]?.fg}>
                <DecisionDisplay
                  label="Last QR Scan"
                  variant={qrSignal?.variant || "idle"}
                  sub1={qrSignal?.partId || currentContext?.partId || "Waiting for scan…"}
                  sub2={(qrSignal?.reason || qrSignal?.message || "") + (qrSignal?.timestamp ? ` · ${fmtTime(qrSignal.timestamp)}` : "") || fmtDT(currentContext?.createdAt)}
                  accent
                  compact={isCompact}
                />
              </Card>

              {/* Operation Decision */}
              <Card title="Operation Result" icon={Activity} accent={STATUS_MAP[opVariant]?.fg}>
                <DecisionDisplay
                  label="PLC Operation Status"
                  variant={opVariant}
                  sub1={currentContext?.partId || "—"}
                  sub2={(currentContext?.interlockReason || currentContext?.result || "") + (currentContext?.createdAt ? ` · ${fmtTime(currentContext.createdAt)}` : "")}
                  accent
                  compact={isCompact}
                />
                {canQuickReset && (
                  <button onClick={() => openResetConfirm(quickResetPartId, quickResetStation)}
                    style={{
                      width: "100%", marginTop: 12, height: isCompact ? 34 : 38,
                      background: C.ng(), color: "white",
                      border: "none", borderRadius: 9,
                      fontSize: isCompact ? 11 : 12, fontWeight: 800, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      boxShadow: `0 3px 10px ${C.ng(0.3)}`, transition: "filter .15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.08)"}
                    onMouseLeave={e => e.currentTarget.style.filter = "none"}>
                    <RefreshCw size={isCompact ? 12 : 13} /> Reset Operation
                  </button>
                )}
              </Card>
            </div>

            {/* ── Center: Production Gauge ──────────────────────────── */}
            <Card title="Production Overview" icon={Gauge} accent={C.amber()}>
              <ResponsiveGauge
                progressPct={progressPct}
                qualityPct={qualityPct}
                producedCount={producedCount}
                expectedCount={expectedCount}
                compact={isCompact}
              />

              {/* OK / NG counters - responsive grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: metricGridColumns,
                gap: isCompact ? 8 : 10,
                marginBottom: isCompact ? 12 : 16,
              }}>
                {[
                  { label: "Pass", value: qualitySummary.okCount || 0, color: C.ok(), bg: C.ok(0.08), bd: C.ok(0.2) },
                  { label: "Fail", value: qualitySummary.ngCount || 0, color: C.ng(), bg: C.ng(0.08), bd: C.ng(0.2) },
                  { label: "Locked", value: qualitySummary.interlockedCount || 0, color: C.amber(), bg: C.amber(0.08), bd: C.amber(0.2) },
                  { label: "Active", value: qualitySummary.inProgressCount || 0, color: C.steel(), bg: C.steel(0.08), bd: C.steel(0.2) },
                ].map((s, i) => (
                  <div key={i} style={{
                    borderRadius: 10, padding: "8px 4px", textAlign: "center",
                    background: s.bg, border: `1px solid ${s.bd}`
                  }}>
                    <p style={{
                      fontSize: isCompact ? 16 : 20, fontWeight: 800, color: s.color,
                      fontFamily: "'DM Mono',monospace", lineHeight: 1, marginBottom: 2
                    }}>
                      {s.value}
                    </p>
                    <p style={{
                      fontSize: isCompact ? 8 : 9, fontWeight: 700, color: C.txt("muted"),
                      textTransform: "uppercase", letterSpacing: "0.07em"
                    }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Operator + station info - responsive */}
              <div style={{
                background: C.bg("surf"), borderRadius: 10,
                border: `1px solid ${C.bdr()}`, padding: "8px 12px"
              }}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: operatorInfoColumns,
                  gap: isMobile ? 4 : 0,
                }}>
                  <InfoRow label="Operator" value={user.username || "Operator"} />
                  <InfoRow label="Status" value={currentContext?.plcStatus || "WAITING"} />
                  <InfoRow label="Last Part" value={currentContext?.partId} mono />
                  <InfoRow label="Updated" value={fmtTime(currentContext?.createdAt)} />
                </div>
              </div>
            </Card>

            {/* ── Right: Station Rules + Rejection Summary ──────────── */}
            <div style={{ display: "flex", flexDirection: "column", gap: isCompact ? 10 : 12 }}>
              <Card title="Station Configuration" icon={ShieldCheck} accent={C.steel()} collapsible={isMobile}>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  <FeatureRow label="QR Validation" enabled={stationFeatureConfig.qr} />
                  <FeatureRow label="Operation Rule" enabled={stationFeatureConfig.operation} />
                  <FeatureRow label="Rejection Bin" enabled={stationFeatureConfig.rejectionBin} />

                  <FeatureRow label="Final Pack Station" enabled={stationFeatureConfig.finalPacking} />
                  <FeatureRow label="Machine Bypass" enabled={Boolean(selectedMachine?.machineBypassEnabled)} />
                </div>
                {selectedMachine?.machineBypassEnabled && selectedMachine?.machineBypassReason && (
                  <p style={{ fontSize: 10, color: C.amber(), marginTop: 6 }}>
                    Reason: {selectedMachine.machineBypassReason}
                  </p>
                )}
              </Card>

              {/* Rejection summary */}
              <Card title="Rejection Summary" icon={AlertTriangle} accent={C.ng()}>
                {!stationFeatureConfig.rejectionBin ? (
                  <p style={{ fontSize: 11, color: C.txt("muted"), fontStyle: "italic" }}>
                    Rejection Bin is disabled for this station.
                  </p>
                ) : rejectionSummary.length === 0 ? (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 8px", borderRadius: 8,
                    background: C.ok(0.07), border: `1px solid ${C.ok(0.2)}`
                  }}>
                    <CheckCircle2 size={12} color={C.ok()} />
                    <p style={{ fontSize: 11, color: C.ok(), fontWeight: 600 }}>
                      No rejections in recent events
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {rejectionSummary.slice(0, isMobile ? 3 : 5).map(e => (
                      <div key={e.reason} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "6px 8px", borderRadius: 8,
                        background: C.ng(0.07), border: `1px solid ${C.ng(0.18)}`,
                      }}>
                        <span style={{
                          fontSize: 10, color: C.txt("pri"),
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          flex: 1
                        }}>{e.reason}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 800, color: C.ng(),
                          fontFamily: "'DM Mono',monospace",
                          background: C.ng(0.12), padding: "1px 6px",
                          borderRadius: 4, border: `1px solid ${C.ng(0.25)}`,
                          flexShrink: 0, marginLeft: 6,
                        }}>{e.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* ── Row 2: Hourly Trend + Recent Events (Responsive) ────── */}
          <div style={{
            display: "grid",
            gridTemplateColumns: bottomSectionColumns,
            gap: isCompact ? 12 : 16,
          }}>
            {/* Hourly trend */}
            <Card title="Hourly Production Trend" icon={BarChart2} accent={C.steel()}>
              {trendChartData.length === 0 ? (
                <p style={{ fontSize: 11, color: C.txt("muted") }}>No trend data for this station.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <SafeChart height={trendChartHeight}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} aspect={undefined}>
                      <ComposedChart data={trendChartData} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                        <CartesianGrid stroke={C.bdr(0.18)} strokeDasharray="3 4" vertical={false} />
                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: C.txt("muted"), fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="count" tick={{ fontSize: 10, fill: C.txt("muted") }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="util" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: C.txt("muted") }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip
                          contentStyle={{ background: C.bg("card"), border: `1px solid ${C.bdr()}`, borderRadius: 10 }}
                          labelStyle={{ color: C.txt("sec") }}
                          formatter={(value, key) => {
                            if (key === "utilization") return [`${value}%`, "Utilization"];
                            if (key === "ok") return [value, "Pass"];
                            if (key === "ng") return [value, "Fail"];
                            return [value, "Output"];
                          }}
                        />
                        <Bar yAxisId="count" dataKey="ok" name="Pass" fill={C.ok()} radius={[4, 4, 0, 0]} maxBarSize={20} />
                        <Bar yAxisId="count" dataKey="ng" name="Fail" fill={C.ng()} radius={[4, 4, 0, 0]} maxBarSize={20} />
                        <Line yAxisId="util" type="monotone" dataKey="utilization" name="Utilization" stroke={C.amber()} strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Badge variant="ok" label="Pass Output" />
                    <Badge variant="ng" label="Fail Output" />
                    <Badge variant="wip" label="Utilization %" />
                  </div>
                </div>
              )}
            </Card>

            {/* Recent events */}
            <Card title="Recent Scan Events" icon={Wrench} accent={C.navy()}>
              {(stationStats?.recentParts || []).length === 0 ? (
                <p style={{ fontSize: 11, color: C.txt("muted") }}>No recent station events.</p>
              ) : (
                <div style={{
                  display: "flex", flexDirection: "column", gap: 6,
                  maxHeight: recentEventsMaxHeight, overflowY: "auto",
                }}>
                  {(stationStats?.recentParts || []).slice(0, recentEventsVisibleRows).map((row, i) => {
                    const res = String(row.result || "").toUpperCase();
                    const variant = ["OK", "PASS", "SUCCESS"].includes(res) ? "ok" : ["NG", "FAIL", "FAILED", "BLOCK", "REJECTED"].includes(res) ? "ng" : "idle";
                    return (
                      <div key={row.id || i} style={{
                        padding: "8px 10px", borderRadius: 9,
                        background: C.bg("surf"), border: `1px solid ${C.bdr()}`,
                        borderLeft: `3px solid ${STATUS_MAP[variant]?.fg || C.bdr()}`,
                      }}>
                        <div style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between", gap: 6, marginBottom: 3
                        }}>
                          <span style={{
                            fontFamily: "'DM Mono',monospace", fontSize: 10,
                            fontWeight: 700, color: C.txt("pri"),
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            flex: 1
                          }}>
                            {row.partId || "—"}
                          </span>
                          <Badge
                            variant={variant}
                            label={variant === "ok" ? "Pass" : variant === "ng" ? "Fail" : "—"}
                            size="sm"
                          />
                        </div>
                        <div style={{
                          display: "flex", alignItems: "center",
                          gap: 8, fontSize: 9, color: C.txt("muted"), flexWrap: "wrap"
                        }}>
                          <span>{row.plcStatus || "—"}</span>
                          <span>{fmtTime(row.createdAt)}</span>
                        </div>
                        {row.interlockReason && (
                          <p style={{ fontSize: 9, color: C.ng(), marginTop: 3, lineHeight: 1.3 }}>
                            ⚠ {row.interlockReason.length > 40 ? row.interlockReason.slice(0, 40) + "..." : row.interlockReason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* ── Row 3: Live QR Feed (Responsive) ────────────────────── */}
          {qrFeed.length > 0 && (
            <Card title="Live QR Feed" icon={Radio} accent={C.steel()}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {qrFeed.slice(0, isMobile ? 3 : 6).map(entry => (
                  <div key={entry.id} style={{
                    display: "flex", alignItems: "center", gap: isCompact ? 8 : 12,
                    padding: "8px 10px", borderRadius: 9,
                    background: STATUS_MAP[entry.variant]?.bg || C.bg("surf"),
                    border: `1px solid ${STATUS_MAP[entry.variant]?.bd || C.bdr()}`,
                    flexWrap: isMobile ? "wrap" : "nowrap",
                  }}>
                    <Badge variant={entry.variant} label={entry.label} pulse={entry.variant === "wip"} size="sm" />
                    <span style={{
                      fontFamily: "'DM Mono',monospace", fontSize: 10,
                      fontWeight: 700, color: C.txt("pri"), flex: 1,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                    }}>
                      {entry.partId || "—"}
                    </span>
                    {entry.stationNo && (
                      <span style={{ fontSize: 9, color: C.txt("muted"), flexShrink: 0 }}>
                        {entry.stationNo}
                      </span>
                    )}
                    <span style={{
                      fontSize: 9, color: C.txt("muted"),
                      fontFamily: "'DM Mono',monospace", flexShrink: 0
                    }}>
                      {fmtTime(entry.timestamp)}
                    </span>
                    <button
                      onClick={() => openResetConfirm(entry.partId, entry.stationNo)}
                      title="Reset this part"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 24, height: 24, borderRadius: 6,
                        background: C.bg("input"), border: `1px solid ${C.bdr()}`,
                        color: C.txt("sec"), cursor: "pointer", flexShrink: 0,
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.bg("surf"); e.currentTarget.style.color = C.ng(); }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = C.bg("input"); e.currentTarget.style.color = C.txt("sec"); }}
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Row 4: Bottom action bar (Responsive) ────────────────── */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: 10,
            padding: "10px 14px", borderRadius: 12,
            background: C.bg("card"), border: `1px solid ${C.bdr()}`,
            boxShadow: SH,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: isCompact ? 10 : 20, flexWrap: "wrap" }}>
              <button style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: isCompact ? 10 : 12, fontWeight: 600, color: C.txt("sec"),
                background: "none", border: "none", cursor: "pointer"
              }}>
                <CheckCircle2 size={isCompact ? 12 : 14} color={C.ok()} /> Change Job
              </button>
              <button style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: isCompact ? 10 : 12, fontWeight: 600, color: C.txt("sec"),
                background: "none", border: "none", cursor: "pointer"
              }}>
                <AlertTriangle size={isCompact ? 12 : 14} color={C.ng()} /> Reject Part
              </button>
            </div>
            <div style={{ display: "flex", gap: isCompact ? 6 : 10, flexWrap: "wrap" }}>
              {[
                { label: "Availability", value: `${Math.max(0, 100 - (qualitySummary.interlockedCount || 0))}%` },
                { label: "Quality", value: `${qualityPct}%` },
                { label: "In Progress", value: qualitySummary.inProgressCount || 0 },
              ].map((s, i) => (
                <div key={i} style={{
                  padding: "4px 10px", borderRadius: 8,
                  background: C.bg("surf"), border: `1px solid ${C.bdr()}`,
                  fontSize: isCompact ? 9 : 11, color: C.txt("pri"),
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  <span style={{ color: C.txt("muted") }}>{s.label}:</span>
                  <span style={{ fontWeight: 700, fontFamily: "'DM Mono',monospace", fontSize: isCompact ? 10 : 11 }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <ConfirmModal
        isOpen={Boolean(resetConfirm)}
        title="Confirm Reset Operation"
        message={`Reset operation for part "${resetConfirm?.partId || ""}" at station "${resetConfirm?.stationNo || ""}"?`}
        confirmText="Confirm Reset"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmResetOperation}
        onCancel={() => setResetConfirm(null)}
      />
    </div>
  );
};

export default OperatorView;




