const ChartTooltip = ({ active, payload, label, labelFormatter, valueFormatter }) => {
  if (!active || !payload?.length) return null;

  const formattedLabel = labelFormatter ? labelFormatter(label) : label;

  return (
    <div className="bg-bg-dark border border-border rounded-xl px-4 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.45)] border-t-2 border-t-primary min-w-[160px]">
      {formattedLabel !== undefined && formattedLabel !== null && (
        <p className="text-text-muted font-black border-b border-border/40 pb-2 mb-2 text-[10px] uppercase tracking-widest">
          {formattedLabel}
        </p>
      )}
      {payload.map((entry, index) => (
        <div key={`${entry.dataKey || entry.name}-${index}`} className="flex items-center justify-between gap-4 py-1">
          <span className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: entry.color || entry.fill }}
            />
            <span className="text-text-muted text-[11px] font-bold">
              {entry.name || entry.dataKey}
            </span>
          </span>
          <span className="font-black text-text-main tabular-nums">
            {valueFormatter ? valueFormatter(entry.value, entry) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export default ChartTooltip;
