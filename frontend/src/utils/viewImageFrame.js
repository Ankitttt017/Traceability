import { useEffect, useState } from "react";

/* ── Rejection view image frame ──────────────────────────────────────────────
   Zones are stored as percentages of the frame the view image is drawn in. The frame used to be a fixed
   900×520 landscape box, so a vertical (portrait) image appeared shrunk in the middle of a wide frame.
   Now the frame takes the image's own shape. Images close to 900×520 (within 10%, i.e. every existing
   landscape view) keep the standard frame exactly, so their zones do not move.
   Every place that draws a view (configuration, operator NG picker, Rejection page, Dashboard) must use
   this same rule, otherwise zones drawn in one place land elsewhere in another. */
export const STANDARD_VIEW_ASPECT = 900 / 520;

export const viewFrameAspect = (width, height) => {
  if (!(width > 0 && height > 0)) return STANDARD_VIEW_ASPECT;
  const ratio = width / height;
  return Math.abs(ratio / STANDARD_VIEW_ASPECT - 1) <= 0.1 ? STANDARD_VIEW_ASPECT : ratio;
};

/** Inline style for the frame: null for the standard 900×520 frame (the existing CSS applies unchanged);
 *  otherwise the image's own ratio, as wide as fits both the container and `maxHeight`. */
export const viewFrameStyle = (aspect, maxHeight = "70vh") => (
  aspect === STANDARD_VIEW_ASPECT ? null : {
    aspectRatio: String(aspect),
    width: `min(100%, calc(${maxHeight} * ${aspect}))`,
    height: "auto",
    maxHeight: "none",
    marginLeft: "auto",
    marginRight: "auto",
  }
);

const aspectCache = new Map();

/** Frame aspect for an image URL (standard while it loads or when there is no image). */
export function useViewFrameAspect(src) {
  const [state, setState] = useState({ src: null, aspect: STANDARD_VIEW_ASPECT });
  useEffect(() => {
    if (!src || aspectCache.has(src)) return undefined;
    let alive = true;
    const img = new window.Image();
    img.onload = () => {
      const aspect = viewFrameAspect(img.naturalWidth, img.naturalHeight);
      aspectCache.set(src, aspect);
      if (alive) setState({ src, aspect });
    };
    img.src = src;
    return () => { alive = false; };
  }, [src]);
  if (!src) return STANDARD_VIEW_ASPECT;
  if (aspectCache.has(src)) return aspectCache.get(src);
  return state.src === src ? state.aspect : STANDARD_VIEW_ASPECT;
}

export const useViewFrameStyle = (src, maxHeight) => viewFrameStyle(useViewFrameAspect(src), maxHeight);

/** For frames that cannot use the hook: <img onLoad={fitViewFrame("52dvh")}> sizes its parent frame. */
export const fitViewFrame = (maxHeight) => (event) => {
  const img = event.currentTarget;
  const frame = img?.parentElement;
  if (!frame) return;
  const keys = ["aspectRatio", "width", "height", "maxHeight", "marginLeft", "marginRight"];
  const style = viewFrameStyle(viewFrameAspect(img.naturalWidth, img.naturalHeight), maxHeight);
  // remember the frame's own inline values so a standard image puts them back exactly
  if (!frame.__viewFrameOriginal) frame.__viewFrameOriginal = Object.fromEntries(keys.map((k) => [k, frame.style[k]]));
  keys.forEach((k) => { frame.style[k] = style ? style[k] : frame.__viewFrameOriginal[k]; });
};
