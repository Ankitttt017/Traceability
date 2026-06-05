import { useCallback, useEffect, useMemo, useState } from "react";
import { 
  Boxes, 
  QrCode, 
  RefreshCw, 
  Save, 
  Settings2, 
  PlusCircle, 
  Filter, 
  Database,
  ArrowRightCircle,
  Hash,
  Activity,
  Package,
  TrendingUp,
  CheckCircle
} from "lucide-react";
import { packingApi } from "../api/services";
import { useLanguage } from "../context/LanguageContext";

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return (!Number.isFinite(parsed) || parsed <= 0) ? fallback : Math.trunc(parsed);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

/**
 * Premium SVG Barcode Preview
 */
function BarcodePreview({ value }) {
  const bars = useMemo(() => {
    const CODE_39 = {
      "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
      "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
      "8": "wnnwnnwnn", "9": "nnwwnnwnn", A: "wnnnnnwnnw", B: "nnwnnwnnw",
      C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn",
      G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
      K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww",
      O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn",
      S: "nnwnnnwwn", T: "nnnnwnwwn", U: "wwnnnnnnw", V: "nwwnnnnnw",
      W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn",
      "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", $: "nwnwnwnnn",
      "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn", "*": "nwnnwnwnn",
    };
    const sanitized = String(value || "EMPTY").toUpperCase().replace(/[^0-9A-Z.$/+% -]/g, "");
    const encoded = `*${sanitized || "EMPTY"}*`;
    const segments = [{ isBar: false, width: 10 }];
    for (let i = 0; i < encoded.length; i++) {
      const pattern = CODE_39[encoded[i]];
      if (!pattern) continue;
      for (let j = 0; j < pattern.length; j++) {
        segments.push({ isBar: j % 2 === 0, width: pattern[j] === "w" ? 3 : 1 });
      }
      if (i < encoded.length - 1) segments.push({ isBar: false, width: 1 });
    }
    segments.push({ isBar: false, width: 10 });
    return segments;
  }, [value]);

  const width = bars.reduce((sum, b) => sum + b.width, 0);
  let cur = 0;

  return (
    <div className="bg-white p-3 rounded-xl border border-white/10 shadow-inner">
      <svg viewBox={`0 0 ${width} 60`} className="w-full h-12">
        {bars.map((s, i) => {
          const x = cur; cur += s.width;
          return s.isBar ? <rect key={i} x={x} y={0} width={s.width} height={60} fill="#000" /> : null;
        })}
      </svg>
    </div>
  );
}

