import { useCallback, useEffect, useState } from "react";
import { Clock3, Plus, Save, Trash2, Pencil, X, RefreshCw, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { shiftApi } from "../api/services";
import ConfirmModal from "../components/ConfirmModal";

const EMPTY_FORM = { shiftName: "", shiftCode: "", startTime: "", endTime: "", isActive: true };

const INPUT_CLS =
  "w-full bg-bg-dark border border-border rounded-xl px-3 py-2.5 text-sm text-text-main focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-text-muted/50";

const Label = ({ children, required }) => (
  <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
    {children} {required && <span className="text-primary">*</span>}
  </label>
);

const SHIFT_COLORS = ["bg-primary/10 text-primary border-primary/20", "bg-accent/10 text-accent border-accent/20", "bg-warning/10 text-warning border-warning/20", "bg-secondary/10 text-secondary border-secondary/20"];

const parseTimeParts = (value) => {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { hour: value.getUTCHours(), minute: value.getUTCMinutes() };
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const directMatch = raw.match(/^(\d{1,2}):(\d{2})/);
  if (directMatch) {
    const hour = Number(directMatch[1]);
    const minute = Number(directMatch[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const isoMatch = raw.match(/T(\d{2}):(\d{2})/i);
  if (isoMatch) {
    const hour = Number(isoMatch[1]);
    const minute = Number(isoMatch[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const parsedDate = new Date(raw);
  if (Number.isFinite(parsedDate.getTime())) {
    return { hour: parsedDate.getUTCHours(), minute: parsedDate.getUTCMinutes() };
  }

  return null;
};

const formatHHmm = (value) => {
  const parts = parseTimeParts(value);
  if (!parts) return "--:--";
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
};

const formatTimeInputValue = (value) => {
  const parts = parseTimeParts(value);
  if (!parts) return "";
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
};

const toMinutes = (value) => {
  const parts = parseTimeParts(value);
  if (!parts) return null;
  return parts.hour * 60 + parts.minute;
};

const Shifts = () => {
  const [shifts, setShifts] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const set = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const loadShifts = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const data = await shiftApi.list();
      setShifts(data || []);
    } catch {
      if (!quiet) toast.error("Failed to load shifts");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadShifts(); }, [loadShifts]);

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(false); };

  const handleEdit = (shift) => {
    setEditingId(shift.id);
    setForm({
      shiftName: shift.shiftName || "",
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
    const startMins = toMinutes(start);
    const endMins = toMinutes(end);
    if (startMins === null || endMins === null) return "-";
    let mins = endMins - startMins;
    if (mins < 0) mins += 1440;
    const h = Math.floor(mins / 60), m = mins % 60;
    return `${h}h${m > 0 ? ` ${m}m` : ""}`;
  };

  return (
    <div className="space-y-6 rise-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
            <Clock3 className="text-primary" size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-main">Shift Manager</h1>
            <p className="text-text-muted text-sm">Define production shifts for reporting and time-based filtering</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => loadShifts()} disabled={refreshing} className="p-2.5 rounded-xl border border-border bg-bg-card text-text-muted hover:border-primary/50 transition-colors">
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          </button>
          <button onClick={() => { setShowForm((p) => !p); if (editingId) resetForm(); }}
            className="px-4 py-2.5 rounded-xl bg-primary text-on-strong font-semibold text-sm inline-flex items-center gap-2 hover:brightness-110 transition-all">
            {showForm && !editingId ? <X size={15} /> : <Plus size={15} />}
            {showForm && !editingId ? "Cancel" : "Add Shift"}
          </button>
        </div>
      </div>

      {/* Shift KPI Cards */}
      {shifts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {shifts.map((shift, i) => (
            <div key={shift.id} className={`industrial-card p-4 border ${SHIFT_COLORS[i % SHIFT_COLORS.length].split(" ").pop()}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${SHIFT_COLORS[i % SHIFT_COLORS.length]}`}>
                  {shift.shiftCode}
                </span>
                {shift.isActive && <CheckCircle2 size={14} className="text-accent" />}
              </div>
              <p className="font-bold text-text-main mt-2">{shift.shiftName}</p>
              <p className="text-sm text-text-muted font-mono mt-1">
                {formatHHmm(shift.startTime)} {" -> "} {formatHHmm(shift.endTime)}
              </p>
              <p className="text-xs text-text-muted mt-1">
                Duration: <span className="text-text-main font-semibold">{formatDuration(shift.startTime, shift.endTime)}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="industrial-card p-6">
          <h2 className="font-bold text-text-main mb-5 flex items-center gap-2">
            {editingId ? <><Pencil size={16} className="text-primary" /> Edit Shift</> : <><Plus size={16} className="text-primary" /> New Shift</>}
          </h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <Label required>Shift Name</Label>
              <input value={form.shiftName} onChange={set("shiftName")} required className={INPUT_CLS} placeholder="e.g. Morning Shift" />
            </div>
            <div>
              <Label required>Shift Code</Label>
              <input value={form.shiftCode} onChange={(e) => setForm((p) => ({ ...p, shiftCode: e.target.value.toUpperCase() }))} required className={INPUT_CLS} placeholder="SHIFT_A" />
            </div>
            <div>
              <Label required>Start Time</Label>
              <input type="time" value={form.startTime} onChange={set("startTime")} required className={INPUT_CLS} />
            </div>
            <div>
              <Label required>End Time</Label>
              <input type="time" value={form.endTime} onChange={set("endTime")} required className={INPUT_CLS} />
            </div>
            <div>
              <Label>Status</Label>
              <select value={form.isActive ? "1" : "0"} onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.value === "1" }))} className={INPUT_CLS}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-1 flex items-end gap-2">
              <button type="button" onClick={resetForm} className="flex-1 px-4 py-2.5 border border-border rounded-xl text-text-muted hover:bg-bg-dark text-sm transition-colors">Cancel</button>
              <button type="submit" disabled={loading} className="flex-1 px-4 py-2.5 bg-primary text-on-strong font-semibold rounded-xl text-sm inline-flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-50">
                {loading ? <RefreshCw size={14} className="animate-spin" /> : editingId ? <Save size={14} /> : <Plus size={14} />}
                {loading ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="industrial-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-bold text-text-main">All Shifts</h2>
          <span className="text-xs text-text-muted bg-bg-dark px-3 py-1 rounded-lg border border-border">{shifts.length} shift{shifts.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-dark/60 border-b border-border">
              <tr>
                {["Shift Name", "Code", "Start", "End", "Duration", "Status", "Actions"].map((h) => (
                  <th key={h} className={`px-5 py-3 text-xs font-bold uppercase tracking-wide text-text-muted ${h === "Actions" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shifts.map((shift, i) => (
                <tr key={shift.id} className="hover:bg-bg-dark/30 transition-colors">
                  <td className="px-5 py-4 font-medium text-text-main">{shift.shiftName}</td>
                  <td className="px-5 py-4"><span className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${SHIFT_COLORS[i % SHIFT_COLORS.length]}`}>{shift.shiftCode}</span></td>
                  <td className="px-5 py-4 text-sm font-mono text-text-main">{formatHHmm(shift.startTime)}</td>
                  <td className="px-5 py-4 text-sm font-mono text-text-main">{formatHHmm(shift.endTime)}</td>
                  <td className="px-5 py-4 text-sm text-text-muted">{formatDuration(shift.startTime, shift.endTime)}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${shift.isActive ? "bg-accent/10 text-accent border border-accent/20" : "bg-bg-dark text-text-muted border border-border"}`}>
                      {shift.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex gap-2">
                      <button onClick={() => handleEdit(shift)} className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors" title="Edit"><Pencil size={14} /></button>
                      <button onClick={() => setDeleteTarget(shift)} className="p-2 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 transition-colors" title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <Clock3 size={40} className="mx-auto opacity-20 mb-3" />
                    <p className="text-text-muted text-sm">No shifts configured yet</p>
                    <button onClick={() => setShowForm(true)} className="mt-3 text-sm text-primary hover:underline">+ Add your first shift</button>
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
        message={`Are you sure you want to delete shift "${deleteTarget?.shiftName}" (${deleteTarget?.shiftCode})? All historical reports linked to this shift code will retain their data.`}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default Shifts;
