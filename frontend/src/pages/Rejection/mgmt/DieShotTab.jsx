import React, { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import SectionCard from "../../../components/mgmt/SectionCard";
import ComboChart from "../../../components/mgmt/ComboChart";
import { SkeletonBlock } from "../../../components/mgmt/Skeleton";
import EmptyState from "../../../components/mgmt/EmptyState";
import {
  NAVY, OUTCOME_COLOR, SLATE, STATUS_BG, STATUS_COLOR, TARGETS, WARMUP_COLOR, alpha, fmtInt, fmtPct, pctOf, statusLowerBetter,
} from "../../../components/mgmt/mgmtTheme";
import { DieFunnel, DieProductionTrend, FLOW_CSS } from "./DieFlow";

/* ═══════════════════════════════════════════════════════════════════════════
   Die Performance — built on the DCM shot data of the die-casting machine (OP100, shot analytics: the same source as
   the "DCM shots" KPI) plus the final result of the traced parts of each die (rejection summary dieStats).
     1. Shot cards per die: shots · OK · warm-up · NG shots (parameter out of limit) · NG-shot %, and final OK / NG
     2. Die-casting production trend per day: OK / warm-up / NG shots stacked + NG-shot % with 7-day average
     3. Flow per die: shots → − warm-up → − NG shots → good castings → traced parts → passed final / final NG
     4. Parameter NG: which process parameters were out of limit on the NG shots
   Only Oil Pan K-12 dies that cast in the period (PlcCycleReadings part "OPK12-Sxx").
   ═══════════════════════════════════════════════════════════════════════════ */
const CSS = `
.ds-root{display:flex;flex-direction:column;gap:16px;min-width:0}
.ds-scope{font-size:12.5px;color:#64748b;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.ds-scope b{color:#0f172a}
.ds-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:12px}
.ds-card{border:1px solid #e2e8f0;border-top:4px solid var(--c);border-radius:14px;background:linear-gradient(180deg,var(--bg) 0%,#fff 55%);padding:12px 16px 14px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.ds-card-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px}
.ds-card-head b{font-size:18px;font-weight:800;color:#0f2a4a}
.ds-card-head span{font-size:12px;color:#64748b}
.ds-nums{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.ds-num{min-width:0}
.ds-num small{display:block;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;white-space:nowrap}
.ds-num b{font-size:19px;font-weight:800;font-variant-numeric:tabular-nums}
.ds-pct{display:inline-block;padding:1px 9px;border-radius:999px;font-size:15px;font-weight:800}
.ds-split{display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1px;margin:10px 0 8px;background:#f1f5f9}
.ds-final{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;color:#475569;border-top:1px dashed #e2e8f0;padding-top:8px}
.ds-final b{font-variant-numeric:tabular-nums}
.ds-flow{display:flex;align-items:stretch;gap:0;overflow-x:auto;padding:4px 2px 8px}
.ds-step{flex:1 1 0;min-width:118px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:10px 12px;display:flex;flex-direction:column;gap:2px;border-top:4px solid var(--c)}
.ds-step small{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;white-space:nowrap}
.ds-step b{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--c)}
.ds-step span{font-size:11.5px;color:#64748b;line-height:1.35}
.ds-step.minus b::before{content:"− "}
.ds-arrow{flex:0 0 26px;display:grid;place-items:center;color:#94a3b8}
.ds-ends{display:flex;flex-direction:column;gap:6px;flex:1 1 0;min-width:140px}
.ds-ends .ds-step{flex:1}
.ds-flow-title{display:flex;justify-content:space-between;align-items:baseline;margin:6px 0 6px;font-size:13px;font-weight:800;color:#0f2a4a}
.ds-flow-title span{font-size:12px;font-weight:600;color:#64748b}
@media (max-width:760px){.ds-nums{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const st = (p) => statusLowerBetter(p, TARGETS.scrapPct);

export default function DieShotTab({ shot, shotLoading, dieStats = [], summary, dieDaily = [] }) {
  const dies = useMemo(() => (shot?.byDie || []).filter((d) => d.die).map((d) => {
    const ds = (dieStats || []).find((x) => String(x.die_name || x.dieName || "").toUpperCase() === String(d.die).toUpperCase()) || null;
    const traced = ds ? num(ds.total_shots ?? ds.totalParts) : null;
    const finalOk = ds ? num(ds.ok_count ?? ds.totalOK) : null;
    const finalNg = ds ? num(ds.ng_count ?? ds.totalNG) : null;
    const good = num(d.ok);
    return {
      die: String(d.die).toUpperCase(), machine: d.machine, shots: num(d.shots), ok: good, warmUp: num(d.warmUp), ng: num(d.ng),
      ngPct: pctOf(num(d.ng), good + num(d.ng)), traced, finalOk, finalNg, wip: traced != null ? Math.max(0, traced - finalOk - finalNg) : null,
    };
  }).sort((a, b) => b.shots - a.shots), [shot, dieStats]);

  const rawParams = shot?.parameters;
  const params = useMemo(() => (rawParams || []).filter((p) => num(p.ngOutOfLimit) > 0).sort((a, b) => num(b.lift) - num(a.lift) || b.ngOutOfLimit - a.ngOutOfLimit).slice(0, 12), [rawParams]);
  const ngShots = num(shot?.totalsForParameters?.ngShots ?? shot?.totals?.ng);
  const tracked = Number(summary?.totalProduction);
  const noShot = Number.isFinite(tracked) && tracked > 0 ? Math.max(0, tracked - dies.reduce((a, d) => a + (d.traced || 0), 0)) : null;

  if (shotLoading && !shot) return <div className="ds-root"><SkeletonBlock lines={8} height={420} /></div>;
  if (!dies.length) return <EmptyState title="No DCM shots of Oil Pan K-12 in this period" />;

  return (
    <div className="ds-root">
      <style>{CSS}{FLOW_CSS}</style>
      <div className="ds-scope">
        <span><b>Oil Pan K-12 (OPK12) dies in this period: {dies.map((d) => d.die).join(", ")}</b> · machine {dies[0].machine || "—"}</span>
        {noShot != null && noShot > 0 && <span>· {fmtInt(noShot)} traced parts ({fmtPct(pctOf(noShot, tracked), 1)}) have no shot record and are not on a die</span>}
      </div>

      {/* 1. shot cards per die */}
      <div className="ds-cards">
        {dies.map((d) => {
          const s = st(d.ngPct);
          const fin = d.finalOk != null ? pctOf(d.finalNg, d.finalOk + d.finalNg) : null;
          return (
            <section key={d.die} className="ds-card" style={{ "--c": STATUS_COLOR[s], "--bg": STATUS_BG[s] }} aria-label={`Die ${d.die}`}>
              <div className="ds-card-head"><b>Die {d.die}</b><span>Die casting OP100 · DCM shots</span></div>
              <div className="ds-nums">
                <div className="ds-num"><small>Shots</small><b style={{ color: NAVY }}>{fmtInt(d.shots)}</b></div>
                <div className="ds-num"><small>OK shots</small><b style={{ color: OUTCOME_COLOR.ok }}>{fmtInt(d.ok)}</b></div>
                <div className="ds-num"><small>Warm-up</small><b style={{ color: SLATE[600] }}>{fmtInt(d.warmUp)}</b></div>
                <div className="ds-num"><small>NG shots</small><b style={{ color: OUTCOME_COLOR.ng }}>{fmtInt(d.ng)}</b></div>
                <div className="ds-num"><small>NG-shot %</small><span className="ds-pct" style={{ color: STATUS_COLOR[s], background: alpha(STATUS_COLOR[s], 0.12) }}>{fmtPct(d.ngPct, 2)}</span></div>
              </div>
              <div className="ds-split" aria-hidden="true">
                <i style={{ flex: d.ok, background: OUTCOME_COLOR.ok }} />
                {d.warmUp > 0 && <i style={{ flex: d.warmUp, background: WARMUP_COLOR }} />}
                {d.ng > 0 && <i style={{ flex: d.ng, background: OUTCOME_COLOR.ng }} />}
              </div>
              {d.finalOk != null && (
                <div className="ds-final">
                  <span>Traced parts <b>{fmtInt(d.traced)}</b></span>
                  <span>Passed final <b style={{ color: OUTCOME_COLOR.ok }}>{fmtInt(d.finalOk)}</b></span>
                  <span>Final NG <b style={{ color: OUTCOME_COLOR.ng }}>{fmtInt(d.finalNg)}</b></span>
                  <span>In progress <b>{fmtInt(d.wip)}</b></span>
                  <span>Final rejection <b style={{ color: STATUS_COLOR[st(fin)] }}>{fmtPct(fin, 2)}</b></span>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* 2. production trend (shots + final rejection of the die) */}
      <DieProductionTrend shot={shot} dieDaily={dieDaily} dies={dies} />

      {/* 3. flow per die */}
      <SectionCard
        id="ds-flow"
        title="From shot to finished part — flow per die"
        subtitle="Stepped funnel: shots → production shots (warm-up removed) → good castings (NG shots removed) → traced parts → passed final inspection (OP160), with the drop at every step."
        info={{
          what: "Shots, warm-up and NG shots: shot analytics (PLC). Traced parts, passed final and final NG: the tracked parts of the die in the period (first scan) by their result so far.",
          formula: ["Production shots = shots − warm-up", "Good castings = production shots − NG shots", "Passed final % = passed final ÷ good castings", "Final rejection % = final NG ÷ (passed final + final NG)"],
          note: "Shots and traced parts are counted by different clocks (shot time vs first scan), so a few parts can cross the period boundary.",
        }}
      >
        {dies.map((d) => <DieFunnel key={d.die} d={d} />)}
      </SectionCard>

      {/* 4. parameter NG */}
      <SectionCard
        id="ds-params"
        title="Why shots are NG — parameters out of limit"
        subtitle={`Of ${fmtInt(ngShots)} NG shots, how many had each process parameter outside its set limits (a shot can break more than one) — sorted by lift (share on NG shots minus share on OK shots). A parameter out of limit on OK shots as well points to its limits, not to the process.`}
        info={{ what: "PLC shot records of the period: for every parameter with set limits, the NG shots and OK shots with a reading outside LSL / USL.", formula: ["Share of NG shots = NG shots out of limit ÷ all NG shots", "Lift = share on NG shots − share on OK shots (pp)"] }}
      >
        {!params.length ? <EmptyState title="No parameter out of limit on the NG shots" /> : (
          <ComboChart
            labels={params.map((p) => p.label)}
            keys={params.map((p) => p.key)}
            bars={[
              { key: "ng", name: "NG shots out of limit", color: OUTCOME_COLOR.ng, data: params.map((p) => num(p.ngOutOfLimit)) },
            ]}
            lines={[
              { key: "share", name: "% of NG shots out of limit", color: OUTCOME_COLOR.ng, data: params.map((p) => Number(num(p.ngOutPct).toFixed(1))), label: true, markersOnly: true },
              { key: "okshare", name: "% of OK shots out of limit", color: OUTCOME_COLOR.ok, data: params.map((p) => Number(num(p.okOutPct).toFixed(1))), markersOnly: true },
            ]}
            leftName="Shots"
            rightName="% of NG shots"
            rightMax={100}
            height={360}
            barMaxWidth={30}
            zoom={false}
            rotate={params.length > 6 ? 30 : 0}
            tooltipRows={(i) => [{ label: "OK shots out of limit", value: fmtInt(params[i]?.okOutOfLimit), bold: false }, { label: "Lift vs OK shots", value: `${num(params[i]?.lift).toFixed(1)} pp`, bold: false }]}
          />
        )}
      </SectionCard>
    </div>
  );
}
