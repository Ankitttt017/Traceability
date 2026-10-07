import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  Clock, Activity, Droplets, Thermometer, Target, Download, RotateCcw,
  Search, ArrowLeft, Gauge as GaugeIcon, Flame, Wind,
  ShieldAlert, Sliders, AlertTriangle, Layers, CheckCircle2, TrendingUp,
  Sigma, ArrowUpDown, ChevronUp, ChevronDown, ListChecks, Scale, Waves,
} from "lucide-react";
import {
  ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceLine, ReferenceArea, Brush, LabelList, Cell,
} from "recharts";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import SafeChart from "../../components/charts/SafeChart";
import FacetedBoxPlot from "./FacetedBoxPlot";
import {
  ALL_TELEMETRY_CATEGORIES, ALL_45_PARAMETERS, MACHINE_PROCESS_PARAMETERS,
  formatResultTimestamp, looksLikeCustomerQr,
  extractShotFromPartId, extractShotDateTimeFromPartId,
} from "./rejectionConstants";
import {
  INK as THEME, CATEGORICAL, STATUS, FONT_FAMILY, OUTCOME, ACCENT, accent, withAlpha,
  RECHARTS_TOOLTIP, RECHARTS_AXIS, RECHARTS_GRID, CARD_CSS,
} from "./chartTheme";

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS & HELPERS (all colours come from the shared chart theme)
   ───────────────────────────────────────────────────────────────────────────── */
const INK = THEME.primary;
const MUTED = THEME.muted;
const GRID = THEME.grid;
const SERIES = CATEGORICAL[0];      // measurements (normal points)
const C_OK = STATUS.good;
const C_WARN = STATUS.warning;
const C_NG = STATUS.critical;
const LIMIT = STATUS.critical;      // spec limits LSL / USL
const CONTROL = STATUS.serious;     // control limits UCL / LCL
const WARN_LINE = STATUS.warning;   // ±2σ warning limits
const CENTER = THEME.secondary;     // set point / centre line

const TOOLTIP_STYLE = { ...RECHARTS_TOOLTIP.contentStyle, minWidth: 200 };
const REF_LABEL = { fontSize: 10.5, fill: CENTER, fontFamily: FONT_FAMILY };

/* Point status, in priority order. "Warning" = beyond ±2σ but inside control limits, or within 10 % of the
   tolerance band from a spec limit. */
const PT_COLOR = { normal: SERIES, warning: STATUS.warning, ooc: STATUS.serious, oos: STATUS.critical };
const PT_LABEL = { normal: "Normal", warning: "Warning", ooc: "Out of control", oos: "Out of spec" };
const PT_KEYS = ["normal", "warning", "ooc", "oos"];

const NG_STATUSES = ["NG", "FAILED", "FAIL", "ENDED_NG", "COMPLETED_NG"];
const OK_STATUSES = ["OK", "PASSED", "ENDED_OK", "COMPLETED_OK"];

/* ═════════════════════════════════════════════════════════════════════════════
   SPC MATHS — pure functions (no React, no imports). Everything between the
   SPC-MATHS-BEGIN / SPC-MATHS-END markers is self-contained so it can be
   re-run outside the browser to verify the numbers against live data.
   ═════════════════════════════════════════════════════════════════════════════ */
/* SPC-MATHS-BEGIN */
const NEAR_SPEC_FRACTION = 0.1;  // "near spec" warning band = 10 % of the tolerance inside each limit
const D2 = 1.128;                // d2 for moving ranges of 2 → σ_within = MR̄ / d2
const SPC_WINDOW = 1000;         // last N readings per parameter used by every SPC statistic
const EWMA_LAMBDA = 0.2;
const EWMA_L = 3;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const camel = (k) => String(k || "").replace(/_([a-z0-9])/g, (_, l) => l.toUpperCase());

/** Spec limits are "not set" when missing, zero, a 9999-style placeholder, or inverted. */
const sanitizeLimits = (lslRaw, uslRaw) => {
  const lsl = lslRaw === "" || lslRaw == null ? null : Number(lslRaw);
  const usl = uslRaw === "" || uslRaw == null ? null : Number(uslRaw);
  const has = isNum(lsl) && isNum(usl) && lsl !== 0 && usl !== 0 && usl < 9999 && usl > lsl;
  return has ? { lsl, usl, has: true } : { lsl: null, usl: null, has: false };
};

