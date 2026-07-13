// UPGRADE COMPLETE - GlobalPopup (v4.2 - Tablet-Optimized Layout)
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
import { rejectionConfigApi, stationSettingsApi, traceabilityApi } from "../api/services";
import { normalizeScanResponse } from "../utils/scanResponse";
import { useLanguage } from "../context/LanguageContext";


const StationIcon = React.memo(() => (
  <MapPin size={32} className="opacity-40 text-amber-500 animate-bounce" />
));

function sanitizeScannerCode(value) {
  const raw = String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const invalidTokens = new Set([
    "ERROR",
    "ERR",
    "FAILED",
    "FAIL",
    "NG",
    "WAIT",
    "WAITING",
    "PENDING",
    "IN_PROGRESS",
    "RUNNING",
    "PLC_COMM_ERROR",
    "COMM_ERROR",
    "TIMEOUT",
    "NULL",
    "UNDEFINED",
  ]);
  return invalidTokens.has(raw.toUpperCase()) ? "" : raw;
}
const LEAK_TEST_PREVIEW_FIELDS = [
  ["Machine Name", "Machine"],
  ["Part QR", "Part_QR_Code"],
  ["Result", "Result"],
  ["Body Leak Value", "Body_Leak_Value"],
  ["Gall_1", "Gall_1"],
  ["Gall_2", "Gall_2"],
  ["Cycle Time", "Cycle_Time"],
  ["Running Mode", "Running_Mode"],
  ["Manual", "Manual"],
  ["Dry", "Dry"],
  ["Wey", "Wey"],
  ["Both", "Both"],
];
function formatLeakPreviewValue(reading, key) {
  if (!reading) return "—";
  if (key === "Machine") return reading.Machine || reading.machineName || reading.matchedMachineName || "—";
  if (key === "Cycle_End_Time") {
    const raw = reading.Cycle_End_Time || reading.cycleEndTime || "";
    if (!raw) return "—";
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? String(raw) : parsed.toLocaleString("en-IN");
  }
  const value = reading[key];
  return value === undefined || value === null || value === "" ? "—" : String(value);
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

const ACTIVE_REJECTION_PART_NAME = "OIL PAN K-12";

const getNgZoneGridShape = (zoneCount = 0) => {
  if (zoneCount <= 3) {
    return { columns: Math.max(1, zoneCount), rows: 1 };
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(zoneCount || 1)));
  const rows = Math.max(1, Math.ceil((zoneCount || 1) / columns));
  return { columns, rows };
};

const NG_ZONE_LABEL_STYLES = [
  "border-cyan-500 bg-cyan-100 text-slate-950",
  "border-violet-500 bg-violet-100 text-slate-950",
  "border-emerald-500 bg-emerald-100 text-slate-950",
  "border-rose-500 bg-rose-100 text-slate-950",
  "border-sky-500 bg-sky-100 text-slate-950",
  "border-lime-600 bg-lime-100 text-slate-950",
];

const NG_ZONE_OVERLAY_STYLES = [
  "border-cyan-500/80 bg-cyan-400/15 hover:bg-cyan-400/25",
  "border-violet-500/80 bg-violet-400/15 hover:bg-violet-400/25",
  "border-emerald-500/80 bg-emerald-400/15 hover:bg-emerald-400/25",
  "border-rose-500/80 bg-rose-400/15 hover:bg-rose-400/25",
  "border-sky-500/80 bg-sky-400/15 hover:bg-sky-400/25",
  "border-lime-600/80 bg-lime-400/15 hover:bg-lime-400/25",
];

function getEnabledNgCategories(features = {}) {
  return NG_REASON_CATEGORIES.filter((category) => {
    if (category.key === "CR") return features.rejectionCategoryCR !== false;
    if (category.key === "CRAM") return features.rejectionCategoryCRAM !== false;
    if (category.key === "MR") return features.rejectionCategoryMR !== false;
    return true;
  });
}

function isNgCategoryEnabled(category = {}, features = {}) {
  const code = String(category.key || category.code || "").trim().toUpperCase();
  if (code === "CR") return features.rejectionCategoryCR !== false;
  if (code === "CRAM") return features.rejectionCategoryCRAM !== false;
  if (code === "MR") return features.rejectionCategoryMR !== false;
  return true;
}

function getNgCategoryDisplayName(category = {}) {
  return String(category.name || category.label || category.code || category.key || "")
    .replace(/^\s*([A-Z0-9_]+)\s*-\s*\1\s*$/i, "$1")
    .trim();
}

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
  if (["PASSED", "PASS", "ENDED_OK", "COMPLETED", "COMPLETED_OK"].includes(raw)) return "PASS";
  if (["COMPLETED_NG"].includes(raw)) return "FAIL";
  if (["FAILED", "FAIL", "ENDED_NG", "NG"].includes(raw)) return "FAIL";
  if (["RUNNING", "STARTED", "IN_PROGRESS", "IN PROCESS"].includes(raw)) return "RUN";
  if (["WAITING_CUSTOMER_QR", "CUSTOMER_QR_PENDING"].includes(raw)) return "RUN";
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

