import { useEffect, useMemo, useState } from "react";
import { Database, Edit, GitBranch, Layers3, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import { organizationApi } from "../api/services";

const emptyForm = { plantId: "", lineName: "", lineCode: "", status: "ACTIVE" };

const C = {
  bg: "#f8fafc",
  card: "#ffffff",
  muted: "#f1f5f9",
  border: "#e2e8f0",
  text: "#0f172a",
  sec: "#475569",
  hint: "#94a3b8",
  blue: "#185FA5",
  blueLt: "#dbeafe",
  green: "#15803d",
  greenLt: "#dcfce7",
  red: "#dc2626",
  redLt: "#fee2e2",
};

const inputStyle = {
  width: "100%",
  height: 36,
  boxSizing: "border-box",
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  background: C.card,
  padding: "0 10px",
  fontSize: 12,
  fontWeight: 600,
  color: C.text,
  outline: "none",
};

const Label = ({ children }) => (
  <p style={{ margin: "0 0 5px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: C.hint }}>
    {children}
  </p>
);

function StatusBadge({ status }) {
  const active = status !== "INACTIVE";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 8px", borderRadius: 999, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: active ? C.green : C.sec, background: active ? C.greenLt : C.muted, border: `1px solid ${active ? "#86efac" : C.border}` }}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function IconBtn({ icon: Icon, title, onClick, color = C.sec, bg = "transparent" }) {
  return (
    <button type="button" title={title} onClick={onClick} style={{ width: 30, height: 30, border: `1px solid ${C.border}`, borderRadius: 6, background: bg, color, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
      <Icon size={13} />
    </button>
  );
}

export default function Lines() {
  const [plants, setPlants] = useState([]);
  const [lines, setLines] = useState([]);
  const [plantFilter, setPlantFilter] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const activePlants = useMemo(() => plants.filter((plant) => plant.status !== "INACTIVE" && plant.isActive !== false), [plants]);
  const defaultPlantId = activePlants[0]?.id || plants[0]?.id || "";

  const load = async () => {
    setLoading(true);
    try {
      const [plantRows, lineRows] = await Promise.all([organizationApi.listPlants(), organizationApi.listLines()]);
      setPlants(plantRows || []);
      setLines(lineRows || []);
      setForm((prev) => ({ ...prev, plantId: prev.plantId || plantFilter || plantRows?.[0]?.id || "" }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => toast.error("Failed to load lines")); }, []);

  const visibleLines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return lines.filter((line) => {
      const plantOk = !plantFilter || String(line.plantId) === String(plantFilter);
      const searchOk = !needle || [line.lineName, line.lineCode, line.plantName].some((v) => String(v || "").toLowerCase().includes(needle));
      return plantOk && searchOk;
    });
  }, [lines, plantFilter, search]);

  const stats = useMemo(() => ({
    total: lines.length,
    active: lines.filter((line) => line.status !== "INACTIVE").length,
    plants: new Set(lines.map((line) => String(line.plantId || "")).filter(Boolean)).size,
  }), [lines]);

  const reset = () => {
    setEditingId(null);
    setForm({ ...emptyForm, plantId: plantFilter || defaultPlantId });
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        plantId: form.plantId || defaultPlantId,
        lineName: form.lineName.trim(),
        lineCode: form.lineCode.trim().toUpperCase(),
      };
      if (editingId) await organizationApi.updateLine(editingId, payload);
      else await organizationApi.createLine(payload);
      toast.success(editingId ? "Line updated" : "Line created");
      reset();
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (line) => {
    if (!window.confirm(`Delete line "${line.lineName}"?`)) return;
    try {
      await organizationApi.deleteLine(line.id);
      toast.success("Line deleted");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Delete failed");
    }
  };

  const edit = (line) => {
    setEditingId(line.id);
    setForm({
      plantId: String(line.plantId || ""),
      lineName: line.lineName || "",
      lineCode: line.lineCode || "",
      status: line.status || "ACTIVE",
    });
  };

  return (
    <div className="space-y-5 rise-in" style={{ fontFamily: "var(--font-outfit)", paddingBottom: 64 }}>
      <div className="db-header-card">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box"><GitBranch size={22} /></div>
            <div>
              <h1 className="db-header-title">Line Manager</h1>
              <p className="db-header-subtitle">Production lines mapped to plants for isolated settings</p>
            </div>
          </div>
          <button type="button" onClick={() => load().catch(() => toast.error("Refresh failed"))} className="db-secondary-btn">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
        {[
          ["Total Lines", stats.total, C.text],
          ["Active", stats.active, C.green],
          ["Plants Used", stats.plants, C.blue],
        ].map(([label, value, color]) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: 10, padding: "12px 14px" }}>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: C.hint }}>{label}</p>
            <p style={{ margin: "4px 0 0", fontSize: 24, fontWeight: 900, lineHeight: 1, color, fontFamily: "ui-monospace,monospace" }}>{value}</p>
          </div>
        ))}
      </div>

      <form onSubmit={submit} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: C.muted, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Plus size={14} color={C.blue} />
            <span style={{ fontSize: 11, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: "0.07em" }}>{editingId ? "Edit Line" : "Add Line"}</span>
          </div>
          {editingId && <button type="button" onClick={reset} style={{ height: 30, display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, borderRadius: 6, background: C.card, color: C.sec, padding: "0 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}><X size={13} /> Cancel</button>}
        </div>
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, alignItems: "end" }}>
          <label><Label>Plant</Label><select required style={inputStyle} value={form.plantId || defaultPlantId} onChange={(e) => setForm((p) => ({ ...p, plantId: e.target.value }))}><option value="">Select plant</option>{activePlants.map((plant) => <option key={plant.id} value={plant.id}>{plant.plantName}</option>)}</select></label>
          <label><Label>Line Name</Label><input required style={inputStyle} value={form.lineName} onChange={(e) => setForm((p) => ({ ...p, lineName: e.target.value }))} placeholder="OIL PAN K-12" /></label>
          <label><Label>Line Code</Label><input style={{ ...inputStyle, fontFamily: "ui-monospace,monospace" }} value={form.lineCode} onChange={(e) => setForm((p) => ({ ...p, lineCode: e.target.value.toUpperCase() }))} placeholder="OP-K12" /></label>
          <label><Label>Status</Label><select style={inputStyle} value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
          <button disabled={saving} style={{ height: 36, border: "none", borderRadius: 7, background: saving ? C.hint : C.text, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer" }}>
            {editingId ? <Save size={14} /> : <Plus size={14} />} {saving ? "Saving..." : editingId ? "Update Line" : "Create Line"}
          </button>
        </div>
      </form>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.hint }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search line, code, plant..." style={{ ...inputStyle, paddingLeft: 30 }} />
        </div>
        <select style={{ ...inputStyle, width: 190 }} value={plantFilter} onChange={(e) => { setPlantFilter(e.target.value); if (!editingId) setForm((p) => ({ ...p, plantId: e.target.value || defaultPlantId })); }}>
          <option value="">All Plants</option>
          {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.plantName}</option>)}
        </select>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: C.muted, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Database size={14} color={C.blue} />
            <span style={{ fontSize: 11, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: "0.07em" }}>Lines List</span>
          </div>
          <span style={{ fontSize: 11, color: C.hint, padding: "2px 8px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 5 }}>{visibleLines.length} records</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 820 }}>
            <thead>
              <tr style={{ background: C.muted, borderBottom: `1px solid ${C.border}` }}>
                {["Line", "Code", "Plant", "Status", ""].map((h) => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: h === "" ? "right" : "left", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: C.hint }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: 48, textAlign: "center", color: C.hint, fontWeight: 700 }}>Loading lines...</td></tr>
              ) : visibleLines.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 48, textAlign: "center", color: C.hint, fontWeight: 700 }}>No lines found.</td></tr>
              ) : visibleLines.map((line, idx) => (
                <tr key={line.id} style={{ borderBottom: `1px solid ${C.border}`, background: idx % 2 ? C.muted : C.card }}>
                  <td style={{ padding: "11px 14px" }}>
                    <p style={{ margin: 0, color: C.text, fontWeight: 800 }}>{line.lineName}</p>
                    <p style={{ margin: "2px 0 0", color: C.hint, fontSize: 10 }}>ID {line.id}</p>
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "ui-monospace,monospace", color: C.blue, fontWeight: 800 }}>{line.lineCode || "-"}</td>
                  <td style={{ padding: "11px 14px", color: C.sec }}><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Layers3 size={12} />{line.plantName || "-"}</span></td>
                  <td style={{ padding: "11px 14px" }}><StatusBadge status={line.status} /></td>
                  <td style={{ padding: "11px 14px", textAlign: "right" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                      <IconBtn icon={Edit} title="Edit line" onClick={() => edit(line)} color={C.blue} bg={C.blueLt} />
                      <IconBtn icon={Trash2} title="Delete line" onClick={() => remove(line)} color={C.red} bg={C.redLt} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
