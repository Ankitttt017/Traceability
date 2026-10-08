import React, { useMemo, useState } from "react";
import {
  FileSpreadsheet, BarChart3, PieChart, Table, LineChart as LineChartIcon, Clock, ListOrdered,
} from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import EChart from "../../components/charts/EChart";
import {
  canonicalizeReason, formatResultTimestamp, looksLikeCustomerQr, parseRowDefect,
  extractShotFromPartId, extractShotDateTimeFromPartId,
} from "./rejectionConstants";
import {
  INK, OUTCOME, OTHER, DEFECT_CATEGORY, DEFECT_CATEGORY_LABEL, SHIFT,
  makeColorMap, withAlpha, fmtInt, fmtPct, shiftKey, CARD_CSS, FONT_FAMILY, ACCENT, accent,
  ECHART_TOOLTIP, tooltipHtml, axisLabel, axisName, valueAxis, categoryAxis, LEGEND, baseOption,
} from "./chartTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */
/* Minimum inspected parts (OK + NG) before a die's rejection rate is ranked against others. */
const MIN_INSPECTED_FOR_RANK = 50;
const Z95 = 1.96;
const CATEGORY_KEYS = ["CR", "CRAM", "MR"];
const UNCLASSIFIED = "Unclassified";
const NO_REASON = "No reason recorded";
const PARETO_TOP = 10;
const PARETO_CUTOFF = 80;
const NG_LIGHT = "#f87171";          // Pareto: reasons outside the vital few (light red, never grey)
const AVG_LINE = INK.primary;        // K-12 average reference line

/* Scope: this tab shows Oil Pan K-12 (part OPK12) dies only. */
const K12_PART = "OPK12";
/* Fallback list — used only for a die whose loaded records carry no part_name at all. */
const KNOWN_K12_DIES = ["S14", "S16", "S17", "S18"];
const isK12Part = (raw) => {
  const s = String(raw || "").toUpperCase().replace(/[\s_-]/g, "");
  return s === "OPK12" || s === "OILPANK12" || s.includes("K12");
};

const SHIFT_KEYS = ["A", "B", "C", "Unassigned"];

const fmtPP = (v) => (Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(2)} pp` : "—");

/** 95 % Wilson score interval for k NG out of n inspected. Returns percentages. */
const wilson = (k, n, z = Z95) => {
  if (!(n > 0)) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half) * 100, hi: Math.min(1, centre + half) * 100, centre: centre * 100 };
};

const isLeakReason = (raw) => {
  const s = String(raw || "").toLowerCase();
  return s.includes("op150") || s.includes("op 150") || s.includes("leak");
};
/* Leak failures are grouped under one reason; the measured leak value is not part of the reason. */
const normalizeReason = (raw) => (isLeakReason(raw) ? "Leak test fail (OP150)" : canonicalizeReason(raw));
const rowReason = (r) => {
  const raw = r.ngReason || r.rejection_reason || r.reason || r.ng_reason;
  if (!raw || raw === "-" || raw === "Quality Gate Ng") return null;
  return normalizeReason(raw);
};
const rowDie = (r) => String(r.die_name || r.dieName || "").trim().toUpperCase();
const rowPart = (r) => String(r.part_name || r.partName || "").trim();
/* Category via the shared parser — but only when the record carries a category or a reason to derive it
   from. A record with neither is "Unclassified" rather than silently defaulted to CR. */
const rowCategory = (r, reason) => {
  const rawCat = r.rejection_category || r.category
    || /Category:\s*[^|\n]+/i.test(String(r.parts_interlock_reason || r.ng_reason || r.ngReason || ""));
  if (!rawCat && !reason) return UNCLASSIFIED;
  const cat = parseRowDefect(r).category;
  return CATEGORY_KEYS.includes(cat) ? cat : UNCLASSIFIED;
};
/* Calendar day (browser local time) of the NG record. */
const rowDay = (r) => {
  const raw = r.ngRecordedAt || r.createdAt;
  if (!raw || raw === "-") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayLabel = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};
const dayRange = (keys) => {
  if (!keys.length) return [];
  const sorted = [...keys].sort();
  const [y0, m0, d0] = sorted[0].split("-").map(Number);
  const [y1, m1, d1] = sorted[sorted.length - 1].split("-").map(Number);
  const out = [];
  for (let t = new Date(y0, m0 - 1, d0), end = new Date(y1, m1 - 1, d1); t <= end && out.length < 400; t.setDate(t.getDate() + 1)) {
    out.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`);
  }
  return out;
};
const categoryFill = (k) => DEFECT_CATEGORY[k] || OTHER;
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : null);
const shiftLabel = (k) => (k === "Unassigned" ? k : `Shift ${k}`);

const dieText = (name) => `${name} · ${K12_PART}`;
/* Rate-vs-average signal: red = significantly above, green = significantly below, grey otherwise. */
const signalColor = (d) => (d.lowVolume ? OUTCOME.wip
  : d.signal === "above" ? OUTCOME.ng : d.signal === "below" ? OUTCOME.ok : ACCENT.neutral);
const signalText = (d) => (d.signal === "above" ? "Significantly above K-12 average"
  : d.signal === "below" ? "Significantly below K-12 average"
    : d.signal === "same" ? "Not significantly different from K-12 average" : "No inspected parts");

/* Y-axis labels: die name (+ "low volume" underneath when applicable). */
const dieAxisLabel = (byName) => ({
  ...axisLabel(),
  rich: {
    n: { color: INK.secondary, fontSize: 11.5, fontWeight: 600, fontFamily: FONT_FAMILY },
    lv: { color: INK.faint, fontSize: 10, fontFamily: FONT_FAMILY },
  },
  formatter: (v) => `{n|${v}}${byName[v]?.lowVolume ? "\n{lv|low volume}" : ""}`,
});
/** Tooltip rows for one die (output chart). */
const dieRows = (d) => [
  { label: "Produced", value: fmtInt(d.total_shots) },
  { label: "OK", value: fmtInt(d.ok_count), color: OUTCOME.ok },
  { label: "NG", value: fmtInt(d.ng_count), color: OUTCOME.ng },
  d.pending > 0 && { label: "In process", value: fmtInt(d.pending), color: OUTCOME.wip },
  { label: "Rejection rate", value: d.rate != null ? fmtPct(d.rate, 2) : "No inspections" },
  d.ci && { label: "95% CI", value: `${fmtPct(d.ci.lo, 2)} – ${fmtPct(d.ci.hi, 2)}` },
  { label: "vs K-12 average", value: fmtPP(d.vsPlant) },
];
const SHADOW_POINTER ={ type: "shadow", shadowStyle: { color: "rgba(15,23,42,0.04)" } };

