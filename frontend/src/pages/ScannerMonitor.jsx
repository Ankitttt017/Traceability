// ============================================================
//  ScannerMonitor.jsx — IndusTrace
//  Scanners ONLY — status, IP, machine link, ping test
//  No PLC data here (PLC is in IoMonitor)
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL, SCANNER_CONNECTION_GRACE_MS } from "../constants/network";
import {
  RefreshCw, ScanLine, Wifi, WifiOff, Activity,
  Clock, Globe, CheckCircle2, XCircle, Play, X,
} from "lucide-react";
import toast from "react-hot-toast";
import { scannerApi } from "../api/services";
import { formatMachineLabel } from "../utils/machineFields";


const CONNECTION_GRACE_MS = SCANNER_CONNECTION_GRACE_MS;

// ── Design tokens ──────────────────────────────────────────────────────────
const DS = `
  @keyframes scSpin   { to{transform:rotate(360deg)} }
  @keyframes scFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes scPulse  { 0%,100%{opacity:1} 50%{opacity:.35} }
  @keyframes scPing   { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.4);opacity:0} }
  :root{
    --sc-navy:  26,50,99;
    --sc-steel: 84,119,146;
    --sc-amber: 250,185,91;
    --sc-linen: 232,226,219;
    --sc-ok:    34,197,94;
    --sc-ng:    239,68,68;
    --sc-wip:   249,115,22;
    --sc-idle:  148,163,184;
  }
  [data-theme="light"]{
    --sc-bg-card:   255,255,255;
    --sc-bg-surf:   240,236,230;
    --sc-bg-input:  255,255,255;
    --sc-txt-pri:   26,50,99;
    --sc-txt-sec:   84,119,146;
    --sc-txt-muted: 140,160,180;
    --sc-bdr:       84,119,146;
    --sc-bop:       0.14;
  }
  [data-theme="dark"]{
    --sc-bg-card:   20,34,62;
    --sc-bg-surf:   16,26,50;
    --sc-bg-input:  14,22,44;
    --sc-txt-pri:   232,226,219;
    --sc-txt-sec:   120,160,190;
    --sc-txt-muted: 84,119,146;
    --sc-bdr:       84,119,146;
    --sc-bop:       0.18;
  }
`;
let _scDS = false;
function injectDS() {
  if (_scDS || typeof document === "undefined") return;
  _scDS = true;
  const el = document.createElement("style");
  el.textContent = DS;
  document.head.appendChild(el);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme", "dark");
}

const C = {
  navy:  (o=1) => `rgba(var(--sc-navy),${o})`,
  steel: (o=1) => `rgba(var(--sc-steel),${o})`,
  amber: (o=1) => `rgba(var(--sc-amber),${o})`,
  linen: (o=1) => `rgba(var(--sc-linen),${o})`,
  ok:    (o=1) => `rgba(var(--sc-ok),${o})`,
  ng:    (o=1) => `rgba(var(--sc-ng),${o})`,
  bg:    (v="card") => `rgb(var(--sc-bg-${v}))`,
  txt:   (v="pri")  => `rgb(var(--sc-txt-${v}))`,
  bdr:   (o)        => `rgba(var(--sc-bdr),${o||"var(--sc-bop)"})`,
};
const SH  = `0 2px 12px rgba(var(--sc-navy),.08),0 1px 3px rgba(var(--sc-navy),.05)`;
const SHM = `0 8px 28px rgba(var(--sc-navy),.2),0 3px 8px rgba(var(--sc-navy),.1)`;

function fmtTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d) ? "—" : d.toLocaleTimeString();
}

function isRecentWithinGrace(isoValue, graceMs = CONNECTION_GRACE_MS) {
  if (!isoValue) return false;
  const ms = new Date(isoValue).getTime();
  if (!Number.isFinite(ms)) return false;
  return (Date.now() - ms) <= graceMs;
}

// ── Atoms ──────────────────────────────────────────────────────────────────
const Badge = ({ variant = "idle", label, pulse }) => {
  const map = {
    ok:   { fg: C.ok(),    bg: C.ok(0.1),    bd: C.ok(0.25)   },
    ng:   { fg: C.ng(),    bg: C.ng(0.1),    bd: C.ng(0.25)   },
    idle: { fg: C.txt("muted"), bg: C.bg("surf"), bd: C.bdr() },
  };
  const s = map[variant] || map.idle;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 99,
      fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
      color: s.fg, background: s.bg, border: `1px solid ${s.bd}`,
      whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%",
        background: s.fg, flexShrink: 0,
        animation: pulse ? "scPulse 1.2s ease-in-out infinite" : "none",
      }}/>
      {label}
    </span>
  );
};

