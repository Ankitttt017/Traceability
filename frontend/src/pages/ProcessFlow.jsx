import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_OPTIONS, SOCKET_URL } from "../constants/network";
import {
  RefreshCw, Route, ZoomIn, ZoomOut,
  ChevronRight, Cpu, CheckCircle, XCircle,
  AlertTriangle, Play, Pause, Box,
  ArrowRight, ArrowLeftRight, Circle,
  Activity, Zap, Shield, Wifi, WifiOff,
  Printer, QrCode, Camera, Gauge, Package,
  Flag, TrendingUp, Clock, AlertCircle
} from "lucide-react";
import { traceabilityApi } from "../api/services";


const statusStyle = {
  RUNNING: { bg: "rgba(34,197,94,0.12)", bd: "rgba(34,197,94,0.38)", fg: "#16a34a", icon: <Play size={10} />, label: "RUNNING", gradient: "linear-gradient(135deg, #16a34a20, #16a34a05)" },
  PASSED: { bg: "rgba(59,130,246,0.12)", bd: "rgba(59,130,246,0.38)", fg: "#2563eb", icon: <CheckCircle size={10} />, label: "PASS", gradient: "linear-gradient(135deg, #2563eb20, #2563eb05)" },
  FAILED: { bg: "rgba(239,68,68,0.12)", bd: "rgba(239,68,68,0.38)", fg: "#dc2626", icon: <XCircle size={10} />, label: "FAILED", gradient: "linear-gradient(135deg, #dc262620, #dc262605)" },
  NG: { bg: "rgba(239,68,68,0.12)", bd: "rgba(239,68,68,0.38)", fg: "#dc2626", icon: <XCircle size={10} />, label: "FAILED", gradient: "linear-gradient(135deg, #dc262620, #dc262605)" },
  ENDED_NG: { bg: "rgba(239,68,68,0.12)", bd: "rgba(239,68,68,0.38)", fg: "#dc2626", icon: <XCircle size={10} />, label: "FAILED", gradient: "linear-gradient(135deg, #dc262620, #dc262605)" },
  BLOCKED: { bg: "rgba(245,158,11,0.14)", bd: "rgba(245,158,11,0.42)", fg: "#d97706", icon: <AlertTriangle size={10} />, label: "BLOCKED", gradient: "linear-gradient(135deg, #d9770620, #d9770605)" },
  IDLE: { bg: "rgba(148,163,184,0.14)", bd: "rgba(148,163,184,0.38)", fg: "#64748b", icon: <Pause size={10} />, label: "IDLE", gradient: "linear-gradient(135deg, #64748b20, #64748b05)" },
  COMPLETED_OK: { bg: "rgba(34,197,94,0.12)", bd: "rgba(34,197,94,0.38)", fg: "#16a34a", icon: <CheckCircle size={10} />, label: "COMPLETED", gradient: "linear-gradient(135deg, #16a34a20, #16a34a05)" },
};

const machineIcons = {
  DEFAULT: <Cpu size={16} />,
  PRINTER: <Printer size={16} />,
  CAMERA: <Camera size={16} />,
  PACKAGING: <Package size={16} />,
  QUALITY: <Gauge size={16} />,
  SCANNER: <QrCode size={16} />,
};

function getMachineIcon(machineName) {
  const name = String(machineName || "").toLowerCase();
  if (name.includes("print")) return machineIcons.PRINTER;
  if (name.includes("camera") || name.includes("vision")) return machineIcons.CAMERA;
  if (name.includes("pack")) return machineIcons.PACKAGING;
  if (name.includes("qual") || name.includes("test")) return machineIcons.QUALITY;
  if (name.includes("scan")) return machineIcons.SCANNER;
  return machineIcons.DEFAULT;
}

function isLeakTestNode(node = {}) {
  const n = String(node.machineName || node.machine_name || "").toLowerCase();
  // Use OR so naming variants like "Leak-1", "Air Test", "Leak Check"
  // are still grouped when OP/sequence are the same.
  return n.includes("leak") || n.includes("test");
}

function mergeGroupedStatus(nodes = []) {
  const states = nodes.map((n) => String(n.status || "").toUpperCase());
  if (states.some((s) => ["FAILED", "NG", "ENDED_NG", "BLOCKED", "INTERLOCKED"].includes(s))) return "FAILED";
  if (states.some((s) => ["RUNNING", "STARTED", "IN_PROGRESS"].includes(s))) return "RUNNING";
  if (states.some((s) => ["PASSED", "ENDED_OK", "COMPLETED_OK"].includes(s))) return "PASSED";
  return states[0] || "IDLE";
}

