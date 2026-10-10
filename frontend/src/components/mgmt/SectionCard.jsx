import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import InfoTip from "../../pages/Rejection/components/InfoTip";

/**
 * Card for one management section: kicker (e.g. "Where"), title, one-line plain-language subtitle,
 * optional (i) definitions popover, header actions, collapsible body and footnote.
 * info = { what, formula?, note? }
 */
export default function SectionCard({
  id, kicker, title, subtitle, info, actions, footer, children,
  collapsible = false, defaultOpen = true, bodyStyle, sectionRef, style,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} ref={sectionRef} className="mg-card" style={style} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="mg-card-head">
        <div style={{ minWidth: 0, flex: "1 1 300px" }}>
          {kicker && <div className="mg-card-kicker">{kicker}</div>}
          <h2 className="mg-card-title" id={id ? `${id}-title` : undefined}>
            {title}
            {info && <InfoTip info={{ title, ...info }} label={`How to read: ${title}`} />}
          </h2>
          {subtitle && <p className="mg-card-sub">{subtitle}</p>}
        </div>
        {(actions || collapsible) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {actions}
            {collapsible && (
              <button type="button" className="mg-collapse-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
                {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? "Hide" : "Show"}
              </button>
            )}
          </div>
        )}
      </div>
      {(!collapsible || open) && (
        <>
          <div className="mg-card-body" style={bodyStyle}>{children}</div>
          {footer && <div className="mg-card-foot">{footer}</div>}
        </>
      )}
    </section>
  );
}
