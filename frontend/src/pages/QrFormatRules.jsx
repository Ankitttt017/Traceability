// QrFormatRules.jsx — QR Validation Engine (Fully Responsive)
// Modes: SEGMENT (field-by-field builder) + REGEX (pattern with named groups)

import { useEffect, useState } from "react";
import {
  Plus, Save, Trash2, CheckCircle, AlertCircle, Scan, Edit2,
  RefreshCw, Info, X, Copy, Check, ChevronDown, ChevronRight,
  Eye, Code2, Sliders, Zap, Shield, Database, ScanLine,
  FlaskConical, Hash, Calendar, Package, Layers, GripVertical,
  HelpCircle, Clock, CalendarDays, MoveHorizontal, UserRound,
} from "lucide-react";
import toast from "react-hot-toast";
import { qrFormatApi } from "../api/services";
import ConfirmModal from "../components/ConfirmModal";

/* ─── segment field catalog ─────────────────────────────── */
const FIELD_TYPES = [
  { value: "year", label: "Year (YY)", icon: <Calendar size={12} />, description: "2-digit year (00-99)" },
  { value: "month", label: "Month (MM)", icon: <Calendar size={12} />, description: "2-digit month (01-12)" },
  { value: "day", label: "Day (DD)", icon: <Calendar size={12} />, description: "2-digit day (01-31)" },
  { value: "hour", label: "Hour (HH)", icon: <Clock size={12} />, description: "2-digit hour (00-23)" },
  { value: "minute", label: "Minute (MM)", icon: <Clock size={12} />, description: "2-digit minute (00-59)" },
  { value: "second", label: "Second (SS)", icon: <Clock size={12} />, description: "2-digit second (00-59)" },
  { value: "numeric", label: "Numeric", icon: <Hash size={12} />, description: "Digits only (0-9)" },
  { value: "alpha", label: "Alpha (A-Z)", icon: <Hash size={12} />, description: "Uppercase letters only" },
  { value: "alphanumeric", label: "Alphanumeric", icon: <Hash size={12} />, description: "Letters and digits" },
  { value: "shot", label: "Shot Number", icon: <Hash size={12} />, description: "Shot/casting sequence number" },
  { value: "die", label: "Die / Cavity", icon: <Hash size={12} />, description: "Die or cavity identifier" },
  { value: "line", label: "Production Line", icon: <MoveHorizontal size={12} />, description: "Production line code" },
  { value: "model", label: "Model Code", icon: <Package size={12} />, description: "Part/model identifier" },
  { value: "machine", label: "Machine Code", icon: <Package size={12} />, description: "Machine/equipment ID" },
  { value: "shift", label: "Shift", icon: <UserRound size={12} />, description: "Shift code (A/B/C/S)" },
  { value: "serial", label: "Serial Number", icon: <Hash size={12} />, description: "Unique serial number" },
  { value: "part_no", label: "Part Number", icon: <Package size={12} />, description: "Part number identifier" },
  { value: "custom", label: "Custom Pattern", icon: <Code2 size={12} />, description: "Custom regex pattern" },
];

/* ─── quick-add presets ─────────────────────────────────── */
const QUICK_FIELDS = [
  { field: "year", displayName: "YY", type: "year", mode: "FIXED", length: 2, required: true },
  { field: "month", displayName: "MM", type: "month", mode: "FIXED", length: 2, required: true },
  { field: "day", displayName: "DD", type: "day", mode: "FIXED", length: 2, required: true },
  { field: "hour", displayName: "HH", type: "hour", mode: "FIXED", length: 2, required: true },
  { field: "minute", displayName: "MIN", type: "minute", mode: "FIXED", length: 2, required: true },
  { field: "second", displayName: "SEC", type: "second", mode: "FIXED", length: 2, required: true },
  { field: "shot", displayName: "SHT", type: "shot", mode: "RANGE", minLength: 4, maxLength: 6, required: true },
  { field: "die", displayName: "DIE", type: "die", mode: "FIXED", length: 2, required: true },
  { field: "line", displayName: "LN", type: "line", mode: "FIXED", length: 2, required: true },
  { field: "shift", displayName: "SFT", type: "shift", mode: "FIXED", length: 1, required: true },
  { field: "model", displayName: "MDL", type: "alphanumeric", mode: "FIXED", length: 4, required: true },
  { field: "serial", displayName: "SER", type: "serial", mode: "RANGE", minLength: 4, maxLength: 10, required: true },
];

/* ─── default segment structure ─────────────────────────── */
const defaultSegment = {
  field: "",
  displayName: "",
  type: "numeric",
  mode: "FIXED",
  length: 2,
  minLength: 1,
  maxLength: 10,
  required: true,
  enabled: true,
  customPattern: "",
  example: "",
  description: "",
};