function groupLineNodes(nodes = []) {
  const direct = [];
  const leakBuckets = new Map();
  for (const node of nodes) {
    const station = String(node.stationNo || node.operationNo || "").trim().toUpperCase();
    // Group leak-test nodes by station only so all parallel leak machines
    // appear as one process block for the same operation/station.
    const key = `${station}`;
    if (isLeakTestNode(node)) {
      if (!leakBuckets.has(key)) leakBuckets.set(key, []);
      leakBuckets.get(key).push(node);
    } else {
      direct.push(node);
    }
  }
  for (const [key, bucket] of leakBuckets.entries()) {
    if (!bucket.length) continue;
    if (bucket.length === 1) {
      direct.push(bucket[0]);
      continue;
    }
    const base = bucket[0];
    direct.push({
      ...base,
      machineId: `LEAK_GROUP_${key}`,
      machineName: `${base.machineName || "Leak Test"} (${bucket.length})`,
      status: mergeGroupedStatus(bucket),
      groupedMachineCount: bucket.length,
      groupedMachineNames: bucket.map((x) => x.machineName).filter(Boolean),
    });
  }
  return direct.sort((a, b) => Number(a.sequenceNo || 0) - Number(b.sequenceNo || 0));
}

function StatusBadge({ status, showIcon = true, size = "sm" }) {
  const normalized = String(status || "IDLE").trim().toUpperCase();
  const style = statusStyle[normalized] || statusStyle.IDLE;
  const padding = size === "sm" ? "2px 8px" : "4px 12px";
  const fontSize = size === "sm" ? 9 : 11;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding,
        borderRadius: 999,
        fontSize,
        fontWeight: 800,
        letterSpacing: "0.06em",
        border: `1px solid ${style.bd}`,
        background: style.bg,
        color: style.fg,
      }}
    >
      {showIcon && style.icon}
      {style.label || normalized}
    </span>
  );
}

