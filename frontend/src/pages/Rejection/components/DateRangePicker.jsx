import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/* ── Production-day date range picker ────────────────────────────────────────
   Pick one day (click once) or a range (click start, then end). Apply sends PLAIN local dates "YYYY-MM-DD",
   which the server reads as production days (same as the Report page). (It used to send
   toISOString() of local midnight — 1 Sep became "2026-08-31T18:30Z" — which shifted the range by a day and
   counted midnight-to-midnight instead of production days.) */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD…" (or a Date) → local midnight Date; never via UTC. */
const toLocalDay = (v) => {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmt = (d) => `${String(d.getDate()).padStart(2, "0")} ${MON[d.getMonth()]} ${d.getFullYear()}`;
const sameDay = (a, b) => a && b && a.getTime() === b.getTime();

const DateRangePicker = ({ startDate, endDate, onApply, onClear }) => {
  const [month, setMonth] = useState(() => { const d = toLocalDay(startDate) || new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [start, setStart] = useState(() => toLocalDay(startDate));
  const [end, setEnd] = useState(() => toLocalDay(endDate));
  const [hover, setHover] = useState(null);

  // (the parent remounts this picker with a key when the applied dates change, so state starts from the props)

  const today = toLocalDay(new Date());
  const pick = (d) => {
    if (!start || end) { setStart(d); setEnd(null); return; }
    if (d < start) { setEnd(start); setStart(d); } else setEnd(d);
  };
  const last = end || start;
  const days = last && start ? Math.round((last - start) / 86400000) + 1 : 0;

  const year = month.getFullYear(), mon = month.getMonth();
  const cells = [];
  for (let i = 0; i < new Date(year, mon, 1).getDay(); i++) cells.push(null);
  for (let d = 1; d <= new Date(year, mon + 1, 0).getDate(); d++) cells.push(new Date(year, mon, d));
  const rangeEnd = end || (start && hover && hover > start ? hover : null);

  return (
    <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 12px 32px rgba(15,23,42,0.14)", padding: 14, width: 300 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(year, mon - 1, 1))} style={navBtn}><ChevronLeft size={16} /></button>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0f172a" }}>{month.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</span>
        <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(year, mon + 1, 1))} style={navBtn}><ChevronRight size={16} /></button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "#94a3b8", marginBottom: 4 }}>
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <span key={d}>{d}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: 3 }} onMouseLeave={() => setHover(null)}>
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const isEdge = sameDay(d, start) || sameDay(d, end);
          const inRange = start && rangeEnd && d > start && d < rangeEnd;
          const future = d > today;
          return (
            <button key={ymd(d)} type="button" disabled={future} onClick={() => pick(d)} onMouseEnter={() => setHover(d)}
              title={fmt(d)}
              style={{
                height: 32, border: "none", cursor: future ? "not-allowed" : "pointer", fontSize: 12.5,
                fontWeight: isEdge ? 700 : sameDay(d, today) ? 700 : 500,
                borderRadius: isEdge ? 8 : inRange ? 0 : 8,
                background: isEdge ? "#1e3a8a" : inRange ? "rgba(30,58,138,0.10)" : "transparent",
                color: isEdge ? "#ffffff" : future ? "#cbd5e1" : inRange ? "#1e3a8a" : "#0f172a",
                boxShadow: sameDay(d, today) && !isEdge ? "inset 0 0 0 1px #94a3b8" : "none",
              }}>
              {d.getDate()}
            </button>
          );
        })}
      </div>

      {/* exactly what will be counted */}
      <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 9, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 11.5, color: "#475569", lineHeight: 1.5 }}>
        {start ? (
          <>
            <b style={{ color: "#0f172a" }}>{days === 1 ? "1 day" : `${days} days`}</b>
            <div>{end && !sameDay(start, end) ? `${fmt(start)} – ${fmt(end)}` : fmt(start)}</div>
            {!end && <div style={{ color: "#94a3b8" }}>Click another day for a range, or Apply for this day.</div>}
          </>
        ) : "Pick a day, or a start and an end day."}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={() => { setStart(null); setEnd(null); if (typeof onClear === "function") onClear(); }} style={secondaryBtn}>Reset</button>
        <button type="button" disabled={!start} onClick={() => { if (start && typeof onApply === "function") onApply(ymd(start), ymd(end || start)); }} style={{ ...primaryBtn, opacity: start ? 1 : 0.5 }}>Apply</button>
      </div>
    </div>
  );
};

const navBtn = { width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: "pointer", color: "#334155" };
const secondaryBtn = { padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#334155", cursor: "pointer" };
const primaryBtn = { padding: "6px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", background: "#1e3a8a", color: "#ffffff", cursor: "pointer" };

export default DateRangePicker;
