import React from "react";
import { STATUS_COLOR, fmtPct } from "./mgmtTheme";

/** Horizontal rate bar with a target marker. status colours the fill (status vs target). */
export default function RateBar({ value, target, max, status = "none", showValue = true }) {
  const v = Number(value);
  const ok = value !== null && value !== undefined && Number.isFinite(v);
  const m = Math.max(Number(max) || 0, (Number(target) || 0) * 1.5, ok ? v : 0, 0.0001);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div className="mg-ratebar" style={{ flex: 1 }} title={target != null ? `Target ${fmtPct(target, 1)}` : undefined}>
        {ok && <i style={{ width: `${Math.min(100, (v / m) * 100)}%`, background: STATUS_COLOR[status] || STATUS_COLOR.none }} />}
        {target != null && <b style={{ left: `calc(${Math.min(100, (target / m) * 100)}% - 1px)` }} />}
      </div>
      {showValue && (
        <span className="mg-num" style={{ minWidth: 50, textAlign: "right", fontWeight: 700, color: STATUS_COLOR[status] || "#334155" }}>
          {ok ? fmtPct(v, 1) : "—"}
        </span>
      )}
    </div>
  );
}
