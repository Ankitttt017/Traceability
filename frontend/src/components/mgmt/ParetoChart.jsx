import React, { useLayoutEffect, useMemo, useRef } from "react";
import EChart from "../charts/EChart";
import { FONT, NAVY, SLATE, TOOLTIP, axisLabel, fmtInt, fmtPct, tipHtml } from "./mgmtTheme";

/**
 * Vertical Pareto: biggest cause on the left, names on the X-axis (long names rotated + truncated, the full name in
 * the tooltip), bars coloured by group (e.g. defect category), count (+ share) on top of every bar, cumulative-share
 * line on a right-hand 0–100 % axis and a dashed 80 % line.
 *
 * items: [{ label, value, color, group?, note? }] — already sorted, already folded ("Other" last)
 * total: denominator for shares (defaults to the sum of items)
 * onSelect(item, index) (optional): click a bar or its name; selectedIndex = the selected bar (others faded)
 * showPct: the bar label also shows the share; labelWidth: widest axis name in px before it is truncated
 * height: chart height (default grows a little with the number of bars)
 */
export default function ParetoChart({
  items = [], total, labelWidth = 120, valueName = "Rejections", onSelect, selectedIndex = null, selectHint = "Click to see it on the part.",
  showPct = false, height,
}) {
  // EChart registers onEvents once → keep the latest handler / items in refs
  const selectRef = useRef(onSelect);
  const itemsRef = useRef(items);
  useLayoutEffect(() => { selectRef.current = onSelect; itemsRef.current = items; }, [onSelect, items]);
  const events = useMemo(() => ({
    click: (p) => {
      const list = itemsRef.current;
      let i = typeof p?.dataIndex === "number" && p.componentType === "series" ? p.dataIndex : -1;
      if (p?.componentType === "xAxis") i = list.findIndex((x) => x.label === p.value);
      if (i >= 0 && list[i] && selectRef.current) selectRef.current(list[i], i);
    },
  }), []);
  const clickable = !!onSelect;

  const n = items.length;
  const longest = items.reduce((m, x) => Math.max(m, String(x.label || "").length), 0);
  // rotate when the names do not fit side by side
  const rotate = n > 5 || longest > 14 ? (n > 10 || longest > 22 ? 40 : 30) : 0;
  const nameW = Math.max(70, Math.min(labelWidth, 150));
  const bottom = rotate ? Math.round(Math.sin((rotate * Math.PI) / 180) * Math.min(nameW, longest * 6.4)) + 22 : 30;

  const option = useMemo(() => {
    const sum = total || items.reduce((a, x) => a + (x.value || 0), 0) || 1;
    const cum = items.reduce((acc, x) => [...acc, (acc.length ? acc[acc.length - 1] : 0) + (x.value || 0)], [])
      .map((v) => Number(((v / sum) * 100).toFixed(1)));
    const cut = cum.findIndex((c) => c >= 80);
    const dense = n > 9;
    return {
      textStyle: { fontFamily: FONT },
      animationDuration: 350,
      tooltip: {
        ...TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,42,74,0.05)" } },
        formatter: (ps) => {
          const i = (Array.isArray(ps) ? ps[0] : ps)?.dataIndex;
          const it = items[i];
          if (!it) return "";
          return tipHtml({
            title: it.label,
            rows: [
              { label: valueName, value: fmtInt(it.value), color: it.color },
              { label: "Share of all", value: fmtPct(((it.value || 0) / sum) * 100) },
              { label: "Cumulative", value: fmtPct(cum[i]) },
              it.group ? { label: "Category", value: it.group, bold: false } : null,
            ],
            note: [it.note, clickable ? selectHint : null].filter(Boolean).join(" "),
          });
        },
      },
      grid: { left: 48, right: 46, top: 34, bottom },
      xAxis: {
        type: "category", data: items.map((x) => x.label),
        axisTick: { show: false }, axisLine: { lineStyle: { color: SLATE[300] } },
        axisLabel: axisLabel({ interval: 0, rotate, width: nameW, overflow: "truncate", fontSize: 11, color: SLATE[700], margin: 8 }),
        triggerEvent: clickable,
      },
      yAxis: [
        {
          type: "value", name: valueName, nameTextStyle: { color: SLATE[500], fontSize: 11, align: "left", padding: [0, 0, 0, -38] },
          minInterval: 1, max: (v) => Math.ceil(v.max * 1.18), axisLabel: axisLabel({ fontSize: 10.5, formatter: (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v) }),
          axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: SLATE[100] } },
        },
        {
          type: "value", min: 0, max: 100, interval: 20, position: "right",
          axisLabel: axisLabel({ formatter: (v) => `${v}%`, fontSize: 10.5 }),
          axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        },
      ],
      series: [
        {
          name: valueName, type: "bar", yAxisIndex: 0, barMaxWidth: 46, barCategoryGap: "30%", cursor: clickable ? "pointer" : "default",
          data: items.map((x, i) => {
            const sel = selectedIndex != null && selectedIndex >= 0;
            const on = sel && i === selectedIndex;
            const op = sel ? (on ? 1 : 0.35) : cut >= 0 && i > cut ? 0.6 : 1;
            return {
              value: x.value,
              itemStyle: { color: x.color, borderRadius: [4, 4, 0, 0], opacity: op, ...(on ? { borderColor: SLATE[900], borderWidth: 1.5 } : {}) },
            };
          }),
          label: {
            show: true, position: "top", distance: 4, color: SLATE[800], fontWeight: 700, fontSize: dense ? 10.5 : 11.5, fontFamily: FONT, lineHeight: 13,
            formatter: (p) => {
              const share = fmtPct(((Number(p.value) || 0) / sum) * 100, dense ? 0 : 1);
              return showPct ? `${fmtInt(p.value)}\n{s|${share}}` : fmtInt(p.value);
            },
            rich: { s: { color: SLATE[500], fontWeight: 600, fontSize: 10, fontFamily: FONT } },
          },
          labelLayout: { hideOverlap: false },
        },
        {
          name: "Cumulative %", type: "line", yAxisIndex: 1, data: cum, symbol: "circle", symbolSize: 6,
          lineStyle: { color: NAVY, width: 2 }, itemStyle: { color: NAVY, borderColor: "#fff", borderWidth: 1 }, z: 4,
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: SLATE[500], type: "dashed", width: 1 },
            label: { formatter: "80%", position: "insideEndTop", color: SLATE[600], fontSize: 10, fontWeight: 700 },
            data: [{ yAxis: 80 }],
          },
        },
      ],
    };
  }, [items, total, valueName, clickable, selectHint, selectedIndex, showPct, rotate, nameW, bottom, n]);

  const h = height || Math.max(300, 250 + bottom);
  return <EChart option={option} onEvents={events} style={{ height: h, minHeight: h }} />;
}
