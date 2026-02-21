import { useEffect } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info } from "lucide-react";

const stylesByType = {
  SUCCESS: {
    container: "bg-accent/15 border-accent/40 text-accent",
    icon: CheckCircle,
  },
  ERROR: {
    container: "bg-danger/15 border-danger/40 text-danger",
    icon: XCircle,
  },
  WARNING: {
    container: "bg-warning/15 border-warning/40 text-warning",
    icon: AlertTriangle,
  },
  INFO: {
    container: "bg-primary/15 border-primary/40 text-primary",
    icon: Info,
  },
};

const GlobalPopup = ({ popup, onClose }) => {
  useEffect(() => {
    if (!popup) {
      return undefined;
    }
    const timer = setTimeout(() => {
      onClose?.();
    }, 3000);
    return () => clearTimeout(timer);
  }, [popup, onClose]);

  if (!popup) {
    return null;
  }

  const type = String(popup.type || "INFO").toUpperCase();
  const meta = stylesByType[type] || stylesByType.INFO;
  const Icon = meta.icon;

  return (
    <div className="fixed top-6 right-6 z-[1000] max-w-sm w-full">
      <div className={`border rounded-xl p-4 shadow-2xl backdrop-blur-lg ${meta.container}`}>
        <div className="flex items-start gap-3">
          <Icon size={20} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-bold text-sm">{popup.title || type}</p>
            <p className="text-sm mt-1 break-words text-text-main">{popup.message}</p>
            {(popup.partId || popup.stationNo || popup.machineName) && (
              <p className="text-xs mt-2 text-text-muted">
                {popup.partId ? `Part: ${popup.partId}` : ""}
                {popup.partId && popup.stationNo ? " | " : ""}
                {popup.stationNo ? `Station: ${popup.stationNo}` : ""}
                {popup.machineName ? ` | Machine: ${popup.machineName}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalPopup;
