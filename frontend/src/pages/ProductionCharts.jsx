import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Factory,
  TrendingUp,
  Download,
  RefreshCw,
  BarChart3,
  PieChart,
  LineChart,
  Activity,
} from "lucide-react";
import {
  LineChart as ReLineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart as RePieChart,
  Pie,
  Cell,
} from "recharts";
import { dashboardApi, machineApi } from "../api/services";

const PIE_COLORS = ["#74959A", "#98B4AA", "#F1E0AC", "#E27D60", "#495371", "#8BAA9D"];

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

function toDateRange(timeRange) {
  const now = new Date();
  const from = new Date(now);
  if (timeRange === "daily") {
    from.setDate(now.getDate() - 1);
  } else if (timeRange === "weekly") {
    from.setDate(now.getDate() - 7);
  } else {
    from.setDate(now.getDate() - 30);
  }
  return {
    dateFrom: from.toISOString(),
    dateTo: now.toISOString(),
  };
}

const ProductionPage = () => {
  const [timeRange, setTimeRange] = useState("weekly");
  const [chartType, setChartType] = useState("line");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({
    machines: { total: 0, active: 0, inactive: 0 },
    parts: { inProgress: 0, completed: 0, ng: 0, interlocked: 0, rework: 0 },
    quality: { ok: 0, ng: 0 },
  });
  const [report, setReport] = useState({
    machineWise: [],
    hourlyProduction: [],
    shiftProduction: {
      SHIFT_A: { total: 0, ok: 0, ng: 0 },
      SHIFT_B: { total: 0, ok: 0, ng: 0 },
      SHIFT_C: { total: 0, ok: 0, ng: 0 },
    },
  });
  const [machines, setMachines] = useState([]);
  const [status, setStatus] = useState({ type: "", message: "" });

  const query = useMemo(() => toDateRange(timeRange), [timeRange]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setStatus({ type: "", message: "" });
    try {
      const [summaryData, reportData, machineData] = await Promise.all([
        dashboardApi.summary(query),
        dashboardApi.report(query),
        machineApi.list(),
      ]);
      setSummary(summaryData || {
        machines: { total: 0, active: 0, inactive: 0 },
        parts: { inProgress: 0, completed: 0, ng: 0, interlocked: 0, rework: 0 },
        quality: { ok: 0, ng: 0 },
      });
      setReport(reportData || {
        machineWise: [],
        hourlyProduction: [],
        shiftProduction: {
          SHIFT_A: { total: 0, ok: 0, ng: 0 },
          SHIFT_B: { total: 0, ok: 0, ng: 0 },
          SHIFT_C: { total: 0, ok: 0, ng: 0 },
        },
      });
      setMachines(machineData || []);
    } catch (error) {
      setStatus({
        type: "error",
        message: error.response?.data?.error || "Production data unavailable",
      });
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadData().catch(() => {});
  }, [loadData]);

  const productionData = useMemo(
    () =>
      (report.hourlyProduction || []).map((row) => ({
        date: row.hour,
        output: Number(row.total || 0),
      })),
    [report.hourlyProduction]
  );

  const machineProduction = useMemo(() => {
    const machineMap = new Map(machines.map((machine) => [Number(machine.id), machine.machineName]));
    return (report.machineWise || []).map((row, index) => ({
      name: machineMap.get(Number(row.machine_id)) || `Machine ${row.machine_id}`,
      value: Number(row.ok || 0) + Number(row.ng || 0),
      color: PIE_COLORS[index % PIE_COLORS.length],
    }));
  }, [machines, report.machineWise]);

  const qualityData = useMemo(
    () => [
      { name: "Pass", value: Number(summary.quality?.ok || 0), color: "#98B4AA" },
      { name: "Defects", value: Number(summary.quality?.ng || 0), color: "#E27D60" },
    ],
    [summary.quality]
  );

  const totalUnits = Number(summary.quality?.ok || 0) + Number(summary.quality?.ng || 0);
  const efficiency = totalUnits > 0 ? Math.round((Number(summary.quality?.ok || 0) / totalUnits) * 100) : 0;

  const handleExport = async () => {
    try {
      const blob = await dashboardApi.exportReport(query);
      downloadBlob(blob, "production_report.csv");
    } catch (error) {
      setStatus({
        type: "error",
        message: error.response?.data?.error || "Export failed",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-primary/10 text-primary rounded-2xl border border-primary/20">
            <Factory size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Production Overview</h1>
            <p className="text-text-muted text-sm">Dynamic production and quality metrics from live logs</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={() => loadData().catch(() => {})} className="p-2 hover:bg-bg-card rounded-lg transition-colors">
            <RefreshCw size={18} className={`text-text-muted ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={handleExport} className="p-2 hover:bg-bg-card rounded-lg transition-colors" title="Export CSV">
            <Download size={18} className="text-text-muted" />
          </button>
        </div>
      </div>

      {status.message && (
        <div className="p-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-sm">{status.message}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-2 bg-bg-card rounded-lg p-1">
          <button
            onClick={() => setTimeRange("daily")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              timeRange === "daily" ? "bg-primary text-bg-dark" : "text-text-muted hover:text-text-main"
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setTimeRange("weekly")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              timeRange === "weekly" ? "bg-primary text-bg-dark" : "text-text-muted hover:text-text-main"
            }`}
          >
            Weekly
          </button>
          <button
            onClick={() => setTimeRange("monthly")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              timeRange === "monthly" ? "bg-primary text-bg-dark" : "text-text-muted hover:text-text-main"
            }`}
          >
            Monthly
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setChartType("line")}
            className={`p-2 rounded-lg transition-colors ${
              chartType === "line" ? "bg-primary text-bg-dark" : "bg-bg-card text-text-muted hover:text-text-main"
            }`}
          >
            <LineChart size={18} />
          </button>
          <button
            onClick={() => setChartType("bar")}
            className={`p-2 rounded-lg transition-colors ${
              chartType === "bar" ? "bg-primary text-bg-dark" : "bg-bg-card text-text-muted hover:text-text-main"
            }`}
          >
            <BarChart3 size={18} />
          </button>
        </div>
      </div>

      <div className="industrial-card p-6">
        <h2 className="font-bold mb-4">Production Output</h2>
        <ResponsiveContainer width="100%" height={400}>
          {chartType === "line" ? (
            <ReLineChart data={productionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="output" stroke="#74959A" strokeWidth={2} />
            </ReLineChart>
          ) : (
            <BarChart data={productionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="date" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Legend />
              <Bar dataKey="output" fill="#74959A" />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="industrial-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-primary/10 rounded-lg">
              <Activity className="text-primary" size={24} />
            </div>
            <span className="text-xs text-text-muted">selected range</span>
          </div>
          <p className="text-3xl font-bold">{totalUnits}</p>
          <p className="text-text-muted text-sm">Total Units</p>
        </div>

        <div className="industrial-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-accent/10 rounded-lg">
              <Activity className="text-accent" size={24} />
            </div>
            <span className="text-xs text-text-muted">quality</span>
          </div>
          <p className="text-3xl font-bold">{efficiency}%</p>
          <p className="text-text-muted text-sm">Pass Efficiency</p>
        </div>

        <div className="industrial-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-warning/10 rounded-lg">
              <Activity className="text-warning" size={24} />
            </div>
            <span className="text-xs text-text-muted">interlocks</span>
          </div>
          <p className="text-3xl font-bold">{summary.parts?.interlocked || 0}</p>
          <p className="text-text-muted text-sm">Current Interlocks</p>
        </div>

        <div className="industrial-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-danger/10 rounded-lg">
              <TrendingUp className="text-danger" size={24} />
            </div>
            <span className="text-xs text-text-muted">rework</span>
          </div>
          <p className="text-3xl font-bold">{summary.parts?.rework || 0}</p>
          <p className="text-text-muted text-sm">Rework Parts</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="industrial-card p-6">
          <h2 className="font-bold mb-4 flex items-center gap-2">
            <PieChart size={18} className="text-primary" />
            Production by Machine
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <RePieChart>
              <Pie data={machineProduction} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value" label>
                {machineProduction.map((entry, index) => (
                  <Cell key={`${entry.name}-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </RePieChart>
          </ResponsiveContainer>
        </div>

        <div className="industrial-card p-6">
          <h2 className="font-bold mb-4 flex items-center gap-2">
            <PieChart size={18} className="text-primary" />
            Quality Analysis
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <RePieChart>
              <Pie data={qualityData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value" label>
                {qualityData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </RePieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-4 mt-4">
            {qualityData.map((item) => (
              <div key={item.name} className="text-center">
                <div className="text-lg font-bold" style={{ color: item.color }}>
                  {item.value}
                </div>
                <div className="text-xs text-text-muted">{item.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductionPage;
