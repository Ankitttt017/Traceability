import React, { useEffect, useMemo, useState } from "react";
import { Sliders, Download, X, Search } from "lucide-react";
import { saveAs } from "file-saver";
import { MASTER_RECIPE_SET_PARAMETERS } from "../rejectionConstants";
import { NAVY, NAVY_3, OUTCOME_COLOR, SLATE, STATUS_BG, STATUS_COLOR, alpha } from "../../../components/mgmt/mgmtTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   Master casting recipe & parameter intelligence — every PLC parameter with its set limits (LSL · nominal · USL),
   the live OK-part mean and NG-part mean (part-level process analysis), where they sit in the limit band and a
   status: in limits · near a limit (outer 10 % of the band) · outside · no limits set.
   ═══════════════════════════════════════════════════════════════════════════ */
const CSS = `
.mr-back{position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
.mr{width:100%;max-width:1280px;max-height:92vh;display:flex;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 30px 60px -20px rgba(15,23,42,.45);overflow:hidden;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a}
.mr-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #e2e8f0}
.mr-id{display:flex;align-items:center;gap:12px;min-width:0}
.mr-logo{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(145deg,#0f2a4a,#1e3a5f);color:#fff;flex-shrink:0}
.mr-head h3{margin:0;font-size:17px;font-weight:800;color:#0f2a4a;letter-spacing:-.01em}
.mr-head p{margin:2px 0 0;font-size:12.5px;color:#64748b}
.mr-actions{display:flex;gap:8px}
.mr-btn{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#1e293b;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.mr-btn:hover{background:#f8fafc}
.mr-btn.icon{width:34px;padding:0;justify-content:center}
.mr-tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;padding:14px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
@media(max-width:900px){.mr-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.mr-tile{border:1px solid #e2e8f0;border-top:3px solid var(--c);border-radius:12px;background:#fff;padding:9px 12px}
.mr-tile span{display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b}
.mr-tile b{font-size:22px;font-weight:800;color:var(--c);font-variant-numeric:tabular-nums}
.mr-tile em{font-style:normal;font-size:11.5px;color:#64748b;margin-left:6px}
.mr-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 20px;border-bottom:1px solid #e2e8f0}
.mr-search{display:flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;min-width:220px}
.mr-search input{border:none;outline:none;font:inherit;font-size:12.5px;flex:1;min-width:0;background:transparent}
.mr-seg{display:inline-flex;flex-wrap:wrap;gap:3px;padding:3px;border-radius:10px;background:#f1f5f9;border:1px solid #e2e8f0}
.mr-seg button{height:26px;padding:0 10px;border:none;border-radius:7px;background:transparent;font:inherit;font-size:12px;font-weight:600;color:#334155;cursor:pointer;white-space:nowrap}
.mr-seg button.on{background:#0f2a4a;color:#fff}
.mr-body{flex:1;overflow:auto}
.mr-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;font-variant-numeric:tabular-nums}
.mr-table th{position:sticky;top:0;z-index:2;background:#f8fafc;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;text-align:right;padding:9px 10px;border-bottom:1px solid #e2e8f0;white-space:nowrap}
.mr-table th.l,.mr-table td.l{text-align:left}
.mr-table td{padding:9px 10px;text-align:right;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:middle}
.mr-table tbody tr:hover td{background:#f8fafc}
.mr-group td{background:#eef3f9!important;color:#0f2a4a;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;text-align:left;padding:7px 10px}
.mr-name b{display:block;font-size:13px;color:#0f172a}
.mr-name code{font-size:10.5px;color:#94a3b8}
.mr-lim{font-weight:700;color:#0f2a4a}
.mr-nom{display:inline-block;padding:1px 8px;border-radius:6px;background:#eef3f9;color:#0f2a4a;font-weight:800}
.mr-band{position:relative;height:16px;min-width:150px}
.mr-band .track{position:absolute;left:0;right:0;top:6px;height:4px;border-radius:2px;background:#e2e8f0}
.mr-band .ok{position:absolute;top:5px;height:6px;border-radius:3px;background:${alpha(STATUS_COLOR.good, 0.35)}}
.mr-band .mk{position:absolute;top:1px;width:3px;height:14px;border-radius:2px;transform:translateX(-50%)}
.mr-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;border:1px solid}
.mr-chip i{width:7px;height:7px;border-radius:50%}
.mr-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:11.5px;color:#64748b}
.mr-foot span{display:inline-flex;align-items:center;gap:5px;margin-right:12px}
.mr-foot i{width:9px;height:9px;border-radius:2px;display:inline-block}
`;

