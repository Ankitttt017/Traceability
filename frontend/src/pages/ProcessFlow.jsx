import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { 
  RefreshCw, Route, ZoomIn, ZoomOut, 
  ChevronRight, Cpu, CheckCircle, XCircle, 
  AlertTriangle, Play, Pause, Box, 
  ArrowRight, ArrowLeftRight, Circle, 
  Activity, Zap, Shield, Wifi, WifiOff,
  Printer, QrCode, Camera, Gauge, Package
} from "lucide-react";
import { traceabilityApi } from "../api/services";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

const statusStyle = {
  RUNNING: { bg: "rgba(34,197,94,0.12)", bd: "rgba(34,197,94,0.38)", fg: "#16a34a", icon: <Play size={10} /> },
  PASSED: { bg: "rgba(59,130,246,0.12)", bd: "rgba(59,130,246,0.38)", fg: "#2563eb", icon: <CheckCircle size={10} /> },
  FAILED: { bg: "rgba(239,68,68,0.12)", bd: "rgba(239,68,68,0.38)", fg: "#dc2626", icon: <XCircle size={10} /> },
  BLOCKED: { bg: "rgba(245,158,11,0.14)", bd: "rgba(245,158,11,0.42)", fg: "#d97706", icon: <AlertTriangle size={10} /> },
  IDLE: { bg: "rgba(148,163,184,0.14)", bd: "rgba(148,163,184,0.38)", fg: "#64748b", icon: <Pause size={10} /> },
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

function StatusBadge({ status, showIcon = true }) {
  const normalized = String(status || "IDLE").trim().toUpperCase();
  const style = statusStyle[normalized] || statusStyle.IDLE;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: "0.06em",
        border: `1px solid ${style.bd}`,
        background: style.bg,
        color: style.fg,
      }}
    >
      {showIcon && style.icon}
      {normalized}
    </span>
  );
}

