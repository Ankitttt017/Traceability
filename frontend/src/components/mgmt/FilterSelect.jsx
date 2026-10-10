import React from "react";
import { ChevronDown, Loader2, X } from "lucide-react";

/**
 * Compact labelled dropdown for a page filter row (native <select> — keyboard and screen-reader friendly).
 * options: [{ value, label, count? }]; value "" = all. The current value is always listed, even when the options
 * (loaded from data) do not contain it, so a filter is never silently dropped.
 * loading: options still loading (the select stays usable with the current value).
 */
export default function FilterSelect({
  label, value = "", options = [], onChange, allLabel = "All", loading = false, disabled = false, title, width = 150,
}) {
  const list = value && !options.some((o) => o.value === value) ? [{ value, label: value }, ...options] : options;
  const active = !!value;
  const id = `fs-${String(label).replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className={`mg-fsel ${active ? "on" : ""}`} title={title} style={{ "--fsel-w": `${width}px` }}>
      <label htmlFor={id} className="mg-fsel-label">{label}</label>
      <div className="mg-fsel-box">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-busy={loading || undefined}
        >
          <option value="">{loading && !list.length ? "Loading…" : allLabel}</option>
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}{o.count != null ? ` (${Number(o.count).toLocaleString("en-IN")})` : ""}
            </option>
          ))}
        </select>
        {loading ? <Loader2 size={13} className="mg-fsel-icon ra-spin" aria-hidden="true" /> : <ChevronDown size={14} className="mg-fsel-icon" aria-hidden="true" />}
        {active && (
          <button type="button" className="mg-fsel-clear" onClick={() => onChange("")} aria-label={`Clear ${label} filter`}>
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export const FILTER_SELECT_CSS = `
.mg-fsel{display:flex;flex-direction:column;gap:3px;min-width:0;flex:0 1 var(--fsel-w,150px)}
.mg-fsel-label{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;white-space:nowrap}
.mg-fsel-box{position:relative;display:flex;align-items:center}
.mg-fsel select{appearance:none;-webkit-appearance:none;width:100%;height:32px;padding:0 28px 0 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.mg-fsel select:hover:not(:disabled){border-color:#94a3b8}
.mg-fsel select:focus-visible{outline:2px solid #3b5b82;outline-offset:1px}
.mg-fsel select:disabled{opacity:.6;cursor:default}
.mg-fsel.on select{border-color:#0f2a4a;background:#eef3f9;padding-right:46px}
.mg-fsel-icon{position:absolute;right:9px;pointer-events:none;color:#64748b}
.mg-fsel.on .mg-fsel-icon{right:26px}
.mg-fsel-clear{position:absolute;right:6px;display:grid;place-items:center;width:18px;height:18px;border:none;border-radius:50%;background:#0f2a4a;color:#fff;cursor:pointer;padding:0}
.mg-fsel-clear:focus-visible{outline:2px solid #3b5b82;outline-offset:1px}
`;
