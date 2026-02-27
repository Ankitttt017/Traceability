import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { stationSettingsApi, traceabilityApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import { getStationFeatureSettings, getStationFeatures, saveStationFeatureSettings } from "../utils/stationSettings";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const REALTIME_REFRESH_COOLDOWN_MS = 350;
const FALLBACK_POLL_INTERVAL_MS = 30000;
const CATALOG_SYNC_INTERVAL_MS = 60000;
const QR_EVENT_DEDUPE_MS = 3000;

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

function toDerivedPassSignal(partId, stationNo, timestamp, reason = "QR validated from journey state") {
  return {
    id: `${Date.now()}-${Math.random()}`,
    label: "QR PASS",
    tone: "border-emerald-500/75 bg-emerald-500/14",
    textTone: "text-emerald-200",
    partId: normalizePartId(partId),
    stationNo: String(stationNo || "").trim().toUpperCase(),
    decision: "ALLOW",
    reason: "QR_VALIDATED",
    message: reason,
    timestamp: timestamp || new Date().toISOString(),
  };
}

function getLatestAttempt(station = {}) {
  const attempts = Array.isArray(station.attempts) ? station.attempts : [];
  if (!attempts.length) {
    return null;
  }
  return attempts[attempts.length - 1];
}

function hasDerivedQrSignal(station = {}) {
  const latestAttempt = getLatestAttempt(station);
  if (!latestAttempt) {
    return false;
  }

  const latestStatus = String(latestAttempt.plcStatus || station.latestStatus || "").trim().toUpperCase();
  if (!latestStatus || latestStatus === "RESET") {
    return false;
  }

  return true;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getOperationStatusMeta(status) {
  const state = String(status || "PENDING").toUpperCase();
  if (state === "PASSED" || state === "ENDED_OK" || state === "COMPLETED") {
    return {
      label: "OP PASS",
      cardTone: "border-emerald-500/80 bg-emerald-500/12",
      badgeTone: "bg-emerald-500 text-white",
      textTone: "text-emerald-300",
      icon: CheckCircle2,
    };
  }
  if (state === "FAILED" || state === "INTERLOCKED" || state === "ENDED_NG" || state === "NG") {
    return {
      label: "OP FAIL",
      cardTone: "border-rose-500/80 bg-rose-500/12",
      badgeTone: "bg-rose-500 text-white",
      textTone: "text-rose-300",
      icon: XCircle,
    };
  }
  if (state === "COMM_ERROR" || state === "PLC_COMM_ERROR") {
    return {
      label: "OP COMM",
      cardTone: "border-orange-500/80 bg-orange-500/12",
      badgeTone: "bg-orange-500 text-white",
      textTone: "text-orange-300",
      icon: AlertTriangle,
    };
  }
  if (state === "IN_PROGRESS" || state === "STARTED" || state === "PENDING" || state === "REWORK") {
    return {
      label: "OP RUN",
      cardTone: "border-amber-500/70 bg-amber-500/10",
      badgeTone: "bg-amber-500 text-black",
      textTone: "text-amber-300",
      icon: Clock3,
    };
  }
  return {
    label: "OP WAIT",
    cardTone: "border-slate-500/60 bg-slate-500/10",
    badgeTone: "bg-slate-500 text-white",
    textTone: "text-slate-300",
    icon: Clock3,
  };
}

function getPartStatusMeta(status) {
  const state = String(status || "").trim().toUpperCase();
  if (state === "COMPLETED") {
    return {
      label: "PASS",
      badgeTone: "bg-emerald-500 text-white",
    };
  }
  if (state === "NG" || state === "INTERLOCKED" || state === "FAILED") {
    return {
      label: "FAIL",
      badgeTone: "bg-rose-500 text-white",
    };
  }
  if (state === "IN_PROGRESS" || state === "REWORK") {
    return {
      label: "RUN",
      badgeTone: "bg-amber-500 text-black",
    };
  }
  return {
    label: "WAIT",
    badgeTone: "bg-slate-500 text-white",
  };
}

const ComponentJourney = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [parts, setParts] = useState([]);
  const [selectedPartId, setSelectedPartId] = useState("");
  const [journeyData, setJourneyData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resettingStation, setResettingStation] = useState("");
  const [resetConfirm, setResetConfirm] = useState(null);
  const [popup, setPopup] = useState(null);
  const [lastQrSignal, setLastQrSignal] = useState(null);
  const [qrFeed, setQrFeed] = useState([]);
  const [qrByStation, setQrByStation] = useState({});
  const [stationSettings, setStationSettings] = useState(() => getStationFeatureSettings());
  const selectedPartIdRef = useRef("");
  const searchTermRef = useRef("");
  const socketRef = useRef(null);
  const subscribedPartRef = useRef("");
  const realtimeTimerRef = useRef(null);
  const lastRealtimeRefreshRef = useRef(0);
  const inFlightRefreshRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const lastQrEventRef = useRef({ key: "", at: 0 });

  const selectedPart = useMemo(
    () => parts.find((entry) => entry.partId === selectedPartId) || null,
    [parts, selectedPartId]
  );

  const stationTimeline = useMemo(() => journeyData?.stationTimeline || [], [journeyData?.stationTimeline]);

  const statusSummary = useMemo(() => {
    return stationTimeline.reduce(
      (acc, station) => {
        const state = String(station.stageState || "").toUpperCase();
        if (state === "PASSED") {
          acc.passed += 1;
        } else if (state === "FAILED" || state === "INTERLOCKED" || state === "COMM_ERROR") {
          acc.failed += 1;
        } else if (state === "IN_PROGRESS") {
          acc.inProgress += 1;
        } else {
          acc.pending += 1;
        }
        return acc;
      },
      { passed: 0, failed: 0, inProgress: 0, pending: 0 }
    );
  }, [stationTimeline]);

  const loadPartCatalog = useCallback(
    async (search) => {
      const rows = await traceabilityApi.partCatalog({ search, limit: 80 });
      setParts(rows || []);
      if (!selectedPartId && rows?.length) {
        setSelectedPartId(rows[0].partId);
      }
      if (selectedPartId && !(rows || []).some((entry) => entry.partId === selectedPartId)) {
        setSelectedPartId(rows?.[0]?.partId || "");
      }
    },
    [selectedPartId]
  );

  const loadJourney = useCallback(async (partId, showLoader = true) => {
    if (!partId) {
      setJourneyData(null);
      return;
    }

    if (showLoader) {
      setLoading(true);
    }
    try {
      const response = await traceabilityApi.journeyByPart(partId);
      setJourneyData(response || null);
    } catch (error) {
      const statusCode = Number(error.response?.status || 0);
      if (statusCode === 404) {
        setJourneyData(null);
        return;
      }

      if (showLoader) {
        setJourneyData(null);
      }
      setPopup({
        type: "ERROR",
        title: "Part History Missing",
        message: error.response?.data?.error || "Part journey data not found",
      });
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, []);

  const refreshJourneyNow = useCallback(
    async (showLoader = false) => {
      const partId = selectedPartIdRef.current;
      if (!partId) {
        return;
      }

      if (inFlightRefreshRef.current) {
        queuedRefreshRef.current = true;
        return;
      }

      inFlightRefreshRef.current = true;
      try {
        await loadJourney(partId, showLoader);
      } finally {
        inFlightRefreshRef.current = false;
        if (queuedRefreshRef.current) {
          queuedRefreshRef.current = false;
          refreshJourneyNow(false);
        }
      }
    },
    [loadJourney]
  );

  const scheduleRealtimeRefresh = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastRealtimeRefreshRef.current;
    const delay = Math.max(0, REALTIME_REFRESH_COOLDOWN_MS - elapsed);

    if (realtimeTimerRef.current) {
      return;
    }

    realtimeTimerRef.current = setTimeout(() => {
      realtimeTimerRef.current = null;
      lastRealtimeRefreshRef.current = Date.now();
      refreshJourneyNow(false);
    }, delay);
  }, [refreshJourneyNow]);

  const patchPartFromRealtime = useCallback((payload = {}) => {
    const realtimePartId = normalizePartId(payload.partId || payload.part_id);
    if (!realtimePartId) {
      return;
    }

    const realtimeStatus = String(payload.currentStatus || payload.partStatus || payload.status || "")
      .trim()
      .toUpperCase();
    const resolvedStatus = ["COMPLETED", "IN_PROGRESS", "NG", "INTERLOCKED", "REWORK"].includes(realtimeStatus)
      ? realtimeStatus
      : realtimeStatus === "ENDED_OK" || realtimeStatus === "STARTED" || realtimeStatus === "PENDING"
      ? "IN_PROGRESS"
      : realtimeStatus === "ENDED_NG"
      ? "NG"
      : "";
    const realtimeStation = String(payload.stationNo || payload.station_no || "").trim().toUpperCase();
    const realtimeTimestamp = payload.timestamp || new Date().toISOString();

    setParts((prev) => {
      const foundIndex = prev.findIndex((row) => row.partId === realtimePartId);
      if (foundIndex === -1) {
        if (searchTermRef.current) {
          return prev;
        }
        return [
          {
            partId: realtimePartId,
            status: resolvedStatus || "IN_PROGRESS",
            currentStation: realtimeStation || null,
            updatedAt: realtimeTimestamp,
          },
          ...prev,
        ].slice(0, 80);
      }

      const row = prev[foundIndex];
      const nextRow = {
        ...row,
        status: resolvedStatus || row.status,
        currentStation: realtimeStation || row.currentStation,
        updatedAt: realtimeTimestamp,
      };
      const next = [...prev];
      next[foundIndex] = nextRow;
      return next;
    });
  }, []);

  const processQrSignal = useCallback((payload = {}) => {
    if (!hasQrDecision(payload)) {
      return;
    }

    const payloadPart = normalizePartId(payload.partId || payload.part_id);
    const activePart = normalizePartId(selectedPartIdRef.current);

    if (activePart && payloadPart && payloadPart !== activePart) {
      return;
    }

    const signal = toQrSignal(payload);
    const dedupeKey = [signal.partId, signal.stationNo, signal.decision, signal.reason].join("|");
    const now = Date.now();
    if (lastQrEventRef.current.key === dedupeKey && now - lastQrEventRef.current.at < QR_EVENT_DEDUPE_MS) {
      return;
    }
    lastQrEventRef.current = { key: dedupeKey, at: now };

    setLastQrSignal(signal);
    setQrFeed((prev) => [signal, ...prev].slice(0, 6));

    if (signal.stationNo) {
      setQrByStation((prev) => ({
        ...prev,
        [signal.stationNo]: signal,
      }));
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadPartCatalog(searchTerm);
      await refreshJourneyNow(false);
      setStationSettings(getStationFeatureSettings());
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Refresh Failed",
        message: error.response?.data?.error || "Unable to refresh component journey",
      });
    } finally {
      setRefreshing(false);
    }
  }, [loadPartCatalog, searchTerm, refreshJourneyNow]);

  const handleResetStation = useCallback((stationNo) => {
    if (!selectedPartId || !stationNo) {
      return;
    }
    setResetConfirm({
      partId: selectedPartId,
      stationNo,
    });
  }, [selectedPartId]);

  const confirmResetStation = useCallback(async () => {
    const stationNo = String(resetConfirm?.stationNo || "").trim().toUpperCase();
    const partId = normalizePartId(resetConfirm?.partId || selectedPartId);
    if (!partId || !stationNo) {
      setResetConfirm(null);
      return;
    }

    setResettingStation(stationNo);
    try {
      await traceabilityApi.resetStation({
        partId,
        stationNo,
        reason: `Manual reset from Component Journey at ${stationNo}`,
      });

      // Clear stale QR badges immediately; fresh timeline will re-populate valid stations only.
      setQrByStation({});
      setLastQrSignal(null);
      setQrFeed([]);

      await Promise.all([refreshJourneyNow(false), loadPartCatalog(searchTermRef.current)]);
      setPopup({
        type: "SUCCESS",
        title: "Process Reset",
        message: `Station ${stationNo} reset for part ${partId}`,
      });
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Reset Failed",
        message: error.response?.data?.error || "Unable to reset this station process",
      });
    } finally {
      setResettingStation("");
      setResetConfirm(null);
    }
  }, [resetConfirm, selectedPartId, refreshJourneyNow, loadPartCatalog]);

  useEffect(() => {
    selectedPartIdRef.current = selectedPartId;
  }, [selectedPartId]);

  useEffect(() => {
    setLastQrSignal(null);
    setQrFeed([]);
    setQrByStation({});
    setResetConfirm(null);
    lastQrEventRef.current = { key: "", at: 0 };
  }, [selectedPartId]);

  useEffect(() => {
    if (!selectedPartId || stationTimeline.length === 0) {
      setQrByStation({});
      return;
    }

    const derivedByStation = {};
    for (const station of stationTimeline) {
      if (!hasDerivedQrSignal(station)) {
        continue;
      }
      const latestAttempt = getLatestAttempt(station);
      derivedByStation[station.stationNo] = toDerivedPassSignal(
        selectedPartId,
        station.stationNo,
        latestAttempt?.createdAt || station.latestAt
      );
    }
    setQrByStation(derivedByStation);

    if (lastQrSignal || qrFeed.length > 0) {
      return;
    }

    const latestStation = [...stationTimeline]
      .filter((station) => hasDerivedQrSignal(station) && station.latestAt)
      .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())[0];

    if (!latestStation) {
      return;
    }

    const derived = toDerivedPassSignal(selectedPartId, latestStation.stationNo, latestStation.latestAt);
    setLastQrSignal(derived);
    setQrFeed([derived]);
  }, [selectedPartId, stationTimeline, lastQrSignal, qrFeed.length]);

  useEffect(() => {
    searchTermRef.current = searchTerm;
  }, [searchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPartCatalog(searchTerm).catch((error) => {
        setPopup({
          type: "ERROR",
          title: "Search Failed",
          message: error.response?.data?.error || "Unable to load part catalog",
        });
      });
    }, 220);
    return () => clearTimeout(timer);
  }, [searchTerm, loadPartCatalog]);

  useEffect(() => {
    refreshJourneyNow(true);
  }, [selectedPartId, refreshJourneyNow]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnectionDelay: 200,
      reconnectionDelayMax: 1200,
    });
    socketRef.current = socket;

    socket.on("journey_update", (payload = {}) => {
      patchPartFromRealtime(payload);
      if (String(payload.sourceEvent || "").toLowerCase() !== "scan_event" && hasQrDecision(payload)) {
        processQrSignal(payload);
      }
      const payloadPart = normalizePartId(payload.partId || payload.part_id);
      if (!payloadPart || payloadPart !== selectedPartIdRef.current) {
        return;
      }
      scheduleRealtimeRefresh();
    });

    socket.on("scan_event", (payload = {}) => {
      patchPartFromRealtime(payload);
      processQrSignal(payload);
      const payloadPart = normalizePartId(payload.partId || payload.part_id);
      if (!payloadPart || payloadPart === selectedPartIdRef.current) {
        scheduleRealtimeRefresh();
      }
    });

    socket.on("operator_popup", (payload = {}) => {
      patchPartFromRealtime(payload);
      const payloadPart = normalizePartId(payload.partId || payload.part_id);
      if (payloadPart && payloadPart !== selectedPartIdRef.current) {
        return;
      }
      scheduleRealtimeRefresh();
    });

    socket.on("dashboard_refresh", () => {
      scheduleRealtimeRefresh();
    });

    return () => {
      if (realtimeTimerRef.current) {
        clearTimeout(realtimeTimerRef.current);
        realtimeTimerRef.current = null;
      }
      if (subscribedPartRef.current) {
        socket.emit("unsubscribe_part", { partId: subscribedPartRef.current });
        subscribedPartRef.current = "";
      }
      socketRef.current = null;
      socket.disconnect();
    };
  }, [scheduleRealtimeRefresh, patchPartFromRealtime, processQrSignal]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    const nextPart = normalizePartId(selectedPartIdRef.current);
    const currentPart = normalizePartId(subscribedPartRef.current);

    if (currentPart && currentPart !== nextPart) {
      socket.emit("unsubscribe_part", { partId: currentPart });
      subscribedPartRef.current = "";
    }

    if (nextPart && nextPart !== currentPart) {
      socket.emit("subscribe_part", { partId: nextPart });
      subscribedPartRef.current = nextPart;
    }

    if (!nextPart && currentPart) {
      socket.emit("unsubscribe_part", { partId: currentPart });
      subscribedPartRef.current = "";
    }
  }, [selectedPartId]);

  useEffect(() => {
    const fallbackInterval = setInterval(() => {
      refreshJourneyNow(false);
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => clearInterval(fallbackInterval);
  }, [refreshJourneyNow]);

  useEffect(() => {
    const catalogSyncInterval = setInterval(() => {
      loadPartCatalog(searchTermRef.current).catch(() => {});
    }, CATALOG_SYNC_INTERVAL_MS);

    return () => clearInterval(catalogSyncInterval);
  }, [loadPartCatalog]);

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

  return (
    <div className="space-y-5">
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} autoCloseMs={3500} criticalAutoCloseMs={9000} />

      {resetConfirm ? (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-bg-card shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]">
            <div className="relative border-b border-border px-5 py-4">
              <button
                onClick={() => setResetConfirm(null)}
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-bg-dark text-text-main hover:border-primary"
                aria-label="Close reset confirmation"
                title="Close"
              >
                <X size={14} />
              </button>
              <p className="text-sm font-bold uppercase tracking-wide text-text-main">Confirm Reset</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-text-muted">
                Reset part <span className="font-mono text-text-main">{resetConfirm.partId}</span> from station{" "}
                <span className="font-semibold text-warning">{resetConfirm.stationNo}</span>?
              </p>
              <p className="text-xs text-text-muted">
                This clears downstream progress from selected station. Re-scan will be required.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setResetConfirm(null)}
                  className="rounded-lg border border-border bg-bg-dark px-3 py-2 text-xs font-semibold text-text-main hover:border-primary"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmResetStation}
                  disabled={Boolean(resettingStation)}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {resettingStation ? "Resetting..." : "Confirm Reset"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <section className="industrial-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text-main">Component Journey</h1>
            <p className="text-sm text-text-muted">Simple PASS/FAIL station tracking for operators.</p>
          </div>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-card px-3 py-2 text-sm text-text-main hover:border-primary disabled:opacity-60"
            disabled={refreshing || loading}
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-2">
            <label className="text-xs uppercase tracking-wide text-text-muted font-semibold">Search QR / Part</label>
            <div className="relative mt-1.5">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-xl border border-border bg-bg-dark py-2.5 pl-9 pr-3 text-sm text-text-main focus:border-primary focus:outline-none"
                placeholder="Scan or type part ID"
              />
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/70 bg-emerald-500/12 px-3 py-2.5">
            <p className="text-xs uppercase text-emerald-300">PASS</p>
            <p className="text-2xl font-bold text-white">{statusSummary.passed}</p>
          </div>
          <div className="rounded-xl border border-rose-500/70 bg-rose-500/12 px-3 py-2.5">
            <p className="text-xs uppercase text-rose-300">FAIL</p>
            <p className="text-2xl font-bold text-white">{statusSummary.failed}</p>
          </div>
          <div className="rounded-xl border border-amber-500/70 bg-amber-500/12 px-3 py-2.5">
            <p className="text-xs uppercase text-amber-300">RUN</p>
            <p className="text-2xl font-bold text-white">{statusSummary.inProgress}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className={`lg:col-span-2 rounded-xl border px-3 py-2.5 ${lastQrSignal?.tone || "border-border bg-bg-dark/70"}`}>
            <p className="text-xs uppercase text-text-muted">Last QR Result</p>
            <p className={`text-2xl font-bold ${lastQrSignal?.textTone || "text-text-main"}`}>
              {lastQrSignal?.label || "WAITING"}
            </p>
            <p className="text-xs text-text-muted mt-1">
              {lastQrSignal?.partId || selectedPartId || "-"} {lastQrSignal?.stationNo ? `| ${lastQrSignal.stationNo}` : ""}
            </p>
            <p className="text-xs text-text-muted">
              {lastQrSignal?.reason || lastQrSignal?.message || "-"} {lastQrSignal?.timestamp ? `| ${formatDateTime(lastQrSignal.timestamp)}` : ""}
            </p>
          </div>
          <div className="lg:col-span-3 rounded-xl border border-border bg-bg-dark/70 px-3 py-2.5">
            <p className="text-xs uppercase text-text-muted mb-2">Live QR Feed</p>
            <div className="space-y-1 max-h-[98px] overflow-y-auto">
              {qrFeed.map((entry) => (
                <div key={entry.id} className="text-xs text-text-main flex items-center justify-between gap-2">
                  <span className={`${entry.textTone} font-bold`}>{entry.label}</span>
                  <span className="font-mono truncate">{entry.partId || "-"}</span>
                  <span className="text-text-muted">{formatDateTime(entry.timestamp)}</span>
                </div>
              ))}
              {qrFeed.length === 0 && <p className="text-xs text-text-muted">Waiting scanner response...</p>}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-4 industrial-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/70 bg-bg-dark/70 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-text-muted font-semibold">Parts</p>
            <p className="text-xs text-text-muted">{parts.length}</p>
          </div>
          <div className="max-h-[720px] overflow-y-auto p-3 space-y-2">
            {parts.map((part) => {
              const active = selectedPartId === part.partId;
              const partStatus = getPartStatusMeta(part.status);
              return (
                <button
                  key={part.partId}
                  onClick={() => setSelectedPartId(part.partId)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    active
                      ? "border-primary bg-primary/18 shadow-[0_16px_36px_-24px_rgba(25,179,199,0.9)]"
                      : "border-border bg-bg-dark/65 hover:border-primary/50"
                  }`}
                >
                  <p className="font-mono text-xs text-text-main font-semibold truncate">{part.partId}</p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${partStatus.badgeTone}`}>
                      {partStatus.label}
                    </span>
                    <span className="text-[10px] text-text-muted">{part.currentStation || "-"}</span>
                  </div>
                </button>
              );
            })}

            {parts.length === 0 && <p className="text-sm text-text-muted px-1 py-3">No parts found.</p>}
          </div>
        </div>

        <div className="xl:col-span-8 industrial-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/70 bg-bg-dark/70 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-text-muted">Selected Part</p>
              <p className="text-sm font-mono font-semibold text-text-main">{selectedPartId || "-"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-text-muted">Current Station</p>
              <p className="text-sm font-semibold text-primary">{selectedPart?.currentStation || "-"}</p>
            </div>
          </div>

          {loading ? (
            <div className="p-5 text-sm text-text-muted">Loading station timeline...</div>
          ) : (
            <div className="p-3 space-y-3 max-h-[720px] overflow-y-auto">
              {stationTimeline.map((station) => {
                const statusMeta = getOperationStatusMeta(station.stageState);
                const StatusIcon = statusMeta.icon;
                const settings = getStationFeatures(station.stationNo, stationSettings);
                const qrMeta = qrByStation[station.stationNo];
                const modules = [
                  settings.qr ? "QR" : null,
                  settings.operation ? "OP" : null,
                  settings.rejectionBin ? "REJ" : null,
                ].filter(Boolean);
                const isResetting = resettingStation === station.stationNo;

                return (
                  <div key={station.stationNo} className={`rounded-xl border p-3 ${statusMeta.cardTone}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <StatusIcon size={18} className={statusMeta.textTone} />
                        <div>
                          <p className="text-base font-bold text-white">{station.stationNo}</p>
                          <p className="text-xs text-text-muted">Last: {formatDateTime(station.latestAt)}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-bold rounded-full px-2.5 py-1 ${
                            qrMeta
                              ? qrMeta.label === "QR PASS"
                                ? "bg-emerald-500 text-white"
                                : qrMeta.label === "QR FAIL"
                                ? "bg-rose-500 text-white"
                                : "bg-slate-500 text-white"
                              : "bg-slate-500 text-white"
                          }`}
                        >
                          {qrMeta?.label || "QR WAIT"}
                        </span>
                        <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${statusMeta.badgeTone}`}>
                          {statusMeta.label}
                        </span>
                        <button
                          onClick={() => handleResetStation(station.stationNo)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-dark/70 px-2.5 py-1.5 text-xs font-semibold text-text-main hover:border-warning disabled:opacity-60"
                          disabled={!selectedPartId || isResetting}
                        >
                          <RotateCcw size={12} className={isResetting ? "animate-spin" : ""} />
                          Reset
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {modules.length > 0 ? (
                        modules.map((module) => (
                          <span
                            key={`${station.stationNo}-${module}`}
                            className="text-[10px] font-semibold rounded-md bg-bg-dark/80 border border-border px-2 py-1 text-text-muted"
                          >
                            {module}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] font-semibold rounded-md bg-bg-dark/80 border border-border px-2 py-1 text-text-muted">
                          No modules
                        </span>
                      )}
                    </div>

                    {settings.rejectionBin && (station.latestInterlockReason || station.stageState === "FAILED") && (
                      <div className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-200 flex items-center gap-1.5">
                        <AlertTriangle size={13} />
                        {station.latestInterlockReason || "Rejection/NG detected"}
                      </div>
                    )}
                  </div>
                );
              })}

              {stationTimeline.length === 0 && (
                <div className="rounded-lg border border-border bg-bg-dark/65 px-3 py-3 text-sm text-text-muted">
                  No station journey data available for this part.
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default ComponentJourney;
