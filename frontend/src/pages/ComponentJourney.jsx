// ============================================================
//  ComponentJourney.jsx — IndusTrace Professional Edition
//  ✅ Professional Navy/Steel/Amber theme
//  ✅ Working custom date range picker with emojis
//  ✅ Responsive design
//  ✅ Clean, attractive UI with proper emojis
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import {
  AlertTriangle, CheckCircle2, Clock3, RefreshCw, RotateCcw,
  Search, X, XCircle, Activity, Layers, ChevronRight,
  MapPin, Zap, Package, QrCode, Trash2, Download,
  Calendar, ChevronDown, ChevronLeft, ChevronRight as ChevronRightIcon,
  Sparkles, TrendingUp, Shield, Award, Target, Anchor,
} from "lucide-react";
import { machineApi, shiftApi, stationSettingsApi, traceabilityApi } from "../api/services";
import { SOCKET_OPTIONS, SOCKET_URL } from "../constants/network";
import {
  getStationFeatureSettings, getStationFeatures, saveStationFeatureSettings,
} from "../utils/stationSettings";

// ── Constants ──────────────────────────────────────────────────────────────
const REALTIME_REFRESH_COOLDOWN = 350;
const FALLBACK_POLL_INTERVAL    = 30000;
const CATALOG_SYNC_INTERVAL     = 60000;
const QR_DEDUPE_MS              = 3000;

