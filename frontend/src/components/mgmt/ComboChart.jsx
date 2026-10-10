import React, { useLayoutEffect, useMemo, useRef } from "react";
import EChart from "../charts/EChart";
import { FONT, NAVY, OUTCOME_COLOR, SLATE, STATUS_COLOR, TOOLTIP, axisLabel, fmtInt, fmtPct, statusLowerBetter, tipHtml } from "./mgmtTheme";

/**
 * Combo chart for trend analytics: bars = counts (left axis), lines = % (right axis), optional moving average,
 * target line, data labels on bars and line points, inside zoom + slider for long series. Click → onSelect.
 *
 * props:
 *   labels: string[]; keys: any[] (handed to onSelect(key, index, barKey))
 *   bars:   [{ key, name, color, data, stack?: string, label?: bool, labelColor?, colors?: string[] }]
 *           minHeight?: px (thin segments stay visible), topLabel?(i) → text on top of a stack, insideMin?: share of the
 *           tallest column below which an inside label is hidden (default 0.07)
 *   lines:  [{ key, name, color, data: (number|null)[], dashed?: bool, label?: bool, status?: bool (points coloured vs target), smooth?,
 *           markersOnly?: bool (no connecting line — for categories that are not a time series) }]
 *   flows:  { values: number[n-1], name, color, level?: share of the left axis (0–1) } — a flow line between consecutive
 *           columns with a circle at the midpoint labelled with the value (e.g. parts waiting between two stations)
 *   partial: index of a partial bucket (e.g. today, still running) — hollow point, "(partial)" in labels / tooltip
 *   target: number (%, dashed line on the right axis); band: amber band width (pp)
 *   leftName / rightName: axis names; height; zoom (default auto: ≥ 15 points); barMaxWidth; tooltipRows(i)
 */
const OUTCOME_COLOR_NG = OUTCOME_COLOR.ng;

