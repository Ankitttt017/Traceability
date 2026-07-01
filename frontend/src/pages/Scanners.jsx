// Scanners.jsx — Scanner Device Management
// Professional design with compact stats and always-visible actions
import { useCallback, useEffect, useState } from "react";
import {
  ScanLine, Plus, Save, Trash2, Pencil, X,
  RefreshCw, Wifi, Network, ArrowRight, WifiOff, Info,
  Activity, Server, CheckCircle
} from "lucide-react";
import toast from "react-hot-toast";
import { scannerApi, machineApi, organizationApi, traceabilityApi } from "../api/services";
import { formatMachineLabel, sanitizeLineName } from "../utils/machineFields";
import ConfirmModal from "../components/ConfirmModal";
import PlantLineSelector from "../components/PlantLineSelector";

/* ─── constants ────────────────────────────────────────────── */
const EMPTY_FORM = {
  scannerName: "", scannerIp: "", scannerPort: "",
  scannerMode: "TCP_CLIENT",
  plcIp: "", plcPort: "502", plcProtocol: "MODBUS_TCP",
  plcUnitId: "1", plcDevice: "D", plcFrameMode: "AUTO",
  plcStartRegister: "", plcEndRegister: "", plcDataType: "ALPHANUM",
  plcTimeoutMs: "8000", plcReadRetryCount: "3", plcReadRetryDelayMs: "300",
  concatSeparator: "",
  mappedMachineId: "", isActive: true, isSimulation: false, scannerRole: "",
};

const SCANNER_MODES = [
  { value: "TCP_CLIENT", label: "TCP Client", hint: "Bridge connects to scanner endpoint and reads data" },
  { value: "USB_SERIAL", label: "USB / Serial", hint: "Scanner connected on station system serial/USB" },
  { value: "TCP_SERVER", label: "TCP Server", hint: "Bridge opens listener, scanner pushes data" },
  { value: "PLC_REGISTER", label: "PLC Data Register", hint: "Part ID is read from PLC register range" },
];

const PLC_PROTOCOLS = [
  { value: "MODBUS_TCP", label: "Modbus TCP" },
  { value: "SLMP", label: "SLMP" },
];

const PLC_DEVICES = ["D", "W", "R", "M", "ZR", "X", "Y"];

const PLC_DATA_TYPES = [
  { value: "ASCII", label: "ASCII (all printable chars)" },
  { value: "ALPHANUM", label: "Alphanumeric (A-Z,0-9,-_./:)" },
  { value: "HEX", label: "HEX (4-digit words)" },
  { value: "INT16", label: "INT16" },
  { value: "UINT16", label: "UINT16" },
  { value: "DEC", label: "DEC (decimal)" },
  { value: "BIT", label: "BIT (0/1)" },
  { value: "BOOL", label: "BOOL (true/false from bit)" },
  { value: "FLOAT32", label: "FLOAT32 (2 words)" },
  { value: "REAL32BIT", label: "REAL32BIT (2 words)" },
  { value: "INT32", label: "INT32" },
  { value: "UINT32", label: "UINT32" },
  { value: "STRING", label: "STRING" },
];

