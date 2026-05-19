import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { plcConfigApi } from "../api/services";

const empty = () => ({ endpointName: "", plcIp: "", plcPort: "502", plcProtocol: "MODBUS_TCP", plcName: "", description: "" });

export default function PlcManager() {
  const [endpoints, setEndpoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty());

  const load = async () => {
    setLoading(true);
    try {
      const data = await plcConfigApi.listEndpoints();
      setEndpoints(data || []);
    } catch (err) {
      toast.error("Failed to load PLC endpoints");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const startCreate = () => { setForm(empty()); setEditing(null); };
  const startEdit = (ep) => { setEditing(ep.id); setForm({ endpointName: ep.endpointName, plcIp: ep.plcIp, plcPort: String(ep.plcPort), plcProtocol: ep.plcProtocol, plcName: ep.plcName, description: ep.description || "" }); };

  const save = async () => {
    try {
      if (!form.endpointName || !form.plcIp) {
        toast.error("Name and IP required");
        return;
      }
      if (editing) {
        await plcConfigApi.updateEndpoint(editing, { ...form });
        toast.success("Updated endpoint");
      } else {
        await plcConfigApi.createEndpoint({ ...form });
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
              {endpoints.map(ep => (
                <div key={ep.id} className="p-3 border border-border rounded-lg flex items-center justify-between">
                  <div>
                    <div className="font-bold">{ep.endpointName}</div>
                    <div className="text-xs font-mono">{ep.plcIp}:{ep.plcPort} · {ep.plcProtocol}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(ep)} className="db-secondary-btn">Edit</button>
                    <button onClick={() => testConn(ep.id)} className="db-secondary-btn">Test</button>
                    <button onClick={() => remove(ep.id)} className="db-danger-btn">Delete</button>
                  </div>
                </div>
              ))}

              <div className="p-3 border border-border rounded-lg">
                <div className="grid grid-cols-3 gap-3">
                  <input placeholder="Name" value={form.endpointName} onChange={e => setForm(prev => ({ ...prev, endpointName: e.target.value }))} className="px-3 py-2 bg-bg-dark border border-border rounded-xl" />
                  <input placeholder="IP" value={form.plcIp} onChange={e => setForm(prev => ({ ...prev, plcIp: e.target.value }))} className="px-3 py-2 bg-bg-dark border border-border rounded-xl font-mono" />
                  <input placeholder="Port" value={form.plcPort} onChange={e => setForm(prev => ({ ...prev, plcPort: e.target.value }))} className="px-3 py-2 bg-bg-dark border border-border rounded-xl font-mono" />
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={save} className="db-action-btn">{editing ? "Save" : "Create"}</button>
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
