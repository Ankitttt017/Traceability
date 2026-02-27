import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Factory,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { machineApi, stationSettingsApi, traceabilityApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import { getMachineStage } from "../utils/machineFields";
import { getStationFeatureSettings, getStationFeatures, saveStationFeatureSettings } from "../utils/stationSettings";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const LIVE_REFRESH_COOLDOWN_MS = 350;
const QR_EVENT_DEDUPE_MS = 3000;
const POPUP_EVENT_DEDUPE_MS = 1800;
const OPERATOR_QR_STATE_STORAGE_KEY = "operator-last-qr-signal";

function normalizePartId(value) {
  return String(value || "").trim();
}

function extractQrDecision(payload = {}) {
  const primary = String(
    payload.qrResult || payload.decision || payload.outcome || payload.scanOutcome || payload.qrDecision || payload.qrStatus || ""
  )
    .trim()
    .toUpperCase();

  if (primary) {
    return primary;
  }

  const fallback = String(payload.reason || payload.result || "")
    .trim()
    .toUpperCase();
  if (["PASS", "OK", "ALLOW"].includes(fallback)) {
    return "ALLOW";
  }
  if (["FAIL", "NG", "BLOCK", "REJECT"].includes(fallback)) {
    return "BLOCK";
  }
  return "";
}

function hasQrDecision(payload = {}) {
  const decision = extractQrDecision(payload);
  return ["ALLOW", "PASS", "OK", "ACCEPT", "VALID", "BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(decision);
}

function toQrSignal(payload = {}) {
  const decision = extractQrDecision(payload);
  let label = "QR WAIT";
  let tone = "border-slate-500/60 bg-slate-500/10";
  let textTone = "text-slate-200";

  if (["ALLOW", "PASS", "OK", "ACCEPT", "VALID"].includes(decision)) {
    label = "QR PASS";
    tone = "border-emerald-500/75 bg-emerald-500/14";
    textTone = "text-emerald-200";
  } else if (["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(decision)) {
    label = "QR FAIL";
    tone = "border-rose-500/75 bg-rose-500/14";
    textTone = "text-rose-200";
  }

  return {
    id: `${Date.now()}-${Math.random()}`,
    label,
    tone,
    textTone,
    partId: normalizePartId(payload.partId || payload.part_id),
    stationNo: String(payload.stationNo || payload.station_no || "").trim().toUpperCase(),
    decision,
    reason: String(payload.reason || payload.qrReason || "").trim(),
    message: String(payload.message || "").trim(),
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}

function formatScanErrorMessage(payload = {}) {
  const reason = String(payload.reason || "").trim().toUpperCase();
  const station = String(payload.stationNo || payload.station_no || "").trim().toUpperCase();
  const expected = String(payload.expectedStation || payload.expected_station || "").trim().toUpperCase();

  if (reason === "DUPLICATE_SCAN") {
    return `Duplicate scan at ${station || "station"}. Reset required before re-scan.`;
  }
  if (reason === "PREVIOUS_STATION_NOT_COMPLETED") {
    return expected
      ? `Station sequence error. Complete ${expected} first.`
      : "Station sequence error. Previous station not completed.";
  }
  if (reason === "INVALID_QR_FORMAT") {
    return "Invalid QR format. Scan correct component code.";
  }
  if (reason === "ALREADY_COMPLETED") {
    return "Part already completed. Re-scan is not allowed.";
  }
  if (reason === "PART_INTERLOCKED") {
    return "Part interlocked. Reset required from control flow.";
  }
  if (reason === "STATION_NOT_CONFIGURED") {
    return "Station not configured in machine master. Contact supervisor.";
  }
  if (reason === "INVALID_INPUT") {
    return "Invalid scan input. Re-scan the QR code.";
  }
  if (reason === "SCAN_RESULT_NG") {
    return "QR validation failed (NG). Send part to rejection flow.";
  }
  if (reason) {
    return reason.replaceAll("_", " ");
  }
  return String(payload.message || "Scan blocked");
}

function shouldSuppressPopupPayload(payload = {}) {
  const partId = normalizePartId(payload.partId || payload.part_id);
  const station = String(payload.stationNo || payload.station_no || "").trim();
  const message = String(payload.message || payload.error || "").trim().toUpperCase();

  if (!partId && !station && !message) {
    return true;
  }

  if (!partId && message.includes("PART NOT FOUND")) {
    return true;
  }

  return false;
}

function normalizeDecisionState(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (["ALLOW", "PASS", "OK", "ACCEPT", "VALID"].includes(normalized)) {
    return "PASS";
  }
  if (["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(normalized)) {
    return "FAIL";
  }
  if (normalized === "WAIT") {
    return "WAIT";
  }
  return "";
}

function isResetLikePayload(payload = {}) {
  const status = String(payload.status || payload.plcStatus || payload.plc_status || "").trim().toUpperCase();
  const reason = String(payload.reason || payload.qrReason || "").trim().toUpperCase();
  const message = String(payload.message || "").trim().toUpperCase();

  return status === "RESET" || reason.includes("RESET") || message.includes("RESET");
}

function getOperationSignal(status) {
  const state = String(status || "").trim().toUpperCase();
  if (state === "ENDED_OK" || state === "PASSED") {
    return {
      label: "OP PASS",
      tone: "border-emerald-500/75 bg-emerald-500/14",
      textTone: "text-emerald-200",
    };
  }
  if (state === "ENDED_NG" || state === "INTERLOCKED" || state === "FAILED") {
    return {
      label: "OP FAIL",
      tone: "border-rose-500/75 bg-rose-500/14",
      textTone: "text-rose-200",
    };
  }
  if (state === "PLC_COMM_ERROR" || state === "COMM_ERROR") {
    return {
      label: "OP COMM",
      tone: "border-orange-400/75 bg-orange-400/14",
      textTone: "text-orange-200",
    };
  }
  if (state === "STARTED" || state === "PENDING" || state === "IN_PROGRESS") {
    return {
      label: "OP RUN",
      tone: "border-amber-500/70 bg-amber-500/12",
      textTone: "text-amber-200",
    };
  }
  return {
    label: "OP WAIT",
    tone: "border-slate-500/60 bg-slate-500/10",
    textTone: "text-slate-200",
  };
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function formatElapsedTime(timestamp, now) {
  if (!timestamp) {
    return "0m 00s";
  }
  const start = new Date(timestamp).getTime();
  if (Number.isNaN(start)) {
    return "0m 00s";
  }
  const diff = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

const OperatorView = () => {
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  }, []);

  const [machines, setMachines] = useState([]);
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [liveState, setLiveState] = useState(null);
  const [stationStats, setStationStats] = useState(null);
  const [stationSettings, setStationSettings] = useState(() => getStationFeatureSettings());
  const [loadingMachines, setLoadingMachines] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [popup, setPopup] = useState(null);
  const [qrSignal, setQrSignal] = useState(null);
  const [qrFeed, setQrFeed] = useState([]);
  const [clockTick, setClockTick] = useState(Date.now());

  const selectedMachineIdRef = useRef("");
  const selectedStationRef = useRef("");
  const liveRefreshTimerRef = useRef(null);
  const lastLiveRefreshRef = useRef(0);
  const lastQrEventRef = useRef({ key: "", at: 0 });
  const lastPopupEventRef = useRef({ key: "", at: 0 });

  const selectedMachine = useMemo(
    () => machines.find((entry) => entry.id === Number(selectedMachineId)) || null,
    [machines, selectedMachineId]
  );

  const selectedStation = useMemo(() => getMachineStage(selectedMachine), [selectedMachine]);

  useEffect(() => {
    selectedMachineIdRef.current = String(selectedMachineId || "");
  }, [selectedMachineId]);

  useEffect(() => {
    selectedStationRef.current = String(selectedStation || "").toUpperCase();
  }, [selectedStation]);

  const stationFeatureConfig = useMemo(
    () => getStationFeatures(selectedStation, stationSettings),
    [selectedStation, stationSettings]
  );

  const qualitySummary = stationStats?.summary || {
    okCount: 0,
    ngCount: 0,
    interlockedCount: 0,
    inProgressCount: 0,
    processedCount: 0,
    accuracy: 0,
  };

  const expectedCount = Math.max(
    Number(qualitySummary.processedCount || 0) +
      Number(qualitySummary.inProgressCount || 0) +
      Number(qualitySummary.interlockedCount || 0),
    1
  );
  const producedCount = Number(qualitySummary.processedCount || 0);
  const progressPercent = Math.min(100, Math.round((producedCount / expectedCount) * 100));
  const qualityPercent = Number(qualitySummary.accuracy || 0);
  const machineMode = liveState?.current ? "Running" : liveState?.lastEvent ? "Idle" : "Waiting";
  const machineClock = formatElapsedTime(
    liveState?.current?.createdAt || liveState?.lastEvent?.createdAt,
    clockTick
  );

  const currentContext = liveState?.current || stationStats?.current || liveState?.lastEvent || stationStats?.lastEvent || null;
  const plcHealth = liveState?.plcHealth || stationStats?.plcHealth || null;
  const scannerHealth = liveState?.scannerHealth || stationStats?.scannerHealth || null;
  const plcConnected = Boolean(plcHealth?.healthy);
  const scannerConfigured = String(scannerHealth?.status || "").toUpperCase() !== "NOT_CONFIGURED";
  const scannerConnected = Boolean(scannerHealth?.connected);
  const operationSignal = useMemo(
    () => getOperationSignal(currentContext?.plcStatus),
    [currentContext?.plcStatus]
  );
  const canQuickReset = useMemo(() => {
    if (!currentContext?.partId || !selectedStation) {
      return false;
    }
    const state = String(currentContext?.plcStatus || "").trim().toUpperCase();
    return ["ENDED_NG", "FAILED", "NG", "INTERLOCKED", "PLC_COMM_ERROR", "COMM_ERROR", "TIMEOUT", "PLC_TIMEOUT"].includes(state);
  }, [currentContext?.partId, currentContext?.plcStatus, selectedStation]);

  const rejectionSummary = useMemo(() => {
    const rows = stationStats?.recentParts || [];
    const grouped = rows.reduce((acc, row) => {
      const hasRejection = Boolean(row.interlockReason) || String(row.result || "").toUpperCase() === "NG";
      const reason = hasRejection ? row.interlockReason || "NG without reason" : null;
      if (!reason) {
        return acc;
      }
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [stationStats?.recentParts]);

  const trendRows = useMemo(() => {
    return [...(stationStats?.trend || [])].slice(-6);
  }, [stationStats?.trend]);

  const loadMachines = useCallback(async () => {
    setLoadingMachines(true);
    try {
      const rows = await machineApi.list();
      setMachines(rows || []);
      if ((rows || []).length > 0) {
        setSelectedMachineId((current) => current || String(rows[0].id));
      } else {
        setSelectedMachineId("");
      }
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Machine Load Failed",
        message: error.response?.data?.error || "Unable to load machines",
      });
    } finally {
      setLoadingMachines(false);
    }
  }, []);

  const loadMachineTelemetry = useCallback(async (machineId, showLoader = true) => {
    const id = Number(machineId || 0);
    if (!id) {
      setLiveState(null);
      setStationStats(null);
      return;
    }

    if (showLoader) {
      setLoadingStats(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [live, stats] = await Promise.all([
        traceabilityApi.liveState(id),
        traceabilityApi.machineStats(id),
      ]);
      setLiveState(live || null);
      setStationStats(stats || null);
    } catch (error) {
      if (showLoader) {
        setPopup({
          type: "ERROR",
          title: "Station Data Error",
          message: error.response?.data?.error || "Unable to load machine telemetry",
        });
      }
    } finally {
      setLoadingStats(false);
      setRefreshing(false);
    }
  }, []);

  const scheduleLiveRefresh = useCallback(() => {
    const activeMachine = selectedMachineIdRef.current;
    if (!activeMachine) {
      return;
    }

    const now = Date.now();
    const elapsed = now - lastLiveRefreshRef.current;
    const delay = Math.max(0, LIVE_REFRESH_COOLDOWN_MS - elapsed);
    if (liveRefreshTimerRef.current) {
      return;
    }

    liveRefreshTimerRef.current = setTimeout(() => {
      liveRefreshTimerRef.current = null;
      lastLiveRefreshRef.current = Date.now();
      loadMachineTelemetry(activeMachine, false);
    }, delay);
  }, [loadMachineTelemetry]);

  const isDuplicatePopupEvent = useCallback((payload = {}) => {
    const key = [
      String(payload.type || "").trim().toUpperCase(),
      normalizePartId(payload.partId || payload.part_id),
      String(payload.stationNo || payload.station_no || "").trim().toUpperCase(),
      normalizeDecisionState(payload.qrResult || payload.qr_result),
      String(payload.plcStatus || payload.plc_status || "").trim().toUpperCase(),
      String(payload.reason || payload.qrReason || "").trim().toUpperCase(),
      String(payload.message || "").trim().toUpperCase(),
    ].join("|");

    if (!key.replaceAll("|", "")) {
      return false;
    }

    const now = Date.now();
    if (lastPopupEventRef.current.key === key && now - lastPopupEventRef.current.at < POPUP_EVENT_DEDUPE_MS) {
      return true;
    }

    lastPopupEventRef.current = { key, at: now };
    return false;
  }, []);

  const processQrSignal = useCallback((payload = {}) => {
    if (!hasQrDecision(payload)) {
      return false;
    }

    const payloadMachine = String(payload.machineId || payload.machine_id || "");
    const payloadStation = String(payload.stationNo || payload.station_no || "").trim().toUpperCase();
    const activeMachine = selectedMachineIdRef.current;
    const activeStation = selectedStationRef.current;
    const relevantByMachine = payloadMachine && payloadMachine === activeMachine;
    const relevantByStation = payloadStation && payloadStation === activeStation;
    const isRelevant = relevantByMachine || relevantByStation;

    if (!isRelevant) {
      return false;
    }

    const signal = toQrSignal(payload);
    const dedupeReason = ["BLOCK", "FAIL", "NG", "REJECT", "INVALID"].includes(signal.decision) ? signal.reason : "";
    const dedupeKey = [signal.partId, signal.stationNo, signal.decision, dedupeReason].join("|");
    const now = Date.now();
    if (lastQrEventRef.current.key === dedupeKey && now - lastQrEventRef.current.at < QR_EVENT_DEDUPE_MS) {
      return false;
    }
    lastQrEventRef.current = { key: dedupeKey, at: now };

    setQrSignal(signal);
    setQrFeed((prev) => [signal, ...prev].slice(0, 6));

    const machineKey = selectedMachineIdRef.current;
    if (machineKey) {
      try {
        const current = JSON.parse(localStorage.getItem(OPERATOR_QR_STATE_STORAGE_KEY) || "{}");
        current[machineKey] = signal;
        localStorage.setItem(OPERATOR_QR_STATE_STORAGE_KEY, JSON.stringify(current));
      } catch {
        // Ignore localStorage failures.
      }
    }

    return true;
  }, []);

  const mergePopupPayload = useCallback((payload = {}) => {
    setPopup((prev) => {
      const incomingQrRaw = payload.qrResult || payload.qr_result || "";
      const incomingQrState = normalizeDecisionState(incomingQrRaw);
      const previousQrState = normalizeDecisionState(prev?.qrResult || prev?.qr_result || "");

      const incomingPlcRaw = payload.plcStatus || payload.plc_status || "";
      const incomingPlcState = String(incomingPlcRaw || "").trim().toUpperCase();
      const previousPlcState = String(prev?.plcStatus || prev?.plc_status || "").trim().toUpperCase();
      const resetLike = isResetLikePayload(payload);

      // Prevent noisy WAIT payloads from wiping a valid PASS/FAIL unless this is a reset flow.
      const shouldApplyQr =
        Boolean(incomingQrRaw) &&
        (incomingQrState !== "WAIT" || !previousQrState || previousQrState === "WAIT" || resetLike);
      const shouldApplyPlc =
        Boolean(incomingPlcRaw) &&
        (incomingPlcState !== "WAIT" || !previousPlcState || previousPlcState === "WAIT" || resetLike);

      return {
        ...prev,
        ...(payload.type && { type: payload.type }),
        ...(payload.title && { title: payload.title }),
        ...(shouldApplyQr && { qrResult: incomingQrRaw }),
        ...(shouldApplyPlc && { plcStatus: incomingPlcRaw }),
        ...(payload.message && { message: payload.message }),
        ...(payload.reason && { reason: payload.reason }),
        ...(payload.expectedStation && { expectedStation: payload.expectedStation }),
        ...((payload.partId || payload.part_id) && { partId: payload.partId || payload.part_id }),
        ...((payload.stationNo || payload.station_no) && { stationNo: payload.stationNo || payload.station_no }),
        ...((payload.machineId || payload.machine_id) && { machineId: payload.machineId || payload.machine_id }),
        ...(payload.machineName && { machineName: payload.machineName }),
        ...(payload.timestamp && { timestamp: payload.timestamp }),
      };
    });
  }, []);

  const handleResetOperation = useCallback(async (partId, stationNo, options = {}) => {
    const normalizedPartId = normalizePartId(partId);
    const normalizedStation = String(stationNo || "").trim().toUpperCase();
    if (!normalizedPartId || !normalizedStation) {
      return false;
    }

    if (!options.confirmed) {
      const confirmed = window.confirm(`Reset operation for part ${normalizedPartId} at ${normalizedStation}?`);
      if (!confirmed) {
        return false;
      }
    }

    const response = await traceabilityApi.resetOperation({ partId: normalizedPartId, stationNo: normalizedStation });

    const machineKey = selectedMachineIdRef.current;
    if (machineKey) {
      try {
        const current = JSON.parse(localStorage.getItem(OPERATOR_QR_STATE_STORAGE_KEY) || "{}");
        delete current[machineKey];
        localStorage.setItem(OPERATOR_QR_STATE_STORAGE_KEY, JSON.stringify(current));
      } catch {
        // Ignore localStorage failures.
      }
    }

    setQrSignal(null);
    setQrFeed([]);
    mergePopupPayload({
      type: "INFO",
      partId: normalizedPartId,
      stationNo: normalizedStation,
      qrResult: "WAIT",
      plcStatus: "WAIT",
      message: response?.message || "Operation reset successful",
    });
    scheduleLiveRefresh();
    return true;
  }, [mergePopupPayload, scheduleLiveRefresh]);

  useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  useEffect(() => {
    if (!selectedMachineId) {
      return;
    }
    loadMachineTelemetry(selectedMachineId, true);
  }, [selectedMachineId, loadMachineTelemetry]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!selectedMachineIdRef.current) {
        return;
      }
      loadMachineTelemetry(selectedMachineIdRef.current, false);
    }, 15000);
    return () => clearInterval(interval);
  }, [loadMachineTelemetry]);

  useEffect(() => {
    const interval = setInterval(() => {
      setClockTick(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const syncSettings = async () => {
      try {
        const remote = await stationSettingsApi.list();
        if (remote && Object.keys(remote).length > 0) {
          setStationSettings(remote);
          saveStationFeatureSettings(remote);
          return;
        }
      } catch {
        // Fallback to local cached settings.
      }
      setStationSettings(getStationFeatureSettings());
    };

    syncSettings();
    const onFocus = () => {
      syncSettings();
    };
    const onStorage = () => {
      setStationSettings(getStationFeatureSettings());
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
    });

    socket.on("scan_event", (payload = {}) => {
      const isRelevantSignal = processQrSignal(payload);
      if (isRelevantSignal) {
        const decision = extractQrDecision(payload);
        if (decision === "BLOCK") {
          if (isDuplicatePopupEvent({ ...payload, type: "ERROR" })) {
            scheduleLiveRefresh();
            return;
          }
          if (shouldSuppressPopupPayload(payload)) {
            scheduleLiveRefresh();
            return;
          }
          mergePopupPayload({
            type: "ERROR",
            title: "Scan Blocked",
            message: formatScanErrorMessage(payload),
            reason: payload.reason || "",
            partId: payload.partId || payload.part_id,
            stationNo: payload.stationNo || payload.station_no,
            machineId: payload.machineId || payload.machine_id,
            qrResult: "FAIL",
            plcStatus: "WAIT",
            timestamp: payload.timestamp,
          });
        }
        scheduleLiveRefresh();
      }
    });

    socket.on("journey_update", (payload = {}) => {
      if (String(payload.sourceEvent || "").toLowerCase() === "scan_event") {
        return;
      }
      if (hasQrDecision(payload) && processQrSignal(payload)) {
        scheduleLiveRefresh();
      }
    });

    socket.on("operator_popup", (payload = {}) => {
      if (shouldSuppressPopupPayload(payload)) {
        return;
      }
      if (isDuplicatePopupEvent(payload)) {
        return;
      }

      const payloadStation = String(payload.stationNo || payload.station_no || "").trim().toUpperCase();
      const payloadMachine = String(payload.machineId || payload.machine_id || "");
      const activeMachine = selectedMachineIdRef.current;
      const activeStation = selectedStationRef.current;
      const isRelevant = payloadMachine === activeMachine || (payloadStation && payloadStation === activeStation);

      if (!isRelevant) {
        return;
      }
      const normalizedMessage =
        String(payload.type || "").toUpperCase() === "ERROR" && String(payload.reason || payload.qrReason || "").trim()
          ? formatScanErrorMessage({ ...payload, reason: payload.reason || payload.qrReason })
          : payload.message;
      mergePopupPayload({
        ...payload,
        ...(normalizedMessage ? { message: normalizedMessage } : {}),
      });
      if (hasQrDecision(payload) || String(payload.sourceEvent || "").toLowerCase() === "scan_event") {
        processQrSignal(payload);
      }
      scheduleLiveRefresh();
    });

    socket.on("dashboard_refresh", () => {
      scheduleLiveRefresh();
    });

    socket.on("plc_health", (payload = {}) => {
      const payloadMachine = String(payload.machineId || payload.machine_id || "");
      if (payloadMachine && payloadMachine === selectedMachineIdRef.current) {
        scheduleLiveRefresh();
      }
    });

    socket.on("scanner_health", (payload = {}) => {
      const payloadMachine = String(payload.machineId || payload.machine_id || "");
      if (payloadMachine && payloadMachine === selectedMachineIdRef.current) {
        scheduleLiveRefresh();
      }
    });

    return () => {
      if (liveRefreshTimerRef.current) {
        clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
      socket.disconnect();
    };
  }, [scheduleLiveRefresh, processQrSignal, mergePopupPayload, isDuplicatePopupEvent]);

  useEffect(() => {
    const machineKey = String(selectedMachineId || "");
    if (!machineKey) {
      setQrSignal(null);
      setQrFeed([]);
      return;
    }

    try {
      const saved = JSON.parse(localStorage.getItem(OPERATOR_QR_STATE_STORAGE_KEY) || "{}");
      const restored = saved[machineKey] || null;
      if (restored) {
        setQrSignal(restored);
        setQrFeed([restored]);
        return;
      }
    } catch {
      // Ignore localStorage failures.
    }

    setQrSignal(null);
    setQrFeed([]);
  }, [selectedMachineId]);

  useEffect(() => {
    if (qrSignal || !currentContext?.partId) {
      return;
    }

    const state = String(currentContext?.plcStatus || "")
      .trim()
      .toUpperCase();
    if (!["PENDING", "STARTED", "ENDED_OK", "ENDED_NG", "PLC_COMM_ERROR"].includes(state)) {
      return;
    }

    const inferred = {
      id: `${Date.now()}-inferred`,
      label: "QR PASS",
      tone: "border-emerald-500/75 bg-emerald-500/14",
      textTone: "text-emerald-200",
      partId: normalizePartId(currentContext.partId),
      stationNo: String(selectedStation || "").trim().toUpperCase(),
      decision: "ALLOW",
      reason: "QR_VALIDATED",
      message: "Restored from latest station state",
      timestamp: currentContext.createdAt || new Date().toISOString(),
    };

    setQrSignal(inferred);
    setQrFeed((prev) => (prev.length ? prev : [inferred]));

    const machineKey = String(selectedMachineIdRef.current || "");
    if (machineKey) {
      try {
        const current = JSON.parse(localStorage.getItem(OPERATOR_QR_STATE_STORAGE_KEY) || "{}");
        current[machineKey] = inferred;
        localStorage.setItem(OPERATOR_QR_STATE_STORAGE_KEY, JSON.stringify(current));
      } catch {
        // Ignore localStorage failures.
      }
    }
  }, [currentContext?.partId, currentContext?.plcStatus, currentContext?.createdAt, selectedStation, qrSignal]);

  const gaugeStyle = useMemo(
    () => ({
      background: `conic-gradient(var(--app-primary) ${progressPercent * 3.6}deg, color-mix(in srgb, var(--app-bg-dark), #ffffff 6%) 0deg)`,
    }),
    [progressPercent]
  );

  const handleRefresh = () => {
    if (selectedMachineId) {
      loadMachineTelemetry(selectedMachineId, false);
    }
  };

  return (
    <div className="space-y-6">
      <GlobalPopup
        popup={popup}
        onClose={() => setPopup(null)}
        onResetOperation={handleResetOperation}
        autoCloseMs={3500}
        criticalAutoCloseMs={9000}
        showAcknowledge={false}
      />

      <section className="industrial-card p-6 overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none opacity-60 bg-[radial-gradient(circle_at_15%_20%,rgba(25,179,199,0.2),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(215,91,91,0.18),transparent_40%)]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            {/* <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold">Live Station Monitor</p> */}
            <h1 className="text-3xl font-bold text-text-main mt-1">
              {selectedMachine?.machineName || "Station Not Selected"}
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Job: {selectedMachine?.lineName || "LINE"} | Station: {selectedStation || "-"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[240px]">
              <label className="text-xs uppercase tracking-wide text-text-muted">Select Machine</label>
              <select
                value={selectedMachineId}
                onChange={(event) => setSelectedMachineId(event.target.value)}
                disabled={loadingMachines}
                className="mt-1.5 w-full rounded-xl border border-border bg-bg-dark px-3 py-2.5 text-sm text-text-main focus:border-primary focus:outline-none"
              >
                {machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.machineName} | {machine.operationNo}
                  </option>
                ))}
                {machines.length === 0 && <option value="">No machine available</option>}
              </select>
            </div>

            <button
              onClick={handleRefresh}
              disabled={loadingStats || refreshing || !selectedMachineId}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-card px-3 py-2.5 text-sm text-text-main hover:border-primary disabled:opacity-60"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {(loadingStats || loadingMachines) && (
        <section className="industrial-card p-6 text-sm text-text-muted">Loading operator telemetry...</section>
      )}

      {!loadingStats && (
        <>
          <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-3 industrial-card p-5">
              <h2 className="text-sm font-semibold text-text-main flex items-center gap-2">
                <Factory size={16} className="text-primary" />
                Station Context
              </h2>
              <div className="mt-4 space-y-2 text-sm text-text-main">
                <p>
                  <span className="text-text-muted">Mode:</span> {machineMode}
                </p>
                <p>
                  <span className="text-text-muted">Elapsed:</span> {machineClock}
                </p>
                <p>
                  <span className="text-text-muted">Operator:</span> {user.username || "Operator 1"}
                </p>
                <p>
                  <span className="text-text-muted">Status:</span> {currentContext?.plcStatus || "WAITING"}
                </p>
                <p className="flex items-center gap-2">
                  <span className="text-text-muted">PLC:</span>
                  <span className={`text-xs font-semibold ${plcConnected ? "text-emerald-300" : "text-rose-300"}`}>
                    {plcConnected ? "CONNECTED" : "DISCONNECTED"}
                  </span>
                </p>
                <p className="flex items-center gap-2">
                  <span className="text-text-muted">Scanner:</span>
                  <span
                    className={`text-xs font-semibold ${
                      !scannerConfigured ? "text-amber-300" : scannerConnected ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {!scannerConfigured ? "NOT CONFIGURED" : scannerConnected ? "CONNECTED" : "DISCONNECTED"}
                  </span>
                </p>
                {scannerConfigured && (
                  <p className="text-[11px] text-text-muted">
                    Last scan: {formatDateTime(scannerHealth?.lastSeenAt)}
                  </p>
                )}
              </div>

              <div className="mt-4 rounded-xl border border-border bg-bg-dark/70 p-3">
                <p className="text-[11px] uppercase text-text-muted">Last Scanned QR</p>
                <p className="text-xs font-mono text-text-main mt-2 break-all">
                  {currentContext?.partId || "--- WAITING FOR SCAN ---"}
                </p>
                <p className="text-[11px] text-text-muted mt-2">
                  Updated: {formatDateTime(currentContext?.createdAt)}
                </p>
              </div>

              <div className={`mt-3 rounded-xl border p-3 ${qrSignal?.tone || "border-border bg-bg-dark/70"}`}>
                <p className="text-[11px] uppercase text-text-muted">QR Decision</p>
                <p className={`text-xl font-bold mt-1 ${qrSignal?.textTone || "text-text-main"}`}>
                  {qrSignal?.label || "WAITING"}
                </p>
                <p className="text-[11px] text-text-muted mt-1">
                  {qrSignal?.partId || "-"} {qrSignal?.stationNo ? `| ${qrSignal.stationNo}` : ""}
                </p>
                <p className="text-[11px] text-text-muted">
                  {qrSignal?.reason || qrSignal?.message || "-"} {qrSignal?.timestamp ? `| ${formatDateTime(qrSignal.timestamp)}` : ""}
                </p>
              </div>

              <div className={`mt-3 rounded-xl border p-3 ${operationSignal.tone}`}>
                <p className="text-[11px] uppercase text-text-muted">Operation Decision</p>
                <p className={`text-xl font-bold mt-1 ${operationSignal.textTone}`}>{operationSignal.label}</p>
                <p className="text-[11px] text-text-muted mt-1">
                  {currentContext?.partId || "-"} {selectedStation ? `| ${selectedStation}` : ""}
                </p>
                <p className="text-[11px] text-text-muted">
                  {currentContext?.interlockReason || currentContext?.result || "-"}{" "}
                  {currentContext?.createdAt ? `| ${formatDateTime(currentContext.createdAt)}` : ""}
                </p>
                {canQuickReset ? (
                  <button
                    onClick={() => {
                      handleResetOperation(currentContext.partId, selectedStation).catch((error) => {
                        mergePopupPayload({
                          type: "ERROR",
                          title: "Reset Failed",
                          message: error.response?.data?.error || "Unable to reset operation",
                          partId: currentContext.partId,
                          stationNo: selectedStation,
                        });
                      });
                    }}
                    className="mt-3 w-full rounded-lg bg-red-600 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-red-700"
                  >
                    Reset Operation
                  </button>
                ) : null}
              </div>

              <div className="mt-3 rounded-xl border border-border bg-bg-dark/70 p-3">
                <p className="text-[11px] uppercase text-text-muted mb-2">Live QR Feed</p>
                <div className="space-y-1 max-h-[84px] overflow-y-auto">
                  {qrFeed.map((entry) => (
                    <div key={entry.id} className="text-[11px] flex items-center justify-between gap-2">
                      <span className={`${entry.textTone} font-bold`}>{entry.label}</span>
                      <span className="font-mono text-text-main truncate">{entry.partId || "-"}</span>
                      <span className="text-text-muted">{formatDateTime(entry.timestamp)}</span>
                    </div>
                  ))}
                  {qrFeed.length === 0 && <p className="text-[11px] text-text-muted">Waiting scanner response...</p>}
                </div>
              </div>
            </div>

            <div className="xl:col-span-6 industrial-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-text-main flex items-center gap-2">
                  <Gauge size={16} className="text-primary" />
                  Production Gauge
                </h2>
                <span className="rounded-full border border-border px-2.5 py-1 text-xs text-text-muted">
                  {producedCount}/{expectedCount} processed
                </span>
              </div>

              <div className="mt-4 flex flex-col items-center">
                <div className="h-52 w-52 rounded-full p-4" style={gaugeStyle}>
                  <div className="h-full w-full rounded-full bg-bg-card border border-border flex flex-col items-center justify-center text-center">
                    <p className="text-4xl font-bold text-text-main">{progressPercent}%</p>
                    <p className="text-xs uppercase tracking-wide text-text-muted mt-1">Shift Progress</p>
                    <p className="text-[11px] text-text-muted mt-2">
                      Quality: <span className="text-accent font-semibold">{qualityPercent}%</span>
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 w-full max-w-md">
                  <button className="rounded-xl border border-border bg-bg-dark py-2 text-sm font-semibold text-text-main hover:border-accent">
                    OK ({qualitySummary.okCount || 0})
                  </button>
                  <button className="rounded-xl border border-border bg-bg-dark py-2 text-sm font-semibold text-text-main hover:border-danger">
                    NG ({qualitySummary.ngCount || 0})
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
                  <span>Produced: {producedCount}</span>
                  <span>Expected: {expectedCount}</span>
                </div>
                <div className="h-2.5 w-full rounded-full border border-border bg-bg-dark">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            </div>

            <div className="xl:col-span-3 industrial-card p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-text-main flex items-center gap-2">
                  <ShieldCheck size={16} className="text-primary" />
                  Station Rules
                </h2>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="rounded-lg border border-border bg-bg-dark/70 px-3 py-2 flex items-center justify-between">
                  <span className="text-text-main">QR Validation</span>
                  <span className={stationFeatureConfig.qr ? "text-accent" : "text-text-muted"}>
                    {stationFeatureConfig.qr ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <div className="rounded-lg border border-border bg-bg-dark/70 px-3 py-2 flex items-center justify-between">
                  <span className="text-text-main">Operation Rule</span>
                  <span className={stationFeatureConfig.operation ? "text-accent" : "text-text-muted"}>
                    {stationFeatureConfig.operation ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <div className="rounded-lg border border-border bg-bg-dark/70 px-3 py-2 flex items-center justify-between">
                  <span className="text-text-main">Rejection Bin</span>
                  <span className={stationFeatureConfig.rejectionBin ? "text-accent" : "text-text-muted"}>
                    {stationFeatureConfig.rejectionBin ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border bg-bg-dark/70 overflow-hidden">
                <div className="px-3 py-2 border-b border-border text-xs uppercase text-text-muted font-semibold flex items-center gap-2">
                  <AlertTriangle size={12} className="text-danger" />
                  Rejection Summary
                </div>
                <div className="max-h-[160px] overflow-y-auto">
                  {stationFeatureConfig.rejectionBin && rejectionSummary.length === 0 && (
                    <p className="px-3 py-3 text-xs text-text-muted">No rejections in latest events.</p>
                  )}
                  {stationFeatureConfig.rejectionBin &&
                    rejectionSummary.map((entry) => (
                      <div
                        key={entry.reason}
                        className="px-3 py-2 text-xs border-b last:border-b-0 border-border/60 flex items-center justify-between gap-2"
                      >
                        <span className="text-text-main truncate">{entry.reason}</span>
                        <span className="text-danger font-semibold">{entry.count}</span>
                      </div>
                    ))}
                  {!stationFeatureConfig.rejectionBin && (
                    <p className="px-3 py-3 text-xs text-text-muted">
                      Rejection Bin is disabled for this station in Master Settings.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="industrial-card p-5">
              <h2 className="font-semibold text-text-main mb-3 flex items-center gap-2">
                <Clock3 size={16} className="text-primary" />
                Hourly Trend
              </h2>
              <div className="space-y-2">
                {trendRows.length === 0 && <p className="text-sm text-text-muted">No trend data for this station.</p>}
                {trendRows.map((row) => (
                  <div
                    key={row.hour}
                    className="rounded-lg border border-border bg-bg-dark/70 px-3 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-text-main">{row.hour}</p>
                      <p className="text-xs text-text-muted">Total: {row.total}</p>
                    </div>
                    <div className="flex gap-2 text-xs font-semibold">
                      <span className="rounded-md bg-accent/20 px-2 py-1 text-accent">OK {row.ok}</span>
                      <span className="rounded-md bg-danger/20 px-2 py-1 text-danger">NG {row.ng}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="industrial-card p-5">
              <h2 className="font-semibold text-text-main mb-3 flex items-center gap-2">
                <Wrench size={16} className="text-primary" />
                Recent Events
              </h2>
              <div className="space-y-2 max-h-[260px] overflow-y-auto">
                {(stationStats?.recentParts || []).map((row) => (
                  <div key={row.id} className="rounded-lg border border-border bg-bg-dark/70 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-mono text-text-main">{row.partId}</p>
                      <span className="text-xs text-text-muted">{row.plcStatus || "-"}</span>
                    </div>
                    <p className="text-xs text-text-muted mt-1">
                      Result: {row.result || "-"} | {formatDateTime(row.createdAt)}
                    </p>
                    {row.interlockReason && <p className="text-xs text-danger mt-1">Reason: {row.interlockReason}</p>}
                  </div>
                ))}
                {(stationStats?.recentParts || []).length === 0 && (
                  <p className="text-sm text-text-muted">No recent station events.</p>
                )}
              </div>
            </div>
          </section>

          <section className="industrial-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-5 text-xs text-text-muted">
                <button className="inline-flex items-center gap-1 hover:text-primary transition-colors">
                  <CheckCircle2 size={14} />
                  Change Job
                </button>
                <button className="inline-flex items-center gap-1 hover:text-danger transition-colors">
                  <AlertTriangle size={14} />
                  Reject Part
                </button>
              </div>
              <div className="flex gap-4 text-xs">
                <span className="rounded-md bg-bg-dark border border-border px-2 py-1 text-text-main">
                  Availability: {Math.max(0, 100 - (qualitySummary.interlockedCount || 0))}%
                </span>
                <span className="rounded-md bg-bg-dark border border-border px-2 py-1 text-text-main">
                  Quality: {qualityPercent}%
                </span>
                <span className="rounded-md bg-bg-dark border border-border px-2 py-1 text-text-main">
                  In Progress: {qualitySummary.inProgressCount || 0}
                </span>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default OperatorView;
