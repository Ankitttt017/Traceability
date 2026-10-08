import { useEffect, useRef, useState } from "react";
import ChartDownloadButton from "./ChartDownloadButton";
import { useChartDownload, chartFileName, downloadSvgAsPng } from "./chartDownload";

const SafeChart = ({ height = 220, children, style = {} }) => {
  const hostRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const downloadable = useChartDownload();

  useEffect(() => {
    if (!hostRef.current) return;
    const el = hostRef.current;
    let rafId = 0;
    const check = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const w = Math.floor(rect.width || el.clientWidth || 0);
        const h = Math.floor(rect.height || el.clientHeight || 0);
        setSize({ width: w, height: h });
        setReady(w > 1 && h > 1);
      });
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef} className={downloadable ? "chart-dl-host" : undefined} style={{ height, width: "100%", minWidth: 1, minHeight: 1, overflow: "hidden", ...(downloadable ? { position: "relative" } : null), ...style }}>
      {ready ? (
        <div style={{ width: size.width, height: size.height, minWidth: 1, minHeight: 1 }}>
          {typeof children === "function" ? children(size) : children}
        </div>
      ) : null}
      {downloadable && ready && <ChartDownloadButton onDownload={(btn) => downloadSvgAsPng(hostRef.current, chartFileName(btn))} />}
    </div>
  );
};

export default SafeChart;
