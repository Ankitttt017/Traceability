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
  Activity
} from "lucide-react";
import { packingApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";

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

  return (
    <div className="space-y-6 rise-in">
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} simple />

      {/* Header Section */}
      {/* ── Header ── */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <Boxes size={22} />
            </div>
            <div>
              <h1 className="db-header-title">Packing Management</h1>
              <p className="db-header-subtitle">Configure automated distribution & container mapping protocols</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadData} disabled={loading} className="db-secondary-btn">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Sync
            </button>
            <button onClick={saveSettings} disabled={saving} className="db-action-btn">
              <Save size={14} /> Push Configuration
            </button>
          </div>
        </div>
      </div>

      {/* Stats Quick Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: "Active Pipeline", val: stats.total, icon: Database, color: "text-primary", bg: "bg-primary/5" },
          { label: "Pending Fulfillment", val: stats.open, icon: Activity, color: "text-primary", bg: "bg-primary/5" },
          { label: "Validated Units", val: stats.closed, icon: PlusCircle, color: "text-emerald-400", bg: "bg-emerald-400/5" }
        ].map((s, i) => (
          <div key={i} className={`industrial-card p-6 flex items-center justify-between ${s.bg}`}>
            <div>
              <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-1">{s.label}</p>
              <p className={`text-3xl font-black ${s.color} font-mono`}>{s.val}</p>
            </div>
            <s.icon className={`${s.color} opacity-40`} size={40} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
        {/* Settings Form */}
        <div className="xl:col-span-8 industrial-card p-0 overflow-hidden">
          <div className="px-6 py-5 border-b border-border bg-bg-dark/40 flex items-center gap-3">
             <Hash size={18} className="text-primary" />
             <h2 className="text-xs font-black text-text-main uppercase tracking-widest">Logic & Prefix Standards</h2>
          </div>
          <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { label: "Container Prefix", key: "boxPrefix", type: "text" },
              { label: "Identity Separator", key: "boxSeparator", type: "text" },
              { label: "Serial Padding", key: "serialPadding", type: "number" },
              { label: "Sequence Counter", key: "nextSerial", type: "number" },
              { label: "Unit Capacity", key: "defaultCapacity", type: "number" },
              { label: "Label Prefix", key: "labelPrefix", type: "text" }
            ].map(f => (
              <div key={f.key} className="space-y-1.5">
                <label className="text-[10px] font-black text-text-muted uppercase tracking-widest ml-1">{f.label}</label>
                <input
                  type={f.type}
                  value={settings[f.key]}
                  onChange={e => setSettings(p => ({ ...p, [f.key]: f.type === 'number' ? e.target.value : e.target.value.toUpperCase() }))}
                  className="w-full h-11 bg-bg-dark border border-border rounded-xl px-4 font-mono text-sm text-text-main focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all outline-none"
                />
              </div>
            ))}
          </div>
          <div className="px-8 py-5 bg-bg-dark/40 border-t border-border flex items-center gap-3">
             <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setSettings(p => ({ ...p, autoCreateNextBox: !p.autoCreateNextBox }))}>
                <div className={`w-10 h-6 rounded-full p-1 transition-colors ${settings.autoCreateNextBox ? 'bg-primary' : 'bg-border'}`}>
                   <div className={`w-4 h-4 rounded-full bg-bg-card transition-transform ${settings.autoCreateNextBox ? 'translate-x-4' : ''}`} />
                </div>
                <span className="text-xs font-bold text-text-main group-hover:text-primary transition-colors">Continuous sequence auto-generation protocol</span>
             </div>
          </div>
        </div>

        {/* Live Preview Card */}
        {/* <div className="xl:col-span-4 industrial-card p-6 space-y-6 border-t-4 border-t-primary">
          <div>
            <h2 className="text-xs font-black text-text-main uppercase tracking-widest mb-4 flex items-center gap-2">
               <QrCode size={16} className="text-primary" /> Generation Preview
            </h2>
            <div className="bg-bg-dark border border-border rounded-2xl p-6 mb-6 shadow-inner text-center">
               <p className="text-[10px] font-black text-text-muted uppercase tracking-widest mb-2">Next Logical Identity</p>
               <p className="text-2xl font-black text-primary font-mono tracking-tighter mb-4">{settings.preview || "UNCONFIGURED"}</p>
               <BarcodePreview value={settings.preview} />
            </div>
            <button
              onClick={generateNextBox}
              disabled={generating}
              className="w-full h-12 rounded-xl bg-accent text-on-strong font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:brightness-110 shadow-lg shadow-accent/20 transition-all disabled:opacity-50"
            >
              <PlusCircle size={18} /> {generating ? "Mapping..." : "Manual Pulse Logic"}
            </button>
            <p className="mt-4 text-[10px] text-text-muted font-bold italic text-center">Force sequence advance will burn current ID.</p>
          </div>
        </div> */}
      </div>

      {/* Box Registry Table */}
      <div className="industrial-card p-0 overflow-hidden">
        <div className="px-6 py-5 border-b border-border bg-bg-dark/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-primary" />
            <h2 className="text-xs font-black text-text-main uppercase tracking-widest">Identity Registry</h2>
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-bg-dark border border-border rounded-lg px-3 py-1.5 text-[10px] font-black text-text-main uppercase tracking-widest focus:outline-none focus:border-primary"
          >
            <option value="ALL">All Nodes</option>
            <option value="OPEN">Pending</option>
            <option value="CLOSED">Sealed</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-bg-dark/60 text-[9px] font-black text-text-muted uppercase tracking-widest border-b border-border">
              <tr>
                <th className="px-6 py-4">Serial</th>
                <th className="px-6 py-4">Box Identity</th>
                <th className="px-6 py-4">Capacity</th>
                <th className="px-6 py-4">Packed</th>
                <th className="px-6 py-4">Node Status</th>
                <th className="px-6 py-4">Mapping Target</th>
                <th className="px-6 py-4">Created At</th>
                <th className="px-6 py-4">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20 text-xs">
              {boxes.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-12 text-center text-text-muted italic opacity-30">Registry is empty. Initialize logic above.</td></tr>
              ) : boxes.map(r => (
                <tr key={r.id} className="hover:bg-primary/5 transition-colors group">
                  <td className="px-6 py-4 font-mono font-black text-text-muted">{r.serialNo}</td>
                  <td className="px-6 py-4">
                    <span className="font-black text-primary font-mono text-sm">{r.boxNumber}</span>
                  </td>
                  <td className="px-6 py-4 font-bold text-text-main">{r.capacity}</td>
                  <td className="px-6 py-4">
                     <div className="flex items-center gap-2">
                        <div className="w-16 h-1 bg-border rounded-full overflow-hidden">
                           <div className="h-full bg-primary" style={{ width: `${(r.packedCount/r.capacity)*100}%` }} />
                        </div>
                        <span className="font-mono font-bold">{r.packedCount}</span>
                     </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-[9px] font-black uppercase border ${r.status?.toUpperCase() === 'CLOSED' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-primary/10 border-primary/20 text-primary'}`}>
                      {r.status || "OPEN"}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-text-muted italic">{r.labelCode || "—"}</td>
                  <td className="px-6 py-4 text-text-muted font-mono whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td className="px-6 py-4">
                     <button className="p-2 text-text-muted hover:text-primary transition-colors"><ArrowRightCircle size={18} /></button>
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

