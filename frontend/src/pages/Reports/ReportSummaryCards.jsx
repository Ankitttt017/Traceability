import React from 'react';
import { CheckCircle2, Activity, Clock3, Gauge, CircleSlash, TrendingUp, AlertCircle, Shield } from 'lucide-react';

const SummaryCardSkeleton = () => (
  <div className="relative min-h-[120px] overflow-hidden bg-[rgb(var(--pk-bg-card))] border border-[rgba(var(--pk-bdr),0.12)] rounded-xl p-4 shadow-sm shadow-[rgba(var(--pk-navy),0.04)]">
    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
    <div className="flex items-start justify-between mb-3">
      <div className="h-11 w-11 rounded-xl bg-[rgba(var(--pk-steel),0.06)] border border-[rgba(var(--pk-bdr),0.06)]" />
      <div className="h-5 w-20 rounded-lg bg-[rgba(var(--pk-steel),0.06)] border border-[rgba(var(--pk-bdr),0.04)]" />
    </div>
    <div className="space-y-2.5">
      <div className="h-3 w-32 rounded-lg bg-[rgba(var(--pk-steel),0.06)]" />
      <div className="h-7 w-20 rounded-lg bg-[rgba(var(--pk-steel),0.08)]" />
    </div>
  </div>
);

const SummaryCard = ({ label, value, icon: Icon, colorClass, subValue, subtitle }) => {
  const colorMap = {
    navy: { bg: 'rgba(26,50,99,0.08)', border: 'rgba(26,50,99,0.15)', text: 'rgb(26,50,99)', light: 'rgba(26,50,99,0.04)' },
    green: { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.2)', text: 'rgb(34,197,94)', light: 'rgba(34,197,94,0.04)' },
    red: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)', text: 'rgb(239,68,68)', light: 'rgba(239,68,68,0.04)' },
    orange: { bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.2)', text: 'rgb(249,115,22)', light: 'rgba(249,115,22,0.04)' },
    amber: { bg: 'rgba(250,185,91,0.12)', border: 'rgba(250,185,91,0.2)', text: 'rgb(250,185,91)', light: 'rgba(250,185,91,0.04)' },
  };
  const styles = colorMap[colorClass] || colorMap.navy;

  return (
    <div className="group relative bg-[rgb(var(--pk-bg-card))] border border-[rgba(var(--pk-bdr),0.12)] rounded-xl p-4 shadow-sm shadow-[rgba(var(--pk-navy),0.04)] hover:shadow-md hover:shadow-[rgba(var(--pk-navy),0.08)] hover:border-[rgba(var(--pk-steel),0.2)] transition-all duration-300 hover:-translate-y-0.5">
      <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[rgba(var(--pk-steel),0.02)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div
            className="p-2.5 rounded-xl transition-all duration-300 group-hover:scale-110 group-hover:shadow-md"
            style={{
              background: styles.bg,
              border: `1px solid ${styles.border}`,
              boxShadow: `0 2px 8px ${styles.light}`,
            }}
          >
            <Icon size={17} style={{ color: styles.text }} strokeWidth={2.5} />
          </div>
          {subValue && (
            <span className="text-[9px] font-extrabold text-[rgb(var(--pk-txt-muted))] bg-[rgba(var(--pk-bdr),0.06)] px-2.5 py-1 rounded-lg border border-[rgba(var(--pk-bdr),0.06)] uppercase tracking-wider">
              {subValue}
            </span>
          )}
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-extrabold text-[rgb(var(--pk-txt-muted))] uppercase tracking-wider">
            {label}
          </p>
          <div className="flex items-end gap-2">
            <h3 className="text-2xl font-black text-[rgb(var(--pk-txt-pri))] tracking-tight font-mono leading-none">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </h3>
            {subtitle && (
              <span className="text-[10px] font-medium text-[rgb(var(--pk-txt-muted))] mb-0.5">
                {subtitle}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ReportSummaryCards = ({ metrics = {}, loading = false, shotSummaryLoading = false }) => {
  const plc = metrics.plcShotSummary || {};
  const totalProduction = metrics.totalProduction ?? 0;
  const totalOK = metrics.totalOK ?? 0;
  const totalNG = metrics.totalNG ?? 0;
  const inProgress = metrics.inProgress ?? 0;

  const shotCards = [
    {
      label: "Total Shots",
      value: plc.totalProduction ?? 0,
      icon: TrendingUp,
      colorClass: "navy",
      subValue: "HPDC Machine",
      subtitle: "shots",
    },
    {
      label: "OK Shots",
      value: plc.okShot ?? 0,
      icon: CheckCircle2,
      colorClass: "green",
      subValue: "Passed",
      subtitle: "shots",
    },
    {
      label: "Warm Up Shots",
      value: plc.warmUpShot ?? 0,
      icon: Gauge,
      colorClass: "amber",
      subValue: "NG Status",
      subtitle: "shots",
    },
    {
      label: "Off Shots",
      value: plc.offShot ?? 0,
      icon: CircleSlash,
      colorClass: "red",
      subValue: "Rejected",
      subtitle: "shots",
    },
  ];

  const traceabilityCards = [
    {
      label: "Total Production",
      value: totalProduction,
      icon: Activity,
      colorClass: "navy",
      subValue: "Scanned Parts",
      subtitle: "parts",
    },
    {
      label: "Passed",
      value: totalOK,
      icon: Shield,
      colorClass: "green",
      subValue: "Quality OK",
      subtitle: "parts",
    },
    {
      label: "Failed",
      value: totalNG,
      icon: AlertCircle,
      colorClass: "red",
      subValue: "Quality NG",
      subtitle: totalNG > 0 ? "Needs review" : "All good",
    },
    {
      label: "In Progress",
      value: inProgress,
      icon: Clock3,
      colorClass: "orange",
      subValue: "Active",
      subtitle: "parts",
    },
  ];

  return (
    <div className="space-y-4 mb-6">
      {loading ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {shotCards.map((_, i) => <SummaryCardSkeleton key={`shot-skeleton-${i}`} />)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {traceabilityCards.map((_, i) => <SummaryCardSkeleton key={`trace-skeleton-${i}`} />)}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <div className="h-4 w-1 rounded-full bg-[rgb(var(--pk-steel))]" />
              <span className="text-[11px] font-extrabold text-[rgb(var(--pk-steel))] uppercase tracking-wider">
                Machine Shot Statistics
              </span>
              <span className="text-[11px] text-[rgb(var(--pk-txt-muted))] font-semibold">
                {plc.totalProduction ? `${plc.totalProduction.toLocaleString()} total shots` : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {shotSummaryLoading 
                ? shotCards.map((_, i) => <SummaryCardSkeleton key={`shot-skeleton-${i}`} />)
                : shotCards.map((card, i) => <SummaryCard key={`shot-${i}`} {...card} />)
              }
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <div className="h-4 w-1 rounded-full bg-[rgb(var(--pk-amber))]" />
              <span className="text-[11px] font-extrabold text-[rgb(var(--pk-steel))] uppercase tracking-wider">
                Production Traceability
              </span>
              <span className="text-[11px] text-[rgb(var(--pk-txt-muted))] font-semibold">
                {totalProduction ? `${totalProduction.toLocaleString()} parts tracked` : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {traceabilityCards.map((card, i) => <SummaryCard key={`trace-${i}`} {...card} />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ReportSummaryCards;