function NodeCard({ node, index, isFirst, isLast, totalNodes }) {
  const [hovered, setHovered] = useState(false);
  const machineIcon = getMachineIcon(node.machineName);
  
  return (
    <div
      style={{
        position: "relative",
        minWidth: 200,
        maxWidth: 220,
        borderRadius: 12,
        border: `2px solid ${hovered ? statusStyle[node.status]?.bd || "#cbd5e1" : "var(--app-border)"}`,
        background: hovered ? "rgba(59,130,246,0.04)" : "var(--app-bg-surface)",
        padding: "12px 14px",
        transition: "all 0.2s ease",
        cursor: "pointer",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered ? "0 4px 12px rgba(0,0,0,0.1)" : "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Step indicator */}
      <div
        style={{
          position: "absolute",
          top: -10,
          left: 12,
          background: "var(--app-bg-card)",
          border: `1px solid ${statusStyle[node.status]?.bd || "#cbd5e1"}`,
          borderRadius: 20,
          padding: "0 8px",
          fontSize: 9,
          fontWeight: 800,
          color: statusStyle[node.status]?.fg || "#64748b",
        }}
      >
        STEP {String(index + 1).padStart(2, "0")}
      </div>

      {/* Icon and name */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 4 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: `${statusStyle[node.status]?.fg || "#64748b"}15`,
            border: `1px solid ${statusStyle[node.status]?.bd || "#cbd5e1"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: statusStyle[node.status]?.fg || "#64748b",
          }}
        >
          {machineIcon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", marginBottom: 2 }}>
            {node.stationNo || "-"}
          </div>
          <div style={{ fontWeight: 700, fontSize: 12, lineHeight: 1.2 }}>{node.machineName}</div>
        </div>
      </div>

      {/* Status and sequence */}
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
        <span style={{ fontSize: 10, opacity: 0.5, fontFamily: "monospace" }}>
          #{String(node.sequenceNo).padStart(2, "0")}
        </span>
      </div>

      {/* Additional metrics if available */}
      {node.currentPartId && (
        <div
          style={{
            marginTop: 8,
            fontSize: 9,
            color: "var(--app-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <Activity size={10} />
          <span>Part: {node.currentPartId}</span>
        </div>
      )}

      {node.cycleTime && (
        <div
          style={{
            marginTop: 4,
            fontSize: 9,
            color: "var(--app-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Zap size={10} />
          <span>CT: {node.cycleTime}s</span>
        </div>
      )}
    </div>
  );
}

function ArrowConnector({ isLast, status }) {
  const [hovered, setHovered] = useState(false);
  const arrowColor = statusStyle[status]?.fg || "#64748b";
  
  if (isLast) return null;
  
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 50,
        position: "relative",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Animated flow indicator */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "50%",
          transform: "translateY(-50%)",
          width: "100%",
          height: 2,
          background: hovered ? arrowColor : "rgba(84,119,146,0.4)",
          transition: "background 0.2s ease",
          borderRadius: 2,
        }}
      >
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            width: 0,
            height: 0,
            borderLeft: `6px solid ${hovered ? arrowColor : "rgba(84,119,146,0.6)"}`,
            borderTop: "4px solid transparent",
            borderBottom: "4px solid transparent",
            transition: "border-color 0.2s ease",
          }}
        />
      </div>
      
      {/* Pulse animation on hover */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: `${arrowColor}20`,
            animation: "pulse 1s ease-out infinite",
          }}
        />
      )}
      
      <ArrowRight
        size={18}
        style={{
          color: hovered ? arrowColor : "rgba(84,119,146,0.5)",
          transition: "color 0.2s ease",
          position: "relative",
          zIndex: 1,
        }}
      />
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
        marginBottom: 16,
        padding: "8px 12px",
        background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(59,130,246,0.02))",
        borderRadius: 10,
        borderLeft: "3px solid #3b82f6",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#3b82f620",
            border: "1px solid #3b82f640",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Route size={16} color="#3b82f6" />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {lineName}
          </div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>Production Line</div>
        </div>
      </div>
      
      {stats && (
        <div style={{ display: "flex", gap: 12 }}>
          {stats.totalMachines > 0 && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, opacity: 0.6 }}>Machines</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#3b82f6" }}>{stats.totalMachines}</div>
            </div>
          )}
          {stats.activeMachines > 0 && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, opacity: 0.6 }}>Active</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#16a34a" }}>{stats.activeMachines}</div>
            </div>
          )}
          {stats.completedToday && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, opacity: 0.6 }}>Today</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#8b5cf6" }}>{stats.completedToday}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Add CSS animation
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes pulse {
    0% {
      transform: translate(-50%, -50%) scale(0.8);
      opacity: 0.8;
    }
    100% {
      transform: translate(-50%, -50%) scale(1.5);
      opacity: 0;
    }
  }
`;
document.head.appendChild(styleSheet);

export default function ProcessFlow() {
  const [flow, setFlow] = useState({ lines: [], availableLines: [] });
  const [lineName, setLineName] = useState("");
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);

  const loadFlow = useCallback(async () => {
    setLoading(true);
    try {
      const data = await traceabilityApi.processFlow({ lineName: lineName || undefined });
      setFlow(data || { lines: [], availableLines: [] });
    } finally {
      setLoading(false);
    }
  }, [lineName]);

  useEffect(() => {
    loadFlow();
    const timer = setInterval(loadFlow, 10000);
    return () => clearInterval(timer);
  }, [loadFlow]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { path: "/socket.io/", transports: ["websocket", "polling"] });
    socket.on("dashboard_refresh", () => loadFlow());
    return () => socket.disconnect();
  }, [loadFlow]);

  const visibleLines = useMemo(() => flow.lines || [], [flow.lines]);

  // Calculate line statistics
  const lineStats = useMemo(() => {
    const stats = {};
    visibleLines.forEach(line => {
      const nodes = line.nodes || [];
      stats[line.lineName] = {
        totalMachines: nodes.length,
        activeMachines: nodes.filter(n => n.status === "RUNNING").length,
        completedToday: nodes.reduce((sum, n) => sum + (n.todayCount || 0), 0),
      };
    });
    return stats;
  }, [visibleLines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 20 }}>
      {/* Header Controls */}
      <div
        style={{
          background: "var(--app-bg-card)",
          border: "1px solid var(--app-border)",
          borderRadius: 14,
          padding: "14px 18px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#3b82f620",
                border: "1px solid #3b82f640",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Route size={20} color="#3b82f6" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Process Flow Diagram</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Live machine workflow visualization</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              value={lineName}
              onChange={(e) => setLineName(e.target.value)}
              style={{
                height: 34,
                borderRadius: 8,
                border: "1px solid var(--app-border)",
                padding: "0 12px",
                background: "var(--app-bg-surface)",
                color: "var(--app-text-main)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <option value="">All Lines</option>
              {(flow.availableLines || []).map((line) => (
                <option key={line} value={line}>
                  {line}
                </option>
              ))}
            </select>

            <div
              style={{
                display: "flex",
                gap: 4,
                padding: "3px",
                background: "var(--app-bg-surface)",
                border: "1px solid var(--app-border)",
                borderRadius: 8,
              }}
            >
              <button
                onClick={() => setZoom((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))}
                style={{
                  width: 30,
                  height: 28,
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--app-text-main)",
                }}
              >
                <ZoomOut size={14} />
              </button>
              <span
                style={{
                  minWidth: 45,
                  textAlign: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((prev) => Math.min(1.8, Number((prev + 0.1).toFixed(2))))}
                style={{
                  width: 30,
                  height: 28,
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--app-text-main)",
                }}
              >
                <ZoomIn size={14} />
              </button>
            </div>

            <button
              onClick={loadFlow}
              disabled={loading}
              style={{
                height: 34,
                borderRadius: 8,
                border: "1px solid var(--app-border)",
                padding: "0 14px",
                background: "var(--app-bg-surface)",
                color: "var(--app-text-main)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Flow Diagram */}
      {visibleLines.length === 0 ? (
        <div
          style={{
            background: "var(--app-bg-card)",
            border: "1px solid var(--app-border)",
            borderRadius: 14,
            padding: 48,
            textAlign: "center",
            opacity: 0.75,
          }}
        >
          <Route size={40} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
          <p style={{ fontSize: 13, fontWeight: 500 }}>No process flow data available</p>
          <p style={{ fontSize: 11, marginTop: 4 }}>Select a line or check machine configurations</p>
        </div>
      ) : (
        visibleLines.map((line) => (
          <div
            key={line.lineName}
            style={{
              background: "var(--app-bg-card)",
              border: "1px solid var(--app-border)",
              borderRadius: 14,
              padding: "16px 18px",
              overflow: "hidden",
            }}
          >
            <LineHeader lineName={line.lineName} stats={lineStats[line.lineName]} />

            <div style={{ overflowX: "auto", paddingBottom: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 800,
                  transform: `scale(${zoom})`,
                  transformOrigin: "left top",
                  transition: "transform 0.2s ease",
                }}
              >
                {(line.nodes || []).map((node, index) => (
                  <div key={node.machineId} style={{ display: "flex", alignItems: "center" }}>
                    <NodeCard
                      node={node}
                      index={index}
                      isFirst={index === 0}
                      isLast={index === (line.nodes || []).length - 1}
                      totalNodes={(line.nodes || []).length}
                    />
                    <ArrowConnector
                      isLast={index === (line.nodes || []).length - 1}
                      status={node.status}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div
              style={{
                marginTop: 16,
                paddingTop: 12,
                borderTop: "1px solid var(--app-border)",
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", opacity: 0.6 }}>
                Status Legend:
              </span>
              {Object.entries(statusStyle).map(([key, style]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: style.fg,
                      boxShadow: `0 0 4px ${style.fg}`,
                    }}
                  />
                  <span style={{ fontSize: 9, fontWeight: 600, color: style.fg }}>{key}</span>
                </div>
              ))}
              <div style={{ width: 1, height: 20, background: "var(--app-border)" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <ArrowRight size={12} style={{ opacity: 0.6 }} />
                <span style={{ fontSize: 9, opacity: 0.6 }}>Flow Direction</span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}