/* ─── helpers ───────────────────────────────────────────── */
const buildRegex = (segments, sep = "") => {
  if (!segments.length) return "";

  const separator = sep ? sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";

  const parts = [];

  for (const seg of segments) {
    if (!seg.enabled) continue;

    const fieldName = seg.field || "field";

    let pattern = "";

    switch (seg.type) {
      case "year":
      case "month":
      case "day":
      case "hour":
      case "minute":
      case "second":
      case "numeric":
      case "shot":
      case "serial":
        pattern = "\\d";
        break;
      case "alpha":
        pattern = "[A-Z]";
        break;
      case "shift":
        pattern = "[ABCS]";
        break;
      case "alphanumeric":
      case "model":
      case "machine":
      case "part_no":
        pattern = "[A-Z0-9]";
        break;
      case "custom":
        pattern = seg.customPattern || ".";
        break;
      default:
        pattern = ".";
    }

    let finalPattern = "";
    if (seg.mode === "FIXED") {
      finalPattern = `${pattern}{${seg.length || 2}}`;
    } else if (seg.mode === "RANGE") {
      finalPattern = `${pattern}{${seg.minLength || 1},${seg.maxLength || 10}}`;
    } else if (seg.mode === "UNTIL_SEPARATOR") {
      finalPattern = `[^${separator || "-"}]+`;
    } else {
      finalPattern = `${pattern}+`;
    }

    let group = `(?<${fieldName}>${finalPattern})`;
    if (!seg.required) {
      group = `${group}?`;
    }

    parts.push(group);
  }

  return "^" + parts.join(separator) + "$";
};

const parseGroups = (value, pattern) => {
  try {
    const m = new RegExp(pattern).exec(value);
    return m?.groups ? { ...m.groups } : null;
  } catch { return null; }
};

/* ─── empty form state ──────────────────────────────────── */
const empty = {
  formatName: "", modelCode: "", ruleType: "SEGMENT",
  regexPattern: "", segments: [], separator: "",
  stationScope: "", sampleValue: "", description: "", isActive: true,
};

