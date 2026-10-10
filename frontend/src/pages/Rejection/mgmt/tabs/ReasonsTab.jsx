import React, { useCallback, useEffect, useMemo } from "react";
import { ZoomIn } from "lucide-react";
import SectionCard from "../../../../components/mgmt/SectionCard";
import ZoomBarChart from "../../../../components/mgmt/ZoomBarChart";
import DonutChart from "../../../../components/mgmt/DonutChart";
import HeatMatrix from "../../../../components/mgmt/HeatMatrix";
import { SkeletonBlock } from "../../../../components/mgmt/Skeleton";
import EmptyState from "../../../../components/mgmt/EmptyState";
import {
  CATEGORY_COLOR, CATEGORY_NAME, CATEGORY_ORDER, NAVY, NAVY_3, OUTCOME_COLOR, SLATE, WARMUP_COLOR, fmtInt, fmtPct, pctOf,
} from "../../../../components/mgmt/mgmtTheme";
import WhySection from "../WhySection";
import { buildReasonPareto, buildStationMatrix, dayLabel } from "../derive";
import { NEUTRAL_RAMP, SHIFT_COLOR, buildReasonStationMatrix, buildReasonTrend, buildShiftSplit } from "../deriveTabs";

const LINE_COLORS = ["#0f2a4a", "#0e7490", "#a16207", "#be185d", "#64748b"];
const ZoomHint = () => <span className="mg-hint"><ZoomIn size={13} aria-hidden="true" />Mouse wheel = zoom · drag = move</span>;

/** DCM shots per day: OK / NG / warm-up (three series) + NG-shot rate. */
function ShotsByDay({ shot, loading }) {
  const days = useMemo(() => (shot?.byDay || []).slice().sort((a, b) => String(a.day).localeCompare(String(b.day))), [shot]);
  const labels = useMemo(() => days.map((d) => dayLabel(d.day)), [days]);
  const bars = useMemo(() => [
    { name: "OK shots", color: OUTCOME_COLOR.ok, data: days.map((d) => Number(d.ok) || 0) },
    { name: "NG shots", color: OUTCOME_COLOR.ng, data: days.map((d) => Number(d.ng) || 0), minHeight: 2 },
    { name: "Warm-up shots", color: WARMUP_COLOR, data: days.map((d) => Number(d.warmUp) || 0), label: true, labelColor: SLATE[700],
      labelFormatter: (i) => fmtInt(Number(days[i]?.shots) || 0) },
  ], [days]);
  const rate = useMemo(() => ({
    name: "NG-shot %", axisName: "NG %",
    data: days.map((d) => pctOf(Number(d.ng) || 0, (Number(d.shots) || 0) - (Number(d.warmUp) || 0))),
  }), [days]);
  const tooltipRows = useCallback((i) => [{ label: "Total shots", value: fmtInt(days[i]?.shots) }], [days]);
  const t = shot?.totals;

  return (
    <SectionCard
      id="ra-dcm"
      kicker="Why · die casting"
      title="DCM shots per day — OK, NG and warm-up"
      subtitle={t
        ? `${fmtInt(t.shots)} shots on ${t.machine || "the die-casting machine"}: ${fmtInt(t.ok)} OK, ${fmtInt(t.ng)} NG (${fmtPct(pctOf(t.ng, t.shots - t.warmUp), 2)} of production shots), ${fmtInt(t.warmUp)} warm-up. The number on each bar is the day's total.`
        : "Shots of the die-casting machine per production day."}
      info={{
        what: "Every shot of the die-casting machine (OP100), each shot number once. NG shot = a process parameter out of limits (machine rejection, always CR). Warm-up shots are planned start-up shots — shown in grey, not counted as scrap.",
        formula: ["NG-shot % = NG shots ÷ (shots − warm-up)"],
      }}
      actions={<ZoomHint />}
    >
      {loading && !shot ? <SkeletonBlock lines={6} height={320} />
        : !days.length ? <EmptyState title="No DCM shot data in this period" />
          : (
            <>
              <div className="mg-legend" style={{ marginBottom: 2 }}>
                <span><i style={{ background: OUTCOME_COLOR.ok }} />OK shots</span>
                <span><i style={{ background: OUTCOME_COLOR.ng }} />NG shots</span>
                <span><i style={{ background: WARMUP_COLOR }} />Warm-up (planned, not scrap)</span>
                <span><i className="line" style={{ background: NAVY }} />NG-shot % (right axis)</span>
              </div>
              <ZoomBarChart labels={labels} keys={[]} bars={bars} rate={rate} tooltipRows={tooltipRows} height={360} valueAxisName="Shots" sliderFrom={10} />
            </>
          )}
    </SectionCard>
  );
}

