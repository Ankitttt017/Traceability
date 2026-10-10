import React, { useLayoutEffect, useMemo, useRef } from "react";
import EChart from "../charts/EChart";
import {
  FONT, NAVY, SLATE, STATUS_COLOR, TOOLTIP, axisLabel, fmtInt, fmtPct, statusLowerBetter, tipHtml,
} from "./mgmtTheme";

/**
 * Bars (stacked or grouped) over a category axis + optional rate line on a right-hand % axis, with mouse zoom:
 * ECharts dataZoom "inside" (mouse wheel = zoom in / out, drag = pan) and a slider under the axis when there are
 * many points. Click a bar / point → onSelect(key, index) (drill-down).
 *
 * props:
 *   labels: string[]; keys: any[] (handed to onSelect)
 *   bars:  [{ name, color, data: number[], stack?: string|false, label?: bool (value on top), labelFormatter?(i),
 *            colors?: string[] (per point), tooltip?: false (e.g. an invisible "total" series that only carries a label) }]
 *   lines: [{ name, color, data }]                         extra count lines on the left axis (e.g. reason trend)
 *   rate:  { name, data: (number|null)[], target?, band?, axisName?, status?: bool }   right-hand % line
 *   onSelect(key, i, barKey); selectHint: tooltip footer text when clickable
 *            barKey = the clicked bar's `key` (bars[].key) when a bar itself was clicked, else null (column / axis label)
 *   tooltipRows(i) → [{ label, value, color }]; tooltipNote(i) → string
 *   zoom (default true), sliderFrom (min points for the slider, default 12), height, valueAxisName
 */
