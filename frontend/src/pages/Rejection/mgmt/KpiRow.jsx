import React from "react";
import KpiTile from "../../../components/mgmt/KpiTile";
import {
  NAVY_3, OUTCOME_COLOR, SLATE, TARGETS, WARMUP_COLOR, fmtInt, fmtPct, fmtPp, fpyStatus, pctOf, scrapStatus,
} from "../../../components/mgmt/mgmtTheme";
import { DEFINITIONS } from "./derive";

const n = (v) => fmtInt(v);

/**
 * The executive KPI row: DCM Shots · Total Traced · Total Pass · Total NG · In Progress · Scrap % · FPY.
 * Total Traced = Total Pass + Total NG + In Progress over the same parts (the parts first scanned in the period).
 * k = computeKpis(); trend = buildDailyTrend()/buildHourlyTrend() (sparklines, optional).
 */
export default function KpiRow({ k, trend, loadingShot, loadingSummary }) {
  const daily = trend?.mode === "day" && trend.buckets.length > 1 ? trend.buckets : null;
  const spark = (fn) => (daily ? daily.map(fn) : undefined);
  const scrapSt = scrapStatus(k.scrapPct);
  const fpySt = fpyStatus(k.fpyPct);
  const eq = k.traced != null ? `${n(k.totalPass)} + ${n(k.totalNg)} + ${n(k.inProgress)} = ${n(k.tracedSum)}` : null;

  return (
    <div className="mg-kpis ra-kpis" aria-label="Key figures for the selected period">
      <KpiTile
        label="DCM Shots"
        loading={loadingShot}
        value={fmtInt(k.shots)}
        sub={k.shots != null ? `${fmtInt(k.ngShots)} NG · ${fmtInt(k.warmUp)} warm-up` : "No shot data in this period"}
        spark={spark((b) => b.shots)}
        sparkColor={WARMUP_COLOR}
        info={{ ...DEFINITIONS.shots, formula: ["DCM shots = good + NG + warm-up shots"], note: "NG shots = process parameter out of limits (CR). Warm-up shots are planned and not counted as scrap." }}
      />
      <KpiTile
        label="Total Traced"
        loading={loadingSummary}
        value={fmtInt(k.traced)}
        sub={k.traced != null ? (k.tracedAddsUp ? "= Pass + NG + In Progress" : `Pass + NG + In Progress = ${n(k.tracedSum)}`) : null}
        info={{
          ...DEFINITIONS.traced,
          formula: ["Total Traced = Total Pass + Total NG + In Progress", ...(eq ? [eq] : [])],
          note: k.traced != null && !k.tracedAddsUp ? `The parts do not add up to the traced total (difference ${n(k.traced - k.tracedSum)}).` : "All four figures count the same parts.",
        }}
      />
      <KpiTile
        label="Total Pass"
        loading={loadingSummary}
        value={fmtInt(k.totalPass)}
        valueColor={OUTCOME_COLOR.ok}
        sub={k.traced ? `${fmtPct(pctOf(k.totalPass, k.traced), 1)} of traced` : null}
        spark={spark((b) => b.ok)}
        sparkColor={OUTCOME_COLOR.ok}
        info={DEFINITIONS.pass}
      />
      <KpiTile
        label="Total NG"
        loading={loadingSummary}
        value={fmtInt(k.totalNg)}
        valueColor={OUTCOME_COLOR.ng}
        sub={k.traced ? `${fmtPct(pctOf(k.totalNg, k.traced), 1)} of traced` : null}
        spark={spark((b) => b.stationNg)}
        sparkColor={OUTCOME_COLOR.ng}
        info={DEFINITIONS.ng}
      />
      <KpiTile
        label="In Progress"
        loading={loadingSummary}
        value={fmtInt(k.inProgress)}
        valueColor={SLATE[600]}
        sub={k.traced ? `${fmtPct(pctOf(k.inProgress, k.traced), 1)} of traced · no final result yet` : null}
        info={DEFINITIONS.inProgress}
      />
      <KpiTile
        label="Scrap %"
        loading={loadingShot || loadingSummary}
        value={fmtPct(k.scrapPct, 2)}
        status={scrapSt}
        target={`≤ ${TARGETS.scrapPct}%`}
        delta={k.scrapPct != null ? `${fmtPp(k.scrapPct - TARGETS.scrapPct)}` : null}
        spark={spark((b) => b.rate)}
        sparkTarget={TARGETS.scrapPct}
        sparkColor={NAVY_3}
        info={{
          ...DEFINITIONS.scrap,
          formula: [
            ...DEFINITIONS.scrap.formula,
            ...(k.scrapPct != null ? [`= (${n(k.ngShots)} + ${n(k.totalNg)}) ÷ ${n(k.production)} = ${fmtPct(k.scrapPct, 2)}`] : []),
          ],
        }}
      />
      <KpiTile
        label="FPY"
        loading={loadingSummary}
        value={fmtPct(k.fpyPct, 1)}
        status={fpySt}
        target={`≥ ${TARGETS.fpyPct}%`}
        delta={k.fpyPct != null ? `${fmtPp(k.fpyPct - TARGETS.fpyPct)}` : null}
        spark={spark((b) => b.fpy)}
        sparkTarget={TARGETS.fpyPct}
        sparkColor={NAVY_3}
        info={{
          ...DEFINITIONS.fpy,
          formula: [
            ...DEFINITIONS.fpy.formula,
            ...(k.fpyPct != null ? [`= ${n(k.totalPass)} ÷ (${n(k.totalPass)} + ${n(k.totalNg)}) = ${fmtPct(k.fpyPct, 1)}`] : []),
          ],
        }}
      />
    </div>
  );
}