/** Tab 2 — Reasons & Pareto. */
export default function ReasonsTab({ enriched, rowsLoading, k, shot, shotLoading, trend, ngParts, ensure, config, configLoading }) {
  useEffect(() => { ensure("rows"); }, [ensure]);
  const ngShots = k.ngShots || 0;
  const ensureConfig = useCallback(() => ensure("config"), [ensure]);

  const donuts = useMemo(() => {
    if (!enriched) return null;
    const cats = k.cats || {};
    const catItems = [...CATEGORY_ORDER, "OTHER"].map((c) => ({
      label: c === "OTHER" ? "Not classified" : `${c} · ${CATEGORY_NAME[c]}`, value: cats[c] || 0, color: CATEGORY_COLOR[c],
      note: c === "CR" ? `Includes ${fmtInt(ngShots)} NG shots` : undefined,
    }));
    const pareto = buildReasonPareto({ enriched, ngShots, top: 5 });
    const reasonItems = pareto.items.map((x, i) => ({ label: x.label, value: x.value, color: x.label.startsWith("Other (") ? SLATE[300] : NEUTRAL_RAMP[i % NEUTRAL_RAMP.length], note: x.note }));
    const stations = buildStationMatrix({ enriched, ngShots })
      .map((r) => ({ label: r.key === "DCM" ? "OP100 DCM (NG shots)" : r.label, value: Object.values(r.values).reduce((a, v) => a + (Number(v) || 0), 0), note: r.sub }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((r, i) => ({ ...r, color: NEUTRAL_RAMP[i % NEUTRAL_RAMP.length] }));
    const sh = buildShiftSplit({ enriched, shot });
    const shiftItems = ["A", "B", "C", "—"].map((l) => ({ label: l === "—" ? "Shift not recorded" : `Shift ${l}`, value: sh[l], color: SHIFT_COLOR[l] }));
    return { catItems, reasonItems, stations, shiftItems };
  }, [enriched, k.cats, ngShots, shot]);

  const matrix = useMemo(() => (enriched ? buildReasonStationMatrix(enriched, 10) : null), [enriched]);
  const matrixCols = useMemo(() => (matrix ? matrix.cols.map((c) => ({ key: c, label: c, color: NAVY_3 })) : []), [matrix]);

  const reasonTrend = useMemo(
    () => (enriched ? buildReasonTrend({ enriched, ngParts, top: 5, dayKeys: trend?.mode === "day" ? trend.keys : null }) : null),
    [enriched, ngParts, trend],
  );
  const rtLines = useMemo(() => (reasonTrend ? reasonTrend.series.map((s, i) => ({ ...s, color: LINE_COLORS[i % LINE_COLORS.length] })) : []), [reasonTrend]);
  const rtLabels = useMemo(() => (reasonTrend ? reasonTrend.keys.map(dayLabel) : []), [reasonTrend]);

  return (
    <>
      <WhySection enriched={enriched} ngShots={ngShots} loading={rowsLoading} config={config} configLoading={configLoading} onNeedConfig={ensureConfig} />

      <ShotsByDay shot={shot} loading={shotLoading} />

      <SectionCard
        id="ra-reason-mix"
        kicker="Why · share"
        title="Rejection mix"
        subtitle="Share of all rejections in the period by defect category, by reason, by station and by shift. NG shots count as CR at the die-casting machine."
        info={{ what: "Each donut splits the same total — all rejections (NG shots + station NG) — a different way. Hover a slice for the count and share." }}
      >
        {rowsLoading && !donuts ? <SkeletonBlock lines={6} height={260} />
          : !donuts ? <EmptyState />
            : (
              <div className="ra-donuts">
                <div><div className="ra-mini-title">By category</div><DonutChart items={donuts.catItems} centerLabel="rejections" /></div>
                <div><div className="ra-mini-title">Top reasons</div><DonutChart items={donuts.reasonItems} centerLabel="rejections" /></div>
                <div><div className="ra-mini-title">By station</div><DonutChart items={donuts.stations} centerLabel="rejections" /></div>
                <div><div className="ra-mini-title">By shift</div><DonutChart items={donuts.shiftItems} centerLabel="rejections" /></div>
              </div>
            )}
      </SectionCard>

      <div className="mg-grid2">
        <SectionCard
          id="ra-advanced"
          kicker="Advanced analytics"
          title="Reason × station"
          subtitle="Which station records which reason (top 10 station reasons). Darker = more."
          info={{ what: "Station rejections only (part records), counted at the station that rejected the part. Leak-test machines separately." }}
        >
          {rowsLoading && !matrix ? <SkeletonBlock lines={7} height={280} />
            : !matrix?.rows.length ? <EmptyState title="No station rejections in this period" />
              : <HeatMatrix rows={matrix.rows} cols={matrixCols} rowHeader="Reason" />}
        </SectionCard>
        <SectionCard
          id="ra-reason-trend"
          kicker="Advanced analytics"
          title="Top 5 reasons over time"
          subtitle="Station rejections per production day for the five most frequent reasons."
          info={{ what: "Each NG record lands on the production day the daily trend gives the part (same day as the trend totals)." }}
          actions={<ZoomHint />}
        >
          {rowsLoading && !reasonTrend ? <SkeletonBlock lines={6} height={300} />
            : !reasonTrend?.series.length ? <EmptyState title="No station rejections in this period" />
              : (
                <>
                  <div className="mg-legend" style={{ marginBottom: 2 }}>
                    {rtLines.map((s) => <span key={s.name}><i className="line" style={{ background: s.color }} />{s.name}</span>)}
                  </div>
                  <ZoomBarChart labels={rtLabels} keys={[]} lines={rtLines} height={320} valueAxisName="NG parts" sliderFrom={10} />
                </>
              )}
        </SectionCard>
      </div>
    </>
  );
}