/* ═══════════════════════════════════════════════════════════════════════════
   SMALL PIECES
   ═══════════════════════════════════════════════════════════════════════════ */
const KPI = ({ label, value, sub, color = ACCENT.neutral }) => (
  <div className="ra-kpi die-kpi" data-accent style={accent(color)}>
    <div className="ra-kpi-label">{label}</div>
    <div className="ra-kpi-value">{value}</div>
    {sub && <div className="ra-kpi-sub">{sub}</div>}
  </div>
);

/** Card shell: accent stripe, icon chip, title, one short context line, optional actions. */
const Card = ({ color, icon: Icon, title, sub, actions, children }) => (
  <div className="ra-card" data-accent style={accent(color)}>
    <div className="ra-card-head">
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span className="ra-icon">{React.createElement(Icon, { size: 16 })}</span>
        <div style={{ minWidth: 0 }}>
          <h3 className="ra-card-title">{title}</h3>
          {sub && <p className="ra-card-sub">{sub}</p>}
        </div>
      </div>
      {actions}
    </div>
    <div className="ra-card-body">{children}</div>
  </div>
);

const Legend = ({ items }) => (
  <div className="ra-legend die-legend">
    {items.filter(Boolean).map((it) => (
      <span key={it.label}><i style={it.style || { background: it.color }} />{it.label}</span>
    ))}
  </div>
);

