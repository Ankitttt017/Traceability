import React, { useMemo, useState } from "react";
import { Layers } from "lucide-react";
import EChart from "../../components/charts/EChart";
import { ALL_45_PARAMETERS, ALL_TELEMETRY_CATEGORIES } from "./rejectionConstants";
import {
  OUTCOME, INK, FONT_FAMILY, ECHART_TOOLTIP, baseOption, valueAxis, categoryAxis, axisLabel, tooltipHtml, CARD_CSS, ACCENT, accent,
} from "./chartTheme";

const NG_STATUS = new Set(["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"]);
const OK_STATUS = new Set(["OK", "PASSED", "ENDED_OK", "COMPLETED_OK"]);
const MAX_JITTER = 160; // dots drawn per class (evenly sampled); stats always use every reading

const idOf = (r) => String(r.partId || r.part_id || r.customerQrCode || r.customer_qr || r.id || "");
const readParam = (r, p) => {
  for (const k of [p.key, ...(p.altKeys || [])]) {
    const raw = r?.[k];
    if (raw === null || raw === undefined || raw === "" || raw === "-") continue;
    const v = Number(raw);
    if (Number.isFinite(v)) return v;
  }
  return null;
};
const quantile = (s, q) => {
  if (!s.length) return NaN;
  const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return s[lo] + (s[hi] - s[lo]) * (p - lo);
};
// Deterministic jitter (stable across re-renders)
const hash01 = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
const sampleEvenly = (a, max) => (a.length <= max ? a : a.filter((_, i) => i % Math.ceil(a.length / max) === 0));
const fmt = (v) => (Number.isFinite(v) ? Number(v.toFixed(Math.abs(v) >= 100 ? 1 : 2)).toLocaleString() : "—");

// Tukey box: whiskers at the most extreme readings within 1.5×IQR of the box; beyond = outliers
const tukey = (vals) => {
  const s = [...vals].sort((a, b) => a - b);
  const q1 = quantile(s, 0.25), med = quantile(s, 0.5), q3 = quantile(s, 0.75), iqr = q3 - q1;
  const loF = q1 - 1.5 * iqr, hiF = q3 + 1.5 * iqr;
  const inside = s.filter((v) => v >= loF && v <= hiF);
  return {
    n: s.length, q1, med, q3, iqr,
    lo: inside.length ? inside[0] : q1, hi: inside.length ? inside[inside.length - 1] : q3,
    mean: s.reduce((a, v) => a + v, 0) / (s.length || 1),
    outliers: s.filter((v) => v < loF || v > hiF),
  };
};

