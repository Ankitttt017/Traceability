import React, { useCallback, useMemo } from "react";
import SectionCard from "../../../components/mgmt/SectionCard";
import TargetTrendChart from "../../../components/mgmt/TargetTrendChart";
import { SkeletonBlock } from "../../../components/mgmt/Skeleton";
import EmptyState from "../../../components/mgmt/EmptyState";
import {
  CATEGORY_COLOR, CATEGORY_NAME, CATEGORY_ORDER, NAVY, SLATE, STATUS_COLOR, TARGETS, fmtInt, scrapStatus,
} from "../../../components/mgmt/mgmtTheme";

/** Rejections by category over time + scrap % vs target. Click a day → page filters to that day. */
export default function TrendSection({ trend, loading, onSelectDay, ngShotsTotal }) {
  const hourly = trend?.mode === "hour";

  const chart = useMemo(() => {
    if (!trend?.buckets?.length) return null;
    const b = trend.buckets;
    const stacks = CATEGORY_ORDER.map((c) => ({
      name: c === "CR" && !hourly ? "CR (incl. NG shots)" : c,
      color: CATEGORY_COLOR[c],
      data: b.map((x) => (c === "CR" ? x.cats.CR + (hourly ? 0 : x.ngShots) : x.cats[c])),
    }));
    if (b.some((x) => x.cats.OTHER > 0)) stacks.push({ name: "Not classified", color: SLATE[400], data: b.map((x) => x.cats.OTHER) });
    return { stacks, rate: { name: hourly ? "Station reject %" : "Scrap %", data: b.map((x) => x.rate) } };
  }, [trend, hourly]);

  const tooltipRows = useCallback((i) => {
    const x = trend?.buckets?.[i];
    if (!x) return [];
    return hourly
      ? [{ label: "Parts traced", value: fmtInt(x.produced), bold: false }, { label: "Final OK", value: fmtInt(x.ok), bold: false }]
      : [
        { label: "NG shots (in CR)", value: fmtInt(x.ngShots), bold: false },
        { label: "Station NG", value: fmtInt(x.stationNg), bold: false },
        { label: "DCM shots (excl. warm-up)", value: x.shots ? fmtInt(x.shots - x.warmUp) : "no shot data", bold: false },
        { label: "Final OK", value: fmtInt(x.ok), bold: false },
      ];
  }, [trend, hourly]);
  const tooltipNote = useCallback((i) => {
    const x = trend?.buckets?.[i];
    if (!x || hourly) return null;
    return !x.shots ? "No DCM shot data for this day — scrap % cannot be calculated." : null;
  }, [trend, hourly]);

  const offDays = useMemo(() => {
    if (!trend?.buckets?.length || hourly) return null;
    const rated = trend.buckets.filter((x) => x.rate != null);
    if (!rated.length) return null;
    const red = rated.filter((x) => scrapStatus(x.rate) === "bad").length;
    const amber = rated.filter((x) => scrapStatus(x.rate) === "warn").length;
    return { red, amber, green: rated.length - red - amber, n: rated.length };
  }, [trend, hourly]);

  return (
    <SectionCard
      id="ra-trend"
      kicker="When"
      title={hourly ? "Rejections hour by hour" : "Rejections and scrap rate by day"}
      subtitle={hourly
        ? "Bars = parts rejected at stations each hour, by category; the line below is the station reject % against the 2 % target."
        : "Bars = rejections per production day by category; the line below is the scrap % — points above the dashed target line are off target. Click a day to see it hour by hour."}
      info={{
        what: hourly
          ? "Top: station rejections per hour (CR / CRAM / MR). Bottom: station reject % = station NG ÷ parts traced in that hour. NG shots are only recorded per day, so they are not in the hourly bars."
          : "Top: rejections per production day (06:00 → 06:00) stacked by category; CR includes the shots the machine rejected (NG shots). Bottom: scrap % of that day with the target line and the amber 'near target' band.",
        formula: hourly ? ["Station reject % = station NG ÷ parts traced"] : ["Scrap % = (NG shots + station NG) ÷ (DCM shots − warm-up)"],
      }}
      actions={offDays && (
        <div className="ra-daycount" aria-label="Days by status">
          <span style={{ color: STATUS_COLOR.good }}>● {offDays.green} on target</span>
          <span style={{ color: STATUS_COLOR.warn }}>● {offDays.amber} near</span>
          <span style={{ color: STATUS_COLOR.bad }}>● {offDays.red} off target</span>
        </div>
      )}
      footer={hourly && ngShotsTotal != null
        ? <>NG shots this day: <b>{fmtInt(ngShotsTotal)}</b> (recorded per day only, not shown per hour). They are included in the KPI scrap rate above.</>
        : null}
    >
      {loading && !chart ? (
        <SkeletonBlock lines={6} height={340} />
      ) : !chart ? (
        <EmptyState title="No rejections or production in this period" />
      ) : (
        <>
          <div className="mg-legend" style={{ marginBottom: 2 }}>
            {chart.stacks.map((s) => (
              <span key={s.name} title={CATEGORY_NAME[s.name.split(" ")[0]] || s.name}><i style={{ background: s.color }} />{s.name}</span>
            ))}
            <span><i className="line" style={{ background: NAVY }} />{chart.rate.name}</span>
            <span style={{ color: SLATE[700] }}><i className="dash" />Target {TARGETS.scrapPct}%</span>
            <span><i style={{ background: "rgba(217,119,6,0.25)" }} />Near target (+{TARGETS.amberBandPp} pp)</span>
          </div>
          <TargetTrendChart
            labels={trend.labels}
            keys={trend.keys}
            stacks={chart.stacks}
            rate={chart.rate}
            target={TARGETS.scrapPct}
            band={TARGETS.amberBandPp}
            tooltipRows={tooltipRows}
            tooltipNote={tooltipNote}
            onSelect={hourly ? undefined : onSelectDay}
            rateAxisName={hourly ? "Reject %" : "Scrap %"}
            height={390}
          />
        </>
      )}
    </SectionCard>
  );
}
