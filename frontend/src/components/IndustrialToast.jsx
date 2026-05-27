import React from 'react';
import { 
  CheckCircle2, XCircle, AlertTriangle, 
  Info, ShieldAlert, WifiOff, X 
} from 'lucide-react';

const TOAST_VARIANTS = {
  SUCCESS: {
    bg: 'rgba(22, 163, 74, 0.05)',
    border: '#16a34a',
    color: '#15803d',
    icon: <CheckCircle2 size={18} />,
    title: 'SUCCESS'
  },
  ERROR: {
    bg: 'rgba(220, 38, 38, 0.05)',
    border: '#dc2626',
    color: '#b91c1c',
    icon: <XCircle size={18} />,
    title: 'ERROR'
  },
  WARNING: {
    bg: 'rgba(217, 119, 6, 0.05)',
    border: '#d97706',
    color: '#b45309',
    icon: <AlertTriangle size={18} />,
    title: 'WARNING'
  },
  INFO: {
    bg: 'rgba(37, 99, 235, 0.05)',
    border: '#2563eb',
    color: '#1d4ed8',
    icon: <Info size={18} />,
    title: 'INFORMATION'
  },
  BLOCKED: {
    bg: 'rgba(71, 85, 105, 0.05)',
    border: '#475569',
    color: '#334155',
    icon: <ShieldAlert size={18} />,
    title: 'SYSTEM BLOCKED'
  },
  PLC_ERROR: {
    bg: 'rgba(153, 27, 27, 0.05)',
    border: '#991b1b',
    color: '#7f1d1d',
    icon: <WifiOff size={18} />,
    title: 'PLC COMM ERROR'
  }
};

export default function IndustrialToast({ 
  type = 'INFO', 
  message, 
  detail, 
  onClose,
  id 
}) {
  const variant = TOAST_VARIANTS[type.toUpperCase()] || TOAST_VARIANTS.INFO;

  return (
    <div 
      id={`toast-${id}`}
      style={{
        width: '100%',
        maxWidth: 380,
        background: '#ffffff',
        borderLeft: `5px solid ${variant.border}`,
        borderRadius: 8,
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        padding: '16px',
        display: 'flex',
        gap: '12px',
        position: 'relative',
        animation: 'slideIn 0.3s ease-out forwards',
        pointerEvents: 'auto'
      }}
    >
      <div style={{ color: variant.border, marginTop: '2px' }}>
        {variant.icon}
      </div>
      
      <div style={{ flex: 1 }}>
        <div style={{ 
          fontSize: '11px', 
          fontWeight: 800, 
          color: variant.color, 
          letterSpacing: '0.05em',
          marginBottom: '2px'
        }}>
          {variant.title}
        </div>
        <div style={{ 
          fontSize: '14px', 
          fontWeight: 700, 
          color: '#1e293b',
          lineHeight: 1.4
        }}>
          {message}
        </div>
        {detail && (
          <div style={{ 
            fontSize: '12px', 
            color: '#64748b', 
            marginTop: '4px',
            lineHeight: 1.5
          }}>
            {detail}
          </div>
        )}
      </div>

      <button 
        onClick={onClose}
        style={{
          border: 'none',
          background: 'transparent',
          color: '#94a3b8',
          cursor: 'pointer',
          padding: '4px',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'flex-start',
          transition: 'all 0.2s'
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <X size={14} />
      </button>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
