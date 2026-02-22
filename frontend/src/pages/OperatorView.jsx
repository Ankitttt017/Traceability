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
import { machineApi, traceabilityApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import { getMachineStage } from "../utils/machineFields";
import { getStationFeatureSettings, getStationFeatures } from "../utils/stationSettings";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

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
    } catch (_error) {
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
  const [clockTick, setClockTick] = useState(Date.now());

  const selectedMachineIdRef = useRef("");
  const selectedStationRef = useRef("");

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
      setPopup({
        type: "ERROR",
        title: "Station Data Error",
        message: error.response?.data?.error || "Unable to load machine telemetry",
      });
    } finally {
      setLoadingStats(false);
      setRefreshing(false);
    }
  }, []);

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
    const syncSettings = () => {
      setStationSettings(getStationFeatureSettings());
    };
    window.addEventListener("focus", syncSettings);
    window.addEventListener("storage", syncSettings);
    return () => {
      window.removeEventListener("focus", syncSettings);
      window.removeEventListener("storage", syncSettings);
    };
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
    });

    socket.on("operator_popup", (payload = {}) => {
      const payloadStation = String(payload.stationNo || "").trim().toUpperCase();
      const payloadMachine = String(payload.machineId || "");
      const activeMachine = selectedMachineIdRef.current;
      const activeStation = selectedStationRef.current;
      const isRelevant = payloadMachine === activeMachine || (payloadStation && payloadStation === activeStation);

      if (!isRelevant) {
        return;
      }
      setPopup(payload);
      if (activeMachine) {
        loadMachineTelemetry(activeMachine, false);
      }
    });

    socket.on("dashboard_refresh", () => {
      if (selectedMachineIdRef.current) {
        loadMachineTelemetry(selectedMachineIdRef.current, false);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [loadMachineTelemetry]);

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
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} />

      <section className="industrial-card p-6 overflow-hidden relative">
        <div className="absolute inset-0 pointer-events-none opacity-60 bg-[radial-gradient(circle_at_15%_20%,rgba(25,179,199,0.2),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(215,91,91,0.18),transparent_40%)]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-primary font-semibold">Live Station Monitor</p>
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
