import React from "react";
import InfoTip from "./InfoTip";
import { OTHER, fmtInt, fmtPct } from "../chartTheme";

const pctOf = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);

/** Card header with the (i) chart description, used by the daily output / category cards. */
export function Head({ icon: Icon, title, sub, info, children }) {
  return (
    <div className="ra-card-head">
      <div style={{ minWidth: 0, flex: "1 1 260px", display: "flex", gap: 10, alignItems: "flex-start" }}>
        {Icon && <span className="ra-icon" aria-hidden="true"><Icon size={16} /></span>}
        <div style={{ minWidth: 0 }}>
          <h3 className="ra-card-title" style={{ display: "flex", alignItems: "center" }}>{title}<InfoTip info={info} /></h3>
          {sub && <p className="ra-card-sub">{sub}</p>}
        </div>
      </div>
      {children && <div className="rej-header-actions">{children}</div>}
    </div>
  );
}

/** Horizontal share bars used in the drill-down panel. */
export function ShareList({ title, rows, total, empty = "None" }) {
  return (
    <div className="dqt-block">
      <div className="dqt-block-title">{title}</div>
      {!rows.length ? <div className="dqt-muted">{empty}</div> : rows.map((r) => (
        <div key={r.label} className="dqt-row" title={`${r.label}: ${fmtInt(r.value)} (${fmtPct(pctOf(r.value, total))})`}>
          <span className="dqt-row-label"><i style={{ background: r.color || OTHER }} />{r.label}</span>
          <span className="dqt-row-bar"><b style={{ width: `${Math.max(2, pctOf(r.value, total) || 0)}%`, background: r.color || OTHER }} /></span>
          <span className="dqt-row-val">{fmtInt(r.value)} <em>{fmtPct(pctOf(r.value, total))}</em></span>
        </div>
      ))}
    </div>
  );
}
