import { useState } from "react";
import { Search, Route, RefreshCw, Wrench, ShieldOff, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { traceabilityApi } from "../api/services";

const ComponentJourney = () => {
  const [partId, setPartId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [reworkStation, setReworkStation] = useState("");
  const [reworkReason, setReworkReason] = useState("");

  const loadJourney = async (targetPartId) => {
    if (!targetPartId) {
      return;
    }
    setLoading(true);
    setStatus({ type: "", message: "" });
    try {
      const response = await traceabilityApi.journeyByPart(targetPartId);
      setData(response);
      setReworkStation("");
    } catch (error) {
      setData(null);
      setStatus({ type: "error", message: error.response?.data?.error || "Part not found" });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    await loadJourney(partId.trim());
  };

  const handleRework = async () => {
    if (!data?.part?.part_id || !reworkStation) {
      setStatus({ type: "error", message: "Select station for rework" });
      return;
    }
    try {
      const response = await traceabilityApi.rework({
        partId: data.part.part_id,
        stationNo: reworkStation,
        reason: reworkReason,
      });
      setStatus({ type: "success", message: response.message || "Part moved to rework" });
      await loadJourney(data.part.part_id);
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Rework failed" });
    }
  };

  const handleResetInterlock = async () => {
    if (!data?.part?.part_id) {
      return;
    }
    try {
      const response = await traceabilityApi.resetInterlock({
        partId: data.part.part_id,
        reason: "Manual reset from Part Journey",
      });
      setStatus({ type: "success", message: response.message || "Interlock reset" });
      await loadJourney(data.part.part_id);
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Interlock reset failed" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
          <Route className="text-primary" size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Part Journey</h1>
          <p className="text-text-muted text-sm">Trace station-by-station history with rework and interlock controls.</p>
        </div>
      </div>

      {status.message && (
        <div
          className={`p-4 rounded-lg border ${
            status.type === "success"
              ? "bg-accent/10 border-accent/30 text-accent"
              : "bg-danger/10 border-danger/30 text-danger"
          }`}
        >
          {status.message}
        </div>
      )}

      <div className="industrial-card p-6">
        <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={partId}
              onChange={(e) => setPartId(e.target.value)}
              className="w-full bg-bg-dark border border-border rounded-lg py-3 pl-9 pr-4 text-text-main focus:border-primary outline-none"
              placeholder="Enter Part ID"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-3 bg-primary hover:brightness-110 text-bg-dark rounded-lg font-bold disabled:opacity-60"
          >
            {loading ? "Loading..." : "Search Journey"}
          </button>
        </form>
      </div>

      {data?.part && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="industrial-card p-4">
              <p className="text-xs uppercase text-text-muted">Part ID</p>
              <p className="font-mono text-primary break-all">{data.part.part_id}</p>
            </div>
            <div className="industrial-card p-4">
              <p className="text-xs uppercase text-text-muted">Status</p>
              <p className="font-bold text-text-main">{data.part.status}</p>
            </div>
            <div className="industrial-card p-4">
              <p className="text-xs uppercase text-text-muted">Current Station</p>
              <p className="font-bold text-text-main">{data.part.current_station || "-"}</p>
            </div>
            <div className="industrial-card p-4">
              <p className="text-xs uppercase text-text-muted">QR Format</p>
              <p className="font-bold text-text-main">{data.part.qr_format_name || "-"}</p>
            </div>
          </div>

          <div className="industrial-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="font-bold text-white">Station Journey</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => loadJourney(data.part.part_id)}
                  className="px-3 py-2 rounded-lg bg-bg-dark border border-border hover:border-primary text-text-muted inline-flex items-center gap-1"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
                <button
                  onClick={handleResetInterlock}
                  className="px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 text-warning inline-flex items-center gap-1"
                >
                  <ShieldOff size={14} />
                  Reset Interlock
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-bg-dark/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-text-muted">Station</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-text-muted">Start Time</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-text-muted">End Time</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-text-muted">Result</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-text-muted">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-text-muted">Interlock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(data.journey || []).map((row) => (
                    <tr key={row.id} className="hover:bg-bg-dark/30">
                      <td className="px-4 py-3 font-mono text-primary">{row.stationNo}</td>
                      <td className="px-4 py-3 text-text-main">
                        {row.plcStartTime ? new Date(row.plcStartTime).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3 text-text-main">
                        {row.plcEndTime ? new Date(row.plcEndTime).toLocaleString() : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {row.result === "OK" ? (
                          <span className="inline-flex items-center gap-1 text-accent text-sm">
                            <CheckCircle size={14} />
                            OK
                          </span>
                        ) : row.result === "NG" ? (
                          <span className="inline-flex items-center gap-1 text-danger text-sm">
                            <XCircle size={14} />
                            NG
                          </span>
                        ) : (
                          <span className="text-text-muted">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-main">{row.plcStatus}</td>
                      <td className="px-4 py-3 text-warning text-sm">{row.interlockReason || "-"}</td>
                    </tr>
                  ))}
                  {(!data.journey || data.journey.length === 0) && (
                    <tr>
                      <td colSpan="6" className="px-4 py-8 text-center text-text-muted">
                        No journey records
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="industrial-card p-6">
            <h2 className="font-bold text-white mb-4 flex items-center gap-2">
              <Wrench size={16} className="text-primary" />
              Rework Controls
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={reworkStation}
                onChange={(e) => setReworkStation(e.target.value)}
                className="bg-bg-dark border border-border rounded-lg py-3 px-3 text-text-main focus:border-primary outline-none"
                placeholder="Restart Station (e.g. ST-20)"
              />
              <input
                value={reworkReason}
                onChange={(e) => setReworkReason(e.target.value)}
                className="bg-bg-dark border border-border rounded-lg py-3 px-3 text-text-main focus:border-primary outline-none"
                placeholder="Reason (optional)"
              />
              <button
                onClick={handleRework}
                className="py-3 px-3 rounded-lg bg-primary hover:brightness-110 text-bg-dark font-bold"
              >
                Start Rework
              </button>
            </div>
            {data.interlockHistory?.length > 0 && (
              <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-lg">
                <p className="text-warning text-sm font-medium flex items-center gap-1">
                  <AlertTriangle size={14} />
                  Interlock History
                </p>
                <div className="mt-2 space-y-1">
                  {data.interlockHistory.slice(0, 5).map((item) => (
                    <p key={item.id} className="text-xs text-text-main">
                      {item.stationNo} - {item.reason} ({new Date(item.createdAt).toLocaleString()})
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ComponentJourney;
