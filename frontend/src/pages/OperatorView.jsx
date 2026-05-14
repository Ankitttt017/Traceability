import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  AlertTriangle, CheckCircle2, Clock3, Factory,
  Gauge, RefreshCw, ShieldCheck, Wrench,
  Wifi, WifiOff, Activity, TrendingUp,
  BarChart2, Target, Cpu, Radio, Maximize2,
  ChevronDown, ChevronUp, Menu, X
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line,
} from "recharts";
import { machineApi, stationSettingsApi, traceabilityApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import ConfirmModal from "../components/ConfirmModal";
import { getMachineStage } from "../utils/machineFields";
import { getStationFeatureSettings, getStationFeatures, saveStationFeatureSettings } from "../utils/stationSettings";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const LIVE_REFRESH_COOLDOWN = 350;
const QR_EVENT_DEDUPE_MS = 3000;
const POPUP_EVENT_DEDUPE_MS = 1800;
const QR_STORAGE_KEY = "operator-last-qr-signal";

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
    --ov-bg-card:   255,255,255; --ov-bg-surf:  240,236,230;
    --ov-bg-input:  255,255,255;
    --ov-txt-pri:   26,50,99;    --ov-txt-sec:  84,119,146;
    --ov-txt-muted: 140,160,180;
    --ov-bdr: 84,119,146; --ov-bop: 0.14;
  }
  [data-theme="dark"]{
    --ov-bg-card:   20,34,62;  --ov-bg-surf:  16,26,50;
    --ov-bg-input:  14,22,44;
    --ov-txt-pri:   232,226,219; --ov-txt-sec: 120,160,190;
    --ov-txt-muted: 84,119,146;
    --ov-bdr: 84,119,146; --ov-bop: 0.18;
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
const SH = `0 2px 12px rgba(var(--ov-navy),.08),0 1px 3px rgba(var(--ov-navy),.05)`;
const SHM = `0 4px 20px rgba(var(--ov-navy),.14),0 2px 6px rgba(var(--ov-navy),.07)`;

// ── Utility functions ────────────────────────────────────────────────────
function normalizePartId(v) { return String(v || "").trim(); }
function extractQrDecision(payload = {}) {
  const p = String(payload.qrResult || payload.decision || payload.outcome || payload.scanOutcome || payload.qrDecision || payload.qrStatus || "").trim().toUpperCase();
  if (p) return p;
  const f = String(payload.reason || payload.result || "").trim().toUpperCase();
  if (["PASS", "OK", "ALLOW"].includes(f)) return "ALLOW";
  if (["FAIL", "NG", "BLOCK", "REJECT"].includes(f)) return "BLOCK";
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
  if (reason === "DUPLICATE_SCAN") return `This part has already completed the ${station || "current"} operation. Duplicate scan detected.`;
  if (reason === "ALREADY_COMPLETED") return `This part is already completed. Duplicate scan detected.`;
  if (reason === "RESET_REQUIRED_AFTER_PLC_COMM_ERROR") return `Previous PLC cycle timed out at ${station || "station"}. Use Reset Operation, then scan again.`;
  if (reason.startsWith("PLC_TIMEOUT")) return "PLC response timeout. Use Reset Operation, then scan again.";
  if (reason === "PREVIOUS_STATION_NOT_COMPLETED") return expected ? `Station sequence skipped! Please complete operation at ${expected} first.` : "Station sequence error. Previous station not completed.";
  if (reason === "INVALID_QR_FORMAT") return String(payload.message || "").trim() || "Invalid QR format. Scan correct component code.";
  if (reason === "QR_RULE_CONFIG_ERROR") return String(payload.message || "").trim() || "QR rule configuration is invalid. Contact supervisor.";
  if (reason === "PART_INTERLOCKED") return "Part interlocked. Reset required from control flow.";
  if (reason === "MACHINE_RUNNING") return String(payload.message || "").trim() || "Machine is currently busy with another cycle.";
  if (reason === "STATION_NOT_CONFIGURED") return "Station not configured in machine master. Contact supervisor.";
  if (reason === "INVALID_INPUT") return "Invalid scan input. Re-scan the QR code.";
  if (reason === "SCAN_RESULT_NG") return "QR validation failed (NG). Send part to rejection flow.";
  if (reason) return reason.replaceAll("_", " ");
  return String(payload.message || payload.reason || "").trim() || "Process Blocked. Contact supervisor.";
}
function shouldSuppressPopupPayload(payload = {}) {
  const partId = normalizePartId(payload.partId || payload.part_id);
  const station = String(payload.stationNo || payload.station_no || "").trim();
  const message = String(payload.message || payload.error || "").trim().toUpperCase();
  if (!partId && !station && !message) return true;
  if (!partId && message.includes("PART NOT FOUND")) return true;
  return false;
}
function normalizeDecisionState(value) {
  const n = String(value || "").trim().toUpperCase();
  if (["ALLOW", "PASS", "OK", "ACCEPT", "VALID"].includes(n)) return "PASS";
  if (["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(n)) return "FAIL";
  if (n === "WAIT") return "WAIT";
  return "";
}
function mapBlockReasonToPlcStatus(payload = {}) {
  const explicit = String(payload.plcStatus || payload.operationStatus || payload.status || "").trim().toUpperCase();
  return explicit || "WAIT";
}
function isResetLikePayload(payload = {}) {
  const status = String(payload.status || payload.plcStatus || payload.plc_status || "").trim().toUpperCase();
  const reason = String(payload.reason || payload.qrReason || "").trim().toUpperCase();
  const message = String(payload.message || "").trim().toUpperCase();
  return status === "RESET" || reason.includes("RESET") || message.includes("RESET");
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
  ok: { fg: C.ok(), bg: C.ok(0.1), bd: C.ok(0.28) },
  ng: { fg: C.ng(), bg: C.ng(0.1), bd: C.ng(0.28) },
  wip: { fg: C.wip(), bg: C.wip(0.1), bd: C.wip(0.28) },
  idle: { fg: C.idle(), bg: C.idle(0.08), bd: C.idle(0.2) },
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
    gap: 8, padding: "5px 0", borderBottom: `1px solid ${C.bdr()}`,
    flexWrap: "wrap", minWidth: 0,
  }}>
    <span style={{ fontSize: 11, color: C.txt("muted"), fontWeight: 600, flexShrink: 0 }}>{label}</span>
    <span style={{
      fontSize: 11, fontWeight: 700,
      color: valueColor || C.txt("pri"),
      fontFamily: mono ? "'DM Mono',monospace" : "inherit",
      textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      maxWidth: "min(160px, 100%)",
    }}>{value || "—"}</span>
  </div>
);

const Card = ({ title, icon: Icon, accent, children, right, noPad, collapsible, defaultCollapsed = false }) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const isCollapsible = !!collapsible;

  return (
    <div style={{
      background: C.bg("card"), border: `1px solid ${C.bdr()}`,
      borderRadius: 14, overflow: "hidden", boxShadow: SH,
      borderLeft: accent ? `3px solid ${accent}` : "none",
      height: collapsed && isCollapsible ? "auto" : "auto",
    }}>
      {(title || right) && (
        <div style={{
          padding: "12px 16px", borderBottom: !collapsed || !isCollapsible ? `1px solid ${C.bdr()}` : "none",
          background: C.bg("surf"), display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 8,
          cursor: isCollapsible ? "pointer" : "default",
        }} onClick={() => isCollapsible && setCollapsed(!collapsed)}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {Icon && <Icon size={14} color={C.steel()} />}
            <p style={{ fontSize: 13, fontWeight: 700, color: C.txt("pri") }}>{title}</p>
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
  return (
    <div style={{
      borderRadius: 12, padding: compact ? "10px 12px" : "14px 16px",
      background: s.bg, border: `1px solid ${s.bd}`,
      borderLeft: accent ? `3px solid ${s.fg}` : "none",
    }}>
      <p style={{
        fontSize: 10, fontWeight: 800, textTransform: "uppercase",
        letterSpacing: "0.1em", color: C.txt("muted"), marginBottom: 6
      }}>{label}</p>
      <p style={{
        fontSize: compact ? 18 : 24, fontWeight: 900, color: s.fg, lineHeight: 1,
        fontFamily: "'DM Mono',monospace", marginBottom: 6
      }}>
        {variant === "ok" ? "✓ PASS" : variant === "ng" ? "✗ FAIL" : variant === "wip" ? "● RUNNING" : "○ WAITING"}
      </p>
      {sub1 && <p style={{ fontSize: 11, color: C.txt("muted"), fontFamily: "'DM Mono',monospace", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub1}</p>}
      {sub2 && <p style={{ fontSize: 10, color: C.txt("muted"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub2}</p>}
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
  const [qrSignal, setQrSignal] = useState(null);
  const [qrFeed, setQrFeed] = useState([]);
  const [resetConfirm, setResetConfirm] = useState(null);
  const [clockTick, setClockTick] = useState(Date.now());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
  const liveRefreshTimerRef = useRef(null);
  const lastLiveRefreshRef = useRef(0);
  const lastQrEventRef = useRef({ key: "", at: 0 });
  const lastPopupEventRef = useRef({ key: "", at: 0 });

  const isMobile = breakpoint === "sm" || breakpoint === "md";
  const isTablet = breakpoint === "lg";
  const isCompact = isMobile || isTablet;

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
  const plcHealth = liveState?.plcHealth || stationStats?.plcHealth || null;
  const scannerHealth = liveState?.scannerHealth || stationStats?.scannerHealth || null;
  const scannerInfo = liveState?.scanner || stationStats?.scanner || null;
  const plcHealthKnown = typeof plcHealth?.healthy === "boolean";
  const plcConnected = plcHealthKnown ? Boolean(plcHealth?.healthy) : null;
  const scannerConfigured = String(scannerHealth?.status || "").toUpperCase() !== "NOT_CONFIGURED";
  const scannerConnected = Boolean(scannerHealth?.connected);

  const opStatusSource = liveState?.machineState?.state || currentContext?.plcStatus;
  const opVariant = useMemo(() => getOperationVariant(opStatusSource), [opStatusSource]);
  const opLabel = useMemo(() => getOperationLabel(opStatusSource), [opStatusSource]);

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

  const processQrSignal = useCallback((payload = {}) => {
    if (!hasQrDecision(payload)) return false;
    const pm = String(payload.machineId || payload.machine_id || "");
    const ps = String(payload.stationNo || payload.station_no || "").trim().toUpperCase();
    const am = selectedMachineIdRef.current, as_ = selectedStationRef.current;
    if (!(pm && pm === am) && !(ps && ps === as_)) return false;
    const sig = toQrSignal(payload);
    const dedupeR = ["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(sig.decision) ? sig.reason : "";
    const key = [sig.partId, sig.stationNo, sig.decision, dedupeR].join("|");
    const now = Date.now();
    if (lastQrEventRef.current.key === key && now - lastQrEventRef.current.at < QR_EVENT_DEDUPE_MS) return false;
    lastQrEventRef.current = { key, at: now };
    setQrSignal(sig); setQrFeed(prev => [sig, ...prev].slice(0, 6));
    const mk = selectedMachineIdRef.current;
    if (mk) { try { const c = JSON.parse(localStorage.getItem(QR_STORAGE_KEY) || "{}"); c[mk] = sig; localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(c)); } catch { } }
    return true;
  }, []);

  const mergePopupPayload = useCallback((payload = {}) => {
    setPopup(prev => {
      const iqr = payload.qrResult || payload.qr_result || "", iqrS = normalizeDecisionState(iqr), pqrS = normalizeDecisionState(prev?.qrResult || prev?.qr_result || "");
      const iplc = payload.plcStatus || payload.plc_status || "", iplcS = String(iplc || "").trim().toUpperCase(), pplcS = String(prev?.plcStatus || prev?.plc_status || "").trim().toUpperCase();
      const rl = isResetLikePayload(payload);
      const applyQr = Boolean(iqr) && (iqrS !== "WAIT" || !pqrS || pqrS === "WAIT" || rl);
      const applyPlc = Boolean(iplc) && (iplcS !== "WAIT" || !pplcS || pplcS === "WAIT" || rl);
      return {
        ...prev, ...(payload.type && { type: payload.type }), ...(payload.title && { title: payload.title }),
        ...(applyQr && { qrResult: iqr }), ...(applyPlc && { plcStatus: iplc }),
        ...(payload.operationStatus && { operationStatus: payload.operationStatus }),
        ...(payload.status && { status: payload.status }),
        ...(payload.message && { message: payload.message }), ...(payload.reason && { reason: payload.reason }),
        ...(payload.expectedStation && { expectedStation: payload.expectedStation }),
        ...((payload.partId || payload.part_id) && { partId: payload.partId || payload.part_id }),
        ...((payload.stationNo || payload.station_no) && { stationNo: payload.stationNo || payload.station_no }),
        ...((payload.machineId || payload.machine_id) && { machineId: payload.machineId || payload.machine_id }),
        ...(payload.machineName && { machineName: payload.machineName }),
        ...(payload.timestamp && { timestamp: payload.timestamp }),
      };
    });
  }, []);

  const handleResetOperation = useCallback(async (partId, stationNo, options = {}) => {
    const pid = normalizePartId(partId), sno = String(stationNo || "").trim().toUpperCase();
    if (!pid || !sno) return false;
    const res = await traceabilityApi.resetOperation({ partId: pid, stationNo: sno });
    const mk = selectedMachineIdRef.current;
    if (mk) { try { const c = JSON.parse(localStorage.getItem(QR_STORAGE_KEY) || "{}"); delete c[mk]; localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(c)); } catch { } }
    setQrSignal(null); setQrFeed([]);
    setPopup(null); // Auto-close any active error/info popups
    setLiveState(prev => prev ? { ...prev, machineState: { ...prev.machineState, state: "IDLE" }, current: null } : null);
    scheduleLiveRefresh(); return true;
  }, [mergePopupPayload, scheduleLiveRefresh]);

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
  useEffect(() => { if (!selectedMachineId) return; loadMachineTelemetry(selectedMachineId, true); }, [selectedMachineId, loadMachineTelemetry]);
  useEffect(() => { const t = setInterval(() => { if (selectedMachineIdRef.current) loadMachineTelemetry(selectedMachineIdRef.current, false); }, 15000); return () => clearInterval(t); }, [loadMachineTelemetry]);
  useEffect(() => { const t = setInterval(() => setClockTick(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const sync = async () => {
      try { const r = await stationSettingsApi.list(); if (r && Object.keys(r).length > 0) { setStationSettings(r); saveStationFeatureSettings(r); return; } } catch { }
      setStationSettings(getStationFeatureSettings());
    };
    sync();
    const onFocus = () => sync(), onStorage = () => setStationSettings(getStationFeatureSettings());
    window.addEventListener("focus", onFocus); window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("focus", onFocus); window.removeEventListener("storage", onStorage); };
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, { path: "/socket.io/", transports: ["websocket", "polling"] });
    socket.on("scan_event", (p = {}) => {
      const rel = processQrSignal(p);
      if (rel) { 
        const d = extractQrDecision(p); 
        if (d === "BLOCK") { 
          if (isDuplicatePopupEvent({ ...p, type: "ERROR" })) { scheduleLiveRefresh(); return; } 
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
            operationStatus: "WAITING_MACHINE"
          });
        }
        scheduleLiveRefresh(); 
      }
    });
    socket.on("QR_VALIDATED", (p = {}) => { processQrSignal(p); scheduleLiveRefresh(); });
    socket.on("PLC_RUNNING", (p = {}) => { scheduleLiveRefresh(); });
    socket.on("PLC_COMPLETED_OK", (p = {}) => { scheduleLiveRefresh(); });
    socket.on("PLC_COMPLETED_NG", (p = {}) => { scheduleLiveRefresh(); });
    socket.on("RESET_COMPLETED", (p = {}) => { setQrSignal(null); setQrFeed([]); scheduleLiveRefresh(); });
    
    socket.on("journey_update", (p = {}) => { if (String(p.sourceEvent || "").toLowerCase() === "scan_event") return; if (hasQrDecision(p) && processQrSignal(p)) scheduleLiveRefresh(); });
    socket.on("operator_popup", (p = {}) => {
      if (shouldSuppressPopupPayload(p) || isDuplicatePopupEvent(p)) return;
      const ps = String(p.stationNo || p.station_no || "").trim().toUpperCase(), pm = String(p.machineId || p.machine_id || "");
      if (!(pm === selectedMachineIdRef.current || (ps && ps === selectedStationRef.current))) return;
      const nm = String(p.type || "").toUpperCase() === "ERROR" && String(p.reason || p.qrReason || "").trim() ? formatScanErrorMessage({ ...p, reason: p.reason || p.qrReason }) : p.message;
      mergePopupPayload({ ...p, ...(nm ? { message: nm } : {}) });
      if (hasQrDecision(p) || String(p.sourceEvent || "").toLowerCase() === "scan_event") processQrSignal(p);
      scheduleLiveRefresh();
    });
    socket.on("dashboard_refresh", () => scheduleLiveRefresh());
    // Avoid noisy refresh storms caused by transient health flaps.
    // Operator telemetry already refreshes on interval and on scan/popup events.
    return () => { if (liveRefreshTimerRef.current) { clearTimeout(liveRefreshTimerRef.current); liveRefreshTimerRef.current = null; } socket.disconnect(); };
  }, [scheduleLiveRefresh, processQrSignal, mergePopupPayload, isDuplicatePopupEvent]);

  useEffect(() => {
    const mk = String(selectedMachineId || "");
    if (!mk) { setQrSignal(null); setQrFeed([]); return; }
    try { const saved = JSON.parse(localStorage.getItem(QR_STORAGE_KEY) || "{}"); const r = saved[mk] || null; if (r) { setQrSignal(r); setQrFeed([r]); return; } } catch { }
    setQrSignal(null); setQrFeed([]);
  }, [selectedMachineId]);

  // Do not infer QR PASS/FAIL from PLC status.
  // Backend scan + PLC pipeline is the single source of truth.

  // ─────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: isCompact ? 12 : 20,
      paddingBottom: isCompact ? 24 : 32,
      animation: "ovFadeIn .3s ease",
      maxWidth: "100%", overflowX: "hidden",
    }}>
      <GlobalPopup popup={popup} onClose={() => setPopup(null)}
        onResetOperation={handleResetOperation}
        autoCloseMs={3500} criticalAutoCloseMs={9000} showAcknowledge={false} />

      {/* ── Page Header ───────────────────────────────────────────── */}
      <div style={{
        background: C.bg("card"), border: `1px solid ${C.bdr()}`,
        borderRadius: isCompact ? 12 : 16, padding: isCompact ? "12px 16px" : "16px 20px",
        boxShadow: SH, overflow: "hidden"
      }}>
        <div style={{
          height: 3, background: `linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`,
          margin: `-${isCompact ? "12px -16px 12px" : "16px -20px 14px"}`,
          marginBottom: isCompact ? 12 : 14,
        }} />

        <div style={{
          display: "flex", alignItems: isCompact ? "flex-start" : "center",
          justifyContent: "space-between", flexWrap: "wrap", gap: 12,
          flexDirection: isMobile ? "column" : "row",
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
                fontSize: isCompact ? 16 : 18, fontWeight: 800, color: C.txt("pri"),
                letterSpacing: "-0.02em", lineHeight: 1.2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {selectedMachine?.machineName || "Select a Machine"}
              </h1>
              <p style={{
                fontSize: isCompact ? 10 : 12, color: C.txt("muted"), marginTop: 3,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>
                {selectedMachine?.lineName || "—"}
                {selectedStation && <> · Station <span style={{ color: C.amber(), fontWeight: 700 }}>{selectedStation}</span></>}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: isMobile ? "100%" : "auto" }}>
            {/* Mobile menu toggle for machine selector (simplified on mobile) */}
            {isMobile && (
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: 36, padding: "0 12px", borderRadius: 9,
                  background: C.bg("surf"), border: `1px solid ${C.bdr()}`,
                  color: C.txt("sec"), fontSize: 12,
                }}
              >
                <Menu size={14} />
                {selectedMachine?.machineName?.slice(0, 20) || "Select Machine"}
              </button>
            )}

            {/* Machine selector - hidden on mobile when menu closed */}
            <div style={{
              minWidth: isMobile ? "100%" : 220,
              display: isMobile && !mobileMenuOpen ? "none" : "block",
            }}>
              <select value={selectedMachineId}
                onChange={e => { setSelectedMachineId(e.target.value); setMobileMenuOpen(false); }}
                disabled={loadingMachines}
                style={{
                  height: isMobile ? 36 : 38, padding: "0 10px", width: "100%",
                  background: C.bg("input"), border: `1px solid ${C.bdr()}`,
                  borderRadius: 9, fontSize: isMobile ? 12 : 13, color: C.txt("pri"),
                  outline: "none", fontFamily: "'DM Sans',sans-serif",
                }}>
                {machines.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.machineName} — {m.operationNo}
                  </option>
                ))}
                {machines.length === 0 && <option value="">No machine available</option>}
              </select>
            </div>

            {/* Refresh button */}
            <button onClick={() => selectedMachineId && loadMachineTelemetry(selectedMachineId, false)}
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
            gridTemplateColumns: isMobile ? "1fr" : (isTablet ? "repeat(2, 1fr)" : "280px 1fr 260px"),
            gap: isCompact ? 12 : 16,
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
                        <p style={{ fontSize: 9, color: C.txt("muted"), fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                    background: !scannerConfigured ? C.idle(0.07) : scannerConnected ? C.ok(0.07) : C.ng(0.07),
                    border: `1px solid ${!scannerConfigured ? C.bdr() : scannerConnected ? C.ok(0.22) : C.ng(0.22)}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <ConnDot connected={scannerConnected} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: isCompact ? 11 : 12, fontWeight: 700, color: C.txt("pri") }}>
                          {scannerInfo?.scannerName || "Scanner"}
                        </p>
                        <p style={{ fontSize: 9, color: C.txt("muted"), fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {scannerInfo?.scannerIp || scannerHealth?.scannerIp || "—"}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={!scannerConfigured ? "idle" : scannerConnected ? "ok" : "ng"}
                      label={!scannerConfigured ? "Not Set" : scannerConnected ? "Online" : "Offline"}
                      pulse={scannerConnected}
                      size={isCompact ? "sm" : "sm"}
                    />
                  </div>
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
                gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)",
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
                  gridTemplateColumns: isMobile ? "1fr" : "repeat(2,1fr)",
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
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
            gap: isCompact ? 12 : 16,
          }}>
            {/* Hourly trend */}
            <Card title="Hourly Production Trend" icon={BarChart2} accent={C.steel()}>
              {trendChartData.length === 0 ? (
                <p style={{ fontSize: 11, color: C.txt("muted") }}>No trend data for this station.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ height: isCompact ? 220 : 250 }}>
                    <ResponsiveContainer width="100%" height="100%">
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
                  </div>
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
                  maxHeight: isCompact ? 280 : 320, overflowY: "auto",
                }}>
                  {(stationStats?.recentParts || []).slice(0, isMobile ? 4 : 8).map((row, i) => {
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

