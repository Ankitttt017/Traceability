// UPGRADE COMPLETE - GlobalPopup with Part Journey Timeline (v2.1 - Production Fixed)
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Clock3,
  Layout,
  X,
  MapPin,
  ShieldCheck,
  XCircle,
  Cpu,
} from "lucide-react";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// --- Existing resolver functions - DO NOT CHANGE -----------------------------
function resolveQrState(popup = {}) {
  const decision = String(
    popup.qrResult ||
      popup.qrDecision ||
      popup.decision ||
      popup.outcome ||
      popup.scanOutcome ||
      popup.qrStatus ||
      ""
  )
    .trim()
    .toUpperCase();
  if (["ALLOW", "PASS", "OK", "ACCEPT", "VALID"].includes(decision))
    return "PASS";
  if (["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(decision))
    return "FAIL";
  return "WAIT";
}

function resolveOperationState(popup = {}) {
  const status = String(
    popup.plcStatus || popup.operationStatus || popup.status || ""
  )
    .trim()
    .toUpperCase();
  if (["ENDED_OK", "PASSED", "COMPLETED"].includes(status)) return "PASS";
  if (["ENDED_NG", "FAILED", "NG", "INTERLOCKED", "BLOCKED"].includes(status))
    return "FAIL";
  if (
    ["PLC_COMM_ERROR", "COMM_ERROR", "PLC_TIMEOUT", "TIMEOUT"].includes(status)
  )
    return "COMM";
  if (["STARTED", "PENDING", "IN_PROGRESS"].includes(status)) return "RUN";
  return "WAIT";
}

function resolveRejectionState(popup = {}, operationState) {
  const explicit = String(
    popup.rejectionStatus || popup.rejectionDecision || ""
  )
    .trim()
    .toUpperCase();
  if (["PASS", "FAIL", "PENDING"].includes(explicit)) return explicit;
  if (operationState === "FAIL") return "FAIL";
  if (operationState === "PASS") return "PASS";
  return "PENDING";
}
// --- End of preserved resolver functions -------------------------------------

// --- StatusBadge - reusable across app ---------------------------------------
export const StatusBadge = ({ status, overrideLabel }) => {
  const map = {
    PASS: {
      bg: "bg-success/15",
      text: "text-success",
      dot: "bg-success",
      label: "Passed",
    },
    FAIL: {
      bg: "bg-danger/15",
      text: "text-danger",
      dot: "bg-danger",
      label: "Failed",
    },
    RUN: {
      bg: "bg-warning/15",
      text: "text-warning",
      dot: "bg-warning animate-pulse",
      label: "Running",
    },
    COMM: {
      bg: "bg-comm/15",
      text: "text-comm",
      dot: "bg-comm",
      label: "Comm Error",
    },
    WAIT: {
      bg: "bg-bg-elevated",
      text: "text-text-muted",
      dot: "bg-border-strong",
      label: "Waiting",
    },
    PENDING: {
      bg: "bg-bg-elevated",
      text: "text-text-muted",
      dot: "bg-border-strong",
      label: "Pending",
    },
  };

  const theme = map[status] || map["WAIT"];
  const label = overrideLabel || theme.label;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${theme.bg} ${theme.text}`}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${theme.dot}`} />
      {label}
    </span>
  );
};

