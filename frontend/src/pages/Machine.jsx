import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings, Plus, Edit, Trash2, Save, X, Database, Search, RefreshCw } from "lucide-react";
import { machineApi } from "../api/services";
import { MACHINE_FORM_FIELD_CONFIG, MACHINE_TABLE_COLUMNS } from "../utils/machineFields";

const emptyForm = {
  machineName: "",
  lineName: "",
  sequenceNo: "",
  operationNo: "",
  plcIp: "",
  plcPort: "",
  plcProtocol: "TCP_TEXT",
  plcRegisters: "",
  status: "ACTIVE",
};

function buildFormFromMachine(machine) {
  return {
    machineName: machine.machineName || "",
    lineName: machine.lineName || "",
    sequenceNo: machine.sequenceNo ?? "",
    operationNo: machine.operationNo || "",
    plcIp: machine.plcIp || "",
    plcPort: machine.plcPort ?? "",
    plcProtocol: machine.plcProtocol || "TCP_TEXT",
    plcRegisters: machine.plcRegisters || "",
    status: machine.status || "ACTIVE",
  };
}

function toSubmitPayload(formData) {
  const plcIp = formData.plcIp.trim();
  const plcPort = formData.plcPort === "" ? null : Number(formData.plcPort);

  return {
    machineName: formData.machineName.trim(),
    lineName: formData.lineName.trim(),
    sequenceNo: formData.sequenceNo === "" ? null : Number(formData.sequenceNo),
    operationNo: formData.operationNo.trim().toUpperCase(),
    plcIp,
    plcPort,
    plcProtocol: formData.plcProtocol,
    plcRegisters: formData.plcRegisters.trim(),
    status: formData.status || "ACTIVE",
    // Backward-compatible aliases for older backend validation still expecting machineIp/machinePort.
    machineIp: plcIp,
    machinePort: plcPort,
  };
}

function sortValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return value;
}