const toLocalDateTimeInput = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const getProductionDateRange = (startDate, endDate = startDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate || startDate);
  start.setHours(6, 0, 0, 0);
  end.setHours(6, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const getCurrentProductionDateRange = (anchor = new Date()) => {
  const start = new Date(anchor);
  start.setHours(6, 0, 0, 0);
  if (anchor < start) start.setDate(start.getDate() - 1);
  const end = new Date(anchor);
  return { start, end };
};

// ── Professional Theme ────────────────────────────────────────────────────
const THEME_STYLES = `
  :root {
    --navy: 26,50,99; --steel: 84,119,146;
    --amber: 250,185,91; --linen: 232,226,219;
    --ok: 34,197,94; --ng: 239,68,68;
    --wip: 249,115,22; --idle: 148,163,184;
    --gold: 218,165,32; --purple: 139,92,246;
  }
  [data-theme="light"] {
    --bg-base: 248,250,252; --bg-surface: 241,244,248;
    --bg-card: 255,255,255; --bg-input: 255,255,255;
    --bg-hover: 232,236,242;
    --txt-primary: 26,50,99; --txt-secondary: 84,119,146;
    --txt-muted: 148,163,184;
    --border: 84,119,146; --border-op: 0.12;
    --shadow: 0 2px 16px rgba(26,50,99,0.06),0 1px 4px rgba(26,50,99,0.04);
    --shadow-md: 0 8px 32px rgba(26,50,99,0.10),0 2px 8px rgba(26,50,99,0.06);
    --shadow-lg: 0 16px 48px rgba(26,50,99,0.14),0 4px 16px rgba(26,50,99,0.08);
  }
  [data-theme="dark"] {
    --bg-base: 10,18,36; --bg-surface: 16,26,50;
    --bg-card: 20,34,62; --bg-input: 14,22,44;
    --bg-hover: 26,42,74;
    --txt-primary: 232,226,219; --txt-secondary: 160,190,210;
    --txt-muted: 84,119,146;
    --border: 84,119,146; --border-op: 0.18;
    --shadow: 0 2px 16px rgba(0,0,0,0.25),0 1px 4px rgba(0,0,0,0.2);
    --shadow-md: 0 8px 32px rgba(0,0,0,0.35),0 2px 8px rgba(0,0,0,0.25);
    --shadow-lg: 0 16px 48px rgba(0,0,0,0.45),0 4px 16px rgba(0,0,0,0.3);
  }
  .cj-container { animation: cjFadeIn 0.4s ease; }
  .cj-gradient-bar {
    height: 3px;
    background: linear-gradient(90deg, rgb(var(--navy)), rgb(var(--steel)), rgb(var(--amber)), rgb(var(--steel)), rgb(var(--navy)));
    background-size: 200% 100%;
    animation: cjShimmer 3s ease-in-out infinite;
  }
  @keyframes cjFadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  @keyframes cjShimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
  @keyframes cjSpin { to { transform: rotate(360deg); } }
  @keyframes cjPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes cjSlideIn { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
  @keyframes cjScale { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }
  @keyframes cjGlow { 0%,100% { box-shadow: 0 0 20px rgba(250,185,91,0.1); } 50% { box-shadow: 0 0 40px rgba(250,185,91,0.2); } }
  
  .cj-card {
    background: rgb(var(--bg-card));
    border: 1px solid rgba(var(--border), var(--border-op));
    border-radius: 14px;
    box-shadow: var(--shadow);
    transition: all 0.25s ease;
  }
  .cj-card:hover { box-shadow: var(--shadow-md); }
  
  .cj-filter-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px; border-radius: 99px;
    font-size: 10px; font-weight: 700;
    background: rgba(84,119,146,0.08);
    border: 1px solid rgba(84,119,146,0.15);
    color: rgb(84,119,146);
    transition: all 0.15s ease;
  }
  .cj-filter-chip:hover { background: rgba(84,119,146,0.15); border-color: rgba(84,119,146,0.3); }
  .cj-filter-chip .remove { cursor: pointer; opacity: 0.5; transition: opacity 0.15s ease; margin-left: 2px; }
  .cj-filter-chip .remove:hover { opacity: 1; color: rgb(239,68,68); }
  .cj-filter-chip.date-chip { background: rgba(250,185,91,0.12); border-color: rgba(250,185,91,0.25); color: rgb(250,185,91); }
  
  .cj-preset-btn {
    padding: 6px 14px; border-radius: 8px;
    border: 1px solid rgba(84,119,146,0.2);
    background: transparent;
    color: rgb(84,119,146);
    font-size: 10px; font-weight: 600;
    cursor: pointer; transition: all 0.15s ease;
    white-space: nowrap;
  }
  .cj-preset-btn:hover { border-color: rgb(84,119,146); background: rgba(84,119,146,0.08); }
  .cj-preset-btn.active { border-color: rgb(26,50,99); background: rgb(26,50,99); color: #fff; font-weight: 800; }
  
  .cj-filter-select {
    width: 100%; min-height: 38px; border-radius: 10px;
    border: 1px solid rgba(84,119,146,0.2);
    background: #ffffff; color: rgb(26,50,99);
    padding: 8px 14px; font-size: 12px; font-weight: 600;
    outline: none; transition: all 0.15s ease;
    cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .cj-filter-select:focus { border-color: rgb(84,119,146); box-shadow: 0 0 0 3px rgba(84,119,146,0.1); }
  .cj-filter-input {
    width: 100%; min-height: 38px; border-radius: 10px;
    border: 1px solid rgba(84,119,146,0.2);
    background: #ffffff; color: rgb(26,50,99);
    padding: 8px 14px; font-size: 12px; font-weight: 600;
    outline: none; transition: all 0.15s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .cj-filter-input:focus { border-color: rgb(84,119,146); box-shadow: 0 0 0 3px rgba(84,119,146,0.1); }
  .cj-filter-input::placeholder { color: rgba(84,119,146,0.5); font-weight: 400; }

  .reports-filter-input {
    width: 100%;
    height: 36px;
    min-width: 0;
    border-radius: 8px;
    border: 1px solid rgba(var(--border), 0.2);
    background: rgb(var(--bg-input));
    padding: 0 12px;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--txt-primary));
    outline: none;
    transition: all 0.15s ease;
  }
  .reports-filter-input:focus {
    border-color: rgba(var(--steel), 0.5);
    box-shadow: 0 0 0 3px rgba(var(--steel), 0.08);
  }
  .reports-filter-input::placeholder {
    color: rgba(var(--txt-muted), 0.6);
    font-weight: 400;
  }

  .date-picker-container {
    position: relative;
    animation: cjScale 0.2s ease;
  }
  .date-picker-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    background: rgb(var(--bg-card));
    border: 1px solid rgba(var(--border), 0.2);
    border-radius: 12px;
    box-shadow: 0 12px 48px rgba(var(--navy), 0.15), 0 2px 8px rgba(var(--navy), 0.06);
    padding: 16px;
    z-index: 1000;
    min-width: 280px;
    max-width: 340px;
    animation: cjScale 0.2s ease;
  }
  .date-picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .date-picker-header button {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid rgba(var(--border), 0.1);
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgb(var(--txt-secondary));
    transition: all 0.15s ease;
  }
  .date-picker-header button:hover {
    background: rgba(var(--steel), 0.08);
    border-color: rgba(var(--steel), 0.2);
  }
  .date-picker-header span {
    font-size: 13px;
    font-weight: 700;
    color: rgb(var(--txt-primary));
  }
  .date-picker-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 3px;
  }
  .date-picker-weekday {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(var(--txt-muted), 0.7);
    padding: 4px 0;
    text-align: center;
  }
  .date-picker-day {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    color: rgb(var(--txt-primary));
    cursor: pointer;
    transition: all 0.12s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  .date-picker-day:hover { background: rgba(var(--steel), 0.08); }
  .date-picker-day.selected {
    background: linear-gradient(135deg, rgb(var(--navy)), rgb(var(--steel)));
    color: rgb(var(--linen));
    box-shadow: 0 2px 8px rgba(var(--navy), 0.25);
  }
  .date-picker-day.in-range {
    background: rgba(var(--steel), 0.12);
    color: rgb(var(--txt-primary));
  }
  .date-picker-day.range-start {
    background: linear-gradient(135deg, rgb(var(--navy)), rgb(var(--steel)));
    color: rgb(var(--linen));
    box-shadow: 0 2px 8px rgba(var(--navy), 0.25);
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .date-picker-day.range-end {
    background: linear-gradient(135deg, rgb(var(--navy)), rgb(var(--steel)));
    color: rgb(var(--linen));
    box-shadow: 0 2px 8px rgba(var(--navy), 0.25);
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .date-picker-day.range-middle {
    background: rgba(var(--steel), 0.12);
    border-radius: 0;
  }
  .date-picker-day.other-month { color: rgba(var(--txt-muted), 0.3); }
  .date-picker-day.today { border: 2px solid rgba(var(--amber), 0.4); }
  .date-picker-day.today.selected,
  .date-picker-day.today.range-start,
  .date-picker-day.today.range-end {
    border-color: rgba(var(--linen), 0.3);
  }
  .date-picker-footer {
    display: flex;
    gap: 6px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid rgba(var(--border), 0.08);
  }
  .date-picker-footer button {
    flex: 1;
    height: 30px;
    border-radius: 6px;
    border: none;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .date-picker-footer .clear-btn {
    background: rgba(var(--ng), 0.06);
    color: rgb(var(--ng));
    border: 1px solid rgba(var(--ng), 0.1);
  }
  .date-picker-footer .clear-btn:hover { background: rgba(var(--ng), 0.12); }
  .date-picker-footer .apply-btn {
    background: linear-gradient(135deg, rgb(var(--navy)), rgb(var(--steel)));
    color: rgb(var(--linen));
  }
  .date-picker-footer .apply-btn:hover { opacity: 0.9; }
  
  .cj-btn-clear {
    display: inline-flex; align-items: center; gap: 6px;
    min-height: 38px; padding: 0 16px; border-radius: 10px;
    border: 1px solid rgba(239,68,68,0.25);
    background: rgba(239,68,68,0.05);
    color: rgb(239,68,68);
    font-size: 12px; font-weight: 700;
    cursor: pointer; transition: all 0.15s ease;
  }
  .cj-btn-clear:hover { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.4); }
  
  .cj-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 99px;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.04em;
  }
  
  @media (max-width: 992px) { .cj-main-layout { grid-template-columns: 1fr !important; } }
  @media (max-width: 768px) {
    .cj-filters-grid { grid-template-columns: 1fr 1fr !important; }
    .cj-date-row { grid-template-columns: 1fr !important; }
    .cj-date-presets { justify-content: flex-start !important; }
    .date-picker-dropdown { left: -50%; min-width: 260px; }
    .cj-parts-list { max-height: 300px !important; position: relative !important; top: 0 !important; }
    .cj-timeline { max-height: 500px !important; }
    .cj-header-stats { grid-template-columns: 1fr 1fr !important; }
  }
  @media (max-width: 480px) {
    .cj-filters-grid { grid-template-columns: 1fr !important; }
    .cj-date-row { grid-template-columns: 1fr !important; }
    .cj-header-stats { grid-template-columns: 1fr !important; }
    .date-picker-dropdown { left: -100%; min-width: 240px; max-width: 280px; }
    .date-picker-day { width: 28px; height: 28px; font-size: 11px; }
  }
`;

let themeInjected = false;
function injectTheme() {
  if (themeInjected) return; themeInjected = true;
  const s = document.createElement("style"); s.textContent = THEME_STYLES; document.head.appendChild(s);
  if (!document.documentElement.hasAttribute("data-theme"))
    document.documentElement.setAttribute("data-theme","dark");
}

// ── Color System ──────────────────────────────────────────────────────────
const C = {
  navy: (o=1) => `rgba(var(--navy),${o})`,
  steel: (o=1) => `rgba(var(--steel),${o})`,
  amber: (o=1) => `rgba(var(--amber),${o})`,
  linen: (o=1) => `rgba(var(--linen),${o})`,
  ok: (o=1) => `rgba(var(--ok),${o})`,
  ng: (o=1) => `rgba(var(--ng),${o})`,
  wip: (o=1) => `rgba(var(--wip),${o})`,
  idle: (o=1) => `rgba(var(--idle),${o})`,
  info: (o=1) => `rgba(var(--steel),${o})`,
  gold: (o=1) => `rgba(var(--gold),${o})`,
  purple: (o=1) => `rgba(var(--purple),${o})`,
  bg: (v="card") => `rgb(var(--bg-${v}))`,
  txt: (v="primary") => `rgb(var(--txt-${v}))`,
  muted: "rgb(var(--txt-muted))",
  border: (o) => `rgba(var(--border),${o||"var(--border-op)"})`,
};

const STATUS = {
  ok: { fg: C.ok(), bgLight: C.ok(0.1), border: C.ok(0.25), emoji: "✅" },
  ng: { fg: C.ng(), bgLight: C.ng(0.1), border: C.ng(0.25), emoji: "❌" },
  wip: { fg: C.wip(), bgLight: C.wip(0.1), border: C.wip(0.25), emoji: "" },
  idle: { fg: C.idle(), bgLight: C.idle(0.08), border: C.idle(0.2), emoji: "" },
};

// ── Custom Date Range Picker ──────────────────────────────────────────────
const DateRangePicker = ({ startDate, endDate, onApply, onClear, label = "Select Date Range" }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [tempStart, setTempStart] = useState(null);
  const [tempEnd, setTempEnd] = useState(null);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (startDate) { const start = new Date(startDate); setTempStart(start); } else { setTempStart(null); }
    if (endDate) { const end = new Date(endDate); setTempEnd(end); } else { setTempEnd(null); }
  }, [startDate, endDate]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) { setIsOpen(false); }
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
      setTempStart(clickedDate);
      setTempEnd(null);
    } else if (tempStart && !tempEnd) {
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
        <div key={`weekday-${day}`} className="date-picker-weekday">
          {day}
        </div>
      );
    });

    for (let i = 0; i < firstDay; i++) { days.push(<div key={`empty-${i}`} />); }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      date.setHours(0, 0, 0, 0);
      const isToday = date.getTime() === today.getTime();
      const isStart = tempStart && date.getTime() === tempStart.getTime();
      const isEnd = tempEnd && date.getTime() === tempEnd.getTime();
      const isInRange = tempStart && tempEnd && date > tempStart && date < tempEnd;
      const isSelected = isStart || isEnd;
      let className = 'date-picker-day';
      if (isToday) className += ' today';
      if (isSelected) className += ' selected';
      if (isStart) className += ' range-start';
      if (isEnd) className += ' range-end';
      if (isInRange) className += ' range-middle in-range';

      days.push(
        <button
          key={`day-${day}`}
          onClick={() => handleDayClick(day, month, year)}
          className={className}
        >
          {day}
        </button>
      );
    }
    return days;
  };

  const getDateRangeText = () => {
    if (tempStart && tempEnd) return `${formatDateDisplay(tempStart)} - ${formatDateDisplay(tempEnd)}`;
    if (tempStart) return `${formatDateDisplay(tempStart)} - Select end date`;
    return label;
  };

  const hasSelection = tempStart !== null;

  return (
    <div className="date-picker-container" ref={pickerRef} style={{ width: '100%', minWidth: 0 }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="reports-filter-input"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, minWidth: 220, cursor: 'pointer',
          borderColor: hasSelection ? C.navy(0.5) : undefined,
          boxShadow: hasSelection ? `0 0 0 2px ${C.navy(0.12)}` : undefined,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', minWidth: 0 }}>
          <Calendar size={14} style={{ color: hasSelection ? C.navy() : C.muted, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: hasSelection ? C.navy() : C.txt("muted") }}>
            {getDateRangeText()}
          </span>
        </span>
        <ChevronDown size={14} style={{ color: C.muted, flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
      </button>

      {isOpen && (
        <div className="date-picker-dropdown">
          <div className="date-picker-header">
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>

          <div className="date-picker-grid">
            {renderCalendar()}
          </div>

          <div className="date-picker-footer">
            <button className="clear-btn" onClick={handleClear}>
              Clear
            </button>
            <button className="apply-btn" onClick={handleApply}>
              Apply Range
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Helper Functions ──────────────────────────────────────────────────────
function normalizePartId(v) { return String(v||"").trim(); }
function sanitizeCustomerQrValue(v) {
  const raw = String(v || "").trim();
  if (!raw || raw === "-") return "";
  const invalid = new Set(["ERROR","ERR","FAILED","FAIL","NG","WAIT","WAITING","PENDING","IN_PROGRESS","RUNNING","PLC_COMM_ERROR","COMM_ERROR","TIMEOUT","NULL","UNDEFINED"]);
  if (invalid.has(raw.toUpperCase())) return "";
  return raw;
}
function extractQrDecision(payload={}) {
  const p = String(payload.qrResult||payload.decision||payload.outcome||payload.scanOutcome||payload.qrDecision||payload.qrStatus||"").trim().toUpperCase();
  if (p) return p;
  const f = String(payload.reason||payload.result||"").trim().toUpperCase();
  if (["PASS","OK","ALLOW"].includes(f)) return "ALLOW";
  if (["FAIL","NG","BLOCK","REJECT"].includes(f)) return "BLOCK";
  return "";
}
function hasQrDecision(payload={}) {
  return ["ALLOW","PASS","OK","ACCEPT","VALID","BLOCK","FAIL","NG","REJECT","INVALID"].includes(extractQrDecision(payload));
}
function toQrSignal(payload={}) {
  const d = extractQrDecision(payload);
  const isPass = ["ALLOW","PASS","OK","ACCEPT","VALID"].includes(d);
  const isFail = ["BLOCK","FAIL","NG","REJECT","INVALID"].includes(d);
  return {
    id: `${Date.now()}-${Math.random()}`,
    label: isPass ? "✅ QR PASS" : isFail ? "❌ QR FAIL" : " QR WAIT",
    variant: isPass ? "ok" : isFail ? "ng" : "idle",
    partId: normalizePartId(payload.partId||payload.part_id),
    stationNo: String(payload.stationNo||payload.station_no||"").trim().toUpperCase(),
    decision: d,
    reason: String(payload.reason||payload.qrReason||"").trim(),
    message: String(payload.message||"").trim(),
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}
function toDerivedPassSignal(partId, stationNo, timestamp) {
  return {
    id: `${Date.now()}-${Math.random()}`,
    label: "✅ QR PASS",
    variant: "ok",
    partId: normalizePartId(partId),
    stationNo: String(stationNo||"").trim().toUpperCase(),
    decision: "ALLOW",
    reason: "QR_VALIDATED",
    message: "Validated from journey",
    timestamp: timestamp || new Date().toISOString(),
  };
}
function getLatestAttempt(station={}) {
  const a = Array.isArray(station.attempts) ? station.attempts : [];
  return a.length ? a[a.length-1] : null;
}
function hasDerivedQrSignal(station={}) {
  const la = getLatestAttempt(station);
  if (!la) return false;
  if (la.isBypassed) return true;
  const s = String(la.plcStatus||station.latestStatus||"").trim().toUpperCase();
  return s && s !== "RESET";
}
function isStationBypassed(station={}) {
  return Array.isArray(station.attempts) && station.attempts.some((att) => att?.isBypassed === true);
}
function normalizeLeakResult(value) {
  const token = String(value || "").trim().toUpperCase();
  if (!token) return "";
  if (["NG","NOK","NOT_OK","NOT OK","FAIL","FAILED","REJECT","REJECTED"].includes(token)) return "NG";
  if (["OK","PASS","PASSED","GOOD"].includes(token)) return "OK";
  return "";
}
function getLeakStationState(station={}) {
  const readings = station.leakTestReadings?.length > 0 ? station.leakTestReadings : (station.leakTestReading ? [station.leakTestReading] : []);
  if (!readings.length) return "";
  const results = readings.map((reading) => normalizeLeakResult(reading?.Result || reading?.result)).filter(Boolean);
  if (results.some((result) => result === "NG")) return "FAILED";
  if (results.length === readings.length && results.every((result) => result === "OK")) return "PASSED";
  return "IN_PROGRESS";
}
function getJourneyStationState(station={}, qrMeta=null, settings={}) {
  if (station.customerQrPending === true) return "IN_PROGRESS";
  const leakState = getLeakStationState(station);
  if (leakState) return leakState;
  const backendState = String(station.stageState || "").trim().toUpperCase();
  if (["FAILED","INTERLOCKED","ENDED_NG","NG","COMPLETED_NG"].includes(backendState)) return backendState;
  if (isStationBypassed(station)) return "COMPLETED";
  const qrState = String(station.qrVerification || "").trim().toUpperCase();
  const liveQrLabel = String(qrMeta?.label || "").trim().toUpperCase();
  const hasPassQrSignal = qrState === "PASS" || liveQrLabel.includes("QR PASS");
  const opState = String(station.operation || "").trim().toUpperCase();
  const opFailLike = ["FAIL","FAILED","NG","COMM","COMM_ERROR","PLC_COMM_ERROR","TIMEOUT","PLC_TIMEOUT"].includes(opState);
  const qrFailLike = ["FAIL","FAILED","NG","BLOCK","REJECT","INVALID"].includes(qrState);
  const forcePassForAutoStations = settings.manualResult !== true && hasPassQrSignal && !opFailLike && !qrFailLike;
  return forcePassForAutoStations ? "COMPLETED" : station.stageState;
}
function deriveJourneyPartStatus(part={}, stationTimeline=[], qrByStation={}, stationSettings={}) {
  const states = (stationTimeline || []).map((station) => String(getJourneyStationState(station, qrByStation[station.stationNo], getStationFeatures(station.stationNo, stationSettings)) || "").trim().toUpperCase()).filter(Boolean);
  if (states.some((state) => ["FAILED","INTERLOCKED","ENDED_NG","NG","COMPLETED_NG","COMM_ERROR"].includes(state))) return "NG";
  const rawStatus = String(part?.status || "").trim().toUpperCase();
  if (["NG","INTERLOCKED","FAILED","COMPLETED_NG","ENDED_NG"].includes(rawStatus)) return "NG";
  if (states.length && states.every((state) => ["PASSED","COMPLETED","COMPLETED_OK"].includes(state))) return "COMPLETED";
  if (states.some((state) => ["IN_PROGRESS","RUNNING","REWORK","STARTED"].includes(state))) return "IN_PROGRESS";
  return rawStatus || "IN_PROGRESS";
}
function formatTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + formatTime(v);
}
function getStationMeta(status) {
  const s = String(status||"PENDING").toUpperCase();
  if (["PASSED","ENDED_OK","COMPLETED","COMPLETED_OK"].includes(s)) return { variant: "ok", label: "✅ Pass", icon: CheckCircle2 };
  if (["FAILED","INTERLOCKED","ENDED_NG","NG","COMPLETED_NG"].includes(s)) return { variant: "ng", label: "❌ Fail", icon: XCircle };
  if (["COMM_ERROR","PLC_COMM_ERROR","PLC_TIMEOUT","TIMEOUT","PLC_ERROR","ACK_TIMEOUT","RUNNING_TIMEOUT","END_TIMEOUT","RESET_TIMEOUT"].includes(s)) return { variant: "ng", label: "⚠️ Error", icon: AlertTriangle };
  if (["RUNNING","IN_PROGRESS","STARTED","REWORK"].includes(s)) return { variant: "wip", label: " In Progress", icon: Clock3 };
  return { variant: "idle", label: " Waiting", icon: Clock3 };
}
const LEAK_TEST_FIELDS = [["Machine Name","Machine"],["Part QR","Part_QR_Code"],["Result","Result"],["Body Leak Value","Body_Leak_Value"],["Gall_1","Gall_1"],["Gall_2","Gall_2"],["Cycle Time","Cycle_Time"],["Running Mode","Running_Mode"],["Manual","Manual"],["Dry","Dry"],["Wey","Wey"],["Both","Both"]];
function formatLeakFieldValue(reading, key) {
  if (!reading) return "—";
  if (key === "Machine") return reading.Machine || reading.machineName || reading.matchedMachineName || "—";
  if (key === "Cycle_End_Time") {
    const raw = reading.Cycle_End_Time || reading.cycleEndTime || "";
    if (!raw) return "—";
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? String(raw) : parsed.toLocaleString("en-IN");
  }
  return reading[key] ?? "—";
}
function getLeakResultMeta(reading) {
  const result = normalizeLeakResult(reading?.Result || reading?.result);
  if (result === "OK") return { variant: "ok", label: "✅ Leak OK" };
  if (result === "NG") return { variant: "ng", label: "❌ Leak NG" };
  return { variant: "idle", label: " Leak -" };
}
function getStationDisplayLabel(station) {
  const stationNo = String(station?.stationNo || station?.operationNo || "").trim();
  const machineName = String(station?.machineName || station?.stationName || station?.matchedMachineName || "").trim();
  const operationNo = String(station?.operationNo || stationNo || "").trim();
  if (operationNo.toUpperCase() === "OP150") {
    return "🔬 Leak Test + OP150";
  }
  if (machineName && operationNo) return ` ${machineName} + ${operationNo}`;
  if (machineName) return ` ${machineName}`;
  return `📍 ${stationNo || "Station"}`;
}
function getPartMeta(status) {
  const s=String(status||"").trim().toUpperCase();
  if (["COMPLETED", "PASSED", "COMPLETED_OK"].includes(s)) return {label:"✅ Pass", variant:"ok"};
  if (["NG", "INTERLOCKED", "FAILED", "COMPLETED_NG", "ENDED_NG"].includes(s)) return {label:"❌ Fail", variant:"ng"};
  if (["IN_PROGRESS", "REWORK", "RUNNING", "STARTED", "SCANNED", "VALIDATED", "START_SENT", "WAITING_ACK", "ACK_RECEIVED", "WAITING_RUNNING", "WAITING_END"].includes(s)) return {label:" In Progress", variant:"wip"};
  if (["PLC_COMM_ERROR", "COMM_ERROR", "PLC_TIMEOUT", "PLC_ERROR"].includes(s)) return {label:"⚠️ Error", variant:"ng"};
  return {label:" Waiting",variant:"idle"};
}

function generateQrPattern(text, size=80) {
  let hash = 0;
  for (let i=0;i<text.length;i++) hash=((hash<<5)-hash)+text.charCodeAt(i), hash|=0;
  const cells = 7; const cell = Math.floor(size/cells);
  const squares = [];
  for (let r=0;r<cells;r++) for (let c=0;c<cells;c++) {
    const isFinderZone=(r<3&&c<3)||(r<3&&c>=cells-3)||(r>=cells-3&&c<3);
    if (!isFinderZone) {
      const bit=((hash>>((r*cells+c)%30))&1)===1;
      if (bit) squares.push(
        <rect key={`d${r}${c}`} x={c*cell} y={r*cell} width={cell-1} height={cell-1} fill="currentColor" rx={1}/>
      );
    }
  }
  return (
    <svg viewBox={`0 0 ${cells*cell} ${cells*cell}`} width={size} height={size}
      style={{color:"currentColor",display:"block"}}>
      <rect x={0} y={0} width={cell*3} height={cell*3} fill="currentColor"/>
      <rect x={cell} y={cell} width={cell} height={cell} fill="white"/>
      <rect x={(cells-3)*cell} y={0} width={cell*3} height={cell*3} fill="currentColor"/>
      <rect x={(cells-2)*cell} y={cell} width={cell} height={cell} fill="white"/>
      <rect x={0} y={(cells-3)*cell} width={cell*3} height={cell*3} fill="currentColor"/>
      <rect x={cell} y={(cells-2)*cell} width={cell} height={cell} fill="white"/>
      {squares}
    </svg>
  );
}

// ── Components ─────────────────────────────────────────────────────────────
const Badge = ({ variant="idle", label, dot=true, pulse=false }) => {
  const s=STATUS[variant]||STATUS.idle;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 10px",
      borderRadius:99,fontSize:11,fontWeight:700,letterSpacing:"0.04em",
      color:s.fg,background:s.bgLight,border:`1px solid ${s.border}`,whiteSpace:"nowrap"}}>
      {dot&&<span style={{width:6,height:6,borderRadius:"50%",background:s.fg,flexShrink:0,
        animation:pulse&&variant==="wip"?"cjPulse 1.4s ease-in-out infinite":"none"}}/>}
      {label}
    </span>
  );
};

const StatCard = ({ label, value, variant="idle", icon:Icon }) => {
  const s=STATUS[variant]||STATUS.idle;
  return (
    <div style={{background:C.bg("card"),border:`1px solid ${s.border}`,borderRadius:12,
      padding:"14px 16px",boxShadow:"var(--shadow)",borderLeft:`3px solid ${s.fg}`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <p style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
          letterSpacing:"0.07em",color:s.fg,opacity:0.85}}>{label}</p>
        {Icon&&<span style={{width:28,height:28,borderRadius:8,background:s.bgLight,
          display:"flex",alignItems:"center",justifyContent:"center",color:s.fg}}>
          <Icon size={14}/>
        </span>}
      </div>
      <p style={{fontSize:28,fontWeight:800,color:s.fg,fontVariantNumeric:"tabular-nums",
        lineHeight:1,fontFamily:"'DM Mono','Courier New',monospace"}}>{value}</p>
    </div>
  );
};

const SectionHead = ({ title, subtitle, right, accent }) => (
  <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border()}`,
    background:C.bg("surface"),display:"flex",alignItems:"center",
    justifyContent:"space-between",
    borderLeft:accent?`3px solid ${C.amber()}`:"none"}}>
    <div>
      {subtitle&&<p style={{fontSize:10,fontWeight:800,textTransform:"uppercase",
        letterSpacing:"0.1em",color:C.txt("muted"),marginBottom:2}}>{subtitle}</p>}
      <p style={{fontSize:13,fontWeight:700,color:C.txt("primary")}}>{title}</p>
    </div>
    {right}
  </div>
);

const Btn = ({ children, onClick, disabled, variant="ghost", loading, style:sx={} }) => {
  const [hover,setHover]=useState(false);
  const styles={
    ghost: {background:hover?C.bg("hover"):"transparent",color:C.txt("secondary"),border:`1px solid ${C.border()}`},
    amber: {background:hover?C.amber(0.9):C.amber(),color:C.navy(),border:"none",fontWeight:800},
    danger:{background:hover?C.ng(0.18):C.ng(0.1),color:C.ng(),border:`1px solid ${C.ng(0.3)}`},
    navy:  {background:hover?C.navy(0.85):C.navy(),color:C.linen(),border:"none"},
  };
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 14px",
        borderRadius:8,fontSize:12,fontWeight:700,cursor:disabled?"not-allowed":"pointer",
        opacity:disabled?0.45:1,transition:"all 0.15s ease",border:"none",outline:"none",
        ...(styles[variant]||styles.ghost),...sx}}>
      {loading?<RefreshCw size={12} style={{animation:"cjSpin 0.9s linear infinite"}}/>:children}
    </button>
  );
};

const Divider = ({ label }) => (
  <div style={{display:"flex",alignItems:"center",gap:10,margin:"4px 0"}}>
    <div style={{flex:1,height:1,background:C.border()}}/>
    {label&&<span style={{fontSize:10,fontWeight:700,color:C.txt("muted"),
      textTransform:"uppercase",letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{label}</span>}
    <div style={{flex:1,height:1,background:C.border()}}/>
  </div>
);

const PartActionBtn = ({ icon, label, color, bgColor, borderColor, hoverBg, onClick }) => {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: 5, width: "100%", height: 30,
        borderRadius: 7, fontSize: 11, fontWeight: 700,
        cursor: "pointer",
        color: color,
        background: h ? hoverBg : bgColor,
        border: `1px solid ${borderColor}`,
        transition: "all .12s",
        whiteSpace: "nowrap",
      }}>
      {icon}
      {label}
    </button>
  );
};

const QrModal = ({ partId, onClose, onDeletePart }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteError,   setDeleteError]   = useState("");

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await traceabilityApi.deletePart({ partId, reason: "Full part deletion" });
      onDeletePart(partId);
      onClose();
    } catch(e) {
      setDeleteError(e.response?.data?.error || "Unable to remove part");
    } finally { setDeleting(false); }
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:1200,display:"flex",alignItems:"center",
      justifyContent:"center",padding:16,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
      <div style={{width:"100%",maxWidth:400,background:C.bg("card"),
        border:`1px solid ${C.border()}`,borderRadius:18,overflow:"hidden",
        boxShadow:"0 24px 64px rgba(0,0,0,0.5)",animation:"cjScale 0.2s ease"}}>
        <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border()}`,
          background:C.bg("surface"),display:"flex",alignItems:"center",
          justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:30,height:30,borderRadius:8,background:C.steel(0.12),
              border:`1px solid ${C.steel(0.25)}`,display:"flex",alignItems:"center",
              justifyContent:"center"}}>
              <QrCode size={15} color={C.steel()}/>
            </div>
            <div>
              <p style={{fontSize:9,fontWeight:800,textTransform:"uppercase",
                letterSpacing:"0.1em",color:C.txt("muted"),marginBottom:1}}> Part QR Code</p>
              <p style={{fontSize:13,fontWeight:700,color:C.txt("primary")}}>
                {partId}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:6,
            background:C.bg("hover"),border:`1px solid ${C.border()}`,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            <X size={13} color={C.txt("muted")}/>
          </button>
        </div>
        <div style={{padding:"24px",display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
          <div style={{background:"white",borderRadius:12,padding:"20px",
            boxShadow:"0 4px 20px rgba(0,0,0,0.15)",display:"flex",
            flexDirection:"column",alignItems:"center",gap:10,
            border:"1px solid rgba(0,0,0,0.08)"}}>
            <div style={{color:"rgba(26,50,99,1)"}}>
              {generateQrPattern(partId, 120)}
            </div>
            <p style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,
              color:"rgba(26,50,99,1)",letterSpacing:"0.05em",textAlign:"center"}}>
              {partId}
            </p>
            <p style={{fontSize:9,color:"rgba(84,119,146,0.8)",textTransform:"uppercase",
              letterSpacing:"0.1em"}}> IndusTrace MES</p>
          </div>
          <p style={{fontSize:11,color:C.txt("muted"),textAlign:"center",lineHeight:1.5}}>
            🔍 Scan this code to look up the part's full production journey.
          </p>
          {!confirmDelete ? (
            <button onClick={() => { setDeleteError(""); setConfirmDelete(true); }}
              style={{display:"flex",alignItems:"center",gap:6,
                fontSize:12,fontWeight:700,color:C.ng(),
                background:C.ng(0.08),border:`1px solid ${C.ng(0.25)}`,
                borderRadius:8,padding:"8px 16px",cursor:"pointer",
                transition:"all .15s",width:"100%",justifyContent:"center"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.ng(0.14)}
              onMouseLeave={e=>e.currentTarget.style.background=C.ng(0.08)}>
              <Trash2 size={13}/> 🗑️ Remove This Part from System
            </button>
          ) : (
            <div style={{width:"100%",background:C.ng(0.07),border:`1px solid ${C.ng(0.25)}`,
              borderRadius:10,padding:"14px",animation:"cjFadeIn .15s ease"}}>
              <p style={{fontSize:12,fontWeight:700,color:C.ng(),marginBottom:4}}>
                ⚠️ Remove Part from System?
              </p>
              <p style={{fontSize:11,color:C.txt("muted"),lineHeight:1.5,marginBottom:12}}>
                This will remove <strong style={{color:C.txt("primary"),fontFamily:"'DM Mono',monospace"}}>{partId}</strong> and
                all its station history from start to end. This cannot be undone.
              </p>
              <div style={{display:"flex",gap:8}}>
                <Btn onClick={() => { setDeleteError(""); setConfirmDelete(false); }}
                  style={{flex:1,justifyContent:"center",padding:"8px 0"}}>
                  Cancel
                </Btn>
                <Btn variant="danger" onClick={handleDelete}
                  disabled={deleting} loading={deleting}
                  style={{flex:1,justifyContent:"center",padding:"8px 0"}}>
                  {deleting?"Removing…":"Yes, Remove"}
                </Btn>
              </div>
              {deleteError ? (
                <p style={{marginTop:10,fontSize:11,color:C.ng(),lineHeight:1.4}}>
                  {deleteError}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
const ComponentJourney = () => {
  useEffect(()=>{ injectTheme(); },[]);

  const [searchTerm,       setSearchTerm]       = useState("");
  const [filters,          setFilters]          = useState(() => {
    const range = getCurrentProductionDateRange();
    return {
      dateFrom: toLocalDateTimeInput(range.start),
      dateTo: toLocalDateTimeInput(range.end),
      partId:"",
      plantId:"",
      lineId:"",
      machineId:"",
      stationNo:"",
      status:"",
      operatorId:"",
      shiftCode:"",
      lineName:"",
    };
  });
  const [parts,            setParts]            = useState([]);
  const [machines,         setMachines]         = useState([]);
  const [availableShifts,  setAvailableShifts]  = useState([]);
  const [selectedPartId,   setSelectedPartId]   = useState("");
  const [journeyData,      setJourneyData]      = useState(null);
  const [loading,          setLoading]          = useState(false);
  const [refreshing,       setRefreshing]       = useState(false);
  const [resettingStation, setResettingStation] = useState("");
  const [resetConfirm,     setResetConfirm]     = useState(null);
  const [popup,            setPopup]            = useState(null);
  const [lastQrSignal,     setLastQrSignal]     = useState(null);
  const [qrFeed,           setQrFeed]           = useState([]);
  const [qrByStation,      setQrByStation]      = useState({});
  const [stationSettings,  setStationSettings]  = useState(()=>getStationFeatureSettings());
  const [qrModalPartId,    setQrModalPartId]    = useState(null);

  const selectedPartIdRef      = useRef("");
  const searchTermRef          = useRef("");
  const socketRef              = useRef(null);
  const subscribedPartRef      = useRef("");
  const realtimeTimerRef       = useRef(null);
  const lastRealtimeRefreshRef = useRef(0);
  const inFlightRefreshRef     = useRef(false);
  const queuedRefreshRef       = useRef(false);
  const lastQrEventRef         = useRef({key:"",at:0});

  const selectedPart    = useMemo(()=>parts.find(e=>e.partId===selectedPartId)||null,[parts,selectedPartId]);
  const lineOptions     = useMemo(
    ()=>Array.from(new Set((machines||[])
      .filter((row)=>!filters.plantId || String(row.plantId || "") === String(filters.plantId))
      .map((row)=>String(row.lineName || "").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b)),
    [machines, filters.plantId]
  );
  const stationTimeline = useMemo(()=>journeyData?.stationTimeline||[],[journeyData?.stationTimeline]);
  const selectedPartDisplayId = selectedPart?.displayPartId || journeyData?.part?.displayPartId || selectedPartId || "";
  const selectedCustomerQrCode = sanitizeCustomerQrValue(selectedPart?.customerQrCode || journeyData?.part?.customerQrCode || "");
  const selectedDerivedPartStatus = useMemo(
    () => deriveJourneyPartStatus(journeyData?.part || selectedPart || {}, stationTimeline, qrByStation, stationSettings),
    [journeyData?.part, selectedPart, stationTimeline, qrByStation, stationSettings]
  );
  const statusSummary   = useMemo(()=>stationTimeline.reduce((acc,st)=>{
    const s=String(getJourneyStationState(st, qrByStation[st.stationNo], getStationFeatures(st.stationNo, stationSettings))||"").toUpperCase();
    if (s==="PASSED" || s==="COMPLETED") acc.passed++;
    else if (["FAILED","INTERLOCKED","COMM_ERROR","NG","COMPLETED_NG"].includes(s)) acc.failed++;
    else if (["IN_PROGRESS","RUNNING","REWORK"].includes(s)) acc.inProgress++;
    else acc.pending++;
    return acc;
  },{passed:0,failed:0,inProgress:0,pending:0}),[stationTimeline, qrByStation, stationSettings]);

  // ── Data Loading ─────────────────────────────────────────────────────
  const loadPartCatalog = useCallback(async(search)=>{
    const rows=await traceabilityApi.partCatalog({
      search,
      limit:80,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      partId: filters.partId || undefined,
      plantId: filters.plantId || undefined,
      lineId: filters.lineId || undefined,
      machineId: filters.machineId || undefined,
      stationNo: filters.stationNo || undefined,
      status: filters.status || undefined,
      operatorId: filters.operatorId || undefined,
      shiftCode: filters.shiftCode || undefined,
      lineName: filters.lineName || undefined,
    });
    setParts(rows||[]);
    if (!selectedPartId&&rows?.length) setSelectedPartId(rows[0].partId);
    if (selectedPartId&&!(rows||[]).some(e=>e.partId===selectedPartId))
      setSelectedPartId(rows?.[0]?.partId||"");
  },[selectedPartId, filters]);

  const loadJourney = useCallback(async(partId,showLoader=true)=>{
    if (!partId){setJourneyData(null);return;}
    if (showLoader) setLoading(true);
    try { const res=await traceabilityApi.journeyByPart(partId); setJourneyData(res||null); }
    catch(e) {
      if (Number(e.response?.status||0)===404){setJourneyData(null);return;}
      if (showLoader) setJourneyData(null);
      setPopup({type:"ERROR",title:"Part History Missing",message:e.response?.data?.error||"Part journey data not found"});
    } finally { if (showLoader) setLoading(false); }
  },[]);

  const refreshJourneyNow = useCallback(async(showLoader=false)=>{
    const partId=selectedPartIdRef.current;
    if (!partId) return;
    if (inFlightRefreshRef.current){queuedRefreshRef.current=true;return;}
    inFlightRefreshRef.current=true;
    try { await loadJourney(partId,showLoader); }
    finally {
      inFlightRefreshRef.current=false;
      if (queuedRefreshRef.current){queuedRefreshRef.current=false;refreshJourneyNow(false);}
    }
  },[loadJourney]);

  const scheduleRealtimeRefresh = useCallback(()=>{
    const elapsed=Date.now()-lastRealtimeRefreshRef.current;
    const delay=Math.max(0,REALTIME_REFRESH_COOLDOWN-elapsed);
    if (realtimeTimerRef.current) return;
    realtimeTimerRef.current=setTimeout(()=>{
      realtimeTimerRef.current=null;lastRealtimeRefreshRef.current=Date.now();refreshJourneyNow(false);
    },delay);
  },[refreshJourneyNow]);

  const patchPartFromRealtime = useCallback((payload={})=>{
    const rPartId=normalizePartId(payload.partId||payload.part_id);
    if (!rPartId) return;
    const opStatus=String(payload.operationStatus||payload.plcStatus||"").trim().toUpperCase();
    const rStatus=String(payload.currentStatus||payload.partStatus||opStatus||payload.status||"").trim().toUpperCase();
    const resolved=["COMPLETED","IN_PROGRESS","NG","INTERLOCKED","REWORK"].includes(rStatus)?rStatus
      :rStatus==="ENDED_OK" || rStatus==="COMPLETED_OK"?"COMPLETED"
      :rStatus==="PASSED" || rStatus==="PASS" || rStatus==="OK"?"COMPLETED"
      :rStatus==="STARTED" || rStatus==="RUNNING" || rStatus.startsWith("WAITING") || rStatus === "ACK_RECEIVED" || rStatus === "START_SENT"?"IN_PROGRESS"
      :rStatus==="PENDING"?"PENDING"
      :rStatus==="ENDED_NG" || rStatus==="COMPLETED_NG"?"NG":"";
    const rStation=String(payload.stationNo||payload.station_no||"").trim().toUpperCase();
    const rTimestamp=payload.timestamp||new Date().toISOString();
    const customerQrCode=sanitizeCustomerQrValue(payload.customerQrCode||payload.customer_qr);
    const mappedPartId=normalizePartId(payload.mappedPartId||payload.mapped_part_id||payload.dotPinPartId||payload.dot_pin_part_id);
    const isCustomerQrOnly=Boolean(customerQrCode&&mappedPartId&&customerQrCode===mappedPartId);
    const displayPartId=isCustomerQrOnly ? "" : mappedPartId;
    setParts(prev=>{
      const idx=prev.findIndex(r=>r.partId===rPartId);
      if (idx===-1){
        if (searchTermRef.current) return prev;
        return [{
          partId:rPartId,
          displayPartId:displayPartId||undefined,
          mappedPartId:mappedPartId||undefined,
          customerQrCode:customerQrCode||undefined,
          isCustomerQrOnly,
          status:resolved||"IN_PROGRESS",
          currentStation:rStation||null,
          updatedAt:rTimestamp,
        },...prev].slice(0,80);
      }
      const next=[...prev];
      next[idx]={
        ...prev[idx],
        ...(displayPartId ? { displayPartId } : {}),
        ...(mappedPartId ? { mappedPartId } : {}),
        ...(customerQrCode ? { customerQrCode } : {}),
        ...(customerQrCode && mappedPartId ? { isCustomerQrOnly } : {}),
        status:resolved||prev[idx].status,
        currentStation:rStation||prev[idx].currentStation,
        updatedAt:rTimestamp,
      };
      return next;
    });
  },[]);

  const processQrSignal = useCallback((payload={})=>{
    if (!hasQrDecision(payload)) return;
    const pp=normalizePartId(payload.partId||payload.part_id);
    const ap=normalizePartId(selectedPartIdRef.current);
    if (ap&&pp&&pp!==ap) return;
    const sig=toQrSignal(payload);
    const key=[sig.partId,sig.stationNo,sig.decision,sig.reason].join("|");
    const now=Date.now();
    if (lastQrEventRef.current.key===key&&now-lastQrEventRef.current.at<QR_DEDUPE_MS) return;
    lastQrEventRef.current={key,at:now};
    setLastQrSignal(sig);
    setQrFeed(prev=>[sig,...prev].slice(0,6));
    if (sig.stationNo) setQrByStation(prev=>({...prev,[sig.stationNo]:sig}));
  },[]);

  const handleRefresh = useCallback(async()=>{
    setRefreshing(true);
    try { await loadPartCatalog(searchTerm); await refreshJourneyNow(false); setStationSettings(getStationFeatureSettings()); }
    catch(e){ setPopup({type:"ERROR",title:"Refresh Failed",message:e.response?.data?.error||"Unable to refresh"}); }
    finally { setRefreshing(false); }
  },[loadPartCatalog,searchTerm,refreshJourneyNow]);

  const exportJourneyReport = useCallback(async () => {
    const rows = (stationTimeline || []).map((station) => {
      const latest = Array.isArray(station.attempts) && station.attempts.length > 0
        ? station.attempts[station.attempts.length - 1]
        : null;
      const effectiveStageState = getJourneyStationState(station, null, {});
      const latestResult = latest?.result || station.latestResult || "";
      const latestRemark = latest?.isBypassed
        ? (latest?.bypassReason || "BYPASSED_AUTO_OK")
        : (station.latestInterlockReason || latest?.interlockReason || "");
      return {
        stationNo: station.stationNo || "",
        stageState: effectiveStageState || station.stageState || "PENDING",
        latestStatus: station.latestStatus || "",
        latestResult: latest?.isBypassed ? "OK" : latestResult,
        interlockReason: latestRemark,
        completedAt: station.latestAt || latest?.createdAt || "",
        cycleStartTime: station.cycleStartTime || "",
        cycleEndTime: station.cycleEndTime || "",
        cycleDuration: station.cycleDurationSec ? `${Number(station.cycleDurationSec).toFixed(2)}s` : "0.00s",
      };
    });
    if (!rows.length) {
      setPopup({ type:"WARNING", title:"No Data", message:"No part journey rows available for export." });
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Traceability Report");
      sheet.columns = [
        { header: " Part ID", key: "partId", width: 25 },
        { header: " Station", key: "stationNo", width: 15 },
        { header: " State", key: "stageState", width: 15 },
        { header: " Latest Status", key: "latestStatus", width: 20 },
        { header: " Result", key: "latestResult", width: 15 },
        { header: " Remark", key: "interlockReason", width: 35 },
        { header: "⏱ Cycle Start", key: "cycleStartTime", width: 25 },
        { header: "⏱ Cycle End", key: "cycleEndTime", width: 25 },
        { header: " Duration", key: "cycleDuration", width: 15 },
        { header: " Timestamp", key: "completedAt", width: 25 }
      ];
      sheet.insertRow(1, [" Industrial Traceability System - Part Journey Report"]);
      sheet.mergeCells("A1:G1");
      const titleRow = sheet.getRow(1);
      titleRow.font = { name: "Arial", family: 4, size: 16, bold: true, color: { argb: "FF1A3263" } };
      titleRow.alignment = { horizontal: "center", vertical: "middle" };
      titleRow.height = 30;
      sheet.insertRow(2, [`📅 Report Generated: ${new Date().toLocaleString()}`, "", "", "", "", "", `📊 Total Stations: ${rows.length}`]);
      sheet.mergeCells("A2:E2");
      sheet.mergeCells("F2:G2");
      const subTitleRow = sheet.getRow(2);
      subTitleRow.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF666666" } };
      subTitleRow.getCell(6).alignment = { horizontal: "right" };
      subTitleRow.height = 20;
      sheet.insertRow(3, []);
      const headerRow = sheet.getRow(4);
      headerRow.values = ["📦 Part ID", "📍 Station", "📊 State", " Latest Status", "✅ Result", "📝 Remark", " Cycle Start", " Cycle End", " Duration", " Timestamp"];
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      headerRow.alignment = { horizontal: "center", vertical: "middle" };
      headerRow.height = 25;
      headerRow.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A3263" } };
        cell.border = { top: { style: 'thin', color: { argb: "FFCCCCCC" } }, left: { style: 'thin', color: { argb: "FFCCCCCC" } }, bottom: { style: 'thin', color: { argb: "FFCCCCCC" } }, right: { style: 'thin', color: { argb: "FFCCCCCC" } } };
      });
      rows.forEach((row, index) => {
        const dataRow = sheet.addRow({
          partId: selectedPartId || "",
          stationNo: row.stationNo,
          stageState: row.stageState,
          latestStatus: row.latestStatus,
          latestResult: row.latestResult,
          interlockReason: row.interlockReason,
          cycleStartTime: row.cycleStartTime ? new Date(row.cycleStartTime).toLocaleString() : "-",
          cycleEndTime: row.cycleEndTime ? new Date(row.cycleEndTime).toLocaleString() : "-",
          cycleDuration: row.cycleDuration,
          completedAt: row.completedAt ? new Date(row.completedAt).toLocaleString() : ""
        });
        if (index % 2 === 0) {
          dataRow.eachCell(cell => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8F9FA" } };
          });
        }
        dataRow.eachCell((cell, colNumber) => {
          cell.border = { top: { style: 'thin', color: { argb: "FFEEEEEE" } }, left: { style: 'thin', color: { argb: "FFEEEEEE" } }, bottom: { style: 'thin', color: { argb: "FFEEEEEE" } }, right: { style: 'thin', color: { argb: "FFEEEEEE" } } };
          if (colNumber !== 6) { cell.alignment = { horizontal: "center", vertical: "middle" }; } else { cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true }; }
        });
        const stateCell = dataRow.getCell(3);
        const state = String(row.stageState).toUpperCase();
        if (state === "PASSED" || state === "COMPLETED") { stateCell.font = { color: { argb: "FF15803D" }, bold: true }; }
        else if (state === "FAILED" || state === "NG") { stateCell.font = { color: { argb: "FFDC2626" }, bold: true }; }
        else if (state === "IN_PROGRESS" || state === "RUN") { stateCell.font = { color: { argb: "FFD97706" }, bold: true }; }
        const resultCell = dataRow.getCell(5);
        const result = String(row.latestResult).toUpperCase();
        if (["PASS", "OK", "ALLOW"].includes(result)) { resultCell.font = { color: { argb: "FF15803D" }, bold: true }; }
        else if (["FAIL", "NG", "BLOCK"].includes(result)) { resultCell.font = { color: { argb: "FFDC2626" }, bold: true }; }
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const pad = (v) => String(v).padStart(2, "0");
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      saveAs(new Blob([buffer]), `Traceability_Report_${stamp}.xlsx`);
    } catch (e) {
      setPopup({ type:"ERROR", title:"Export Failed", message:"Failed to generate Excel file." });
    }
  }, [selectedPartId, stationTimeline]);

  const handleResetStation = useCallback((sNo)=>{
    if (!selectedPartId||!sNo) return;
    setResetConfirm({partId:selectedPartId,stationNo:sNo});
  },[selectedPartId]);

  const confirmResetStation = useCallback(async()=>{
    const sNo=String(resetConfirm?.stationNo||"").trim().toUpperCase();
    const pId=normalizePartId(resetConfirm?.partId||selectedPartId);
    if (!pId||!sNo){setResetConfirm(null);return;}
    setResettingStation(sNo);
    try {
      await traceabilityApi.resetStation({partId:pId,stationNo:sNo,reason:`Manual reset at ${sNo}`});
      setQrByStation({});setLastQrSignal(null);setQrFeed([]);
      await Promise.all([refreshJourneyNow(false),loadPartCatalog(searchTermRef.current)]);
      setPopup({type:"SUCCESS",title:"Station Reset",message:`Station ${sNo} reset for part ${pId}`});
    } catch(e){ setPopup({type:"ERROR",title:"Reset Failed",message:e.response?.data?.error||"Unable to reset"}); }
    finally { setResettingStation("");setResetConfirm(null); }
  },[resetConfirm,selectedPartId,refreshJourneyNow,loadPartCatalog]);

  const handleDeletePart = useCallback((partId)=>{
    setParts(prev=>prev.filter(p=>p.partId!==partId));
    if (selectedPartId===partId) {
      setSelectedPartId(""); setJourneyData(null);
    }
  },[selectedPartId]);

  // ── Effects ─────────────────────────────────────────────────────────
  useEffect(()=>{ selectedPartIdRef.current=selectedPartId; },[selectedPartId]);
  useEffect(()=>{ setLastQrSignal(null);setQrFeed([]);setQrByStation({});setResetConfirm(null); lastQrEventRef.current={key:"",at:0}; },[selectedPartId]);
  useEffect(()=>{
    if (!selectedPartId||stationTimeline.length===0){setQrByStation({});return;}
    const derived={};
    for (const st of stationTimeline){
      if (!hasDerivedQrSignal(st)) continue;
      const la=getLatestAttempt(st);
      derived[st.stationNo]=toDerivedPassSignal(selectedPartId,st.stationNo,la?.createdAt||st.latestAt);
    }
    setQrByStation(derived);
    if (lastQrSignal||qrFeed.length>0) return;
    const latest=[...stationTimeline].filter(s=>hasDerivedQrSignal(s)&&s.latestAt)
      .sort((a,b)=>new Date(b.latestAt)-new Date(a.latestAt))[0];
    if (!latest) return;
    const d=toDerivedPassSignal(selectedPartId,latest.stationNo,latest.latestAt);
    setLastQrSignal(d);setQrFeed([d]);
  },[selectedPartId,stationTimeline,lastQrSignal,qrFeed.length]);

  useEffect(()=>{ searchTermRef.current=searchTerm; },[searchTerm]);
  useEffect(()=>{
    const t=setTimeout(()=>loadPartCatalog(searchTerm).catch(e=>setPopup({type:"ERROR",title:"Search Failed",message:e.response?.data?.error||"Unable to load catalog"})),220);
    return()=>clearTimeout(t);
  },[searchTerm,loadPartCatalog]);
  useEffect(()=>{ refreshJourneyNow(true); },[selectedPartId,refreshJourneyNow]);

  // ── Socket ──────────────────────────────────────────────────────────
  useEffect(()=>{
    const socket=io(SOCKET_URL,{...SOCKET_OPTIONS,reconnectionDelay:500,reconnectionDelayMax:2000,timeout:10000});
    socketRef.current=socket;
    socket.on("journey_update",(p={})=>{
      patchPartFromRealtime(p);
      if (String(p.sourceEvent||"").toLowerCase()!=="scan_event"&&hasQrDecision(p)) processQrSignal(p);
      const pp=normalizePartId(p.partId||p.part_id);
      if (!pp||pp!==selectedPartIdRef.current) return;
      scheduleRealtimeRefresh();
    });
    socket.on("scan_event",(p={})=>{patchPartFromRealtime(p);processQrSignal(p);const pp=normalizePartId(p.partId||p.part_id);if (!pp||pp===selectedPartIdRef.current) scheduleRealtimeRefresh();});
    socket.on("operator_popup",(p={})=>{patchPartFromRealtime(p);const pp=normalizePartId(p.partId||p.part_id);if (pp&&pp!==selectedPartIdRef.current) return;scheduleRealtimeRefresh();});
    socket.on("dashboard_refresh",()=>scheduleRealtimeRefresh());
    return()=>{
      if (realtimeTimerRef.current){clearTimeout(realtimeTimerRef.current);realtimeTimerRef.current=null;}
      if (subscribedPartRef.current){socket.emit("unsubscribe_part",{partId:subscribedPartRef.current});subscribedPartRef.current="";}
      socketRef.current=null;
      if (socket.connected) socket.disconnect();
    };
  },[scheduleRealtimeRefresh,patchPartFromRealtime,processQrSignal]);

  useEffect(()=>{
    const socket=socketRef.current; if (!socket) return;
    const next=normalizePartId(selectedPartIdRef.current);
    const cur=normalizePartId(subscribedPartRef.current);
    if (cur&&cur!==next){socket.emit("unsubscribe_part",{partId:cur});subscribedPartRef.current="";}
    if (next&&next!==cur){socket.emit("subscribe_part",{partId:next});subscribedPartRef.current=next;}
    if (!next&&cur){socket.emit("unsubscribe_part",{partId:cur});subscribedPartRef.current="";}
  },[selectedPartId]);

  useEffect(()=>{const t=setInterval(()=>refreshJourneyNow(false),FALLBACK_POLL_INTERVAL);return()=>clearInterval(t);},[refreshJourneyNow]);
  useEffect(()=>{const t=setInterval(()=>loadPartCatalog(searchTermRef.current).catch(()=>{}),CATALOG_SYNC_INTERVAL);return()=>clearInterval(t);},[loadPartCatalog]);
  useEffect(()=>{
    const sync=async()=>{
      try { const r=await stationSettingsApi.list(); if (r&&Object.keys(r).length>0){setStationSettings(r);saveStationFeatureSettings(r);return;} } catch (_syncError) { void _syncError; }
      setStationSettings(getStationFeatureSettings());
    };
    sync();
    const onFocus=()=>sync(); const onStorage=()=>setStationSettings(getStationFeatureSettings());
    window.addEventListener("focus",onFocus); window.addEventListener("storage",onStorage);
    return()=>{ window.removeEventListener("focus",onFocus); window.removeEventListener("storage",onStorage); };
  },[]);

  useEffect(() => {
    let cancelled = false;
    const loadFilterSources = async () => {
      try {
        const [machineRows, shifts] = await Promise.all([
          machineApi.list(),
          shiftApi.list().catch(() => []),
        ]);
        if (cancelled) return;
        setMachines(machineRows || []);
        setAvailableShifts(
          (shifts || [])
            .filter((row) => row?.isActive !== false)
            .map((row) => ({
              shiftCode: row.shiftCode || row.shift_code,
              shiftName: row.shiftName || row.shift_name || row.shiftCode || row.shift_code,
            }))
        );
      } catch (_error) {
        void _error;
        if (!cancelled) {
          setMachines([]);
          setAvailableShifts([]);
        }
      }
    };
    loadFilterSources();
    return () => { cancelled = true; };
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────
  const handleDateRangeApply = (start, end) => {
    const range = getProductionDateRange(start, end);
    const currentRange = getCurrentProductionDateRange();
    if (
      range.start.toDateString() === currentRange.start.toDateString() &&
      range.end > currentRange.end
    ) {
      range.end.setTime(currentRange.end.getTime());
    }
    setFilters((prev) => ({
      ...prev,
      dateFrom: toLocalDateTimeInput(range.start),
      dateTo: toLocalDateTimeInput(range.end),
    }));
  };

  const handleDateRangeClear = () => {
    const range = getCurrentProductionDateRange();
    setFilters((prev) => ({
      ...prev,
      dateFrom: toLocalDateTimeInput(range.start),
      dateTo: toLocalDateTimeInput(range.end),
    }));
  };

  const removeFilter = (key) => {
    setFilters((prev) => ({ ...prev, [key]: "" }));
  };

  const clearAllFilters = () => {
    const range = getCurrentProductionDateRange();
    setFilters({
      dateFrom: toLocalDateTimeInput(range.start), dateTo: toLocalDateTimeInput(range.end), partId: "", plantId: "",
      lineId: "", machineId: "", stationNo: "", status: "",
      operatorId: "", shiftCode: "", lineName: "",
    });
  };

  const activeFilters = Object.entries(filters).filter(([key, value]) => {
    if (['dateFrom', 'dateTo'].includes(key)) return false;
    return value && String(value).trim();
  });

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="cj-container" style={{display:"flex",flexDirection:"column",gap:20,padding:"4px 2px"}}>

      {/* ── QR Modal ─────────────────────────────────────────────────── */}
      {qrModalPartId && (
        <QrModal
          partId={qrModalPartId}
          onClose={()=>setQrModalPartId(null)}
          onDeletePart={handleDeletePart}
        />
      )}

      {/* ── Reset Confirm Modal ──────────────────────────────────────── */}
      {resetConfirm && (
        <div style={{position:"fixed",inset:0,zIndex:1100,display:"flex",alignItems:"center",
          justifyContent:"center",padding:16,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
          <div style={{width:"100%",maxWidth:440,background:C.bg("card"),
            border:`1px solid ${C.border()}`,borderRadius:16,
            boxShadow:"0 24px 64px rgba(0,0,0,0.5)",overflow:"hidden",animation:"cjFadeIn 0.2s ease"}}>
            <div style={{height:3,background:`linear-gradient(90deg,${C.navy()},${C.steel()},${C.amber()})`}}/>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"14px 18px",borderBottom:`1px solid ${C.border()}`,background:C.bg("surface")}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,borderRadius:8,background:C.ng(0.12),
                  display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <AlertTriangle size={16} color={C.ng()}/>
                </div>
                <p style={{fontSize:14,fontWeight:700,color:C.txt("primary")}}>⚠️ Confirm Station Reset</p>
              </div>
              <button onClick={()=>setResetConfirm(null)} style={{width:28,height:28,borderRadius:6,
                background:C.bg("hover"),border:`1px solid ${C.border()}`,cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"center"}}>
                <X size={13} color={C.txt("muted")}/>
              </button>
            </div>
            <div style={{padding:"18px 18px 20px"}}>
              <div style={{background:C.bg("surface"),border:`1px solid ${C.border()}`,
                borderRadius:10,padding:"12px 14px",marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
                    letterSpacing:"0.07em",color:C.txt("muted")}}>📦 Part Serial</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,
                    color:C.txt("primary")}}>{resetConfirm.partId}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",
                    letterSpacing:"0.07em",color:C.txt("muted")}}>📍 Station</span>
                  <span style={{fontSize:12,fontWeight:700,color:C.amber()}}>{resetConfirm.stationNo}</span>
                </div>
              </div>
              <p style={{fontSize:12,color:C.txt("muted"),lineHeight:1.6,marginBottom:16}}>
                 This clears all downstream progress from the selected station. A re-scan will be required.
              </p>
              <div style={{display:"flex",gap:10}}>
                <Btn onClick={()=>setResetConfirm(null)} style={{flex:1,justifyContent:"center",padding:"9px 0"}}>Cancel</Btn>
                <Btn variant="danger" onClick={confirmResetStation}
                  disabled={Boolean(resettingStation)} loading={Boolean(resettingStation)}
                  style={{flex:1,justifyContent:"center",padding:"9px 0"}}>
                  {resettingStation?"Resetting…":"Confirm Reset"}
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div style={{background:C.bg("card"),border:`1px solid ${C.border()}`,
        borderRadius:16,boxShadow:"var(--shadow)",overflow:"visible",position:"relative",zIndex:20}}>
        <div className="cj-gradient-bar" />
        <div style={{padding:"18px 20px 18px"}}>

          {/* Title + refresh */}
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",
            flexWrap:"wrap",gap:12,marginBottom:18}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:44,height:44,borderRadius:12,
                background:`linear-gradient(135deg,${C.navy()},${C.steel(0.8)})`,
                display:"flex",alignItems:"center",justifyContent:"center",
                boxShadow:`0 4px 12px ${C.navy(0.4)}`}}>
                <Layers size={20} color={C.linen()}/>
              </div>
              <div>
                <h1 style={{fontSize:18,fontWeight:800,color:C.txt("primary"),
                  letterSpacing:"-0.02em",lineHeight:1.2}}>🔍 Part Journey</h1>
                <p style={{fontSize:12,color:C.txt("muted"),marginTop:3}}>
                   Real-time station tracking &amp; QR genealogy
                </p>
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <Btn variant="ghost" onClick={exportJourneyReport} disabled={!stationTimeline.length}>
                <Download size={13}/> 📊 Export Report
              </Btn>
              <Btn variant="ghost" onClick={handleRefresh} disabled={refreshing||loading} loading={refreshing}>
                {!refreshing&&<RefreshCw size={13}/>}
                {refreshing?" Refreshing…":" Refresh"}
              </Btn>
            </div>
          </div>

          {/* Search bar */}
          <div style={{marginBottom:14}}>
            <p style={{fontSize:10,fontWeight:800,textTransform:"uppercase",
              letterSpacing:"0.08em",color:C.txt("muted"),marginBottom:6}}>
              🔎 Search Customer QR / Part ID / Shot Number
            </p>
            <div style={{position:"relative"}}>
              <Search size={14} color={C.txt("muted")} style={{position:"absolute",left:12,
                top:"50%",transform:"translateY(-50%)"}}/>
              <input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}
                placeholder="🔍 Scan Customer QR or enter Part ID / Shot Number…"
                className="cj-filter-input"
                style={{paddingLeft:36}}
              />
            </div>
          </div>

          {/* ── Professional Filters ── */}
          <div className="cj-filters-grid" style={{
            display:"grid",
            gridTemplateColumns:"minmax(220px,340px) repeat(3,minmax(150px,1fr)) minmax(160px,220px)",
            gap:10,
            marginBottom:12,
            alignItems:"center",
            position:"relative",
            zIndex:30,
          }}>
            <DateRangePicker
              startDate={filters.dateFrom}
              endDate={filters.dateTo}
              onApply={handleDateRangeApply}
              onClear={handleDateRangeClear}
              label="Select Date Range"
            />
            <select
              value={filters.machineId}
              onChange={(e)=>setFilters((prev)=>({...prev,machineId:e.target.value}))}
              className="cj-filter-select"
            >
              <option value=""> All Machines</option>
              {machines
                .filter((machine)=>!filters.plantId || String(machine.plantId || "") === String(filters.plantId))
                .filter((machine)=>!filters.lineId || String(machine.lineId || "") === String(filters.lineId))
                .filter((machine)=>!filters.lineName || String(machine.lineName || "").trim() === filters.lineName)
                .map((machine)=>(
                  <option key={machine.id} value={machine.id}>{machine.machineName}</option>
                ))}
            </select>
            <select
              value={filters.status}
              onChange={(e)=>setFilters((prev)=>({...prev,status:e.target.value}))}
              className="cj-filter-select"
            >
              <option value="">📊 All Status</option>
              <option value="IN_PROGRESS"> Running</option>
              <option value="COMPLETED">✅ Passed</option>
              <option value="NG">❌ Failed</option>
              <option value="INTERLOCKED">🔒 Blocked</option>
            </select>
            <select
              value={filters.shiftCode}
              onChange={(e)=>setFilters((prev)=>({...prev,shiftCode:e.target.value}))}
              className="cj-filter-select"
            >
              <option value=""> All Shifts</option>
              {availableShifts.map((shift)=>(
                <option key={shift.shiftCode} value={shift.shiftCode}>{shift.shiftName}</option>
              ))}
            </select>
            <button
              onClick={clearAllFilters}
              className="cj-btn-clear"
              style={{justifyContent:"center"}}
            >
              <X size={14} />  Clear All
            </button>
          </div>

          {/* Active Filters Chips */}
          {(activeFilters.length > 0 || (filters.dateFrom && filters.dateTo)) && (
            <div style={{
              display:"flex",
              flexWrap:"wrap",
              gap:6,
              paddingTop:12,
              borderTop:`1px solid ${C.border()}`,
            }}>
              {activeFilters.map(([key, value]) => (
                <span key={key} className="cj-filter-chip">
                  <span style={{opacity:0.6,fontWeight:600}}>{key}:</span>
                  <span style={{fontWeight:600}}>{String(value).slice(0,30)}</span>
                  <span className="remove" onClick={() => removeFilter(key)}>✕</span>
                </span>
              ))}
              {filters.dateFrom && filters.dateTo && (
                <span className="cj-filter-chip date-chip">
                  <Calendar size={11} />
                   {new Date(filters.dateFrom).toLocaleDateString()} → {new Date(filters.dateTo).toLocaleDateString()}
                  <span className="remove" onClick={() => {
                    setFilters((p) => ({ ...p, dateFrom: "", dateTo: "" }));
                  }}>✕</span>
                </span>
              )}
              <span style={{
                fontSize:9,
                color:C.muted,
                fontWeight:600,
                marginLeft:"auto",
                padding:"4px 8px",
              }}>
                🔢 {activeFilters.length + (filters.dateFrom && filters.dateTo ? 1 : 0)} active filters
              </span>
            </div>
          )}

          {/* 3 KPI stat cards */}
          {stationTimeline.length>0&&(
            <div className="cj-header-stats" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginTop:14}}>
              <StatCard label="✅ Stations Passed"      value={statusSummary.passed}     variant="ok"   icon={CheckCircle2}/>
              <StatCard label="❌ Stations Failed"      value={statusSummary.failed}     variant="ng"   icon={XCircle}/>
              <StatCard label=" In Progress"          value={statusSummary.inProgress} variant="wip"  icon={Activity}/>
            </div>
          )}
        </div>
      </div>

      {/* ── Main content: parts list + timeline ─────────────────────── */}
      <div className="cj-main-layout" style={{display:"grid",gridTemplateColumns:"290px 1fr",gap:16,alignItems:"start"}}>

        {/* ── Parts List ────────────────────────────────────────────── */}
        <div className="cj-parts-list" style={{
          background:C.bg("card"),border:`1px solid ${C.border()}`,
          borderRadius:16,boxShadow:"var(--shadow)",
          position:"sticky",top:16,
          display:"flex",flexDirection:"column",
          maxHeight:"calc(100vh - 120px)",
        }}>

          <SectionHead
            subtitle=" Part Catalog"
            title="📦 All Parts"
            accent
            right={
              <span style={{fontSize:11,fontWeight:700,color:C.txt("muted"),
                background:C.bg("hover"),padding:"3px 8px",borderRadius:6,
                border:`1px solid ${C.border()}`}}>
                📊 {parts.length}
              </span>
            }
          />

          <div style={{flex:1,overflowY:"auto",padding:"8px",
            display:"flex",flexDirection:"column",gap:6,minHeight:0}}>

            {parts.length===0 && (
              <div style={{textAlign:"center",padding:"32px 16px",color:C.txt("muted"),fontSize:13}}>
                <Package size={28} color={C.txt("muted")} style={{margin:"0 auto 10px"}}/>
                <p>📭 No parts found.</p>
                <p style={{fontSize:11,marginTop:4}}>🔍 Try a different search term.</p>
              </div>
            )}

            {parts.map(part=>{
              const active = selectedPartId===part.partId;
              const meta   = getPartMeta(active ? selectedDerivedPartStatus : part.status);
              const visiblePartId = part.displayPartId || part.partId || "-";
              return (
                <div key={part.partId} style={{
                  borderRadius:10,
                  border: active?`1px solid ${C.navy(0.5)}`:`1px solid ${C.border()}`,
                  background: active ? C.navy(0.08) : C.bg("surface"),
                  boxShadow: active?`0 0 0 3px ${C.navy(0.08)}`:"none",
                  transition:"all 0.15s ease",
                  animation:"cjSlideIn 0.18s ease",
                  flexShrink: 0,
                }}>
                  <button
                    onClick={()=>setSelectedPartId(part.partId)}
                    style={{
                      width:"100%",textAlign:"left",
                      padding:"10px 12px 8px",
                      background:"none",border:"none",
                      cursor:"pointer",display:"block",
                      borderRadius:"10px 10px 0 0",
                    }}>
                    <div style={{display:"flex",alignItems:"flex-start",
                      justifyContent:"space-between",gap:4,marginBottom:6}}>
                      <span style={{
                        fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,
                        color:active?C.navy():C.txt("primary"),
                        wordBreak:"break-all",lineHeight:1.35,flex:1,
                      }}>
                        🔹 {visiblePartId}
                      </span>
                      {active&&(
                        <ChevronRight size={13} color={C.amber()} style={{flexShrink:0,marginTop:1}}/>
                      )}
                    </div>
                    <div style={{display:"flex",alignItems:"center",
                      justifyContent:"space-between",gap:4}}>
                      <Badge variant={meta.variant} label={meta.label}/>
                      {part.currentStation&&(
                        <span style={{fontSize:10,color:C.txt("muted"),
                          display:"flex",alignItems:"center",gap:3,flexShrink:0}}>
                          <MapPin size={9}/> 📍 {part.currentStation}
                        </span>
                      )}
                    </div>
                    {part.updatedAt&&(
                      <p style={{fontSize:10,color:C.txt("muted"),marginTop:4,
                        fontFamily:"'DM Mono',monospace"}}>
                         {formatTime(part.updatedAt)}
                      </p>
                    )}
                  </button>
                  <div style={{
                    padding:"5px 8px 7px",
                    borderTop:`1px solid ${C.border()}`,
                    background: active ? C.navy(0.05) : C.bg("card"),
                    borderRadius:"0 0 10px 10px",
                  }}>
                    <PartActionBtn
                      icon={<QrCode size={12}/>}
                      label=" QR & Remove"
                      color={C.steel()}
                      bgColor={C.steel(0.1)}
                      borderColor={C.steel(0.3)}
                      hoverBg={C.steel(0.2)}
                      onClick={e=>{e.stopPropagation();setQrModalPartId(part.partId);}}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Station Timeline ──────────────────────────────────────── */}
        <div className="cj-timeline" style={{background:C.bg("card"),border:`1px solid ${C.border()}`,
          borderRadius:16,boxShadow:"var(--shadow)",overflow:"hidden",maxHeight:"calc(100vh - 120px)"}}>

          <SectionHead
            subtitle=" Station Timeline"
            title={selectedPartId ? ` ${selectedPartDisplayId}` : "🔍 Select a part from the list"}
            accent
            right={
              selectedPart&&(
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  {selectedCustomerQrCode && (
                    <span style={{fontSize:10,fontWeight:800,color:C.info(),
                      background:C.info(0.12),padding:"2px 6px",borderRadius:5}}>
                       Customer QR: {selectedCustomerQrCode}
                    </span>
                  )}
                  {selectedPart.currentStation && (
                    <>
                      <Zap size={12} color={C.amber()}/>
                      <span style={{fontSize:11,fontWeight:700,color:C.amber()}}>
                        📍 {selectedPart.currentStation}
                      </span>
                    </>
                  )}
                </div>
              )
            }
          />

          {/* Loading */}
          {loading&&(
            <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
              {[1,2,3].map(i=>(
                <div key={i} style={{borderRadius:12,border:`1px solid ${C.border()}`,
                  padding:16,background:C.bg("surface")}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <div style={{width:28,height:28,borderRadius:8,background:C.bg("hover"),animation:"cjPulse 1.2s ease-in-out infinite"}}/>
                    <div style={{height:14,width:120,borderRadius:4,background:C.bg("hover"),animation:"cjPulse 1.2s ease-in-out infinite"}}/>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <div style={{height:24,width:70,borderRadius:6,background:C.bg("hover"),animation:"cjPulse 1.2s ease-in-out infinite"}}/>
                    <div style={{height:24,width:70,borderRadius:6,background:C.bg("hover"),animation:"cjPulse 1.2s ease-in-out infinite"}}/>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading&&stationTimeline.length===0&&(
            <div style={{padding:"56px 24px",textAlign:"center"}}>
              <div style={{width:56,height:56,borderRadius:16,background:C.bg("surface"),
                border:`1px solid ${C.border()}`,display:"flex",alignItems:"center",
                justifyContent:"center",margin:"0 auto 16px"}}>
                <Layers size={24} color={C.txt("muted")}/>
              </div>
              <p style={{fontSize:14,fontWeight:600,color:C.txt("secondary"),marginBottom:6}}>
                {selectedPartId?"📭 No station data available":"🔍 Select a part to view its journey"}
              </p>
              <p style={{fontSize:12,color:C.txt("muted")}}>
                {selectedPartId
                  ?" This part has no recorded station history yet."
                  :"🖱️ Click any part in the list on the left to see its full station-by-station journey."}
              </p>
            </div>
          )}

          {/* Timeline */}
          {!loading&&stationTimeline.length>0&&(
            <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",
              gap:8,overflowY:"auto",maxHeight:"calc(100vh - 320px)"}}>

              {/* Progress bar */}
              <div style={{background:C.bg("surface"),border:`1px solid ${C.border()}`,
                borderRadius:10,padding:"10px 14px",marginBottom:4}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontSize:11,fontWeight:700,color:C.txt("muted"),
                    textTransform:"uppercase",letterSpacing:"0.07em"}}>
                     Journey Progress
                  </span>
                  <span style={{fontSize:11,fontWeight:800,color:C.txt("secondary"),
                    fontFamily:"'DM Mono',monospace"}}>
                    ✅ {statusSummary.passed}/{stationTimeline.length} stations passed
                  </span>
                </div>
                <div style={{height:6,borderRadius:99,background:C.bg("hover"),overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:99,
                    background:`linear-gradient(90deg,${C.ok()},${C.steel()})`,
                    width:`${stationTimeline.length?(statusSummary.passed/stationTimeline.length)*100:0}%`,
                    transition:"width 0.4s ease"}}/>
                </div>
                <div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                  {stationTimeline.map((st,i)=>{
                    const m=getStationMeta(getJourneyStationState(st, qrByStation[st.stationNo], getStationFeatures(st.stationNo, stationSettings)));
                    return (
                      <div key={i} title={st.stationNo} style={{
                        width:8,height:8,borderRadius:"50%",flexShrink:0,
                        background:STATUS[m.variant]?.fg||C.idle(),
                        opacity:m.variant==="idle"?0.3:1,
                      }}/>
                    );
                  })}
                </div>
              </div>

              {/* Station cards */}
              {stationTimeline.map((station,idx)=>{
                const settings = getStationFeatures(station.stationNo,stationSettings);
                const qrMeta   = qrByStation[station.stationNo];
                const effectiveStageState = getJourneyStationState(station, qrMeta, settings);
                const meta     = getStationMeta(effectiveStageState);
                const sColor   = STATUS[meta.variant]||STATUS.idle;
                const stationCustomerQrCode = sanitizeCustomerQrValue(station.customerQrCode);
                const isReset  = resettingStation===station.stationNo;
                const bypassed = isStationBypassed(station);
                const modules  = [
                  settings.qr          ?" QR Scan"  :null,
                  settings.operation   ?" Operation":null,
                  settings.rejectionBin?"🗑️ Rej. Bin" :null,
                ].filter(Boolean);

                return (
                  <div key={station.stationNo} style={{
                    borderRadius:12,
                    border:`1px solid ${sColor.border}`,
                    background:meta.variant==="idle"?C.bg("surface"):sColor.bgLight,
                    padding:"14px 16px",
                    transition:"all 0.2s ease",
                    animation:"cjFadeIn 0.25s ease",
                  }}>

                    {/* Station header */}
                    <div style={{display:"flex",alignItems:"flex-start",
                      justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:8}}>

                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:32,height:32,borderRadius:9,flexShrink:0,
                          background:sColor.bgLight,border:`1px solid ${sColor.border}`,
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:12,fontWeight:800,color:sColor.fg}}>
                          #{idx+1}
                        </div>
                        <div>
                          <p style={{fontSize:13,fontWeight:800,color:C.txt("primary"),letterSpacing:"0.01em"}}>
                            {getStationDisplayLabel(station)}
                          </p>
                          <p style={{fontSize:11,color:C.txt("muted"),marginTop:2,
                            fontFamily:"'DM Mono',monospace"}}>
                            {bypassed ? " Bypassed / auto passed" : station.latestAt ? ` Last: ${formatDate(station.latestAt)}` : " Not started"}
                          </p>
                          {station.cycleStartTime && (
                            <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                              <p style={{fontSize:10,color:C.txt("muted"),display:"flex",alignItems:"center",gap:3}}>
                                <Clock3 size={10}/>  Start: {formatDate(station.cycleStartTime)}
                              </p>
                              {station.cycleEndTime && (
                                <p style={{fontSize:10,color:C.ok(),fontWeight:700,display:"flex",alignItems:"center",gap:3}}>
                                  <CheckCircle2 size={10}/> ✅ End: {formatDate(station.cycleEndTime)}
                                </p>
                              )}
                              {station.cycleDurationSec > 0 && (
                                <span style={{fontSize:10,fontWeight:800,color:C.amber(),
                                  background:C.amber(0.12),padding:"1px 5px",borderRadius:4}}>
                                   {station.cycleDurationSec.toFixed(2)}s
                                </span>
                              )}
                            </div>
                          )}
                          {stationCustomerQrCode && (
                            <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                              <span style={{fontSize:10,fontWeight:800,color:C.info(),
                                background:C.info(0.12),padding:"2px 6px",borderRadius:5}}>
                                 Customer QR: {stationCustomerQrCode}
                              </span>
                              <span style={{fontSize:10,color:C.txt("muted"),display:"flex",alignItems:"center",gap:3}}>
                                <Clock3 size={10}/>  Read: {formatDate(station.customerQrMappedAt)}
                              </span>
                            </div>
                          )}
                          {station.customerQrPending && (
                            <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                              <span style={{fontSize:10,fontWeight:800,color:C.amber(),
                                background:C.amber(0.12),padding:"2px 6px",borderRadius:5}}>
                                 Waiting Customer QR
                              </span>
                            </div>
                          )}
                          {(station.leakTestReadings?.length > 0 ? station.leakTestReadings : (station.leakTestReading ? [station.leakTestReading] : [])).map((reading, rIdx) => {
                            const lMeta = getLeakResultMeta(reading);
                            return (
                              <div key={rIdx} style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
                                <span style={{fontSize:10,fontWeight:800,color:C.steel(),
                                  background:C.steel(0.12),padding:"2px 6px",borderRadius:5}}>
                                  🔬 Leak Machine: {reading.matchedMachineName || reading.Machine || "—"}
                                </span>
                                {lMeta && <Badge variant={lMeta.variant} label={lMeta.label} />}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        {qrMeta && (
                          <Badge variant={qrMeta.variant} label={qrMeta.label} pulse={qrMeta.variant==="wip"}/>
                        )}
                        {bypassed && (
                          <Badge variant="ok" label=" Bypassed" />
                        )}
                        <Badge variant={meta.variant} label={` ${meta.label}`} pulse={meta.variant==="wip"}/>
                        <Btn variant="ghost" onClick={()=>handleResetStation(station.stationNo)}
                          disabled={!selectedPartId||Boolean(resettingStation)}
                          loading={isReset}
                          style={{padding:"4px 10px",fontSize:11}}>
                          {!isReset&&<RotateCcw size={10}/>}
                          {isReset?" Resetting…":"Reset"}
                        </Btn>
                      </div>
                    </div>

                    {/* Module tags */}
                    {modules.length>0&&(
                      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:8}}>
                        {modules.map(mod=>(
                          <span key={mod} style={{fontSize:10,fontWeight:700,padding:"2px 8px",
                            borderRadius:5,border:`1px solid ${C.border()}`,
                            background:C.bg("hover"),color:C.txt("muted"),
                            textTransform:"uppercase",letterSpacing:"0.06em"}}>{mod}</span>
                        ))}
                      </div>
                    )}

                    {/* Attempt history */}
                    {Array.isArray(station.attempts)&&station.attempts.length>1&&(
                      <div style={{marginBottom:8}}>
                        <Divider label={` ${station.attempts.length} scan attempts`}/>
                        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:6}}>
                          {station.attempts.map((att,ai)=>{
                            const am=getStationMeta(att.plcStatus||att.status);
                            return (
                              <div key={ai} title={`Attempt ${ai+1} · ${formatDate(att.createdAt)}`}
                                style={{display:"flex",alignItems:"center",gap:5,
                                  padding:"3px 8px",borderRadius:6,fontSize:10,fontWeight:700,
                                  background:STATUS[am.variant]?.bgLight||C.bg("hover"),
                                  border:`1px solid ${STATUS[am.variant]?.border||C.border()}`,
                                  color:STATUS[am.variant]?.fg||C.txt("muted")}}>
                                <span style={{fontFamily:"monospace"}}>#{ai+1}</span>
                                <span style={{opacity:0.8}}> {formatDate(att.createdAt)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Interlock warning */}
                    {settings.rejectionBin&&!bypassed&&(station.latestInterlockReason||station.stageState==="FAILED")&&(
                      <div style={{display:"flex",alignItems:"flex-start",gap:10,
                        borderRadius:8,padding:"9px 12px",marginTop:4,
                        background:C.ng(0.08),border:`1px solid ${C.ng(0.25)}`}}>
                        <AlertTriangle size={13} color={C.ng()} style={{flexShrink:0,marginTop:1}}/>
                        <span style={{fontSize:12,color:C.ng(0.9),lineHeight:1.5}}>
                          ⚠️ {station.latestInterlockReason||"Rejection / NG detected at this station"}
                        </span>
                      </div>
                    )}
                    {(station.leakTestReadings?.length > 0 ? station.leakTestReadings : (station.leakTestReading ? [station.leakTestReading] : [])).map((reading, rIdx) => (
                      <div key={rIdx} style={{marginTop:8,borderRadius:8,padding:"10px 12px",background:C.info(0.08),border:`1px solid ${C.info(0.25)}`}}>
                        <p style={{fontSize:10,fontWeight:800,color:C.info(),textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>
                          🔬 Leak Test Details — {reading.matchedMachineName || reading.Machine || "—"}
                        </p>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
                          {LEAK_TEST_FIELDS.map(([label, key]) => (
                            <div key={key} style={{display:"flex",flexDirection:"column",gap:2}}>
                              <span style={{fontSize:10,color:C.txt("muted"),fontWeight:700}}>{label}</span>
                              <span style={{fontSize:11,color:C.txt("primary"),fontWeight:700,wordBreak:"break-word"}}>
                                {formatLeakFieldValue(reading, key)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComponentJourney;
