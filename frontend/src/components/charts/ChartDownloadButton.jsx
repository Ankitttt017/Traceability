import React, { useState } from "react";
import { Download, Check } from "lucide-react";

/** Small icon button; position it inside a `position:relative` host. */
const ChartDownloadButton = ({ onDownload }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="chart-dl-btn"
      title="Download chart as PNG"
      aria-label="Download chart as PNG"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await onDownload(e.currentTarget);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch (err) {
          console.warn("[chart download]", err);
        }
      }}
    >
      <style>{`
        .chart-dl-btn{position:absolute;top:4px;right:4px;z-index:5;width:26px;height:26px;display:grid;place-items:center;border-radius:7px;border:1px solid #e2e8f0;background:rgba(255,255,255,.92);color:#64748b;cursor:pointer;opacity:.6;transition:opacity .15s,color .15s,border-color .15s,box-shadow .15s}
        .chart-dl-host:hover .chart-dl-btn,.chart-dl-btn:focus-visible{opacity:1}
        .chart-dl-btn:hover{color:#1d4ed8;border-color:#93c5fd;box-shadow:0 2px 8px rgba(37,99,235,.18)}
      `}</style>
      {done ? <Check size={14} color="#16a34a" /> : <Download size={14} />}
    </button>
  );
};

export default ChartDownloadButton;
