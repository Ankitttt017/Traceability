import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Activity, Clock3, BarChart3 } from 'lucide-react';

const SummaryCard = ({ label, value, icon: Icon, colorClass, subValue }) => (
  <div className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
    <div className="flex items-start justify-between mb-3">
      <div className={`p-2 rounded-lg ${colorClass} bg-opacity-10`}>
        <Icon size={18} className={colorClass.replace('bg-', 'text-')} />
      </div>
      {subValue && (
        <span className="text-[10px] font-bold text-text-muted bg-bg-dark px-2 py-0.5 rounded border border-border">
          {subValue}
        </span>
      )}
    </div>
    <div className="space-y-1">
      <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">{label}</p>
      <h3 className="text-2xl font-black text-text-main tracking-tight font-mono">{value}</h3>
    </div>
  </div>
);

const ReportSummaryCards = ({ metrics = {} }) => {
  const cards = [
    {
      label: "Total Production",
      value: metrics.totalProduction || 0,
      icon: Activity,
      colorClass: "bg-primary",
      subValue: "Actual Units"
    },
    {
      label: "Total OK",
      value: metrics.totalOK || 0,
      icon: CheckCircle2,
      colorClass: "bg-green-500",
      subValue: "Passed"
    },
    {
      label: "Total NG",
      value: metrics.totalNG || 0,
      icon: XCircle,
      colorClass: "bg-red-500",
      subValue: "Process Fail"
    },
    {
      label: "In Progress",
      value: metrics.inProgress || 0,
      icon: Clock3,
      colorClass: "bg-orange-500",
      subValue: "Running"
    },
    {
      label: "Validation Rejects",
      value: metrics.validationRejects || 0,
      icon: AlertTriangle,
      colorClass: "bg-amber-500",
      subValue: "Audit Blocks"
    },
    {
      label: "Overall Pass Rate",
      value: `${metrics.passRate || 0}%`,
      icon: BarChart3,
      colorClass: "bg-teal-500",
      subValue: "Quality %"
    }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      {cards.map((card, i) => <SummaryCard key={i} {...card} />)}
    </div>
  );
};

export default ReportSummaryCards;
