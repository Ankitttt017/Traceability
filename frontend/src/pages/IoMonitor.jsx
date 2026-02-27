import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, Lock, RefreshCw, RotateCcw, Save, ServerCog, WifiOff } from "lucide-react";
import { machineApi, traceabilityApi } from "../api/services";
import { getUserRole } from "../utils/authStorage";

function normalizeIp(value) {
  return String(value || "").replace("::ffff:", "").trim();
}

function toIntOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
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

function getToneClass(tone) {
  const normalized = String(tone || "").trim().toLowerCase();
  if (normalized === "good") {
    return "bg-accent/10 text-accent border border-accent/30";
  }
  if (normalized === "error") {
    return "bg-danger/10 text-danger border border-danger/30";
  }
  if (normalized === "warn") {
    return "bg-warning/10 text-warning border border-warning/30";
  }
  if (normalized === "idle") {
    return "bg-slate-500/10 text-slate-300 border border-slate-400/30";
  }
  return "bg-bg-dark text-text-muted border border-border";
}

function toErrorMessage(error, fallback) {
  const status = Number(error?.response?.status || 0);
  if (status === 401 || status === 403) {
    return "Unauthorized. Login with Admin or Engineer role.";
  }
  return error?.response?.data?.error || fallback;
}

const IoMonitor = () => {
  const userRole = getUserRole();
  const canControlPlc = useMemo(() => {
    const normalized = normalizeRole(userRole);
    return normalized === "admin" || normalized === "engineer";
  }, [userRole]);

  const [machines, setMachines] = useState([]);
  const [loadingMachines, setLoadingMachines] = useState(true);
  const [selectedPlcIp, setSelectedPlcIp] = useState("");
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [refreshingSnapshot, setRefreshingSnapshot] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [controlResult, setControlResult] = useState(null);
  const [plcTesting, setPlcTesting] = useState(false);
  const [plcResetting, setPlcResetting] = useState(false);
  const [plcWriting, setPlcWriting] = useState(false);
  const [writeSignal, setWriteSignal] = useState("TRIGGER");
  const [writeValue, setWriteValue] = useState("");
  const [customRegister, setCustomRegister] = useState("");
  const inFlightRef = useRef(false);

  const loadMachines = useCallback(async () => {
    try {
      setLoadingMachines(true);
      const rows = await machineApi.list();
      const activeRows = (rows || []).filter((row) => String(row.status || "ACTIVE").toUpperCase() === "ACTIVE");
      setMachines(activeRows);
      setErrorMessage("");
    } catch (error) {
      setMachines([]);
      setErrorMessage(error.response?.data?.error || "Unable to load machines. Check backend/API status.");
    } finally {
      setLoadingMachines(false);
    }
  }, []);

  useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  const plcOptions = useMemo(() => {
    const unique = new Set();
    for (const machine of machines) {
      const ip = normalizeIp(machine.plcIp || machine.machineIp);
      if (ip) {
        unique.add(ip);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [machines]);

  const filteredMachines = useMemo(() => {
    if (!selectedPlcIp) {
      return machines;
    }
    return machines.filter((machine) => normalizeIp(machine.plcIp || machine.machineIp) === selectedPlcIp);
  }, [machines, selectedPlcIp]);

  useEffect(() => {
    if (filteredMachines.length === 0) {
      setSelectedMachineId("");
      setSnapshot(null);
      return;
    }
    if (!filteredMachines.some((machine) => String(machine.id) === String(selectedMachineId))) {
      setSelectedMachineId(String(filteredMachines[0].id));
    }
  }, [filteredMachines, selectedMachineId]);

  const loadSnapshot = useCallback(
    async ({ silent = false } = {}) => {
      const machineId = Number(selectedMachineId || 0);
      if (!machineId || inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;
      if (silent) {
        setRefreshingSnapshot(true);
      } else {
        setLoadingSnapshot(true);
      }

      try {
        const data = await traceabilityApi.ioSnapshot({
          machineId,
          plcIp: selectedPlcIp || undefined,
        });
        setSnapshot(data || null);
        setErrorMessage("");
      } catch (error) {
        setSnapshot(null);
        setErrorMessage(
          error.response?.data?.error ||
            "Unable to load I/O snapshot. Validate machine mapping, PLC network, and backend service."
        );
      } finally {
        if (silent) {
          setRefreshingSnapshot(false);
        } else {
          setLoadingSnapshot(false);
        }
        inFlightRef.current = false;
      }
    },
    [selectedMachineId, selectedPlcIp]
  );

  useEffect(() => {
    if (!selectedMachineId) {
      return undefined;
    }

    loadSnapshot({ silent: false });
    const timer = setInterval(() => {
      loadSnapshot({ silent: true });
    }, 1000);

    return () => clearInterval(timer);
  }, [selectedMachineId, selectedPlcIp, loadSnapshot]);

  useEffect(() => {
    setControlResult(null);
  }, [selectedMachineId, selectedPlcIp]);

  const selectedMachine = filteredMachines.find((machine) => String(machine.id) === String(selectedMachineId)) || null;

  const getMappedRegister = useCallback((machine, signalKey) => {
    if (!machine) {
      return null;
    }
    const config = machine.plcConfig || {};
    if (signalKey === "TRIGGER") {
      return toIntOrNull(config.startRegister ?? machine.plcStartRegister);
    }
    if (signalKey === "RESET") {
      return toIntOrNull(config.resetRegister ?? machine.plcResetRegister);
    }
    return null;
  }, []);

  const getMappedValue = useCallback((machine, signalKey) => {
    if (!machine) {
      return null;
    }
    const config = machine.plcConfig || {};
    if (signalKey === "TRIGGER") {
      return toIntOrNull(config.startValue ?? machine.plcStartValue) ?? 1;
    }
    if (signalKey === "RESET") {
      return toIntOrNull(config.resetValue ?? machine.plcResetValue) ?? 9;
    }
    return null;
  }, []);

  useEffect(() => {
    if (!selectedMachine) {
      setWriteSignal("TRIGGER");
      setWriteValue("");
      setCustomRegister("");
      return;
    }
    setWriteSignal("TRIGGER");
    setWriteValue(String(getMappedValue(selectedMachine, "TRIGGER") ?? 1));
    setCustomRegister("");
  }, [selectedMachine, getMappedValue]);

  useEffect(() => {
    if (!selectedMachine || writeSignal === "CUSTOM") {
      return;
    }
    setWriteValue(String(getMappedValue(selectedMachine, writeSignal) ?? ""));
  }, [selectedMachine, writeSignal, getMappedValue]);

  const handleTestPlc = async () => {
    if (!selectedMachine) {
      return;
    }
    try {
      setPlcTesting(true);
      setControlResult(null);
      const response = await machineApi.testPlc({ machineId: selectedMachine.id });
      const probe = response?.probe || {};
      const details =
        probe.protocol === "MODBUS_TCP" && Number.isFinite(Number(probe.statusValue))
          ? `STATUS=${probe.statusValue}`
          : "Connected";
      setControlResult({
        type: "success",
        message: `${response?.message || "PLC connection test successful"} (${details})`,
      });
    } catch (error) {
      setControlResult({
        type: "error",
        message: toErrorMessage(error, "PLC test failed"),
      });
    } finally {
      setPlcTesting(false);
    }
  };

  const handleResetPlc = async () => {
    if (!selectedMachine) {
      return;
    }
    try {
      setPlcResetting(true);
      setControlResult(null);
      const response = await machineApi.resetPlc({
        machineId: selectedMachine.id,
        stationNo: selectedMachine.operationNo || selectedMachine.stationNo,
      });
      setControlResult({
        type: "success",
        message: response?.message || "PLC reset command sent",
      });
      await loadSnapshot({ silent: false });
    } catch (error) {
      setControlResult({
        type: "error",
        message: toErrorMessage(error, "PLC reset failed"),
      });
    } finally {
      setPlcResetting(false);
    }
  };

  const handleWritePlcValue = async () => {
    if (!selectedMachine) {
      return;
    }

    const protocol = String(selectedMachine.plcProtocol || "").toUpperCase();
    if (protocol !== "MODBUS_TCP") {
      setControlResult({
        type: "error",
        message: "Write test value is available for MODBUS_TCP machines only.",
      });
      return;
    }

    const registerNo =
      writeSignal === "CUSTOM" ? toIntOrNull(customRegister) : getMappedRegister(selectedMachine, writeSignal);
    const value = toIntOrNull(writeValue);

    if (registerNo === null) {
      setControlResult({
        type: "error",
        message: "Register mapping missing. Select valid signal/register.",
      });
      return;
    }
    if (value === null) {
      setControlResult({
        type: "error",
        message: "Enter valid numeric value.",
      });
      return;
    }

    try {
      setPlcWriting(true);
      setControlResult(null);
      const payload = {
        machineId: selectedMachine.id,
        value,
        registerNo,
      };
      if (writeSignal !== "CUSTOM") {
        payload.signalKey = writeSignal;
      }
      const response = await machineApi.writePlcValue(payload);
      setControlResult({
        type: "success",
        message:
          response?.message ||
          `Register ${registerNo} updated with value ${value}.`,
      });
      await loadSnapshot({ silent: false });
    } catch (error) {
      setControlResult({
        type: "error",
        message: toErrorMessage(error, "Unable to write PLC register"),
      });
    } finally {
      setPlcWriting(false);
    }
  };

  const mappedRegister = writeSignal === "CUSTOM" ? toIntOrNull(customRegister) : getMappedRegister(selectedMachine, writeSignal);
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const plcConnected = Boolean(snapshot?.plcConnection?.connected);
  const scannerConnected = Boolean(snapshot?.scannerHealth?.connected);
  const backendErrors = Array.isArray(snapshot?.errors) ? snapshot.errors.filter(Boolean) : [];

  return (
    <div className="space-y-6 text-text-main">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary/10 rounded-xl text-primary border border-primary/20">
            <Activity size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">I/O Monitor</h1>
            <p className="text-sm text-text-muted">Live PLC signal view with 1-second auto refresh.</p>
          </div>
        </div>

        <button
          onClick={() => {
            loadMachines().then(() => loadSnapshot({ silent: false }));
          }}
          disabled={loadingMachines || loadingSnapshot}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg-card px-3 py-2 text-sm text-text-main hover:border-primary disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshingSnapshot || loadingSnapshot ? "animate-spin" : ""} />
          Refresh Now
        </button>
      </header>

      <section className="industrial-card p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">PLC</label>
            <select
              value={selectedPlcIp}
              onChange={(event) => setSelectedPlcIp(event.target.value)}
              className="w-full rounded-xl border border-border bg-bg-dark px-3 py-2.5 text-sm text-text-main focus:border-primary focus:outline-none"
            >
              <option value="">All PLCs</option>
              {plcOptions.map((ip) => (
                <option key={ip} value={ip}>
                  {ip}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">Machine</label>
            <select
              value={selectedMachineId}
              onChange={(event) => setSelectedMachineId(event.target.value)}
              className="w-full rounded-xl border border-border bg-bg-dark px-3 py-2.5 text-sm text-text-main focus:border-primary focus:outline-none"
            >
              {!selectedMachineId && <option value="">Select machine</option>}
              {filteredMachines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.machineName} | {machine.operationNo}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-border bg-bg-dark/70 px-3 py-2.5">
            <p className="text-[11px] uppercase text-text-muted">Auto Refresh</p>
            <p className="text-sm font-semibold text-text-main">Every 1 second</p>
            <p className="text-[11px] text-text-muted mt-1">Last snapshot: {formatDateTime(snapshot?.snapshotAt)}</p>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div className="rounded-xl border border-danger/40 bg-danger/10 text-danger px-4 py-3 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {backendErrors.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 text-warning px-4 py-3 text-sm space-y-1">
          {backendErrors.map((entry, index) => (
            <p key={`${entry}-${index}`}>{entry}</p>
          ))}
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="industrial-card p-4">
          <p className="text-xs uppercase tracking-wide text-text-muted mb-2">Machine</p>
          <p className="text-base font-semibold text-text-main">{snapshot?.machine?.machineName || selectedMachine?.machineName || "-"}</p>
          <p className="text-sm text-text-muted mt-1">
            {snapshot?.machine?.operationNo || selectedMachine?.operationNo || "-"} |{" "}
            {snapshot?.machine?.lineName || selectedMachine?.lineName || "-"}
          </p>
        </div>

        <div className="industrial-card p-4">
          <p className="text-xs uppercase tracking-wide text-text-muted mb-2">PLC Endpoint</p>
          <p className="text-base font-mono font-semibold text-text-main">
            {snapshot?.plc?.ip || selectedMachine?.plcIp || "-"}:{snapshot?.plc?.port ?? selectedMachine?.plcPort ?? "-"}
          </p>
          <p className="text-sm text-text-muted mt-1">{snapshot?.plc?.protocol || selectedMachine?.plcProtocol || "-"}</p>
        </div>

        <div className="industrial-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-text-muted">PLC Link</p>
            <span
              className={`px-2 py-1 rounded-full text-xs font-semibold ${
                plcConnected ? "bg-accent/10 text-accent border border-accent/30" : "bg-danger/10 text-danger border border-danger/30"
              }`}
            >
              {plcConnected ? "CONNECTED" : "DISCONNECTED"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-text-muted">Scanner</p>
            <span
              className={`px-2 py-1 rounded-full text-xs font-semibold ${
                scannerConnected ? "bg-accent/10 text-accent border border-accent/30" : "bg-slate-500/10 text-slate-300 border border-slate-400/30"
              }`}
            >
              {scannerConnected ? "CONNECTED" : "OFFLINE"}
            </span>
          </div>
        </div>
      </section>

      <section className="industrial-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-muted">PLC Control Panel</p>
            <p className="text-sm text-text-main font-semibold">Test, Reset, and Controlled Register Write</p>
          </div>
          <span
            className={`px-2 py-1 rounded-full text-xs font-semibold ${
              canControlPlc
                ? "bg-accent/10 text-accent border border-accent/30"
                : "bg-warning/10 text-warning border border-warning/30"
            }`}
          >
            Role: {userRole || "Unknown"}
          </span>
        </div>

        {!canControlPlc ? (
          <div className="rounded-xl border border-warning/40 bg-warning/10 text-warning px-3 py-2 text-sm flex items-center gap-2">
            <Lock size={14} />
            PLC controls are restricted to Admin and Engineer.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-[auto_auto_1fr] gap-3">
              <button
                onClick={handleTestPlc}
                disabled={!selectedMachine || plcTesting || plcResetting || plcWriting}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-bg-card px-4 py-2.5 text-sm text-text-main hover:border-primary disabled:opacity-60"
              >
                <Activity size={14} className={plcTesting ? "animate-spin" : ""} />
                {plcTesting ? "Testing..." : "Test PLC"}
              </button>
              <button
                onClick={handleResetPlc}
                disabled={!selectedMachine || plcResetting || plcTesting || plcWriting}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-warning/40 bg-bg-card px-4 py-2.5 text-sm text-warning hover:bg-warning/10 disabled:opacity-60"
              >
                <RotateCcw size={14} className={plcResetting ? "animate-spin" : ""} />
                {plcResetting ? "Resetting..." : "Reset PLC"}
              </button>
              <div className="rounded-xl border border-border bg-bg-dark/70 px-3 py-2 text-xs text-text-muted">
                Use only when line is safe and machine is in maintenance/test mode.
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-text-muted">Signal</label>
                <select
                  value={writeSignal}
                  onChange={(event) => setWriteSignal(event.target.value)}
                  className="w-full rounded-xl border border-border bg-bg-dark px-3 py-2.5 text-sm text-text-main focus:border-primary focus:outline-none"
                >
                  <option value="TRIGGER">TRIGGER</option>
                  <option value="RESET">RESET</option>
                  <option value="CUSTOM">CUSTOM</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-text-muted">Register</label>
                {writeSignal === "CUSTOM" ? (
                  <input
                    type="number"
                    value={customRegister}
                    onChange={(event) => setCustomRegister(event.target.value)}
                    placeholder="e.g. 103"
                    className="w-full rounded-xl border border-border bg-bg-dark px-3 py-2.5 text-sm text-text-main focus:border-primary focus:outline-none"
                  />
                ) : (
                  <input
                    readOnly
                    value={mappedRegister ?? "-"}
                    className="w-full rounded-xl border border-border bg-bg-dark px-3 py-2.5 text-sm text-text-main opacity-80"
                  />
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-text-muted">Value</label>
                <input
                  type="number"
                  value={writeValue}
                  onChange={(event) => setWriteValue(event.target.value)}
                  placeholder="numeric value"
                  className="w-full rounded-xl border border-border bg-bg-dark px-3 py-2.5 text-sm text-text-main focus:border-primary focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase text-text-muted">Action</label>
                <button
                  onClick={handleWritePlcValue}
                  disabled={!selectedMachine || plcWriting || plcTesting || plcResetting}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-bg-dark hover:brightness-110 disabled:opacity-60"
                >
                  <Save size={14} className={plcWriting ? "animate-pulse" : ""} />
                  {plcWriting ? "Writing..." : "Write Value"}
                </button>
              </div>
            </div>

            {controlResult ? (
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  controlResult.type === "success"
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-danger/40 bg-danger/10 text-danger"
                }`}
              >
                {controlResult.message}
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="industrial-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-bg-dark/40 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <ServerCog size={16} />
            <span>Signal Snapshot</span>
          </div>
          {loadingSnapshot ? <span className="text-xs text-text-muted">Loading...</span> : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-dark/70 text-xs uppercase text-text-muted">
              <tr>
                <th className="px-4 py-3 text-left">Signal</th>
                <th className="px-4 py-3 text-left">Register</th>
                <th className="px-4 py-3 text-left">Direction</th>
                <th className="px-4 py-3 text-left">Current Value</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                    {selectedMachineId ? "No I/O rows available for selected machine." : "Select machine to view live I/O."}
                  </td>
                </tr>
              )}
              {rows.map((row, index) => (
                <tr key={`${row.signal}-${row.register}-${index}`} className="border-t border-border/70">
                  <td className="px-4 py-3 font-semibold text-text-main">{row.signal}</td>
                  <td className="px-4 py-3 font-mono text-text-main">{row.register ?? "-"}</td>
                  <td className="px-4 py-3 text-text-main">{row.direction || "-"}</td>
                  <td className="px-4 py-3 font-mono text-text-main">{row.currentValue ?? "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${getToneClass(row.tone)}`}>
                      {String(row.status || "UNKNOWN").replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-muted">{row.description || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="industrial-card p-4">
        <p className="text-xs uppercase tracking-wide text-text-muted mb-2">Latest Operation Context</p>
        {snapshot?.latestOperation ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <p>
              <span className="text-text-muted">Part:</span>{" "}
              <span className="font-mono text-text-main">{snapshot.latestOperation.partId || "-"}</span>
            </p>
            <p>
              <span className="text-text-muted">PLC Status:</span>{" "}
              <span className="font-semibold text-text-main">{snapshot.latestOperation.plcStatus || "-"}</span>
            </p>
            <p>
              <span className="text-text-muted">Result:</span>{" "}
              <span className="font-semibold text-text-main">{snapshot.latestOperation.result || "-"}</span>
            </p>
            <p>
              <span className="text-text-muted">Time:</span>{" "}
              <span className="text-text-main">{formatDateTime(snapshot.latestOperation.createdAt)}</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-text-muted flex items-center gap-2">
            <WifiOff size={15} />
            No recent operation log found for selected machine.
          </p>
        )}

        {snapshot?.plcConnection?.error ? (
          <p className="mt-3 text-sm text-danger flex items-center gap-2">
            <AlertCircle size={14} />
            {snapshot.plcConnection.error}
          </p>
        ) : (
          snapshot?.plcConnection?.connected && (
            <p className="mt-3 text-sm text-accent flex items-center gap-2">
              <CheckCircle2 size={14} />
              PLC communication healthy at {formatDateTime(snapshot.plcConnection.checkedAt)}
            </p>
          )
        )}
      </section>
    </div>
  );
};

export default IoMonitor;
