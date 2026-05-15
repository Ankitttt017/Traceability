// UPGRADE COMPLETE - GlobalPopup (v4.0 - No Duplication, Clean & Compact)
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Clock3,
  Layout,
  X,
  MapPin,
  RefreshCw,
} from "lucide-react";
import axios from "axios";
import { getStationFeatures, getStationFeatureSettings } from "../utils/stationSettings";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// --- Resolver functions --------------------------------------------------------
// --- Resolver functions --------------------------------------------------------
function resolveQrState(popup = {}) {
  // Use explicit qrStatus from backend if available
  const raw = String(
    popup.qrStatus ||
      popup.qrResult ||
      popup.qrDecision ||
      popup.decision ||
      ""
  )
    .trim()
    .toUpperCase();
    
  if (["PASSED", "PASS", "ALLOW", "OK", "ACCEPT", "VALID"].includes(raw)) return "PASS";
  if (["FAILED", "FAIL", "BLOCK", "NG", "REJECT", "INVALID"].includes(raw)) return "FAIL";
  if (["DUPLICATE", "ALREADY_DONE"].includes(raw)) return "DUPLICATE";
  if (["BLOCKED", "SEQUENCE_ERROR"].includes(raw)) return "BLOCKED";
  if (["WAITING_SCAN", "WAITING", "IDLE"].includes(raw)) return "WAIT";
  return "WAIT";
}

function resolveOperationState(popup = {}) {
  // Use explicit operationStatus from backend if available
  const raw = String(
    popup.operationStatus ||
      popup.plcStatus ||
      popup.status ||
      ""
  )
    .trim()
    .toUpperCase();
    
  // STRICT RULE: Only backend-confirmed states determine the operation result.
  if (["PASSED", "PASS", "ENDED_OK", "COMPLETED", "COMPLETED_OK"].includes(raw)) return "PASS";
  if (["FAILED", "FAIL", "ENDED_NG", "COMPLETED_NG", "NG"].includes(raw)) return "FAIL";
  if (["RUNNING", "STARTED", "IN_PROGRESS", "IN PROCESS"].includes(raw)) return "RUN";
  if (["WAITING_MACHINE", "START_SENT", "WAITING_RUNNING", "WAITING_PLC"].includes(raw)) return "WAIT_OP";
  if (["WAITING", "OP_WAIT", "SCANNED", "VALIDATED", "PENDING"].includes(raw)) return "WAIT_OP";
  if (["PLC_TIMEOUT", "TIMEOUT", "COMM_ERROR", "PLC_COMM_ERROR"].includes(raw)) return "COMM";
  if (["INTERLOCKED"].includes(raw)) return "INTERLOCKED";
  if (["BLOCKED"].includes(raw)) return "BLOCKED";
  if (["RESETTING", "RECOVERING"].includes(raw)) return "RESETTING";
  
  return "IDLE";
}

function resolveRejectionState(popup = {}, operationState) {
  const explicit = String(
    popup.rejectionStatus || popup.rejectionDecision || ""
  )
    .trim()
    .toUpperCase();
  if (["PASS", "FAIL", "PENDING"].includes(explicit)) return explicit;
  return "PENDING";
}

