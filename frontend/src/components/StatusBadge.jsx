/**
 * StatusBadge — Reusable inline status badge component.
 * Used in GlobalPopup timeline, Dashboard, and Part Journey views.
 *
 * Props:
 *   status: "PASS" | "FAIL" | "RUN" | "WAIT" | "PENDING" | string
 *   size?:  "sm" | "md" (default "md")
 */
const STATUS_CONFIG = {
  // Success states
  PASS:         { bg: "#dcfce7", color: "#166534", dot: "#16a34a", label: "PASS" },
  PASSED:       { bg: "#dcfce7", color: "#166534", dot: "#16a34a", label: "PASS" },
  COMPLETED:    { bg: "#dcfce7", color: "#166534", dot: "#16a34a", label: "PASS" },
  COMPLETED_OK: { bg: "#dcfce7", color: "#166534", dot: "#16a34a", label: "PASS" },
  ENDED_OK:     { bg: "#dcfce7", color: "#166534", dot: "#16a34a", label: "PASS" },

  // Failure/Error states
  FAIL:         { bg: "#fee2e2", color: "#991b1b", dot: "#dc2626", label: "FAIL" },
  FAILED:       { bg: "#fee2e2", color: "#991b1b", dot: "#dc2626", label: "FAIL" },
  NG:           { bg: "#fee2e2", color: "#991b1b", dot: "#dc2626", label: "FAIL" },
  COMPLETED_NG: { bg: "#fee2e2", color: "#991b1b", dot: "#dc2626", label: "FAIL" },
  ENDED_NG:     { bg: "#fee2e2", color: "#991b1b", dot: "#dc2626", label: "FAIL" },
  INTERLOCKED:  { bg: "#fee2e2", color: "#991b1b", dot: "#dc2626", label: "INTERLOCK" },
  PLC_ERROR:    { bg: "#fee2e2", color: "#991b1b", dot: "#dc2626", label: "PLC ERR" },
  COMM_ERROR:   { bg: "#fee2e2", color: "#991b1b", dot: "#dc2626", label: "COMM ERR" },
  PLC_TIMEOUT:  { bg: "#fee2e2", color: "#991b1b", dot: "#dc2626", label: "TIMEOUT" },

  // Active / Running states
  RUN:             { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "RUNNING", glow: true },
  RUNNING:         { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "RUNNING", glow: true },
  IN_PROGRESS:     { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "IN PROGRESS", glow: true },
  WAITING_RUNNING: { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "STARTING", glow: true },
  WAITING_END:     { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "FINISHING", glow: true },
  WAITING_ACK:     { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "HANDSHAKE", glow: true },
  ACK_RECEIVED:    { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "ACK RCVD", glow: true },
  SCANNED:         { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "SCANNED", glow: true },
  VALIDATED:       { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "VALIDATED", glow: true },
  START_SENT:      { bg: "#fef3c7", color: "#92400e", dot: "#d97706", label: "START SENT", glow: true },

  // Idle / Initial states
  WAIT:    { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8", label: "WAITING" },
  PENDING: { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8", label: "PENDING" },
  RESET:   { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8", label: "RESET" },
};

const StatusBadge = ({ status = "WAIT", size = "md", label: overrideLabel }) => {
  const key     = String(status || "WAIT").toUpperCase();
  const config  = STATUS_CONFIG[key] || STATUS_CONFIG.WAIT;
  const label   = overrideLabel ?? config.label;
  const dotSize = size === "sm" ? 5 : 6;
  const padding = size === "sm" ? "2px 6px" : "3px 9px";
  const font    = size === "sm" ? "9px" : "10px";

  return (
    <span style={{
      display:        "inline-flex",
      alignItems:     "center",
      gap:            4,
      background:     config.bg,
      color:          config.color,
      padding,
      borderRadius:   999,
      fontSize:       font,
      fontWeight:     800,
      letterSpacing:  "0.07em",
      boxShadow:      config.glow ? `0 0 6px ${config.dot}66` : undefined,
      whiteSpace:     "nowrap",
    }}>
      <span style={{
        width:        dotSize,
        height:       dotSize,
        borderRadius: "50%",
        background:   config.dot,
        flexShrink:   0,
        boxShadow:    config.glow ? `0 0 4px ${config.dot}` : undefined,
      }}/>
      {label}
    </span>
  );
};

export default StatusBadge;
