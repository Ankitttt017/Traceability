import React, { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { CATEGORY_COLOR, CATEGORY_NAME, SLATE, alpha, fmtInt, fmtPct, pctOf } from "../../../../components/mgmt/mgmtTheme";
import { reasonCounts } from "../deriveTabs";

/* ═══════════════════════════════════════════════════════════════════════════
   Break-up drawer of one day / hour / month of a trend chart: slides in over the right side of the chart (no extra
   card). Head figures, CR / MR / CRAM counts with %, top reasons, station split. Esc or ✕ closes it.
   recs = the bucket's station rejections (decisive NG records, enriched).
   ═══════════════════════════════════════════════════════════════════════════ */
export const DRAWER_CSS = `
.ra-drawer-host{position:relative}
.ra-drawer{position:absolute;top:34px;right:0;bottom:0;width:min(370px,92%);z-index:8;background:#fff;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 22px 48px -18px rgba(15,23,42,.45);display:flex;flex-direction:column;overflow:hidden;animation:ra-drawer-in .22s ease-out}
@keyframes ra-drawer-in{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.ra-drawer{animation:none}}
.ra-drawer-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:12px 14px 10px;border-bottom:1px solid #eef2f6;background:linear-gradient(180deg,#f8fafc,#fff)}
.ra-drawer-head b{display:block;font-size:14.5px;color:#0f172a}
.ra-drawer-head span{font-size:11.5px;color:#64748b}
.ra-drawer-body{padding:10px 14px 14px;overflow-y:auto;display:flex;flex-direction:column;gap:12px}
.ra-drawer-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.ra-drawer-stats div{border:1px solid #e2e8f0;border-radius:9px;padding:6px 8px}
.ra-drawer-stats b{display:block;font-size:16px;font-variant-numeric:tabular-nums}
.ra-drawer-stats span{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b}
.ra-drawer h6{margin:0 0 6px;font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#64748b;display:flex;justify-content:space-between}
.ra-drawer-cats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.ra-drawer-cat{border-radius:10px;padding:7px 9px;border:1px solid}
.ra-drawer-cat b{display:block;font-size:17px;font-variant-numeric:tabular-nums}
.ra-drawer-cat span{font-size:11px;font-weight:700}
.ra-drawer-cat em{font-style:normal;font-size:11px;color:#64748b;margin-left:4px}
.ra-drawer-split{display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1px;background:#f1f5f9;margin-top:6px}
.ra-drawer-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.ra-drawer-rows li{display:grid;grid-template-columns:minmax(0,1fr) auto 42px;gap:8px;align-items:center;font-size:12.5px;color:#334155}
.ra-drawer-rows li>span:first-child{min-width:0;display:flex;flex-direction:column}
.ra-drawer-rows li>span:first-child>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ra-drawer-rows i{display:block;height:3px;border-radius:2px;margin-top:3px}
.ra-drawer-rows b{font-variant-numeric:tabular-nums;color:#0f172a}
.ra-drawer-rows em{font-style:normal;text-align:right;color:#64748b;font-size:11.5px}
.ra-drawer-st{display:flex;flex-wrap:wrap;gap:6px}
.ra-drawer-st span{display:inline-flex;gap:6px;align-items:center;padding:3px 9px;border-radius:999px;background:#f1f5f9;font-size:12px;font-weight:600;color:#0f2a4a}
.ra-drawer-st span b{color:#dc2626}
`;

const CATS = ["CR", "MR", "CRAM"];
const gateOf = (r) => (r._op === "OP150" ? r._leak || "OP150" : r._op);

export default function BreakdownDrawer({ title, sub, stats = [], recs = [], onClose, extra }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const data = useMemo(() => {
    const cats = { CR: 0, MR: 0, CRAM: 0, OTHER: 0 };
    const st = new Map();
    recs.forEach((r) => { cats[r._cat] += 1; const g = gateOf(r); st.set(g, (st.get(g) || 0) + 1); });
    return { cats, total: recs.length, reasons: reasonCounts(recs).list.slice(0, 6), stations: [...st.entries()].sort((a, b) => b[1] - a[1]) };
  }, [recs]);
  const maxR = data.reasons[0]?.count || 1;

  return (
    <aside className="ra-drawer" role="dialog" aria-label={`Break-up — ${title}`}>
      <div className="ra-drawer-head">
        <div><b>{title}</b>{sub && <span>{sub}</span>}</div>
        <button type="button" className="ra-icon-btn" onClick={onClose} aria-label="Close break-up"><X size={14} /></button>
      </div>
      <div className="ra-drawer-body">
        {stats.length > 0 && (
          <div className="ra-drawer-stats">
            {stats.map((s) => <div key={s.label}><b style={s.color ? { color: s.color } : undefined}>{s.value}</b><span>{s.label}</span></div>)}
          </div>
        )}
        <div>
          <h6><span>Station rejections by category</span><span>{fmtInt(data.total)}</span></h6>
          <div className="ra-drawer-cats">
            {CATS.map((c) => (
              <div key={c} className="ra-drawer-cat" title={CATEGORY_NAME[c]} style={{ borderColor: alpha(CATEGORY_COLOR[c], 0.4), background: alpha(CATEGORY_COLOR[c], 0.06) }}>
                <b style={{ color: CATEGORY_COLOR[c] }}>{fmtInt(data.cats[c])}</b>
                <span style={{ color: CATEGORY_COLOR[c] }}>{c}</span><em>{fmtPct(pctOf(data.cats[c], data.total), 0)}</em>
              </div>
            ))}
          </div>
          <div className="ra-drawer-split" aria-hidden="true">
            {[...CATS, "OTHER"].map((c) => (data.cats[c] ? <i key={c} style={{ flex: data.cats[c], background: CATEGORY_COLOR[c] }} /> : null))}
          </div>
        </div>
        {data.reasons.length > 0 && (
          <div>
            <h6><span>Top reasons</span><span>count · share</span></h6>
            <ol className="ra-drawer-rows">
              {data.reasons.map((x) => (
                <li key={x.reason}>
                  <span><span title={x.reason}>{x.reason}</span><i style={{ width: `${(x.count / maxR) * 100}%`, background: CATEGORY_COLOR[x.cat] || SLATE[400] }} /></span>
                  <b>{fmtInt(x.count)}</b><em>{fmtPct(x.pct, 0)}</em>
                </li>
              ))}
            </ol>
          </div>
        )}
        {data.stations.length > 0 && (
          <div>
            <h6><span>By station</span></h6>
            <div className="ra-drawer-st">{data.stations.map(([g, n]) => <span key={g}>{g}<b>{fmtInt(n)}</b></span>)}</div>
          </div>
        )}
        {extra}
        {!data.total && <div style={{ fontSize: 12.5, color: SLATE[500] }}>No station rejections recorded in this period.</div>}
      </div>
    </aside>
  );
}
