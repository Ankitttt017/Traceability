import React, { useMemo, useState } from "react";
import {
  FileSpreadsheet, BarChart3, PieChart, Table, LineChart as LineChartIcon, Clock, ListOrdered, Percent,
} from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import EChart from "../../components/charts/EChart";
import InfoTip from "./components/InfoTip";
import { DieCategoryCard, DieShiftCard, DieTrendCard } from "./mgmt/DieTrends";
import {
  canonicalizeReason, formatResultTimestamp, looksLikeCustomerQr, parseRowDefect,
  extractShotFromPartId, extractShotDateTimeFromPartId,
} from "./rejectionConstants";
import {
  INK, OUTCOME, OTHER, DEFECT_CATEGORY, DEFECT_CATEGORY_LABEL, SHIFT,
  withAlpha, fmtInt, fmtPct, shiftKey, CARD_CSS, FONT_FAMILY, ACCENT, accent,
  ECHART_TOOLTIP, tooltipHtml, axisLabel, valueAxis, categoryAxis, LEGEND, baseOption,
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
const KNOWN_K12_DIES = ["S13", "S14", "S16", "S17", "S18", "S19"];
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
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : null);

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
  dieDaily = [],
  filterText = "",
  loading = false,
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
  const { dies, namedDieShots } = useMemo(() => {
    if (!Array.isArray(dieStats) || dieStats.length === 0) return { dies: [], namedDieShots: 0 };
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
      namedDieShots: sum(mapped.map((d) => d.total_shots)),
    };
  }, [dieStats, isK12Die]);

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

  /* die → category (+ the die's OK / NG parts) and die × shift → category, from the station rejections */
  const { byDie, byDieShift } = useMemo(() => {
    const bd = {};
    const bs = {};
    ordered.forEach((d) => { bd[d.die_name] = { CR: 0, MR: 0, CRAM: 0, ok: d.ok_count, ng: d.ng_count }; });
    defects.k12Records.forEach((r) => {
      const die = rowDie(r);
      if (!bd[die]) return;
      const cat = rowCategory(r, rowReason(r));
      if (!CATEGORY_KEYS.includes(cat)) return;
      bd[die][cat] += 1;
      const sh = shiftKey(r.shift_code || r.shiftCode);
      if (!["A", "B", "C"].includes(sh)) return;
      const k = `${die}|${sh}`;
      const b = bs[k] || (bs[k] = { CR: 0, MR: 0, CRAM: 0 });
      b[cat] += 1;
    });
    return { byDie: bd, byDieShift: bs };
  }, [ordered, defects]);
  const dieNames = useMemo(() => ordered.map((d) => d.die_name), [ordered]);

  /* Dies that have NG records (record-based charts). */
  const recDies = useMemo(() => ordered.filter((d) => defects.perDie[d.die_name]?.records > 0), [ordered, defects]);
  const hasPending = ordered.some((d) => d.pending > 0);

  /* ═══ ECharts options ═══════════════════════════════════════════════════ */
  /* (1) Production Output by Die — stacked OK / NG / in process, total + NG as the data label */
  const outputOption = useMemo(() => {
    if (!ordered.length) return null;
    const names = ordered.map((d) => d.die_name);
    const maxTotal = Math.max(1, ...ordered.map((d) => d.total_shots));
    const stack = [
      { key: "ok_count", name: "OK", color: OUTCOME.ok, ink: "#fff" },
      { key: "ng_count", name: "NG", color: OUTCOME.ng, ink: "#fff" },
      ...(hasPending ? [{ key: "pending", name: "In process", color: OUTCOME.wip, ink: INK.primary }] : []),
    ];
    const totals = ordered.map((d) => d.total_shots);
    return baseOption({
      grid: { left: 8, right: 16, top: 50, bottom: names.length > 14 ? 40 : 8, containLabel: true },
      legend: { ...LEGEND, top: 0, left: 0, data: stack.map((s) => s.name) },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis", axisPointer: SHADOW_POINTER,
        formatter: (ps) => {
          const d = ordered[ps[0]?.dataIndex ?? 0];
          return d ? tooltipHtml({ title: dieText(d.die_name), rows: dieRows(d) }) : "";
        },
      },
      xAxis: categoryAxis(names, { axisLabel: { ...dieAxisLabel(byName), interval: 0 }, axisTick: { show: false } }),
      yAxis: valueAxis({ axisLabel: axisLabel({ formatter: (v) => Number(v).toLocaleString() }), max: (v) => Math.ceil(v.max * 1.15) }),
      dataZoom: names.length > 14 ? [{ type: "slider", xAxisIndex: 0, bottom: 4, height: 14, startValue: 0, endValue: 13, showDetail: false, brushSelect: false }, { type: "inside", xAxisIndex: 0 }] : undefined,
      series: [
        ...stack.map((s) => ({
          type: "bar", name: s.name, stack: "parts", barMaxWidth: 64,
          data: ordered.map((d) => d[s.key]),
          itemStyle: { color: s.color },
          emphasis: { focus: "series" },
          label: {
            show: true, position: "inside", color: s.ink, fontSize: 10.5, fontWeight: 700, fontFamily: FONT_FAMILY,
            // only where the segment is wide enough to hold the number
            formatter: (p) => (Number(p.value) / maxTotal >= 0.1 ? fmtInt(p.value) : ""),
          },
        })),
        {
          // invisible series that carries the total label at the end of each stacked bar
          type: "bar", name: "Total", stack: "parts", data: totals.map(() => 0), silent: true, tooltip: { show: false },
          itemStyle: { color: "transparent" },
          label: {
            show: true, position: "top", color: INK.secondary, fontSize: 11, fontWeight: 700, fontFamily: FONT_FAMILY, lineHeight: 14,
            formatter: (p) => { const d = ordered[p.dataIndex]; return `${fmtInt(d.total_shots)} parts\nNG ${fmtInt(d.ng_count)}`; },
          },
        },
      ],
    });
  }, [ordered, hasPending, byName]);

  /* (2) Rejection Rate by Die — rate = NG ÷ (OK + NG) per die, bars + 95 % CI whiskers + K-12 average */
  const ciDies = useMemo(() => ordered.filter((d) => d.ci), [ordered]);
  const rateOption = useMemo(() => {
    if (!ciDies.length) return null;
    // Scale to the ranked dies so one low-volume die (very wide interval) does not squash the rest;
    // anything beyond the axis is clipped and marked with an arrow.
    const scaleSet = ciDies.some((d) => !d.lowVolume) ? ciDies.filter((d) => !d.lowVolume) : ciDies;
    const xMax = Math.min(100, Math.ceil(Math.max(1, ...scaleSet.map((d) => Math.max(d.ci.hi, d.rate)), plant.rate ?? 0) * 1.15));
    const clip = (v) => Math.min(v, xMax);
    const names = ciDies.map((d) => d.die_name);
    const filtRate = (d) => (filterText ? pctOf(defects.perDie[d.die_name]?.records || 0, d.inspected) : null);
    return baseOption({
      grid: { left: 8, right: 70, top: filterText ? 44 : 30, bottom: names.length > 14 ? 40 : 8, containLabel: true },
      legend: filterText ? { ...LEGEND, top: 0, left: 0, data: ["All NG", `NG matching ${filterText}`] } : undefined,
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis", axisPointer: SHADOW_POINTER,
        formatter: (ps) => {
          const d = ciDies[(Array.isArray(ps) ? ps[0] : ps)?.dataIndex ?? 0];
          if (!d) return "";
          return tooltipHtml({
            title: dieText(d.die_name),
            subtitle: d.lowVolume ? `Low volume (< ${MIN_INSPECTED_FOR_RANK} inspected) — not ranked` : signalText(d),
            rows: [
              { label: "Rejection rate", value: fmtPct(d.rate, 2), color: signalColor(d) },
              { label: "NG ÷ (OK + NG)", value: `${fmtInt(d.ng_count)} ÷ ${fmtInt(d.inspected)}` },
              { label: "95% CI (Wilson)", value: `${fmtPct(d.ci.lo, 2)} – ${fmtPct(d.ci.hi, 2)}` },
              { label: "K-12 average", value: fmtPct(plant.rate, 2), color: AVG_LINE },
              { label: "vs K-12 average", value: fmtPP(d.vsPlant) },
              filterText ? { label: `Matching ${filterText}`, value: `${fmtPct(filtRate(d), 2)} (${fmtInt(defects.perDie[d.die_name]?.records || 0)} NG)` } : null,
              d.pending > 0 ? { label: "In process (not in the rate)", value: fmtInt(d.pending), strong: false } : null,
            ],
          });
        },
      },
      xAxis: categoryAxis(names, { axisLabel: { ...dieAxisLabel(byName), interval: 0 }, axisTick: { show: false } }),
      yAxis: valueAxis({ min: 0, max: xMax, axisLabel: axisLabel({ formatter: (v) => `${v}%` }) }),
      dataZoom: names.length > 14 ? [{ type: "slider", xAxisIndex: 0, bottom: 4, height: 14, startValue: 0, endValue: 13, showDetail: false, brushSelect: false }, { type: "inside", xAxisIndex: 0 }] : undefined,
      series: [
        {
          type: "bar", name: "All NG", barMaxWidth: 56, z: 2,
          data: ciDies.map((d) => ({
            value: clip(d.rate),
            itemStyle: d.lowVolume
              ? { color: withAlpha(OUTCOME.wip, 0.35), borderColor: OUTCOME.wip, borderWidth: 1, borderType: "dashed", borderRadius: [4, 4, 0, 0] }
              : { color: signalColor(d), borderRadius: [4, 4, 0, 0] },
          })),
          label: {
            show: true, position: "insideBottom", distance: 6, lineHeight: 14, backgroundColor: "rgba(255,255,255,.88)", padding: [2, 4], borderRadius: 4, color: INK.primary, fontSize: 11, fontWeight: 700, fontFamily: FONT_FAMILY,
            formatter: (p) => { const d = ciDies[p.dataIndex]; return `${fmtPct(d.rate, 2)}${d.rate > xMax ? " ▴" : ""}\n${fmtInt(d.ng_count)}/${fmtInt(d.inspected)}`; },
          },
          markLine: plant.rate != null ? {
            symbol: "none", silent: true,
            lineStyle: { color: AVG_LINE, type: [4, 3], width: 1.5 },
            label: { formatter: `K-12 avg\n${fmtPct(plant.rate, 2)}`, color: AVG_LINE, fontWeight: 700, fontSize: 10.5, position: "end", distance: 4 },
            data: [{ yAxis: plant.rate }],
          } : undefined,
        },
        ...(filterText ? [{
          type: "bar", name: `NG matching ${filterText}`, barMaxWidth: 56, z: 2,
          data: ciDies.map((d) => clip(filtRate(d) || 0)),
          itemStyle: { color: "#475569", borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "top", distance: 8, color: INK.secondary, fontSize: 10.5, fontWeight: 600, fontFamily: FONT_FAMILY, formatter: (p) => fmtPct(filtRate(ciDies[p.dataIndex]), 2) },
        }] : []),
        {
          type: "custom",
          name: "95% CI",
          silent: true,
          z: 4,
          encode: { x: 0, y: [1, 2] },
          data: ciDies.map((d, i) => [i, clip(d.ci.lo), clip(d.ci.hi)]),
          renderItem: (params, api) => {
            const d = ciDies[params.dataIndex];
            const lo = api.coord([api.value(0), api.value(1)]);
            const hi = api.coord([api.value(0), api.value(2)]);
            const cap = 5;
            const style = { stroke: INK.primary, lineWidth: 1.3, opacity: 0.75 };
            const end = d.ci.hi > xMax
              ? { type: "polyline", shape: { points: [[hi[0] - 4, hi[1] + 6], [hi[0], hi[1]], [hi[0] + 4, hi[1] + 6]] }, style }
              : { type: "line", shape: { x1: hi[0] - cap, y1: hi[1], x2: hi[0] + cap, y2: hi[1] }, style };
            return {
              type: "group",
              children: [
                { type: "line", shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style },
                { type: "line", shape: { x1: lo[0] - cap, y1: lo[1], x2: lo[0] + cap, y2: lo[1] }, style },
                end,
              ],
            };
          },
        },
      ],
    });
  }, [ciDies, plant.rate, byName, filterText, defects]);

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

  /* Parts left out of the die analysis: no die name = no DCM shot record (the die comes from the shot) */
  const tracked = Number(summary?.totalProduction ?? summary?.totalParts);
  const excl = Number.isFinite(tracked) && tracked > 0 && noDieParts > 0 ? { tracked, noDie: noDieParts } : null;
  const recordsGap = defects.matched - plant.ng;

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
        .die-excl-line { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-left: 6px; }
        .die-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
        .ra-kpi.die-kpi { box-shadow: 0 1px 2px rgba(15,23,42,.04); }
        .die-empty { min-height: 160px; display: grid; place-content: center; color: ${INK.faint}; font-size: 12px; text-align: center; padding: 16px; }
        .die-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 600; background: #fff; color: ${INK.secondary}; border: 1px solid ${INK.axis}; cursor: pointer; font-family: inherit; }
        .die-btn:hover:not(:disabled) { border-color: ${INK.faint}; color: ${INK.primary}; }
        .die-btn:disabled { opacity: .4; cursor: not-allowed; }
        .die-select { max-width: 100%; padding: 5px 10px; border-radius: 8px; border: 1px solid ${INK.axis}; font-size: 12px; font-weight: 600; color: ${INK.primary}; background: #fff; font-family: inherit; }
        .die-totals { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; margin: 0 4px 6px; font-size: 12px; color: ${INK.body}; }
        .die-totals b { color: ${INK.primary}; font-variant-numeric: tabular-nums; }
        .die-totals i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
        .die-totals .muted { color: ${INK.faint}; }
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
        .die-excl { padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; }
        .die-excl-main { display: flex; justify-content: space-between; align-items: baseline; gap: 8px 16px; flex-wrap: wrap; }
        .die-excl-label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: ${INK.muted}; }
        .die-excl-value { font-size: 22px; font-weight: 750; color: ${INK.primary}; font-variant-numeric: tabular-nums; }
        .die-excl-value em { font-style: normal; font-size: 12.5px; font-weight: 600; color: ${INK.muted}; margin-left: 6px; }
        .die-excl-bar { display: flex; gap: 2px; height: 10px; border-radius: 5px; overflow: hidden; background: ${INK.grid}; }
        .die-excl-bar i { display: block; height: 100%; }
        .die-excl-parts { display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 12px; color: ${INK.body}; }
        .die-excl-parts span { display: inline-flex; align-items: center; gap: 6px; }
        .die-excl-parts i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
        .die-excl-parts b { color: ${INK.primary}; font-variant-numeric: tabular-nums; }
      `}</style>

      {/* ═══ SCOPE (one line) + parts without shot details ═══ */}
      <div className="die-scope">
        <b>Oil Pan K-12 ({K12_PART}) dies in this period: {ordered.map((d) => d.die_name).join(", ") || "—"}</b>
        {excl && (
          <span className="die-excl-line">
            <span aria-hidden="true">·</span><b>{fmtInt(excl.noDie)}</b> parts ({fmtPct(pctOf(excl.noDie, excl.tracked), 1)} of {fmtInt(excl.tracked)} tracked) have no shot details and are not in the die charts
            <InfoTip label="Why parts are excluded" info={{
              title: "Parts without shot details",
              what: "The die of a part comes from its DCM shot record (PlcCycleReadings: the shot that cast it). Parts without a shot record — e.g. parts traced only by customer QR, or shots not transferred from the die-casting machine — have no die, so they cannot be placed on a die.",
              formula: ["Excluded = tracked parts − parts on Oil Pan K-12 dies", "Share = excluded ÷ tracked parts of the period"],
              note: "They are still counted in the page totals (KPI strip, Overview).",
            }} />
          </span>
        )}
      </div>

      {/* ═══ KPI ROW ═══ */}
      <div className="die-kpi-row">
        <KPI label="Produced" value={fmtInt(plant.total)} sub={plant.pending > 0 ? `${fmtInt(plant.pending)} in process` : undefined} color={ACCENT.neutral} />
        <KPI label="OK parts" value={fmtInt(plant.ok)} color={OUTCOME.ok} />
        <KPI label="NG parts" value={fmtInt(plant.ng)} color={OUTCOME.ng} />
        <KPI label="Rejection rate" value={fmtPct(plant.rate, 2)} color={OUTCOME.ng} />
        {worst && <KPI
          label="Highest-rate die" value={worst.die_name}
          sub={worst ? `${fmtPct(worst.rate, 2)} · ${fmtPP(worst.vsPlant)}` : undefined}
          color={OUTCOME.ng}
        />}
      </div>

      {/* ═══ (1) PRODUCTION OUTPUT BY DIE ═══ */}
      <Card
        color={ACCENT.neutral} icon={BarChart3} title="Production Output by Die"
        sub={`Parts produced per die — OK · NG · in process${hasPending ? " (in process = no final result yet)" : ""} · total and NG at the end of each bar`}
        actions={(
          <button type="button" onClick={handleExportDieExcel} className="die-btn" disabled={!dies.length}>
            <FileSpreadsheet size={14} /> Excel
          </button>
        )}
      >
        {ordered.length === 0 ? (
          <Empty>{loading ? "Loading die statistics…" : "No K-12 die statistics for the selected filters."}</Empty>
        ) : (
          <>
            <div className="die-totals">
              <span>Total <b>{fmtInt(plant.total)}</b> parts on {ordered.length} {ordered.length === 1 ? "die" : "dies"}</span>
              <span><i style={{ background: OUTCOME.ok }} />OK <b>{fmtInt(plant.ok)}</b></span>
              <span><i style={{ background: OUTCOME.ng }} />NG <b>{fmtInt(plant.ng)}</b></span>
              {hasPending && <span><i style={{ background: OUTCOME.wip }} />In process <b>{fmtInt(plant.pending)}</b></span>}
            </div>
            <EChart option={outputOption} style={{ height: 380 }} />
          </>
        )}
      </Card>

      {/* ═══ (2) REJECTION RATE BY DIE ═══ */}
      <Card
        color={OUTCOME.ng} icon={Percent} title="Rejection Rate by Die"
        sub={`Rate = NG ÷ (OK + NG) of each die — every part counted once, parts in process excluded · whisker = 95% confidence interval · dies under ${MIN_INSPECTED_FOR_RANK} inspected are not ranked${recordsGap > 0 ? ` · ${fmtInt(recordsGap)} NG records still in process not counted` : ""}`}
      >
        {!rateOption ? (
          <Empty>{loading ? "Loading die statistics…" : "No inspected parts on K-12 dies for the selected filters."}</Empty>
        ) : (
          <>
            <div className="die-totals">
              <span>K-12 average <b>{fmtPct(plant.rate, 2)}</b> = {fmtInt(plant.ng)} ÷ {fmtInt(plant.inspected)}</span>
              <Legend items={[
                { label: "Significantly above avg", color: OUTCOME.ng },
                { label: "Not significant", color: ACCENT.neutral },
                { label: "Significantly below avg", color: OUTCOME.ok },
                { label: "Low volume", style: { background: withAlpha(OUTCOME.wip, 0.35), border: `1px dashed ${OUTCOME.wip}` } },
              ]} />
            </div>
            <EChart option={rateOption} style={{ height: 380 }} />
          </>
        )}
      </Card>

      {/* ═══ (3) TREND PER DIE + CATEGORY / SHIFT BREAK-UP ═══ */}
      <DieTrendCard dieDaily={dieDaily} dies={dieNames} />
      <div className="ra-grid2">
        <DieCategoryCard byDie={byDie} dies={dieNames} />
        <DieShiftCard byDieShift={byDieShift} dies={dieNames} />
      </div>

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
