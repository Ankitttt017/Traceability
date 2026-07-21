import React, { useState, useEffect, useRef } from "react";
import { Filter, Calendar, Clock, RefreshCw, X, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { toDatetimeLocal } from "../../utils/time";
import PlantLineSelector from "../../components/PlantLineSelector";

const STATUS_OPTIONS = ["OK", "NG", "WIP", "INTERLOCKED"];

// ── Custom Date Range Picker ──────────────────────────────────────────────
const DateRangePicker = ({ startDate, endDate, onApply, onClear }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [tempStart, setTempStart] = useState(null);
  const [tempEnd, setTempEnd] = useState(null);
  const pickerRef = useRef(null);

  // Initialize dates when props change
  useEffect(() => {
    if (startDate) {
      const start = new Date(startDate);
      setTempStart(start);
    } else {
      setTempStart(null);
    }
    if (endDate) {
      const end = new Date(endDate);
      setTempEnd(end);
    } else {
      setTempEnd(null);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatDateDisplay = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const handleDayClick = (day, month, year) => {
    const clickedDate = new Date(year, month, day);
    clickedDate.setHours(0, 0, 0, 0);

    if (!tempStart || (tempStart && tempEnd)) {
      // Start new selection
      setTempStart(clickedDate);
      setTempEnd(null);
    } else if (tempStart && !tempEnd) {
      // Complete selection
      if (clickedDate < tempStart) {
        setTempStart(clickedDate);
        setTempEnd(tempStart);
      } else {
        setTempEnd(clickedDate);
      }
    }
  };

  const handleApply = () => {
    if (tempStart) {
      const end = tempEnd || tempStart;
      const formattedStart = new Date(tempStart);
      formattedStart.setHours(0, 0, 0, 0);
      const formattedEnd = new Date(end);
      formattedEnd.setHours(23, 59, 59, 999);
      onApply(formattedStart, formattedEnd);
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    setTempStart(null);
    setTempEnd(null);
    onClear();
    setIsOpen(false);
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const days = [];
    const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    weekdays.forEach((day) => {
      days.push(
        <div key={`weekday-${day}`} className="text-center text-[9px] font-bold uppercase tracking-wider text-[rgba(var(--pk-txt-muted),0.6)] py-1">
          {day}
        </div>
      );
    });

    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} />);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      date.setHours(0, 0, 0, 0);
      const isToday = date.getTime() === today.getTime();
      const isStart = tempStart && date.getTime() === tempStart.getTime();
      const isEnd = tempEnd && date.getTime() === tempEnd.getTime();
      const isInRange = tempStart && tempEnd && date > tempStart && date < tempEnd;

      let className = "w-8 h-8 rounded-lg text-xs font-semibold transition-all duration-150 hover:bg-[rgba(var(--pk-steel),0.08)] flex items-center justify-center cursor-pointer";
      
      if (isToday) className += " border-2 border-[rgba(var(--pk-amber),0.4)]";
      
      if (isStart || isEnd) {
        if (isStart && isEnd) {
          className += " bg-gradient-to-br from-[rgb(var(--pk-navy))] to-[rgb(var(--pk-steel))] text-[rgb(var(--pk-linen))] shadow-md shadow-[rgba(var(--pk-navy),0.25)] rounded-lg";
        } else if (isStart) {
          className += " bg-gradient-to-br from-[rgb(var(--pk-navy))] to-[rgb(var(--pk-steel))] text-[rgb(var(--pk-linen))] shadow-md shadow-[rgba(var(--pk-navy),0.25)] rounded-r-none";
        } else if (isEnd) {
          className += " bg-gradient-to-br from-[rgb(var(--pk-navy))] to-[rgb(var(--pk-steel))] text-[rgb(var(--pk-linen))] shadow-md shadow-[rgba(var(--pk-navy),0.25)] rounded-l-none";
        }
      }
      
      if (isInRange) className += " bg-[rgba(var(--pk-steel),0.1)] rounded-none";

      days.push(
        <button
          key={`day-${day}`}
          className={className}
          onClick={() => handleDayClick(day, month, year)}
        >
          {day}
        </button>
      );
    }

    return days;
  };

  const dateRangeText = tempStart && tempEnd
    ? `${formatDateDisplay(tempStart)} - ${formatDateDisplay(tempEnd)}`
    : tempStart
    ? formatDateDisplay(tempStart)
    : "Select Date Range";

  return (
    <div className="relative" ref={pickerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="h-9 w-full rounded-lg border border-[rgba(var(--pk-bdr),0.2)] bg-[rgb(var(--pk-bg-input))] px-3 text-xs font-semibold text-[rgb(var(--pk-txt-pri))] outline-none transition-all focus:border-[rgba(var(--pk-steel),0.5)] focus:ring-2 focus:ring-[rgba(var(--pk-steel),0.08)] flex items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2 truncate">
          <Calendar size={14} className="text-[rgba(var(--pk-txt-muted),0.6)] flex-shrink-0" />
          <span className={tempStart ? "text-[rgb(var(--pk-txt-pri))]" : "text-[rgba(var(--pk-txt-muted),0.6)]"}>
            {dateRangeText}
          </span>
        </span>
        <ChevronDown size={14} className={`text-[rgba(var(--pk-txt-muted),0.6)] transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 bg-[rgb(var(--pk-bg-card))] border border-[rgba(var(--pk-bdr),0.15)] rounded-xl shadow-xl shadow-[rgba(var(--pk-navy),0.12)] p-4 z-50 min-w-[280px] max-w-[340px]">
          <div className="flex items-center justify-between mb-3">
            <button 
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
              className="w-7 h-7 rounded-lg border border-[rgba(var(--pk-bdr),0.1)] hover:bg-[rgba(var(--pk-steel),0.06)] transition-all flex items-center justify-center text-[rgb(var(--pk-txt-sec))]"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-bold text-[rgb(var(--pk-txt-pri))]">
              {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
            <button 
              onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
              className="w-7 h-7 rounded-lg border border-[rgba(var(--pk-bdr),0.1)] hover:bg-[rgba(var(--pk-steel),0.06)] transition-all flex items-center justify-center text-[rgb(var(--pk-txt-sec))]"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          
          <div className="grid grid-cols-7 gap-1">
            {renderCalendar()}
          </div>

          <div className="flex gap-2 mt-4 pt-4 border-t border-[rgba(var(--pk-bdr),0.08)]">
            <button 
              onClick={handleClear}
              className="flex-1 h-8 rounded-lg border border-[rgba(var(--pk-ng),0.15)] bg-[rgba(var(--pk-ng),0.04)] text-[rgb(var(--pk-ng))] text-xs font-bold hover:bg-[rgba(var(--pk-ng),0.08)] transition-all"
            >
              Clear
            </button>
            <button 
              onClick={handleApply}
              className="flex-1 h-8 rounded-lg bg-gradient-to-r from-[rgb(var(--pk-navy))] to-[rgb(var(--pk-steel))] text-[rgb(var(--pk-linen))] text-xs font-bold shadow-md shadow-[rgba(var(--pk-navy),0.2)] hover:shadow-lg transition-all"
            >
              Apply Range
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Main Filters Component ────────────────────────────────────────────────
const ReportFilters = ({ filters, onFilterChange, onApply, onClear, machines = [], availableShifts = [] }) => {
  const [isOpen, setIsOpen] = useState(true);

  const presets = [
    { label: "Today", key: "today" },
    { label: "Yesterday", key: "yesterday" },
    { label: "Current Shift", key: "current_shift" },
    { label: "Last 7 Days", key: "last7days" },
  ];

  const controlCls = "h-9 w-full rounded-lg border border-[rgba(var(--pk-bdr),0.2)] bg-[rgb(var(--pk-bg-input))] px-3 text-xs font-semibold text-[rgb(var(--pk-txt-pri))] outline-none transition-all focus:border-[rgba(var(--pk-steel),0.5)] focus:ring-2 focus:ring-[rgba(var(--pk-steel),0.08)]";

  const handlePreset = (key) => {
    const now = new Date();
    let from = new Date(now);
    let to = new Date(now);

    switch(key) {
      case 'today':
        from.setHours(6, 0, 0, 0);
        if (now < from) from.setDate(from.getDate() - 1);
        to = new Date(from);
        to.setDate(to.getDate() + 1);
        break;
      case 'yesterday':
        from.setHours(6, 0, 0, 0);
        if (now < from) from.setDate(from.getDate() - 1);
        from.setDate(from.getDate() - 1);
        to = new Date(from);
        to.setDate(to.getDate() + 1);
        break;
      case 'current_shift':
        const shiftStart = new Date(now);
        shiftStart.setHours(6, 0, 0, 0);
        if (now < shiftStart) shiftStart.setDate(shiftStart.getDate() - 1);
        const shiftEnd = new Date(shiftStart);
        shiftEnd.setDate(shiftEnd.getDate() + 1);
        from = shiftStart;
        to = shiftEnd;
        break;
      case 'last7days':
        from.setDate(from.getDate() - 7);
        break;
      case 'last14days':
        from.setDate(from.getDate() - 14);
        break;
      default:
        from.setDate(from.getDate() - 7);
    }

    onFilterChange({
      ...filters,
      dateFrom: toDatetimeLocal(from),
      dateTo: toDatetimeLocal(to),
    });
  };

  const handleDateRangeApply = (start, end) => {
    onFilterChange({
      ...filters,
      dateFrom: toDatetimeLocal(start),
      dateTo: toDatetimeLocal(end),
    });
  };

  const handleDateRangeClear = () => {
    onFilterChange({
      ...filters,
      dateFrom: '',
      dateTo: '',
    });
  };

  // Count active filters
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => {
    if (['dateFrom', 'dateTo'].includes(key)) return false;
    return value && String(value).trim();
  }).length;

  return (
    <div className="bg-[rgb(var(--pk-bg-card))] border border-[rgba(var(--pk-bdr),var(--pk-bop))] rounded-xl shadow-sm shadow-[rgba(var(--pk-navy),0.04)] overflow-hidden mb-4 transition-all">
      <div
        className="px-5 py-3.5 border-b border-[rgba(var(--pk-bdr),0.08)] flex items-center justify-between cursor-pointer hover:bg-[rgba(var(--pk-steel),0.02)] transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2.5">
          <Filter size={16} className="text-[rgb(var(--pk-steel))]" />
          <h2 className="text-sm font-bold text-[rgb(var(--pk-txt-pri))] uppercase tracking-wider">Report Filters</h2>
          <span className="text-[10px] font-bold text-[rgb(var(--pk-txt-muted))] bg-[rgba(var(--pk-bdr),0.06)] px-2 py-0.5 rounded-full border border-[rgba(var(--pk-bdr),0.06)]">
            {activeFilterCount} active
          </span>
        </div>
        <ChevronDown size={16} className={`text-[rgb(var(--pk-txt-muted))] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </div>

      {isOpen && (
        <div className="p-5 space-y-4">
          {/* Date Range & Quick Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <DateRangePicker
              startDate={filters.dateFrom}
              endDate={filters.dateTo}
              onApply={handleDateRangeApply}
              onClear={handleDateRangeClear}
            />
            
            <div className="flex flex-wrap gap-1.5 lg:col-span-2">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => handlePreset(preset.key)}
                  className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-[rgba(var(--pk-steel),0.05)] border border-[rgba(var(--pk-bdr),0.1)] text-[rgb(var(--pk-txt-sec))] hover:border-[rgba(var(--pk-steel),0.3)] hover:bg-[rgba(var(--pk-steel),0.08)] transition-all"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="🔍 Part Serial No."
              className={controlCls}
              value={filters.barcode || ""}
              onChange={(e) => onFilterChange({ ...filters, barcode: e.target.value })}
            />
          </div>

          {/* Main Filters Grid */}
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
              <option value="">⚙️ All Machines</option>
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
              <option value="">📊 All Status</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status === "OK" ? "✅ PASSED" : status === "NG" ? "❌ FAILED" : status === "WIP" ? "⏳ WIP" : "🔒 INTERLOCKED"}
                </option>
              ))}
            </select>
            <select
              className={controlCls}
              value={filters.shiftCode || ""}
              onChange={(e) => onFilterChange({ ...filters, shiftCode: e.target.value })}
            >
              <option value="">🕐 All Shifts</option>
              {(availableShifts || []).map((shift) => (
                <option key={shift.shiftCode} value={shift.shiftCode}>
                  {shift.shiftName || shift.shiftCode}
                </option>
              ))}
            </select>
          </div>

          {/* Active Filters Summary */}
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-3 border-t border-[rgba(var(--pk-bdr),0.06)]">
              {Object.entries(filters)
                .filter(([key, value]) => value && String(value).trim() && !['dateFrom', 'dateTo'].includes(key))
                .slice(0, 6)
                .map(([key, value]) => (
                  <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-[rgba(var(--pk-steel),0.06)] border border-[rgba(var(--pk-steel),0.1)] text-[rgb(var(--pk-txt-sec))]">
                    <span className="opacity-50">{key}:</span> {String(value).slice(0, 25)}
                  </span>
                ))}
              {Object.entries(filters)
                .filter(([key, value]) => value && String(value).trim() && !['dateFrom', 'dateTo'].includes(key))
                .length > 6 && (
                  <span className="text-[10px] text-[rgb(var(--pk-txt-muted))] font-medium">
                    +{Object.entries(filters).filter(([key, value]) => value && String(value).trim() && !['dateFrom', 'dateTo'].includes(key)).length - 6} more
                  </span>
                )}
              {filters.dateFrom && filters.dateTo && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-[rgba(var(--pk-amber),0.08)] border border-[rgba(var(--pk-amber),0.15)] text-[rgb(var(--pk-amber))]">
                  <Calendar size={10} /> {new Date(filters.dateFrom).toLocaleDateString()} → {new Date(filters.dateTo).toLocaleDateString()}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="pt-3 border-t border-[rgba(var(--pk-bdr),0.08)] flex items-center justify-between flex-wrap gap-3">
            <button 
              onClick={onClear} 
              className="flex items-center gap-2 text-xs font-bold text-[rgb(var(--pk-txt-muted))] hover:text-[rgb(var(--pk-ng))] transition-colors px-3 py-1.5 rounded-lg hover:bg-[rgba(var(--pk-ng),0.05)]"
            >
              <X size={14} /> Clear Filters
            </button>
            <button
              onClick={onApply}
              className="flex items-center gap-2 bg-gradient-to-r from-[rgb(var(--pk-navy))] to-[rgb(var(--pk-steel))] text-[rgb(var(--pk-linen))] px-6 py-2.5 rounded-lg text-xs font-bold shadow-md shadow-[rgba(var(--pk-navy),0.2)] hover:shadow-lg hover:brightness-110 active:scale-95 transition-all"
            >
              <RefreshCw size={14} /> Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportFilters;