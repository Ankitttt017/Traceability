import React, { useMemo, useState } from "react";
import { MousePointerClick, X } from "lucide-react";
import SectionCard from "../../../../components/mgmt/SectionCard";
import { SkeletonBlock } from "../../../../components/mgmt/Skeleton";
import EmptyState from "../../../../components/mgmt/EmptyState";
import { CATEGORY_COLOR, HEAT, SLATE, fmtInt, fmtPct, heatColor, heatInk, pctOf } from "../../../../components/mgmt/mgmtTheme";
import { stationName } from "../derive";
import { RecordsTable } from "../RecordsSection";

/* ═══════════════════════════════════════════════════════════════════════════
   Station × reason matrix — top rejection reasons (rows) against the station that rejected the part (columns).
   Cell = NG records; colour intensity = count (same heat ramp as the defect map). Click a cell → its NG records;
   click a station or a reason header → all of that station / reason.
   ═══════════════════════════════════════════════════════════════════════════ */
export const SRM_CSS = `
.ra-srm-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.ra-srm{border-collapse:separate;border-spacing:3px;font-size:12px;font-variant-numeric:tabular-nums;min-width:100%}
.ra-srm th{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;padding:4px 6px;white-space:nowrap}
.ra-srm thead th{text-align:center}
.ra-srm thead th button,.ra-srm tbody th button{border:none;background:transparent;font:inherit;color:inherit;cursor:pointer;padding:2px 4px;border-radius:6px;letter-spacing:inherit;text-transform:inherit}
.ra-srm thead th button:hover,.ra-srm tbody th button:hover{background:#f1f5f9;color:#0f172a}
.ra-srm thead th small{display:block;font-size:10px;font-weight:600;color:#94a3b8;text-transform:none;letter-spacing:0}
.ra-srm tbody th{text-align:left;font-size:12px;font-weight:600;color:#0f172a;text-transform:none;letter-spacing:0;max-width:240px}
.ra-srm tbody th button{display:flex;align-items:center;gap:7px;max-width:240px;text-transform:none;letter-spacing:0;font-weight:600;color:#0f172a;font-size:12px}
.ra-srm tbody th button span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ra-srm tbody th i{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.ra-srm td.c{min-width:58px;height:34px;text-align:center;font-weight:700;border-radius:7px;cursor:pointer;transition:box-shadow .12s}
.ra-srm td.c:hover{box-shadow:0 0 0 2px #0f2a4a inset}
.ra-srm td.c.on{box-shadow:0 0 0 2px #0f2a4a inset,0 0 0 2px #fff}
.ra-srm td.c.zero{cursor:default;color:#cbd5e1;background:#f8fafc}
.ra-srm td.c.zero:hover{box-shadow:none}
.ra-srm td.t,.ra-srm tfoot td{text-align:right;font-weight:700;color:#0f172a;padding:0 8px;white-space:nowrap}
.ra-srm tfoot td{padding-top:4px;border-top:1px solid #e2e8f0}
.ra-srm-scale{display:flex;align-items:center;gap:4px;font-size:11px;color:#64748b;margin-top:6px}
.ra-srm-scale i{width:22px;height:9px;border-radius:2px;display:inline-block}
.ra-srm-detail{margin-top:14px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;background:#fbfcfe}
.ra-srm-detail-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.ra-srm-detail-head b{font-size:14px;color:#0f172a}
`;

const TOP = 10;
const ORDER = ["OP100", "OP110", "OP120", "OP130", "OP140", "LT-1", "LT-2", "LT-3", "OP150", "OP160"];
const colOf = (r) => (r._op === "OP150" ? r._leak || "OP150" : r._op);
const colName = (c) => (c.startsWith("LT-") ? `Leak test ${c}` : stationName(c).replace(/^OP\d{3}\s*/, ""));

