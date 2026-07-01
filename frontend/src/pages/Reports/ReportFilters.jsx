import React, { useState } from "react";
import { Filter, Calendar, Clock, RefreshCw, X, ChevronDown } from "lucide-react";
import { toDatetimeLocal, getShiftInterval } from "../../utils/time";
import PlantLineSelector from "../../components/PlantLineSelector";

const STATUS_OPTIONS = ["OK", "NG", "WIP", "INTERLOCKED"];

const ReportFilters = ({ filters, onFilterChange, onApply, onClear, machines = [], availableShifts = [] }) => {
  const [isOpen, setIsOpen] = useState(true);

  const presets = [
    { label: "Today", key: "today" },
    { label: "Yesterday", key: "yesterday" },
    { label: "Current Shift", key: "current_shift" },
    { label: "Last 7 Days", key: "last7days" },
  ];

  const controlCls = "h-9 w-full rounded-md border border-border bg-white px-3 text-xs font-semibold text-slate-800 outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/10";

  const handlePreset = (key) => {
    const { from, to } = getShiftInterval(key);
    onFilterChange({
      ...filters,
      dateFrom: toDatetimeLocal(from),
      dateTo: toDatetimeLocal(to),
    });
  };

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden mb-4">
      <div
        className="px-4 py-3 border-b border-border bg-white flex items-center justify-between cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-primary" />
          <h2 className="text-sm font-bold text-text-main uppercase tracking-wider">Report Filters</h2>
        </div>
        <ChevronDown size={16} className={`text-text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </div>

      {isOpen && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="datetime-local"
                className={`${controlCls} pl-10`}
                value={filters.dateFrom}
                max={new Date().toISOString().slice(0, 16)}
                onChange={(e) => onFilterChange({ ...filters, dateFrom: e.target.value })}
              />
            </div>
            <div className="relative">
              <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="datetime-local"
                className={`${controlCls} pl-10`}
                value={filters.dateTo}
                max={new Date().toISOString().slice(0, 16)}
                onChange={(e) => onFilterChange({ ...filters, dateTo: e.target.value })}
              />
            </div>
            <input
              type="text"
              placeholder="Part Serial No."
              className={controlCls}
              value={filters.barcode || ""}
              onChange={(e) => onFilterChange({ ...filters, barcode: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <PlantLineSelector
              value={filters}
              onChange={(scope) => onFilterChange({ ...filters, ...scope, machineId: "" })}
              includeAll
              compact
              hideLabels
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2"
              inputClassName={controlCls}
            />
            <select
              className={controlCls}
              value={filters.machineId}
              onChange={(e) => onFilterChange({ ...filters, machineId: e.target.value })}
            >
              <option value="">All Machines</option>
              {machines
                .filter((m) => !filters.plantId || String(m.plantId || m.plant_id || "") === String(filters.plantId))
                .filter((m) => !filters.lineId || String(m.lineId || m.line_id || "") === String(filters.lineId))
                .filter((m) => !filters.lineName || (m.line_name || m.lineName) === filters.lineName)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.machine_name || m.machineName}
                  </option>
                ))}
            </select>
            <select
              className={controlCls}
              value={filters.status || ""}
              onChange={(e) => onFilterChange({ ...filters, status: e.target.value })}
            >
              <option value="">All Status</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              className={controlCls}
              value={filters.shiftCode || ""}
              onChange={(e) => onFilterChange({ ...filters, shiftCode: e.target.value })}
            >
              <option value="">All Shifts</option>
              {(availableShifts || []).map((shift) => (
                <option key={shift.shiftCode} value={shift.shiftCode}>
                  {shift.shiftName || shift.shiftCode}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.key}
                onClick={() => handlePreset(preset.key)}
                className="text-[10px] font-bold px-3 py-1.5 rounded-md bg-slate-50 border border-border text-text-muted hover:border-primary/40 hover:text-primary transition-all"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="pt-4 border-t border-border flex items-center justify-between">
            <button onClick={onClear} className="flex items-center gap-2 text-xs font-bold text-text-muted hover:text-red-500 transition-colors">
              <X size={14} /> Clear Filters
            </button>
            <button
              onClick={onApply}
              className="flex items-center gap-2 bg-primary text-on-primary px-6 py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
            >
              <RefreshCw size={14} /> Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportFilters;