/* ─── main component ────────────────────────────────────── */
export default function QrFormatRules() {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadingRules, setLoading] = useState(true);
  const [testResult, setTestResult] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [copied, setCopied] = useState(null);
  const [filterStatus, setFilter] = useState("all");
  const [previewId, setPreviewId] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [tooltipField, setTooltipField] = useState(null);

  const liveRegex = form.ruleType === "SEGMENT"
    ? buildRegex(form.segments, form.separator)
    : form.regexPattern;

  const load = async () => {
    setLoading(true);
    try { setRules((await qrFormatApi.list()) || []); }
    catch { toast.error("Failed to load rules"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm(empty); setEditingId(null);
    setTestResult(null); setShowModal(false);
  };

  const openEdit = (rule) => {
    const segs = rule.segmentsJson
      ? (() => { try { return JSON.parse(rule.segmentsJson); } catch { return []; } })()
      : [];
    setEditingId(rule.id);
    setForm({
      formatName: rule.formatName || "",
      modelCode: rule.modelCode || "",
      ruleType: rule.ruleType || "REGEX",
      regexPattern: rule.regexPattern || "",
      segments: segs.length ? segs : [],
      separator: rule.separator || "",
      stationScope: rule.stationScope || "",
      sampleValue: rule.sampleValue || "",
      description: rule.description || "",
      isActive: Boolean(rule.isActive),
    });
    setTestResult(null);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      regexPattern: liveRegex,
      segmentsJson: form.ruleType === "SEGMENT" ? JSON.stringify(form.segments) : null,
    };
    try {
      if (editingId) { await qrFormatApi.update(editingId, payload); toast.success("Rule updated"); }
      else { await qrFormatApi.create(payload); toast.success("Rule created"); }
      resetForm(); await load();
    } catch (err) { toast.error(err.response?.data?.error || "Save failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    try { await qrFormatApi.remove(id); toast.success("Rule deleted"); await load(); }
    catch { toast.error("Delete failed"); }
  };

  const addSeg = (preset) => {
    const newSeg = preset ? { ...defaultSegment, ...preset } : { ...defaultSegment };
    setForm(p => ({ ...p, segments: [...p.segments, newSeg] }));
  };

  const updateSeg = (i, key, value) => {
    setForm(p => {
      const s = [...p.segments];
      s[i] = { ...s[i], [key]: value };
      if (key === "mode") {
        if (value === "FIXED") {
          s[i].length = s[i].length || 2;
        } else if (value === "RANGE") {
          s[i].minLength = s[i].minLength || 1;
          s[i].maxLength = s[i].maxLength || 10;
        }
      }
      return { ...p, segments: s };
    });
  };

  const removeSeg = (i) =>
    setForm(p => ({ ...p, segments: p.segments.filter((_, idx) => idx !== i) }));

  const toggleSegment = (i) =>
    setForm(p => {
      const s = [...p.segments];
      s[i] = { ...s[i], enabled: !s[i].enabled };
      return { ...p, segments: s };
    });

  const moveSegment = (from, to) => {
    if (to < 0 || to >= form.segments.length) return;
    const newSegments = [...form.segments];
    const [moved] = newSegments.splice(from, 1);
    newSegments.splice(to, 0, moved);
    setForm(p => ({ ...p, segments: newSegments }));
  };

  const runTest = () => {
    if (!form.sampleValue) { setTestResult({ ok: false, msg: "Enter a sample scan value to test" }); return; }
    if (!liveRegex) { setTestResult({ ok: false, msg: form.ruleType === "SEGMENT" ? "Add at least one segment first" : "Enter a regex pattern first" }); return; }
    try {
      const regex = new RegExp(liveRegex);
      const ok = regex.test(form.sampleValue);
      const fields = ok ? parseGroups(form.sampleValue, liveRegex) : null;
      setTestResult({ ok, fields, msg: ok ? "✓ Match — QR value accepted" : "✗ No match — QR value rejected" });
    } catch {
      setTestResult({ ok: false, msg: "Invalid regex syntax — check your pattern" });
    }
  };

  const copy = (txt) => {
    navigator.clipboard.writeText(txt);
    setCopied(txt); setTimeout(() => setCopied(null), 2000);
    toast.success("Copied");
  };

  const visibleRules = rules.filter(r =>
    filterStatus === "active" ? r.isActive :
      filterStatus === "inactive" ? !r.isActive : true
  );

  // Responsive input classes
  const inp = "w-full bg-bg-dark border border-border rounded-lg px-3 py-2 text-sm text-text-main outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-all placeholder:text-text-muted/40";
  const seg_inp = "bg-bg-dark border border-border rounded-md px-2 py-1.5 text-xs text-text-main outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-all font-mono w-full";

  return (
    <div className="space-y-4 md:space-y-5 px-3 sm:px-4 md:px-0 pb-8" style={{ fontFamily: "var(--font-outfit)" }}>

      {/* Page header - Responsive */}
      <div className="db-header-card">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 sm:p-5">
          <div className="db-header-title-group flex items-center gap-3">
            <div className="db-header-icon-box flex-shrink-0 p-2 bg-primary/10 rounded-xl">
              <ScanLine size={18} className="sm:size-[22] text-primary" />
            </div>
            <div>
              <h1 className="db-header-title text-lg sm:text-xl md:text-2xl font-bold text-text-main">QR Validation Engine</h1>
              <p className="db-header-subtitle text-xs sm:text-sm text-text-muted">Segment or regex rules — per station or global</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loadingRules} className="flex items-center gap-1 px-3 sm:px-4 py-1.5 sm:py-2 bg-bg-dark border border-border rounded-lg text-xs sm:text-sm text-text-muted hover:text-text-main transition-all">
              <RefreshCw size={12} className={loadingRules ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button onClick={() => { setForm({ ...empty, segments: [] }); setShowModal(true); }} className="flex items-center gap-1 px-3 sm:px-4 py-1.5 sm:py-2 bg-primary text-white rounded-lg text-xs sm:text-sm font-semibold hover:brightness-110 transition-all">
              <Plus size={14} /> <span className="hidden sm:inline">Add rule</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stat row - Responsive grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[
          { n: rules.length, lbl: "Total rules", icon: <Database size={14} />, col: "text-text-muted" },
          { n: rules.filter(r => r.isActive).length, lbl: "Active", icon: <Shield size={14} />, col: "text-accent" },
          { n: rules.filter(r => r.ruleType === "SEGMENT").length, lbl: "Segment", icon: <Sliders size={14} />, col: "text-blue-400" },
          { n: rules.filter(r => r.ruleType !== "SEGMENT").length, lbl: "Regex", icon: <Code2 size={14} />, col: "text-purple-400" },
        ].map(s => (
          <div key={s.lbl} className="bg-bg-card border border-border rounded-xl p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
            <span className={s.col}>{s.icon}</span>
            <div>
              <p className="text-lg sm:text-xl font-bold text-text-main leading-none">{s.n}</p>
              <p className="text-[8px] sm:text-[10px] text-text-muted mt-0.5">{s.lbl}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Rules table - Horizontal scroll on mobile */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-3 sm:px-5 py-3 border-b border-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scan size={14} className="text-primary" />
            <span className="text-xs font-bold text-text-main uppercase tracking-wider">Validation rules</span>
          </div>
          <div className="flex items-center gap-1">
            {["all", "active", "inactive"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-2 sm:px-3 py-1 rounded-lg text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider transition-all
                  ${filterStatus === f ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {loadingRules ? (
          <div className="flex items-center justify-center py-16 text-text-muted text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        ) : visibleRules.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-text-muted">
            <ScanLine size={36} className="opacity-15 mb-3" />
            <p className="text-sm font-semibold">No rules found</p>
            <p className="text-xs mt-1 opacity-50">Click "Add rule" to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead className="bg-bg-dark/50 text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-text-muted border-b border-border">
                <tr>
                  <th className="px-3 sm:px-5 py-3 text-left">Rule</th>
                  <th className="px-3 sm:px-5 py-3 text-left">Mode</th>
                  <th className="px-3 sm:px-5 py-3 text-left">Pattern</th>
                  <th className="px-3 sm:px-5 py-3 text-left">Scope</th>
                  <th className="px-3 sm:px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {visibleRules.map(rule => {
                  const segs = rule.ruleType === "SEGMENT" && rule.segmentsJson
                    ? (() => { try { return JSON.parse(rule.segmentsJson); } catch { return []; } })()
                    : [];
                  return (
                    <tr key={rule.id} className="hover:bg-bg-dark/20 transition-colors">
                      <td className="px-3 sm:px-5 py-3 sm:py-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full flex-shrink-0 ${rule.isActive ? "bg-accent" : "bg-text-muted/30"}`} />
                          <div>
                            <p className={`font-semibold text-xs sm:text-sm ${rule.isActive ? "text-text-main" : "text-text-muted"}`}>
                              {rule.formatName}
                            </p>
                            <p className="text-[8px] sm:text-[10px] text-text-muted font-mono mt-0.5">{rule.modelCode || "GLOBAL"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 sm:px-5 py-3 sm:py-4">
                        {rule.ruleType === "SEGMENT" ? (
                          <span className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg text-[8px] sm:text-[10px] font-bold text-blue-400 w-fit">
                            <Sliders size={8} className="sm:size-[10]" /> Seg
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-purple-500/10 border border-purple-500/20 rounded-lg text-[8px] sm:text-[10px] font-bold text-purple-400 w-fit">
                            <Code2 size={8} className="sm:size-[10]" /> Regex
                          </span>
                        )}
                      </td>
                      <td className="px-3 sm:px-5 py-3 sm:py-4">
                        {rule.ruleType === "SEGMENT" && segs.length ? (
                          <div className="flex flex-wrap gap-1">
                            {segs.filter(s => s.enabled !== false).slice(0, 2).map((s, i) => (
                              <span key={i} className="px-1 py-0.5 bg-bg-dark border border-border rounded text-[7px] sm:text-[9px] font-mono text-text-muted">
                                {s.displayName || s.field || `seg${i + 1}`}
                              </span>
                            ))}
                            {segs.length > 2 && <span className="text-[7px] sm:text-[9px] text-text-muted">+{segs.length - 2}</span>}
                          </div>
                        ) : (
                          <code className="text-[9px] sm:text-[11px] text-text-muted truncate block max-w-[120px] sm:max-w-[200px]">
                            {rule.regexPattern?.slice(0, 25)}{rule.regexPattern?.length > 25 ? "..." : ""}
                          </code>
                        )}
                      </td>
                      <td className="px-3 sm:px-5 py-3 sm:py-4">
                        {rule.stationScope
                          ? <span className="px-1.5 sm:px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-[9px] sm:text-xs font-mono text-primary">{rule.stationScope}</span>
                          : <span className="px-1.5 sm:px-2 py-0.5 bg-accent/10 border border-accent/20 rounded text-[9px] sm:text-xs font-semibold text-accent">All</span>
                        }
                      </td>
                      <td className="px-3 sm:px-5 py-3 sm:py-4 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <button onClick={() => setPreviewId(previewId === rule.id ? null : rule.id)}
                            className="p-1 sm:p-2 rounded-lg text-text-muted hover:text-accent hover:bg-accent/10 transition-all">
                            <Eye size={12} className="sm:size-[13]" />
                          </button>
                          <button onClick={() => openEdit(rule)}
                            className="p-1 sm:p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-all">
                            <Edit2 size={12} className="sm:size-[13]" />
                          </button>
                          <button onClick={() => setDeleteId(rule.id)}
                            className="p-1 sm:p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-all">
                            <Trash2 size={12} className="sm:size-[13]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inline preview panel - Responsive */}
      {previewId && (() => {
        const rule = rules.find(r => r.id === previewId);
        if (!rule) return null;
        const segs = rule.segmentsJson ? (() => { try { return JSON.parse(rule.segmentsJson); } catch { return []; } })() : [];
        return (
          <div className="bg-bg-card border border-border rounded-2xl p-3 sm:p-5">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <span className="flex items-center gap-2 text-xs font-bold text-text-main uppercase tracking-wider">
                <Eye size={13} className="text-accent" /> Preview — {rule.formatName}
              </span>
              <button onClick={() => setPreviewId(null)} className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-dark transition-all">
                <X size={13} />
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Regex pattern</p>
                  <code className="block px-3 py-2.5 bg-bg-dark border border-border rounded-lg text-[10px] sm:text-[11px] font-mono text-text-main break-all">
                    {rule.regexPattern || "—"}
                  </code>
                </div>
                {rule.sampleValue && (
                  <div>
                    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Sample value</p>
                    <code className="block px-3 py-2 bg-bg-dark border border-border rounded-lg text-xs font-mono text-accent break-all">{rule.sampleValue}</code>
                  </div>
                )}
                {rule.description && (
                  <p className="text-xs text-text-muted">{rule.description}</p>
                )}
              </div>
              {segs.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Segment map</p>
                  <div className="space-y-1.5">
                    {segs.map((s, i) => (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 bg-bg-dark border border-border rounded-lg">
                        <div>
                          <span className="text-xs font-mono text-primary">{s.displayName || s.field || `seg${i + 1}`}</span>
                          {!s.enabled && <span className="ml-2 text-[9px] text-text-muted">(disabled)</span>}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-text-muted">{FIELD_TYPES.find(t => t.value === s.type)?.label || s.type}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-bg-card border border-border rounded text-text-muted">
                            {s.mode === "FIXED" ? `${s.length} char` :
                              s.mode === "RANGE" ? `${s.minLength}–${s.maxLength}` :
                                "variable"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* MODAL - Fully Responsive */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-2 sm:p-4 pt-8 sm:pt-10">
          <div className="absolute inset-0 bg-bg-dark/85 backdrop-blur-sm" onClick={resetForm} />

          <div className="relative w-full max-w-full sm:max-w-4xl lg:max-w-5xl xl:max-w-6xl bg-bg-card border border-border/70 rounded-2xl shadow-2xl flex flex-col max-h-[95vh] sm:max-h-[90vh] m-2 sm:m-0">

            {/* Modal header */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-border flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="font-bold text-text-main text-base sm:text-lg">{editingId ? "Edit rule" : "New validation rule"}</h2>
                <p className="text-[10px] sm:text-xs text-text-muted mt-0.5">Define how this barcode is validated and parsed</p>
              </div>
              <button onClick={resetForm} className="p-1.5 sm:p-2 rounded-xl text-text-muted hover:text-text-main hover:bg-bg-dark transition-all">
                <X size={16} className="sm:size-[17]" />
              </button>
            </div>

            {/* Scrollable body */}
            <form id="qr-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-5">

              {/* Basic info - Responsive grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Rule name *</label>
                  <input required value={form.formatName}
                    onChange={e => setForm(p => ({ ...p, formatName: e.target.value }))}
                    placeholder="Engine head QR" className={inp} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Model code</label>
                  <input value={form.modelCode}
                    onChange={e => setForm(p => ({ ...p, modelCode: e.target.value.toUpperCase() }))}
                    placeholder="e.g. ENG-001" className={`${inp} font-mono`} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Station scope</label>
                  <input value={form.stationScope}
                    onChange={e => setForm(p => ({ ...p, stationScope: e.target.value.toUpperCase() }))}
                    placeholder="OP010 or blank = all" className={`${inp} font-mono`} />
                </div>
              </div>

              {/* Mode picker - Responsive */}
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-2">Validation mode</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      value: "SEGMENT",
                      icon: <Sliders size={16} />,
                      title: "Segment builder",
                      desc: "Define each field by position — system auto-generates the regex.",
                      selCls: "border-accent/50 bg-accent/5",
                      iconCls: "text-accent",
                    },
                    {
                      value: "REGEX",
                      icon: <Code2 size={16} />,
                      title: "Custom regex",
                      desc: "Write a pattern with named groups to extract fields.",
                      selCls: "border-purple-500/50 bg-purple-500/5",
                      iconCls: "text-purple-400",
                    },
                  ].map(m => (
                    <button key={m.value} type="button" onClick={() => setForm(p => ({ ...p, ruleType: m.value }))}
                      className={`p-3 sm:p-4 rounded-xl border text-left transition-all ${form.ruleType === m.value ? m.selCls : "border-border bg-bg-dark/20 hover:border-border/80"}`}>
                      <div className={`flex items-center gap-2 mb-1.5 ${form.ruleType === m.value ? m.iconCls : "text-text-muted"}`}>
                        {m.icon}
                        <span className="text-sm font-semibold text-text-main">{m.title}</span>
                        {form.ruleType === m.value && <CheckCircle size={13} className="ml-auto" />}
                      </div>
                      <p className="text-[11px] text-text-muted leading-relaxed">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* SEGMENT MODE - Responsive */}
              {form.ruleType === "SEGMENT" && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">Field segments</label>
                      <div className="relative">
                        <button
                          type="button"
                          className="text-text-muted/50 hover:text-text-muted transition-colors"
                          onMouseEnter={() => setTooltipField("segments")}
                          onMouseLeave={() => setTooltipField(null)}
                        >
                          <HelpCircle size={12} />
                        </button>
                        {tooltipField === "segments" && (
                          <div className="absolute left-0 bottom-full mb-2 w-64 p-2 bg-bg-card border border-border rounded-lg shadow-lg text-[10px] text-text-muted z-10">
                            Define each part of your QR code as a segment. Drag to reorder. Disabled segments are ignored.
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-text-muted">Separator:</span>
                      <input value={form.separator}
                        onChange={e => setForm(p => ({ ...p, separator: e.target.value }))}
                        placeholder="-"
                        className="w-16 bg-bg-dark border border-border rounded-md px-2 py-1.5 text-xs text-text-main font-mono outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 text-center" />
                    </div>
                  </div>

                  {/* Responsive segment view - Card layout on mobile, grid on desktop */}
                  {form.segments.length === 0 && (
                    <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded-xl">
                      No segments added. Click a quick-add field below to start.
                    </div>
                  )}

                  {/* Desktop view (hidden on mobile) */}
                  <div className="hidden lg:block">
                    {form.segments.length > 0 && (
                      <div className="grid gap-2 px-2 text-[10px] font-bold text-text-muted uppercase tracking-wider"
                        style={{ gridTemplateColumns: "28px minmax(100px, 1fr) 70px 110px 140px 60px 50px 32px" }}>
                        <span></span>
                        <span>Field</span>
                        <span>Display</span>
                        <span>Type</span>
                        <span>Mode / Length</span>
                        <span className="text-center">Req</span>
                        <span className="text-center">En</span>
                        <span></span>
                      </div>
                    )}

                    {form.segments.map((seg, i) => (
                      <div key={i}
                        className={`grid gap-2 items-center p-2 bg-bg-dark/40 border rounded-xl transition-all ${seg.enabled ? 'border-border' : 'border-border/40 opacity-60'}`}
                        style={{ gridTemplateColumns: "28px minmax(100px, 1fr) 70px 110px 140px 60px 50px 32px" }}
                        draggable
                        onDragStart={() => setDragIndex(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => { if (dragIndex !== null && dragIndex !== i) moveSegment(dragIndex, i); setDragIndex(null); }}>
                        
                        <div className="cursor-grab text-text-muted/40 hover:text-text-muted flex justify-center">
                          <GripVertical size={14} />
                        </div>

                        <input value={seg.field} onChange={(e) => updateSeg(i, "field", e.target.value.toLowerCase().replace(/\s+/g, "_"))} placeholder="name" className={seg_inp} />
                        <input value={seg.displayName || ""} onChange={(e) => updateSeg(i, "displayName", e.target.value.toUpperCase().slice(0, 6))} placeholder="YY" className={seg_inp} />

                        <div className="relative">
                          <select value={seg.type} onChange={(e) => updateSeg(i, "type", e.target.value)} className={seg_inp}>
                            {FIELD_TYPES.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
                          </select>
                          <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 text-text-muted/30 hover:text-text-muted"
                            onMouseEnter={() => setTooltipField(`type_${i}`)} onMouseLeave={() => setTooltipField(null)}>
                            <HelpCircle size={10} />
                          </button>
                        </div>

                        <div className="flex gap-1 items-center">
                          <select value={seg.mode} onChange={(e) => updateSeg(i, "mode", e.target.value)} className="bg-bg-dark border border-border rounded-md px-1 py-1.5 text-xs text-text-main outline-none focus:border-accent/60 w-20">
                            <option value="FIXED">Fixed</option>
                            <option value="RANGE">Range</option>
                            <option value="UNTIL_SEPARATOR">Until sep</option>
                          </select>
                          {seg.mode === "FIXED" && (
                            <input type="number" value={seg.length} onChange={(e) => updateSeg(i, "length", Number(e.target.value))} min={1} max={20} className="w-14 bg-bg-dark border border-border rounded-md px-2 py-1.5 text-xs text-text-main font-mono outline-none focus:border-accent/60 text-center" />
                          )}
                          {seg.mode === "RANGE" && (
                            <div className="flex gap-1 items-center">
                              <input type="number" value={seg.minLength} onChange={(e) => updateSeg(i, "minLength", Number(e.target.value))} min={1} className="w-12 bg-bg-dark border border-border rounded-md px-1 py-1.5 text-xs text-text-main font-mono outline-none focus:border-accent/60 text-center" />
                              <span className="text-text-muted text-xs">to</span>
                              <input type="number" value={seg.maxLength} onChange={(e) => updateSeg(i, "maxLength", Number(e.target.value))} min={1} className="w-12 bg-bg-dark border border-border rounded-md px-1 py-1.5 text-xs text-text-main font-mono outline-none focus:border-accent/60 text-center" />
                            </div>
                          )}
                          {seg.mode === "UNTIL_SEPARATOR" && <span className="text-[10px] text-text-muted px-1">(until sep)</span>}
                        </div>

                        <label className="flex justify-center cursor-pointer">
                          <input type="checkbox" checked={seg.required} onChange={(e) => updateSeg(i, "required", e.target.checked)} className="sr-only peer" />
                          <div className={`w-6 h-3.5 rounded-full transition-colors ${seg.required ? 'bg-accent' : 'bg-border'}`}>
                            <div className={`w-2.5 h-2.5 bg-white rounded-full transition-transform mt-0.5 ${seg.required ? 'translate-x-3' : 'translate-x-0.5'}`} />
                          </div>
                        </label>

                        <label className="flex justify-center cursor-pointer">
                          <input type="checkbox" checked={seg.enabled !== false} onChange={() => toggleSegment(i)} className="sr-only peer" />
                          <div className={`w-6 h-3.5 rounded-full transition-colors ${seg.enabled !== false ? 'bg-accent/70' : 'bg-border'}`}>
                            <div className={`w-2.5 h-2.5 bg-white rounded-full transition-transform mt-0.5 ${seg.enabled !== false ? 'translate-x-3' : 'translate-x-0.5'}`} />
                          </div>
                        </label>

                        <button type="button" onClick={() => removeSeg(i)} className="p-1 rounded text-text-muted/40 hover:text-danger transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Mobile card view (visible only on mobile) */}
                  <div className="lg:hidden space-y-3">
                    {form.segments.map((seg, i) => (
                      <div key={i} className={`p-3 bg-bg-dark/40 border rounded-xl space-y-2 ${seg.enabled ? 'border-border' : 'border-border/40 opacity-60'}`}>
                        <div className="flex items-center gap-2">
                          <div className="cursor-grab text-text-muted/40">
                            <GripVertical size={14} />
                          </div>
                          <input value={seg.field} onChange={(e) => updateSeg(i, "field", e.target.value)} placeholder="Field name" className="flex-1 text-xs bg-bg-dark border border-border rounded px-2 py-1" />
                          <button type="button" onClick={() => removeSeg(i)} className="text-danger p-1">
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input value={seg.displayName || ""} onChange={(e) => updateSeg(i, "displayName", e.target.value)} placeholder="Display" className="text-xs bg-bg-dark border border-border rounded px-2 py-1" />
                          <select value={seg.type} onChange={(e) => updateSeg(i, "type", e.target.value)} className="text-xs bg-bg-dark border border-border rounded px-2 py-1">
                            {FIELD_TYPES.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
                          </select>
                        </div>
                        <div className="flex gap-2 items-center">
                          <select value={seg.mode} onChange={(e) => updateSeg(i, "mode", e.target.value)} className="text-xs bg-bg-dark border border-border rounded px-2 py-1 flex-1">
                            <option value="FIXED">Fixed</option>
                            <option value="RANGE">Range</option>
                            <option value="UNTIL_SEPARATOR">Until sep</option>
                          </select>
                          {seg.mode === "FIXED" && (
                            <input type="number" value={seg.length} onChange={(e) => updateSeg(i, "length", Number(e.target.value))} placeholder="Len" className="w-20 text-xs bg-bg-dark border border-border rounded px-2 py-1 text-center" />
                          )}
                          {seg.mode === "RANGE" && (
                            <div className="flex gap-1">
                              <input type="number" value={seg.minLength} onChange={(e) => updateSeg(i, "minLength", Number(e.target.value))} placeholder="Min" className="w-16 text-xs bg-bg-dark border border-border rounded px-2 py-1 text-center" />
                              <span>-</span>
                              <input type="number" value={seg.maxLength} onChange={(e) => updateSeg(i, "maxLength", Number(e.target.value))} placeholder="Max" className="w-16 text-xs bg-bg-dark border border-border rounded px-2 py-1 text-center" />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 text-xs text-text-muted">
                            <input type="checkbox" checked={seg.required} onChange={(e) => updateSeg(i, "required", e.target.checked)} className="rounded" />
                            Required
                          </label>
                          <label className="flex items-center gap-2 text-xs text-text-muted">
                            <input type="checkbox" checked={seg.enabled !== false} onChange={() => toggleSegment(i)} className="rounded" />
                            Enabled
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* quick-add */}
                  <div>
                    <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Quick-add fields</p>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_FIELDS.map(f => (
                        <button key={f.field} type="button" onClick={() => addSeg(f)}
                          className="flex items-center gap-1 px-2 py-1 border border-border rounded-lg text-[10px] font-mono text-text-muted hover:text-accent hover:border-accent/40 transition-all">
                          <Plus size={9} />{f.displayName || f.field}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* live generated regex */}
                  {liveRegex && (
                    <div className="flex items-center gap-3 px-4 py-3 bg-bg-dark/50 border border-border rounded-xl">
                      <Zap size={12} className="text-accent flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-0.5">Auto-generated regex</p>
                        <code className="text-[10px] font-mono text-text-main break-all">{liveRegex}</code>
                      </div>
                      <button type="button" onClick={() => copy(liveRegex)} className="p-1 text-text-muted hover:text-primary flex-shrink-0">
                        {copied === liveRegex ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* REGEX MODE - Simplified (no template picker) */}
              {form.ruleType === "REGEX" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">
                      Regex pattern *
                      <span className="ml-2 font-normal opacity-50">Use (?&lt;name&gt;...) for named capture groups</span>
                    </label>
                    <textarea required value={form.regexPattern}
                      onChange={e => setForm(p => ({ ...p, regexPattern: e.target.value }))}
                      placeholder={"^(?<plant>[A-Z])(?<year>\\d{2})(?<month>[A-Z])(?<date>\\d{2})(?<shift>[A-Z])(?<serial>\\d{4})$"}
                      rows={3}
                      className="w-full bg-bg-dark border border-border rounded-lg px-3 py-2.5 text-text-main font-mono text-xs outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors resize-none" />
                  </div>
                  <div className="text-xs text-text-muted bg-bg-dark/30 p-3 rounded-lg">
                    <Info size={12} className="inline mr-1" /> Example: ^(?&lt;year&gt;\d{2})(?&lt;month&gt;\d{2})(?&lt;serial&gt;\d{4})$
                  </div>
                </div>
              )}

              {/* TEST ENGINE - Responsive */}
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-bg-dark/40 border-b border-border flex items-center gap-2">
                  <FlaskConical size={13} className="text-accent" />
                  <span className="text-[10px] font-bold text-text-main uppercase tracking-wider">Test engine</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input value={form.sampleValue}
                      onChange={e => { setForm(p => ({ ...p, sampleValue: e.target.value })); setTestResult(null); }}
                      placeholder="Paste a real scan string here…"
                      className={`${inp} flex-1 font-mono`} />
                    <button type="button" onClick={runTest}
                      className="flex items-center justify-center gap-1.5 px-4 py-2 bg-bg-dark border border-border rounded-lg text-xs font-semibold text-text-muted hover:text-accent hover:border-accent/40 transition-all whitespace-nowrap">
                      <Zap size={12} /> Run test
                    </button>
                  </div>

                  {testResult && (
                    <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm font-semibold ${testResult.ok ? "bg-accent/10 border-accent/30 text-accent" : "bg-danger/10 border-danger/30 text-danger"
                      }`}>
                      {testResult.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                      {testResult.msg}
                    </div>
                  )}

                  {testResult?.fields && Object.keys(testResult.fields).length > 0 && (
                    <div>
                      <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-2">Extracted fields</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {Object.entries(testResult.fields).map(([k, v]) => (
                          <div key={k} className="px-2.5 py-2 bg-bg-dark/50 border border-border rounded-lg">
                            <p className="text-[9px] font-mono font-semibold text-text-muted">{k}</p>
                            <p className="text-sm font-bold text-accent font-mono mt-0.5 break-all">{v}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Description + active toggle - Responsive */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Description</label>
                  <input value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="Optional note" className={inp} />
                </div>
                <div className="flex items-center justify-between px-4 py-3 border border-border rounded-xl bg-bg-dark/20">
                  <div>
                    <p className="text-xs font-semibold text-text-main">Active</p>
                    <p className="text-[10px] text-text-muted mt-0.5">Apply to live scanning</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={form.isActive}
                      onChange={e => setForm(p => ({ ...p, isActive: e.target.checked }))} className="sr-only peer" />
                    <div className="w-9 h-5 bg-border rounded-full peer-checked:bg-accent transition-colors" />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-sm" />
                  </label>
                </div>
              </div>

            </form>

            {/* Modal footer */}
            <div className="px-4 sm:px-6 py-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 bg-bg-dark/20 flex-shrink-0">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <HelpCircle size={12} /><span>First matching rule wins at runtime</span>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={resetForm}
                  className="px-4 py-2 text-sm text-text-muted hover:text-text-main font-semibold transition-colors">
                  Cancel
                </button>
                <button type="submit" form="qr-form" disabled={saving}
                  className="flex items-center gap-2 px-6 py-2 bg-primary text-white font-bold rounded-xl text-sm hover:brightness-110 transition-all disabled:opacity-50">
                  <Save size={14} />{saving ? "Saving…" : editingId ? "Save changes" : "Add rule"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      <ConfirmModal
        isOpen={Boolean(deleteId)}
        title="Delete rule?"
        message="This rule will be removed from live scanning immediately."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={async () => { const id = deleteId; setDeleteId(null); if (id) await handleDelete(id); }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}