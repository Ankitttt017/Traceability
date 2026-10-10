import React, { useMemo } from "react";
import { SLATE, alpha, fmtInt } from "./mgmtTheme";

/**
 * Count matrix (rows × columns). Each cell is tinted in its column's colour, darker = more.
 * rows: [{ key, label, sub?, badge?, values: { [colKey]: number } }]
 * cols: [{ key, label, color, title? }]
 */
export default function HeatMatrix({ rows = [], cols = [], rowHeader = "Station", showTotals = true }) {
  const { max, colTotals, grand } = useMemo(() => {
    let m = 0;
    const ct = {};
    let g = 0;
    rows.forEach((r) => cols.forEach((c) => {
      const v = Number(r.values?.[c.key]) || 0;
      m = Math.max(m, v);
      ct[c.key] = (ct[c.key] || 0) + v;
      g += v;
    }));
    return { max: m, colTotals: ct, grand: g };
  }, [rows, cols]);

  return (
    <div className="mg-table-wrap">
      <table className="mg-table mg-matrix">
        <thead>
          <tr>
            <th>{rowHeader}</th>
            {cols.map((c) => (
              <th key={c.key} className="r" style={{ textAlign: "center" }} title={c.title}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <i style={{ width: 10, height: 10, borderRadius: 3, background: c.color, display: "inline-block" }} />{c.label}
                </span>
              </th>
            ))}
            {showTotals && <th className="r">Total</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tot = cols.reduce((a, c) => a + (Number(r.values?.[c.key]) || 0), 0);
            return (
              <tr key={r.key}>
                <td>
                  <div className="strong" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{r.label}{r.badge}</div>
                  {r.sub && <div style={{ fontSize: 11.5, color: SLATE[500] }}>{r.sub}</div>}
                </td>
                {cols.map((c) => {
                  const v = Number(r.values?.[c.key]) || 0;
                  const t = max > 0 ? Math.sqrt(v / max) : 0;
                  return (
                    <td
                      key={c.key}
                      className="cell"
                      title={`${r.label} · ${c.label}: ${fmtInt(v)}`}
                      style={{ background: v > 0 ? alpha(c.color, 0.1 + t * 0.75) : SLATE[50], color: v > 0 ? (t > 0.55 ? "#fff" : SLATE[900]) : SLATE[300] }}
                    >
                      {v > 0 ? fmtInt(v) : "·"}
                    </td>
                  );
                })}
                {showTotals && <td className="r strong">{fmtInt(tot)}</td>}
              </tr>
            );
          })}
        </tbody>
        {showTotals && (
          <tfoot>
            <tr>
              <td className="strong" style={{ borderTop: `1px solid ${SLATE[200]}` }}>Total</td>
              {cols.map((c) => (
                <td key={c.key} className="r strong" style={{ textAlign: "center", borderTop: `1px solid ${SLATE[200]}` }}>{fmtInt(colTotals[c.key] || 0)}</td>
              ))}
              <td className="r strong" style={{ borderTop: `1px solid ${SLATE[200]}` }}>{fmtInt(grand)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
