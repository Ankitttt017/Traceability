// QrFormatRules.jsx — QR / Barcode Validation Engine
// Redesigned: modal for adding rules, live regex tester, rules table

import { useEffect, useState } from "react";
import {
  Regex, Plus, Save, Trash2, CheckCircle, AlertCircle,
  Scan, Terminal, ShieldCheck, HelpCircle, Edit2, RefreshCw, Info, X, Layers
} from "lucide-react";
import toast from "react-hot-toast";
import { qrFormatApi } from "../api/services";

/* ─── constants ────────────────────────────────────────────── */
const emptyForm = {
  formatName: "", modelCode: "", regexPattern: "",
  stationScope: "", sampleValue: "", description: "", isActive: true,
};

const PATTERN_EXAMPLES = [
  { label: "Alphanumeric ID", pattern: "^[A-Z0-9]{8,20}$", desc: "8–20 uppercase chars/digits" },
  { label: "3-letter + 6-digit", pattern: "^[A-Z]{3}\\d{6}$", desc: "e.g. ENG123456" },
  { label: "Any length bypass", pattern: ".*", desc: "Accept all scan values" },
  { label: "Fixed length 12", pattern: "^.{12}$", desc: "Exactly 12 characters" },
];

/* ─── component ────────────────────────────────────────────── */
const QrFormatRules = () => {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingRules, setLoadingRules] = useState(true);
  const [testResult, setTestResult] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const loadRules = async () => {
    setLoadingRules(true);
    try {
      const data = await qrFormatApi.list();
      setRules(data || []);
    } catch { toast.error("Failed to load validation rules"); }
    finally { setLoadingRules(false); }
  };

  useEffect(() => { loadRules(); }, []);

  const resetForm = () => { setForm(emptyForm); setEditingId(null); setTestResult(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingId) {
        await qrFormatApi.update(editingId, form);
        toast.success("Validation rule updated");
      } else {
        await qrFormatApi.create(form);
        toast.success("Validation rule created");
      }
      resetForm();
      setShowModal(false);
      await loadRules();
    } catch (err) { toast.error(err.response?.data?.error || "Failed to save rule"); }
    finally { setLoading(false); }
  };

  const handleEdit = (rule) => {
    setEditingId(rule.id);
    setForm({
      formatName: rule.formatName || "",
      modelCode: rule.modelCode || "",
      regexPattern: rule.regexPattern || "",
      stationScope: rule.stationScope || "",
      sampleValue: rule.sampleValue || "",
      description: rule.description || "",
      isActive: Boolean(rule.isActive),
    });
    setTestResult(null);
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this validation rule? This will affect live scanning logic.")) return;
    try {
      await qrFormatApi.remove(id);
      toast.success("Rule deleted");
      await loadRules();
    } catch { toast.error("Failed to delete rule"); }
  };

  const testRegex = () => {
    if (!form.regexPattern || !form.sampleValue) {
      setTestResult({ status: "warn", message: "Enter both a pattern and a sample value to test" });
      return;
    }
    try {
      const re = new RegExp(form.regexPattern);
      const isOk = re.test(form.sampleValue);
      setTestResult({
        status: isOk ? "pass" : "fail",
        message: isOk ? "Match — pattern accepted this value" : "No match — pattern rejected this value",
      });
    } catch {
      setTestResult({ status: "error", message: "Invalid regex syntax — check your pattern" });
    }
  };

  const applyExample = (pattern) => {
    setForm(prev => ({ ...prev, regexPattern: pattern }));
    setTestResult(null);
  };

  const inputCls = "w-full bg-bg-dark border border-border rounded-lg px-3 py-2 text-sm text-text-main outline-none focus:border-primary/60 transition-colors placeholder:text-text-muted/40";
  const selectCls = "w-full bg-bg-dark border border-border rounded-lg px-3 py-2 text-sm text-text-main outline-none focus:border-primary/60 transition-colors";

  const testResultStyle = {
    pass: "bg-accent/10 border-accent/20 text-accent",
    fail: "bg-danger/10 border-danger/20 text-danger",
    warn: "bg-warning/10 border-warning/20 text-warning",
    error: "bg-danger/10 border-danger/20 text-danger",
  };

  return (
    <div className="space-y-6 rise-in">
      {/* ── Header ── */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <Regex size={22} />
            </div>
            <div>
              <h1 className="db-header-title">QR Validation Engine</h1>
              <p className="db-header-subtitle">Define barcode formats &amp; regex patterns for each station</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadRules} disabled={loadingRules} className="db-secondary-btn">
              <RefreshCw size={13} className={loadingRules ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={() => { resetForm(); setShowModal(true); }} className="db-action-btn">
              <Plus size={14} /> Add Rule
            </button>
          </div>
        </div>
      </div>

      {/* ── Rules Table ── */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-bg-dark/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scan size={14} className="text-primary" />
            <h2 className="text-xs font-bold text-text-main uppercase tracking-wider">Active validation rules</h2>
          </div>
          <span className="text-[11px] text-text-muted bg-bg-dark px-3 py-1 rounded-lg border border-border">
            {loadingRules ? "Loading…" : `${rules.length} rule${rules.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {loadingRules ? (
          <div className="flex items-center justify-center py-20 text-text-muted">
            <RefreshCw size={20} className="animate-spin mr-3" /> Loading rules…
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-text-muted">
            <Regex size={40} className="opacity-15 mb-3" />
            <p className="font-semibold text-sm">No validation rules defined</p>
            <p className="text-xs mt-1 text-text-muted/60">Click “Add Rule” to create your first rule</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-dark/50 text-[10px] font-semibold uppercase tracking-widest text-text-muted border-b border-border">
                <tr>
                  <th className="px-5 py-3 text-left">Rule</th>
                  <th className="px-5 py-3 text-left">Pattern</th>
                  <th className="px-5 py-3 text-left">Scope</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rules.map(rule => (
                  <tr key={rule.id} className="group hover:bg-bg-dark/20 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${rule.isActive ? "bg-accent" : "bg-text-muted/30"}`} />
                        <div>
                          <p className="font-semibold text-text-main text-sm">{rule.formatName}</p>
                          <p className="text-[10px] text-text-muted font-mono mt-0.5">{rule.modelCode || "GLOBAL"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="px-2.5 py-1 bg-bg-dark border border-border rounded font-mono text-xs text-primary max-w-[180px] truncate" title={rule.regexPattern}>
                        {rule.regexPattern}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {rule.stationScope ? (
                        <span className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-xs font-mono text-primary">
                          {rule.stationScope}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-accent/10 border border-accent/20 rounded text-xs font-semibold text-accent">
                          All stations
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleEdit(rule)}
                          className="p-2 text-text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-all">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => handleDelete(rule.id)}
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

      {/* ── Modal for creating/editing a rule ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-bg-dark/90 backdrop-blur-sm" onClick={() => { setShowModal(false); resetForm(); }} />
          <div className="relative w-full max-w-2xl bg-bg-card border border-border/60 rounded-2xl overflow-hidden flex flex-col max-h-[90vh] rise-in shadow-2xl">
            {/* Modal header */}
            <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-bg-dark/30">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  {editingId ? <Edit2 size={18} /> : <Plus size={18} />}
                </div>
                <div>
                  <h2 className="font-bold text-text-main">{editingId ? "Edit validation rule" : "Add validation rule"}</h2>
                  <p className="text-xs text-text-muted mt-0.5">{editingId ? "Modify format or pattern" : "Define a new barcode format"}</p>
                </div>
              </div>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="p-2 text-text-muted hover:text-text-main hover:bg-bg-dark rounded-xl transition-all">
                <X size={18} />
              </button>
            </div>

            {/* Form body */}
            <form id="qr-rule-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Rule name *</label>
                  <input required value={form.formatName} onChange={e => setForm({ ...form, formatName: e.target.value })}
                    placeholder="e.g. Engine head QR" className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Model code</label>
                  <input value={form.modelCode} onChange={e => setForm({ ...form, modelCode: e.target.value.toUpperCase() })}
                    placeholder="MDL-001" className={`${inputCls} font-mono`} />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">
                  Station scope
                  <span className="text-text-muted/50 normal-case tracking-normal font-normal ml-2">— leave blank to apply everywhere</span>
                </label>
                <input value={form.stationScope} onChange={e => setForm({ ...form, stationScope: e.target.value.toUpperCase() })}
                  placeholder="e.g. OP010,OP020 or leave blank for all" className={`${inputCls} font-mono`} />
              </div>

              {/* Regex pattern — visually distinct */}
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-primary uppercase tracking-widest flex items-center gap-1.5">
                    <Terminal size={12} /> Regex pattern *
                  </label>
                  <details className="relative">
                    <summary className="text-[10px] text-text-muted hover:text-primary flex items-center gap-1 transition-colors font-semibold cursor-pointer">
                      <HelpCircle size={11} /> Examples
                    </summary>
                    <div className="absolute right-0 top-6 z-10 w-72 bg-bg-card border border-border rounded-lg shadow-xl p-2 space-y-1">
                      {PATTERN_EXAMPLES.map(ex => (
                        <button key={ex.pattern} type="button" onClick={() => applyExample(ex.pattern)}
                          className="w-full flex items-center justify-between px-3 py-2 bg-bg-dark/60 border border-border rounded-lg hover:border-primary/40 hover:bg-primary/5 transition-all text-left group">
                          <div>
                            <span className="text-[11px] font-semibold text-text-main group-hover:text-primary transition-colors">{ex.label}</span>
                            <span className="text-[10px] text-text-muted ml-2">{ex.desc}</span>
                          </div>
                          <code className="text-[10px] font-mono text-primary/70 bg-bg-dark px-2 py-0.5 rounded ml-2 flex-shrink-0">{ex.pattern}</code>
                        </button>
                      ))}
                    </div>
                  </details>
                </div>
                <input required value={form.regexPattern}
                  onChange={e => { setForm({ ...form, regexPattern: e.target.value }); setTestResult(null); }}
                  placeholder="^[A-Z]{3}\d{6}$"
                  className="w-full bg-transparent border-0 border-b border-primary/40 pb-2 text-primary text-base font-mono font-bold outline-none focus:border-primary placeholder:text-primary/30 placeholder:font-normal" />
                <p className="text-[10px] text-text-muted/60 italic">PCRE syntax. Use <span className="font-mono">.*</span> to bypass validation.</p>
              </div>

              {/* Test tool */}
              <div className="space-y-2">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                  <Scan size={11} /> Test your pattern
                </label>
                <div className="flex gap-2">
                  <input value={form.sampleValue}
                    onChange={e => { setForm({ ...form, sampleValue: e.target.value }); setTestResult(null); }}
                    placeholder="Paste a sample scan string here…"
                    className={`${inputCls} flex-1`} />
                  <button type="button" onClick={testRegex}
                    className="h-9 px-4 bg-bg-dark border border-border rounded-lg text-xs font-bold text-text-muted hover:text-primary hover:border-primary/40 transition-all whitespace-nowrap">
                    Run test
                  </button>
                </div>
                {testResult && (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-semibold ${testResultStyle[testResult.status]}`}>
                    {testResult.status === "pass" ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                    {testResult.message}
                  </div>
                )}
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between py-3 px-4 bg-bg-dark/50 rounded-xl border border-border">
                <div>
                  <p className="text-xs font-semibold text-text-main">Active rule</p>
                  <p className="text-[10px] text-text-muted mt-0.5">Apply this rule to live scanning</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="sr-only peer" />
                  <div className="w-9 h-5 bg-border rounded-full peer peer-checked:bg-accent transition-colors"></div>
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                </label>
              </div>
            </form>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-border flex items-center justify-between bg-bg-dark/20">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Info size={12} />
                <span>Rules are evaluated in order; first match wins</span>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => { setShowModal(false); resetForm(); }} className="px-4 py-2 text-sm text-text-muted hover:text-text-main transition-colors font-semibold">Cancel</button>
                <button type="submit" form="qr-rule-form" disabled={loading}
                  className="px-6 py-2 bg-primary text-on-strong font-bold rounded-xl text-sm hover:brightness-110 transition-all flex items-center gap-2 disabled:opacity-50">
                  <Save size={14} /> {loading ? "Saving…" : editingId ? "Save changes" : "Add rule"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QrFormatRules;