/* ─── component ────────────────────────────────────────────── */
const Scanners = () => {
  const [scanners, setScanners] = useState([]);
  const [machines, setMachines] = useState([]);
  const [organization, setOrganization] = useState({ plants: [], lines: [] });
  const [scope, setScope] = useState({ plantId: "", lineId: "" });
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [testingRead, setTestingRead] = useState(false);
  const [testReadResult, setTestReadResult] = useState(null);
  const [simulationQr, setSimulationQr] = useState("");
  const [simulationResult, setSimulationResult] = useState(null);
  const [validatingSimulation, setValidatingSimulation] = useState(false);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const [scannerData, machineData, org] = await Promise.all([
        scannerApi.list(),
        machineApi.list(),
        organizationApi.context().catch(() => ({ plants: [], lines: [] })),
      ]);
      setScanners(scannerData || []);
      setMachines((machineData || []).filter(m => m.status === "ACTIVE"));
      setOrganization({ plants: org?.plants || [], lines: org?.lines || [] });
    } catch {
      if (!quiet) toast.error("Failed to load scanner data");
    } finally { setRefreshing(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const scopedMachines = machines.filter((machine) => {
    const plantOk = !scope.plantId || String(machine.plantId || "") === String(scope.plantId);
    const lineOk = !scope.lineId || String(machine.lineId || "") === String(scope.lineId);
    return plantOk && lineOk;
  });
  const filteredScanners = scanners.filter((scanner) => {
    const machine = scanner.mappedMachine || {};
    const plantOk = !scope.plantId || String(machine.plantId || "") === String(scope.plantId);
    const lineOk = !scope.lineId || String(machine.lineId || "") === String(scope.lineId);
    const statusOk = statusFilter === "ACTIVE" ? scanner.isActive : statusFilter === "INACTIVE" ? !scanner.isActive : true;
    return plantOk && lineOk && statusOk;
  });

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setSimulationQr("");
    setSimulationResult(null);
  };

  const handleEdit = (scanner) => {
    if (scanner.mappedMachine) {
      setScope({
        plantId: String(scanner.mappedMachine.plantId || ""),
        lineId: String(scanner.mappedMachine.lineId || ""),
      });
    }
    setEditingId(scanner.id);
    setForm({
      scannerName: scanner.scannerName || "",
      scannerIp: scanner.scannerIp || "",
      scannerPort: scanner.scannerPort ? String(scanner.scannerPort) : "",
      scannerMode: scanner.scannerMode || "TCP_CLIENT",
      plcIp: scanner.plcIp || "",
      plcPort: scanner.plcPort ? String(scanner.plcPort) : "502",
      plcProtocol: scanner.plcProtocol || "MODBUS_TCP",
      plcUnitId: scanner.plcUnitId ? String(scanner.plcUnitId) : "1",
      plcDevice: scanner.plcDevice || "D",
      plcFrameMode: scanner.plcFrameMode || "AUTO",
      plcStartRegister: scanner.plcStartRegister !== null && scanner.plcStartRegister !== undefined ? String(scanner.plcStartRegister) : "",
      plcEndRegister: scanner.plcEndRegister !== null && scanner.plcEndRegister !== undefined ? String(scanner.plcEndRegister) : "",
      plcDataType: scanner.plcDataType || "ALPHANUM",
      plcTimeoutMs: scanner.plcTimeoutMs ? String(scanner.plcTimeoutMs) : "8000",
      plcReadRetryCount: scanner.plcReadRetryCount ? String(scanner.plcReadRetryCount) : "3",
      plcReadRetryDelayMs: scanner.plcReadRetryDelayMs ? String(scanner.plcReadRetryDelayMs) : "300",
      concatSeparator: scanner.concatSeparator || "",
      mappedMachineId: String(scanner.mappedMachineId || ""),
      scannerRole: String(scanner.scannerRole || ""),
      isActive: Boolean(scanner.isActive),
      isSimulation: Boolean(scanner.isSimulation),
    });
    setTestReadResult(null);
    setSimulationQr("");
    setSimulationResult(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        ...form,
        scannerIp: isPlcRegisterMode ? (form.plcIp || "") : form.scannerIp,
        scannerPort: isPlcRegisterMode ? null : (form.scannerPort ? Number(form.scannerPort) : null),
        plcPort: form.plcPort ? Number(form.plcPort) : null,
        plcUnitId: form.plcUnitId ? Number(form.plcUnitId) : null,
        plcStartRegister: form.plcStartRegister ? Number(form.plcStartRegister) : null,
        plcEndRegister: form.plcEndRegister ? Number(form.plcEndRegister) : null,
        plcTimeoutMs: form.plcTimeoutMs ? Number(form.plcTimeoutMs) : null,
        plcReadRetryCount: form.plcReadRetryCount ? Number(form.plcReadRetryCount) : null,
        plcReadRetryDelayMs: form.plcReadRetryDelayMs ? Number(form.plcReadRetryDelayMs) : null,
        mappedMachineId: form.mappedMachineId ? Number(form.mappedMachineId) : null,
        scannerRole: form.scannerRole || null,
      };
      let saved = null;
      if (editingId) saved = await scannerApi.update(editingId, payload);
      else saved = await scannerApi.create(payload);
      toast.success(editingId ? "Scanner updated" : "Scanner registered successfully");
      if (saved?.id) {
        setScanners((prev) => {
          const exists = prev.some((row) => Number(row.id) === Number(saved.id));
          if (exists) return prev.map((row) => (Number(row.id) === Number(saved.id) ? saved : row));
          return [...prev, saved];
        });
      }
      resetForm();
      await loadData(false);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save scanner");
    } finally { setLoading(false); }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await scannerApi.remove(deleteTarget.id);
      toast.success("Scanner removed");
      await loadData(true);
    } catch { toast.error("Failed to remove scanner"); }
    finally { setDeleteTarget(null); }
  };

  const handleTestConnection = async (scanner) => {
    try {
      const result = await scannerApi.testConnection(scanner.id);
      if (result?.reachable || result?.success) {
        toast.success(result.message || "Connection test successful");
      } else {
        toast.error(result?.message || result?.error || "Connection test failed");
      }
    } catch (err) {
      toast.error(err.response?.data?.error || "Connection test failed");
    }
  };

  const openAdd = () => {
    if (editingId) resetForm();
    setShowForm(true);
    setTestReadResult(null);
    setSimulationResult(null);
  };

  const isPlcRegisterMode = String(form.scannerMode || "").toUpperCase() === "PLC_REGISTER";

  const handleTestRead = async () => {
    setTestingRead(true);
    setTestReadResult(null);
    try {
      const payload = {
        ...form,
        scannerIp: isPlcRegisterMode ? (form.plcIp || "") : form.scannerIp,
        scannerPort: isPlcRegisterMode ? null : (form.scannerPort ? Number(form.scannerPort) : null),
        plcPort: form.plcPort ? Number(form.plcPort) : null,
        plcUnitId: form.plcUnitId ? Number(form.plcUnitId) : null,
        plcStartRegister: form.plcStartRegister ? Number(form.plcStartRegister) : null,
        plcEndRegister: form.plcEndRegister ? Number(form.plcEndRegister) : null,
        plcTimeoutMs: isPlcRegisterMode ? 20000 : (form.plcTimeoutMs ? Number(form.plcTimeoutMs) : null),
        plcReadRetryCount: form.plcReadRetryCount ? Number(form.plcReadRetryCount) : null,
        plcReadRetryDelayMs: form.plcReadRetryDelayMs ? Number(form.plcReadRetryDelayMs) : null,
        mappedMachineId: form.mappedMachineId ? Number(form.mappedMachineId) : null,
        scannerRole: form.scannerRole || null,
      };
      if (isPlcRegisterMode) {
        payload.plcFrameMode = "BINARY";
      }
      const result = await scannerApi.testRead(payload);
      setTestReadResult(result);
      if (result?.waitingForPartId || result?.success === false) {
        toast.error(result?.message || "Scanner/PLC is reachable but no part ID was read");
      } else {
        toast.success(result?.message || "Scanner read test completed");
      }
    } catch (err) {
      const error = err.response?.data?.error || err.message || "Failed to test scanner read";
      setTestReadResult({ error });
      toast.error(error);
    } finally {
      setTestingRead(false);
    }
  };

  const handleSimulationValidate = async () => {
    const qrCode = String(simulationQr || "").trim();
    if (!qrCode) {
      toast.error("Enter scan/manual QR first");
      return;
    }
    if (!form.mappedMachineId) {
      toast.error("Select mapped machine first");
      return;
    }
    setValidatingSimulation(true);
    setSimulationResult(null);
    try {
      const result = await traceabilityApi.verify({
        qrCode,
        machineId: Number(form.mappedMachineId),
        scannerIp: form.scannerIp || form.plcIp || "",
        simulation: true,
      });
      setSimulationResult(result);
      if (result?.decision === "ALLOW" || result?.status === "OK") {
        toast.success(result?.message || "Simulation scan validated");
      } else {
        toast.error(result?.message || result?.error || "Simulation scan blocked");
      }
    } catch (err) {
      const error = err.response?.data?.message || err.response?.data?.error || err.message || "Simulation validation failed";
      setSimulationResult({ error });
      toast.error(error);
    } finally {
      setValidatingSimulation(false);
    }
  };

  const inputCls = "w-full bg-bg-dark border border-border rounded-lg px-3 py-2 text-sm text-text-main outline-none focus:border-primary/60 transition-colors placeholder:text-text-muted/40";
  const selectCls = "w-full bg-bg-dark border border-border rounded-lg px-3 py-2 text-sm text-text-main outline-none focus:border-primary/60 transition-colors";

  const activeScanners = filteredScanners.filter(s => s.isActive);
  const connectedScanners = filteredScanners.filter(s => s.mappedMachineId).length;

  return (
    <div className="space-y-6 rise-in" style={{ fontFamily: "var(--font-outfit)" }}>
      {/* ── Header matching Station Control ── */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <ScanLine size={22} />
            </div>
            <div>
              <h1 className="db-header-title">Scanner Management</h1>
              <p className="db-header-subtitle">Register &amp; map barcode scanners to production nodes</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => loadData()} disabled={refreshing} className="db-action-btn">
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={showForm && !editingId ? resetForm : openAdd} className="db-action-btn">
              {showForm && !editingId ? <X size={14} /> : <Plus size={14} />}
              {showForm && !editingId ? "Cancel" : "Add Scanner"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Compact Stats Cards ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Total Scanners</p>
              <p className="text-2xl font-black text-primary font-mono">{filteredScanners.length}</p>
            </div>
            <Server size={28} className="text-primary/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Active</p>
              <p className="text-2xl font-black text-accent font-mono">{activeScanners.length}</p>
            </div>
            <Activity size={28} className="text-accent/30" />
          </div>
        </div>
        
        <div className="industrial-card p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black text-text-muted uppercase tracking-wider mb-1">Connected</p>
              <p className="text-2xl font-black text-primary font-mono">{connectedScanners}</p>
            </div>
            <CheckCircle size={28} className="text-primary/30" />
          </div>
        </div>
      </div>

      {/* ── Info banner if no machines ── */}
      {machines.length === 0 && (
        <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
          <Info size={16} className="text-primary mt-0.5 flex-shrink-0" />
          <p className="text-sm text-text-muted">
            No active machines found. <span className="font-semibold text-text-main">Add machines first</span> in the Machine Registry before mapping scanners.
          </p>
        </div>
      )}

      {/* ── Add / Edit Form (inline slide-in) ── */}
      {showForm && (
        <div className="industrial-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network size={14} className="text-primary" />
              <h2 className="text-[10px] font-black text-text-main uppercase tracking-wider">
                {editingId ? "Edit Scanner" : "Register New Scanner"}
              </h2>
            </div>
            <button onClick={resetForm} className="text-text-muted hover:text-text-main transition-colors">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5">
            <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-text-muted">
              <p className="font-semibold text-text-main mb-1">Recommended Setup Steps</p>
              <ol className="list-decimal ml-4 space-y-0.5">
                <li>Select scanner mode based on how data arrives.</li>
                <li>For `PLC Data Register`, configure IP/Port/Register range and click `Test Read`.</li>
                <li>Map to machine, then save. Existing validation/sequence logic remains same.</li>
              </ol>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <div>
                <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Scanner Name *</label>
                <input required value={form.scannerName} onChange={e => setForm({ ...form, scannerName: e.target.value })}
                  placeholder="e.g. OP10_Laser_01" className={inputCls} />
              </div>
              <div>
                <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">
                  Scanner Mode *
                </label>
                <select
                  value={form.scannerMode}
                  onChange={e => {
                    const next = e.target.value;
                    setForm((prev) => ({ ...prev, scannerMode: next }));
                    setTestReadResult(null);
                  }}
                  className={selectCls}
                >
                  {SCANNER_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>{mode.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-text-muted">{SCANNER_MODES.find((mode) => mode.value === form.scannerMode)?.hint}</p>
              </div>
              {!isPlcRegisterMode && (
                <>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">
                      System / Scanner IP *
                    </label>
                    <input required value={form.scannerIp} onChange={e => setForm({ ...form, scannerIp: e.target.value })}
                      placeholder="192.168.1.50" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">
                      {form.scannerMode === "USB_SERIAL" ? "Baud Rate" : "TCP Port"}
                      <span className="text-text-muted/50 normal-case tracking-normal font-normal ml-1">(optional)</span>
                    </label>
                    <input type="number" value={form.scannerPort} onChange={e => setForm({ ...form, scannerPort: e.target.value })}
                      placeholder={form.scannerMode === "USB_SERIAL" ? "9600" : "9001"} className={`${inputCls} font-mono`} />
                  </div>
                </>
              )}
              <div className="sm:col-span-2">
                <PlantLineSelector
                  value={scope}
                  onChange={(nextScope) => {
                    setScope(nextScope);
                    setForm((prev) => ({ ...prev, mappedMachineId: "" }));
                  }}
                  includeAll
                  compact
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                  inputClassName={selectCls}
                  labelClassName="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5"
                />
              </div>
              <div>
                <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Map to Machine *</label>
                <select required value={form.mappedMachineId} onChange={e => setForm({ ...form, mappedMachineId: e.target.value })}
                  className={selectCls}>
                  <option value="">— Select Machine —</option>
                  {scopedMachines.map(m => <option key={m.id} value={m.id}>{formatMachineLabel(m)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Scanner Role (Optional)</label>
                <select value={form.scannerRole} onChange={e => setForm({ ...form, scannerRole: e.target.value })} className={selectCls}>
                  <option value="">GENERAL</option>
                  <option value="START_QR">START_QR</option>
                  <option value="CUSTOMER_QR">CUSTOMER_QR</option>
                </select>
              </div>
            </div>

            {isPlcRegisterMode && (
              <div className="mb-5 rounded-lg border border-accent/30 bg-accent/5 p-4">
                <p className="text-[10px] font-black text-text-main uppercase tracking-wider mb-3">PLC Register Mode Configuration</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">PLC IP *</label>
                    <input value={form.plcIp} onChange={e => setForm({ ...form, plcIp: e.target.value })} placeholder="192.168.1.100" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">PLC Port *</label>
                    <input type="number" value={form.plcPort} onChange={e => setForm({ ...form, plcPort: e.target.value })} placeholder="502" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Protocol</label>
                    <select value={form.plcProtocol} onChange={e => setForm({ ...form, plcProtocol: e.target.value })} className={selectCls}>
                      {PLC_PROTOCOLS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Unit ID (Modbus)</label>
                    <input type="number" value={form.plcUnitId} onChange={e => setForm({ ...form, plcUnitId: e.target.value })} placeholder="1" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Start Register *</label>
                    <input type="number" value={form.plcStartRegister} onChange={e => setForm({ ...form, plcStartRegister: e.target.value })} placeholder="2060" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">End Register *</label>
                    <input type="number" value={form.plcEndRegister} onChange={e => setForm({ ...form, plcEndRegister: e.target.value })} placeholder="2068" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Device</label>
                    <select value={form.plcDevice} onChange={e => setForm({ ...form, plcDevice: e.target.value })} className={selectCls}>
                      {PLC_DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Frame Mode</label>
                    <select value={form.plcFrameMode} onChange={e => setForm({ ...form, plcFrameMode: e.target.value })} className={selectCls}>
                      <option value="AUTO">AUTO</option>
                      <option value="ASCII">ASCII</option>
                      <option value="BINARY">BINARY</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Data Type</label>
                    <select value={form.plcDataType} onChange={e => setForm({ ...form, plcDataType: e.target.value })} className={selectCls}>
                      {PLC_DATA_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Read Timeout (ms)</label>
                    <input type="number" value={form.plcTimeoutMs} onChange={e => setForm({ ...form, plcTimeoutMs: e.target.value })} placeholder="8000" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Retry Count</label>
                    <input type="number" value={form.plcReadRetryCount} onChange={e => setForm({ ...form, plcReadRetryCount: e.target.value })} placeholder="3" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Retry Delay (ms)</label>
                    <input type="number" value={form.plcReadRetryDelayMs} onChange={e => setForm({ ...form, plcReadRetryDelayMs: e.target.value })} placeholder="300" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">Concat Separator</label>
                    <input value={form.concatSeparator} onChange={e => setForm({ ...form, concatSeparator: e.target.value })} placeholder="Optional" className={inputCls} />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTestRead}
                    disabled={testingRead}
                    className="h-8 px-4 bg-accent text-on-strong font-bold rounded-lg text-[10px] uppercase tracking-wider flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-50"
                    title="Test PLC read and concatenate part ID from configured register range"
                  >
                    {testingRead ? "Reading..." : "Test Read Part ID"}
                  </button>
                  {testReadResult && (
                    <div className="text-xs">
                      {testReadResult.error ? (
                        <span className="text-danger font-semibold">{testReadResult.error}</span>
                      ) : (
                        <span className="text-accent font-semibold">
                          {testReadResult.waitingForPartId
                            ? `Live read OK (waiting part id). Current: ${testReadResult.partIdPreview || "0"}`
                            : `Preview: ${testReadResult.partIdPreview || "(empty)"}`}
                        </span>
                      )}
                      {testReadResult?.read?.registerRange && (
                        <div className="mt-1 text-[10px] text-text-muted font-mono">
                          {`Range: ${form.plcDevice || "D"}${testReadResult.read.registerRange.start}-${form.plcDevice || "D"}${testReadResult.read.registerRange.end} · Frame: ${testReadResult?.read?.decode?.frameMode || "BINARY"} · Timeout: ${testReadResult?.read?.decode?.timeoutMs || 20000}ms`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-6">
                {/* Active toggle */}
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div className="relative">
                    <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="sr-only peer" />
                    <div className="w-8 h-4 bg-border rounded-full peer peer-checked:bg-accent transition-colors"></div>
                    <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                  </div>
                  <span className="text-xs font-bold text-text-muted uppercase tracking-wider">Active Device</span>
                </label>

                {/* Simulation toggle */}
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={form.isSimulation}
                      onChange={e => {
                        const enabled = e.target.checked;
                        setForm({ ...form, isSimulation: enabled });
                        if (!enabled) {
                          setSimulationQr("");
                          setSimulationResult(null);
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-8 h-4 bg-border rounded-full peer peer-checked:bg-primary transition-colors"></div>
                    <div className="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4 shadow-sm"></div>
                  </div>
                  <span className="text-xs font-bold text-text-muted uppercase tracking-wider">Simulation Mode</span>
                </label>
                </div>
            </div>

              {form.isSimulation && (
                <div className="mb-5 rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                    <div className="flex-1">
                      <label className="text-[9px] font-black text-text-muted uppercase tracking-wider block mb-1.5">
                        Scan / Manual Input Validate
                      </label>
                      <input
                        value={simulationQr}
                        onChange={e => {
                          setSimulationQr(e.target.value);
                          setSimulationResult(null);
                        }}
                        placeholder="Enter or scan QR for simulation validation"
                        className={`${inputCls} font-mono`}
                      />
                      <p className="mt-1 text-[10px] text-text-muted">
                        Visible only in Simulation Mode. Uses selected mapped machine and normal traceability validation.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSimulationValidate}
                      disabled={validatingSimulation || !simulationQr.trim() || !form.mappedMachineId}
                      className="h-9 px-5 bg-primary text-on-strong font-bold rounded-lg text-[10px] uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      {validatingSimulation ? "Validating..." : "Validate Scan"}
                    </button>
                  </div>
                  {simulationResult && (
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs font-semibold ${
                      simulationResult.error || simulationResult.decision === "BLOCK"
                        ? "border-danger/30 bg-danger/5 text-danger"
                        : "border-accent/30 bg-accent/5 text-accent"
                    }`}>
                      {simulationResult.error || simulationResult.message || simulationResult.reason || "Simulation validation completed"}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button type="button" onClick={resetForm}
                  className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-text-main transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={loading}
                  className="h-9 px-5 bg-primary text-on-strong font-bold rounded-lg text-[10px] uppercase tracking-wider flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-50">
                  <Save size={14} /> {loading ? "Saving…" : editingId ? "Save Changes" : "Register Device"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ── Scanner List Table ── */}
      <div className="industrial-card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-white flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex items-center justify-between gap-3 xl:self-center">
            <div className="flex items-center gap-2">
              <Network size={14} className="text-primary" />
              <h2 className="text-[10px] font-black text-text-main uppercase tracking-wider">Registered Devices</h2>
            </div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded border border-border xl:hidden">
              {filteredScanners.length} Device{filteredScanners.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(320px,520px)_150px_auto] md:items-end">
            <PlantLineSelector
              value={scope}
              onChange={setScope}
              includeAll
              compact
              hideLabels
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              inputClassName="h-9 w-full rounded-md border border-border bg-white px-3 text-xs font-semibold text-slate-800 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
            <div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 w-full rounded-md border border-border bg-white px-3 text-xs font-semibold text-slate-800 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10">
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>
            </div>
            {(scope.plantId || scope.lineId) ? (
              <button
                type="button"
                onClick={() => setScope({ plantId: "", lineId: "" })}
                className="h-9 rounded-md border border-border bg-white px-3 text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              >
                Clear Scope
              </button>
            ) : (
              <span className="hidden text-center text-[9px] font-black text-slate-500 uppercase tracking-widest bg-slate-50 px-2 py-2 rounded border border-border md:block">
                {filteredScanners.length} Device{filteredScanners.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {filteredScanners.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-text-muted">
            <ScanLine size={40} className="opacity-15 mb-3" />
            <p className="font-semibold text-sm">No scanners found</p>
            <p className="text-xs mt-1 text-text-muted/60">Clear scope or add a scanner for this line.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-wider text-slate-500 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left">Scanner</th>
                  <th className="px-4 py-3 text-left">Mode</th>
                  <th className="px-4 py-3 text-left">Endpoint</th>
                  <th className="px-4 py-3 text-left">Mapped To</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {filteredScanners.map(scanner => (
                  <tr key={scanner.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          scanner.isActive 
                            ? "bg-primary/10 text-primary border border-primary/20" 
                            : "bg-slate-50 text-text-muted border border-border opacity-70"
                        }`}>
                          {scanner.isActive ? <Wifi size={14} /> : <WifiOff size={14} />}
                        </div>
                        <div>
                          <p className="font-semibold text-text-main text-sm">{scanner.scannerName}</p>
                          <p className="text-[9px] text-text-muted mt-0.5 font-mono">ID: {scanner.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold text-text-main">
                        {SCANNER_MODES.find((m) => m.value === (scanner.scannerMode || "TCP_CLIENT"))?.label || (scanner.scannerMode || "TCP_CLIENT")}
                      </p>
                      {String(scanner.scannerMode || "").toUpperCase() === "PLC_REGISTER" && (
                        <p className="text-[9px] text-text-muted mt-0.5 font-mono">
                          {scanner.plcProtocol || "MODBUS_TCP"} · {scanner.plcDevice || "D"}{scanner.plcStartRegister ?? "?"}-{scanner.plcEndRegister ?? "?"}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {String(scanner.scannerMode || "").toUpperCase() === "PLC_REGISTER" ? (
                        <>
                          <p className="font-mono text-xs text-text-main">{scanner.plcIp || "-"}</p>
                          <p className="text-[9px] text-text-muted mt-0.5">PLC Port: {scanner.plcPort || "N/A"}</p>
                        </>
                      ) : (
                        <>
                          <p className="font-mono text-xs text-text-main">{scanner.scannerIp}</p>
                          <p className="text-[9px] text-text-muted mt-0.5">Port: {scanner.scannerPort || "N/A"}</p>
                        </>
                      )}
                      {String(scanner.scannerMode || "").toUpperCase() === "PLC_REGISTER" && (
                        <p className="text-[9px] text-text-muted mt-0.5 font-mono">
                          Timeout: {scanner.plcTimeoutMs || 8000}ms · Retry: {scanner.plcReadRetryCount || 3}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {scanner.mappedMachine ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <ArrowRight size={10} className="text-primary/50" />
                            <span className="text-xs font-semibold text-text-main">
                              {scanner.mappedMachine.machineName}
                            </span>
                          </div>
                          {sanitizeLineName(scanner.mappedMachine.lineName) && (
                            <p className="text-[9px] text-text-muted mt-0.5 ml-4">{sanitizeLineName(scanner.mappedMachine.lineName)}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${scanner.isActive ? 'bg-accent animate-pulse' : 'bg-text-muted/30'}`} />
                          <span className={`text-[9px] font-black uppercase ${scanner.isActive ? 'text-accent' : 'text-text-muted'}`}>
                            {scanner.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                        {scanner.isSimulation && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[8px] font-black uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                              SIMULATION
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleEdit(scanner)}
                          className="p-1.5 text-text-muted hover:text-primary hover:bg-primary/10 rounded transition-all"
                          title="Edit scanner">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleTestConnection(scanner)}
                          className="p-1.5 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-all"
                          title="Test connection/read">
                          <Activity size={13} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(scanner); }}
                          className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded transition-all"
                          title="Delete scanner">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Remove Scanner"
        message={`Remove "${deleteTarget?.scannerName}"? This disconnects it from its production node.`}
        confirmText="Remove Scanner"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default Scanners;
