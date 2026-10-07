import React, { useEffect, useRef } from "react";
import * as echarts from "echarts";
import ChartDownloadButton from "./ChartDownloadButton";
import { useChartDownload, chartFileName, downloadDataUrl } from "./chartDownload";

// With the download button on: drop ECharts' own save icon and keep a top-right legend clear of the button
const adaptForDownload = (option) => {
  if (!option || typeof option !== "object") return option;
  const next = { ...option };
  if (next.toolbox?.feature?.saveAsImage) {
    const { saveAsImage: _drop, ...rest } = next.toolbox.feature;
    next.toolbox = Object.keys(rest).length ? { ...next.toolbox, feature: rest, right: 36 } : undefined;
  }
  const lg = next.legend;
  if (lg && !Array.isArray(lg) && lg.right !== undefined && lg.right !== "auto" && (lg.top === undefined || Number(lg.top) <= 12) && lg.bottom === undefined) {
    next.legend = { ...lg, right: (Number(lg.right) || 0) + 32 };
  }
  return next;
};

// ECharts throws "Heatmap must use with visualMap" when a heatmap has no visualMap: add a hidden one
// over the value dimension (min–max of the data) so a missing scale can never crash the page
const ensureHeatmapVisualMap = (option) => {
  if (!option || option.visualMap) return option;
  const series = Array.isArray(option.series) ? option.series : option.series ? [option.series] : [];
  const idx = series.map((sr, i) => (sr?.type === "heatmap" ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return option;
  const vals = idx.flatMap((i) => (series[i].data || []).map((d) => Number((Array.isArray(d) ? d : d?.value)?.[2]))).filter(Number.isFinite);
  const min = vals.length ? Math.min(...vals) : 0, max = vals.length ? Math.max(...vals) : 1;
  return { ...option, visualMap: { show: false, seriesIndex: idx, dimension: 2, min, max: max > min ? max : min + 1, inRange: { color: ["#fff1e6", "#f9a77a", "#d9512c", "#7f1d1d"] } } };
};

/**
 * Reusable, high-performance Apache ECharts wrapper for React 19 + Vite
 * Handles auto-resizing via ResizeObserver and proper instance lifecycle.
 * Inside a <ChartDownloadProvider> it also shows a "Download PNG" button.
 */
export default function EChart({ option, style, className, loading = false, theme = null, onEvents }) {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const downloadable = useChartDownload();

  useEffect(() => {
    if (!chartRef.current) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, theme, {
        renderer: "canvas",
      });

      if (onEvents && typeof onEvents === "object") {
        Object.entries(onEvents).forEach(([eventName, handler]) => {
          chartInstance.current.on(eventName, handler);
        });
      }
    }

    if (loading) {
      chartInstance.current.showLoading({
        text: "Loading…",
        color: "#2a78d6",
        textColor: "#64748b",
        maskColor: "rgba(255, 255, 255, 0.7)",
      });
    } else {
      chartInstance.current.hideLoading();
      if (option) {
        const opt = ensureHeatmapVisualMap(option);
        try {
          chartInstance.current.setOption(downloadable ? adaptForDownload(opt) : opt, true);
        } catch (err) {
          // one bad option must not take the whole page down
          console.warn("[EChart] option rejected:", err?.message || err);
        }
      }
    }
  }, [option, loading, theme, downloadable]);

  // Responsive resize on container width/height change
  useEffect(() => {
    if (!chartRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      chartInstance.current?.resize();
    });

    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartInstance.current) {
        chartInstance.current.dispose();
        chartInstance.current = null;
      }
    };
  }, []);

  if (!downloadable) {
    return (
      <div
        ref={chartRef}
        className={className}
        style={{
          width: "100%",
          height: "100%",
          minHeight: 280,
          ...style,
        }}
      />
    );
  }

  return (
    <div className="chart-dl-host" style={{ position: "relative", width: "100%", height: "100%", minHeight: 280, ...style }}>
      <div ref={chartRef} className={className} style={{ position: "absolute", inset: 0 }} />
      <ChartDownloadButton
        onDownload={(btn) => {
          const inst = chartInstance.current;
          if (!inst) throw new Error("Chart not ready");
          downloadDataUrl(inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" }), chartFileName(btn));
        }}
      />
    </div>
  );
}
