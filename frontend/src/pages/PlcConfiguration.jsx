import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, Download, RefreshCw, Save, Trash2 } from "lucide-react";
import { plcConfigApi } from "../api/services";

const RANGE_REGEX = /^\s*(\d+)\s*[-:]\s*(\d+)\s*$/;

function createForm() {
  return {
    plcName: "",
    plcIp: "",
    plcPort: "502",
    plcProtocol: "MODBUS_TCP",
    rangeInput: "",
    status: "ACTIVE",
  };
}

function parseRangeInput(inputValue) {
  const normalized = String(inputValue || "").trim();
  const match = normalized.match(RANGE_REGEX);
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const size = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(size) || size < 4) {
    return null;
  }

  return {
    start: Math.trunc(start),
    size: Math.trunc(size),
    end: Math.trunc(start + size - 1),
  };
}

function toCsvCell(value) {
  const text = String(value ?? "");
  if (!text.includes(",") && !text.includes('"') && !text.includes("\n")) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

const PlcConfiguration = () => {
  const [ranges, setRanges] = useState([]);
  const [formData, setFormData] = useState(() => createForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState({ type: "", message: "" });

  const parsedRange = useMemo(() => parseRangeInput(formData.rangeInput), [formData.rangeInput]);

  const handshakePreview = useMemo(() => {
    if (!parsedRange) {
      return null;
    }
    return [
      { key: "trigger", label: "Trigger Register", reg: parsedRange.start },
      { key: "interlock", label: "Interlock Register", reg: parsedRange.start + 1 },
      { key: "complete", label: "Complete Register", reg: parsedRange.start + 2 },
      { key: "reset", label: "Reset Register", reg: parsedRange.start + 3 },
    ];
  }, [parsedRange]);

  const loadData = useCallback(async (showLoader = true) => {
    if (showLoader) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const data = await plcConfigApi.listRanges();
      setRanges(data || []);
      setStatus({ type: "", message: "" });
    } catch (error) {
      setStatus({
        type: "error",
        message: error.response?.data?.error || "Failed to load PLC ranges",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  const updateField = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!parsedRange) {
      setStatus({
        type: "error",
        message: "Range format should be start-size and minimum size is 4 (example: 100-10).",
      });
      return;
    }

    try {
      setSaving(true);
      const rangeSeed = String(formData.plcName || "").trim() || String(formData.plcIp || "").trim() || "RANGE";
      const rangeName = `${rangeSeed}_${parsedRange.start}-${parsedRange.end}`;

      await plcConfigApi.createRange({
        rangeName,
        plcName: String(formData.plcName || "").trim(),
        plcIp: String(formData.plcIp || "").trim(),
        plcPort: Number(formData.plcPort),
        plcProtocol: formData.plcProtocol,
        rangeInput: String(formData.rangeInput || "").trim(),
        status: formData.status,
        defaultRegisters: {
          startRegister: parsedRange.start,
          statusRegister: parsedRange.start + 1,
          stationRegister: parsedRange.start + 2,
          resetRegister: parsedRange.start + 3,
        },
      });

      setStatus({ type: "success", message: "PLC range saved." });
      setFormData(createForm());
      await loadData(false);
    } catch (error) {
      const responseData = error?.response?.data;
      const text = typeof responseData === "string" ? responseData : JSON.stringify(responseData || {});
      const cannotPost =
        Number(error?.response?.status || 0) === 404 && text.toUpperCase().includes("CANNOT POST");

      setStatus({
        type: "error",
        message: cannotPost
          ? "API route not found. Restart backend and confirm latest server code is running."
          : error.response?.data?.error || "Failed to save PLC range",
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteRange = async (row) => {
    if (!window.confirm(`Delete range ${row.rangeName}?`)) {
      return;
    }

    try {
      await plcConfigApi.deleteRange(row.id);
      await loadData(false);
      setStatus({ type: "success", message: "Range deleted." });
    } catch (error) {
      setStatus({
        type: "error",
        message: error.response?.data?.error || "Failed to delete range",
      });
    }
  };

  const downloadForPlc = () => {
    const rows = [["PLC IP", "PLC Port", "Protocol", "Range", "Signal", "Register"]];

    for (const row of ranges) {
      const start = Number(row.rangeStart);
      if (!Number.isFinite(start)) {
        continue;
      }

      const signals = [
        ["Trigger Register", start],
        ["Interlock Register", start + 1],
        ["Complete Register", start + 2],
        ["Reset Register", start + 3],
      ];

      for (const [signalLabel, registerNo] of signals) {
        rows.push([
          row.plcIp || "",
          row.plcPort ?? "",
          row.plcProtocol || "",
          `${row.rangeStart}-${row.rangeEnd}`,
          signalLabel,
          registerNo,
        ]);
      }
    }

    const csv = rows.map((row) => row.map((entry) => toCsvCell(entry)).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plc_handshake_mapping.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 text-text-main bg-bg-dark min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="text-primary" /> PLC Handshake Master
          </h1>
          <p className="text-sm text-text-muted">Define PLC register ranges once and bind machines dynamically.</p>
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
            onClick={downloadForPlc}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg-dark hover:brightness-110"
          >
            <Download size={14} />
            Export for PLC Dev
          </button>
        </div>
      </header>

      {status.message ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            status.type === "success"
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {status.message}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={handleSubmit} className="lg:col-span-1 space-y-4 bg-bg-card p-6 rounded-2xl border border-border">
          <h2 className="font-bold text-primary uppercase text-xs tracking-widest">PLC Setup</h2>

          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase">PLC Name</label>
            <input
              value={formData.plcName}
              onChange={(event) => updateField("plcName", event.target.value)}
              placeholder="Line 1 Main PLC"
              className="w-full bg-bg-dark p-3 rounded-xl border border-border mt-1"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase">PLC IP Address</label>
            <input
              required
              value={formData.plcIp}
              onChange={(event) => updateField("plcIp", event.target.value)}
              placeholder="192.168.1.50"
              className="w-full bg-bg-dark p-3 rounded-xl border border-border mt-1 font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase">PLC Port</label>
            <input
              required
              type="number"
              value={formData.plcPort}
              onChange={(event) => updateField("plcPort", event.target.value)}
              className="w-full bg-bg-dark p-3 rounded-xl border border-border mt-1 font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase">Protocol</label>
            <select
              value={formData.plcProtocol}
              onChange={(event) => updateField("plcProtocol", event.target.value)}
              className="w-full bg-bg-dark p-3 rounded-xl border border-border mt-1 font-mono"
            >
              <option value="MODBUS_TCP">MODBUS_TCP</option>
              <option value="TCP_TEXT">TCP_TEXT</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-primary uppercase">Register Range (Start-Size)</label>
            <input
              required
              value={formData.rangeInput}
              onChange={(event) => updateField("rangeInput", event.target.value)}
              placeholder="100-10"
              className="w-full bg-bg-dark p-3 rounded-xl border-2 border-primary/50 mt-1 font-mono text-lg"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase">Status</label>
            <select
              value={formData.status}
              onChange={(event) => updateField("status", event.target.value)}
              className="w-full bg-bg-dark p-3 rounded-xl border border-border mt-1"
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>

          {handshakePreview ? (
            <div className="bg-primary/5 p-4 rounded-xl border border-primary/20 space-y-2">
              <p className="text-[10px] font-black text-primary uppercase tracking-widest">Auto Handshake Mapping</p>
              {handshakePreview.map((row) => (
                <div key={row.key} className="flex justify-between text-[11px] border-b border-white/5 pb-1">
                  <span className="text-text-muted">{row.label}</span>
                  <span className="font-mono font-bold text-accent">R{row.reg}</span>
                </div>
              ))}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-primary text-bg-dark font-bold py-3 rounded-xl mt-4 flex justify-center gap-2 disabled:opacity-60"
          >
            <Save size={18} /> {saving ? "Saving..." : "Save PLC Config"}
          </button>
        </form>

        <div className="lg:col-span-2 bg-bg-card rounded-2xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-semibold text-text-main">Configured PLC Ranges</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-bg-dark/50 text-[10px] uppercase text-text-muted">
                <tr>
                  <th className="p-4">PLC IP</th>
                  <th className="p-4">Port</th>
                  <th className="p-4">Protocol</th>
                  <th className="p-4">Range</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!loading && ranges.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-sm text-text-muted">
                      No PLC ranges configured.
                    </td>
                  </tr>
                ) : (
                  ranges.map((row) => (
                    <tr key={row.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-4 font-mono text-sm">{row.plcIp || "-"}</td>
                      <td className="p-4 font-mono text-sm">{row.plcPort ?? "-"}</td>
                      <td className="p-4 font-mono text-sm">{row.plcProtocol || "-"}</td>
                      <td className="p-4">
                        <span className="bg-bg-dark px-2 py-1 rounded border border-border text-xs font-mono text-accent">
                          {row.rangeStart} - {row.rangeEnd}
                        </span>
                      </td>
                      <td className="p-4 text-xs font-bold text-accent">{row.status || "ACTIVE"}</td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => deleteRange(row)}
                          className="text-danger p-2 hover:bg-danger/10 rounded-lg"
                          title="Delete range"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlcConfiguration;
