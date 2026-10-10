import React from "react";
import InfoTip from "../../pages/Rejection/components/InfoTip";
import StatusPill from "./StatusPill";
import Sparkline from "./Sparkline";
import Skeleton from "./Skeleton";
import { STATUS_COLOR } from "./mgmtTheme";

/**
 * One headline number.
 * props: label, value (string), unit, status (good|warn|bad|none → coloured edge + pill), target (text),
 *        delta (text, e.g. "+3.9 pp vs target"), sub (one muted line), spark (number[]), sparkTarget,
 *        info ({ what, formula, note }), loading, children (custom visual, e.g. a split bar)
 *        change ({ text, tone: good|bad|neutral, label, title }) — change vs the previous period, e.g. "▲ 4.2%" "vs previous 7 days"
 */
const CHANGE_COLOR = { good: STATUS_COLOR.good, bad: STATUS_COLOR.bad, neutral: "#475569" };

export default function KpiTile({
  label, value, unit, status, target, delta, sub, spark, sparkTarget = null, sparkColor, info, loading, children, valueColor, valueSize, change,
}) {
  const hasStatus = status && status !== "none";
  return (
    <div
      className="mg-kpi"
      data-status={hasStatus ? status : undefined}
      style={hasStatus ? { "--mg-status": STATUS_COLOR[status] } : undefined}
      aria-busy={loading || undefined}
    >
      <div className="mg-kpi-label">
        <span style={{ lineHeight: 1.25 }}>{label}</span>
        {info && <InfoTip info={{ title: label, ...info }} label={`Definition: ${label}`} />}
      </div>
      {loading ? (
        <>
          <Skeleton height={32} width="70%" />
          <Skeleton height={12} width="85%" />
        </>
      ) : (
        <>
          <div className="mg-kpi-value" style={{ ...(valueColor ? { color: valueColor } : hasStatus ? { color: STATUS_COLOR[status] } : {}), ...(valueSize ? { fontSize: valueSize, lineHeight: "32px" } : {}) }}>
            {value}
            {unit && <small>{unit}</small>}
          </div>
          {(hasStatus || target || delta) && (
            <div className="mg-kpi-meta">
              {hasStatus && <StatusPill status={status} size="sm" />}
              {target && <span style={{ color: "#64748b" }}>Target {target}</span>}
              {delta && <span style={{ fontWeight: 700, color: hasStatus ? STATUS_COLOR[status] : "#334155" }}>{delta}</span>}
            </div>
          )}
          {change && change.text && (
            <div className="mg-kpi-change" title={change.title}>
              <b style={{ color: CHANGE_COLOR[change.tone] || CHANGE_COLOR.neutral }}>{change.text}</b>
              {change.label && <span>{change.label}</span>}
            </div>
          )}
          {sub && <div className="mg-kpi-sub">{sub}</div>}
          {children}
          {Array.isArray(spark) && spark.length > 1 && (
            <div className="mg-kpi-spark">
              <Sparkline values={spark} target={sparkTarget} color={sparkColor} ariaLabel={`${label} trend`} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
