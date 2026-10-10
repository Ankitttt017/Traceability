import React, { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import SectionCard from "../../../components/mgmt/SectionCard";
import ComboChart from "../../../components/mgmt/ComboChart";
import EmptyState from "../../../components/mgmt/EmptyState";
import { movingAverage, ratePct } from "../../../components/mgmt/trendMath";
import {
  NAVY, NAVY_3, OUTCOME_COLOR, SLATE, STATUS_COLOR, TARGETS, WARMUP_COLOR, fmtInt, fmtPct, pctOf, statusLowerBetter,
} from "../../../components/mgmt/mgmtTheme";
import { dayLabel } from "./derive";
import { monthLabel } from "./deriveTabs";
import { localISODate, productionToday } from "./periods";

/* ═══════════════════════════════════════════════════════════════════════════
   Die Performance pieces:
     DieProductionTrend   per die (or all OPK12 dies): OK / warm-up / NG shots per day stacked + NG-shot % and the
                          final rejection % of the die's traced parts, 7-day average, target; month-wise for long periods
                          (click a month → its days, "← Months" back)
     DieFunnel            stepped funnel: shots → after warm-up → good castings → traced → passed final, with the drop
                          at every step and the end result
   ═══════════════════════════════════════════════════════════════════════════ */
export const FLOW_CSS = `
.df-funnel{border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px 12px;background:#fff;margin-bottom:12px}
.df-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.df-head b{font-size:15px;font-weight:800;color:#0f2a4a}
.df-result{display:inline-flex;align-items:center;gap:10px;padding:6px 12px;border-radius:12px;background:#ecfdf3;border:1px solid #bbf7d0}
.df-result strong{font-size:22px;font-weight:800;color:#15803d;font-variant-numeric:tabular-nums}
.df-result span{font-size:12px;color:#166534;line-height:1.3}
.df-svg{display:block;width:100%;height:auto}
.df-labels{display:grid;gap:6px;margin-top:6px}
.df-step{text-align:center;min-width:0}
.df-step small{display:block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.df-step b{display:block;font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}
.df-step span{font-size:11.5px;color:#64748b}
`;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Stepped funnel of one die. */
export function DieFunnel({ d }) {
  const afterWarm = d.shots - d.warmUp;
  const steps = [
    { k: "shots", label: "Shots", v: d.shots, c: NAVY, sub: "made on OP100" },
    { k: "aw", label: "Production shots", v: afterWarm, c: NAVY_3, sub: `${fmtPct(pctOf(afterWarm, d.shots), 1)} of shots` },
    { k: "good", label: "Good castings", v: d.ok, c: OUTCOME_COLOR.ok, sub: `${fmtPct(pctOf(d.ok, afterWarm), 1)} of production` },
    ...(d.traced != null ? [{ k: "traced", label: "Traced parts", v: d.traced, c: "#4a6d97", sub: `${fmtPct(pctOf(d.traced, d.ok), 1)} of good castings` }] : []),
    ...(d.finalOk != null ? [{ k: "final", label: "Passed final", v: d.finalOk, c: "#15803d", sub: `${fmtPct(pctOf(d.finalOk, d.ok), 1)} of good castings` }] : []),
  ];
  const drops = [
    { v: d.warmUp, label: "warm-up", c: WARMUP_COLOR },
    { v: d.ng, label: "NG shots", c: OUTCOME_COLOR.ng },
    ...(d.traced != null ? [{ v: Math.max(0, d.ok - d.traced), label: "not traced", c: SLATE[400] }] : []),
    ...(d.finalOk != null ? [{ v: d.finalNg, label: `final NG · ${fmtInt(d.wip)} in progress`, c: OUTCOME_COLOR.ng }] : []),
  ];
  const W = 1000, H = 216, n = steps.length, slot = W / n, bw = Math.min(110, slot * 0.42), mid = (H - 34) / 2;
  const hOf = (v) => Math.max(14, (v / Math.max(1, d.shots)) * (H - 50));
  const fin = d.finalOk != null ? pctOf(d.finalNg, d.finalOk + d.finalNg) : null;

  return (
    <div className="df-funnel">
      <div className="df-head">
        <b>Die {d.die}</b>
        {d.finalOk != null && (
          <span className="df-result">
            <strong>{fmtPct(pctOf(d.finalOk, d.ok), 1)}</strong>
            <span>of {fmtInt(d.ok)} good castings passed final<br />final rejection <b style={{ color: STATUS_COLOR[statusLowerBetter(fin, TARGETS.scrapPct)] }}>{fmtPct(fin, 2)}</b></span>
          </span>
        )}
      </div>
      <svg className="df-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Flow of die ${d.die}`}>
        {steps.map((s, i) => {
          const x = slot * i + (slot - bw) / 2;
          const h = hOf(s.v);
          const next = steps[i + 1];
          const drop = drops[i];
          let link = null;
          if (next) {
            const nx = slot * (i + 1) + (slot - bw) / 2;
            const nh = hOf(next.v);
            link = (
              <g>
                <polygon points={`${x + bw},${mid - h / 2} ${nx},${mid - nh / 2} ${nx},${mid + nh / 2} ${x + bw},${mid + h / 2}`} fill={s.c} opacity="0.13" />
                {drop && drop.v > 0 && (
                  <g>
                    <rect x={(x + bw + nx) / 2 - 66} y={H - 26} width="132" height="22" rx="11" fill="#fff" stroke={drop.c} />
                    <text x={(x + bw + nx) / 2} y={H - 11} textAnchor="middle" fontSize="12" fontWeight="700" fill={drop.c}>− {fmtInt(drop.v)} {drop.label.split(" · ")[0]}</text>
                  </g>
                )}
              </g>
            );
          }
          return (
            <g key={s.k}>
              {link}
              <rect x={x} y={mid - h / 2} width={bw} height={h} rx="8" fill={s.c} />
              <text x={x + bw / 2} y={mid + 5} textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">{fmtInt(s.v)}</text>
            </g>
          );
        })}
      </svg>
      <div className="df-labels" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>
        {steps.map((s) => <div key={s.k} className="df-step"><small>{s.label}</small><b style={{ color: s.c }}>{fmtInt(s.v)}</b><span>{s.sub}</span></div>)}
      </div>
      {d.finalOk != null && <div style={{ marginTop: 6, fontSize: 12, color: SLATE[500], textAlign: "right" }}>Final NG {fmtInt(d.finalNg)} · in progress {fmtInt(d.wip)}</div>}
    </div>
  );
}

/** Production trend of the die-casting shots (+ final rejection % of the die's traced parts). */
export function DieProductionTrend({ shot, dieDaily = [], dies = [] }) {
  const [month, setMonth] = useState(null);
  const one = dies.length === 1 ? dies[0].die : null;
  const all = useMemo(() => (shot?.byDay || []).slice().sort((a, b) => String(a.day).localeCompare(String(b.day))), [shot]);
  const long = all.length > 31;
  const level = long && !month ? "month" : "day";
  const { keys, labels, rows } = useMemo(() => {
    const m = new Map();
    const keyOf = (day) => (level === "month" ? String(day).slice(0, 7) : day);
    const get = (k) => { if (!m.has(k)) m.set(k, { ok: 0, warmUp: 0, ng: 0, fOk: 0, fNg: 0 }); return m.get(k); };
    all.forEach((d) => { if (month && !String(d.day).startsWith(month)) return; const b = get(keyOf(d.day)); b.ok += num(d.ok); b.warmUp += num(d.warmUp); b.ng += num(d.ng); });
    (dieDaily || []).filter((r) => !one || String(r.die).toUpperCase() === one).forEach((r) => {
      if (month && !String(r.day).startsWith(month)) return;
      const k = keyOf(r.day);
      if (!m.has(k)) return;
      const b = m.get(k); b.fOk += num(r.ok); b.fNg += num(r.ng);
    });
    const ks = [...m.keys()].sort();
    return { keys: ks, labels: ks.map((k) => (level === "month" ? monthLabel(k) : dayLabel(k))), rows: ks.map((k) => m.get(k)) };
  }, [all, dieDaily, one, month, level]);
  const today = localISODate(productionToday());
  const partial = keys.indexOf(level === "month" ? today.slice(0, 7) : today);
  const rate = ratePct(rows.map((r) => r.ng), rows.map((r) => r.ok));
  const finRate = rows.map((r) => (r.fOk + r.fNg > 0 ? Number(((r.fNg / (r.fOk + r.fNg)) * 100).toFixed(2)) : null));
  const ma = movingAverage(rate.map((v, i) => (i === partial ? null : v)), 7).map((v, i) => (i === partial ? null : v));

  return (
    <SectionCard
      id="ds-trend"
      title={`Production & rejection trend — ${one ? `die ${one}` : "Oil Pan K-12 dies"} · per ${level}`}
      subtitle={`Shots of the die-casting machine stacked: OK / warm-up (teal) / NG shots, total on top. Lines: NG-shot %, the final rejection % of the die's traced parts, ${level === "day" ? "the 7-day average, " : ""}and the 2 % target.${long ? " Click a month for its days." : ""}`}
      info={{
        what: "Shots: PLC shot records of OP100 (each shot number once). Final rejection: the die's traced parts of the day (first scan) that were rejected ÷ (passed final + rejected).",
        formula: ["NG-shot % = NG shots ÷ (OK shots + NG shots)", "Final rejection % = final NG ÷ (passed final + final NG)"],
        note: dies.length > 1 ? "The shot data is not split by die per day — the shots are all Oil Pan K-12 dies together." : undefined,
      }}
      actions={month ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="mg-back" onClick={() => setMonth(null)}><ArrowLeft size={14} />Months</button>
          <b style={{ fontSize: 13 }}>{monthLabel(month)}</b>
        </span>
      ) : null}
    >
      {!keys.length ? <EmptyState title="No shots in this period" /> : (
        <ComboChart
          labels={labels}
          keys={keys}
          bars={[
            { key: "ok", name: "OK shots", color: OUTCOME_COLOR.ok, stack: "s", data: rows.map((r) => r.ok) },
            { key: "warm", name: "Warm-up shots", color: WARMUP_COLOR, stack: "s", data: rows.map((r) => r.warmUp), minHeight: 3, insideMin: 0.04 },
            { key: "ng", name: "NG shots", color: OUTCOME_COLOR.ng, stack: "s", data: rows.map((r) => r.ng), minHeight: 3, insideMin: 0.04 },
          ]}
          lines={[
            { key: "rate", name: "NG-shot %", color: OUTCOME_COLOR.ng, data: rate, label: keys.length <= 31, status: true, smooth: false },
            { key: "fin", name: "Final rejection %", color: NAVY_3, data: finRate, label: keys.length <= 16, smooth: false },
            ...(level === "day" && keys.length >= 7 ? [{ key: "ma", name: "7-day average (NG shots)", color: NAVY, data: ma, dashed: true }] : []),
          ]}
          target={TARGETS.scrapPct}
          band={TARGETS.amberBandPp}
          leftName="Shots"
          rightName="%"
          height={390}
          barMaxWidth={28}
          partial={partial >= 0 ? partial : null}
          onSelect={level === "month" ? (k) => setMonth(k) : undefined}
          selectHint="Click to open the days of this month."
          tooltipRows={(i) => [{ label: "Warm-up (not scrap)", value: fmtInt(rows[i]?.warmUp), bold: false }, { label: "Final OK / NG (traced)", value: `${fmtInt(rows[i]?.fOk)} / ${fmtInt(rows[i]?.fNg)}`, bold: false }]}
        />
      )}
    </SectionCard>
  );
}
