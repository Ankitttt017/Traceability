import React, { useLayoutEffect, useMemo, useRef } from "react";
import EChart from "../charts/EChart";
import { FONT, SLATE, TOOLTIP, fmtInt, fmtPct, tipHtml } from "./mgmtTheme";

/**
 * Donut with the total in the middle and a readable legend (value + share) underneath.
 * items: [{ label, value, color, note?, key? }] — zero values are dropped.
 * onSelect(item) (optional): clicking a slice or a legend row selects it; selected = the selected item's key / label
 * (that slice is pulled out, the others are faded).
 * showLabels: data labels outside the ring ("CR 1,234 · 45%"). legend: false hides the list under the ring.
 */
export default function DonutChart({
  items = [], centerLabel = "Total", height = 190, valueName = "Rejections", onSelect, selected = null, selectHint = "Click for the reasons.",
  showLabels = false, legend = true,
}) {
  const list = useMemo(() => items.filter((x) => Number(x.value) > 0), [items]);
  const total = useMemo(() => list.reduce((a, x) => a + Number(x.value), 0), [list]);
  const keyOf = (x) => x.key ?? x.label;

  // EChart registers onEvents once → keep the latest handler / list in refs
  const selectRef = useRef(onSelect);
  const listRef = useRef(list);
  useLayoutEffect(() => { selectRef.current = onSelect; listRef.current = list; }, [onSelect, list]);
  const events = useMemo(() => ({
    click: (p) => {
      const it = listRef.current[p?.dataIndex];
      if (it && selectRef.current) selectRef.current(it);
    },
  }), []);

  const clickable = !!onSelect;
  const option = useMemo(() => ({
    textStyle: { fontFamily: FONT },
    animationDuration: 350,
    tooltip: {
      ...TOOLTIP,
      trigger: "item",
      formatter: (p) => {
        const it = list[p.dataIndex];
        if (!it) return "";
        return tipHtml({
          title: it.label,
          rows: [{ label: valueName, value: fmtInt(it.value), color: it.color }, { label: "Share", value: fmtPct((it.value / (total || 1)) * 100) }],
          note: [it.note, clickable ? selectHint : null].filter(Boolean).join(" "),
        });
      },
    },
    title: {
      text: fmtInt(total), subtext: centerLabel, left: "center", top: "middle", itemGap: 2,
      textStyle: { fontSize: 19, fontWeight: 800, color: SLATE[900], fontFamily: FONT },
      subtextStyle: { fontSize: 10.5, color: SLATE[500], fontFamily: FONT },
    },
    series: [{
      type: "pie", radius: showLabels ? ["46%", "70%"] : ["58%", "86%"], center: ["50%", "50%"], avoidLabelOverlap: true,
      label: showLabels ? {
        show: true, position: "outside", fontFamily: FONT, fontSize: 11.5, color: SLATE[700], lineHeight: 15,
        formatter: (p) => `{n|${String(list[p.dataIndex]?.short || p.name)}}
{v|${fmtInt(p.value)}} · ${fmtPct((p.value / (total || 1)) * 100)}`,
        rich: { n: { fontWeight: 700, color: SLATE[900], fontSize: 12 }, v: { fontWeight: 700, color: SLATE[800] } },
      } : { show: false },
      labelLine: showLabels ? { show: true, length: 8, length2: 10, lineStyle: { color: SLATE[300] } } : { show: false },
      itemStyle: { borderColor: "#fff", borderWidth: 2 },
      emphasis: { scale: true, scaleSize: 4 },
      cursor: clickable ? "pointer" : "default",
      selectedMode: false,
      data: list.map((x) => {
        const on = selected != null && keyOf(x) === selected;
        const dim = selected != null && !on;
        return {
          name: x.label, value: Number(x.value),
          itemStyle: { color: x.color, opacity: dim ? 0.35 : 1, ...(on ? { borderColor: SLATE[900], borderWidth: 2 } : {}) },
        };
      }),
    }],
  }), [list, total, centerLabel, valueName, selected, clickable, selectHint, showLabels]);

  return (
    <div>
      <EChart option={option} onEvents={events} style={{ height, minHeight: height }} />
      {legend && <ul className="mg-donut-legend">
        {list.map((x) => {
          const on = selected != null && keyOf(x) === selected;
          const body = (
            <>
              <i style={{ background: x.color }} />
              <span className="nm">{x.label}</span>
              <b className="mg-num">{fmtInt(x.value)}</b>
              <span className="pc mg-num">{fmtPct((x.value / (total || 1)) * 100, 0)}</span>
            </>
          );
          return (
            <li key={keyOf(x)} title={x.note || x.label} className={on ? "on" : undefined}>
              {clickable ? (
                <button type="button" className="mg-donut-pick" aria-pressed={on} onClick={() => onSelect(x)}>{body}</button>
              ) : body}
            </li>
          );
        })}
      </ul>}
    </div>
  );
}