const MachinePage = () => {
  const [machines, setMachines] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingMachine, setEditingMachine] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [searchTerm, setSearchTerm] = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState({ key: "sequenceNo", direction: "asc" });

  const loadMachines = useCallback(async () => {
    const machineData = await machineApi.list();
    setMachines(machineData || []);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadMachines().catch(() => {
        console.error("Error loading machines");
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [loadMachines]);

  const resetForm = () => {
    setFormData(emptyForm);
    setEditingMachine(null);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      const payload = toSubmitPayload(formData);
      if (editingMachine) {
        await machineApi.update(editingMachine.id, payload);
      } else {
        await machineApi.create(payload);
      }
      closeModal();
      await loadMachines();
    } catch (error) {
      alert(error.response?.data?.error || "Failed to save machine");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this machine?")) {
      return;
    }
    try {
      await machineApi.remove(id);
      await loadMachines();
    } catch (error) {
      alert(error.response?.data?.error || "Failed to delete machine");
    }
  };

  const handleSort = (key) => {
    if (sortConfig.key === key) {
      setSortConfig((prev) => ({
        key,
        direction: prev.direction === "asc" ? "desc" : "asc",
      }));
      return;
    }
    setSortConfig({ key, direction: "asc" });
  };

  const uniqueLines = useMemo(() => {
    const lines = machines.map((machine) => machine.lineName).filter(Boolean);
    return ["all", ...new Set(lines)];
  }, [machines]);

  const filteredMachines = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const filtered = machines.filter((machine) => {
      const searchFields = [
        machine.machineName,
        machine.lineName,
        machine.operationNo,
        String(machine.sequenceNo ?? ""),
        machine.plcIp,
        machine.plcProtocol,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !normalizedSearch || searchFields.includes(normalizedSearch);
      const matchesLine = lineFilter === "all" || machine.lineName === lineFilter;
      const matchesStatus = statusFilter === "all" || machine.status === statusFilter;
      return matchesSearch && matchesLine && matchesStatus;
    });

    return filtered.sort((a, b) => {
      const aValue = sortValue(a[sortConfig.key]);
      const bValue = sortValue(b[sortConfig.key]);
      if (aValue < bValue) {
        return sortConfig.direction === "asc" ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === "asc" ? 1 : -1;
      }
      return 0;
    });
  }, [lineFilter, machines, searchTerm, sortConfig.direction, sortConfig.key, statusFilter]);

  const handleEdit = (machine) => {
    setEditingMachine(machine);
    setFormData(buildFormFromMachine(machine));
    setShowModal(true);
  };

  const updateField = (key, value) => {
    if (key === "operationNo") {
      setFormData((prev) => ({ ...prev, [key]: String(value).toUpperCase() }));
      return;
    }
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const renderCellValue = (machine, key) => {
    if (key === "status") {
      return (
        <span
          className={`px-2 py-1 rounded-full text-xs font-bold ${
            machine.status === "ACTIVE"
              ? "bg-accent/10 text-accent border border-accent/20"
              : "bg-danger/10 text-danger border border-danger/20"
          }`}
        >
          {machine.status || "ACTIVE"}
        </span>
      );
    }

    if (key === "sequenceNo") {
      return <span className="font-mono text-primary">#{String(machine.sequenceNo ?? "-").padStart(2, "0")}</span>;
    }

    if (key === "plcRegisters") {
      return <span className="font-mono text-xs text-text-main">{machine.plcRegisters || "-"}</span>;
    }

    return <span className="text-text-main">{machine[key] ?? "-"}</span>;
  };

  return (
    <div className="space-y-6 text-text-main">
      <header className="flex justify-between items-center mb-10">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-xl text-primary border border-primary/20">
            <Settings size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-main uppercase">Machine Configuration</h1>
            <p className="text-text-muted text-sm">Dynamic machine field model</p>
          </div>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowModal(true);
          }}
          className="bg-primary hover:brightness-110 text-bg-dark px-5 py-2.5 rounded-xl flex items-center gap-2 font-bold transition-all shadow-lg shadow-primary/10"
        >
          <Plus size={20} /> Add Machine
        </button>
      </header>

      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={20} />
          <input
            type="text"
            placeholder="Search by machine, line, sequence, operation, PLC IP..."
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
            {uniqueLines
              .filter((entry) => entry !== "all")
              .map((line) => (
                <option key={line} value={line}>
                  {line}
                </option>
              ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-bg-card border border-border rounded-xl px-4 py-2 text-text-main focus:border-primary/50 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>

          <button
            onClick={() => loadMachines().catch(() => {})}
            className="p-2 bg-bg-card border border-border rounded-xl hover:border-primary/50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} className="text-text-muted" />
          </button>
        </div>
      </div>

      <div className="industrial-card border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-dark/50 border-b border-border">
              <tr>
                {MACHINE_TABLE_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className={`px-6 py-4 text-left text-xs font-bold uppercase tracking-wider ${
                      column.sortable
                        ? "text-text-muted cursor-pointer hover:text-primary"
                        : "text-text-muted"
                    }`}
                    onClick={() => {
                      if (column.sortable) {
                        handleSort(column.key);
                      }
                    }}
                  >
                    <div className="flex items-center gap-1">
                      <span>{column.label}</span>
                      {column.sortable && sortConfig.key === column.key && (
                        <span>{sortConfig.direction === "asc" ? "^" : "v"}</span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredMachines.length > 0 ? (
                filteredMachines.map((machine) => (
                  <tr key={machine.id} className="hover:bg-bg-dark/30 transition-colors group">
                    {MACHINE_TABLE_COLUMNS.map((column) => (
                      <td key={`${machine.id}-${column.key}`} className="px-6 py-4 whitespace-nowrap">
                        {renderCellValue(machine, column.key)}
                      </td>
                    ))}
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEdit(machine)}
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
                ))
              ) : (
                <tr>
                  <td colSpan={MACHINE_TABLE_COLUMNS.length + 1} className="px-6 py-12 text-center">
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

        <div className="px-6 py-4 bg-bg-dark/50 border-t border-border flex items-center justify-between">
          <div className="text-sm text-text-muted">
            Showing <span className="text-primary font-medium">{filteredMachines.length}</span> of{" "}
            <span className="text-primary font-medium">{machines.length}</span> machines
          </div>
          {filteredMachines.length > 0 && (
            <div className="text-sm text-text-muted">
              <span className="text-accent font-medium">{machines.filter((row) => row.status === "ACTIVE").length}</span> Active,{" "}
              <span className="text-danger font-medium">{machines.filter((row) => row.status === "INACTIVE").length}</span> Inactive
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-bg-card border border-border p-8 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-6 sticky top-0 bg-bg-card py-2">
              <h2 className="text-xl font-bold text-text-main flex items-center gap-2">
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
              <button type="button" onClick={closeModal} className="p-2 hover:bg-bg-dark rounded-lg transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {MACHINE_FORM_FIELD_CONFIG.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-xs font-bold text-text-muted uppercase flex items-center gap-1">
                    {field.label}
                    {field.required && <span className="text-primary">*</span>}
                  </label>
                  {field.type === "select" ? (
                    <select
                      value={formData[field.key]}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      required={field.required}
                      className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                    >
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type || "text"}
                      value={formData[field.key]}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      required={field.required}
                      placeholder={field.placeholder || ""}
                      className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                    />
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-text-muted mt-4">
              PLC registers can be entered as comma-separated values or JSON (example: 100,101,102,103,104).
            </p>

            <div className="flex justify-end mt-8 gap-4 pt-6 border-t border-border">
              <button type="button" onClick={closeModal} className="px-6 py-3 text-text-muted hover:text-text-main transition-colors">
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

export default MachinePage;
