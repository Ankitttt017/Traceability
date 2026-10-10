import React, { useLayoutEffect, useMemo, useRef } from "react";
import EChart from "../charts/EChart";
import {
  FONT, NAVY, SLATE, STATUS_COLOR, TOOLTIP, axisLabel, fmtInt, fmtPct, statusLowerBetter, tipHtml,
} from "./mgmtTheme";

/**
 * Volume + rate-vs-target trend, as two aligned panels sharing one time axis (no dual y-axis):
 *   top    — stacked bars (e.g. rejections by category)
 *   bottom — a rate line (e.g. scrap %) with the target line and the amber "near target" band;
 *            each point is coloured by its status vs target.
 *
 * props:
 *   labels: string[]                         x labels
 *   keys: string[]                           bucket keys handed to onSelect
 *   stacks: [{ name, color, data: number[] }]
 *   rate: { name, data: (number|null)[] }
 *   target, band (pp), lowerIsBetter (default true)
 *   tooltipRows(i) → [{ label, value, color }]  extra rows for a bucket's tooltip
 *   tooltipNote(i) → string
 *   onSelect(key, index)                     click a bar / point (e.g. filter the page to that day)
 *   height
 */
export default function TargetTrendChart({
  labels = [], keys = [], stacks = [], rate, target, band = 1, lowerIsBetter = true,
  tooltipRows, tooltipNote, onSelect, height = 380, barAxisName = "Rejections", rateAxisName = "%",
}) {
  // EChart registers onEvents once → keep the latest handler in a ref
  const selectRef = useRef(onSelect);
  const keysRef = useRef(keys);
  useLayoutEffect(() => {
    selectRef.current = onSelect;
    keysRef.current = keys;
  }, [onSelect, keys]);
  const events = useMemo(() => ({
    click: (p) => {
      const i = p?.dataIndex;
      if (typeof i === "number" && selectRef.current && keysRef.current[i] != null) selectRef.current(keysRef.current[i], i);
    },
  }), []);

  const option = useMemo(() => {
    const statusOf = (v) => (lowerIsBetter ? statusLowerBetter(v, target, band) : (v >= target ? "good" : v >= target - band ? "warn" : "bad"));
    const rateVals = (rate?.data || []).filter((v) => v !== null && Number.isFinite(v));
    const rateMax = Math.max(target + band * 1.6, ...rateVals) * 1.1;
    const many = labels.length > 20;
    const clickable = !!onSelect;
    return {
      textStyle: { fontFamily: FONT },
      animationDuration: 350,
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      tooltip: {
        ...TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,42,74,0.06)" } },
        formatter: (params) => {
          const i = Array.isArray(params) ? params[0]?.dataIndex : params?.dataIndex;
          if (i == null) return "";
          const total = stacks.reduce((a, s) => a + (Number(s.data[i]) || 0), 0);
          const rv = rate?.data?.[i];
          const st = rv == null ? "none" : statusOf(rv);
          const rows = [
            ...stacks.map((s) => ({ label: s.name, value: fmtInt(s.data[i]), color: s.color })),
            { label: `Total ${barAxisName.toLowerCase()}`, value: fmtInt(total) },
            rate ? { label: rate.name, value: rv == null ? "—" : `<span style="color:${STATUS_COLOR[st]}">${fmtPct(rv, 2)}</span>` } : null,
            ...(tooltipRows ? tooltipRows(i) || [] : []),
          ];
          const note = [tooltipNote ? tooltipNote(i) : null, clickable ? "Click to open this period." : null].filter(Boolean).join(" ");
          return tipHtml({ title: labels[i], rows, note });
        },
      },
      grid: [
        // the right margin holds the target label outside the plot, so it never sits on a bar, point or label
        { left: 54, right: 50, top: 16, height: "52%" },
        { left: 54, right: 50, top: "68%", bottom: many ? 44 : 30 },
      ],
      xAxis: [
        { type: "category", gridIndex: 0, data: labels, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: SLATE[300] } } },
        {
          type: "category", gridIndex: 1, data: labels, axisTick: { show: false }, axisLine: { lineStyle: { color: SLATE[300] } },
          axisLabel: axisLabel({ hideOverlap: true, rotate: many ? 40 : 0, fontSize: 11 }),
        },
      ],
      yAxis: [
        {
          type: "value", gridIndex: 0, name: barAxisName, nameTextStyle: { color: SLATE[500], fontSize: 11, align: "left", padding: [0, 0, 0, -40] },
          minInterval: 1, axisLabel: axisLabel(), axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: SLATE[100] } },
        },
        {
          type: "value", gridIndex: 1, name: rateAxisName, nameTextStyle: { color: SLATE[500], fontSize: 11, align: "left", padding: [0, 0, 0, -40] },
          min: 0, max: Math.ceil(rateMax), splitNumber: 3,
          axisLabel: axisLabel({ formatter: (v) => `${v}%` }), axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: SLATE[100] } },
        },
      ],
      series: [
        ...stacks.map((s) => ({
          name: s.name, type: "bar", stack: "v", xAxisIndex: 0, yAxisIndex: 0, data: s.data, barMaxWidth: 30,
          cursor: clickable ? "pointer" : "default",
          itemStyle: { color: s.color, borderColor: "#fff", borderWidth: 1, borderRadius: 2 },
          emphasis: { focus: "none" },
        })),
        rate && {
          name: rate.name, type: "line", xAxisIndex: 1, yAxisIndex: 1, connectNulls: false,
          data: rate.data.map((v) => (v == null ? null : {
            value: Number(v.toFixed(2)),
            itemStyle: { color: STATUS_COLOR[statusOf(v)], borderColor: "#fff", borderWidth: 1.5 },
          })),
          symbol: "circle", symbolSize: many ? 7 : 9, cursor: clickable ? "pointer" : "default",
          lineStyle: { color: NAVY, width: 2 },
          itemStyle: { color: NAVY },
          z: 5,
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: SLATE[700], type: "dashed", width: 1.5 },
            label: {
              formatter: `Target\n${target}%`, position: "end", distance: 6,
              color: SLATE[700], fontSize: 10.5, fontWeight: 700, lineHeight: 13,
            },
            data: [{ yAxis: target }],
          },
          markArea: band > 0 ? {
            silent: true,
            itemStyle: { color: "rgba(217,119,6,0.10)" },
            data: lowerIsBetter ? [[{ yAxis: target }, { yAxis: target + band }]] : [[{ yAxis: target - band }, { yAxis: target }]],
          } : undefined,
        },
      ].filter(Boolean),
    };
  }, [labels, stacks, rate, target, band, lowerIsBetter, tooltipRows, tooltipNote, onSelect, barAxisName, rateAxisName]);

  return <EChart option={option} onEvents={events} style={{ height, minHeight: height }} />;
}