const STATE = {
  ok: { label: "In limits", c: STATUS_COLOR.good, bg: STATUS_BG.good },
  near: { label: "Near limit", c: STATUS_COLOR.warn, bg: STATUS_BG.warn },
  out: { label: "Outside", c: STATUS_COLOR.bad, bg: STATUS_BG.bad },
  none: { label: "No limits", c: SLATE[500], bg: SLATE[100] },
  nodata: { label: "No readings", c: SLATE[400], bg: SLATE[50] },
};
const fmt = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : Math.abs(v) < 10 ? Number(v).toFixed(2) : Number(v).toFixed(1));
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) || Number(v) === 0 ? null : Number(v));

export default function MasterRecipeModal({ isOpen, onClose, mlInsights = {} }) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("ALL"); // ALL · LIMITS · MONITOR · ATTENTION
  const [group, setGroup] = useState("ALL");

  useEffect(() => {
    if (!isOpen) return undefined;
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [isOpen, onClose]);

  const list = useMemo(() => MASTER_RECIPE_SET_PARAMETERS.map((p) => {
    const f = (mlInsights.features || []).find((x) => x.key === p.key || (p.altKeys || []).includes(x.key));
    let lsl = num(f?.setLowerLimit ?? f?.lsl) ?? (p.hasStaticLimits ? num(p.defaultLower) : null);
    let usl = num(f?.setUpperLimit ?? f?.usl) ?? (p.hasStaticLimits ? num(p.defaultUpper) : null);
    if (lsl != null && Math.abs(lsl) >= 9999) lsl = null;
    if (usl != null && Math.abs(usl) >= 9999) usl = null;
    const has = lsl != null && usl != null && usl > lsl;
    const nominal = has ? (num(f?.setPoint) ?? (lsl + usl) / 2) : null;
    const okMean = num(f?.meanOk);
    const ngMean = num(f?.meanNg);
    let state = "nodata";
    if (!has) state = okMean != null || ngMean != null ? "none" : "nodata";
    else if (okMean != null || ngMean != null) {
      const vals = [okMean, ngMean].filter((v) => v != null);
      const tol = usl - lsl;
      if (vals.some((v) => v < lsl || v > usl)) state = "out";
      else if (vals.some((v) => v < lsl + tol * 0.1 || v > usl - tol * 0.1)) state = "near";
      else state = "ok";
    }
    return { p, unit: f?.unit || p.unit || "", group: p.category || "Other", lsl, usl, has, nominal, okMean, ngMean, state };
  }), [mlInsights]);

  const groups = useMemo(() => [...new Set(list.map((x) => x.group))], [list]);
  const counts = useMemo(() => ({
    limits: list.filter((x) => x.has).length,
    monitor: list.filter((x) => !x.has).length,
    ok: list.filter((x) => x.state === "ok").length,
    near: list.filter((x) => x.state === "near").length,
    out: list.filter((x) => x.state === "out").length,
  }), [list]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((x) => (scope === "LIMITS" ? x.has : scope === "MONITOR" ? !x.has : scope === "ATTENTION" ? x.state === "out" || x.state === "near" : true)
      && (group === "ALL" || x.group === group)
      && (!q || [x.p.label, x.p.key, x.unit, x.group].some((v) => String(v).toLowerCase().includes(q))));
  }, [list, scope, group, search]);

  if (!isOpen) return null;

  const exportCsv = () => {
    const rows = [["Parameter", "Key", "Group", "Unit", "LSL", "Nominal", "USL", "OK mean", "NG mean", "Status"],
      ...list.map((x) => [x.p.label, x.p.key, x.group, x.unit, x.lsl ?? "", x.nominal ?? "", x.usl ?? "", x.okMean ?? "", x.ngMean ?? "", STATE[x.state].label])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    saveAs(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `Master_Recipe_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const band = (x) => {
    if (!x.has) return <span style={{ color: SLATE[400] }}>—</span>;
    const span = x.usl - x.lsl;
    const vals = [x.okMean, x.ngMean, x.lsl, x.usl].filter((v) => v != null);
    const lo = Math.min(...vals, x.lsl - span * 0.15), hi = Math.max(...vals, x.usl + span * 0.15);
    const pos = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
    return (
      <div className="mr-band" title={`LSL ${fmt(x.lsl)} · USL ${fmt(x.usl)} · OK mean ${fmt(x.okMean)} · NG mean ${fmt(x.ngMean)}`}>
        <span className="track" />
        <span className="ok" style={{ left: pos(x.lsl), width: `calc(${pos(x.usl)} - ${pos(x.lsl)})` }} />
        {x.okMean != null && <span className="mk" style={{ left: pos(x.okMean), background: OUTCOME_COLOR.ok }} />}
        {x.ngMean != null && <span className="mk" style={{ left: pos(x.ngMean), background: OUTCOME_COLOR.ng }} />}
      </div>
    );
  };

  return (
    <div className="mr-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Master casting recipe">
      <style>{CSS}</style>
      <div className="mr">
        <div className="mr-head">
          <div className="mr-id">
            <span className="mr-logo" aria-hidden="true"><Sliders size={18} /></span>
            <div>
              <h3>Master Casting Recipe &amp; Parameter Intelligence</h3>
              <p>Set limits of every PLC parameter with the live OK-part and NG-part means of the period (parts with DCM shot data)</p>
            </div>
          </div>
          <div className="mr-actions">
            <button type="button" className="mr-btn" onClick={exportCsv}><Download size={14} /> Export</button>
            <button type="button" className="mr-btn icon" onClick={onClose} aria-label="Close"><X size={15} /></button>
          </div>
        </div>

        <div className="mr-tiles">
          {[
            { label: "With set limits", v: counts.limits, sub: "LSL / USL", c: NAVY },
            { label: "Monitor only", v: counts.monitor, sub: "no limits", c: NAVY_3 },
            { label: "In limits", v: counts.ok, sub: "OK & NG means", c: STATUS_COLOR.good },
            { label: "Near limit", v: counts.near, sub: "outer 10 % of band", c: STATUS_COLOR.warn },
            { label: "Outside limits", v: counts.out, sub: "a mean beyond LSL / USL", c: STATUS_COLOR.bad },
          ].map((t) => <div key={t.label} className="mr-tile" style={{ "--c": t.c }}><span>{t.label}</span><b>{t.v}</b><em>{t.sub}</em></div>)}
        </div>

        <div className="mr-tools">
          <label className="mr-search"><Search size={14} color={SLATE[400]} /><input type="text" placeholder="Search parameter, key or unit" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search parameters" /></label>
          <div className="mr-seg" role="group" aria-label="Scope">
            {[["ALL", `All ${list.length}`], ["LIMITS", `With limits ${counts.limits}`], ["MONITOR", `Monitor ${counts.monitor}`], ["ATTENTION", `Needs attention ${counts.out + counts.near}`]].map(([k, l]) => (
              <button key={k} type="button" className={scope === k ? "on" : ""} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>
            ))}
          </div>
          <div className="mr-seg" role="group" aria-label="Parameter group">
            {["ALL", ...groups].map((g) => (
              <button key={g} type="button" className={group === g ? "on" : ""} aria-pressed={group === g} onClick={() => setGroup(g)}>{g === "ALL" ? "All groups" : g.replace(/ Parameters?$/, "")}</button>
            ))}
          </div>
        </div>

        <div className="mr-body">
          <table className="mr-table">
            <thead>
              <tr>
                <th className="l">Parameter</th><th>Unit</th><th>LSL</th><th>Nominal</th><th>USL</th>
                <th>OK mean</th><th>NG mean</th><th className="l">Position in the limit band</th><th className="l">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x, i) => {
                const st = STATE[x.state];
                const head = i === 0 || shown[i - 1].group !== x.group;
                return (
                  <React.Fragment key={x.p.key}>
                    {head && <tr className="mr-group"><td colSpan={9}>{x.group}</td></tr>}
                    <tr>
                      <td className="l mr-name"><b>{x.p.label}</b><code>{x.p.key}</code></td>
                      <td style={{ color: SLATE[500] }}>{x.unit || "—"}</td>
                      <td className="mr-lim">{fmt(x.lsl)}</td>
                      <td>{x.nominal != null ? <span className="mr-nom">{fmt(x.nominal)}</span> : "—"}</td>
                      <td className="mr-lim">{fmt(x.usl)}</td>
                      <td style={{ color: OUTCOME_COLOR.ok, fontWeight: 700 }}>{fmt(x.okMean)}</td>
                      <td style={{ color: OUTCOME_COLOR.ng, fontWeight: 700 }}>{fmt(x.ngMean)}</td>
                      <td className="l">{band(x)}</td>
                      <td className="l"><span className="mr-chip" style={{ color: st.c, background: st.bg, borderColor: alpha(st.c, 0.35) }}><i style={{ background: st.c }} />{st.label}</span></td>
                    </tr>
                  </React.Fragment>
                );
              })}
              {!shown.length && <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, color: SLATE[500] }}>No parameters match.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="mr-foot">
          <div>
            <span><i style={{ background: alpha(STATUS_COLOR.good, 0.45) }} />LSL – USL band</span>
            <span><i style={{ background: OUTCOME_COLOR.ok }} />OK-part mean</span>
            <span><i style={{ background: OUTCOME_COLOR.ng }} />NG-part mean</span>
            <span>Near limit = within the outer 10 % of the band</span>
          </div>
          <button type="button" className="mr-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
