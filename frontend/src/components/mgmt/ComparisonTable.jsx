import React from "react";

/**
 * Compact comparison table (die, shift, line …).
 * columns: [{ key, label, align?: "left"|"right", width?, render?: (row) => node, title? }]
 * rows: object[]; rowKey: field name
 */
export default function ComparisonTable({ columns = [], rows = [], rowKey = "key", caption }) {
  return (
    <div className="mg-table-wrap">
      <table className="mg-table">
        {caption && <caption style={{ textAlign: "left", fontSize: 12, color: "#64748b", padding: "0 0 6px" }}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "r" : undefined} style={{ width: c.width, textAlign: c.align === "right" ? "right" : "left" }} title={c.title}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[rowKey]}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === "right" ? "r" : undefined}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
