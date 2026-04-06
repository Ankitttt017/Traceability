// Scanners.jsx — Scanner Device Management
// Redesigned: card layout for scanners, clean inline form, machine mapping
import { useCallback, useEffect, useState } from "react";
import {
  ScanLine, Plus, Save, Trash2, Pencil, X,
  RefreshCw, Wifi, Network, ArrowRight, WifiOff, Info
} from "lucide-react";
import toast from "react-hot-toast";
import { scannerApi, machineApi } from "../api/services";
import { formatMachineLabel } from "../utils/machineFields";
import ConfirmModal from "../components/ConfirmModal";

/* ─── constants ────────────────────────────────────────────── */
const EMPTY_FORM = {
  scannerName: "", scannerIp: "", scannerPort: "9001",
  mappedMachineId: "", isActive: true,
};

/* ─── component ────────────────────────────────────────────── */
const Scanners = () => {
  const [scanners, setScanners] = useState([]);
  const [machines, setMachines] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [scannerData, machineData] = await Promise.all([
        scannerApi.list(),
        machineApi.list(),
      ]);
      setScanners(scannerData || []);
      setMachines((machineData || []).filter(m => m.status === "ACTIVE"));
    } catch {
      if (!quiet) toast.error("Failed to load scanner data");
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(false); };

  const handleEdit = (scanner) => {
    setEditingId(scanner.id);
    setForm({
      scannerName: scanner.scannerName || "",
      scannerIp: scanner.scannerIp || "",
      scannerPort: String(scanner.scannerPort || "9001"),
      mappedMachineId: String(scanner.mappedMachineId || ""),
      isActive: Boolean(scanner.isActive),
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        ...form,
        scannerPort: form.scannerPort ? Number(form.scannerPort) : null,
        mappedMachineId: form.mappedMachineId ? Number(form.mappedMachineId) : null,
      };
      if (editingId) await scannerApi.update(editingId, payload);
      else await scannerApi.create(payload);
      toast.success(editingId ? "Scanner updated" : "Scanner registered successfully");
      resetForm();
      await loadData(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save scanner");
    } finally { setLoading(false); }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await scannerApi.remove(deleteTarget.id);
      toast.success("Scanner removed");
      await loadData(true);
    } catch { toast.error("Failed to remove scanner"); }
    finally { setDeleteTarget(null); }
  };

  const openAdd = () => {
    if (editingId) resetForm();
    setShowForm(true);
  };

  const inputCls = "w-full bg-bg-dark border border-border rounded-lg px-3 py-2 text-sm text-text-main outline-none focus:border-primary/60 transition-colors placeholder:text-text-muted/40";
  const selectCls = "w-full bg-bg-dark border border-border rounded-lg px-3 py-2 text-sm text-text-main outline-none focus:border-primary/60 transition-colors";

  const activeScanners = scanners.filter(s => s.isActive);
  const inactiveScanners = scanners.filter(s => !s.isActive);

  return (
    <div className="space-y-6 rise-in">
      {/* ── Header ── */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <ScanLine size={22} />
            </div>
            <div>
              <h1 className="db-header-title">Scanner Management</h1>
              <p className="db-header-subtitle">Register &amp; map barcode scanners to production nodes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => loadData()} disabled={refreshing} className="db-secondary-btn">
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={showForm && !editingId ? resetForm : openAdd} className="db-action-btn">
              {showForm && !editingId ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Scanner</>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total scanners", value: scanners.length, color: "text-text-main" },
          { label: "Active", value: activeScanners.length, color: "text-accent" },
          { label: "Inactive", value: inactiveScanners.length, color: "text-text-muted" },
        ].map((s, i) => (
          <div key={i} className="bg-bg-card border border-border rounded-xl p-4">
            <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-1">{s.label}</p>
            <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Add / Edit Form (inline slide-in) ── */}
      {showForm && (
        <div className="bg-bg-card border border-primary/20 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-bg-dark/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network size={14} className="text-primary" />
              <h2 className="text-xs font-bold text-text-main uppercase tracking-wider">
                {editingId ? "Edit scanner" : "Register new scanner"}
              </h2>
            </div>
            <button onClick={resetForm} className="text-text-muted hover:text-text-main transition-colors">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Scanner name *</label>
                <input required value={form.scannerName} onChange={e => setForm({ ...form, scannerName: e.target.value })}
                  placeholder="e.g. OP10_Laser_01" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">IP address *</label>
                <input required value={form.scannerIp} onChange={e => setForm({ ...form, scannerIp: e.target.value })}
                  placeholder="192.168.1.50" className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">
                  TCP port
                  <span className="text-text-muted/50 normal-case tracking-normal font-normal ml-1">(optional)</span>
                </label>
                <input type="number" value={form.scannerPort} onChange={e => setForm({ ...form, scannerPort: e.target.value })}
                  placeholder="9001" className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Map to machine *</label>
                <select required value={form.mappedMachineId} onChange={e => setForm({ ...form, mappedMachineId: e.target.value })}
                  className={selectCls}>
                  <option value="">— Select production node —</option>
                  {machines.map(m => <option key={m.id} value={m.id}>{formatMachineLabel(m)}</option>)}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              {/* Active toggle */}
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div className="relative">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="sr-only peer" />
                  <div className="w-9 h-5 bg-border rounded-full peer peer-checked:bg-accent transition-colors"></div>
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </div>
                <span className="text-sm text-text-muted font-medium">Active device</span>
              </label>

              <div className="flex items-center gap-3">
                <button type="button" onClick={resetForm}
                  className="px-4 py-2 text-sm font-semibold text-text-muted hover:text-text-main transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  className="h-9 px-6 bg-primary text-on-strong font-bold rounded-xl text-sm flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-50">
                  <Save size={14} /> {loading ? "Saving…" : editingId ? "Save changes" : "Register device"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ── Info banner if no machines ── */}
      {machines.length === 0 && (
        <div className="flex items-start gap-3 p-4 bg-warning/5 border border-warning/20 rounded-xl">
          <Info size={16} className="text-warning mt-0.5 flex-shrink-0" />
          <p className="text-sm text-text-muted">
            No active machines found. <span className="font-semibold text-text-main">Add machines first</span> in the Machine Registry before mapping scanners to them.
          </p>
        </div>
      )}

      {/* ── Scanner List ── */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-bg-dark/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network size={14} className="text-primary" />
            <h2 className="text-xs font-bold text-text-main uppercase tracking-wider">Registered devices</h2>
          </div>
          <span className="text-[11px] text-text-muted bg-bg-dark px-3 py-1 rounded-lg border border-border">
            {scanners.length} device{scanners.length !== 1 ? "s" : ""}
          </span>
        </div>

        {scanners.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-text-muted">
            <ScanLine size={40} className="opacity-15 mb-3" />
            <p className="font-semibold text-sm">No scanners registered</p>
            <p className="text-xs mt-1 text-text-muted/60">Click "Add Scanner" above to register your first device</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-dark/50 text-[10px] font-semibold uppercase tracking-widest text-text-muted border-b border-border">
                <tr>
                  <th className="px-5 py-3 text-left">Scanner</th>
                  <th className="px-5 py-3 text-left">Endpoint</th>
                  <th className="px-5 py-3 text-left">Mapped to</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {scanners.map(scanner => (
                  <tr key={scanner.id} className="group hover:bg-bg-dark/20 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${scanner.isActive ? "bg-primary/10 text-primary border border-primary/20" : "bg-bg-dark text-text-muted border border-border opacity-50"}`}>
                          {scanner.isActive ? <Wifi size={16} /> : <WifiOff size={16} />}
                        </div>
                        <div>
                          <p className="font-semibold text-text-main">{scanner.scannerName}</p>
                          <p className="text-[10px] text-text-muted mt-0.5">ID: {scanner.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-mono text-xs text-text-main">{scanner.scannerIp}</p>
                      <p className="text-[10px] text-text-muted mt-0.5">Port: {scanner.scannerPort || "8000"}</p>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <ArrowRight size={11} className="text-primary/50" />
                        <span className="text-xs font-semibold text-text-main">
                          {scanner.mappedMachine?.machineName || "Unassigned"}
                        </span>
                      </div>
                      {scanner.mappedMachine?.lineName && (
                        <p className="text-[10px] text-text-muted mt-0.5 ml-4">{scanner.mappedMachine.lineName}</p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${scanner.isActive ? "bg-accent/10 border border-accent/20 text-accent" : "bg-bg-dark border border-border text-text-muted"}`}>
                        {scanner.isActive && <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
                        {scanner.isActive ? "Active" : "Inactive"}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleEdit(scanner)}
                          className="p-2 text-text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-all">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => setDeleteTarget(scanner)}
                          className="p-2 text-text-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-all">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Remove scanner?"
        message={`Remove "${deleteTarget?.scannerName}"? This disconnects it from its production node. Historical scan data is preserved.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default Scanners;