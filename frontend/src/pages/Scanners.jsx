import { useEffect, useState } from "react";
import { ScanLine, Plus, Save, Trash2, CheckCircle, AlertCircle } from "lucide-react";
import { scannerApi, machineApi } from "../api/services";

const emptyForm = {
  scannerName: "",
  scannerIp: "",
  scannerPort: "",
  mappedMachineId: "",
  isActive: true,
};

const Scanners = () => {
  const [scanners, setScanners] = useState([]);
  const [machines, setMachines] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    try {
      const [scannerData, machineData] = await Promise.all([scannerApi.list(), machineApi.list()]);
      setScanners(scannerData);
      setMachines(machineData.filter((machine) => machine.isActive !== false));
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Failed to load scanner data" });
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: "", message: "" });
    try {
      const payload = {
        ...form,
        scannerPort: form.scannerPort ? Number(form.scannerPort) : null,
        mappedMachineId: Number(form.mappedMachineId),
      };

      if (editingId) {
        await scannerApi.update(editingId, payload);
        setStatus({ type: "success", message: "Scanner updated" });
      } else {
        await scannerApi.create(payload);
        setStatus({ type: "success", message: "Scanner added" });
      }
      resetForm();
      await loadData();
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Failed to save scanner" });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (scanner) => {
    setEditingId(scanner.id);
    setForm({
      scannerName: scanner.scannerName,
      scannerIp: scanner.scannerIp,
      scannerPort: scanner.scannerPort || "",
      mappedMachineId: String(scanner.mappedMachineId || ""),
      isActive: Boolean(scanner.isActive),
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this scanner mapping?")) {
      return;
    }
    try {
      await scannerApi.remove(id);
      setStatus({ type: "success", message: "Scanner deleted" });
      await loadData();
    } catch (error) {
      setStatus({ type: "error", message: error.response?.data?.error || "Delete failed" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
          <ScanLine className="text-primary" size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Scanner IP Management</h1>
          <p className="text-text-muted text-sm">Map scanner TCP endpoints to machine stations dynamically.</p>
        </div>
      </div>

      {status.message && (
        <div
          className={`p-4 rounded-lg border flex items-center gap-2 ${
            status.type === "success"
              ? "bg-accent/10 border-accent/30 text-accent"
              : "bg-danger/10 border-danger/30 text-danger"
          }`}
        >
          {status.type === "success" ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{status.message}</span>
        </div>
      )}

      <div className="industrial-card p-6">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              Scanner Name <span className="text-primary">*</span>
            </label>
            <input
              value={form.scannerName}
              onChange={(e) => setForm({ ...form, scannerName: e.target.value })}
              required
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              Scanner IP <span className="text-primary">*</span>
            </label>
            <input
              value={form.scannerIp}
              onChange={(e) => setForm({ ...form, scannerIp: e.target.value })}
              required
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">Scanner Port</label>
            <input
              type="number"
              value={form.scannerPort}
              onChange={(e) => setForm({ ...form, scannerPort: e.target.value })}
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">
              Mapped Machine <span className="text-primary">*</span>
            </label>
            <select
              value={form.mappedMachineId}
              onChange={(e) => setForm({ ...form, mappedMachineId: e.target.value })}
              required
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
            >
              <option value="">Select machine</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.stationNo || machine.operationNo} - {machine.machineName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold uppercase text-text-muted">Status</label>
            <select
              value={form.isActive ? "ACTIVE" : "INACTIVE"}
              onChange={(e) => setForm({ ...form, isActive: e.target.value === "ACTIVE" })}
              className="w-full bg-bg-dark border border-border rounded-lg p-3 text-text-main focus:border-primary outline-none"
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>

          <div className="md:col-span-2 lg:col-span-1 flex items-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-3 border border-border rounded-lg text-text-muted hover:bg-bg-dark"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-3 bg-primary hover:brightness-110 rounded-lg text-bg-dark font-bold flex items-center gap-2 disabled:opacity-60"
            >
              {editingId ? <Save size={16} /> : <Plus size={16} />}
              {editingId ? "Update" : "Add Scanner"}
            </button>
          </div>
        </form>
      </div>

      <div className="industrial-card overflow-hidden">
        <div className="px-6 py-4 bg-bg-dark/50 border-b border-border">
          <h2 className="font-bold text-white">Configured Scanners</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-dark/40 border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Name</th>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">IP:Port</th>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Machine</th>
                <th className="px-6 py-3 text-left text-xs font-bold uppercase text-text-muted">Status</th>
                <th className="px-6 py-3 text-right text-xs font-bold uppercase text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {scanners.map((scanner) => (
                <tr key={scanner.id} className="hover:bg-bg-dark/30">
                  <td className="px-6 py-4 text-text-main">{scanner.scannerName}</td>
                  <td className="px-6 py-4 font-mono text-primary">
                    {scanner.scannerIp}
                    {scanner.scannerPort ? `:${scanner.scannerPort}` : ""}
                  </td>
                  <td className="px-6 py-4 text-text-main">
                    {scanner.mappedMachine
                      ? `${scanner.mappedMachine.stationNo} - ${scanner.mappedMachine.machineName}`
                      : `Machine #${scanner.mappedMachineId}`}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-bold ${
                        scanner.isActive
                          ? "bg-accent/10 text-accent border border-accent/20"
                          : "bg-bg-dark text-text-muted border border-border"
                      }`}
                    >
                      {scanner.isActive ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        onClick={() => handleEdit(scanner)}
                        className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(scanner.id)}
                        className="px-3 py-1.5 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 inline-flex items-center gap-1"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {scanners.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-6 py-10 text-center text-text-muted">
                    No scanner mappings configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Scanners;
