import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Search, X } from "lucide-react";
import { CATEGORY_COLOR, NAVY, OUTCOME_COLOR, SLATE, alpha, fmtInt } from "../../../components/mgmt/mgmtTheme";
import { ALL_45_PARAMETERS, formatResultTimestamp, looksLikeCustomerQr, parseRowDefect } from "../rejectionConstants";
import { productionDayOf } from "./deriveTabs";

/* ═══════════════════════════════════════════════════════════════════════════
   Scrap records — every rejected part of the period in one clean table:
   sticky header · search · filters (category, station, production day) · category chips · station result chips
   OP100 … OP160 · defect location (view › zone › sub-zone) · key process readings with units · expandable row with
   every reading · pages of 50 · Excel export (all matching records).
   ═══════════════════════════════════════════════════════════════════════════ */
const CSS = `
.st-root{display:flex;flex-direction:column;min-width:0}
.st-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;padding:16px 18px 10px}
.st-head h3{margin:0;font-size:16px;font-weight:700;color:#0f172a}
.st-head p{margin:3px 0 0;font-size:12.5px;color:#64748b}
.st-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 13px;border-radius:9px;border:1px solid #0f2a4a;background:#0f2a4a;color:#fff;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap}
.st-btn:disabled{opacity:.5;cursor:default}
.st-tools{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:0 18px 12px;border-bottom:1px solid #e2e8f0}
.st-search{display:flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;min-width:260px;flex:1 1 260px;max-width:380px}
.st-search input{border:none;outline:none;font:inherit;font-size:12.5px;flex:1;min-width:0;background:transparent}
.st-search button{border:none;background:none;color:#94a3b8;cursor:pointer;display:grid;place-items:center}
.st-select{height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font:inherit;font-size:12.5px;font-weight:600;color:#0f172a}
.st-count{margin-left:auto;font-size:12.5px;color:#64748b}
.st-count b{color:#0f172a}
.st-wrap{overflow:auto;max-height:640px}
.st-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;font-variant-numeric:tabular-nums}
.st-table th{position:sticky;top:0;z-index:2;background:#f8fafc;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;text-align:left;padding:9px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap}
.st-table th.r,.st-table td.r{text-align:right}
.st-table td{padding:9px 10px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:middle;white-space:nowrap}
.st-table tbody tr.row{cursor:pointer}
.st-table tbody tr.row:hover td{background:#f8fafc}
.st-table tbody tr.open td{background:#eef3f9}
.st-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:#0f172a;font-weight:600}
.st-qr{display:block;font-size:10.5px;color:#94a3b8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.st-chip{display:inline-block;padding:1px 8px;border-radius:999px;border:1px solid;font-size:11px;font-weight:800}
.st-st{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:7px;background:#eef3f9;color:#0f2a4a;font-weight:700;font-size:11.5px}
.st-res{display:flex;gap:3px}
.st-res span{display:inline-grid;place-items:center;min-width:36px;height:20px;padding:0 4px;border-radius:5px;font-size:10px;font-weight:800;border:1px solid}
.st-loc{display:flex;flex-direction:column;line-height:1.3}
.st-loc small{font-size:10.5px;color:#94a3b8}
.st-reading b{color:#0f172a}
.st-reading small{color:#94a3b8;margin-left:2px}
.st-detail td{background:#fbfcfe!important;white-space:normal;padding:12px 16px 14px}
.st-dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px 14px}
.st-dgrid div{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed #e2e8f0;padding:3px 0;font-size:12px}
.st-dgrid div span{color:#64748b}
.st-dgrid div b{color:#0f172a;font-variant-numeric:tabular-nums}
.st-dtitle{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;margin:0 0 6px}
.st-pager{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 18px;border-top:1px solid #e2e8f0;font-size:12.5px;color:#64748b}
.st-pager button{display:grid;place-items:center;width:30px;height:30px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f2a4a;cursor:pointer}
.st-pager button:disabled{opacity:.35;cursor:default}
.st-empty{padding:34px;text-align:center;color:#64748b}
`;

const OPS = ["OP100", "OP110", "OP120", "OP130", "OP140", "OP150", "OP160"];
const CATS = ["CR", "MR", "CRAM"];
const PAGE = 50;
const KEY_READINGS = [
  ["metal_pressure", "Metal press.", "MPa"], ["furnace_metal_temp", "Metal temp", "°C"], ["biscuit_thickness", "Biscuit", "mm"], ["plc_cycle_time", "Cycle", "s"],
];
const val = (r, k) => { const v = r?.[k]; const n = Number(v); return v === "" || v == null || !Number.isFinite(n) || n === 0 ? null : n; };
const fmtV = (n) => (n == null ? "—" : Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(1));
const stationOf = (r) => {
  const st = String(r.ngStation || r.ng_station || "");
  const m = st.match(/Leak[\s-]*Test[\s-]*0?(\d)/i);
  if (m) return `LT-${m[1]}`;
  return String(r.ngGate || r.ng_gate || "").toUpperCase().match(/OP\d{3}/)?.[0] || "—";
};
const resChip = (v) => {
  const s = String(v || "").toUpperCase();
  if (["OK", "PASSED", "ENDED_OK", "COMPLETED_OK"].includes(s)) return { t: "OK", c: OUTCOME_COLOR.ok };
  if (["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"].includes(s)) return { t: "NG", c: OUTCOME_COLOR.ng };
  return { t: "—", c: SLATE[300] };
};

