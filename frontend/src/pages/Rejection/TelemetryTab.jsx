import { useState, useMemo, useCallback } from "react";
import { Activity, Download, Search, Sigma, ListChecks, Layers, Sliders } from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import EChart from "../../components/charts/EChart";
import FacetedBoxPlot from "./FacetedBoxPlot";
import {
  ALL_TELEMETRY_CATEGORIES, ALL_45_PARAMETERS, MACHINE_PROCESS_PARAMETERS,
  formatResultTimestamp, looksLikeCustomerQr,
  extractShotFromPartId, extractShotDateTimeFromPartId,
} from "./rejectionConstants";
import {
  INK, OUTCOME, STATUS, ACCENT, FONT_FAMILY, LEGEND, ECHART_TOOLTIP, CARD_CSS,
  accent, withAlpha, baseOption, valueAxis, axisLabel, tooltipHtml,
} from "./chartTheme";

/* ─────────────────────────────────────────────────────────────────────────────
   COLOURS (shared theme only). OK green / NG red everywhere; control limits red
   dashed, spec limits amber dash-dot, centre line slate.
   ───────────────────────────────────────────────────────────────────────────── */
const C_OK = OUTCOME.ok;
const C_NG = OUTCOME.ng;
const C_WIP = OUTCOME.wip;
const C_CONTROL = OUTCOME.ng;
const C_SPEC = ACCENT.warning;
const C_CENTER = INK.secondary;
const QUALITY_COLOR = { OK: C_OK, NG: C_NG, WIP: C_WIP };
const QUALITY_LABEL = { OK: "OK", NG: "NG", WIP: "In process" };

const NG_STATUSES = ["NG", "FAILED", "FAIL", "ENDED_NG", "COMPLETED_NG"];
const OK_STATUSES = ["OK", "PASSED", "ENDED_OK", "COMPLETED_OK"];

/* ═════════════════════════════════════════════════════════════════════════════
   SPC MATHS — pure functions (no React). Everything between the SPC-MATHS-BEGIN /
   SPC-MATHS-END markers is self-contained so it can be re-run outside the browser.
   ═════════════════════════════════════════════════════════════════════════════ */
/* SPC-MATHS-BEGIN */
const D2 = 1.128;                // d2 for moving ranges of 2 → σ_within = MR̄ / d2
const SPC_WINDOW = 1000;         // last N readings per parameter used by every SPC statistic

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

/** Individuals-chart limits from moving-range σ: centre and ±3σ control limits. */
const controlLimits = (st) => {
  const s = st.sigmaWithin;
  if (!isNum(st.mean) || !isNum(s) || s <= 0) return { mean: st.mean, sigma: null, ucl: null, lcl: null };
  return { mean: st.mean, sigma: s, ucl: st.mean + 3 * s, lcl: st.mean - 3 * s };
};

/**
 * Process capability of an ordered series against its spec.
 *   Cp  = (USL − LSL) / 6σ_within         Cpk = min(USL − μ, μ − LSL) / 3σ_within
 *   Pp  = (USL − LSL) / 6σ_overall        Ppk = min(USL − μ, μ − LSL) / 3σ_overall
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

/** Run-rule test per point (the point completing the pattern is flagged); centre μ, σ = σ_within. */
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

const normalPdf = (x, mu, s) => Math.exp(-((x - mu) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));

/** Histogram range: the data range, widened to take in any limit that lies within one data span of the data. */
const histRange = (vals, marks = []) => {
  if (!vals.length) return null;
  let lo = Infinity, hi = -Infinity;
  vals.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; });
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
/* SPC-MATHS-END */

/* ── Formatting ──────────────────────────────────────────────────────────── */
const fmtVal = (v, d = 2) => (isNum(v) ? Number(v.toFixed(d)).toString() : "—");
const fmtSigned = (v, d = 2, suffix = "") => (isNum(v) ? `${v > 0 ? "+" : ""}${Number(v.toFixed(d))}${suffix}` : "—");
/** Keeps 3 significant digits for tiny values (e.g. σ = 0.0004) instead of rounding to 0. */
const fmtSmall = (v, d = 3) => (isNum(v) && v !== 0 && Math.abs(v) < 10 ** -(d - 1) ? String(Number(v.toPrecision(3))) : fmtVal(v, d));
/** 4 significant digits below 1 (so 0.1994 and 0.2018 do not both read 0.2), else 2 decimals. */
const fmtKpi = (v) => (isNum(v) && v !== 0 && Math.abs(v) < 1 ? String(Number(v.toPrecision(4))) : fmtVal(v));
const fmtAxis = (v) => (isNum(v) ? String(Number(v.toFixed(Math.abs(v) < 10 ? 2 : 1))) : "");
const fmtTime = (ts) => (isNum(ts)
  ? new Date(ts).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
  : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ruleLabel = (ids = []) => ids.map((id) => RUN_RULES.find((r) => r.id === id)?.short).filter(Boolean).join(" · ");
const cleanUnit = (u) => (u && u !== "—" && u !== "-" ? u : "");

const RATING = {
  capable: { label: "Capable", color: STATUS.good },
  marginal: { label: "Marginal", color: ACCENT.warning },
  not: { label: "Not capable", color: STATUS.critical },
};
const ratingColor = (v) => RATING[capRating(v)]?.color || INK.primary;

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
    unit: cleanUnit(base.unit || feat?.unit || ""),
    altKeys: [...(cat?.altKeys || []), ...(feat?.altKeys || [])],
    lsl: lim.lsl, usl: lim.usl, hasLimits: lim.has, setPoint,
  };
};