/** Read a parameter value from a production row. Zero / non-numeric readings are treated as "not recorded". */
const getParamValue = (r, spec) => {
  if (spec.key === "plc_cycle_time") {
    const m = String(r.machineName || r.machine_name || "").toLowerCase();
    if (m.includes("inspection") || m.includes("pdi") || m.includes("guag")) return null;
    const isCasting = m.includes("dcm") || m.includes("casting") || m.includes("dc");
    const n = Number(r.plc_cycle_time ?? r.plcCycleTime ?? (isCasting ? (r.cycleTime ?? r.cycle_time) : null));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const keys = [spec.key, camel(spec.key), ...(spec.altKeys || [])];
  for (const k of keys) {
    const raw = r[k];
    if (raw === undefined || raw === null || raw === "" || raw === "-") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

/** Mean, sample std dev (σ_overall), min, max and moving-range sigma σ_within = MR̄ / 1.128 of an ordered series. */
const seriesStats = (vals) => {
  const n = vals.length;
  if (!n) return { n: 0, mean: null, std: null, min: null, max: null, sigmaWithin: null, mrBar: null };
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const std = n > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  let mrSum = 0;
  for (let i = 1; i < n; i++) mrSum += Math.abs(vals[i] - vals[i - 1]);
  const mrBar = n > 1 ? mrSum / (n - 1) : null;
  const sigmaWithin = n > 1 ? mrBar / D2 : null;
  let min = Infinity, max = -Infinity;
  vals.forEach((v) => { if (v < min) min = v; if (v > max) max = v; });
  return { n, mean, std, min, max, sigmaWithin, mrBar };
};

/** Individuals-chart limits from moving-range σ: centre, ±2σ warning and ±3σ control limits. */
const controlLimits = (st) => {
  const s = st.sigmaWithin;
  if (!isNum(st.mean) || !isNum(s) || s <= 0) return { mean: st.mean, sigma: null, ucl: null, lcl: null, uwl: null, lwl: null };
  return { mean: st.mean, sigma: s, ucl: st.mean + 3 * s, lcl: st.mean - 3 * s, uwl: st.mean + 2 * s, lwl: st.mean - 2 * s };
};

/** Classify one reading: oos (beyond LSL/USL) > ooc (beyond UCL/LCL) > warning > normal. */
const classifyPoint = (v, spec, ctl) => {
  if (!isNum(v)) return null;
  if (spec.hasLimits && (v < spec.lsl || v > spec.usl)) return "oos";
  if (isNum(ctl.ucl) && (v > ctl.ucl || v < ctl.lcl)) return "ooc";
  const band = spec.hasLimits ? (spec.usl - spec.lsl) * NEAR_SPEC_FRACTION : null;
  const nearSpec = band != null && (v > spec.usl - band || v < spec.lsl + band);
  const beyond2 = isNum(ctl.uwl) && (v > ctl.uwl || v < ctl.lwl);
  return nearSpec || beyond2 ? "warning" : "normal";
};

const countStatuses = (vals, spec, ctl) => {
  const c = { normal: 0, warning: 0, ooc: 0, oos: 0 };
  vals.forEach((v) => { const k = classifyPoint(v, spec, ctl); if (k) c[k] += 1; });
  return c;
};

/**
 * Process capability of an ordered series against its spec.
 *   Cp  = (USL − LSL) / 6σ_within         Cpk = min(USL − μ, μ − LSL) / 3σ_within
 *   Pp  = (USL − LSL) / 6σ_overall        Ppk = min(USL − μ, μ − LSL) / 3σ_overall
 * σ_within = MR̄ / 1.128 (short-term), σ_overall = sample standard deviation (long-term).
 */
const capability = (vals, spec) => {
  const st = seriesStats(vals);
  const ok = spec.hasLimits && st.n > 1;
  const sw = st.sigmaWithin;
  const so = st.std;
  const tol = ok ? spec.usl - spec.lsl : null;
  const nearest = ok ? Math.min(spec.usl - st.mean, st.mean - spec.lsl) : null;
  const usable = (s) => ok && isNum(s) && s > 0;
  const oos = spec.hasLimits ? vals.filter((v) => v < spec.lsl || v > spec.usl).length : null;
  return {
    ...st,
    sigmaOverall: so,
    cp: usable(sw) ? tol / (6 * sw) : null,
    cpk: usable(sw) ? nearest / (3 * sw) : null,
    pp: usable(so) ? tol / (6 * so) : null,
    ppk: usable(so) ? nearest / (3 * so) : null,
    oos,
    oosPct: oos != null && st.n > 0 ? (oos / st.n) * 100 : null,
  };
};

/** Capability rating: ≥ 1.33 capable, 1.00 – 1.33 marginal, < 1.00 not capable. */
const capRating = (c) => (!isNum(c) ? null : c >= 1.33 ? "capable" : c >= 1 ? "marginal" : "not");

/** Western Electric / Nelson run rules used on the individuals chart. */
const RUN_RULES = [
  { id: 1, short: "R1", label: "1 point beyond ±3σ" },
  { id: 2, short: "R2", label: "9 points in a row on one side of the centre line" },
  { id: 3, short: "R3", label: "6 points in a row steadily increasing or decreasing" },
  { id: 5, short: "R5", label: "2 of 3 points beyond ±2σ on the same side" },
];

/**
 * Run-rule test per point (the point that completes the pattern is flagged), centre μ and σ = σ_within.
 *   R1: |x − μ| > 3σ
 *   R2: this point and the 8 before it all strictly above μ (or all strictly below)
 *   R3: this point and the 5 before it strictly increasing (or strictly decreasing) — 5 rises/falls in a row
 *   R5: this point beyond 2σ, and at least 2 of the last 3 points beyond 2σ on that same side
 * Returns an array (one entry per reading) of the rule ids broken at that reading.
 */
const detectRunRules = (vals, mean, sigma) => {
  const out = vals.map(() => []);
  if (!isNum(mean) || !isNum(sigma) || sigma <= 0) return out;
  const hi2 = mean + 2 * sigma;
  const lo2 = mean - 2 * sigma;
  let above = 0, below = 0, up = 0, down = 0;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (Math.abs(v - mean) > 3 * sigma) out[i].push(1);
    above = v > mean ? above + 1 : 0;
    below = v < mean ? below + 1 : 0;
    if (above >= 9 || below >= 9) out[i].push(2);
    if (i > 0) {
      up = v > vals[i - 1] ? up + 1 : 0;
      down = v < vals[i - 1] ? down + 1 : 0;
    }
    if (up >= 5 || down >= 5) out[i].push(3);
    const w = vals.slice(Math.max(0, i - 2), i + 1);
    if ((v > hi2 && w.filter((x) => x > hi2).length >= 2) || (v < lo2 && w.filter((x) => x < lo2).length >= 2)) out[i].push(5);
  }
  return out;
};

/**
 * EWMA chart: z_i = λ·x_i + (1 − λ)·z_{i−1}, z_0 = μ.
 * Limits μ ± L·σ·√(λ / (2 − λ) · (1 − (1 − λ)^{2i})), σ = σ_within.
 */
const ewmaSeries = (vals, mean, sigma, lambda = EWMA_LAMBDA, L = EWMA_L) => {
  if (!isNum(mean) || !isNum(sigma) || sigma <= 0) return vals.map(() => ({ z: null, ucl: null, lcl: null, ooc: false }));
  let z = mean;
  return vals.map((x, k) => {
    const i = k + 1;
    z = lambda * x + (1 - lambda) * z;
    const w = L * sigma * Math.sqrt((lambda / (2 - lambda)) * (1 - (1 - lambda) ** (2 * i)));
    return { z, ucl: mean + w, lcl: mean - w, ooc: z > mean + w || z < mean - w };
  });
};

const normalPdf = (x, mu, s) => Math.exp(-((x - mu) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));

/** Histogram range: the data range, widened to take in any limit that lies within one data span of the data. */
const histRange = (vals, marks = []) => {
  if (!vals.length) return null;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const span = hi - lo || Math.max(Math.abs(hi) * 0.05, 1);
  marks.filter(isNum).forEach((m) => {
    if (m >= lo - span && m <= hi + span) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
  });
  if (hi === lo) { lo -= span / 2; hi += span / 2; }
  const pad = (hi - lo) * 0.03;
  return [lo - pad, hi + pad];
};

/** Equal-width bins over [lo, hi]; bin count = √n clamped to 8 … 30. */
const makeBins = (lo, hi, n) => {
  const count = Math.max(8, Math.min(30, Math.round(Math.sqrt(Math.max(n, 1)))));
  const width = (hi - lo) / count;
  return {
    width,
    bins: Array.from({ length: count }, (_, i) => ({ x: lo + (i + 0.5) * width, binStart: lo + i * width, binEnd: lo + (i + 1) * width })),
    indexOf: (v) => Math.min(count - 1, Math.max(0, Math.floor((v - lo) / width))),
  };
};

/** OK vs NG mean shift in units of the pooled standard deviation (Cohen's d = (μ_NG − μ_OK) / s_pooled). */
const groupShift = (okVals, ngVals) => {
  const a = seriesStats(okVals);
  const b = seriesStats(ngVals);
  const delta = isNum(a.mean) && isNum(b.mean) ? b.mean - a.mean : null;
  const pooled = a.n > 1 && b.n > 1
    ? Math.sqrt(((a.n - 1) * a.std ** 2 + (b.n - 1) * b.std ** 2) / (a.n + b.n - 2))
    : null;
  return { ok: a, ng: b, delta, pooled, d: isNum(pooled) && pooled > 0 && delta != null ? delta / pooled : null };
};
/* SPC-MATHS-END */

const fmtVal = (v, d = 2) => (isNum(v) ? Number(v.toFixed(d)).toString() : "—");
const fmtSigned = (v, d = 2, suffix = "") => (isNum(v) ? `${v > 0 ? "+" : ""}${Number(v.toFixed(d))}${suffix}` : "—");
/** Like fmtVal, but keeps 3 significant digits for tiny values (e.g. σ = 0.0004) instead of rounding to 0. */
const fmtSmall = (v, d = 3) => (isNum(v) && v !== 0 && Math.abs(v) < 10 ** -(d - 1) ? String(Number(v.toPrecision(3))) : fmtVal(v, d));
/** KPI / label number: 4 significant digits below 1 (so 0.1994 – 0.2018 do not both read 0.2), else 2 decimals. */
const fmtKpi = (v) => (isNum(v) && v !== 0 && Math.abs(v) < 1 ? String(Number(v.toPrecision(4))) : fmtVal(v));
const fmtAxis = (v) => (isNum(v) ? String(Number(v.toFixed(Math.abs(v) < 10 ? 2 : 1))) : "");

/** Resolve the spec for a parameter: recipe limits from the ML/recipe feed first, catalog defaults second. */
const resolveSpec = (key, features = []) => {
  const feat = features?.find((f) => f.key === key);
  const cat = ALL_45_PARAMETERS.find((p) => p.key === key);
  const base = cat || feat || { key, label: key, unit: "" };
  const fromFeat = sanitizeLimits(feat?.lsl ?? feat?.setLowerLimit, feat?.usl ?? feat?.setUpperLimit);
  const fromCat = sanitizeLimits(cat?.defaultLower, cat?.defaultUpper);
  const lim = fromFeat.has ? fromFeat : fromCat;
  let setPoint = null;
  if (lim.has) {
    const sp = Number(fromFeat.has ? feat?.setPoint : cat?.setPoint);
    setPoint = isNum(sp) && sp >= lim.lsl && sp <= lim.usl ? sp : Number(((lim.lsl + lim.usl) / 2).toFixed(4));
  }
  return {
    key,
    label: base.label || feat?.label || key,
    unit: base.unit || feat?.unit || "",
    altKeys: [...(cat?.altKeys || []), ...(feat?.altKeys || [])],
    color: cat?.color || feat?.color || ACCENT.process,
    lsl: lim.lsl, usl: lim.usl, hasLimits: lim.has, setPoint,
  };
};

const paddedDomain = (values) => {
  const v = values.filter(isNum);
  if (!v.length) return ["auto", "auto"];
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min;
  const pad = span > 0 ? span * 0.08 : Math.max(Math.abs(max) * 0.05, 0.01);
  return [min - pad, max + pad];
};

const partInfo = (r) => {
  const rawPartId = String(r.partId || r.part_id || r.barcode || "").trim();
  const rawCustomerQr = String(r.customerQrCode || r.customer_qr || r.customerQr || r.customer_qr_code || "").trim();
  const isQr = !rawPartId || rawPartId === "-" || looksLikeCustomerQr(rawPartId) || (rawCustomerQr && rawPartId === rawCustomerQr);
  const partId = isQr ? "" : rawPartId;
  const shotIso = partId ? extractShotDateTimeFromPartId(partId) : null;
  const tsRaw = shotIso || r.first_scan_at || r.createdAt || null;
  const ts = tsRaw ? new Date(tsRaw).getTime() : NaN;
  const rawShot = r.shot_number && r.shot_number !== "-" ? r.shot_number : (r.shotNumber && r.shotNumber !== "-" ? r.shotNumber : "");
  const shot = rawShot ? String(rawShot).trim() : (partId ? extractShotFromPartId(partId) : "");
  const status = String(r.status || r.overall_status || "").trim().toUpperCase();
  return {
    partId,
    customerQr: rawCustomerQr && rawCustomerQr !== "-" ? rawCustomerQr : "",
    ts: Number.isFinite(ts) ? ts : null,
    shot,
    quality: NG_STATUSES.includes(status) ? "NG" : (OK_STATUSES.includes(status) ? "OK" : "WIP"),
  };
};

/* ═════════════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═════════════════════════════════════════════════════════════════════════════ */
const CAT_COLORS = {
  machine_process: { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", glow: "rgba(37,99,235,0.18)" },
  die_temperature: { color: "#e11d48", bg: "#fff1f2", border: "#fecdd3", glow: "rgba(225,29,72,0.18)" },
  metal_furnace: { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa", glow: "rgba(234,88,12,0.18)" },
  injection_velocity: { color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", glow: "rgba(124,58,237,0.18)" },
  biscuit_thickness: { color: "#059669", bg: "#ecfdf5", border: "#a7f3d0", glow: "rgba(5,150,105,0.18)" },
  hydraulic_pressures: { color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc", glow: "rgba(8,145,178,0.18)" },
  timing_parameters: { color: "#4f46e5", bg: "#eef2ff", border: "#c7d2fe", glow: "rgba(79,70,229,0.18)" },
  vacuum_pressures: { color: "#c026d3", bg: "#fdf4ff", border: "#f5d0fe", glow: "rgba(192,38,211,0.18)" },
};

const CategoryTab = ({ cat, isActive, onClick }) => {
  const IconMap = { clock: Clock, activity: Activity, droplet: Droplets, thermometer: Thermometer, flame: Flame, wind: Wind, target: Target, gauge: GaugeIcon };
  const Icon = IconMap[cat.icon] || Activity;
  const theme = CAT_COLORS[cat.id] || { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tm-category-tab ${isActive ? "active" : ""}`}
      style={isActive ? {
        background: `linear-gradient(135deg, ${theme.color} 0%, ${theme.color}dd 100%)`,
        borderColor: theme.color,
        color: "#fff",
        boxShadow: `0 3px 10px ${theme.glow || "rgba(0,0,0,0.12)"}`,
      } : undefined}
    >
      <Icon size={14} style={{ color: isActive ? "#fff" : theme.color }} />
      <span className="tm-category-tab-label">{cat.shortLabel || cat.label}</span>
      <span
        className="tm-category-tab-count"
        style={{
          background: isActive ? "rgba(255,255,255,0.22)" : theme.bg,
          color: isActive ? "#fff" : theme.color,
          padding: "1px 7px",
          borderRadius: 9999,
          fontWeight: 700,
        }}
      >
        {cat.params?.length ?? cat.count}
      </span>
    </button>
  );
};

const KpiCard = ({ label, value, unit, subtext, valueColor, icon: Icon, color = ACCENT.process }) => (
  <div className="ra-kpi tm-kpi" data-accent style={accent(color)}>
    <div className="ra-kpi-top" style={{ marginBottom: 6 }}>
      {Icon && <span className="ra-icon" style={{ width: 28, height: 28, borderRadius: 8 }}><Icon size={15} /></span>}
      <div className="ra-kpi-label">{label}</div>
    </div>
    <div className="ra-kpi-value tm-kpi-value" style={valueColor ? { color: valueColor } : undefined}>
      {value}
      {unit && value !== "—" && <span className="tm-kpi-unit">{unit}</span>}
    </div>
    {subtext && <div className="tm-kpi-subtext">{subtext}</div>}
  </div>
);

const MiniStat = ({ label, value, color }) => (
  <div className="tm-mini-stat" style={{ background: "#f8fafc", padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
    <span className="tm-mini-stat-label">{label}</span>
    <span className="tm-mini-stat-value" style={color ? { color } : undefined}>{value}</span>
  </div>
);

const LegendKey = ({ items }) => (
  <div className="tm-legend">
    {items.map((it) => (
      <span key={it.label} className="tm-legend-item">
        {it.type === "line"
          ? <span className="tm-legend-line" style={{ borderTopColor: it.color, borderTopStyle: it.dotted ? "dotted" : it.dashed ? "dashed" : "solid" }} />
          : it.type === "diamond"
            ? <span className="tm-legend-dot" style={{ width: 9, height: 9, borderRadius: 1, transform: "rotate(45deg)", background: withAlpha(it.color, 0.12), border: `1.6px solid ${it.color}` }} />
          : it.type === "ring"
            ? <span className="tm-legend-dot" style={{ background: "#fff", border: `2px solid ${it.color}` }} />
            : it.type === "band"
              ? <span className="tm-legend-band" style={{ background: withAlpha(it.color, 0.14), borderColor: withAlpha(it.color, 0.45) }} />
              : <span className="tm-legend-dot" style={{ background: it.color }} />}
        {it.label}
      </span>
    ))}
  </div>
);

/** Legend items for an SPC / trend chart: four point states plus whichever reference lines are drawn. */
const spcLegendItems = ({ hasLimits, hasControl, extra = [] }) => [
  { label: "Reading", color: SERIES, type: "line" },
  ...PT_KEYS.filter((k) => hasLimits || k !== "oos").map((k) => ({ label: PT_LABEL[k], color: PT_COLOR[k] })),
  ...extra,
  ...(hasLimits ? [{ label: "In-spec zone", color: OUTCOME.ok, type: "band" }] : []),
  ...(hasControl ? [{ label: "Beyond control limits", color: STATUS.critical, type: "band" }] : []),
  ...(hasLimits ? [{ label: "Spec limits LSL / USL", color: LIMIT, type: "line", dashed: true }] : []),
  { label: hasLimits ? "Set point" : "Mean (no set point)", color: CENTER, type: "line", dashed: true },
  ...(hasControl ? [
    { label: "Control limits UCL / LCL (±3σ)", color: CONTROL, type: "line", dashed: true },
    { label: "Warning limits (±2σ)", color: WARN_LINE, type: "line", dotted: true },
  ] : []),
];

/** Per-status counts shown in each parameter card. */
const StatusCounts = ({ counts, hasLimits, inline = false }) => (
  <div className="tm-status-row" style={inline ? { padding: 0, borderBottom: "none" } : undefined}>
    {PT_KEYS.map((k) => {
      const na = k === "oos" && !hasLimits;
      const count = na ? "n/a" : (counts?.[k] ?? 0);
      const lit = !na && count > 0 && k !== "normal";
      return (
        <span
          key={k}
          className="ra-chip tm-status-chip"
          title={na ? "Spec limits not configured" : undefined}
          style={accent(lit ? PT_COLOR[k] : THEME.faint)}
        >
          <i style={{ background: PT_COLOR[k], width: 8, height: 8, borderRadius: "50%" }} />
          <span style={{ fontWeight: 500, color: THEME.body }}>{PT_LABEL[k]}</span>
          <strong style={{ color: lit ? PT_COLOR[k] : INK, fontWeight: 700 }}>
            {na ? "n/a" : count.toLocaleString()}
          </strong>
        </span>
      );
    })}
  </div>
);

/** Recharts dot renderer coloured by point status. Normal points are hidden on dense series. */
const statusDot = (statusOf, { showNormal, ngRing = false }) => (props) => {
  const { cx, cy, payload, key } = props;
  const st = statusOf(payload);
  if (!st || !isNum(cx) || !isNum(cy)) return <g key={key} />;
  if (st === "normal" && !showNormal && !(ngRing && payload.status === "NG")) return <g key={key} />;
  const isNg = ngRing && payload.status === "NG";
  return (
    <circle key={key} cx={cx} cy={cy} r={st === "normal" ? 2.5 : 3.5}
      fill={PT_COLOR[st]} stroke={isNg ? INK : "#fff"} strokeWidth={isNg ? 1.5 : 1} />
  );
};

/** Tooltip rows for one reading against its limits. */
const ReadingTooltip = ({ title, sub, value, unit, spec, ctl, status, extraRows = [] }) => {
  const u = unit ? ` ${unit}` : "";
  const ref = spec.hasLimits ? spec.setPoint : ctl.mean;
  const dev = isNum(value) && isNum(ref) ? value - ref : null;
  return (
    <div style={TOOLTIP_STYLE}>
      <div className="tm-tt-title">{title}</div>
      {sub && <div className="tm-tt-sub">{sub}</div>}
      <div className="tm-tt-grid">
        <span>Value</span><strong>{isNum(value) ? `${fmtVal(value, 3)}${u}` : "Not recorded"}</strong>
        {spec.hasLimits
          ? <><span>Spec LSL – USL</span><strong>{spec.lsl} – {spec.usl}{u}</strong><span>Set point</span><strong>{fmtVal(spec.setPoint)}{u}</strong></>
          : <><span>Spec limits</span><strong>Not configured</strong></>}
        {isNum(ctl.ucl) && <><span>Control LCL – UCL</span><strong>{fmtVal(ctl.lcl)} – {fmtVal(ctl.ucl)}{u}</strong></>}
        {dev != null && <><span>{spec.hasLimits ? "Deviation from set" : "Deviation from mean"}</span><strong>{fmtSigned(dev, 3)}{u}</strong></>}
        {status && <><span>Status</span><strong><i className="tm-tt-dot" style={{ background: PT_COLOR[status] }} />{PT_LABEL[status]}</strong></>}
        {extraRows.map((r) => <React.Fragment key={r.label}><span>{r.label}</span><strong>{r.value}</strong></React.Fragment>)}
      </div>
    </div>
  );
};

/* ── Run-rule marker + capability rating meta ─────────────────────────────── */
const RULE_COLOR = CATEGORICAL[6];   // violet — reserved for run-rule signals, never a status
const EWMA_COLOR = CATEGORICAL[0];
const RATING = {
  capable: { label: "Capable", color: STATUS.good, icon: CheckCircle2 },
  marginal: { label: "Marginal", color: ACCENT.warning, icon: AlertTriangle },
  not: { label: "Not capable", color: STATUS.critical, icon: ShieldAlert },
};
const ruleLabel = (ids = []) => ids.map((id) => RUN_RULES.find((r) => r.id === id)?.short).filter(Boolean).join(" · ");
const fmtTime = (ts) => (isNum(ts)
  ? new Date(ts).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
  : "—");

/** Rating chip for a capability index (Cp / Cpk / Pp / Ppk). */
const CapChip = ({ label, value, title }) => {
  const r = RATING[capRating(value)];
  return (
    <span className="ra-chip" title={title} style={accent(r ? r.color : THEME.faint)}>
      {label} <strong style={{ fontVariantNumeric: "tabular-nums" }}>{isNum(value) ? value.toFixed(2) : "—"}</strong>
    </span>
  );
};

/** Status dot plus a violet diamond (with rule numbers) when the point breaks a run rule. */
const spcDot = (statusOf, { ruleLabels }) => (props) => {
  const { cx, cy, payload, key } = props;
  const st = statusOf(payload);
  if (!st || !isNum(cx) || !isNum(cy)) return <g key={key} />;
  const isNg = payload.status === "NG";
  const rules = payload.rules || [];
  return (
    <g key={key}>
      {rules.length > 0 && (
        <path d={`M${cx} ${cy - 8} L${cx + 8} ${cy} L${cx} ${cy + 8} L${cx - 8} ${cy} Z`} fill={withAlpha(RULE_COLOR, 0.1)} stroke={RULE_COLOR} strokeWidth={1.6} />
      )}
      {rules.length > 0 && ruleLabels && (
        <text x={cx} y={cy - 11} textAnchor="middle" fontSize={9} fontWeight={700} fill={RULE_COLOR} fontFamily={FONT_FAMILY}>{rules.join(",")}</text>
      )}
      <circle cx={cx} cy={cy} r={st === "normal" ? 2.5 : 3.5} fill={PT_COLOR[st]} stroke={isNg ? INK : "#fff"} strokeWidth={isNg ? 1.5 : 1} />
    </g>
  );
};

/* ── Histogram with normal fit, spec + control lines and capability badges ── */
const SPCHistogram = ({ values, spec, ctl, cap }) => {
  const hasLimits = spec.hasLimits;
  const u = spec.unit ? ` ${spec.unit}` : "";
  const model = useMemo(() => {
    const vals = values.filter(isNum);
    const range = histRange(vals, [spec.lsl, spec.usl, ctl.lcl, ctl.ucl, spec.setPoint]);
    if (!range) return null;
    const { bins, width, indexOf } = makeBins(range[0], range[1], vals.length);
    const out = bins.map((b) => ({ ...b, count: 0, inCount: 0, outCount: 0 }));
    vals.forEach((v) => {
      const b = out[indexOf(v)];
      b.count++;
      // Each reading is judged individually, so a bin that straddles a limit is split correctly.
      if (hasLimits && (v < spec.lsl || v > spec.usl)) b.outCount++; else b.inCount++;
    });
    const s = cap.std;
    out.forEach((b) => { b.fit = isNum(s) && s > 0 ? normalPdf(b.x, cap.mean, s) * vals.length * width : null; });
    const inRange = (x) => isNum(x) && x >= range[0] && x <= range[1];
    const offChart = [["LSL", spec.lsl], ["USL", spec.usl], ["LCL", ctl.lcl], ["UCL", ctl.ucl]].filter(([, x]) => isNum(x) && !inRange(x));
    return { bins: out, range, inRange, offChart };
  }, [values, spec, ctl, cap, hasLimits]);

  if (!model) return <div className="tm-empty">No readings to display.</div>;
  const { bins, range, inRange, offChart } = model;
  const lbl = (value, position, fill = CENTER, extra = {}) => ({ ...REF_LABEL, fill, value, position, ...extra });

  return (
    <>
      <SafeChart height={340}>
        {({ width, height }) => (
          <ComposedChart data={bins} width={width} height={height} margin={{ top: 34, right: 32, left: 8, bottom: 26 }} barCategoryGap={1}>
            <defs>
              <linearGradient id="histInSpecGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES} stopOpacity={0.72} />
                <stop offset="100%" stopColor={SERIES} />
              </linearGradient>
              <linearGradient id="histOutSpecGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C_NG} stopOpacity={0.72} />
                <stop offset="100%" stopColor={C_NG} />
              </linearGradient>
            </defs>
            <CartesianGrid {...RECHARTS_GRID} />
            <XAxis dataKey="x" type="number" domain={range} allowDataOverflow {...RECHARTS_AXIS} tickFormatter={fmtAxis}
              label={{ value: spec.unit ? `${spec.label} (${spec.unit})` : spec.label, position: "insideBottom", offset: -14, fontSize: 11, fill: THEME.body }} />
            <YAxis {...RECHARTS_AXIS} axisLine={false} allowDecimals={false} width={48}
              label={{ value: "Parts (count)", angle: -90, position: "insideLeft", offset: 4, fontSize: 11, fill: THEME.body, style: { textAnchor: "middle" } }} />
            <Tooltip
              cursor={RECHARTS_TOOLTIP.cursor}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const b = payload[0].payload;
                return (
                  <div style={TOOLTIP_STYLE}>
                    <div className="tm-tt-title">{fmtVal(b.binStart, 3)} – {fmtVal(b.binEnd, 3)}{u}</div>
                    <div className="tm-tt-grid">
                      <span>Parts in bin</span><strong>{b.count} · {fmtVal((b.count / Math.max(1, cap.n)) * 100, 1)}%</strong>
                      {hasLimits && <><span><i className="tm-tt-dot" style={{ background: SERIES }} />In spec</span><strong>{b.inCount}</strong>
                        <span><i className="tm-tt-dot" style={{ background: C_NG }} />Out of spec</span><strong>{b.outCount}</strong></>}
                      {b.fit != null && <><span>Normal fit (expected)</span><strong>{fmtVal(b.fit, 1)}</strong></>}
                      {hasLimits && <><span>Spec LSL – USL</span><strong>{spec.lsl} – {spec.usl}{u}</strong></>}
                      {isNum(ctl.ucl) && <><span>Control LCL – UCL</span><strong>{fmtVal(ctl.lcl)} – {fmtVal(ctl.ucl)}{u}</strong></>}
                      <span>Mean · σ overall</span><strong>{fmtVal(cap.mean, 3)} · {fmtVal(cap.std, 3)}</strong>
                    </div>
                  </div>
                );
              }}
            />
            {hasLimits && <ReferenceArea x1={Math.max(spec.lsl, range[0])} x2={Math.min(spec.usl, range[1])} fill={OUTCOME.ok} fillOpacity={0.06} ifOverflow="hidden" />}
            <Bar dataKey="inCount" name={hasLimits ? "Parts in spec" : "Parts"} stackId="h" fill="url(#histInSpecGrad)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            {hasLimits && <Bar dataKey="outCount" name="Parts out of spec" stackId="h" fill="url(#histOutSpecGrad)" radius={[3, 3, 0, 0]} isAnimationActive={false} />}
            {bins[0].fit != null && <Line type="monotone" dataKey="fit" name="Normal fit" stroke={CATEGORICAL[6]} strokeWidth={2} dot={false} isAnimationActive={false} />}
            {hasLimits && inRange(spec.lsl) && <ReferenceLine x={spec.lsl} stroke={LIMIT} strokeWidth={1.5} strokeDasharray="5 3" label={lbl(`LSL ${spec.lsl}`, "top", LIMIT)} />}
            {hasLimits && inRange(spec.usl) && <ReferenceLine x={spec.usl} stroke={LIMIT} strokeWidth={1.5} strokeDasharray="5 3" label={lbl(`USL ${spec.usl}`, "top", LIMIT)} />}
            {inRange(ctl.lcl) && <ReferenceLine x={ctl.lcl} stroke={CONTROL} strokeDasharray="6 3" label={lbl("LCL", "insideTopRight", CONTROL)} />}
            {inRange(ctl.ucl) && <ReferenceLine x={ctl.ucl} stroke={CONTROL} strokeDasharray="6 3" label={lbl("UCL", "insideTopLeft", CONTROL)} />}
            {inRange(cap.mean) && <ReferenceLine x={cap.mean} stroke={CATEGORICAL[6]} strokeDasharray="2 3" label={lbl("μ", "insideTopRight", CATEGORICAL[6], { offset: 22 })} />}
            {hasLimits && inRange(spec.setPoint) && <ReferenceLine x={spec.setPoint} stroke={CENTER} strokeDasharray="7 4" label={lbl("Set", "insideTopLeft", CENTER, { offset: 22 })} />}
          </ComposedChart>
        )}
      </SafeChart>
      {offChart.length > 0 && (
        <div className="tm-legend" style={{ color: MUTED, paddingTop: 2 }}>
          Off the chart (far from the data, not drawn): {offChart.map(([k, x]) => `${k} ${fmtVal(x)}`).join(" · ")}
        </div>
      )}
    </>
  );
};

/* ── Process capability summary: every parameter with spec limits ─────────── */
const CAP_COLUMNS = [
  { key: "label", label: "Parameter", align: "left" },
  { key: "n", label: "n" },
  { key: "mean", label: "Mean" },
  { key: "sigmaWithin", label: <><span style={{ textTransform: "none" }}>σ</span> within</> },
  { key: "sigmaOverall", label: <><span style={{ textTransform: "none" }}>σ</span> overall</> },
  { key: "lsl", label: "LSL – USL" },
  { key: "cp", label: "Cp" },
  { key: "cpk", label: "Cpk" },
  { key: "pp", label: "Pp" },
  { key: "ppk", label: "Ppk" },
  { key: "oosPct", label: "% out of spec" },
  { key: "rating", label: "Rating (Cpk)", align: "left" },
];
const RATING_ORDER = { not: 0, marginal: 1, capable: 2 };

/** Bar-end label that always sits right of the bar and of the zero line; clipped bars get an arrow. */
const capLabel = (name, lo, hi, style) => (props) => {
  const { x, y, width, height, value } = props;
  if (!isNum(value) || !isNum(x) || !isNum(width)) return null;
  const right = Math.max(x, x + width);
  const clipped = value < lo || value > hi;
  return (
    <text x={right + 5} y={y + height / 2} dy={3.5} fontFamily={FONT_FAMILY} {...style}>
      {name} {value.toFixed(2)}{clipped ? (value < lo ? " ◂" : " ▸") : ""}
    </text>
  );
};

const CapabilitySummary = ({ rows, selectedKey, onSelect }) => {
  const [sort, setSort] = useState({ key: "cpk", dir: "asc" });
  const sorted = useMemo(() => {
    const val = (r) => (sort.key === "rating" ? RATING_ORDER[r.rating] : sort.key === "label" ? r.label : r[sort.key]);
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      const na = va == null || (typeof va === "number" && !Number.isFinite(va));
      const nb = vb == null || (typeof vb === "number" && !Number.isFinite(vb));
      if (na !== nb) return na ? 1 : -1;   // missing values always last
      if (na) return a.label.localeCompare(b.label);
      const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, sort]);

  const chartItems = useMemo(() => {
    const items = rows.filter((r) => isNum(r.cpk)).sort((a, b) => a.cpk - b.cpk);
    const all = items.flatMap((r) => [r.cpk, r.ppk]).filter(isNum);
    const lo = Math.max(-2, Math.floor(Math.min(0, ...all)));
    const hi = Math.min(4, Math.max(2, Math.ceil(Math.max(0, ...all) * 2) / 2));
    const clamp = (v) => (isNum(v) ? Math.max(lo, Math.min(hi, v)) : null);
    return { lo, hi, items: items.map((r) => ({ ...r, cpkBar: clamp(r.cpk), ppkBar: clamp(r.ppk) })) };
  }, [rows]);

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "label" ? "asc" : key === "oosPct" ? "desc" : "asc" }));
  const { items, lo, hi } = chartItems;
  const tick = ({ x, y, payload }) => {
    const d = items.find((i) => i.key === payload.value);
    const label = d ? (d.label.length > 24 ? `${d.label.slice(0, 23)}…` : d.label) : payload.value;
    return (
      <g transform={`translate(${x},${y})`}>
        <circle cx={-10} cy={0} r={4} fill={d?.color || THEME.faint} />
        <text x={-20} y={0} dy={4} textAnchor="end" fill={THEME.secondary} fontSize={11} fontFamily={FONT_FAMILY}>{label}</text>
      </g>
    );
  };
  const ratingLegend = Object.entries(RATING).map(([k, r]) => ({ label: `${r.label} ${k === "capable" ? "≥ 1.33" : k === "marginal" ? "1.00 – 1.33" : "< 1.00"}`, color: r.color }));

  return (
    <>
      <h4 className="tm-subhead" style={{ padding: "14px 18px 0", margin: 0 }}>Cpk and Ppk by parameter (worst first)</h4>
      <LegendKey items={[
        { label: "Cpk (solid) · short-term σ within", color: THEME.secondary },
        { label: "Ppk (light) · long-term σ overall", color: withAlpha(THEME.secondary, 0.35) },
        ...ratingLegend,
        { label: "Targets 1.00 / 1.33", color: THEME.muted, type: "line", dashed: true },
      ]} />
      <div className="ra-card-body" style={{ paddingTop: 6 }}>
        {items.length === 0 ? (
          <div className="tm-empty">No parameter with spec limits has enough readings (n ≥ 2) to compute Cpk.</div>
        ) : (
          <SafeChart height={Math.max(180, items.length * 46 + 74)}>
            {({ width, height }) => (
              <BarChart layout="vertical" width={width} height={height} data={items} margin={{ top: 22, right: 56, left: 8, bottom: 28 }} barGap={2} barCategoryGap="24%"
                onClick={(e) => { if (e?.activeLabel && onSelect) onSelect(e.activeLabel); }}>
                <CartesianGrid {...RECHARTS_GRID} vertical horizontal={false} />
                <XAxis type="number" {...RECHARTS_AXIS} domain={[lo, hi]} allowDataOverflow tickFormatter={(v) => v.toFixed(1)}
                  label={{ value: "Capability index (dimensionless)", position: "insideBottom", offset: -16, fontSize: 11, fill: THEME.body }} />
                <YAxis type="category" dataKey="key" width={190} {...RECHARTS_AXIS} axisLine={false} tick={tick} interval={0} />
                <Tooltip
                  cursor={RECHARTS_TOOLTIP.cursor}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    const uu = d.unit ? ` ${d.unit}` : "";
                    const r = RATING[d.rating];
                    return (
                      <div style={TOOLTIP_STYLE}>
                        <div className="tm-tt-title">{d.label}{d.unit ? ` (${d.unit})` : ""}</div>
                        <div className="tm-tt-grid">
                          <span>Readings (n)</span><strong>{d.n.toLocaleString()}</strong>
                          <span>Spec LSL – USL</span><strong>{d.lsl} – {d.usl}{uu}</strong>
                          <span>Mean</span><strong>{fmtVal(d.mean, 3)}{uu}</strong>
                          <span>σ within · overall</span><strong>{fmtSmall(d.sigmaWithin)} · {fmtSmall(d.sigmaOverall)}</strong>
                          <span>Cp · Cpk</span><strong>{fmtVal(d.cp)} · {fmtVal(d.cpk)}</strong>
                          <span>Pp · Ppk</span><strong>{fmtVal(d.pp)} · {fmtVal(d.ppk)}</strong>
                          <span>Out of spec</span><strong>{d.oos} · {fmtVal(d.oosPct, 1)}%</strong>
                          {r && <><span>Rating</span><strong><i className="tm-tt-dot" style={{ background: r.color }} />{r.label}</strong></>}
                        </div>
                        <div className="tm-tt-foot">Click to open its SPC chart</div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine x={0} stroke={THEME.axis} />
                <ReferenceLine x={1} stroke={THEME.muted} strokeDasharray="4 3" label={{ ...REF_LABEL, value: "1.00", position: "top" }} />
                <ReferenceLine x={1.33} stroke={THEME.muted} strokeDasharray="4 3" label={{ ...REF_LABEL, value: "1.33", position: "top" }} />
                <Bar dataKey="cpkBar" name="Cpk" radius={[0, 4, 4, 0]} isAnimationActive={false} style={{ cursor: "pointer" }}>
                  {items.map((d) => <Cell key={d.key} fill={RATING[d.rating]?.color || THEME.faint} />)}
                  <LabelList dataKey="cpk" content={capLabel("Cpk", lo, hi, { fontSize: 10.5, fontWeight: 700, fill: THEME.secondary })} />
                </Bar>
                <Bar dataKey="ppkBar" name="Ppk" radius={[0, 4, 4, 0]} isAnimationActive={false} style={{ cursor: "pointer" }}>
                  {items.map((d) => {
                    const c = RATING[capRating(d.ppk)]?.color || THEME.faint;
                    return <Cell key={d.key} fill={withAlpha(c, 0.32)} stroke={c} strokeWidth={1} />;
                  })}
                  <LabelList dataKey="ppk" content={capLabel("Ppk", lo, hi, { fontSize: 10, fill: THEME.muted })} />
                </Bar>
              </BarChart>
            )}
          </SafeChart>
        )}
      </div>
      <div style={{ overflowX: "auto", borderTop: `1px solid ${THEME.grid}` }}>
        <table className="tm-table" style={{ minWidth: 1080 }}>
          <thead>
            <tr>
              {CAP_COLUMNS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th key={c.key} style={{ textAlign: c.align || "right" }} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="tm-sort-btn" onClick={() => toggleSort(c.key)} style={{ justifyContent: c.align === "left" ? "flex-start" : "flex-end" }}>
                      {c.label}
                      {active ? (sort.dir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const rt = RATING[r.rating];
              const RIcon = rt?.icon;
              const cell = (v, d = 2) => <td style={{ textAlign: "right" }}>{fmtVal(v, d)}</td>;
              const idx = (v) => {
                const c = RATING[capRating(v)];
                return <td style={{ textAlign: "right", fontWeight: 700, color: c ? c.color : THEME.faint }}>{fmtVal(v)}</td>;
              };
              return (
                <tr key={r.key} onClick={() => onSelect?.(r.key)} style={{ cursor: "pointer", ...(r.key === selectedKey ? { background: withAlpha(r.color, 0.08) } : null) }}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <i style={{ width: 9, height: 9, borderRadius: 3, background: r.color, display: "inline-block", flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>{r.label}</span>
                      {r.unit && <span style={{ color: MUTED }}>({r.unit})</span>}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>{r.n.toLocaleString()}</td>
                  {cell(r.mean, 3)}
                  <td style={{ textAlign: "right" }}>{fmtSmall(r.sigmaWithin)}</td>
                  <td style={{ textAlign: "right" }}>{fmtSmall(r.sigmaOverall)}</td>
                  <td style={{ textAlign: "right", color: MUTED }}>{r.lsl} – {r.usl}</td>
                  {idx(r.cp)}{idx(r.cpk)}{idx(r.pp)}{idx(r.ppk)}
                  <td style={{ textAlign: "right", fontWeight: 600, color: r.oos > 0 ? C_NG : INK }}>{r.n ? `${fmtVal(r.oosPct, 1)}%` : "—"}</td>
                  <td>
                    {rt
                      ? <span className="ra-chip" style={accent(rt.color)}><RIcon size={11} />{rt.label}</span>
                      : <span className="ra-chip" style={accent(THEME.faint)}>{r.n < 2 ? "Too few readings" : "No variation"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

/* ── OK vs NG distribution for one parameter ─────────────────────────────── */
const effectWord = (d) => (!isNum(d) ? "" : Math.abs(d) >= 0.8 ? "large" : Math.abs(d) >= 0.5 ? "medium" : Math.abs(d) >= 0.2 ? "small" : "negligible");

const OkNgComparison = ({ data, spec }) => {
  const u = spec.unit ? ` ${spec.unit}` : "";
  const model = useMemo(() => {
    const okVals = data.filter((d) => d.status === "OK").map((d) => d.value);
    const ngVals = data.filter((d) => d.status === "NG").map((d) => d.value);
    const shift = groupShift(okVals, ngVals);
    const all = [...okVals, ...ngVals];
    const range = histRange(all, [spec.lsl, spec.usl]);
    if (!range) return { shift, okVals, ngVals, bins: [] };
    const { bins, width, indexOf } = makeBins(range[0], range[1], all.length);
    const out = bins.map((b) => ({ ...b, ok: 0, ng: 0 }));
    okVals.forEach((v) => { out[indexOf(v)].ok++; });
    ngVals.forEach((v) => { out[indexOf(v)].ng++; });
    const fit = (g, x) => (g.n > 1 && g.std > 0 ? normalPdf(x, g.mean, g.std) * width * 100 : null);
    out.forEach((b) => {
      b.okPct = okVals.length ? (b.ok / okVals.length) * 100 : 0;
      b.ngPct = ngVals.length ? (b.ng / ngVals.length) * 100 : 0;
      b.okFit = fit(shift.ok, b.x);
      b.ngFit = fit(shift.ng, b.x);
    });
    const oosOf = (vals) => (spec.hasLimits && vals.length ? (vals.filter((v) => v < spec.lsl || v > spec.usl).length / vals.length) * 100 : null);
    return { shift, okVals, ngVals, bins: out, range, okOos: oosOf(okVals), ngOos: oosOf(ngVals) };
  }, [data, spec]);

  const { shift, bins, range } = model;
  const enough = shift.ok.n >= 2 && shift.ng.n >= 2;
  const inRange = (x) => range && isNum(x) && x >= range[0] && x <= range[1];
  const word = effectWord(shift.d);

  return (
    <>
      <div className="tm-kpi-row" style={{ paddingBottom: 6 }}>
        <KpiCard label="OK parts" value={shift.ok.n ? fmtVal(shift.ok.mean, 3) : "—"} unit={spec.unit} icon={CheckCircle2} color={ACCENT.ok}
          subtext={`n ${shift.ok.n.toLocaleString()} · σ ${fmtVal(shift.ok.std, 3)}${isNum(model.okOos) ? ` · ${fmtVal(model.okOos, 1)}% out of spec` : ""}`} />
        <KpiCard label="NG parts" value={shift.ng.n ? fmtVal(shift.ng.mean, 3) : "—"} unit={spec.unit} icon={ShieldAlert} color={ACCENT.ng}
          subtext={`n ${shift.ng.n.toLocaleString()} · σ ${fmtVal(shift.ng.std, 3)}${isNum(model.ngOos) ? ` · ${fmtVal(model.ngOos, 1)}% out of spec` : ""}`} />
        <KpiCard label="Mean shift NG − OK" value={isNum(shift.delta) ? fmtSigned(shift.delta, 3) : "—"} unit={spec.unit} icon={ArrowUpDown} color={ACCENT.process}
          subtext="Difference of the group means" />
        <KpiCard label={<>Shift in <span style={{ textTransform: "none" }}>σ</span> (pooled)</>} value={isNum(shift.d) ? fmtSigned(shift.d, 2, "σ") : "—"} icon={Sigma}
          color={!isNum(shift.d) ? ACCENT.neutral : Math.abs(shift.d) >= 0.8 ? STATUS.critical : Math.abs(shift.d) >= 0.5 ? ACCENT.warning : ACCENT.process}
          subtext={isNum(shift.d) ? `${word[0].toUpperCase()}${word.slice(1)} separation · pooled σ ${fmtVal(shift.pooled, 3)}` : "Needs ≥ 2 OK and ≥ 2 NG readings"} />
      </div>
      {!enough ? (
        <div className="tm-empty" style={{ height: 220 }}>Need at least 2 OK and 2 NG parts with a {spec.label} reading to compare.</div>
      ) : (
        <>
          <h4 className="tm-subhead" style={{ padding: "6px 18px 0", margin: 0 }}>Distribution of {spec.label}: OK vs NG parts</h4>
          <LegendKey items={[
            { label: `OK parts (n ${shift.ok.n})`, color: OUTCOME.ok },
            { label: `NG parts (n ${shift.ng.n})`, color: OUTCOME.ng },
            { label: "Normal fit per group", color: THEME.secondary, type: "line", dashed: true },
            { label: "Group means", color: THEME.secondary, type: "line", dotted: true },
            ...(spec.hasLimits ? [{ label: "Spec limits LSL / USL", color: LIMIT, type: "line", dashed: true }] : []),
          ]} />
          <div style={{ padding: "4px 10px 0" }}>
            <SafeChart height={320}>
              {({ width, height }) => (
                <ComposedChart data={bins} width={width} height={height} margin={{ top: 30, right: 32, left: 8, bottom: 26 }} barGap={0} barCategoryGap={2}>
                  <CartesianGrid {...RECHARTS_GRID} />
                  <XAxis dataKey="x" type="number" domain={range} allowDataOverflow {...RECHARTS_AXIS} tickFormatter={fmtAxis}
                    label={{ value: spec.unit ? `${spec.label} (${spec.unit})` : spec.label, position: "insideBottom", offset: -14, fontSize: 11, fill: THEME.body }} />
                  <YAxis {...RECHARTS_AXIS} axisLine={false} width={48} tickFormatter={(v) => `${v}%`}
                    label={{ value: "Share of group (%)", angle: -90, position: "insideLeft", offset: 4, fontSize: 11, fill: THEME.body, style: { textAnchor: "middle" } }} />
                  <Tooltip
                    cursor={RECHARTS_TOOLTIP.cursor}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const b = payload[0].payload;
                      const where = !spec.hasLimits ? null : b.binEnd < spec.lsl || b.binStart > spec.usl ? "Outside spec" : b.binStart >= spec.lsl && b.binEnd <= spec.usl ? "Inside spec" : "Straddles a spec limit";
                      return (
                        <div style={TOOLTIP_STYLE}>
                          <div className="tm-tt-title">{fmtVal(b.binStart, 3)} – {fmtVal(b.binEnd, 3)}{u}</div>
                          <div className="tm-tt-grid">
                            <span><i className="tm-tt-dot" style={{ background: OUTCOME.ok }} />OK parts</span><strong>{b.ok} · {fmtVal(b.okPct, 1)}%</strong>
                            <span><i className="tm-tt-dot" style={{ background: OUTCOME.ng }} />NG parts</span><strong>{b.ng} · {fmtVal(b.ngPct, 1)}%</strong>
                            {where && <><span>Bin vs spec</span><strong>{where}</strong></>}
                            {spec.hasLimits && <><span>Spec LSL – USL</span><strong>{spec.lsl} – {spec.usl}{u}</strong></>}
                            <span>Mean OK · NG</span><strong>{fmtVal(shift.ok.mean, 3)} · {fmtVal(shift.ng.mean, 3)}</strong>
                          </div>
                        </div>
                      );
                    }}
                  />
                  {spec.hasLimits && <ReferenceArea x1={Math.max(spec.lsl, range[0])} x2={Math.min(spec.usl, range[1])} fill={OUTCOME.ok} fillOpacity={0.05} ifOverflow="hidden" />}
                  <Bar dataKey="okPct" name="OK parts" fill={withAlpha(OUTCOME.ok, 0.7)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="ngPct" name="NG parts" fill={withAlpha(OUTCOME.ng, 0.7)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  <Line type="monotone" dataKey="okFit" stroke={OUTCOME.ok} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="ngFit" stroke={OUTCOME.ng} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
                  {spec.hasLimits && inRange(spec.lsl) && <ReferenceLine x={spec.lsl} stroke={LIMIT} strokeWidth={1.5} strokeDasharray="5 3" label={{ ...REF_LABEL, fill: LIMIT, value: `LSL ${spec.lsl}`, position: "top" }} />}
                  {spec.hasLimits && inRange(spec.usl) && <ReferenceLine x={spec.usl} stroke={LIMIT} strokeWidth={1.5} strokeDasharray="5 3" label={{ ...REF_LABEL, fill: LIMIT, value: `USL ${spec.usl}`, position: "top" }} />}
                  <ReferenceLine x={shift.ok.mean} stroke={OUTCOME.ok} strokeWidth={1.5} strokeDasharray="2 3" label={{ ...REF_LABEL, fill: OUTCOME.ok, value: "μ OK", position: shift.ok.mean <= shift.ng.mean ? "insideTopLeft" : "insideTopRight" }} />
                  <ReferenceLine x={shift.ng.mean} stroke={OUTCOME.ng} strokeWidth={1.5} strokeDasharray="2 3" label={{ ...REF_LABEL, fill: OUTCOME.ng, value: "μ NG", offset: 20, position: shift.ok.mean <= shift.ng.mean ? "insideTopRight" : "insideTopLeft" }} />
                </ComposedChart>
              )}
            </SafeChart>
          </div>
        </>
      )}
    </>
  );
};

/* ── Ranked "% of shots out of spec / out of control" per parameter ─────────── */
const ParameterExceedanceBar = ({ items, onSelect }) => {
  const chartHeight = Math.max(160, items.length * 44 + 70);
  const max = Math.max(1, ...items.map((d) => Math.max(d.oosPct ?? 0, d.oocPct ?? 0)));
  const tick = ({ x, y, payload }) => {
    const d = items.find((i) => i.key === payload.value);
    const label = d ? (d.label.length > 26 ? `${d.label.slice(0, 25)}…` : d.label) : payload.value;
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={-8} y={0} dy={4} textAnchor="end" fill={THEME.secondary} fontSize={11} fontFamily={FONT_FAMILY}>{label}</text>
      </g>
    );
  };
  return (
    <SafeChart height={chartHeight}>
      {({ width, height }) => (
        <BarChart layout="vertical" width={width} height={height} data={items} margin={{ top: 8, right: 64, left: 8, bottom: 28 }} barGap={2} barCategoryGap="22%"
          onClick={(e) => { if (e?.activeLabel && onSelect) onSelect(e.activeLabel); }}>
          <defs>
            <linearGradient id="oosExceedGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={PT_COLOR.oos} stopOpacity={0.7} />
              <stop offset="100%" stopColor={PT_COLOR.oos} />
            </linearGradient>
            <linearGradient id="oocExceedGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={PT_COLOR.ooc} stopOpacity={0.7} />
              <stop offset="100%" stopColor={PT_COLOR.ooc} />
            </linearGradient>
          </defs>
          <CartesianGrid {...RECHARTS_GRID} vertical horizontal={false} />
          <XAxis type="number" {...RECHARTS_AXIS} domain={[0, Math.ceil(max * 1.15)]} tickFormatter={(v) => `${v}%`}
            label={{ value: "Share of shots with a reading (%)", position: "insideBottom", offset: -16, fontSize: 11, fill: THEME.body }} />
          <YAxis type="category" dataKey="key" width={180} {...RECHARTS_AXIS} axisLine={false} tick={tick} interval={0} />
          <Tooltip
            cursor={RECHARTS_TOOLTIP.cursor}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div style={TOOLTIP_STYLE}>
                  <div className="tm-tt-title">{d.label}{d.unit ? ` (${d.unit})` : ""}</div>
                  <div className="tm-tt-grid">
                    <span>Shots with a reading</span><strong>{d.n.toLocaleString()}</strong>
                    <span><i className="tm-tt-dot" style={{ background: PT_COLOR.oos }} />Out of spec</span>
                    <strong>{d.hasLimits ? `${d.oos} · ${fmtVal(d.oosPct, 1)}%` : "Limits not configured"}</strong>
                    <span><i className="tm-tt-dot" style={{ background: PT_COLOR.ooc }} />Out of control</span>
                    <strong>{d.hasControl ? `${d.ooc} · ${fmtVal(d.oocPct, 1)}%` : "No variation"}</strong>
                    {d.hasLimits && <><span>Spec LSL – USL</span><strong>{d.lsl} – {d.usl}</strong></>}
                    {d.hasControl && <><span>Control LCL – UCL</span><strong>{fmtVal(d.lcl)} – {fmtVal(d.ucl)}</strong></>}
                  </div>
                  <div className="tm-tt-foot">Click to open its SPC chart</div>
                </div>
              );
            }}
          />
          <Legend verticalAlign="top" align="right" height={24} iconSize={10}
            formatter={(v) => <span style={{ fontSize: 11.5, color: THEME.body }}>{v}</span>} />
          <Bar dataKey="oosBar" name="Out of spec (beyond LSL / USL)" fill="url(#oosExceedGrad)" radius={[0, 4, 4, 0]} isAnimationActive={false} style={{ cursor: "pointer" }}>
            <LabelList dataKey="oosPct" position="right" style={{ fontSize: 10.5, fontWeight: 600, fill: THEME.secondary }}
              formatter={(v) => (v == null ? "no limits" : `${Number(v).toFixed(1)}%`)} />
          </Bar>
          <Bar dataKey="oocBar" name="Out of control (beyond UCL / LCL)" fill="url(#oocExceedGrad)" radius={[0, 4, 4, 0]} isAnimationActive={false} style={{ cursor: "pointer" }}>
            <LabelList dataKey="oocPct" position="right" style={{ fontSize: 10.5, fontWeight: 600, fill: THEME.secondary }}
              formatter={(v) => (v == null ? "—" : `${Number(v).toFixed(1)}%`)} />
          </Bar>
        </BarChart>
      )}
    </SafeChart>
  );
};

/* ── Capability gauge ─────────────────────────────────────────────────────── */
const CapabilityGauge = ({ cpk, cp, reason }) => {
  const has = isNum(cpk);
  const pct = has ? Math.max(0, Math.min(100, (cpk / 2) * 100)) : 0;
  const color = !has ? STATUS.neutral : cpk >= 1.33 ? C_OK : cpk >= 1.0 ? C_WARN : C_NG;
  const rating = !has ? reason : cpk >= 1.67 ? "Excellent" : cpk >= 1.33 ? "Capable" : cpk >= 1.0 ? "Marginal" : "Not capable";
  return (
    <div className="tm-gauge-wrapper">
      <svg width={190} height={110} viewBox="0 0 180 104">
        <defs>
          <filter id="gaugeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={color} floodOpacity="0.4" />
          </filter>
        </defs>
        <path d="M 20 96 A 70 70 0 0 1 160 96" fill="none" stroke="#e2e8f0" strokeWidth={12} strokeLinecap="round" />
        {has && (
          <path d="M 20 96 A 70 70 0 0 1 160 96" fill="none" stroke={color} strokeWidth={12} strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * 220} 220`} filter="url(#gaugeGlow)" />
        )}
      </svg>
      <div className="tm-gauge-body">
        <div className="tm-gauge-value" style={{ color: has ? color : "#0f172a" }}>{has ? cpk.toFixed(2) : "—"}</div>
        <div className="tm-gauge-label" style={{ color: has ? color : MUTED, fontWeight: 700 }}>Cpk · {rating}</div>
        <div className="tm-gauge-cp" style={{ fontWeight: 600 }}>Cp {isNum(cp) ? cp.toFixed(2) : "—"}</div>
      </div>
    </div>
  );
};

/* ═════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═════════════════════════════════════════════════════════════════════════════ */
export default function TelemetryTab({
  rows = [],
  recordsRows = [],
  allRejectionRecords = [],
  mlInsights = { features: [] },
  onOpenRecipeModal,
}) {
  const [telemetryTableFilter, setTelemetryTableFilter] = useState("all");
  const [telemetrySearch, setTelemetrySearch] = useState("");
  const [telemetryPage, setTelemetryPage] = useState(1);
  const [telemetryPageSize, setTelemetryPageSize] = useState(25);
  const [telemetryCategory, setTelemetryCategory] = useState("machine_process");
  const [telemetryViewMode, setTelemetryViewMode] = useState("stacked_timeline");
  const [spcChartMode, setSpcChartMode] = useState("scroll");
  const [selectedTelemetryParam, setSelectedTelemetryParam] = useState("plc_cycle_time");
  const [spcChartType, setSpcChartType] = useState("run"); // run (individuals) | ewma | histogram | both
  const [showAllSignals, setShowAllSignals] = useState(false);
  const [spcZoomRange, setSpcZoomRange] = useState({ start: 0, end: null });
  const [spcDragLeft, setSpcDragLeft] = useState(null);
  const [spcDragRight, setSpcDragRight] = useState(null);

  const spcChartScrollRef = useRef(null);
  const features = mlInsights?.features;

  const scrollSpcChart = useCallback((direction) => {
    spcChartScrollRef.current?.scrollBy({ left: direction === "left" ? -600 : 600, behavior: "smooth" });
  }, []);

  const activeCategoryParams = useMemo(() => {
    const cat = ALL_TELEMETRY_CATEGORIES.find((c) => c.id === telemetryCategory);
    return cat ? cat.params : MACHINE_PROCESS_PARAMETERS;
  }, [telemetryCategory]);

  /* ── Casted parts in production order (oldest → newest) ─────────────────── */
  const orderedParts = useMemo(() => {
    const dataPool = rows.length > 0 ? rows : (recordsRows.length > 0 ? recordsRows : allRejectionRecords);
    if (!dataPool?.length) return [];
    return dataPool
      .map((r) => ({ r, info: partInfo(r) }))
      .filter((x) => x.info.partId)
      .sort((a, b) => {
        const ta = a.info.ts ?? 0;
        const tb = b.info.ts ?? 0;
        if (ta !== tb) return ta - tb;
        return (Number(a.info.shot) || 0) - (Number(b.info.shot) || 0);
      });
  }, [rows, recordsRows, allRejectionRecords]);

  /* ── Overview timeline: last 180 shots, all parameters ──────────────────── */
  const stackedTimelineData = useMemo(() => {
    const specs = ALL_45_PARAMETERS.map((p) => resolveSpec(p.key, features));
    return orderedParts.slice(-180).map(({ r, info }, idx) => {
      const dt = info.ts != null ? new Date(info.ts) : null;
      const pt = {
        index: idx + 1,
        timeLabel: dt ? dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : `#${idx + 1}`,
        dateLabel: dt ? dt.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "",
        shift: r.shiftCode || r.shift_code || "",
        shot: info.shot || "",
        part: info.partId,
        quality: info.quality,
      };
      specs.forEach((s) => { pt[s.key] = getParamValue(r, s); });
      return pt;
    });
  }, [orderedParts, features]);

  /* ── Per-parameter overview stats for the active category ───────────────── */
  const categoryParamStats = useMemo(() => activeCategoryParams.map((p) => {
    const spec = resolveSpec(p.key, features);
    const vals = stackedTimelineData.map((d) => d[p.key]).filter(isNum);
    const st = seriesStats(vals);
    const outCount = spec.hasLimits ? vals.filter((v) => v < spec.lsl || v > spec.usl).length : null;
    const ctl = controlLimits(st);
    // Independent counts (a point can be both) for the ranking; exclusive status counts for the card.
    const oocCount = isNum(ctl.ucl) ? vals.filter((v) => v > ctl.ucl || v < ctl.lcl).length : null;
    const counts = countStatuses(vals, spec, ctl);
    return { param: p, spec, vals, st, outCount, oocCount, ctl, counts };
  }), [activeCategoryParams, stackedTimelineData, features]);

  /* Ranked exceedance: % of shots out of spec / out of control, per parameter with readings. */
  const exceedanceItems = useMemo(() => categoryParamStats
    .filter((c) => c.st.n > 0)
    .map(({ param, spec, st, outCount, oocCount, ctl }) => {
      const oosPct = spec.hasLimits ? (outCount / st.n) * 100 : null;
      const oocPct = oocCount != null ? (oocCount / st.n) * 100 : null;
      return {
        key: param.key, label: param.label, unit: spec.unit, n: st.n,
        hasLimits: spec.hasLimits, hasControl: isNum(ctl.ucl),
        lsl: spec.lsl, usl: spec.usl, ucl: ctl.ucl, lcl: ctl.lcl,
        oos: outCount, ooc: oocCount, oosPct, oocPct, oosBar: oosPct ?? 0, oocBar: oocPct ?? 0,
      };
    })
    .sort((a, b) => (b.oosPct ?? -1) - (a.oosPct ?? -1) || (b.oocPct ?? -1) - (a.oocPct ?? -1)), [categoryParamStats]);

  /* ── SPC: readings of the selected parameter ────────────────────────────── */
  const currentTelemetrySpec = useMemo(() => resolveSpec(selectedTelemetryParam, features), [selectedTelemetryParam, features]);

  const telemetryTrendData = useMemo(() => {
    const spec = currentTelemetrySpec;
    const withVal = [];
    orderedParts.forEach(({ r, info }) => {
      const v = getParamValue(r, spec);
      if (v != null) withVal.push({ r, info, v });
    });
    return withVal.slice(-SPC_WINDOW).map(({ r, info, v }, index) => {
      const value = Number(v.toFixed(3));
      const sp = spec.setPoint;
      const delta = sp != null ? Number((value - sp).toFixed(3)) : null;
      const deltaPct = sp != null && sp !== 0 ? Number((((value - sp) / Math.abs(sp)) * 100).toFixed(1)) : null;
      let specStatus = "NO_LIMITS";
      if (spec.hasLimits) specStatus = value > spec.usl ? "HIGH" : value < spec.lsl ? "LOW" : "IN_SPEC";
      const outOfSpec = specStatus === "HIGH" || specStatus === "LOW";
      const machine = r.machineName || r.machine_name || "";
      const die = r.dieName || r.die_name || "";
      return {
        index: index + 1,
        partId: info.partId || "—",
        customerQr: info.customerQr || "—",
        shotNumber: info.shot || "—",
        machineName: machine && machine !== "-" ? machine : "—",
        dieName: die && die !== "-" ? die : "—",
        shiftCode: r.shiftCode || r.shift_code || "—",
        value,
        target: sp, usl: spec.usl, lsl: spec.lsl,
        delta, deltaPct, specStatus, outOfSpec,
        isInSpec: !outOfSpec,
        status: info.quality,
        hasSetLimits: spec.hasLimits,
        createdAt: r.first_scan_at || r.createdAt,
        ts: info.ts,
      };
    });
  }, [orderedParts, currentTelemetrySpec]);

  const spcMetrics = useMemo(() => {
    const spec = currentTelemetrySpec;
    const vals = telemetryTrendData.map((d) => d.value);
    const cap = capability(vals, spec);
    const ctl = controlLimits(cap);
    const ngVals = telemetryTrendData.filter((d) => d.status === "NG").map((d) => d.value);
    const okCount = telemetryTrendData.filter((d) => d.status === "OK").length;
    return {
      cap, ctl, counts: countStatuses(vals, spec, ctl),
      n: cap.n, mean: cap.mean, std: cap.std, sigmaWithin: cap.sigmaWithin, ucl: ctl.ucl, lcl: ctl.lcl,
      cp: cap.cp, cpk: cap.cpk, pp: cap.pp, ppk: cap.ppk,
      ngMean: ngVals.length ? ngVals.reduce((x, y) => x + y, 0) / ngVals.length : null,
      ngCount: ngVals.length, okCount, outCount: cap.oos ?? 0,
      cpkReason: !spec.hasLimits ? "limits not set" : (cap.n < 2 ? "too few readings" : "no variation"),
    };
  }, [currentTelemetrySpec, telemetryTrendData]);

  /* Run rules + EWMA over the whole window (centre μ, σ = σ_within), attached to each reading. */
  const spcSeries = useMemo(() => {
    const vals = telemetryTrendData.map((d) => d.value);
    const { mean, sigma } = spcMetrics.ctl;
    const rules = detectRunRules(vals, mean, sigma);
    const ew = ewmaSeries(vals, mean, sigma);
    return telemetryTrendData.map((d, i) => ({
      ...d,
      rules: rules[i],
      zScore: isNum(sigma) && sigma > 0 ? (d.value - mean) / sigma : null,
      ewma: ew[i].z, ewmaUcl: ew[i].ucl, ewmaLcl: ew[i].lcl, ewmaOoc: ew[i].ooc,
    }));
  }, [telemetryTrendData, spcMetrics]);

  const ruleSummary = useMemo(() => {
    const byRule = Object.fromEntries(RUN_RULES.map((r) => [r.id, 0]));
    const flagged = [];
    spcSeries.forEach((d) => {
      if (d.rules.length) flagged.push(d);
      d.rules.forEach((id) => { byRule[id] += 1; });
    });
    return { byRule, flagged: flagged.reverse(), ewmaOoc: spcSeries.filter((d) => d.ewmaOoc).length };
  }, [spcSeries]);

  /* Capability of every parameter that has spec limits (same last-N window and rounding as the SPC chart). */
  const capabilityRows = useMemo(() => ALL_45_PARAMETERS.map((p) => {
    const pSpec = resolveSpec(p.key, features);
    if (!pSpec.hasLimits) return null;
    const vals = [];
    orderedParts.forEach(({ r }) => {
      const v = getParamValue(r, pSpec);
      if (v != null) vals.push(Number(v.toFixed(3)));
    });
    const cap = capability(vals.slice(-SPC_WINDOW), pSpec);
    return {
      key: p.key, label: pSpec.label, unit: pSpec.unit && pSpec.unit !== "—" ? pSpec.unit : "", color: pSpec.color,
      lsl: pSpec.lsl, usl: pSpec.usl, ...cap, rating: capRating(cap.cpk),
    };
  }).filter(Boolean), [orderedParts, features]);

  const displayedSpcData = useMemo(() => {
    if (!spcSeries.length) return [];
    const end = spcZoomRange.end != null ? Math.min(spcZoomRange.end, spcSeries.length) : spcSeries.length;
    const start = Math.max(0, Math.min(spcZoomRange.start, end - 5));
    return spcSeries.slice(start, end);
  }, [spcSeries, spcZoomRange]);

  /* SPC drag-to-zoom */
  const handleSpcMouseDown = useCallback((e) => {
    if (e && e.activeLabel != null) { setSpcDragLeft(Number(e.activeLabel)); setSpcDragRight(null); }
  }, []);
  const handleSpcMouseMove = useCallback((e) => {
    if (spcDragLeft != null && e && e.activeLabel != null) setSpcDragRight(Number(e.activeLabel));
  }, [spcDragLeft]);
  const handleSpcMouseUp = useCallback(() => {
    if (spcDragLeft != null && spcDragRight != null && spcDragLeft !== spcDragRight) {
      const left = Math.min(spcDragLeft, spcDragRight);
      const right = Math.max(spcDragLeft, spcDragRight);
      // `index` is 1-based over the full series, so it maps directly to the slice range.
      const actualStart = Math.max(0, left - 1);
      const actualEnd = Math.min(telemetryTrendData.length, right);
      if (actualEnd - actualStart >= 3) setSpcZoomRange({ start: actualStart, end: actualEnd });
    }
    setSpcDragLeft(null); setSpcDragRight(null);
  }, [spcDragLeft, spcDragRight, telemetryTrendData.length]);
  const handleSpcResetZoom = useCallback(() => {
    setSpcZoomRange({ start: 0, end: null });
    setSpcDragLeft(null); setSpcDragRight(null);
  }, []);

  const selectParam = useCallback((key) => {
    setSelectedTelemetryParam(key);
    setSpcZoomRange({ start: 0, end: null });
    setTelemetryPage(1);
    setTelemetryTableFilter("all");
  }, []);
  const selectCategory = useCallback((cat) => {
    setTelemetryCategory(cat.id);
    if (cat.params?.length) selectParam(cat.params[0].key);
  }, [selectParam]);

  /* ── Excel: set vs live summary for all parameters ──────────────────────── */
  const exportSetVsLiveOverview = useCallback(() => {
    if (!orderedParts.length) return;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Rejection Analysis";
    const ws = wb.addWorksheet("Set vs Live Summary", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "#", key: "idx", width: 6 }, { header: "Parameter", key: "param", width: 30 },
      { header: "Unit", key: "unit", width: 10 }, { header: "Set Point", key: "target", width: 12 },
      { header: "LSL", key: "lsl", width: 10 }, { header: "USL", key: "usl", width: 10 },
      { header: "Readings", key: "n", width: 10 },
      { header: "Mean", key: "mean", width: 12 }, { header: "Std Dev", key: "std", width: 12 },
      { header: "Min", key: "min", width: 10 }, { header: "Max", key: "max", width: 10 },
      { header: "UCL (mean+3σ, MR)", key: "ucl", width: 18 }, { header: "LCL (mean−3σ, MR)", key: "lcl", width: 18 },
      { header: "σ within (MR̄/1.128)", key: "sw", width: 18 },
      { header: "Cp", key: "cp", width: 8 }, { header: "Cpk", key: "cpk", width: 8 },
      { header: "Pp", key: "pp", width: 8 }, { header: "Ppk", key: "ppk", width: 8 },
      { header: "In Spec", key: "inSpec", width: 10 }, { header: "Out of Spec", key: "outSpec", width: 12 },
      { header: "Out of Spec %", key: "outPct", width: 14 },
      { header: "NG Parts", key: "ngParts", width: 10 }, { header: "OK Parts", key: "okParts", width: 10 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };

    ALL_45_PARAMETERS.forEach((p, fi) => {
      const spec = resolveSpec(p.key, features);
      const readings = [];
      orderedParts.forEach(({ r, info }) => {
        const v = getParamValue(r, spec);
        if (v != null) readings.push({ v, q: info.quality });
      });
      const vals = readings.map((x) => x.v);
      const st = seriesStats(vals);
      const sig = st.sigmaWithin;
      const out = spec.hasLimits ? vals.filter((v) => v < spec.lsl || v > spec.usl).length : null;
      const capx = capability(vals, spec);
      const idx2 = (v) => (isNum(v) ? Number(v.toFixed(2)) : "-");
      const row = ws.addRow({
        idx: fi + 1, param: spec.label, unit: spec.unit,
        target: spec.setPoint ?? "-", lsl: spec.lsl ?? "-", usl: spec.usl ?? "-",
        n: st.n,
        mean: isNum(st.mean) ? Number(st.mean.toFixed(3)) : "-", std: isNum(st.std) ? Number(st.std.toFixed(3)) : "-",
        min: isNum(st.min) ? st.min : "-", max: isNum(st.max) ? st.max : "-",
        ucl: isNum(sig) && sig > 0 ? Number((st.mean + 3 * sig).toFixed(3)) : "-",
        lcl: isNum(sig) && sig > 0 ? Number((st.mean - 3 * sig).toFixed(3)) : "-",
        sw: isNum(sig) ? Number(sig.toFixed(3)) : "-",
        cp: idx2(capx.cp), cpk: idx2(capx.cpk), pp: idx2(capx.pp), ppk: idx2(capx.ppk),
        inSpec: out != null ? st.n - out : "-", outSpec: out != null ? out : "-",
        outPct: out != null && st.n > 0 ? `${((out / st.n) * 100).toFixed(1)}%` : "-",
        ngParts: readings.filter((x) => x.q === "NG").length,
        okParts: readings.filter((x) => x.q === "OK").length,
      });
      if (fi % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    });
    wb.xlsx.writeBuffer().then((buf) => saveAs(new Blob([buf]), "Set_vs_Live_Parameter_Summary.xlsx"));
  }, [orderedParts, features]);

  const filteredTelemetryRows = useMemo(() => {
    let list = spcSeries;
    if (telemetryTableFilter === "outliers") list = list.filter((d) => d.outOfSpec);
    else if (telemetryTableFilter === "ng") list = list.filter((d) => d.status === "NG");
    else if (telemetryTableFilter === "rules") list = list.filter((d) => d.rules.length > 0);
    if (telemetrySearch.trim()) {
      const q = telemetrySearch.trim().toLowerCase();
      list = list.filter((d) =>
        [d.partId, d.customerQr, d.shotNumber, d.machineName, d.shiftCode, d.dieName].some((x) => String(x).toLowerCase().includes(q))
      );
    }
    return list;
  }, [spcSeries, telemetryTableFilter, telemetrySearch]);

  const specStatusLabel = (s) => (s === "IN_SPEC" ? "In spec" : s === "HIGH" ? "Above USL" : s === "LOW" ? "Below LSL" : "No limits");
  const qualityLabel = (q) => (q === "WIP" ? "In process" : q);

  const exportTelemetryExcel = useCallback(() => {
    if (!filteredTelemetryRows.length) return;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Rejection Analysis";
    const ws = wb.addWorksheet("Per-part Readings", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "#", key: "index", width: 8 }, { header: "Part Serial No", key: "partId", width: 26 },
      { header: "Shot Number", key: "shotNumber", width: 14 }, { header: "Customer QR", key: "customerQr", width: 30 },
      { header: "Machine", key: "machineName", width: 16 }, { header: "Die", key: "dieName", width: 12 },
      { header: "Shift", key: "shiftCode", width: 10 },
      { header: "Parameter", key: "paramName", width: 24 }, { header: "Value", key: "value", width: 14 },
      { header: "Unit", key: "unit", width: 8 }, { header: "Set Point", key: "target", width: 12 },
      { header: "LSL", key: "lsl", width: 10 }, { header: "USL", key: "usl", width: 10 },
      { header: "Deviation", key: "delta", width: 12 }, { header: "Deviation %", key: "deltaPct", width: 12 },
      { header: "Spec Status", key: "specStatus", width: 14 }, { header: "Run Rules", key: "rules", width: 14 }, { header: "Quality", key: "status", width: 12 },
      { header: "Timestamp", key: "timestamp", width: 22 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    filteredTelemetryRows.forEach((r, idx) => {
      const row = ws.addRow({
        index: r.index, partId: r.partId, shotNumber: r.shotNumber, customerQr: r.customerQr,
        machineName: r.machineName, dieName: r.dieName, shiftCode: r.shiftCode, paramName: currentTelemetrySpec.label,
        value: r.value, unit: currentTelemetrySpec.unit, target: r.target ?? "-",
        lsl: r.lsl ?? "-", usl: r.usl ?? "-",
        delta: r.delta != null ? fmtSigned(r.delta, 3) : "-",
        deltaPct: r.deltaPct != null ? fmtSigned(r.deltaPct, 1, "%") : "-",
        specStatus: specStatusLabel(r.specStatus), rules: r.rules?.length ? ruleLabel(r.rules) : "-", status: qualityLabel(r.status),
        timestamp: formatResultTimestamp(r.createdAt) || "-",
      });
      if (idx % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    });
    wb.xlsx.writeBuffer().then((buf) => saveAs(new Blob([buf]), `SPC_${currentTelemetrySpec.label.replace(/[^\w]+/g, "_")}_Readings.xlsx`));
  }, [filteredTelemetryRows, currentTelemetrySpec]);

  const spec = currentTelemetrySpec;
  const unitSuffix = spec.unit ? ` ${spec.unit}` : "";
  const pageCount = Math.max(1, Math.ceil(filteredTelemetryRows.length / telemetryPageSize));
  const paramsWithoutLimits = categoryParamStats.filter((c) => !c.spec.hasLimits).length;
  const spcCtl = spcMetrics.ctl;
  const spcHasCtl = isNum(spcCtl.ucl);
  const paramColor = spec.color || ACCENT.process;
  // Limits far from the data (e.g. a 999 placeholder-like USL) would squash the chart: draw only those within one data span.
  const spcValueRange = displayedSpcData.length ? histRange(displayedSpcData.map((d) => d.value), []) : null;
  const nearData = (x) => isNum(x) && spcValueRange && x >= spcValueRange[0] - (spcValueRange[1] - spcValueRange[0]) && x <= spcValueRange[1] + (spcValueRange[1] - spcValueRange[0]);
  const spcOffChart = [["LSL", spec.lsl], ["USL", spec.usl], ["Set", spec.setPoint]].filter(([, x]) => isNum(x) && !nearData(x));
  const spcYDomain = paddedDomain([
    ...displayedSpcData.map((d) => d.value),
    ...[spec.lsl, spec.usl, spec.setPoint].filter(nearData),
    spcCtl.ucl, spcCtl.lcl,
  ]);
  const ewmaYDomain = paddedDomain([
    ...displayedSpcData.flatMap((d) => [d.ewma, d.ewmaUcl, d.ewmaLcl]),
    spcCtl.mean,
  ]);
  const spcStatusOf = (d) => classifyPoint(d.value, spec, spcCtl);
  const displayedSpcCounts = countStatuses(displayedSpcData.map((d) => d.value), spec, spcCtl);
  const histValues = telemetryTrendData.map((d) => d.value);
  const isTimeChart = spcChartType !== "histogram";

  /** Time-ordered SPC chart host: scrolls horizontally (18 px per reading) or fits the card width. */
  const renderTimeChart = (height, render) => (
    <SafeChart height={height}>
      {({ width, height: h }) => {
        const chartWidth = spcChartMode === "scroll" ? Math.max(width, displayedSpcData.length * 18) : width;
        return (
          <div ref={spcChartScrollRef} className={spcChartMode === "scroll" ? "tm-scroll-x" : ""} style={{ width: "100%", height: "100%" }}>
            <div style={{ width: chartWidth, minWidth: "100%", height: h - 6, cursor: spcDragLeft != null ? "col-resize" : "crosshair" }}>
              {render(chartWidth, h - 16)}
            </div>
          </div>
        );
      }}
    </SafeChart>
  );

  const capabilityCard = (
    <div className="ra-card tm-clip" data-accent style={accent(ACCENT.quality)}>
      <div className="ra-card-head tm-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="ra-icon"><GaugeIcon size={16} /></span>
          <div>
            <h3 className="ra-card-title">Process capability summary · all parameters with spec limits</h3>
            <p className="ra-card-sub">Cp / Cpk use σ within (short-term), Pp / Ppk use σ overall (long-term). Last {SPC_WINDOW.toLocaleString()} readings per parameter. Click a row or bar to open its SPC chart.</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(RATING).map(([k, r]) => {
            const count = capabilityRows.filter((x) => x.rating === k).length;
            const RIcon = r.icon;
            return <span key={k} className="ra-chip" style={accent(count ? r.color : THEME.faint)}><RIcon size={11} />{r.label} <strong>{count}</strong></span>;
          })}
          <span className="ra-chip" style={accent(ACCENT.neutral)}>{capabilityRows.length} parameters</span>
        </div>
      </div>
      {capabilityRows.length === 0
        ? <div className="tm-empty">No parameter has spec limits configured.</div>
        : <CapabilitySummary rows={capabilityRows} selectedKey={selectedTelemetryParam} onSelect={(key) => { selectParam(key); setTelemetryViewMode("spc_detail"); }} />}
      <div className="ra-note">
        Cp = (USL − LSL) / 6σw · Cpk = min(USL − μ, μ − LSL) / 3σw · Pp = (USL − LSL) / 6σo · Ppk = min(USL − μ, μ − LSL) / 3σo, with σw = MR̄ / 1.128 and σo = sample standard deviation. Rating uses Cpk: ≥ 1.33 capable, 1.00 – 1.33 marginal, &lt; 1.00 not capable. Limits ≥ 9999, 0 or blank count as not set.
      </div>
    </div>
  );

  /* ═════════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="tm-root">
      <style>{CARD_CSS}{`
        .tm-root { display: flex; flex-direction: column; gap: 16px; font-family: ${FONT_FAMILY}; }
        .tm-root * { box-sizing: border-box; }

        /* Cards (base styles from the shared CARD_CSS) */
        .tm-clip { overflow: hidden; }
        .tm-head { align-items: center; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; }
        .tm-status-row { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 8px 16px; border-bottom: 1px solid #f1f5f9; font-size: 11.5px; color: #475569; }
        .tm-status-chip { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
        .tm-status-chip i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
        .tm-status-chip strong { color: #0f172a; font-weight: 600; font-variant-numeric: tabular-nums; }
        .tm-empty { min-height: 160px; display: grid; place-content: center; color: #94a3b8; font-size: 12px; text-align: center; padding: 20px; }

        /* Category tabs & toggles */
        .tm-toolbar-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .tm-category-tab { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; font-family: inherit; color: #64748b; transition: all 0.15s ease; }
        .tm-category-tab:hover:not(.active) { border-color: #cbd5e1; background: #f8fafc; color: #0f172a; }
        .tm-category-tab.active { color: #fff; font-weight: 600; }
        .tm-category-tab-label { font-size: 12px; font-weight: 600; }
        .tm-category-tab-count { font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .tm-seg { display: inline-flex; gap: 4px; padding: 4px; background: #f1f5f9; border-radius: 10px; flex-wrap: wrap; }
        .tm-seg-btn { padding: 5px 12px; border: none; border-radius: 7px; background: transparent; cursor: pointer; font-size: 11.5px; font-weight: 600; color: #64748b; font-family: inherit; display: inline-flex; align-items: center; gap: 5px; }
        .tm-seg-btn:hover { color: #0f172a; }
        .tm-seg-btn.active { background: #fff; color: #0f172a; box-shadow: 0 1px 2px rgba(15,23,42,.08); }
        .tm-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; font-size: 11.5px; font-weight: 600; color: #334155; cursor: pointer; font-family: inherit; }
        .tm-btn:hover:not(:disabled) { border-color: #94a3b8; color: #0f172a; }
        .tm-btn:disabled { opacity: .4; cursor: not-allowed; }
        .tm-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

        /* KPI */
        .tm-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(138px, 1fr)); gap: 12px; padding: 16px 18px; }
        .tm-kpi { box-shadow: 0 1px 2px rgba(15,23,42,.04); }
        .tm-kpi-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
        .tm-kpi-value { font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.15; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
        .tm-kpi-unit { font-size: 12px; font-weight: 500; color: #64748b; margin-left: 4px; }
        .tm-kpi-subtext { font-size: 11.5px; color: #64748b; margin-top: 4px; }

        /* Parameter cards */
        .tm-param-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        @media (max-width: 1100px) { .tm-param-grid { grid-template-columns: 1fr; } }
        .tm-param-grid .ra-card:hover { box-shadow: 0 6px 20px rgba(15,23,42,0.06); }
        .tm-param-chart-header { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
        .tm-param-title { font-size: 14.5px; font-weight: 700; color: #0f172a; margin: 0; line-height: 1.25; }
        .tm-param-subtitle { font-size: 12px; color: #64748b; margin: 3px 0 0; font-variant-numeric: tabular-nums; }
        .tm-mini-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 10px 16px; border-bottom: 1px solid #f1f5f9; }
        .tm-mini-stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .tm-mini-stat-label { font-size: 10.5px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .06em; }
        .tm-mini-stat-value { font-size: 13.5px; font-weight: 600; color: #0f172a; font-variant-numeric: tabular-nums; }

        /* Badges */
        .tm-badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 9999px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .tm-badge.green { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
        .tm-badge.red { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
        .tm-badge.amber { background: #fffbeb; color: #b45309; border-color: #fde68a; }
        .tm-badge.neutral { background: #f8fafc; color: #475569; border-color: #e2e8f0; }

        /* Legend */
        .tm-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 10px 18px 0; font-size: 11.5px; color: #475569; }
        .tm-legend-item { display: inline-flex; align-items: center; gap: 6px; }
        .tm-legend-dot { width: 8px; height: 8px; border-radius: 50%; }
        .tm-legend-line { width: 16px; border-top-width: 2px; }
        .tm-legend-band { width: 14px; height: 10px; border-radius: 2px; border: 1px solid; }

        /* Gauge */
        .tm-gauge-wrapper { position: relative; display: flex; flex-direction: column; align-items: center; }
        .tm-gauge-body { position: absolute; top: 60%; left: 50%; transform: translate(-50%, -50%); text-align: center; pointer-events: none; }
        .tm-gauge-value { font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1; font-variant-numeric: tabular-nums; }
        .tm-gauge-label { font-size: 11px; font-weight: 600; margin-top: 4px; }
        .tm-gauge-cp { font-size: 11px; color: #64748b; margin-top: 2px; }
        .tm-hist-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; padding: 16px 18px; }
        .tm-hist-grid.single { grid-template-columns: 1fr; }
        @media (max-width: 1100px) { .tm-hist-grid { grid-template-columns: 1fr; } }
        .tm-subhead { font-size: 13px; font-weight: 700; color: #0f172a; margin: 0 0 8px; }

        /* Tooltip */
        .tm-tt-title { font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
        .tm-tt-sub { font-size: 11px; color: #64748b; margin-bottom: 6px; font-family: ui-monospace, monospace; }
        .tm-tt-grid { display: grid; grid-template-columns: auto auto; gap: 3px 16px; font-size: 12px; font-variant-numeric: tabular-nums; }
        .tm-tt-grid span { color: #475569; }
        .tm-tt-grid strong { color: #0f172a; font-weight: 700; text-align: right; }
        .tm-tt-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
        .tm-tt-foot { color: #64748b; font-size: 11px; margin-top: 6px; }

        /* Scroll */
        .tm-scroll-x { overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent; }

        /* Search, table, pagination */
        .tm-search { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; min-width: 200px; }
        .tm-search input { border: none; outline: none; flex: 1; font-size: 11.5px; font-family: inherit; background: transparent; color: #334155; min-width: 0; }
        .tm-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        .tm-table thead th { position: sticky; top: 0; background: #f8fafc; padding: 9px 10px; text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; border-bottom: 1px solid #e2e8f0; }
        .tm-table tbody td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; color: #1e293b; font-variant-numeric: tabular-nums; }
        .tm-table tbody tr:nth-child(even) { background: #fbfcfe; }
        .tm-table tbody tr:hover { background: ${withAlpha(ACCENT.quality, 0.05)}; }
        .tm-mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #1e293b; }
        .tm-pagination { display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; border-top: 1px solid #f1f5f9; flex-wrap: wrap; gap: 10px; font-size: 11.5px; color: #64748b; }
        .tm-page-btn { width: 28px; height: 28px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; display: grid; place-items: center; color: #475569; font-family: inherit; }
        .tm-page-btn:disabled { opacity: .35; cursor: not-allowed; }
        .tm-page-select { padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 11.5px; font-family: inherit; background: #fff; color: #334155; }

        /* Parameter picker */
        .tm-param-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 8px; font-size: 11.5px; font-weight: 500; border: 1px solid #e2e8f0; background: #fff; color: #475569; cursor: pointer; font-family: inherit; }
        .tm-param-pill:hover { border-color: #94a3b8; color: #0f172a; }
        .tm-param-pill.active { background: #0f172a; border-color: #0f172a; color: #fff; }
        .tm-sort-btn { display: inline-flex; align-items: center; gap: 4px; width: 100%; border: none; background: none; padding: 0; font: inherit; color: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer; white-space: nowrap; }
        .tm-sort-btn:hover { color: #0f172a; }
        .tm-picker-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .06em; }
      `}</style>

      {/* ═══ CATEGORY TABS + VIEW MODE ═══ */}
      <div className="tm-toolbar-card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ALL_TELEMETRY_CATEGORIES.map((cat) => (
            <CategoryTab key={cat.id} cat={cat} isActive={telemetryCategory === cat.id} onClick={() => selectCategory(cat)} />
          ))}
        </div>
        <div className="tm-seg">
          <button type="button" onClick={() => setTelemetryViewMode("stacked_timeline")} className={`tm-seg-btn ${telemetryViewMode === "stacked_timeline" ? "active" : ""}`}>
            All parameters
          </button>
          <button type="button" onClick={() => setTelemetryViewMode("spc_detail")} className={`tm-seg-btn ${telemetryViewMode === "spc_detail" ? "active" : ""}`}>
            Single parameter SPC
          </button>
        </div>
      </div>

      {/* ═══ VIEW 1: ALL PARAMETERS ═══ */}
      {telemetryViewMode === "stacked_timeline" && (
        <>
          <div className="ra-card tm-clip" data-accent style={accent(STATUS.critical)}>
            <div className="ra-card-head tm-head">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="ra-icon"><ShieldAlert size={16} /></span>
                <div>
                  <h3 className="ra-card-title">Which parameters drift outside their limits</h3>
                  <p className="ra-card-sub">Share of shots out of spec and out of control, worst first. Click a parameter to open its SPC chart.</p>
                </div>
              </div>
              <span className="ra-chip" style={accent(ACCENT.neutral)}><Clock size={11} />Last {stackedTimelineData.length} shots</span>
            </div>
            <div className="ra-card-body" style={{ paddingTop: 12 }}>
              {exceedanceItems.length > 0
                ? <ParameterExceedanceBar items={exceedanceItems} onSelect={(key) => { selectParam(key); setTelemetryViewMode("spc_detail"); }} />
                : <div className="tm-empty">No parameter in this category has recorded readings.</div>}
            </div>
            <div className="ra-note">
              Out of spec = beyond the recipe LSL / USL. Out of control = beyond mean ± 3σ (σ from the moving range), counted independently.
              {paramsWithoutLimits > 0 && ` ${paramsWithoutLimits} of ${categoryParamStats.length} parameters have no spec limits configured, so only out-of-control is shown for them.`}
            </div>
          </div>

          {capabilityCard}

          <div className="ra-card" style={{ padding: "10px 0 12px" }}>
            <LegendKey items={spcLegendItems({ hasLimits: true, hasControl: true })} />
            <div className="tm-legend" style={{ color: MUTED, paddingTop: 6 }}>
              Warning = beyond ±2σ but inside the control limits, or within {NEAR_SPEC_FRACTION * 100}% of the tolerance from a spec limit. Normal points are drawn only when a chart has 60 readings or fewer.
            </div>
          </div>

          <div className="tm-param-grid">
            {categoryParamStats.map(({ param, spec: pSpec, vals, st, ctl, counts }) => {
              const unit = pSpec.unit && pSpec.unit !== "—" ? pSpec.unit : "";
              const domain = paddedDomain([...vals, pSpec.lsl, pSpec.usl, pSpec.setPoint, ctl.ucl, ctl.lcl]);
              const hasCtl = isNum(ctl.ucl);
              const statusOf = (d) => classifyPoint(d[param.key], pSpec, ctl);
              const hasOos = (counts?.oos ?? 0) > 0;
              const hasWarn = (counts?.warning ?? 0) > 0;
              // Per-parameter identity colour from the catalog drives the card accent; status lives in the chip.
              const paramColor = param.color || ALL_45_PARAMETERS.find((p) => p.key === param.key)?.color || ACCENT.process;
              const gradId = `tmParamFill-${param.key}`;
              return (
                <div key={param.key} className="ra-card tm-clip" data-accent style={{ ...accent(paramColor), transition: "transform 0.15s ease, box-shadow 0.15s ease" }}>
                  <div className="ra-card-head tm-param-chart-header">
                    <div style={{ minWidth: 0, flex: 1, display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span className="ra-icon"><Activity size={16} /></span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <h4 className="tm-param-title">{param.label}{unit ? ` (${unit})` : ""}</h4>
                        {hasOos ? (
                          <span className="ra-chip" style={accent(PT_COLOR.oos)}><ShieldAlert size={11} />{counts.oos} out of spec</span>
                        ) : hasWarn ? (
                          <span className="ra-chip" style={accent(ACCENT.warning)}><AlertTriangle size={11} />{counts.warning} warning</span>
                        ) : (
                          <span className="ra-chip" style={accent(STATUS.good)}><CheckCircle2 size={11} />In spec</span>
                        )}
                      </div>
                      <div className="tm-param-subtitle">
                        {pSpec.hasLimits
                          ? <>Set {fmtVal(pSpec.setPoint)} · Spec {pSpec.lsl} – {pSpec.usl}{hasCtl ? ` · Control ${fmtVal(ctl.lcl)} – ${fmtVal(ctl.ucl)}` : ""}</>
                          : <>Spec limits not configured{hasCtl ? ` · Control ${fmtVal(ctl.lcl)} – ${fmtVal(ctl.ucl)}` : ""}</>}
                      </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span className="ra-chip" style={accent(paramColor)}>{st.n} readings</span>
                      <button type="button" className="tm-btn" onClick={() => { selectParam(param.key); setTelemetryViewMode("spc_detail"); }}>
                        View SPC chart
                      </button>
                    </div>
                  </div>

                  <div className="tm-mini-stats">
                    <MiniStat label="Mean" value={fmtVal(st.mean)} />
                    <MiniStat label="Std dev" value={fmtVal(st.std)} />
                    <MiniStat label="Min" value={fmtVal(st.min)} />
                    <MiniStat label="Max" value={fmtVal(st.max)} />
                  </div>
                  {st.n > 0 && <StatusCounts counts={counts} hasLimits={pSpec.hasLimits} />}

                  <div style={{ padding: "8px 8px 4px" }}>
                    {st.n === 0 ? (
                      <div className="tm-empty" style={{ height: 260 }}>No readings recorded for this parameter.</div>
                    ) : (
                      <SafeChart height={260}>
                        {({ width, height }) => (
                          <ComposedChart width={width} height={height} data={stackedTimelineData} margin={{ top: 14, right: 48, left: 8, bottom: 22 }}>
                            <defs>
                              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={SERIES} stopOpacity={0.22} />
                                <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid {...RECHARTS_GRID} />
                            <XAxis dataKey="timeLabel" {...RECHARTS_AXIS} interval="preserveStartEnd" minTickGap={24}
                              label={{ value: "Shot time (last shots, oldest → newest)", position: "insideBottom", offset: -12, fontSize: 11, fill: THEME.body }} />
                            <YAxis {...RECHARTS_AXIS} axisLine={false} width={56} domain={domain} tickFormatter={fmtAxis} allowDataOverflow
                              label={{ value: unit || "Value", angle: -90, position: "insideLeft", offset: 4, fontSize: 11, fill: THEME.body, style: { textAnchor: "middle" } }} />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const d = payload[0].payload;
                                const val = d[param.key];
                                return (
                                  <ReadingTooltip
                                    title={`Shot ${d.shot || "—"}${d.shift ? ` · Shift ${d.shift}` : ""}`}
                                    sub={d.part}
                                    value={val} unit={unit} spec={pSpec} ctl={ctl} status={statusOf(d)}
                                    extraRows={[{ label: "Time", value: `${d.dateLabel} ${d.timeLabel}` }, { label: "Part result", value: qualityLabel(d.quality) }]}
                                  />
                                );
                              }}
                            />
                            {pSpec.hasLimits && (
                              <ReferenceArea y1={pSpec.lsl} y2={pSpec.usl} fill={OUTCOME.ok} fillOpacity={0.06} ifOverflow="hidden" />
                            )}
                            {hasCtl && isNum(domain[1]) && ctl.ucl < domain[1] && (
                              <ReferenceArea y1={ctl.ucl} y2={domain[1]} fill={STATUS.critical} fillOpacity={0.05} ifOverflow="hidden" />
                            )}
                            {hasCtl && isNum(domain[0]) && ctl.lcl > domain[0] && (
                              <ReferenceArea y1={domain[0]} y2={ctl.lcl} fill={STATUS.critical} fillOpacity={0.05} ifOverflow="hidden" />
                            )}
                            {hasCtl && <ReferenceLine y={ctl.uwl} stroke={WARN_LINE} strokeDasharray="2 3" />}
                            {hasCtl && <ReferenceLine y={ctl.lwl} stroke={WARN_LINE} strokeDasharray="2 3" />}
                            {hasCtl && <ReferenceLine y={ctl.ucl} stroke={CONTROL} strokeDasharray="6 3" label={{ ...REF_LABEL, value: "UCL", position: "right" }} />}
                            {hasCtl && <ReferenceLine y={ctl.lcl} stroke={CONTROL} strokeDasharray="6 3" label={{ ...REF_LABEL, value: "LCL", position: "right" }} />}
                            {pSpec.hasLimits && <ReferenceLine y={pSpec.usl} stroke={LIMIT} strokeDasharray="5 3" label={{ ...REF_LABEL, value: "USL", position: "right" }} />}
                            {pSpec.hasLimits && <ReferenceLine y={pSpec.lsl} stroke={LIMIT} strokeDasharray="5 3" label={{ ...REF_LABEL, value: "LSL", position: "right" }} />}
                            {pSpec.hasLimits
                              ? <ReferenceLine y={pSpec.setPoint} stroke={CENTER} strokeDasharray="4 3" label={{ ...REF_LABEL, value: "Set", position: "right" }} />
                              : <ReferenceLine y={st.mean} stroke={CENTER} strokeDasharray="4 3" label={{ ...REF_LABEL, value: "Mean", position: "right" }} />}
                            <Area type="linear" dataKey={param.key} stroke="none" fill={`url(#${gradId})`} isAnimationActive={false}
                              dot={false} activeDot={false} legendType="none" tooltipType="none" />
                            <Line type="linear" dataKey={param.key} name={param.label} stroke={SERIES} strokeOpacity={0.85} strokeWidth={2} isAnimationActive={false}
                              dot={statusDot(statusOf, { showNormal: st.n <= 60 })} activeDot={{ r: 4.5, strokeWidth: 1, stroke: "#fff", fill: SERIES }} />
                          </ComposedChart>
                        )}
                      </SafeChart>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ═══ VIEW 2: PARAMETER PICKER ═══ */}
      {telemetryViewMode === "spc_detail" && (
        <div className="ra-card tm-clip" style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setTelemetryViewMode("stacked_timeline")} className="tm-btn">
              <ArrowLeft size={13} /> All parameters
            </button>
            <span className="tm-picker-label" style={{ marginLeft: 6 }}>Category</span>
            {ALL_TELEMETRY_CATEGORIES.map((cat) => (
              <button key={cat.id} type="button" onClick={() => selectCategory(cat)} className={`tm-param-pill ${telemetryCategory === cat.id ? "active" : ""}`}>
                {cat.shortLabel} <span style={{ opacity: 0.7 }}>{cat.params?.length ?? cat.count}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span className="tm-picker-label">Parameter</span>
            {activeCategoryParams.map((f) => (
              <button key={f.key} type="button" onClick={() => selectParam(f.key)} className={`tm-param-pill ${selectedTelemetryParam === f.key ? "active" : ""}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ═══ SPC KPI + CHART ═══ */}
      <div className="ra-card tm-clip" data-accent style={accent(paramColor)}>
        <div className="ra-card-head tm-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="ra-icon">{spcChartType === "ewma" ? <Waves size={16} /> : <TrendingUp size={16} />}</span>
            <div>
              <h3 className="ra-card-title">
                {spcChartType === "ewma" ? "EWMA Chart" : spcChartType === "histogram" ? "Distribution & Capability" : "SPC Individuals Chart"} · {spec.label}{unitSuffix ? ` (${spec.unit})` : ""}
              </h3>
              <p className="ra-card-sub">
                Last {telemetryTrendData.length.toLocaleString()} parts with a reading · showing {displayedSpcData.length.toLocaleString()}.{spcChartType !== "histogram" ? " Drag across the chart to zoom." : ""}
              </p>
            </div>
          </div>
          <div className="tm-toolbar">
            {!spec.hasLimits && typeof onOpenRecipeModal === "function" && (
              <button type="button" className="tm-btn" onClick={onOpenRecipeModal}>Set limits</button>
            )}
            <button type="button" onClick={exportSetVsLiveOverview} className="tm-btn" disabled={!orderedParts.length}>
              <Download size={12} /> Set vs live summary
            </button>
          </div>
        </div>

        <div className="tm-kpi-row">
          <KpiCard
            label="Set point"
            value={spec.hasLimits ? fmtVal(spec.setPoint) : "—"}
            unit={spec.unit}
            subtext={spec.hasLimits ? `Spec ${spec.lsl} – ${spec.usl}` : "Limits not configured"}
            icon={Target}
            color={spec.hasLimits ? paramColor : ACCENT.neutral}
          />
          <KpiCard
            label={<>Mean ± <span style={{ textTransform: "none" }}>σ</span> overall</>}
            value={isNum(spcMetrics.mean) ? `${fmtKpi(spcMetrics.mean)} ± ${fmtKpi(spcMetrics.std)}` : "—"}
            unit={spec.unit}
            subtext={`${spcMetrics.n.toLocaleString()} readings · σ within ${fmtSmall(spcMetrics.sigmaWithin)}`}
            icon={Activity}
            color={paramColor}
          />
          <KpiCard
            label="Out of spec"
            value={spec.hasLimits ? spcMetrics.outCount.toLocaleString() : "—"}
            valueColor={spec.hasLimits && spcMetrics.outCount > 0 ? C_NG : undefined}
            subtext={spec.hasLimits
              ? (spcMetrics.n > 0 ? `${fmtVal(spcMetrics.cap.oosPct, 1)}% of ${spcMetrics.n.toLocaleString()} readings` : "No readings")
              : "Limits not configured"}
            icon={spec.hasLimits && spcMetrics.outCount === 0 ? CheckCircle2 : ShieldAlert}
            color={!spec.hasLimits ? ACCENT.neutral : spcMetrics.outCount > 0 ? STATUS.critical : STATUS.good}
          />
          <KpiCard
            label="Cpk · short term"
            value={isNum(spcMetrics.cpk) ? spcMetrics.cpk.toFixed(2) : "—"}
            subtext={isNum(spcMetrics.cpk) ? `Cp ${spcMetrics.cp.toFixed(2)} · σ within (MR̄/1.128)` : `Not available: ${spcMetrics.cpkReason}`}
            icon={GaugeIcon}
            color={RATING[capRating(spcMetrics.cpk)]?.color || ACCENT.neutral}
          />
          <KpiCard
            label="Ppk · long term"
            value={isNum(spcMetrics.ppk) ? spcMetrics.ppk.toFixed(2) : "—"}
            subtext={isNum(spcMetrics.ppk) ? `Pp ${spcMetrics.pp.toFixed(2)} · σ overall (sample SD)` : `Not available: ${spcMetrics.cpkReason}`}
            icon={Scale}
            color={RATING[capRating(spcMetrics.ppk)]?.color || ACCENT.neutral}
          />
          <KpiCard
            label="Control limits"
            value={isNum(spcMetrics.lcl) ? `${fmtKpi(spcMetrics.lcl)} – ${fmtKpi(spcMetrics.ucl)}` : "—"}
            unit={spec.unit}
            subtext="Mean ± 3σ within"
            icon={Sliders}
            color={CONTROL}
          />
          <KpiCard
            label="Run-rule signals"
            value={spcHasCtl ? ruleSummary.flagged.length.toLocaleString() : "—"}
            subtext={spcHasCtl
              ? RUN_RULES.map((r) => `${r.short} ${ruleSummary.byRule[r.id]}`).join(" · ")
              : "No variation"}
            icon={ListChecks}
            color={ruleSummary.flagged.length > 0 ? RULE_COLOR : STATUS.good}
          />
          <KpiCard
            label="NG parts mean"
            value={isNum(spcMetrics.ngMean) ? fmtKpi(spcMetrics.ngMean) : "—"}
            unit={spec.unit}
            subtext={`${spcMetrics.ngCount.toLocaleString()} NG · ${spcMetrics.okCount.toLocaleString()} OK parts`}
            icon={AlertTriangle}
            color={ACCENT.ng}
          />
        </div>

        <div className="ra-card-head tm-head" style={{ borderTop: "1px solid #f1f5f9" }}>
          <div className="tm-toolbar" style={{ gap: 14 }}>
            <StatusCounts counts={displayedSpcCounts} hasLimits={spec.hasLimits} inline />
            <span style={{ fontSize: 11.5, color: MUTED }}>
              Parts: <strong style={{ color: OUTCOME.ok }}>{displayedSpcData.filter((d) => d.status === "OK").length}</strong> OK ·{" "}
              <strong style={{ color: OUTCOME.ng }}>{displayedSpcData.filter((d) => d.status === "NG").length}</strong> NG
            </span>
          </div>
          <div className="tm-toolbar">
            <div className="tm-seg" role="tablist" aria-label="Chart type">
              {[["run", "Individuals", TrendingUp], ["ewma", "EWMA", Waves], ["histogram", "Histogram", Sigma], ["both", "I + Histogram", Layers]].map((t) => {
                const [k, l] = t;
                const TabIcon = t[2];
                return (
                  <button key={k} type="button" role="tab" aria-selected={spcChartType === k} onClick={() => setSpcChartType(k)} className={`tm-seg-btn ${spcChartType === k ? "active" : ""}`}>
                    <TabIcon size={12} />{l}
                  </button>
                );
              })}
            </div>
            {isTimeChart && (
              <div className="tm-seg">
                <button type="button" onClick={() => setSpcChartMode("scroll")} className={`tm-seg-btn ${spcChartMode === "scroll" ? "active" : ""}`}>Scroll</button>
                <button type="button" onClick={() => setSpcChartMode("fit")} className={`tm-seg-btn ${spcChartMode === "fit" ? "active" : ""}`}>Fit to width</button>
              </div>
            )}
            {isTimeChart && spcChartMode === "scroll" && (
              <div style={{ display: "flex", gap: 3 }}>
                <button type="button" onClick={() => scrollSpcChart("left")} className="tm-page-btn" aria-label="Scroll left">‹</button>
                <button type="button" onClick={() => scrollSpcChart("right")} className="tm-page-btn" aria-label="Scroll right">›</button>
              </div>
            )}
            {(spcZoomRange.start !== 0 || spcZoomRange.end != null) && (
              <button type="button" onClick={handleSpcResetZoom} className="tm-btn"><RotateCcw size={12} /> Reset zoom</button>
            )}
          </div>
        </div>

        {/* ── Individuals chart with run rules ── */}
        {(spcChartType === "run" || spcChartType === "both") && (
          displayedSpcData.length === 0 ? (
            <div className="tm-empty" style={{ height: 300 }}>No readings recorded for {spec.label}.</div>
          ) : (
            <>
              <h4 className="tm-subhead" style={{ padding: "12px 18px 0", margin: 0 }}>Individuals (I) chart with Western Electric / Nelson run rules</h4>
              <LegendKey items={spcLegendItems({
                hasLimits: spec.hasLimits,
                hasControl: spcHasCtl,
                extra: [
                  { label: "NG part (dark ring)", color: INK, type: "ring" },
                  ...(spec.hasLimits ? [{ label: "Centre line μ (mean)", color: THEME.faint, type: "line", dotted: true }] : []),
                  ...(spcHasCtl ? [{ label: "Run-rule signal (◇, number = rule)", color: RULE_COLOR, type: "diamond" }] : []),
                ],
              })} />
              {!spec.hasLimits && (
                <div className="tm-legend" style={{ color: MUTED, paddingTop: 4 }}>
                  Spec limits are not configured for this parameter, so no LSL / USL or out-of-spec status is shown.
                </div>
              )}
              {spcOffChart.length > 0 && (
                <div className="tm-legend" style={{ color: MUTED, paddingTop: 4 }}>
                  Off the chart (far from the data, not drawn): {spcOffChart.map(([k, x]) => `${k} ${fmtVal(x)}`).join(" · ")}
                </div>
              )}
              {renderTimeChart(spcChartType === "both" ? 420 : 500, (chartWidth, chartHeight) => (
                <ComposedChart
                  width={chartWidth}
                  height={chartHeight}
                  data={displayedSpcData}
                  margin={{ top: 18, right: 78, left: 12, bottom: 8 }}
                  onMouseDown={handleSpcMouseDown}
                  onMouseMove={handleSpcMouseMove}
                  onMouseUp={handleSpcMouseUp}
                >
                  <defs>
                    <linearGradient id="tmSpcFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SERIES} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...RECHARTS_GRID} />
                  <XAxis dataKey="index" {...RECHARTS_AXIS} minTickGap={16} height={40}
                    label={{ value: "Part sequence # (oldest → newest)", position: "insideBottom", offset: -2, fontSize: 11, fill: THEME.body }} />
                  <YAxis domain={spcYDomain} allowDataOverflow {...RECHARTS_AXIS} axisLine={false} width={62} tickFormatter={fmtAxis}
                    label={{ value: spec.unit ? `${spec.label} (${spec.unit})` : spec.label, angle: -90, position: "insideLeft", offset: 4, fontSize: 11, fill: THEME.body, style: { textAnchor: "middle" } }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <ReadingTooltip
                          title={`Shot ${d.shotNumber} · ${qualityLabel(d.status)} part`}
                          sub={d.partId}
                          value={d.value} unit={spec.unit} spec={spec} ctl={spcCtl} status={spcStatusOf(d)}
                          extraRows={[
                            ...(d.deltaPct != null ? [{ label: "Deviation %", value: fmtSigned(d.deltaPct, 1, "%") }] : []),
                            ...(isNum(d.zScore) ? [{ label: "Distance from mean", value: fmtSigned(d.zScore, 2, "σ") }] : []),
                            { label: "Rule broken", value: d.rules.length ? ruleLabel(d.rules) : "None" },
                            { label: "Time", value: fmtTime(d.ts) },
                            { label: "Machine", value: d.machineName },
                          ]}
                        />
                      );
                    }}
                  />
                  {spec.hasLimits && (
                    <ReferenceArea y1={spec.lsl} y2={spec.usl} fill={OUTCOME.ok} fillOpacity={0.06} ifOverflow="hidden" />
                  )}
                  {spcHasCtl && isNum(spcYDomain[1]) && spcCtl.ucl < spcYDomain[1] && (
                    <ReferenceArea y1={spcCtl.ucl} y2={spcYDomain[1]} fill={STATUS.critical} fillOpacity={0.05} ifOverflow="hidden" />
                  )}
                  {spcHasCtl && isNum(spcYDomain[0]) && spcCtl.lcl > spcYDomain[0] && (
                    <ReferenceArea y1={spcYDomain[0]} y2={spcCtl.lcl} fill={STATUS.critical} fillOpacity={0.05} ifOverflow="hidden" />
                  )}
                  {spcHasCtl && <ReferenceLine y={spcCtl.uwl} stroke={WARN_LINE} strokeDasharray="2 3" ifOverflow="hidden" label={{ ...REF_LABEL, value: "+2σ", position: "right" }} />}
                  {spcHasCtl && <ReferenceLine y={spcCtl.lwl} stroke={WARN_LINE} strokeDasharray="2 3" ifOverflow="hidden" label={{ ...REF_LABEL, value: "−2σ", position: "right" }} />}
                  {spcHasCtl && <ReferenceLine y={spcCtl.ucl} stroke={CONTROL} strokeDasharray="6 3" ifOverflow="hidden" label={{ ...REF_LABEL, fill: CONTROL, value: `UCL ${fmtKpi(spcCtl.ucl)}`, position: "right" }} />}
                  {spcHasCtl && <ReferenceLine y={spcCtl.lcl} stroke={CONTROL} strokeDasharray="6 3" ifOverflow="hidden" label={{ ...REF_LABEL, fill: CONTROL, value: `LCL ${fmtKpi(spcCtl.lcl)}`, position: "right" }} />}
                  {isNum(spcCtl.mean) && <ReferenceLine y={spcCtl.mean} stroke={spec.hasLimits ? THEME.faint : CENTER} strokeDasharray={spec.hasLimits ? "1 3" : "7 4"} ifOverflow="hidden" label={{ ...REF_LABEL, value: `μ ${fmtKpi(spcCtl.mean)}`, position: "right" }} />}
                  {spec.hasLimits && <ReferenceLine y={spec.usl} stroke={LIMIT} strokeWidth={1.5} strokeDasharray="5 3" ifOverflow="hidden" label={{ ...REF_LABEL, fill: LIMIT, value: `USL ${spec.usl}`, position: "insideTopLeft" }} />}
                  {spec.hasLimits && <ReferenceLine y={spec.lsl} stroke={LIMIT} strokeWidth={1.5} strokeDasharray="5 3" ifOverflow="hidden" label={{ ...REF_LABEL, fill: LIMIT, value: `LSL ${spec.lsl}`, position: "insideBottomLeft" }} />}
                  {spec.hasLimits && <ReferenceLine y={spec.setPoint} stroke={CENTER} strokeDasharray="7 4" ifOverflow="hidden" label={{ ...REF_LABEL, value: `Set ${fmtVal(spec.setPoint)}`, position: "insideTopLeft" }} />}
                  <Area type="linear" dataKey="value" stroke="none" fill="url(#tmSpcFill)" isAnimationActive={false}
                    dot={false} activeDot={false} legendType="none" tooltipType="none" />
                  <Line
                    type="linear"
                    dataKey="value"
                    name={spec.label}
                    stroke={SERIES}
                    strokeOpacity={0.85}
                    strokeWidth={2}
                    isAnimationActive={false}
                    dot={spcDot(spcStatusOf, { ruleLabels: displayedSpcData.length <= 300 })}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: "#fff", fill: SERIES }}
                  />
                  {spcDragLeft != null && spcDragRight != null && (
                    <ReferenceArea x1={Math.min(spcDragLeft, spcDragRight)} x2={Math.max(spcDragLeft, spcDragRight)} fill={SERIES} fillOpacity={0.1} stroke={SERIES} strokeDasharray="4 2" />
                  )}
                  <Brush dataKey="index" height={20} stroke="#94a3b8" fill="#f8fafc" travellerWidth={8} />
                </ComposedChart>
              ))}

              {/* Run-rule signal list */}
              {spcHasCtl && (
                <div style={{ borderTop: "1px solid #f1f5f9" }}>
                  <div className="ra-card-head" style={{ padding: "12px 18px 8px", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="ra-icon" style={{ ...accent(RULE_COLOR), width: 28, height: 28 }}><ListChecks size={15} /></span>
                      <div>
                        <h4 className="tm-subhead" style={{ margin: 0 }}>Run-rule signals · {ruleSummary.flagged.length.toLocaleString()} points</h4>
                        <p className="ra-card-sub" style={{ margin: 0 }}>Newest first, over all {spcSeries.length.toLocaleString()} readings. Click a row to zoom the chart to it.</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {RUN_RULES.map((r) => (
                        <span key={r.id} className="ra-chip" title={r.label} style={accent(ruleSummary.byRule[r.id] > 0 ? RULE_COLOR : THEME.faint)}>
                          {r.short} · {r.label} <strong>{ruleSummary.byRule[r.id]}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                  {ruleSummary.flagged.length === 0 ? (
                    <div className="tm-empty" style={{ minHeight: 70 }}>No run rule is broken — the process shows only common-cause variation.</div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table className="tm-table" style={{ minWidth: 820 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "center" }}>Seq #</th><th>Shot</th><th>Time</th><th>Part serial</th>
                            <th style={{ textAlign: "right" }}>Value</th><th style={{ textAlign: "right" }}>Distance (σ)</th>
                            <th>Rules broken</th><th style={{ textAlign: "center" }}>Part result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(showAllSignals ? ruleSummary.flagged : ruleSummary.flagged.slice(0, 10)).map((d) => (
                            <tr key={d.index} style={{ cursor: "pointer" }} onClick={() => setSpcZoomRange({ start: Math.max(0, d.index - 31), end: Math.min(spcSeries.length, d.index + 30) })}>
                              <td style={{ textAlign: "center", color: MUTED }}>{d.index}</td>
                              <td>{d.shotNumber}</td>
                              <td style={{ color: MUTED, whiteSpace: "nowrap" }}>{fmtTime(d.ts)}</td>
                              <td><span className="tm-mono">{d.partId}</span></td>
                              <td style={{ textAlign: "right", fontWeight: 600, color: PT_COLOR[spcStatusOf(d)] === SERIES ? INK : PT_COLOR[spcStatusOf(d)] }}>{fmtVal(d.value, 3)}{unitSuffix}</td>
                              <td style={{ textAlign: "right" }}>{fmtSigned(d.zScore, 2, "σ")}</td>
                              <td>
                                <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                                  {d.rules.map((id) => (
                                    <span key={id} className="ra-chip" style={accent(RULE_COLOR)} title={RUN_RULES.find((r) => r.id === id)?.label}>
                                      {RUN_RULES.find((r) => r.id === id)?.short}
                                    </span>
                                  ))}
                                </span>
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <span className="ra-chip" style={accent(d.status === "NG" ? ACCENT.ng : d.status === "OK" ? ACCENT.ok : ACCENT.wip)}>{qualityLabel(d.status)}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {ruleSummary.flagged.length > 10 && (
                        <div style={{ padding: "8px 18px 12px" }}>
                          <button type="button" className="tm-btn" onClick={() => setShowAllSignals((v) => !v)}>
                            {showAllSignals ? "Show newest 10" : `Show all ${ruleSummary.flagged.length.toLocaleString()} signals`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )
        )}

        {/* ── EWMA chart ── */}
        {spcChartType === "ewma" && (
          !spcHasCtl || displayedSpcData.length === 0 ? (
            <div className="tm-empty" style={{ height: 300 }}>EWMA needs at least 2 readings with some variation.</div>
          ) : (
            <>
              <h4 className="tm-subhead" style={{ padding: "12px 18px 0", margin: 0 }}>
                EWMA chart (λ = {EWMA_LAMBDA}, L = {EWMA_L}) · {ruleSummary.ewmaOoc.toLocaleString()} points beyond the EWMA limits
              </h4>
              <LegendKey items={[
                { label: "EWMA of readings (z)", color: EWMA_COLOR, type: "line" },
                { label: "EWMA signal (beyond limits)", color: STATUS.critical },
                { label: "EWMA control limits", color: CONTROL, type: "line", dashed: true },
                { label: `Centre line μ ${fmtVal(spcCtl.mean)}`, color: CENTER, type: "line", dashed: true },
              ]} />
              {renderTimeChart(500, (chartWidth, chartHeight) => (
                <ComposedChart
                  width={chartWidth}
                  height={chartHeight}
                  data={displayedSpcData}
                  margin={{ top: 18, right: 78, left: 12, bottom: 8 }}
                  onMouseDown={handleSpcMouseDown}
                  onMouseMove={handleSpcMouseMove}
                  onMouseUp={handleSpcMouseUp}
                >
                  <CartesianGrid {...RECHARTS_GRID} />
                  <XAxis dataKey="index" {...RECHARTS_AXIS} minTickGap={16} height={40}
                    label={{ value: "Part sequence # (oldest → newest)", position: "insideBottom", offset: -2, fontSize: 11, fill: THEME.body }} />
                  <YAxis domain={ewmaYDomain} allowDataOverflow {...RECHARTS_AXIS} axisLine={false} width={62} tickFormatter={fmtAxis}
                    label={{ value: spec.unit ? `EWMA of ${spec.label} (${spec.unit})` : `EWMA of ${spec.label}`, angle: -90, position: "insideLeft", offset: 4, fontSize: 11, fill: THEME.body, style: { textAnchor: "middle" } }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={TOOLTIP_STYLE}>
                          <div className="tm-tt-title">Shot {d.shotNumber} · {qualityLabel(d.status)} part</div>
                          <div className="tm-tt-sub">{d.partId}</div>
                          <div className="tm-tt-grid">
                            <span>Reading</span><strong>{fmtVal(d.value, 3)}{unitSuffix}</strong>
                            <span><i className="tm-tt-dot" style={{ background: EWMA_COLOR }} />EWMA z</span><strong>{fmtVal(d.ewma, 3)}{unitSuffix}</strong>
                            <span>EWMA LCL – UCL</span><strong>{fmtVal(d.ewmaLcl, 3)} – {fmtVal(d.ewmaUcl, 3)}</strong>
                            <span>Centre line μ</span><strong>{fmtVal(spcCtl.mean, 3)}{unitSuffix}</strong>
                            <span>Deviation from μ</span><strong>{fmtSigned(d.ewma - spcCtl.mean, 3)}{unitSuffix}</strong>
                            {spec.hasLimits && <><span>Spec LSL – USL</span><strong>{spec.lsl} – {spec.usl}{unitSuffix}</strong></>}
                            <span>Status</span><strong><i className="tm-tt-dot" style={{ background: d.ewmaOoc ? STATUS.critical : STATUS.good }} />{d.ewmaOoc ? "Drift signal" : "In control"}</strong>
                            <span>Time</span><strong>{fmtTime(d.ts)}</strong>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine y={spcCtl.mean} stroke={CENTER} strokeDasharray="7 4" label={{ ...REF_LABEL, value: `μ ${fmtKpi(spcCtl.mean)}`, position: "right" }} />
                  <Line type="linear" dataKey="ewmaUcl" stroke={CONTROL} strokeWidth={1.5} strokeDasharray="6 3" dot={false} activeDot={false} isAnimationActive={false} />
                  <Line type="linear" dataKey="ewmaLcl" stroke={CONTROL} strokeWidth={1.5} strokeDasharray="6 3" dot={false} activeDot={false} isAnimationActive={false} />
                  <Line type="linear" dataKey="ewma" stroke={EWMA_COLOR} strokeWidth={2} isAnimationActive={false}
                    dot={(p) => (p.payload.ewmaOoc && isNum(p.cx) && isNum(p.cy)
                      ? <circle key={p.key} cx={p.cx} cy={p.cy} r={3.5} fill={STATUS.critical} stroke="#fff" strokeWidth={1} />
                      : <g key={p.key} />)}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff", fill: EWMA_COLOR }} />
                  {spcDragLeft != null && spcDragRight != null && (
                    <ReferenceArea x1={Math.min(spcDragLeft, spcDragRight)} x2={Math.max(spcDragLeft, spcDragRight)} fill={SERIES} fillOpacity={0.1} stroke={SERIES} strokeDasharray="4 2" />
                  )}
                  <Brush dataKey="index" height={20} stroke="#94a3b8" fill="#f8fafc" travellerWidth={8} />
                </ComposedChart>
              ))}
              <div className="tm-legend" style={{ color: MUTED, padding: "6px 18px 12px" }}>
                z₀ = μ; zᵢ = λ·xᵢ + (1 − λ)·zᵢ₋₁. Limits μ ± L·σ·√(λ/(2 − λ)·(1 − (1 − λ)^2i)) with σ = σ within. EWMA averages recent shots, so it flags small sustained drifts (≈ 0.5–1.5σ) that the individuals chart misses.
              </div>
            </>
          )
        )}

        {/* ── Histogram + capability ── */}
        {(spcChartType === "histogram" || spcChartType === "both") && (
          <div className={`tm-hist-grid ${spcChartType === "both" ? "single" : ""}`} style={{ borderTop: spcChartType === "both" ? "1px solid #f1f5f9" : "none" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <h4 className="tm-subhead" style={{ margin: 0 }}>Distribution of readings · normal fit</h4>
                {spec.hasLimits && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <CapChip label="Cp" value={spcMetrics.cp} title="(USL − LSL) / 6σ within" />
                    <CapChip label="Cpk" value={spcMetrics.cpk} title="min(USL − μ, μ − LSL) / 3σ within" />
                    <CapChip label="Pp" value={spcMetrics.pp} title="(USL − LSL) / 6σ overall" />
                    <CapChip label="Ppk" value={spcMetrics.ppk} title="min(USL − μ, μ − LSL) / 3σ overall" />
                  </div>
                )}
              </div>
              <div style={{ margin: "-4px -18px 4px" }}>
                <LegendKey items={[
                  ...(spec.hasLimits ? [{ label: "In spec", color: SERIES }, { label: "Out of spec", color: C_NG }] : [{ label: "Parts", color: SERIES }]),
                  { label: "Normal fit (μ, σ overall)", color: CATEGORICAL[6], type: "line" },
                  ...(spec.hasLimits ? [{ label: "Spec limits LSL / USL", color: LIMIT, type: "line", dashed: true }, { label: "Set point", color: CENTER, type: "line", dashed: true }] : []),
                  ...(spcHasCtl ? [{ label: "Control limits UCL / LCL", color: CONTROL, type: "line", dashed: true }] : []),
                  { label: "Mean μ", color: CATEGORICAL[6], type: "line", dotted: true },
                ]} />
              </div>
              <SPCHistogram values={histValues} spec={spec} ctl={spcCtl} cap={spcMetrics.cap} />
            </div>
            {spcChartType !== "both" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                <h4 className="tm-subhead" style={{ margin: 0 }}>Process Capability</h4>
                <CapabilityGauge cpk={spcMetrics.cpk} cp={spcMetrics.cp} reason={spcMetrics.cpkReason} />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                  <CapChip label="Pp" value={spcMetrics.pp} title="(USL − LSL) / 6σ overall" />
                  <CapChip label="Ppk" value={spcMetrics.ppk} title="min(USL − μ, μ − LSL) / 3σ overall" />
                </div>
                <div style={{ fontSize: 11.5, color: MUTED, textAlign: "center", maxWidth: 260 }}>
                  ≥ 1.33 capable · 1.00 – 1.33 marginal · &lt; 1.00 not capable. Cpk ≫ Ppk means the process drifts between shots.
                </div>
              </div>
            )}
          </div>
        )}
        <div className="ra-note">
          σ within = MR̄ / 1.128 (average moving range of consecutive readings) drives the control limits, run rules, EWMA, Cp and Cpk; σ overall = sample standard deviation drives Pp, Ppk and the normal fit. Zero readings are treated as not recorded.
        </div>
      </div>

      {/* ═══ OK vs NG COMPARISON ═══ */}
      <div className="ra-card tm-clip" data-accent style={accent(paramColor)}>
        <div className="ra-card-head tm-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="ra-icon"><Scale size={16} /></span>
            <div>
              <h3 className="ra-card-title">OK vs NG parts · {spec.label}{unitSuffix ? ` (${spec.unit})` : ""}</h3>
              <p className="ra-card-sub">Does this parameter separate good from rejected parts? Each group is normalised to 100 % so different group sizes compare fairly.</p>
            </div>
          </div>
          <span className="ra-chip" style={accent(ACCENT.neutral)}>Last {telemetryTrendData.length.toLocaleString()} readings · in-process parts excluded</span>
        </div>
        <OkNgComparison data={telemetryTrendData} spec={spec} />
        <div className="ra-note">
          Shift in σ = (mean NG − mean OK) / pooled σ, pooled σ = √(((n_OK − 1)·s_OK² + (n_NG − 1)·s_NG²) / (n_OK + n_NG − 2)). |shift| ≥ 0.8 large, ≥ 0.5 medium, ≥ 0.2 small.
        </div>
      </div>

      {telemetryViewMode === "spc_detail" && capabilityCard}

      {/* ═══ PER-PART TABLE ═══ */}
      <div className="ra-card tm-clip" data-accent style={accent(ACCENT.quality)}>
        <div className="ra-card-head tm-head">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="ra-icon"><Layers size={16} /></span>
            <div>
              <h3 className="ra-card-title">Per-part Readings · {spec.label}</h3>
              <p className="ra-card-sub">
                {spec.hasLimits ? `Deviation is measured from the set point (${fmtVal(spec.setPoint)}${unitSuffix}).` : "Spec limits not configured, so no deviation or spec status is shown."}
              </p>
            </div>
          </div>
          <div className="tm-toolbar">
            <div className="tm-seg">
              {[
                { key: "all", label: `All (${telemetryTrendData.length})` },
                ...(spec.hasLimits ? [{ key: "outliers", label: `Out of spec (${spcMetrics.outCount})` }] : []),
                { key: "ng", label: `NG (${spcMetrics.ngCount})` },
                ...(spcHasCtl ? [{ key: "rules", label: `Rule signals (${ruleSummary.flagged.length})` }] : []),
              ].map((f) => (
                <button key={f.key} type="button" onClick={() => { setTelemetryTableFilter(f.key); setTelemetryPage(1); }}
                  className={`tm-seg-btn ${telemetryTableFilter === f.key ? "active" : ""}`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="tm-search">
              <Search size={13} color="#94a3b8" />
              <input type="text" placeholder="Search serial, QR, shot, machine, die" value={telemetrySearch}
                onChange={(e) => { setTelemetrySearch(e.target.value); setTelemetryPage(1); }} />
            </div>
            <button type="button" onClick={exportTelemetryExcel} disabled={!filteredTelemetryRows.length} className="tm-btn">
              <Download size={13} /> Export
            </button>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="tm-table" style={{ minWidth: 1400 }}>
            <thead>
              <tr>
                <th style={{ width: 45, textAlign: "center" }}>#</th>
                <th>Part serial</th>
                <th style={{ textAlign: "center" }}>Shot</th>
                <th>Customer QR</th>
                <th>Machine</th>
                <th>Die</th>
                <th style={{ textAlign: "center" }}>Shift</th>
                <th style={{ textAlign: "right" }}>Value</th>
                <th style={{ textAlign: "right" }}>Set point</th>
                <th>Limits</th>
                <th style={{ textAlign: "right" }}>Deviation</th>
                <th style={{ textAlign: "right" }}>Deviation %</th>
                <th>Spec status</th>
                <th>Run rules</th>
                <th style={{ textAlign: "center" }}>Quality</th>
                <th>Recorded at</th>
              </tr>
            </thead>
            <tbody>
              {filteredTelemetryRows.length === 0 ? (
                <tr>
                  <td colSpan={16} style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>No readings match this filter or search.</td>
                </tr>
              ) : (
                filteredTelemetryRows
                  .slice((telemetryPage - 1) * telemetryPageSize, telemetryPage * telemetryPageSize)
                  .map((r, idx) => {
                    const rowIdx = (telemetryPage - 1) * telemetryPageSize + idx + 1;
                    return (
                      <tr key={`${r.index}-${r.partId}`}>
                        <td style={{ color: "#94a3b8", textAlign: "center" }}>{rowIdx}</td>
                        <td><span className="tm-mono">{r.partId}</span></td>
                        <td style={{ textAlign: "center" }}>{r.shotNumber}</td>
                        <td><span className="tm-mono" style={{ fontSize: 11 }}>{r.customerQr}</span></td>
                        <td>{r.machineName}</td>
                        <td>{r.dieName}</td>
                        <td style={{ textAlign: "center" }}>{r.shiftCode}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: r.outOfSpec ? C_NG : INK }}>{fmtVal(r.value, 3)}{unitSuffix}</td>
                        <td style={{ textAlign: "right" }}>{r.target != null ? `${fmtVal(r.target)}${unitSuffix}` : "—"}</td>
                        <td style={{ color: MUTED }}>{r.lsl != null ? `${r.lsl} – ${r.usl}` : "Not configured"}</td>
                        <td style={{ textAlign: "right" }}>{fmtSigned(r.delta, 3)}</td>
                        <td style={{ textAlign: "right" }}>{fmtSigned(r.deltaPct, 1, "%")}</td>
                        <td>
                          <span className="ra-chip" style={accent(r.specStatus === "IN_SPEC" ? STATUS.good : r.specStatus === "NO_LIMITS" ? ACCENT.neutral : STATUS.critical)}>
                            {specStatusLabel(r.specStatus)}
                          </span>
                        </td>
                        <td>
                          {r.rules?.length
                            ? <span className="ra-chip" style={accent(RULE_COLOR)} title={r.rules.map((id) => RUN_RULES.find((x) => x.id === id)?.label).join("; ")}>{ruleLabel(r.rules)}</span>
                            : <span style={{ color: THEME.faint }}>—</span>}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span className="ra-chip" style={accent(r.status === "NG" ? ACCENT.ng : r.status === "OK" ? ACCENT.ok : ACCENT.wip)}>{qualityLabel(r.status)}</span>
                        </td>
                        <td style={{ color: MUTED, whiteSpace: "nowrap" }}>{formatResultTimestamp(r.createdAt) || "—"}</td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>

        {filteredTelemetryRows.length > 0 && (
          <div className="tm-pagination">
            <div>
              Showing {Math.min((telemetryPage - 1) * telemetryPageSize + 1, filteredTelemetryRows.length)}–{Math.min(telemetryPage * telemetryPageSize, filteredTelemetryRows.length)} of {filteredTelemetryRows.length.toLocaleString()} parts
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Rows
                <select className="tm-page-select" value={telemetryPageSize} onChange={(e) => { setTelemetryPageSize(Number(e.target.value)); setTelemetryPage(1); }}>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button type="button" disabled={telemetryPage <= 1} onClick={() => setTelemetryPage((p) => Math.max(1, p - 1))} className="tm-page-btn" aria-label="Previous page">‹</button>
                <span style={{ padding: "0 8px", color: INK, fontVariantNumeric: "tabular-nums" }}>{telemetryPage} / {pageCount}</span>
                <button type="button" disabled={telemetryPage >= pageCount} onClick={() => setTelemetryPage((p) => Math.min(pageCount, p + 1))} className="tm-page-btn" aria-label="Next page">›</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <FacetedBoxPlot rows={rows} allRejectionRecords={allRejectionRecords} />
    </div>
  );
}