export default function StationReasonMatrix({ enriched, rowsLoading }) {
  const [sel, setSel] = useState(null); // { reason?, col? }
  const m = useMemo(() => {
    if (!enriched) return null;
    const byReason = new Map();
    enriched.forEach((r) => byReason.set(r._reason, (byReason.get(r._reason) || 0) + 1));
    const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([reason]) => reason);
    const inTop = new Set(reasons);
    const cells = {};
    const cols = new Set();
    const cat = {};
    enriched.forEach((r) => {
      if (!inTop.has(r._reason)) return;
      const c = colOf(r);
      cols.add(c);
      const row = cells[r._reason] || (cells[r._reason] = {});
      row[c] = (row[c] || 0) + 1;
      const cc = cat[r._reason] || (cat[r._reason] = {});
      cc[r._cat] = (cc[r._cat] || 0) + 1;
    });
    const rank = (c) => { const i = ORDER.indexOf(c); return i < 0 ? 99 : i; };
    const colList = [...cols].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    let max = 0;
    reasons.forEach((rs) => colList.forEach((c) => { max = Math.max(max, cells[rs]?.[c] || 0); }));
    const rowTot = Object.fromEntries(reasons.map((rs) => [rs, colList.reduce((a, c) => a + (cells[rs]?.[c] || 0), 0)]));
    const colTot = Object.fromEntries(colList.map((c) => [c, reasons.reduce((a, rs) => a + (cells[rs]?.[c] || 0), 0)]));
    const domCat = Object.fromEntries(reasons.map((rs) => [rs, Object.entries(cat[rs] || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "OTHER"]));
    return { reasons, cols: colList, cells, max, rowTot, colTot, domCat, grand: Object.values(rowTot).reduce((a, v) => a + v, 0), total: enriched.length };
  }, [enriched]);

  const recs = useMemo(() => {
    if (!sel || !enriched) return null;
    return enriched.filter((r) => (!sel.reason || r._reason === sel.reason) && (!sel.col || colOf(r) === sel.col));
  }, [sel, enriched]);
  const pick = (next) => setSel((s) => (s && s.reason === next.reason && s.col === next.col ? null : next));
  const selTitle = sel ? [sel.reason, sel.col && `${sel.col} ${colName(sel.col)}`].filter(Boolean).join(" · ") : "";

  return (
    <SectionCard
      id="ra-station-reason"
      title="Station × reason — where each reason is rejected"
      subtitle={`Top ${TOP} reasons against the station that rejected the part. Darker = more NG records. Click a cell for its records.`}
      info={{
        what: "NG part records of the period, counted by rejection reason (rows) and by the station that rejected the part (columns; the leak-test machines separately). Only the most frequent reasons are shown.",
        formula: ["Cell = NG records with that reason at that station", "Row total = all stations · share = of all NG records"],
        note: "NG shots of the die-casting machine are not part records and are not in this matrix.",
      }}
      actions={<span className="mg-hint"><MousePointerClick size={13} aria-hidden="true" />Click a cell</span>}
    >
      {rowsLoading && !enriched ? <SkeletonBlock lines={6} height={300} />
        : !m?.reasons.length ? <EmptyState title="No NG records in this period" />
          : (
            <>
              <div className="ra-srm-wrap">
                <table className="ra-srm">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Reason</th>
                      {m.cols.map((c) => (
                        <th key={c}><button type="button" onClick={() => pick({ col: c })} title={`All top-reason NG records at ${c}`}>{c}<small>{colName(c)}</small></button></th>
                      ))}
                      <th style={{ textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.reasons.map((rs) => (
                      <tr key={rs}>
                        <th scope="row">
                          <button type="button" onClick={() => pick({ reason: rs })} title={`${rs} — all stations`}>
                            <i style={{ background: CATEGORY_COLOR[m.domCat[rs]] || CATEGORY_COLOR.OTHER }} /><span>{rs}</span>
                          </button>
                        </th>
                        {m.cols.map((c) => {
                          const v = m.cells[rs]?.[c] || 0;
                          const on = sel && sel.reason === rs && sel.col === c;
                          return (
                            <td
                              key={c}
                              className={`c ${v ? "" : "zero"} ${on ? "on" : ""}`}
                              style={v ? { background: heatColor(v, m.max), color: heatInk(v, m.max) } : undefined}
                              title={`${rs} at ${c}: ${fmtInt(v)} NG records${v ? ` (${fmtPct(pctOf(v, m.rowTot[rs]), 0)} of the reason)` : ""}`}
                              onClick={v ? () => pick({ reason: rs, col: c }) : undefined}
                              tabIndex={v ? 0 : -1}
                              onKeyDown={v ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick({ reason: rs, col: c }); } } : undefined}
                            >
                              {v ? fmtInt(v) : "·"}
                            </td>
                          );
                        })}
                        <td className="t">{fmtInt(m.rowTot[rs])} <span style={{ color: SLATE[500], fontWeight: 600 }}>{fmtPct(pctOf(m.rowTot[rs], m.total), 0)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ textAlign: "left" }}>Total (top {m.reasons.length})</td>
                      {m.cols.map((c) => <td key={c} style={{ textAlign: "center" }}>{fmtInt(m.colTot[c])}</td>)}
                      <td>{fmtInt(m.grand)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="ra-srm-scale" aria-hidden="true">
                <span>Fewer</span>{HEAT.map((c) => <i key={c} style={{ background: c }} />)}<span>More (max {fmtInt(m.max)})</span>
                <span style={{ marginLeft: "auto" }}>{fmtInt(m.grand)} of {fmtInt(m.total)} NG records in the top {m.reasons.length} reasons</span>
              </div>
              {sel && recs && (
                <div className="ra-srm-detail">
                  <div className="ra-srm-detail-head">
                    <b>{selTitle} — {fmtInt(recs.length)} NG records</b>
                    <button type="button" className="ra-icon-btn" onClick={() => setSel(null)} aria-label="Close records"><X size={14} /></button>
                  </div>
                  <RecordsTable enriched={recs} pageSize={10} hideStation={!!sel.col} />
                </div>
              )}
            </>
          )}
    </SectionCard>
  );
}
