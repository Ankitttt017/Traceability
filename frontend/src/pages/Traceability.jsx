import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import {
  AlertTriangle,
  CheckCircle,
  Clock3,
  History,
  Route,
  ScanLine,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { traceabilityApi } from "../api/services";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

function eventTypeClass(type) {
  if (type === "SUCCESS") {
    return "text-accent";
  }
  if (type === "ERROR") {
    return "text-danger";
  }
  if (type === "WARNING") {
    return "text-warning";
  }
  return "text-primary";
}

function normalizeEventType(type, decision) {
  if (type) {
    return String(type).toUpperCase();
  }
  return decision === "ALLOW" ? "SUCCESS" : "WARNING";
}

const Traceability = () => {
  const [partId, setPartId] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [traceData, setTraceData] = useState(null);
  const [operations, setOperations] = useState([]);
  const [feed, setFeed] = useState([]);

  useEffect(() => {
    traceabilityApi
      .operations()
      .then((rows) => setOperations(rows))
      .catch(() => {
        setOperations([]);
      });
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
    });

    const pushFeed = (entry) => {
      setFeed((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random()}`,
            timestamp: new Date().toISOString(),
            ...entry,
          },
          ...prev,
        ].slice(0, 25)
      );
    };

    socket.on("scan_event", (payload = {}) => {
      pushFeed({
        type: normalizeEventType(payload.type, payload.decision),
        message: payload.message || payload.reason || "Scan event",
        partId: payload.partId || null,
        stationNo: payload.stationNo || null,
      });
    });

    socket.on("operator_popup", (payload = {}) => {
      pushFeed({
        type: normalizeEventType(payload.type),
        message: payload.message || "Operation event",
        partId: payload.partId || null,
        stationNo: payload.stationNo || null,
        machineName: payload.machineName || null,
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const partSummary = useMemo(() => traceData?.part || null, [traceData]);
  const historyRows = useMemo(() => traceData?.history || [], [traceData]);
  const reworkRows = useMemo(() => traceData?.reworkHistory || [], [traceData]);

  const handleSearch = async (event) => {
    event.preventDefault();
    const value = partId.trim();
    if (!value) {
      return;
    }
    setLoading(true);
    setStatus({ type: "", message: "" });
    try {
      const response = await traceabilityApi.historyByPart(value);
      setTraceData(response);
      setStatus({ type: "success", message: "Traceability loaded" });
    } catch (error) {
      setTraceData(null);
      setStatus({ type: "error", message: error.response?.data?.error || "Part not found" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 rise-in">
      <div className="industrial-card p-6 md:p-8">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Traceability Control</h1>
        <p className="text-sm text-text-muted mt-1">
          Search any part to view full station history, interlock reason, and rework record.
        </p>

        <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <div className="md:col-span-3 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              required
              value={partId}
              onChange={(e) => setPartId(e.target.value)}
              className="w-full bg-bg-dark border border-border rounded-lg py-3 pl-10 pr-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-mono"
              placeholder="Enter Part ID"
            />
          </div>
          <button
            disabled={loading}
            className="bg-primary hover:brightness-110 disabled:opacity-60 text-bg-dark font-semibold rounded-lg py-3 px-4 flex items-center justify-center gap-2"
            type="submit"
          >
            <ScanLine size={17} />
            {loading ? "Loading..." : "Search"}
          </button>
        </form>

        <p className="text-xs text-text-muted mt-3">
          Manual scan/operation trigger is disabled here. Scan comes from scanner Ethernet IP mapping only.
        </p>
      </div>

      {status.message && (
        <div
          className={`industrial-card p-4 border ${
            status.type === "success" ? "border-accent/30 bg-accent/5" : "border-danger/30 bg-danger/5"
          }`}
        >
          <p className={status.type === "success" ? "text-accent" : "text-danger"}>{status.message}</p>
        </div>
      )}

      {partSummary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="industrial-card p-4">
            <p className="text-xs text-text-muted uppercase">Part ID</p>
            <p className="text-sm font-mono text-primary break-all">{partSummary.part_id}</p>
          </div>
          <div className="industrial-card p-4">
            <p className="text-xs text-text-muted uppercase">Status</p>
            <p className="text-sm font-semibold text-text-main">{partSummary.status || "-"}</p>
          </div>
          <div className="industrial-card p-4">
            <p className="text-xs text-text-muted uppercase">Current Station</p>
            <p className="text-sm font-semibold text-text-main">{partSummary.current_station || "-"}</p>
          </div>
          <div className="industrial-card p-4">
            <p className="text-xs text-text-muted uppercase">Interlock</p>
            <p className="text-sm font-semibold text-warning">{partSummary.interlock_reason || "NO"}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 industrial-card p-6">
          <h3 className="text-sm uppercase tracking-[0.2em] text-text-muted flex items-center gap-2">
            <History size={15} />
            Part Operation History
          </h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border">
                  <th className="py-2">Time</th>
                  <th>Station</th>
                  <th>PLC Status</th>
                  <th>Result</th>
                  <th>Interlock</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="py-2">{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.station_no || row.operation_no || "-"}</td>
                    <td>{row.plc_status || "-"}</td>
                    <td className={row.result === "OK" ? "text-accent" : row.result === "NG" ? "text-danger" : "text-text-muted"}>
                      {row.result || "-"}
                    </td>
                    <td className="text-warning">{row.interlock_reason || "-"}</td>
                  </tr>
                ))}
                {historyRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-text-muted">
                      Search a part ID to view its trace history.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {reworkRows.length > 0 && (
            <div className="mt-5 p-4 rounded-lg border border-warning/20 bg-warning/5">
              <p className="text-sm text-warning font-semibold flex items-center gap-2">
                <ShieldAlert size={16} />
                Rework Records
              </p>
              <div className="mt-2 space-y-1">
                {reworkRows.map((row) => (
                  <p key={row.id} className="text-xs text-text-main">
                    {row.from_station || "-"} to {row.to_station || "-"} | {row.reason || "Manual rework"} |{" "}
                    {new Date(row.createdAt).toLocaleString()}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="industrial-card p-5">
            <h2 className="font-bold text-text-main mb-3 flex items-center gap-2">
              <Route size={16} className="text-primary" />
              Configured Sequence
            </h2>
            <div className="space-y-2 max-h-[260px] overflow-y-auto">
              {operations.map((row) => (
                <div key={row.machineId} className="p-3 rounded-lg bg-bg-dark border border-border">
                  <p className="text-xs text-text-muted">SEQ {row.sequenceNo}</p>
                  <p className="text-sm text-text-main font-semibold">{row.machineName}</p>
                  <p className="text-xs font-mono text-primary mt-1">
                    {row.operationNo || row.stationNo || "-"} | {row.lineName || "-"}
                  </p>
                  <p className="text-xs font-mono text-text-muted mt-1">
                    {row.plcIp || "-"}
                    {row.plcPort ? `:${row.plcPort}` : ""} | {row.plcProtocol || "TCP_TEXT"}
                  </p>
                </div>
              ))}
              {operations.length === 0 && <p className="text-sm text-text-muted">No station sequence configured.</p>}
            </div>
          </div>

          <div className="industrial-card p-5">
            <h2 className="font-bold text-text-main mb-3 flex items-center gap-2">
              <Clock3 size={16} className="text-primary" />
              Live Scan Feed
            </h2>
            <div className="space-y-2 max-h-[320px] overflow-y-auto">
              {feed.map((event) => (
                <div key={event.id} className="p-3 rounded-lg bg-bg-dark border border-border">
                  <div className="flex items-center gap-2">
                    {event.type === "SUCCESS" ? (
                      <CheckCircle size={14} className="text-accent" />
                    ) : event.type === "ERROR" ? (
                      <XCircle size={14} className="text-danger" />
                    ) : event.type === "WARNING" ? (
                      <AlertTriangle size={14} className="text-warning" />
                    ) : (
                      <Clock3 size={14} className="text-primary" />
                    )}
                    <span className={`text-xs font-bold ${eventTypeClass(event.type)}`}>{event.type}</span>
                  </div>
                  <p className="text-sm text-text-main mt-1">{event.message}</p>
                  <p className="text-xs text-text-muted mt-1">
                    {event.partId ? `Part: ${event.partId}` : ""}
                    {event.stationNo ? ` | Station: ${event.stationNo}` : ""}
                    {event.machineName ? ` | ${event.machineName}` : ""}
                  </p>
                </div>
              ))}
              {feed.length === 0 && <p className="text-sm text-text-muted">Waiting for live scan events.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Traceability;
