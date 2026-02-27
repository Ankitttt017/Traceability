import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Download, RefreshCw, Funnel } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { dashboardApi, machineApi } from "../api/services";
import { formatMachineLabel } from "../utils/machineFields";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

const EMPTY_SUMMARY = {
  machines: { total: 0, active: 0, inactive: 0 },
  parts: { inProgress: 0, completed: 0, ng: 0, interlocked: 0, rework: 0 },
  quality: { ok: 0, ng: 0 },
  recentScans: [],
  availableShifts: [],
};

const EMPTY_REPORT = {
  machineWise: [],
  hourlyProduction: [],
  shiftProduction: {
    SHIFT_A: { total: 0, ok: 0, ng: 0 },
    SHIFT_B: { total: 0, ok: 0, ng: 0 },
    SHIFT_C: { total: 0, ok: 0, ng: 0 },
  },
  interlockHistory: [],
  reworkCount: 0,
  partJourney: [],
};

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const Dashboard = () => {
  const [machines, setMachines] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [report, setReport] = useState(EMPTY_REPORT);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [showFilters, setShowFilters] = useState(true);
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    machineId: "",
    partId: "",
    status: "",
    shiftCode: "",
  });

  const query = useMemo(
    () => ({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      machineId: filters.machineId || undefined,
      partId: filters.partId || undefined,
      status: filters.status || undefined,
      shiftCode: filters.shiftCode || undefined,
    }),
    [filters.dateFrom, filters.dateTo, filters.machineId, filters.partId, filters.status, filters.shiftCode]
  );

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setStatus({ type: "", message: "" });
    try {
      const [machineData, summaryData, reportData] = await Promise.all([
        machineApi.list(),
        dashboardApi.summary(query),
        dashboardApi.report(query),
      ]);
      setMachines(machineData);
      setSummary(summaryData || EMPTY_SUMMARY);
      setReport(reportData || EMPTY_REPORT);
    } catch (error) {
      setStatus({
        type: "error",
        message: error.response?.data?.error || "Dashboard data unavailable. Showing latest known snapshot.",
      });
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadDashboard();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadDashboard]);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
    });

    socket.on("dashboard_refresh", () => {
      loadDashboard();
    });

    return () => {
      socket.disconnect();
    };
  }, [loadDashboard]);

  const handleExport = async () => {
    try {
      const blob = await dashboardApi.exportReport(query);
      downloadBlob(blob, "traceability_report.csv");
    } catch (error) {
      console.error("CSV export failed:", error);
    }
  };

  const handleExportPdf = () => {
    const generatedAt = new Date().toLocaleString();
    const filterLine = [
      filters.dateFrom ? `From: ${filters.dateFrom}` : null,
      filters.dateTo ? `To: ${filters.dateTo}` : null,
      filters.machineId ? `Machine: ${filters.machineId}` : "Machine: All",
      filters.status ? `Status: ${filters.status}` : "Status: All",
      filters.shiftCode ? `Shift: ${filters.shiftCode}` : "Shift: All",
    ]
      .filter(Boolean)
      .join(" | ");

    const machineRows = (report?.machineWise || [])
      .map(
        (row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.machine_id)}</td>
            <td>${escapeHtml(row.ok ?? 0)}</td>
            <td>${escapeHtml(row.ng ?? 0)}</td>
            <td>${escapeHtml((Number(row.ok || 0) + Number(row.ng || 0)).toString())}</td>
          </tr>
        `
      )
      .join("");

    const interlockRows = (report?.interlockHistory || [])
      .slice(0, 100)
      .map(
        (row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.part_id || "-")}</td>
            <td>${escapeHtml(row.station_no || row.operation_no || "-")}</td>
            <td>${escapeHtml(row.interlock_reason || "-")}</td>
            <td>${escapeHtml(new Date(row.createdAt).toLocaleString())}</td>
          </tr>
        `
      )
      .join("");

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Traceability Production Report</title>
    <style>
      body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
      h1 { margin: 0 0 4px; font-size: 22px; }
      .meta { color: #444; font-size: 12px; margin-bottom: 16px; }
      .cards { display: grid; grid-template-columns: repeat(5, minmax(100px, 1fr)); gap: 8px; margin-bottom: 16px; }
      .card { border: 1px solid #ddd; border-radius: 6px; padding: 8px; font-size: 12px; }
      .card strong { display: block; font-size: 16px; margin-top: 4px; }
      h2 { font-size: 14px; margin: 18px 0 8px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #d4d4d4; padding: 6px; text-align: left; vertical-align: top; }
      th { background: #f5f5f5; }
      .empty { color: #666; font-style: italic; }
    </style>
  </head>
  <body>
    <h1>IndusTrace Production Report</h1>
    <div class="meta">Generated: ${escapeHtml(generatedAt)}</div>
    <div class="meta">${escapeHtml(filterLine || "No filters applied")}</div>

    <div class="cards">
      <div class="card">Total Machines<strong>${escapeHtml(summary.machines.total)}</strong></div>
      <div class="card">In Progress<strong>${escapeHtml(summary.parts.inProgress)}</strong></div>
      <div class="card">Completed<strong>${escapeHtml(summary.parts.completed)}</strong></div>
      <div class="card">NG<strong>${escapeHtml(summary.parts.ng)}</strong></div>
      <div class="card">Interlocked<strong>${escapeHtml(summary.parts.interlocked || 0)}</strong></div>
    </div>

    <h2>Machine-wise Production</h2>
    ${
      machineRows
        ? `<table>
            <thead>
              <tr><th>#</th><th>Machine</th><th>OK</th><th>NG</th><th>Total</th></tr>
            </thead>
            <tbody>${machineRows}</tbody>
          </table>`
        : '<div class="empty">No machine production rows for selected range.</div>'
    }

    <h2>Interlock History</h2>
    ${
      interlockRows
        ? `<table>
            <thead>
              <tr><th>#</th><th>Part ID</th><th>Station</th><th>Reason</th><th>Time</th></tr>
            </thead>
            <tbody>${interlockRows}</tbody>
          </table>`
        : '<div class="empty">No interlock entries for selected range.</div>'
    }
  </body>
</html>`;

    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setStatus({
        type: "error",
        message: "Popup blocked. Enable popups to export PDF.",
      });
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 300);
  };

  const machineWiseData = (report?.machineWise || []).map((row) => ({
    machineId: row.machine_id,
    ok: Number(row.ok || 0),
    ng: Number(row.ng || 0),
  }));

  const hourlyData = (report?.hourlyProduction || []).map((row) => ({
    hour: row.hour,
    total: Number(row.total || 0),
  }));

  return (
    <div className="space-y-6">
      {status.message && (
        <div className="p-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-sm">{status.message}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main">Production Dashboard</h1>
          <p className="text-text-muted text-sm">Live industrial traceability and production intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadDashboard}
            className="px-3 py-2 rounded-lg bg-bg-card border border-border text-text-muted hover:border-primary inline-flex items-center gap-1"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            onClick={() => setShowFilters((prev) => !prev)}
            className="px-3 py-2 rounded-lg bg-bg-card border border-border text-text-muted hover:border-primary inline-flex items-center gap-1"
          >
            <Funnel size={14} />
            {showFilters ? "Hide Filters" : "Show Filters"}
          </button>
          <button
            onClick={handleExport}
            className="px-3 py-2 rounded-lg bg-primary text-bg-dark font-bold inline-flex items-center gap-1"
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            onClick={handleExportPdf}
            className="px-3 py-2 rounded-lg border border-border bg-bg-card text-text-main font-semibold inline-flex items-center gap-1 hover:border-primary"
          >
            <Download size={14} />
            Export PDF
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="industrial-card p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
            className="bg-bg-dark border border-border rounded-lg p-2.5 text-text-main"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
            className="bg-bg-dark border border-border rounded-lg p-2.5 text-text-main"
          />
          <select
            value={filters.machineId}
            onChange={(e) => setFilters((prev) => ({ ...prev, machineId: e.target.value }))}
            className="bg-bg-dark border border-border rounded-lg p-2.5 text-text-main"
          >
            <option value="">All Machines</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {formatMachineLabel(machine)}
              </option>
            ))}
          </select>
          <input
            value={filters.partId}
            onChange={(e) => setFilters((prev) => ({ ...prev, partId: e.target.value }))}
            placeholder="Part ID"
            className="bg-bg-dark border border-border rounded-lg p-2.5 text-text-main"
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            className="bg-bg-dark border border-border rounded-lg p-2.5 text-text-main"
          >
            <option value="">All Status</option>
            <option value="OK">OK</option>
            <option value="NG">NG</option>
          </select>
          <select
            value={filters.shiftCode}
            onChange={(e) => setFilters((prev) => ({ ...prev, shiftCode: e.target.value }))}
            className="bg-bg-dark border border-border rounded-lg p-2.5 text-text-main"
          >
            <option value="">All Shifts</option>
            {(summary.availableShifts || []).map((shift) => (
              <option key={shift.shiftCode} value={shift.shiftCode}>
                {shift.shiftCode} ({String(shift.startTime || "").slice(0, 5)}-{String(shift.endTime || "").slice(0, 5)})
              </option>
            ))}
          </select>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="industrial-card p-4">
          <p className="text-xs text-text-muted">Total Machines</p>
          <p className="text-2xl font-bold text-text-main">{summary.machines.total}</p>
        </div>
        <div className="industrial-card p-4">
          <p className="text-xs text-text-muted">In Progress</p>
          <p className="text-2xl font-bold text-primary">{summary.parts.inProgress}</p>
        </div>
        <div className="industrial-card p-4">
          <p className="text-xs text-text-muted">Completed</p>
          <p className="text-2xl font-bold text-accent">{summary.parts.completed}</p>
        </div>
        <div className="industrial-card p-4">
          <p className="text-xs text-text-muted">NG</p>
          <p className="text-2xl font-bold text-danger">{summary.parts.ng}</p>
        </div>
        <div className="industrial-card p-4">
          <p className="text-xs text-text-muted">Interlocked</p>
          <p className="text-2xl font-bold text-warning">{summary.parts.interlocked || 0}</p>
        </div>
      </div>

      {report?.shiftProduction && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(report.shiftProduction).map(([shift, row]) => (
            <div key={shift} className="industrial-card p-4">
              <p className="text-xs text-text-muted">{shift}</p>
              <p className="text-xl font-bold text-text-main">{row.total}</p>
              <p className="text-xs text-text-muted mt-1">
                <span className="text-accent font-semibold">{row.ok}</span> OK /{" "}
                <span className="text-danger font-semibold">{row.ng}</span> NG
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="industrial-card p-5">
          <h2 className="font-bold text-text-main mb-3">Machine-wise OK/NG</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={machineWiseData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="machineId" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Legend />
              <Bar dataKey="ok" fill="#10b981" />
              <Bar dataKey="ng" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="industrial-card p-5">
          <h2 className="font-bold text-text-main mb-3">Hourly Production</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="hour" stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Line type="monotone" dataKey="total" stroke="#38bdf8" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="industrial-card p-5">
        <h2 className="font-bold text-text-main mb-3">Interlock History</h2>
        <div className="space-y-2 max-h-[260px] overflow-y-auto">
          {(report?.interlockHistory || []).map((row) => (
            <div key={row.id} className="p-3 bg-bg-dark border border-border rounded-lg">
              <p className="text-sm text-warning">{row.interlock_reason}</p>
              <p className="text-xs text-text-muted mt-1">
                Part: {row.part_id} | Station: {row.station_no || row.operation_no} | {new Date(row.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
          {(report?.interlockHistory || []).length === 0 && (
            <p className="text-sm text-text-muted">No interlock entries in selected range.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
