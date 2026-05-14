import React, { useState } from 'react';
import { Filter, Calendar, Clock, RefreshCw, X, ChevronDown } from 'lucide-react';
import { toDatetimeLocal, getShiftInterval } from '../../utils/time';

const ReportFilters = ({ filters, onFilterChange, onApply, onClear, machines = [] }) => {
  const [isOpen, setIsOpen] = useState(true);

  const presets = [
    { label: 'Today', key: 'today' },
    { label: 'Yesterday', key: 'yesterday' },
    { label: 'Current Shift', key: 'current_shift' },
    { label: 'Last 7 Days', key: 'last7days' },
  ];

  const handlePreset = (key) => {
    const { from, to } = getShiftInterval(key);
    onFilterChange({
      ...filters,
      dateFrom: toDatetimeLocal(from),
      dateTo: toDatetimeLocal(to)
    });
  };

  const lines = [...new Set(machines.map(m => m.line_name || m.lineName).filter(Boolean))];

  return (
    <div className="bg-bg-card border border-border rounded-xl shadow-sm overflow-hidden mb-6">
      <div 
        className="px-6 py-4 border-b border-border bg-bg-dark/30 flex items-center justify-between cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-primary" />
          <h2 className="text-sm font-bold text-text-main uppercase tracking-wider">Industrial Filter Engine</h2>
          <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20 ml-2">
            Audit-Ready
          </span>
        </div>
        <ChevronDown size={16} className={`text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {isOpen && (
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Date Range Section */}
            <div className="lg:col-span-2 space-y-4">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest block">Date & Time Interval</label>
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
                    <Calendar size={14} />
                  </div>
                  <input 
                    type="datetime-local" 
                    className="w-full bg-bg-dark border border-border rounded-lg pl-10 pr-3 py-2.5 text-xs text-text-main outline-none focus:border-primary/50 transition-all"
                    value={filters.dateFrom}
                    max={new Date().toISOString().slice(0, 16)}
                    onChange={(e) => onFilterChange({ ...filters, dateFrom: e.target.value })}
                  />
                </div>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
                    <Clock size={14} />
                  </div>
                  <input 
                    type="datetime-local" 
                    className="w-full bg-bg-dark border border-border rounded-lg pl-10 pr-3 py-2.5 text-xs text-text-main outline-none focus:border-primary/50 transition-all"
                    value={filters.dateTo}
                    max={new Date().toISOString().slice(0, 16)}
                    onChange={(e) => onFilterChange({ ...filters, dateTo: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map(p => (
                  <button 
                    key={p.label}
                    onClick={() => handlePreset(p.key)}
                    className="text-[10px] font-bold px-3 py-1.5 rounded-md bg-bg-dark border border-border text-text-muted hover:border-primary/40 hover:text-primary transition-all"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Industrial Scoping */}
            <div className="space-y-4">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest block">Manufacturing Scope</label>
              <div className="space-y-3">
                <select 
                  className="w-full bg-bg-dark border border-border rounded-lg px-3 py-2.5 text-xs text-text-main outline-none focus:border-primary/50 transition-all"
                  value={filters.lineName}
                  onChange={(e) => onFilterChange({ ...filters, lineName: e.target.value, machineId: '' })}
                >
                  <option value="">All Production Lines</option>
                  {lines.map(l => <option key={l} value={l}>{l}</option>)}
                </select>

                <select 
                  className="w-full bg-bg-dark border border-border rounded-lg px-3 py-2.5 text-xs text-text-main outline-none focus:border-primary/50 transition-all"
                  value={filters.machineId}
                  onChange={(e) => onFilterChange({ ...filters, machineId: e.target.value })}
                >
                  <option value="">All Machines (Machine-Wise)</option>
                  {machines.filter(m => !filters.lineName || (m.line_name || m.lineName) === filters.lineName).map(m => (
                    <option key={m.id} value={m.id}>{m.machine_name || m.machineName}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quality & Model */}
            <div className="space-y-4">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest block">Quality & Analytics</label>
              <div className="space-y-3">
                <select 
                  className="w-full bg-bg-dark border border-border rounded-lg px-3 py-2.5 text-xs text-text-main outline-none focus:border-primary/50 transition-all"
                  value={filters.resultType}
                  onChange={(e) => onFilterChange({ ...filters, resultType: e.target.value })}
                >
                  <option value="">All Result Types</option>
                  <option value="OK">Passed (OK)</option>
                  <option value="NG">Failed (NG)</option>
                  <option value="VALIDATION">Validation Rejects</option>
                </select>

                <input 
                  type="text"
                  placeholder="Operation No / Model Code"
                  className="w-full bg-bg-dark border border-border rounded-lg px-3 py-2.5 text-xs text-text-main outline-none focus:border-primary/50 transition-all placeholder:text-text-muted/40"
                  value={filters.modelCode}
                  onChange={(e) => onFilterChange({ ...filters, modelCode: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-border flex items-center justify-between">
            <button 
              onClick={onClear}
              className="flex items-center gap-2 text-xs font-bold text-text-muted hover:text-red-500 transition-colors"
            >
              <X size={14} /> Clear All Filters
            </button>
            <div className="flex items-center gap-3">
              <button 
                onClick={onApply}
                className="flex items-center gap-2 bg-primary text-on-primary px-6 py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
              >
                <RefreshCw size={14} /> Apply Analytics Filter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportFilters;