// --- StationCard --------------------------------------------------------------
const StationCard = ({ station, isLast }) => {
  const isCompleted = station.status === "COMPLETED";
  const isInProgress = station.status === "IN_PROGRESS";
  const isPending = station.status === "PENDING";

  const dotClass = isCompleted
    ? "bg-success"
    : isInProgress
    ? "bg-primary shadow-[0_0_0_4px_rgba(0,180,216,0.2)] animate-[pulse-ring_1.5s_ease-out_infinite]"
    : "bg-border-strong";

  const cardClass = isCompleted
    ? "bg-success/8 border-success/30"
    : isInProgress
    ? "bg-primary/8 border-primary/40 border-[1.5px]"
    : "bg-bg-card border-border border-dashed opacity-60";

  const titleColor = isCompleted
    ? "text-success"
    : isInProgress
    ? "text-primary"
    : "text-text-muted";

  const subtitleColor = isCompleted ? "text-success/80" : "text-primary/80";

  const dateObj = station.completedAt ? new Date(station.completedAt) : null;
  const timeStr = dateObj
    ? dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const dateStr = dateObj
    ? dateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

  // FIX 1: Always show all rows for non-pending stations
  const showRows = !isPending;

  return (
    <div className="flex gap-4">
      {/* Timeline spine */}
      <div className="flex flex-col items-center">
        <div
          className={`w-3.5 h-3.5 rounded-full z-10 mt-4 flex-shrink-0 ${dotClass}`}
        />
        {!isLast && (
          <div className="w-0.5 flex-1 my-1 bg-bg-elevated min-h-[20px]" />
        )}
      </div>

      {/* Card */}
      <div
        className={`flex-1 rounded-2xl border p-4 mb-4 transition-all ${cardClass}`}
      >
        {/* Card header */}
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`text-[14px] font-bold tracking-wide ${titleColor}`}>
                {station.stationName || station.stationNo}
              </h3>
              {isInProgress && (
                <span className="px-2 py-0.5 rounded-full bg-primary text-on-strong text-[9px] font-black uppercase tracking-wider">
                  Current
                </span>
              )}
            </div>
            {!isPending && (
              <p className={`text-[11px] mt-1 font-medium ${subtitleColor}`}>
                {isCompleted
                  ? `Previous station - completed`
                  : `In progress - ${timeStr || "started"}`}
              </p>
            )}
            {isPending && (
              <p className="text-[11px] mt-1 font-medium text-text-muted">
                Next station - not started
              </p>
            )}
          </div>
          {dateObj && (
            <div className="text-right flex-shrink-0 ml-2">
              <p className="text-[11px] text-text-muted font-medium">{dateStr}</p>
              <p className="text-[10px] text-text-muted">{timeStr}</p>
            </div>
          )}
        </div>

        {/* FIX 2: Show all 4 rows for any non-pending station */}
        {showRows && (
          <div className="border-t border-border/60 pt-1 space-y-0">
            <div className="flex items-center justify-between border-b border-border/60 py-2">
              <span className="text-[12px] font-bold text-text-muted">
                QR Verification
              </span>
              <StatusBadge status={station.qrVerification || "WAIT"} />
            </div>
            <div className="flex items-center justify-between border-b border-border/60 py-2">
              <span className="text-[12px] font-bold text-text-muted">
                Operation
              </span>
              <StatusBadge status={station.operation || "WAIT"} />
            </div>
            <div className="flex items-center justify-between border-b border-border/60 py-2">
              <span className="text-[12px] font-bold text-text-muted">
                Quality Check
              </span>
              <StatusBadge status={station.qualityCheck || "WAIT"} />
            </div>
            {/* Always show rejection confirmation for non-pending stations */}
            <div className="flex items-center justify-between py-2">
              <span className="text-[12px] font-bold text-text-muted">
                Rejection Confirmation
              </span>
              <StatusBadge
                status={station.rejectionConfirmation || "PENDING"}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Skeleton loader ----------------------------------------------------------
const JourneySkeleton = () => (
  <div className="space-y-4 animate-pulse px-1">
    {[1, 2, 3].map((i) => (
      <div key={i} className="flex gap-4">
        <div className="flex flex-col items-center">
          <div className="w-3.5 h-3.5 rounded-full bg-bg-elevated mt-4" />
          {i < 3 && <div className="w-0.5 flex-1 bg-bg-elevated my-1 min-h-[60px]" />}
        </div>
        <div className="flex-1 rounded-2xl border border-border-muted bg-bg-card p-4 mb-4">
          <div className="h-3.5 bg-bg-elevated rounded w-2/5 mb-3" />
          <div className="h-2.5 bg-bg-elevated rounded w-1/4 mb-4" />
          <div className="space-y-2">
            <div className="h-2.5 bg-bg-elevated rounded w-full" />
            <div className="h-2.5 bg-bg-elevated rounded w-full" />
            <div className="h-2.5 bg-bg-elevated rounded w-3/4" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// --- Main GlobalPopup Component -----------------------------------------------
const GlobalPopup = ({
  popup,
  onClose,
  onResetOperation,
  autoCloseMs = 4000,
  criticalAutoCloseMs = 9000,
  showAcknowledge = false,
  simple = false,
}) => {
  const [journeyData, setJourneyData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const partId = String(
    popup?.partId || popup?.part_id || ""
  ).trim();
  const stationNo = String(
    popup?.stationNo || popup?.station_no || ""
  ).trim();

  // Reset local state when popup changes
  useEffect(() => {
    setResetError("");
    setIsResetting(false);
    setShowResetConfirm(false);
  }, [partId, stationNo, popup?.message]);

  // Auto-close timer - DO NOT CHANGE logic
  useEffect(() => {
    if (!popup) return undefined;
    const qrState = resolveQrState(popup);
    const operationState = resolveOperationState(popup);
    const isCritical =
      String(popup.type || "").toUpperCase() === "ERROR" ||
      qrState === "FAIL" ||
      operationState === "FAIL" ||
      operationState === "COMM";
    const hasStateDetails = Boolean(
      partId ||
        stationNo ||
        qrState !== "WAIT" ||
        operationState !== "WAIT"
    );
    if (!hasStateDetails) {
      const t = setTimeout(() => onClose?.(), 2500);
      return () => clearTimeout(t);
    }
    const timeoutMs = isCritical
      ? Number(criticalAutoCloseMs)
      : Number(autoCloseMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined;
    const timer = setTimeout(() => onClose?.(), timeoutMs);
    return () => clearTimeout(timer);
  }, [popup, partId, stationNo, onClose, autoCloseMs, criticalAutoCloseMs]);

  // Fetch part journey
  useEffect(() => {
    let isActive = true;

    if (!partId) {
      setJourneyData(null);
      return () => {
        isActive = false;
      };
    }

    const token = localStorage.getItem("token");
    const fetchJourney = async () => {
      try {
        setLoading(true);
        setJourneyData(null);
        const res = await axios.get(
          `${API_BASE}/parts/${encodeURIComponent(partId)}/journey`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (isActive) {
          setJourneyData(res.data);
        }
      } catch (error) {
        console.warn(
          "[GlobalPopup] Journey fetch failed:",
          error?.message || error
        );
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    fetchJourney();

    return () => {
      isActive = false;
    };
  }, [partId]);

  if (!popup) return null;

  // -- Simple mode ------------------------------------------------------------
  if (simple) {
    const type = String(popup.type || "INFO").toUpperCase();
    const simpleTheme =
      type === "ERROR"
        ? "bg-red-600"
        : type === "SUCCESS"
        ? "bg-emerald-600"
        : type === "WARNING"
        ? "bg-amber-500"
        : "bg-cyan-600";
    const SimpleIcon =
      type === "ERROR"
        ? AlertTriangle
        : type === "SUCCESS"
        ? CheckCircle
        : Clock3;
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
        <div className="w-full max-w-md bg-bg-card rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.35)] animate-in zoom-in duration-200">
          <div
            className={`relative p-5 flex items-center gap-3 text-white ${simpleTheme}`}
          >
            {typeof onClose === "function" && (
              <button
                onClick={onClose}
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-black/10 text-white hover:bg-black/25"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            )}
            <SimpleIcon size={24} />
            <h2 className="text-lg font-bold">{popup.title || type}</h2>
          </div>
          <div className="p-5">
            <p className="text-sm text-text-main">
              {popup.message || "Update received."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // -- Full journey mode ------------------------------------------------------
  const stations = journeyData?.stations || [];

  const currentStationName =
    stations.find((s) => s.status === "IN_PROGRESS")?.stationName ||
    stationNo ||
    stations.slice(-1)[0]?.stationName ||
    "System Node";

  // FIX 3: Count by station.status === "COMPLETED" not qualityCheck
  const passCount = stations.filter(
    (s) => s.status === "COMPLETED"
  ).length;
  const totalCount = stations.length || "?";

  const allPassed =
    typeof totalCount === "number" && passCount === totalCount;

  const hour = new Date().getHours();
  const shiftText =
    hour >= 6 && hour < 14
      ? "Morning - A"
      : hour >= 14 && hour < 22
      ? "Evening - B"
      : "Night - C";

  const qrState = resolveQrState(popup);
  const operationState = resolveOperationState(popup);
  const rejectionState = resolveRejectionState(popup, operationState);

  const canReset =
    (operationState === "COMM" || operationState === "FAIL") &&
    Boolean(partId) &&
    Boolean(stationNo) &&
    typeof onResetOperation === "function";

  const handleReset = async () => {
    if (!partId || !stationNo || isResetting) return;
    setIsResetting(true);
    setResetError("");
    try {
      const completed = await onResetOperation(partId, stationNo, {
        confirmed: true,
      });
      if (completed === false) return;
      setShowResetConfirm(false);
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      const apiError = String(
        error?.response?.data?.error || ""
      )
        .trim()
        .toUpperCase();
      if (
        status === 401 ||
        apiError.includes("UNAUTHORIZED") ||
        apiError.includes("NO TOKEN")
      ) {
        setResetError("Session expired. Please login again.");
      } else {
        setResetError(error?.response?.data?.error || "Reset failed.");
      }
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-8">
      <div
        className="w-full max-w-[680px] bg-bg-card rounded-3xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in duration-200"
        style={{ maxHeight: "calc(100vh - 48px)" }}
      >
        {/* -- Dark Header -- */}
        <div
          className="rounded-t-3xl px-6 py-5 flex-shrink-0"
          style={{ background: "#1e293b" }}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div
                className="p-2.5 rounded-xl border border-white/5"
                style={{ background: "#0f172a" }}
              >
                <Layout className="text-amber-400" size={22} />
              </div>
              <div>
                <h2 className="text-white text-[17px] font-bold leading-tight">
                  Part Journey
                </h2>
                <p className="text-text-muted text-[10px] font-black uppercase tracking-widest mt-0.5">
                  Traceability View
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {partId && (
                <div
                  className="px-3 py-2 rounded-xl font-mono text-[12px] font-bold text-amber-400 border border-white/5 max-w-[220px] truncate"
                  style={{ background: "#0f172a" }}
                  title={partId}
                >
                  {partId}
                </div>
              )}
              {/* FIX: X icon instead of gray circle */}
              {typeof onClose === "function" && (
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full flex items-center justify-center border border-border/30 hover:bg-bg-hover transition-colors"
                  style={{ background: "#0f172a" }}
                  aria-label="Close"
                  title="Close"
                >
                  <X size={14} className="text-text-muted" />
                </button>
              )}
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-3 gap-3">
            <div
              className="rounded-2xl p-3.5 border border-white/5"
              style={{ background: "#0f172a" }}
            >
              <p className="text-text-muted text-[10px] font-black uppercase tracking-wider mb-1.5">
                Current Station
              </p>
              <p
                className="text-white text-[13px] font-bold truncate"
                title={currentStationName}
              >
                {currentStationName}
              </p>
            </div>
            <div
              className="rounded-2xl p-3.5 border border-white/5"
              style={{ background: "#0f172a" }}
            >
              <p className="text-text-muted text-[10px] font-black uppercase tracking-wider mb-1.5">
                Shift
              </p>
              <p className="text-white text-[13px] font-bold">{shiftText}</p>
            </div>
            <div
              className="rounded-2xl p-3.5 border"
              style={
                allPassed
                  ? { background: "#064e3b", borderColor: "#047857" }
                  : { background: "#0f172a", borderColor: "rgba(255,255,255,0.05)" }
              }
            >
              <p
                className="text-[10px] font-black uppercase tracking-wider mb-1.5"
                style={{ color: allPassed ? "#34d399" : "#64748b" }}
              >
                Overall
              </p>
              <p
                className="text-[13px] font-bold"
                style={{ color: allPassed ? "#4ade80" : "#fff" }}
              >
                {passCount} / {totalCount} PASS
              </p>
            </div>
          </div>
        </div>

        {/* -- Timeline body -- */}
        <div className="flex-1 overflow-y-auto px-6 py-6 bg-bg-card min-h-0">
          {loading ? (
            <JourneySkeleton />
          ) : stations.length > 0 ? (
            <div className="pr-1">
              {stations.map((station, idx) => (
                <StationCard
                  key={station.stationNo || `station-${idx}`}
                  station={station}
                  isLast={idx === stations.length - 1}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted">
              <MapPin size={36} className="mb-3 opacity-25" />
              <p className="text-sm font-semibold text-center leading-relaxed">
                Listening for scan events…
                <br />
                <span className="text-text-subtle text-xs">
                  The journey timeline will appear after the first scan.
                </span>
              </p>
            </div>
          )}
        </div>

        {/* -- Current scan status rows (below timeline, above footer) -- */}
        {(qrState !== "WAIT" || operationState !== "WAIT") && (
          <div className="px-6 py-4 bg-bg-card border-t border-border-muted flex-shrink-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-text-muted mb-3">
              Live Scan Status
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-bg-card rounded-xl border border-border p-3">
                <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                  QR Validation
                </p>
                <StatusBadge status={qrState} />
              </div>
              <div className="bg-bg-card rounded-xl border border-border p-3">
                <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                  PLC Handshake
                </p>
                <StatusBadge status={operationState} />
              </div>
              <div className="bg-bg-card rounded-xl border border-border p-3">
                <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                  Rejection
                </p>
                <StatusBadge
                  status={rejectionState === "PENDING" ? "PENDING" : rejectionState}
                />
              </div>
            </div>
            {popup.message && (
              <p
                className={`text-sm font-semibold mt-3 ${
                  operationState === "FAIL" || qrState === "FAIL"
                    ? "text-red-600"
                    : operationState === "COMM"
                    ? "text-orange-600"
                    : "text-text-muted"
                }`}
              >
                {popup.message}
              </p>
            )}
          </div>
        )}

        {/* -- Footer -- */}
        <div className="px-6 py-4 bg-bg-card border-t border-border-muted flex-shrink-0 space-y-3">
          {/* Reset confirm dialog */}
          {canReset && showResetConfirm && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-sm font-semibold text-red-700">
                Confirm reset for{" "}
                <span className="font-mono text-red-800">{partId}</span> at{" "}
                <span className="font-bold">{stationNo}</span>?
              </p>
              <p className="text-xs text-red-500">
                This will clear the current operation and require a re-scan.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  disabled={isResetting}
                  className="rounded-lg border border-red-200 bg-bg-card py-2 text-xs font-bold uppercase tracking-wide text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReset}
                  disabled={isResetting}
                  className="rounded-lg bg-red-600 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isResetting ? "Resetting…" : "Confirm Reset"}
                </button>
              </div>
            </div>
          )}

          {resetError && (
            <p className="text-sm font-semibold text-red-600">{resetError}</p>
          )}

          <div className="flex gap-3">
            {(showAcknowledge || typeof onClose === "function") && (
              <button
                onClick={onClose}
                className="flex-1 bg-bg-elevated hover:bg-bg-elevated text-text-main font-black py-3.5 rounded-xl transition-colors text-[12px] uppercase tracking-widest border border-border"
              >
                Close
              </button>
            )}

            {canReset && !showResetConfirm && (
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={isResetting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-3.5 rounded-xl transition-colors text-[12px] uppercase tracking-widest disabled:opacity-50"
              >
                {isResetting ? "Resetting…" : "Reset Operation"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalPopup;




