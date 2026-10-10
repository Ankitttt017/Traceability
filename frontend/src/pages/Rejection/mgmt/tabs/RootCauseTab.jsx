import React, { useEffect, useMemo } from "react";
import SectionCard from "../../../../components/mgmt/SectionCard";
import ComparisonTable from "../../../../components/mgmt/ComparisonTable";
import StatusPill from "../../../../components/mgmt/StatusPill";
import { SkeletonBlock } from "../../../../components/mgmt/Skeleton";
import EmptyState from "../../../../components/mgmt/EmptyState";
import { NAVY_3, OUTCOME_COLOR, SLATE, fmtInt } from "../../../../components/mgmt/mgmtTheme";
import RootCauseSection from "../RootCauseSection";
import { mlTopParameters } from "../deriveTabs";

const RISK = { CRITICAL: ["bad", "Critical"], HIGH: ["bad", "High"], MODERATE: ["warn", "Moderate"], LOW: ["good", "Low"] };
const fmtNum = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

/** Part-level process analysis: machine parameters of NG parts vs OK parts (rejection-ml-insights). */
function ProcessAnalysis({ ensure, get }) {
  useEffect(() => { ensure("ml"); }, [ensure]);
  const q = get("ml");
  const data = useMemo(() => (q.data ? mlTopParameters(q.data, 10) : null), [q.data]);
  const maxImp = data ? Math.max(1, ...data.ranked.map((p) => p.importance)) : 1;

  return (
    <SectionCard
      id="ra-process"
      kicker="Why · part level"
      title="Machine parameters on NG parts vs OK parts"
      subtitle="Traced parts (all stations): the average value of each machine parameter on rejected parts compared with good parts. The parameters that separate NG from OK most come first."
      info={{
        what: "Uses the shot parameters stored with every traced part. 'Separation' is the analysis score (0–100) of how strongly a parameter differs between NG and OK parts. A difference does not prove cause — check it against the shot-level view above and the machine limits.",
        formula: ["Difference = (mean on NG − mean on OK) ÷ mean on OK", "σ = (mean on NG − mean on OK) ÷ spread on OK parts"],
        note: "Parameters that are not recorded on NG or OK parts (average 0) are left out.",
      }}
      footer={data ? <>{fmtInt(data.ranked.length)} of {fmtInt(data.total)} parameters shown{data.skipped ? ` · ${data.skipped} not recorded on NG or OK parts left out` : ""}. Loaded only when this tab is opened.</> : null}
    >
      {q.status === "loading" && !data ? <SkeletonBlock lines={8} height={320} />
        : q.status === "error" ? <EmptyState title="Process analysis could not be loaded" hint={q.error} />
          : !data?.ranked.length ? <EmptyState title="Not enough parameter data in this period" />
            : (
              <ComparisonTable
                rowKey="key"
                rows={data.ranked}
                columns={[
                  {
                    key: "label", label: "Parameter",
                    render: (p) => (
                      <div>
                        <div className="strong">{p.label}</div>
                        <div style={{ fontSize: 11, color: SLATE[500] }}>{p.category}{p.lsl != null || p.usl != null ? ` · limits ${p.lsl ?? "—"} – ${p.usl ?? "—"} ${p.unit}` : ""}</div>
                      </div>
                    ),
                  },
                  { key: "ok", label: "Mean on OK", align: "right", render: (p) => <span>{fmtNum(p.meanOk)} <small style={{ color: SLATE[500] }}>{p.unit}</small></span> },
                  { key: "ng", label: "Mean on NG", align: "right", render: (p) => <span style={{ color: OUTCOME_COLOR.ng, fontWeight: 700 }}>{fmtNum(p.meanNg)} <small style={{ color: SLATE[500], fontWeight: 400 }}>{p.unit}</small></span> },
                  {
                    key: "diff", label: "Difference", align: "right",
                    render: (p) => (
                      <span style={{ whiteSpace: "nowrap" }}>
                        <b>{p.diffPct == null ? "—" : `${p.diffPct > 0 ? "+" : ""}${p.diffPct.toFixed(1)}%`}</b>
                        {p.sigma != null && <span style={{ color: SLATE[500], fontSize: 11.5 }}> · {p.sigma > 0 ? "+" : ""}{p.sigma.toFixed(1)}σ</span>}
                      </span>
                    ),
                  },
                  {
                    key: "imp", label: "Separation", width: "20%",
                    render: (p) => (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="mg-ratebar" style={{ flex: 1, minWidth: 60 }}><i style={{ width: `${(p.importance / maxImp) * 100}%`, background: NAVY_3 }} /></div>
                        <span className="mg-num" style={{ fontSize: 12, width: 30, textAlign: "right" }}>{Math.round(p.importance)}</span>
                      </div>
                    ),
                  },
                  { key: "risk", label: "Risk", render: (p) => { const r = RISK[p.risk] || ["none", p.risk || "—"]; return <StatusPill status={r[0]} label={r[1]} size="sm" />; } },
                ]}
              />
            )}
    </SectionCard>
  );
}

/** Tab 4 — Root cause. */
export default function RootCauseTab({ shot, shotLoading, ensure, get }) {
  return (
    <>
      <RootCauseSection shot={shot} loading={shotLoading} />
      <ProcessAnalysis ensure={ensure} get={get} />
    </>
  );
}
