import React, { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import SectionCard from "../../../components/mgmt/SectionCard";
import ParameterLiftBars from "../../../components/mgmt/ParameterLiftBars";
import { SkeletonBlock } from "../../../components/mgmt/Skeleton";
import EmptyState from "../../../components/mgmt/EmptyState";
import { OUTCOME_COLOR, SLATE, fmtInt, fmtPct } from "../../../components/mgmt/mgmtTheme";
import { LIMIT_ISSUE_OK_PCT, processSignals } from "./derive";

const TOP = 8;

/** Why NG shots happen: which process parameters are out of limits on NG shots but not on good shots. */
export default function RootCauseSection({ shot, loading }) {
  const data = useMemo(() => processSignals(shot, TOP), [shot]);

  const top = data.signal[0];
  const toItem = (p, flag) => ({
    key: p.key, label: p.label, aPct: p.ngOutPct, bPct: p.okOutPct, aCount: p.ngOutOfLimit, bCount: p.okOutOfLimit,
    muted: !!flag, flag,
  });

  return (
    <SectionCard
      id="ra-rootcause"
      kicker="Why · process root cause"
      title="What goes wrong on NG shots"
      subtitle={`For each machine parameter: how often it was out of its limits on NG shots (red) vs on good shots (grey). A big gap points to the cause.`}
      info={{
        what: "Compares the NG shots of the die-casting machine with the good shots of the same period. A parameter that is out of limits on most NG shots but almost never on good shots is the likely cause of NG shots.",
        formula: ["Gap (pp) = % of NG shots out of limits − % of OK shots out of limits"],
        note: `Parameters out of limits on ≥ ${LIMIT_ISSUE_OK_PCT}% of good shots are flagged "limit setting issue": their machine limits are wrong, so they cannot explain NG shots.`,
      }}
      footer={data.params.length > 0 ? (
        <>Based on {fmtInt(data.ng)} NG shots and {fmtInt(data.ok)} good shots. {data.quiet > 0 && `${data.quiet} other parameters show no difference between NG and good shots.`}</>
      ) : null}
    >
      {loading && !shot ? <SkeletonBlock lines={6} height={300} />
        : !data.ng ? <EmptyState title="No NG shots in this period" hint="The die-casting machine rejected no shots for process reasons." />
          : (
            <>
              {top && (
                <div className="ra-callout">
                  <b>{top.label}</b> was out of limits on <b style={{ color: OUTCOME_COLOR.ng }}>{fmtPct(top.ngOutPct)}</b> of NG shots
                  vs <b>{fmtPct(top.okOutPct, top.okOutPct < 1 ? 2 : 1)}</b> of good shots — the strongest signal in this period.
                </div>
              )}
              <div className="mg-legend" style={{ marginBottom: 12 }}>
                <span><i style={{ background: OUTCOME_COLOR.ng }} />NG shots out of limits</span>
                <span><i style={{ background: SLATE[500] }} />Good shots out of limits</span>
              </div>
              {data.signal.length ? (
                <ParameterLiftBars items={data.signal.map((p) => toItem(p))} />
              ) : (
                <EmptyState title="No parameter stands out" hint="NG shots and good shots have the same out-of-limit pattern." minHeight={100} />
              )}
              {data.limitIssue.length > 0 && (
                <div className="ra-limit-box">
                  <div className="ra-limit-head">
                    <AlertTriangle size={14} aria-hidden="true" /> Limits not meaningful — out of limits on most shots, NG or good
                  </div>
                  <ParameterLiftBars items={data.limitIssue.map((p) => toItem(p, "limit setting issue"))} />
                  <div style={{ fontSize: 11.5, color: SLATE[500], marginTop: 6 }}>Review the machine limits for these parameters; until then they give no signal.</div>
                </div>
              )}
            </>
          )}
    </SectionCard>
  );
}
