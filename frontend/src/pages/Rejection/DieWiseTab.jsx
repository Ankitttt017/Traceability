import React, { useMemo, useState } from "react";
import {
  FileSpreadsheet, Layers, Activity, CheckCircle2, AlertTriangle, Percent, TrendingUp, TrendingDown,
  BarChart3, PieChart, Grid, Table, LineChart as LineChartIcon, Clock, Target, ListOrdered, HelpCircle, Info,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from "recharts";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import SafeChart from "../../components/charts/SafeChart";
import EChart from "../../components/charts/EChart";
import {
  canonicalizeReason, formatResultTimestamp, looksLikeCustomerQr, parseRowDefect,
  extractShotFromPartId, extractShotDateTimeFromPartId,
} from "./rejectionConstants";
import {
  INK, OUTCOME, OTHER, DEFECT_CATEGORY, DEFECT_CATEGORY_LABEL, SEQ_SCRAP, SHIFT, STATUS,
  makeColorMap, seqColor, withAlpha, fmtInt, fmtPct, shiftKey,
  RECHARTS_TOOLTIP, RECHARTS_AXIS, RECHARTS_GRID, CARD_CSS, FONT_FAMILY, ACCENT, accent,
  ECHART_TOOLTIP, tooltipHtml, axisLabel, axisName, valueAxis, categoryAxis, LEGEND, baseOption,
} from "./chartTheme";

/* Semantic accents for this tab. */
const HEAT_ACCENT = SEQ_SCRAP[4];   // scrap-count heat maps
const AVG_LINE = ACCENT.model;      // K-12 average reference

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS & HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */
/* Minimum inspected parts (OK + NG) before a die's rejection rate is ranked against others. */
const MIN_INSPECTED_FOR_RANK = 50;
const Z95 = 1.96;
const CATEGORY_KEYS = ["CR", "CRAM", "MR"];
const UNCLASSIFIED = "Unclassified";
const NO_REASON = "No reason recorded";
const HEAT_REASON_COLUMNS = 8;
const PARETO_TOP = 10;

/* Scope: this tab shows Oil Pan K-12 (part OPK12) dies only. */
const K12_PART = "OPK12";
/* Fallback list — used only for a die whose loaded records carry no part_name at all. */
const KNOWN_K12_DIES = ["S14", "S16", "S17", "S18"];
const isK12Part = (raw) => {
  const s = String(raw || "").toUpperCase().replace(/[\s_-]/g, "");
  return s === "OPK12" || s === "OILPANK12" || s.includes("K12");
};

/* Stations in process order (first NG gate of a record). */
const STATION_ORDER = ["OP100", "OP110", "OP120", "OP130", "OP140", "OP150", "OP160"];
const STATION_NAME = {
  OP100: "DCM + DPM", OP110: "Laser marking", OP120: "Casting PDI", OP130: "Pre-inspection",
  OP140: "Auto gauging", OP150: "Leak test", OP160: "Final inspection",
};
const UNSPEC_STATION = "No gate";
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
/* First NG gate of the record ("OP120, OP150" → "OP120"). */
const rowStation = (r) => {
  const first = String(r.ngGate || r.ng_gate || "").split(",")[0].trim().toUpperCase();
  return STATION_ORDER.includes(first) ? first : UNSPEC_STATION;
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

const dieText = (name) => `${name} · ${K12_PART}`;
const signalColor = (d) => (d.lowVolume ? OUTCOME.wip
  : d.signal === "above" ? OUTCOME.ng : d.signal === "below" ? OUTCOME.ok : ACCENT.neutral);
const signalText = (d) => (d.signal === "above" ? "Significantly above K-12 average"
  : d.signal === "below" ? "Significantly below K-12 average"
    : d.signal === "same" ? "Not significantly different from K-12 average" : "No inspected parts");

/* Rich y-axis labels: die swatch + "S18 · OPK12" (+ "low volume"). */
const dieAxisLabel = (list, dieColor, byName) => {
  const rich = { n: { color: INK.secondary, fontSize: 11.5, fontWeight: 600, fontFamily: FONT_FAMILY, padding: [0, 0, 0, 4] }, lv: { color: INK.faint, fontSize: 10, fontFamily: FONT_FAMILY } };
  list.forEach((d, i) => { rich[`c${i}`] = { width: 9, height: 9, borderRadius: 2, backgroundColor: dieColor(d.die_name) }; });
  const idx = Object.fromEntries(list.map((d, i) => [d.die_name, i]));
  return {
    ...axisLabel(),
    rich,
    formatter: (v) => `{c${idx[v]}|}{n|${dieText(v)}}${byName[v]?.lowVolume ? "\n{lv|low volume}" : ""}`,
  };
};

/* ═══════════════════════════════════════════════════════════════════════════
   SMALL PIECES
   ═══════════════════════════════════════════════════════════════════════════ */
const TT_CSS = `
.die-tt{min-width:200px}
.die-tt-title{font-weight:700;font-size:13px;margin-bottom:2px;color:#0f172a}
.die-tt-sub{color:#64748b;font-size:11px;margin-bottom:6px}
.die-tt-grid{display:grid;grid-template-columns:auto auto;gap:3px 16px;font-size:12px;font-variant-numeric:tabular-nums}
.die-tt-grid span{color:#475569}
.die-tt-grid strong{color:#0f172a;font-weight:700;text-align:right}
.die-tt-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
.die-tt-note{color:#64748b;font-size:11px;margin-top:6px;max-width:260px;white-space:normal}
`;

const TooltipBox = ({ title, subtitle, rows, note }) => (
  <div className="die-tt" style={RECHARTS_TOOLTIP.contentStyle}>
    <div className="die-tt-title">{title}</div>
    {subtitle && <div className="die-tt-sub">{subtitle}</div>}
    <div className="die-tt-grid">
      {rows.filter(Boolean).map((r) => (
        <React.Fragment key={r.label}>
          <span>{r.color && <i className="die-tt-dot" style={{ background: r.color }} />}{r.label}</span>
          <strong>{r.value}</strong>
        </React.Fragment>
      ))}
    </div>
    {note && <div className="die-tt-note">{note}</div>}
  </div>
);

const KPI = ({ label, value, sub, icon: Icon, color = ACCENT.neutral, swatch }) => (
  <div className="ra-kpi die-kpi" data-accent style={accent(color)}>
    <div className="ra-kpi-top">
      {Icon && <span className="ra-icon" style={{ width: 28, height: 28, borderRadius: 8 }}><Icon size={15} /></span>}
      <div className="ra-kpi-label">{label}</div>
    </div>
    <div className="ra-kpi-value">
      {swatch && <i className="die-swatch" style={{ background: swatch, width: 11, height: 11, verticalAlign: 1 }} aria-hidden="true" />}
      {value}
    </div>
    {sub && <div className="ra-kpi-sub">{sub}</div>}
  </div>
);

/** Card shell: accent stripe, icon chip, h3 title, optional actions and footnote. */
const Card = ({ color, icon: Icon, title, sub, actions, note, children, className = "" }) => (
  <div className={`ra-card ${className}`} data-accent style={accent(color)}>
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
    {note && <div className="ra-note">{note}</div>}
  </div>
);

/** Soft horizontal bar gradient in one theme colour (lighter at the base, full at the tip). */
const BarGrad = ({ id, color, from = 0.7 }) => (
  <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stopColor={color} stopOpacity={from} />
    <stop offset="100%" stopColor={color} />
  </linearGradient>
);
const swatchGrad = (color) => `linear-gradient(90deg, ${withAlpha(color, 0.7)}, ${color})`;

/** Y-axis tick: die colour swatch + "S18 · OPK12", "low volume" underneath when applicable. */
const DieTick = ({ x, y, payload, dieColor, byName, label }) => {
  const d = byName[payload.value];
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-14} y={-5} width={9} height={9} rx={2} fill={dieColor(payload.value)} />
      <text x={-20} y={0} dy={4} textAnchor="end" fill={INK.secondary} fontSize={11.5} fontWeight={600} fontFamily={FONT_FAMILY}>
        {label(payload.value)}
      </text>
      {d?.lowVolume && (
        <text x={-20} y={0} dy={16} textAnchor="end" fill={INK.faint} fontSize={10} fontFamily={FONT_FAMILY}>low volume</text>
      )}
    </g>
  );
};

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

  /* One stable die → colour map (known K-12 dies first, then any other by name). */
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
        return { ...d, rateBar: d.rate ?? 0, vsPlant, signal, shareOfNg: pctOf(d.ng_count, plant.ng) };
      });
  }, [dies, plant]);
  const byName = useMemo(() => Object.fromEntries(ordered.map((d) => [d.die_name, d])), [ordered]);

  const ranked = useMemo(() => ordered.filter((d) => d.rate != null && !d.lowVolume), [ordered]);
  const best = ranked.length >= 2 ? ranked[ranked.length - 1] : null;
  const worst = ranked.length >= 2 ? ranked[0] : null;

  /* ── NG records per K-12 die: reasons, categories, stations, shifts, days ── */
  const defects = useMemo(() => {
    const dieSet = new Set(dies.map((d) => d.die_name));
    const perDie = {};
    const reasonTotals = {};
    const stationTotals = {};
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
      const station = rowStation(r);
      const shift = shiftKey(r.shift_code || r.shiftCode);
      const day = rowDay(r);
      if (!perDie[die]) {
        perDie[die] = {
          records: 0, reasons: {}, cats: { CR: 0, CRAM: 0, MR: 0, [UNCLASSIFIED]: 0 },
          stations: {}, shifts: { A: 0, B: 0, C: 0, Unassigned: 0 }, days: {},
        };
      }
      const p = perDie[die];
      p.records += 1;
      p.cats[cat] += 1;
      catTotals[cat] += 1;
      const rk = reason || NO_REASON;
      p.reasons[rk] = (p.reasons[rk] || 0) + 1;
      if (reason) reasonTotals[reason] = (reasonTotals[reason] || 0) + 1;
      p.stations[station] = (p.stations[station] || 0) + 1;
      stationTotals[station] = (stationTotals[station] || 0) + 1;
      p.shifts[shift] += 1;
      if (day) { p.days[day] = (p.days[day] || 0) + 1; dayKeys.add(day); } else noDay += 1;
    });
    const reasonOrder = Object.entries(reasonTotals).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const matched = k12Records.length;
    return {
      perDie, reasonOrder, reasonTotals, stationTotals, catTotals, matched, noDie, otherDie, noDay,
      days: dayRange([...dayKeys]), k12Records,
    };
  }, [defectPool, dies]);

  /* No-die production: parts in the window without a die_name (summary total − Σ named-die totals). */
  const noDieParts = useMemo(() => {
    const total = Number(summary?.totalProduction ?? summary?.totalParts);
    return Number.isFinite(total) && total > 0 ? Math.max(0, total - namedDieShots) : null;
  }, [summary, namedDieShots]);

  /* One reason → colour map from the overall reason order (9th+ → Other). */
  const reasonColor = useMemo(() => makeColorMap(defects.reasonOrder), [defects.reasonOrder]);
  const heatReasons = useMemo(() => defects.reasonOrder.slice(0, HEAT_REASON_COLUMNS), [defects.reasonOrder]);
  const hasOtherReasons = defects.reasonOrder.length > HEAT_REASON_COLUMNS;

  const dieDefect = (name) => defects.perDie[name] || null;
  const topOf = (obj, skip = []) => {
    const e = Object.entries(obj || {}).filter(([k, v]) => v > 0 && !skip.includes(k)).sort((a, b) => b[1] - a[1]);
    return e.length ? { key: e[0][0], count: e[0][1] } : null;
  };

  /* Dies that have NG records (record-based charts). */
  const recDies = useMemo(() => ordered.filter((d) => defects.perDie[d.die_name]?.records > 0), [ordered, defects]);

  /* Heat table cells (die × top reasons) */
  const heatRows = useMemo(() => ordered.map((d) => {
    const reasons = defects.perDie[d.die_name]?.reasons || {};
    const cells = heatReasons.map((r) => reasons[r] || 0);
    const withReason = sum(Object.entries(reasons).filter(([k]) => k !== NO_REASON).map(([, v]) => v));
    const other = withReason - sum(cells);
    return { die: d, cells, other, withReason };
  }), [ordered, defects, heatReasons]);
  const heatMax = Math.max(0, ...heatRows.flatMap((h) => [...h.cells, hasOtherReasons ? h.other : 0]));

  const dieTooltip = (d) => (
    <TooltipBox
      title={dieText(d.die_name)}
      subtitle={d.lowVolume ? `Low volume: fewer than ${MIN_INSPECTED_FOR_RANK} inspected parts — not ranked` : undefined}
      rows={[
        { label: "Produced", value: fmtInt(d.total_shots) },
        { label: "OK", value: fmtInt(d.ok_count), color: OUTCOME.ok },
        { label: "NG", value: fmtInt(d.ng_count), color: OUTCOME.ng },
        d.pending > 0 && { label: "In process", value: fmtInt(d.pending), color: OUTCOME.wip },
        { label: "Rejection rate", value: d.rate != null ? fmtPct(d.rate, 2) : "No inspections" },
        d.ci && { label: "95% CI", value: `${fmtPct(d.ci.lo, 2)} – ${fmtPct(d.ci.hi, 2)}` },
        { label: "vs K-12 average", value: fmtPP(d.vsPlant) },
        { label: "Share of K-12 NG", value: fmtPct(d.shareOfNg) },
      ]}
      note={`Rejection rate = NG ÷ (OK + NG). K-12 average ${fmtPct(plant.rate, 2)}.`}
    />
  );

  /* ═══ ECharts options ═══════════════════════════════════════════════════ */
  /* (1) Rejection rate with 95 % Wilson CI */
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
      grid: { left: 8, right: 40, top: 34, bottom: 44, containLabel: true },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (p) => {
          const d = ciDies[p.dataIndex];
          if (!d) return "";
          return tooltipHtml({
            title: dieText(d.die_name),
            subtitle: d.lowVolume ? `Low volume (< ${MIN_INSPECTED_FOR_RANK} inspected) — interval is wide` : signalText(d),
            rows: [
              { label: "Inspected (OK + NG)", value: fmtInt(d.inspected) },
              { label: "OK", value: fmtInt(d.ok_count), color: OUTCOME.ok },
              { label: "NG", value: fmtInt(d.ng_count), color: OUTCOME.ng },
              { label: "Rejection rate", value: fmtPct(d.rate, 2) },
              { label: "95% CI (Wilson)", value: `${fmtPct(d.ci.lo, 2)} – ${fmtPct(d.ci.hi, 2)}` },
              { label: "K-12 average", value: fmtPct(plant.rate, 2), color: AVG_LINE },
              { label: "vs K-12 average", value: fmtPP(d.vsPlant) },
              { label: "Share of K-12 NG", value: fmtPct(d.shareOfNg) },
            ],
            note: "Whisker = 95% Wilson score interval. If it does not cross the average line, the difference is statistically significant.",
          });
        },
      },
      xAxis: valueAxis({ min: 0, max: xMax, axisLabel: axisLabel({ formatter: (v) => `${v}%` }), ...axisName("Rejection rate, NG ÷ (OK + NG) (%)", 28) }),
      yAxis: categoryAxis(names, { inverse: true, axisLabel: dieAxisLabel(ciDies, dieColor, byName), axisLine: { show: false } }),
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
            const cap = 7;
            const clipped = d.ci.hi > xMax;
            const style = { stroke: withAlpha(signalColor(d), 0.85), lineWidth: 2, lineCap: "round" };
            const end = clipped
              ? { type: "polyline", shape: { points: [[hi[0] - 7, hi[1] - 5], [hi[0], hi[1]], [hi[0] - 7, hi[1] + 5]] }, style }
              : { type: "line", shape: { x1: hi[0], y1: hi[1] - cap, x2: hi[0], y2: hi[1] + cap }, style };
            return {
              type: "group",
              children: [
                { type: "rect", shape: { x: lo[0], y: lo[1] - 5, width: Math.max(1, hi[0] - lo[0]), height: 10, r: 5 }, style: { fill: withAlpha(signalColor(d), 0.12) } },
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
          symbolSize: 13,
          z: 3,
          data: ciDies.map((d, i) => ({
            value: [clip(d.rate), i],
            itemStyle: d.lowVolume
              ? { color: "#fff", borderColor: OUTCOME.wip, borderWidth: 2 }
              : { color: signalColor(d), borderColor: "#fff", borderWidth: 2, shadowBlur: 4, shadowColor: "rgba(15,23,42,.25)" },
          })),
          label: { show: true, position: "top", distance: 6, formatter: (p) => { const d = ciDies[p.dataIndex]; return `${fmtPct(d.rate, 2)}${d.rate > xMax ? " ▸" : ""}`; }, color: INK.secondary, fontSize: 10.5, fontWeight: 600 },
          markLine: plant.rate != null ? {
            symbol: "none", silent: true,
            lineStyle: { color: AVG_LINE, type: [4, 3], width: 1.75 },
            label: { formatter: `K-12 avg ${fmtPct(plant.rate, 2)}`, color: AVG_LINE, fontWeight: 700, fontSize: 10.5, position: "start", distance: 6 },
            data: [{ xAxis: plant.rate }],
          } : undefined,
        },
      ],
    });
  }, [ciDies, plant.rate, dieColor, byName]);

  /* (2) Daily NG trend per die */
  const trendOption = useMemo(() => {
    if (!recDies.length || !defects.days.length) return null;
    const days = defects.days;
    const dayTotals = days.map((k) => sum(recDies.map((d) => defects.perDie[d.die_name].days[k] || 0)));
    return baseOption({
      grid: { left: 8, right: 20, top: 40, bottom: days.length > 21 ? 78 : 34, containLabel: true },
      legend: { ...LEGEND, data: recDies.map((d) => dieText(d.die_name)) },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: INK.axis } },
        formatter: (ps) => {
          const i = ps[0]?.dataIndex ?? 0;
          const tot = dayTotals[i];
          return tooltipHtml({
            title: dayLabel(days[i]),
            subtitle: `${fmtInt(tot)} NG records on K-12 dies`,
            rows: ps.map((p) => ({ label: p.seriesName, color: p.color, value: `${fmtInt(p.value)} · ${fmtPct(pctOf(p.value, tot), 0)}` })),
            note: "Count of NG records by recorded date. Daily production per die is not available, so this is a count, not a rate.",
          });
        },
      },
      xAxis: categoryAxis(days.map(dayLabel), { boundaryGap: false, ...axisName("Date (NG recorded)", days.length > 21 ? 30 : 26) }),
      yAxis: valueAxis({ minInterval: 1, ...axisName("NG records (count / day)", 34) }),
      dataZoom: days.length > 21 ? [{ type: "inside" }, { type: "slider", height: 14, bottom: 4, borderColor: INK.border, fillerColor: withAlpha(ACCENT.process, 0.12), handleSize: 14, showDetail: false }] : undefined,
      series: recDies.map((d) => ({
        type: "line",
        name: dieText(d.die_name),
        data: days.map((k) => defects.perDie[d.die_name].days[k] || 0),
        smooth: 0.25,
        symbol: "circle",
        symbolSize: 5,
        showSymbol: days.length <= 45,
        lineStyle: { width: 2.2, color: dieColor(d.die_name) },
        itemStyle: { color: dieColor(d.die_name) },
        areaStyle: recDies.length <= 2 ? { color: withAlpha(dieColor(d.die_name), 0.08) } : undefined,
        emphasis: { focus: "series" },
      })),
    });
  }, [recDies, defects, dieColor]);

  /* (3) Die × station heat matrix */
  const stations = useMemo(
    () => [...STATION_ORDER, UNSPEC_STATION].filter((s) => defects.stationTotals[s] > 0),
    [defects.stationTotals]
  );
  const stationOption = useMemo(() => {
    if (!recDies.length || !stations.length) return null;
    const max = Math.max(0, ...recDies.flatMap((d) => stations.map((s) => defects.perDie[d.die_name].stations[s] || 0)));
    const data = [];
    recDies.forEach((d, yi) => {
      const p = defects.perDie[d.die_name];
      stations.forEach((s, xi) => {
        const v = p.stations[s] || 0;
        const bg = seqColor(v, max);
        const light = bg && SEQ_SCRAP.indexOf(bg) >= 4;
        data.push({
          // dimension 3 = ramp step (−1 = empty cell), coloured through the hidden visualMap below
          value: [xi, yi, v, bg ? SEQ_SCRAP.indexOf(bg) : -1],
          label: { rich: { v: { fontSize: 12, fontWeight: 700, color: light ? "#fff" : INK.primary }, p: { fontSize: 9.5, color: light ? "rgba(255,255,255,.85)" : INK.body } } },
        });
      });
    });
    return baseOption({
      grid: { left: 8, right: 12, top: 8, bottom: 44, containLabel: true },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (p) => {
          const [xi, yi, v] = p.value;
          const d = recDies[yi];
          const s = stations[xi];
          const dieTot = defects.perDie[d.die_name].records;
          return tooltipHtml({
            title: `${dieText(d.die_name)} · ${s}`,
            subtitle: STATION_NAME[s] || "Record has no NG gate",
            rows: [
              { label: "NG records", value: fmtInt(v), color: seqColor(v, max) || INK.faint },
              { label: "Share of die NG", value: fmtPct(pctOf(v, dieTot)) },
              { label: "Share of station NG (K-12)", value: fmtPct(pctOf(v, defects.stationTotals[s])) },
              { label: "Die NG total", value: fmtInt(dieTot) },
            ],
          });
        },
      },
      xAxis: categoryAxis(stations, {
        splitArea: { show: false },
        axisLabel: axisLabel({ interval: 0, formatter: (v) => `${v}\n{s|${STATION_NAME[v] || ""}}`, rich: { s: { color: INK.faint, fontSize: 9.5 } }, lineHeight: 14 }),
        ...axisName("First NG gate (station)", 38),
      }),
      yAxis: categoryAxis(recDies.map((d) => d.die_name), { inverse: true, axisLabel: dieAxisLabel(recDies, dieColor, byName), axisLine: { show: false } }),
      // ECharts requires a visualMap on every heatmap; this one only re-applies the √-scaled ramp step
      visualMap: {
        show: false, type: "piecewise", dimension: 3, seriesIndex: 0,
        pieces: [{ value: -1, color: INK.surfaceAlt }, ...SEQ_SCRAP.map((c, i) => ({ value: i, color: c }))],
      },
      series: [{
        type: "heatmap",
        data,
        itemStyle: { borderColor: "#fff", borderWidth: 3, borderRadius: 6 },
        label: {
          show: true,
          formatter: (p) => {
            const [, yi, v] = p.value;
            if (!v) return "·";
            return `{v|${fmtInt(v)}}\n{p|${fmtPct(pctOf(v, defects.perDie[recDies[yi].die_name].records), 0)}}`;
          },
          rich: {
            v: { fontSize: 12, fontWeight: 700, color: INK.primary },
            p: { fontSize: 9.5, color: INK.body },
          },
        },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(15,23,42,.25)" } },
      }],
    });
  }, [recDies, stations, defects, dieColor, byName]);

  /* (4) Die × shift grouped bars */
  const shiftsPresent = useMemo(
    () => SHIFT_KEYS.filter((k) => recDies.some((d) => defects.perDie[d.die_name].shifts[k] > 0)),
    [recDies, defects]
  );
  const shiftTotals = useMemo(() => Object.fromEntries(SHIFT_KEYS.map((k) => [k, sum(recDies.map((d) => defects.perDie[d.die_name].shifts[k]))])), [recDies, defects]);
  const shiftOption = useMemo(() => {
    if (!recDies.length || !shiftsPresent.length) return null;
    return baseOption({
      grid: { left: 8, right: 16, top: 40, bottom: 40, containLabel: true },
      legend: { ...LEGEND, data: shiftsPresent.map((k) => (k === "Unassigned" ? k : `Shift ${k}`)) },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,23,42,0.04)" } },
        formatter: (ps) => {
          const d = recDies[ps[0]?.dataIndex ?? 0];
          const tot = defects.perDie[d.die_name].records;
          return tooltipHtml({
            title: dieText(d.die_name),
            subtitle: `${fmtInt(tot)} NG records`,
            rows: ps.map((p, i) => ({
              label: p.seriesName, color: p.color,
              value: `${fmtInt(p.value)} · ${fmtPct(pctOf(p.value, tot), 0)} of die · ${fmtPct(pctOf(p.value, shiftTotals[shiftsPresent[i]]), 0)} of shift`,
            })),
          });
        },
      },
      xAxis: categoryAxis(recDies.map((d) => dieText(d.die_name)), { axisLabel: axisLabel({ fontWeight: 600, color: INK.secondary }), ...axisName("Die · part", 28) }),
      yAxis: valueAxis({ minInterval: 1, ...axisName("NG records (count)", 36) }),
      series: shiftsPresent.map((k) => ({
        type: "bar",
        name: k === "Unassigned" ? k : `Shift ${k}`,
        data: recDies.map((d) => defects.perDie[d.die_name].shifts[k]),
        barMaxWidth: 30,
        barGap: "12%",
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: SHIFT[k] }, { offset: 1, color: withAlpha(SHIFT[k], 0.7) }] },
        },
        label: { show: true, position: "top", color: INK.secondary, fontSize: 10.5, fontWeight: 600, formatter: (p) => (p.value ? fmtInt(p.value) : "") },
        emphasis: { focus: "series" },
      })),
    });
  }, [recDies, shiftsPresent, shiftTotals, defects]);

  /* (6) Per-die Pareto of top defects */
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
      items: items.map((it) => { cum += it.count; return { ...it, pct: (it.count / p.records) * 100, cum: (cum / p.records) * 100 }; }),
    };
  }, [paretoDie, defects]);
  const paretoOption = useMemo(() => {
    if (!pareto) return null;
    const colorFor = (it) => (it.other || it.reason === NO_REASON ? OTHER : reasonColor(it.reason));
    const short = (s) => (s.length > 22 ? `${s.slice(0, 21)}…` : s);
    return baseOption({
      grid: { left: 8, right: 24, top: 40, bottom: 12, containLabel: true },
      legend: { ...LEGEND, data: [{ name: "Share of die NG" }, { name: "Cumulative %" }] },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,23,42,0.04)" } },
        formatter: (ps) => {
          const it = pareto.items[ps[0]?.dataIndex ?? 0];
          const plantReason = defects.reasonTotals[it.reason];
          return tooltipHtml({
            title: it.reason,
            subtitle: `${dieText(paretoDie)} · ${fmtInt(pareto.total)} NG records`,
            rows: [
              { label: "NG records", value: fmtInt(it.count), color: colorFor(it) },
              { label: "Share of die NG", value: fmtPct(it.pct) },
              { label: "Cumulative", value: fmtPct(it.cum), color: INK.primary },
              plantReason ? { label: "Die's share of K-12 total", value: `${fmtPct(pctOf(it.count, plantReason))} of ${fmtInt(plantReason)}` } : null,
            ],
          });
        },
      },
      xAxis: categoryAxis(pareto.items.map((it) => it.reason), { axisLabel: axisLabel({ interval: 0, rotate: pareto.items.length > 5 ? 32 : 0, formatter: short }) }),
      yAxis: valueAxis({ min: 0, max: 100, interval: 20, axisLabel: axisLabel({ formatter: (v) => `${v}%` }), ...axisName("% of die NG records", 40) }),
      series: [
        {
          type: "bar", name: "Share of die NG", barMaxWidth: 34,
          data: pareto.items.map((it) => ({ value: Number(it.pct.toFixed(2)), itemStyle: { color: colorFor(it), borderRadius: [4, 4, 0, 0] } })),
          itemStyle: { color: ACCENT.process },
          label: { show: true, position: "top", color: INK.secondary, fontSize: 10.5, fontWeight: 600, formatter: (p) => fmtInt(pareto.items[p.dataIndex].count) },
        },
        {
          type: "line", name: "Cumulative %", data: pareto.items.map((it) => Number(it.cum.toFixed(2))),
          symbol: "circle", symbolSize: 6, smooth: false,
          lineStyle: { color: INK.primary, width: 2 }, itemStyle: { color: INK.primary, borderColor: "#fff", borderWidth: 1.5 },
          markLine: {
            symbol: "none", silent: true, lineStyle: { color: STATUS.serious, type: [4, 3], width: 1.25 },
            label: { formatter: "80%", color: STATUS.serious, fontWeight: 700, fontSize: 10.5, position: "end" },
            data: [{ yAxis: 80 }],
          },
        },
      ],
    });
  }, [pareto, paretoDie, defects, reasonColor]);

  /* (5) Defect-category donut per die */
  const catKeysFor = (p) => [...CATEGORY_KEYS, ...(p.cats[UNCLASSIFIED] > 0 ? [UNCLASSIFIED] : [])];
  const donutOptions = useMemo(() => Object.fromEntries(recDies.map((d) => {
    const p = defects.perDie[d.die_name];
    const data = catKeysFor(p).filter((k) => p.cats[k] > 0).map((k) => ({ name: k, value: p.cats[k], itemStyle: { color: categoryFill(k) } }));
    return [d.die_name, baseOption({
      title: {
        text: fmtInt(p.records), subtext: "NG records", left: "center", top: "middle", itemGap: 2,
        textStyle: { fontSize: 22, fontWeight: 700, color: INK.primary, fontFamily: FONT_FAMILY },
        subtextStyle: { fontSize: 10.5, color: INK.muted, fontFamily: FONT_FAMILY },
      },
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (q) => tooltipHtml({
          title: `${dieText(d.die_name)} · ${q.name}`,
          subtitle: DEFECT_CATEGORY_LABEL[q.name] || "No category and no reason on the record",
          rows: [
            { label: "NG records", value: fmtInt(q.value), color: q.color },
            { label: "Share of die NG", value: fmtPct(pctOf(q.value, p.records)) },
            { label: `Share of K-12 ${q.name}`, value: fmtPct(pctOf(q.value, defects.catTotals[q.name])) },
            { label: `K-12 mix (${q.name})`, value: fmtPct(pctOf(defects.catTotals[q.name], defects.matched)) },
          ],
        }),
      },
      series: [{
        type: "pie", radius: ["60%", "86%"], center: ["50%", "50%"], avoidLabelOverlap: true,
        label: { show: false }, labelLine: { show: false },
        itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 },
        emphasis: { scale: true, scaleSize: 5 },
        data,
      }],
    })];
  })), [recDies, defects]);

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
  const rowH = 44;
  const barChartHeight = Math.max(180, ordered.length * rowH + 70);
  const ciHeight = Math.max(barChartHeight, ciDies.length * 56 + 84);
  const heatHeight = Math.max(220, recDies.length * 58 + 90);
  const hasPending = ordered.some((d) => d.pending > 0);
  const yTick = (props) => <DieTick {...props} dieColor={dieColor} byName={byName} label={dieText} />;
  const textOn = (bg) => (bg && SEQ_SCRAP.indexOf(bg) >= 4 ? "#ffffff" : INK.primary);
  const recordsGap = defects.matched - plant.ng;

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="die-root">
      <style>{CARD_CSS}{TT_CSS}{`
        .die-root { display: flex; flex-direction: column; gap: 16px; font-family: ${FONT_FAMILY}; }
        .die-root * { box-sizing: border-box; }
        .die-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
        .die-scope { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 10px 14px; border-radius: 12px; border: 1px solid ${INK.border}; background: linear-gradient(90deg, ${withAlpha(ACCENT.model, 0.06)}, #fff 60%); font-size: 12px; color: ${INK.body}; }
        .die-scope b { color: ${INK.primary}; }
        .die-empty { min-height: 180px; display: grid; place-content: center; color: ${INK.faint}; font-size: 12px; text-align: center; padding: 16px; }
        .die-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-size: 11.5px; font-weight: 600; background: #fff; color: ${INK.secondary}; border: 1px solid ${INK.axis}; cursor: pointer; font-family: inherit; }
        .die-btn:hover:not(:disabled) { border-color: ${INK.faint}; color: ${INK.primary}; }
        .die-btn:disabled { opacity: .4; cursor: not-allowed; }
        .die-select { padding: 5px 10px; border-radius: 8px; border: 1px solid ${INK.axis}; font-size: 12px; font-weight: 600; color: ${INK.primary}; background: #fff; font-family: inherit; }
        .die-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
        @media (max-width: 1100px) { .die-split { grid-template-columns: 1fr; } }
        .die-panel-title { font-size: 12.5px; font-weight: 600; color: ${INK.body}; margin: 0 0 4px 4px; }
        .die-panel-head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: baseline; }
        .die-donuts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
        .die-donut { border: 1px solid ${INK.grid}; border-radius: 12px; padding: 10px 12px 12px; background: ${INK.surfaceAlt}; min-width: 0; }
        .die-donut h4 { margin: 0 0 2px; font-size: 13px; font-weight: 700; color: ${INK.primary}; display: flex; align-items: center; gap: 6px; }
        .die-donut-legend { display: grid; grid-template-columns: auto 1fr auto auto; gap: 4px 10px; font-size: 11.5px; color: ${INK.body}; font-variant-numeric: tabular-nums; margin-top: 4px; }
        .die-donut-legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; align-self: center; }
        .die-donut-legend .n { text-align: right; font-weight: 600; color: ${INK.primary}; }
        .die-donut-legend .p { text-align: right; color: ${INK.muted}; min-width: 44px; }
        .die-table-wrap { overflow-x: auto; }
        .die-table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
        .die-table:not(.die-heat) tbody tr:nth-child(even) td { background: #fbfcfe; }
        .die-table:not(.die-heat) tbody tr:hover td { background: ${withAlpha(ACCENT.neutral, 0.06)}; }
        .die-heat tbody tr:hover td:first-child { background: ${withAlpha(HEAT_ACCENT, 0.06)}; }
        .ra-kpi.die-kpi { box-shadow: 0 1px 2px rgba(15,23,42,.04); }
        .die-table th { background: ${INK.surfaceAlt}; padding: 8px 10px; text-align: right; font-size: 11px; font-weight: 600; color: ${INK.muted}; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; border-bottom: 1px solid ${INK.border}; }
        .die-table th:first-child, .die-table td:first-child { text-align: left; }
        .die-table td { padding: 8px 10px; text-align: right; border-bottom: 1px solid ${INK.grid}; color: ${INK.secondary}; white-space: nowrap; }
        .die-table td.left, .die-table th.left { text-align: left; }
        .die-table tfoot td { font-weight: 700; color: ${INK.primary}; background: ${INK.surfaceAlt}; border-top: 1px solid ${INK.border}; border-bottom: none; }
        .die-swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 7px; vertical-align: 0; }
        .die-name { font-weight: 600; color: ${INK.primary}; }
        .die-heat td.cell { text-align: center; min-width: 64px; border-radius: 6px; font-weight: 600; transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .die-heat td.cell:hover { transform: scale(1.08); z-index: 2; box-shadow: 0 4px 12px rgba(15,23,42,0.18); }
        .die-heat th.cell { text-align: center; white-space: normal; min-width: 72px; max-width: 120px; line-height: 1.3; vertical-align: bottom; text-transform: none; letter-spacing: 0; font-size: 11px; color: ${INK.body}; }
        .die-ramp { display: inline-flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; color: ${INK.muted}; background: #f8fafc; padding: 4px 10px; border-radius: 9999px; border: 1px solid #e2e8f0; }
        .die-ramp span.sw { display: inline-flex; border-radius: 4px; overflow: hidden; }
        .die-ramp span.sw i { width: 16px; height: 10px; display: inline-block; }
      `}</style>

      {/* ═══ SCOPE ═══ */}
      <div className="die-scope">
        <span className="ra-chip" style={accent(ACCENT.model)}><Info size={11} />Showing Oil Pan K-12 dies only (OPK12)</span>
        {excludedDies.length > 0 && (
          <span>Other-part dies excluded: <b>{excludedDies.map((d) => `${d.die_name} (${fmtInt(d.total_shots)} parts)`).join(", ")}</b></span>
        )}
        <span>
          No die recorded: <b>{noDieParts != null ? `${fmtInt(noDieParts)} parts` : "—"}</b>
          {` · ${fmtInt(defects.noDie)} NG records`} — kept out of the per-die charts.
        </span>
      </div>

      {/* ═══ KPI CARDS ═══ */}
      <div className="die-kpi-row">
        <KPI label="K-12 dies" value={fmtInt(dies.length)} sub={`${ranked.length} with ${MIN_INSPECTED_FOR_RANK}+ inspected parts`} icon={Layers} color={ACCENT.model} />
        <KPI label="Produced" value={fmtInt(plant.total)} sub={plant.pending > 0 ? `${fmtInt(plant.pending)} still in process` : "All parts have an OK / NG result"} icon={Activity} color={ACCENT.neutral} />
        <KPI label="OK parts" value={fmtInt(plant.ok)} sub={`${fmtPct(pctOf(plant.ok, plant.inspected))} of inspected`} icon={CheckCircle2} color={ACCENT.ok} />
        <KPI label="NG parts" value={fmtInt(plant.ng)} sub={`${fmtInt(defects.matched)} NG records loaded`} icon={AlertTriangle} color={ACCENT.ng} />
        <KPI
          label="K-12 rejection rate" value={fmtPct(plant.rate, 2)}
          sub={plant.ci ? `95% CI ${fmtPct(plant.ci.lo, 2)} – ${fmtPct(plant.ci.hi, 2)}` : "NG ÷ (OK + NG)"}
          icon={Percent} color={ACCENT.ng}
        />
        <KPI
          label="Highest rejection die" value={worst ? worst.die_name : "—"} swatch={worst ? dieColor(worst.die_name) : undefined}
          sub={worst ? `${K12_PART} · ${fmtPct(worst.rate, 2)} · ${fmtPP(worst.vsPlant)}${worst.signal === "above" ? " · significant" : ""}` : `Needs ≥ 2 dies with ${MIN_INSPECTED_FOR_RANK}+ inspected`}
          icon={TrendingUp} color={worst ? ACCENT.ng : ACCENT.neutral}
        />
        <KPI
          label="Lowest rejection die" value={best ? best.die_name : "—"} swatch={best ? dieColor(best.die_name) : undefined}
          sub={best ? `${K12_PART} · ${fmtPct(best.rate, 2)} · ${fmtPP(best.vsPlant)}${best.signal === "below" ? " · significant" : ""}` : `Needs ≥ 2 dies with ${MIN_INSPECTED_FOR_RANK}+ inspected`}
          icon={TrendingDown} color={best ? ACCENT.ok : ACCENT.neutral}
        />
        <KPI
          label="No die recorded" value={noDieParts != null ? fmtInt(noDieParts) : "—"}
          sub={`parts · ${fmtInt(defects.noDie)} NG records`}
          icon={HelpCircle} color={ACCENT.warning}
        />
      </div>

      {/* ═══ (1) OUTPUT + RATE WITH CI ═══ */}
      <Card
        color={ACCENT.ng} icon={BarChart3} title="Output and rejection rate by die"
        sub={`Sorted by rejection rate, highest first; dies under ${MIN_INSPECTED_FOR_RANK} inspected parts listed last.`}
        actions={(
          <button type="button" onClick={handleExportDieExcel} className="die-btn" disabled={!dies.length}>
            <FileSpreadsheet size={14} /> Download report
          </button>
        )}
        note={`Produced = all parts on the die; "In process" = no OK / NG result yet. Rate = NG ÷ (OK + NG) from the die summary query. Whisker = 95% Wilson interval; a die is called significantly above / below only when its whole interval is on one side of the K-12 average (${fmtPct(plant.rate, 2)}, pooled over K-12 dies). Low-volume dies (hollow marker) are not ranked; the axis is scaled to the ranked dies and a low-volume interval that runs past it is clipped (arrow / ▸).${recordsGap > 0 ? ` Note: ${fmtInt(recordsGap)} leak-test NG records on these dies still have an in-process / passed overall status, so they are not in this rate (see "NG records" in the comparison table).` : ""}`}
      >
        {ordered.length === 0 ? (
          <div className="die-empty">No K-12 die statistics available for the selected filters.</div>
        ) : (
          <div className="die-split">
            <div style={{ minWidth: 0 }}>
              <div className="die-panel-head">
                <h4 className="die-panel-title">Parts produced (label = total)</h4>
                <div className="ra-legend">
                  <span><i style={{ background: swatchGrad(OUTCOME.ok) }} />OK</span>
                  <span><i style={{ background: swatchGrad(OUTCOME.ng) }} />NG</span>
                  {hasPending && <span><i style={{ background: swatchGrad(OUTCOME.wip) }} />In process</span>}
                </div>
              </div>
              <SafeChart height={barChartHeight}>
                {({ width, height }) => (
                  <BarChart layout="vertical" width={width} height={height} data={ordered} margin={{ top: 20, right: 64, left: 8, bottom: 24 }} barCategoryGap="26%">
                    <defs>
                      <BarGrad id="okBarGrad" color={OUTCOME.ok} />
                      <BarGrad id="ngBarGrad" color={OUTCOME.ng} />
                      <BarGrad id="wipBarGrad" color={OUTCOME.wip} />
                    </defs>
                    <CartesianGrid {...RECHARTS_GRID} vertical horizontal={false} />
                    <XAxis type="number" {...RECHARTS_AXIS} tickFormatter={(v) => Number(v).toLocaleString()}
                      label={{ value: "Parts (count)", position: "insideBottom", offset: -14, fontSize: 11, fill: INK.body }} />
                    <YAxis type="category" dataKey="die_name" width={118} {...RECHARTS_AXIS} axisLine={false} tick={yTick} interval={0} />
                    <Tooltip cursor={RECHARTS_TOOLTIP.cursor} content={({ active, payload }) => (active && payload?.length ? dieTooltip(payload[0].payload) : null)} />
                    <Bar dataKey="ok_count" name="OK" stackId="p" fill="url(#okBarGrad)" radius={[4, 0, 0, 4]} isAnimationActive={false} />
                    <Bar dataKey="ng_count" name="NG" stackId="p" fill="url(#ngBarGrad)" radius={!hasPending ? [0, 4, 4, 0] : undefined} isAnimationActive={false}>
                      {!hasPending && <LabelList dataKey="total_shots" position="right" style={{ fontSize: 10.5, fontWeight: 600, fill: INK.secondary }} formatter={(v) => Number(v).toLocaleString()} />}
                    </Bar>
                    {hasPending && (
                      <Bar dataKey="pending" name="In process" stackId="p" fill="url(#wipBarGrad)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                        <LabelList dataKey="total_shots" position="right" style={{ fontSize: 10.5, fontWeight: 600, fill: INK.secondary }} formatter={(v) => Number(v).toLocaleString()} />
                      </Bar>
                    )}
                  </BarChart>
                )}
              </SafeChart>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="die-panel-head">
                <h4 className="die-panel-title">Rejection rate with 95% confidence interval</h4>
                <div className="ra-legend">
                  <span><i style={{ background: OUTCOME.ng, borderRadius: 99 }} />Above avg</span>
                  <span><i style={{ background: ACCENT.neutral, borderRadius: 99 }} />Not significant</span>
                  <span><i style={{ background: OUTCOME.ok, borderRadius: 99 }} />Below avg</span>
                  <span><i style={{ background: "#fff", border: `2px solid ${OUTCOME.wip}`, borderRadius: 99 }} />Low volume</span>
                  <span><i style={{ background: "transparent", borderTop: `2px dashed ${AVG_LINE}`, height: 0, borderRadius: 0 }} />K-12 avg</span>
                </div>
              </div>
              {ciOption ? <EChart option={ciOption} style={{ height: ciHeight, minHeight: 180 }} /> : <div className="die-empty">No inspected parts.</div>}
            </div>
          </div>
        )}
      </Card>

      {/* ═══ (2) TREND + (4) SHIFT ═══ */}
      <div className="ra-grid2">
        <Card
          color={ACCENT.process} icon={LineChartIcon} title="Daily NG trend by die"
          sub="NG records per day, one line per die."
          note={`Date = NG recorded time (falls back to first scan). This is a count of NG records — daily production per die is not available, so busy days look worse. Some records were loaded into the system after they were scanned, so the trend can start before the selected date range.${defects.noDay ? ` ${fmtInt(defects.noDay)} records without a timestamp are not plotted.` : ""}`}
        >
          {trendOption ? <EChart option={trendOption} style={{ height: 320 }} /> : <div className="die-empty">No dated NG records on K-12 dies.</div>}
        </Card>
        <Card
          color={ACCENT.location} icon={Clock} title="NG by shift and die"
          sub="NG records per shift, grouped by die."
          note="Shift = shift code on the NG record. The records API returns shift A when a record has no shift code, so shift A may include unassigned records."
        >
          {shiftOption ? <EChart option={shiftOption} style={{ height: 320 }} /> : <div className="die-empty">No NG records on K-12 dies.</div>}
        </Card>
      </div>

      {/* ═══ (3) STATION HEAT + (6) PARETO ═══ */}
      <div className="ra-grid2">
        <Card
          color={HEAT_ACCENT} icon={Grid} title="Die × station NG matrix"
          sub="NG records by first NG gate; cell = count and share of the die's NG."
          actions={stationOption ? (
            <span className="die-ramp">0<span className="sw">{SEQ_SCRAP.map((c) => <i key={c} style={{ background: c }} />)}</span>max</span>
          ) : null}
          note={'Station = the first gate flagged NG on the record (lowest OP number). "No gate" = NG record with no station status flagged.'}
        >
          {stationOption ? <EChart option={stationOption} style={{ height: heatHeight }} /> : <div className="die-empty">No NG records on K-12 dies.</div>}
        </Card>
        <Card
          color={ACCENT.quality} icon={ListOrdered} title="Top defects Pareto"
          sub={`Top ${PARETO_TOP} defect reasons for the selected die; bars and cumulative line share one 0–100% axis.`}
          actions={recDies.length > 0 ? (
            <select className="die-select" value={paretoDie} onChange={(e) => setParetoPick(e.target.value)} aria-label="Die for Pareto">
              {recDies.map((d) => <option key={d.die_name} value={d.die_name}>{dieText(d.die_name)} ({fmtInt(defects.perDie[d.die_name].records)})</option>)}
            </select>
          ) : null}
          note="Bar height = % of the die's NG records; bar label = record count. The dashed line marks 80% — reasons left of where the cumulative line crosses it drive most of the die's scrap."
        >
          {paretoOption ? <EChart option={paretoOption} style={{ height: 340 }} /> : <div className="die-empty">No NG records on K-12 dies.</div>}
        </Card>
      </div>

      {/* ═══ (5) CATEGORY DONUTS ═══ */}
      <Card
        color={ACCENT.model} icon={PieChart} title="Defect category mix by die"
        sub="Share of each die's NG records by rejection category; centre = die NG records."
        note={`K-12 mix: ${[...CATEGORY_KEYS, UNCLASSIFIED].filter((k) => defects.catTotals[k] > 0).map((k) => `${k} ${fmtInt(defects.catTotals[k])} (${fmtPct(pctOf(defects.catTotals[k], defects.matched))})`).join(" · ") || "—"}. Unclassified = record has neither a category nor a reason.`}
      >
        {recDies.length === 0 ? (
          <div className="die-empty">No NG records with a K-12 die are loaded for these filters.</div>
        ) : (
          <div className="die-donuts">
            {recDies.map((d) => {
              const p = defects.perDie[d.die_name];
              return (
                <div className="die-donut" key={d.die_name}>
                  <h4><i className="die-swatch" style={{ background: dieColor(d.die_name), marginRight: 0 }} />{dieText(d.die_name)}</h4>
                  <EChart option={donutOptions[d.die_name]} style={{ height: 190, minHeight: 190 }} />
                  <div className="die-donut-legend">
                    {catKeysFor(p).map((k) => (
                      <React.Fragment key={k}>
                        <i style={{ background: categoryFill(k) }} />
                        <span title={DEFECT_CATEGORY_LABEL[k] || k}>{k}</span>
                        <span className="n">{fmtInt(p.cats[k])}</span>
                        <span className="p">{fmtPct(pctOf(p.cats[k], p.records))}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ═══ TOP DEFECTS HEAT TABLE ═══ */}
      <Card
        color={HEAT_ACCENT} icon={Target} title="Top defects by die"
        sub={`NG count per die for the ${heatReasons.length} most frequent defect reasons on K-12 dies.`}
        actions={heatMax > 0 ? (
          <span className="die-ramp">1<span className="sw">{SEQ_SCRAP.map((c) => <i key={c} style={{ background: c }} />)}</span>{fmtInt(heatMax)}</span>
        ) : null}
        note="Darker = more NG records. Hover a cell for its share of the die's and of all K-12 rejections with that reason."
      >
        {heatReasons.length === 0 ? (
          <div className="die-empty">No defect reasons recorded for these filters.</div>
        ) : (
          <div className="die-table-wrap">
            <table className="die-table die-heat">
              <thead>
                <tr>
                  <th className="left">Die</th>
                  {heatReasons.map((r) => (
                    <th key={r} className="cell" title={`${r}: ${fmtInt(defects.reasonTotals[r])} NG on K-12 dies`}>
                      <i className="die-swatch" style={{ background: reasonColor(r), marginRight: 4 }} />{r}
                    </th>
                  ))}
                  {hasOtherReasons && <th className="cell">Other reasons</th>}
                </tr>
              </thead>
              <tbody>
                {heatRows.map(({ die, cells, other, withReason }) => (
                  <tr key={die.die_name}>
                    <td>
                      <i className="die-swatch" style={{ background: dieColor(die.die_name) }} />
                      <span className="die-name">{dieText(die.die_name)}</span>
                    </td>
                    {[...cells, ...(hasOtherReasons ? [other] : [])].map((c, i) => {
                      const reason = i < heatReasons.length ? heatReasons[i] : "Other reasons";
                      const plantTotal = i < heatReasons.length ? defects.reasonTotals[reason] : null;
                      const bg = seqColor(c, heatMax, SEQ_SCRAP);
                      return (
                        <td
                          key={reason}
                          className="cell"
                          style={{ background: bg || "transparent", color: c ? textOn(bg) : INK.faint }}
                          title={`${dieText(die.die_name)} · ${reason}\n${fmtInt(c)} NG` +
                            `${withReason ? ` · ${fmtPct((c / withReason) * 100)} of this die's reasons` : ""}` +
                            `${plantTotal ? ` · ${fmtPct((c / plantTotal) * 100)} of K-12 "${reason}"` : ""}`}
                        >
                          {c ? fmtInt(c) : "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ═══ COMPARISON TABLE ═══ */}
      <Card
        color={ACCENT.neutral} icon={Table} title="Die comparison"
        sub="Same order as the rate chart; top defect and category from loaded NG records."
        note={`Rejection % = NG ÷ (OK + NG) from the die summary. "vs K-12" = difference in percentage points from the K-12 average (${fmtPct(plant.rate, 2)}). ` +
          `"NG" counts every part rejected at any station or by the leak test, the same definition as the NG records` +
          `${recordsGap !== 0 ? ` (records differ by ${recordsGap > 0 ? "+" : "−"}${fmtInt(Math.abs(recordsGap))}, e.g. parts outside the loaded page)` : " (they tie out)"}.` +
          `${defects.otherDie > 0 ? ` ${fmtInt(defects.otherDie)} NG records on non-K-12 dies are excluded.` : ""}`}
      >
        {ordered.length === 0 ? (
          <div className="die-empty">No dies to compare.</div>
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
                  <th>Share of NG</th>
                  <th>NG records</th>
                  <th className="left">Top defect</th>
                  <th className="left">Top category</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((d) => {
                  const p = dieDefect(d.die_name);
                  const topReason = topOf(p?.reasons, [NO_REASON]);
                  const topCat = topOf(p?.cats);
                  return (
                    <tr key={d.die_name}>
                      <td>
                        <i className="die-swatch" style={{ background: dieColor(d.die_name) }} />
                        <span className="die-name">{dieText(d.die_name)}</span>
                        {d.lowVolume && <span className="ra-chip" style={{ ...accent(ACCENT.warning), marginLeft: 8 }}><AlertTriangle size={10} />Low volume</span>}
                      </td>
                      <td>{fmtInt(d.total_shots)}</td>
                      <td style={{ color: OUTCOME.ok, fontWeight: 600 }}>{fmtInt(d.ok_count)}</td>
                      <td style={{ color: OUTCOME.ng, fontWeight: 600 }}>{fmtInt(d.ng_count)}</td>
                      {hasPending && <td>{fmtInt(d.pending)}</td>}
                      <td>
                        {d.rate != null ? (
                          <span className="ra-chip" style={{ ...accent(d.lowVolume ? ACCENT.neutral : signalColor(d)), fontWeight: 700 }} title={signalText(d)}>
                            {fmtPct(d.rate, 2)}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ color: INK.muted }}>{d.ci ? `${d.ci.lo.toFixed(2)} – ${d.ci.hi.toFixed(2)}%` : "—"}</td>
                      <td>
                        {d.vsPlant != null ? (
                          <span className="ra-chip" style={accent(d.vsPlant > 0 ? ACCENT.ng : d.vsPlant < 0 ? ACCENT.ok : ACCENT.neutral)}>
                            {fmtPP(d.vsPlant)}
                          </span>
                        ) : "—"}
                      </td>
                      <td>{fmtPct(d.shareOfNg)}</td>
                      <td>{fmtInt(p?.records || 0)}</td>
                      <td className="left">
                        {topReason ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <i className="die-swatch" style={{ background: reasonColor(topReason.key), borderRadius: 3 }} />
                            <span>{topReason.key}</span>
                            <span style={{ color: INK.muted, fontSize: 11 }}>({fmtInt(topReason.count)})</span>
                          </span>
                        ) : "—"}
                      </td>
                      <td className="left">
                        {topCat ? (
                          <span className="ra-chip" style={accent(categoryFill(topCat.key))}>
                            <i className="die-swatch" style={{ background: categoryFill(topCat.key), marginRight: 0 }} />
                            {topCat.key} <span style={{ color: INK.muted, fontWeight: 500 }}>{fmtPct((topCat.count / p.records) * 100, 0)}</span>
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>All K-12 dies</td>
                  <td>{fmtInt(plant.total)}</td>
                  <td>{fmtInt(plant.ok)}</td>
                  <td>{fmtInt(plant.ng)}</td>
                  {hasPending && <td>{fmtInt(plant.pending)}</td>}
                  <td><span className="ra-chip" style={{ ...accent(AVG_LINE), fontWeight: 700 }}>{fmtPct(plant.rate, 2)}</span></td>
                  <td style={{ color: INK.muted }}>{plant.ci ? `${plant.ci.lo.toFixed(2)} – ${plant.ci.hi.toFixed(2)}%` : "—"}</td>
                  <td>—</td>
                  <td>{plant.ng > 0 ? "100.0%" : "—"}</td>
                  <td>{fmtInt(defects.matched)}</td>
                  <td className="left">
                    {defects.reasonOrder[0] ? `${defects.reasonOrder[0]} (${fmtInt(defects.reasonTotals[defects.reasonOrder[0]])})` : "—"}
                  </td>
                  <td className="left">
                    {(() => {
                      const t = topOf(defects.catTotals);
                      return t && defects.matched ? `${t.key} ${fmtPct((t.count / defects.matched) * 100, 0)}` : "—";
                    })()}
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