export default function FacetedBoxPlot({ rows = [], allRejectionRecords = [], rejectedRows = [], okRecords = [], paramKeys = null }) {
  const [group, setGroup] = useState("drivers");
  const [count, setCount] = useState(6);

  /* OK vs NG parts (each part once; unknown outcome excluded) */
  const { okRows, ngRows } = useMemo(() => {
    const ngIds = new Set();
    [allRejectionRecords, rejectedRows].forEach((l) => (l || []).forEach((r) => { const id = idOf(r); if (id) ngIds.add(id); }));
    const ok = [], ng = [], seen = new Set();
    [allRejectionRecords, rejectedRows, okRecords, rows].forEach((list) => (list || []).forEach((r) => {
      const id = idOf(r);
      if (id) { if (seen.has(id)) return; seen.add(id); }
      const st = String(r.status || r.overall_status || "").trim().toUpperCase();
      const isNg = (id && ngIds.has(id)) || NG_STATUS.has(st);
      if (isNg) ng.push(r);
      else if (OK_STATUS.has(st)) ok.push(r);
    }));
    return { okRows: ok, ngRows: ng };
  }, [rows, allRejectionRecords, rejectedRows, okRecords]);

  /* Per-parameter stats + effect size (median shift in OK-IQR units) */
  const facets = useMemo(() => ALL_45_PARAMETERS.map((p) => {
    const okV = okRows.map((r) => readParam(r, p)).filter((v) => v !== null && v > 0);
    const ngV = ngRows.map((r) => readParam(r, p)).filter((v) => v !== null && v > 0);
    if (okV.length < 5 || ngV.length < 5) return null;
    const ok = tukey(okV), ng = tukey(ngV);
    const scale = ok.iqr > 0 ? ok.iqr : Math.abs(ok.med) * 0.01 || 1;
    return { p, ok, ng, okV, ngV, shift: ng.med - ok.med, effect: (ng.med - ok.med) / scale };
  }).filter(Boolean), [okRows, ngRows]);

  const active = useMemo(() => {
    let list = facets;
    if (group === "drivers") {
      if (paramKeys?.length) {
        const rank = new Map(paramKeys.map((k, i) => [k, i]));
        list = [...facets].sort((a, b) => (rank.get(a.p.key) ?? 999) - (rank.get(b.p.key) ?? 999));
      } else list = [...facets].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
    } else if (group === "shift") {
      list = [...facets].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
    } else {
      list = facets.filter((f) => f.p.categoryId === group);
    }
    return list.slice(0, count);
  }, [facets, group, count, paramKeys]);

  const optionFor = ({ p, ok, ng, okV, ngV }) => {
    const all = [...okV, ...ngV].sort((a, b) => a - b);
    // Axis spans the whiskers and the 1st–99th percentile; rarer extremes are pinned to the edge
    let yMin = Math.min(ok.lo, ng.lo, quantile(all, 0.01)), yMax = Math.max(ok.hi, ng.hi, quantile(all, 0.99));
    const pad = (yMax - yMin) * 0.08 || Math.abs(yMax) * 0.05 || 1;
    yMin -= pad; yMax += pad;
    const pin = (v) => Math.max(yMin, Math.min(yMax, v));
    const jitter = (vals, cls, x) => sampleEvenly(vals, MAX_JITTER).map((v, i) => [x + (hash01(`${p.key}${cls}${i}${v}`) - 0.5) * 0.36, v, cls]);
    const outl = (o, cls, x) => o.outliers.map((v) => ({ value: [x, pin(v), cls, v], itemStyle: { color: "#fff", borderColor: cls === "OK" ? OUTCOME.ok : OUTCOME.ng, borderWidth: 1.4 } }));
    const boxTip = (cls, s) => tooltipHtml({
      title: `${p.label} · ${cls} parts`,
      rows: [
        { label: "Readings (n)", value: s.n.toLocaleString() },
        { label: "Upper whisker", value: `${fmt(s.hi)} ${p.unit}` },
        { label: "Q3 (75th pct)", value: `${fmt(s.q3)} ${p.unit}` },
        { label: "Median", value: `${fmt(s.med)} ${p.unit}`, color: cls === "OK" ? OUTCOME.ok : OUTCOME.ng },
        { label: "Q1 (25th pct)", value: `${fmt(s.q1)} ${p.unit}` },
        { label: "Lower whisker", value: `${fmt(s.lo)} ${p.unit}` },
        { label: "IQR", value: `${fmt(s.iqr)} ${p.unit}` },
        { label: "Mean", value: `${fmt(s.mean)} ${p.unit}` },
        { label: "Outliers (beyond 1.5×IQR)", value: s.outliers.length.toLocaleString() },
      ],
    });
    return {
      ...baseOption(),
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (it) => {
          if (it.seriesType === "boxplot") return boxTip(it.dataIndex === 0 ? "OK" : "NG", it.dataIndex === 0 ? ok : ng);
          const [, v, cls, raw] = it.value || it.data || [];
          const val = raw ?? v;
          return tooltipHtml({
            title: `${cls} part · ${p.label}`,
            rows: [{ label: "Reading", value: `${fmt(val)} ${p.unit}`, color: cls === "OK" ? OUTCOME.ok : OUTCOME.ng }],
            note: it.seriesName === "Outliers" ? (val !== v ? "Outlier beyond the axis range — pinned to the edge." : "Outlier: beyond 1.5×IQR from the box.") : undefined,
          });
        },
      },
      grid: { left: 54, right: 14, top: 14, bottom: 30 },
      xAxis: categoryAxis([`OK  n=${ok.n.toLocaleString()}`, `NG  n=${ng.n.toLocaleString()}`], { axisLabel: axisLabel({ color: INK.body, fontWeight: 600 }) }),
      yAxis: valueAxis({ min: Number(yMin.toPrecision(4)), max: Number(yMax.toPrecision(4)), axisLabel: axisLabel({ formatter: (v) => fmt(v) }) }),
      series: [
        {
          name: "Sample", type: "scatter", symbolSize: 4, silent: false, z: 1,
          data: [...jitter(okV, "OK", 0), ...jitter(ngV, "NG", 1)],
          itemStyle: { color: (it) => (it.data[2] === "OK" ? OUTCOME.ok : OUTCOME.ng), opacity: 0.28 },
        },
        {
          name: "Distribution", type: "boxplot", z: 3, boxWidth: [26, 44],
          data: [
            { value: [ok.lo, ok.q1, ok.med, ok.q3, ok.hi], itemStyle: { color: "rgba(27,175,122,0.16)", borderColor: OUTCOME.ok, borderWidth: 1.6 } },
            { value: [ng.lo, ng.q1, ng.med, ng.q3, ng.hi], itemStyle: { color: "rgba(208,59,59,0.16)", borderColor: OUTCOME.ng, borderWidth: 1.6 } },
          ],
        },
        {
          name: "Outliers", type: "scatter", symbol: "circle", symbolSize: 6, z: 4,
          data: [...outl(ok, "OK", 0), ...outl(ng, "NG", 1)],
        },
      ],
    };
  };

  const groups = [
    { id: "drivers", label: paramKeys?.length ? "Top drivers (influence ranking)" : "Largest OK vs NG difference" },
    { id: "shift", label: "Largest median shift" },
    ...ALL_TELEMETRY_CATEGORIES.map((c) => ({ id: c.id, label: c.label.trim() })),
  ];

  return (
    <section className="ra-card fbp" data-accent style={accent(ACCENT.process)}>
      <style>{CARD_CSS + `
        .fbp .ra-card-head{align-items:center}
        .fbp-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .fbp-select{height:32px;padding:0 10px;border:1px solid ${INK.axis};border-radius:8px;background:#fff;font-size:12.5px;color:${INK.secondary};font-family:${FONT_FAMILY}}
        .fbp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;padding:4px 16px 16px}
        .fbp-cell{border:1px solid ${INK.border};border-top:3px solid var(--pc,${INK.axis});border-radius:12px;padding:10px 10px 4px;min-width:0;background:linear-gradient(180deg,color-mix(in srgb,var(--pc,#94a3b8) 5%,#fff),#fff 40%)}
        .fbp-cell-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:0 4px 4px}
        .fbp-cell-head b{font-size:12.5px;font-weight:600;color:${INK.primary};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .fbp-shift{font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
        .fbp-empty{padding:40px 16px;text-align:center;color:${INK.faint};font-size:12.5px}
      `}</style>
      <header className="ra-card-head">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="ra-icon"><Layers size={16} /></span>
          <div>
            <h3 className="ra-card-title">OK vs NG distribution by parameter</h3>
            <p className="ra-card-sub">Box = middle 50% (IQR) with median · whiskers 1.5×IQR · hollow dots = outliers · faint dots = sampled readings</p>
          </div>
        </div>
        <div className="fbp-controls">
          <div className="ra-legend">
            <span><i style={{ background: OUTCOME.ok }} />OK parts ({okRows.length.toLocaleString()})</span>
            <span><i style={{ background: OUTCOME.ng }} />NG parts ({ngRows.length.toLocaleString()})</span>
          </div>
          <select className="fbp-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Parameter group">
            {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
          <select className="fbp-select" value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of parameters">
            {[6, 9, 12, 24].map((n) => <option key={n} value={n}>{n} parameters</option>)}
          </select>
        </div>
      </header>
      {!active.length ? (
        <div className="fbp-empty">Not enough OK and NG readings (need at least 5 of each) for this parameter group.</div>
      ) : (
        <div className="fbp-grid">
          {active.map((f) => {
            const up = f.shift > 0;
            const strong = Math.abs(f.effect) >= 0.5;
            return (
              <div key={f.p.key} className="fbp-cell" style={{ "--pc": f.p.color || INK.axis }}>
                <div className="fbp-cell-head">
                  <b title={`${f.p.label} (${f.p.unit})`}>{f.p.label} <span style={{ color: INK.faint, fontWeight: 400 }}>({f.p.unit})</span></b>
                  <span className="fbp-shift" style={{ color: strong ? OUTCOME.ng : INK.muted }}
                    title="Difference of medians (NG − OK); in brackets, the same difference in units of the OK interquartile range">
                    NG median {up ? "+" : ""}{fmt(f.shift)} ({up ? "+" : ""}{f.effect.toFixed(2)} IQR)
                  </span>
                </div>
                <div style={{ height: 220 }}>
                  <EChart option={optionFor(f)} style={{ width: "100%", height: "100%", minHeight: 0 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