function NodeCard({ node, index, isFirst, isLast, totalNodes }) {
  const [hovered, setHovered] = useState(false);
  const machineIcon = getMachineIcon(node.machineName);
  const status = statusStyle[node.status] || statusStyle.IDLE;

  // Calculate progress percentage through the line
  const progressPercent = ((index + 1) / totalNodes) * 100;

  return (
    <div
      style={{
        position: "relative",
        minWidth: 220,
        maxWidth: 240,
        borderRadius: 16,
        border: `2px solid ${hovered ? status.bd : "var(--app-border)"}`,
        background: hovered ? status.gradient : "var(--app-bg-surface)",
        padding: "14px 16px",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: "pointer",
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        boxShadow: hovered ? `0 8px 20px ${status.fg}20` : "0 1px 3px rgba(0,0,0,0.1)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
     

     

      {/* Icon and name */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, marginTop: 6 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: status.bg,
            border: `1.5px solid ${status.bd}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: status.fg,
            transition: "all 0.2s ease",
            transform: hovered ? "scale(1.05)" : "scale(1)",
          }}
        >
          {machineIcon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", marginBottom: 2, letterSpacing: "0.05em" }}>
            {node.stationNo || "Station"}
          </div>
          <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{node.machineName}</div>
        </div>
      </div>

      {/* Status and metrics */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid var(--app-border)",
        }}
      >
        <StatusBadge status={node.status} showIcon={true} />
        <span style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace", fontWeight: 600 }}>
          #{String(node.sequenceNo).padStart(2, "0")}
        </span>
      </div>

      {/* Process Lifecycle Steps - Enhanced */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 8, opacity: 0.5, marginBottom: 6, letterSpacing: "0.08em", fontWeight: 600 }}>
          PROCESS STEPS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "QR Verification", checked: ["PENDING", "STARTED", "RUNNING", "PASSED", "FAILED", "ENDED_OK", "ENDED_NG", "COMPLETED_OK", "COMPLETED_NG"].includes(node.status), icon: <QrCode size={8} /> },
            { label: "Processing", checked: ["STARTED", "RUNNING", "PASSED", "FAILED", "ENDED_OK", "ENDED_NG", "COMPLETED_OK", "COMPLETED_NG"].includes(node.status), icon: <Activity size={8} /> },
            { label: "Result", checked: ["PASSED", "FAILED", "ENDED_OK", "ENDED_NG", "COMPLETED_OK", "COMPLETED_NG"].includes(node.status), icon: node.status === "FAILED" ? <XCircle size={8} /> : <CheckCircle size={8} /> },
          ].map((step, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, opacity: step.checked ? 1 : 0.4 }}>
              <div style={{
                width: 16, height: 16, borderRadius: 4,
                background: step.checked ? (node.status === "FAILED" || node.status === "ENDED_NG" || node.status === "NG" ? "#dc2626" : "#16a34a") : "transparent",
                border: `1px solid ${step.checked ? "transparent" : "var(--app-border)"}`,
                display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                {step.checked && (node.status === "FAILED" || node.status === "ENDED_NG" || node.status === "NG" ? <XCircle size={10} color="#fff" /> : <CheckCircle size={10} color="#fff" />)}
              </div>
              <span style={{ fontSize: 9, fontWeight: step.checked ? 600 : 500, color: step.checked ? "var(--app-text-main)" : "var(--app-text-muted)" }}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Metrics */}
      {(node.currentPartId || node.cycleTime) && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: "1px dashed var(--app-border)",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {node.currentPartId && (
            <div style={{ fontSize: 9, color: "var(--app-text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <Package size={9} />
              <span style={{ fontFamily: "monospace" }}>{node.currentPartId.slice(-8)}</span>
            </div>
          )}
          {node.cycleTime && (
            <div style={{ fontSize: 9, color: "var(--app-text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <Clock size={9} />
              <span>{node.cycleTime}s</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EnhancedArrowConnector({ isLast, status, fromNode, toNode }) {
  const [hovered, setHovered] = useState(false);
  const arrowColor = statusStyle[status]?.fg || "#64748b";

  if (isLast) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 60,
        position: "relative",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Animated flow line */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "50%",
          transform: "translateY(-50%)",
          width: "100%",
          height: 3,
          background: `linear-gradient(90deg, ${hovered ? arrowColor : "rgba(84,119,146,0.3)"}, ${hovered ? arrowColor + "80" : "rgba(84,119,146,0.15)"})`,
          transition: "all 0.3s ease",
          borderRadius: 3,
        }}
      >
        {/* Animated dot */}
        <div
          style={{
            position: "absolute",
            left: hovered ? "100%" : "0%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: arrowColor,
            transition: "left 0.5s ease-in-out",
            boxShadow: `0 0 8px ${arrowColor}`,
          }}
        />
      </div>

      {/* Arrow head */}
      <div
        style={{
          position: "absolute",
          right: -4,
          top: "50%",
          transform: "translateY(-50%)",
          width: 0,
          height: 0,
          borderLeft: `8px solid ${hovered ? arrowColor : "rgba(84,119,146,0.5)"}`,
          borderTop: "6px solid transparent",
          borderBottom: "6px solid transparent",
          transition: "border-color 0.3s ease",
        }}
      />

      {/* Hover effect ring */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: `${arrowColor}15`,
            animation: "ripple 1s ease-out infinite",
          }}
        />
      )}

      {/* Flow direction indicator */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          background: "var(--app-bg-card)",
          borderRadius: "50%",
          padding: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s ease",
        }}
      >
        <ArrowRight
          size={16}
          style={{
            color: hovered ? arrowColor : "rgba(84,119,146,0.6)",
            transition: "color 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}

function LineHeader({ lineName, stats }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20,
        padding: "12px 20px",
        background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(59,130,246,0.03))",
        borderRadius: 16,
        borderLeft: "4px solid #3b82f6",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "linear-gradient(135deg, #3b82f6, #2563eb)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px #3b82f640",
          }}
        >
          <Route size={22} color="#fff" />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", background: "linear-gradient(135deg, #3b82f6, #60a5fa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            {lineName}
          </div>
          <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>Production Workflow • Real-time Status</div>
        </div>
      </div>

      {stats && (
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ textAlign: "center", padding: "2px 6px", borderRadius: 8, background: "rgba(59,130,246,0.1)" }}>
            <div style={{ fontSize: 10, opacity: 0.7 }}>Machines</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#3b82f6" }}>{stats.totalMachines}</div>
          </div>
          <div style={{ textAlign: "center", padding: "4px 8px", borderRadius: 8, background: "rgba(34,197,94,0.1)" }}>
            <div style={{ fontSize: 10, opacity: 0.7 }}>Active</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#16a34a" }}>{stats.activeMachines}</div>
          </div>
          <div style={{ textAlign: "center", padding: "4px 8px", borderRadius: 8, background: "rgba(139,92,246,0.1)" }}>
            <div style={{ fontSize: 10, opacity: 0.7 }}>Today's Output</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#8b5cf6" }}>{stats.completedToday}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Enhanced CSS animations
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes pulse {
    0% {
      transform: translate(-50%, -50%) scale(0.8);
      opacity: 0.8;
    }
    100% {
      transform: translate(-50%, -50%) scale(2);
      opacity: 0;
    }
  }
  
  @keyframes ripple {
    0% {
      transform: translate(-50%, -50%) scale(0.5);
      opacity: 0.6;
    }
    100% {
      transform: translate(-50%, -50%) scale(1.8);
      opacity: 0;
    }
  }
  
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  
  @keyframes glow {
    0% {
      box-shadow: 0 0 0px rgba(59,130,246,0);
    }
    50% {
      box-shadow: 0 0 12px rgba(59,130,246,0.4);
    }
    100% {
      box-shadow: 0 0 0px rgba(59,130,246,0);
    }
  }
  
  .flow-line {
    animation: slideIn 0.5s ease-out;
  }
  
  .glow-effect {
    animation: glow 2s ease-in-out infinite;
  }
`;
document.head.appendChild(styleSheet);

export default function ProcessFlow() {
  const [flow, setFlow] = useState({ lines: [], availableLines: [] });
  const [lineName, setLineName] = useState("");
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const loadFlow = useCallback(async () => {
    setLoading(true);
    try {
      const data = await traceabilityApi.processFlow({ lineName: lineName || undefined });
      setFlow(data || { lines: [], availableLines: [] });
      setLastUpdate(new Date());
    } finally {
      setLoading(false);
    }
  }, [lineName]);

  useEffect(() => {
    loadFlow();
    const timer = setInterval(loadFlow, 8000);
    return () => clearInterval(timer);
  }, [loadFlow]);

  useEffect(() => {
    let refreshTimer = null;
    const socket = io(SOCKET_URL, {
      ...SOCKET_OPTIONS,
      reconnection: true,
      reconnectionAttempts: Infinity,
      timeout: 10000,
    });
    socket.on("dashboard_refresh", () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        loadFlow();
      }, 400);
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.off("dashboard_refresh");
      if (socket.connected) socket.disconnect();
    };
  }, [loadFlow]);

  const visibleLines = useMemo(() => flow.lines || [], [flow.lines]);
  const preparedLines = useMemo(
    () => (visibleLines || []).map((line) => ({ ...line, preparedNodes: groupLineNodes(line.nodes || []) })),
    [visibleLines]
  );

  // Calculate line statistics
  const lineStats = useMemo(() => {
    const stats = {};
    preparedLines.forEach(line => {
      const nodes = line.preparedNodes || [];
      stats[line.lineName] = {
        totalMachines: nodes.length,
        activeMachines: nodes.filter(n => n.status === "RUNNING").length,
        completedToday: nodes.reduce((sum, n) => sum + (n.todayCount || 0), 0),
      };
    });
    return stats;
  }, [preparedLines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingBottom: 30 }}>
      {/* Header Controls */}
      <div
        style={{
          background: "linear-gradient(135deg, var(--app-bg-card), var(--app-bg-surface))",
          border: "1px solid var(--app-border)",
          borderRadius: 20,
          padding: "16px 24px",
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              className="glow-effect"
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 16px rgba(59,130,246,0.3)",
              }}
            >
              <Route size={24} color="#fff" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>Process Flow Diagram</div>
              <div style={{ fontSize: 12, opacity: 0.7, display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <Activity size={12} />
                Live machine workflow visualization
                <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 8 }}>
                  Last updated: {lastUpdate.toLocaleTimeString()}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <select
                value={lineName}
                onChange={(e) => setLineName(e.target.value)}
                style={{
                  height: 38,
                  borderRadius: 12,
                  border: "1.5px solid var(--app-border)",
                  padding: "0 32px 0 14px",
                  background: "var(--app-bg-surface)",
                  color: "var(--app-text-main)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  appearance: "none",
                }}
              >
                <option value="">All Production Lines</option>
                {(flow.availableLines || []).map((line) => (
                  <option key={line} value={line}>
                    {line}
                  </option>
                ))}
              </select>
              <ChevronRight size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%) rotate(90deg)", pointerEvents: "none", opacity: 0.5 }} />
            </div>

            <div
              style={{
                display: "flex",
                gap: 4,
                padding: "4px",
                background: "var(--app-bg-surface)",
                border: "1.5px solid var(--app-border)",
                borderRadius: 12,
              }}
            >
              <button
                onClick={() => setZoom((prev) => Math.max(0.5, Number((prev - 0.1).toFixed(2))))}
                style={{
                  width: 34,
                  height: 32,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--app-text-main)",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--app-border)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <ZoomOut size={15} />
              </button>
              <span
                style={{
                  minWidth: 50,
                  textAlign: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "monospace",
                }}
              >
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((prev) => Math.min(2, Number((prev + 0.1).toFixed(2))))}
                style={{
                  width: 34,
                  height: 32,
                  borderRadius: 8,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--app-text-main)",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--app-border)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <ZoomIn size={15} />
              </button>
            </div>

            <button
              onClick={loadFlow}
              disabled={loading}
              style={{
                height: 38,
                borderRadius: 12,
                border: "1.5px solid var(--app-border)",
                padding: "0 18px",
                background: "linear-gradient(135deg, var(--app-bg-surface), var(--app-bg-card))",
                color: "var(--app-text-main)",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Flow Diagram */}
      {preparedLines.length === 0 ? (
        <div
          style={{
            background: "linear-gradient(135deg, var(--app-bg-card), var(--app-bg-surface))",
            border: "1px solid var(--app-border)",
            borderRadius: 20,
            padding: 60,
            textAlign: "center",
          }}
        >
          <div style={{ width: 80, height: 80, margin: "0 auto 16px", background: "rgba(59,130,246,0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Route size={40} style={{ opacity: 0.4 }} />
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No Process Flow Data Available</p>
          <p style={{ fontSize: 12, opacity: 0.6 }}>Select a production line or check machine configurations</p>
        </div>
      ) : (
        preparedLines.map((line, lineIndex) => (
          <div
            key={line.lineName}
            className="flow-line"
            style={{
              background: "linear-gradient(135deg, var(--app-bg-card), var(--app-bg-surface))",
              border: "1px solid var(--app-border)",
              borderRadius: 20,
              padding: "20px 24px",
              overflow: "hidden",
            }}
          >
            <LineHeader lineName={line.lineName} stats={lineStats[line.lineName]} />

            <div style={{ overflowX: "auto", paddingBottom: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  minWidth: 900,
                  transform: `scale(${zoom})`,
                  transformOrigin: "left top",
                  transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {/* Start Indicator */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    marginRight: 4,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #10b981, #059669)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 4px 12px #10b98140",
                    }}
                  >
                    <Flag size={22} color="#fff" />
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.7 }}>START</span>
                </div>

                {/* Arrow from start to first node */}
                <div style={{ minWidth: 30, position: "relative" }}>
                  <ArrowRight size={20} style={{ opacity: 0.5 }} />
                </div>

                {/* Nodes with arrows */}
                {(line.preparedNodes || []).map((node, index) => (
                  <div key={node.machineId} style={{ display: "flex", alignItems: "center" }}>
                    <NodeCard
                      node={node}
                      index={index}
                      isFirst={index === 0}
                      isLast={index === (line.preparedNodes || []).length - 1}
                      totalNodes={(line.preparedNodes || []).length}
                    />
                    <EnhancedArrowConnector
                      isLast={index === (line.preparedNodes || []).length - 1}
                      status={node.status}
                      fromNode={node}
                      toNode={(line.preparedNodes || [])[index + 1]}
                    />
                  </div>
                ))}

                {/* End Indicator */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    marginLeft: 4,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #ef4444, #dc2626)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 4px 12px #ef444440",
                    }}
                  >
                    <CheckCircle size={22} color="#fff" />
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 600, opacity: 0.7 }}>END</span>
                </div>
              </div>
            </div>

            {/* Enhanced Legend */}
            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: "1.5px solid var(--app-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.6 }}>
                  Status Legend:
                </span>
                {Object.entries(statusStyle).slice(0, 5).map(([key, style]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: style.fg,
                        boxShadow: `0 0 6px ${style.fg}`,
                      }}
                    />
                    <span style={{ fontSize: 10, fontWeight: 600, color: style.fg }}>{key}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Flag size={12} style={{ opacity: 0.7 }} />
                  <span style={{ fontSize: 10, opacity: 0.7 }}>Start</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ArrowRight size={12} style={{ opacity: 0.7 }} />
                  <span style={{ fontSize: 10, opacity: 0.7 }}>Flow Direction</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle size={12} style={{ opacity: 0.7 }} />
                  <span style={{ fontSize: 10, opacity: 0.7 }}>End</span>
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
