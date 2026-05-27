import React from 'react';
import { Download, FileSpreadsheet, FileText, ShieldCheck } from 'lucide-react';

const ExportButtons = ({ onExport, loading }) => {
  const exportTypes = [
    { 
      id: 'full', 
      label: 'Full Production Log', 
      icon: FileSpreadsheet, 
      desc: 'Complete history with metrics',
      color: 'primary'
    },
    { 
      id: 'ng', 
      label: 'NG Audit Report', 
      icon: FileText, 
      desc: 'Focus on actual failures',
      color: 'red-500'
    },
    { 
      id: 'parts', 
      label: 'Part Journey Map', 
      icon: Download, 
      desc: 'Unique part lifecycle',
      color: 'amber-500'
    },
    { 
      id: 'audit', 
      label: 'Quality Conformance', 
      icon: ShieldCheck, 
      desc: 'Audit-ready summary',
      color: 'teal-500'
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {exportTypes.map((type) => (
        <button
          key={type.id}
          disabled={loading}
          onClick={() => onExport(type.id)}
          className="bg-bg-card border border-border rounded-xl p-4 flex items-center gap-4 hover:border-primary/40 hover:bg-primary/5 transition-all group active:scale-[0.98]"
        >
          <div className={`p-3 rounded-lg bg-${type.color}/10 text-${type.color} group-hover:scale-110 transition-transform`}>
            <type.icon size={20} />
          </div>
          <div className="text-left">
            <p className="text-xs font-bold text-text-main uppercase tracking-wider">{type.label}</p>
            <p className="text-[10px] text-text-muted mt-0.5">{type.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
};

export default ExportButtons;
