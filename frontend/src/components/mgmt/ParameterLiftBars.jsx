import React from "react";
import { OUTCOME_COLOR, SLATE, fmtPct, fmtPp } from "./mgmtTheme";

/**
 * Paired bars per factor: how often it is "present" in the bad group (a) vs the good group (b).
 * The gap (lift, in percentage points) is what points to a cause.
 *
 * items: [{ key, label, aPct, bPct, aCount?, bCount?, muted?, flag? }]
 * aLabel / bLabel: e.g. "NG shots" / "OK shots"; phrase: e.g. "out of limits"
 */
export default function ParameterLiftBars({
  items = [], aLabel = "NG shots", bLabel = "OK shots", aColor = OUTCOME_COLOR.ng, bColor = SLATE[500], phrase = "out of limits",
}) {
  return (
    <div className="mg-lift">
      {items.map((it) => {
        const lift = (it.aPct || 0) - (it.bPct || 0);
        const fade = it.muted ? 0.45 : 1;
        return (
          <div key={it.key} className="mg-lift-row">
            <div>
              <div className="mg-lift-name" style={{ color: it.muted ? SLATE[500] : SLATE[900] }}>{it.label}</div>
              {it.flag ? (
                <span className="mg-tag" style={{ marginTop: 3, background: "#fff7e6", color: "#92400e", borderColor: "#fcd9a5" }}>{it.flag}</span>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 700, color: lift >= 1 ? SLATE[800] : SLATE[400] }} className="mg-num">
                  {fmtPp(lift)} on NG
                </div>
              )}
            </div>
            <div className="mg-lift-bars" aria-hidden="true">
              <div className="mg-lift-track" title={`${aLabel}: ${fmtPct(it.aPct)}`}>
                <i style={{ width: `${Math.min(100, it.aPct || 0)}%`, minWidth: it.aPct > 0 ? 3 : 0, background: aColor, opacity: fade }} />
              </div>
              <div className="mg-lift-track" title={`${bLabel}: ${fmtPct(it.bPct)}`}>
                <i style={{ width: `${Math.min(100, it.bPct || 0)}%`, minWidth: it.bPct > 0 ? 3 : 0, background: bColor, opacity: fade }} />
              </div>
            </div>
            <div className="mg-lift-txt">
              {phrase} on <b className="mg-num" style={{ color: it.muted ? SLATE[600] : aColor }}>{fmtPct(it.aPct)}</b> of {aLabel}
              {" "}vs <b className="mg-num" style={{ color: SLATE[700] }}>{fmtPct(it.bPct, it.bPct > 0 && it.bPct < 1 ? 2 : 1)}</b> of {bLabel}
            </div>
          </div>
        );
      })}
    </div>
  );
}
