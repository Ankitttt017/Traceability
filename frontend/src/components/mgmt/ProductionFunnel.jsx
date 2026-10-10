import React, { useMemo } from "react";
import { NAVY_2, OUTCOME_COLOR, SLATE, fmtInt, fmtPct } from "./mgmtTheme";

/**
 * Step-by-step production flow ("from shot to final OK").
 * Each row: step name | bar (passed · rejected · other) | passed | rejected (+ category mix) | loss %.
 *
 * steps: [{
 *   key, name, desc, badge (node), final (bool — green "good output" row),
 *   passed, rejected,
 *   other: [{ label, value, color }]        // extra, non-scrap segments (e.g. warm-up shots)
 *   segments: [{ key, label, value, color }] // composition of `rejected` (e.g. CR / CRAM / MR)
 *   lossPct, muted (bool — de-emphasise numbers that are not real inspection), note (text under the name)
 * }]
 */
export default function ProductionFunnel({ steps = [], passedColor = NAVY_2, rejectedColor = OUTCOME_COLOR.ng }) {
  const max = useMemo(
    () => Math.max(1, ...steps.map((s) => (s.passed || 0) + (s.rejected || 0) + (s.other || []).reduce((a, o) => a + (o.value || 0), 0))),
    [steps],
  );

  return (
    <div className="mg-funnel" role="table" aria-label="Production flow from shot to final OK">
      <div className="mg-fn-head" role="row">
        <span role="columnheader">Step</span>
        <span role="columnheader" style={{ textAlign: "left" }}>Volume</span>
        <span role="columnheader">Passed</span>
        <span role="columnheader">Rejected</span>
        <span role="columnheader">Loss</span>
      </div>
      {steps.map((s, idx) => {
        const segTotal = (s.segments || []).reduce((a, x) => a + (x.value || 0), 0);
        const mix = segTotal > 0
          ? (s.segments || []).filter((x) => x.value > 0).map((x) => ({ ...x, share: (x.value / segTotal) * 100 }))
          : [];
        const mixText = mix.slice().sort((a, b) => b.value - a.value).map((x) => `${x.label} ${Math.round(x.share)}%`).join(" · ");
        const tip = [
          `${s.name}`,
          `Passed: ${fmtInt(s.passed)}`,
          s.rejected != null ? `Rejected: ${fmtInt(s.rejected)}` : null,
          ...(s.other || []).map((o) => `${o.label}: ${fmtInt(o.value)}`),
          mixText ? `Mix: ${mixText}` : null,
        ].filter(Boolean).join("\n");
        return (
          <div key={s.key} className={`mg-fn-row ${s.final ? "final" : ""}`} role="row" title={tip}>
            <div className="mg-fn-label" role="cell">
              <div className="mg-fn-name">
                <span style={{ color: SLATE[400], fontWeight: 700, fontSize: 11.5, minWidth: 16 }}>{idx + 1}</span>
                {s.name}
                {s.badge}
              </div>
              {s.desc && <div className="mg-fn-desc" style={{ paddingLeft: 22 }}>{s.desc}</div>}
            </div>
            <div className="mg-fn-bar" role="cell" aria-hidden="true">
              {s.passed > 0 && (
                <span style={{ width: `${(s.passed / max) * 100}%`, background: s.final ? OUTCOME_COLOR.ok : s.muted ? SLATE[300] : passedColor }} />
              )}
              {s.rejected > 0 && <span style={{ width: `max(3px, ${(s.rejected / max) * 100}%)`, background: rejectedColor }} />}
              {(s.other || []).filter((o) => o.value > 0).map((o) => (
                <span key={o.label} style={{ width: `max(3px, ${(o.value / max) * 100}%)`, background: o.color }} />
              ))}
            </div>
            <div className="mg-fn-num" role="cell" style={{ color: s.final ? OUTCOME_COLOR.ok : s.muted ? SLATE[500] : SLATE[900] }}>
              <span className="mg-fn-step-lbl">Passed</span>
              {fmtInt(s.passed)}
            </div>
            <div className="mg-fn-rej" role="cell">
              <span className="mg-fn-step-lbl">Rejected</span>
              {s.rejected == null ? (
                <span className="mg-fn-num" style={{ color: SLATE[400] }}>—</span>
              ) : (
                <span className="mg-fn-num" style={{ color: s.rejected > 0 ? rejectedColor : SLATE[400] }}>{fmtInt(s.rejected)}</span>
              )}
              {mix.length > 0 && (
                <>
                  <span className="mg-fn-mini" aria-label={mixText}>
                    {mix.map((x) => <i key={x.key} style={{ width: `${x.share}%`, background: x.color }} />)}
                  </span>
                  <span style={{ fontSize: 10.5, color: SLATE[500], whiteSpace: "nowrap" }}>{mixText}</span>
                </>
              )}
              {(s.other || []).filter((o) => o.value > 0).map((o) => (
                <span key={o.label} style={{ fontSize: 11, color: SLATE[500], whiteSpace: "nowrap" }}>
                  + {fmtInt(o.value)} {o.label.toLowerCase()}
                </span>
              ))}
            </div>
            <div className="mg-fn-loss" role="cell">
              <span className="mg-fn-step-lbl">Loss</span>
              <span className="mg-fn-num" style={{ fontSize: 14, color: s.lossPct > 0 ? SLATE[800] : SLATE[400] }}>
                {s.lossPct == null ? "—" : fmtPct(s.lossPct, s.lossPct > 0 && s.lossPct < 0.1 ? 2 : 1)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
