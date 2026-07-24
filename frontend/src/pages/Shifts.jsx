import { useCallback, useEffect, useState } from "react";
import { Clock3, Plus, Save, Trash2, Pencil, X, RefreshCw, CheckCircle2, Calendar, TrendingUp, Activity } from "lucide-react";
import toast from "react-hot-toast";
import { shiftApi } from "../api/services";
import ConfirmModal from "../components/ConfirmModal";
import PlantLineSelector from "../components/PlantLineSelector";

const EMPTY_FORM = { plantId: "", lineId: "", lineName: "", shiftName: "", shiftCode: "", startTime: "", endTime: "", isActive: true };

const INPUT_CLS =
  "w-full bg-bg-dark border border-border rounded-lg px-3 py-2 text-sm text-text-main focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-text-muted/50";

const Label = ({ children, required }) => (
  <label className="block text-[10px] font-black uppercase tracking-wider text-text-muted mb-1.5">
    {children} {required && <span className="text-primary">*</span>}
  </label>
);

const SHIFT_COLORS = ["bg-primary/10 text-primary border-primary/20", "bg-accent/10 text-accent border-accent/20", "bg-slate-100 text-slate-700 border-slate-200", "bg-secondary/10 text-secondary border-secondary/20"];

const parseTimeParts = (value) => {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { hour: value.getUTCHours(), minute: value.getUTCMinutes(), second: value.getUTCSeconds() };
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const directMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (directMatch) {
    const hour = Number(directMatch[1]);
    const minute = Number(directMatch[2]);
    const second = Number(directMatch[3] || 0);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
      return { hour, minute, second };
    }
  }

  const isoMatch = raw.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/i);
  if (isoMatch) {
    const hour = Number(isoMatch[1]);
    const minute = Number(isoMatch[2]);
    const second = Number(isoMatch[3] || 0);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
      return { hour, minute, second };
    }
  }

  const parsedDate = new Date(raw);
  if (Number.isFinite(parsedDate.getTime())) {
    return { hour: parsedDate.getUTCHours(), minute: parsedDate.getUTCMinutes(), second: parsedDate.getUTCSeconds() };
  }

  return null;
};

const formatHHmmss = (value) => {
  const parts = parseTimeParts(value);
  if (!parts) return "--:--:--";
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second || 0).padStart(2, "0")}`;
};

const formatTimeInputValue = (value) => {
  const parts = parseTimeParts(value);
  if (!parts) return "";
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second || 0).padStart(2, "0")}`;
};

const toSeconds = (value) => {
  const parts = parseTimeParts(value);
  if (!parts) return null;
  return parts.hour * 3600 + parts.minute * 60 + (parts.second || 0);
};

