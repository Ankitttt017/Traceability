import React, { useEffect, useRef, useState } from "react";
import { Calendar, Check, ChevronDown, FileSpreadsheet, RefreshCw, CheckCircle2, ShieldAlert } from "lucide-react";
import DateRangePicker from "../components/DateRangePicker";
import { RA_PERIODS, dayCount, rangeLabel } from "./periods";
import { PART } from "./derive";

const relTime = (ts, now) => {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
};

const HEADER_CSS = `
.ra-hbar{position:relative;overflow:visible;display:flex;align-items:center;justify-content:space-between;gap:12px 20px;flex-wrap:wrap;padding:14px 18px}
.ra-hbar-id{display:flex;align-items:center;gap:12px;min-width:0;flex:1 1 320px}
.ra-hbar-logo{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(145deg,#0f2a4a,#1e3a5f);color:#fff;flex-shrink:0;box-shadow:0 6px 14px -8px rgba(15,42,74,.6)}
.ra-hbar .ra-title{margin:0;font-size:21px;line-height:1.15;font-weight:800;letter-spacing:-.02em;color:#0f2a4a}
.ra-hbar-sub{margin:3px 0 0;font-size:12.5px;color:#64748b;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ra-hbar-sub b{color:#0f172a;font-weight:700}
.ra-hbar-sub i{width:3px;height:3px;border-radius:50%;background:#94a3b8;display:inline-block}
.ra-hbar-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ra-period{position:relative}
.ra-period-btn{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 10px 0 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#0f172a;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;min-width:190px;justify-content:space-between}
.ra-period-btn:hover{border-color:#94a3b8;background:#f8fafc}
.ra-period-btn[aria-expanded="true"]{border-color:#0f2a4a;box-shadow:0 0 0 3px rgba(15,42,74,.12)}
.ra-period-btn small{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b}
.ra-period-btn span{display:inline-flex;align-items:center;gap:7px}
.ra-period-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:60;min-width:220px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 18px 40px rgba(15,23,42,.18);padding:6px}
.ra-period-menu button.opt{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:8px 10px;border:none;border-radius:8px;background:transparent;font:inherit;font-size:13px;font-weight:600;color:#334155;cursor:pointer;text-align:left}
.ra-period-menu button.opt:hover{background:#f1f5f9}
.ra-period-menu button.opt.on{background:#0f2a4a;color:#fff}
.ra-period-menu hr{border:none;border-top:1px solid #f1f5f9;margin:4px 2px}
.ra-period-pick{position:absolute;top:calc(100% + 6px);right:0;z-index:61;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 18px 40px rgba(15,23,42,.18);padding:10px}
.ra-btn-sm{height:36px;padding:0 12px;font-size:12.5px;gap:6px}
@media (max-width:640px){.ra-hbar{padding:12px 14px}.ra-hbar .ra-title{font-size:18px}.ra-hbar-logo{width:34px;height:34px}.ra-period-btn{min-width:0}.ra-period-menu,.ra-period-pick{right:auto;left:0}}
`;

/**
 * Page header — title, part and period on the left; ONE period dropdown (Today · Last 7 / 30 / 90 days · Custom
 * range of production days), refresh and export on the right. No other filters in the header.
 * filters: { datePreset, dateFrom, dateTo }
 */
export default function HeaderBar({
  filters, onPreset, onCustom, lastUpdated, loading, onRefresh, onExport, exportState = "idle", machine,
  title = "Rejection Analysis", clearPreset = "last30",
}) {
  const [open, setOpen] = useState(null); // null | "menu" | "custom"
  const [now, setNow] = useState(() => Date.now());
  const boxRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(null); };
    const esc = (e) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const isCustom = filters.datePreset === "custom";
  const current = RA_PERIODS.find((p) => p.value === filters.datePreset);
  const periodText = current ? current.label : isCustom ? "Custom range" : rangeLabel(filters.dateFrom, filters.dateTo);
  const days = dayCount(filters.dateFrom, filters.dateTo);
  const updated = loading && !lastUpdated ? "Loading…" : `Updated ${relTime(lastUpdated, now)}`;

  return (
    <header className="ra-hbar mg-card">
      <style>{HEADER_CSS}</style>
      <div className="ra-hbar-id">
        <span className="ra-hbar-logo" aria-hidden="true"><ShieldAlert size={20} /></span>
        <div style={{ minWidth: 0 }}>
          <h1 className="ra-title">{title}</h1>
          <p className="ra-hbar-sub" title={`Production day 06:00 → 06:00 · ${machine || "UBE 850 T - 02"}`}>
            <span>{PART.label} ({PART.code})</span><i aria-hidden="true" />
            <b>{rangeLabel(filters.dateFrom, filters.dateTo)}</b>
            {days > 1 && <span>({days} production days)</span>}<i aria-hidden="true" />
            <span>day 06:00 → 06:00</span>
          </p>
        </div>
      </div>

      <div className="ra-hbar-actions">
        <div className="ra-period" ref={boxRef}>
          <button
            type="button"
            className="ra-period-btn"
            aria-haspopup="listbox"
            aria-expanded={!!open}
            aria-label={`Period: ${periodText}`}
            onClick={() => setOpen((o) => (o ? null : "menu"))}
          >
            <span><Calendar size={15} aria-hidden="true" /><small>Period</small>{periodText}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {open === "menu" && (
            <div className="ra-period-menu" role="listbox" aria-label="Period">
              {RA_PERIODS.map((p) => {
                const on = filters.datePreset === p.value;
                return (
                  <button key={p.value} type="button" role="option" aria-selected={on} className={`opt ${on ? "on" : ""}`} onClick={() => { onPreset(p.value); setOpen(null); }}>
                    {p.label}{on && <Check size={14} aria-hidden="true" />}
                  </button>
                );
              })}
              <hr />
              <button type="button" role="option" aria-selected={isCustom} className={`opt ${isCustom ? "on" : ""}`} onClick={() => setOpen("custom")}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Calendar size={14} aria-hidden="true" />Custom range…</span>
                {isCustom && <Check size={14} aria-hidden="true" />}
              </button>
            </div>
          )}
          {open === "custom" && (
            <div className="ra-period-pick">
              <DateRangePicker
                key={`${filters.dateFrom}|${filters.dateTo}`}
                startDate={filters.dateFrom}
                endDate={filters.dateTo}
                onApply={(f, t) => { onCustom(f, t); setOpen(null); }}
                onClear={() => { onPreset(clearPreset); setOpen(null); }}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          className="ra-btn ra-btn-sm"
          onClick={onRefresh}
          disabled={loading}
          aria-label={`Refresh data (${updated})`}
          title={lastUpdated ? `${updated} · ${new Date(lastUpdated).toLocaleString()}` : updated}
        >
          <RefreshCw size={14} className={loading ? "ra-spin" : ""} /> <span>{loading && !lastUpdated ? "Loading…" : relTime(lastUpdated, now)}</span>
        </button>
        {onExport && (
          <button type="button" className="ra-btn ra-btn-sm primary" onClick={onExport} disabled={exportState === "loading"}>
            {exportState === "loading" ? <RefreshCw size={14} className="ra-spin" /> : exportState === "success" ? <CheckCircle2 size={14} /> : <FileSpreadsheet size={14} />}
            <span>{exportState === "loading" ? "Exporting…" : exportState === "success" ? "Exported" : "Export"}</span>
          </button>
        )}
      </div>
      {loading && <div className="ra-progress" aria-hidden="true" />}
    </header>
  );
}
