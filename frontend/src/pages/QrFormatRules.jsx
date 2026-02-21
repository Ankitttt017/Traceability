import { useEffect, useState } from "react";
import { Regex, Plus, Save, Trash2, CheckCircle, AlertCircle } from "lucide-react";
import { qrFormatApi } from "../api/services";

const emptyForm = {
  formatName: "",
  regexPattern: "",
  sampleValue: "",
  description: "",
  isActive: false,
};

const QrFormatRules = () => {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  const loadRules = async () => {
    try {
      const data = await qrFormatApi.list();
      setRules(data);
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Failed to load rules" });
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: "", message: "" });
    try {
      if (editingId) {
        await qrFormatApi.update(editingId, form);
        setStatus({ type: "success", message: "Rule updated" });
      } else {
        await qrFormatApi.create(form);
        setStatus({ type: "success", message: "Rule created" });
      }
      resetForm();
      await loadRules();
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Rule save failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (rule) => {
    setEditingId(rule.id);
    setForm({
      formatName: rule.formatName,
      regexPattern: rule.regexPattern,
      sampleValue: rule.sampleValue || "",
      description: rule.description || "",
      isActive: Boolean(rule.isActive),
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this QR format rule?")) {
      return;
    }
    try {
      await qrFormatApi.remove(id);
      setStatus({ type: "success", message: "Rule deleted" });
      await loadRules();
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Delete failed" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
            <Regex className="text-primary" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">QR Format Rules</h1>
            <p className="text-text-muted text-sm">
              Define dynamic industrial QR validation patterns (regex).
            </p>
          </div>
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
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              Rule Name <span className="text-primary">*</span>
            </label>
            <input
              value={form.formatName}
              onChange={(e) => setForm({ ...form, formatName: e.target.value })}
              required
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
              placeholder="Example: Flywheel Format V1"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              Sample Value
            </label>
            <input
              value={form.sampleValue}
              onChange={(e) => setForm({ ...form, sampleValue: e.target.value })}
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
              placeholder="Example sample QR"
            />
          </div>

          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              Regex Pattern <span className="text-primary">*</span>
            </label>
            <input
              value={form.regexPattern}
              onChange={(e) => setForm({ ...form, regexPattern: e.target.value })}
              required
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none font-mono"
              placeholder="Example: ^[A-Z0-9-]{12,40}$"
            />
          </div>

          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              Description
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
              placeholder="Optional note for production team"
            />
          </div>

          <div className="md:col-span-2 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-text-main">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="w-4 h-4"
              />
              Set as active format
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 border border-border rounded-lg hover:bg-bg-dark text-text-muted"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-primary hover:brightness-110 rounded-lg text-bg-dark font-bold flex items-center gap-2 disabled:opacity-60"
              >
                {editingId ? <Save size={16} /> : <Plus size={16} />}
                {editingId ? "Update Rule" : "Create Rule"}
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="industrial-card overflow-hidden">
        <div className="px-6 py-4 bg-bg-dark/50 border-b border-border">
          <h2 className="font-bold text-white">Configured QR Rules</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-dark/40 border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Rule</th>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Regex</th>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Sample</th>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Status</th>
                <th className="px-6 py-3 text-right text-xs font-bold uppercase text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-bg-dark/30">
                  <td className="px-6 py-4">
                    <p className="font-medium text-white">{rule.formatName}</p>
                    <p className="text-xs text-text-muted">{rule.description || "-"}</p>
                  </td>
                  <td className="px-6 py-4 font-mono text-sm text-primary">{rule.regexPattern}</td>
                  <td className="px-6 py-4 text-sm text-text-main">{rule.sampleValue || "-"}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-bold ${
                        rule.isActive
                          ? "bg-accent/10 text-accent border border-accent/20"
                          : "bg-bg-dark text-text-muted border border-border"
                      }`}
                    >
                      {rule.isActive ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        onClick={() => handleEdit(rule)}
                        className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        className="px-3 py-1.5 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 inline-flex items-center gap-1"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-6 py-10 text-center text-text-muted">
                    No QR format rules configured
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

export default QrFormatRules;