export default function ComboChart({
  labels = [], keys = [], bars = [], lines = [], target = null, band = 1, leftName = "Parts", rightName = "%",
  height = 360, zoom, barMaxWidth = 34, onSelect, selectHint = "Click for details.", tooltipRows, rotate, partial = null, flows = null, rightMax = null,
}) {
  const selectRef = useRef(onSelect);
  const keysRef = useRef(keys);
  const labelsRef = useRef(labels);
  const barsRef = useRef(bars);
  useLayoutEffect(() => { selectRef.current = onSelect; keysRef.current = keys; labelsRef.current = labels; barsRef.current = bars; }, [onSelect, keys, labels, bars]);
  const events = useMemo(() => ({
    click: (p) => {
      const i = p?.componentType === "xAxis" ? labelsRef.current.indexOf(p.value) : p?.dataIndex;
      const bar = p?.componentType === "series" && p.seriesName !== "__hit" ? barsRef.current.find((b) => b.name === p.seriesName) || null : null;
      if (typeof i === "number" && i >= 0 && selectRef.current && keysRef.current[i] != null) selectRef.current(keysRef.current[i], i, bar?.key ?? null);
    },
  }), []);

  const option = useMemo(() => {
    const n = labels.length;
    const useZoom = zoom ?? n >= 15;
    const rot = rotate ?? (n > 14 ? 40 : 0);
    const dense = n > 20;
    const pctVals = lines.flatMap((l) => l.data).filter((v) => v != null && Number.isFinite(v));
    const sorted = pctVals.slice().sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    // a partial day or a low-volume bucket must not flatten the rest: cap the axis, draw outliers clipped
    const nonPartial = lines.flatMap((l) => l.data.filter((v, i) => i !== partial)).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    const p95b = nonPartial.length ? nonPartial[Math.min(nonPartial.length - 1, Math.floor(nonPartial.length * 0.95))] : p95;
    // outliers by the IQR fence (a low-volume day must not set the scale), then max(10 %, biggest normal value × 1.3)
    const q = (p) => (nonPartial.length ? nonPartial[Math.min(nonPartial.length - 1, Math.floor((nonPartial.length - 1) * p))] : 0);
    const fence = q(0.75) + 1.5 * (q(0.75) - q(0.25));
    const normalMax = nonPartial.filter((v) => v <= fence).pop() ?? p95b;
    const top = rightMax ?? Math.max(10, target != null ? target * 2 : 0, Math.ceil(Math.min(p95b, normalMax) * 1.3));
    const statusOf = (v) => (target != null ? statusLowerBetter(v, target, band) : "none");
    const stacks = new Set(bars.filter((b) => b.stack).map((b) => b.stack));
    const lastOfStack = (si) => { const s = bars[si].stack; return !s || bars.slice(si + 1).every((b) => b.stack !== s); };
    const colTotal = (i) => bars.reduce((a, b) => a + (Number(b.data[i]) || 0), 0);
    const maxCol = Math.max(1, ...labels.map((_, i) => (stacks.size ? colTotal(i) : Math.max(0, ...bars.map((b) => Number(b.data[i]) || 0)))));
    return {
      textStyle: { fontFamily: FONT },
      animationDuration: 350,
      legend: {
        top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 8, itemGap: 14,
        textStyle: { fontFamily: FONT, fontSize: 11.5, color: SLATE[700] },
        orient: "horizontal", type: "plain",
        data: [...bars.map((b) => b.name), ...(flows ? [{ name: flows.name, icon: "circle", itemStyle: { color: "#fff", borderColor: flows.color, borderWidth: 2 } }] : []), ...lines.map((l) => ({ name: l.name, icon: l.dashed ? "line" : "circle" }))],
      },
      tooltip: {
        ...TOOLTIP, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,42,74,0.06)" } },
        formatter: (ps) => {
          const i = (Array.isArray(ps) ? ps[0] : ps)?.dataIndex;
          if (i == null) return "";
          const rows = [
            ...bars.map((b) => ({ label: b.name, value: fmtInt(b.data[i]), color: b.colors?.[i] || b.color })),
            ...lines.map((l) => ({ label: l.name, value: l.data[i] == null ? "—" : `${fmtPct(l.data[i], 2)}${l.data[i] > top ? " (off scale)" : ""}`, color: l.color, bold: !l.dashed })),
            ...(flows && i < labels.length - 1 && flows.values[i] != null ? [{ label: `${flows.name} → ${labels[i + 1].split("\n")[0]}`, value: fmtInt(flows.values[i]), color: flows.color }] : []),
            ...(tooltipRows ? tooltipRows(i) || [] : []),
          ];
          const note = [i === partial ? "Still running — figures are incomplete (many parts not yet finished)." : null, onSelect && keys[i] != null ? selectHint : null].filter(Boolean).join(" ");
          return tipHtml({ title: `${labels[i]}${i === partial ? " (partial)" : ""}`, rows, note: note || undefined });
        },
      },
      grid: { left: 54, right: lines.length ? 56 : 18, top: 44, bottom: (useZoom ? 40 : 6) + (rot ? 46 : 24) },
      dataZoom: useZoom ? [
        { type: "inside", xAxisIndex: onSelect ? [0, 1] : 0, zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, minValueSpan: 3 },
        { type: "slider", xAxisIndex: onSelect ? [0, 1] : 0, height: 16, bottom: 6, brushSelect: false, borderColor: SLATE[200], fillerColor: "rgba(15,42,74,0.10)", backgroundColor: SLATE[50], dataBackground: { lineStyle: { color: SLATE[300] }, areaStyle: { color: SLATE[100] } }, handleStyle: { color: "#fff", borderColor: SLATE[400] }, textStyle: { color: SLATE[500], fontSize: 10.5 } },
      ] : undefined,
      xAxis: [
        {
          type: "category", data: labels, axisTick: { show: false }, axisLine: { lineStyle: { color: SLATE[300] } },
          axisLabel: axisLabel({ hideOverlap: true, rotate: rot, fontSize: 11, interval: n <= 16 ? 0 : "auto" }), triggerEvent: !!onSelect,
        },
        // hidden twin axis carrying a full-height click area per column (grouped bars leave gaps that would not react)
        ...(onSelect ? [{ type: "category", data: labels, show: false, axisPointer: { show: false } }] : []),
      ],
      yAxis: [
        {
          type: "value", name: leftName, nameTextStyle: { color: SLATE[500], fontSize: 11, align: "left", padding: [0, 0, 0, -40] },
          minInterval: 1, max: (v) => Math.ceil(v.max * (stacks.size || bars.length < 3 ? 1.14 : 1.2)),
          axisLabel: axisLabel({ formatter: (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v) }),
          axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: SLATE[100] } },
        },
        ...(lines.length ? [{
          type: "value", name: rightName, position: "right", min: 0, max: top,
          nameTextStyle: { color: SLATE[500], fontSize: 11, align: "right", padding: [0, -40, 0, 0] },
          axisLabel: axisLabel({ formatter: (v) => `${v}%` }), axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        }] : []),
        ...(onSelect ? [{ type: "value", min: 0, max: 1, show: false }] : []),
      ],
      series: [
        ...(onSelect ? [{
          name: "__hit", type: "bar", xAxisIndex: 1, yAxisIndex: lines.length ? 2 : 1, data: labels.map(() => 1), barWidth: "96%", z: 0,
          itemStyle: { color: "rgba(15,42,74,0)" }, emphasis: { itemStyle: { color: "rgba(15,42,74,0.04)" } }, cursor: "pointer",
          label: { show: false }, tooltip: { show: false },
        }] : []),
        ...bars.map((b, si) => {
          const onTop = !b.stack || lastOfStack(si);
          return {
            name: b.name, type: "bar", stack: b.stack, yAxisIndex: 0, barMaxWidth, cursor: onSelect ? "pointer" : "default", barMinHeight: b.minHeight || 0,
            data: b.colors ? b.data.map((v, i) => ({ value: v, itemStyle: { color: b.colors[i] || b.color } })) : b.data,
            itemStyle: { color: b.color, borderRadius: onTop ? [3, 3, 0, 0] : 0, borderColor: b.stack ? "#fff" : undefined, borderWidth: b.stack ? 0.5 : 0 },
            emphasis: { focus: "series" },
            label: b.label === false ? undefined : {
              show: true, position: b.stack ? (onTop ? "top" : "inside") : "top", distance: 3, fontSize: dense ? 9.5 : 10.5, fontWeight: 700, fontFamily: FONT,
              color: b.stack && !onTop ? "#fff" : (b.labelColor || SLATE[700]),
              formatter: b.stack && onTop && b.topLabel ? (p) => b.topLabel(p.dataIndex)
                : b.stack && onTop && stacks.size
                  ? (p) => { const tot = bars.filter((x) => x.stack === b.stack).reduce((a, x) => a + (Number(x.data[p.dataIndex]) || 0), 0); return tot > 0 ? fmtInt(tot) : ""; }
                  : b.stack && !onTop
                    ? (p) => (Number(p.value) / maxCol >= (b.insideMin ?? 0.07) ? fmtInt(p.value) : "")
                    : (p) => (Number(p.value) > 0 ? fmtInt(p.value) : ""),
              ...(b.stack && onTop && b.topLabel ? { color: SLATE[800], lineHeight: 14, rich: { ok: { color: "#15803d", fontWeight: 800, fontSize: 11 }, ng: { color: OUTCOME_COLOR_NG, fontWeight: 800, fontSize: 11 }, wip: { color: SLATE[600], fontWeight: 700, fontSize: 10.5 } } } : {}),
            },
            labelLayout: { hideOverlap: true },
          };
        }),
        ...(flows ? [{
          name: flows.name, type: "custom", yAxisIndex: 0, z: 6, silent: true, tooltip: { show: false },
          data: flows.values.map((v, i) => [i, v]),
          renderItem: (params, api) => {
            const i = api.value(0);
            const v = api.value(1);
            if (!(v >= 0) || i >= labels.length - 1) return null;
            const yv = maxCol * (flows.level ?? 0.55);
            const a = api.coord([i, yv]);
            const b = api.coord([i + 1, yv]);
            const half = api.size([1, 0])[0] * 0.18;
            const x1 = a[0] + half, x2 = b[0] - half, xm = (a[0] + b[0]) / 2, y = a[1];
            const col = v > 0 ? flows.color : SLATE[300];
            const text = fmtInt(v);
            const rr = Math.max(13, 5 + text.length * 3.6);
            return {
              type: "group",
              children: [
                { type: "line", shape: { x1, y1: y, x2: x2 - 6, y2: y }, style: { stroke: col, lineWidth: 2, lineDash: v > 0 ? null : [3, 3] } },
                { type: "polygon", shape: { points: [[x2 - 7, y - 4], [x2, y], [x2 - 7, y + 4]] }, style: { fill: col } },
                { type: "circle", shape: { cx: xm, cy: y, r: rr }, style: { fill: "#fff", stroke: col, lineWidth: 2 } },
                { type: "text", style: { x: xm, y, text, align: "center", verticalAlign: "middle", fill: v > 0 ? SLATE[900] : SLATE[400], font: `800 11px ${FONT}` } },
              ],
            };
          },
        }] : []),
        ...lines.map((l) => ({
          name: l.name, type: "line", yAxisIndex: 1, z: 5, connectNulls: !!l.dashed, smooth: l.smooth ?? !!l.dashed,
          symbol: l.dashed ? "none" : l.markersOnly ? "diamond" : "circle", symbolSize: l.markersOnly ? 13 : dense ? 5 : 7,
          lineStyle: { color: l.color, width: l.dashed ? 2 : 2.2, type: l.dashed ? "dashed" : "solid", opacity: l.markersOnly ? 0 : 1 },
          itemStyle: { color: l.color, borderColor: "#fff", borderWidth: 1 },
          data: l.data.map((v, i) => (v == null ? null : {
            value: Number(Math.min(Number(v), top).toFixed(2)),
            real: Number(v),
            ...(Number(v) > top ? { symbol: "triangle", symbolSize: 11 } : {}),
            itemStyle: i === partial
              ? { color: "#fff", borderColor: l.status ? STATUS_COLOR[statusOf(v)] : l.color, borderWidth: 2, borderType: "dashed" }
              : l.status ? { color: STATUS_COLOR[statusOf(v)], borderColor: "#fff", borderWidth: 1.2 } : undefined,
          })),
          label: l.label ? {
            show: true, position: "top", distance: 6, fontSize: dense ? 9.5 : 10.5, fontWeight: 700, fontFamily: FONT, color: l.color,
            backgroundColor: "rgba(255,255,255,.85)", padding: [1, 3], borderRadius: 3,
            formatter: (p) => {
              const real = p.data?.real ?? p.value;
              if (real == null) return "";
              return `${real > top ? "▲ " : ""}${Number(real).toFixed(1)}%${p.dataIndex === partial ? " (partial)" : ""}`;
            },
          } : undefined,
          labelLayout: { hideOverlap: true },
          markLine: target != null && l === lines[0] ? {
            silent: true, symbol: "none", lineStyle: { color: SLATE[700], type: [5, 4], width: 1.4 },
            label: { formatter: `Target ${target}%`, position: "insideStartTop", color: SLATE[700], fontSize: 10.5, fontWeight: 700, backgroundColor: "rgba(255,255,255,.9)", padding: [1, 4], borderRadius: 3 },
            data: [{ yAxis: target }],
          } : undefined,
        })),
      ],
      color: [NAVY],
    };
  }, [labels, keys, bars, lines, target, band, leftName, rightName, zoom, barMaxWidth, onSelect, selectHint, tooltipRows, rotate, partial, flows, rightMax]);

  return <EChart option={option} onEvents={events} style={{ height, minHeight: height }} />;
}
