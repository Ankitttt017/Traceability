// UPGRADE COMPLETE - GlobalPopup (v4.0 - No Duplication, Clean & Compact)
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Clock3,
  Layout,
  X,
  MapPin,
  RefreshCw,
  Maximize2,
  Minimize2,
} from "lucide-react";
import axios from "axios";
import { getStationFeatures, getStationFeatureSettings } from "../utils/stationSettings";
import { traceabilityApi } from "../api/services";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// ---------------------------------------------
// OIL PAN K12 DEFECT MASTER
// ---------------------------------------------
const DEFECT_CATEGORIES = {
  CR: {
    label: "Casting Defects",
    defects: [
      "Warm Up",
      "Non -Filling",
      "Pre Filling",
      "Cold Shot",
      "Crack",
      "Chip-off",
      "Shrinkage",
      "Ejector Pin Deep",
      "Bend",
      "Black Mark",
      "Dent",
      "Extra Metal",
      "Runner Broken",
      "Excess Fettling",
      "Flow Mark",
      "Soldering",
      "Catching",
      "White-Rust",
      "Peel Off",
      "Casting Damage",
      "Biscuit Thickness NG",
      "Cast Pressure NG",
      "Air Bubble",
      "Core Pin Broken",
      "Core Pin Bend",
      "Under Cut",
      "Gate Broken",
      "Laser Marking NG"
    ]
  },

  CRAM: {
    label: "Cram Defects",
    defects: [
      "Blow Hole",
      "Blow Hole M14",
      "LT Oil Gallery-1 NG",
      "LT Oil Gallery-2 NG",
      "Body Leak",
      "Bend",
      "Chipoff",
      "Cold Shut",
      "Crack",
      "Blister",
      "Iron particle",
      "Non-filling",
      "Porosity",
      "Black Mark",
      "Ejector Pin Depression",
      "Casting Damage",
      "Shrinkage",
      "Peel-off",
      "Flow Mark",
      "Scratch Mark",
      "Laser Marking NG",
      "Setting part",
      "Over Fettling",
      "Tool Broken",
      "Power Failure Part",
      "Unclean",
      "Dent",
      "Oval/Soldering",
      "OVERCUT",
      "Bubble"
    ]
  },

  MR: {
    label: "Machining / MR Defects",
    defects: [
      "Dia Over size",
      "Dia Under Size",
      "Chattering",
      "Toolmark",
      "Dent",
      "Dimension NG",
      "Tapping NG",
      "Setting part",
      "Power Cut",
      "Air Pressure Low",
      "Machine Alarm",
      "Laser Marking NG",
      "Extra Rework",
      "Roughness NG",
      "Chamfer NG",
      "Profile NG",
      "Position NG",
      "Receiving Gauge NG",
      "Step Mark",
      "Scratch Mark"
    ]
  }
};

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
        
        {/* Show NG Reason if available */}
        {(station.reason || station.remarks) && (isFailed || station.qualityCheck === "FAIL" || station.operation === "FAIL") && (
          <div className="mt-2 px-2 py-1.5 bg-danger/10 border border-danger/20 rounded">
            <span className="text-[9px] font-bold text-danger uppercase tracking-wider">Defect Reason:</span>
            <p className="text-[11px] font-semibold text-danger/90 mt-0.5">{station.reason || station.remarks}</p>
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
  machineId,
  scannerInfo,
}) => {
  const [journeyData, setJourneyData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [stationSettings] = useState(() => getStationFeatureSettings());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoCloseTimeLeft, setAutoCloseTimeLeft] = useState(null); // remaining time in ms
  const [autoCloseDuration, setAutoCloseDuration] = useState(0);    // original duration in ms

  const [manualSelection, setManualSelection] = useState(null); // 'OK' or 'NG'
  const [manualReason, setManualReason] = useState("");
  const [submittingManual, setSubmittingManual] = useState(false);
  const [manualSuccessMsg, setManualSuccessMsg] = useState("");

  const [manualQrCode, setManualQrCode] = useState("");
  const [validatingQr, setValidatingQr] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [validationInfo, setValidationInfo] = useState(""); // friendly info (e.g. already completed)
  // Use ref so handleValidateQr sets value synchronously before socket/useEffect can read stale state
  const [localQrValidated, setLocalQrValidated] = useState(false);
  const localValidatedPartIdRef = useRef("");

  const handleValidateQr = async () => {
    if (!manualQrCode.trim()) return;
    const scannedCode = manualQrCode.trim();
    setValidatingQr(true);
    setValidationError("");
    setValidationInfo("Scanning...");
    setLocalQrValidated(false);
    localValidatedPartIdRef.current = "";
    try {
      const res = await traceabilityApi.verify({
        qrCode: scannedCode,
        machineId: Number(machineId),
      });

      // verifyScanForOperator always returns HTTP 200 — check decision field
      const reason = String(res?.reason || "").toUpperCase();
      const isBlocked = res?.decision === "BLOCK" || res?.status === "NG";

      if (isBlocked) {
        if (reason === "DUPLICATE_SCAN" || reason === "ALREADY_COMPLETED") {
          setValidationInfo(`✓ Already completed. This part has passed this station. Ready for next scan.`);
        } else if (reason === "PREVIOUS_STATION_NOT_COMPLETED") {
          const expected = res?.expectedStation ? ` (${res.expectedStation})` : "";
          setValidationError(
            `⚠ Previous station not completed${expected}. Process parts through earlier stations first.`
          );
        } else if (reason === "QR_FORMAT_INVALID" || reason === "INVALID_FORMAT") {
          setValidationError("❌ QR format mismatch. This barcode is not a valid component code.");
        } else if (reason === "PART_NOT_EXIST") {
          setValidationError("❌ Part not found in system. Verify QR code and try again.");
        } else if (reason === "MACHINE_RUNNING") {
          setValidationError("⏳ Machine is running. Wait for current operation to complete.");
        } else if (reason === "PART_INTERLOCKED") {
          setValidationError("🔒 Part interlocked. Use Reset Operation to clear hold.");
        } else {
          setValidationError(res?.message || `⚠ Scan blocked: ${reason || "Unknown reason"}`);
        }
        setManualQrCode("");
        return;
      }

      // ALLOW — show OK/NG panel immediately, don't wait for socket
      setValidationInfo("");
      localValidatedPartIdRef.current = scannedCode;
      setLocalQrValidated(true);
      setManualSelection(null);
      setManualReason("");
      setManualQrCode("");
    } catch (err) {
      // HTTP-level errors (500, network, etc.)
      const errMsg = String(err.response?.data?.error || err.message || "Validation failed.");
      const errUpper = errMsg.toUpperCase();
      if (errUpper.includes("DUPLICATE_SCAN") || errUpper.includes("ALREADY_COMPLETED") || errUpper.includes("ALREADY COMPLETED")) {
        setValidationInfo(`✓ Already completed. Part has passed. Ready for next scan.`);
      } else if (errUpper.includes("PREVIOUS_STATION") || errUpper.includes("SEQUENCE")) {
        setValidationError(`⚠ Station sequence error. ${errMsg}`);
      } else if (errUpper.includes("PART_NOT") || errUpper.includes("NOT FOUND")) {
        setValidationError(`❌ Part not found. Verify QR code.`);
      } else if (errUpper.includes("FORMAT") || errUpper.includes("INVALID")) {
        setValidationError(`❌ QR format mismatch. Invalid component code.`);
      } else if (errUpper.includes("MACHINE") || errUpper.includes("BUSY")) {
        setValidationError(`⏳ Machine busy. Wait for current cycle.`);
      } else {
        setValidationError(`⚠ ${errMsg}`);
      }
    } finally {
      setValidatingQr(false);
    }
  };

  const partId = String(popup?.partId || popup?.part_id || "").trim();
  const stationNo = String(popup?.stationNo || popup?.station_no || "").trim();

  // Reset manual state only when station changes (not on partId change — that would wipe localQrValidated)
  useEffect(() => {
    setResetError("");
    setIsResetting(false);
    setShowResetConfirm(false);
    setManualSelection(null);
    setManualReason("");
    setManualSuccessMsg("");
    setValidationError("");
    setValidationInfo("");
    setLocalQrValidated(false);
    localValidatedPartIdRef.current = "";
  }, [stationNo]); // Only reset on station change — partId changes from socket must NOT wipe validated state

  // effectivePartId: use ref value (fresh) or socket-provided partId
  const effectivePartId = partId || localValidatedPartIdRef.current;

  const handleSubmitManualResult = async () => {
    const submitPartId = effectivePartId;
    const submitStationNo = stationNo;
    if (!submitPartId || !submitStationNo || !manualSelection) return;
    setSubmittingManual(true);
    setManualSuccessMsg("");
    setResetError("");
    try {
      const res = await traceabilityApi.submitManualResult({
        partId: submitPartId,
        stationNo: submitStationNo,
        status: manualSelection,
        reason: manualSelection === "NG" ? manualReason : undefined,
      });
      setManualSuccessMsg(res?.message || `Part ${manualSelection === "OK" ? "PASSED ✓" : "REJECTED ✗"} — Ready for next scan.`);
      setLocalQrValidated(false);
      localValidatedPartIdRef.current = "";
      setManualSelection(null);
      setManualReason("");
      setTimeout(() => {
        if (typeof onResetOperation === "function") {
          onResetOperation(submitPartId, submitStationNo, { confirmed: true }).catch(() => {});
        }
        setManualSuccessMsg("");
        setSubmittingManual(false);
      }, 1500);
    } catch (error) {
      setResetError(error?.response?.data?.error || error?.message || "Submission failed.");
      setSubmittingManual(false);
    }
  };

  // Auto-close timer with linear decreasing interval logic
  useEffect(() => {
    if (!popup || scannerInfo?.isSimulation || popup.isSimulationPlaceholder) {
      setAutoCloseTimeLeft(null);
      setAutoCloseDuration(0);
      return undefined;
    }

    const targetStationNo = stationNo || popup?.stationNo || popup?.station_no;
    const targetFeatures = getStationFeatures(targetStationNo, stationSettings);
    const isOnlyQrCheck = targetFeatures.qr === true && targetFeatures.operation === false;
    const isManual = String(targetStationNo).toUpperCase() === "OP020" || Boolean(stationSettings?.[targetStationNo]?.manualResult);
    
    let duration = 0;

    // Auto-close / Auto-reset for ONLY QR Check enabled stations (3 seconds)
    if (isOnlyQrCheck) {
      const qrState = resolveQrState(popup);
      if (qrState === "PASS" || qrState === "DUPLICATE") {
        duration = 3000;
      } else {
        setAutoCloseTimeLeft(null);
        setAutoCloseDuration(0);
        return undefined; // stay open so operator can see format / sequence error
      }
    } else if (isManual) {
      setAutoCloseTimeLeft(null);
      setAutoCloseDuration(0);
      return undefined; // manual stations never auto-close
    } else {
      const qrState = resolveQrState(popup);
      const operationState = resolveOperationState(popup);
      
      // Auto-close for PASS (1.5 seconds per industrial rule)
      if (operationState === "PASS") {
        duration = 1500;
      } else if (["FAIL", "COMM", "TIMEOUT"].includes(operationState)) {
        setAutoCloseTimeLeft(null);
        setAutoCloseDuration(0);
        return undefined;
      } else {
        const isCritical = String(popup.type || "").toUpperCase() === "ERROR" || qrState === "FAIL";
        const hasStateDetails = Boolean(partId || stationNo || qrState !== "WAIT" || operationState !== "IDLE");
        if (!hasStateDetails) {
          duration = 2500;
        } else {
          duration = isCritical ? criticalAutoCloseMs : autoCloseMs;
        }
      }
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      setAutoCloseTimeLeft(null);
      setAutoCloseDuration(0);
      return undefined;
    }

    setAutoCloseDuration(duration);
    setAutoCloseTimeLeft(duration);

    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, duration - elapsed);
      setAutoCloseTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        onClose?.();
      }
    }, 50);

    return () => clearInterval(timer);
  }, [popup, partId, stationNo, onClose, autoCloseMs, criticalAutoCloseMs, scannerInfo?.isSimulation, stationSettings]);

  // Auto-clear validation messages/warnings and success messages for manual result stations after 5s
  useEffect(() => {
    const targetStationNo = stationNo || popup?.stationNo || popup?.station_no;
    const isManual = String(targetStationNo).toUpperCase() === "OP020" || Boolean(stationSettings?.[targetStationNo]?.manualResult);
    if (!isManual) return undefined;

    if (!validationInfo && !validationError && !manualSuccessMsg) return undefined;

    const timer = setTimeout(() => {
      setValidationError("");
      setValidationInfo("");
      if (!submittingManual) {
        setManualSuccessMsg("");
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [popup, stationNo, stationSettings, validationInfo, validationError, manualSuccessMsg, submittingManual]);

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

  const targetStationNo = stationNo || popup.stationNo || popup.station_no;
  const features = getStationFeatures(targetStationNo, stationSettings);
  const isManualResultStation = features?.manualResult === true || String(targetStationNo).toUpperCase() === "OP020";

  const showManualVerificationPanel =
    isManualResultStation &&
    // Show immediately after local validate OR after socket confirms PASS
    (localQrValidated || liveQrState === "PASS") &&
    liveOperationState !== "PASS" &&
    liveOperationState !== "FAIL";

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
      <div className={`w-full bg-bg-card shadow-2xl flex flex-col transition-all duration-200 ${
        isFullscreen 
          ? "fixed inset-0 z-[1000] w-screen h-screen max-w-full max-h-screen rounded-none m-0 animate-none" 
          : "max-w-2xl rounded-xl max-h-[85vh] animate-in zoom-in duration-200"
      }`}>
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
              {effectivePartId && (
                <div className="px-2 py-1 rounded-lg font-mono text-[10px] font-bold text-amber-400 max-w-[180px] truncate" style={{ background: "#0f172a" }} title={effectivePartId}>
                  {effectivePartId}
                </div>
              )}
              <button 
                onClick={() => setIsFullscreen(!isFullscreen)} 
                title={isFullscreen ? "Minimize" : "Maximize Screen"}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 text-slate-400 hover:text-white transition-colors" 
                style={{ background: "#0f172a" }}
              >
                {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
              {/* Manual stations: hide close so popup stays persistent for operator */}
              {typeof onClose === "function" && !isManualResultStation && (
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
          {/* QR Input: always visible on manual stations when not in OK/NG selection mode */}
          {isManualResultStation && !showManualVerificationPanel && (
            <div className="w-full bg-slate-900/60 border border-slate-700/60 rounded-xl p-4 space-y-3 mb-4">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Manual QR Code Input (Scan Next Part)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualQrCode}
                  onChange={(e) => setManualQrCode(e.target.value)}
                  placeholder="e.g. PART-K12-998877"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-amber-500 transition-colors font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleValidateQr();
                  }}
                />
                <button
                  type="button"
                  onClick={handleValidateQr}
                  disabled={validatingQr || !manualQrCode.trim()}
                  className="bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1.5"
                >
                  {validatingQr ? (
                    <RefreshCw size={12} className="animate-spin" />
                  ) : (
                    "Validate"
                  )}
                </button>
              </div>
              {validationError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-start gap-2 text-rose-400 mt-2">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <div className="text-left">
                    <p className="text-xs font-bold uppercase tracking-wider">Scan Rejected</p>
                    <p className="text-[11px] font-medium leading-relaxed mt-0.5">{validationError}</p>
                  </div>
                </div>
              )}
              {validationInfo && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2 text-amber-400 mt-2">
                  <CheckCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] font-medium leading-relaxed">{validationInfo}</p>
                </div>
              )}
            </div>
          )}
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
            <div className="flex flex-col items-center justify-center py-6 text-text-muted space-y-4">
              <MapPin size={32} className="opacity-40 text-amber-500 animate-bounce" />
              <div className="text-center">
                <p className="text-xs font-bold text-white">Waiting for Barcode Scan</p>
                <p className="text-[10px] text-text-muted mt-0.5">Timeline appears after first scan</p>
              </div>
            </div>
          )}
        </div>

        {/* Message & Footer */}
        <div className="px-5 py-3 bg-bg-card border-t border-border/50 flex-shrink-0 space-y-2">
          {showManualVerificationPanel && (
            <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-4 space-y-4 shadow-inner mb-3" style={{ backdropFilter: "blur(4px)" }}>
              <div className="flex items-center gap-2 border-b border-slate-700/60 pb-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <h3 className="text-white text-xs font-extrabold uppercase tracking-wider">Manual Quality Inspection</h3>
              </div>
              
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => { setManualSelection("OK"); setManualReason(""); }}
                  className={`flex-1 flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all duration-200 ${
                    manualSelection === "OK"
                      ? "bg-emerald-950/40 border-emerald-500 text-emerald-400 shadow-md shadow-emerald-500/10 scale-[1.02]"
                      : "bg-emerald-950/20 border-emerald-700/50 text-emerald-500 hover:border-emerald-500 hover:text-emerald-400"
                  }`}
                >
                  <CheckCircle size={20} className={manualSelection === "OK" ? "text-emerald-400" : "text-emerald-500"} />
                  <span className="mt-1.5 text-xs font-bold uppercase tracking-wide">Part OK</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setManualSelection("NG"); setManualReason(""); }}
                  className={`flex-1 flex flex-col items-center justify-center p-3 rounded-lg border-2 transition-all duration-200 ${
                    manualSelection === "NG"
                      ? "bg-rose-950/40 border-rose-500 text-rose-400 shadow-md shadow-rose-500/10 scale-[1.02]"
                      : "bg-rose-950/20 border-rose-700/50 text-rose-500 hover:border-rose-500 hover:text-rose-400"
                  }`}
                >
                  <AlertTriangle size={20} className={manualSelection === "NG" ? "text-rose-400" : "text-rose-500"} />
                  <span className="mt-1.5 text-xs font-bold uppercase tracking-wide">Part NG</span>
                </button>
              </div>

              {manualSelection === "NG" && (
                <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-150">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Failure / Rejection Reason</label>
                  <select
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    style={{ color: "#fff", background: "#0f172a", colorScheme: "dark" }}
                    className="w-full border border-slate-700 rounded-lg py-2 px-3 text-xs outline-none focus:border-rose-500 transition-colors font-semibold"
                  >
                    <option value="" disabled style={{ color: "#94a3b8", background: "#0f172a" }}>-- Select rejection reason --</option>
                    {Object.entries(DEFECT_CATEGORIES).map(([key, category]) => (
                      <optgroup key={key} label={category.label} style={{ color: "#f87171", background: "#0f172a", fontWeight: 800 }}>
                        {category.defects.map((defect) => (
                          <option key={defect} value={defect} style={{ color: "#f1f5f9", background: "#1e293b", fontWeight: 600 }}>
                            {defect}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )}

              {manualSuccessMsg && (
                <p className="text-xs font-bold text-emerald-400 text-center">{manualSuccessMsg}</p>
              )}

              <button
                type="button"
                onClick={handleSubmitManualResult}
                disabled={submittingManual || !manualSelection || (manualSelection === "NG" && !manualReason)}
                className={`w-full py-2.5 rounded-lg text-xs font-extrabold uppercase tracking-wider text-white transition-all ${
                  submittingManual || !manualSelection || (manualSelection === "NG" && !manualReason)
                    ? "bg-slate-700 text-slate-400 cursor-not-allowed opacity-50"
                    : manualSelection === "OK"
                      ? "bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-600/20 active:scale-[0.99]"
                      : "bg-rose-600 hover:bg-rose-500 shadow-md shadow-rose-600/20 active:scale-[0.99]"
                }`}
              >
                {submittingManual ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw size={12} className="animate-spin" />
                    Submitting Result...
                  </span>
                ) : (
                  "Submit Quality Verification"
                )}
              </button>
            </div>
          )}

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

        {/* Decreasing Horizontal Auto-Close Progress Bar */}
        {autoCloseTimeLeft !== null && autoCloseDuration > 0 && (
          <div className="w-full h-1 bg-slate-800/80 overflow-hidden flex-shrink-0 relative">
            <div 
              className={`h-full ${
                popup.type === "ERROR" || liveQrState === "FAIL" || liveOperationState === "FAIL" || liveOperationState === "COMM"
                  ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
                  : popup.type === "WARNING" || liveQrState === "DUPLICATE" || liveQrState === "BLOCKED"
                    ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                    : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
              } transition-all duration-75 ease-linear`} 
              style={{ width: `${(autoCloseTimeLeft / autoCloseDuration) * 100}%` }} 
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default GlobalPopup;