import React from "react";
import { categoryColor, CATEGORY_NAME } from "./mgmtTheme";

/** Defect category chip (CR / CRAM / MR) in its fixed colour. */
export default function CategoryChip({ category, count, showName = false }) {
  const key = String(category || "").toUpperCase() || "OTHER";
  const c = categoryColor(key);
  return (
    <span className="mg-chip" title={CATEGORY_NAME[key] || key} style={{ color: c, background: `${c}14`, border: `1px solid ${c}40` }}>
      {key === "OTHER" ? "—" : key}
      {showName && CATEGORY_NAME[key] ? <span style={{ fontWeight: 500 }}>· {CATEGORY_NAME[key]}</span> : null}
      {count != null && <span style={{ color: "#0f172a" }}>{Number(count).toLocaleString("en-IN")}</span>}
    </span>
  );
}
