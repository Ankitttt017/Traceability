import React from 'react';
import { CheckCircle2, XCircle, Activity, Clock3, Gauge, CircleSlash } from 'lucide-react';

const SummaryCardSkeleton = () => (
  <div className="relative min-h-[108px] overflow-hidden bg-bg-card border border-border rounded-lg p-3 shadow-sm">
    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    <div className="flex items-start justify-between mb-3">
      <div className="h-8 w-8 rounded-md bg-slate-200" />
      <div className="h-5 w-24 rounded border border-slate-200 bg-slate-100" />
    </div>
    <div className="space-y-2.5">
      <div className="h-3 w-32 rounded bg-slate-200" />
      <div className="h-6 w-16 rounded bg-slate-200" />
    </div>
  </div>
);

const SummaryCard = ({ label, value, icon: Icon, colorClass, subValue }) => (
  <div className="bg-bg-card border border-border rounded-lg p-3 shadow-sm">
    <div className="flex items-start justify-between mb-2">
      <div className={`p-1.5 rounded-md ${colorClass}`}>
        <Icon size={15} className="text-white" strokeWidth={2.7} />
      </div>
      {subValue && (
        <span className="text-[9px] font-black text-text-main bg-bg-dark px-1.5 py-0.5 rounded border border-border">
          {subValue}
        </span>
      )}
    </div>
    <div className="space-y-0.5">
      <p className="text-[9px] font-black text-text-main uppercase tracking-wide">{label}</p>
      <h3 className="text-xl font-black text-text-main tracking-tight font-mono leading-none">{value}</h3>
    </div>
  </div>
);

const ReportSummaryCards = ({ metrics = {}, loading = false }) => {
  const plc = metrics.plcShotSummary || {};
  const traceabilityCards = [
    {
      label: "Traceability Production",
      value: metrics.totalProduction || 0,
      icon: Activity,
      colorClass: "bg-primary",
      subValue: "Parts"
    },
    {
      label: "Traceability OK",
      value: metrics.totalOK || 0,
      icon: CheckCircle2,
      colorClass: "bg-green-500",
      subValue: "Passed"
    },
    {
      label: "Traceability NG",
      value: metrics.totalNG || 0,
      icon: XCircle,
      colorClass: "bg-red-500",
      subValue: "Failed"
    },
    {
      label: "In Progress",
      value: metrics.inProgress || 0,
      icon: Clock3,
      colorClass: "bg-orange-500",
      subValue: "Running"
    }
  ];

  const shotCards = [
    {
      label: "Total Shot",
      value: plc.totalProduction ?? 0,
      icon: Activity,
      colorClass: "bg-primary",
      subValue: "HPDC Machine Shots"
    },
    {
      label: "OK Shot",
      value: plc.okShot ?? 0,
      icon: CheckCircle2,
      colorClass: "bg-green-500",
      subValue: "Status"
    },
    {
      label: "Warm Up Shot",
      value: plc.warmUpShot ?? 0,
      icon: Gauge,
      colorClass: "bg-red-500",
      subValue: "NG Status"
    },
    {
      label: "Off Shot",
      value: plc.offShot ?? 0,
      icon: CircleSlash,
      colorClass: "bg-red-500",
      subValue: "Status "
    }
  ];

  return (
    <div className="space-y-3 mb-5">
      {loading ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {shotCards.map((_, i) => <SummaryCardSkeleton key={`shot-skeleton-${i}`} />)}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {traceabilityCards.map((_, i) => <SummaryCardSkeleton key={`trace-skeleton-${i}`} />)}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {shotCards.map((card, i) => <SummaryCard key={`shot-${i}`} {...card} />)}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {traceabilityCards.map((card, i) => <SummaryCard key={`trace-${i}`} {...card} />)}
          </div>
        </>
      )}
    </div>
  );
};

export default ReportSummaryCards;