function getJourneyStationDisplayState(station = {}, features = {}) {
  const attempts = Array.isArray(station.attempts) ? station.attempts : [];
  const bypassed =
    Boolean(station.isBypassed || station.is_bypassed || station.bypassed) ||
    attempts.some((attempt) => attempt?.isBypassed === true);
  if (bypassed) return "PASS";

  const stageState = String(station.stageState || station.status || station.latestStatus || "").trim().toUpperCase();
  const qrState = String(station.qrVerification || station.qrStatus || "").trim().toUpperCase();
  const operationState = String(station.operation || station.qualityCheck || "").trim().toUpperCase();
  const passLike = ["PASS", "PASSED", "COMPLETED", "COMPLETED_OK", "ENDED_OK"];
  const failLike = ["FAIL", "FAILED", "NG", "COMPLETED_NG", "ENDED_NG", "COMM", "COMM_ERROR", "PLC_COMM_ERROR", "TIMEOUT", "PLC_TIMEOUT"];

  if (failLike.includes(operationState) || failLike.includes(stageState) || ["FAIL", "FAILED", "NG", "BLOCK", "REJECT", "INVALID"].includes(qrState)) {
    return "FAIL";
  }
  if (passLike.includes(operationState) || passLike.includes(stageState)) return "PASS";

  // Match Component Journey: automatic stations are complete once QR passed
  // and there is no recorded failure. Manual-result stations still require an operation result.
  if (features.manualResult !== true && ["PASS", "PASSED", "ALLOW", "OK", "ACCEPT", "VALID"].includes(qrState)) {
    return "PASS";
  }
  return operationState || stageState || "WAIT";
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
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] md:text-[11px] font-bold ${theme.bg} ${theme.text}`}>
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
    <div className="flex gap-2.5 group">
      <div className="flex flex-col items-center">
        <div className={`w-2.5 h-2.5 rounded-full mt-4 ${dotClass}`} />
        {!isLast && <div className="w-px flex-1 bg-border/40 my-0.5 min-h-[16px]" />}
      </div>
      <div className={`flex-1 rounded-xl border p-3 md:p-4 mb-3 transition-all ${cardClass}`}>
        <div className="flex justify-between items-center flex-wrap gap-1 mb-2">
          <div className="flex items-center gap-2">
            <h3 className={`text-xs md:text-sm font-bold ${titleColor}`}>
              {station.stationName || station.stationNo}
            </h3>
            {(isInProgress || isLiveCurrent) && (
              <span className="px-1.5 py-0.5 rounded-full bg-primary text-white text-[8px] font-bold uppercase">{t("globalPopup.current", "Current")}</span>
            )}
          </div>
          {dateObj && <span className="text-[9px] text-text-muted">{timeStr}</span>}
        </div>

        {!isPending && (
          <div className="flex flex-wrap gap-1.5 md:gap-2">
            {station.features?.qr && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded-lg px-2 py-1.5 min-w-[80px] md:min-w-[96px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.qr", "QR")}</span>
                <StatusBadge status={station.qrVerification || "WAIT"} />
              </div>
            )}
            {station.features?.operation && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded-lg px-2 py-1.5 min-w-[80px] md:min-w-[96px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.operation", "Op")}</span>
                <StatusBadge status={station.operation || "WAIT"} />
              </div>
            )}
            {station.features?.qualityCheck && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded-lg px-2 py-1.5 min-w-[80px] md:min-w-[96px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.qc", "QC")}</span>
                <StatusBadge status={station.qualityCheck || "WAIT"} />
              </div>
            )}
            {(station.features?.manualResult || station.features?.camera || station.features?.torque) && !station.features?.qualityCheck && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded-lg px-2 py-1.5 min-w-[80px] md:min-w-[96px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.qcValue", "QC Val")}</span>
                <StatusBadge status={station.qualityCheck || "WAIT"} />
              </div>
            )}
            {station.features?.rejectionBin && (
              <div className="flex items-center justify-between gap-1 bg-white/5 rounded-lg px-2 py-1.5 min-w-[80px] md:min-w-[96px]">
                <span className="text-[9px] font-medium text-text-muted uppercase">{t("globalPopup.rejectionShort", "Rej")}</span>
                <StatusBadge status={station.rejectionConfirmation || "PENDING"} />
              </div>
            )}
          </div>
        )}

        {/* Show NG Reason if available */}
        {(station.reason || station.remarks) && (isFailed || station.qualityCheck === "FAIL" || station.operation === "FAIL") && (
          <div className="mt-2 px-2.5 py-1.5 bg-danger/10 border border-danger/20 rounded-lg">
            <span className="text-[9px] font-bold text-danger uppercase tracking-wider">{t("globalPopup.defectReason", "Defect Reason:")}</span>
            <p className="text-[11px] md:text-xs font-semibold text-danger/90 mt-0.5">{station.reason || station.remarks}</p>
          </div>
        )}
      </div>
    </div>
  );
};

const InfoRow = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 md:px-3.5 md:py-2.5">
    <span className="text-[11px] md:text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

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

  if (reason === "NO_SHOT_NUMBER" || msgUpper.includes("NO_SHOT_NUMBER") || msgUpper.includes("COULD NOT EXTRACT SHOT")) {
    return `[SHOT DETAILS INVALID] Shot number could not be extracted from ${partId || "the scanned QR"}. Verify the QR format and scan again.`;
  }
  if (
    reason === "PART_NOT_FOUND" ||
    reason === "PLC_RECORD_NOT_FOUND" ||
    msgUpper.includes("PART NOT FOUND") ||
    msgUpper.includes("NOT FOUND IN MOULDING") ||
    msgUpper.includes("PLCCYCLEREADINGS")
  ) {
    return "Part not found. Shot details are not available.";
  }
  if (reason === "INVALID_QR_FORMAT" || msgUpper.includes("INVALID_QR_FORMAT") || msgUpper.includes("QR FORMAT MISMATCH")) {
    return `[QR FORMAT MISMATCH] Invalid QR format. Scan correct component code.`;
  }
  if (reason === "PREVIOUS_STATION_NOT_COMPLETED" || msgUpper.includes("PREVIOUS_STATION_NOT_COMPLETED")) {
    const expected = String(popup?.expectedStation || "").trim().toUpperCase();
    const lastCompleted = String(popup?.lastCompletedStation || popup?.last_completed_station || "").trim().toUpperCase();
    if (msg && !msgUpper.includes("PREVIOUS_STATION_NOT_COMPLETED")) return msg;
    return expected && lastCompleted
      ? `Wrong station. Scan ${expected} first. Last OK: ${lastCompleted}.`
      : expected
      ? `Wrong station. Scan ${expected} first.`
      : `Wrong station. Previous OP not completed.`;
  }
  if (["DUPLICATE_SCAN", "ALREADY_COMPLETED", "DUPLICATE_SCAN_IN_FLIGHT"].includes(reason) || msgUpper.includes("DUPLICATE_SCAN") || msgUpper.includes("ALREADY_COMPLETED")) {
    return msg || `Already passed at ${station || "this OP"}. Scan next operation.`;
  }
  if (reason === "SCAN_RESULT_NG" || msgUpper.includes("SCAN_RESULT_NG")) {
    return `[PART NG] This part is marked NG. Move to rejection flow.`;
  }
  if (reason === "STATION_NOT_CONFIGURED" || reason === "STATION_NOT_FOUND" || msgUpper.includes("STATION NOT FOUND")) {
    return `[STATION NOT CONFIGURED] Station ${station || "selected station"} is not in active route configuration.`;
  }

  if (msgUpper.includes("DUPLICATE") || msgUpper.includes("ALREADY_COMPLETED") || msgUpper.includes("ALREADY COMPLETED")) {
    return msg || `Already passed at ${station || "this OP"}. Scan next operation.`;
  }

  if (msgUpper.includes("PREVIOUS_STATION") || msgUpper.includes("SEQUENCE")) {
    const expected = String(popup?.expectedStation || "").trim().toUpperCase();
    const lastCompleted = String(popup?.lastCompletedStation || popup?.last_completed_station || "").trim().toUpperCase();
    if (msg && !msgUpper.includes("PREVIOUS_STATION")) return msg;
    if (expected && lastCompleted) return `Wrong station. Scan ${expected} first. Last OK: ${lastCompleted}.`;
    if (expected) return `Wrong station. Scan ${expected} first.`;
    return "Wrong station. Previous OP not completed.";
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
  const [isClosingSmoothly, setIsClosingSmoothly] = useState(false);

  const [manualSelection, setManualSelection] = useState(null); // 'OK' or 'NG'
  const [manualReason, setManualReason] = useState("");
  const [manualReasonQuery, setManualReasonQuery] = useState("");
  const [manualReasonCategory, setManualReasonCategory] = useState("");
  const [manualRejectionView, setManualRejectionView] = useState(null);
  const [manualRejectionZone, setManualRejectionZone] = useState(null);
  const [manualRejectionSubZone, setManualRejectionSubZone] = useState(null);
  const [manualRejectionRemark, setManualRejectionRemark] = useState("");
  const [dynamicRejectionConfig, setDynamicRejectionConfig] = useState(null);
  const [loadingRejectionConfig, setLoadingRejectionConfig] = useState(false);
  const [showReasonDropdown, setShowReasonDropdown] = useState(false);
  const [showNgReasonModal, setShowNgReasonModal] = useState(false);
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

  const closeSmoothly = (delayMs = 220) => {
    setIsClosingSmoothly(true);
    window.setTimeout(() => {
      setIsFullscreen(false);
      setShowNgReasonModal(false);
      setIsClosingSmoothly(false);
      onClose?.();
    }, delayMs);
  };

  const validateQrCode = async (rawCode) => {
    const scannedCode = sanitizeScannerCode(rawCode);
    if (!scannedCode) {
      setValidationInfo("");
      setValidationError("Please scan or enter QR code.");
      return;
    }
    if (scannedCode.length < 4) {
      setValidationInfo("");
      setValidationError("Invalid QR code. Scan a valid Part ID / Customer QR.");
      setLocalQrValidated(false);
      localValidatedPartIdRef.current = "";
      setLastScannedCode("");
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
      setManualRejectionView(null);
      setManualRejectionZone(null);
      setManualRejectionSubZone(null);
      setManualRejectionRemark("");
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
  const stationNo = String(popup?.stationNo || popup?.station_no || activeStation || "").trim();

  // Reset manual state only when station changes (not on partId change — that would wipe localQrValidated)
  useEffect(() => {
    setResetError("");
    setIsResetting(false);
    setShowResetConfirm(false);
    setManualSelection(null);
    setManualReason("");
    setManualReasonQuery("");
    setManualReasonCategory("");
    setManualRejectionView(null);
    setManualRejectionZone(null);
      setManualRejectionSubZone(null);
    setManualRejectionRemark("");
    setShowReasonDropdown(false);
    setShowNgReasonModal(false);
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
  const customerQrCode = sanitizeScannerCode(popup?.customerQrCode || popup?.customer_qr || "");
  const mappedPartId = sanitizeScannerCode(popup?.mappedPartId || popup?.mapped_part_id || popup?.dotPinPartId || popup?.dot_pin_part_id || "");
  const scannedQr = sanitizeScannerCode(popup?.scannedQr || popup?.displayQr || popup?.rawQr || popup?.customerQrCode || popup?.customer_qr || lastScannedCode || popup?.partId || popup?.part_id);
  const qrFormatName = String(popup?.qrFormatName || popup?.qr_format_name || "").trim().toUpperCase();
  const popupReason = String(popup?.reason || "").trim().toUpperCase();
  const reasonUpper = String(popup?.reason || popup?.qrReason || "").trim().toUpperCase();
  const customerQrPending = Boolean(
    popup?.customerQrPending ||
    reasonUpper === "WAITING_CUSTOMER_QR" ||
    String(popup?.operationStatus || popup?.plcStatus || "").trim().toUpperCase() === "WAITING_CUSTOMER_QR"
  );
  const customerQrMapped = Boolean(
    popup?.customerQrMapped ||
    reasonUpper === "CUSTOMER_QR_MAPPED" ||
    reasonUpper === "CUSTOMER_QR_ONLY_STARTED"
  );
  const popupTypeUpper = String(popup?.type || "").trim().toUpperCase();
  const popupStatusUpper = String(popup?.status || popup?.plcStatus || "").trim().toUpperCase();
  const mappedPartDiffersFromCustomerQr =
    Boolean(mappedPartId && customerQrCode) &&
    mappedPartId.toUpperCase() !== customerQrCode.toUpperCase();
  const isCustomerQrOnlyScan =
    qrFormatName === "CUSTOMER_QR_ONLY" ||
    Boolean(customerQrCode && partId && customerQrCode.toUpperCase() === partId.toUpperCase() && !mappedPartDiffersFromCustomerQr);
  const hasMappedCustomerQr =
    Boolean(customerQrCode) &&
    (
      mappedPartDiffersFromCustomerQr ||
      isCustomerQrOnlyScan ||
      customerQrCode.toUpperCase() !== String(partId || effectivePartId || "").trim().toUpperCase() ||
      popupReason === "CUSTOMER_QR_MAPPED"
    );
  const displayedScanCode = customerQrCode || scannedQr || effectivePartId || lastScannedCode;
  const displayInternalPartId = mappedPartId || effectivePartId || customerQrCode || displayedScanCode || "-";
  const displayedScanLabel = customerQrCode ? "Scanned Customer QR" : (scannedQr ? "Scanned QR" : "Scanned Part ID");

  useEffect(() => {
    let isActive = true;
    setLoadingRejectionConfig(true);
    rejectionConfigApi.operatorConfig({ partName: ACTIVE_REJECTION_PART_NAME })
      .then((config) => {
        if (isActive) setDynamicRejectionConfig(config);
      })
      .catch((error) => {
        console.warn("[GlobalPopup] Rejection config load failed:", error?.message || error);
        if (isActive) setDynamicRejectionConfig(null);
      })
      .finally(() => {
        if (isActive) setLoadingRejectionConfig(false);
      });
    return () => { isActive = false; };
  }, []);

  // When a brand-new socket part arrives on same station, reset popup UI state to initial
  // so previous error/success does not stick to next scanned part.
  useEffect(() => {
    if (!popup) {
      prevSocketPartIdRef.current = "";
      return;
    }
    if (!socketPartId) {
      setLastScannedCode("");
      setLocalQrValidated(false);
      localValidatedPartIdRef.current = "";
      if (prevSocketPartIdRef.current) {
        prevSocketPartIdRef.current = "";
        setResetError("");
        setShowResetConfirm(false);
        setIsResetting(false);
        setManualSelection(null);
        setManualReason("");
        setManualReasonQuery("");
        setManualReasonCategory("");
        setManualRejectionView(null);
        setManualRejectionZone(null);
      setManualRejectionSubZone(null);
        setManualRejectionRemark("");
        setManualSuccessMsg("");
        setManualQrCode("");
        setShowNgReasonModal(false);
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
    setManualRejectionView(null);
    setManualRejectionZone(null);
      setManualRejectionSubZone(null);
    setManualRejectionRemark("");
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
    if (needsNgReason && configuredCategories.length && !selectedDynamicCategory) {
      setValidationError("Please select rejection category.");
      return;
    }
    if (needsNgReason && configuredCategories.length && !manualRejectionView) {
      setValidationError("Please select rejection view.");
      return;
    }
    if (needsNgReason && configuredCategories.length && !manualRejectionZone) {
      setValidationError("Please select rejection zone.");
      return;
    }
    if (needsNgReason && configuredCategories.length && needsSubZoneSelection && !manualRejectionSubZone) {
      setValidationError("Please select rejection sub-zone.");
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
        category: manualSelection === "NG" ? (getNgCategoryDisplayName(selectedDynamicCategory) || manualReasonCategory) : undefined,
        view: manualSelection === "NG" ? (manualRejectionView?.name || "") : undefined,
        zone: manualSelection === "NG" ? [
          manualRejectionZone?.name || manualRejectionZone?.code || "",
          manualRejectionSubZone?.name || manualRejectionSubZone?.code || "",
        ].filter(Boolean).join(" / ") : undefined,
        subZone: manualSelection === "NG" ? (manualRejectionSubZone?.name || manualRejectionSubZone?.code || "") : undefined,
        remark: manualSelection === "NG" ? manualRejectionRemark : undefined,
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
        setManualRejectionView(null);
        setManualRejectionZone(null);
      setManualRejectionSubZone(null);
        setManualRejectionRemark("");
        setShowNgReasonModal(false);
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
        closeSmoothly();
      }, 500);
    } catch (error) {
      setResetError(error?.response?.data?.error || error?.message || "Submission failed.");
      setAwaitingNextScan(false);
      setSubmittingManual(false);
      if (manualSubmitTimerRef.current) clearTimeout(manualSubmitTimerRef.current);
      manualSubmitTimerRef.current = setTimeout(() => {
        setResetError("");
        closeSmoothly();
      }, 900);
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

    const popupType = String(popup?.type || "").trim().toUpperCase();
    const popupQrState = resolveQrState(popup);
    const popupOpState = resolveOperationState(popup);
    const forceErrorAutoClose =
      Boolean(validationError) ||
      popupType === "ERROR" ||
      popupQrState === "FAIL" ||
      popupQrState === "BLOCKED" ||
      popupOpState === "FAIL" ||
      popupOpState === "COMM";

    if (disableAutoClose && !forceErrorAutoClose) {
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
    const CUSTOMER_QR_MAPPED_CLOSE_MS = 7000;
    const STANDARD_ERROR_CLOSE_MS = 8000;

    // Laser two-step flow must stay visible until the customer QR arrives and maps.
    if (customerQrPending) {
      setAutoCloseTimeLeft(null);
      setAutoCloseDuration(0);
      return undefined;
    }

    // Faster auto-close / auto-reset for QR-focused industrial flow
    if (isOnlyQrCheck) {
      const qrState = popupQrState;
      if (qrState === "PASS" || qrState === "DUPLICATE") {
        duration = customerQrMapped ? CUSTOMER_QR_MAPPED_CLOSE_MS : STANDARD_SUCCESS_CLOSE_MS;
      } else if (popup?.type === "ERROR" || qrState === "FAIL" || qrState === "BLOCKED") {
        duration = STANDARD_ERROR_CLOSE_MS;
      } else {
        // Even when upstream state is partial/WAIT, close quickly to be ready for next industrial scan.
        duration = STANDARD_SUCCESS_CLOSE_MS;
      }
    } else if (signalCustomerMappingStation) {
      if (customerQrMapped || popupType === "SUCCESS" || popupQrState === "PASS") {
        duration = customerQrMapped ? CUSTOMER_QR_MAPPED_CLOSE_MS : STANDARD_SUCCESS_CLOSE_MS;
      } else if (popup?.type === "ERROR" || popupQrState === "FAIL" || popupQrState === "BLOCKED") {
        duration = STANDARD_ERROR_CLOSE_MS;
      } else {
        setAutoCloseTimeLeft(null);
        setAutoCloseDuration(0);
        return undefined;
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
          duration = customerQrMapped ? CUSTOMER_QR_MAPPED_CLOSE_MS : STANDARD_SUCCESS_CLOSE_MS; // Auto-close for PASS
        } else if (["FAIL", "COMM", "TIMEOUT"].includes(operationState) || popupType === "ERROR" || qrState === "FAIL") {
          duration = STANDARD_ERROR_CLOSE_MS; // shorter for errors
        } else {
          const isCritical = popupType === "ERROR" || qrState === "FAIL";
          const hasStateDetails = Boolean(partId || stationNo || qrState !== "WAIT" || operationState !== "IDLE");
          if (!hasStateDetails) {
            duration = STANDARD_SUCCESS_CLOSE_MS;
          } else {
            duration = isCritical
              ? STANDARD_ERROR_CLOSE_MS
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
        closeSmoothly();
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
    customerQrPending,
    customerQrMapped,
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

  const preReturnNgReasonCategories = getEnabledNgCategories(getStationFeatures(stationNo, stationSettings));
  const preReturnNgReasonCategoryKeys = preReturnNgReasonCategories.map((category) => category.key).join("|");
  useEffect(() => {
    if (manualSelection !== "NG") return;
    if (preReturnNgReasonCategories.length === 1 && manualReasonCategory !== preReturnNgReasonCategories[0].key) {
      setManualReasonCategory(preReturnNgReasonCategories[0].key);
    }
  }, [manualSelection, manualReasonCategory, preReturnNgReasonCategoryKeys]);

  if (!popup) return null;

  // Simple mode
  if (simple) {
    const type = String(popup.type || "INFO").toUpperCase();
    const simpleTheme = type === "ERROR" ? "bg-red-600" : type === "SUCCESS" ? "bg-emerald-600" : type === "WARNING" ? "bg-amber-500" : "bg-cyan-600";
    const SimpleIcon = type === "ERROR" ? AlertTriangle : type === "SUCCESS" ? CheckCircle : Clock3;

    return (
      <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm md:max-w-md bg-bg-card rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in duration-200">
          <div className={`relative p-4 md:p-5 flex items-center gap-2.5 text-white ${simpleTheme}`}>
            {typeof onClose === "function" && (
              <button onClick={onClose} className="absolute right-2 top-2 w-7 h-7 rounded-full flex items-center justify-center bg-black/20 hover:bg-black/30">
                <X size={12} />
              </button>
            )}
            <SimpleIcon size={18} />
            <h2 className="text-sm md:text-base font-bold">{popup.title || type}</h2>
          </div>
          <div className="p-4 md:p-5">
            <p className="text-sm md:text-base text-text-main">{popup.message || "Update received."}</p>
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
  const targetStationIndexInJourney = journeyStations.findIndex(
    (s) => String(s.stationNo || "").trim().toUpperCase() === targetStationKey
  );
  const fallbackCurrentIndex = journeyStations.findIndex((s) => String(s.status || "").toUpperCase() === "IN_PROGRESS");
  const resolvedCurrentIndex = targetStationIndexInJourney >= 0 ? targetStationIndexInJourney : fallbackCurrentIndex;
  const previousStation = targetStationIndexInJourney > 0
    ? journeyStations[targetStationIndexInJourney - 1]
    : (resolvedCurrentIndex > 0 ? journeyStations[resolvedCurrentIndex - 1] : null);
  const currentStationCard = targetStationIndexInJourney >= 0
    ? journeyStations[targetStationIndexInJourney]
    : (resolvedCurrentIndex >= 0 ? journeyStations[resolvedCurrentIndex] : null);

  // Always prefer the station currently opened on OperatorView.
  // Fallback to journey IN_PROGRESS only when popup has no station identity.
  const mergeStationIndex = resolvedCurrentIndex;
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
  const fallbackNgReasonCategories = getEnabledNgCategories(features);
  const configuredCategories = Array.isArray(dynamicRejectionConfig?.categories) && dynamicRejectionConfig.categories.length
    ? dynamicRejectionConfig.categories
    : [];
  const dynamicCategories = configuredCategories.filter((category) => isNgCategoryEnabled(category, features));
  const dynamicViews = Array.isArray(dynamicRejectionConfig?.views) ? dynamicRejectionConfig.views : [];
  const dynamicMappings = Array.isArray(dynamicRejectionConfig?.mappings) ? dynamicRejectionConfig.mappings : [];
  const enabledNgReasonCategories = configuredCategories.length ? dynamicCategories : fallbackNgReasonCategories;

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

  const displayStations = showJourney
    ? (resolvedCurrentIndex >= 0
      ? enrichedStations.slice(Math.max(0, resolvedCurrentIndex - 1), Math.min(enrichedStations.length, resolvedCurrentIndex + 2))
      : enrichedStations.slice(0, 3))
    : [];
  const selectedDynamicCategory = dynamicCategories.find((category) =>
    String(category.key || category.code || category.id) === String(manualReasonCategory)
  );
  const selectedDynamicView = manualRejectionView;
  const selectedDynamicZone = manualRejectionZone;
  const selectedDynamicSubZone = manualRejectionSubZone;
  const popupZones = selectedDynamicView?.zones || [];
  const popupSubZones = selectedDynamicZone?.subZones || [];
  const needsSubZoneSelection = popupSubZones.length > 0;
  const popupZoneShape = getNgZoneGridShape(popupZones.length);
  const popupVerticalDividers = Array.from(
    { length: Math.max(0, popupZoneShape.columns - 1) },
    (_, index) => Number(popupZones[index + 1]?.xPercent ?? ((index + 1) * 100 / popupZoneShape.columns))
  );
  const popupHorizontalDividers = Array.from(
    { length: Math.max(0, popupZoneShape.rows - 1) },
    (_, index) => Number(popupZones[(index + 1) * popupZoneShape.columns]?.yPercent ?? ((index + 1) * 100 / popupZoneShape.rows))
  );
  const dynamicReasonIdsForSelection = (() => {
    if (!selectedDynamicCategory || !selectedDynamicView || !selectedDynamicZone) return null;

    const zoneMatches = dynamicMappings.filter((row) =>
      Number(row.categoryId) === Number(selectedDynamicCategory.id) &&
      Number(row.viewId) === Number(selectedDynamicView.id) &&
      Number(row.zoneId) === Number(selectedDynamicZone.id)
    );

    if (!zoneMatches.length) return null;

    const subZoneMatches = selectedDynamicSubZone
      ? zoneMatches.filter((row) => Number(row.subZoneId || 0) === Number(selectedDynamicSubZone.id))
      : zoneMatches.filter((row) => !row.subZoneId);
    const zoneLevelMatches = zoneMatches.filter((row) => !row.subZoneId);
    const selectedMatches = subZoneMatches.length ? subZoneMatches : zoneLevelMatches;

    return selectedMatches.length
      ? new Set(selectedMatches.map((row) => Number(row.reasonId)))
      : null;
  })();
  const allNgReasonOptions = Array.from(
    new Set(enabledNgReasonCategories.flatMap((category) => {
      if (dynamicCategories.length) return (category.reasons || []).map((reason) => reason.name || reason);
      return getNgReasonsByCategory(category.key);
    }))
  );
  const ngReasonOptions = (() => {
    if (dynamicCategories.length) {
      if (!selectedDynamicCategory) return allNgReasonOptions;
      const categoryReasons = (selectedDynamicCategory.reasons || []).filter((reason) => {
        if (!dynamicReasonIdsForSelection) return true;
        return dynamicReasonIdsForSelection.has(Number(reason.id));
      });
      return categoryReasons.map((reason) => reason.name || reason);
    }
    return manualReasonCategory ? getNgReasonsByCategory(manualReasonCategory) : allNgReasonOptions;
  })();
  const filteredNgReasonOptions = (() => {
    const q = String(manualReasonQuery || "").trim().toLowerCase();
    if (!q) return ngReasonOptions;
    return ngReasonOptions.filter((reason) => String(reason).toLowerCase().includes(q));
  })();
  const isValidNgReason = !manualReason || ngReasonOptions.includes(manualReason);
  const ngWizardStep = !manualRejectionView
    ? 1
    : !manualRejectionZone
      ? 2
      : needsSubZoneSelection && !manualRejectionSubZone
        ? 3
      : !selectedDynamicCategory && configuredCategories.length
        ? 4
        : 5;
  const previousStationFeatures = getStationFeatures(previousStation?.stationNo, stationSettings);
  const previousOpState = getJourneyStationDisplayState(previousStation || {}, previousStationFeatures);
  const currentOpState = String(liveOperationState || currentStationCard?.operation || currentStationCard?.status || "").trim().toUpperCase();
  const previousBypassReason = String(previousStation?.bypassReason || previousStation?.bypass_reason || previousStation?.interlockReason || "").trim().toUpperCase();
  const previousStationBypassed =
    Boolean(previousStation?.isBypassed || previousStation?.is_bypassed || previousStation?.bypassed) ||
    previousBypassReason.includes("BYPASS");
  const previousStationPassed = previousStationBypassed || previousOpState === "PASS";
  const previousQrDisplayState = previousStationPassed && !["FAIL", "FAILED", "NG", "BLOCK", "REJECT", "INVALID"].includes(String(previousStation?.qrVerification || "").trim().toUpperCase())
    ? "PASS"
    : (previousStation?.qrVerification || "WAIT");
  const previousOperationDisplayState = previousStationPassed
    ? "PASS"
    : (previousStation?.operation || previousOpState || "WAIT");
  const currentStationPassed = ["PASS", "PASSED", "COMPLETED", "ENDED_OK"].includes(currentOpState);
  const currentStationName = currentStationCard?.stationName || displayStations.find((s) => s.status === "IN_PROGRESS")?.stationName || stationNo || "System Node";

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

  const needsResetByReason = ["DUPLICATE_SCAN", "RESET_REQUIRED_AFTER_PLC_COMM_ERROR"].some(r => reasonUpper.startsWith(r)) || reasonUpper.startsWith("PLC_TIMEOUT");
  const canReset = (liveOperationState === "COMM" || liveOperationState === "FAIL" || needsResetByReason) && Boolean(partId) && Boolean(stationNo) && typeof onResetOperation === "function";
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
    <>
    <div className={`fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/70 p-2 backdrop-blur-sm transition-opacity duration-200 sm:p-4 md:p-5 ${isClosingSmoothly ? "opacity-0" : "opacity-100"}`}>
      <div className={`w-full min-h-0 bg-bg-card shadow-2xl flex flex-col transition-all duration-200 ${isFullscreen
        ? "fixed inset-0 z-[1000] w-screen h-screen max-w-full max-h-screen rounded-none m-0 animate-none"
        : `max-w-[44rem] md:max-w-[54rem] lg:max-w-[60rem] rounded-2xl max-h-[calc(100dvh-1rem)] md:max-h-[calc(100dvh-2.5rem)] ${isClosingSmoothly ? "scale-[0.98]" : "animate-in zoom-in duration-200"}`
        }`}>
        {/* Header - Compact */}
        <div className="px-3 py-2.5 flex-shrink-0 border-b border-border/50 sm:px-4 md:px-6 md:py-4" style={{ background: "#1e293b" }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-1.5 md:p-2 rounded-lg" style={{ background: "#0f172a" }}>
                <Layout className="text-amber-400" size={18} />
              </div>
              <div>
                <h3 className="text-white text-sm md:text-base font-bold">Part Journey</h3>
                <p className="text-amber-400 text-[9px] md:text-[10px] font-medium uppercase tracking-wider">Traceability</p>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              {displayedScanCode && (
                <div className="px-2.5 py-1.5 md:px-3 md:py-2 rounded-lg border border-amber-500/20 max-w-[260px] md:max-w-[340px] min-w-[120px]" style={{ background: "#0f172a" }} title={displayedScanCode}>
                  <p className="text-[8px] md:text-[9px] font-bold uppercase tracking-wider text-slate-400">{displayedScanLabel}</p>
                  <p className="font-mono text-[11px] font-black text-amber-400 break-all leading-tight sm:text-xs md:text-sm">{displayedScanCode}</p>
                </div>
              )}
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                title={isFullscreen ? "Minimize" : "Maximize Screen"}
                className="w-7 h-7 md:w-9 md:h-9 rounded-lg flex items-center justify-center hover:bg-white/10 text-black hover:text-white transition-colors"
                style={{ background: "#f59e0b" }}
              >
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
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
                  className="w-8 h-8 md:w-9 md:h-9 rounded-lg flex items-center justify-center hover:bg-rose-500 transition-colors"
                  style={{ background: "#dc2626" }}
                >
                  <X size={14} className="text-white" />
                </button>
              )}
            </div>
          </div>

          {/* Compact Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mt-2.5 md:mt-4">
            <div className="rounded-lg md:rounded-xl p-2 md:p-3" style={{ background: "#0f172a" }}>
              <p className="text-amber-400 text-[9px] md:text-[10px] font-medium uppercase mb-0.5 tracking-wide">Machine</p>
              <p className="text-white text-xs font-bold truncate sm:text-sm md:text-base">{popup?.machineName || "N/A"}</p>
            </div>
            <div className="rounded-lg md:rounded-xl p-2 md:p-3" style={{ background: "#0f172a" }}>
              <p className="text-amber-400 text-[9px] md:text-[10px] font-medium uppercase mb-0.5 tracking-wide">Station</p>
              <p className="text-white text-xs font-bold truncate sm:text-sm md:text-base">{currentStationName}</p>
            </div>
            <div className="rounded-lg md:rounded-xl p-2 md:p-3" style={{ background: "#0f172a" }}>
              <p className="text-amber-400 text-[9px] md:text-[10px] font-medium uppercase mb-0.5 tracking-wide">Shift</p>
              <p className="text-white text-xs font-bold sm:text-sm md:text-base">{shiftText}</p>
            </div>
            <div className="rounded-lg md:rounded-xl p-2 md:p-3" style={allPassed ? { background: "#064e3b" } : { background: "#0f172a" }}>
              <p className="text-amber-400 text-[9px] md:text-[10px] font-medium uppercase mb-0.5 tracking-wide" >Pass</p>
              <p className="text-xs font-bold sm:text-sm md:text-base" style={{ color: allPassed ? "#4ade80" : "#fff" }}>{passCount}/{totalCount}</p>
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
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 bg-bg-card font-medium sm:px-4 md:px-6 md:py-4">
          {displayedScanCode && !isNextPartState && (
            <div className={`mb-2 md:mb-3 px-2.5 py-1.5 md:px-3.5 md:py-2.5 rounded-lg md:rounded-xl border shadow-sm flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2.5 ${qrStripTheme.container}`}>
              <span className={`text-[12px] md:text-sm font-bold uppercase tracking-wider whitespace-nowrap ${qrStripTheme.label}`}>
                {displayedScanLabel}
              </span>
              <div className="flex-1 min-w-0 text-center overflow-hidden">
                <span className={`font-bold text-xs tracking-wide text-black break-all sm:text-sm md:text-base ${qrStripTheme.value}`}>
                  {displayedScanCode}
                </span>
                {hasMappedCustomerQr && displayInternalPartId && displayInternalPartId !== displayedScanCode && (
                  <p className={`mt-0.5 break-all font-mono text-[10px] font-bold ${qrStripTheme.label}`}>
                    Internal Part ID: {displayInternalPartId}
                  </p>
                )}
              </div>
              <span className={`inline-flex items-center justify-center px-2 md:px-3 py-0.5 md:py-1 rounded-md text-[11px] md:text-xs font-bold border whitespace-nowrap ${qrStripTheme.badge}`}>
                {qrStripTheme.badgeText}
              </span>
            </div>
          )}

          {plcReadingPreview && (
            <div className="mb-3 md:mb-4 rounded-lg md:rounded-xl border border-sky-500/30 bg-sky-950/20 p-3 md:p-4">
              <div className="flex items-center justify-between gap-2 mb-2 md:mb-3">
                <p className="text-[10px] md:text-xs font-bold text-sky-200 uppercase tracking-widest">
                  {plcReadingPreview?.Result ? "Leak Test Reading" : t("globalPopup.plcReading", "PLC Reading")}
                </p>
                <span className={`text-[10px] md:text-xs px-2 py-0.5 rounded-full font-bold ${plcOnline ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"}`}>
                  {plcOnline ? t("operatorView.online", "Online") : t("operatorView.offline", "Offline")}
                </span>
              </div>
              {plcReadingPreview?.Result ? (
                <div className="grid grid-cols-1 gap-2 md:gap-2.5 rounded-md md:rounded-lg bg-slate-900/70 p-2 md:p-3 md:grid-cols-2 lg:grid-cols-3">
                  {LEAK_TEST_PREVIEW_FIELDS.map(([label, key]) => (
                    <div key={key} className="rounded border border-slate-800/80 bg-slate-950/60 px-2 py-1.5 md:px-3 md:py-2">
                      <p className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-sky-200">{label}</p>
                      <p className="mt-0.5 break-all text-[11px] md:text-xs font-semibold text-slate-100">
                        {formatLeakPreviewValue(plcReadingPreview, key)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="text-[11px] text-slate-100 bg-slate-900/70 rounded-md p-2 overflow-auto max-h-36">
                  {JSON.stringify(plcReadingPreview, null, 2)}
                </pre>
              )}
            </div>
          )}

          {effectivePartId && (
          <div className="mb-3 md:mb-4 grid grid-cols-1 gap-2.5 md:gap-3 md:grid-cols-2">
              <div className={`rounded-xl md:rounded-2xl border p-3 md:p-4 shadow-sm ${
                previousStation ? (previousStationPassed ? "border-emerald-200 bg-emerald-50/80" : "border-rose-200 bg-rose-50/80") : "border-slate-200 bg-white"
              }`}>
                <p className="mb-2 md:mb-3 text-[10px] md:text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{t("globalPopup.previousStation", "Previous Station")}</p>
                {previousStation ? (
                  <div className="space-y-2 md:space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900 md:text-base">{previousStation.stationName || previousStation.stationNo || "-"}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] md:text-[11px] font-bold ${previousStationPassed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
                        {previousStationPassed ? t("globalPopup.passed", "PASSED") : t("globalPopup.notPassed", "NOT PASSED")}
                      </span>
                    </div>
                    <InfoRow label="QR">
                      <StatusBadge status={previousQrDisplayState} />
                    </InfoRow>
                    <InfoRow label="Operation">
                      <StatusBadge status={previousOperationDisplayState} />
                    </InfoRow>
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-slate-500">{t("operatorView.noPreviousStation", "No previous station (first operation).")}</p>
                )}
              </div>

              <div className={`rounded-xl md:rounded-2xl border p-3 md:p-4 shadow-sm ${
                currentStationPassed ? "border-emerald-200 bg-emerald-50/80" : "border-sky-200 bg-sky-50/80"
              }`}>
                <p className="mb-2 md:mb-3 text-[10px] md:text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{t("globalPopup.currentStation", "Current Station")}</p>
                {currentStationCard ? (
                  <div className="space-y-2 md:space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900 md:text-base">{currentStationCard.stationName || currentStationCard.stationNo || currentStationName}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] md:text-[11px] font-bold ${currentStationPassed ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                        {currentStationPassed ? t("globalPopup.passed", "PASSED") : t("globalPopup.inProcess", "IN PROCESS")}
                      </span>
                    </div>
                    <InfoRow label="QR">
                      <StatusBadge status={liveQrState || currentStationCard.qrVerification || "WAIT"} />
                    </InfoRow>
                    <InfoRow label="Operation">
                      <StatusBadge status={liveOperationState || currentStationCard.operation || "WAIT"} />
                    </InfoRow>
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-slate-500">{t("operatorView.waitingStationData", "Waiting for station data.")}</p>
                )}
              </div>
            </div>
          )}

          {/* QR Input: visible in simulation/USB/manual scan modes */}
          {showScanInputPanel && (
            <div className="w-full bg-slate-900/80 border border-slate-700/80 rounded-xl md:rounded-2xl p-4 md:p-5 space-y-3 md:space-y-4 mb-4 md:mb-5">
              <label className="block text-xs md:text-sm font-bold uppercase tracking-wider text-slate-300">
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
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-600 rounded-lg px-4 py-2.5 md:py-3 font-bold text-sm md:text-base text-slate-400 placeholder:text-slate-400 outline-none focus:border-amber-500 transition-colors font-mono"
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
                  className="w-full sm:w-auto justify-center bg-amber-500 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-bold px-6 py-2.5 md:py-3 rounded-lg text-sm md:text-base transition-colors flex items-center gap-2"
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
          {showJourney && displayStations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 md:py-10 text-text-muted space-y-4">
              <StationIcon />
              <div className="text-center">
                <p className="text-sm md:text-base font-bold text-white">{t("globalPopup.waiting", "Waiting")}</p>
                <p className="text-xs md:text-sm text-text-muted mt-1">{t("globalPopup.timelineAfterFirstScan", "Timeline appears after first scan")}</p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Message & Footer */}
        <div className="max-h-[48dvh] flex-shrink-0 space-y-2 overflow-y-auto border-t border-border/50 bg-bg-card px-3 py-2 sm:px-4 md:max-h-[42dvh] md:px-6 md:py-3">
          {showManualVerificationPanel && (
            <div className="mb-3 space-y-3 rounded-xl md:rounded-2xl border border-slate-200 bg-white p-3 md:p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
              <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <h3 className="text-xs md:text-sm font-bold uppercase tracking-[0.16em] text-slate-700">{t("globalPopup.submitQualityVerification", "Manual Quality Inspection")}</h3>
              </div>

              {displayedScanCode && (
                <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 md:px-4 md:py-3 text-center shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">{displayedScanLabel}</p>
                  <p className="mt-1 break-all font-mono text-sm font-black text-slate-950 sm:text-base md:text-lg">
                    {displayedScanCode}
                  </p>
                  {hasMappedCustomerQr && displayInternalPartId && displayInternalPartId !== displayedScanCode && (
                    <p className="mt-1.5 break-all text-[10px] font-bold text-slate-600">Mapped Part ID: <span className="font-mono">{displayInternalPartId}</span></p>
                  )}
                  {isCustomerQrOnlyScan && (
                    <p className="mt-1.5 text-[9px] font-bold text-slate-500">Part ID: <span className="font-mono">{displayInternalPartId}</span></p>
                  )}
                  {!hasMappedCustomerQr && effectivePartId && !isCustomerQrOnlyScan && (
                    <p className="mt-1.5 text-[9px] font-bold text-slate-500">Customer QR: <span className="font-mono">Waiting</span></p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5 md:gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setManualSelection("OK");
                    setManualReason("");
                    setManualReasonQuery("");
                  }}
                  className={`flex flex-col items-center justify-center p-3 md:p-5 rounded-xl border-2 transition-all duration-200 active:scale-[0.98] ${manualSelection === "OK"
                    ? "bg-emerald-500 border-emerald-300 text-white shadow-lg shadow-emerald-500/25 scale-[1.02]"
                    : "bg-slate-50 border-slate-200 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
                    }`}
                >
                  <CheckCircle size={24} className={manualSelection === "OK" ? "text-white" : "text-emerald-600"} />
                  <span className="mt-2 text-xs md:text-sm font-black uppercase tracking-wider text-center">{t("common.ok", "OK")} ({t("operatorView.pass", "Pass")})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setManualSelection("NG");
                    setManualReason("");
                    setManualReasonQuery("");
                    setManualRejectionView(null);
                    setManualRejectionZone(null);
      setManualRejectionSubZone(null);
                    setManualRejectionRemark("");
                    setManualReasonCategory(!dynamicCategories.length && enabledNgReasonCategories.length === 1 ? enabledNgReasonCategories[0].key : "");
                    setShowReasonDropdown(false);
                    setShowNgReasonModal(true);
                  }}
                  className={`flex flex-col items-center justify-center p-3 md:p-5 rounded-xl border-2 transition-all duration-200 active:scale-[0.98] ${manualSelection === "NG"
                    ? "bg-rose-500 border-rose-300 text-white shadow-lg shadow-rose-500/25 scale-[1.02]"
                    : "bg-slate-50 border-slate-200 text-rose-700 hover:border-rose-300 hover:bg-rose-50"
                    }`}
                >
                  <AlertTriangle size={24} className={manualSelection === "NG" ? "text-white" : "text-rose-600"} />
                  <span className="mt-2 text-xs md:text-sm font-black uppercase tracking-wider text-center">{t("common.ng", "NG")} ({t("operatorView.fail", "Fail")})</span>
                </button>
              </div>

              {manualSelection === "NG" && (
                <div className="animate-in slide-in-from-top-2 duration-150 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 md:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-700">
                        {t("globalPopup.rejectionReason", "Rejection Reason")}
                      </p>
                      <p className="mt-1 text-sm md:text-base font-bold text-slate-800">
                        {manualReason
                          ? [
                            getNgCategoryDisplayName(selectedDynamicCategory),
                            manualRejectionView?.name || "",
                            manualRejectionZone?.name || manualRejectionZone?.code || "",
                            manualReason,
                          ].filter(Boolean).join(" / ")
                          : t("globalPopup.noReasonSelected", "No defect reason selected")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowNgReasonModal(true)}
                      className="rounded-xl border border-rose-300 bg-white px-4 py-3 text-sm font-black uppercase tracking-widest text-rose-700 shadow-sm transition hover:bg-rose-100"
                    >
                      {manualReason ? t("globalPopup.changeReason", "Change Reason") : t("globalPopup.selectReason", "Select Reason")}
                    </button>
                  </div>
                  {manualReason && !isValidNgReason && (
                    <p className="mt-2 text-[11px] font-semibold text-rose-500">
                      {t("globalPopup.selectReasonFromList", "Select a reason from the dropdown list.")}
                    </p>
                  )}
                </div>
              )}

              {manualSuccessMsg && (
                <p className="text-sm font-bold text-emerald-600 text-center">{manualSuccessMsg}</p>
              )}

              <button
                type="button"
                onClick={handleSubmitManualResult}
                disabled={submittingManual || !manualSelection || (manualSelection === "NG" && (!manualReason || !isValidNgReason))}
                className={`w-full py-3 md:py-3.5 rounded-xl text-sm md:text-base font-black uppercase tracking-widest text-white transition-all duration-200 ${submittingManual || !manualSelection || (manualSelection === "NG" && (!manualReason || !isValidNgReason))
                  ? "bg-slate-200 border-slate-200 text-slate-500 cursor-not-allowed opacity-70"
                  : manualSelection === "OK"
                    ? "bg-emerald-500 hover:bg-emerald-400 border border-emerald-300 shadow-lg shadow-emerald-500/20 active:scale-[0.99] text-slate-950 font-black"
                    : "bg-rose-500 hover:bg-rose-400 border border-rose-300 shadow-lg shadow-rose-500/20 active:scale-[0.99] text-white font-black"
                  }`}
              >
                {submittingManual ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw size={16} className="animate-spin" />
                    {t("globalPopup.submittingResult", "Submitting Result...")}
                  </span>
                ) : (
                  t("globalPopup.submitQualityVerification", "Submit Quality Verification")
                )}
              </button>
            </div>
          )}

          {(validationError || validationInfo || popup.message) && (
            <div className={`p-3 md:p-4 rounded-xl md:rounded-2xl border-2 flex gap-3 items-start text-sm shadow-sm transition-colors duration-300 ${validationError ? "bg-rose-50 border-rose-300 text-rose-700" : !duplicateLike && (liveOperationState === "FAIL" || liveQrState === "FAIL" || popup.type === "ERROR" || popup.gate === "FORMAT" || popup.gate === "PLC_MATCH") ? "bg-rose-50 border-rose-300 text-rose-700" :
              liveOperationState === "COMM" || popup.type === "WARNING" || popup.reason === "PREVIOUS_STATION_NOT_COMPLETED" ? "bg-amber-50 border-amber-300 text-amber-800" :
                popup.type === "SUCCESS" || popup.type === "INFO" ? "bg-emerald-50 border-emerald-300 text-emerald-800" :
                  "bg-white border-slate-300 text-slate-800"
              }`}>
              {(validationInfo || popup.type === "SUCCESS" || popup.type === "INFO" || duplicateLike) && !validationError ? (
                <CheckCircle size={22} className="mt-0.5 flex-shrink-0" />
              ) : (
                <AlertTriangle size={22} className="mt-0.5 flex-shrink-0" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-black leading-snug tracking-wide sm:text-base">{validationError || validationInfo || (localScanDecision ? "" : friendlyErrorMessage(popup.message, popup))}</p>
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
            <div className="rounded-2xl border border-red-300 bg-red-50/90 p-4 md:p-5 space-y-3">
              <p className="text-sm md:text-base font-semibold text-red-700">
                {t("globalPopup.confirmResetQuestion", "Reset operation for part")} <span className="font-mono">{partId}</span> at {stationNo}?
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={() => setShowResetConfirm(false)} className="flex-1 rounded-xl border border-red-300 bg-white py-2.5 md:py-3 text-sm md:text-base font-bold text-red-700 hover:bg-red-50">
                  {t("globalPopup.cancel", "Cancel")}
                </button>
                <button onClick={handleReset} disabled={isResetting} className="flex-1 rounded-xl bg-red-600 py-2.5 md:py-3 text-sm md:text-base font-bold text-white hover:bg-red-700">
                  {isResetting ? "..." : t("globalPopup.confirm", "Confirm")}
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-3 md:gap-4 mt-2">
            {allowBottomClose && (showAcknowledge || typeof onClose === "function") && (
              <button
                onClick={onClose}
                className="flex-1 bg-white hover:bg-slate-50 active:scale-[0.98] text-slate-700 font-black py-3.5 md:py-4 px-6 rounded-xl text-sm uppercase tracking-widest border border-slate-300 shadow-sm transition-all duration-150"
              >
                {t("globalPopup.close", "Close")}
              </button>
            )}
            {canReset && !showResetConfirm && (
              <button
                onClick={() => setShowResetConfirm(true)}
                disabled={isResetting}
                className="flex-1 bg-rose-600 hover:bg-rose-500 active:scale-[0.98] text-white font-black py-3.5 md:py-4 px-6 rounded-xl text-sm uppercase tracking-widest border border-rose-500 shadow-lg shadow-rose-600/25 flex items-center justify-center gap-2 transition-all duration-150"
              >
                <RefreshCw size={16} className={isResetting ? "animate-spin" : ""} />
                {isResetting ? "..." : t("globalPopup.resetOperation", "RESET OPERATION")}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
    {showNgReasonModal && manualSelection === "NG" && (
      <div className={`fixed inset-0 z-[1100] flex items-center justify-center bg-black/80 p-2 backdrop-blur-md transition-opacity duration-200 sm:p-4 md:p-6 ${isClosingSmoothly ? "opacity-0" : "opacity-100"}`}>
        <div className={`flex h-[calc(100dvh-1rem)] max-h-[900px] w-full max-w-[min(1180px,98vw)] flex-col overflow-hidden rounded-xl border border-border bg-bg-card text-text-main shadow-[0_30px_90px_rgba(0,0,0,0.6)] transition-transform duration-200 sm:h-auto sm:max-h-[96dvh] sm:rounded-2xl ${isClosingSmoothly ? "scale-[0.98]" : "scale-100"}`}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 sm:px-6 md:py-4" style={{ background: "#1e293b" }}>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-black text-white sm:text-xl md:text-2xl">
                {t("globalPopup.selectRejectionReason", "Select rejection reason")}
              </h2>
              <p className="hidden">
                {stationNo || "Station"} • {currentStationName}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowNgReasonModal(false)}
                className="rounded-xl border border-slate-600 bg-slate-900 p-2 md:p-2.5 text-slate-200 transition hover:bg-slate-700"
                aria-label="Close rejection reason popup"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="border-b border-danger/30 bg-danger/10 px-4 py-3 sm:px-6 md:py-4">
            <div className="flex items-start gap-3 text-danger">
              <AlertTriangle size={22} className="mt-0.5 flex-shrink-0 text-rose-600" />
              <p className="text-base font-black sm:text-[17px] md:text-lg">
                {t("globalPopup.partMarkedNgChooseReason", "Part marked NG — choose defect category and exact reason below.")}
              </p>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-bg-elevated p-3 sm:p-5 md:p-6">
            <div className="mx-auto max-w-5xl space-y-4 md:space-y-5">
              <div className="sticky top-0 z-40 grid grid-cols-4 gap-1.5 md:gap-2 rounded-xl bg-bg-elevated/95 pb-2 backdrop-blur sm:gap-2">
                {(needsSubZoneSelection ? ["View", "Zone", "Sub Zone", "Category", "Reason"] : ["View", "Zone", "Category", "Reason"]).map((label, index) => {
                  const step = index + 1;
                  return <div key={label} className={`rounded-lg border px-1 py-2 md:py-2.5 text-center text-[9px] font-black uppercase sm:px-2 sm:text-xs md:text-sm ${
                    ngWizardStep === step ? "border-primary bg-primary text-white" : ngWizardStep > step ? "border-green-600 bg-green-500 text-white" : "border-border bg-bg-card text-text-muted"
                  }`}>{step}. {label}</div>;
                })}
              </div>
              {ngWizardStep === 1 && (
                <div>
                  <h3 className="mb-3 text-lg font-black text-text-main sm:text-xl md:text-2xl">Select Part View</h3>
                  {loadingRejectionConfig ? (
                    <div className="flex min-h-40 items-center justify-center rounded-xl border border-border bg-bg-card">
                      <RefreshCw size={22} className="mr-3 animate-spin text-primary" />
                      <span className="text-sm font-black text-text-muted">Loading saved rejection views...</span>
                    </div>
                  ) : dynamicViews.length === 0 ? (
                    <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-4 text-sm font-bold text-amber-700">
                      No saved rejection views were found for this component.
                    </div>
                  ) : <div className="grid grid-cols-2 gap-3 md:gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {dynamicViews.map((view) => (
                      <button key={view.id} type="button" onClick={() => {
                        setManualRejectionView(view);
                        setManualRejectionZone(null);
      setManualRejectionSubZone(null);
                        setManualReasonCategory("");
                        setManualReason("");
                        setManualReasonQuery("");
                      }} className="overflow-hidden rounded-xl border-2 border-border bg-bg-card transition hover:border-primary active:scale-[0.99]">
                        <div className="aspect-video bg-bg-dark">{view.imageUrl ? <img src={view.imageUrl} alt={view.name} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-xs font-black text-text-muted">No Image</div>}</div>
                        <div className="border-t border-border px-3 py-2 md:py-2.5 text-center text-sm md:text-base font-black text-text-main">{view.name}</div>
                      </button>
                    ))}
                  </div>}
                </div>
              )}

              {ngWizardStep === 2 && manualRejectionView && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-black text-text-main sm:text-xl md:text-2xl">Select Zone - {manualRejectionView.name}</h3>
                    <button type="button" onClick={() => setManualRejectionView(null)} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-black text-text-main">Back</button>
                  </div>
                  <div className="mx-auto w-full max-w-4xl">
                    <div className="relative mx-auto aspect-[900/520] max-h-[52dvh] w-full overflow-hidden rounded-xl border-2 border-border bg-bg-dark shadow-lg sm:max-h-[56dvh]">
                      {manualRejectionView.imageUrl && <img src={manualRejectionView.imageUrl} alt={manualRejectionView.name} className="absolute inset-0 h-full w-full object-contain" />}
                      {popupVerticalDividers.map((position, index) => (
                        <span key={`wizard-v-${index}`} className="pointer-events-none absolute inset-y-0 z-20 border-l-[3px] border-dotted border-red-600 sm:border-l-4" style={{ left:`${position}%` }} />
                      ))}
                      {popupHorizontalDividers.map((position, index) => (
                        <span key={`wizard-h-${index}`} className="pointer-events-none absolute inset-x-0 z-20 border-t-[3px] border-dotted border-red-600 sm:border-t-4" style={{ top:`${position}%` }} />
                      ))}
                      {popupZones.map((zone, zoneIndex) => (
                        <button key={zone.id} type="button" onClick={() => {
                          setManualRejectionZone(zone);
                          setManualRejectionSubZone(null);
                          setManualReasonCategory("");
                          setManualReason("");
                          setManualReasonQuery("");
                        }} className={`absolute z-30 flex items-center justify-center border-2 transition hover:z-40 active:scale-[0.99] ${NG_ZONE_OVERLAY_STYLES[zoneIndex % NG_ZONE_OVERLAY_STYLES.length]}`} style={{ left:`${Number(zone.xPercent ?? 0)}%`, top:`${Number(zone.yPercent ?? 0)}%`, width:`${Number(zone.widthPercent ?? 10)}%`, height:`${Number(zone.heightPercent ?? 10)}%` }}>
                          <span className={`flex min-h-8 min-w-8 items-center justify-center rounded-md border-2 px-2 text-sm font-black shadow-lg sm:min-h-12 sm:min-w-12 sm:rounded-lg sm:px-3 sm:text-lg ${NG_ZONE_LABEL_STYLES[zoneIndex % NG_ZONE_LABEL_STYLES.length]}`}>{zone.code || zone.name}</span>
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-center text-[11px] font-bold text-text-muted sm:text-xs">Tap the highlighted area directly on the part image.</p>
                  </div>
                </div>
              )}

              {ngWizardStep === 3 && needsSubZoneSelection && manualRejectionView && manualRejectionZone && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-black text-text-main sm:text-xl md:text-2xl">Select Sub Zone - {manualRejectionZone.name || manualRejectionZone.code}</h3>
                    <button type="button" onClick={() => { setManualRejectionZone(null); setManualRejectionSubZone(null); }} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-black text-text-main">Back</button>
                  </div>
                  <div className="mx-auto w-full max-w-4xl">
                    <div className="relative mx-auto aspect-[900/520] max-h-[52dvh] w-full overflow-hidden rounded-xl border-2 border-border bg-bg-dark shadow-lg sm:max-h-[56dvh]">
                      {manualRejectionView.imageUrl && <img src={manualRejectionView.imageUrl} alt={manualRejectionView.name} className="absolute inset-0 h-full w-full object-contain" />}
                      <div className="absolute z-20 border-2 border-yellow-400 bg-yellow-300/10" style={{ left:`${Number(manualRejectionZone.xPercent ?? 0)}%`, top:`${Number(manualRejectionZone.yPercent ?? 0)}%`, width:`${Number(manualRejectionZone.widthPercent ?? 10)}%`, height:`${Number(manualRejectionZone.heightPercent ?? 10)}%` }} />
                      {popupSubZones.map((subZone, subZoneIndex) => {
                        const left = Number(manualRejectionZone.xPercent || 0) + (Number(manualRejectionZone.widthPercent || 10) * Number(subZone.xPercent || 0) / 100);
                        const top = Number(manualRejectionZone.yPercent || 0) + (Number(manualRejectionZone.heightPercent || 10) * Number(subZone.yPercent || 0) / 100);
                        const width = Number(manualRejectionZone.widthPercent || 10) * Number(subZone.widthPercent || 10) / 100;
                        const height = Number(manualRejectionZone.heightPercent || 10) * Number(subZone.heightPercent || 10) / 100;
                        return (
                          <button key={subZone.id} type="button" onClick={() => {
                            setManualRejectionSubZone(subZone);
                            setManualReasonCategory("");
                            setManualReason("");
                            setManualReasonQuery("");
                          }} className={`absolute z-30 flex items-center justify-center border-2 transition hover:z-40 active:scale-[0.99] ${NG_ZONE_OVERLAY_STYLES[subZoneIndex % NG_ZONE_OVERLAY_STYLES.length]}`} style={{ left:`${left}%`, top:`${top}%`, width:`${Math.max(3, width)}%`, height:`${Math.max(3, height)}%` }}>
                            <span className={`flex min-h-7 min-w-7 items-center justify-center rounded-md border-2 px-2 text-xs font-black shadow-lg sm:min-h-10 sm:min-w-10 sm:text-sm ${NG_ZONE_LABEL_STYLES[subZoneIndex % NG_ZONE_LABEL_STYLES.length]}`}>{subZone.code || subZone.name}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-center text-[11px] font-bold text-text-muted sm:text-xs">Tap the exact small defect area.</p>
                  </div>
                </div>
              )}

              {ngWizardStep === (needsSubZoneSelection ? 4 : 3) && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-black text-text-main sm:text-xl md:text-2xl">Select Rejection Category</h3>
                    <button type="button" onClick={() => needsSubZoneSelection ? setManualRejectionSubZone(null) : setManualRejectionZone(null)} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-black text-text-main">Back</button>
                  </div>
                  {enabledNgReasonCategories.length === 0 ? (
                    <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-4 text-sm font-bold text-amber-700">
                      No rejection category is enabled for this station. Enable CR, CRAM, or MR in Station Control.
                    </div>
                  ) : <div className="grid grid-cols-1 gap-3 md:gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {enabledNgReasonCategories.map((category) => {
                      const categoryKey = String(category.key || category.code || category.id);
                      const count = dynamicCategories.length ? (category.reasons || []).length : getNgReasonsByCategory(category.key).length;
                      return <button key={categoryKey} type="button" onClick={() => {
                        setManualReasonCategory(categoryKey);
                        setManualReason("");
                        setManualReasonQuery("");
                      }} className="min-h-24 rounded-xl border-2 border-border bg-bg-card p-4 md:p-5 text-left transition hover:border-primary active:scale-[0.99]">
                        <p className="text-lg md:text-xl font-black text-text-main">{getNgCategoryDisplayName(category)}</p>
                        <p className="mt-2 text-xs md:text-sm font-bold text-text-muted">{count} rejection reasons</p>
                      </button>;
                    })}
                  </div>}
                </div>
              )}

              {ngWizardStep === (needsSubZoneSelection ? 5 : 4) && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-lg font-black text-text-main sm:text-xl md:text-2xl">Select Rejection Reason</h3>
                      <p className="mt-1 truncate text-xs md:text-sm font-bold text-text-muted">{manualRejectionView?.name} / {manualRejectionZone?.name || manualRejectionZone?.code}{manualRejectionSubZone ? ` / ${manualRejectionSubZone.name || manualRejectionSubZone.code}` : ""} / {getNgCategoryDisplayName(selectedDynamicCategory) || manualReasonCategory}</p>
                    </div>
                    <button type="button" onClick={() => { setManualReasonCategory(""); setManualReason(""); }} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-black text-text-main">Back</button>
                  </div>
                  {filteredNgReasonOptions.length === 0 ? (
                    <div className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-4 text-sm font-bold text-amber-700">
                      No rejection reason is mapped for this selection. Check Rejection Configuration mapping for this view, zone, sub-zone, and category.
                    </div>
                  ) : <div className="grid grid-cols-2 gap-2 md:gap-3 lg:grid-cols-3">
                    {filteredNgReasonOptions.map((reason) => <button key={reason} type="button" onClick={() => {
                      setManualReason(reason);
                      setManualReasonQuery(reason);
                      setValidationError("");
                    }} className={`min-h-14 rounded-xl border-2 px-4 py-3 text-left text-sm font-black transition sm:text-base ${manualReason === reason ? "border-green-700 bg-green-500 text-white shadow-lg" : "border-border bg-bg-card text-text-main hover:border-primary"}`}>{reason}</button>)}
                  </div>}
                  <textarea value={manualRejectionRemark} onChange={(event) => setManualRejectionRemark(event.target.value)} rows={2} className="mt-4 w-full rounded-xl border border-border bg-bg-card px-3 py-2 text-sm font-semibold text-text-main outline-none focus:border-primary" placeholder="Optional remark" />
                </div>
              )}
            </div>
          </div>

          <div className="hidden">
            <div className="space-y-3">
              {enabledNgReasonCategories.map((category) => {
                const categoryKey = String(category.key || category.code || category.id);
                const expanded = manualReasonCategory === categoryKey || enabledNgReasonCategories.length === 1;
                const categoryReasons = dynamicCategories.length
                  ? (category.reasons || []).map((reason) => reason.name || reason)
                  : getNgReasonsByCategory(category.key);
                const selectedInCategory = categoryReasons.includes(manualReason);
                return (
                  <div
                    key={categoryKey}
                    className={`overflow-hidden rounded-2xl border transition ${
                      expanded
                        ? "border-primary bg-bg-card shadow-lg shadow-primary/10"
                        : selectedInCategory
                          ? "border-rose-400 bg-rose-50 shadow-md"
                          : "border-border bg-bg-card shadow-sm"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setManualReasonCategory(expanded && enabledNgReasonCategories.length > 1 ? "" : categoryKey);
                        setManualReasonQuery("");
                        setManualReason("");
                        setManualRejectionView(null);
                        setManualRejectionZone(null);
      setManualRejectionSubZone(null);
                        setShowReasonDropdown(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-base font-black text-text-main sm:text-xl">{getNgCategoryDisplayName(category)}</p>
                        <p className="mt-1 text-xs font-black text-text-muted sm:text-sm">
                          {categoryReasons.length} reasons {selectedInCategory ? `• Selected: ${manualReason}` : ""}
                        </p>
                      </div>
                      <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border text-base font-black ${
                        expanded ? "border-primary bg-primary text-white" : "border-border bg-bg-elevated text-text-main"
                      }`}>
                        {expanded ? "−" : "+"}
                      </span>
                    </button>

                    {expanded && (
                      <div className="space-y-4 border-t border-border bg-bg-elevated p-2 sm:p-4">
                        {dynamicCategories.length > 0 && (
                          <>
                            <div>
                              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">Select View</p>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                                {dynamicViews.map((view) => {
                                  const selected = Number(manualRejectionView?.id) === Number(view.id);
                                  return (
                                    <button
                                      key={view.id}
                                      type="button"
                                      onClick={() => {
                                        setManualRejectionView(view);
                                        setManualRejectionZone(null);
      setManualRejectionSubZone(null);
                                        setManualReason("");
                                        setManualReasonQuery("");
                                      }}
                                      className={`min-h-[54px] rounded-xl border-2 px-3 py-2 text-center text-xs font-black uppercase transition ${
                                        selected
                                          ? "border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                                          : "border-slate-300 bg-white text-slate-800 hover:border-blue-400"
                                      }`}
                                    >
                                      {view.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {manualRejectionView && (
                              <div>
                                <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">Select Zone</p>
                                <div className="grid gap-3 xl:grid-cols-[minmax(320px,1fr)_220px]">
                                  <div className="relative aspect-video min-h-[220px] overflow-hidden rounded-xl border-2 border-border bg-bg-dark sm:min-h-[300px]">
                                    {manualRejectionView.imageUrl ? (
                                      <img src={manualRejectionView.imageUrl} alt={manualRejectionView.name} className="h-full w-full object-contain" />
                                    ) : (
                                      <div className="flex aspect-[4/3] items-center justify-center bg-slate-300 text-sm font-black uppercase tracking-wider text-slate-700">
                                        {manualRejectionView.name}
                                      </div>
                                    )}
                                    {popupVerticalDividers.map((position, index) => (
                                      <span key={`popup-v-${index}`} className="pointer-events-none absolute inset-y-0 z-20 border-l-4 border-dotted border-red-600" style={{ left: `${position}%` }} />
                                    ))}
                                    {popupHorizontalDividers.map((position, index) => (
                                      <span key={`popup-h-${index}`} className="pointer-events-none absolute inset-x-0 z-20 border-t-4 border-dotted border-red-600" style={{ top: `${position}%` }} />
                                    ))}
                                    {popupZones.map((zone, zoneIndex) => {
                                      const selected = Number(manualRejectionZone?.id) === Number(zone.id);
                                      return (
                                        <button
                                          key={zone.id}
                                          type="button"
                                          onClick={() => {
                                            setManualRejectionZone(zone);
                          setManualRejectionSubZone(null);
                                            setManualReason("");
                                            setManualReasonQuery("");
                                          }}
                                          className={`absolute flex items-center justify-center text-lg font-black transition ${
                                            selected
                                              ? "z-10 bg-green-500/25 text-green-950"
                                              : "text-blue-950"
                                          }`}
                                          style={{
                                            left: `${zone.xPercent}%`,
                                            top: `${zone.yPercent}%`,
                                            width: `${Math.max(8, zone.widthPercent)}%`,
                                            height: `${Math.max(8, zone.heightPercent)}%`,
                                          }}
                                        >
                                          <span className={`flex h-10 min-w-10 items-center justify-center rounded-md border-2 px-2 text-base font-black shadow-md ${
                                            selected
                                              ? "border-green-700 bg-green-500 text-white"
                                              : NG_ZONE_LABEL_STYLES[zoneIndex % NG_ZONE_LABEL_STYLES.length]
                                          }`}>
                                            {zone.code || zone.name}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div className="rounded-xl border border-border bg-bg-card p-3">
                                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">Zones</p>
                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                      {(manualRejectionView.zones || []).map((zone) => {
                                        const selected = Number(manualRejectionZone?.id) === Number(zone.id);
                                        return (
                                          <button
                                            key={zone.id}
                                            type="button"
                                            onClick={() => {
                                              setManualRejectionZone(zone);
                          setManualRejectionSubZone(null);
                                              setManualReason("");
                                              setManualReasonQuery("");
                                            }}
                                            className={`rounded-lg border px-3 py-2 text-sm font-black ${
                                              selected ? "border-green-600 bg-green-500 text-white" : "border-slate-300 bg-slate-50 text-slate-900"
                                            }`}
                                          >
                                            {zone.name || zone.code}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        <div>
                          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">Select Rejection Reason</p>
                          {dynamicCategories.length > 0 && (!manualRejectionView || !manualRejectionZone) ? (
                            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                              Select view and zone to show zone-wise rejection reasons.
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {ngReasonOptions.map((reason) => {
                            const selected = manualReason === reason;
                            return (
                              <button
                                key={reason}
                                type="button"
                                onClick={() => {
                                  setManualReasonCategory(categoryKey);
                                  setManualReason(reason);
                                  setManualReasonQuery(reason);
                                  setValidationError("");
                                }}
                                className={`min-h-[48px] rounded-xl border-2 px-3 py-3 text-left text-[15px] font-black leading-snug transition active:scale-[0.99] sm:text-base ${
                                  selected
                                    ? "border-rose-500 bg-rose-600 text-white shadow-lg shadow-rose-500/25"
                                    : "border-slate-300 bg-white text-slate-900 hover:border-amber-400 hover:bg-amber-50"
                                }`}
                              >
                                {reason}
                              </button>
                            );
                          })}
                            </div>
                          )}
                        </div>

                        {dynamicCategories.length > 0 && (
                          <div>
                            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">Remark</p>
                            <textarea
                              value={manualRejectionRemark}
                              onChange={(event) => setManualRejectionRemark(event.target.value)}
                              rows={2}
                              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-rose-400"
                              placeholder="Optional remark"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-border bg-bg-card p-3 sm:grid-cols-[0.65fr_1fr] sm:p-4 md:p-5">
            <button
              type="button"
              onClick={() => setShowNgReasonModal(false)}
              className="rounded-xl border-2 border-border bg-bg-elevated py-3 md:py-3.5 text-base font-black text-text-main transition hover:border-primary"
            >
              {t("globalPopup.cancel", "Cancel")}
            </button>
            <button
              type="button"
              disabled={!manualReason || (dynamicCategories.length > 0 && (!manualRejectionView || !manualRejectionZone))}
              onClick={() => setShowNgReasonModal(false)}
              className={`rounded-xl py-3 md:py-3.5 text-base font-black uppercase tracking-widest transition ${
                manualReason && (dynamicCategories.length === 0 || (manualRejectionView && manualRejectionZone))
                  ? "border-2 border-green-700 bg-green-600 text-white shadow-lg shadow-green-600/20 hover:bg-green-500"
                  : "cursor-not-allowed border-2 border-border bg-bg-elevated text-text-muted"
              }`}
            >
              {manualReason && (dynamicCategories.length === 0 || (manualRejectionView && manualRejectionZone))
                ? t("globalPopup.confirmReason", "Confirm Reason")
                : ngWizardStep === 1 ? "Select a View"
                  : ngWizardStep === 2 ? "Select a Zone"
                    : ngWizardStep === 3 ? "Select a Category"
                      : t("globalPopup.selectReasonFirst", "Select Reason First")}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default React.memo(GlobalPopup);
