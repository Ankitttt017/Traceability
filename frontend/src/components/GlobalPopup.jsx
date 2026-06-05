// UPGRADE COMPLETE - GlobalPopup (v4.1 - Enhanced Visibility & Timer)
import React, { useEffect, useRef, useState } from "react";
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
import { getStationFeatures, getStationFeatureSettings } from "../utils/stationSettings";
import { stationSettingsApi, traceabilityApi } from "../api/services";
import { normalizeScanResponse } from "../utils/scanResponse";
import { useLanguage } from "../context/LanguageContext";


const StationIcon = React.memo(() => (
  <MapPin size={32} className="opacity-40 text-amber-500 animate-bounce" />
));

function sanitizeScannerCode(value) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

// ---------------------------------------------
// OIL PAN K12 DEFECT MASTER
// ---------------------------------------------
const DEFECT_CATEGORIES = {
  CR: {
    label: "Casting Defects",
    defects: [
      "Warm Up",
      "Non-Filling",
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
      "Iron Particle",
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
      "Overcut",
      "Bubble"
    ]
  },

  MR: {
    label: "MR Defects",
    defects: [
      "Dia Over Size",
      "Dia Under Size",
      "Chattering",
      "Toolmark",
      "Dent",
      "Dimension NG",
      "Tapping NG",
      "Setting Part",
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

const NG_REASON_CATEGORIES = [
  { key: "CR", label: "CR - Casting Defects" },
  { key: "CRAM", label: "CRAM - Cram Defects" },
  { key: "MR", label: "MR - MR Defects" },
];

function getNgReasonsByCategory(categoryKey = "") {
  const key = String(categoryKey || "").trim().toUpperCase();
  return [...(DEFECT_CATEGORIES[key]?.defects || [])];
}

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

function resolveRejectionState(popup = {}) {
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
  const { t } = useLanguage();
  const statusMap = {
    PASS: { bg: "bg-success/15", text: "text-success", dot: "bg-success", label: "PASSED ✓" },
    FAIL: { bg: "bg-danger/15", text: "text-danger", dot: "bg-danger", label: "FAILED ✗" },
    DUPLICATE: { bg: "bg-amber-500/15", text: "text-amber-600", dot: "bg-amber-500", label: t("globalPopup.duplicate", "DUPLICATE") },
    BLOCKED: { bg: "bg-slate-500/15", text: "text-slate-600", dot: "bg-slate-500", label: t("globalPopup.blocked", "BLOCKED") },
    RUN: { bg: "bg-warning/15", text: "text-warning", dot: "bg-warning animate-pulse", label: t("globalPopup.running", "RUNNING...") },
    WAIT_MACHINE: { bg: "bg-warning/10", text: "text-warning/80", dot: "bg-warning/60 animate-pulse", label: t("globalPopup.waitingMachine", "WAITING MACHINE...") },
    WAIT_OP: { bg: "bg-primary/10", text: "text-primary/80", dot: "bg-primary/60", label: t("globalPopup.waiting", "WAITING...") },
    SCANNED: { bg: "bg-primary/15", text: "text-primary", dot: "bg-primary", label: t("globalPopup.scanned", "SCANNED") },
    COMM: { bg: "bg-comm/15", text: "text-comm", dot: "bg-comm", label: t("globalPopup.plcFault", "PLC FAULT") },
    INTERLOCKED: { bg: "bg-slate-500/15", text: "text-slate-600", dot: "bg-slate-500", label: t("globalPopup.interlocked", "INTERLOCKED") },
    RESETTING: { bg: "bg-amber-500/15", text: "text-amber-600", dot: "bg-amber-500 animate-spin", label: t("globalPopup.resetting", "RESETTING...") },
    WAIT: { bg: "bg-bg-elevated", text: "text-text-muted", dot: "bg-border-strong", label: t("globalPopup.waiting", "WAITING") },
    IDLE: { bg: "bg-bg-elevated", text: "text-text-muted", dot: "bg-border-strong", label: t("globalPopup.idle", "IDLE") },
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
  const { t } = useLanguage();
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
              <span className="px-1.5 py-0.5 rounded-full bg-primary text-white text-[8px] font-bold uppercase">{t("globalPopup.current", "Current")}</span>
            )}
          </div>
          {dateObj && <span className="text-[9px] text-text-muted">{timeStr}</span>}
        </div>

        {!isPending && (
          <div className="flex flex-wrap gap-1.5">
            {station.features?.qr && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.qr", "QR")}</span>
                <StatusBadge status={station.qrVerification || "WAIT"} />
              </div>
            )}
            {station.features?.operation && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.operation", "Op")}</span>
                <StatusBadge status={station.operation || "WAIT"} />
              </div>
            )}
            {station.features?.qualityCheck && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.qc", "QC")}</span>
                <StatusBadge status={station.qualityCheck || "WAIT"} />
              </div>
            )}
            {(station.features?.manualResult || station.features?.camera || station.features?.torque) && !station.features?.qualityCheck && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.qcValue", "QC Val")}</span>
                <StatusBadge status={station.qualityCheck || "WAIT"} />
              </div>
            )}
            {station.features?.rejectionBin && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded px-2 py-1.5 min-w-[80px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.rejectionShort", "Rej")}</span>
                <StatusBadge status={station.rejectionConfirmation || "PENDING"} />
              </div>
            )}
          </div>
        )}

        {/* Show NG Reason if available */}
        {(station.reason || station.remarks) && (isFailed || station.qualityCheck === "FAIL" || station.operation === "FAIL") && (
          <div className="mt-2 px-2 py-1.5 bg-danger/10 border border-danger/20 rounded">
            <span className="text-[9px] font-bold text-danger uppercase tracking-wider">{t("globalPopup.defectReason", "Defect Reason:")}</span>
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
  const reason = String(popup?.reason || popup?.qrReason || "").trim().toUpperCase();

  if (reason === "PART_NOT_FOUND" || msgUpper.includes("PART NOT FOUND") || msgUpper.includes("NOT FOUND IN MOULDING")) {
    return `[PART NOT FOUND] Part ${partId || "QR"} not found in moulding records. Verify scanned QR and bridge source data.`;
  }
  if (reason === "INVALID_QR_FORMAT" || msgUpper.includes("INVALID_QR_FORMAT") || msgUpper.includes("QR FORMAT MISMATCH")) {
    return `[QR FORMAT MISMATCH] Invalid QR format. Scan correct component code.`;
  }
  if (reason === "PREVIOUS_STATION_NOT_COMPLETED" || msgUpper.includes("PREVIOUS_STATION_NOT_COMPLETED")) {
    const expected = String(popup?.expectedStation || "").trim().toUpperCase();
    const lastCompleted = String(popup?.lastCompletedStation || popup?.last_completed_station || "").trim().toUpperCase();
    return expected && lastCompleted
      ? `[SEQUENCE ERROR] Scan at ${expected} first. Last completed: ${lastCompleted}.`
      : expected
      ? `[SEQUENCE ERROR] Scan at ${expected} first.`
      : `[SEQUENCE ERROR] Previous station not completed.`;
  }
  if (["DUPLICATE_SCAN", "ALREADY_COMPLETED", "DUPLICATE_SCAN_IN_FLIGHT"].includes(reason) || msgUpper.includes("DUPLICATE_SCAN") || msgUpper.includes("ALREADY_COMPLETED")) {
    return `[DUPLICATE SCAN] This part has already passed. Re-scan is not allowed.`;
  }
  if (reason === "SCAN_RESULT_NG" || msgUpper.includes("SCAN_RESULT_NG")) {
    return `[PART NG] This part is marked NG. Move to rejection flow.`;
  }
  if (reason === "STATION_NOT_CONFIGURED" || reason === "STATION_NOT_FOUND" || msgUpper.includes("STATION NOT FOUND")) {
    return `[STATION NOT CONFIGURED] Station ${station || "selected station"} is not in active route configuration.`;
  }

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
    const expected = String(popup?.expectedStation || "").trim().toUpperCase();
    const lastCompleted = String(popup?.lastCompletedStation || popup?.last_completed_station || "").trim().toUpperCase();
    if (expected && lastCompleted) {
      return `❌ [SEQUENCE ERROR] Scan at ${expected} first. Last completed: ${lastCompleted}.`;
    }
    if (expected) {
      return `❌ [SEQUENCE ERROR] Scan at ${expected} first.`;
    }
    return "❌ [SEQUENCE ERROR] Previous station not completed.";
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
  showJourney = false,
  journeyScope = "full",
  allowBottomClose = false,
  manualScanMode = false,
  disableAutoClose = false,
  activeStation = "",
}) => {
  const { t } = useLanguage();
  const [journeyData, setJourneyData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [stationSettings, setStationSettings] = useState(() => getStationFeatureSettings());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoCloseTimeLeft, setAutoCloseTimeLeft] = useState(null); // remaining time in ms
  const [autoCloseDuration, setAutoCloseDuration] = useState(0);    // original duration in ms
  const [stickyErrorMode, setStickyErrorMode] = useState(false);

  const [manualSelection, setManualSelection] = useState(null); // 'OK' or 'NG'
  const [manualReason, setManualReason] = useState("");
  const [manualReasonQuery, setManualReasonQuery] = useState("");
  const [manualReasonCategory, setManualReasonCategory] = useState("");
  const [showReasonDropdown, setShowReasonDropdown] = useState(false);
  const [submittingManual, setSubmittingManual] = useState(false);
  const [manualSuccessMsg, setManualSuccessMsg] = useState("");

  const [manualQrCode, setManualQrCode] = useState("");
  const [lastScannedCode, setLastScannedCode] = useState("");
  const [validatingQr, setValidatingQr] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [validationInfo, setValidationInfo] = useState(""); // friendly info (e.g. already completed)
  const [scanBanner, setScanBanner] = useState(null);
  const [scanLocked, setScanLocked] = useState(false);
  const [localScanDecision, setLocalScanDecision] = useState("");
  const [awaitingNextScan, setAwaitingNextScan] = useState(false);
  const [submittedPartId, setSubmittedPartId] = useState("");
  const manualSubmitTimerRef = useRef(null);
  const submittedPartIdRef = useRef("");
  // Use ref so handleValidateQr sets value synchronously before socket/useEffect can read stale state
  const [localQrValidated, setLocalQrValidated] = useState(false);
  const localValidatedPartIdRef = useRef("");
  const scanInputRef = useRef(null);
  const usbScanBufferRef = useRef("");
  const usbLastKeyAtRef = useRef(0);
  const prevSocketPartIdRef = useRef("");
  const autoCloseContextRef = useRef("");
  const reasonDropdownRef = useRef(null);
  const validateRequestSeqRef = useRef(0);

  const validateQrCode = async (rawCode) => {
    const scannedCode = sanitizeScannerCode(rawCode);
    if (!scannedCode) {
      setValidationInfo("");
      setValidationError("Please scan or enter QR code.");
      return;
    }
    if (scannedCode.length < 4) {
      setValidationInfo("");
      setValidationError("");
      return;
    }
    const requestSeq = ++validateRequestSeqRef.current;
    setValidatingQr(true);
    setAwaitingNextScan(false);
    setValidationError("");
    setValidationInfo("");
    setScanBanner(null);
    setLocalScanDecision("");
    setLocalQrValidated(false);
    const newScanKey = String(scannedCode || "").trim().toUpperCase();
    if (newScanKey && submittedPartIdRef.current && newScanKey !== submittedPartIdRef.current) {
      setSubmittedPartId("");
      submittedPartIdRef.current = "";
    }
    localValidatedPartIdRef.current = "";
    try {
      const payload = {
        qrCode: scannedCode,
        machineId: Number(machineId),
      };
      setLastScannedCode(scannedCode);
      const res = await traceabilityApi.verify(payload);
      const normalized = normalizeScanResponse(res);
      if (requestSeq !== validateRequestSeqRef.current) return;
      setScanBanner(normalized);

      if (!normalized.ok) {
        // Failed/blocked QR is not a validated active part.
        localValidatedPartIdRef.current = "";
        setValidationInfo("");
        setValidationError(normalized.message);
        setLocalScanDecision(String(normalized.decision || "FAIL").toUpperCase());
        const rawReason = String(normalized?.raw?.reason || "").toUpperCase();
        const lockForRescan = ["DUPLICATE_SCAN", "ALREADY_COMPLETED", "SCAN_RESULT_NG", "PART_INTERLOCKED"].includes(rawReason)
          || ["DUPLICATE", "NG", "FAIL", "BLOCK"].includes(String(normalized.decision || "").toUpperCase());
        setScanLocked(lockForRescan);
        setManualQrCode("");
        return;
      }

      setValidationInfo(normalized.message || `QR accepted for ${String(normalized.stationNo || stationNo || "").trim().toUpperCase() || "current station"}.`);
      setLocalScanDecision("PASS");
      localValidatedPartIdRef.current = String(
        normalized?.raw?.partId || normalized?.raw?.part_id || scannedCode
      ).trim();
      setLocalQrValidated(true);
      setManualSelection(null);
      setManualReason("");
      setManualReasonQuery("");
      setManualQrCode("");
      setScanLocked(false);
    } catch (err) {
      if (requestSeq !== validateRequestSeqRef.current) return;
      const normalized = normalizeScanResponse(err?.response?.data || { error: err?.message || "Validation failed." });
      setScanBanner({ ...normalized, decision: normalized.decision || "ERROR", ok: false });
      setValidationInfo("");
      setValidationError(normalized.message);
      setLocalScanDecision("FAIL");
      setLocalQrValidated(false);
      localValidatedPartIdRef.current = "";
    } finally {
      if (requestSeq === validateRequestSeqRef.current) {
        setValidatingQr(false);
      }
    }
  };

  const handleValidateQr = async () => {
    const code = String(manualQrCode || "").trim();
    if (validatingQr) return;
    if (scanLocked) {
      setValidationError("This part is blocked for re-scan (duplicate/NG/interlocked). Please scan a new part.");
      return;
    }
    if (!code) {
      setValidationInfo("");
      setValidationError("Please scan or enter QR code.");
      return;
    }
    await validateQrCode(code);
  };

  const socketPartId = String(popup?.partId || popup?.part_id || "").trim();
  const partId = socketPartId;
  const stationNo = String(activeStation || popup?.stationNo || popup?.station_no || "").trim();

  // Reset manual state only when station changes (not on partId change — that would wipe localQrValidated)
  useEffect(() => {
    setResetError("");
    setIsResetting(false);
    setShowResetConfirm(false);
    setManualSelection(null);
    setManualReason("");
    setManualReasonQuery("");
    setManualReasonCategory("");
    setShowReasonDropdown(false);
    setManualSuccessMsg("");
    setValidationError("");
    setValidationInfo("");
    setLocalScanDecision("");
    setLocalQrValidated(false);
    setScanLocked(false);
    setAwaitingNextScan(false);
    setSubmittedPartId("");
    submittedPartIdRef.current = "";
    localValidatedPartIdRef.current = "";
  }, [stationNo]); // Only reset on station change — partId changes from socket must NOT wipe validated state

  useEffect(() => {
    if (!showReasonDropdown) return undefined;
    const handleOutside = (event) => {
      if (!reasonDropdownRef.current?.contains(event.target)) {
        setShowReasonDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [showReasonDropdown]);

  // Prefer locally validated QR immediately so strip/panel update without waiting socket partId
  const effectivePartId = localValidatedPartIdRef.current || partId || lastScannedCode;

  // When a brand-new socket part arrives on same station, reset popup UI state to initial
  // so previous error/success does not stick to next scanned part.
  useEffect(() => {
    if (!popup) {
      prevSocketPartIdRef.current = "";
      return;
    }
    if (!socketPartId) {
      if (prevSocketPartIdRef.current) {
        prevSocketPartIdRef.current = "";
        setResetError("");
        setShowResetConfirm(false);
        setIsResetting(false);
        setManualSelection(null);
        setManualReason("");
        setManualReasonQuery("");
        setManualReasonCategory("");
        setManualSuccessMsg("");
        setManualQrCode("");
        setLocalQrValidated(false);
        localValidatedPartIdRef.current = "";
      }
      return;
    }
    if (prevSocketPartIdRef.current === socketPartId) return;
    prevSocketPartIdRef.current = socketPartId;
    setAwaitingNextScan(false);
    setSubmittedPartId("");
    submittedPartIdRef.current = "";

    setResetError("");
    setShowResetConfirm(false);
    setIsResetting(false);
    setManualSelection(null);
    setManualReason("");
    setManualReasonQuery("");
    setManualReasonCategory("");
    setManualSuccessMsg("");
    setManualQrCode("");
    setLocalQrValidated(false);
    localValidatedPartIdRef.current = "";
  }, [popup, socketPartId]);

  const handleSubmitManualResult = async () => {
    const submitPartId = effectivePartId;
    const submitStationNo = stationNo;
    const normalizedReason = String(manualReason || manualReasonQuery || "").trim();
    const needsNgReason = manualSelection === "NG";
    if (!submitPartId || !submitStationNo || !manualSelection) {
      setValidationError("Scan QR and select OK/NG first.");
      return;
    }
    if (needsNgReason && !normalizedReason) {
      setValidationError("Please select NG reason before submit.");
      return;
    }
    if (needsNgReason && !ngReasonOptions.includes(normalizedReason)) {
      setValidationError("Please select NG reason from the list.");
      return;
    }
    if (needsNgReason) {
      setManualReason(normalizedReason);
      setManualReasonQuery(normalizedReason);
    }
    setSubmittingManual(true);
    setAwaitingNextScan(true);
    setManualSuccessMsg("");
    setResetError("");
    setValidationError("");
    try {
      const res = await traceabilityApi.submitManualResult({
        partId: submitPartId,
        stationNo: submitStationNo,
        status: manualSelection === "OK" ? "OK" : "NG",
        reason: manualSelection === "NG" ? normalizedReason : undefined,
      });
      setManualSuccessMsg(res?.message || `Part ${manualSelection === "OK" ? "accepted" : "rejected"} - ready for next scan.`);
      if (manualSubmitTimerRef.current) clearTimeout(manualSubmitTimerRef.current);
      manualSubmitTimerRef.current = setTimeout(() => {
        // return popup to initial state after successful submit
        setLocalQrValidated(false);
        localValidatedPartIdRef.current = "";
        setManualSelection(null);
        setManualReason("");
        setManualReasonQuery("");
        setManualReasonCategory("");
        setValidationError("");
        setValidationInfo("");
        setLocalScanDecision("");
        setLastScannedCode("");
        setManualQrCode("");
        setScanLocked(false);
        setAwaitingNextScan(true);
        const submittedKey = String(submitPartId || "").trim().toUpperCase();
        setSubmittedPartId(submittedKey);
        submittedPartIdRef.current = submittedKey;
        if (typeof onResetOperation === "function") {
          onResetOperation(submitPartId, submitStationNo, { confirmed: true }).catch(() => { });
        }
        setManualSuccessMsg("");
        setSubmittingManual(false);
        onClose?.();
      }, 1200);
    } catch (error) {
      setResetError(error?.response?.data?.error || error?.message || "Submission failed.");
      setAwaitingNextScan(false);
      setSubmittingManual(false);
    }
  };
  useEffect(() => () => {
    if (manualSubmitTimerRef.current) clearTimeout(manualSubmitTimerRef.current);
  }, []);

  // Auto-close timer with linear decreasing interval logic
  useEffect(() => {
    if (!popup) {
      setAutoCloseTimeLeft(null);
      setAutoCloseDuration(0);
      setStickyErrorMode(false);
      autoCloseContextRef.current = "";
      return undefined;
    }
    if (disableAutoClose) {
      setAutoCloseTimeLeft(null);
      setAutoCloseDuration(0);
      setStickyErrorMode(false);
      autoCloseContextRef.current = "";
      return undefined;
    }

    const targetStationNo = stationNo || activeStation || popup?.stationNo || popup?.station_no;
    const targetFeatures = getStationFeatures(targetStationNo, stationSettings);
    const isOnlyQrCheck = targetFeatures.qr === true && targetFeatures.operation === false;
    const signalCustomerMappingStation =
      targetFeatures?.manualResult !== true &&
      targetFeatures?.validateQrFormat === false &&
      targetFeatures?.validateShotNumber === false &&
      targetFeatures?.validatePreviousStation !== false;
    const isManual = targetFeatures?.manualResult === true;

    const popupType = String(popup?.type || "").trim().toUpperCase();
    const popupQrState = resolveQrState(popup);
    const popupOpState = resolveOperationState(popup);
    const closeContextKey = [
      String(popup?._shownAtMs || popup?.createdAt || ""),
      String(socketPartId || localValidatedPartIdRef.current || "").trim().toUpperCase(),
      String(targetStationNo || "").trim().toUpperCase(),
      popupType,
      popupQrState,
      popupOpState,
      String(validationError || "").trim().toUpperCase(),
    ].join("|");

    let duration = 0;
    const STANDARD_SUCCESS_CLOSE_MS = 4200;
    const STANDARD_ERROR_CLOSE_MS = 9000;

    // Faster auto-close / auto-reset for QR-focused industrial flow
    if (isOnlyQrCheck) {
      const qrState = popupQrState;
      if (qrState === "PASS" || qrState === "DUPLICATE") {
        duration = STANDARD_SUCCESS_CLOSE_MS;
      } else if (popup?.type === "ERROR" || qrState === "FAIL" || qrState === "BLOCKED") {
        duration = Math.max(criticalAutoCloseMs || 0, STANDARD_ERROR_CLOSE_MS);
      } else {
        // Even when upstream state is partial/WAIT, close quickly to be ready for next industrial scan.
        duration = STANDARD_SUCCESS_CLOSE_MS;
      }
    } else if (signalCustomerMappingStation) {
      if (popupType === "SUCCESS" || popupQrState === "PASS") {
        duration = Math.max(autoCloseMs || 12000, 12000);
      } else if (popup?.type === "ERROR" || popupQrState === "FAIL" || popupQrState === "BLOCKED") {
        duration = Math.max(criticalAutoCloseMs || 0, STANDARD_ERROR_CLOSE_MS);
      } else {
        duration = Math.max(autoCloseMs || 12000, 12000);
      }
    } else if (isManual) {
      // Manual-result station behavior:
      // Keep popup open until operator submits final OK/NG action.
      if (submittingManual) {
        setAutoCloseTimeLeft(null);
        setAutoCloseDuration(0);
        return undefined;
      }
      const hasManualDecisionPending = Boolean(manualSelection);
      if (popupType === "SUCCESS" || manualSuccessMsg) {
        duration = 2200;
      } else if ((validationError || popupType === "ERROR") && !hasManualDecisionPending) {
        duration = STANDARD_ERROR_CLOSE_MS; // auto-close plain validation errors so next scan can start
      } else {
        setAutoCloseTimeLeft(null);
        setAutoCloseDuration(0);
        return undefined;
      }
    } else {
      if (autoCloseMs > 0) {
        const qrState = String(popup.qrVerification || popup.qrState || "WAIT").toUpperCase();
        const operationState = resolveOperationState(popup);

        if (popupType === "SUCCESS" || operationState === "PASS") {
          duration = STANDARD_SUCCESS_CLOSE_MS; // Auto-close for PASS
        } else if (["FAIL", "COMM", "TIMEOUT"].includes(operationState) || popupType === "ERROR" || qrState === "FAIL") {
          duration = Math.max(criticalAutoCloseMs || 0, STANDARD_ERROR_CLOSE_MS); // shorter for errors
        } else {
          const isCritical = popupType === "ERROR" || qrState === "FAIL";
          const hasStateDetails = Boolean(partId || stationNo || qrState !== "WAIT" || operationState !== "IDLE");
          if (!hasStateDetails) {
            duration = STANDARD_SUCCESS_CLOSE_MS;
          } else {
            duration = isCritical
              ? Math.max(criticalAutoCloseMs || 0, STANDARD_ERROR_CLOSE_MS)
              : Math.max(autoCloseMs || 0, STANDARD_SUCCESS_CLOSE_MS);
          }
        }
      }
    }

    // Keep a small minimum for readability while staying fast.
    if (duration > 0 && duration < 2200) {
      duration = 2200;
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      setAutoCloseTimeLeft(null);
      setAutoCloseDuration(0);
      autoCloseContextRef.current = "";
      return undefined;
    }

    if (autoCloseContextRef.current === closeContextKey) {
      return undefined;
    }
    autoCloseContextRef.current = closeContextKey;

    const qrStateNow = popupQrState;
    const opStateNow = popupOpState;
    const isErrorNow =
      Boolean(validationError) ||
      popupType === "ERROR" ||
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
        autoCloseContextRef.current = "";
        onClose?.();
      }
    }, 50);

    return () => clearInterval(timer);
  }, [
    socketPartId,
    partId,
    stationNo,
    onClose,
    autoCloseMs,
    criticalAutoCloseMs,
    scannerInfo?.isSimulation,
    stationSettings,
    validationError,
    disableAutoClose,
    submittingManual,
    manualSuccessMsg,
    popup?.type,
    popup?._shownAtMs,
    popup?.createdAt,
    popup?.qrStatus,
    popup?.qrResult,
    popup?.qrDecision,
    popup?.decision,
    popup?.qrVerification,
    popup?.qrState,
    popup?.operationStatus,
    popup?.plcStatus,
    popup?.status,
  ]);

  // Auto-clear only non-error helper messages for manual result stations.
  // Keep validation errors visible so operators can read and act (no blink/disappear).
  useEffect(() => {
    const targetStationNo = stationNo || activeStation || popup?.stationNo || popup?.station_no;
    const targetFeatures = getStationFeatures(targetStationNo, stationSettings);
    const isManual = targetFeatures?.manualResult === true;
    if (!isManual) return undefined;

    if (!validationInfo && !manualSuccessMsg) return undefined;

    const timer = setTimeout(() => {
      setValidationInfo("");
      if (!submittingManual) {
        setManualSuccessMsg("");
      }
    }, 2200);

    return () => clearTimeout(timer);
  }, [popup, stationNo, stationSettings, validationInfo, validationError, manualSuccessMsg, submittingManual]);

  useEffect(() => {
    const mode = String(
      scannerInfo?.scannerMode ||
      scannerInfo?.mode ||
      popup?.scannerMode ||
      popup?.mode ||
      ""
    ).trim().toUpperCase();
    const isUsbMode = ["USB_SERIAL", "USB", "USB_HID", "HID"].includes(mode);
    const shouldAutoFocus =
      Boolean(popup) &&
      (Boolean(scannerInfo?.isSimulation) || mode === "USB_SERIAL" || manualScanMode === true || popup?.manualScanMode === true);
    if (!shouldAutoFocus) return;
    const isTypingInAnotherField = () => {
      const active = document?.activeElement;
      const tag = String(active?.tagName || "").toUpperCase();
      const editable = active?.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      return editable && active !== scanInputRef.current;
    };
    if (isUsbMode) {
      const timer = setTimeout(() => {
        if (isTypingInAnotherField()) return;
        if (scanInputRef.current && typeof scanInputRef.current.focus === "function") {
          scanInputRef.current.focus({ preventScroll: true });
        }
      }, 80);
      const keepFocusTimer = setInterval(() => {
        if (!popup) return;
        if (isTypingInAnotherField()) return;
        const active = document?.activeElement;
        if (scanInputRef.current && active !== scanInputRef.current && typeof scanInputRef.current.focus === "function") {
          scanInputRef.current.focus({ preventScroll: true });
        }
      }, 1200);
      return () => {
        clearTimeout(timer);
        clearInterval(keepFocusTimer);
      };
    }
    const timer = setTimeout(() => {
      if (isTypingInAnotherField()) return;
      if (scanInputRef.current && typeof scanInputRef.current.focus === "function") {
        scanInputRef.current.focus();
      }
    }, 80);
    const keepFocusTimer = setInterval(() => {
      if (!popup) return;
      if (isTypingInAnotherField()) return;
      const active = document?.activeElement;
      if (scanInputRef.current && active !== scanInputRef.current && typeof scanInputRef.current.focus === "function") {
        scanInputRef.current.focus();
      }
    }, 1200);
    return () => {
      clearTimeout(timer);
      clearInterval(keepFocusTimer);
    };
  }, [popup, scannerInfo?.isSimulation, scannerInfo?.scannerMode, scannerInfo?.mode, manualScanMode]);

  useEffect(() => {
    let active = true;
    const syncSettings = async () => {
      try {
        const latest = await stationSettingsApi.list();
        if (active && latest && Object.keys(latest).length > 0) {
          setStationSettings(latest);
          return;
        }
      } catch {
        // keep fallback local settings
      }
      if (active) {
        setStationSettings(getStationFeatureSettings());
      }
    };
    syncSettings();
    const onFocus = () => syncSettings();
    const onStorage = () => setStationSettings(getStationFeatureSettings());
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!popup) return undefined;

    const mode = String(
      scannerInfo?.scannerMode ||
      scannerInfo?.mode ||
      popup?.scannerMode ||
      popup?.mode ||
      ""
    ).trim().toUpperCase();
    const isUsbMode = ["USB_SERIAL", "USB", "USB_HID", "HID"].includes(mode);
    if (!isUsbMode) return undefined;

    const targetStationNo = stationNo || activeStation || popup?.stationNo || popup?.station_no;
    const targetFeatures = getStationFeatures(targetStationNo, stationSettings);
    const isManualResultStation = targetFeatures?.manualResult === true;

    const currentQrState = resolveQrState(popup);
    const currentOperationState = resolveOperationState(popup);
    const currentNextPartHint = String(validationInfo || popup?.message || "").trim().toUpperCase();
    const isCurrentNextPartState =
      awaitingNextScan ||
      currentNextPartHint.includes("SCAN THE NEXT PART") ||
      (currentNextPartHint.includes("READY") && currentNextPartHint.includes("NEXT"));
    const currentActivePartKey = String(effectivePartId || "").trim().toUpperCase();
    const hasActiveScannedPart = Boolean(currentActivePartKey);
    const currentSubmittedKey = String(submittedPartId || submittedPartIdRef.current || "").trim().toUpperCase();
    const isSubmittedPartStillActive = Boolean(currentSubmittedKey) && currentSubmittedKey === currentActivePartKey;
    const showManualVerificationPanel =
      isManualResultStation &&
      hasActiveScannedPart &&
      !isSubmittedPartStillActive &&
      !isCurrentNextPartState &&
      (localQrValidated || localScanDecision === "PASS" || currentQrState === "PASS" || scanBanner?.ok === true) &&
      currentOperationState !== "PASS" &&
      currentOperationState !== "FAIL";

    const shouldShowScanInputPanel =
      !showManualVerificationPanel &&
      (Boolean(scannerInfo?.isSimulation) || isUsbMode || manualScanMode === true || popup?.manualScanMode === true);

    if (!shouldShowScanInputPanel) return undefined;

    usbScanBufferRef.current = "";
    usbLastKeyAtRef.current = 0;

    const onUsbScannerKeyDown = (event) => {
      if (!popup) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      const tag = String(target?.tagName || "").toUpperCase();
      const isEditable =
        target?.isContentEditable === true ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
      if (isEditable && target !== scanInputRef.current) return;

      const now = Date.now();
      if (now - usbLastKeyAtRef.current > 250) {
        usbScanBufferRef.current = "";
      }
      usbLastKeyAtRef.current = now;

      if (event.key === "Enter") {
        const scanned = String(usbScanBufferRef.current || "").trim();
        usbScanBufferRef.current = "";
        if (!scanned) return;
        event.preventDefault();
        setManualQrCode(scanned);
        validateQrCode(scanned);
        return;
      }

      if (event.key === "Backspace") {
        usbScanBufferRef.current = usbScanBufferRef.current.slice(0, -1);
        setManualQrCode(usbScanBufferRef.current);
        return;
      }

      if (event.key.length === 1) {
        if (/[\u0000-\u001F\u007F]/.test(event.key)) return;
        usbScanBufferRef.current += event.key;
        setManualQrCode(usbScanBufferRef.current);
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onUsbScannerKeyDown, true);
    return () => window.removeEventListener("keydown", onUsbScannerKeyDown, true);
  }, [
    popup,
    stationNo,
    stationSettings,
    scannerInfo?.isSimulation,
    scannerInfo?.scannerMode,
    scannerInfo?.mode,
    manualScanMode,
    localQrValidated,
    localScanDecision,
    validationInfo,
    scanBanner?.ok,
    awaitingNextScan,
    effectivePartId,
    submittedPartId,
  ]);

  // Fetch part journey
  useEffect(() => {
    let isActive = true;
    if (!showJourney || !partId) {
      setJourneyData(null);
      return () => { isActive = false; };
    }

    const fetchJourney = async () => {
      try {
        const hasBlockingError = Boolean(validationError) || String(popup?.type || "").toUpperCase() === "ERROR";
        if (!journeyData && !hasBlockingError) {
          setLoading(true);
        }
        const res = await traceabilityApi.journeyByPart(partId);
        if (isActive) setJourneyData(res);
      } catch (error) {
        console.warn("[GlobalPopup] Journey fetch failed:", error?.message || error);
      } finally {
        if (isActive) setLoading(false);
      }
    };
    fetchJourney();
    return () => { isActive = false; };
  }, [partId, validationError, popup?.type, showJourney]);

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
        </div>
      </div>
    );
  }

  // Full journey mode
  const stations = showJourney ? (journeyData?.stations || []) : [];
  const journeyStations = showJourney ? (journeyData?.stationTimeline || journeyData?.stations || []) : [];
  const targetStationNo = stationNo || popup.stationNo || popup.station_no;
  const targetStationKey = String(targetStationNo || "").trim().toUpperCase();

  // Merge live data into the current station (if it exists in the timeline)
  const liveQrState = resolveQrState(popup);
  const liveOperationState = resolveOperationState(popup);
  const duplicateLike =
    ["DUPLICATE_SCAN", "ALREADY_COMPLETED", "DUPLICATE_SCAN_IN_FLIGHT"].includes(String(popup?.reason || "").toUpperCase()) ||
    String(popup?.message || "").toUpperCase().includes("ALREADY COMPLETED") ||
    String(popup?.message || "").toUpperCase().includes("DUPLICATE");
  const liveRejectionState = resolveRejectionState(popup, liveOperationState);

  // Always prefer the station currently opened on OperatorView.
  // Fallback to journey IN_PROGRESS only when popup has no station identity.
  const currentStationIndex = journeyStations.findIndex(
    (s) => String(s.stationNo || "").trim().toUpperCase() === targetStationKey
  );
  const fallbackLiveStationIndex = journeyStations.findIndex((s) => s.status === "IN_PROGRESS");
  const mergeStationIndex = currentStationIndex >= 0 ? currentStationIndex : fallbackLiveStationIndex;
  const enrichedStations = journeyStations.map((s, idx) => {
    const features = getStationFeatures(s.stationNo, stationSettings);
    let base = { ...s, features };

    // MERGE LOGIC: merge live data only into the opened target station
    if (idx === mergeStationIndex) {
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
  const features = getStationFeatures(targetStationNo, stationSettings);
  const isManualResultStation = features?.manualResult === true;

  const nextPartHint = String(validationInfo || popup?.message || "").trim().toUpperCase();
  const isNextPartState =
    awaitingNextScan ||
    nextPartHint.includes("SCAN THE NEXT PART") ||
    nextPartHint.includes("READY") && nextPartHint.includes("NEXT");
  const activePartKey = String(effectivePartId || "").trim().toUpperCase();
  const hasActiveScannedPart = Boolean(activePartKey);
  const submittedKey = String(submittedPartId || submittedPartIdRef.current || "").trim().toUpperCase();
  const isSubmittedPartStillActive = Boolean(submittedKey) && submittedKey === activePartKey;
  const showManualVerificationPanel =
    isManualResultStation &&
    hasActiveScannedPart &&
    !isSubmittedPartStillActive &&
    !isNextPartState &&
    // Show immediately after local validate OR after socket confirms PASS
    (localQrValidated || localScanDecision === "PASS" || liveQrState === "PASS" || scanBanner?.ok === true) &&
    liveOperationState !== "PASS" &&
    liveOperationState !== "FAIL";
  const scannerMode = String(
    scannerInfo?.scannerMode ||
    scannerInfo?.mode ||
    popup?.scannerMode ||
    popup?.mode ||
    ""
  ).trim().toUpperCase();
  const isUsbScannerMode = ["USB_SERIAL", "USB", "USB_HID", "HID"].includes(scannerMode);
  const showScanInputPanel =
    !showManualVerificationPanel &&
    (Boolean(scannerInfo?.isSimulation) ||
      isUsbScannerMode ||
      manualScanMode === true ||
      popup?.manualScanMode === true);

  const displayStations = showJourney ? enrichedStations : [];
  const allNgReasonOptions = Array.from(
    new Set(NG_REASON_CATEGORIES.flatMap((category) => getNgReasonsByCategory(category.key)))
  );
  const ngReasonOptions = manualReasonCategory
    ? getNgReasonsByCategory(manualReasonCategory)
    : allNgReasonOptions;
  const filteredNgReasonOptions = (() => {
    const q = String(manualReasonQuery || "").trim().toLowerCase();
    if (!q) return ngReasonOptions;
    return ngReasonOptions.filter((reason) => String(reason).toLowerCase().includes(q));
  })();
  const isValidNgReason = !manualReason || ngReasonOptions.includes(manualReason);
  const currentStationName = displayStations.find((s) => s.status === "IN_PROGRESS")?.stationName || stationNo || "System Node";
  const activeStationIndexInJourney = enrichedStations.findIndex(
    (s) => String(s.stationNo || "").trim().toUpperCase() === targetStationKey
  );
  const fallbackCurrentIndex = enrichedStations.findIndex((s) => String(s.status || "").toUpperCase() === "IN_PROGRESS");
  const resolvedCurrentIndex = activeStationIndexInJourney >= 0 ? activeStationIndexInJourney : fallbackCurrentIndex;
  const previousStation = resolvedCurrentIndex > 0 ? enrichedStations[resolvedCurrentIndex - 1] : null;
  const currentStationCard = resolvedCurrentIndex >= 0 ? enrichedStations[resolvedCurrentIndex] : null;
  const previousOpState = String(previousStation?.operation || previousStation?.qualityCheck || previousStation?.status || "").trim().toUpperCase();
  const currentOpState = String(liveOperationState || currentStationCard?.operation || currentStationCard?.status || "").trim().toUpperCase();
  const previousStationPassed = ["PASS", "PASSED", "COMPLETED", "ENDED_OK"].includes(previousOpState);
  const currentStationPassed = ["PASS", "PASSED", "COMPLETED", "ENDED_OK"].includes(currentOpState);

  const passCount = displayStations.filter(s => {
    const quality = String(s.qualityCheck || "").toUpperCase();
    const operation = String(s.operation || "").toUpperCase();
    return quality === "PASS" || operation === "PASS";
  }).length;
  const totalCount = displayStations.length || "?";
  const allPassed = typeof totalCount === "number" && passCount === totalCount && passCount > 0;

  const hour = new Date().getHours();
  const shiftText = hour >= 6 && hour < 14 ? "A Shift" : hour >= 14 && hour < 22 ? "B Shift" : "C Shift";
  const scannerConnected = (() => {
    const raw = String(
      scannerInfo?.status ||
      scannerInfo?.scannerStatus ||
      scannerInfo?.connectionStatus ||
      ""
    ).trim().toUpperCase();
    if (["ONLINE", "CONNECTED", "ACTIVE", "OK"].includes(raw)) return true;
    if (["OFFLINE", "DISCONNECTED", "ERROR", "DOWN"].includes(raw)) return false;
    if (typeof scannerInfo?.connected === "boolean") return scannerInfo.connected;
    if (typeof scannerInfo?.isOnline === "boolean") return scannerInfo.isOnline;
    return false;
  })();
  const plcOnline = !["COMM", "BLOCKED"].includes(String(liveOperationState || "").trim().toUpperCase());
  const plcReadingPreview = popup?.leakTestReading || popup?.plcReading || popup?.plcReadings || null;

  const reasonUpper = String(popup?.reason || popup?.qrReason || "").trim().toUpperCase();
  const needsResetByReason = ["DUPLICATE_SCAN", "RESET_REQUIRED_AFTER_PLC_COMM_ERROR"].some(r => reasonUpper.startsWith(r)) || reasonUpper.startsWith("PLC_TIMEOUT");
  const canReset = (liveOperationState === "COMM" || liveOperationState === "FAIL" || needsResetByReason) && Boolean(partId) && Boolean(stationNo) && typeof onResetOperation === "function";
  const popupTypeUpper = String(popup?.type || "").trim().toUpperCase();
  const popupStatusUpper = String(popup?.status || popup?.plcStatus || "").trim().toUpperCase();
  const qrVisualState = (() => {
    if (localScanDecision === "PASS") return "PASS";
    if (["FAIL", "NG", "BLOCK", "DUPLICATE", "ERROR", "WARNING"].includes(localScanDecision)) return "FAIL";
    if (liveQrState === "PASS" || liveQrState === "FAIL" || liveQrState === "DUPLICATE" || liveQrState === "BLOCKED") {
      return liveQrState;
    }
    if (duplicateLike) return "DUPLICATE";
    if (
      popupTypeUpper === "ERROR" ||
      liveOperationState === "FAIL" ||
      liveOperationState === "COMM" ||
      popupStatusUpper === "BLOCKED" ||
      popupStatusUpper === "INTERLOCKED"
    ) {
      return "FAIL";
    }
    if (popupTypeUpper === "SUCCESS" || liveOperationState === "PASS" || popupStatusUpper === "ENDED_OK") {
      return "PASS";
    }
    return "WAIT";
  })();

  const qrStripTheme =
    qrVisualState === "PASS"
      ? {
          container: "bg-emerald-900/80 border-emerald-400/60 ring-1 ring-emerald-400/20",
          label: "text-emerald-200",
          value: "text-emerald-300",
          badge: "bg-emerald-500/30 text-emerald-100 border-emerald-300/40",
          badgeText: "QR PASS",
        }
      : qrVisualState === "FAIL" || qrVisualState === "BLOCKED"
        ? {
            container: "bg-rose-900/80 border-rose-400/60 ring-1 ring-rose-400/20",
            label: "text-white",
            value: "text-white",
            badge: "bg-rose-400/30 text-rose-100 border-rose-300/40",
            badgeText: "QR FAIL",
          }
        : qrVisualState === "DUPLICATE"
          ? {
              container: "bg-sky-900/40 border-sky-400/60 ring-1 ring-sky-400/20",
              label: "text-black",
              value: "text-black",
              badge: "bg-sky-500/30 text-sky-100 border-sky-300/40",
              badgeText: "DUPLICATE",
            }
          : {
              container: "bg-slate-900 border-slate-500/60",
              label: "text-slate-400",
              value: "text-black",
              badge: "bg-slate-700/40 text-slate-300 border-slate-500/40",
              badgeText: "QR WAIT",
            };

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
                <h3 className="text-white text-sm font-bold">Part Journey</h3>
                <p className="text-amber-400 text-[9px] font-medium uppercase">Traceability</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {effectivePartId && (
                <div className="px-3 py-2 rounded-lg border border-amber-500/20 max-w-[420px] min-w-[180px]" style={{ background: "#0f172a" }} title={effectivePartId}>
                  <p className="font-mono text-xs font-black text-amber-400 break-all leading-tight">{effectivePartId}</p>
                </div>
              )}
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                title={isFullscreen ? "Minimize" : "Maximize Screen"}
                className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 text-black hover:text-white transition-colors"
                style={{ background: "#f59e0b" }}
              >
                {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
              {typeof onClose === "function" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose?.();
                  }}
                  aria-label="Close popup"
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-rose-500 transition-colors"
                  style={{ background: "#dc2626" }}
                >
                  <X size={14} className="text-white" />
                </button>
              )}
            </div>
          </div>

          {/* Compact Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <div className="rounded-lg p-2" style={{ background: "#0f172a" }}>
              <p className="text-amber-400 text-[9px] font-medium uppercase mb-0.5">Machine</p>
              <p className="text-white text-m font-bold truncate">{popup?.machineName || "N/A"}</p>
            </div>
            <div className="rounded-lg p-2" style={{ background: "#0f172a" }}>
              <p className="text-amber-400 text-[9px] font-medium uppercase mb-0.5">Station</p>
              <p className="text-white text-m font-bold truncate">{currentStationName}</p>
            </div>
            <div className="rounded-lg p-2" style={{ background: "#0f172a" }}>
              <p className="text-amber-400 text-[9px] font-medium uppercase mb-0.5">Shift</p>
              <p className="text-white text-m font-bold">{shiftText}</p>
            </div>
            <div className="rounded-lg p-2" style={allPassed ? { background: "#064e3b" } : { background: "#0f172a" }}>
              <p className="text-amber-400 text-[9px] font-medium uppercase mb-0.5" >Pass</p>
              <p className="text-m font-bold" style={{ color: allPassed ? "#4ade80" : "#fff" }}>{passCount}/{totalCount}</p>
            </div>
          </div>

          {(autoCloseTimeLeft !== null && autoCloseDuration > 0) && (
            <div className="mt-3 rounded-md overflow-hidden border border-slate-700/70">
              <div className="relative w-full h-2 bg-slate-900">
                <div
                  className={`absolute inset-y-0 left-0 h-full transition-all duration-300 ease-out ${stickyErrorMode || validationError || popup.type === "ERROR" || liveQrState === "FAIL" || liveOperationState === "FAIL" || liveOperationState === "COMM"
                      ? "bg-gradient-to-r from-rose-700 to-rose-500"
                      : popup.type === "WARNING" || liveQrState === "DUPLICATE" || liveQrState === "BLOCKED"
                        ? "bg-gradient-to-r from-amber-600 to-amber-400"
                        : "bg-gradient-to-r from-emerald-600 to-emerald-400"
                    }`}
                  style={{ width: `${(autoCloseTimeLeft / autoCloseDuration) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Timeline Body - Single source of truth */}
        <div className="flex-1 overflow-y-auto px-5 py-3 bg-bg-card font-medium">
          {effectivePartId && !isNextPartState && (
            <div className={`mb-2 px-3 py-2 rounded-lg border shadow-sm flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 ${qrStripTheme.container}`}>
              <span className={`text-[15px] font-bold uppercase tracking-wider whitespace-nowrap ${qrStripTheme.label}`}>
                Scanned QR
              </span>
              <div className="flex-1 min-w-0 text-center overflow-hidden">
                <span className={`font-bold text-m tracking-wide text-black break-all sm:truncate ${qrStripTheme.value}`}>
                  {effectivePartId}
                </span>
              </div>
              <span className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-[15px] font-bold border whitespace-nowrap ${qrStripTheme.badge}`}>
                {qrStripTheme.badgeText}
              </span>
            </div>
          )}

          {plcReadingPreview && (
            <div className="mb-3 rounded-lg border border-sky-500/30 bg-sky-950/20 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold text-sky-200 uppercase tracking-widest">{t("globalPopup.plcReading", "PLC Reading")}</p>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${plcOnline ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"}`}>
                  {plcOnline ? t("operatorView.online", "Online") : t("operatorView.offline", "Offline")}
                </span>
              </div>
              <pre className="text-[11px] text-slate-100 bg-slate-900/70 rounded-md p-2 overflow-auto max-h-36">
                {JSON.stringify(plcReadingPreview, null, 2)}
              </pre>
            </div>
          )}

          {effectivePartId && (
            <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className={`rounded-lg border p-3 ${
                previousStation ? (previousStationPassed ? "border-emerald-500/40 bg-emerald-950/25" : "border-rose-500/40 bg-rose-950/20") : "border-slate-700 bg-slate-900/60"
              }`}>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t("globalPopup.previousStation", "Previous Station")}</p>
                {previousStation ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-100">{previousStation.stationName || previousStation.stationNo || "-"}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${previousStationPassed ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"}`}>
                        {previousStationPassed ? t("globalPopup.passed", "PASSED") : t("globalPopup.notPassed", "NOT PASSED")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400">QR:</span>
                      <StatusBadge status={previousStation.qrVerification || "WAIT"} />
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400">Operation:</span>
                      <StatusBadge status={previousStation.operation || "WAIT"} />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-slate-400">{t("operatorView.noPreviousStation", "No previous station (first operation).")}</p>
                )}
              </div>

              <div className={`rounded-lg border p-3 ${
                currentStationPassed ? "border-emerald-500/40 bg-emerald-950/20" : "border-sky-500/40 bg-sky-950/20"
              }`}>
                <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mb-2">{t("globalPopup.currentStation", "Current Station")}</p>
                {currentStationCard ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-100">{currentStationCard.stationName || currentStationCard.stationNo || currentStationName}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${currentStationPassed ? "bg-emerald-500/20 text-emerald-200" : "bg-sky-500/20 text-sky-200"}`}>
                        {currentStationPassed ? t("globalPopup.passed", "PASSED") : t("globalPopup.inProcess", "IN PROCESS")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400">QR:</span>
                      <StatusBadge status={liveQrState || currentStationCard.qrVerification || "WAIT"} />
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400">Operation:</span>
                      <StatusBadge status={liveOperationState || currentStationCard.operation || "WAIT"} />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-slate-400">{t("operatorView.waitingStationData", "Waiting for station data.")}</p>
                )}
              </div>
            </div>
          )}

          {/* QR Input: visible in simulation/USB/manual scan modes */}
          {showScanInputPanel && (
            <div className="w-full bg-slate-900/80 border border-slate-700/80 rounded-xl p-5 space-y-4 mb-5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                {t("operatorView.scanManualInput", "Scan / Manual QR Input")}
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  ref={scanInputRef}
                  type="text"
                  value={manualQrCode}
                  onChange={(e) => setManualQrCode(e.target.value)}
                  placeholder={t("globalPopup.manualQrPlaceholder", "e.g., PART-K12-998877")}
                  inputMode={isUsbScannerMode ? "none" : "text"}
                  readOnly={isUsbScannerMode}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-600 rounded-lg px-4 py-2 font-bold text-sm text-slate-400 placeholder:text-slate-400 outline-none focus:border-amber-500 transition-colors font-mono"
                  style={{ caretColor: isUsbScannerMode ? "transparent" : undefined }}
                  tabIndex={isUsbScannerMode ? -1 : 0}
                  onFocus={() => {}}
                  onPointerDown={(e) => {
                    if (isUsbScannerMode) {
                      e.preventDefault();
                    }
                  }}
                  onTouchStart={(e) => {
                    if (isUsbScannerMode) {
                      e.preventDefault();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleValidateQr();
                  }}
                />
                <button
                  type="button"
                  onClick={handleValidateQr}
                  disabled={validatingQr || !manualQrCode.trim() || scanLocked}
                  className="w-full sm:w-auto justify-center bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold px-5 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                  {validatingQr ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    t("operatorView.validate", "Validate")
                  )}
                </button>
              </div>
            </div>
          )}
          {showJourney && displayStations.length > 0 ? (
            <div>
              {displayStations.map((station, idx) => (
                <StationCard
                  key={station.stationNo || `station-${idx}`}
                  station={station}
                  isLast={idx === displayStations.length - 1}
                  isCurrentStation={String(station.stationNo || "").trim().toUpperCase() === targetStationKey}
                />
              ))}
            </div>
          ) : showJourney ? (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted space-y-4">
              <StationIcon />
              <div className="text-center">
                <p className="text-sm font-bold text-white">{t("globalPopup.waiting", "Waiting")}</p>
                <p className="text-xs text-text-muted mt-1">{t("globalPopup.timelineAfterFirstScan", "Timeline appears after first scan")}</p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Message & Footer */}
        <div className="px-5 py-3 bg-bg-card border-t border-border/50 flex-shrink-0 space-y-3">
          {showManualVerificationPanel && (
            <div className="rounded-xl border-2 border-slate-600 bg-slate-800/90 p-5 space-y-5 shadow-xl mb-3" style={{ backdropFilter: "blur(4px)" }}>
              <div className="flex items-center gap-2 border-b border-slate-700/60 pb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                <h3 className="text-white text-sm font-extrabold uppercase tracking-wider">{t("globalPopup.submitQualityVerification", "Manual Quality Inspection")}</h3>
              </div>

              <div className="flex flex-col sm:flex-row gap-5">
                <button
                  type="button"
                  onClick={() => {
                    setManualSelection("OK");
                    setManualReason("");
                    setManualReasonQuery("");
                  }}
                  className={`flex-1 flex flex-col items-center justify-center p-5 rounded-xl border-3 transition-all duration-200 active:scale-[0.98] ${manualSelection === "OK"
                    ? "bg-emerald-600 border-emerald-300 text-white shadow-lg shadow-emerald-500/40 scale-[1.04]"
                    : "bg-slate-900 border-slate-700 text-emerald-500 hover:border-emerald-500 hover:bg-slate-800"
                    }`}
                >
                  <CheckCircle size={28} className={manualSelection === "OK" ? "text-white animate-bounce" : "text-emerald-500"} />
                  <span className="mt-2 text-base font-black uppercase tracking-wider">{t("common.ok", "OK")} ({t("operatorView.pass", "Pass")})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setManualSelection("NG");
                    setManualReason("");
                    setManualReasonQuery("");
                    setManualReasonCategory("");
                    setShowReasonDropdown(false);
                  }}
                  className={`flex-1 flex flex-col items-center justify-center p-5 rounded-xl border-3 transition-all duration-200 active:scale-[0.98] ${manualSelection === "NG"
                    ? "bg-rose-600 border-rose-300 text-white shadow-lg shadow-rose-500/40 scale-[1.04]"
                    : "bg-slate-900 border-slate-700 text-rose-500 hover:border-rose-500 hover:bg-slate-800"
                    }`}
                >
                  <AlertTriangle size={28} className={manualSelection === "NG" ? "text-white animate-bounce" : "text-rose-500"} />
                  <span className="mt-2 text-base font-black uppercase tracking-wider">{t("common.ng", "NG")} ({t("operatorView.fail", "Fail")})</span>
                </button>
              </div>

              {manualSelection === "NG" && (
                <div className="space-y-2 animate-in slide-in-from-top-2 duration-150">
                  <label className="text-xs font-bold text-white uppercase tracking-wide">{t("faq.rejectionTab", "Rejection Categories")}</label>
                  <div className="flex flex-wrap gap-2">
                    {NG_REASON_CATEGORIES.map((category) => {
                      const selected = manualReasonCategory === category.key;
                      return (
                        <button
                          key={category.key}
                          type="button"
                          onClick={() => {
                            setManualReasonCategory(category.key);
                            setManualReason("");
                            setManualReasonQuery("");
                            setShowReasonDropdown(true);
                          }}
                          className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition-colors ${
                            selected
                              ? "bg-rose-500 text-white border-rose-300"
                              : "bg-slate-900 text-slate-200 border-slate-600 hover:border-rose-400"
                          }`}
                        >
                          {category.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="relative" ref={reasonDropdownRef}>
                    <input
                      type="text"
                      value={manualReasonQuery}
                      onChange={(e) => {
                        setManualReasonQuery(e.target.value);
                        setManualReason("");
                        setShowReasonDropdown(true);
                      }}
                      placeholder={manualReasonCategory ? t("globalPopup.searchOrSelectReason", "Search or select rejection reason") : t("globalPopup.searchReasonOrSelectCategory", "Search reason or select category")}
                      className="w-full bg-white border-2 border-slate-500 rounded-xl py-3 px-4 text-sm text-black outline-none focus:border-rose-500 transition-colors font-semibold"
                      onFocus={() => {
                        setShowReasonDropdown(true);
                      }}
                      onClick={() => {
                        setShowReasonDropdown(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setShowReasonDropdown(false);
                        }
                      }}
                    />
                    {showReasonDropdown && (
                      <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-slate-300 bg-white shadow-xl">
                        {filteredNgReasonOptions.length === 0 ? (
                          <div className="px-3 py-2 text-xs font-semibold text-slate-500">
                            {t("globalPopup.noReasonFound", "No reason found")}
                          </div>
                        ) : (
                          filteredNgReasonOptions.map((reason) => (
                            <button
                              key={reason}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setManualReason(reason);
                                setManualReasonQuery(reason);
                                setShowReasonDropdown(false);
                              }}
                              className={`w-full px-3 py-2 text-left text-sm font-semibold border-b border-slate-200 last:border-b-0 transition-colors ${
                                manualReason === reason ? "bg-rose-100 text-rose-700" : "text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              {reason}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  {!isValidNgReason && (
                    <p className="text-[11px] font-semibold text-rose-300">
                      {t("globalPopup.selectReasonFromList", "Select a reason from the dropdown list.")}
                    </p>
                  )}
                </div>
              )}

              {manualSuccessMsg && (
                <p className="text-sm font-bold text-emerald-400 text-center">{manualSuccessMsg}</p>
              )}

              <button
                type="button"
                onClick={handleSubmitManualResult}
                disabled={submittingManual || !manualSelection || (manualSelection === "NG" && (!manualReason || !isValidNgReason))}
                className={`w-full py-4 rounded-xl text-base font-black uppercase tracking-widest text-white transition-all duration-200 ${submittingManual || !manualSelection || (manualSelection === "NG" && (!manualReason || !isValidNgReason))
                  ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed opacity-60"
                  : manualSelection === "OK"
                    ? "bg-emerald-500 hover:bg-emerald-400 border-2 border-emerald-300 shadow-lg shadow-emerald-500/30 active:scale-[0.98] text-slate-950 font-black"
                    : "bg-emerald-500 hover:bg-emerald-400 border-2 border-emerald-300 shadow-lg shadow-rose-500/30 active:scale-[0.98] text-white font-black"
                  }`}
              >
                {submittingManual ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw size={18} className="animate-spin" />
                    {t("globalPopup.submittingResult", "Submitting Result...")}
                  </span>
                ) : (
                  t("globalPopup.submitQualityVerification", "Submit Quality Verification")
                )}
              </button>
            </div>
          )}

          {(validationError || validationInfo || popup.message) && (
            <div className={`p-3 rounded-xl border-2 flex gap-2 items-start text-sm transition-colors duration-300 ${validationError ? "bg-danger/15 border-danger/30 text-danger" : !duplicateLike && (liveOperationState === "FAIL" || liveQrState === "FAIL" || popup.type === "ERROR" || popup.gate === "FORMAT" || popup.gate === "PLC_MATCH") ? "bg-danger/15 border-danger/30 text-danger" :
              liveOperationState === "COMM" || popup.type === "WARNING" || popup.reason === "PREVIOUS_STATION_NOT_COMPLETED" ? "bg-warning/15 border-warning/30 text-warning" :
                popup.type === "SUCCESS" || popup.type === "INFO" ? "bg-success/20 border-success/40 text-success" :
                  "bg-bg-elevated/40 border-border/40 text-text-muted"
              }`}>
              {(validationInfo || popup.type === "SUCCESS" || popup.type === "INFO" || duplicateLike) && !validationError ? (
                <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium">{validationError || validationInfo || (localScanDecision ? "" : friendlyErrorMessage(popup.message, popup))}</p>
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
                {t("globalPopup.confirmResetQuestion", "Reset operation for part")} <span className="font-mono">{partId}</span> at {stationNo}?
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={() => setShowResetConfirm(false)} className="flex-1 rounded-xl border border-red-300 bg-white py-2 text-sm font-bold text-red-700 hover:bg-red-50">
                  {t("globalPopup.cancel", "Cancel")}
                </button>
                <button onClick={handleReset} disabled={isResetting} className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-bold text-white hover:bg-red-700">
                  {isResetting ? "..." : t("globalPopup.confirm", "Confirm")}
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-4 mt-2">
            {allowBottomClose && (showAcknowledge || typeof onClose === "function") && (
              <button
                onClick={onClose}
                className="flex-1 bg-slate-400 hover:bg-slate-600 active:scale-[0.98] text-white font-black py-4 px-6 rounded-xl text-sm uppercase tracking-widest border-2 border-slate-600 shadow-lg transition-all duration-150"
              >
                {t("globalPopup.close", "Close")}
              </button>
            )}
            {canReset && !showResetConfirm && (
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={isResetting}
                className="flex-1 bg-rose-600 hover:bg-rose-500 active:scale-[0.98] text-white font-black py-4 px-6 rounded-xl text-sm uppercase tracking-widest border-2 border-rose-500 shadow-lg shadow-rose-600/40 flex items-center justify-center gap-2 transition-all duration-150"
              >
                <RefreshCw size={16} className={isResetting ? "animate-spin" : ""} />
                {isResetting ? "..." : t("globalPopup.resetOperation", "RESET OPERATION")}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default React.memo(GlobalPopup);



