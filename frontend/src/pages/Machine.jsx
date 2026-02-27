import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Download, Edit, Plus, RefreshCw, Save, Search, Settings, Trash2, X } from "lucide-react";
import { machineApi, plcConfigApi } from "../api/services";
import {
  MACHINE_FORM_FIELD_CONFIG,
  MACHINE_MODBUS_TUNING_FIELD_CONFIG,
  MACHINE_REGISTER_ROLE_FIELDS,
  MACHINE_TABLE_COLUMNS,
} from "../utils/machineFields";

function createEmptyForm() {
  return {
    machineName: "",
    lineName: "",
    sequenceNo: "",
    operationNo: "",
    plcIp: "",
    plcPort: "",
    plcProtocol: "TCP_TEXT",
    plcRangeId: "",
    plcConfig: {
      rangeId: "",
      startRegister: "",
      statusRegister: "",
      stationRegister: "",
      resetRegister: "",
      startValue: "1",
      startedValue: "2",
      endOkValue: "3",
      endNgValue: "4",
    },
    status: "ACTIVE",
  };
}

function toFormValue(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function toNullableNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNumberWithDefault(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clearRangeAssignments(config = {}) {
  return {
    ...config,
    rangeId: "",
    startRegister: "",
    statusRegister: "",
    stationRegister: "",
    resetRegister: "",
  };
}

function buildFormFromMachine(machine) {
  const config = machine.plcConfig || {};
  const plcRangeId = config.rangeId ?? machine.plcRangeId ?? "";

  return {
    machineName: machine.machineName || "",
    lineName: machine.lineName || "",
    sequenceNo: toFormValue(machine.sequenceNo, ""),
    operationNo: machine.operationNo || "",
    plcIp: machine.plcIp || "",
    plcPort: toFormValue(machine.plcPort, ""),
    plcProtocol: machine.plcProtocol || "TCP_TEXT",
    plcRangeId: toFormValue(plcRangeId, ""),
    plcConfig: {
      rangeId: toFormValue(plcRangeId, ""),
      startRegister: toFormValue(config.startRegister ?? machine.plcStartRegister, ""),
      statusRegister: toFormValue(config.statusRegister ?? machine.plcStatusRegister, ""),
      stationRegister: toFormValue(config.stationRegister ?? machine.plcStationRegister, ""),
      resetRegister: toFormValue(config.resetRegister ?? machine.plcResetRegister, ""),
      startValue: toFormValue(config.startValue ?? machine.plcStartValue, "1"),
      startedValue: toFormValue(config.startedValue ?? machine.plcStartedValue, "2"),
      endOkValue: toFormValue(config.endOkValue ?? machine.plcEndOkValue, "3"),
      endNgValue: toFormValue(config.endNgValue ?? machine.plcEndNgValue, "4"),
    },
    status: machine.status || "ACTIVE",
  };
}

function toSubmitPayload(formData) {
  const plcIp = String(formData.plcIp || "").trim();
  const plcPort = toNullableNumber(formData.plcPort);
  const plcRangeId = toNullableNumber(formData.plcRangeId);
  const cfg = formData.plcConfig || {};

  const plcConfig = {
    rangeId: plcRangeId,
    startRegister: toNullableNumber(cfg.startRegister),
    statusRegister: toNullableNumber(cfg.statusRegister),
    stationRegister: toNullableNumber(cfg.stationRegister),
    resetRegister: toNullableNumber(cfg.resetRegister),
    startValue: toNumberWithDefault(cfg.startValue, 1),
    startedValue: toNumberWithDefault(cfg.startedValue, 2),
    endOkValue: toNumberWithDefault(cfg.endOkValue, 3),
    endNgValue: toNumberWithDefault(cfg.endNgValue, 4),
  };

  return {
    machineName: String(formData.machineName || "").trim(),
    lineName: String(formData.lineName || "").trim(),
    sequenceNo: toNullableNumber(formData.sequenceNo),
    operationNo: String(formData.operationNo || "").trim().toUpperCase(),
    plcIp,
    plcPort,
    plcProtocol: formData.plcProtocol,
    plcRangeId,
    plcConfig,
    status: formData.status || "ACTIVE",
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
  const [plcRanges, setPlcRanges] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingMachine, setEditingMachine] = useState(null);
  const [formData, setFormData] = useState(() => createEmptyForm());
  const [searchTerm, setSearchTerm] = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortConfig, setSortConfig] = useState({ key: "sequenceNo", direction: "asc" });
  const [pageError, setPageError] = useState("");
  const [rangeRegisters, setRangeRegisters] = useState(null);
  const [rangeRegistersLoading, setRangeRegistersLoading] = useState(false);
  const [rangeRegistersError, setRangeRegistersError] = useState("");

  const loadMachineContext = useCallback(async () => {
    const [machineRows, rangeRows] = await Promise.all([machineApi.list(), plcConfigApi.listRanges().catch(() => [])]);
    setMachines(machineRows || []);
    setPlcRanges(rangeRows || []);
    setPageError("");
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadMachineContext().catch((error) => {
        setPageError(error.response?.data?.error || "Error loading machine configuration");
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [loadMachineContext]);

  const rangeById = useMemo(
    () =>
      plcRanges.reduce((acc, row) => {
        acc[row.id] = row;
        return acc;
      }, {}),
    [plcRanges]
  );

  const activeRanges = useMemo(
    () => plcRanges.filter((row) => String(row.status || "").toUpperCase() === "ACTIVE"),
    [plcRanges]
  );

  const plcIpOptions = useMemo(() => {
    const options = [];
    const seen = new Set();
    for (const row of activeRanges) {
      const ip = String(row.plcIp || "").trim();
      if (!ip || seen.has(ip)) {
        continue;
      }
      seen.add(ip);
      options.push(ip);
    }
    const currentIp = String(formData.plcIp || "").trim();
    if (currentIp && !seen.has(currentIp)) {
      options.push(currentIp);
    }
    return options.sort((a, b) => a.localeCompare(b));
  }, [activeRanges, formData.plcIp]);

  const selectableRanges = useMemo(() => {
    const selectedIp = String(formData.plcIp || "").trim();
    const map = new Map();
    for (const row of activeRanges.filter((entry) => !selectedIp || String(entry.plcIp || "").trim() === selectedIp)) {
      map.set(String(row.id), row);
    }

    const editingRangeId = toNullableNumber(editingMachine?.plcRangeId || editingMachine?.plcConfig?.rangeId);
    if (editingRangeId && rangeById[editingRangeId]) {
      map.set(String(editingRangeId), rangeById[editingRangeId]);
    }

    return Array.from(map.values());
  }, [activeRanges, editingMachine, formData.plcIp, rangeById]);

  const isModbusProtocol = String(formData.plcProtocol || "").toUpperCase() === "MODBUS_TCP";

  const resetForm = () => {
    setFormData(createEmptyForm());
    setEditingMachine(null);
    setRangeRegisters(null);
    setRangeRegistersError("");
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const loadRangeRegisters = useCallback(async (rangeId, excludeMachineId = null) => {
    if (!rangeId) {
      setRangeRegisters(null);
      setRangeRegistersError("");
      return;
    }

    try {
      setRangeRegistersLoading(true);
      setRangeRegistersError("");

      const payload = await plcConfigApi.rangeRegisters(rangeId, excludeMachineId ? { excludeMachineId } : {});
      setRangeRegisters(payload || null);

      const defaults = payload?.range?.defaultRegisters || {};
      const available = new Set(
        (payload?.availableRegisters || [])
          .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry))
      );
      const currentMachine = new Set(
        (payload?.currentMachineRegisters || [])
          .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry))
      );

      setFormData((prev) => {
        if (String(prev.plcRangeId || "") !== String(rangeId)) {
          return prev;
        }

        let changed = false;
        const nextConfig = { ...(prev.plcConfig || {}), rangeId: String(rangeId) };

        for (const role of MACHINE_REGISTER_ROLE_FIELDS) {
          const existing = toNullableNumber(nextConfig[role.key]);
          if (existing !== null) {
            continue;
          }

          const defaultRegister = toNullableNumber(defaults[role.key]);
          if (defaultRegister === null) {
            continue;
          }
          if (!available.has(defaultRegister) && !currentMachine.has(defaultRegister)) {
            continue;
          }

          nextConfig[role.key] = String(defaultRegister);
          changed = true;
        }

        if (!changed) {
          return prev;
        }

        return {
          ...prev,
          plcConfig: nextConfig,
        };
      });
    } catch (error) {
      setRangeRegisters(null);
      setRangeRegistersError(error.response?.data?.error || "Unable to load range register usage");
    } finally {
      setRangeRegistersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showModal || String(formData.plcProtocol || "").toUpperCase() !== "MODBUS_TCP") {
      setRangeRegisters(null);
      setRangeRegistersError("");
      return;
    }

    if (!formData.plcRangeId) {
      setRangeRegisters(null);
      setRangeRegistersError("");
      return;
    }

    loadRangeRegisters(formData.plcRangeId, editingMachine?.id || null);
  }, [showModal, formData.plcProtocol, formData.plcRangeId, editingMachine?.id, loadRangeRegisters]);

  useEffect(() => {
    if (!showModal) {
      return;
    }
    if (editingMachine) {
      return;
    }
    if (String(formData.plcProtocol || "").toUpperCase() !== "MODBUS_TCP") {
      return;
    }
    if (formData.plcRangeId) {
      return;
    }
    if (activeRanges.length === 0) {
      return;
    }

    const firstRange = activeRanges[0];
    const nextRangeId = String(firstRange.id);
    setFormData((prev) => ({
      ...prev,
      plcIp: firstRange.plcIp || "",
      plcPort: toFormValue(firstRange.plcPort, ""),
      plcRangeId: nextRangeId,
      plcConfig: {
        ...(prev.plcConfig || {}),
        rangeId: nextRangeId,
      },
    }));
  }, [showModal, editingMachine, formData.plcProtocol, formData.plcRangeId, activeRanges]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const payload = toSubmitPayload(formData);
      if (String(payload.plcProtocol || "").toUpperCase() === "MODBUS_TCP" && !payload.plcRangeId) {
        alert("Select PLC register range for MODBUS_TCP machine");
        return;
      }
      if (String(payload.plcProtocol || "").toUpperCase() === "TCP_TEXT") {
        if (!payload.plcIp || !Number.isFinite(Number(payload.plcPort))) {
          alert("For TCP_TEXT, PLC IP and PLC Port are required.");
          return;
        }
      }

      if (editingMachine) {
        await machineApi.update(editingMachine.id, payload);
      } else {
        await machineApi.create(payload);
      }

      closeModal();
      await loadMachineContext();
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
      await loadMachineContext();
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

  const downloadMachineSheet = () => {
    const rows = [
      [
        "Machine Name",
        "Line Name",
        "Sequence No",
        "Operation No",
        "Protocol",
        "PLC IP",
        "PLC Port",
        "PLC Range",
        "Trigger Register",
        "Interlock Register",
        "Complete Register",
        "Reset Register",
        "Start Value",
        "Started Value",
        "End OK Value",
        "End NG Value",
        "Status",
      ],
    ];

    for (const machine of filteredMachines) {
      const cfg = machine.plcConfig || {};
      const rangeId = toNullableNumber(machine.plcRangeId || cfg.rangeId);
      const range = rangeId ? rangeById[rangeId] : null;
      rows.push([
        machine.machineName || "",
        machine.lineName || "",
        machine.sequenceNo ?? "",
        machine.operationNo || "",
        machine.plcProtocol || "",
        machine.plcIp || "",
        machine.plcPort ?? "",
        range ? `${range.rangeName} (${range.rangeStart}-${range.rangeEnd})` : rangeId || "",
        cfg.startRegister ?? "",
        cfg.statusRegister ?? "",
        cfg.stationRegister ?? "",
        cfg.resetRegister ?? "",
        cfg.startValue ?? "",
        cfg.startedValue ?? "",
        cfg.endOkValue ?? "",
        cfg.endNgValue ?? "",
        machine.status || "",
      ]);
    }

    const csv = rows
      .map((row) =>
        row
          .map((entry) => {
            const text = String(entry ?? "");
            if (!text.includes(",") && !text.includes('"') && !text.includes("\n")) {
              return text;
            }
            return `"${text.replace(/"/g, '""')}"`;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "machine_handshake_sheet.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const uniqueLines = useMemo(() => {
    const lines = machines.map((machine) => machine.lineName).filter(Boolean);
    return ["all", ...new Set(lines)];
  }, [machines]);

  const filteredMachines = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const filtered = machines.filter((machine) => {
      const rangeId = toNullableNumber(machine.plcRangeId || machine.plcConfig?.rangeId);
      const rangeName = rangeId ? rangeById[rangeId]?.rangeName || "" : "";

      const searchFields = [
        machine.machineName,
        machine.lineName,
        machine.operationNo,
        String(machine.sequenceNo ?? ""),
        machine.plcIp,
        machine.plcProtocol,
        machine.plcRangeId,
        rangeName,
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
  }, [lineFilter, machines, rangeById, searchTerm, sortConfig.direction, sortConfig.key, statusFilter]);

  const handleEdit = (machine) => {
    setEditingMachine(machine);
    setFormData(buildFormFromMachine(machine));
    setRangeRegisters(null);
    setRangeRegistersError("");
    setShowModal(true);
  };

  const updateField = (key, value) => {
    if (key === "operationNo") {
      setFormData((prev) => ({ ...prev, [key]: String(value).toUpperCase() }));
      return;
    }

    if (key === "plcProtocol") {
      const normalized = String(value || "").toUpperCase();
      setFormData((prev) => {
        if (normalized === "MODBUS_TCP") {
          const candidateRanges = activeRanges.filter(
            (row) => String(row.plcIp || "").trim() === String(prev.plcIp || "").trim()
          );
          const range =
            rangeById[toNullableNumber(prev.plcRangeId)] ||
            candidateRanges[0] ||
            activeRanges[0] ||
            null;
          return {
            ...prev,
            plcProtocol: normalized,
            plcIp: range?.plcIp || "",
            plcPort: toFormValue(range?.plcPort, ""),
            plcRangeId: range ? String(range.id) : "",
            plcConfig: {
              ...(prev.plcConfig || {}),
              rangeId: range ? String(range.id) : "",
            },
          };
        }

        return {
          ...prev,
          plcProtocol: normalized,
          plcRangeId: "",
          plcConfig: clearRangeAssignments(prev.plcConfig),
        };
      });
      return;
    }

    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const updatePlcConfigField = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      plcConfig: {
        ...(prev.plcConfig || {}),
        [key]: value,
      },
    }));
  };

  const updateSelectedPlcIp = (ipValue) => {
    const normalizedIp = String(ipValue || "").trim();
    const candidateRanges = activeRanges.filter((row) => String(row.plcIp || "").trim() === normalizedIp);
    const currentRangeId = toNullableNumber(formData.plcRangeId);
    const currentRange =
      currentRangeId && candidateRanges.some((entry) => Number(entry.id) === currentRangeId)
        ? candidateRanges.find((entry) => Number(entry.id) === currentRangeId)
        : null;
    const nextRange = currentRange || candidateRanges[0] || null;

    setFormData((prev) => ({
      ...prev,
      plcIp: normalizedIp,
      plcPort: toFormValue(nextRange?.plcPort, ""),
      plcRangeId: nextRange ? String(nextRange.id) : "",
      plcConfig: {
        ...clearRangeAssignments(prev.plcConfig),
        rangeId: nextRange ? String(nextRange.id) : "",
      },
    }));

    setRangeRegisters(null);
    setRangeRegistersError("");
  };

  const updateSelectedRange = (rangeId) => {
    const range = rangeById[toNullableNumber(rangeId)] || null;
    setFormData((prev) => ({
      ...prev,
      plcRangeId: rangeId,
      plcProtocol: String(range?.plcProtocol || "MODBUS_TCP").toUpperCase(),
      plcIp: range?.plcIp || "",
      plcPort: toFormValue(range?.plcPort, ""),
      plcConfig: {
        ...clearRangeAssignments(prev.plcConfig),
        rangeId,
      },
    }));

    setRangeRegisters(null);
    setRangeRegistersError("");
  };

  const getRoleRegisterOptions = useCallback(
    (roleKey) => {
      const selectedRangeId = toNullableNumber(formData.plcRangeId);
      if (!selectedRangeId) {
        return [];
      }

      const rangeRow = rangeById[selectedRangeId] || null;
      const fallbackRegisters = [];
      if (rangeRow) {
        for (let registerNo = rangeRow.rangeStart; registerNo <= rangeRow.rangeEnd; registerNo += 1) {
          fallbackRegisters.push(registerNo);
        }
      }

      const baseSet = new Set(
        ((rangeRegisters?.availableRegisters || []).length > 0 ? rangeRegisters.availableRegisters : fallbackRegisters)
          .map((entry) => Number(entry))
          .filter((entry) => Number.isFinite(entry))
      );

      const current = toNullableNumber(formData.plcConfig?.[roleKey]);
      if (current !== null) {
        baseSet.add(current);
      }

      const usedByOtherRoles = new Set(
        MACHINE_REGISTER_ROLE_FIELDS.filter((entry) => entry.key !== roleKey)
          .map((entry) => toNullableNumber(formData.plcConfig?.[entry.key]))
          .filter((entry) => entry !== null)
      );

      return Array.from(baseSet)
        .filter((registerNo) => registerNo === current || !usedByOtherRoles.has(registerNo))
        .sort((a, b) => a - b);
    },
    [formData.plcConfig, formData.plcRangeId, rangeById, rangeRegisters]
  );

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

    if (key === "plcRangeId") {
      const rangeId = toNullableNumber(machine.plcRangeId || machine.plcConfig?.rangeId);
      const range = rangeId ? rangeById[rangeId] : null;

      if (String(machine.plcProtocol || "").toUpperCase() !== "MODBUS_TCP") {
        return <span className="text-text-muted text-xs">N/A</span>;
      }

      if (!rangeId) {
        return <span className="text-danger text-xs">Not linked</span>;
      }

      return (
        <span className="text-text-main text-xs font-mono">
          {range?.rangeName || `Range #${rangeId}`}
          {range ? ` (${range.rangeStart}-${range.rangeEnd})` : ""}
        </span>
      );
    }

    if (key === "plcConfig") {
      const cfg = machine.plcConfig || null;
      if (!cfg) {
        return <span className="font-mono text-xs text-text-main">-</span>;
      }

      if (String(machine.plcProtocol || "").toUpperCase() !== "MODBUS_TCP") {
        return <span className="font-mono text-xs text-text-main">TCP_TEXT</span>;
      }

      return (
        <span className="font-mono text-xs text-text-main">
          TRG:{cfg.startRegister ?? "-"} | INT:{cfg.statusRegister ?? "-"} | CMP:{cfg.stationRegister ?? "-"} | RST:
          {cfg.resetRegister ?? "-"}
        </span>
      );
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
            <p className="text-text-muted text-sm">Dynamic machine-to-PLC binding with register ownership control</p>
          </div>
        </div>
        <button
          onClick={openCreateModal}
          className="bg-primary hover:brightness-110 text-bg-dark px-5 py-2.5 rounded-xl flex items-center gap-2 font-bold transition-all shadow-lg shadow-primary/10"
        >
          <Plus size={20} /> Add Machine
        </button>
      </header>

      {pageError ? (
        <div className="rounded-xl border border-danger/40 bg-danger/10 text-danger px-4 py-3 text-sm">{pageError}</div>
      ) : null}

      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={20} />
          <input
            type="text"
            placeholder="Search by machine, line, sequence, operation, PLC IP, range..."
            className="w-full bg-bg-card border border-border rounded-xl py-3 pl-10 pr-4 text-text-main focus:border-primary/50 focus:outline-none transition-all"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <select
            value={lineFilter}
            onChange={(event) => setLineFilter(event.target.value)}
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
            onChange={(event) => setStatusFilter(event.target.value)}
            className="bg-bg-card border border-border rounded-xl px-4 py-2 text-text-main focus:border-primary/50 focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>

          <button
            onClick={() => loadMachineContext().catch(() => {})}
            className="p-2 bg-bg-card border border-border rounded-xl hover:border-primary/50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} className="text-text-muted" />
          </button>
        </div>
      </div>

      <div className="industrial-card border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-bg-dark/30 flex items-center justify-between">
          <p className="text-sm font-semibold text-text-main">Machine Handshake Table</p>
          <button
            onClick={downloadMachineSheet}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2 text-xs font-semibold text-text-main hover:border-primary"
          >
            <Download size={14} />
            Download Sheet
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-bg-dark/50 border-b border-border">
              <tr>
                {MACHINE_TABLE_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className={`px-6 py-4 text-left text-xs font-bold uppercase tracking-wider ${
                      column.sortable ? "text-text-muted cursor-pointer hover:text-primary" : "text-text-muted"
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
              <span className="text-danger font-medium">{machines.filter((row) => row.status === "INACTIVE").length}</span>{" "}
              Inactive
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-bg-card border border-border p-8 rounded-3xl w-full max-w-6xl max-h-[90vh] overflow-y-auto"
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
                      onChange={(event) => updateField(field.key, event.target.value)}
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
                      onChange={(event) => updateField(field.key, event.target.value)}
                      required={field.required}
                      placeholder={field.placeholder || ""}
                      className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                    />
                  )}
                </div>
              ))}
            </div>

            {!isModbusProtocol ? (
              <div className="mt-6 border border-border rounded-2xl p-4 bg-bg-dark/40 space-y-4">
                <p className="text-sm font-bold text-text-main uppercase tracking-wide">PLC Binding</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-text-muted uppercase">
                      Select PLC IP <span className="text-primary">*</span>
                    </label>
                    <input
                      value={formData.plcIp}
                      onChange={(event) => updateField("plcIp", event.target.value)}
                      placeholder="192.168.0.10"
                      required
                      className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-text-muted uppercase">
                      Auto Port <span className="text-primary">*</span>
                    </label>
                    <input
                      type="number"
                      value={formData.plcPort}
                      onChange={(event) => updateField("plcPort", event.target.value)}
                      placeholder="502"
                      required
                      className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 border border-border rounded-2xl p-4 bg-bg-dark/40 space-y-5">
                <div>
                  <p className="text-sm font-bold text-text-main uppercase tracking-wide">PLC Binding</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-text-muted uppercase">
                      Select PLC IP <span className="text-primary">*</span>
                    </label>
                    <select
                      value={formData.plcIp}
                      onChange={(event) => updateSelectedPlcIp(event.target.value)}
                      required
                      className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                    >
                      <option value="">Select PLC IP</option>
                      {plcIpOptions.map((ip) => (
                        <option key={ip} value={ip}>
                          {ip}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-text-muted uppercase">Auto Port</label>
                    <input
                      value={formData.plcPort}
                      readOnly
                      className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main outline-none opacity-80"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-text-muted uppercase">
                      Select Register Range <span className="text-primary">*</span>
                    </label>
                    <select
                      value={formData.plcRangeId}
                      onChange={(event) => updateSelectedRange(event.target.value)}
                      required
                      className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                    >
                      <option value="">Select range</option>
                      {selectableRanges.map((range) => (
                        <option key={range.id} value={range.id}>
                          {range.rangeName} ({range.rangeStart}-{range.rangeEnd})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {rangeRegistersError ? (
                  <div className="rounded-xl border border-danger/40 bg-danger/10 text-danger px-3 py-2 text-xs">
                    {rangeRegistersError}
                  </div>
                ) : null}

                <div className="space-y-2">
                  <p className="text-sm font-bold text-text-main uppercase tracking-wide">Handshake Mapping</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {MACHINE_REGISTER_ROLE_FIELDS.map((field) => {
                      const options = getRoleRegisterOptions(field.key);
                      return (
                        <div key={field.key} className="space-y-1">
                          <label className="text-xs font-bold text-text-muted uppercase flex items-center gap-1">
                            {field.label}
                            {field.required && <span className="text-primary">*</span>}
                          </label>
                          <select
                            value={formData.plcConfig?.[field.key] ?? ""}
                            onChange={(event) => updatePlcConfigField(field.key, event.target.value)}
                            required={field.required}
                            disabled={!formData.plcRangeId || selectableRanges.length === 0 || rangeRegistersLoading}
                            className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none disabled:opacity-60"
                          >
                            <option value="">Select register</option>
                            {options.map((registerNo) => (
                              <option key={`${field.key}-${registerNo}`} value={registerNo}>
                                {registerNo}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  {rangeRegistersLoading ? <p className="text-xs text-text-muted">Loading register occupancy...</p> : null}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-bold text-text-main uppercase tracking-wide">Value Mapping</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {MACHINE_MODBUS_TUNING_FIELD_CONFIG.map((field) => (
                      <div key={field.key} className="space-y-1">
                        <label className="text-xs font-bold text-text-muted uppercase flex items-center gap-1">
                          {field.label}
                          {field.required && <span className="text-primary">*</span>}
                        </label>
                        <input
                          type={field.type || "text"}
                          value={formData.plcConfig?.[field.key] ?? ""}
                          onChange={(event) => updatePlcConfigField(field.key, event.target.value)}
                          required={field.required}
                          placeholder={field.placeholder || ""}
                          className="w-full bg-bg-dark border border-border rounded-xl p-3 text-text-main focus:border-primary/50 outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end mt-8 gap-4 pt-6 border-t border-border">
              <button
                type="button"
                onClick={closeModal}
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

export default MachinePage;
