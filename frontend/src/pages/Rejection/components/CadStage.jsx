import React from "react";
import { ImageOff } from "lucide-react";
import { getFullImageUrl } from "../rejectionConstants";

/**
 * CAD image + zone overlay stage.
 * Zones are authored in Rejection Configuration on a 900×520 box with the image object-fit:contain,
 * so overlays are only correct when the stage reproduces exactly that geometry (no padding, same ratio).
 */
export default function CadStage({ imageUrl, alt = "", dark = false, className = "", children }) {
  return (
    <div className={`cad-stage ${dark ? "dark" : ""} ${className}`}>
      <style>{`
        .cad-stage{position:relative;width:100%;aspect-ratio:900/520;padding:0;margin:0;overflow:hidden;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0}
        .cad-stage.dark{background:#0b1220;border-color:#1e293b}
        .cad-stage>.cad-stage-img{position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:contain;padding:0;margin:0;border-radius:0;pointer-events:none;user-select:none}
        .cad-stage>.cad-stage-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;font-size:12px;font-weight:700;color:#94a3b8}
        .cad-zone,.cad-sub{position:absolute;box-sizing:border-box;border-radius:6px;transition:background .15s,border-color .15s,box-shadow .15s}
        .cad-zone{border:1.5px dashed rgba(100,116,139,.55);background:transparent}
        .cad-sub{border:1px dotted rgba(100,116,139,.6);background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center}
        .cad-stage.dark .cad-zone{border-color:rgba(148,163,184,.45)}
        .cad-stage.dark .cad-sub{border-color:rgba(148,163,184,.5)}
        .cad-tag{position:absolute;top:3px;left:3px;font:700 10px/1.3 Inter,system-ui,sans-serif;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,.92);color:#0f172a;white-space:nowrap;pointer-events:none;box-shadow:0 1px 2px rgba(0,0,0,.12)}
        .cad-sub .cad-tag{position:static;font-size:9.5px;padding:0 4px}
        .cad-count{display:inline-block;margin-left:4px;padding:0 5px;border-radius:9px;background:#dc2626;color:#fff;font-weight:800}
        .cad-count.inferred{background:#d97706}
      `}</style>
      {imageUrl ? (
        <img className="cad-stage-img" src={getFullImageUrl(imageUrl)} alt={alt} />
      ) : (
        <div className="cad-stage-empty"><ImageOff size={26} />No image configured for this view</div>
      )}
      {children}
    </div>
  );
}

