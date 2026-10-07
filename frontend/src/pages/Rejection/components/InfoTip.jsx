import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { INK, FONT_FAMILY } from "../chartTheme";

/**
 * Small "i" next to a chart heading. Hover, focus or click shows what the chart presents and the formula behind it.
 * The popover is portalled to <body> with fixed positioning, so cards with overflow:hidden cannot clip it.
 *
 * info = { what: string, formula?: string | string[], note?: string }
 */
export default function InfoTip({ info, label = "About this chart" }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(360, window.innerWidth - 24);
    setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left - 12, window.innerWidth - width - 12)), width });
  }, []);

  const show = useCallback(() => { place(); setOpen(true); }, [place]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (pinned && !btnRef.current?.contains(e.target)) { setPinned(false); setOpen(false); } };
    const esc = (e) => { if (e.key === "Escape") { setPinned(false); setOpen(false); } };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open, pinned, place]);

  if (!info) return null;
  const formulas = [].concat(info.formula || []).filter(Boolean);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={() => { if (!pinned) setOpen(false); }}
        onFocus={show}
        onBlur={() => { if (!pinned) setOpen(false); }}
        onClick={(e) => { e.stopPropagation(); setPinned((p) => !p); show(); }}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, marginLeft: 6,
          padding: 0, border: "none", borderRadius: "50%", background: "transparent", cursor: "pointer",
          color: open ? INK.primary : INK.faint, verticalAlign: "-3px", flexShrink: 0,
        }}
      >
        <Info size={15} />
      </button>
      {open && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 3000,
            background: "#ffffff", color: "#334155", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px",
            boxShadow: "0 14px 36px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,0.08)", fontFamily: FONT_FAMILY, fontSize: 12, lineHeight: 1.5,
            textTransform: "none", letterSpacing: "normal", fontWeight: 400, pointerEvents: "none",
          }}
        >
          {info.title && <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 4 }}>{info.title}</div>}
          <div>{info.what}</div>
          {formulas.length > 0 && (
            <div style={{ marginTop: 9, padding: "8px 10px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "#64748b", marginBottom: 3 }}>Formula</div>
              {formulas.map((f) => (
                <div key={f} style={{ fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace", fontSize: 11.5, color: "#0f172a", lineHeight: 1.6 }}>{f}</div>
              ))}
            </div>
          )}
          {info.note && <div style={{ marginTop: 8, color: "#64748b", fontSize: 11.5 }}>{info.note}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
