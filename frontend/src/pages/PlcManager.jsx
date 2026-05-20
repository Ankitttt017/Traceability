import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Pencil } from "lucide-react";
import { plcConfigApi } from "../api/services";

const empty = () => ({
  endpointName: "",
  plcIp: "",
  plcPort: "502",
  plcProtocol: "MODBUS_TCP",
  plcName: "",
  description: "",
});

const emptyQuick = () => ({
  plcIp: "",
  plcPort: "502",
  plcProtocol: "MODBUS_TCP",
});

export default function PlcManager() {
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty());
  const [quickEditId, setQuickEditId] = useState(null);
  const [quickForm, setQuickForm] = useState(emptyQuick());

  const load = async () => {
    setLoading(true);
    try {
      const data = await plcConfigApi.listEndpoints();
      setEndpoints(data || []);
    } catch (_err) {
      toast.error("Failed to load PLC endpoints");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startCreate = () => {
    setForm(empty());
    setEditing(null);
  };

  const startEdit = (ep) => {
    setEditing(ep.id);
    setForm({
      endpointName: ep.endpointName || "",
      plcIp: ep.plcIp || "",
      plcPort: String(ep.plcPort ?? "502"),
      plcProtocol: ep.plcProtocol || "MODBUS_TCP",
      plcName: ep.plcName || "",
      description: ep.description || "",
    });
  };

  const startQuickEdit = (ep) => {
    setQuickEditId(ep.id);
    setQuickForm({
      plcIp: ep.plcIp || "",
      plcPort: String(ep.plcPort ?? "502"),
      plcProtocol: ep.plcProtocol || "MODBUS_TCP",
    });
  };

  const cancelQuickEdit = () => {
    setQuickEditId(null);
    setQuickForm(emptyQuick());
  };

  const saveQuickEdit = async (ep) => {
    try {
      if (!quickForm.plcIp?.trim()) {
        toast.error("PLC IP is required");
        return;
      }
      const port = Number(quickForm.plcPort);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        toast.error("Port must be 1-65535");
        return;
      }

      await plcConfigApi.updateEndpoint(ep.id, {
        plcIp: quickForm.plcIp.trim(),
        plcPort: String(port),
        plcProtocol: quickForm.plcProtocol,
      });

      toast.success("IP/Port updated and synced");
      cancelQuickEdit();
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Quick update failed");
    }
  };

  const save = async () => {
    try {
      if (!form.endpointName?.trim() || !form.plcIp?.trim()) {
        toast.error("Name and IP required");
        return;
      }
      if (editing) {
        await plcConfigApi.updateEndpoint(editing, { ...form, plcIp: form.plcIp.trim() });
        toast.success("Updated endpoint");
      } else {
        await plcConfigApi.createEndpoint({ ...form, plcIp: form.plcIp.trim() });
        toast.success("Created endpoint");
      }
      await load();
      setEditing(null);
      setForm(empty());
    } catch (err) {
      toast.error(err.response?.data?.error || "Save failed");
    }
  };

  const remove = async (id) => {
    try {
      await plcConfigApi.deleteEndpoint(id);
      toast.success("Deleted endpoint");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || "Delete failed");
    }
  };

  const testConn = async (id) => {
    try {
      const { data } = await plcConfigApi.testEndpoint(id);
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.error || "Test failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="db-header-card">
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <h1 className="db-header-title">PLC Manager</h1>
            <p className="db-header-subtitle">Centralized PLC endpoints</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="db-secondary-btn">Refresh</button>
            <button onClick={startCreate} className="db-action-btn">New Endpoint</button>
          </div>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-xs font-bold">Endpoints</h2>
          <span className="text-[11px] text-text-muted">{endpoints.length}</span>
        </div>

        <div className="p-4">
          {loading ? (
            <div>Loading...</div>
          ) : (
            <div className="space-y-3">
              {endpoints.map((ep) => (
                <div key={ep.id} className="p-3 border border-border rounded-lg space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold">{ep.endpointName}</div>
                      <div className="text-xs font-mono">
                        {ep.plcIp}:{ep.plcPort} - {ep.plcProtocol}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      <button
                        onClick={() => startQuickEdit(ep)}
                        className="db-action-btn inline-flex items-center gap-1"
                        title="Edit IP/Port"
                      >
                        <Pencil size={14} />
                        Edit IP/Port
                      </button>
                      <button onClick={() => startEdit(ep)} className="db-secondary-btn">Edit Full</button>
                      <button onClick={() => testConn(ep.id)} className="db-secondary-btn">Test</button>
                      <button onClick={() => remove(ep.id)} className="db-danger-btn">Delete</button>
                    </div>
                  </div>

                  {quickEditId === ep.id && (
                    <div className="p-3 border border-border rounded-xl bg-bg-dark">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <input
                          placeholder="PLC IP"
                          value={quickForm.plcIp}
                          onChange={(e) => setQuickForm((prev) => ({ ...prev, plcIp: e.target.value }))}
                          className="px-3 py-2 bg-bg-card border border-border rounded-xl font-mono"
                        />
                        <input
                          placeholder="PLC Port"
                          value={quickForm.plcPort}
                          onChange={(e) => setQuickForm((prev) => ({ ...prev, plcPort: e.target.value }))}
                          className="px-3 py-2 bg-bg-card border border-border rounded-xl font-mono"
                        />
                        <select
                          value={quickForm.plcProtocol}
                          onChange={(e) => setQuickForm((prev) => ({ ...prev, plcProtocol: e.target.value }))}
                          className="px-3 py-2 bg-bg-card border border-border rounded-xl"
                        >
                          <option value="MODBUS_TCP">MODBUS_TCP</option>
                          <option value="SLMP">SLMP</option>
                          <option value="TCP_TEXT">TCP_TEXT</option>
                        </select>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => saveQuickEdit(ep)} className="db-action-btn">Update Communication</button>
                        <button onClick={cancelQuickEdit} className="db-secondary-btn">Cancel</button>
                      </div>
                      <p className="text-[11px] text-text-muted mt-2">
                        This updates linked machine/range communication values also.
                      </p>
                    </div>
                  )}
                </div>
              ))}

              <div className="p-3 border border-border rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    placeholder="Endpoint Name"
                    value={form.endpointName}
                    onChange={(e) => setForm((prev) => ({ ...prev, endpointName: e.target.value }))}
                    className="px-3 py-2 bg-bg-dark border border-border rounded-xl"
                  />
                  <input
                    placeholder="PLC IP"
                    value={form.plcIp}
                    onChange={(e) => setForm((prev) => ({ ...prev, plcIp: e.target.value }))}
                    className="px-3 py-2 bg-bg-dark border border-border rounded-xl font-mono"
                  />
                  <input
                    placeholder="PLC Port"
                    value={form.plcPort}
                    onChange={(e) => setForm((prev) => ({ ...prev, plcPort: e.target.value }))}
                    className="px-3 py-2 bg-bg-dark border border-border rounded-xl font-mono"
                  />
                  <select
                    value={form.plcProtocol}
                    onChange={(e) => setForm((prev) => ({ ...prev, plcProtocol: e.target.value }))}
                    className="px-3 py-2 bg-bg-dark border border-border rounded-xl"
                  >
                    <option value="MODBUS_TCP">MODBUS_TCP</option>
                    <option value="SLMP">SLMP</option>
                    <option value="TCP_TEXT">TCP_TEXT</option>
                  </select>
                  <input
                    placeholder="PLC Name (optional)"
                    value={form.plcName}
                    onChange={(e) => setForm((prev) => ({ ...prev, plcName: e.target.value }))}
                    className="px-3 py-2 bg-bg-dark border border-border rounded-xl"
                  />
                  <input
                    placeholder="Description (optional)"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    className="px-3 py-2 bg-bg-dark border border-border rounded-xl"
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={save} className="db-action-btn">{editing ? "Save Endpoint" : "Create Endpoint"}</button>
                  <button onClick={() => { setEditing(null); setForm(empty()); }} className="db-secondary-btn">Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