const PackingManagement = () => {
  const { t } = useLanguage();
  const [settings, setSettings] = useState({
    boxPrefix: "BOX", boxSeparator: "-", serialPadding: 4, nextSerial: 1,
    defaultCapacity: 65, autoCreateNextBox: true, labelPrefix: "PKG", preview: "BOX-0001"
  });
  const [boxes, setBoxes] = useState([]);
  const [stats, setStats] = useState({ total: 0, open: 0, closed: 0 });
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [popup, setPopup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b, all] = await Promise.all([
        packingApi.managementSettings(),
        packingApi.managementBoxes({ limit: 100, status: statusFilter === "ALL" ? undefined : statusFilter }),
        packingApi.managementBoxes({ limit: 1000 })
      ]);
      setSettings(prev => ({ ...prev, ...s }));
      setBoxes(b?.rows || []);
      const allRows = all?.rows || [];
      setStats({
        total: all?.total || allRows.length,
        open: allRows.filter(r => r.status?.toUpperCase() === "OPEN").length,
        closed: allRows.filter(r => r.status?.toUpperCase() === "CLOSED").length
      });
    } catch (err) {
      console.error(err);
      setPopup({ type: "ERROR", title: "Sync Failed", message: err.response?.data?.error || "Network error in management hub." });
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const p = {
        boxPrefix: settings.boxPrefix.trim().toUpperCase(),
        boxSeparator: settings.boxSeparator || "-",
        serialPadding: toPositiveInt(settings.serialPadding, 4),
        nextSerial: toPositiveInt(settings.nextSerial, 1),
        defaultCapacity: Math.min(500, Math.max(1, toPositiveInt(settings.defaultCapacity, 65))),
        autoCreateNextBox: !!settings.autoCreateNextBox,
        labelPrefix: settings.labelPrefix.trim().toUpperCase()
      };
      await packingApi.updateManagementSettings(p);
      setPopup({ type: "SUCCESS", title: "Configuration Locked", message: "Global packing parameters updated successfully." });
      loadData();
    } catch (err) {
      setPopup({ type: "ERROR", title: "Write Failed", message: err.response?.data?.error || "Unable to persist settings." });
    } finally { setSaving(false); }
  };

  const generateNextBox = async () => {
    setGenerating(true);
    try {
      const res = await packingApi.generateNext();
      setPopup({ type: "SUCCESS", title: "Sequence Advanced", message: `Box unit ${res?.box?.boxNumber} initialized.` });
      loadData();
    } catch (err) {
      setPopup({ type: "ERROR", title: "Generation Gap", message: err.response?.data?.error || "Sequence violation occurred." });
    } finally { setGenerating(false); }
  };

  const getPreviewValue = useMemo(() => {
    const prefix = settings.boxPrefix?.trim().toUpperCase() || "BOX";
    const separator = settings.boxSeparator || "-";
    const nextSerial = String(toPositiveInt(settings.nextSerial, 1)).padStart(toPositiveInt(settings.serialPadding, 4), '0');
    return `${prefix}${separator}${nextSerial}`;
  }, [settings.boxPrefix, settings.boxSeparator, settings.nextSerial, settings.serialPadding]);

  return (
    <div className="space-y-6 rise-in" style={{ fontFamily: "var(--font-outfit)" }}>

      {/* Header matching Station Control */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <Boxes size={22} />
            </div>
            <div>
              <h1 className="db-header-title">{t("packingManagement.title", "Packing Management")}</h1>
              <p className="db-header-subtitle">{t("packingManagement.subtitle", "Configure automated distribution & container mapping protocols")}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadData} disabled={loading} className="db-action-btn">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {t("packingManagement.refresh", "Refresh")}
            </button>
            <button onClick={saveSettings} disabled={saving} className="db-action-btn">
              <Save size={14} /> {t("packingManagement.saveSettings", "Save Settings")}
            </button>
          </div>
        </div>
      </div>

      {/* Compact Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">{t("packingManagement.totalBoxes", "Total Boxes")}</p>
              <p className="text-2xl font-black text-primary font-mono">{stats.total}</p>
            </div>
            <Database size={28} className="text-primary/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">{t("packingManagement.openBoxes", "Open Boxes")}</p>
              <p className="text-2xl font-black text-primary font-mono">{stats.open}</p>
            </div>
            <Activity size={28} className="text-primary/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">{t("packingManagement.closedBoxes", "Closed Boxes")}</p>
              <p className="text-2xl font-black text-emerald-400 font-mono">{stats.closed}</p>
            </div>
            <CheckCircle size={28} className="text-emerald-400/30" />
          </div>
        </div>
      </div>

      {/* Settings Form - Full Width */}
      <div className="industrial-card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-bg-dark/40 flex items-center gap-2">
          <Hash size={14} className="text-primary" />
          <h2 className="text-[10px] font-black text-text-main uppercase tracking-wider">{t("packingManagement.configurationParameters", "Configuration Parameters")}</h2>
        </div>
        <div className="p-5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="space-y-1">
            <label className="text-[9px] font-black text-text-muted uppercase tracking-wider">{t("packingManagement.containerPrefix", "Container Prefix")}</label>
            <input
              type="text"
              value={settings.boxPrefix}
              onChange={e => setSettings(p => ({ ...p, boxPrefix: e.target.value.toUpperCase() }))}
              className="w-full h-9 bg-bg-dark border border-border rounded-lg px-3 font-mono text-sm text-text-main focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all outline-none"
            />
          </div>
          
          <div className="space-y-1">
            <label className="text-[9px] font-black text-text-muted uppercase tracking-wider">{t("packingManagement.separator", "Separator")}</label>
            <input
              type="text"
              value={settings.boxSeparator}
              onChange={e => setSettings(p => ({ ...p, boxSeparator: e.target.value }))}
              className="w-full h-9 bg-bg-dark border border-border rounded-lg px-3 font-mono text-sm text-text-main focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all outline-none"
            />
          </div>
          
          <div className="space-y-1">
            <label className="text-[9px] font-black text-text-muted uppercase tracking-wider">{t("packingManagement.serialPadding", "Serial Padding")}</label>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.serialPadding}
              onChange={e => setSettings(p => ({ ...p, serialPadding: e.target.value }))}
              className="w-full h-9 bg-bg-dark border border-border rounded-lg px-3 font-mono text-sm text-text-main focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all outline-none"
            />
          </div>
          
          <div className="space-y-1">
            <label className="text-[9px] font-black text-text-muted uppercase tracking-wider">{t("packingManagement.nextSerial", "Next Serial")}</label>
            <input
              type="number"
              min={1}
              value={settings.nextSerial}
              onChange={e => setSettings(p => ({ ...p, nextSerial: e.target.value }))}
              className="w-full h-9 bg-bg-dark border border-border rounded-lg px-3 font-mono text-sm text-text-main focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all outline-none"
            />
          </div>
          
          <div className="space-y-1">
            <label className="text-[9px] font-black text-text-muted uppercase tracking-wider">{t("packingManagement.defaultCapacity", "Default Capacity")}</label>
            <input
              type="number"
              min={1}
              max={500}
              value={settings.defaultCapacity}
              onChange={e => setSettings(p => ({ ...p, defaultCapacity: e.target.value }))}
              className="w-full h-9 bg-bg-dark border border-border rounded-lg px-3 font-mono text-sm text-text-main focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all outline-none"
            />
          </div>
          
          <div className="space-y-1">
            <label className="text-[9px] font-black text-text-muted uppercase tracking-wider">{t("packingManagement.labelPrefix", "Label Prefix")}</label>
            <input
              type="text"
              value={settings.labelPrefix}
              onChange={e => setSettings(p => ({ ...p, labelPrefix: e.target.value.toUpperCase() }))}
              className="w-full h-9 bg-bg-dark border border-border rounded-lg px-3 font-mono text-sm text-text-main focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all outline-none"
            />
          </div>
        </div>
        
        <div className="px-5 py-3 bg-bg-dark/40 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 cursor-pointer group" onClick={() => setSettings(p => ({ ...p, autoCreateNextBox: !p.autoCreateNextBox }))}>
              <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${settings.autoCreateNextBox ? 'bg-primary' : 'bg-border'}`}>
                <div className={`w-3 h-3 rounded-full bg-white transition-transform ${settings.autoCreateNextBox ? 'translate-x-4' : ''}`} />
              </div>
              <span className="text-[10px] font-bold text-text-main group-hover:text-primary transition-colors">{t("packingManagement.autoCreateNextBox", "Auto-create next box")}</span>
            </div>
          </div>
          
          <button
            onClick={generateNextBox}
            disabled={generating}
            className="h-9 px-4 rounded-lg bg-accent text-on-strong font-black uppercase tracking-wider flex items-center gap-2 hover:brightness-110 shadow-lg shadow-accent/20 transition-all disabled:opacity-50 text-[10px]"
          >
            <PlusCircle size={14} /> {generating ? t("packingManagement.generating", "Generating...") : t("packingManagement.generateBox", "Generate Box")}
          </button>
        </div>
      </div>

      {/* Box Registry Table */}
      <div className="industrial-card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-bg-dark/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package size={14} className="text-primary" />
            <h2 className="text-[10px] font-black text-text-main uppercase tracking-wider">{t("packingManagement.boxRegistry", "Box Registry")}</h2>
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-bg-dark border border-border rounded-lg px-3 py-1.5 text-[9px] font-black text-text-main uppercase tracking-wider focus:outline-none focus:border-primary"
          >
            <option value="ALL">{t("packingManagement.allBoxes", "All Boxes")}</option>
            <option value="OPEN">{t("packingManagement.openOnly", "Open Only")}</option>
            <option value="CLOSED">{t("packingManagement.closedOnly", "Closed Only")}</option>
          </select>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-bg-dark/60 text-[9px] font-black text-text-muted uppercase tracking-wider border-b border-border">
              <tr>
                <th className="px-4 py-3">{t("packingManagement.serial", "Serial")}</th>
                <th className="px-4 py-3">{t("packingManagement.boxId", "Box ID")}</th>
                <th className="px-4 py-3">{t("packingManagement.capacity", "Capacity")}</th>
                <th className="px-4 py-3">{t("packingManagement.filled", "Filled")}</th>
                <th className="px-4 py-3">{t("packingManagement.status", "Status")}</th>
                <th className="px-4 py-3">{t("packingManagement.label", "Label")}</th>
                <th className="px-4 py-3">{t("packingManagement.created", "Created")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {boxes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-text-muted">
                    <Package size={32} className="mx-auto opacity-20 mb-3" />
                    <p className="text-xs font-medium">{t("packingManagement.noBoxesFound", "No boxes found")}</p>
                    <p className="text-[10px] mt-1 opacity-60">{t("packingManagement.generateFirstBox", "Generate your first box using the button above")}</p>
                  </td>
                </tr>
              ) : boxes.map((box) => (
                <tr key={box.id} className="hover:bg-primary/5 transition-colors group">
                  <td className="px-4 py-3 font-mono font-black text-text-muted text-xs">{box.serialNo}</td>
                  <td className="px-4 py-3">
                    <span className="font-black text-primary font-mono text-sm">{box.boxNumber}</span>
                  </td>
                  <td className="px-4 py-3 font-bold text-text-main text-xs">{box.capacity}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${(box.packedCount / box.capacity) * 100}%` }} />
                      </div>
                      <span className="font-mono font-bold text-xs">{box.packedCount}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-black uppercase border ${
                      box.status?.toUpperCase() === 'CLOSED' 
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                        : 'bg-primary/10 border-primary/20 text-primary'
                    }`}>
                      {box.status || "OPEN"}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-text-muted text-xs">{box.labelCode || "—"}</td>
                  <td className="px-4 py-3 text-text-muted font-mono text-xs whitespace-nowrap">{formatDateTime(box.createdAt)}</td>
                  <td className="px-4 py-3">
                    <button className="p-1.5 text-text-muted hover:text-primary transition-colors">
                      <ArrowRightCircle size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PackingManagement;
