import React, { useMemo } from "react";
import { PieChart as PieIcon, Users, ListOrdered } from "lucide-react";
import EChart from "../charts/EChart";
import InfoTip from "../../pages/Rejection/components/InfoTip";
import {
  OUTCOME, INK, SHIFT, OTHER, FONT_FAMILY, LEGEND, ECHART_TOOLTIP, tooltipHtml, baseOption,
  valueAxis, categoryAxis, axisLabel, axisName, fmtInt, fmtPct, CARD_CSS, accent, ACCENT,
} from "../../pages/Rejection/chartTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   Dashboard overview cards — Pass / fail split, production by shift, rejection Pareto.
   Same counting rules as Rejection Analysis and the Historical Report (production day 06:00 → 06:00 IST,
   shift from the Shift Management timings, OK = final pass, NG = any station or leak NG).
   Each card: header with (i) description + formula, one chart, one-line summary of what it says.
   ═══════════════════════════════════════════════════════════════════════════ */

const pctOf = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);
const hhmm = (v) => { const m = String(v || "").match(/(\d{1,2}):(\d{2})/); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : ""; };

const CSS = `
.ov-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:16px}
@media(max-width:1000px){.ov-grid{grid-template-columns:1fr}}
.ov-card .ra-card-head{padding:14px 18px 8px}
.ov-title{margin:0;font-size:14.5px;font-weight:700;color:${INK.primary};display:flex;align-items:center}
.ov-sub{margin:2px 0 0;font-size:11.5px;color:${INK.muted}}
.ov-summary{margin:4px 18px 16px;padding:9px 12px;border-radius:10px;background:${INK.surfaceAlt};border:1px solid ${INK.grid};font-size:12px;color:${INK.body};line-height:1.5}
.ov-summary b{color:${INK.primary}}
.ov-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center;padding:0 14px}
@media(max-width:560px){.ov-split{grid-template-columns:1fr}}
.ov-legend{display:flex;flex-direction:column;gap:8px}
.ov-legend-row{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:12.5px;color:${INK.secondary};font-variant-numeric:tabular-nums}
.ov-legend-row i{width:10px;height:10px;border-radius:3px;display:inline-block}
.ov-legend-row b{color:${INK.primary};font-weight:700}
.ov-legend-row em{font-style:normal;color:${INK.muted};font-size:11.5px;margin-left:6px}
.ov-rates{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px}
.ov-rate{border:1px solid ${INK.grid};border-radius:10px;padding:7px 10px}
.ov-rate span{display:block;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:${INK.muted}}
.ov-rate b{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums}
.ov-empty{display:flex;align-items:center;justify-content:center;min-height:220px;color:${INK.muted};font-size:12.5px}
`;

