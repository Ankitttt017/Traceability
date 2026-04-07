// ReportConfiguration.jsx — Define report heading, branding & layout settings
import { useCallback, useEffect, useState } from "react";
import {
  FileText, Save, RefreshCw, Plus, Trash2, Edit2, X,
  Download, Settings, Image, Type, MapPin, Building2
} from "lucide-react";
import toast from "react-hot-toast";

const STORAGE_KEY = "traceability-report-config-v1";

const DEFAULT_CONFIG = {
  companyName: "BMW Group",
  plantName: "Gen-6 Bawal Plant",
  projectTitle: "Traceability System",
  reportTitle: "Production Report",
  logoUrl: "",
  headerLine1: "BMW India Private Limited",
  headerLine2: "Quality & Production Traceability",
  footerText: "Confidential — Internal Use Only",
  location: "Bawal, Haryana, India",
  preparedBy: "",
  approvedBy: "",
  department: "Quality Engineering",
  showLogo: true,
  showDate: true,
  showShift: true,
  showMachine: true,
  columns: [
    { id: "partId", label: "Part Serial No", enabled: true },
    { id: "machineName", label: "Machine Name", enabled: true },
    { id: "stationNo", label: "Station", enabled: true },
    { id: "status", label: "Result (OK/NG)", enabled: true },
    { id: "shiftCode", label: "Shift", enabled: true },
    { id: "createdAt", label: "Timestamp", enabled: true },
    { id: "operationNo", label: "Operation No", enabled: false },
    { id: "lineName", label: "Line", enabled: false },
  ],
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}
function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

const inputCls = "w-full bg-bg-dark border border-border rounded-lg px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-text-muted/40";

