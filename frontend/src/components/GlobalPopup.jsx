import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, Clock3, Cpu, ShieldCheck, X, XCircle } from "lucide-react";

function resolveQrState(popup = {}) {
  const decision = String(
    popup.qrResult || popup.qrDecision || popup.decision || popup.outcome || popup.scanOutcome || popup.qrStatus || ""
  )
    .trim()
    .toUpperCase();

  if (["ALLOW", "PASS", "OK", "ACCEPT", "VALID"].includes(decision)) {
    return "PASS";
  }
  if (["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(decision)) {
    return "FAIL";
  }

  return "WAIT";
}

function resolveOperationState(popup = {}) {
  const status = String(popup.plcStatus || popup.operationStatus || popup.status || "")
    .trim()
    .toUpperCase();

  if (["ENDED_OK", "PASSED", "COMPLETED"].includes(status)) {
    return "PASS";
  }

  if (["ENDED_NG", "FAILED", "NG", "INTERLOCKED", "BLOCKED"].includes(status)) {
    return "FAIL";
  }

  if (["PLC_COMM_ERROR", "COMM_ERROR", "PLC_TIMEOUT", "TIMEOUT"].includes(status)) {
    return "COMM";
  }

  if (["STARTED", "PENDING", "IN_PROGRESS"].includes(status)) {
    return "RUN";
  }

  return "WAIT";
}

function resolveRejectionState(popup = {}, operationState) {
  const explicit = String(popup.rejectionStatus || popup.rejectionDecision || "").trim().toUpperCase();
  if (["PASS", "FAIL", "PENDING"].includes(explicit)) {
    return explicit;
  }

  if (operationState === "FAIL") {
    return "FAIL";
  }
  if (operationState === "PASS") {
    return "PASS";
  }
  return "PENDING";
}

function getSignalMeta(state) {
  if (state === "PASS") {
    return {
      label: "PASS",
      icon: CheckCircle,
      textTone: "text-emerald-600",
      badgeTone: "bg-emerald-100 text-emerald-700",
    };
  }
  if (state === "FAIL") {
    return {
      label: "FAIL",
      icon: XCircle,
      textTone: "text-red-600",
      badgeTone: "bg-red-100 text-red-700",
    };
  }
  if (state === "COMM") {
    return {
      label: "COMM",
      icon: AlertTriangle,
      textTone: "text-orange-600",
      badgeTone: "bg-orange-100 text-orange-700",
    };
  }
  if (state === "RUN") {
    return {
      label: "RUN",
      icon: Clock3,
      textTone: "text-amber-600",
      badgeTone: "bg-amber-100 text-amber-700",
    };
  }
  return {
    label: "WAIT",
    icon: Clock3,
    textTone: "text-slate-500",
    badgeTone: "bg-slate-100 text-slate-700",
  };
}

const GlobalPopup = ({
  popup,
  onClose,
  onResetOperation,
  autoCloseMs = 4000,
  criticalAutoCloseMs = 9000,
  showAcknowledge = false,
}) => {
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    setResetError("");
    setIsResetting(false);
    setShowResetConfirm(false);
  }, [popup?.partId, popup?.stationNo, popup?.message]);

  useEffect(() => {
    if (!popup) {
      return undefined;
    }

    const popupType = String(popup.type || "INFO").toUpperCase();
    const partId = String(popup.partId || popup.part_id || "").trim();
    const stationNo = String(popup.stationNo || popup.station_no || "").trim();
    const qrState = resolveQrState(popup);
    const operationState = resolveOperationState(popup);
    const isCritical = popupType === "ERROR" || qrState === "FAIL" || operationState === "FAIL" || operationState === "COMM";
    // If popup has no useful station/part state, auto-dismiss quickly.
    const hasStateDetails = Boolean(partId || stationNo || qrState !== "WAIT" || operationState !== "WAIT");
    if (!hasStateDetails) {
      const fallbackTimer = setTimeout(() => onClose?.(), 2500);
      return () => clearTimeout(fallbackTimer);
    }

    const timeoutMs = isCritical ? Number(criticalAutoCloseMs) : Number(autoCloseMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return undefined;
    }

    const timer = setTimeout(() => onClose?.(), timeoutMs);
    return () => clearTimeout(timer);
  }, [popup, onClose, autoCloseMs, criticalAutoCloseMs, onResetOperation]);

  if (!popup) {
    return null;
  }

  const type = String(popup.type || "INFO").toUpperCase();
  const partId = popup.partId || popup.part_id || "";
  const stationNo = popup.stationNo || popup.station_no || "";
  const qrState = resolveQrState(popup);
  const operationState = resolveOperationState(popup);
  const rejectionState = resolveRejectionState(popup, operationState);
  const qrMeta = getSignalMeta(qrState);
  const operationMeta = getSignalMeta(operationState);
  const rejectionMeta = getSignalMeta(rejectionState === "PENDING" ? "WAIT" : rejectionState);
  const QrIcon = qrMeta.icon;
  const OperationIcon = operationMeta.icon;
  const RejectionIcon = rejectionMeta.icon;

  const headerTheme =
    operationState === "PASS"
      ? "bg-emerald-600"
      : operationState === "FAIL" || qrState === "FAIL"
      ? "bg-red-600"
      : operationState === "COMM"
      ? "bg-orange-500"
      : qrState === "PASS"
      ? "bg-cyan-600"
      : "bg-amber-500";

  const HeaderIcon =
    operationState === "PASS"
      ? ShieldCheck
      : operationState === "FAIL" || qrState === "FAIL" || operationState === "COMM"
      ? AlertTriangle
      : Clock3;

  const headerTitle =
    popup.title ||
    (operationState === "PASS"
      ? "OP PASS"
      : operationState === "FAIL"
      ? "OP FAIL"
      : operationState === "COMM"
      ? "OP COMM"
      : qrState === "PASS"
      ? "QR PASS"
      : qrState === "FAIL"
      ? "QR FAIL"
      : type);

  const messageTone =
    operationState === "FAIL" || qrState === "FAIL"
      ? "text-red-600"
      : operationState === "COMM"
      ? "text-orange-600"
      : "text-slate-700";

  const canReset =
    (operationState === "COMM" || operationState === "FAIL") &&
    Boolean(partId) &&
    Boolean(stationNo) &&
    typeof onResetOperation === "function";

  const handleReset = async () => {
    if (!partId || !stationNo || isResetting) {
      return;
    }

    setIsResetting(true);
    setResetError("");
    try {
      const completed = await onResetOperation(partId, stationNo, { confirmed: true });
      if (completed === false) {
        return;
      }
      setShowResetConfirm(false);
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      const apiError = String(error?.response?.data?.error || "").trim().toUpperCase();
      if (status === 401 || apiError.includes("UNAUTHORIZED") || apiError.includes("NO TOKEN")) {
        setResetError("Session expired. Please login again.");
      } else {
        setResetError(error.response?.data?.error || "Reset failed");
      }
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in zoom-in duration-200">
        <div className={`relative p-6 flex items-center gap-4 text-white ${headerTheme}`}>
          {typeof onClose === "function" ? (
            <button
              onClick={() => onClose?.()}
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/10 text-white hover:bg-black/25"
              aria-label="Close popup"
              title="Close"
            >
              <X size={16} />
            </button>
          ) : null}
          <HeaderIcon size={40} />
          <div>
            <h2 className="text-2xl font-black uppercase italic tracking-tighter leading-none">{headerTitle}</h2>
            <p className="text-xs font-bold opacity-80 mt-1 uppercase tracking-widest">
              Station: {stationNo || "System Process"}
            </p>
          </div>
        </div>

        <div className="p-8 space-y-6">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Cpu size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Component Identity</span>
            </div>
            <p className="text-xl font-mono font-bold text-slate-800 break-all">{partId || "WAITING FOR SCAN"}</p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-600 font-bold uppercase text-xs">QR Validation</span>
              <div className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${qrMeta.badgeTone}`}>
                <QrIcon size={14} className={qrMeta.textTone} />
                <span>{qrMeta.label}</span>
              </div>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-600 font-bold uppercase text-xs">PLC Handshake</span>
              <div
                className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${operationMeta.badgeTone}`}
              >
                <OperationIcon size={14} className={operationMeta.textTone} />
                <span>{operationMeta.label}</span>
              </div>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-600 font-bold uppercase text-xs">Rejection Confirmation</span>
              <div
                className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${rejectionMeta.badgeTone}`}
              >
                <RejectionIcon size={14} className={rejectionMeta.textTone} />
                <span>{rejectionState}</span>
              </div>
            </div>
          </div>

          <div>
            <p className={`text-lg font-bold ${messageTone}`}>{popup.message || "Live station update received."}</p>
          </div>

          {showAcknowledge ? (
            <button
              onClick={() => onClose?.()}
              className="w-full bg-slate-900 text-white py-4 rounded-xl font-black uppercase tracking-widest hover:bg-black transition-all active:scale-95"
            >
              Close
            </button>
          ) : null}

          {canReset && !showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              disabled={isResetting}
              className="w-full mt-3 bg-red-600 text-white py-3 rounded-xl font-black uppercase tracking-widest hover:bg-red-700 transition-all disabled:opacity-60"
            >
              {isResetting ? "Resetting..." : "Reset Operation"}
            </button>
          ) : null}

          {canReset && showResetConfirm ? (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
              <p className="text-sm font-semibold text-red-700">
                Confirm reset for <span className="font-mono">{partId}</span> at <span className="font-semibold">{stationNo}</span>?
              </p>
              <p className="text-xs text-red-600">This will clear current operation state and require re-scan.</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  disabled={isResetting}
                  className="w-full rounded-lg border border-red-200 bg-white py-2 text-xs font-bold uppercase tracking-wide text-red-700 hover:bg-red-100 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReset}
                  disabled={isResetting}
                  className="w-full rounded-lg bg-red-600 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {isResetting ? "Resetting..." : "Confirm Reset"}
                </button>
              </div>
            </div>
          ) : null}

          {resetError ? <p className="text-sm font-semibold text-red-600">{resetError}</p> : null}
        </div>
      </div>
    </div>
  );
};

export default GlobalPopup;
