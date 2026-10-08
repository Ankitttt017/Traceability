import { createContext, createElement, useContext } from "react";

/**
 * Opt-in "Download PNG" button for EChart / SafeChart.
 * Wrap a page in <ChartDownloadProvider> to show it on every chart inside; pages without the provider
 * are unchanged. The filename comes from the nearest card title (h3/h4) + date.
 */
const ChartDownloadContext = createContext(false);
export const ChartDownloadProvider = ({ children, enabled = true }) =>
  createElement(ChartDownloadContext.Provider, { value: enabled }, children);
export const useChartDownload = () => useContext(ChartDownloadContext);

const slug = (s) => String(s || "").replace(/[—–]/g, "-").replace(/[^a-z0-9\- ]/gi, "").trim().replace(/\s+/g, "_").slice(0, 70);

export const chartFileName = (el, fallback = "chart") => {
  const card = el?.closest?.("section, [class*='card'], [class*='panel']");
  const head = card?.querySelector?.("h3, h4, [class*='title']");
  const title = slug(head?.textContent) || fallback;
  return `${title}_${new Date().toISOString().slice(0, 10)}.png`;
};

const saveDataUrl = (url, name) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

/** SVG (Recharts) → PNG at 2× on a white background. */
export const downloadSvgAsPng = (host, name) => new Promise((resolve, reject) => {
  const svg = host?.querySelector?.("svg.recharts-surface") || host?.querySelector?.("svg");
  if (!svg) { reject(new Error("No chart found")); return; }
  const rect = svg.getBoundingClientRect();
  const w = Math.ceil(rect.width), h = Math.ceil(rect.height);
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", w);
  clone.setAttribute("height", h);
  // Recharts relies on inherited CSS font; pin it so the PNG matches the screen
  clone.setAttribute("style", "font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;font-size:11px;background:#fff");
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    saveDataUrl(canvas.toDataURL("image/png"), name);
    resolve();
  };
  img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
  img.src = url;
});

export const downloadDataUrl = saveDataUrl;

