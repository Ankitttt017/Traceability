import { useEffect, useMemo, useState } from "react";
import { Building2, Database, Edit, MapPin, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";
import { organizationApi } from "../api/services";

const emptyForm = { plantName: "", plantCode: "", location: "", status: "ACTIVE" };

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

export default function Plants() {
  const [plants, setPlants] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const rows = await organizationApi.listPlants();
      setPlants(rows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => toast.error("Failed to load plants")); }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return plants;
    return plants.filter((plant) => [plant.plantName, plant.plantCode, plant.location].some((v) => String(v || "").toLowerCase().includes(needle)));
  }, [plants, search]);

  const stats = useMemo(() => ({
    total: plants.length,
    active: plants.filter((plant) => plant.status !== "INACTIVE").length,
    inactive: plants.filter((plant) => plant.status === "INACTIVE").length,
  }), [plants]);

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, plantName: form.plantName.trim(), plantCode: form.plantCode.trim().toUpperCase(), location: form.location.trim() };
      if (editingId) await organizationApi.updatePlant(editingId, payload);
      else await organizationApi.createPlant(payload);
      toast.success(editingId ? "Plant updated" : "Plant created");
      reset();
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (plant) => {
    if (!window.confirm(`Delete plant "${plant.plantName}"?`)) return;
    try {
      await organizationApi.deletePlant(plant.id);
      toast.success("Plant deleted");
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || "Delete failed");
    }
  };

  const edit = (plant) => {
    setEditingId(plant.id);
    setForm({
      plantName: plant.plantName || "",
      plantCode: plant.plantCode || "",
      location: plant.location || "",
      status: plant.status || "ACTIVE",
    });
  };

  return (
    <div className="space-y-5 rise-in" style={{ fontFamily: "var(--font-outfit)", paddingBottom: 64 }}>
      <div className="db-header-card">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box"><Building2 size={22} /></div>
            <div>
              <h1 className="db-header-title">Plant Manager</h1>
              <p className="db-header-subtitle">Plant masters for line-wise traceability isolation</p>
            </div>
          </div>
          <button type="button" onClick={() => load().catch(() => toast.error("Refresh failed"))} className="db-secondary-btn">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
        {[
          ["Total Plants", stats.total, C.text],
          ["Active", stats.active, C.green],
          ["Inactive", stats.inactive, C.sec],
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
            <span style={{ fontSize: 11, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: "0.07em" }}>{editingId ? "Edit Plant" : "Add Plant"}</span>
          </div>
          {editingId && <button type="button" onClick={reset} style={{ height: 30, display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, borderRadius: 6, background: C.card, color: C.sec, padding: "0 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}><X size={13} /> Cancel</button>}
        </div>
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, alignItems: "end" }}>
          <label><Label>Plant Name</Label><input required style={inputStyle} value={form.plantName} onChange={(e) => setForm((p) => ({ ...p, plantName: e.target.value }))} placeholder="Bawal Plant" /></label>
          <label><Label>Plant Code</Label><input style={{ ...inputStyle, fontFamily: "ui-monospace,monospace" }} value={form.plantCode} onChange={(e) => setForm((p) => ({ ...p, plantCode: e.target.value.toUpperCase() }))} placeholder="BAWAL" /></label>
          <label><Label>Location</Label><input style={inputStyle} value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} placeholder="City / shop location" /></label>
          <label><Label>Status</Label><select style={inputStyle} value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
          <button disabled={saving} style={{ height: 36, border: "none", borderRadius: 7, background: saving ? C.hint : C.text, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12, fontWeight: 800, cursor: saving ? "not-allowed" : "pointer" }}>
            {editingId ? <Save size={14} /> : <Plus size={14} />} {saving ? "Saving..." : editingId ? "Update Plant" : "Create Plant"}
          </button>
        </div>
      </form>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.hint }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search plant, code, location..." style={{ ...inputStyle, paddingLeft: 30 }} />
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", background: C.muted, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Database size={14} color={C.blue} />
            <span style={{ fontSize: 11, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: "0.07em" }}>Plants List</span>
          </div>
          <span style={{ fontSize: 11, color: C.hint, padding: "2px 8px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 5 }}>{filtered.length} records</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 760 }}>
            <thead>
              <tr style={{ background: C.muted, borderBottom: `1px solid ${C.border}` }}>
                {["Plant", "Code", "Location", "Status", ""].map((h) => (
                  <th key={h} style={{ padding: "9px 14px", textAlign: h === "" ? "right" : "left", fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: C.hint }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: 48, textAlign: "center", color: C.hint, fontWeight: 700 }}>Loading plants...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 48, textAlign: "center", color: C.hint, fontWeight: 700 }}>No plants found.</td></tr>
              ) : filtered.map((plant, idx) => (
                <tr key={plant.id} style={{ borderBottom: `1px solid ${C.border}`, background: idx % 2 ? C.muted : C.card }}>
                  <td style={{ padding: "11px 14px" }}>
                    <p style={{ margin: 0, color: C.text, fontWeight: 800 }}>{plant.plantName}</p>
                    <p style={{ margin: "2px 0 0", color: C.hint, fontSize: 10 }}>ID {plant.id}</p>
                  </td>
                  <td style={{ padding: "11px 14px", fontFamily: "ui-monospace,monospace", color: C.blue, fontWeight: 800 }}>{plant.plantCode || "-"}</td>
                  <td style={{ padding: "11px 14px", color: C.sec }}><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><MapPin size={12} />{plant.location || "-"}</span></td>
                  <td style={{ padding: "11px 14px" }}><StatusBadge status={plant.status} /></td>
                  <td style={{ padding: "11px 14px", textAlign: "right" }}>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                      <IconBtn icon={Edit} title="Edit plant" onClick={() => edit(plant)} color={C.blue} bg={C.blueLt} />
                      <IconBtn icon={Trash2} title="Delete plant" onClick={() => remove(plant)} color={C.red} bg={C.redLt} />
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