function CardHead({ icon, title, sub, info }) {
  const Icon = icon;
  return (
    <div className="ra-card-head">
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
        <span className="ra-icon" aria-hidden="true"><Icon size={16} /></span>
        <div style={{ minWidth: 0 }}>
          <h3 className="ov-title">{title}<InfoTip info={info} /></h3>
          {sub && <p className="ov-sub">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

/* ── Pass / fail split ─────────────────────────────────────────────────── */
export function PassFailCard({ counts = {} }) {
  const ok = Number(counts.passed || 0), ng = Number(counts.failed || 0), wip = Number(counts.inProgress || 0);
  const produced = ok + ng + wip;
  const done = ok + ng;
  const fpy = pctOf(ok, done), ngPct = pctOf(ng, done);
  const slices = [
    { name: "Final OK", value: ok, color: OUTCOME.ok },
    { name: "NG", value: ng, color: OUTCOME.ng },
    { name: "In process", value: wip, color: OUTCOME.wip },
  ];
  const option = produced ? baseOption({
    tooltip: { ...ECHART_TOOLTIP, trigger: "item", formatter: (p) => tooltipHtml({ title: p.name, rows: [{ label: "Parts", value: fmtInt(p.value), color: p.color }, { label: "Share of produced", value: fmtPct(p.percent) }] }) },
    title: { text: fmtInt(produced), subtext: "PRODUCED", left: "center", top: "middle", itemGap: 2, textStyle: { fontSize: 22, fontWeight: 800, color: INK.primary, fontFamily: FONT_FAMILY }, subtextStyle: { fontSize: 10.5, fontWeight: 700, color: INK.muted, fontFamily: FONT_FAMILY } },
    series: [{
      type: "pie", radius: ["58%", "84%"], center: ["50%", "50%"], avoidLabelOverlap: true, padAngle: 1.5,
      itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 }, label: { show: false }, labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 5 },
      data: slices.filter((s) => s.value > 0).map((s) => ({ name: s.name, value: s.value, itemStyle: { color: s.color } })),
    }],
  }) : null;
  return (
    <div className="ra-card ov-card" data-accent style={accent(ACCENT.ok)}>
      <CardHead icon={PieIcon} title="Pass / fail split" sub="Every part produced in the period, by its current result"
        info={{ title: "Pass / fail split", what: "Parts produced in the selected period split into final OK (passed final inspection), NG (rejected at any station or leak test) and still in process.", formula: ["Produced = OK + NG + in process", "First-pass yield = OK ÷ (OK + NG) × 100", "NG % = NG ÷ (OK + NG) × 100"], note: "Parts still in process are not in FPY or NG %." }} />
      {!produced ? <div className="ov-empty">No parts in this period.</div> : (
        <>
          <div className="ov-split">
            <EChart option={option} style={{ height: 210, minHeight: 210 }} />
            <div className="ov-legend">
              {slices.map((s) => (
                <div key={s.name} className="ov-legend-row"><i style={{ background: s.color }} /><span>{s.name}</span><span><b>{fmtInt(s.value)}</b><em>{fmtPct(pctOf(s.value, produced))}</em></span></div>
              ))}
              <div className="ov-rates">
                <div className="ov-rate"><span>First-pass yield</span><b style={{ color: OUTCOME.ok }}>{fmtPct(fpy, 2)}</b></div>
                <div className="ov-rate"><span>NG rate</span><b style={{ color: OUTCOME.ng }}>{fmtPct(ngPct, 2)}</b></div>
              </div>
            </div>
          </div>
          <div className="ov-summary">
            <b>{fmtInt(ok)}</b> of <b>{fmtInt(done)}</b> completed parts passed first time ({fmtPct(fpy, 1)}); <b>{fmtInt(ng)}</b> were rejected and <b>{fmtInt(wip)}</b> are still in process.
          </div>
        </>
      )}
    </div>
  );
}

/* ── Production by shift ───────────────────────────────────────────────── */
export function ShiftProductionCard({ shiftProduction = {}, shifts = [] }) {
  const rows = useMemo(() => ["A", "B", "C"].map((code) => {
    const it = shiftProduction?.[code] || shiftProduction?.[`SHIFT_${code}`] || {};
    const def = (shifts || []).find((s) => String(s.shiftCode || s.shift_code || "").toUpperCase().replace(/^SHIFT[_\s-]*/, "") === code) || {};
    const total = Number(it.total || 0), ok = Number(it.ok || 0), ng = Number(it.ng || 0);
    return {
      code, name: def.shiftName || def.shift_name || `Shift ${code}`,
      window: def.startTime || def.start_time ? `${hhmm(def.startTime || def.start_time)}–${hhmm(def.endTime || def.end_time)}` : "",
      total, ok, ng, wip: Math.max(0, total - ok - ng), ngPct: pctOf(ng, ok + ng), fpy: pctOf(ok, ok + ng),
    };
  }), [shiftProduction, shifts]);
  const any = rows.some((r) => r.total > 0);
  const option = useMemo(() => {
    if (!any) return null;
    const max = Math.max(1, ...rows.map((r) => r.total));
    return baseOption({
      grid: { left: 54, right: 16, top: 52, bottom: 46 },
      legend: { ...LEGEND, left: 0, right: "auto", data: ["Final OK", "NG", "In process"] },
      tooltip: { ...ECHART_TOOLTIP, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,23,42,0.05)" } }, formatter: (ps) => {
        const r = rows[(Array.isArray(ps) ? ps[0] : ps)?.dataIndex];
        if (!r) return "";
        return tooltipHtml({ title: `${r.name}${r.window ? ` · ${r.window}` : ""}`, rows: [
          { label: "Produced", value: fmtInt(r.total) },
          { label: "Final OK", value: fmtInt(r.ok), color: OUTCOME.ok },
          { label: "NG", value: `${fmtInt(r.ng)} · ${fmtPct(r.ngPct, 2)}`, color: OUTCOME.ng },
          { label: "In process", value: fmtInt(r.wip), color: OUTCOME.wip },
          { label: "First-pass yield", value: fmtPct(r.fpy, 2) },
        ] });
      } },
      xAxis: categoryAxis(rows.map((r) => `${r.name}\n${r.window}`), { axisLabel: axisLabel({ lineHeight: 15, fontSize: 11.5, color: INK.secondary }) }),
      yAxis: valueAxis({ ...axisName("Parts", 40), minInterval: 1 }),
      series: [
        { type: "bar", name: "Final OK", stack: "s", barMaxWidth: 64, itemStyle: { color: OUTCOME.ok }, label: { show: true, position: "inside", fontSize: 11, fontWeight: 700, color: "#fff", formatter: (p) => (p.value >= max * 0.1 ? fmtInt(p.value) : "") }, data: rows.map((r) => r.ok) },
        { type: "bar", name: "NG", stack: "s", barMaxWidth: 64, barMinHeight: 2, itemStyle: { color: OUTCOME.ng }, data: rows.map((r) => r.ng) },
        {
          type: "bar", name: "In process", stack: "s", barMaxWidth: 64, itemStyle: { color: OUTCOME.wip, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "top", distance: 4, fontFamily: FONT_FAMILY, lineHeight: 14,
            formatter: (p) => { const r = rows[p.dataIndex]; return r.total ? `{t|${fmtInt(r.total)}}\n{n|NG ${fmtInt(r.ng)} · ${fmtPct(r.ngPct, 1)}}` : ""; },
            rich: { t: { fontSize: 11.5, fontWeight: 700, color: INK.primary }, n: { fontSize: 10.5, fontWeight: 700, color: OUTCOME.ng } } },
          data: rows.map((r) => r.wip),
        },
      ],
    });
  }, [rows, any]);
  const worked = rows.filter((r) => r.ok + r.ng > 0);
  const worst = worked.length > 1 ? [...worked].sort((a, b) => b.ngPct - a.ngPct)[0] : null;
  const best = worked.length > 1 ? [...worked].sort((a, b) => a.ngPct - b.ngPct)[0] : null;
  return (
    <div className="ra-card ov-card" data-accent style={accent(SHIFT.B)}>
      <CardHead icon={Users} title="Production by shift" sub="Shift from the scan time and the Shift Management timings · top label = produced and NG %"
        info={{ title: "Production by shift", what: "Parts produced in each shift, split into final OK, NG and in process. A part belongs to the shift of its first scan, using the timings in Shift Management (end second included).", formula: ["Produced = OK + NG + in process", "NG % = NG ÷ (OK + NG) × 100", "FPY = OK ÷ (OK + NG) × 100"], note: "Shift C (23:00–05:59:59) counts on the production day it started." }} />
      {!any ? <div className="ov-empty">No shift data for this period.</div> : (
        <>
          <div style={{ padding: "0 8px" }}><EChart option={option} style={{ height: 250, minHeight: 250 }} /></div>
          <div className="ov-summary">
            {rows.map((r, i) => <span key={r.code}>{i > 0 && " · "}<b style={{ color: SHIFT[r.code] || OTHER }}>{r.name}</b> {fmtInt(r.total)} produced, NG {fmtPct(r.ngPct, 1)}</span>)}
            {worst && best && worst.code !== best.code && <> — highest NG % in <b>{worst.name}</b>, lowest in <b>{best.name}</b>.</>}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Rejection Pareto ──────────────────────────────────────────────────── */
export function ParetoCard({ data = [] }) {
  const rows = useMemo(() => {
    const list = (data || []).filter((d) => Number(d.count) > 0).sort((a, b) => Number(b.count) - Number(a.count));
    const total = list.reduce((s, d) => s + Number(d.count), 0);
    const top = list.slice(0, 10);
    // running total of the counts up to and including each reason
    const running = top.map((_, i) => top.slice(0, i + 1).reduce((a, d) => a + Number(d.count), 0));
    const items = top.map((d, i) => {
      const share = pctOf(Number(d.count), total) ?? 0;
      const cumPct = pctOf(running[i], total) ?? 0;
      return { reason: d.reason, count: Number(d.count), share, cum: cumPct, vital: cumPct - share < 80 };
    });
    return { total, items, more: Math.max(0, list.length - 10) };
  }, [data]);
  const vitalCount = rows.items.filter((d) => d.vital).length;
  const option = useMemo(() => {
    if (!rows.items.length) return null;
    return baseOption({
      grid: { left: 52, right: 52, top: 48, bottom: 66 },
      legend: { ...LEGEND, left: 0, right: "auto", data: ["NG parts", "Cumulative %"] },
      tooltip: { ...ECHART_TOOLTIP, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,23,42,0.05)" } }, formatter: (ps) => {
        const d = rows.items[(Array.isArray(ps) ? ps[0] : ps)?.dataIndex];
        if (!d) return "";
        return tooltipHtml({ title: d.reason, subtitle: d.vital ? "Within the vital few (first 80% of NG)" : "Outside the first 80% of NG", rows: [
          { label: "NG parts", value: fmtInt(d.count), color: d.vital ? OUTCOME.ng : "#f87171" },
          { label: "Share of all NG", value: fmtPct(d.share, 1) },
          { label: "Cumulative share", value: fmtPct(d.cum, 1), color: INK.primary },
        ] });
      } },
      xAxis: categoryAxis(rows.items.map((d) => d.reason), { axisLabel: axisLabel({ interval: 0, rotate: rows.items.length > 6 ? 28 : 0, fontSize: 11, color: INK.secondary, width: 96, overflow: "truncate" }) }),
      yAxis: [
        valueAxis({ ...axisName("NG parts", 38), minInterval: 1 }),
        valueAxis({ position: "right", min: 0, max: 100, splitLine: { show: false }, axisLabel: axisLabel({ formatter: (v) => `${v}%` }) }),
      ],
      series: [
        {
          type: "bar", name: "NG parts", barMaxWidth: 46,
          data: rows.items.map((d) => ({ value: d.count, itemStyle: { color: d.vital ? OUTCOME.ng : "#f87171", borderRadius: [4, 4, 0, 0] } })),
          label: { show: true, position: "top", distance: 4, fontFamily: FONT_FAMILY, lineHeight: 14,
            formatter: (p) => { const d = rows.items[p.dataIndex]; return `{c|${fmtInt(d.count)}}\n{s|${d.share.toFixed(1)}%}`; },
            rich: { c: { fontSize: 11, fontWeight: 700, color: INK.primary }, s: { fontSize: 10, fontWeight: 600, color: INK.muted } } },
          markLine: { silent: true, symbol: "none", yAxisIndex: 1, lineStyle: { type: "dashed", color: INK.muted }, label: { formatter: "80%", color: INK.muted, fontSize: 10.5 }, data: [{ yAxis: 80 }] },
        },
        { type: "line", name: "Cumulative %", yAxisIndex: 1, data: rows.items.map((d) => Number(d.cum.toFixed(1))), symbol: "circle", symbolSize: 6, lineStyle: { color: INK.primary, width: 2 }, itemStyle: { color: INK.primary } },
      ],
    });
  }, [rows]);
  const top = rows.items[0];
  return (
    <div className="ra-card ov-card" data-accent style={accent(ACCENT.ng)}>
      <CardHead icon={ListOrdered} title="Rejection Pareto" sub={`Top ${rows.items.length} rejection reasons · dark red = the vital few (first 80% of NG) · light red = the rest`}
        info={{ title: "Rejection Pareto", what: "Rejection reasons ranked by NG parts with the running cumulative share. Fixing the red bars removes most of the scrap.", formula: ["Share = reason NG ÷ all NG × 100", "Cumulative % = running sum of shares, largest first", "Vital few = reasons until the cumulative share reaches 80%"] }} />
      {!option ? <div className="ov-empty">No rejects found in this period.</div> : (
        <>
          <div style={{ padding: "0 8px" }}><EChart option={option} style={{ height: 300, minHeight: 300 }} /></div>
          <div className="ov-summary">
            <b>{vitalCount}</b> of {rows.items.length + rows.more} reasons make up 80% of the <b>{fmtInt(rows.total)}</b> NG parts; the biggest is <b>{top.reason}</b> with {fmtInt(top.count)} parts ({fmtPct(top.share, 1)}).
          </div>
        </>
      )}
    </div>
  );
}

/** The three cards in the dashboard layout: split + shift side by side, Pareto full width. */
export default function OverviewCharts({ counts, shiftProduction, shifts, pareto }) {
  return (
    <>
      <style>{CARD_CSS + CSS}</style>
      <div className="ov-grid">
        <PassFailCard counts={counts} />
        <ShiftProductionCard shiftProduction={shiftProduction} shifts={shifts} />
      </div>
      <ParetoCard data={pareto} />
    </>
  );
}
