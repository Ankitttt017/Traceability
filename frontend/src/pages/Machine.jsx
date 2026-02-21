import React, { useCallback, useEffect, useMemo, useState } from "react";
import { 
  Settings, 
  Plus, 
  Edit, 
  Trash2, 
  Save, 
  X, 
  Database,
  Search,
  RefreshCw,
  Wifi,
  Cpu,
  Server,
  Network,
  Hash,
  SlidersHorizontal
} from "lucide-react";
import { machineApi, scannerApi } from "../api/services";

const emptyForm = {
  machineNumber: "",
  machineName: "",
  lineName: "",
  sequenceNo: "",
  operationNo: "",
  machineIp: "",
  machinePort: "",
  plcIp: "",
  plcPort: "",
  plcProtocol: "TCP_TEXT",
  plcUnitId: "1",
  plcStartRegister: "",
  plcStatusRegister: "",
  plcPartRegister: "",
  plcStationRegister: "",
  plcResetRegister: "",
  plcStartValue: "1",
  plcStartedValue: "1",
  plcEndOkValue: "2",
  plcEndNgValue: "3",
  status: "ACTIVE",
};

const MachinePage = () => {
  const [machines, setMachines] = useState([]);
  const [scanners, setScanners] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingMachine, setEditingMachine] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [searchTerm, setSearchTerm] = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showPlcAdvanced, setShowPlcAdvanced] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: "sequenceNo", direction: "asc" });

  const loadData = useCallback(async () => {
    const [machineData, scannerData] = await Promise.all([machineApi.list(), scannerApi.list()]);
    setMachines(machineData);
    setScanners(scannerData);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadData().catch(() => {
        console.error("Error loading machines/scanners");
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingMachine) {
        await machineApi.update(editingMachine.id, formData);
      } else {
        await machineApi.create(formData);
      }

      setShowModal(false);
      resetForm();
      await loadData();
    } catch (err) {
      alert(err.response?.data?.error || "Check sequence or IP uniqueness.");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this machine?")) return;
    await machineApi.remove(id);
    loadData().catch(() => {});
  };

  const resetForm = () => {
    setFormData(emptyForm);
    setEditingMachine(null);
    setShowPlcAdvanced(false);
  };

  const handleSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const getUniqueLines = () => {
    const lines = machines.map(m => m.lineName).filter(Boolean);
    return ["all", ...new Set(lines)];
  };

  const getFilteredAndSortedMachines = () => {
    let filtered = machines.filter(machine => {
      const matchesSearch = 
        machine.machineName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        machine.machineNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        machine.operationNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        machine.lineName?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesLine = lineFilter === "all" || machine.lineName === lineFilter;
      const matchesStatus = statusFilter === "all" || machine.status === statusFilter;
      
      return matchesSearch && matchesLine && matchesStatus;
    });

    return filtered.sort((a, b) => {
      const aVal = a[sortConfig.key] || "";
      const bVal = b[sortConfig.key] || "";
      
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  };

  const filteredMachines = getFilteredAndSortedMachines();
  const scannerByMachine = useMemo(() => {
    const map = new Map();
    for (const scanner of scanners) {
      map.set(Number(scanner.mappedMachineId), scanner);
    }
    return map;
  }, [scanners]);

  return (
    <div className="space-y-6 text-text-main">
      {/* Header */}
      <header className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-xl text-primary border border-primary/20">
            <Settings size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white uppercase">Machine Configuration</h1>
            <p className="text-text-muted text-sm">Sequence Based Traceability Control</p>
          </div>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowPlcAdvanced(false);
            setShowModal(true);
          }}
          className="bg-primary hover:brightness-110 text-bg-dark px-5 py-2.5 rounded-xl flex items-center gap-2 font-bold transition-all shadow-lg shadow-primary/10"
        >
          <Plus size={20} /> Add Machine
        </button>
      </header>

      {/* Filters and Search */}
      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={20} />
          <input
            type="text"
            placeholder="Search machines by name, number, operation..."
            className="w-full bg-bg-card border border-border rounded-xl py-3 pl-10 pr-4 text-text-main focus:border-primary/50 focus:outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex gap-2">
          <select
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value)}
            className="bg-bg-card border border-border rounded-xl px-4 py-2 text-text-main focus:border-primary/50 focus:outline-none"
          >
            <option value="all">All Lines</option>
            {getUniqueLines().filter(l => l !== "all").map(line => (
              <option key={line} value={line}>{line}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-bg-card border border-border rounded-xl px-4 py-2 text-text-main focus:border-primary/50 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>

          <button
            onClick={() => loadData().catch(() => {})}
            className="p-2 bg-bg-card border border-border rounded-xl hover:border-primary/50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} className="text-text-muted" />
          </button>
        </div>
      </div>

      {/* Machines Table */}
      <div className="industrial-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-dark/50 border-b border-border">
              <tr>
                <th 
                  className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted cursor-pointer hover:text-primary"
                  onClick={() => handleSort("sequenceNo")}
                >
                  <div className="flex items-center gap-1">
                    <Hash size={14} />
                    <span>SEQ</span>
                    {sortConfig.key === "sequenceNo" && (
                      <span>{sortConfig.direction === "asc" ? "^" : "v"}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted cursor-pointer hover:text-primary"
                  onClick={() => handleSort("machineName")}
                >
                  <div className="flex items-center gap-1">
                    <Database size={14} />
                    <span>Machine</span>
                    {sortConfig.key === "machineName" && (
                      <span>{sortConfig.direction === "asc" ? "^" : "v"}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted cursor-pointer hover:text-primary"
                  onClick={() => handleSort("lineName")}
                >
                  <div className="flex items-center gap-1">
                    <span>Line</span>
                    {sortConfig.key === "lineName" && (
                      <span>{sortConfig.direction === "asc" ? "^" : "v"}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted cursor-pointer hover:text-primary"
                  onClick={() => handleSort("operationNo")}
                >
                  <div className="flex items-center gap-1">
                    <Cpu size={14} />
                    <span>Operation</span>
                    {sortConfig.key === "operationNo" && (
                      <span>{sortConfig.direction === "asc" ? "^" : "v"}</span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  <div className="flex items-center gap-1">
                    <Network size={14} />
                    <span>Machine IP:Port</span>
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  <div className="flex items-center gap-1">
                    <Wifi size={14} />
                    <span>Mapped Scanner</span>
                  </div>
                </th>
                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                  <div className="flex items-center gap-1">
                    <Server size={14} />
                    <span>PLC IP:Port</span>
                  </div>
                </th>
                <th 
                  className="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-text-muted cursor-pointer hover:text-primary"
                  onClick={() => handleSort("status")}
                >
                  <div className="flex items-center gap-1">
                    <span>Status</span>
                    {sortConfig.key === "status" && (
                      <span>{sortConfig.direction === "asc" ? "^" : "v"}</span>
                    )}
                  </div>
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredMachines.length > 0 ? (
                filteredMachines.map((machine) => {
                  const mappedScanner = scannerByMachine.get(Number(machine.id));
                  return (
                    <tr
                      key={machine.id}
                      className="hover:bg-bg-dark/30 transition-colors group"
                    >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-mono text-primary font-bold">
                        #{String(machine.sequenceNo).padStart(2, '0')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                          <Database size={18} className="text-primary" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">
                            {machine.machineName}
                          </div>
                          <div className="text-xs text-text-muted">
                            {machine.machineNumber}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-text-main">{machine.lineName}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-mono text-primary">
                        {machine.operationNo}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Network size={14} className="text-text-muted" />
                        <span className="text-sm font-mono text-text-main">
                          {machine.machineIp || '-'}:{machine.machinePort || '-'}
                        </span>
                      </div>
                    </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <Wifi size={14} className="text-text-muted" />
                          <span className="text-sm font-mono text-text-main">
                            {mappedScanner
                              ? `${mappedScanner.scannerName} (${mappedScanner.scannerIp}${
                                  mappedScanner.scannerPort ? `:${mappedScanner.scannerPort}` : ""
                                })`
                              : "Not mapped"}
                          </span>
                        </div>
                      </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Server size={14} className="text-text-muted" />
                        <div>
                          <span className="text-sm font-mono text-text-main">
                            {machine.plcIp || '-'}:{machine.plcPort || '-'}
                          </span>
                          <p className="text-[11px] text-text-muted">{machine.plcProtocol || "TCP_TEXT"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          machine.status === "ACTIVE" ? "bg-accent animate-pulse" : "bg-danger"
                        }`}></span>
                        <span className={`text-xs font-medium ${
                          machine.status === "ACTIVE" ? "text-accent" : "text-danger"
                        }`}>
                          {machine.status}
                        </span>
                      </div>
                    </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setEditingMachine(machine);
                              setShowPlcAdvanced((machine.plcProtocol || "TCP_TEXT") === "MODBUS_TCP");
                              setFormData({
                                machineNumber: machine.machineNumber,
                                machineName: machine.machineName,
                                lineName: machine.lineName,
                                sequenceNo: machine.sequenceNo,
                                operationNo: machine.operationNo,
                                machineIp: machine.machineIp,
                                machinePort: machine.machinePort || "",
                                plcIp: machine.plcIp || "",
                                plcPort: machine.plcPort || "",
                                plcProtocol: machine.plcProtocol || "TCP_TEXT",
                                plcUnitId: machine.plcUnitId || "1",
                                plcStartRegister: machine.plcStartRegister || "",
                                plcStatusRegister: machine.plcStatusRegister || "",
                                plcPartRegister: machine.plcPartRegister || "",
                                plcStationRegister: machine.plcStationRegister || "",
                                plcResetRegister: machine.plcResetRegister || "",
                                plcStartValue: machine.plcStartValue || "1",
                                plcStartedValue: machine.plcStartedValue || "1",
                                plcEndOkValue: machine.plcEndOkValue || "2",
                                plcEndNgValue: machine.plcEndNgValue || "3",
                                status: machine.status,
                              });
                              setShowModal(true);
                            }}
                            className="p-2 hover:bg-primary/10 text-primary rounded-lg transition-all hover:scale-110"
                            title="Edit machine"
                          >
                            <Edit size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(machine.id)}
                            className="p-2 hover:bg-danger/10 text-danger rounded-lg transition-all hover:scale-110"
                            title="Delete machine"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="9" className="px-6 py-12 text-center">
                    <Database size={48} className="mx-auto text-text-muted mb-4 opacity-50" />
                    <p className="text-text-muted">No machines found</p>
                    <button 
                      onClick={() => {
                        setSearchTerm("");
                        setLineFilter("all");
                        setStatusFilter("all");
                      }}
                      className="mt-4 text-primary hover:underline text-sm"
                    >
                      Clear filters
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      {/* Table Footer */}
      <div className="px-6 py-4 bg-bg-dark/50 border-t border-border flex items-center justify-between">
          <div className="text-sm text-text-muted">
            Showing <span className="text-primary font-medium">{filteredMachines.length}</span> of{" "}
            <span className="text-primary font-medium">{machines.length}</span> machines
          </div>
          
          {filteredMachines.length > 0 && (
            <div className="text-sm text-text-muted">
              <span className="text-accent font-medium">
                {machines.filter(m => m.status === "ACTIVE").length}
              </span> Active,{" "}
              <span className="text-danger font-medium">
                {machines.filter(m => m.status === "INACTIVE").length}
              </span> Inactive
            </div>
          )}
      </div>
      </div>

      {/* Add/Edit Modal - Keep the same modal as before but with improved styling */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSubmit} className="bg-bg-card border border-border p-8 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-bg-card py-2">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                {editingMachine ? (
                  <>
                    <Edit size={20} className="text-primary" />
                    <span>Edit Machine</span>
                  </>
                ) : (
                  <>
                    <Plus size={20} className="text-primary" />
                    <span>Add New Machine</span>
                  </>
                )}
              </h2>
              <button 
                type="button" 
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-bg-dark rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <Input 
                label="Machine Number" 
                value={formData.machineNumber} 
                onChange={(e) => setFormData({ ...formData, machineNumber: e.target.value })} 
                required
              />
              <Input 
                label="Machine Name" 
                value={formData.machineName} 
                onChange={(e) => setFormData({ ...formData, machineName: e.target.value })} 
                required
              />
              <Input 
                label="Line Name" 
                value={formData.lineName} 
                onChange={(e) => setFormData({ ...formData, lineName: e.target.value })} 
                required
              />
              <Input 
                label="Sequence No" 
                type="number" 
                value={formData.sequenceNo} 
                onChange={(e) => setFormData({ ...formData, sequenceNo: e.target.value })} 
                required
              />
              <Input 
                label="Operation No" 
                value={formData.operationNo} 
                onChange={(e) => setFormData({ ...formData, operationNo: e.target.value.toUpperCase() })} 
                required
              />
              <Input 
                label="Machine IP" 
                value={formData.machineIp} 
                onChange={(e) => setFormData({ ...formData, machineIp: e.target.value })} 
                required
              />
              <Input 
                label="Machine Port" 
                type="number" 
                value={formData.machinePort} 
                onChange={(e) => setFormData({ ...formData, machinePort: e.target.value })} 
                required
              />
              <Input 
                label="PLC IP" 
                value={formData.plcIp} 
                onChange={(e) => setFormData({ ...formData, plcIp: e.target.value })} 
              />
              <Input 
                label="PLC Port" 
                type="number" 
                value={formData.plcPort} 
                onChange={(e) => setFormData({ ...formData, plcPort: e.target.value })} 
              />

              <div className="space-y-1">
                <label className="text-xs font-bold text-text-muted uppercase">
                  PLC Protocol <span className="text-primary">*</span>
                </label>
                <select
                  value={formData.plcProtocol}
                  onChange={(e) => {
                    const nextProtocol = e.target.value;
                    setFormData({ ...formData, plcProtocol: nextProtocol });
                    if (nextProtocol === "MODBUS_TCP") {
                      setShowPlcAdvanced(true);
                    }
                  }}
                  className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                  required
                >
                  <option value="TCP_TEXT">TCP_TEXT (ACK string)</option>
                  <option value="MODBUS_TCP">MODBUS_TCP</option>
                </select>
              </div>

              <Input 
                label="PLC Unit ID" 
                type="number" 
                value={formData.plcUnitId} 
                onChange={(e) => setFormData({ ...formData, plcUnitId: e.target.value })} 
              />

              <div className="space-y-1">
                <label className="text-xs font-bold text-text-muted uppercase">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowPlcAdvanced((prev) => !prev)}
                className="px-3 py-2 rounded-lg border border-border text-text-muted hover:border-primary inline-flex items-center gap-2"
              >
                <SlidersHorizontal size={15} />
                {showPlcAdvanced ? "Hide PLC Advanced" : "Show PLC Advanced"}
              </button>
            </div>

            {showPlcAdvanced && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                <Input
                  label="PLC Start Register"
                  type="number"
                  value={formData.plcStartRegister}
                  onChange={(e) => setFormData({ ...formData, plcStartRegister: e.target.value })}
                  required={formData.plcProtocol === "MODBUS_TCP"}
                />
                <Input
                  label="PLC Status Register"
                  type="number"
                  value={formData.plcStatusRegister}
                  onChange={(e) => setFormData({ ...formData, plcStatusRegister: e.target.value })}
                  required={formData.plcProtocol === "MODBUS_TCP"}
                />
                <Input
                  label="PLC Part Register"
                  type="number"
                  value={formData.plcPartRegister}
                  onChange={(e) => setFormData({ ...formData, plcPartRegister: e.target.value })}
                />
                <Input
                  label="PLC Station Register"
                  type="number"
                  value={formData.plcStationRegister}
                  onChange={(e) => setFormData({ ...formData, plcStationRegister: e.target.value })}
                />
                <Input
                  label="PLC Reset Register"
                  type="number"
                  value={formData.plcResetRegister}
                  onChange={(e) => setFormData({ ...formData, plcResetRegister: e.target.value })}
                />
                <Input
                  label="PLC Start Value"
                  type="number"
                  value={formData.plcStartValue}
                  onChange={(e) => setFormData({ ...formData, plcStartValue: e.target.value })}
                />
                <Input
                  label="PLC Started Value"
                  type="number"
                  value={formData.plcStartedValue}
                  onChange={(e) => setFormData({ ...formData, plcStartedValue: e.target.value })}
                />
                <Input
                  label="PLC End OK Value"
                  type="number"
                  value={formData.plcEndOkValue}
                  onChange={(e) => setFormData({ ...formData, plcEndOkValue: e.target.value })}
                />
                <Input
                  label="PLC End NG Value"
                  type="number"
                  value={formData.plcEndNgValue}
                  onChange={(e) => setFormData({ ...formData, plcEndNgValue: e.target.value })}
                />
              </div>
            )}
            <p className="text-xs text-text-muted mt-3">
              Scanner IP mapping is managed from the Scanners page to avoid duplicate configuration.
            </p>

            <div className="flex justify-end mt-8 gap-4 pt-6 border-t border-border">
              <button 
                type="button" 
                onClick={() => setShowModal(false)} 
                className="px-6 py-3 text-text-muted hover:text-text-main transition-colors"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="bg-primary px-8 py-3 rounded-xl text-bg-dark font-bold flex gap-2 hover:brightness-110 transition-all shadow-lg shadow-primary/10"
              >
                <Save size={18} /> {editingMachine ? "Update" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const Input = ({ label, required, ...props }) => (
  <div className="space-y-1">
    <label className="text-xs font-bold text-text-muted uppercase flex items-center gap-1">
      {label}
      {required && <span className="text-primary">*</span>}
    </label>
    <input
      {...props}
      required={required}
      className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
    />
  </div>
);

export default MachinePage;