const Btn = ({ children, onClick, disabled, loading, variant = "ghost", size = "md", full }) => {
  const [h, setH] = useState(false);
  const V = {
    ghost:  { bg: h ? C.bg("surf") : "transparent", color: C.txt("sec"), border: `1px solid ${C.bdr()}` },
    amber:  { bg: h ? C.amber(0.9) : C.amber(),     color: C.navy(),     border: "none", fontWeight: 800, boxShadow: `0 3px 10px ${C.amber(0.25)}` },
    steel:  { bg: h ? C.steel(0.2) : C.steel(0.1),  color: C.steel(),    border: `1px solid ${C.steel(0.3)}` },
    ok:     { bg: h ? C.ok(0.18) : C.ok(0.1),       color: C.ok(),       border: `1px solid ${C.ok(0.3)}` },
    danger: { bg: h ? C.ng(0.18) : C.ng(0.1),       color: C.ng(),       border: `1px solid ${C.ng(0.3)}` },
  };
  const s = V[variant] || V.ghost;
  const H = size === "sm" ? 32 : size === "lg" ? 44 : 38;
  const px = size === "sm" ? "0 12px" : size === "lg" ? "0 22px" : "0 16px";
  return (
    <button onClick={onClick} disabled={disabled || loading}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        height: H, padding: px, width: full ? "100%" : undefined,
        borderRadius: 8, fontSize: size === "sm" ? 11 : 12, fontWeight: 700,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled || loading ? 0.45 : 1,
        transition: "all .15s", ...s,
      }}>
      {loading
        ? <RefreshCw size={12} style={{ animation: "scSpin .9s linear infinite" }}/>
        : children}
    </button>
  );
};