const Empty = ({ children }) => <div className="die-empty">{children}</div>;

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
export default function DieWiseTab({
  dieStats = [],
  filteredTableRows = [],
  recordsRows = [],
  rows = [],
  summary = null,
}) {
  const defectPool = useMemo(
    () => (filteredTableRows && filteredTableRows.length > 0)
      ? filteredTableRows
      : (recordsRows.length > 0 ? recordsRows : rows),
    [filteredTableRows, recordsRows, rows]
  );

  /* ── Which dies are Oil Pan K-12 dies (explicit allow-rule) ─────────────
     A die is kept when its loaded records carry a K-12 part_name; a die whose records carry no
     part_name at all falls back to the known K-12 list. Everything else (e.g. S5 on C0PK15C) is excluded. */
  const partsByDie = useMemo(() => {
    const m = {};
    defectPool.forEach((r) => {
      const die = rowDie(r);
      const part = rowPart(r);
      if (!die || !part) return;
      if (!m[die]) m[die] = {};
      m[die][part] = (m[die][part] || 0) + 1;
    });
    return m;
  }, [defectPool]);
  const isK12Die = useMemo(() => (die) => {
    const parts = partsByDie[die];
    if (parts && Object.keys(parts).length) return Object.keys(parts).some(isK12Part);
    return KNOWN_K12_DIES.includes(die);
  }, [partsByDie]);

  /* ── Normalised die stats (SQL, K-12 dies only) ─────────────────────── */
  const { dies, excludedDies, namedDieShots } = useMemo(() => {
    if (!Array.isArray(dieStats) || dieStats.length === 0) return { dies: [], excludedDies: [], namedDieShots: 0 };
    const mapped = dieStats.map((d) => {
      const rawName = String(d.die_name || d.dieName || d.die || "").trim().toUpperCase();
      const ok = Number(d.ok_count ?? d.totalOK ?? d.ok ?? 0) || 0;
      const ng = Number(d.ng_count ?? d.totalNG ?? d.ng ?? 0) || 0;
      const totalRaw = Number(d.total_shots ?? d.totalParts ?? d.total);
      const inspected = ok + ng;
      const total = Number.isFinite(totalRaw) ? Math.max(totalRaw, inspected) : inspected;
      const pending = Math.max(0, total - inspected);
      const rate = inspected > 0 ? (ng / inspected) * 100 : null;
      return {
        die_name: rawName && rawName !== "UNKNOWN" && rawName !== "-" ? rawName : "",
        total_shots: total, ok_count: ok, ng_count: ng, pending, inspected, rate,
        ci: wilson(ng, inspected),
        lowVolume: inspected < MIN_INSPECTED_FOR_RANK,
      };
    }).filter((d) => d.die_name);
    return {
      dies: mapped.filter((d) => isK12Die(d.die_name)),
      excludedDies: mapped.filter((d) => !isK12Die(d.die_name)),
      namedDieShots: sum(mapped.map((d) => d.total_shots)),
    };
  }, [dieStats, isK12Die]);

  /* One stable die → colour map (known K-12 dies first, then any other by name). Used for the trend lines. */
  const dieColor = useMemo(() => {
    const extra = dies.map((d) => d.die_name).filter((n) => !KNOWN_K12_DIES.includes(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return makeColorMap([...KNOWN_K12_DIES, ...extra]);
  }, [dies]);

  /* ── K-12 totals (pooled over K-12 dies) ────────────────────────────── */
  const plant = useMemo(() => {
    const total = sum(dies.map((d) => d.total_shots));
    const ok = sum(dies.map((d) => d.ok_count));
    const ng = sum(dies.map((d) => d.ng_count));
    const pending = sum(dies.map((d) => d.pending));
    const inspected = ok + ng;
    return { total, ok, ng, pending, inspected, rate: inspected > 0 ? (ng / inspected) * 100 : null, ci: wilson(ng, inspected) };
  }, [dies]);

  /* Display order: ranked dies by rejection rate (worst first), then low-volume, then not inspected. */
  const ordered = useMemo(() => {
    const group = (d) => (d.rate == null ? 2 : d.lowVolume ? 1 : 0);
    return [...dies]
      .sort((a, b) => group(a) - group(b) || (b.rate ?? -1) - (a.rate ?? -1) || b.inspected - a.inspected)
      .map((d) => {
        const vsPlant = d.rate != null && plant.rate != null ? d.rate - plant.rate : null;
        let signal = "none";
        if (d.ci && plant.rate != null) signal = d.ci.lo > plant.rate ? "above" : d.ci.hi < plant.rate ? "below" : "same";
        return { ...d, vsPlant, signal, shareOfNg: pctOf(d.ng_count, plant.ng) };
      });
  }, [dies, plant]);
  const byName = useMemo(() => Object.fromEntries(ordered.map((d) => [d.die_name, d])), [ordered]);

  const ranked = useMemo(() => ordered.filter((d) => d.rate != null && !d.lowVolume), [ordered]);
  const worst = ranked.length >= 2 ? ranked[0] : null;

  /* ── NG records per K-12 die: reasons, categories, shifts, days ── */
  const defects = useMemo(() => {
    const dieSet = new Set(dies.map((d) => d.die_name));
    const perDie = {};
    const reasonTotals = {};
    const catTotals = { CR: 0, CRAM: 0, MR: 0, [UNCLASSIFIED]: 0 };
    const dayKeys = new Set();
    const k12Records = [];
    let noDie = 0;
    let otherDie = 0;
    let noDay = 0;
    defectPool.forEach((r) => {
      const die = rowDie(r);
      if (!die) { noDie += 1; return; }
      const part = rowPart(r);
      if (!dieSet.has(die) || (part && !isK12Part(part))) { otherDie += 1; return; }
      k12Records.push(r);
      const reason = rowReason(r);
      const cat = rowCategory(r, reason);
      const shift = shiftKey(r.shift_code || r.shiftCode);
      const day = rowDay(r);
      if (!perDie[die]) {
        perDie[die] = {
          records: 0, reasons: {}, cats: { CR: 0, CRAM: 0, MR: 0, [UNCLASSIFIED]: 0 },
          shifts: { A: 0, B: 0, C: 0, Unassigned: 0 }, days: {},
        };
      }
      const p = perDie[die];
      p.records += 1;
      p.cats[cat] += 1;
      catTotals[cat] += 1;
      const rk = reason || NO_REASON;
      p.reasons[rk] = (p.reasons[rk] || 0) + 1;
      if (reason) reasonTotals[reason] = (reasonTotals[reason] || 0) + 1;
      p.shifts[shift] += 1;
      if (day) { p.days[day] = (p.days[day] || 0) + 1; dayKeys.add(day); } else noDay += 1;
    });
    const reasonOrder = Object.entries(reasonTotals).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return {
      perDie, reasonOrder, reasonTotals, catTotals, matched: k12Records.length, noDie, otherDie, noDay,
      days: dayRange([...dayKeys]), k12Records,
    };
  }, [defectPool, dies]);

  /* No-die production: parts in the window without a die_name (summary total − Σ named-die totals). */
  const noDieParts = useMemo(() => {
    const total = Number(summary?.totalProduction ?? summary?.totalParts);
    return Number.isFinite(total) && total > 0 ? Math.max(0, total - namedDieShots) : null;
  }, [summary, namedDieShots]);

  const topOf = (obj, skip = []) => {
    const e = Object.entries(obj || {}).filter(([k, v]) => v > 0 && !skip.includes(k)).sort((a, b) => b[1] - a[1]);
    return e.length ? { key: e[0][0], count: e[0][1] } : null;
  };

  /* Dies that have NG records (record-based charts). */
  const recDies = useMemo(() => ordered.filter((d) => defects.perDie[d.die_name]?.records > 0), [ordered, defects]);
  const hasPending = ordered.some((d) => d.pending > 0);

  /* ═══ ECharts options ═══════════════════════════════════════════════════ */
  /* (1a) Output by die — stacked OK / NG / in process */
  const outputOption = useMemo(() => {
    if (!ordered.length) return null;
    const names = ordered.map((d) => d.die_name);
    const stack = [
      { key: "ok_count", name: "OK", color: OUTCOME.ok },
      { key: "ng_count", name: "NG", color: OUTCOME.ng },
      ...(hasPending ? [{ key: "pending", name: "In process", color: OUTCOME.wip }] : []),
    ];
    return baseOption({
      grid: { left: 8, right: 56, top: 8, bottom: 36, containLabel: true },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis", axisPointer: SHADOW_POINTER,
        formatter: (ps) => {
          const d = ordered[ps[0]?.dataIndex ?? 0];
          return d ? tooltipHtml({ title: dieText(d.die_name), rows: dieRows(d) }) : "";
        },
      },
      xAxis: valueAxis({ axisLabel: axisLabel({ formatter: (v) => Number(v).toLocaleString() }), ...axisName("Parts", 26) }),
      yAxis: categoryAxis(names, { inverse: true, axisLabel: dieAxisLabel(byName), axisLine: { show: false } }),
      series: stack.map((s, i) => ({
        type: "bar", name: s.name, stack: "parts", barMaxWidth: 26,
        data: ordered.map((d) => d[s.key]),
        itemStyle: { color: s.color },
        emphasis: { focus: "series" },
        label: i === stack.length - 1 ? {
          show: true, position: "right", color: INK.secondary, fontSize: 10.5, fontWeight: 600,
          formatter: (p) => fmtInt(ordered[p.dataIndex].total_shots),
        } : undefined,
      })),
    });
  }, [ordered, hasPending, byName]);

  /* (1b) Rejection rate with 95 % Wilson CI */
  const ciDies = useMemo(() => ordered.filter((d) => d.ci), [ordered]);
  const ciOption = useMemo(() => {
    if (!ciDies.length) return null;
    // Scale to the ranked dies so one low-volume die (very wide interval) does not squash the rest;
    // anything beyond the axis is clipped and marked with an arrow.
    const scaleSet = ciDies.some((d) => !d.lowVolume) ? ciDies.filter((d) => !d.lowVolume) : ciDies;
    const xMax = Math.min(100, Math.ceil(Math.max(1, ...scaleSet.map((d) => d.ci.hi), plant.rate ?? 0) * 1.15));
    const clip = (v) => Math.min(v, xMax);
    const names = ciDies.map((d) => d.die_name);
    return baseOption({
      grid: { left: 8, right: 28, top: 24, bottom: 36, containLabel: true },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (p) => {
          const d = ciDies[p.dataIndex];
          if (!d) return "";
          return tooltipHtml({
            title: dieText(d.die_name),
            subtitle: d.lowVolume ? `Low volume (< ${MIN_INSPECTED_FOR_RANK} inspected) — not ranked` : signalText(d),
            rows: [
              { label: "Inspected (OK + NG)", value: fmtInt(d.inspected) },
              { label: "NG", value: fmtInt(d.ng_count), color: OUTCOME.ng },
              { label: "Rejection rate", value: fmtPct(d.rate, 2) },
              { label: "95% CI (Wilson)", value: `${fmtPct(d.ci.lo, 2)} – ${fmtPct(d.ci.hi, 2)}` },
              { label: "K-12 average", value: fmtPct(plant.rate, 2), color: AVG_LINE },
              { label: "vs K-12 average", value: fmtPP(d.vsPlant) },
            ],
          });
        },
      },
      xAxis: valueAxis({ min: 0, max: xMax, axisLabel: axisLabel({ formatter: (v) => `${v}%` }), ...axisName("Rejection rate (%)", 26) }),
      yAxis: categoryAxis(names, { inverse: true, axisLabel: dieAxisLabel(byName), axisLine: { show: false } }),
      series: [
        {
          type: "custom",
          name: "95% CI",
          encode: { x: [0, 1], y: 2 },
          data: ciDies.map((d, i) => [clip(d.ci.lo), clip(d.ci.hi), i]),
          renderItem: (params, api) => {
            const d = ciDies[params.dataIndex];
            const lo = api.coord([api.value(0), api.value(2)]);
            const hi = api.coord([api.value(1), api.value(2)]);
            const cap = 6;
            const clipped = d.ci.hi > xMax;
            const style = { stroke: signalColor(d), lineWidth: 2, lineCap: "round" };
            const end = clipped
              ? { type: "polyline", shape: { points: [[hi[0] - 7, hi[1] - 5], [hi[0], hi[1]], [hi[0] - 7, hi[1] + 5]] }, style }
              : { type: "line", shape: { x1: hi[0], y1: hi[1] - cap, x2: hi[0], y2: hi[1] + cap }, style };
            return {
              type: "group",
              children: [
                { type: "line", shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style },
                { type: "line", shape: { x1: lo[0], y1: lo[1] - cap, x2: lo[0], y2: lo[1] + cap }, style },
                end,
              ],
            };
          },
          z: 2,
        },
        {
          type: "scatter",
          name: "Rejection rate",
          symbolSize: 12,
          z: 3,
          data: ciDies.map((d, i) => ({
            value: [clip(d.rate), i],
            itemStyle: d.lowVolume
              ? { color: "#fff", borderColor: OUTCOME.wip, borderWidth: 2 }
              : { color: signalColor(d), borderColor: "#fff", borderWidth: 2 },
          })),
          label: { show: true, position: "top", distance: 5, formatter: (p) => { const d = ciDies[p.dataIndex]; return `${fmtPct(d.rate, 2)}${d.rate > xMax ? " ▸" : ""}`; }, color: INK.secondary, fontSize: 10.5, fontWeight: 600 },
          markLine: plant.rate != null ? {
            symbol: "none", silent: true,
            lineStyle: { color: AVG_LINE, type: [4, 3], width: 1.5 },
            label: { formatter: `K-12 avg ${fmtPct(plant.rate, 2)}`, color: AVG_LINE, fontWeight: 700, fontSize: 10.5, position: "start", distance: 4 },
            data: [{ xAxis: plant.rate }],
          } : undefined,
        },
      ],
    });
  }, [ciDies, plant.rate, byName]);

  /* (2) Daily NG trend per die */
  const trendOption = useMemo(() => {
    if (!recDies.length || !defects.days.length) return null;
    const days = defects.days;
    const dayTotals = days.map((k) => sum(recDies.map((d) => defects.perDie[d.die_name].days[k] || 0)));
    const zoom = days.length > 21;
    return baseOption({
      grid: { left: 8, right: 16, top: 36, bottom: zoom ? 56 : 12, containLabel: true },
      legend: { ...LEGEND, type: "scroll", data: recDies.map((d) => d.die_name) },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: INK.axis } },
        formatter: (ps) => {
          const i = ps[0]?.dataIndex ?? 0;
          const tot = dayTotals[i];
          return tooltipHtml({
            title: dayLabel(days[i]),
            subtitle: `${fmtInt(tot)} NG records on K-12 dies`,
            rows: ps.map((p) => ({ label: dieText(p.seriesName), color: p.color, value: fmtInt(p.value) })),
          });
        },
      },
      xAxis: categoryAxis(days.map(dayLabel), { boundaryGap: false }),
      yAxis: valueAxis({ minInterval: 1, ...axisName("NG / day", 32) }),
      dataZoom: zoom ? [{ type: "inside" }, { type: "slider", height: 14, bottom: 6, borderColor: INK.border, fillerColor: withAlpha(ACCENT.process, 0.12), handleSize: 14, showDetail: false }] : undefined,
      series: recDies.map((d) => ({
        type: "line",
        name: d.die_name,
        data: days.map((k) => defects.perDie[d.die_name].days[k] || 0),
        smooth: 0.25,
        symbol: "circle",
        symbolSize: 5,
        showSymbol: days.length <= 45,
        lineStyle: { width: 2, color: dieColor(d.die_name) },
        itemStyle: { color: dieColor(d.die_name) },
        emphasis: { focus: "series" },
      })),
    });
  }, [recDies, defects, dieColor]);

  /* (3) Per-die Pareto of top defects */
  const [paretoPick, setParetoPick] = useState("");
  const paretoDie = useMemo(() => {
    if (recDies.some((d) => d.die_name === paretoPick)) return paretoPick;
    const top = [...recDies].sort((a, b) => defects.perDie[b.die_name].records - defects.perDie[a.die_name].records)[0];
    return top ? top.die_name : "";
  }, [paretoPick, recDies, defects]);
  const pareto = useMemo(() => {
    const p = paretoDie ? defects.perDie[paretoDie] : null;
    if (!p || !p.records) return null;
    const entries = Object.entries(p.reasons).sort((a, b) => b[1] - a[1]);
    const items = entries.slice(0, PARETO_TOP).map(([reason, count]) => ({ reason, count }));
    const rest = entries.slice(PARETO_TOP);
    if (rest.length) items.push({ reason: `Other (${rest.length} reasons)`, count: sum(rest.map((e) => e[1])), other: true });
    let cum = 0;
    return {
      total: p.records,
      items: items.map((it) => {
        const before = cum;
        cum += it.count;
        // vital few = every bar up to and including the one where the cumulative line crosses 80 %
        return { ...it, pct: (it.count / p.records) * 100, cum: (cum / p.records) * 100, vital: (before / p.records) * 100 < PARETO_CUTOFF };
      }),
    };
  }, [paretoDie, defects]);
  const paretoOption = useMemo(() => {
    if (!pareto) return null;
    const colorFor = (it) => (it.vital ? OUTCOME.ng : NG_LIGHT);
    const short = (s) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);
    return baseOption({
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      legend: {
        ...LEGEND,
        data: [
          { name: "Share of die NG", itemStyle: { color: OUTCOME.ng } },
          { name: "Cumulative %", itemStyle: { color: INK.primary } },
        ],
      },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis", axisPointer: SHADOW_POINTER,
        formatter: (ps) => {
          const it = pareto.items[ps[0]?.dataIndex ?? 0];
          const plantReason = defects.reasonTotals[it.reason];
          return tooltipHtml({
            title: it.reason,
            subtitle: `${dieText(paretoDie)} · ${it.vital ? "vital few" : "remaining"}`,
            rows: [
              { label: "NG records", value: fmtInt(it.count), color: colorFor(it) },
              { label: "Share of die NG", value: fmtPct(it.pct) },
              { label: "Cumulative", value: fmtPct(it.cum), color: INK.primary },
              plantReason ? { label: "Die's share of K-12 total", value: `${fmtPct(pctOf(it.count, plantReason))} of ${fmtInt(plantReason)}` } : null,
            ],
          });
        },
      },
      xAxis: categoryAxis(pareto.items.map((it) => it.reason), { axisLabel: axisLabel({ interval: 0, rotate: pareto.items.length > 4 ? 35 : 0, formatter: short }) }),
      yAxis: valueAxis({ min: 0, max: 100, interval: 20, axisLabel: axisLabel({ formatter: (v) => `${v}%` }) }),
      series: [
        {
          type: "bar", name: "Share of die NG", barMaxWidth: 34,
          data: pareto.items.map((it) => ({ value: Number(it.pct.toFixed(2)), itemStyle: { color: colorFor(it), borderRadius: [3, 3, 0, 0] } })),
          label: { show: true, position: "top", color: INK.secondary, fontSize: 10.5, fontWeight: 600, formatter: (p) => fmtInt(pareto.items[p.dataIndex].count) },
        },
        {
          type: "line", name: "Cumulative %", data: pareto.items.map((it) => Number(it.cum.toFixed(2))),
          symbol: "circle", symbolSize: 6,
          lineStyle: { color: INK.primary, width: 2 }, itemStyle: { color: INK.primary, borderColor: "#fff", borderWidth: 1.5 },
          markLine: {
            symbol: "none", silent: true, lineStyle: { color: INK.faint, type: [4, 3], width: 1.25 },
            label: { formatter: `${PARETO_CUTOFF}%`, color: INK.muted, fontWeight: 700, fontSize: 10.5, position: "end" },
            data: [{ yAxis: PARETO_CUTOFF }],
          },
        },
      ],
    });
  }, [pareto, paretoDie, defects]);

  /* (4) Defect-category mix per die — 100 % stacked bars */
  const catKeys = useMemo(
    () => [...CATEGORY_KEYS, UNCLASSIFIED].filter((k) => defects.catTotals[k] > 0),
    [defects.catTotals]
  );
  const catOption = useMemo(() => {
    if (!recDies.length || !catKeys.length) return null;
    const names = recDies.map((d) => d.die_name);
    return baseOption({
      grid: { left: 8, right: 16, top: 8, bottom: 30, containLabel: true },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis", axisPointer: SHADOW_POINTER,
        formatter: (ps) => {
          const d = recDies[ps[0]?.dataIndex ?? 0];
          const p = defects.perDie[d.die_name];
          return tooltipHtml({
            title: dieText(d.die_name),
            subtitle: `${fmtInt(p.records)} NG records`,
            rows: catKeys.map((k) => ({ label: k, color: categoryFill(k), value: `${fmtInt(p.cats[k])} · ${fmtPct(pctOf(p.cats[k], p.records), 0)}` })),
          });
        },
      },
      xAxis: valueAxis({ min: 0, max: 100, interval: 25, axisLabel: axisLabel({ formatter: (v) => `${v}%` }) }),
      yAxis: categoryAxis(names, { inverse: true, axisLabel: dieAxisLabel(byName), axisLine: { show: false } }),
      series: catKeys.map((k) => ({
        type: "bar", name: k, stack: "cat", barMaxWidth: 26,
        data: recDies.map((d) => {
          const p = defects.perDie[d.die_name];
          return Number((pctOf(p.cats[k], p.records) || 0).toFixed(2));
        }),
        itemStyle: { color: categoryFill(k) },
        label: { show: true, position: "inside", color: "#fff", fontSize: 10.5, fontWeight: 600, formatter: (p) => (p.value >= 9 ? `${Math.round(p.value)}%` : "") },
        emphasis: { focus: "series" },
      })),
    });
  }, [recDies, catKeys, defects, byName]);

  /* (5) Die × shift grouped bars */
  const shiftsPresent = useMemo(
    () => SHIFT_KEYS.filter((k) => recDies.some((d) => defects.perDie[d.die_name].shifts[k] > 0)),
    [recDies, defects]
  );
  const shiftOption = useMemo(() => {
    if (!recDies.length || !shiftsPresent.length) return null;
    return baseOption({
      grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
      legend: { ...LEGEND, data: shiftsPresent.map(shiftLabel) },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis", axisPointer: SHADOW_POINTER,
        formatter: (ps) => {
          const d = recDies[ps[0]?.dataIndex ?? 0];
          const tot = defects.perDie[d.die_name].records;
          return tooltipHtml({
            title: dieText(d.die_name),
            subtitle: `${fmtInt(tot)} NG records`,
            rows: ps.map((p) => ({ label: p.seriesName, color: p.color, value: `${fmtInt(p.value)} · ${fmtPct(pctOf(p.value, tot), 0)}` })),
          });
        },
      },
      xAxis: categoryAxis(recDies.map((d) => d.die_name), { axisLabel: axisLabel({ interval: 0, fontWeight: 600, color: INK.secondary }) }),
      yAxis: valueAxis({ minInterval: 1, ...axisName("NG records", 34) }),
      series: shiftsPresent.map((k) => ({
        type: "bar",
        name: shiftLabel(k),
        data: recDies.map((d) => defects.perDie[d.die_name].shifts[k]),
        barMaxWidth: 26,
        barGap: "12%",
        itemStyle: { color: SHIFT[k], borderRadius: [3, 3, 0, 0] },
        label: { show: recDies.length * shiftsPresent.length <= 16, position: "top", color: INK.secondary, fontSize: 10, fontWeight: 600, formatter: (p) => (p.value ? fmtInt(p.value) : "") },
        emphasis: { focus: "series" },
      })),
    });
  }, [recDies, shiftsPresent, defects]);

  /* ── Excel export (K-12 dies only) ──────────────────────────────────── */
  const handleExportDieExcel = async () => {
    if (!dies.length) return;
    const workbook = new ExcelJS.Workbook();
    const headerStyle = (row) => {
      row.font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    };

    const summarySheet = workbook.addWorksheet("Die Performance");
    summarySheet.columns = [
      { header: "Die", key: "die_name", width: 16 },
      { header: "Part", key: "part", width: 10 },
      { header: "Produced", key: "total_shots", width: 12 },
      { header: "OK Parts", key: "ok_count", width: 12 },
      { header: "NG Parts", key: "ng_count", width: 12 },
      { header: "In Process", key: "pending", width: 12 },
      { header: "Inspected (OK + NG)", key: "inspected", width: 20 },
      { header: "Rejection Rate (%)", key: "rate", width: 18 },
      { header: "95% CI Low (%)", key: "ciLo", width: 15 },
      { header: "95% CI High (%)", key: "ciHi", width: 15 },
      { header: "Vs K-12 Average (pp)", key: "vsPlant", width: 20 },
      { header: "Share of K-12 NG (%)", key: "share", width: 20 },
      { header: "NG Records Loaded", key: "records", width: 18 },
      { header: "Note", key: "note", width: 34 },
    ];
    headerStyle(summarySheet.getRow(1));
    const r2 = (v) => (v != null && Number.isFinite(v) ? Number(v.toFixed(2)) : "-");
    ordered.forEach((d) => {
      summarySheet.addRow({
        die_name: d.die_name, part: K12_PART, total_shots: d.total_shots, ok_count: d.ok_count,
        ng_count: d.ng_count, pending: d.pending, inspected: d.inspected,
        rate: r2(d.rate), ciLo: r2(d.ci?.lo), ciHi: r2(d.ci?.hi), vsPlant: r2(d.vsPlant), share: r2(d.shareOfNg),
        records: defects.perDie[d.die_name]?.records || 0,
        note: d.rate == null ? "No inspected parts" : d.lowVolume ? `Low volume (< ${MIN_INSPECTED_FOR_RANK} inspected)` : signalText(d),
      });
    });
    summarySheet.addRow({});
    summarySheet.addRow({ die_name: "Scope", part: "Oil Pan K-12 dies only (OPK12)" });
    if (noDieParts != null) summarySheet.addRow({ die_name: "No die recorded", total_shots: noDieParts, note: `${defects.noDie} NG records without a die name` });

    const defectSheet = workbook.addWorksheet("Defects by Die");
    defectSheet.columns = [
      { header: "Die", key: "die", width: 16 },
      { header: "Defect Reason", key: "reason", width: 34 },
      { header: "Count", key: "count", width: 12 },
      { header: "Category", key: "category", width: 14 },
    ];
    headerStyle(defectSheet.getRow(1));
    ordered.forEach((die) => {
      const map = {};
      defects.k12Records.filter((r) => rowDie(r) === die.die_name).forEach((r) => {
        const reason = rowReason(r);
        if (!reason) return;
        const cat = rowCategory(r, reason);
        const key = `${reason}__${cat}`;
        if (!map[key]) map[key] = { reason, category: cat, count: 0 };
        map[key].count += 1;
      });
      Object.values(map).sort((a, b) => b.count - a.count).forEach((item) => {
        defectSheet.addRow({ die: dieText(die.die_name), reason: item.reason, count: item.count, category: item.category });
      });
    });

    const logSheet = workbook.addWorksheet("Scrap Parts Log");
    logSheet.columns = [
      { header: "Part ID (DMC Serial)", key: "partId", width: 28 },
      { header: "Customer QR Code", key: "customerCode", width: 32 },
      { header: "Shot Number", key: "shotNumber", width: 14 },
      { header: "Die", key: "die_name", width: 14 },
      { header: "Part", key: "part_name", width: 12 },
      { header: "NG Station", key: "ng_station", width: 24 },
      { header: "Rejection Reason", key: "ngReason", width: 32 },
      { header: "Body Leak Value", key: "leakValue", width: 16 },
      { header: "Category", key: "rejection_category", width: 14 },
      { header: "View", key: "rejection_view", width: 16 },
      { header: "Zone", key: "rejection_zone", width: 16 },
      { header: "Sub Zone", key: "rejection_sub_zone", width: 16 },
      { header: "Recorded At", key: "shot_datetime", width: 22 },
    ];
    headerStyle(logSheet.getRow(1));

    defects.k12Records.slice(0, 5000).forEach((r) => {
      const rawPartId = String(r.barcode || r.partId || r.part_id || "").trim();
      const rawCustomerQr = String(r.customerCode || r.customerQrCode || r.customer_qr || "").trim();
      const isQrInPartId = looksLikeCustomerQr(rawPartId) || rawPartId === rawCustomerQr;
      const displayPartId = !isQrInPartId && rawPartId && rawPartId !== "-" ? rawPartId : "—";
      const displayCustomerQr = rawCustomerQr !== "-" && rawCustomerQr ? rawCustomerQr : (isQrInPartId && rawPartId ? rawPartId : "—");
      const isCasted = displayPartId !== "—" && !looksLikeCustomerQr(displayPartId);
      const shotNum = isCasted ? (r.shot_number || r.shotNumber || extractShotFromPartId(displayPartId) || "—") : "—";
      const decodedShotDate = isCasted ? extractShotDateTimeFromPartId(displayPartId) : null;
      const rawShotDate = decodedShotDate || r.shot_datetime || r.ngRecordedAt || r.final_scan_at || r.first_scan_at || r.createdAt;
      const shotDateTime = rawShotDate && rawShotDate !== "-" ? formatResultTimestamp(rawShotDate) : "—";
      const rawReason = r.ngReason || r.rejection_reason || r.reason || r.ng_reason;
      const leakVal = r.leak_body_leak_value ?? r.leakBodyValue;

      let z = r.rejection_zone || r.zone || r.rejectionZone || "—";
      if (String(z).toLowerCase().includes("leak") || String(z).toLowerCase().includes("150")) z = "Leak Test";

      logSheet.addRow({
        partId: displayPartId, customerCode: displayCustomerQr, shotNumber: shotNum,
        die_name: rowDie(r) || "-", part_name: rowPart(r) || "-",
        ng_station: r.ng_station || r.ngStation || r.machine_name || r.machineName || "-",
        ngReason: rawReason && rawReason !== "-" ? normalizeReason(rawReason) : "-",
        leakValue: leakVal != null && leakVal !== "" && leakVal !== "-" ? leakVal : "-",
        rejection_category: r.rejection_category || r.category || "-",
        rejection_view: r.rejection_view || r.view || "-", rejection_zone: z,
        rejection_sub_zone: r.rejection_sub_zone || r.subZone || "-", shot_datetime: shotDateTime,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Die_Scrap_Report_K12_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  /* Chart geometry */
  const rowsHeight = (n, per = 44, pad = 64) => Math.max(180, n * per + pad);
  const dieChartHeight = rowsHeight(ordered.length);
  const recordsGap = defects.matched - plant.ng;
  const scopeBits = [
    excludedDies.length > 0 && `excluded: ${excludedDies.map((d) => d.die_name).join(", ")}`,
    noDieParts != null && noDieParts > 0 && `${fmtInt(noDieParts)} parts without a die`,
  ].filter(Boolean);

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="die-root">
      <style>{CARD_CSS}{`
        .die-root { display: flex; flex-direction: column; gap: 16px; font-family: ${FONT_FAMILY}; min-width: 0; }
        .die-root * { box-sizing: border-box; }
        .die-scope { font-size: 12px; color: ${INK.muted}; margin: 0 2px; }
        .die-scope b { color: ${INK.secondary}; font-weight: 600; }
        .die-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
        .ra-kpi.die-kpi { box-shadow: 0 1px 2px rgba(15,23,42,.04); }
        .die-empty { min-height: 160px; display: grid; place-content: center; color: ${INK.faint}; font-size: 12px; text-align: center; padding: 16px; }
        .die-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 600; background: #fff; color: ${INK.secondary}; border: 1px solid ${INK.axis}; cursor: pointer; font-family: inherit; }
        .die-btn:hover:not(:disabled) { border-color: ${INK.faint}; color: ${INK.primary}; }
        .die-btn:disabled { opacity: .4; cursor: not-allowed; }
        .die-select { max-width: 100%; padding: 5px 10px; border-radius: 8px; border: 1px solid ${INK.axis}; font-size: 12px; font-weight: 600; color: ${INK.primary}; background: #fff; font-family: inherit; }
        .die-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
        @media (max-width: 1100px) { .die-split { grid-template-columns: 1fr; } }
        .die-panel-head { display: flex; justify-content: space-between; gap: 6px 12px; flex-wrap: wrap; align-items: baseline; margin: 0 4px 4px; }
        .die-panel-title { font-size: 12.5px; font-weight: 600; color: ${INK.body}; margin: 0; }
        .die-legend { font-size: 11px; gap: 6px 12px; }
        .die-table-wrap { overflow-x: auto; max-width: 100%; }
        .die-table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
        .die-table th { background: ${INK.surfaceAlt}; padding: 8px 10px; text-align: right; font-size: 11px; font-weight: 600; color: ${INK.muted}; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; border-bottom: 1px solid ${INK.border}; }
        .die-table td { padding: 8px 10px; text-align: right; border-bottom: 1px solid ${INK.grid}; color: ${INK.secondary}; white-space: nowrap; }
        .die-table th.left, .die-table td.left { text-align: left; }
        .die-table tbody tr:hover td { background: ${INK.surfaceAlt}; }
        .die-table tfoot td { font-weight: 700; color: ${INK.primary}; background: ${INK.surfaceAlt}; border-top: 1px solid ${INK.border}; border-bottom: none; }
        .die-name { font-weight: 600; color: ${INK.primary}; }
        .die-lv { margin-left: 6px; font-size: 10.5px; color: ${INK.faint}; font-weight: 500; }
      `}</style>

      {/* ═══ SCOPE (one line) ═══ */}
      <div className="die-scope">
        <b>Oil Pan K-12 ({K12_PART}) dies only</b>{scopeBits.length ? ` · ${scopeBits.join(" · ")}` : ""}
      </div>

      {/* ═══ KPI ROW ═══ */}
      <div className="die-kpi-row">
        <KPI label="Produced" value={fmtInt(plant.total)} sub={plant.pending > 0 ? `${fmtInt(plant.pending)} in process` : undefined} color={ACCENT.neutral} />
        <KPI label="OK parts" value={fmtInt(plant.ok)} color={OUTCOME.ok} />
        <KPI label="NG parts" value={fmtInt(plant.ng)} color={OUTCOME.ng} />
        <KPI label="Rejection rate" value={fmtPct(plant.rate, 2)} color={OUTCOME.ng} />
        <KPI
          label="Highest-rate die" value={worst ? worst.die_name : "—"}
          sub={worst ? `${fmtPct(worst.rate, 2)} · ${fmtPP(worst.vsPlant)}` : undefined}
          color={worst ? OUTCOME.ng : ACCENT.neutral}
        />
      </div>

      {/* ═══ (1) OUTPUT + RATE WITH CI ═══ */}
      <Card
        color={OUTCOME.ng} icon={BarChart3} title="Output and rejection rate by die"
        sub={`Worst rate first · rate = NG ÷ (OK + NG) · dies under ${MIN_INSPECTED_FOR_RANK} inspected are not ranked${recordsGap > 0 ? ` · ${fmtInt(recordsGap)} NG records still in process not counted` : ""}`}
        actions={(
          <button type="button" onClick={handleExportDieExcel} className="die-btn" disabled={!dies.length}>
            <FileSpreadsheet size={14} /> Excel
          </button>
        )}
      >
        {ordered.length === 0 ? (
          <Empty>No K-12 die statistics for the selected filters.</Empty>
        ) : (
          <div className="die-split">
            <div style={{ minWidth: 0 }}>
              <div className="die-panel-head">
                <h4 className="die-panel-title">Parts produced</h4>
                <Legend items={[
                  { label: "OK", color: OUTCOME.ok },
                  { label: "NG", color: OUTCOME.ng },
                  hasPending && { label: "In process", color: OUTCOME.wip },
                ]} />
              </div>
              <EChart option={outputOption} style={{ height: dieChartHeight }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="die-panel-head">
                <h4 className="die-panel-title">Rejection rate, 95% CI</h4>
                <Legend items={[
                  { label: "Above avg", style: { background: OUTCOME.ng, borderRadius: 99 } },
                  { label: "Not significant", style: { background: ACCENT.neutral, borderRadius: 99 } },
                  { label: "Below avg", style: { background: OUTCOME.ok, borderRadius: 99 } },
                  { label: "K-12 avg", style: { background: "transparent", borderTop: `2px dashed ${AVG_LINE}`, height: 0, borderRadius: 0 } },
                ]} />
              </div>
              {ciOption ? <EChart option={ciOption} style={{ height: Math.max(dieChartHeight, rowsHeight(ciDies.length, 50, 70)) }} /> : <Empty>No inspected parts.</Empty>}
            </div>
          </div>
        )}
      </Card>

      {/* ═══ (2) DAILY TREND ═══ */}
      <Card
        color={ACCENT.process} icon={LineChartIcon} title="Daily NG trend by die"
        sub={`NG records per day by recorded date (count, not rate)${defects.noDay ? ` · ${fmtInt(defects.noDay)} undated not shown` : ""}`}
      >
        {trendOption ? <EChart option={trendOption} style={{ height: 300 }} /> : <Empty>No dated NG records on K-12 dies.</Empty>}
      </Card>

      {/* ═══ (3) PARETO ═══ */}
      <Card
        color={OUTCOME.ng} icon={ListOrdered} title="Top defects by die (Pareto)"
        sub={`Dark red = vital few up to ${PARETO_CUTOFF}% cumulative · bar label = NG count`}
        actions={recDies.length > 0 ? (
          <select className="die-select" value={paretoDie} onChange={(e) => setParetoPick(e.target.value)} aria-label="Die for Pareto">
            {recDies.map((d) => <option key={d.die_name} value={d.die_name}>{dieText(d.die_name)} ({fmtInt(defects.perDie[d.die_name].records)})</option>)}
          </select>
        ) : null}
      >
        {paretoOption ? <EChart option={paretoOption} style={{ height: 340 }} /> : <Empty>No NG records on K-12 dies.</Empty>}
      </Card>

      {/* ═══ (4) CATEGORY MIX + (5) SHIFT ═══ */}
      <div className="ra-grid2">
        <Card
          color={DEFECT_CATEGORY.CRAM} icon={PieChart} title="Defect category mix by die"
          sub="Share of each die's NG records by category"
          actions={catKeys.length ? (
            <Legend items={catKeys.map((k) => ({ label: k, color: categoryFill(k) }))} />
          ) : null}
        >
          {catOption ? <EChart option={catOption} style={{ height: rowsHeight(recDies.length, 44, 50) }} /> : <Empty>No NG records on K-12 dies.</Empty>}
          {catKeys.length > 0 && (
            <div className="die-scope" style={{ marginTop: 2 }} title={catKeys.map((k) => DEFECT_CATEGORY_LABEL[k] || "Unclassified = no category and no reason").join("\n")}>
              {catKeys.map((k) => `${k} ${fmtPct(pctOf(defects.catTotals[k], defects.matched), 0)}`).join(" · ")} of all K-12 NG records
            </div>
          )}
        </Card>
        <Card
          color={SHIFT.B} icon={Clock} title="NG by shift and die"
          sub="NG records per shift code on the record"
        >
          {shiftOption ? <EChart option={shiftOption} style={{ height: 300 }} /> : <Empty>No NG records on K-12 dies.</Empty>}
        </Card>
      </div>

      {/* ═══ COMPARISON TABLE ═══ */}
      <Card
        color={ACCENT.neutral} icon={Table} title="Die comparison"
        sub={`Exact figures · vs K-12 = difference from the K-12 average (${fmtPct(plant.rate, 2)}) in percentage points`}
      >
        {ordered.length === 0 ? (
          <Empty>No dies to compare.</Empty>
        ) : (
          <div className="die-table-wrap">
            <table className="die-table">
              <thead>
                <tr>
                  <th className="left">Die</th>
                  <th>Produced</th>
                  <th>OK</th>
                  <th>NG</th>
                  {hasPending && <th>In process</th>}
                  <th>Rejection %</th>
                  <th>95% CI</th>
                  <th>vs K-12</th>
                  <th className="left">Top defect</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((d) => {
                  const topReason = topOf(defects.perDie[d.die_name]?.reasons, [NO_REASON]);
                  return (
                    <tr key={d.die_name}>
                      <td className="left">
                        <span className="die-name">{dieText(d.die_name)}</span>
                        {d.lowVolume && <span className="die-lv">low volume</span>}
                      </td>
                      <td>{fmtInt(d.total_shots)}</td>
                      <td style={{ color: OUTCOME.ok, fontWeight: 600 }}>{fmtInt(d.ok_count)}</td>
                      <td style={{ color: OUTCOME.ng, fontWeight: 600 }}>{fmtInt(d.ng_count)}</td>
                      {hasPending && <td>{fmtInt(d.pending)}</td>}
                      <td style={{ color: signalColor(d), fontWeight: 700 }} title={signalText(d)}>{d.rate != null ? fmtPct(d.rate, 2) : "—"}</td>
                      <td style={{ color: INK.muted }}>{d.ci ? `${d.ci.lo.toFixed(2)} – ${d.ci.hi.toFixed(2)}%` : "—"}</td>
                      <td style={{ color: d.vsPlant > 0 ? OUTCOME.ng : d.vsPlant < 0 ? OUTCOME.ok : INK.secondary, fontWeight: 600 }}>{fmtPP(d.vsPlant)}</td>
                      <td className="left">{topReason ? <>{topReason.key} <span style={{ color: INK.muted }}>({fmtInt(topReason.count)})</span></> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="left">All K-12 dies</td>
                  <td>{fmtInt(plant.total)}</td>
                  <td>{fmtInt(plant.ok)}</td>
                  <td>{fmtInt(plant.ng)}</td>
                  {hasPending && <td>{fmtInt(plant.pending)}</td>}
                  <td>{fmtPct(plant.rate, 2)}</td>
                  <td style={{ color: INK.muted }}>{plant.ci ? `${plant.ci.lo.toFixed(2)} – ${plant.ci.hi.toFixed(2)}%` : "—"}</td>
                  <td>—</td>
                  <td className="left">
                    {defects.reasonOrder[0] ? `${defects.reasonOrder[0]} (${fmtInt(defects.reasonTotals[defects.reasonOrder[0]])})` : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