const paddedDomain = (values) => {
  const v = values.filter(isNum);
  if (!v.length) return [null, null];
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

/** Last SPC_WINDOW readings of one parameter, in production order, rounded like the exports. */
const readingsFor = (parts, spec) => {
  const out = [];
  parts.forEach(({ r, info }) => {
    const v = getParamValue(r, spec);
    if (v != null) out.push({ r, info, v: Number(v.toFixed(3)) });
  });
  return out.slice(-SPC_WINDOW);
};

/* ═════════════════════════════════════════════════════════════════════════════
   SMALL PRESENTATIONAL PIECES
   ═════════════════════════════════════════════════════════════════════════════ */
const Stat = ({ label, value, color, hint }) => (
  <div className="tm-stat" title={hint}>
    <span className="tm-stat-label">{label}</span>
    <span className="tm-stat-value" style={color ? { color } : undefined}>{value}</span>
  </div>
);

const CardHead = ({ icon, title, sub, color = ACCENT.process, children }) => (
  <div className="ra-card-head tm-head">
    <div className="tm-head-main">
      <span className="ra-icon" style={accent(color)}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <h3 className="ra-card-title">{title}</h3>
        {sub && <p className="ra-card-sub">{sub}</p>}
      </div>
    </div>
    {children && <div className="tm-toolbar">{children}</div>}
  </div>
);

const ChartSkeleton = ({ height }) => <div className="tm-skel" style={{ height }} />;

/** Shown while the parent is still fetching PLC readings (first render of the tab), or when there are none. */
const WaitingState = ({ loading = true }) => (loading ? (
  <div className="ra-card tm-wait">
    <div className="tm-wait-text">
      <span className="tm-spinner" aria-hidden="true" />
      <div>
        <div className="tm-wait-title">Loading process data…</div>
        <div className="tm-wait-sub">Charts appear as soon as PLC readings for this period arrive.</div>
      </div>
    </div>
    <div className="tm-stats" style={{ padding: 0 }}>
      {Array.from({ length: 6 }, (_, i) => <div key={i} className="tm-skel" style={{ height: 46 }} />)}
    </div>
    <ChartSkeleton height={300} />
  </div>
) : (
  <div className="ra-card tm-wait">
    <div className="tm-wait-title">No process readings in this period</div>
    <div className="tm-wait-sub">No PLC readings were recorded for the selected dates and filters.</div>
  </div>
));

/* ═════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═════════════════════════════════════════════════════════════════════════════ */
export default function TelemetryTab({
  rows = [],
  recordsRows = [],
  allRejectionRecords = [],
  mlInsights = { features: [] },
  onOpenRecipeModal,
  loading = true,
}) {
  const [categoryId, setCategoryId] = useState("machine_process");
  const [paramKey, setParamKey] = useState("plc_cycle_time");
  const [tableFilter, setTableFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const features = mlInsights?.features;

  const activeParams = useMemo(() => {
    const cat = ALL_TELEMETRY_CATEGORIES.find((c) => c.id === categoryId);
    return cat?.params?.length ? cat.params : MACHINE_PROCESS_PARAMETERS;
  }, [categoryId]);

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

  const spec = useMemo(() => resolveSpec(paramKey, features), [paramKey, features]);
  const u = spec.unit ? ` ${spec.unit}` : "";

  /* ── SPC for the selected parameter ─────────────────────────────────────── */
  const spc = useMemo(() => {
    const list = readingsFor(orderedParts, spec);
    const vals = list.map((x) => x.v);
    const cap = capability(vals, spec);
    const ctl = controlLimits(cap);
    const rules = detectRunRules(vals, ctl.mean, ctl.sigma);
    const hasCtl = isNum(ctl.ucl);
    const points = list.map(({ r, info, v }, i) => {
      const machine = r.machineName || r.machine_name || "";
      const die = r.dieName || r.die_name || "";
      const specStatus = !spec.hasLimits ? "NO_LIMITS" : v > spec.usl ? "HIGH" : v < spec.lsl ? "LOW" : "IN_SPEC";
      return {
        index: i + 1,
        value: v,
        quality: info.quality,
        partId: info.partId || "—",
        customerQr: info.customerQr || "—",
        shot: info.shot || "—",
        machine: machine && machine !== "-" ? machine : "—",
        die: die && die !== "-" ? die : "—",
        shift: r.shiftCode || r.shift_code || "—",
        ts: info.ts,
        createdAt: r.first_scan_at || r.createdAt,
        ooc: hasCtl && (v > ctl.ucl || v < ctl.lcl),
        specStatus,
        oos: specStatus === "HIGH" || specStatus === "LOW",
        delta: isNum(spec.setPoint) ? v - spec.setPoint : null,
        z: hasCtl ? (v - ctl.mean) / ctl.sigma : null,
        rules: rules[i],
      };
    });
    const group = (q) => {
      const g = points.filter((p) => p.quality === q);
      return { n: g.length, mean: g.length ? g.reduce((s, p) => s + p.value, 0) / g.length : null };
    };
    const oocCount = points.filter((p) => p.ooc).length;
    return {
      points, cap, ctl, hasCtl,
      oocCount,
      oocPct: hasCtl && points.length ? (oocCount / points.length) * 100 : null,
      ruleCount: points.filter((p) => p.rules.length).length,
      ok: group("OK"), ng: group("NG"),
    };
  }, [orderedParts, spec]);

  /* ── Overview of every parameter in the active category (worst first) ───── */
  const overviewRows = useMemo(() => activeParams.map((p) => {
    const s = resolveSpec(p.key, features);
    const vals = readingsFor(orderedParts, s).map((x) => x.v);
    const cap = capability(vals, s);
    const ctl = controlLimits(cap);
    const ooc = isNum(ctl.ucl) ? vals.filter((v) => v > ctl.ucl || v < ctl.lcl).length : null;
    return {
      key: p.key, label: s.label, unit: s.unit, n: cap.n, mean: cap.mean, cpk: cap.cpk,
      oocPct: ooc != null && cap.n ? (ooc / cap.n) * 100 : null,
      oosPct: cap.oosPct, hasLimits: s.hasLimits,
    };
  }).sort((a, b) => {
    if (!a.n !== !b.n) return a.n ? -1 : 1;                         // parameters without readings last
    const ca = isNum(a.cpk) ? a.cpk : Infinity;
    const cb = isNum(b.cpk) ? b.cpk : Infinity;
    if (ca !== cb) return ca - cb;                                  // lowest Cpk first
    return (b.oocPct ?? -1) - (a.oocPct ?? -1);                     // then most out of control
  }), [activeParams, orderedParts, features]);

  /* ── Individuals control chart (ECharts, canvas, large-mode scatter) ────── */
  const controlOption = useMemo(() => {
    const { points, ctl, hasCtl } = spc;
    if (!points.length) return null;
    const vals = points.map((p) => p.value);
    const range = histRange(vals, []);
    const span = range[1] - range[0];
    // Limits far from the data (e.g. a placeholder-like USL) would squash the chart: draw only those within one data span.
    const near = (x) => isNum(x) && x >= range[0] - span && x <= range[1] + span;
    const showSpec = spec.hasLimits ? [["LSL", spec.lsl], ["USL", spec.usl]].filter(([, x]) => near(x)) : [];
    const [yMin, yMax] = paddedDomain([...vals, ...(hasCtl ? [ctl.ucl, ctl.lcl] : []), ...showSpec.map(([, x]) => x)]);

    const line = (y, text, color, type, width = 1.5) => ({
      yAxis: y,
      lineStyle: { color, type, width },
      label: {
        formatter: text, position: "insideEndTop", color, fontSize: 10.5, fontWeight: 600, fontFamily: FONT_FAMILY,
        backgroundColor: "rgba(255,255,255,0.85)", padding: [1, 4], borderRadius: 3,
      },
    });
    const marks = [];
    if (isNum(ctl.mean)) marks.push(line(ctl.mean, `CL ${fmtKpi(ctl.mean)}`, C_CENTER, "solid", 1.2));
    if (hasCtl) {
      marks.push(line(ctl.ucl, `UCL ${fmtKpi(ctl.ucl)}`, C_CONTROL, "dashed"));
      marks.push(line(ctl.lcl, `LCL ${fmtKpi(ctl.lcl)}`, C_CONTROL, "dashed"));
    }
    showSpec.forEach(([k, x]) => marks.push(line(x, `${k} ${fmtVal(x, 3)}`, C_SPEC, [8, 4, 2, 4])));

    const n = points.length;
    const dot = n > 600 ? 4 : n > 200 ? 5 : 6;
    const byQ = { OK: [], NG: [], WIP: [] };
    points.forEach((p) => byQ[p.quality].push([p.index, p.value]));
    const scatter = (q, name, z) => ({
      name, type: "scatter", data: byQ[q], symbolSize: q === "NG" ? dot + 1 : dot, z,
      itemStyle: { color: QUALITY_COLOR[q], borderColor: "#fff", borderWidth: n > 600 ? 0 : 0.6 },
      large: true, largeThreshold: 2000, progressive: 0, emphasis: { scale: false },
    });

    const tooltipFor = (p) => {
      const ruleTxt = p.rules.length ? ruleLabel(p.rules) : "None";
      return tooltipHtml({
        title: `Part #${p.index} · Shot ${esc(p.shot)}`,
        subtitle: esc(p.partId),
        rows: [
          { label: "Value", value: `${fmtVal(p.value, 3)}${esc(u)}` },
          { label: "Part result", value: QUALITY_LABEL[p.quality], color: QUALITY_COLOR[p.quality] },
          hasCtl && { label: "Control", value: p.ooc ? "Out of control" : "In control", color: p.ooc ? C_CONTROL : C_OK },
          spec.hasLimits && { label: "Spec", value: p.oos ? (p.specStatus === "HIGH" ? "Above USL" : "Below LSL") : "In spec", color: p.oos ? C_NG : C_OK },
          isNum(p.z) && { label: "Distance from CL", value: fmtSigned(p.z, 2, "σ"), strong: false },
          hasCtl && { label: "Run rules", value: ruleTxt, strong: false },
          { label: "Time", value: fmtTime(p.ts), strong: false },
          { label: "Machine", value: esc(p.machine), strong: false },
        ],
      });
    };

    return baseOption({
      animation: n <= 400,
      grid: { left: 8, right: 14, top: 40, bottom: 58, containLabel: true },
      legend: { ...LEGEND, left: 0, right: "auto", data: ["OK part", "NG part", "In process", "Out of control"] },
      tooltip: {
        ...ECHART_TOOLTIP,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: INK.faint, type: "dashed" } },
        formatter: (params) => {
          const hit = (Array.isArray(params) ? params : [params]).find((x) => x.seriesId === "reading") || params?.[0];
          const idx = Array.isArray(hit?.value) ? hit.value[0] : null;
          const p = isNum(idx) ? points[idx - 1] : null;
          return p ? tooltipFor(p) : "";
        },
      },
      xAxis: {
        type: "value", min: 1, max: Math.max(2, n), minInterval: 1,
        axisLabel: axisLabel({ hideOverlap: true }),
        axisLine: { show: true, lineStyle: { color: INK.axis } },
        axisTick: { show: false }, splitLine: { show: false },
        name: "Part sequence (oldest → newest)", nameLocation: "middle", nameGap: 26,
        nameTextStyle: { color: INK.muted, fontSize: 10.5, fontFamily: FONT_FAMILY },
      },
      yAxis: valueAxis({
        min: yMin, max: yMax, scale: true,
        axisLabel: axisLabel({ formatter: fmtAxis }),
        name: spec.unit || undefined,
        nameTextStyle: { color: INK.muted, fontSize: 10.5, fontFamily: FONT_FAMILY, align: "left" },
      }),
      dataZoom: [
        { type: "inside", xAxisIndex: 0, filterMode: "none" },
        {
          type: "slider", xAxisIndex: 0, filterMode: "none", height: 16, bottom: 4, showDetail: false, brushSelect: false,
          borderColor: INK.border, fillerColor: withAlpha(ACCENT.process, 0.12), backgroundColor: INK.surfaceAlt,
          dataBackground: { lineStyle: { color: INK.axis }, areaStyle: { color: INK.grid } },
          handleStyle: { color: "#fff", borderColor: INK.faint }, moveHandleSize: 0,
        },
      ],
      series: [
        {
          id: "reading", name: "Reading", type: "line", data: points.map((p) => [p.index, p.value]),
          showSymbol: false, symbol: "none", silent: true, z: 1,
          lineStyle: { color: INK.faint, width: 1 },
          emphasis: { disabled: true },
          markLine: { silent: true, symbol: "none", animation: false, data: marks },
        },
        scatter("OK", "OK part", 3),
        scatter("WIP", "In process", 2),
        scatter("NG", "NG part", 4),
        {
          name: "Out of control", type: "scatter", z: 5, silent: true,
          data: points.filter((p) => p.ooc).map((p) => [p.index, p.value]),
          symbol: "circle", symbolSize: dot + 8,
          itemStyle: { color: "rgba(0,0,0,0)", borderColor: C_CONTROL, borderWidth: 2 },
          emphasis: { disabled: true },
        },
      ],
    });
  }, [spc, spec, u]);

  /* ── Distribution: stacked OK / NG / in-process histogram vs limits ─────── */
  const histOption = useMemo(() => {
    const { points, ctl, hasCtl, cap } = spc;
    if (!points.length) return null;
    const vals = points.map((p) => p.value);
    const range = histRange(vals, [spec.lsl, spec.usl, ctl.lcl, ctl.ucl]);
    const { bins, width, indexOf } = makeBins(range[0], range[1], vals.length);
    const counts = bins.map(() => ({ OK: 0, NG: 0, WIP: 0 }));
    points.forEach((p) => { counts[indexOf(p.value)][p.quality] += 1; });
    const n = vals.length;

    const inRange = (x) => isNum(x) && x >= range[0] && x <= range[1];
    const vline = (x, text, color, type) => ({
      xAxis: x, lineStyle: { color, type, width: 1.5 },
      label: { formatter: text, position: "end", color, fontSize: 10, fontWeight: 600, fontFamily: FONT_FAMILY },
    });
    const marks = [];
    if (spec.hasLimits) [["LSL", spec.lsl], ["USL", spec.usl]].forEach(([k, x]) => inRange(x) && marks.push(vline(x, k, C_SPEC, [8, 4, 2, 4])));
    if (hasCtl) [["LCL", ctl.lcl], ["UCL", ctl.ucl]].forEach(([k, x]) => inRange(x) && marks.push(vline(x, k, C_CONTROL, "dashed")));
    if (inRange(ctl.mean)) marks.push(vline(ctl.mean, "CL", C_CENTER, "solid"));

    const stack = (q, name, below) => ({
      name, type: "custom", z: 2,
      itemStyle: { color: QUALITY_COLOR[q] },
      encode: { x: [0, 1], y: [2, 3] },
      data: bins.map((b, i) => {
        const base = below.reduce((s, k) => s + counts[i][k], 0);
        return [b.binStart, b.binEnd, base, base + counts[i][q], i];
      }),
      renderItem: (_params, api) => {
        const y0 = api.value(2), y1 = api.value(3);
        if (!(y1 > y0)) return null;
        const a = api.coord([api.value(0), y1]);
        const b = api.coord([api.value(1), y0]);
        return { type: "rect", shape: { x: a[0] + 0.5, y: a[1], width: Math.max(1, b[0] - a[0] - 1), height: b[1] - a[1] }, style: { fill: QUALITY_COLOR[q] } };
      },
    });

    const s = cap.std;
    const fit = isNum(s) && s > 0
      ? Array.from({ length: 61 }, (_, i) => {
        const x = range[0] + ((range[1] - range[0]) * i) / 60;
        return [x, normalPdf(x, cap.mean, s) * n * width];
      })
      : [];

    return baseOption({
      animation: false,
      grid: { left: 8, right: 14, top: 40, bottom: 28, containLabel: true },
      legend: { ...LEGEND, left: 0, right: "auto", data: ["OK", "NG", "In process", "Normal fit"] },
      tooltip: {
        ...ECHART_TOOLTIP,
        trigger: "item",
        formatter: (p) => {
          const i = p?.data?.[4];
          const b = bins[i];
          if (!b) return "";
          const c = counts[i];
          const tot = c.OK + c.NG + c.WIP;
          return tooltipHtml({
            title: `${fmtVal(b.binStart, 3)} – ${fmtVal(b.binEnd, 3)}${esc(u)}`,
            rows: [
              { label: "Parts in bin", value: `${tot} · ${fmtVal((tot / Math.max(1, n)) * 100, 1)}%` },
              { label: "OK", value: c.OK, color: C_OK },
              { label: "NG", value: c.NG, color: C_NG },
              c.WIP > 0 && { label: "In process", value: c.WIP, color: C_WIP },
            ],
          });
        },
      },
      xAxis: {
        type: "value", min: range[0], max: range[1], scale: true,
        axisLabel: axisLabel({ formatter: fmtAxis, hideOverlap: true }),
        axisLine: { show: true, lineStyle: { color: INK.axis } }, axisTick: { show: false }, splitLine: { show: false },
      },
      yAxis: valueAxis({ minInterval: 1, name: "Parts", nameTextStyle: { color: INK.muted, fontSize: 10.5, fontFamily: FONT_FAMILY, align: "left" } }),
      series: [
        stack("OK", "OK", []),
        stack("NG", "NG", ["OK"]),
        stack("WIP", "In process", ["OK", "NG"]),
        {
          name: "Normal fit", type: "line", data: fit, smooth: true, symbol: "none", silent: true, z: 3,
          lineStyle: { color: C_CENTER, width: 1.5 }, itemStyle: { color: C_CENTER }, tooltip: { show: false },
        },
        {
          name: "limits", type: "line", data: [[range[0], 0], [range[1], 0]], symbol: "none", silent: true,
          lineStyle: { opacity: 0 }, tooltip: { show: false }, z: 4,
          markLine: { silent: true, symbol: "none", animation: false, data: marks },
        },
      ],
    });
  }, [spc, spec, u]);

  /* ── Per-part readings table ────────────────────────────────────────────── */
  const filteredRows = useMemo(() => {
    let list = spc.points;
    if (tableFilter === "ooc") list = list.filter((d) => d.ooc);
    else if (tableFilter === "oos") list = list.filter((d) => d.oos);
    else if (tableFilter === "ng") list = list.filter((d) => d.quality === "NG");
    else if (tableFilter === "rules") list = list.filter((d) => d.rules.length > 0);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((d) => [d.partId, d.customerQr, d.shot, d.machine, d.shift, d.die].some((x) => String(x).toLowerCase().includes(q)));
    return [...list].reverse();   // newest first
  }, [spc.points, tableFilter, search]);

  const selectParam = useCallback((key) => {
    setParamKey(key);
    setPage(1);
    setTableFilter("all");
  }, []);
  const selectCategory = useCallback((cat) => {
    setCategoryId(cat.id);
    if (cat.params?.length) selectParam(cat.params[0].key);
  }, [selectParam]);

  /* ── Excel: set vs live summary for all parameters ──────────────────────── */
  const exportSummary = useCallback(() => {
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
      const s = resolveSpec(p.key, features);
      const readings = [];
      orderedParts.forEach(({ r, info }) => {
        const v = getParamValue(r, s);
        if (v != null) readings.push({ v, q: info.quality });
      });
      const vals = readings.map((x) => x.v);
      const st = seriesStats(vals);
      const sig = st.sigmaWithin;
      const out = s.hasLimits ? vals.filter((v) => v < s.lsl || v > s.usl).length : null;
      const capx = capability(vals, s);
      const idx2 = (v) => (isNum(v) ? Number(v.toFixed(2)) : "-");
      const row = ws.addRow({
        idx: fi + 1, param: s.label, unit: s.unit,
        target: s.setPoint ?? "-", lsl: s.lsl ?? "-", usl: s.usl ?? "-",
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

  const specStatusLabel = (s) => (s === "IN_SPEC" ? "In spec" : s === "HIGH" ? "Above USL" : s === "LOW" ? "Below LSL" : "No limits");

  const exportReadings = useCallback(() => {
    if (!filteredRows.length) return;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Rejection Analysis";
    const ws = wb.addWorksheet("Per-part Readings", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "#", key: "index", width: 8 }, { header: "Part Serial No", key: "partId", width: 26 },
      { header: "Shot Number", key: "shot", width: 14 }, { header: "Customer QR", key: "customerQr", width: 30 },
      { header: "Machine", key: "machine", width: 16 }, { header: "Die", key: "die", width: 12 },
      { header: "Shift", key: "shift", width: 10 },
      { header: "Parameter", key: "paramName", width: 24 }, { header: "Value", key: "value", width: 14 },
      { header: "Unit", key: "unit", width: 8 }, { header: "Set Point", key: "target", width: 12 },
      { header: "LSL", key: "lsl", width: 10 }, { header: "USL", key: "usl", width: 10 },
      { header: "UCL", key: "ucl", width: 10 }, { header: "LCL", key: "lcl", width: 10 },
      { header: "Deviation", key: "delta", width: 12 },
      { header: "Spec Status", key: "specStatus", width: 14 }, { header: "Control", key: "control", width: 16 },
      { header: "Run Rules", key: "rules", width: 14 }, { header: "Quality", key: "quality", width: 12 },
      { header: "Timestamp", key: "timestamp", width: 22 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    const { ctl, hasCtl } = spc;
    filteredRows.forEach((r, idx) => {
      const row = ws.addRow({
        index: r.index, partId: r.partId, shot: r.shot, customerQr: r.customerQr,
        machine: r.machine, die: r.die, shift: r.shift, paramName: spec.label,
        value: r.value, unit: spec.unit, target: spec.setPoint ?? "-",
        lsl: spec.lsl ?? "-", usl: spec.usl ?? "-",
        ucl: hasCtl ? Number(ctl.ucl.toFixed(3)) : "-", lcl: hasCtl ? Number(ctl.lcl.toFixed(3)) : "-",
        delta: r.delta != null ? fmtSigned(r.delta, 3) : "-",
        specStatus: specStatusLabel(r.specStatus),
        control: !hasCtl ? "-" : r.ooc ? "Out of control" : "In control",
        rules: r.rules.length ? ruleLabel(r.rules) : "-", quality: QUALITY_LABEL[r.quality],
        timestamp: formatResultTimestamp(r.createdAt) || "-",
      });
      if (idx % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    });
    wb.xlsx.writeBuffer().then((buf) => saveAs(new Blob([buf]), `SPC_${spec.label.replace(/[^\w]+/g, "_")}_Readings.xlsx`));
  }, [filteredRows, spec, spc]);

  /* ═════════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════════ */
  const { cap, ctl, hasCtl } = spc;
  const n = spc.points.length;
  const hasData = orderedParts.length > 0;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const cpkRating = RATING[capRating(cap.cpk)];
  const capReason = !spec.hasLimits ? "Spec limits not set" : n < 2 ? "Too few readings" : "No variation";

  const filters = [
    { key: "all", label: `All ${n.toLocaleString()}` },
    ...(hasCtl ? [{ key: "ooc", label: `Out of control ${spc.oocCount}` }] : []),
    ...(spec.hasLimits ? [{ key: "oos", label: `Out of spec ${cap.oos ?? 0}` }] : []),
    { key: "ng", label: `NG ${spc.ng.n}` },
    ...(hasCtl ? [{ key: "rules", label: `Rule signals ${spc.ruleCount}` }] : []),
  ];

  return (
    <div className="tm-root">
      <style>{CARD_CSS}{`
        .tm-root { display: flex; flex-direction: column; gap: 16px; font-family: ${FONT_FAMILY}; min-width: 0; }
        .tm-root * { box-sizing: border-box; }
        .tm-clip { overflow: hidden; }
        .tm-head { align-items: center; border-bottom: 1px solid ${INK.grid}; }
        .tm-head-main { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 260px; }
        .tm-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

        /* Selector bar */
        .tm-selector { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; }
        .tm-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .tm-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 8px; font-size: 12px; font-weight: 600; border: 1px solid ${INK.border}; background: #fff; color: ${INK.body}; cursor: pointer; font-family: inherit; }
        .tm-pill:hover { border-color: ${INK.faint}; color: ${INK.primary}; }
        .tm-pill.active { background: ${INK.primary}; border-color: ${INK.primary}; color: #fff; }
        .tm-pill-count { font-weight: 500; opacity: .7; font-variant-numeric: tabular-nums; }
        .tm-selector-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .tm-label { font-size: 11px; font-weight: 600; color: ${INK.muted}; text-transform: uppercase; letter-spacing: .06em; }
        .tm-select { min-width: 0; max-width: 100%; flex: 1 1 220px; padding: 7px 10px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 13px; font-weight: 600; font-family: inherit; color: ${INK.primary}; background: #fff; }
        .tm-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; font-size: 12px; font-weight: 600; color: ${INK.secondary}; cursor: pointer; font-family: inherit; white-space: nowrap; }
        .tm-btn:hover:not(:disabled) { border-color: ${INK.faint}; color: ${INK.primary}; }
        .tm-btn:disabled { opacity: .4; cursor: not-allowed; }

        /* Capability summary */
        .tm-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; padding: 12px 16px; border-bottom: 1px solid ${INK.grid}; }
        .tm-stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 7px 10px; border-radius: 9px; background: ${INK.surfaceAlt}; border: 1px solid ${INK.border}; }
        .tm-stat-label { font-size: 10.5px; font-weight: 600; color: ${INK.muted}; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tm-stat-value { font-size: 15px; font-weight: 700; color: ${INK.primary}; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; line-height: 1.25; }
        .tm-chart { padding: 8px 10px 6px; }
        .tm-empty { min-height: 200px; display: grid; place-content: center; color: ${INK.muted}; font-size: 12.5px; text-align: center; padding: 20px; }

        /* Loading */
        .tm-wait { padding: 18px; display: flex; flex-direction: column; gap: 14px; }
        .tm-wait-text { display: flex; align-items: center; gap: 12px; }
        .tm-wait-title { font-size: 14px; font-weight: 700; color: ${INK.primary}; }
        .tm-wait-sub { font-size: 12px; color: ${INK.muted}; margin-top: 2px; }
        .tm-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid ${INK.border}; border-top-color: ${ACCENT.process}; animation: tm-spin .8s linear infinite; flex-shrink: 0; }
        .tm-skel { border-radius: 10px; background: linear-gradient(90deg, ${INK.grid} 25%, ${INK.surfaceAlt} 50%, ${INK.grid} 75%); background-size: 200% 100%; animation: tm-shimmer 1.4s ease-in-out infinite; }
        @keyframes tm-spin { to { transform: rotate(360deg); } }
        @keyframes tm-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        /* Tables */
        .tm-scroll { overflow-x: auto; max-width: 100%; }
        .tm-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .tm-table thead th { position: sticky; top: 0; z-index: 1; background: ${INK.surfaceAlt}; padding: 8px 10px; text-align: left; font-size: 10.5px; font-weight: 600; color: ${INK.muted}; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; border-bottom: 1px solid ${INK.border}; }
        .tm-table tbody td { padding: 7px 10px; border-bottom: 1px solid ${INK.grid}; vertical-align: middle; color: #1e293b; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .tm-table .num { text-align: right; }
        .tm-table tbody tr.sel { background: ${withAlpha(ACCENT.process, 0.08)}; }
        .tm-table tbody tr.click { cursor: pointer; }
        .tm-table tbody tr.click:hover { background: ${withAlpha(ACCENT.process, 0.05)}; }
        .tm-mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; }
        .tm-overview { max-height: 380px; overflow: auto; }
        .tm-seg { display: inline-flex; gap: 3px; padding: 3px; background: ${INK.grid}; border-radius: 9px; flex-wrap: wrap; }
        .tm-seg-btn { padding: 4px 10px; border: none; border-radius: 7px; background: transparent; cursor: pointer; font-size: 11.5px; font-weight: 600; color: ${INK.muted}; font-family: inherit; white-space: nowrap; }
        .tm-seg-btn.active { background: #fff; color: ${INK.primary}; box-shadow: 0 1px 2px rgba(15,23,42,.08); }
        .tm-search { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; flex: 1 1 200px; min-width: 0; max-width: 300px; }
        .tm-search input { border: none; outline: none; flex: 1; font-size: 12px; font-family: inherit; background: transparent; color: ${INK.secondary}; min-width: 0; }
        .tm-pagination { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-top: 1px solid ${INK.grid}; flex-wrap: wrap; gap: 10px; font-size: 12px; color: ${INK.muted}; }
        .tm-page-btn { width: 28px; height: 28px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; display: grid; place-items: center; color: ${INK.body}; font-family: inherit; }
        .tm-page-btn:disabled { opacity: .35; cursor: not-allowed; }
        .tm-page-select { padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 12px; font-family: inherit; background: #fff; color: ${INK.secondary}; }
        @media (max-width: 640px) {
          .tm-selector, .tm-stats { padding: 10px 12px; }
          .tm-chart { padding: 6px 4px 4px; }
          .tm-search { max-width: none; }
        }
      `}</style>

      {/* ═══ PARAMETER SELECTOR ═══ */}
      <div className="ra-card">
        <div className="tm-selector">
          <div className="tm-pills" role="tablist" aria-label="Parameter group">
            {ALL_TELEMETRY_CATEGORIES.map((cat) => (
              <button key={cat.id} type="button" role="tab" aria-selected={categoryId === cat.id}
                className={`tm-pill ${categoryId === cat.id ? "active" : ""}`} onClick={() => selectCategory(cat)}>
                {cat.shortLabel || cat.label}
                <span className="tm-pill-count">{cat.params?.length ?? cat.count}</span>
              </button>
            ))}
          </div>
          <div className="tm-selector-row">
            <label className="tm-label" htmlFor="tm-param-select">Parameter</label>
            <select id="tm-param-select" className="tm-select" value={paramKey} onChange={(e) => selectParam(e.target.value)}>
              {!activeParams.some((p) => p.key === paramKey) && <option value={paramKey}>{spec.label}</option>}
              {activeParams.map((p) => (
                <option key={p.key} value={p.key}>{p.label}{cleanUnit(p.unit) ? ` (${cleanUnit(p.unit)})` : ""}</option>
              ))}
            </select>
            {!spec.hasLimits && typeof onOpenRecipeModal === "function" && (
              <button type="button" className="tm-btn" onClick={onOpenRecipeModal}><Sliders size={13} /> Set limits</button>
            )}
            <button type="button" className="tm-btn" onClick={exportSummary} disabled={!hasData}>
              <Download size={13} /> Summary
            </button>
          </div>
        </div>
      </div>

      {!hasData ? <WaitingState loading={loading} /> : (
        <>
          {/* ═══ CONTROL CHART + CAPABILITY ═══ */}
          <div className="ra-card tm-clip" data-accent style={accent(ACCENT.process)}>
            <CardHead
              icon={<Activity size={16} />}
              title={`Individuals control chart · ${spec.label}${spec.unit ? ` (${spec.unit})` : ""}`}
              sub={`Last ${n.toLocaleString()} parts · limits = mean ± 3σ (moving range)`}
            >
              {cpkRating
                ? <span className="ra-chip" style={accent(cpkRating.color)}>Cpk {cap.cpk.toFixed(2)} · {cpkRating.label}</span>
                : <span className="ra-chip" style={accent(INK.faint)}>{capReason}</span>}
            </CardHead>

            {n > 0 && (
              <div className="tm-stats">
                <Stat label="Readings" value={n.toLocaleString()} />
                <Stat label="Mean" value={`${fmtKpi(cap.mean)}${u}`} />
                <Stat label="σ within" value={fmtSmall(cap.sigmaWithin)} hint="Moving range σ = MR̄ / 1.128" />
                <Stat label="UCL / LCL" value={hasCtl ? `${fmtKpi(ctl.ucl)} / ${fmtKpi(ctl.lcl)}` : "—"} />
                <Stat label="LSL / USL" value={spec.hasLimits ? `${spec.lsl} / ${spec.usl}` : "Not set"} color={spec.hasLimits ? undefined : INK.faint} />
                <Stat label="Cp" value={isNum(cap.cp) ? cap.cp.toFixed(2) : "—"} color={isNum(cap.cp) ? ratingColor(cap.cp) : INK.faint} />
                <Stat label="Cpk" value={isNum(cap.cpk) ? cap.cpk.toFixed(2) : "—"} color={isNum(cap.cpk) ? ratingColor(cap.cpk) : INK.faint} hint="≥ 1.33 capable · 1.00–1.33 marginal · < 1.00 not capable" />
                <Stat label="Ppk" value={isNum(cap.ppk) ? cap.ppk.toFixed(2) : "—"} color={isNum(cap.ppk) ? ratingColor(cap.ppk) : INK.faint} hint="Long-term, uses overall σ" />
                <Stat label="Out of control" value={hasCtl ? `${fmtVal(spc.oocPct, 1)}%` : "—"} color={spc.oocCount > 0 ? C_NG : undefined} hint={`${spc.oocCount} points beyond UCL / LCL`} />
                <Stat label="Out of spec" value={spec.hasLimits ? `${fmtVal(cap.oosPct, 1)}%` : "—"} color={(cap.oos ?? 0) > 0 ? C_NG : undefined} hint={spec.hasLimits ? `${cap.oos} parts beyond LSL / USL` : "Spec limits not set"} />
              </div>
            )}

            <div className="tm-chart">
              {controlOption
                ? <EChart option={controlOption} style={{ height: 380, minHeight: 300 }} />
                : <div className="tm-empty">No {spec.label} readings in this period. Pick another parameter above.</div>}
            </div>
          </div>

          {/* ═══ DISTRIBUTION + PARAMETER OVERVIEW ═══ */}
          <div className="ra-grid2">
            <div className="ra-card tm-clip" data-accent style={accent(ACCENT.process)}>
              <CardHead icon={<Sigma size={16} />} title="Distribution vs limits" sub="OK and NG parts stacked, with normal fit">
                {spc.ok.n > 0 && <span className="ra-chip" style={accent(C_OK)}>OK mean {fmtKpi(spc.ok.mean)}</span>}
                {spc.ng.n > 0 && <span className="ra-chip" style={accent(C_NG)}>NG mean {fmtKpi(spc.ng.mean)}</span>}
              </CardHead>
              <div className="tm-chart">
                {histOption
                  ? <EChart option={histOption} style={{ height: 320, minHeight: 280 }} />
                  : <div className="tm-empty">No readings to plot.</div>}
              </div>
            </div>

            <div className="ra-card tm-clip" data-accent style={accent(ACCENT.quality)}>
              <CardHead icon={<ListChecks size={16} />} color={ACCENT.quality} title="Parameter health" sub="Worst Cpk first · click a row to chart it" />
              <div className="tm-overview">
                <table className="tm-table">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th className="num">n</th>
                      <th className="num">Cpk</th>
                      <th className="num">Out of ctrl</th>
                      <th className="num">Out of spec</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewRows.map((r) => (
                      <tr key={r.key} className={`click ${r.key === paramKey ? "sel" : ""}`} onClick={() => selectParam(r.key)}
                        tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectParam(r.key); } }}>
                        <td style={{ whiteSpace: "normal", minWidth: 140, fontWeight: r.key === paramKey ? 700 : 500 }}>
                          {r.label}{r.unit && <span style={{ color: INK.muted, fontWeight: 400 }}> ({r.unit})</span>}
                        </td>
                        <td className="num" style={{ color: r.n ? undefined : INK.faint }}>{r.n ? r.n.toLocaleString() : "—"}</td>
                        <td className="num" style={{ fontWeight: 700, color: isNum(r.cpk) ? ratingColor(r.cpk) : INK.faint }}>
                          {isNum(r.cpk) ? r.cpk.toFixed(2) : r.n && !r.hasLimits ? "No limits" : "—"}
                        </td>
                        <td className="num" style={{ color: r.oocPct > 0 ? C_NG : r.oocPct == null ? INK.faint : undefined }}>
                          {r.oocPct == null ? "—" : `${fmtVal(r.oocPct, 1)}%`}
                        </td>
                        <td className="num" style={{ color: r.oosPct > 0 ? C_NG : r.oosPct == null ? INK.faint : undefined }}>
                          {r.oosPct == null ? "—" : `${fmtVal(r.oosPct, 1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ═══ PER-PART READINGS ═══ */}
          <div className="ra-card tm-clip" data-accent style={accent(ACCENT.neutral)}>
            <CardHead icon={<Layers size={16} />} color={ACCENT.neutral} title={`Part readings · ${spec.label}`} sub="Newest first">
              <div className="tm-seg">
                {filters.map((f) => (
                  <button key={f.key} type="button" onClick={() => { setTableFilter(f.key); setPage(1); }}
                    className={`tm-seg-btn ${tableFilter === f.key ? "active" : ""}`}>{f.label}</button>
                ))}
              </div>
              <div className="tm-search">
                <Search size={13} color={INK.faint} />
                <input type="text" placeholder="Serial, QR, shot, machine" value={search} aria-label="Search readings"
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              </div>
              <button type="button" onClick={exportReadings} disabled={!filteredRows.length} className="tm-btn">
                <Download size={13} /> Export
              </button>
            </CardHead>

            <div className="tm-scroll">
              <table className="tm-table" style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Part serial</th>
                    <th>Shot</th>
                    <th>Shift</th>
                    <th>Machine</th>
                    <th className="num">Value</th>
                    <th className="num">vs set</th>
                    <th>Control</th>
                    <th>Spec</th>
                    <th>Result</th>
                    <th>Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={11} style={{ padding: 28, textAlign: "center", color: INK.muted }}>No readings match this filter.</td></tr>
                  ) : pageRows.map((r) => (
                    <tr key={r.index}>
                      <td className="num" style={{ color: INK.faint }}>{r.index}</td>
                      <td><span className="tm-mono">{r.partId}</span></td>
                      <td>{r.shot}</td>
                      <td>{r.shift}</td>
                      <td>{r.machine}</td>
                      <td className="num" style={{ fontWeight: 700, color: r.ooc || r.oos ? C_NG : INK.primary }}>{fmtVal(r.value, 3)}{u}</td>
                      <td className="num" style={{ color: INK.body }}>{fmtSigned(r.delta, 3)}</td>
                      <td>
                        {!hasCtl ? <span style={{ color: INK.faint }}>—</span>
                          : r.ooc ? <span className="ra-chip" style={accent(C_NG)}>Out of control</span>
                            : r.rules.length ? <span className="ra-chip" style={accent(ACCENT.warning)} title={r.rules.map((id) => RUN_RULES.find((x) => x.id === id)?.label).join("; ")}>{ruleLabel(r.rules)}</span>
                              : <span style={{ color: INK.muted }}>In control</span>}
                      </td>
                      <td>
                        {r.specStatus === "NO_LIMITS" ? <span style={{ color: INK.faint }}>—</span>
                          : r.oos ? <span className="ra-chip" style={accent(C_NG)}>{specStatusLabel(r.specStatus)}</span>
                            : <span style={{ color: INK.muted }}>In spec</span>}
                      </td>
                      <td><span className="ra-chip" style={accent(QUALITY_COLOR[r.quality])}>{QUALITY_LABEL[r.quality]}</span></td>
                      <td style={{ color: INK.muted }}>{formatResultTimestamp(r.createdAt) || fmtTime(r.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredRows.length > 0 && (
              <div className="tm-pagination">
                <div>
                  {((safePage - 1) * pageSize + 1).toLocaleString()}–{Math.min(safePage * pageSize, filteredRows.length).toLocaleString()} of {filteredRows.length.toLocaleString()}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    Rows
                    <select className="tm-page-select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button type="button" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))} className="tm-page-btn" aria-label="Previous page">‹</button>
                    <span style={{ padding: "0 8px", color: INK.primary, fontVariantNumeric: "tabular-nums" }}>{safePage} / {pageCount}</span>
                    <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))} className="tm-page-btn" aria-label="Next page">›</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <FacetedBoxPlot rows={rows} allRejectionRecords={allRejectionRecords} />
        </>
      )}
    </div>
  );
}