// --- Compact StatusBadge ------------------------------------------------------
export const StatusBadge = ({ status }) => {
  const statusMap = {
    PASS: { bg: "bg-success/15", text: "text-success", dot: "bg-success", label: "PASSED" },
    FAIL: { bg: "bg-danger/15", text: "text-danger", dot: "bg-danger", label: "FAILED" },
    DUPLICATE: { bg: "bg-amber-500/15", text: "text-amber-600", dot: "bg-amber-500", label: "DUPLICATE" },
    BLOCKED: { bg: "bg-slate-500/15", text: "text-slate-600", dot: "bg-slate-500", label: "BLOCKED" },
    RUN: { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning animate-pulse", label: "OP RUNNING" },
    WAIT_MACHINE: { bg: "bg-warning/10", text: "text-warning/80", dot: "bg-warning/60 animate-pulse", label: "WAITING MACHINE" },
    WAIT_OP: { bg: "bg-primary/10", text: "text-primary/80", dot: "bg-primary/60", label: "OP WAIT" },
    SCANNED: { bg: "bg-primary/15", text: "text-primary", dot: "bg-primary", label: "SCANNED" },
    COMM: { bg: "bg-comm/15", text: "text-comm", dot: "bg-comm", label: "PLC FAULT" },
    INTERLOCKED: { bg: "bg-slate-500/15", text: "text-slate-600", dot: "bg-slate-500", label: "INTERLOCKED" },
    RESETTING: { bg: "bg-amber-500/15", text: "text-amber-600", dot: "bg-amber-500 animate-spin", label: "RESETTING" },
    WAIT: { bg: "bg-bg-elevated", text: "text-text-muted", dot: "bg-border-strong", label: "WAITING" },
    IDLE: { bg: "bg-bg-elevated", text: "text-text-muted", dot: "bg-border-strong", label: "IDLE" },
  };

  const theme = statusMap[status] || statusMap.IDLE;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${theme.bg} ${theme.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${theme.dot}`} />
      {theme.label}
    </span>
  );
};

// --- Station Timeline Card (Single source of truth) --------------------------
const StationCard = ({ station, isLast, isCurrentStation }) => {
  const isCompleted = station.status === "COMPLETED";
  const isFailed = station.status === "FAILED";
  const isInProgress = station.status === "IN_PROGRESS";
  const isPending = station.status === "PENDING";
  
  // For current station - use live data from popup
  const isLiveCurrent = isCurrentStation && isInProgress;

  const dotClass = isCompleted ? "bg-success" : isFailed ? "bg-danger" : (isInProgress || isLiveCurrent) ? "bg-primary animate-pulse" : "bg-border-strong";
  const cardClass = isCompleted ? "bg-success/5 border-success/30" : isFailed ? "bg-danger/5 border-danger/30" : (isInProgress || isLiveCurrent) ? "bg-primary/5 border-primary/40 border" : "bg-bg-card border-border/50 opacity-70";
  const titleColor = isCompleted ? "text-success" : isFailed ? "text-danger" : (isInProgress || isLiveCurrent) ? "text-primary" : "text-text-muted";

  const dateObj = station.completedAt ? new Date(station.completedAt) : null;
  const timeStr = dateObj?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "";

  return (
    <div className="flex gap-2 group">
      <div className="flex flex-col items-center">
        <div className={`w-2.5 h-2.5 rounded-full mt-4 ${dotClass}`} />
        {!isLast && <div className="w-px flex-1 bg-border/40 my-0.5 min-h-[16px]" />}
      </div>
      <div className={`flex-1 rounded-lg border p-3 mb-3 transition-all ${cardClass}`}>
        <div className="flex justify-between items-center flex-wrap gap-1 mb-2">
          <div className="flex items-center gap-2">
            <h3 className={`text-xs font-bold ${titleColor}`}>
              {station.stationName || station.stationNo}
            </h3>
            {(isInProgress || isLiveCurrent) && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary text-white text-[8px] font-bold uppercase">Current</span>
            )}
          </div>
          {dateObj && <span className="text-[9px] text-text-muted">{timeStr}</span>}
        </div>

        {!isPending && (
          <div className="flex flex-wrap gap-1.5">
            {station.features?.qr && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">QR</span>
                <StatusBadge status={station.qrVerification || "WAIT"} />
              </div>
            )}
            {station.features?.operation && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">Op</span>
                <StatusBadge status={station.operation || "WAIT"} />
              </div>
            )}
            {station.features?.qualityCheck && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">QC</span>
                <StatusBadge status={station.qualityCheck || "WAIT"} />
              </div>
            )}
            {(station.features?.manualResult || station.features?.camera || station.features?.torque) && !station.features?.qualityCheck && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">QC Val</span>
                <StatusBadge status={station.qualityCheck || "WAIT"} />
              </div>
            )}
            {station.features?.rejectionBin && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">Rej</span>
                <StatusBadge status={station.rejectionConfirmation || "PENDING"} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Skeleton Loader ----------------------------------------------------------
const JourneySkeleton = () => (
  <div className="space-y-3 animate-pulse">
    {[1, 2, 3].map((i) => (
      <div key={i} className="flex gap-2">
        <div className="flex flex-col items-center">
          <div className="w-2.5 h-2.5 rounded-full bg-bg-elevated mt-4" />
          {i < 3 && <div className="w-px flex-1 bg-bg-elevated my-0.5" />}
        </div>
        <div className="flex-1 rounded-lg border border-border-muted bg-bg-card p-3 mb-3">
          <div className="h-3 bg-bg-elevated rounded w-1/4 mb-2" />
          <div className="grid grid-cols-4 gap-1.5">
            <div className="h-7 bg-bg-elevated rounded" />
            <div className="h-7 bg-bg-elevated rounded" />
            <div className="h-7 bg-bg-elevated rounded" />
            <div className="h-7 bg-bg-elevated rounded" />
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
  const [stationSettings] = useState(() => getStationFeatureSettings());

  const partId = String(popup?.partId || popup?.part_id || "").trim();
  const stationNo = String(popup?.stationNo || popup?.station_no || "").trim();

  // Reset state when popup changes
  useEffect(() => {
    setResetError("");
    setIsResetting(false);
    setShowResetConfirm(false);
  }, [partId, stationNo]);

  // Auto-close timer
  useEffect(() => {
    if (!popup) return undefined;
    const qrState = resolveQrState(popup);
    const operationState = resolveOperationState(popup);
    
    // Auto-close for PASS (1.5 seconds per industrial rule)
    if (operationState === "PASS") {
      const timer = setTimeout(() => onClose?.(), 1500);
      return () => clearTimeout(timer);
    }
    
    // Manual close for FAIL / COMM
    if (operationState === "FAIL" || operationState === "COMM" || operationState === "TIMEOUT") {
      return undefined;
    }

    const isCritical =
      String(popup.type || "").toUpperCase() === "ERROR" ||
      qrState === "FAIL";
      
    const hasStateDetails = Boolean(partId || stationNo || qrState !== "WAIT" || operationState !== "IDLE");
    
    if (!hasStateDetails) {
      const t = setTimeout(() => onClose?.(), 2500);
      return () => clearTimeout(t);
    }
    const timeoutMs = isCritical ? criticalAutoCloseMs : autoCloseMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined;
    const timer = setTimeout(() => onClose?.(), timeoutMs);
    return () => clearTimeout(timer);
  }, [popup, partId, stationNo, onClose, autoCloseMs, criticalAutoCloseMs]);

  // Fetch part journey
  useEffect(() => {
    let isActive = true;
    if (!partId) {
      setJourneyData(null);
      return () => { isActive = false; };
    }

    const token = localStorage.getItem("token");
    const fetchJourney = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`${API_BASE}/traceability/journey/${encodeURIComponent(partId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (isActive) setJourneyData(res.data);
      } catch (error) {
        console.warn("[GlobalPopup] Journey fetch failed:", error?.message || error);
      } finally {
        if (isActive) setLoading(false);
      }
    };
    fetchJourney();
    return () => { isActive = false; };
  }, [partId]);

  if (!popup) return null;

  // Simple mode
  if (simple) {
    const type = String(popup.type || "INFO").toUpperCase();
    const simpleTheme = type === "ERROR" ? "bg-red-600" : type === "SUCCESS" ? "bg-emerald-600" : type === "WARNING" ? "bg-amber-500" : "bg-cyan-600";
    const SimpleIcon = type === "ERROR" ? AlertTriangle : type === "SUCCESS" ? CheckCircle : Clock3;
    
    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm bg-bg-card rounded-xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
          <div className={`relative p-4 flex items-center gap-2 text-white ${simpleTheme}`}>
            {typeof onClose === "function" && (
              <button onClick={onClose} className="absolute right-2 top-2 w-7 h-7 rounded-full flex items-center justify-center bg-black/20 hover:bg-black/30">
                <X size={12} />
              </button>
            )}
            <SimpleIcon size={18} />
            <h2 className="text-sm font-bold">{popup.title || type}</h2>
          </div>
          <div className="p-4">
            <p className="text-sm text-text-main">{popup.message || "Update received."}</p>
          </div>
          <button onClick={onClose} className="w-full py-2.5 text-sm font-semibold border-t border-border hover:bg-bg-elevated transition-colors">
            Close
          </button>
        </div>
      </div>
    );
  }

  // Full journey mode
  const stations = journeyData?.stations || [];
  
  // Merge live data into the current station (if it exists in the timeline)
  const liveQrState = resolveQrState(popup);
  const liveOperationState = resolveOperationState(popup);
  const liveRejectionState = resolveRejectionState(popup, liveOperationState);
  
  // Find current station index and merge live data
  const currentStationIndex = stations.findIndex(s => s.status === "IN_PROGRESS");
  const enrichedStations = stations.map((s, idx) => {
    const features = getStationFeatures(s.stationNo, stationSettings);
    let base = { ...s, features };
    
    // MERGE LOGIC: If this is the current active station, merge live data from popup
    if (idx === currentStationIndex) {
      // If system is reset (IDLE/WAIT) AND no active QR is scanned, force journey to WAIT
      if ((liveOperationState === "WAIT" || liveOperationState === "IDLE") && liveQrState === "WAIT") {
        return {
          ...base,
          qrVerification: "WAIT",
          operation: "WAIT",
          isCurrent: true,
          live: true
        };
      }
      
      // Otherwise, if we have active scan/operation data, show it
      if (liveQrState !== "WAIT" || liveOperationState !== "WAIT") {
        return {
          ...base,
          qrVerification: liveQrState,
          operation: liveOperationState,
          qualityCheck: liveOperationState === "PASS" ? "PASS" : liveOperationState === "FAIL" ? "FAIL" : s.qualityCheck,
          rejectionConfirmation: liveRejectionState,
          isCurrent: true,
          live: true
        };
      }
    }
    return base;
  });

  const currentStationName = enrichedStations.find(s => s.status === "IN_PROGRESS")?.stationName || stationNo || "System Node";
  
  const passCount = enrichedStations.filter(s => {
    const quality = String(s.qualityCheck || "").toUpperCase();
    const operation = String(s.operation || "").toUpperCase();
    return quality === "PASS" || operation === "PASS";
  }).length;
  const totalCount = enrichedStations.length || "?";
  const allPassed = typeof totalCount === "number" && passCount === totalCount && passCount > 0;

  const hour = new Date().getHours();
  const shiftText = hour >= 6 && hour < 14 ? "A Shift" : hour >= 14 && hour < 22 ? "B Shift" : "C Shift";

  const reasonUpper = String(popup?.reason || popup?.qrReason || "").trim().toUpperCase();
  const needsResetByReason = ["DUPLICATE_SCAN", "RESET_REQUIRED_AFTER_PLC_COMM_ERROR"].some(r => reasonUpper.startsWith(r)) || reasonUpper.startsWith("PLC_TIMEOUT");
  const canReset = (liveOperationState === "COMM" || liveOperationState === "FAIL" || needsResetByReason) && Boolean(partId) && Boolean(stationNo) && typeof onResetOperation === "function";

  const handleReset = async () => {
    if (!partId || !stationNo || isResetting) return;
    setIsResetting(true);
    setResetError("");
    try {
      const completed = await onResetOperation(partId, stationNo, { confirmed: true });
      if (completed === false) return;
      setShowResetConfirm(false);
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      const apiError = String(error?.response?.data?.error || "").trim().toUpperCase();
      if (status === 401 || apiError.includes("UNAUTHORIZED")) {
        setResetError("Session expired. Please login.");
      } else {
        setResetError(error?.response?.data?.error || "Reset failed.");
      }
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-bg-card rounded-xl shadow-2xl flex flex-col max-h-[85vh] animate-in zoom-in duration-200">
        {/* Header - Compact */}
        <div className="px-5 py-3 flex-shrink-0 border-b border-border/50" style={{ background: "#1e293b" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg" style={{ background: "#0f172a" }}>
                <Layout className="text-amber-400" size={18} />
              </div>
              <div>
                <h2 className="text-white text-sm font-bold">Journey</h2>
                <p className="text-text-muted text-[9px] font-medium uppercase">Traceability</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {partId && (
                <div className="px-2 py-1 rounded-lg font-mono text-[10px] font-bold text-amber-400 max-w-[180px] truncate" style={{ background: "#0f172a" }} title={partId}>
                  {partId}
                </div>
              )}
              {typeof onClose === "function" && (
                <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors" style={{ background: "#0f172a" }}>
                  <X size={12} className="text-text-muted" />
                </button>
              )}
            </div>
          </div>

          {/* Compact Stats */}
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="rounded-lg p-2" style={{ background: "#0f172a" }}>
              <p className="text-text-muted text-[9px] font-medium uppercase mb-0.5">Station</p>
              <p className="text-white text-xs font-bold truncate">{currentStationName}</p>
            </div>
            <div className="rounded-lg p-2" style={{ background: "#0f172a" }}>
              <p className="text-text-muted text-[9px] font-medium uppercase mb-0.5">Shift</p>
              <p className="text-white text-xs font-bold">{shiftText}</p>
            </div>
            <div className="rounded-lg p-2" style={allPassed ? { background: "#064e3b" } : { background: "#0f172a" }}>
              <p className="text-[9px] font-medium uppercase mb-0.5" style={{ color: allPassed ? "#34d399" : "#64748b" }}>Pass</p>
              <p className="text-xs font-bold" style={{ color: allPassed ? "#4ade80" : "#fff" }}>{passCount}/{totalCount}</p>
            </div>
          </div>
        </div>

        {/* Timeline Body - Single source of truth */}
        <div className="flex-1 overflow-y-auto px-5 py-3 bg-bg-card">
          {loading ? (
            <JourneySkeleton />
          ) : enrichedStations.length > 0 ? (
            <div>
              {enrichedStations.map((station, idx) => (
                <StationCard
                  key={station.stationNo || `station-${idx}`}
                  station={station}
                  isLast={idx === enrichedStations.length - 1}
                  isCurrentStation={idx === currentStationIndex}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-text-muted">
              <MapPin size={32} className="mb-2 opacity-30" />
              <p className="text-xs font-medium">Waiting for scan...</p>
              <p className="text-[10px] mt-0.5" style={{ fontFamily: "var(--font-outfit)" }}>Timeline appears after first scan</p>
            </div>
          )}
        </div>

        {/* Message & Footer */}
        <div className="px-5 py-3 bg-bg-card border-t border-border/50 flex-shrink-0 space-y-2">
          {popup.message && (
            <div className={`p-2 rounded-lg border flex gap-1.5 items-start text-xs ${
              liveOperationState === "FAIL" || liveQrState === "FAIL" || popup.type === "ERROR" ? "bg-danger/8 border-danger/20 text-danger" :
              liveOperationState === "COMM" || popup.type === "WARNING" ? "bg-warning/8 border-warning/20 text-warning" :
              popup.type === "SUCCESS" || popup.type === "INFO" ? "bg-success/15 border-success/30 text-success" :
              "bg-bg-elevated/30 border-border/30 text-text-muted"
            }`}>
              {popup.type === "SUCCESS" || popup.type === "INFO" ? (
                <CheckCircle size={12} className="mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              )}
              <p className="text-[11px] font-medium">{popup.message}</p>
            </div>
          )}

          {resetError && <p className="text-xs font-semibold text-red-600">{resetError}</p>}

          {canReset && showResetConfirm && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-red-700">
                Reset <span className="font-mono">{partId}</span> at {stationNo}?
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowResetConfirm(false)} className="flex-1 rounded-lg border border-red-200 bg-white py-1.5 text-xs font-bold text-red-700 hover:bg-red-50">
                  Cancel
                </button>
                <button onClick={handleReset} disabled={isResetting} className="flex-1 rounded-lg bg-red-600 py-1.5 text-xs font-bold text-white hover:bg-red-700">
                  {isResetting ? "..." : "Confirm"}
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {(showAcknowledge || typeof onClose === "function") && (
              <button onClick={onClose} className="flex-1 bg-bg-elevated hover:bg-bg-elevated/80 text-text-main font-semibold py-2 rounded-lg text-[11px] uppercase tracking-wide border border-border transition-colors">
                Close
              </button>
            )}
            {canReset && !showResetConfirm && (
              <button onClick={() => setShowResetConfirm(true)} disabled={isResetting} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded-lg text-[11px] uppercase tracking-wide flex items-center justify-center gap-1.5 transition-colors">
                <RefreshCw size={10} className={isResetting ? "animate-spin" : ""} />
                {isResetting ? "..." : "Reset"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalPopup;