import { useEffect } from "react";
import { CheckCircle, X, XCircle, AlertTriangle, Info, ShieldCheck, Cpu } from "lucide-react";

const GlobalPopup = ({ popup, onClose }) => {
  // We keep the auto-close for SUCCESS, but stay open for ERROR to ensure operator sees it
  useEffect(() => {
    if (!popup || popup.type === "ERROR") return;
    const timer = setTimeout(() => onClose?.(), 4000);
    return () => clearTimeout(timer);
  }, [popup, onClose]);

  if (!popup) return null;

  const type = String(popup.type || "INFO").toUpperCase();
  const isSuccess = type === "SUCCESS";
  const isError = type === "ERROR";

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in zoom-in duration-200">
        
        {/* Header - Industrial Color Coded */}
        <div className={`p-6 flex items-center gap-4 text-white ${
          isSuccess ? "bg-emerald-600" : isError ? "bg-red-600" : "bg-amber-500"
        }`}>
          {isSuccess ? <ShieldCheck size={40} /> : <AlertTriangle size={40} />}
          <div>
            <h2 className="text-2xl font-black uppercase italic tracking-tighter leading-none">
              {popup.title || type}
            </h2>
            <p className="text-xs font-bold opacity-80 mt-1 uppercase tracking-widest">
              Station: {popup.stationNo || "System Process"}
            </p>
          </div>
        </div>

        <div className="p-8 space-y-6">
          {/* Scanned ID Section */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Cpu size={14} />
              <span className="text-[10px] font-black uppercase tracking-widest">Component Identity</span>
            </div>
            <p className="text-xl font-mono font-bold text-slate-800 break-all">
              {popup.partId || "NO DATA DETECTED"}
            </p>
          </div>

          {/* Checklist */}
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-600 font-bold uppercase text-xs">QR Validation</span>
              {isSuccess ? <CheckCircle size={20} className="text-emerald-500" /> : <XCircle size={20} className="text-red-500" />}
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-600 font-bold uppercase text-xs">Sequence Check</span>
              <CheckCircle size={20} className="text-emerald-500" />
            </div>
          </div>

          {/* Message Area */}
          <div>
             <p className={`text-lg font-bold ${isError ? "text-red-600" : "text-slate-700"}`}>
               {popup.message}
             </p>
          </div>

          <button
            onClick={() => onClose?.()}
            className="w-full bg-slate-900 text-white py-4 rounded-xl font-black uppercase tracking-widest hover:bg-black transition-all active:scale-95"
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};

export default GlobalPopup;