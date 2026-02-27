import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  AlertTriangle,
  Factory,
  FileText,
  Gauge,
  LayoutPanelTop,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { dashboardApi, machineApi, stationSettingsApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import { formatMachineLabel, getMachineStage } from "../utils/machineFields";
import {
  DEFAULT_STATION_FEATURES,
  getStationFeatureSettings,
  mergeStationFeatureSettings,
  normalizeStationKey,
  saveStationFeatureSettings,
} from "../utils/stationSettings";

const EMPTY_SUMMARY = {
  machines: { total: 0, active: 0, inactive: 0 },
  parts: { inProgress: 0, completed: 0, ng: 0, interlocked: 0, rework: 0 },
  quality: { ok: 0, ng: 0 },
  shiftProduction: {},
  availableShifts: [],
};

const EMPTY_REPORT = {
  machineWise: [],
  interlockHistory: [],
  shiftProduction: {},
};

const LOCAL_STORAGE_BOX_CAPACITY_KEY = "packing-default-capacity";
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 500;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";
const DASHBOARD_REALTIME_COOLDOWN_MS = 1200;

const TABS = [
  { id: "master", label: "Master Dashboard", icon: LayoutPanelTop },
  { id: "stations", label: "Station Controls", icon: Settings2 },
  { id: "reports", label: "Report Dashboard", icon: FileText },
];

const ACCESS_MATRIX = [
  { module: "Master Settings", admin: "View/Edit", engineer: "View", supervisor: "View", operator: "Hidden" },
  { module: "Machines", admin: "View/Edit", engineer: "View/Edit", supervisor: "View", operator: "Hidden" },
  { module: "PLC Config", admin: "View/Edit", engineer: "View/Edit", supervisor: "View", operator: "Hidden" },
  { module: "Scanners", admin: "View/Edit", engineer: "View/Edit", supervisor: "View", operator: "Hidden" },
  { module: "QR Rules", admin: "View/Edit", engineer: "View/Edit", supervisor: "View", operator: "Hidden" },
  { module: "Shifts", admin: "View/Edit", engineer: "View", supervisor: "View", operator: "Hidden" },
  { module: "Users", admin: "View/Edit", engineer: "Hidden", supervisor: "Hidden", operator: "Hidden" },
  { module: "Operator View", admin: "View", engineer: "View", supervisor: "View", operator: "View" },
  { module: "I/O Monitor", admin: "View/Control", engineer: "View/Control", supervisor: "View", operator: "View" },
  { module: "Packing", admin: "View", engineer: "View", supervisor: "View", operator: "View" },
];

function getTodayRange() {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  return {
    dateFrom: from.toISOString(),
    dateTo: now.toISOString(),
  };
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readSavedCapacity() {
  if (typeof window === "undefined") {
    return 65;
  }

  const value = Number(localStorage.getItem(LOCAL_STORAGE_BOX_CAPACITY_KEY));
  if (!Number.isFinite(value)) {
    return 65;
  }
  return Math.min(Math.max(Math.round(value), MIN_CAPACITY), MAX_CAPACITY);
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

const MasterSettingsDashboard = () => {
  const [activeTab, setActiveTab] = useState("master");
  const [machines, setMachines] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [report, setReport] = useState(EMPTY_REPORT);
  const [stationSettings, setStationSettings] = useState(() => getStationFeatureSettings());
  const [defaultBoxCapacity, setDefaultBoxCapacity] = useState(() => readSavedCapacity());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [popup, setPopup] = useState(null);
  const realtimeTimerRef = useRef(null);
  const lastRealtimeRefreshRef = useRef(0);

  const stationRows = useMemo(() => {
    const grouped = new Map();

    for (const machine of machines) {
      const stationNo = normalizeStationKey(getMachineStage(machine));
      if (!stationNo) {
        continue;
      }

      if (!grouped.has(stationNo)) {
        grouped.set(stationNo, {
          stationNo,
          lineName: machine.lineName || "-",
          sequenceNo: Number(machine.sequenceNo || 9999),
          machines: [],
        });
      }

      const row = grouped.get(stationNo);
      row.machines.push(machine);
      row.sequenceNo = Math.min(row.sequenceNo, Number(machine.sequenceNo || 9999));
    }

    return Array.from(grouped.values()).sort((a, b) => {
      if (a.sequenceNo === b.sequenceNo) {
        return a.stationNo.localeCompare(b.stationNo);
      }
      return a.sequenceNo - b.sequenceNo;
    });
  }, [machines]);

  const stationKeys = useMemo(() => stationRows.map((entry) => entry.stationNo), [stationRows]);

  const normalizedSettings = useMemo(
    () => mergeStationFeatureSettings(stationKeys, stationSettings),
    [stationKeys, stationSettings]
  );

  const machineById = useMemo(
    () =>
      machines.reduce((acc, machine) => {
        acc[machine.id] = machine;
        return acc;
      }, {}),
    [machines]
  );

  const machineNameById = useMemo(
    () =>
      machines.reduce((acc, machine) => {
        acc[machine.id] = formatMachineLabel(machine);
        return acc;
      }, {}),
    [machines]
  );

  const loadData = useCallback(
    async (showLoader = true) => {
      if (showLoader) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const query = getTodayRange();
        const [machineRows, summaryRows, reportRows, remoteSettings] = await Promise.all([
          machineApi.list(),
          dashboardApi.summary(query),
          dashboardApi.report(query),
          stationSettingsApi.list().catch(() => null),
        ]);

        setMachines(machineRows || []);
        setSummary(summaryRows || EMPTY_SUMMARY);
        setReport(reportRows || EMPTY_REPORT);
        setStationSettings((prev) => {
          const localFallback = Object.keys(prev).length > 0 ? prev : getStationFeatureSettings();
          const sourceSettings =
            remoteSettings && Object.keys(remoteSettings).length > 0 ? remoteSettings : localFallback;
          const merged = mergeStationFeatureSettings(
            (machineRows || []).map((machine) => getMachineStage(machine)),
            sourceSettings
          );
          saveStationFeatureSettings(merged);
          return merged;
        });
      } catch (error) {
        setPopup({
          type: "ERROR",
          title: "Load Failed",
          message: error.response?.data?.error || "Unable to load master dashboard data",
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  const scheduleRealtimeRefresh = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastRealtimeRefreshRef.current;
    const delay = Math.max(0, DASHBOARD_REALTIME_COOLDOWN_MS - elapsed);

    if (realtimeTimerRef.current) {
      return;
    }

    realtimeTimerRef.current = setTimeout(() => {
      realtimeTimerRef.current = null;
      lastRealtimeRefreshRef.current = Date.now();
      loadData(false);
    }, delay);
  }, [loadData]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
      reconnectionDelay: 200,
      reconnectionDelayMax: 1200,
    });

    socket.on("dashboard_refresh", () => {
      scheduleRealtimeRefresh();
    });

    socket.on("operator_popup", () => {
      scheduleRealtimeRefresh();
    });

    return () => {
      if (realtimeTimerRef.current) {
        clearTimeout(realtimeTimerRef.current);
        realtimeTimerRef.current = null;
      }
      socket.disconnect();
    };
  }, [scheduleRealtimeRefresh]);

  const saveCurrentSettings = async () => {
    try {
      await stationSettingsApi.save(normalizedSettings);
      saveStationFeatureSettings(normalizedSettings);
      localStorage.setItem(LOCAL_STORAGE_BOX_CAPACITY_KEY, String(defaultBoxCapacity));
      setPopup({
        type: "SUCCESS",
        title: "Configuration Saved",
        message: "Master settings and station controls have been saved.",
      });
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Save Failed",
        message: error.response?.data?.error || "Unable to save settings to server",
      });
    }
  };

  const updateStationToggle = (stationNo, key, value) => {
    const stationKey = normalizeStationKey(stationNo);
    if (!stationKey) {
      return;
    }
    setStationSettings((prev) => {
      const next = {
        ...prev,
        [stationKey]: {
          ...DEFAULT_STATION_FEATURES,
          ...(prev[stationKey] || {}),
          [key]: value,
        },
      };
      saveStationFeatureSettings(next);
      return next;
    });
  };

  const applyPreset = (preset) => {
    const next = stationKeys.reduce((acc, stationNo) => {
      if (preset === "strict") {
        acc[stationNo] = { qr: true, operation: true, rejectionBin: true };
      } else if (preset === "speed") {
        acc[stationNo] = { qr: true, operation: true, rejectionBin: false };
      } else {
        acc[stationNo] = { qr: true, operation: true, rejectionBin: true };
      }
      return acc;
    }, {});
    setStationSettings(next);
    saveStationFeatureSettings(next);
  };

  const resetSettings = () => {
    const defaults = stationKeys.reduce((acc, stationNo) => {
      acc[stationNo] = { ...DEFAULT_STATION_FEATURES };
      return acc;
    }, {});
    setStationSettings(defaults);
    setDefaultBoxCapacity(65);
    saveStationFeatureSettings(defaults);
    localStorage.setItem(LOCAL_STORAGE_BOX_CAPACITY_KEY, "65");
    setPopup({
      type: "SUCCESS",
      title: "Defaults Restored",
      message: "Station controls and packing capacity reset to standard defaults.",
    });
  };

  const incidents = report.interlockHistory || [];

  const stationSignalRows = useMemo(() => {
    const grouped = {};
    for (const row of report.machineWise || []) {
      const machineId = Number(row.machine_id || 0);
      const machine = machineById[machineId];
      const stationNo = normalizeStationKey(getMachineStage(machine) || `M-${machineId}`);
      if (!grouped[stationNo]) {
        grouped[stationNo] = {
          stationNo,
          ok: 0,
          ng: 0,
          machineIds: new Set(),
        };
      }
      grouped[stationNo].ok += Number(row.ok || 0);
      grouped[stationNo].ng += Number(row.ng || 0);
      grouped[stationNo].machineIds.add(machineId);
    }

    return Object.values(grouped)
      .map((row) => ({
        stationNo: row.stationNo,
        ok: row.ok,
        ng: row.ng,
        machineCount: row.machineIds.size,
        status: row.ng > 0 ? "FAIL" : row.ok > 0 ? "PASS" : "WAIT",
      }))
      .sort((a, b) => {
        const priority = { FAIL: 0, PASS: 1, WAIT: 2 };
        if (priority[a.status] !== priority[b.status]) {
          return priority[a.status] - priority[b.status];
        }
        return a.stationNo.localeCompare(b.stationNo);
      });
  }, [report.machineWise, machineById]);

  const topMachines = (report.machineWise || [])
    .map((row) => ({
      machineId: row.machine_id,
      machineName: machineNameById[row.machine_id] || `Machine ${row.machine_id}`,
      ok: Number(row.ok || 0),
      ng: Number(row.ng || 0),
      total: Number(row.ok || 0) + Number(row.ng || 0),
    }))
    .sort((a, b) => b.ng - a.ng || b.total - a.total)
    .slice(0, 8);

  const lineReadiness = useMemo(() => {
    const total = Number(summary.machines.total || 0);
    const active = Number(summary.machines.active || 0);
    if (total === 0) {
      return 0;
    }
    return Math.round((active / total) * 100);
  }, [summary.machines.active, summary.machines.total]);

  const renderTabButton = (tab) => {
    const Icon = tab.icon;
    const active = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => setActiveTab(tab.id)}
        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
          active
            ? "bg-primary text-bg-dark shadow-[0_10px_30px_-12px_rgba(25,179,199,0.8)]"
            : "bg-bg-card border border-border text-text-muted hover:border-primary hover:text-text-main"
        }`}
      >
        <Icon size={16} />
        {tab.label}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} />

      <div className="industrial-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Settings Command Center</p>
            <h1 className="mt-1 text-2xl font-bold text-text-main">Master Dashboard and Station Controls</h1>
            <p className="text-sm text-text-muted mt-1">
              Manage station rules, line readiness, reports, and packing defaults from one place.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData(false)}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-card px-3 py-2 text-sm text-text-main hover:border-primary disabled:opacity-60"
              disabled={loading || refreshing}
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              onClick={resetSettings}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-card px-3 py-2 text-sm text-text-main hover:border-warning"
            >
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              onClick={saveCurrentSettings}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-bg-dark hover:brightness-110"
            >
              <Save size={14} />
              Save
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">{TABS.map(renderTabButton)}</div>
      </div>

      {loading ? (
        <div className="industrial-card p-8 text-sm text-text-muted">Loading master dashboard...</div>
      ) : null}

      {!loading && activeTab === "master" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="industrial-card p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase text-text-muted">Line Readiness</p>
                <Gauge size={16} className="text-primary" />
              </div>
              <p className="mt-2 text-2xl font-bold text-text-main">{lineReadiness}%</p>
              <div className="mt-3 h-2 rounded-full bg-bg-dark border border-border">
                <div className="h-full rounded-full bg-primary" style={{ width: `${lineReadiness}%` }} />
              </div>
            </div>

            <div className="industrial-card p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase text-emerald-300">PASS Parts</p>
                <ShieldCheck size={16} className="text-emerald-300" />
              </div>
              <p className="mt-2 text-3xl font-bold text-emerald-200">{summary.quality.ok || 0}</p>
            </div>

            <div className="industrial-card p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase text-rose-300">FAIL / NG</p>
                <AlertTriangle size={16} className="text-rose-300" />
              </div>
              <p className="mt-2 text-3xl font-bold text-rose-200">{summary.quality.ng || 0}</p>
            </div>

            <div className="industrial-card p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase text-text-muted">Interlocks</p>
                <Factory size={16} className="text-warning" />
              </div>
              <p className="mt-2 text-3xl font-bold text-warning">{summary.parts.interlocked || 0}</p>
            </div>
          </div>

          <div className="industrial-card p-5">
            <h2 className="font-bold text-text-main mb-3">Station Pass / Fail Board</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {stationSignalRows.map((row) => {
                const isPass = row.status === "PASS";
                const isFail = row.status === "FAIL";
                const tone = isPass
                  ? "border-emerald-500/75 bg-emerald-500/14"
                  : isFail
                  ? "border-rose-500/75 bg-rose-500/14"
                  : "border-slate-500/60 bg-slate-500/10";
                const badgeTone = isPass
                  ? "bg-emerald-500 text-white"
                  : isFail
                  ? "bg-rose-500 text-white"
                  : "bg-slate-500 text-white";

                return (
                  <div key={row.stationNo} className={`rounded-xl border p-3 ${tone}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-base font-bold text-white">{row.stationNo}</p>
                      <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${badgeTone}`}>{row.status}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-emerald-300 font-semibold">OK: {row.ok}</span>
                      <span className="text-rose-300 font-semibold">NG: {row.ng}</span>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">{row.machineCount} machine(s)</p>
                  </div>
                );
              })}
              {stationSignalRows.length === 0 && (
                <p className="text-sm text-text-muted">No station signal data available.</p>
              )}
            </div>
          </div>

          <div className="industrial-card p-5">
            <h2 className="font-bold text-text-main mb-3">Role Access Matrix</h2>
            <p className="text-sm text-text-muted mb-3">
              Reference matrix for production deployment. Final enforcement stays on backend API permissions.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-bg-dark/70 text-text-muted text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Module</th>
                    <th className="px-4 py-3 text-left">Admin</th>
                    <th className="px-4 py-3 text-left">Engineer</th>
                    <th className="px-4 py-3 text-left">Supervisor</th>
                    <th className="px-4 py-3 text-left">Operator</th>
                  </tr>
                </thead>
                <tbody>
                  {ACCESS_MATRIX.map((row) => (
                    <tr key={row.module} className="border-t border-border/60">
                      <td className="px-4 py-3 font-semibold text-text-main">{row.module}</td>
                      <td className="px-4 py-3 text-text-main">{row.admin}</td>
                      <td className="px-4 py-3 text-text-main">{row.engineer}</td>
                      <td className="px-4 py-3 text-text-main">{row.supervisor}</td>
                      <td className="px-4 py-3 text-text-main">{row.operator}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="industrial-card p-5">
            <h2 className="font-bold text-text-main mb-3">Recent Rejection Alerts</h2>
            <div className="space-y-2 max-h-[220px] overflow-y-auto">
              {incidents.slice(0, 10).map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{row.part_id || row.partId || "Unknown part"}</p>
                    <p className="text-xs text-rose-200">{row.interlock_reason || "No reason"}</p>
                  </div>
                  <p className="text-xs text-text-muted whitespace-nowrap">{formatDateTime(row.createdAt)}</p>
                </div>
              ))}
              {incidents.length === 0 && <p className="text-sm text-text-muted">No rejection alerts in this window.</p>}
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === "stations" && (
        <div className="space-y-6">
          <div className="industrial-card p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-bold text-text-main">Station Requirement Matrix</h2>
                <p className="text-sm text-text-muted mt-1">
                  Enable what each station must enforce: QR validation, operation checks, and rejection bin.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => applyPreset("strict")}
                  className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-semibold text-text-main hover:border-primary"
                >
                  Strict Quality
                </button>
                <button
                  onClick={() => applyPreset("speed")}
                  className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-semibold text-text-main hover:border-primary"
                >
                  Speed Focus
                </button>
                <button
                  onClick={() => applyPreset("balanced")}
                  className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-semibold text-text-main hover:border-primary"
                >
                  Balanced
                </button>
              </div>
            </div>
          </div>

          <div className="industrial-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-bg-dark/70 text-text-muted text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Station</th>
                    <th className="px-4 py-3 text-left">Line</th>
                    <th className="px-4 py-3 text-left">Machines</th>
                    <th className="px-4 py-3 text-center">QR Validation</th>
                    <th className="px-4 py-3 text-center">Operation Rule</th>
                    <th className="px-4 py-3 text-center">Rejection Bin</th>
                  </tr>
                </thead>
                <tbody>
                  {stationRows.map((row) => {
                    const config = normalizedSettings[row.stationNo] || DEFAULT_STATION_FEATURES;
                    return (
                      <tr key={row.stationNo} className="border-t border-border/60 hover:bg-bg-dark/50">
                        <td className="px-4 py-3 font-semibold text-text-main">{row.stationNo}</td>
                        <td className="px-4 py-3 text-text-muted">{row.lineName || "-"}</td>
                        <td className="px-4 py-3 text-text-main">{row.machines.length}</td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={config.qr}
                            onChange={(event) => updateStationToggle(row.stationNo, "qr", event.target.checked)}
                            className="h-4 w-4 accent-[var(--app-primary)]"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={config.operation}
                            onChange={(event) => updateStationToggle(row.stationNo, "operation", event.target.checked)}
                            className="h-4 w-4 accent-[var(--app-primary)]"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={config.rejectionBin}
                            onChange={(event) => updateStationToggle(row.stationNo, "rejectionBin", event.target.checked)}
                            className="h-4 w-4 accent-[var(--app-primary)]"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="industrial-card p-5">
            <h2 className="font-bold text-text-main mb-3">Packing Defaults</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <label className="text-xs uppercase tracking-wide text-text-muted">Default box capacity</label>
                <input
                  type="number"
                  min={MIN_CAPACITY}
                  max={MAX_CAPACITY}
                  value={defaultBoxCapacity}
                  onChange={(event) => {
                    const value = Math.min(
                      MAX_CAPACITY,
                      Math.max(MIN_CAPACITY, toNumber(event.target.value, defaultBoxCapacity))
                    );
                    setDefaultBoxCapacity(value);
                    localStorage.setItem(LOCAL_STORAGE_BOX_CAPACITY_KEY, String(value));
                  }}
                  className="mt-2 w-full rounded-xl border border-border bg-bg-dark px-3 py-2.5 text-text-main focus:border-primary focus:outline-none"
                />
              </div>
              <div className="text-xs text-text-muted md:col-span-2">
                This value is used as the default in the packing screen. Operators can still override per box at start.
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === "reports" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="industrial-card p-5">
              <h2 className="font-bold text-text-main mb-3">Production Snapshot (Today)</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-bg-dark/70 p-3">
                  <p className="text-xs text-text-muted uppercase">Completed</p>
                  <p className="text-xl font-bold text-accent">{summary.parts.completed || 0}</p>
                </div>
                <div className="rounded-lg border border-border bg-bg-dark/70 p-3">
                  <p className="text-xs text-text-muted uppercase">In Progress</p>
                  <p className="text-xl font-bold text-primary">{summary.parts.inProgress || 0}</p>
                </div>
                <div className="rounded-lg border border-border bg-bg-dark/70 p-3">
                  <p className="text-xs text-text-muted uppercase">NG Parts</p>
                  <p className="text-xl font-bold text-danger">{summary.parts.ng || 0}</p>
                </div>
              </div>
            </div>

            <div className="industrial-card p-5">
              <h2 className="font-bold text-text-main mb-3">Line Continuity Checklist</h2>
              <div className="space-y-2 text-sm">
                <div className="rounded-lg border border-border bg-bg-dark/70 p-3 flex items-center justify-between">
                  <span className="text-text-main">Scanner and PLC mappings verified</span>
                  <Activity size={14} className="text-primary" />
                </div>
                <div className="rounded-lg border border-border bg-bg-dark/70 p-3 flex items-center justify-between">
                  <span className="text-text-main">Interlocked parts under response SLA</span>
                  <AlertTriangle size={14} className="text-warning" />
                </div>
                <div className="rounded-lg border border-border bg-bg-dark/70 p-3 flex items-center justify-between">
                  <span className="text-text-main">Bypass/Reset actions tracked with reason</span>
                  <ShieldCheck size={14} className="text-accent" />
                </div>
              </div>
            </div>
          </div>

          <div className="industrial-card p-5">
            <h2 className="font-bold text-text-main mb-3">Recent Interlock and Downtime Signals</h2>
            <div className="space-y-2 max-h-[340px] overflow-y-auto">
              {incidents.length === 0 && <p className="text-sm text-text-muted">No interlock incidents in this window.</p>}
              {incidents.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-border bg-bg-dark/70 p-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-text-main">{row.part_id || row.partId || "Unknown part"}</p>
                    <p className="text-xs text-text-muted">{row.interlock_reason || "No reason"} </p>
                  </div>
                  <p className="text-xs text-text-muted">{formatDateTime(row.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="industrial-card p-5">
            <h2 className="font-bold text-text-main mb-3">Machine Quality Ranking</h2>
            <div className="space-y-2">
              {topMachines.length === 0 && <p className="text-sm text-text-muted">No machine records found.</p>}
              {topMachines.map((row) => (
                <div
                  key={row.machineId}
                  className="rounded-lg border border-border bg-bg-dark/70 p-3 flex flex-wrap justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-main truncate">{row.machineName}</p>
                    <p className="text-xs text-text-muted">Machine ID: {row.machineId}</p>
                  </div>
                  <div className="flex gap-2 text-xs font-semibold">
                    <span className="rounded-md bg-accent/20 px-2 py-1 text-accent">OK {row.ok}</span>
                    <span className="rounded-md bg-danger/20 px-2 py-1 text-danger">NG {row.ng}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MasterSettingsDashboard;
