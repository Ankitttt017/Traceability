import React from "react";
import { STATUS_COLOR, TARGETS, statusLowerBetter } from "./mgmtTheme";

/**
 * Quality-gate speedometer (inline SVG): a 180° dial with green / amber / red zones from the plant targets
 * (≤ target green, ≤ target + amber band amber, above red), a needle at the value and the value in the
 * status colour. The same dial at every size so the overall gate and the station gates read alike.
 *
 * value: NG % (lower is better); target: green limit (default TARGETS.scrapPct); band: amber width (pp)
 * max: dial end (at least 2 × the red limit, and above the value); size: "sm" | "lg"; label: under the value
 */
const STATUS_TEXT = { good: "On target", warn: "Near limit", bad: "Above limit", none: "No data" };

export default function QualityGauge({
  value, target = TARGETS.scrapPct, band = TARGETS.amberBandPp, max, size = "sm", label = "NG %", decimals = 1, ariaLabel,
}) {
  const has = value !== null && value !== undefined && Number.isFinite(Number(value));
  const v = has ? Math.max(0, Number(value)) : 0;
  const red = target + band;
  const end = Math.max(max || 0, Math.ceil(red * 2), Math.ceil(v * 1.15));
  const status = has ? statusLowerBetter(v, target, band) : "none";
  const color = STATUS_COLOR[status];

  const lg = size === "lg";
  const W = lg ? 220 : 150;
  const cx = W / 2;
  const r = lg ? 86 : 58;
  const sw = lg ? 14 : 10;
  const cy = r + sw / 2 + (lg ? 18 : 13);
  const H = cy + (lg ? 50 : 36);
  const ang = (x) => Math.PI * (1 - Math.min(1, Math.max(0, x / end))); // 0 → left (π), end → right (0)
  const pt = (a, rr) => [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  const arc = (from, to, rr = r) => {
    const [x1, y1] = pt(ang(from), rr);
    const [x2, y2] = pt(ang(to), rr);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rr} ${rr} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const zones = [
    { from: 0, to: Math.min(target, end), c: STATUS_COLOR.good },
    { from: Math.min(target, end), to: Math.min(red, end), c: STATUS_COLOR.warn },
    { from: Math.min(red, end), to: end, c: STATUS_COLOR.bad },
  ].filter((z) => z.to > z.from);
  const needleA = ang(v);
  const [nx, ny] = pt(needleA, r - sw / 2 - (lg ? 6 : 4));
  const ticks = lg ? [0, target, red, end] : [0, end];
  const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ maxWidth: W, display: "block", margin: "0 auto", overflow: "visible" }}
      role="img"
      aria-label={ariaLabel || `${label} ${has ? `${v.toFixed(decimals)}%` : "no data"} — ${STATUS_TEXT[status]}`}
    >
      {/* zone track (soft) + zone ticks */}
      {zones.map((z) => <path key={z.c} d={arc(z.from, z.to)} fill="none" stroke={z.c} strokeOpacity="0.2" strokeWidth={sw} />)}
      {/* value arc */}
      {has && v > 0 && <path d={arc(0, Math.min(v, end))} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="butt" />}
      {/* thin zone ring inside the dial */}
      {zones.map((z) => <path key={`i${z.c}`} d={arc(z.from, z.to, r - sw / 2 - 3)} fill="none" stroke={z.c} strokeWidth={lg ? 2.5 : 2} />)}
      {ticks.map((t) => {
        const a = ang(t);
        const [x1, y1] = pt(a, r + sw / 2 + 1);
        const [x2, y2] = pt(a, r + sw / 2 + (lg ? 6 : 4));
        const [lx, ly] = pt(a, r + sw / 2 + (lg ? 15 : 11));
        return (
          <g key={t}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="1.2" />
            <text x={lx} y={ly + 3} textAnchor="middle" fontSize={lg ? 10 : 8.5} fontWeight="600" fill="#64748b">{fmt(t)}</text>
          </g>
        );
      })}
      {/* needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#0f172a" strokeWidth={lg ? 3 : 2.2} strokeLinecap="round" style={{ transition: "all .5s ease" }} />
      <circle cx={cx} cy={cy} r={lg ? 7 : 5} fill="#0f172a" />
      <circle cx={cx} cy={cy} r={lg ? 3 : 2} fill={color} />
      {/* value */}
      <text x={cx} y={cy + (lg ? 32 : 23)} textAnchor="middle" fontSize={lg ? 26 : 17} fontWeight="800" fill={has ? color : "#94a3b8"} style={{ fontVariantNumeric: "tabular-nums" }}>
        {has ? `${v.toFixed(decimals)}%` : "—"}
      </text>
      <text x={cx} y={cy + (lg ? 46 : 34)} textAnchor="middle" fontSize={lg ? 10.5 : 8.5} fontWeight="700" fill="#475569" letterSpacing=".06em">{label.toUpperCase()}</text>
    </svg>
  );
}

