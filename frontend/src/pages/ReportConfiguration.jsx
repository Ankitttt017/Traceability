// ReportConfiguration.jsx - Define report heading, branding & layout settings
import { useMemo, useRef, useState, useEffect } from "react";
import { FileText, Save, RefreshCw, Download, Settings, Type, Building2, ShieldCheck, ClipboardCheck, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import {
  DEFAULT_REPORT_CONFIG,
  loadReportConfig,
  saveReportConfig,
} from "../utils/reportConfig";
import { reportApi, machineApi, organizationApi, shiftApi } from "../api/services";

const inputCls = "w-full bg-bg-dark border border-border rounded-lg px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-text-muted/40";
const normalizePartToken = (value) => String(value || "").trim().toUpperCase();

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); a.remove(); URL.revokeObjectURL(url);
}

const ReportConfiguration = () => {
  const [config, setConfig] = useState(() => loadReportConfig());
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState("branding");
  const [exportLoading, setExportLoading] = useState(false);
  const [machines, setMachines] = useState([]);
  const [organization, setOrganization] = useState({ plants: [], lines: [], parts: [] });
  const [shifts, setShifts] = useState([]);
  
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    plantId: "",
    lineId: "",
    machineId: "",
    lineName: "",
    partName: "",
    dieName: "",
    dieCastingMachine: "",
    shiftCode: "",
  });

  const logoFileInputRef = useRef(null);

  useEffect(() => {
    machineApi.list().then(m => setMachines(m || [])).catch(() => {});
    organizationApi.context().then((org) => setOrganization({ plants: org?.plants || [], lines: org?.lines || [], parts: org?.parts || [] })).catch(() => {});
    shiftApi.list().then((rows) => setShifts((rows || []).filter((row) => row?.isActive !== false))).catch(() => {});
  }, []);

  const scopedMachines = useMemo(
    () => machines.filter((machine) => !filters.plantId || String(machine.plantId || "") === String(filters.plantId)),
    [machines, filters.plantId]
  );
  const scopedLines = useMemo(
    () => (organization.lines || []).filter((line) => !filters.plantId || String(line.plantId || "") === String(filters.plantId)),
    [organization.lines, filters.plantId]
  );
  const activePartAssignments = useMemo(() => {
    return (organization.parts || []).filter((part) => {
      const active = String(part.status || "ACTIVE").toUpperCase() !== "INACTIVE" && part.isActive !== false;
      const plantOk = !filters.plantId || String(part.plantId || "") === String(filters.plantId);
      const lineOk = !filters.lineId || String(part.lineId || "") === String(filters.lineId);
      return active && plantOk && lineOk;
    });
  }, [organization.parts, filters.plantId, filters.lineId]);
  const availablePartNames = useMemo(() => (
    [...new Set(activePartAssignments.map((part) => normalizePartToken(part.partName)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
  ), [activePartAssignments]);
  const availableDies = useMemo(() => (
    [...new Set(activePartAssignments
      .filter((part) => !filters.partName || normalizePartToken(part.partName) === normalizePartToken(filters.partName))
      .map((part) => normalizePartToken(part.dieName))
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
  ), [activePartAssignments, filters.partName]);
  const availableDieCastingMachines = useMemo(() => (
    [...new Set(activePartAssignments
      .filter((part) => !filters.partName || normalizePartToken(part.partName) === normalizePartToken(filters.partName))
      .filter((part) => !filters.dieName || normalizePartToken(part.dieName) === normalizePartToken(filters.dieName))
      .map((part) => normalizePartToken(part.dieCastingMachine))
      .filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
  ), [activePartAssignments, filters.partName, filters.dieName]);

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
      saveReportConfig(config);
      toast.success("Report configuration saved successfully");
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig({ ...DEFAULT_REPORT_CONFIG });
    toast.success("Configuration reset to defaults");
  };

  const toDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image"));
      reader.readAsDataURL(file);
    });

  const handleBrowseLogo = async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    try {
      const dataUrl = await toDataUrl(file);
      updateField("logoUrl", dataUrl);
      updateField("showLogo", true);
      toast.success("Logo uploaded for reports");
    } catch {
      toast.error("Unable to read logo file");
    } finally {
      if (event.target) event.target.value = "";
    }
  };

  const handleRunExport = async (type) => {
    setExportLoading(true);
    try {
      let blob;
      const ts = new Date().toISOString().slice(0,10);
      if (type === "full") {
        blob = await reportApi.exportFull(filters, config);
        downloadBlob(blob, `Full_Report_${ts}.xlsx`);
      } else if (type === "ng") {
        blob = await reportApi.exportNG(filters, config);
        downloadBlob(blob, `NG_Report_${ts}.xlsx`);
      } else if (type === "parts") {
        blob = await reportApi.exportParts(filters, config);
        downloadBlob(blob, `Parts_Report_${ts}.xlsx`);
      } else if (type === "audit") {
        blob = await reportApi.exportAudit(filters, config);
        downloadBlob(blob, `Audit_Report_${ts}.xlsx`);
      }
      toast.success(`${type.toUpperCase()} report generated`);
    } catch (e) {
      console.error(e);
      toast.error("Export failed");
    } finally {
      setExportLoading(false);
    }
  };

  const sections = [
    { id: "branding", label: "Branding", icon: Building2 },
    { id: "header", label: "Report Headers", icon: Type },
    { id: "footer", label: "Footer & Info", icon: FileText },
    { id: "columns", label: "Report Columns", icon: Settings },
    { id: "exporthub", label: "Export Hub", icon: Download },
    { id: "preview", label: "Preview", icon: ShieldCheck },
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
              <Save size={14} /> {saving ? "Saving..." : "Save Config"}
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
              <div className="md:col-span-2">
                <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Logo Upload</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleBrowseLogo}
                    className="hidden"
                  />
                  <button type="button" onClick={() => logoFileInputRef.current?.click()} className="db-secondary-btn">
                    Browse Logo
                  </button>
                  <button
                    type="button"
                    onClick={() => updateField("logoUrl", "")}
                    className="db-secondary-btn"
                  >
                    Remove Logo
                  </button>
                </div>
                {config.logoUrl ? (
                  <div className="mt-3 p-3 rounded-lg border border-border bg-bg-dark/30 inline-block">
                    <img src={config.logoUrl} alt="Report logo preview" className="h-14 w-auto object-contain" />
                  </div>
                ) : (
                  <p className="text-xs text-text-muted mt-2">No logo selected.</p>
                )}
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
                <input value={config.footerText} onChange={e => updateField("footerText", e.target.value)} placeholder="Confidential - Internal Use Only" className={inputCls} />
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
            <div className="space-y-6">
              <div className="p-4 bg-bg-dark/30 border border-border rounded-xl">
                <h3 className="text-xs font-bold text-text-main uppercase tracking-widest mb-2 flex items-center gap-2">
                  <Settings size={14} className="text-primary" /> Active Report Columns
                </h3>
                <p className="text-[11px] text-text-muted mb-4">Select the specific data fields to include in your industrial exports. Checked items will appear as columns in the Excel file.</p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {config.columns.map(col => (
                    <label key={col.id} 
                      className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all cursor-pointer group ${col.enabled ? "bg-primary/5 border-primary/30" : "bg-bg-dark/20 border-border hover:border-primary/20"}`}>
                      <div className="relative flex items-center justify-center">
                        <input 
                          type="checkbox" 
                          checked={col.enabled} 
                          onChange={() => toggleColumn(col.id)}
                          className="sr-only peer"
                        />
                        <div className="w-5 h-5 border-2 border-border rounded-md peer-checked:bg-primary peer-checked:border-primary transition-all flex items-center justify-center">
                          {col.enabled && <div className="w-2 h-3 border-r-2 border-b-2 border-white rotate-45 -mt-0.5" />}
                        </div>
                      </div>
                      <div className="flex-1">
                        <span className={`text-[13px] font-bold block transition-colors ${col.enabled ? "text-text-main" : "text-text-muted group-hover:text-text-main"}`}>
                          {col.label}
                        </span>
                        <span className="text-[9px] font-mono opacity-50 uppercase tracking-tighter">{col.id}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* EXPORT HUB SECTION */}
          {activeSection === "exporthub" && (
            <div className="space-y-6">
              <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl flex gap-3">
                <AlertCircle className="text-blue-500 shrink-0" size={18} />
                <p className="text-xs text-text-muted leading-relaxed">
                  Consolidated reporting engine. Select your filters below and trigger high-conformance Excel exports.
                  All reports adhere to the branding and column rules defined in the other tabs.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">From Date/Time</label>
                  <input type="datetime-local" className={inputCls} value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">To Date/Time</label>
                  <input type="datetime-local" className={inputCls} value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Shift</label>
                  <select className={inputCls} value={filters.shiftCode} onChange={e => setFilters(f => ({ ...f, shiftCode: e.target.value }))}>
                    <option value="">All Shifts</option>
                    {shifts.map((shift) => (
                      <option key={shift.id || shift.shiftCode || shift.shift_code} value={shift.shiftCode || shift.shift_code}>
                        {shift.shiftName || shift.shift_name || shift.shiftCode || shift.shift_code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Plant</label>
                  <select className={inputCls} value={filters.plantId} onChange={e => setFilters(f => ({ ...f, plantId: e.target.value, lineId: "", lineName: "", machineId: "", partName: "", dieName: "", dieCastingMachine: "" }))}>
                    <option value="">All Plants</option>
                    {(organization.plants || []).map((plant) => (
                      <option key={plant.id} value={plant.id}>{plant.plantName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Line</label>
                  <select className={inputCls} value={filters.lineId} onChange={e => {
                    const line = scopedLines.find((item) => String(item.id) === String(e.target.value));
                    setFilters(f => ({ ...f, lineId: e.target.value, lineName: line?.lineName || "", machineId: "", partName: "", dieName: "", dieCastingMachine: "" }));
                  }}>
                    <option value="">All Lines</option>
                    {scopedLines.map(line => (
                      <option key={line.id} value={line.id}>{line.lineName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Part</label>
                  <select className={inputCls} value={filters.partName} onChange={e => setFilters(f => ({ ...f, partName: normalizePartToken(e.target.value), dieName: "", dieCastingMachine: "" }))}>
                    <option value="">All Parts</option>
                    {availablePartNames.map((partName) => <option key={partName} value={partName}>{partName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Die</label>
                  <select className={inputCls} value={filters.dieName} onChange={e => setFilters(f => ({ ...f, dieName: normalizePartToken(e.target.value), dieCastingMachine: "" }))}>
                    <option value="">All Dies</option>
                    {availableDies.map((dieName) => <option key={dieName} value={dieName}>{dieName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Die Casting Machine</label>
                  <select className={inputCls} value={filters.dieCastingMachine} onChange={e => setFilters(f => ({ ...f, dieCastingMachine: normalizePartToken(e.target.value) }))}>
                    <option value="">All Die Casting Machines</option>
                    {availableDieCastingMachines.map((machineName) => <option key={machineName} value={machineName}>{machineName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-widest block mb-1.5">Machine Name</label>
                  <select className={inputCls} value={filters.machineId} onChange={e => setFilters(f => ({ ...f, machineId: e.target.value }))}>
                    <option value="">All Machines</option>
                    {scopedMachines
                      .filter(m => !filters.lineId || String(m.lineId || m.line_id || "") === String(filters.lineId))
                      .filter(m => !filters.lineName || m.lineName === filters.lineName)
                      .map(m => (
                      <option key={m.id} value={m.id}>{m.machineName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
                <button disabled={exportLoading} onClick={() => handleRunExport("full")} 
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-bg-dark/40 border border-border hover:border-primary/40 hover:bg-primary/5 transition-all group">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                    <ClipboardCheck size={24} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-text-main">Full Report</p>
                    <p className="text-[10px] text-text-muted mt-1">Complete production log</p>
                  </div>
                </button>

                <button disabled={exportLoading} onClick={() => handleRunExport("ng")}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-bg-dark/40 border border-border hover:border-red-500/40 hover:bg-red-500/5 transition-all group">
                  <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 group-hover:scale-110 transition-transform">
                    <AlertCircle size={24} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-text-main">NG Report</p>
                    <p className="text-[10px] text-text-muted mt-1">Rejected parts only</p>
                  </div>
                </button>

                <button disabled={exportLoading} onClick={() => handleRunExport("parts")}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-bg-dark/40 border border-border hover:border-amber-500/40 hover:bg-amber-500/5 transition-all group">
                  <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform">
                    <Settings size={24} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-text-main">Parts Report</p>
                    <p className="text-[10px] text-text-muted mt-1">Unique part journey</p>
                  </div>
                </button>

                <button disabled={exportLoading} onClick={() => handleRunExport("audit")}
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-bg-dark/40 border border-border hover:border-green-500/40 hover:bg-green-500/5 transition-all group">
                  <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 group-hover:scale-110 transition-transform">
                    <ShieldCheck size={24} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-text-main">Audit Report</p>
                    <p className="text-[10px] text-text-muted mt-1">Conformance summary</p>
                  </div>
                </button>
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
                <p className="text-center text-xs text-gray-500 mb-4">{config.plantName} - {config.department}</p>
                
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
