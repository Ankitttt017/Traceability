// CR / MR / CRAM split shown under the NG figure (counts from the server, whole filtered set).
// Same colours as the Rejection Analysis page and the Excel.
const NG_CATEGORY_COLORS = { CR: "#2563eb", MR: "#7c3aed", CRAM: "#ea580c" };
const NG_CATEGORY_NAMES = {
  CR: "Casting rejection",
  MR: "Machining rejection",
  CRAM: "Casting rejection after machining",
};

const NgCategorySplit = ({ split }) => {
  if (!split) return null;
  const items = ["CR", "MR", "CRAM"].map((key) => ({ key, count: Number(split[key] || 0) }));
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <div className="mt-2.5" data-testid="ng-category-split">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[rgba(var(--pk-bdr),0.12)]" aria-hidden="true">
        {total > 0 && items.map((item) => (item.count > 0 ? (
          <span key={item.key} style={{ width: `${(item.count / total) * 100}%`, background: NG_CATEGORY_COLORS[item.key] }} />
        ) : null))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {items.map((item) => (
          <span
            key={item.key}
            className="inline-flex items-center gap-1 text-[10px] font-bold text-[rgb(var(--pk-txt-pri))]"
            title={`${NG_CATEGORY_NAMES[item.key]}: ${item.count.toLocaleString()} parts`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: NG_CATEGORY_COLORS[item.key] }} />
            <span style={{ color: NG_CATEGORY_COLORS[item.key] }}>{item.key}</span>
            <span className="font-mono">{item.count.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

export default NgCategorySplit;
