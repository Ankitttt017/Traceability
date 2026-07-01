import { useEffect, useMemo, useState } from "react";
import { Boxes, Database, Edit, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import { organizationApi } from "../api/services";
import PlantLineSelector from "../components/PlantLineSelector";

const emptyForm = { plantId: "", lineId: "", lineName: "", partName: "", dieName: "", dieCastingMachine: "", status: "ACTIVE" };
const C = { card: "#fff", muted: "#f1f5f9", border: "#e2e8f0", text: "#0f172a", sec: "#475569", hint: "#94a3b8", blue: "#185FA5", blueLt: "#dbeafe", green: "#15803d", greenLt: "#dcfce7", red: "#dc2626", redLt: "#fee2e2" };
const inputStyle = { width: "100%", height: 36, boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 6, background: C.card, padding: "0 10px", fontSize: 12, fontWeight: 600, color: C.text, outline: "none" };
const labelStyle = { margin: "0 0 5px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: C.hint };

const norm = (value) => String(value || "").trim().toUpperCase();

function Label({ children }) {
  return <p style={labelStyle}>{children}</p>;
}

function StatusBadge({ status }) {
  const active = status !== "INACTIVE";
  return <span style={{ display: "inline-flex", padding: "3px 8px", borderRadius: 999, fontSize: 9, fontWeight: 800, color: active ? C.green : C.sec, background: active ? C.greenLt : C.muted, border: `1px solid ${active ? "#86efac" : C.border}` }}>{active ? "Active" : "Inactive"}</span>;
}

function IconBtn({ icon: Icon, title, onClick, color, bg }) {
  return <button type="button" title={title} onClick={onClick} style={{ width: 30, height: 30, border: `1px solid ${C.border}`, borderRadius: 6, background: bg || "transparent", color: color || C.sec, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Icon size={13} /></button>;
}

export default function Parts() {
  const [parts, setParts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState({ plantId: "", lineId: "", lineName: "" });
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const partRows = await organizationApi.listParts();
      setParts(partRows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => toast.error("Failed to load part assignments")); }, []);

  const visibleParts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parts.filter((part) => {
      const plantOk = !filter.plantId || String(part.plantId || "") === String(filter.plantId);
      const lineOk = !filter.lineId || String(part.lineId || "") === String(filter.lineId);
      const statusOk = statusFilter === "ALL" || String(part.status || "ACTIVE") === statusFilter;
      const searchOk = !q || [part.partName, part.dieName, part.lineName, part.plantName, part.dieCastingMachine].some((v) => String(v || "").toLowerCase().includes(q));
      return plantOk && lineOk && statusOk && searchOk;
    });
  }, [parts, filter, statusFilter, search]);

  const stats = useMemo(() => ({
    total: parts.length,
    active: parts.filter((part) => part.status !== "INACTIVE").length,
    parts: new Set(parts.map((part) => norm(part.partName)).filter(Boolean)).size,
    dies: new Set(parts.map((part) => `${norm(part.partName)}-${norm(part.dieName)}`).filter((v) => v !== "-")).size,
  }), [parts]);

  const reset = () => { setEditingId(null); setForm(emptyForm); };
  const edit = (part) => {
    setEditingId(part.id);
    setForm({
      plantId: String(part.plantId || ""),
      lineId: String(part.lineId || ""),
      lineName: part.lineName || "",
      partName: part.partName || "",
      dieName: part.dieName || "",
      dieCastingMachine: part.dieCastingMachine || "",
      status: part.status || "ACTIVE",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, partName: norm(form.partName), dieName: norm(form.dieName), dieCastingMachine: norm(form.dieCastingMachine) };
      if (editingId) await organizationApi.updatePart(editingId, payload);
      else await organizationApi.createPart(payload);
      toast.success(editingId ? "Part assignment updated" : "Part assignment created");
      reset();
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (part) => {
    if (!window.confirm(`Delete ${part.partName}${part.dieName ? `-${part.dieName}` : ""}?`)) return;
    try {
      await organizationApi.deletePart(part.id);
      toast.success("Part assignment deleted");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Delete failed");
    }
  };

  return (
    <div className="space-y-5 rise-in" style={{ fontFamily: "var(--font-outfit)", paddingBottom: 64 }}>
      <div className="db-header-card">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box"><Boxes size={22} /></div>
            <div>
              <h1 className="db-header-title">Part Manager</h1>
              <p className="db-header-subtitle">Assign active parts and dies line-wise for reports, QR rules, and PLC shot stats</p>
            </div>
          </div>
          <button type="button" onClick={() => load().catch(() => toast.error("Refresh failed"))} className="db-secondary-btn"><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
        {[["Assignments", stats.total, C.text], ["Active", stats.active, C.green], ["Parts", stats.parts, C.blue], ["Part + Die", stats.dies, C.sec]].map(([label, value, color]) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: 10, padding: "12px 14px" }}>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: C.hint }}>{label}</p>
            <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 900, lineHeight: 1, color, fontFamily: "ui-monospace,monospace" }}>{value}</p>
          </div>
        ))}
      </div>

      <form onSubmit={submit} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: C.muted, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: "0.07em" }}>{editingId ? "Edit Part Assignment" : "Add Part Assignment"}</span>
          {editingId && <button type="button" onClick={reset} style={{ height: 30, display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, borderRadius: 6, background: C.card, color: C.sec, padding: "0 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}><X size={13} /> Cancel</button>}
        </div>
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, alignItems: "end" }}>
          <div style={{ gridColumn: "span 2" }}><PlantLineSelector value={form} onChange={(scope) => setForm((prev) => ({ ...prev, ...scope }))} includeAll compact className="grid grid-cols-1 gap-3 sm:grid-cols-2" inputClassName="h-9 w-full rounded-md border border-border bg-white px-3 text-xs font-semibold text-slate-800 outline-none" /></div>
          <label><Label>Part Name</Label><input required style={{ ...inputStyle, fontFamily: "ui-monospace,monospace" }} value={form.partName} onChange={(e) => setForm((p) => ({ ...p, partName: e.target.value.toUpperCase() }))} placeholder="OPK12" /></label>
          <label><Label>Die Name</Label><input style={{ ...inputStyle, fontFamily: "ui-monospace,monospace" }} value={form.dieName} onChange={(e) => setForm((p) => ({ ...p, dieName: e.target.value.toUpperCase() }))} placeholder="S16" /></label>
          <label><Label>Die Casting Machine</Label><input required style={{ ...inputStyle, fontFamily: "ui-monospace,monospace" }} value={form.dieCastingMachine} onChange={(e) => setForm((p) => ({ ...p, dieCastingMachine: e.target.value.toUpperCase() }))} placeholder="UBE 850T-02" /></label>
          <label><Label>Status</Label><select style={inputStyle} value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
          <button disabled={saving} style={{ height: 36, border: "none", borderRadius: 7, background: saving ? C.hint : C.text, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer" }}>{editingId ? <Save size={14} /> : <Plus size={14} />} {saving ? "Saving..." : editingId ? "Update" : "Create"}</button>
        </div>
      </form>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: C.card, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Database size={14} color={C.blue} /><span style={{ fontSize: 11, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: "0.07em" }}>Part Assignments</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,420px) 140px 220px", gap: 10, alignItems: "center" }}>
            <PlantLineSelector value={filter} onChange={setFilter} includeAll compact hideLabels className="grid grid-cols-2 gap-2" inputClassName="h-9 w-full rounded-md border border-border bg-white px-3 text-xs font-semibold text-slate-800 outline-none" />
            <select style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="ALL">All Status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
            <div style={{ position: "relative" }}><Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.hint }} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search part, die, die casting machine..." style={{ ...inputStyle, paddingLeft: 30 }} /></div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 980 }}>
            <thead><tr style={{ background: C.muted, borderBottom: `1px solid ${C.border}` }}>{["Part", "Die", "Plant", "Line", "Die Casting Machine", "Status", ""].map((h) => <th key={h} style={{ padding: "9px 14px", textAlign: h === "" ? "right" : "left", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: C.hint }}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} style={{ padding: 48, textAlign: "center", color: C.hint, fontWeight: 700 }}>Loading parts...</td></tr> :
                visibleParts.length === 0 ? <tr><td colSpan={7} style={{ padding: 48, textAlign: "center", color: C.hint, fontWeight: 700 }}>No part assignments found.</td></tr> :
                visibleParts.map((part, idx) => (
                  <tr key={part.id} style={{ borderBottom: `1px solid ${C.border}`, background: idx % 2 ? C.muted : C.card }}>
                    <td style={{ padding: "11px 14px", fontFamily: "ui-monospace,monospace", color: C.text, fontWeight: 900 }}>{part.partName}</td>
                    <td style={{ padding: "11px 14px", fontFamily: "ui-monospace,monospace", color: C.blue, fontWeight: 800 }}>{part.dieName || "-"}</td>
                    <td style={{ padding: "11px 14px", color: C.sec }}>{part.plantName || "-"}</td>
                    <td style={{ padding: "11px 14px", color: C.sec }}>{part.lineName || "-"}</td>
                    <td style={{ padding: "11px 14px", fontFamily: "ui-monospace,monospace", color: C.sec, fontWeight: 800 }}>{part.dieCastingMachine || "-"}</td>
                    <td style={{ padding: "11px 14px" }}><StatusBadge status={part.status} /></td>
                    <td style={{ padding: "11px 14px", textAlign: "right" }}><div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}><IconBtn icon={Edit} title="Edit" onClick={() => edit(part)} color={C.blue} bg={C.blueLt} /><IconBtn icon={Trash2} title="Delete" onClick={() => remove(part)} color={C.red} bg={C.redLt} /></div></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
