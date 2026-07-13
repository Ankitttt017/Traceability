import React from "react";

const shimmer =
  "relative overflow-hidden bg-slate-200 before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.4s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent";

const PageSkeleton = ({ rows = 6, columns = 5, progress = null, title = "Loading" }) => {
  const pct = progress === null ? null : Math.min(100, Math.max(0, Math.round(Number(progress) || 0)));
  return (
    <div className="bg-bg-card border border-border rounded-xl p-5 shadow-sm">
      <style>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
      `}</style>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className={`${shimmer} h-4 w-44 rounded`} />
          <div className={`${shimmer} h-3 w-28 rounded`} />
        </div>
        {pct !== null && (
          <div className="w-40">
            <div className="mb-1 flex justify-between text-[10px] font-black uppercase tracking-wider text-text-muted">
              <span>{title}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(90px, 1fr))` }}>
            {Array.from({ length: columns }).map((__, colIndex) => (
              <div
                key={colIndex}
                className={`${shimmer} rounded-md ${rowIndex === 0 ? "h-8" : "h-10"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PageSkeleton;
