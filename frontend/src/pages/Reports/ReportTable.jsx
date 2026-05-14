import React from 'react';
import { Activity } from 'lucide-react';
import { formatIndustrial } from '../../utils/time';

const StatusChip = ({ status }) => {
  const baseCls = "px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border";
  
  if (status === "OK") {
    return <span className={`${baseCls} bg-green-500/10 text-green-500 border-green-500/20`}>OK</span>;
  }
  if (status === "NG") {
    return <span className={`${baseCls} bg-red-500/10 text-red-500 border-red-500/20`}>NG</span>;
  }
  if (status === "IN PROGRESS") {
    return <span className={`${baseCls} bg-blue-500/10 text-blue-500 border-blue-500/20`}>WIP</span>;
  }
  return <span className={`${baseCls} bg-amber-500/10 text-amber-500 border-amber-500/20`}>{status}</span>;
};

const ReportTable = ({ rows = [], loading }) => {
  if (loading) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-20 flex flex-col items-center justify-center space-y-4">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Processing Industrial Dataset...</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-20 flex flex-col items-center justify-center space-y-4 text-center">
        <div className="p-4 bg-bg-dark rounded-full">
          <Activity size={32} className="text-text-muted/30" />
        </div>
        <div>
          <p className="text-sm font-bold text-text-main">No production records found</p>
          <p className="text-xs text-text-muted mt-1">Adjust your filters to see historical data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-bg-dark/50 border-b border-border">
              {[
                "SR NO", "Part Serial No", "Timestamp", "Shift", "Operation No", 
                "Machine Name", "Model Code", "Model Name", "Result", 
                "Reason", "Cycle Time (s)", "Line No"
              ].map(h => (
                <th key={h} className="px-6 py-4 text-[10px] font-black text-text-muted uppercase tracking-widest whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-primary/5 transition-colors group">
                <td className="px-6 py-4 text-[11px] font-bold text-text-muted">
                  {i + 1}
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs font-bold text-text-main font-mono tracking-tight group-hover:text-primary transition-colors">
                    {row.partId}
                  </span>
                </td>
                <td className="px-6 py-4 text-[11px] text-text-muted font-mono">
                  {formatIndustrial(row.createdAt)}
                </td>
                <td className="px-6 py-4 text-[11px] font-bold text-text-main">
                  {row.shiftCode || 'A'}
                </td>
                <td className="px-6 py-4 text-[11px] text-text-muted">
                  {row.operationNo}
                </td>
                <td className="px-6 py-4 text-[11px] font-bold text-text-main">
                  {row.machineName}
                </td>
                <td className="px-6 py-4 text-[11px] text-text-muted">
                  {row.modelCode}
                </td>
                <td className="px-6 py-4 text-[11px] text-text-muted">
                  {row.qrFormatName}
                </td>
                <td className="px-6 py-4">
                  <StatusChip status={row.industrialResult || "UNKNOWN"} />
                </td>
                <td className="px-6 py-4 text-[11px] text-red-500/80 italic max-w-[200px] truncate" title={row.interlock_reason}>
                  {row.interlock_reason || '-'}
                </td>
                <td className="px-6 py-4 text-[11px] font-mono text-text-main">
                  {row.cycleTime || '0.00'}
                </td>
                <td className="px-6 py-4 text-[11px] font-bold text-text-muted">
                  {row.lineName}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div className="px-6 py-4 bg-bg-dark/20 border-t border-border flex items-center justify-between">
        <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
          Displaying {rows.length} records · Production Traceability Engine
        </p>
      </div>
    </div>
  );
};

export default ReportTable;
