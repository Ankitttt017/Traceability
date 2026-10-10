import React, { useMemo } from "react";
import { NAVY_3 } from "./mgmtTheme";

/**
 * Tiny trend line (inline SVG, no axes). values: (number|null)[]; optional target draws a dashed reference line.
 */
export default function Sparkline({ values = [], color = NAVY_3, target = null, height = 30, ariaLabel, area = false }) {
  const W = 120;
  const H = height;
  const geo = useMemo(() => {
    const pts = values.map((v, i) => [i, v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null]);
    const nums = pts.map((p) => p[1]).filter((v) => v !== null);
    if (nums.length < 2) return null;
    let min = Math.min(...nums, target ?? Infinity);
    let max = Math.max(...nums, target ?? -Infinity);
    if (max === min) { max += 1; min -= 1; }
    const x = (i) => (values.length > 1 ? (i / (values.length - 1)) * (W - 6) + 3 : W / 2);
    const y = (v) => H - 3 - ((v - min) / (max - min)) * (H - 6);
    let d = "";
    let pen = false;
    pts.forEach(([i, v]) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    const last = [...pts].reverse().find((p) => p[1] !== null);
    const firstX = x(pts.find((p) => p[1] !== null)[0]);
    const fill = area ? `${d}L${x(last[0]).toFixed(1)},${H}L${firstX.toFixed(1)},${H}Z` : null;
    return { d, fill, ty: target !== null ? y(target) : null, lx: x(last[0]), ly: y(last[1]) };
  }, [values, target, H, area]);
  if (!geo) return <div style={{ height: H }} aria-hidden="true" />;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label={ariaLabel || "trend"} style={{ display: "block", overflow: "visible" }}>
      {geo.ty !== null && <line x1="0" x2={W} y1={geo.ty} y2={geo.ty} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      {geo.fill && <path d={geo.fill} fill={color} fillOpacity="0.12" stroke="none" />}
      <path d={geo.d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