export default function ScrapTable({ rows = [], total = 0, loading = false, onExport, onSearchChange }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [station, setStation] = useState("");
  const [day, setDay] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(null);

  const list = useMemo(() => rows.map((r) => {
    const p = parseRowDefect(r);
    const rawId = String(r.partId || r.part_id || "").trim();
    const qr = String(r.customerQrCode || r.customer_qr || "").trim();
    const isQr = !rawId || looksLikeCustomerQr(rawId) || rawId === qr;
    const at = r.ngRecordedAt || r.createdAt;
    return {
      r, key: r.rowKey || r.id, partId: isQr ? "" : rawId, qr: qr && qr !== "-" ? qr : isQr ? rawId : "",
      at, atText: formatResultTimestamp(at) || "—", day: productionDayOf(at), shift: String(r.shiftCode || r.shift_code || "").replace(/^SHIFT_/, "") || "—",
      station: stationOf(r), cat: (CATS.includes(String(p.category || r.rejection_category || "").toUpperCase()) ? String(p.category || r.rejection_category).toUpperCase() : "—"),
      reason: p.reason || r.rejection_reason || "—", view: r.rejection_view || p.view || "", zone: r.rejection_zone || p.zone || "", sub: r.rejection_sub_zone || p.subZone || "",
      die: r.dieName || r.die_name || "", shot: r.shot_number || r.shotNumber || "",
    };
  }), [rows]);
  const days = useMemo(() => [...new Set(list.map((x) => x.day).filter(Boolean))].sort().reverse(), [list]);
  const stations = useMemo(() => [...new Set(list.map((x) => x.station).filter((s) => s !== "—"))].sort(), [list]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return list.filter((x) => (!cat || x.cat === cat) && (!station || x.station === station) && (!day || x.day === day)
      && (!t || [x.partId, x.qr, x.reason, x.zone, x.sub, x.view, x.station, x.die, x.shot].some((v) => String(v).toLowerCase().includes(t))));
  }, [list, q, cat, station, day]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const pageRows = shown.slice(pg * PAGE, pg * PAGE + PAGE);
  const setFilter = (fn) => (v) => { fn(v); setPage(0); setOpen(null); };

  return (
    <div className="ra-card st-root">
      <style>{CSS}</style>
      <div className="st-head">
        <div>
          <h3>Scrap records</h3>
          <p>Every rejected part of the period with its station results, defect location and process readings · {fmtInt(total || rows.length)} records · click a row for every reading</p>
        </div>
        {onExport && <button type="button" className="st-btn" onClick={onExport} disabled={!rows.length}><Download size={14} />Export to Excel</button>}
      </div>
      <div className="st-tools">
        <label className="st-search"><Search size={14} color={SLATE[400]} />
          <input type="text" placeholder="Search part, QR, reason, zone, die, shot…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); onSearchChange?.(e.target.value); }} aria-label="Search scrap records" />
          {q && <button type="button" onClick={() => { setQ(""); onSearchChange?.(""); }} aria-label="Clear search"><X size={13} /></button>}
        </label>
        <div className="ra-seg ra-seg-sm" role="group" aria-label="Category">
          {["", ...CATS].map((c) => (
            <button key={c || "all"} type="button" className={cat === c ? "on" : ""} aria-pressed={cat === c} onClick={() => setFilter(setCat)(c)}>
              {c && <span className="ra-dot" style={{ background: CATEGORY_COLOR[c] }} />}{c || "All"}
            </button>
          ))}
        </div>
        <select className="st-select" value={station} onChange={(e) => setFilter(setStation)(e.target.value)} aria-label="Station">
          <option value="">All stations</option>
          {stations.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="st-select" value={day} onChange={(e) => setFilter(setDay)(e.target.value)} aria-label="Production day">
          <option value="">All days</option>
          {days.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="st-count"><b>{fmtInt(shown.length)}</b> of {fmtInt(list.length)} shown</span>
      </div>
      <div className="st-wrap">
        <table className="st-table">
          <thead>
            <tr>
              <th style={{ width: 30 }} aria-label="Expand" />
              <th>Part / customer QR</th><th>Rejected at</th><th>Shift</th><th>Station</th><th>Category</th><th>Defect</th>
              <th>Location</th><th>Station results</th><th>Die</th>
              {KEY_READINGS.map(([, l, u]) => <th key={l} className="r">{l} ({u})</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? <tr><td colSpan={10 + KEY_READINGS.length} className="st-empty">Loading scrap records…</td></tr>
              : !pageRows.length ? <tr><td colSpan={10 + KEY_READINGS.length} className="st-empty">No records match.</td></tr>
                : pageRows.map((x) => {
                  const isOpen = open === x.key;
                  return (
                    <React.Fragment key={x.key}>
                      <tr className={`row ${isOpen ? "open" : ""}`} onClick={() => setOpen(isOpen ? null : x.key)} tabIndex={0}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : x.key); } }} aria-expanded={isOpen}>
                        <td><ChevronDown size={14} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s", color: SLATE[500] }} /></td>
                        <td><span className="st-id">{x.partId || x.qr || "—"}</span>{x.partId && x.qr && <span className="st-qr">{x.qr}</span>}</td>
                        <td>{x.atText}</td>
                        <td>{x.shift}</td>
                        <td><span className="st-st">{x.station}</span></td>
                        <td>{x.cat !== "—" ? <span className="st-chip" style={{ color: CATEGORY_COLOR[x.cat], borderColor: alpha(CATEGORY_COLOR[x.cat], 0.45), background: alpha(CATEGORY_COLOR[x.cat], 0.07) }}>{x.cat}</span> : "—"}</td>
                        <td style={{ fontWeight: 600, color: "#0f172a", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={x.reason}>{x.reason}</td>
                        <td>{x.zone || x.view ? <span className="st-loc"><span>{[x.zone, x.sub].filter(Boolean).join(" › ") || "—"}</span><small>{x.view}</small></span> : <span style={{ color: SLATE[400] }}>—</span>}</td>
                        <td>
                          <span className="st-res">
                            {OPS.map((op) => {
                              const c = resChip(x.r[`${op.toLowerCase()}_status`]);
                              return <span key={op} title={`${op}: ${c.t}`} style={{ color: c.c, borderColor: alpha(c.c, 0.5), background: c.t === "—" ? "#fff" : alpha(c.c, 0.08) }}>{op.slice(2)}</span>;
                            })}
                          </span>
                        </td>
                        <td>{x.die || "—"}</td>
                        {KEY_READINGS.map(([k, , u]) => { const v = val(x.r, k); return <td key={k} className="r st-reading">{v == null ? <span style={{ color: SLATE[300] }}>—</span> : <><b>{fmtV(v)}</b><small>{u}</small></>}</td>; })}
                      </tr>
                      {isOpen && (
                        <tr className="st-detail">
                          <td colSpan={10 + KEY_READINGS.length}>
                            <p className="st-dtitle">Part details</p>
                            <div className="st-dgrid" style={{ marginBottom: 12 }}>
                              <div><span>Part ID</span><b>{x.partId || "—"}</b></div>
                              <div><span>Customer QR</span><b>{x.qr || "—"}</b></div>
                              <div><span>Shot number</span><b>{x.shot || "—"}</b></div>
                              <div><span>Machine</span><b>{x.r.machineName || x.r.machine_name || "—"}</b></div>
                              <div><span>NG station</span><b>{x.r.ngStation || x.r.ng_station || x.station}</b></div>
                              <div><span>Production day</span><b>{x.day || "—"}</b></div>
                              <div><span>View</span><b>{x.view || "—"}</b></div>
                              <div><span>Zone / sub-zone</span><b>{[x.zone, x.sub].filter(Boolean).join(" › ") || "—"}</b></div>
                              {val(x.r, "leak_body_leak_value") != null && <div><span>Leak body value</span><b>{fmtV(val(x.r, "leak_body_leak_value"))} mbar</b></div>}
                            </div>
                            <p className="st-dtitle">Process readings of the shot</p>
                            {ALL_45_PARAMETERS.some((pp) => val(x.r, pp.key) != null) ? (
                              <div className="st-dgrid">
                                {ALL_45_PARAMETERS.filter((pp) => val(x.r, pp.key) != null).map((pp) => (
                                  <div key={pp.key}><span>{pp.label}</span><b>{fmtV(val(x.r, pp.key))} <small style={{ color: SLATE[500], fontWeight: 500 }}>{pp.unit}</small></b></div>
                                ))}
                              </div>
                            ) : <div style={{ fontSize: 12, color: SLATE[500] }}>No DCM shot record for this part (no process readings).</div>}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
          </tbody>
        </table>
      </div>
      <div className="st-pager">
        <span>Rows {shown.length ? pg * PAGE + 1 : 0}–{Math.min(shown.length, pg * PAGE + PAGE)} of {fmtInt(shown.length)}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={() => setPage(pg - 1)} disabled={pg === 0} aria-label="Previous page"><ChevronLeft size={15} /></button>
          <span style={{ color: NAVY, fontWeight: 700 }}>{pg + 1} / {pages}</span>
          <button type="button" onClick={() => setPage(pg + 1)} disabled={pg >= pages - 1} aria-label="Next page"><ChevronRight size={15} /></button>
        </span>
      </div>
    </div>
  );
}
