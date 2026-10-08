import React from "react";

// ── Station Speedometer SVG Gauge Component ─────────────────────────────────
const StationSpeedometer = React.memo(({
  value = 0,
  max = 20,
  size = "compact", // "compact" (pipeline card) | "featured" (station drawer)
  label = "SCRAP",
  showTicks = true,
  unit = "%",
  showStatusPill = null, // null defaults to false in compact (avoids duplicate badge with card header), true in featured
}) => {
  const numVal = Math.max(0, Number(value) || 0);
  const effectiveMax = Math.max(max, Math.ceil(numVal / 5) * 5, 10);
  const clampedVal = Math.min(effectiveMax, numVal);
  const ratio = clampedVal / effectiveMax; // 0 to 1

  // Color Architecture:
  // When numVal === 0 (Zero Rejection / 100% OK Yield): PURE VIBRANT GREEN (#16a34a)
  // When numVal > 0 (Rejections Present): SCRAP IS RED! Rejection progress arc & value are BOLD CRIMSON RED (#dc2626)!
  const isZeroScrap = numVal === 0;

  let arcColor = "#16a34a";
  let readoutColor = "#16a34a";
  let statusColor = "#16a34a";
  let statusText = "PASS";
  let statusBg = "#dcfce7";
  let statusBorder = "#86efac";
  let statusTextColor = "#15803d";

  if (numVal > 5.0) {
    arcColor = "#dc2626"; // bold crimson red
    readoutColor = "#dc2626";
    statusColor = "#dc2626";
    statusText = "ALERT";
    statusBg = "#fee2e2";
    statusBorder = "#fca5a5";
    statusTextColor = "#991b1b";
  } else if (numVal >= 2.5) {
    arcColor = "#dc2626"; // bold red rejection arc
    readoutColor = "#dc2626";
    statusColor = "#f59e0b";
    statusText = "WATCH";
    statusBg = "#fef3c7";
    statusBorder = "#fcd34d";
    statusTextColor = "#9a3412";
  } else if (!isZeroScrap) {
    // 0 < numVal < 2.5%: Rejection is present! Arc and readout MUST be bold red to highlight rejections
    arcColor = "#dc2626"; // bold red scrap arc
    readoutColor = "#dc2626";
    statusColor = "#16a34a";
    statusText = "PASS";
    statusBg = "#f0fdf4";
    statusBorder = "#bbf7d0";
    statusTextColor = "#166534";
  }

  const isCompact = size === "compact";
  const shouldShowPill = showStatusPill !== null ? showStatusPill : !isCompact;

  const width = isCompact ? 164 : 240;
  const height = isCompact ? 92 : 145;
  const cx = width / 2;
  const cy = isCompact ? 72 : 112;
  const r = isCompact ? 56 : 84;
  const strokeWidth = isCompact ? 10 : 14;
  const needleLen = isCompact ? 42 : 64;

  const needleDeg = -90 + ratio * 180;

  const describeArc = (startDeg, endDeg) => {
    const sRad = (startDeg * Math.PI) / 180;
    const eRad = (endDeg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(sRad);
    const y1 = cy - r * Math.sin(sRad);
    const x2 = cx + r * Math.cos(eRad);
    const y2 = cy - r * Math.sin(eRad);
    const largeArc = Math.abs(startDeg - endDeg) > 180 ? 1 : 0;
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };

  const tickSteps = [0, 0.25, 0.5, 0.75, 1];
  const ticks = tickSteps.map((pct) => {
    const deg = 180 - pct * 180;
    const rad = (deg * Math.PI) / 180;
    const innerR = r - (isCompact ? 5 : 7);
    const outerR = r + (isCompact ? 5 : 7);
    return {
      x1: cx + innerR * Math.cos(rad),
      y1: cy - innerR * Math.sin(rad),
      x2: cx + outerR * Math.cos(rad),
      y2: cy - outerR * Math.sin(rad),
      labelX: cx + (r - (isCompact ? 14 : 18)) * Math.cos(rad),
      labelY: cy - (r - (isCompact ? 14 : 18)) * Math.sin(rad),
      label: (pct * effectiveMax).toFixed(0),
      pct,
    };
  });

  return (
    <div
      className={`rej-speedometer-root ${isCompact ? "compact" : "featured"}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative",
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ overflow: "visible", display: "block" }}
      >
        <defs>
          <filter id={`speedo-shadow-${isCompact ? 'c' : 'f'}`} x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* Outer Background Track Arc */}
        <path
          d={describeArc(180, 0)}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Value Rejection Arc */}
        {ratio > 0.005 && (
          <>
            <path
              d={describeArc(180, 180 - ratio * 180)}
              fill="none"
              stroke={arcColor}
              strokeWidth={strokeWidth + 4}
              strokeOpacity="0.22"
              strokeLinecap="round"
            />
            <path
              d={describeArc(180, 180 - ratio * 180)}
              fill="none"
              stroke={arcColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          </>
        )}

        {/* Clean Instrument Tick lines */}
        {showTicks && ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1.toFixed(1)}
            y1={t.y1.toFixed(1)}
            x2={t.x2.toFixed(1)}
            y2={t.y2.toFixed(1)}
            stroke="#475569"
            strokeWidth={isCompact ? "1.4" : "1.8"}
          />
        ))}

        {/* Min / Max Range Markers on Arc Base */}
        <text
          x={(cx - r + (isCompact ? 4 : 6)).toFixed(1)}
          y={(cy + (isCompact ? 13 : 17)).toFixed(1)}
          textAnchor="middle"
          fontSize={isCompact ? "8" : "10"}
          fontWeight="750"
          fill="#64748b"
        >
          0
        </text>
        <text
          x={(cx + r - (isCompact ? 4 : 6)).toFixed(1)}
          y={(cy + (isCompact ? 13 : 17)).toFixed(1)}
          textAnchor="middle"
          fontSize={isCompact ? "8" : "10"}
          fontWeight="750"
          fill="#64748b"
        >
          {effectiveMax}
        </text>

        {/* Featured Size Intermediate Numeric Tick Labels */}
        {!isCompact && ticks.filter(t => t.pct > 0 && t.pct < 1).map((t, i) => (
          <text
            key={`lbl-${i}`}
            x={t.labelX.toFixed(1)}
            y={(t.labelY + 3).toFixed(1)}
            textAnchor="middle"
            fontSize="10"
            fontWeight="750"
            fill="#475569"
          >
            {t.label}
          </text>
        ))}

        {/* High-Contrast Instrument Needle */}
        <g
          style={{
            transform: `rotate(${needleDeg}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            transition: "transform 0.65s cubic-bezier(0.34, 1.4, 0.64, 1)",
          }}
        >
          <polygon
            points={`${cx - (isCompact ? 2.5 : 3.5)},${cy} ${cx + (isCompact ? 2.5 : 3.5)},${cy} ${cx},${cy - needleLen}`}
            fill="#0f172a"
          />
          <polygon
            points={`${cx - (isCompact ? 1.4 : 2)},${cy - needleLen * 0.55} ${cx + (isCompact ? 1.4 : 2)},${cy - needleLen * 0.55} ${cx},${cy - needleLen}`}
            fill={arcColor}
          />
        </g>

        {/* Pivot Center Pin Hub */}
        <circle cx={cx} cy={cy} r={isCompact ? 5.5 : 7} fill="#0f172a" stroke="#ffffff" strokeWidth={isCompact ? "1.5" : "2"} />
        <circle cx={cx} cy={cy} r={isCompact ? 2.5 : 3} fill={arcColor} />

        {/* Bold Central Numeric Value Readout */}
        <text
          x={cx}
          y={isCompact ? 44 : 76}
          textAnchor="middle"
          fontSize={isCompact ? "16" : "25"}
          fontWeight="900"
          fill={readoutColor}
          fontFamily="'Inter', -apple-system, sans-serif"
        >
          {numVal.toFixed(1)}{unit}
        </text>

        {/* Sub-label under value */}
        <text
          x={cx}
          y={isCompact ? 58 : 94}
          textAnchor="middle"
          fontSize={isCompact ? "8.5" : "10.5"}
          fontWeight="800"
          fill="#475569"
          letterSpacing="0.06em"
        >
          {label}
        </text>
      </svg>

      {/* Bold Status Pill Badge */}
      {shouldShowPill && (
        <div
          className="rej-speedo-status-pill"
          style={{
            marginTop: isCompact ? -2 : 4,
            padding: isCompact ? "1px 8px" : "3px 12px",
            borderRadius: 99,
            background: statusBg,
            border: `1px solid ${statusBorder}`,
            color: statusTextColor,
            fontSize: isCompact ? 9 : 11,
            fontWeight: 800,
            letterSpacing: "0.04em",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span
            className="rej-speedo-dot"
            style={{
              background: statusColor,
              boxShadow: `0 0 6px ${statusColor}`,
            }}
          />
          <span>{statusText}</span>
        </div>
      )}
    </div>
  );
});

export default StationSpeedometer;