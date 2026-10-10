import React from "react";
import { X } from "lucide-react";
import EmptyState from "../../../components/mgmt/EmptyState";
import { CATEGORY_COLOR, CATEGORY_NAME, CATEGORY_ORDER, SLATE, fmtInt, fmtPct } from "../../../components/mgmt/mgmtTheme";

const catText = (c) => (c === "OTHER" ? "Not classified" : c);

/**
 * Side / drill-down list of reasons with count and share, coloured by defect category.
 * data = reasonCounts() → { list: [{ reason, count, pct, cat }], total, cats }
 * showCats: category totals as chips on top. limit: rows shown (the rest folded into one line).
 */
export default function ReasonList({ title, sub, data, onClose, showCats = true, limit = 0, empty = "No rejections", actions }) {
  const list = data?.list || [];
  const shown = limit > 0 && list.length > limit + 1 ? list.slice(0, limit) : list;
  const rest = list.slice(shown.length);
  const max = list[0]?.count || 1;
  return (
    <div className="ra-rlist">
      <div className="ra-rlist-head">
        <div style={{ minWidth: 0 }}>
          <div className="ra-rlist-title">{title}</div>
          {sub && <div className="ra-rlist-sub">{sub}</div>}
        </div>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {actions}
          {onClose && <button type="button" className="ra-icon-btn" onClick={onClose} aria-label="Close list"><X size={14} /></button>}
        </span>
      </div>
      {showCats && data?.total > 0 && (
        <div className="ra-rlist-cats">
          {[...CATEGORY_ORDER, "OTHER"].filter((c) => data.cats?.[c] > 0).map((c) => (
            <span key={c} title={CATEGORY_NAME[c]} style={{ borderColor: CATEGORY_COLOR[c], color: CATEGORY_COLOR[c] }}>
              {catText(c)} <b>{fmtInt(data.cats[c])}</b> · {fmtPct((data.cats[c] / data.total) * 100, 0)}
            </span>
          ))}
        </div>
      )}
      {!list.length ? <EmptyState title={empty} minHeight={90} /> : (
        <ol className="ra-rlist-rows">
          {shown.map((x) => (
            <li key={x.reason}>
              <span className="ra-rlist-dot" style={{ background: CATEGORY_COLOR[x.cat] || CATEGORY_COLOR.OTHER }} title={catText(x.cat)} />
              <span className="ra-rlist-name" title={`${x.reason} · ${catText(x.cat)}`}>
                {x.reason}
                <span className="ra-rlist-bar"><i style={{ width: `${(x.count / max) * 100}%`, background: CATEGORY_COLOR[x.cat] || CATEGORY_COLOR.OTHER }} /></span>
              </span>
              <b className="mg-num">{fmtInt(x.count)}</b>
              <span className="ra-rlist-pc mg-num">{fmtPct(x.pct, 1)}</span>
            </li>
          ))}
          {rest.length > 0 && (
            <li style={{ color: SLATE[500] }}>
              <span className="ra-rlist-dot" style={{ background: SLATE[300] }} />
              <span className="ra-rlist-name">{rest.length} more reasons</span>
              <b className="mg-num">{fmtInt(rest.reduce((a, x) => a + x.count, 0))}</b>
              <span className="ra-rlist-pc mg-num">{fmtPct(rest.reduce((a, x) => a + x.pct, 0), 1)}</span>
            </li>
          )}
        </ol>
      )}
      {data?.total > 0 && <div className="ra-rlist-foot">Total <b className="mg-num">{fmtInt(data.total)}</b> · % = share of this list</div>}
    </div>
  );
}
