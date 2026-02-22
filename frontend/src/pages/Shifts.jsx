import { useEffect, useState } from "react";
import { Clock3, Plus, Save, Trash2, CheckCircle, AlertCircle } from "lucide-react";
import { shiftApi } from "../api/services";

const emptyForm = {
  shiftName: "",
  shiftCode: "",
  startTime: "",
  endTime: "",
  isActive: true,
};

const Shifts = () => {
  const [shifts, setShifts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  const loadShifts = async () => {
    try {
      const data = await shiftApi.list();
      setShifts(data);
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Failed to load shifts" });
    }
  };

  useEffect(() => {
    loadShifts();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setStatus({ type: "", message: "" });
    try {
      if (editingId) {
        await shiftApi.update(editingId, form);
        setStatus({ type: "success", message: "Shift updated" });
      } else {
        await shiftApi.create(form);
        setStatus({ type: "success", message: "Shift created" });
      }
      resetForm();
      await loadShifts();
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Shift save failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (shift) => {
    setEditingId(shift.id);
    setForm({
      shiftName: shift.shiftName,
      shiftCode: shift.shiftCode,
      startTime: String(shift.startTime || "").slice(0, 5),
      endTime: String(shift.endTime || "").slice(0, 5),
      isActive: Boolean(shift.isActive),
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this shift?")) {
      return;
    }
    try {
      await shiftApi.remove(id);
      setStatus({ type: "success", message: "Shift deleted" });
      await loadShifts();
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Delete failed" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
          <Clock3 className="text-primary" size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-main">Shift Management</h1>
          <p className="text-text-muted text-sm">Define dynamic shift timing for reporting and production filters.</p>
        </div>
      </div>

      {status.message && (
        <div
          className={`p-4 rounded-lg border flex items-center gap-2 ${
            status.type === "success"
              ? "bg-accent/10 border-accent/30 text-accent"
              : "bg-danger/10 border-danger/30 text-danger"
          }`}
        >
          {status.type === "success" ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{status.message}</span>
        </div>
      )}

      <div className="industrial-card p-6">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="space-y-1 lg:col-span-2">
            <label className="text-xs font-bold uppercase text-text-muted">
              Shift Name <span className="text-primary">*</span>
            </label>
            <input
              value={form.shiftName}
              onChange={(e) => setForm({ ...form, shiftName: e.target.value })}
              required
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              Shift Code <span className="text-primary">*</span>
            </label>
            <input
              value={form.shiftCode}
              onChange={(e) => setForm({ ...form, shiftCode: e.target.value.toUpperCase() })}
              required
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
              placeholder="SHIFT_A"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              Start Time <span className="text-primary">*</span>
            </label>
            <input
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              required
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              End Time <span className="text-primary">*</span>
            </label>
            <input
              type="time"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              required
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">Status</label>
            <select
              value={form.isActive ? "ACTIVE" : "INACTIVE"}
              onChange={(e) => setForm({ ...form, isActive: e.target.value === "ACTIVE" })}
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>

          <div className="lg:col-span-6 flex gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 border border-border rounded-lg text-text-muted hover:bg-bg-dark"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-primary hover:brightness-110 rounded-lg text-bg-dark font-bold flex items-center gap-2 disabled:opacity-60"
            >
              {editingId ? <Save size={16} /> : <Plus size={16} />}
              {editingId ? "Update Shift" : "Create Shift"}
            </button>
          </div>
        </form>
      </div>

      <div className="industrial-card overflow-hidden">
        <div className="px-6 py-4 bg-bg-dark/50 border-b border-border">
          <h2 className="font-bold text-text-main">Configured Shifts</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-dark/40 border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Shift</th>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Time Window</th>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Status</th>
                <th className="px-6 py-3 text-right text-xs font-bold uppercase text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shifts.map((shift) => (
                <tr key={shift.id} className="hover:bg-bg-dark/30">
                  <td className="px-6 py-4">
                    <p className="font-medium text-text-main">{shift.shiftName}</p>
                    <p className="text-xs font-mono text-primary">{shift.shiftCode}</p>
                  </td>
                  <td className="px-6 py-4 text-text-main font-mono">
                    {String(shift.startTime || "").slice(0, 5)} - {String(shift.endTime || "").slice(0, 5)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-bold ${
                        shift.isActive
                          ? "bg-accent/10 text-accent border border-accent/20"
                          : "bg-bg-dark text-text-muted border border-border"
                      }`}
                    >
                      {shift.isActive ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        onClick={() => handleEdit(shift)}
                        className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(shift.id)}
                        className="px-3 py-1.5 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 inline-flex items-center gap-1"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan="4" className="px-6 py-10 text-center text-text-muted">
                    No shifts configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Shifts;