const ReportConfiguration = () => {
  const [config, setConfig] = useState(() => loadConfig());
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState("branding");

  const updateField = (key, value) => setConfig(p => ({ ...p, [key]: value }));

  const toggleColumn = (id) => {
    setConfig(p => ({
      ...p,
      columns: p.columns.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c)
    }));
  };

  const handleSave = () => {
    setSaving(true);
    try {
      saveConfig(config);
      toast.success("Report configuration saved successfully");
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig({ ...DEFAULT_CONFIG });
    toast.success("Configuration reset to defaults");
  };

  const sections = [
    { id: "branding", label: "Branding", icon: Building2 },
    { id: "header", label: "Report Headers", icon: Type },
    { id: "footer", label: "Footer & Info", icon: FileText },
    { id: "columns", label: "Report Columns", icon: Settings },
    { id: "preview", label: "Preview", icon: Download },
  ];

  return (
    <div className="space-y-6 rise-in">
      {/* Header */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <FileText size={22} />
            </div>
            <div>
              <h1 className="db-header-title">Report Configuration</h1>
              <p className="db-header-subtitle">Define report headings, branding & export layout</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleReset} className="db-secondary-btn">
              <RefreshCw size={13} /> Reset
            </button>
            <button onClick={handleSave} disabled={saving} className="db-action-btn">
              <Save size={14} /> {saving ? "Saving…" : "Save Config"}
            </button>
          </div>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="db-tabs-container mb-6">
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`db-tab-btn ${activeSection === s.id ? "active" : ""}`}>
            <s.icon size={13} /> {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-bg-dark/30 flex items-center gap-2">
          {sections.find(s => s.id === activeSection)?.icon && (() => {
            const Icon = sections.find(s => s.id === activeSection).icon;
            return <Icon size={14} className="text-primary" />;
          })()}
          <h2 className="text-xs font-bold text-text-main uppercase tracking-wider">{sections.find(s => s.id === activeSection)?.label}</h2>
        </div>
        <div className="p-6">
          {/* BRANDING SECTION */}
          {activeSection === "branding" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Company Name</label>
                <input value={config.companyName} onChange={e => updateField("companyName", e.target.value)} placeholder="e.g. BMW Group" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Plant Name</label>
                <input value={config.plantName} onChange={e => updateField("plantName", e.target.value)} placeholder="e.g. Gen-6 Bawal Plant" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Project Title</label>
                <input value={config.projectTitle} onChange={e => updateField("projectTitle", e.target.value)} placeholder="e.g. Traceability System" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Location</label>
                <input value={config.location} onChange={e => updateField("location", e.target.value)} placeholder="e.g. Bawal, Haryana" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Department</label>
                <input value={config.department} onChange={e => updateField("department", e.target.value)} placeholder="e.g. Quality Engineering" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Logo URL (optional)</label>
                <input value={config.logoUrl} onChange={e => updateField("logoUrl", e.target.value)} placeholder="https://..." className={inputCls} />
              </div>
            </div>
          )}

          {/* HEADER SECTION */}
          {activeSection === "header" && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Report Title</label>
                  <input value={config.reportTitle} onChange={e => updateField("reportTitle", e.target.value)} placeholder="Production Report" className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Header Line 1</label>
                  <input value={config.headerLine1} onChange={e => updateField("headerLine1", e.target.value)} placeholder="Company Legal Name" className={inputCls} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Header Line 2 (Subtitle)</label>
                  <input value={config.headerLine2} onChange={e => updateField("headerLine2", e.target.value)} placeholder="Quality & Production Traceability" className={inputCls} />
                </div>
              </div>
              <div className="p-4 bg-bg-dark/50 border border-border rounded-xl">
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-3">Show in Report Header</p>
                <div className="flex flex-wrap gap-4">
                  {[
                    { key: "showLogo", label: "Company Logo" },
                    { key: "showDate", label: "Report Date" },
                    { key: "showShift", label: "Shift Info" },
                    { key: "showMachine", label: "Machine Name" },
                  ].map(opt => (
                    <label key={opt.key} className="flex items-center gap-2 cursor-pointer group">
                      <input type="checkbox" checked={config[opt.key]} onChange={e => updateField(opt.key, e.target.checked)} className="sr-only peer" />
                      <div className="w-8 h-5 bg-border rounded-full peer peer-checked:bg-accent transition-colors relative">
                        <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-3 shadow-sm" />
                      </div>
                      <span className="text-xs font-semibold text-text-muted group-hover:text-text-main">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FOOTER SECTION */}
          {activeSection === "footer" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Footer Text</label>
                <input value={config.footerText} onChange={e => updateField("footerText", e.target.value)} placeholder="Confidential — Internal Use Only" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Prepared By</label>
                <input value={config.preparedBy} onChange={e => updateField("preparedBy", e.target.value)} placeholder="Name or Title" className={inputCls} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Approved By</label>
                <input value={config.approvedBy} onChange={e => updateField("approvedBy", e.target.value)} placeholder="Name or Title" className={inputCls} />
              </div>
            </div>
          )}

          {/* COLUMNS SECTION */}
          {activeSection === "columns" && (
            <div className="space-y-4">
              <p className="text-xs text-text-muted">Select which columns appear in downloaded reports (CSV/PDF).</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {config.columns.map(col => (
                  <div key={col.id}
                    onClick={() => toggleColumn(col.id)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${col.enabled ? "bg-primary/10 border-primary/30 text-primary" : "bg-bg-dark/40 border-border text-text-muted hover:border-primary/20"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">{col.label}</span>
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${col.enabled ? "bg-primary text-on-strong" : "bg-border"}`}>
                        {col.enabled && <span className="text-[10px]">✓</span>}
                      </div>
                    </div>
                    <p className="text-[10px] mt-1 font-mono opacity-60">{col.id}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PREVIEW SECTION */}
          {activeSection === "preview" && (
            <div className="space-y-4">
              <p className="text-xs text-text-muted mb-4">Preview of how the report header will look when exported:</p>
              <div className="bg-white text-gray-900 rounded-xl p-8 border border-border shadow-inner">
                {/* Report Preview */}
                <div className="border-b-2 border-gray-900 pb-4 mb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-lg font-bold">{config.headerLine1 || config.companyName}</h2>
                      <p className="text-sm text-gray-600">{config.headerLine2}</p>
                    </div>
                    <div className="text-right">
                      {config.showDate && <p className="text-xs text-gray-500">Date: {new Date().toLocaleDateString()}</p>}
                      {config.location && <p className="text-xs text-gray-500">{config.location}</p>}
                    </div>
                  </div>
                </div>
                <h3 className="text-center text-base font-bold mb-1">{config.reportTitle}</h3>
                <p className="text-center text-xs text-gray-500 mb-4">{config.plantName} — {config.department}</p>
                
                <table className="w-full text-xs border-collapse mb-4">
                  <thead>
                    <tr className="bg-gray-100">
                      {config.columns.filter(c => c.enabled).map(c => (
                        <th key={c.id} className="border border-gray-300 px-2 py-1.5 text-left font-bold">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {config.columns.filter(c => c.enabled).map(c => (
                        <td key={c.id} className="border border-gray-300 px-2 py-1.5 text-gray-400 italic">Sample data</td>
                      ))}
                    </tr>
                  </tbody>
                </table>

                <div className="border-t border-gray-300 pt-3 flex justify-between text-[10px] text-gray-500">
                  <div>
                    {config.preparedBy && <span>Prepared by: {config.preparedBy}</span>}
                    {config.approvedBy && <span className="ml-6">Approved by: {config.approvedBy}</span>}
                  </div>
                  <span>{config.footerText}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportConfiguration;