// ── Ping result modal ─────────────────────────────────────────────────────
const PingModal = ({ scanner, onClose }) => {
  const [testing, setTesting] = useState(false);
  const [result,  setResult]  = useState(null);

  const runPing = async () => {
    setTesting(true); setResult(null);
    const t0 = Date.now();
    try {
      const res = await scannerApi.testConnection(scanner.id);
      const ok = Boolean(res?.reachable);
      const mode = String(res?.scannerMode || scanner?.scannerMode || "TCP_CLIENT").toUpperCase();
      setResult({
        success: ok,
        mode,
        message: res?.message || (ok ? "Scanner test completed." : "Scanner test failed."),
        latency: Date.now() - t0,
      });
    } catch (e) {
      setResult({
        success: false,
        message: e.response?.data?.error || `Could not reach ${scanner.scannerIp}. Check network and scanner power.`,
        latency: Date.now() - t0,
      });
    } finally { setTesting(false); }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1200,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)",
    }}>
      <div style={{
        width: "100%", maxWidth: 440,
        background: C.bg("card"), border: `1px solid ${C.bdr()}`,
        borderRadius: 18, overflow: "hidden",
        boxShadow: SHM, animation: "scFadeIn .2s ease",
      }}>
        {/* Accent */}
        <div style={{ height: 3, background: `linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})` }}/>

        {/* Header */}
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${C.bdr()}`,
          background: C.bg("surf"), display: "flex",
          alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: C.steel(0.12), border: `1px solid ${C.steel(0.3)}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <ScanLine size={15} color={C.steel()}/>
            </div>
            <div>
              <p style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                letterSpacing: "0.1em", color: C.txt("muted"), marginBottom: 1 }}>
                Scanner Test
              </p>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.txt("pri") }}>
                {scanner.scannerName || "Scanner"}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6, background: "none",
            border: `1px solid ${C.bdr()}`, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: C.txt("muted"),
          }}>
            <X size={13}/>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 20px 22px" }}>

          {/* Scanner details */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8,
            marginBottom: 18,
          }}>
            {[
              { label: "IP Address", value: scanner.scannerIp || "—",     mono: true  },
              { label: "Port",       value: scanner.scannerPort || "—",   mono: true  },
              { label: "Machine",    value: scanner.mappedMachine
                  ? formatMachineLabel(scanner.mappedMachine) : "Not linked", mono: false },
            ].map((f, i) => (
              <div key={i} style={{
                background: C.bg("surf"), border: `1px solid ${C.bdr()}`,
                borderRadius: 9, padding: "9px 11px",
              }}>
                <p style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                  letterSpacing: "0.08em", color: C.txt("muted"), marginBottom: 4 }}>
                  {f.label}
                </p>
                <p style={{
                  fontSize: 12, fontWeight: 700, color: C.txt("pri"),
                  fontFamily: f.mono ? "'DM Mono',monospace" : "inherit",
                }}>
                  {f.value}
                </p>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 12, color: C.txt("muted"), lineHeight: 1.6, marginBottom: 18 }}>
            This runs a mode-aware scanner test for{" "}
            <span style={{ fontFamily: "'DM Mono',monospace", color: C.steel(), fontWeight: 700 }}>
              {scanner.scannerIp}{scanner.scannerPort ? `:${scanner.scannerPort}` : ""}
            </span>{" "}
            and validates backend listener/data flow for push-mode scanners.
          </p>

          {/* Result */}
          {result && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "12px 14px", borderRadius: 10, marginBottom: 18,
              background: result.success ? C.ok(0.07) : C.ng(0.07),
              border: `1px solid ${result.success ? C.ok(0.22) : C.ng(0.22)}`,
              animation: "scFadeIn .2s ease",
            }}>
              {result.success
                ? <CheckCircle2 size={16} color={C.ok()} style={{ flexShrink: 0, marginTop: 1 }}/>
                : <XCircle      size={16} color={C.ng()} style={{ flexShrink: 0, marginTop: 1 }}/>}
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 4,
                  color: result.success ? C.ok() : C.ng() }}>
                  {result.success ? "Test Passed" : "Test Failed"}
                </p>
                <p style={{ fontSize: 11, lineHeight: 1.5,
                  color: result.success ? C.ok(0.85) : C.ng(0.85) }}>
                  {result.message}
                </p>
                <p style={{ fontSize: 10, color: C.txt("muted"), marginTop: 4,
                  fontFamily: "'DM Mono',monospace" }}>
                  Response time: {result.latency}ms
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={onClose} variant="ghost" style={{ flex: 1, justifyContent: "center" }}>
              Close
            </Btn>
            <Btn onClick={runPing} loading={testing} variant="amber"
              style={{ flex: 2, justifyContent: "center" }}>
              {!testing && <Play size={13}/>}
              {testing ? "Testing…" : result ? "Test Again" : "Start Test"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
//  SCANNER MONITOR
// ══════════════════════════════════════════════════════════════════════════
const ScannerMonitor = () => {
  injectDS();

  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [pingTarget,  setPingTarget]  = useState(null);
  const refreshTimerRef               = useRef(null);

  const loadConnections = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await scannerApi.listConnections();
      setRows(res?.configured || []);
    } catch (e) {
      toast.error(e.response?.data?.error || "Unable to load scanner data.");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { loadConnections(true); }, [loadConnections]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["polling"], upgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
    const sched = () => {
      if (refreshTimerRef.current) return;
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        loadConnections(false);
      }, 500);
    };
    socket.on("scanner_connection", sched);
    socket.on("scanner_health",     sched);
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      socket.off("scanner_connection", sched);
      socket.off("scanner_health", sched);
      if (socket.connected) socket.disconnect();
    };
  }, [loadConnections]);

  useEffect(() => {
    // Fallback polling so status still refreshes even if websocket event is missed.
    const intervalId = setInterval(() => {
      loadConnections(false);
    }, 10000);
    return () => clearInterval(intervalId);
  }, [loadConnections]);

  const summary = useMemo(() => {
    const total     = rows.length;
    const connected = rows.filter(r => Boolean(r?.connection?.connected)).length;
    return {
      total,
      connected,
      disconnected: Math.max(total - connected, 0),
      rate: total ? Math.round((connected / total) * 100) : 0,
    };
  }, [rows]);

  // ═════════════════════════════════════════════════════════════════════
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 20, paddingBottom: 32,
      animation: "scFadeIn .3s ease",
    }}>

      {/* Ping modal */}
      {pingTarget && (
        <PingModal scanner={pingTarget} onClose={() => setPingTarget(null)}/>
      )}

      {/* ── Page Header ─────────────────────────────────────────── */}
      <div style={{
        background: C.bg("card"), border: `1px solid ${C.bdr()}`,
        borderRadius: 16, padding: "16px 20px", boxShadow: SH, overflow: "hidden",
      }}>
        <div style={{
          height: 3,
          background: `linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`,
          margin: "-16px -20px 14px",
        }}/>
        <div style={{
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", flexWrap: "wrap", gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: `linear-gradient(135deg,${C.navy()},${C.steel(0.8)})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 4px 12px ${C.navy(0.35)}`,
            }}>
              <ScanLine size={21} color={C.linen()}/>
            </div>
            <div>
              <h1 style={{
                fontSize: 17, fontWeight: 800, color: C.txt("pri"),
                letterSpacing: "-0.02em", lineHeight: 1.2,
              }}>
                Scanner Monitor
              </h1>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3 }}>
                <div style={{ position: "relative", width: 7, height: 7 }}>
                  <div style={{
                    position: "absolute", inset: 0, borderRadius: "50%",
                    background: C.ok(), animation: "scPing 1.6s ease-out infinite", opacity: 0.6,
                  }}/>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.ok() }}/>
                </div>
                <p style={{ fontSize: 11, color: C.txt("muted") }}>
                  Live — updates on every connection event
                </p>
              </div>
            </div>
          </div>
          <Btn onClick={() => loadConnections(false)} loading={refreshing || loading} variant="ghost">
            <RefreshCw size={12}/> Refresh
          </Btn>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
        gap: 12,
      }}>
        {[
          { label: "Total Scanners", value: summary.total,        color: C.steel(), icon: ScanLine },
          { label: "Online",         value: summary.connected,    color: C.ok(),    icon: Wifi     },
          { label: "Offline",        value: summary.disconnected, color: C.ng(),    icon: WifiOff  },
          { label: "Uptime Rate",    value: `${summary.rate}%`,   color: C.amber(), icon: Globe    },
        ].map((s, i) => (
          <div key={i} style={{
            background: C.bg("card"), border: `1px solid ${C.bdr()}`,
            borderLeft: `3px solid ${s.color}`, borderRadius: 12,
            padding: "13px 15px", boxShadow: SH,
            display: "flex", alignItems: "center", gap: 11,
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9, flexShrink: 0,
              background: `${s.color.replace("1)", "0.1)")}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <s.icon size={16} color={s.color}/>
            </div>
            <div>
              <p style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.07em", color: C.txt("muted"), marginBottom: 2,
              }}>
                {s.label}
              </p>
              <p style={{
                fontSize: 22, fontWeight: 800, color: C.txt("pri"),
                fontFamily: "'DM Mono',monospace", lineHeight: 1,
              }}>
                {s.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Scanner Table ───────────────────────────────────────────── */}
      <div style={{
        background: C.bg("card"), border: `1px solid ${C.bdr()}`,
        borderRadius: 14, overflow: "hidden", boxShadow: SH,
      }}>
        {/* Table header */}
        <div style={{
          padding: "12px 18px", borderBottom: `1px solid ${C.bdr()}`,
          background: C.bg("surf"), display: "flex",
          alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <p style={{
              fontSize: 9, fontWeight: 800, textTransform: "uppercase",
              letterSpacing: "0.1em", color: C.txt("muted"), marginBottom: 1,
            }}>
              Live Status
            </p>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.txt("pri") }}>
              All Scanners
            </p>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 99,
            background: C.ok(0.1), border: `1px solid ${C.ok(0.25)}`,
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%", background: C.ok(),
              animation: "scPulse 1.2s ease-in-out infinite",
            }}/>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.ok() }}>Live</span>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <RefreshCw size={22} color={C.txt("muted")}
              style={{ margin: "0 auto 12px", animation: "scSpin .9s linear infinite" }}/>
            <p style={{ fontSize: 12, color: C.txt("muted") }}>Loading scanner data…</p>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "56px 24px", textAlign: "center" }}>
            <ScanLine size={32} color={C.txt("muted")} style={{ margin: "0 auto 14px" }}/>
            <p style={{ fontSize: 14, fontWeight: 600, color: C.txt("sec"), marginBottom: 6 }}>
              No scanners configured
            </p>
            <p style={{ fontSize: 12, color: C.txt("muted") }}>
              Add scanners in Scanner Registry to monitor them here.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: C.bg("surf"), borderBottom: `1px solid ${C.bdr()}` }}>
                  {[
                    "Connection","Scanner Name","IP Address : Port",
                    "Linked Machine","Online Since","Last Data Received","Action",
                  ].map(h => (
                    <th key={h} style={{
                      padding: "10px 16px", textAlign: "left",
                      fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                      letterSpacing: "0.09em", color: C.txt("muted"), whiteSpace: "nowrap",
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isUsbMode = String(row?.scannerMode || "").toUpperCase() === "USB_SERIAL";
                  const conn = Boolean(row?.connection?.connected) || isRecentWithinGrace(row?.connection?.lastDataAt);
                  const connLabel = isUsbMode ? (conn ? "USB Active" : "USB Idle") : (conn ? "Online" : "Offline");
                  return (
                    <tr key={row.id} style={{
                      borderBottom: `1px solid ${C.bdr()}`,
                      background: i % 2 === 1 ? C.bg("surf") : "transparent",
                      transition: "background .1s",
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = C.steel(0.04)}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? C.bg("surf") : "transparent"}
                    >
                      {/* Connection status */}
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {/* Animated dot */}
                          <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
                            {conn && (
                              <div style={{
                                position: "absolute", inset: 0, borderRadius: "50%",
                                background: C.ok(0.4),
                                animation: "scPing 1.8s ease-out infinite",
                              }}/>
                            )}
                            <div style={{
                              width: 10, height: 10, borderRadius: "50%",
                              background: conn ? C.ok() : C.ng(),
                              position: "relative",
                            }}/>
                          </div>
                          <Badge
                            variant={conn ? "ok" : "ng"}
                            label={connLabel}
                            pulse={conn}
                          />
                        </div>
                      </td>

                      {/* Scanner name */}
                      <td style={{ padding: "12px 16px" }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: C.txt("pri"), marginBottom: 2 }}>
                          {row.scannerName || "Scanner"}
                        </p>
                        <p style={{ fontSize: 10, color: C.txt("muted") }}>
                          {isUsbMode ? "USB Scanner" : "TCP Barcode / QR"}
                        </p>
                      </td>

                      {/* IP : Port */}
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{
                          fontFamily: "'DM Mono',monospace", fontSize: 12,
                          fontWeight: 700, color: C.steel(),
                        }}>
                          {row.scannerIp || "—"}
                          {row.scannerPort && (
                            <span style={{ color: C.txt("muted"), fontWeight: 400 }}>
                              :{row.scannerPort}
                            </span>
                          )}
                        </span>
                      </td>

                      {/* Linked machine */}
                      <td style={{ padding: "12px 16px" }}>
                        {row.mappedMachine ? (
                          <span style={{
                            fontSize: 12, fontWeight: 600, color: C.txt("pri"),
                            padding: "3px 9px", borderRadius: 5,
                            background: C.navy(0.1), border: `1px solid ${C.navy(0.2)}`,
                          }}>
                            {formatMachineLabel(row.mappedMachine)}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: C.txt("muted"), fontStyle: "italic" }}>
                            Not linked
                          </span>
                        )}
                      </td>

                      {/* Online since */}
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <Clock size={11} color={C.txt("muted")}/>
                          <span style={{
                            fontSize: 11, color: C.txt("muted"),
                            fontFamily: "'DM Mono',monospace",
                          }}>
                            {fmtTime(row?.connection?.connectedAt)}
                          </span>
                        </div>
                      </td>

                      {/* Last data */}
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <Activity size={11} color={
                            row?.connection?.lastDataAt
                              ? C.ok(0.7) : C.txt("muted")
                          }/>
                          <span style={{
                            fontSize: 11,
                            color: row?.connection?.lastDataAt ? C.txt("pri") : C.txt("muted"),
                            fontFamily: "'DM Mono',monospace",
                          }}>
                            {fmtTime(row?.connection?.lastDataAt)}
                          </span>
                        </div>
                      </td>

                      {/* Ping button */}
                      <td style={{ padding: "12px 16px" }}>
                        <Btn size="sm" variant="steel"
                          disabled={String(row.id).startsWith("unmanaged-")}
                          onClick={() => setPingTarget(row)}>
                          <Wifi size={11}/> Ping
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Scanner health cards (if any offline) ──────────────── */}
      {summary.disconnected > 0 && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "13px 16px", borderRadius: 12,
          background: C.ng(0.07), border: `1px solid ${C.ng(0.22)}`,
          boxShadow: SH,
        }}>
          <WifiOff size={16} color={C.ng()} style={{ flexShrink: 0, marginTop: 1 }}/>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: C.ng(), marginBottom: 4 }}>
              {summary.disconnected} scanner{summary.disconnected > 1 ? "s" : ""} offline
            </p>
            <p style={{ fontSize: 11, color: C.ng(0.75), lineHeight: 1.5 }}>
              Check power supply, network cable, and IP address configuration for offline scanners.
              Use the Ping button to test individual connections.
            </p>
          </div>
        </div>
      )}

    </div>
  );
};

export default ScannerMonitor;