export default function ZoomBarChart({
  labels = [], keys = [], bars = [], lines = [], rate, onSelect, selectHint = "Click to drill down.",
  tooltipRows, tooltipNote, zoom = true, sliderFrom = 12, height = 360, valueAxisName = "", barMaxWidth = 34,
}) {
  // EChart registers onEvents once → keep the latest handler / keys in refs
  const selectRef = useRef(onSelect);
  const keysRef = useRef(keys);
  const labelsRef = useRef(labels);
  const barsRef = useRef(bars);
  useLayoutEffect(() => {
    selectRef.current = onSelect;
    keysRef.current = keys;
    labelsRef.current = labels;
    barsRef.current = bars;
  }, [onSelect, keys, labels, bars]);
  const events = useMemo(() => ({
    click: (p) => {
      // a bar / point, the invisible column behind it, or the axis label under it
      const i = p?.componentType === "xAxis" ? labelsRef.current.indexOf(p.value) : p?.dataIndex;
      // bars are the first series, in order → the clicked bar's own key (null for the column hit area / axis label)
      const bar = p?.componentType === "series" && p.seriesName !== "__hit" ? barsRef.current[p.seriesIndex] : null;
      if (typeof i === "number" && selectRef.current && keysRef.current[i] != null) selectRef.current(keysRef.current[i], i, bar?.key ?? null);
    },
  }), []);

  const option = useMemo(() => {
    const n = labels.length;
    const clickable = !!onSelect;
    const slider = zoom && n >= sliderFrom;
    const rotate = n > 14 ? 40 : 0;
    const target = rate?.target;
    const band = rate?.band || 0;
    const statusOf = (v) => (target != null ? statusLowerBetter(v, target, band) : "none");
    const rateVals = (rate?.data || []).filter((v) => v !== null && Number.isFinite(v));
    // robust scale: one day with only a few recorded shots must not flatten every other point (its value stays in the
    // tooltip; the point is clipped at the top edge)
    const sorted = rateVals.slice().sort((a, b) => a - b);
    const p85 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.85))] : 0;
    const floor = target != null ? target + band * 1.6 : 1;
    const top = Math.max(floor, ...rateVals);
    const outlier = p85 > 0 && top > p85 * 3;
    const rateMax = rate ? (outlier ? Math.max(floor, p85 * 1.8) : top) * 1.12 : 0;
    // clickable charts: an invisible bar over the whole height of each column, so a click anywhere in a day /
    // month column selects it (with grouped bars the gaps between bars would not react otherwise)
    const hitX = clickable ? [0, 1] : 0;
    const hitSeries = clickable ? {
      name: "__hit", type: "bar", xAxisIndex: 1, yAxisIndex: rate ? 2 : 1, data: labels.map(() => 1), barWidth: "96%", z: 0,
      itemStyle: { color: "rgba(15,42,74,0)" }, emphasis: { itemStyle: { color: "rgba(15,42,74,0.05)" } }, cursor: "pointer",
      label: { show: false }, tooltip: { show: false },
    } : null;
    return {
      textStyle: { fontFamily: FONT },
      animationDuration: 350,
      tooltip: {
        ...TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,42,74,0.06)" } },
        formatter: (params) => {
          const i = Array.isArray(params) ? params[0]?.dataIndex : params?.dataIndex;
          if (i == null) return "";
          const rv = rate?.data?.[i];
          const rows = [
            ...bars.filter((s) => s.tooltip !== false).map((s) => ({ label: s.name, value: fmtInt(s.data[i]), color: s.colors?.[i] || s.color })),
            ...lines.map((s) => ({ label: s.name, value: fmtInt(s.data[i]), color: s.color })),
            rate ? {
              label: rate.name,
              value: rv == null ? "—" : `<span style="color:${rate.status ? STATUS_COLOR[statusOf(rv)] : SLATE[900]}">${fmtPct(rv, 2)}</span>`,
            } : null,
            ...(tooltipRows ? tooltipRows(i) || [] : []),
          ];
          const note = [tooltipNote ? tooltipNote(i) : null, clickable && keys[i] != null ? selectHint : null].filter(Boolean).join(" ");
          return tipHtml({ title: labels[i], rows, note });
        },
      },
      grid: { left: 52, right: rate ? 56 : 18, top: 30, bottom: (slider ? 46 : 8) + (rotate ? 44 : 26) },
      dataZoom: zoom ? [
        { type: "inside", xAxisIndex: hitX, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, minValueSpan: 2 },
        ...(slider ? [{
          type: "slider", xAxisIndex: hitX, height: 18, bottom: 8, brushSelect: false,
          borderColor: SLATE[200], fillerColor: "rgba(15,42,74,0.10)", backgroundColor: SLATE[50],
          dataBackground: { lineStyle: { color: SLATE[300] }, areaStyle: { color: SLATE[100] } },
          handleStyle: { color: "#fff", borderColor: SLATE[400] }, textStyle: { color: SLATE[500], fontSize: 10.5 },
        }] : []),
      ] : undefined,
      xAxis: [
        {
          type: "category", data: labels, axisTick: { show: false }, axisLine: { lineStyle: { color: SLATE[300] } },
          axisLabel: axisLabel({ hideOverlap: true, rotate, fontSize: 11 }), triggerEvent: clickable,
        },
        // hidden twin axis that carries the full-column click area (does not take part in the bar grouping)
        ...(clickable ? [{ type: "category", data: labels, show: false, axisPointer: { show: false } }] : []),
      ],
      yAxis: [
        {
          type: "value", name: valueAxisName, nameTextStyle: { color: SLATE[500], fontSize: 11, align: "left", padding: [0, 0, 0, -38] },
          minInterval: 1, axisLabel: axisLabel({ formatter: (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v) }),
          axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: SLATE[100] } },
        },
        rate ? {
          type: "value", position: "right", min: 0, max: Math.max(1, Math.ceil(rateMax)),

          axisLabel: axisLabel({ formatter: (v) => `${v}%` }), axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        } : null,
        clickable ? { type: "value", min: 0, max: 1, show: false } : null,
      ].filter(Boolean),
      series: [
        ...bars.map((s, si) => {
          const top = s.label && (s.stack === false || si === bars.length - 1 || bars.slice(si + 1).every((b) => b.stack !== s.stack));
          return {
            name: s.name, type: "bar", stack: s.stack === false ? undefined : (s.stack || "v"), yAxisIndex: 0, barMaxWidth, silent: s.tooltip === false,
            cursor: clickable ? "pointer" : "default", barMinHeight: s.minHeight || 0,
            data: s.colors ? s.data.map((v, i) => ({ value: v, itemStyle: { color: s.colors[i] || s.color } })) : s.data,
            itemStyle: { color: s.color, borderColor: "#fff", borderWidth: s.stack === false ? 0 : 1, borderRadius: 2 },
            emphasis: { focus: "none" },
            label: s.label ? {
              show: true, position: top ? "top" : "inside", distance: 3, fontSize: 10.5, fontWeight: 700, fontFamily: FONT,
              color: top ? (s.labelColor || s.color) : "#fff",
              formatter: s.labelFormatter ? (p) => s.labelFormatter(p.dataIndex) : (p) => (Number(p.value) > 0 ? fmtInt(p.value) : ""),
            } : undefined,
            labelLayout: { hideOverlap: true },
          };
        }),
        ...lines.map((s) => ({
          name: s.name, type: "line", yAxisIndex: 0, data: s.data, symbol: "circle", symbolSize: 6, smooth: false,
          lineStyle: { color: s.color, width: 2 }, itemStyle: { color: s.color }, emphasis: { focus: "series" },
          cursor: clickable ? "pointer" : "default",
        })),
        rate && {
          name: rate.name, type: "line", yAxisIndex: 1, connectNulls: false, z: 5,
          data: rate.data.map((v) => (v == null ? null : {
            value: Number(v.toFixed(2)),
            itemStyle: rate.status ? { color: STATUS_COLOR[statusOf(v)], borderColor: "#fff", borderWidth: 1.5 } : undefined,
          })),
          symbol: "circle", symbolSize: n > 24 ? 6 : 8, cursor: clickable ? "pointer" : "default",
          lineStyle: { color: rate.color || NAVY, width: 2 }, itemStyle: { color: rate.color || NAVY },
          markLine: target != null ? {
            silent: true, symbol: "none",
            lineStyle: { color: SLATE[700], type: "dashed", width: 1.5 },
            label: { formatter: `Target ${target}%`, position: "insideEndTop", color: SLATE[700], fontSize: 10.5, fontWeight: 700 },
            data: [{ yAxis: target }],
          } : undefined,
          markArea: target != null && band > 0 ? {
            silent: true, itemStyle: { color: "rgba(217,119,6,0.10)" },
            data: [[{ yAxis: target }, { yAxis: target + band }]],
          } : undefined,
        },
        hitSeries,
      ].filter(Boolean),
    };
  }, [labels, keys, bars, lines, rate, onSelect, selectHint, tooltipRows, tooltipNote, zoom, sliderFrom, valueAxisName, barMaxWidth]);

  return <EChart option={option} onEvents={events} style={{ height, minHeight: height }} />;
}
