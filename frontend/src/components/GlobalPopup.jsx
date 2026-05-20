// UPGRADE COMPLETE - GlobalPopup (v4.1 - Enhanced Visibility & Timer)
import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
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

const StationIcon = React.memo(() => (
  <MapPin size={32} className="opacity-40 text-amber-500 animate-bounce" />
));

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
  if (["PASSED", "PASS", "ENDED_OK", "COMPLETED", "COMPLETED_OK", "COMPLETED_NG"].includes(raw)) return "PASS";
  if (["FAILED", "FAIL", "ENDED_NG", "NG"].includes(raw)) return "FAIL";
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
    PASS: { bg: "bg-success/15", text: "text-success", dot: "bg-success", label: "PASSED ✓" },
    FAIL: { bg: "bg-danger/15", text: "text-danger", dot: "bg-danger", label: "FAILED ✗" },
    DUPLICATE: { bg: "bg-amber-500/15", text: "text-amber-600", dot: "bg-amber-500", label: "DUPLICATE" },
    BLOCKED: { bg: "bg-slate-500/15", text: "text-slate-600", dot: "bg-slate-500", label: "BLOCKED" },
    RUN: { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning animate-pulse", label: "RUNNING..." },
    WAIT_MACHINE: { bg: "bg-warning/10", text: "text-warning/80", dot: "bg-warning/60 animate-pulse", label: "WAITING MACHINE..." },
    WAIT_OP: { bg: "bg-primary/10", text: "text-primary/80", dot: "bg-primary/60", label: "WAITING..." },
    SCANNED: { bg: "bg-primary/15", text: "text-primary", dot: "bg-primary", label: "SCANNED" },
    COMM: { bg: "bg-comm/15", text: "text-comm", dot: "bg-comm", label: "PLC FAULT" },
    INTERLOCKED: { bg: "bg-slate-500/15", text: "text-slate-600", dot: "bg-slate-500", label: "INTERLOCKED" },
    RESETTING: { bg: "bg-amber-500/15", text: "text-amber-600", dot: "bg-amber-500 animate-spin", label: "RESETTING..." },
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

// --- Friendly error message mapping -------------------------------------------
function friendlyErrorMessage(rawMsg, popup = {}) {
  const msg = String(rawMsg || "");
  const msgUpper = msg.toUpperCase();
  const partId = popup?.partId || popup?.part_id || "";
  const station = popup?.stationNo || popup?.station_no || "";

  // Raw socket/network errors
  if (msg.includes("EADDRNOTAVAIL") || msg.includes("connect EADDRNOTAVAIL")) {
    return `[NETWORK ERROR] Machine ${popup?.machineId || ""} is not reachable. Check hardware/ethernet connection.`;
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
    return `[COMMUNICATION ERROR] PLC connection refused or timed out. Please check if PLC is powered on and connected.`;
  }
  if (msg.includes("Creating new connection for 0.0.0.0")) {
    return `[CONFIGURATION ERROR] Machine not configured. Set IP address in settings.`;
  }

  // Duplicate / already scanned checks
  if (
    msgUpper.includes("DUPLICATE") ||
    msgUpper.includes("ALREADY_COMPLETED") ||
    msgUpper.includes("ALREADY COMPLETED") ||
    msgUpper.includes("ALREADY_SCANNED") ||
    popup?.reason === "DUPLICATE_SCAN" ||
    popup?.reason === "ALREADY_COMPLETED"
  ) {
    return `❌ [DUPLICATE SCAN] Part ${partId} has already been processed and completed at station ${station}.`;
  }

  // Sequence errors
  if (
    msgUpper.includes("PREVIOUS_STATION") ||
    msgUpper.includes("SEQUENCE") ||
    popup?.reason === "PREVIOUS_STATION_NOT_COMPLETED" ||
    msgUpper.includes("EXPECTEDSTATION IS NOT DEFINED")
  ) {
    const expected = popup?.expectedStation || "";
    return `❌ [SEQUENCE ERROR] Previous station ${expected ? expected + " " : ""}not completed. Process parts through earlier stations first.`;
  }

  // Format errors
  if (
    msgUpper.includes("FORMAT") ||
    msgUpper.includes("INVALID_FORMAT") ||
    popup?.gate === "FORMAT" ||
    popup?.reason === "QR_FORMAT_INVALID"
  ) {
    return `❌ [QR FORMAT MISMATCH] Invalid QR barcode. Expected format: YYMMDDHHMMSS + Shot Number or active station rules.`;
  }

  // PLC record match errors (strict match only; avoid false positives on generic text like OP10)
  const popupReason = String(popup?.reason || "").toUpperCase();
  if (
    popup?.gate === "PLC_MATCH" ||
    popupReason === "PLC_RECORD_NOT_FOUND" ||
    popupReason === "PART_NOT_FOUND" ||
    msgUpper.includes("PLC_RECORD_NOT_FOUND") ||
    msgUpper.includes("PART_NOT_FOUND") ||
    msgUpper.includes("MOULDING_RECORD_NOT_FOUND") ||
    msgUpper.includes("PART QR NOT FOUND IN MOULDING")
  ) {
    return `❌ [MATCH FAILED] Part QR not found in moulding records. Verify part was recorded first.`;
  }

  // Machine state errors
  if (msgUpper.includes("MACHINE_RUNNING") || msgUpper.includes("BUSY")) {
    return `⏳ [MACHINE BUSY] Machine is currently in operation. Please wait for current cycle to complete.`;
  }

  // Interlock errors
  if (msgUpper.includes("PART_INTERLOCKED") || popup?.reason === "GLOBAL_REJECTION" || popup?.forceNg) {
    return `🔒 [PART INTERLOCKED] Part is marked as NG (Rejected). Further operations are BLOCKED. Move to rejection bin.`;
  }

  // General fallbacks
  if (msg) {
    return msg.replace("Process validation failed. ", "");
  }
  return "Station routing error — contact admin.";
}

// --- Main GlobalPopup Component -----------------------------------------------
const GlobalPopup = ({
  popup,
  onClose,
  onResetOperation,
  autoCloseMs = 8000,
  criticalAutoCloseMs = 8000,
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
  const [stickyErrorMode, setStickyErrorMode] = useState(false);

  const [manualSelection, setManualSelection] = useState(null); // 'OK' or 'NG'
  const [manualReason, setManualReason] = useState("");
  const [manualReasonOpen, setManualReasonOpen] = useState(false);
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
        localValidatedPartIdRef.current = scannedCode;
        if (reason === "DUPLICATE_SCAN" || reason === "ALREADY_COMPLETED") {
          setValidationError(`✓ Already completed. This part has passed this station. Ready for next scan.`);
          setValidationInfo("");
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
        setValidationError(`✓ Already completed. Part has passed. Ready for next scan.`);
        setValidationInfo("");
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
      setTimeout(() => {
        setLocalQrValidated(false);
        localValidatedPartIdRef.current = "";
        setManualSelection(null);
        setManualReason("");
        if (typeof onResetOperation === "function") {
          onResetOperation(submitPartId, submitStationNo, { confirmed: true }).catch(() => { });
        }
        setManualSuccessMsg("");
        setSubmittingManual(false);
      }, 2000);
    } catch (error) {
      setResetError(error?.response?.data?.error || error?.message || "Submission failed.");
      setSubmittingManual(false);
    }
  };

  // Auto-close timer with linear decreasing interval logic
  useEffect(() => {
    if (!popup) {
      setAutoCloseTimeLeft(null);
      setAutoCloseDuration(0);
      setStickyErrorMode(false);
      return undefined;
    }

    const targetStationNo = stationNo || popup?.stationNo || popup?.station_no;
    const targetFeatures = getStationFeatures(targetStationNo, stationSettings);
    const isOnlyQrCheck = targetFeatures.qr === true && targetFeatures.operation === false;
    const isManual = String(targetStationNo).toUpperCase() === "OP020" || Boolean(stationSettings?.[targetStationNo]?.manualResult);

    let duration = 0;

    // Auto-close / Auto-reset for ONLY QR Check enabled stations (15 seconds)
    if (isOnlyQrCheck) {
      const qrState = resolveQrState(popup);
      if (qrState === "PASS" || qrState === "DUPLICATE") {
        duration = 15000;
      } else if (popup?.type === "ERROR" || qrState === "FAIL" || qrState === "BLOCKED") {
        duration = Math.max(criticalAutoCloseMs || 0, 20000);
      } else {
        setAutoCloseTimeLeft(null);
        setAutoCloseDuration(0);
        return undefined; // stay open so operator can see format / sequence error
      }
    } else if (isManual) {
      if (validationError) {
        duration = 18000; // Auto-close on error for manual stations (18 seconds)
      } else {
        setAutoCloseTimeLeft(null);
        setAutoCloseDuration(0);
        return undefined; // manual stations stay open for OK input
      }
    } else {
      if (autoCloseMs > 0) {
        const qrState = String(popup.qrVerification || popup.qrState || "WAIT").toUpperCase();
        const operationState = resolveOperationState(popup);

        if (operationState === "PASS") {
          duration = 8000; // Auto-close for PASS (8 seconds)
        } else if (["FAIL", "COMM", "TIMEOUT"].includes(operationState) || popup.type === "ERROR" || qrState === "FAIL") {
          duration = Math.max(criticalAutoCloseMs || 0, 20000); // 20 seconds for errors
        } else {
          const isCritical = String(popup.type || "").toUpperCase() === "ERROR" || qrState === "FAIL";
          const hasStateDetails = Boolean(partId || stationNo || qrState !== "WAIT" || operationState !== "IDLE");
          if (!hasStateDetails) {
            duration = 5000;
          } else {
            duration = isCritical ? Math.max(criticalAutoCloseMs || 0, 20000) : Math.max(autoCloseMs || 0, 15000);
          }
        }
      }
    }

    // Increased minimum duration for better readability
    if (duration > 0 && duration < 4000) {
      duration = 4000;
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      setAutoCloseTimeLeft(null);
      setAutoCloseDuration(0);
      return undefined;
    }

    const qrStateNow = resolveQrState(popup);
    const opStateNow = resolveOperationState(popup);
    const isErrorNow =
      Boolean(validationError) ||
      String(popup?.type || "").toUpperCase() === "ERROR" ||
      qrStateNow === "FAIL" ||
      opStateNow === "FAIL" ||
      opStateNow === "COMM";
    setStickyErrorMode(isErrorNow);

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
  }, [popup, partId, stationNo, onClose, autoCloseMs, criticalAutoCloseMs, scannerInfo?.isSimulation, stationSettings, validationError]);

  // Auto-clear only non-error helper messages for manual result stations.
  // Keep validation errors visible so operators can read and act (no blink/disappear).
  useEffect(() => {
    const targetStationNo = stationNo || popup?.stationNo || popup?.station_no;
    const isManual = String(targetStationNo).toUpperCase() === "OP020" || Boolean(stationSettings?.[targetStationNo]?.manualResult);
    if (!isManual) return undefined;

    if (!validationInfo && !manualSuccessMsg) return undefined;

    const timer = setTimeout(() => {
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
        const hasBlockingError = Boolean(validationError) || String(popup?.type || "").toUpperCase() === "ERROR";
        if (!journeyData && !hasBlockingError) {
          setLoading(true);
        }
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
  }, [partId, validationError, popup?.type]);

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
  const duplicateLike =
    ["DUPLICATE_SCAN", "ALREADY_COMPLETED", "DUPLICATE_SCAN_IN_FLIGHT"].includes(String(popup?.reason || "").toUpperCase()) ||
    String(popup?.message || "").toUpperCase().includes("ALREADY COMPLETED") ||
    String(popup?.message || "").toUpperCase().includes("DUPLICATE");
  const isErrorPopup =
    String(popup?.type || "").toUpperCase() === "ERROR" ||
    liveQrState === "FAIL" ||
    liveOperationState === "FAIL" ||
    liveOperationState === "COMM";
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
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className={`w-full bg-bg-card shadow-2xl flex flex-col transition-all duration-200 ${isFullscreen
        ? "fixed inset-0 z-[1000] w-screen h-screen max-w-full max-h-screen rounded-none m-0 animate-none"
        : "max-w-3xl rounded-xl max-h-[90vh] animate-in zoom-in duration-200"
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
                <div className="px-3 py-1.5 rounded-lg font-mono text-sm font-black text-amber-400 border border-amber-500/20 max-w-[240px] truncate" style={{ background: "#0f172a" }} title={effectivePartId}>
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
        <div className="flex-1 overflow-y-auto px-5 py-3 bg-bg-card font-medium">
          {effectivePartId && (
            <div className="mb-4 p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between shadow-inner">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Scanned Part QR</span>
              <span className="font-mono text-base font-black text-amber-400 tracking-wider select-all">{effectivePartId}</span>
            </div>
          )}

          {/* QR Input: visible only in simulation mode when not in OK/NG selection mode */}
          {Boolean(scannerInfo?.isSimulation) && !showManualVerificationPanel && (
            <div className="w-full bg-slate-900/80 border border-slate-700/80 rounded-xl p-5 space-y-4 mb-5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Manual QR Code Input
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={manualQrCode}
                  onChange={(e) => setManualQrCode(e.target.value)}
                  placeholder="e.g., PART-K12-998877"
                  className="flex-1 bg-slate-950 border border-slate-600 rounded-lg px-4 py-2 font-bold text-sm text-black outline-none focus:border-amber-500 transition-colors font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleValidateQr();
                  }}
                />
                <button
                  type="button"
                  onClick={handleValidateQr}
                  disabled={validatingQr || !manualQrCode.trim()}
                  className="bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold px-5 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                  {validatingQr ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    "Validate"
                  )}
                </button>
              </div>
              {validationError && (
                <div className="p-4 bg-rose-500/15 border-2 border-rose-500/40 rounded-xl flex items-start gap-3 text-rose-400 mt-2">
                  <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
                  <div className="text-left">
                    <p className="text-sm font-bold uppercase tracking-wider">Scan Rejected</p>
                    <p className="text-sm font-medium leading-relaxed mt-1">{validationError}</p>
                  </div>
                </div>
              )}
              {validationInfo && (
                <div className="p-4 bg-emerald-500/15 border-2 border-emerald-500/40 rounded-xl flex items-start gap-3 text-emerald-400 mt-2">
                  <CheckCircle size={18} className="flex-shrink-0 mt-0.5" />
                  <p className="text-sm font-medium leading-relaxed">{validationInfo}</p>
                </div>
              )}
            </div>
          )}
          {enrichedStations.length > 0 ? (
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
            <div className="flex flex-col items-center justify-center py-8 text-text-muted space-y-4">
              <StationIcon />
              <div className="text-center">
                <p className="text-sm font-bold text-white">Waiting for Barcode Scan</p>
                <p className="text-xs text-text-muted mt-1">Timeline appears after first scan</p>
              </div>
            </div>
          )}
        </div>

        {/* Message & Footer */}
        <div className="px-5 py-3 bg-bg-card border-t border-border/50 flex-shrink-0 space-y-3">
          {showManualVerificationPanel && (
            <div className="rounded-xl border-2 border-slate-600 bg-slate-800/90 p-5 space-y-5 shadow-xl mb-3" style={{ backdropFilter: "blur(4px)" }}>
              <div className="flex items-center gap-2 border-b border-slate-700/60 pb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                <h3 className="text-white text-sm font-extrabold uppercase tracking-wider">Manual Quality Inspection</h3>
              </div>

              <div className="flex gap-5">
                <button
                  type="button"
                  onClick={() => { setManualSelection("OK"); setManualReason(""); }}
                  className={`flex-1 flex flex-col items-center justify-center p-5 rounded-xl border-3 transition-all duration-200 active:scale-[0.98] ${manualSelection === "OK"
                    ? "bg-emerald-600 border-emerald-300 text-white shadow-lg shadow-emerald-500/40 scale-[1.04]"
                    : "bg-slate-900 border-slate-700 text-emerald-500 hover:border-emerald-500 hover:bg-slate-800"
                    }`}
                >
                  <CheckCircle size={28} className={manualSelection === "OK" ? "text-white animate-bounce" : "text-emerald-500"} />
                  <span className="mt-2 text-base font-black uppercase tracking-wider">Part OK (Pass)</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setManualSelection("NG"); setManualReason(""); setManualReasonOpen(false); }}
                  className={`flex-1 flex flex-col items-center justify-center p-5 rounded-xl border-3 transition-all duration-200 active:scale-[0.98] ${manualSelection === "NG"
                    ? "bg-rose-600 border-rose-300 text-white shadow-lg shadow-rose-500/40 scale-[1.04]"
                    : "bg-slate-900 border-slate-700 text-rose-500 hover:border-rose-500 hover:bg-slate-800"
                    }`}
                >
                  <AlertTriangle size={28} className={manualSelection === "NG" ? "text-white animate-bounce" : "text-rose-500"} />
                  <span className="mt-2 text-base font-black uppercase tracking-wider">Part NG (Fail)</span>
                </button>
              </div>

              {manualSelection === "NG" && (
                <div className="space-y-2 animate-in slide-in-from-top-2 duration-150">
                  <label className="text-xs font-bold text-white uppercase tracking-wide">Failure / Rejection Reason</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={manualReason}
                      onChange={(e) => { setManualReason(e.target.value); setManualReasonOpen(true); }}
                      onFocus={() => setManualReasonOpen(true)}
                      placeholder="Type reason to search and select..."
                      className="w-full bg-white border-2 border-slate-500 rounded-xl py-3 px-4 text-sm text-black outline-none focus:border-rose-500 transition-colors font-semibold"
                    />
                    {manualReasonOpen && (
                      <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-slate-300 bg-white shadow-lg">
                        {Object.entries(DEFECT_CATEGORIES).map(([key, category]) => {
                          const matches = category.defects.filter((defect) =>
                            String(defect).toUpperCase().includes(String(manualReason || "").trim().toUpperCase())
                          );
                          if (matches.length === 0) return null;
                          return (
                            <div key={key} className="border-b border-slate-200 last:border-b-0">
                              <div className="px-3 py-1 text-[11px] font-bold text-slate-700 bg-slate-100">{category.label}</div>
                              {matches.map((defect) => (
                                <button
                                  key={`${key}-${defect}`}
                                  type="button"
                                  onClick={() => { setManualReason(defect); setManualReasonOpen(false); }}
                                  className="w-full text-left px-3 py-2 text-sm text-black hover:bg-rose-50"
                                >
                                  {defect}
                                </button>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {manualSuccessMsg && (
                <p className="text-sm font-bold text-emerald-400 text-center">{manualSuccessMsg}</p>
              )}

              <button
                type="button"
                onClick={handleSubmitManualResult}
                disabled={submittingManual || !manualSelection || (manualSelection === "NG" && !manualReason)}
                className={`w-full py-4 rounded-xl text-base font-black uppercase tracking-widest text-white transition-all duration-200 ${submittingManual || !manualSelection || (manualSelection === "NG" && !manualReason)
                  ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
                  : manualSelection === "OK"
                    ? "bg-emerald-500 hover:bg-emerald-400 border-2 border-emerald-300 shadow-lg shadow-emerald-500/30 active:scale-[0.98] text-slate-950 font-black"
                    : "bg-emerald-500 hover:bg-emerald-400 border-2 border-emerald-300 shadow-lg shadow-rose-500/30 active:scale-[0.98] text-white font-black"
                  }`}
              >
                {submittingManual ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw size={18} className="animate-spin" />
                    Submitting Result...
                  </span>
                ) : (
                  "Submit Quality Verification"
                )}
              </button>
            </div>
          )}

          {popup.message && (
            <div className={`p-3 rounded-xl border-2 flex gap-2 items-start text-sm ${!duplicateLike && (liveOperationState === "FAIL" || liveQrState === "FAIL" || popup.type === "ERROR" || popup.gate === "FORMAT" || popup.gate === "PLC_MATCH") ? "bg-danger/15 border-danger/30 text-danger" :
              liveOperationState === "COMM" || popup.type === "WARNING" || popup.reason === "PREVIOUS_STATION_NOT_COMPLETED" ? "bg-warning/15 border-warning/30 text-warning" :
                popup.type === "SUCCESS" || popup.type === "INFO" ? "bg-success/20 border-success/40 text-success" :
                  "bg-bg-elevated/40 border-border/40 text-text-muted"
              }`}>
              {popup.type === "SUCCESS" || popup.type === "INFO" || duplicateLike ? (
                <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium">{friendlyErrorMessage(popup.message, popup)}</p>
                {/* Gate status indicators */}
                {popup.gate && (
                  <div className="flex gap-3 mt-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${popup.gate === "FORMAT" ? "bg-red-500/30 text-red-400" : "bg-emerald-500/30 text-emerald-400"}`}>
                      FORMAT {popup.gate === "FORMAT" ? "✗" : "✓"}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${popup.gate === "PLC_MATCH" ? "bg-red-500/30 text-red-400" : popup.gate === "FORMAT" ? "bg-slate-500/30 text-slate-400" : "bg-emerald-500/30 text-emerald-400"}`}>
                      PLC MATCH {popup.gate === "PLC_MATCH" ? "✗" : popup.gate === "FORMAT" ? "—" : "✓"}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${popup.gate === "DUPLICATE_CHECK" ? "bg-red-500/30 text-red-400" : (popup.gate === "FORMAT" || popup.gate === "PLC_MATCH") ? "bg-slate-500/30 text-slate-400" : "bg-emerald-500/30 text-emerald-400"}`}>
                      DUPLICATE {popup.gate === "DUPLICATE_CHECK" ? "✗" : (popup.gate === "FORMAT" || popup.gate === "PLC_MATCH") ? "—" : "✓"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {resetError && <p className="text-sm font-semibold text-red-500">{resetError}</p>}

          {canReset && showResetConfirm && (
            <div className="rounded-xl border-2 border-red-300 bg-red-50/90 p-4 space-y-2">
              <p className="text-sm font-semibold text-red-700">
                Reset <span className="font-mono">{partId}</span> at {stationNo}?
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowResetConfirm(false)} className="flex-1 rounded-xl border border-red-300 bg-white py-2 text-sm font-bold text-red-700 hover:bg-red-50">
                  Cancel
                </button>
                <button onClick={handleReset} disabled={isResetting} className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-bold text-white hover:bg-red-700">
                  {isResetting ? "..." : "Confirm"}
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-4 mt-2">
            {(showAcknowledge || typeof onClose === "function") && (
              <button
                onClick={onClose}
                className="flex-1 bg-slate-400 hover:bg-slate-600 active:scale-[0.98] text-white font-black py-4 px-6 rounded-xl text-sm uppercase tracking-widest border-2 border-slate-600 shadow-lg transition-all duration-150"
              >
                Close
              </button>
            )}
            {canReset && !showResetConfirm && (
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={isResetting}
                className="flex-1 bg-rose-600 hover:bg-rose-500 active:scale-[0.98] text-white font-black py-4 px-6 rounded-xl text-sm uppercase tracking-widest border-2 border-rose-500 shadow-lg shadow-rose-600/40 flex items-center justify-center gap-2 transition-all duration-150"
              >
                <RefreshCw size={16} className={isResetting ? "animate-spin" : ""} />
                {isResetting ? "..." : "RESET OPERATION"}
              </button>
            )}
          </div>
        </div>

        {/* Enhanced Horizontal Progress Bar with Time Display */}
        {(autoCloseTimeLeft !== null && autoCloseDuration > 0) && (
          <div className="w-full flex-shrink-0">
            <div className="relative w-full h-4 bg-slate-900 overflow-hidden border-t border-slate-700">
              <div
                className={`absolute inset-y-0 left-0 h-full transition-all duration-75 ease-linear ${stickyErrorMode || validationError || popup.type === "ERROR" || liveQrState === "FAIL" || liveOperationState === "FAIL" || liveOperationState === "COMM"
                    ? "bg-gradient-to-r from-rose-700 to-rose-500 shadow-[0_0_12px_rgba(225,29,72,0.6)]"
                    : popup.type === "WARNING" || liveQrState === "DUPLICATE" || liveQrState === "BLOCKED"
                      ? "bg-gradient-to-r from-amber-600 to-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.6)]"
                      : "bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.6)]"
                  }`}
                style={{ width: `${(autoCloseTimeLeft / autoCloseDuration) * 100}%` }}
              />
            </div>
            <div className="bg-slate-950/90 flex items-center justify-between px-3 py-1 text-[10px] font-mono font-bold text-slate-300 border-t border-slate-800">
              <span>Returning to initial state</span>
              <span>{Math.max(0, Math.ceil(autoCloseTimeLeft / 1000))}s</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(GlobalPopup);

