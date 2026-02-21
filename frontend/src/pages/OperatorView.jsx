import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock3,
  Factory,
  ScanLine,
  ShieldAlert,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { dashboardApi, machineApi, scannerApi, traceabilityApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

function getBadgeClass(status) {
  if (!status) {
    return "bg-bg-dark text-text-muted border border-border";
  }
  if (status === "ENDED_OK") {
    return "bg-accent/10 text-accent border border-accent/20";
  }
  if (status === "ENDED_NG" || status === "NG") {
    return "bg-danger/10 text-danger border border-danger/20";
  }
  if (status === "INTERLOCKED") {
    return "bg-warning/10 text-warning border border-warning/20";
  }
  if (status === "STARTED") {
    return "bg-primary/10 text-primary border border-primary/20";
  }
  return "bg-bg-dark text-text-main border border-border";
}

function normalizePopupType(rawType, decision) {
  const normalized = String(rawType || "").toUpperCase();
  if (normalized) {
    return normalized;
  }
  if (decision === "ALLOW") {
    return "SUCCESS";
  }
  return "WARNING";
}

const OperatorView = () => {
  const [machines, setMachines] = useState([]);
  const [scanners, setScanners] = useState([]);
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [liveState, setLiveState] = useState(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [bypassLoading, setBypassLoading] = useState(false);
  const [popup, setPopup] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [recentEvents, setRecentEvents] = useState([]);
  const [stats, setStats] = useState({
    ok: 0,
    ng: 0,
    total: 0,
    currentRunningPart: "-",
  });

  const selectedMachine = useMemo(
    () => machines.find((machine) => machine.id === Number(selectedMachineId)),
    [machines, selectedMachineId]
  );

  const mappedScanner = useMemo(() => {
    if (!selectedMachine) {
      return null;
    }
    if (liveState?.scanner) {
      return {
        scannerName: liveState.scanner.scannerName,
        scannerIp: liveState.scanner.scannerIp,
        scannerPort: liveState.scanner.scannerPort,
        isActive: liveState.scanner.isActive,
      };
    }
    return scanners.find((scanner) => Number(scanner.mappedMachineId) === Number(selectedMachine.id)) || null;
  }, [liveState?.scanner, scanners, selectedMachine]);

  const currentPartId = useMemo(() => liveState?.current?.partId || "", [liveState]);
  const currentPlcStatus = useMemo(() => String(liveState?.current?.plcStatus || ""), [liveState]);
  const canBypassCurrent = useMemo(
    () => Boolean(selectedMachineId && currentPartId && currentPlcStatus && currentPlcStatus !== "ENDED_OK"),
    [currentPartId, currentPlcStatus, selectedMachineId]
  );

  const pushEvent = useCallback((event) => {
    setRecentEvents((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date().toISOString(),
          ...event,
        },
        ...prev,
      ].slice(0, 20)
    );
  }, []);

  const loadMachinesAndScanners = useCallback(async () => {
    const [machineData, scannerData] = await Promise.all([machineApi.list(), scannerApi.list()]);
    const activeMachines = machineData.filter((machine) => machine.isActive !== false);
    setMachines(activeMachines);
    setScanners(scannerData);

    if (!selectedMachineId && activeMachines.length > 0) {
      setSelectedMachineId(String(activeMachines[0].id));
    }
  }, [selectedMachineId]);

  const loadStats = useCallback(async () => {
    const summary = await dashboardApi.summary();
    const ok = Number(summary?.quality?.ok || 0);
    const ng = Number(summary?.quality?.ng || 0);
    setStats((prev) => ({
      ...prev,
      ok,
      ng,
      total: ok + ng,
    }));
  }, []);

  const loadLiveState = useCallback(async () => {
    const machineId = Number(selectedMachineId);
    if (!machineId) {
      setLiveState(null);
      return;
    }
    setLoadingLive(true);
    try {
      const response = await traceabilityApi.liveState(machineId);
      setLiveState(response);
      if (response?.current?.partId) {
        setStats((prev) => ({
          ...prev,
          currentRunningPart: response.current.partId,
        }));
      }
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Live State Error",
        message: error.response?.data?.error || "Unable to load machine live state",
      });
    } finally {
      setLoadingLive(false);
    }
  }, [selectedMachineId]);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await Promise.all([loadMachinesAndScanners(), loadStats()]);
      } catch (error) {
        setPopup({
          type: "ERROR",
          title: "Load Error",
          message: error.response?.data?.error || "Unable to load operator screen",
        });
      }
    };
    bootstrap();
  }, [loadMachinesAndScanners, loadStats]);

  useEffect(() => {
    loadLiveState().catch(() => {});
  }, [loadLiveState]);

  useEffect(() => {
    const timer = setInterval(() => {
      Promise.all([loadStats(), loadLiveState()]).catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [loadLiveState, loadStats]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setConnectionStatus("connected");
    });
    socket.on("disconnect", () => {
      setConnectionStatus("disconnected");
    });
    socket.on("connect_error", () => {
      setConnectionStatus("disconnected");
    });

    socket.on("operator_popup", (payload = {}) => {
      const eventType = normalizePopupType(payload.type);
      const event = {
        type: eventType,
        message: payload.message,
        partId: payload.partId || null,
        stationNo: payload.stationNo || null,
        machineName: payload.machineName || null,
        scannerName: payload.scannerName || null,
        scannerIp: payload.scannerIp || null,
        status: payload.status || null,
        timestamp: payload.timestamp || new Date().toISOString(),
      };
      setPopup({ ...payload, type: eventType });
      pushEvent(event);
      if (payload.partId) {
        setStats((prev) => ({ ...prev, currentRunningPart: payload.partId }));
      }
      Promise.all([loadStats(), loadLiveState()]).catch(() => {});
    });

    socket.on("scan_event", (payload = {}) => {
      const eventType = normalizePopupType(payload.type, payload.decision);
      const event = {
        type: eventType,
        message: payload.message,
        partId: payload.partId || null,
        stationNo: payload.stationNo || null,
        expectedStation: payload.expectedStation || null,
        status: payload.decision || null,
        timestamp: payload.timestamp || new Date().toISOString(),
      };
      pushEvent(event);
      if (event.partId) {
        setStats((prev) => ({ ...prev, currentRunningPart: event.partId }));
      }
    });

    socket.on("plc_connection_event", (payload = {}) => {
      pushEvent({
        type: payload.state === "COMPLETED" ? "SUCCESS" : payload.state === "RETRYING" ? "WARNING" : "INFO",
        message: payload.error ? `PLC ${payload.state}: ${payload.error}` : `PLC ${payload.state}`,
        partId: payload.partId || null,
        stationNo: payload.stationNo || null,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("dashboard_refresh", () => {
      Promise.all([loadStats(), loadLiveState()]).catch(() => {});
    });

    socket.on("scanner_status", (rows = []) => {
      const mapped = Array.isArray(rows)
        ? rows.map((row) => ({
            id: row.id,
            scannerName: row.scanner_name,
            scannerIp: row.scanner_ip,
            scannerPort: row.scanner_port,
            mappedMachineId: row.mapped_machine_id,
            isActive: row.is_active,
          }))
        : [];
      if (mapped.length > 0) {
        setScanners(mapped);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [loadLiveState, loadStats, pushEvent]);

  const handleBypassCurrent = async () => {
    const machineId = Number(selectedMachineId);
    if (!machineId || !currentPartId || !canBypassCurrent) {
      setPopup({
        type: "WARNING",
        title: "Bypass Blocked",
        message: "No bypass-eligible part found on selected machine",
      });
      return;
    }

    setBypassLoading(true);
    try {
      const response = await traceabilityApi.bypass({
        machineId,
        partId: currentPartId,
        reason: "MANUAL_BYPASS_FROM_OPERATOR_VIEW",
      });
      setPopup({
        type: "WARNING",
        title: "Bypass Success",
        message: response.message || "Operation bypassed",
        partId: currentPartId,
        stationNo: selectedMachine?.stationNo,
        machineName: selectedMachine?.machineName,
      });
      pushEvent({
        type: "WARNING",
        message: response.message || "Operation bypassed",
        partId: currentPartId,
        stationNo: selectedMachine?.stationNo,
        machineName: selectedMachine?.machineName,
      });
      await Promise.all([loadStats(), loadLiveState()]);
    } catch (error) {
      setPopup({
        type: "ERROR",
        title: "Bypass Failed",
        message: error.response?.data?.error || "Unable to bypass current operation",
      });
    } finally {
      setBypassLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
            <Factory className="text-primary" size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Operator Live Station</h1>
            <p className="text-text-muted text-sm">
              QR input is disabled here. Part IDs come from Scanner TCP/IP mapped to station.
            </p>
          </div>
        </div>

        <div
          className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1 ${
            connectionStatus === "connected"
              ? "bg-accent/10 border-accent/30 text-accent"
              : "bg-danger/10 border-danger/30 text-danger"
          }`}
        >
          {connectionStatus === "connected" ? <Wifi size={14} /> : <WifiOff size={14} />}
          {connectionStatus === "connected" ? "LIVE CONNECTED" : "DISCONNECTED"}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="industrial-card p-4">
          <p className="text-xs text-text-muted uppercase">OK Count</p>
          <p className="text-2xl font-bold text-accent">{stats.ok}</p>
        </div>
        <div className="industrial-card p-4">
          <p className="text-xs text-text-muted uppercase">NG Count</p>
          <p className="text-2xl font-bold text-danger">{stats.ng}</p>
        </div>
        <div className="industrial-card p-4">
          <p className="text-xs text-text-muted uppercase">Today Production</p>
          <p className="text-2xl font-bold text-primary">{stats.total}</p>
        </div>
        <div className="industrial-card p-4">
          <p className="text-xs text-text-muted uppercase">Current Running Part</p>
          <p className="text-sm font-mono text-primary break-all">{stats.currentRunningPart || "-"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 industrial-card p-6 space-y-5">
          <h2 className="font-bold text-white flex items-center gap-2">
            <ScanLine size={18} className="text-primary" />
            Live Station Context
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-text-muted">
                Machine <span className="text-primary">*</span>
              </label>
              <select
                value={selectedMachineId}
                onChange={(e) => setSelectedMachineId(e.target.value)}
                className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
              >
                <option value="">Select machine</option>
                {machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.stationNo || machine.operationNo} - {machine.machineName}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase text-text-muted">Live Status</label>
              <div className="h-[46px] flex items-center px-3 rounded-lg bg-bg-dark border border-border">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${getBadgeClass(liveState?.current?.plcStatus)}`}>
                  {loadingLive ? "LOADING" : liveState?.current?.plcStatus || "IDLE"}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="bg-bg-dark p-3 rounded-lg border border-border">
              <p className="text-text-muted text-xs uppercase">Machine</p>
              <p className="text-text-main font-semibold">{selectedMachine?.machineName || "-"}</p>
            </div>
            <div className="bg-bg-dark p-3 rounded-lg border border-border">
              <p className="text-text-muted text-xs uppercase">Station</p>
              <p className="text-primary font-mono">{selectedMachine?.stationNo || selectedMachine?.operationNo || "-"}</p>
            </div>
            <div className="bg-bg-dark p-3 rounded-lg border border-border">
              <p className="text-text-muted text-xs uppercase">Running Part</p>
              <p className="text-primary font-mono break-all">{currentPartId || "-"}</p>
            </div>
            <div className="bg-bg-dark p-3 rounded-lg border border-border">
              <p className="text-text-muted text-xs uppercase">Machine IP</p>
              <p className="text-text-main font-mono">{selectedMachine?.machineIp || "-"}</p>
            </div>
            <div className="bg-bg-dark p-3 rounded-lg border border-border">
              <p className="text-text-muted text-xs uppercase">PLC IP</p>
              <p className="text-text-main font-mono">{selectedMachine?.plcIp || "-"}</p>
            </div>
            <div className="bg-bg-dark p-3 rounded-lg border border-border">
              <p className="text-text-muted text-xs uppercase">PLC Protocol</p>
              <p className="text-text-main font-mono">{selectedMachine?.plcProtocol || "TCP_TEXT"}</p>
            </div>
            <div className="bg-bg-dark p-3 rounded-lg border border-border">
              <p className="text-text-muted text-xs uppercase">Scanner Mapping</p>
              <p className="text-text-main font-mono">
                {mappedScanner
                  ? `${mappedScanner.scannerName} (${mappedScanner.scannerIp}${mappedScanner.scannerPort ? `:${mappedScanner.scannerPort}` : ""})`
                  : "Not mapped"}
              </p>
            </div>
          </div>

          <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg text-sm text-warning">
            Scanner IP mapping controls scan authorization. If scanner/machine mapping is wrong, scans are blocked automatically.
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleBypassCurrent}
              disabled={bypassLoading || !canBypassCurrent}
              className="px-5 py-2.5 bg-warning/15 border border-warning/30 text-warning rounded-lg font-bold hover:bg-warning/25 disabled:opacity-60 inline-flex items-center gap-2"
            >
              <ShieldAlert size={16} />
              {bypassLoading ? "Bypassing..." : "Bypass Current Operation"}
            </button>
            {!canBypassCurrent && (
              <p className="text-xs text-text-muted">Bypass is enabled only when part status is not ENDED_OK.</p>
            )}
          </div>
        </div>

        <div className="industrial-card p-6">
          <h2 className="font-bold text-white mb-4 flex items-center gap-2">
            <Activity size={18} className="text-primary" />
            Live Operation
          </h2>
          {liveState?.current ? (
            <div className="space-y-3 text-sm">
              <div className="bg-bg-dark p-3 rounded-lg border border-border">
                <p className="text-text-muted text-xs uppercase">Part ID</p>
                <p className="font-mono text-primary break-all">{liveState.current.partId}</p>
              </div>
              <div className="bg-bg-dark p-3 rounded-lg border border-border">
                <p className="text-text-muted text-xs uppercase">PLC Status</p>
                <p className="font-semibold text-text-main">{liveState.current.plcStatus}</p>
              </div>
              <div className="bg-bg-dark p-3 rounded-lg border border-border">
                <p className="text-text-muted text-xs uppercase">Result</p>
                <p className="font-semibold text-text-main">{liveState.current.result || "-"}</p>
              </div>
              <div className="bg-bg-dark p-3 rounded-lg border border-border">
                <p className="text-text-muted text-xs uppercase">Bypass</p>
                <p className={liveState.current.isBypassed ? "text-warning font-semibold" : "text-text-main"}>
                  {liveState.current.isBypassed ? `YES (${liveState.current.bypassReason || "MANUAL"})` : "NO"}
                </p>
              </div>
              <div className="bg-bg-dark p-3 rounded-lg border border-border">
                <p className="text-text-muted text-xs uppercase">Interlock Reason</p>
                <p className="text-warning">{liveState.current.interlockReason || "-"}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-muted">No active part at selected station.</p>
          )}
        </div>
      </div>

      <div className="industrial-card p-6">
        <h2 className="font-bold text-white mb-4 flex items-center gap-2">
          <Clock3 size={18} className="text-primary" />
          Live Events
        </h2>
        <div className="space-y-2 max-h-[380px] overflow-y-auto">
          {recentEvents.map((event) => (
            <div key={event.id} className="p-3 rounded-lg bg-bg-dark border border-border">
              <div className="flex items-center gap-2">
                {event.type === "SUCCESS" ? (
                  <CheckCircle size={14} className="text-accent" />
                ) : event.type === "ERROR" ? (
                  <XCircle size={14} className="text-danger" />
                ) : event.type === "WARNING" ? (
                  <AlertTriangle size={14} className="text-warning" />
                ) : (
                  <Activity size={14} className="text-primary" />
                )}
                <span className="text-xs font-bold">{event.type}</span>
              </div>
              <p className="text-sm text-text-main mt-1">{event.message || "-"}</p>
              <p className="text-xs text-text-muted mt-1">
                {event.partId ? `Part: ${event.partId}` : ""}
                {event.stationNo ? ` | Station: ${event.stationNo}` : ""}
                {event.expectedStation ? ` | Expected: ${event.expectedStation}` : ""}
              </p>
            </div>
          ))}
          {recentEvents.length === 0 && <p className="text-sm text-text-muted">No live events yet.</p>}
        </div>
      </div>
    </div>
  );
};

export default OperatorView;
