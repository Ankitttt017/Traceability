import React, { useEffect, useMemo } from "react";
import SectionCard from "../../../components/mgmt/SectionCard";
import ComparisonTable from "../../../components/mgmt/ComparisonTable";
import RateBar from "../../../components/mgmt/RateBar";
import StatusPill from "../../../components/mgmt/StatusPill";
import { SkeletonBlock } from "../../../components/mgmt/Skeleton";
import EmptyState from "../../../components/mgmt/EmptyState";
import useInView from "../../../components/mgmt/useInView";
import { OUTCOME_COLOR, SLATE, STATUS_COLOR, TARGETS, fmtInt, fmtPct, fpyStatus, scrapStatus } from "../../../components/mgmt/mgmtTheme";
import { buildDieRows, buildShiftRows } from "./derive";

const INFO = {
  what: "Same definitions as the KPI row, per die and per shift. Shots, NG shots and warm-up come from the die-casting machine; station NG and final OK come from the traced parts of that die / shift.",
  formula: ["Scrap % = (NG shots + station NG) ÷ max(shots − warm-up, parts, final OK + rejections)", "FPY = final OK ÷ (final OK + station NG)"],
  note: "A die with no shot data in the period shows '—' for scrap %.",
};

const numCell = (v, color) => <span style={{ color: v ? color || SLATE[800] : SLATE[400] }}>{v == null ? "—" : fmtInt(v)}</span>;

/** showFpy=false drops the FPY column (e.g. on a running day, when parts of a shift have not reached final OK yet). */
export default function DieShiftSection({ shot, dieStats, shiftScrap, shiftLoading, summaryLoading, onVisible, showFpy = true }) {
  const [ref, seen] = useInView();
  useEffect(() => { if (seen) onVisible?.(); }, [seen, onVisible]);

  const dies = useMemo(() => buildDieRows({ shot, dieStats }), [shot, dieStats]);
  const shifts = useMemo(() => (shiftScrap ? buildShiftRows({ shot, shiftScrap }) : null), [shot, shiftScrap]);
  const maxRate = useMemo(
    () => Math.max(TARGETS.scrapPct * 2, ...[...dies, ...(shifts || [])].map((r) => r.scrapPct || 0)),
    [dies, shifts],
  );

  const rateCol = { key: "scrap", label: `Scrap % (target ≤ ${TARGETS.scrapPct}%)`, width: "30%", render: (r) => <RateBar value={r.scrapPct} target={TARGETS.scrapPct} max={maxRate} status={scrapStatus(r.scrapPct)} /> };
  const fpyCol = {
    key: "fpy", label: "FPY", align: "right",
    render: (r) => <span style={{ fontWeight: 700, color: STATUS_COLOR[fpyStatus(r.fpyPct)] }}>{fmtPct(r.fpyPct)}</span>,
  };
  const common = [
    { key: "shots", label: "Shots", align: "right", render: (r) => numCell(r.shots) },
    { key: "ngShots", label: "NG shots", align: "right", render: (r) => numCell(r.ngShots, OUTCOME_COLOR.ng) },
    { key: "stationNg", label: "Station NG", align: "right", render: (r) => numCell(r.stationNg, OUTCOME_COLOR.ng) },
    { key: "finalOk", label: "Final OK", align: "right", render: (r) => numCell(r.finalOk, OUTCOME_COLOR.ok) },
    rateCol,
    ...(showFpy ? [fpyCol] : []),
  ];

  const worstShift = shifts ? shifts.filter((s) => s.scrapPct != null).sort((a, b) => b.scrapPct - a.scrapPct)[0] : null;

  return (
    <div ref={ref} className="mg-grid2">
      <SectionCard
        id="ra-die"
        kicker="Which die"
        title="Die comparison"
        subtitle={dies.length === 1 ? `Only die ${dies[0].die} ran in this period.` : "Scrap rate per die against the target (black tick)."}
        info={INFO}
      >
        {summaryLoading && !dies.length ? <SkeletonBlock lines={3} height={140} />
          : !dies.length ? <EmptyState title="No die data in this period" />
            : (
              <ComparisonTable
                rowKey="key"
                rows={dies}
                columns={[
                  {
                    key: "die", label: "Die",
                    render: (r) => (
                      <div>
                        <div className="strong">{r.die}</div>
                        <div style={{ fontSize: 11, color: SLATE[500], whiteSpace: "nowrap" }}>{r.machine || (r.shots == null ? "no shot data" : "")}</div>
                      </div>
                    ),
                  },
                  ...common,
                ]}
              />
            )}
      </SectionCard>

      <SectionCard
        id="ra-shift"
        kicker="Which shift"
        title="Shift comparison"
        subtitle={worstShift ? `Shift ${worstShift.shift} has the highest scrap rate (${fmtPct(worstShift.scrapPct, 2)}).` : "Scrap rate per shift against the target (black tick)."}
        info={INFO}
        actions={worstShift ? <StatusPill status={scrapStatus(worstShift.scrapPct)} label={`Worst: Shift ${worstShift.shift}`} /> : null}
      >
        {!seen || (shiftLoading && !shifts) ? <SkeletonBlock lines={3} height={140} />
          : !shifts ? <EmptyState title="Shift data not available" />
            : (
              <ComparisonTable
                rowKey="key"
                rows={shifts}
                columns={[{ key: "shift", label: "Shift", render: (r) => <span className="strong" style={{ whiteSpace: "nowrap" }}>Shift {r.shift}</span> }, ...common]}
              />
            )}
      </SectionCard>
    </div>
  );
}