const Shifts = () => {
  const [shifts, setShifts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [scopeFilter, setScopeFilter] = useState({ plantId: "", lineId: "" });
  const [statusFilter, setStatusFilter] = useState("ALL");

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const loadShifts = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const params = {};
      if (scopeFilter.plantId) params.plantId = scopeFilter.plantId;
      if (scopeFilter.lineId) params.lineId = scopeFilter.lineId;
      const data = await shiftApi.list(params);
      setShifts(data || []);
    } catch {
      if (!quiet) toast.error("Failed to load shifts");
    } finally {
      setRefreshing(false);
    }
  }, [scopeFilter]);

  useEffect(() => { loadShifts(); }, [loadShifts]);

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(false); };

  const handleEdit = (shift) => {
    setEditingId(shift.id);
    setForm({
      shiftName: shift.shiftName || "",
      plantId: String(shift.plantId || ""),
      lineId: String(shift.lineId || ""),
      lineName: shift.lineName || "",
      shiftCode: shift.shiftCode || "",
      startTime: formatTimeInputValue(shift.startTime),
      endTime: formatTimeInputValue(shift.endTime),
      isActive: Boolean(shift.isActive),
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingId) {
        await shiftApi.update(editingId, form);
        toast.success("Shift updated successfully");
      } else {
        await shiftApi.create(form);
        toast.success("Shift created successfully");
      }
      resetForm();
      await loadShifts(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save shift");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await shiftApi.remove(deleteTarget.id);
      toast.success(`Shift "${deleteTarget.shiftName}" deleted`);
      await loadShifts(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Delete failed");
    } finally {
      setDeleteTarget(null);
    }
  };

  const formatDuration = (start, end) => {
    if (!start || !end) return "-";
    const startSecs = toSeconds(start);
    const endSecs = toSeconds(end);
    if (startSecs === null || endSecs === null) return "-";
    let secs = endSecs - startSecs;
    if (secs < 0) secs += 86400;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}h ${m > 0 ? `${m}m` : ""}${s > 0 ? ` ${s}s` : ""}`;
  };

  // Calculate stats
  const activeShifts = shifts.filter(s => s.isActive).length;
  const totalHours = shifts.reduce((total, shift) => {
    const startSecs = toSeconds(shift.startTime);
    const endSecs = toSeconds(shift.endTime);
    if (startSecs !== null && endSecs !== null) {
      let secs = endSecs - startSecs;
      if (secs < 0) secs += 86400;
      return total + secs / 60;
    }
    return total;
  }, 0);
  const avgHoursPerShift = shifts.length > 0 ? (totalHours / shifts.length / 60).toFixed(1) : 0;
  const visibleShifts = shifts.filter((shift) => {
    if (statusFilter === "ACTIVE") return shift.isActive;
    if (statusFilter === "INACTIVE") return !shift.isActive;
    return true;
  });

  return (
    <div className="space-y-6 rise-in" style={{ fontFamily: "var(--font-outfit)" }}>
      {/* Header matching Station Control */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <Clock3 size={22} />
            </div>
            <div>
              <h1 className="db-header-title">Shift Manager</h1>
              <p className="db-header-subtitle">Define production shifts for reporting and time-based filtering</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => loadShifts()} disabled={refreshing} className="db-action-btn">
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={() => { setShowForm((p) => !p); if (editingId) resetForm(); }} className="db-action-btn">
              {showForm && !editingId ? <X size={14} /> : <Plus size={14} />}
              {showForm && !editingId ? "Cancel" : "Add Shift"}
            </button>
          </div>
        </div>
      </div>

      {/* Compact Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Total Shifts</p>
              <p className="text-2xl font-black text-primary font-mono">{shifts.length}</p>
            </div>
            <Calendar size={28} className="text-primary/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Active Shifts</p>
              <p className="text-2xl font-black text-accent font-mono">{activeShifts}</p>
            </div>
            <Activity size={28} className="text-accent/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Avg Duration</p>
              <p className="text-2xl font-black text-primary font-mono">{avgHoursPerShift}h</p>
            </div>
            <TrendingUp size={28} className="text-primary/30" />
          </div>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="industrial-card p-5">
          <h2 className="font-bold text-text-main mb-4 flex items-center gap-2 text-sm">
            {editingId ? <><Pencil size={14} className="text-primary" /> Edit Shift</> : <><Plus size={14} className="text-primary" /> New Shift</>}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="sm:col-span-2 lg:col-span-4">
              <PlantLineSelector
                value={form}
                onChange={(scope) => setForm((p) => ({ ...p, ...scope }))}
                includeAll
                compact
                className="grid grid-cols-1 gap-3 md:grid-cols-2"
                inputClassName={INPUT_CLS}
              />
            </div>
            <div>
              <Label required>Shift Name</Label>
              <input value={form.shiftName} onChange={set("shiftName")} required className={INPUT_CLS} placeholder="e.g. Morning Shift" />
            </div>
            <div>
              <Label required>Shift Code</Label>
              <input value={form.shiftCode} onChange={(e) => setForm((p) => ({ ...p, shiftCode: e.target.value.toUpperCase() }))} required className={INPUT_CLS} placeholder="SHIFT_A" />
            </div>
            <div>
              <Label required>Start Time</Label>
              <input type="time" step="1" value={form.startTime} onChange={set("startTime")} required className={INPUT_CLS} />
            </div>
            <div>
              <Label required>End Time</Label>
              <input type="time" step="1" value={form.endTime} onChange={set("endTime")} required className={INPUT_CLS} />
            </div>
            <div>
              <Label>Status</Label>
              <select value={form.isActive ? "1" : "0"} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.value === "1" }))} className={INPUT_CLS}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="button" onClick={resetForm} className="flex-1 px-4 py-2 border border-border rounded-lg text-text-muted hover:bg-bg-dark text-xs font-bold uppercase tracking-wider transition-colors">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-primary text-on-strong font-bold rounded-lg text-xs uppercase tracking-wider inline-flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-50">
                {loading ? <RefreshCw size={12} className="animate-spin" /> : editingId ? <Save size={12} /> : <Plus size={12} />}
                {loading ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Shifts Table */}
      <div className="industrial-card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-white flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex items-center justify-between gap-3 xl:self-center">
            <div className="flex items-center gap-2">
              <Clock3 size={14} className="text-primary" />
              <h2 className="text-[10px] font-black text-text-main uppercase tracking-wider">Shift Directory</h2>
            </div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded border border-border xl:hidden">
              {visibleShifts.length} Shift{visibleShifts.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(320px,520px)_150px_auto] md:items-end">
            <PlantLineSelector
              value={scopeFilter}
              onChange={setScopeFilter}
              includeAll
              compact
              hideLabels
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              inputClassName="h-9 w-full rounded-md border border-border bg-white px-3 text-xs font-semibold text-slate-800 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            <div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 w-full rounded-md border border-border bg-white px-3 text-xs font-semibold text-slate-800 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10">
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>
            </div>
            {(scopeFilter.plantId || scopeFilter.lineId) ? (
              <button
                type="button"
                onClick={() => setScopeFilter({ plantId: "", lineId: "" })}
                className="h-9 rounded-md border border-border bg-white px-3 text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              >
                Clear Scope
              </button>
            ) : (
              <span className="hidden text-center text-[9px] font-black text-slate-500 uppercase tracking-widest bg-slate-50 px-2 py-2 rounded border border-border md:block">
                {visibleShifts.length} Shift{visibleShifts.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-wider text-slate-500 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left">Shift Name</th>
                <th className="px-4 py-3 text-left">Scope</th>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Start</th>
                <th className="px-4 py-3 text-left">End</th>
                <th className="px-4 py-3 text-left">Duration</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {visibleShifts.map((shift, i) => (
                <tr key={shift.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-main text-sm">{shift.shiftName}</td>
                  <td className="px-4 py-3 text-[10px] font-bold text-text-muted">{shift.plantId || shift.lineId ? `Plant ${shift.plantId || "-"} / Line ${shift.lineId || "-"}` : "Global"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded border ${SHIFT_COLORS[i % SHIFT_COLORS.length]}`}>
                      {shift.shiftCode}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-text-main text-xs">{formatHHmmss(shift.startTime)}</td>
                  <td className="px-4 py-3 font-mono text-text-main text-xs">{formatHHmmss(shift.endTime)}</td>
                  <td className="px-4 py-3 text-text-muted text-xs font-semibold">{formatDuration(shift.startTime, shift.endTime)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${shift.isActive ? 'bg-accent animate-pulse' : 'bg-text-muted/30'}`} />
                      <span className={`text-[9px] font-black uppercase ${shift.isActive ? 'text-accent' : 'text-text-muted'}`}>
                        {shift.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button 
                        onClick={() => handleEdit(shift)} 
                        className="p-1.5 text-text-muted hover:text-primary hover:bg-primary/10 rounded transition-all"
                        title="Edit shift"
                      >
                        <Pencil size={13} />
                      </button>
                      <button 
                        onClick={() => setDeleteTarget(shift)} 
                        className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded transition-all"
                        title="Delete shift"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleShifts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <Clock3 size={32} className="mx-auto opacity-20 mb-3" />
                    <p className="text-text-muted text-xs font-medium">No shifts found</p>
                    <button onClick={() => setShowForm(true)} className="mt-2 text-primary text-[10px] font-bold uppercase tracking-wider hover:underline">
                      + Add your first shift
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Shift"
        message={`Are you sure you want to delete shift "${deleteTarget?.shiftName}" (${deleteTarget?.shiftCode})?`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
        confirmText="Delete Shift"
        confirmStyle="danger"
      />
    </div>
  );
};

export default Shifts;
