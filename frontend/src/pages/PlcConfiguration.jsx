// PlcConfiguration.jsx — Clean PLC Register Management
import { useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, Plus, Save, Trash2, RefreshCw, Download, AlertTriangle, Info } from "lucide-react";
import toast from "react-hot-toast";
import ConfirmModal from "../components/ConfirmModal";
import { plcConfigApi } from "../api/services";

const PROTO_OPTIONS = [
  { value: "MODBUS_TCP", label: "Modbus TCP" },
  { value: "TCP_TEXT", label: "Generic TCP Text" },
  { value: "SLMP", label: "SLMP (Mitsubishi)" },
];

const PlcConfiguration = () => {
  const [ranges, setRanges] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    plcName: "", plcIp: "", plcPort: "502", plcProtocol: "MODBUS_TCP", rangeInput: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await plcConfigApi.listRanges();
      setRanges(data || []);
    } catch {
      toast.error("Failed to load PLC ranges");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const updateField = (key, value) => {
    if (key === "plcProtocol") {
      const protocol = String(value || "").toUpperCase();
      setFormData(prev => {
        const next = { ...prev, plcProtocol: protocol };
        if (!String(prev.plcPort || "").trim()) {
          if (protocol === "MODBUS_TCP") next.plcPort = "502";
          else if (protocol === "SLMP") next.plcPort = "5000";
        }
        return next;
      });
      return;
    }
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Basic validation (you can enhance)
      if (!formData.plcIp || !formData.rangeInput) {
        toast.error("IP and Range are required");
        return;
      }
      await plcConfigApi.createRange({ ...formData, rangeName: `Block_${formData.rangeInput}` });
      toast.success("Register block added successfully");
      setShowAddModal(false);
      setFormData({ plcName: "", plcIp: "", plcPort: "502", plcProtocol: "MODBUS_TCP", rangeInput: "" });
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await plcConfigApi.deleteRange(deleteId);
      toast.success("Block deleted");
      await loadData();
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="space-y-6 rise-in">
      {/* Header */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <Cpu size={22} />
            </div>
            <div>
              <h1 className="db-header-title">PLC Configuration</h1>
              <p className="db-header-subtitle">Manage register blocks and PLC endpoints</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={loadData} className="db-secondary-btn">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={() => setShowAddModal(true)} className="db-action-btn">
              <Plus size={14} /> Add Register Block
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex justify-between bg-bg-dark/30 items-center">
          <h2 className="text-xs font-bold text-text-main uppercase tracking-wider">Registered Blocks</h2>
          <span className="text-[11px] text-text-muted bg-bg-dark px-3 py-1 rounded-lg border border-border">{ranges.length} blocks</span>
        </div>

        {loading ? (
          <div className="py-20 text-center text-text-muted">Loading...</div>
        ) : ranges.length === 0 ? (
          <div className="py-20 text-center text-text-muted">No register blocks yet. Click "Add Register Block".</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-dark/50 text-[10px] font-semibold uppercase tracking-widest text-text-muted border-b border-border">
                <tr>
                  <th className="px-5 py-3 text-left">PLC Name</th>
                  <th className="px-5 py-3 text-left">Endpoint</th>
                  <th className="px-5 py-3 text-left">Protocol</th>
                  <th className="px-5 py-3 text-left">Range</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {ranges.map(r => (
                  <tr key={r.id} className="hover:bg-bg-dark/20 transition-colors group">
                    <td className="px-5 py-4 font-bold text-text-main">{r.plcName || "—"}</td>
                    <td className="px-5 py-4 font-mono text-primary flex flex-col gap-0.5 text-xs"><span>{r.plcIp}</span><span className="text-text-muted">Port {r.plcPort}</span></td>
                    <td className="px-5 py-4">
                      <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20 rounded-md">{r.plcProtocol}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="px-3 py-1 text-xs font-mono font-semibold bg-bg-dark border border-border rounded-lg text-text-muted">R{r.rangeStart}–R{r.rangeEnd}</span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button onClick={() => setDeleteId(r.id)} className="p-2 text-text-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-all" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-bg-dark/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card border border-border/60 rounded-2xl max-w-lg w-full overflow-hidden rise-in shadow-2xl">
            <div className="px-6 py-5 border-b border-border flex justify-between items-center bg-bg-dark/30">
              <h3 className="font-bold text-text-main">Add New Register Block</h3>
              <button onClick={() => setShowAddModal(false)} className="p-2 text-text-muted hover:text-text-main hover:bg-bg-dark rounded-xl transition-all">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-text-muted mb-1.5">PLC Friendly Name</label>
                <input value={formData.plcName} onChange={e => updateField("plcName", e.target.value)}
                  placeholder="OP-010 Main PLC" className="w-full bg-bg-dark border border-border rounded-2xl px-4 py-3 text-sm focus:border-primary outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-muted mb-1.5">IP Address</label>
                  <input value={formData.plcIp} onChange={e => updateField("plcIp", e.target.value)}
                    placeholder="192.168.1.100" className="w-full bg-bg-dark border border-border rounded-2xl px-4 py-3 text-sm font-mono focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted mb-1.5">Port</label>
                  <input type="number" value={formData.plcPort} onChange={e => updateField("plcPort", e.target.value)}
                    className="w-full bg-bg-dark border border-border rounded-2xl px-4 py-3 text-sm font-mono focus:border-primary outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-muted mb-1.5">Protocol</label>
                <select value={formData.plcProtocol} onChange={e => updateField("plcProtocol", e.target.value)}
                  className="w-full bg-bg-dark border border-border rounded-2xl px-4 py-3 text-sm focus:border-primary outline-none">
                  {PROTO_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-muted mb-1.5">Range (start-size)</label>
                <input value={formData.rangeInput} onChange={e => updateField("rangeInput", e.target.value)}
                  placeholder="100-12" className="w-full bg-bg-dark border border-border rounded-2xl px-4 py-3 text-sm font-mono focus:border-primary outline-none" />
                <p className="text-xs text-text-muted mt-1">Example: 100-12 means R100 to R111 (min 6 registers recommended)</p>
                <p className="text-xs text-text-muted mt-1">For SLMP, these are word addresses (e.g. D100–D111 with device selected in machine mapping).</p>
              </div>

              <div className="flex gap-3 pt-4 border-t border-border mt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm text-text-muted hover:text-text-main transition-colors font-semibold">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-6 py-2 bg-primary text-on-strong font-bold rounded-xl text-sm hover:brightness-110 transition-all ml-auto disabled:opacity-50">
                  {saving ? "Saving..." : "Add Block"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal isOpen={!!deleteId} onConfirm={handleDelete} onCancel={() => setDeleteId(null)} title="Delete block?" message="This action cannot be undone." />
    </div>
  );
};

export default PlcConfiguration;
