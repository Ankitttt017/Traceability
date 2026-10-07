import React, { useEffect, useMemo, useState } from "react";
import {
  Zap, Download, Search, Target, Activity, Gauge, ShieldAlert, Layers, BrainCircuit,
  BarChart3, ScatterChart as ScatterIcon, TrendingUp, Sliders, Waves, Cpu, Percent,
} from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import EChart from "../../components/charts/EChart";
import RejectionTable from "./RejectionTable";
import FacetedBoxPlot from "./FacetedBoxPlot";
import {
  formatResultTimestamp, extractShotFromPartId, ALL_45_PARAMETERS, parseRowDefect,
} from "./rejectionConstants";
import {
  OUTCOME, CATEGORICAL, OTHER, DIVERGING, DEFECT_CATEGORY, STATUS, INK, FONT_FAMILY,
  ECHART_TOOLTIP, LEGEND, SEQ_SCRAP, ACCENT, baseOption, valueAxis, categoryAxis, axisName, axisLabel, tooltipHtml,
} from "./chartTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */
const NG_STATUS = new Set(["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"]);
const OK_STATUS = new Set(["OK", "PASSED", "ENDED_OK", "COMPLETED_OK"]);
const MIN_PER_CLASS = 2;          // OK and NG readings needed to rank a parameter
const MIN_MODEL_PER_CLASS = 5;    // complete or imputed OK and NG samples needed to fit the model
const CPK_TARGET = 1.33;          // common automotive minimum for capable processes
const C = { ok: OUTCOME.ok, ng: OUTCOME.ng, model: CATEGORICAL[6], grid: INK.grid, amber: STATUS.warning, green: STATUS.good };
const FONT = { fontFamily: "Inter, system-ui, -apple-system, sans-serif" };
const DATE_FIELDS = ["ngRecordedAt", "createdAtRaw", "createdAt", "shot_datetime", "shotDatetime", "timestamp", "created_at"];

/* ═══════════════════════════════════════════════════════════════════════════
   STATS / ML HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */
// PlcCycleReadings value for a parameter, trying its column aliases; null when not recorded
const readParam = (r, p) => {
  for (const k of [p.key, ...(p.altKeys || [])]) {
    const raw = r?.[k];
    if (raw === null || raw === undefined || raw === "" || raw === "-") continue;
    const v = Number(raw);
    if (Number.isFinite(v)) return v;
  }
  return null;
};

const hashStr = (s) => { let h = 0; const t = String(s); for (let i = 0; i < t.length; i++) { h = (h << 5) - h + t.charCodeAt(i); h |= 0; } return Math.abs(h); };
const jitter = (id, base, width) => base + ((hashStr(id) % 1000) / 1000 - 0.5) * width;
const sampleEvenly = (a, max) => (a.length <= max ? a : a.filter((_, i) => i % Math.ceil(a.length / max) === 0));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const quantile = (sorted, q) => { if (!sorted.length) return 0; const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo); };
const r2 = (v) => Number(Number(v).toFixed(2));
const r3 = (v) => Number(Number(v).toFixed(3));
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;

// ROC AUC = P(score_pos > score_neg) via Mann–Whitney with tie-averaged ranks
const aucScore = (neg, pos) => {
  if (!neg.length || !pos.length) return NaN;
  const all = [...neg.map((v) => [v, 0]), ...pos.map((v) => [v, 1])].sort((a, b) => a[0] - b[0]);
  let rs = 0, i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k][1]) rs += avg;
    i = j + 1;
  }
  const n1 = pos.length, n0 = neg.length;
  return (rs - (n1 * (n1 + 1)) / 2) / (n1 * n0);
};

const downsample = (pts, max) => {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * step)]);
};

const rocCurve = (pos, neg) => {
  if (!pos.length || !neg.length) return [[0, 0], [1, 1]];
  const all = [...pos.map((s) => [s, 1]), ...neg.map((s) => [s, 0])].sort((a, b) => b[0] - a[0]);
  const P = pos.length, N = neg.length;
  let tp = 0, fp = 0;
  const pts = [[0, 0]];
  for (let i = 0; i < all.length; i++) {
    if (all[i][1]) tp++; else fp++;
    if (i === all.length - 1 || all[i + 1][0] !== all[i][0]) pts.push([fp / N, tp / P]);
  }
  return downsample(pts, 150).map(([x, y]) => [r3(x), r3(y)]);
};

const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 5) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
};

// Gaussian KDE (Silverman bandwidth), density normalised per class
const kde = (vals, grid) => {
  const n = vals.length;
  const sd = std(vals);
  if (n < 3 || !(sd > 0)) return grid.map(() => 0);
  const h = 1.06 * sd * Math.pow(n, -0.2);
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  return grid.map((g) => { let s = 0; for (let i = 0; i < n; i++) { const u = (g - vals[i]) / h; s += Math.exp(-0.5 * u * u); } return s * norm; });
};

// Gauss–Jordan inverse (small matrices: covariance of the model coefficients)
const invertMatrix = (M) => {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    for (let k = 0; k < 2 * n; k++) A[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f) for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row) => row.slice(n));
};
// Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7)
const normCdf = (x) => {
  const u = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * u);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-u * u);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
};
// Hanley–McNeil standard error of an AUC
const aucSE = (A, nPos, nNeg) => {
  if (!(nPos > 0 && nNeg > 0) || !Number.isFinite(A)) return NaN;
  const q1 = A / (2 - A), q2 = (2 * A * A) / (1 + A);
  return Math.sqrt(Math.max(0, (A * (1 - A) + (nPos - 1) * (q1 - A * A) + (nNeg - 1) * (q2 - A * A)) / (nPos * nNeg)));
};
const rgba = (hex, a) => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};
const STATION_NAME = { OP100: "DCM + DPM", OP110: "Laser marking", OP120: "Casting PDi", OP130: "Pre-inspection", OP140: "Auto gauging", OP150: "Leak test", OP160: "Final inspection" };
// OK-green and NG-red are reserved for outcome, so stations use the remaining slots (labels give secondary encoding)
const STATION_COLOR = { OP120: CATEGORICAL[0], OP130: CATEGORICAL[1], OP150: CATEGORICAL[6], OP160: CATEGORICAL[3], OP140: CATEGORICAL[4] };
const stationColor = (st) => STATION_COLOR[st] || OTHER;

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
// Class-weighted, L2-regularised logistic regression (batch gradient descent)
// balanced=false fits the plain likelihood; sw = per-sample weights (e.g. to restore the plant's OK/NG mix)
const trainLogReg = (X, y, { epochs = 300, lr = 0.3, l2 = 0.01, balanced = true, sw = null } = {}) => {
  const n = X.length, d = X[0].length;
  const pos = Math.max(1, y.reduce((s, v) => s + v, 0));
  const negCount = Math.max(1, n - pos);
  const wPos = balanced ? n / (2 * pos) : 1, wNeg = balanced ? n / (2 * negCount) : 1;
  const w = new Array(d).fill(0);
  let b;
  if (sw) {
    const wp = y.reduce((s, v, i) => s + (v ? sw[i] : 0), 0), wt = sw.reduce((s, v) => s + v, 0);
    b = Math.log(Math.max(1e-6, wp) / Math.max(1e-6, wt - wp));
  } else b = balanced ? 0 : Math.log(pos / negCount);
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const err = (sigmoid(z) - y[i]) * (sw ? sw[i] : y[i] ? wPos : wNeg);
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= (lr * gb) / n;
  }
  return { w, b };
};

const getDay = (r) => {
  for (const k of DATE_FIELDS) {
    const v = r[k];
    if (!v) continue;
    const d = new Date(v);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
};

/* ═══════════════════════════════════════════════════════════════════════════
   UI PIECES
   ═══════════════════════════════════════════════════════════════════════════ */
const Card = ({ icon: Icon, color = "#6366f1", title, subtitle, right, note, height, children, badge }) => (
  <div className="dl-card" style={{ borderTop: `3px solid ${color}`, "--accent": color }}>
    <div className="dl-section-header">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="dl-section-icon" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 4px 14px ${color}40` }}>
          {Icon && <Icon size={19} />}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 className="dl-section-title">{title}</h3>
            {badge && <span className="dl-badge" style={{ background: `${color}18`, color, border: `1px solid ${color}35`, fontSize: 10.5, fontWeight: 700 }}>{badge}</span>}
          </div>
          {subtitle && <p className="dl-section-subtitle">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
    <div style={height ? { height, padding: "8px 14px" } : undefined}>{children}</div>
    {note && <div className="dl-note">{note}</div>}
  </div>
);

const Stat = ({ icon: Icon, label, value, sub, color }) => (
  <div className="dl-stat-card" style={{ background: `linear-gradient(135deg, ${color}12, ${color}04)`, borderColor: `${color}35`, borderTop: `3px solid ${color}` }}>
    <div className="dl-stat-icon" style={{ background: `linear-gradient(135deg, ${color}25, ${color}15)`, color, boxShadow: `0 4px 14px ${color}25`, border: `1px solid ${color}30` }}><Icon size={20} /></div>
    <div style={{ minWidth: 0 }}>
      <div className="dl-stat-label">{label}</div>
      <div className="dl-stat-value" style={{ color }}>{value}</div>
      {sub && <div className="dl-stat-subtext">{sub}</div>}
    </div>
  </div>
);

const Empty = ({ children }) => <div className="dl-empty">{children}</div>;

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════════ */
export default function RootCauseTab({
  mlInsights = { features: [], topAnomalies: [] },
  rows = [],
  recordsRows = [],
  allRejectionRecords = [],
  rejectedRows = [],
  okRecords = [],
  summary = {},
  loading = false,
}) {
  const [tab, setTab] = useState("causes");
  const [param, setParam] = useState("");
  const [scatterX, setScatterX] = useState("furnace_metal_temp");
  const [scatterY, setScatterY] = useState("biscuit_thickness");
  const [pdKey, setPdKey] = useState("");
  const [outlierSearch, setOutlierSearch] = useState("");
  const [infView, setInfView] = useState("swarm");

  /* ── 1. Labelled sample pool ──────────────────────────────────────────── */
  const pool = useMemo(() => {
    const idOf = (r) => String(r.partId || r.part_id || r.customerQrCode || r.customer_qr || r.id || "");
    const ngIds = new Set();
    [allRejectionRecords, rejectedRows].forEach((l) => (l || []).forEach((r) => { const id = idOf(r); if (id) ngIds.add(id); }));
    const seen = new Set();
    const out = [];
    [allRejectionRecords, rejectedRows, okRecords, rows, recordsRows].forEach((list) => (list || []).forEach((r) => {
      const id = idOf(r);
      if (id) { if (seen.has(id)) return; seen.add(id); }
      const st = String(r.status || r.overall_status || "").trim().toUpperCase();
      const ng = (id && ngIds.has(id)) || NG_STATUS.has(st) || (r.ngGate && r.ngGate !== "-");
      if (!ng && !OK_STATUS.has(st)) return; // unknown outcome → excluded
      out.push({ r, id: id || `row-${out.length}`, ng: !!ng });
    }));
    return out;
  }, [rows, recordsRows, allRejectionRecords, rejectedRows, okRecords]);

  const counts = useMemo(() => {
    const ng = pool.filter((p) => p.ng).length;
    return { total: pool.length, ng, ok: pool.length - ng, rate: pool.length ? ng / pool.length : 0 };
  }, [pool]);

  // The sample holds every NG part but only a slice of OK parts, so its NG share is far above the plant's.
  // Each class is re-weighted to the plant mix from the summary (NG / (OK + NG)) so rates are plant-accurate.
  const popRate = useMemo(() => {
    const ng = Number(summary?.totalNG), ok = Number(summary?.totalOK);
    return ng > 0 && ok > 0 ? ng / (ng + ok) : null;
  }, [summary]);
  const classW = useMemo(() => {
    if (!popRate || !counts.ng || !counts.ok) return { ng: 1, ok: 1, calibrated: false };
    return { ng: popRate / (counts.ng / counts.total), ok: (1 - popRate) / (counts.ok / counts.total), calibrated: true };
  }, [popRate, counts]);

  /* ── 2. Per-parameter statistics (readings ≤ 0 treated as "no reading") ─ */
  const { stats, maps } = useMemo(() => {
    const list = [], mapsOut = {};
    ALL_45_PARAMETERS.forEach((p) => {
      const ok = [], ng = [], m = new Map();
      pool.forEach(({ r, id, ng: isNg }) => {
        const v = readParam(r, p);
        if (v === null || v <= 0) return;
        m.set(id, v);
        (isNg ? ng : ok).push({ v, id });
      });
      if (ok.length < MIN_PER_CLASS || ng.length < MIN_PER_CLASS) return;
      const okVals = ok.map((x) => x.v), ngVals = ng.map((x) => x.v);
      const okStd = std(okVals);
      if (!(okStd > 0)) return;
      const auc = aucScore(sampleEvenly(okVals, 4000), sampleEvenly(ngVals, 4000));
      list.push({
        key: p.key, def: p, label: p.label, unit: p.unit || "", ok, ng,
        okMean: mean(okVals), okStd, ngMean: mean(ngVals), allMean: mean([...okVals, ...ngVals]),
        shift: (mean(ngVals) - mean(okVals)) / okStd,
        auc, dir: auc >= 0.5 ? 1 : -1, sep: Math.max(auc, 1 - auc),
      });
      mapsOut[p.key] = m;
    });
    list.sort((a, b) => b.sep - a.sep);
    return { stats: list, maps: mapsOut };
  }, [pool]);

  const top = useMemo(() => stats.slice(0, 12), [stats]);

  // Default the parameter pickers to the strongest driver once data arrives
  useEffect(() => {
    if (!param && top.length) setParam(top[0].key);
  }, [top, param]);

  /* ── 3. Multivariate model + all derived ML diagnostics ───────────────── */
  const model = useMemo(() => {
    if (!stats.length || pool.length < 6) return null;
    const ngById = new Map(pool.map((p) => [p.id, p.ng]));
    const totalNg = pool.filter(p => p.ng).length;
    const totalOk = pool.length - totalNg;
    if (totalNg < 2 || totalOk < 2) return null;

    // Try fitting across different feature counts (8, 6, 4, 3, 2)
    for (const K of [8, 6, 4, 3, 2]) {
      const feats = stats.slice(0, K);
      if (feats.length < 2) break;

      // Missing readings are imputed with the pooled mean. (Imputing with the OK/NG class mean
      // would leak the outcome into the features and inflate every metric below.)
      const samples = [];
      pool.forEach(({ id, ng: isNg }) => {
        const x = [];
        let validCount = 0;
        for (const f of feats) {
          const val = maps[f.key]?.get(id);
          if (val !== undefined) {
            x.push(val);
            validCount++;
          } else {
            x.push(f.allMean);
          }
        }
        if (validCount > 0) {
          samples.push({ id, x, y: isNg ? 1 : 0 });
        }
      });

      const nNg = samples.filter((s) => s.y).length;
      const nOk = samples.length - nNg;
      if (nNg < 2 || nOk < 2) continue;

      const train = [], test = [];
      samples.forEach((s) => (hashStr(s.id) % 10 < 7 ? train : test).push(s));
      if (train.length < 3 || test.length < 2) {
        // Use full set for both if small
        train.push(...samples);
        test.push(...samples);
      }

      const trS = sampleEvenly(train, 20000);
      const trNg = trS.filter((s) => s.y).length;
      const teNg = test.filter((s) => s.y).length;
      if (trNg < 1 || teNg < 1) continue;

      const mu = feats.map((_, j) => mean(trS.map((s) => s.x[j])));
      const sd = feats.map((_, j) => std(trS.map((s) => s.x[j])) || 1);
      const norm = (x) => x.map((v, j) => (v - mu[j]) / sd[j]);
      const { w, b } = trainLogReg(trS.map((s) => norm(s.x)), trS.map((s) => s.y));

      const probs = test.map((s) => sigmoid(b + norm(s.x).reduce((z, v, j) => z + v * w[j], 0)));
      const posP = probs.filter((_, i) => test[i].y);
      const negP = probs.filter((_, i) => !test[i].y);
      const P = posP.length, N = negP.length;

      const metricsAt = (t) => {
        const tp = posP.filter((p) => p >= t).length, fp = negP.filter((p) => p >= t).length;
        const fn = P - tp, tn = N - fp;
        const precision = tp + fp ? tp / (tp + fp) : 0, recall = P ? tp / P : 0, spec = N ? tn / N : 0;
        return { tp, fp, fn, tn, precision, recall, spec, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
      };
      const m50 = metricsAt(0.5);
      // Precision at the plant's OK/NG mix (the test split is NG-heavy, which inflates raw precision)
      const plantPrec = (m) => (m.tp * classW.ng + m.fp * classW.ok > 0 ? (m.tp * classW.ng) / (m.tp * classW.ng + m.fp * classW.ok) : 0);

      // Threshold sweep
      const sweep = [];
      for (let t = 0.05; t <= 0.951; t += 0.025) sweep.push({ t: r3(t), ...metricsAt(t) });
      const best = sweep.reduce((a, c) => (c.f1 > a.f1 ? c : a), sweep[0]);

      // Sorted pass for PR + cumulative gain
      const order = probs.map((p, i) => [p, test[i].y]).sort((a, c) => c[0] - a[0]);
      let tp = 0, fpN = 0, ap = 0, apPlant = 0;
      const prPts = [], prPlantPts = [], gainPts = [[0, 0]];
      order.forEach(([, y], i) => {
        if (y) tp++; else fpN++;
        const prec = tp / (i + 1);
        const precPlant = tp * classW.ng + fpN * classW.ok > 0 ? (tp * classW.ng) / (tp * classW.ng + fpN * classW.ok) : 0;
        if (y && P) { ap += prec / P; apPlant += precPlant / P; }
        prPts.push([r3(P ? tp / P : 0), r3(prec)]);
        prPlantPts.push([r3(P ? tp / P : 0), r3(precPlant)]);
        gainPts.push([r3((i + 1) / order.length), r3(P ? tp / P : 0)]);
      });
      const k10 = Math.max(1, Math.round(order.length * 0.1));
      const lift10 = P ? (order.slice(0, k10).filter((o) => o[1]).length / P / 0.1) : 1;

      // Score histogram (% of each class)
      // Top single parameter scored on the SAME hold-out parts, so the comparison with the model is fair
      const aucModel = aucScore(negP, posP);
      const top1 = stats[0];
      let single = null;
      if (top1) {
        const sp = [], sn = [];
        test.forEach((sm) => { const v = maps[top1.key]?.get(sm.id); if (v !== undefined) (sm.y ? sp : sn).push(top1.dir * v); });
        if (sp.length >= 3 && sn.length >= 3) {
          const a = aucScore(sn, sp);
          single = { label: top1.label, auc: a, se: aucSE(a, sp.length, sn.length), roc: rocCurve(sp, sn), nPos: sp.length, nNeg: sn.length };
        }
      }

      const bins = 20;
      const hOk = new Array(bins).fill(0), hNg = new Array(bins).fill(0);
      negP.forEach((p) => { hOk[Math.min(bins - 1, Math.floor(p * bins))]++; });
      posP.forEach((p) => { hNg[Math.min(bins - 1, Math.floor(p * bins))]++; });

      return {
        feats: feats.map((f, j) => {
          const sorted = trS.map((s) => s.x[j]).sort((a, c) => a - c);
          return { key: f.key, label: f.label, unit: f.unit, coef: w[j], mu: mu[j], sd: sd[j], p5: quantile(sorted, 0.05), p95: quantile(sorted, 0.95), okMean: f.okMean, ngMean: f.ngMean };
        }),
        b, auc: aucModel, aucSe: aucSE(aucModel, P, N), roc: rocCurve(posP, negP), single,
        pr: { pts: downsample(prPts, 150), ap, plantPts: downsample(prPlantPts, 150), apPlant }, prevalence: test.length ? P / test.length : 0,
        opPoints: [
          { name: "Default threshold 0.50", short: "t = 0.50", t: 0.5, ...m50, plantPrecision: plantPrec(m50) },
          ...(Math.abs(best.t - 0.5) > 1e-6 ? [{ name: `Best F1 threshold ${best.t}`, short: `best F1 t = ${best.t}`, ...best, plantPrecision: plantPrec(best) }] : []),
        ],
        gain: { pts: downsample(gainPts, 120), lift10 },
        sweep, best, m50,
        hist: { ok: hOk.map((c) => r2(N ? (c / N) * 100 : 0)), ng: hNg.map((c) => r2(P ? (c / P) * 100 : 0)), bins },
        bacc: (m50.recall + m50.spec) / 2,
        nTrain: trS.length, nTest: test.length, nTestNg: teNg,
      };
    }
    return null;
  }, [stats, maps, pool, classW]);

  const activePd = model ? model.feats.find((f) => f.key === pdKey) || model.feats[0] : null;

  /* ── 3b. Process-parameter influence on scrap (all PlcCycleReadings parameters) ──
     One logistic model on every parameter with enough coverage, weighted to the plant's OK/NG mix.
     • explained  = Nagelkerke R² on a 30% hold-out (in-sample when the hold-out is too small)
     • per-parameter share = log-likelihood lost when that parameter is held at its mean, scaled so the
       shares add up to the explained total. The coefficient sign gives the direction. */
  const influence = useMemo(() => {
    if (counts.ng < 5 || counts.ok < 5) return null;
    const feats = stats.filter((st) => st.ok.length >= 5 && st.ng.length >= 5 && st.ok.length + st.ng.length >= 0.3 * pool.length);
    if (feats.length < 2) return null;
    const rowsAll = sampleEvenly(pool, 4000);
    const sd = feats.map((ft) => std([...ft.ok, ...ft.ng].map((x) => x.v)) || 1);
    const X = rowsAll.map(({ id }) => feats.map((ft, j) => {
      const v = maps[ft.key]?.get(id);
      return v === undefined ? 0 : (v - ft.allMean) / sd[j];
    }));
    const y = rowsAll.map((p) => (p.ng ? 1 : 0));
    const sw = y.map((v) => (v ? classW.ng : classW.ok));
    const wsum = (idx) => idx.reduce((a, i) => a + sw[i], 0);
    const prevOf = (idx) => idx.reduce((a, i) => a + (y[i] ? sw[i] : 0), 0) / (wsum(idx) || 1);
    const logLik = (w, b, idx) => idx.reduce((a, i) => {
      let z = b;
      for (let j = 0; j < w.length; j++) z += w[j] * X[i][j];
      const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(z)));
      return a + sw[i] * (y[i] ? Math.log(p) : Math.log(1 - p));
    }, 0);
    const nullLogLik = (idx, prev) => idx.reduce((a, i) => a + sw[i] * (y[i] ? Math.log(prev) : Math.log(1 - prev)), 0);
    const nagelkerke = (ll1, ll0, n) => {
      const cs = 1 - Math.exp((2 / n) * (ll0 - ll1));
      const max = 1 - Math.exp((2 / n) * ll0);
      return max > 0 ? Math.min(1, Math.max(0, cs / max)) : 0;
    };
    const fit = (idx) => trainLogReg(idx.map((i) => X[i]), idx.map((i) => y[i]), { epochs: 300, lr: 0.3, l2: 0.02, balanced: false, sw: idx.map((i) => sw[i]) });

    const all = rowsAll.map((_, i) => i);
    const tr = [], te = [];
    all.forEach((i) => (hashStr(rowsAll[i].id) % 10 < 7 ? tr : te).push(i));
    const trNg = tr.filter((i) => y[i]).length, teNg = te.filter((i) => y[i]).length;
    let r2Holdout = null;
    if (te.length >= 30 && teNg >= 5 && trNg >= 5 && tr.length - trNg >= 5) {
      const m = fit(tr);
      r2Holdout = nagelkerke(logLik(m.w, m.b, te), nullLogLik(te, prevOf(tr)), wsum(te));
    }

    const full = fit(all);
    const llFull = logLik(full.w, full.b, all);
    const r2In = nagelkerke(llFull, nullLogLik(all, prevOf(all)), wsum(all));
    const explained = r2Holdout ?? r2In;
    const contrib = feats.map((_, j) => {
      const w2 = full.w.slice();
      w2[j] = 0;
      return Math.max(0, llFull - logLik(w2, full.b, all));
    });
    const totC = contrib.reduce((a, c) => a + c, 0) || 1;
    // Approximate 95% confidence intervals from the observed information matrix (weighted Hessian + ridge term)
    const dim = feats.length + 1;
    const H = Array.from({ length: dim }, () => new Array(dim).fill(0));
    all.forEach((i) => {
      let z = full.b;
      for (let j = 0; j < feats.length; j++) z += full.w[j] * X[i][j];
      const p = sigmoid(z), v = sw[i] * p * (1 - p);
      const xi = [1, ...X[i]];
      for (let a = 0; a < dim; a++) {
        if (!xi[a]) continue;
        for (let c = a; c < dim; c++) H[a][c] += v * xi[a] * xi[c];
      }
    });
    for (let a = 0; a < dim; a++) {
      for (let c = 0; c < a; c++) H[a][c] = H[c][a];
      if (a > 0) H[a][a] += 0.02 * all.length;
    }
    const cov = invertMatrix(H);
    const base = sigmoid(full.b); // every parameter at its average

    // Sensitivity: predicted scrap rate with one parameter at the low (P10) vs high (P90) end of the
    // good-part range, all others at their average — the classic tornado swing.
    const items = feats.map((ft, j) => {
      const okSorted = ft.ok.map((x) => x.v).sort((a, b) => a - b);
      const lo = quantile(okSorted, 0.1), hi = quantile(okSorted, 0.9);
      const zLo = (lo - ft.allMean) / sd[j], zHi = (hi - ft.allMean) / sd[j];
      const w = full.w[j];
      const se = cov && cov[j + 1][j + 1] > 0 ? Math.sqrt(cov[j + 1][j + 1]) : NaN;
      const zStat = Number.isFinite(se) && se > 0 ? w / se : NaN;
      const pval = Number.isFinite(zStat) ? 2 * (1 - normCdf(Math.abs(zStat))) : NaN;
      const at = (coef, zz) => sigmoid(full.b + coef * zz);
      const wLo = Number.isFinite(se) ? w - 1.96 * se : w, wHi = Number.isFinite(se) ? w + 1.96 * se : w;
      const span = (zz) => { const a = at(wLo, zz), b2 = at(wHi, zz); return [Math.min(a, b2), Math.max(a, b2)]; };
      return {
        key: ft.key, label: ft.label, unit: ft.unit, coef: w, se, pval, sig: Number.isFinite(pval) ? pval < 0.05 : null,
        dir: w >= 0 ? 1 : -1, pct: (contrib[j] / totC) * explained * 100,
        lo, hi, pLo: at(w, zLo), pHi: at(w, zHi), pLoCI: span(zLo), pHiCI: span(zHi),
        orCI: Number.isFinite(se) ? [Math.exp(wLo), Math.exp(wHi)] : null,
        okMean: ft.okMean, ngMean: ft.ngMean, n: ft.ok.length + ft.ng.length,
      };
    }).sort((a, b) => Math.abs(b.pHi - b.pLo) - Math.abs(a.pHi - a.pLo));
    // "What drives scrap" swarm: for a logistic model the contribution of parameter j to part i, in log-odds,
    // is exactly w_j × z_ij (the linear-SHAP value). Missing readings are skipped, not imputed.
    const byKey = Object.fromEntries(items.map((it) => [it.key, it]));
    const shapRows = feats.map((ft, j) => {
      const m = maps[ft.key];
      const vals = [];
      rowsAll.forEach(({ id }, i) => { const v = m?.get(id); if (v !== undefined) vals.push({ id, v, s: full.w[j] * X[i][j] }); });
      const vs = vals.map((d) => d.v).sort((a, b) => a - b);
      return { ft, vals, p5: quantile(vs, 0.05), p95: quantile(vs, 0.95), meanAbs: vals.reduce((a, d) => a + Math.abs(d.s), 0) / (vals.length || 1) };
    }).filter((rw) => rw.vals.length >= 10).sort((a, b) => b.meanAbs - a.meanAbs);
    const absAll = shapRows.flatMap((rw) => rw.vals.map((d) => Math.abs(d.s))).sort((a, b) => a - b);
    const swarmLim = Math.max(0.25, quantile(absAll, 0.995) * 1.15);
    const swarm = {
      lim: swarmLim,
      rows: shapRows.map((rw, idx) => {
        const it = byKey[rw.ft.key];
        const pts = sampleEvenly(rw.vals, 320).sort((a, b) => a.s - b.s);
        // beeswarm layout: dots with similar impact fan out vertically
        const bw = (2 * swarmLim) / 90;
        const dots = [];
        for (let a = 0; a < pts.length;) {
          let e = a;
          const bin = Math.floor((pts[a].s + swarmLim) / bw);
          while (e < pts.length && Math.floor((pts[e].s + swarmLim) / bw) === bin) e++;
          const n = e - a, step = Math.min(0.07, 0.8 / Math.max(n, 1));
          for (let k = a; k < e; k++) {
            const d = pts[k];
            const t = rw.p95 > rw.p5 ? Math.max(0, Math.min(1, (d.v - rw.p5) / (rw.p95 - rw.p5))) : 0.5;
            dots.push([Math.max(-swarmLim, Math.min(swarmLim, d.s)), idx + (k - a - (n - 1) / 2) * step, Number(t.toFixed(3)), d.id, d.v, d.s]);
          }
          a = e;
        }
        return { key: rw.ft.key, label: rw.ft.label, unit: rw.ft.unit, meanAbs: rw.meanAbs, n: rw.vals.length, dir: it?.dir ?? 1, sig: it?.sig ?? null, pval: it?.pval ?? NaN, coef: it?.coef ?? 0, orCI: it?.orCI ?? null, okMean: rw.ft.okMean, ngMean: rw.ft.ngMean, dots };
      }),
    };
    return {
      swarm, items, base, nLower: items.filter((i) => i.dir < 0).length, nHigher: items.filter((i) => i.dir > 0).length,
      nSig: items.filter((i) => i.sig).length,
      explained, holdout: r2Holdout !== null, n: all.length, nNg: y.reduce((a, v) => a + v, 0),
      missing: ALL_45_PARAMETERS.filter((p) => !feats.some((ft) => ft.key === p.key)).map((p) => p.label),
    };
  }, [stats, maps, pool, counts, classW]);

  // Parameters ranked by influence (falls back to single-parameter separation when the model can't fit)
  const ranked = useMemo(() => {
    const byKey = Object.fromEntries(stats.map((st) => [st.key, st]));
    if (influence) return influence.items.map((it) => byKey[it.key]).filter(Boolean);
    return stats;
  }, [influence, stats]);

  /* ── 4. Correlation ───────────────────────────────────────────────────── */
  /* ── Rejection causes: station → defect category → defect, from every NG record ── */
  const causes = useMemo(() => {
    const recs = allRejectionRecords || [];
    if (!recs.length) return null;
    const tree = {}, flat = {};
    let total = 0;
    recs.forEach((rec) => {
      const q = Number(rec.quantity) || 1;
      const st = String(rec.ngGate || rec.ng_gate || "").toUpperCase().split(/[,;\s]+/).filter(Boolean)[0] || "Not recorded";
      const pd = parseRowDefect(rec);
      const cat = pd.category || "—";
      const def = pd.reason && pd.reason !== "Defect" ? pd.reason : "Unspecified";
      total += q;
      const s = (tree[st] = tree[st] || { n: 0, cats: {} });
      s.n += q;
      const c = (s.cats[cat] = s.cats[cat] || { n: 0, defs: {} });
      c.n += q;
      c.defs[def] = (c.defs[def] || 0) + q;
      const k = `${st}|${cat}|${def}`;
      flat[k] = (flat[k] || 0) + q;
    });
    const data = Object.entries(tree).sort((a, b) => b[1].n - a[1].n).map(([st, s]) => {
      const col = stationColor(st);
      return {
        name: st, value: s.n, itemStyle: { color: col },
        children: Object.entries(s.cats).sort((a, b) => b[1].n - a[1].n).map(([cat, c]) => ({
          name: cat, value: c.n, itemStyle: { color: rgba(col, 0.72) },
          children: Object.entries(c.defs).sort((a, b) => b[1] - a[1]).map(([d, n]) => ({ name: d, value: n, itemStyle: { color: rgba(col, 0.42) } })),
        })),
      };
    });
    let cum = 0;
    const top = Object.entries(flat).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
      const [st, cat, def] = k.split("|");
      cum += n;
      return { st, cat, def, n, share: (n / total) * 100, cum: (cum / total) * 100 };
    });
    const vital = top.findIndex((t) => t.cum >= 80) + 1 || top.length;
    return { data, total, top, vital, stations: Object.keys(tree) };
  }, [allRejectionRecords]);

  const causesOption = useMemo(() => {
    if (!causes) return null;
    return {
      ...baseOption(),
      tooltip: {
        ...ECHART_TOOLTIP,
        formatter: (p) => {
          const path = (p.treePathInfo || []).slice(1);
          if (!path.length) return "";
          const parent = path.length > 1 ? path[path.length - 2] : null;
          const name = (i) => (i === 0 && STATION_NAME[path[0].name] ? `${path[0].name} ${STATION_NAME[path[0].name]}` : path[i].name);
          return tooltipHtml({
            title: path.map((_, i) => name(i)).join(" › "),
            rows: [
              { label: "Rejected parts", value: Number(p.value).toLocaleString() },
              { label: "Share of all rejects", value: `${((p.value / causes.total) * 100).toFixed(1)}%` },
              parent ? { label: `Share of ${parent.name}`, value: `${((p.value / parent.value) * 100).toFixed(1)}%` } : null,
            ],
            note: "Click a segment to zoom in; click the centre to go back.",
          });
        },
      },
      series: [{
        type: "sunburst", data: causes.data, radius: ["14%", "94%"], sort: null, nodeClick: "rootToNode",
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        emphasis: { focus: "ancestor" },
        levels: [
          {},
          { r0: "14%", r: "42%", label: { rotate: 0, color: "#fff", fontSize: 11, fontWeight: 600, formatter: (p) => `${p.name}\n${((p.value / causes.total) * 100).toFixed(0)}%` } },
          { r0: "42%", r: "62%", label: { rotate: "tangential", color: INK.primary, fontSize: 10.5, minAngle: 10 } },
          { r0: "62%", r: "94%", label: { rotate: "radial", color: INK.primary, fontSize: 10, minAngle: 6, overflow: "truncate", width: 90 } },
        ],
      }],
    };
  }, [causes]);

  const corr = useMemo(() => {
    const feats = ranked.slice(0, 8);
    const matrix = [];
    feats.forEach((a, i) => feats.forEach((b, j) => {
      if (i === j) { matrix.push([j, i, 1]); return; }
      const xs = [], ys = [];
      maps[a.key]?.forEach((v, id) => { const w = maps[b.key]?.get(id); if (w !== undefined) { xs.push(v); ys.push(w); } });
      const c = pearson(xs, ys);
      if (c !== null) matrix.push([j, i, r2(c)]);
    }));
    return { feats, matrix };
  }, [ranked, maps]);

  /* ── 5. Daily rejects c-chart ──────────────────────────────────────────── */
  const cChart = useMemo(() => {
    const byDay = {};
    (allRejectionRecords || []).forEach((rec) => {
      const d = getDay(rec);
      if (!d) return;
      byDay[d] = (byDay[d] || 0) + (Number(rec.quantity) || 1);
    });
    const days = Object.keys(byDay).sort();
    if (days.length < 3) return null;
    const cBar = mean(days.map((d) => byDay[d]));
    const ucl = cBar + 3 * Math.sqrt(cBar), lcl = Math.max(0, cBar - 3 * Math.sqrt(cBar));
    const pts = days.map((d) => ({ d, c: byDay[d] }));
    return { cBar: r2(cBar), ucl: r2(ucl), lcl: r2(lcl), pts, ooc: pts.filter((x) => x.c > ucl).length };
  }, [allRejectionRecords]);

  /* ── 6. Process capability (needs set limits from the analysis service) ─ */
  const limitMap = useMemo(() => {
    const m = {};
    (mlInsights.features || []).forEach((f) => {
      const lsl = Number(f.setLowerLimit), usl = Number(f.setUpperLimit);
      // 9999 / -9999 are "not set" placeholders in the recipe table, not real limits
      if (f.setLowerLimit != null && f.setUpperLimit != null && Number.isFinite(lsl) && Number.isFinite(usl) && usl > lsl && usl < 9999 && lsl > -9999) m[f.key] = { lsl, usl };
    });
    return m;
  }, [mlInsights.features]);

  const cpk = useMemo(() => {
    const calc = (vals, { lsl, usl }) => { const m = mean(vals), s = std(vals); return s > 0 ? Math.min((usl - m) / (3 * s), (m - lsl) / (3 * s)) : null; };
    return stats.filter((s) => limitMap[s.key]).map((s) => ({
      label: s.label, ok: calc(s.ok.map((x) => x.v), limitMap[s.key]), ng: calc(s.ng.map((x) => x.v), limitMap[s.key]),
    })).filter((c) => c.ok !== null && c.ng !== null).sort((a, b) => a.ng - b.ng).slice(0, 12);
  }, [stats, limitMap]);

  /* ── 7. Selected-parameter data (strip, density, binned NG rate) ──────── */
  const sel = useMemo(() => {
    const def = ALL_45_PARAMETERS.find((p) => p.key === param) || ALL_45_PARAMETERS[0];
    const ok = [], ng = [];
    pool.forEach(({ r, id, ng: isNg }) => {
      const v = readParam(r, def);
      if (v === null || v <= 0) return;
      (isNg ? ng : ok).push({ v, id, shot: r.shotNumber || r.shot_number || extractShotFromPartId(id) || "—" });
    });
    return { def, ok, ng };
  }, [pool, param]);

  /* ═════════ ADVANCED DARK TOOLTIP STYLING ═════════ */
  const tip = ECHART_TOOLTIP;
  const toolbox = { right: 8, top: 0, feature: { saveAsImage: { title: "PNG", pixelRatio: 2 } }, iconStyle: { borderColor: "#94a3b8" } };
  const xName = (name) => ({ name, nameLocation: "middle", nameGap: 28, nameTextStyle: { fontSize: 11, fontWeight: 700, color: "#334155" } });

  /* Tornado / sensitivity: predicted scrap rate with each parameter at the low (P10) vs high (P90) end of the
     good-part range, others at average. Sorted by swing; whiskers = approx. 95% CI; faded = not significant. */
  /* "What drives scrap?" — one dot per part. x = how far that parameter pushed the part toward scrap (right)
     or toward OK (left); colour = the parameter's value for that part (blue low → red high). */
  const SWARM_ROW = 26;
  const SWARM_RAMP = [DIVERGING.low, "#9b59d0", DIVERGING.high];
  const swarmOption = useMemo(() => {
    if (!influence?.swarm?.rows.length) return null;
    const { rows: sr, lim } = influence.swarm;
    const band = { sig: "#cfdaee", ns: "#eef1f6" };
    const lab = (sig) => ({ width: 214, height: SWARM_ROW, lineHeight: SWARM_ROW, align: "right", padding: [0, 4, 0, 8], fontSize: 11.5, color: sig ? "#1e2f55" : INK.body, fontFamily: FONT_FAMILY, backgroundColor: sig ? band.sig : band.ns });
    const arrow = (sig, up) => ({ width: 22, height: SWARM_ROW, lineHeight: SWARM_ROW, align: "center", fontSize: 9, color: up ? OUTCOME.ng : DIVERGING.low, backgroundColor: sig ? band.sig : band.ns });
    return {
      ...baseOption(),
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (p) => {
          if (p.seriesType !== "scatter") return "";
          const row = sr[Math.round(p.value[1])];
          if (!row) return "";
          const [shap, , t, id, v] = p.value;
          const mult = Math.exp(shap);
          const sigTxt = row.sig === null ? "—" : row.sig ? "significant (p < 0.05)" : "not significant";
          return tooltipHtml({
            title: row.label,
            subtitle: `Part ${id}`,
            rows: [
              { label: "Parameter value", value: `${r2(v)} ${row.unit}`, color: SWARM_RAMP[t > 0.66 ? 2 : t > 0.33 ? 1 : 0] },
              { label: "Effect on this part's scrap odds", value: `×${mult.toFixed(2)} (${shap >= 0 ? "toward scrap" : "toward OK"})`, color: shap >= 0 ? OUTCOME.ng : DIVERGING.low },
              { label: "Typical effect of this parameter", value: `±${((Math.exp(row.meanAbs) - 1) * 100).toFixed(0)}% on odds` },
              { label: "Higher value", value: row.dir > 0 ? "raises scrap" : "lowers scrap" },
              { label: "Statistical significance", value: sigTxt },
              { label: "Good / rejected mean", value: `${r2(row.okMean)} / ${r2(row.ngMean)} ${row.unit}` },
            ],
            note: "Each dot is one part. Effect is the model's log-odds contribution of this parameter alone.",
          });
        },
      },
      grid: { left: 262, right: 92, top: 34, bottom: 46 },
      graphic: [
        { type: "text", left: 270, top: 8, style: { text: "◀ Pushes toward OK", fill: DIVERGING.low, font: "600 11px Inter, system-ui, sans-serif" } },
        { type: "text", right: 100, top: 8, style: { text: "Pushes toward scrap ▶", fill: OUTCOME.ng, font: "600 11px Inter, system-ui, sans-serif", textAlign: "right" } },
        { type: "text", right: 8, top: 8, style: { text: "Parameter value", fill: INK.body, font: "600 11px Inter, system-ui, sans-serif" } },
      ],
      visualMap: {
        type: "continuous", dimension: 2, min: 0, max: 1, right: 18, top: 34, bottom: 46, itemWidth: 12, itemHeight: "100%",
        text: ["High", "Low"], textStyle: { color: INK.body, fontSize: 11, fontFamily: FONT_FAMILY }, calculable: false, orient: "vertical",
        inRange: { color: SWARM_RAMP },
      },
      xAxis: valueAxis({
        min: -lim, max: lim,
        ...axisName("Impact on scrap likelihood (log-odds)", 30),
        axisLabel: axisLabel({ formatter: (v) => (v > 0 ? `+${Number(v.toFixed(2))}` : `${Number(v.toFixed(2))}`) }),
      }),
      yAxis: {
        type: "value", inverse: true, min: -0.5, max: sr.length - 0.5, interval: 1,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: true, lineStyle: { color: "#f6f7f9" } },
        axisLabel: {
          margin: 6, interval: 0,
          formatter: (v) => {
            const i = Math.round(v);
            const row = sr[i];
            if (!row || Math.abs(v - i) > 0.01) return "";
            const k = row.sig ? "s" : "n";
            return `{${k}|${row.label}} {${k}${row.dir > 0 ? "u" : "d"}|${row.dir > 0 ? "▲" : "▼"}}`;
          },
          rich: { s: lab(true), n: lab(false), su: arrow(true, true), sd: arrow(true, false), nu: arrow(false, true), nd: arrow(false, false) },
        },
      },
      series: [{
        type: "scatter", symbolSize: 5.5, large: false, z: 3,
        itemStyle: { opacity: 0.8 },
        data: sr.flatMap((row) => row.dots),
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "#64748b", width: 1.2 }, data: [{ xAxis: 0 }] },
      }],
    };
  }, [influence]);

  const TORNADO_LOW = CATEGORICAL[0];
  const TORNADO_HIGH = CATEGORICAL[1];
  const influenceOption = useMemo(() => {
    if (!influence) return null;
    const it = influence.items;
    const base = influence.base * 100;
    const vals = it.flatMap((x) => [x.pLo, x.pHi, ...x.pLoCI, ...x.pHiCI].map((v) => v * 100));
    const maxV = Math.max(base, ...vals), minV = Math.min(base, ...vals);
    const pad = (maxV - minV) * 0.06 || 0.5;
    return {
      ...baseOption(),
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (p) => {
          const x = it[p.value?.[0]];
          if (!x) return "";
          const sigTxt = x.sig === null ? "—" : x.sig ? `p ${x.pval < 0.001 ? "< 0.001" : `= ${x.pval.toFixed(3)}`}` : `not significant (p = ${x.pval.toFixed(2)})`;
          return tooltipHtml({
            title: `${x.label} (${x.unit})`,
            subtitle: x.dir > 0 ? "▲ Higher value → more scrap" : "▼ Higher value → less scrap",
            rows: [
              { label: `At low end · P10 = ${r2(x.lo)}`, value: `${(x.pLo * 100).toFixed(2)}%`, color: TORNADO_LOW },
              { label: `At high end · P90 = ${r2(x.hi)}`, value: `${(x.pHi * 100).toFixed(2)}%`, color: TORNADO_HIGH },
              { label: "Swing in scrap rate", value: `${(Math.abs(x.pHi - x.pLo) * 100).toFixed(2)} pts` },
              { label: "Odds of NG per +1σ (95% CI)", value: x.orCI ? `${Math.exp(x.coef).toFixed(2)}× (${x.orCI[0].toFixed(2)}–${x.orCI[1].toFixed(2)})` : `${Math.exp(x.coef).toFixed(2)}×` },
              { label: "Significance", value: sigTxt },
              { label: "Share of explained scrap", value: `${x.pct.toFixed(1)}%` },
              { label: "Good / rejected mean", value: `${r2(x.okMean)} / ${r2(x.ngMean)} ${x.unit}` },
              { label: "Readings", value: x.n.toLocaleString() },
            ],
            note: `Baseline ${base.toFixed(2)}% = predicted scrap rate with every parameter at its average. Association, not proof of cause.`,
          });
        },
      },
      grid: { left: 240, right: 28, top: 26, bottom: 44 },
      xAxis: valueAxis({
        min: Math.max(0, minV - pad), max: maxV + pad,
        ...axisName("Predicted scrap rate (%)", 28),
        axisLabel: axisLabel({ formatter: (v) => `${Number(v.toFixed(2))}%` }),
      }),
      yAxis: categoryAxis(it.map((x) => x.label), {
        inverse: true, axisLine: { show: false },
        axisLabel: {
          fontSize: 11, color: INK.secondary, width: 228, overflow: "truncate", fontFamily: FONT_FAMILY,
          formatter: (v, i) => { const x = it[i]; if (!x) return v; return `{${x.sig === false ? "ns" : "lb"}|${v}} {${x.dir > 0 ? "up" : "dn"}|${x.dir > 0 ? "▲" : "▼"}}`; },
          rich: {
            lb: { color: INK.secondary, fontSize: 11 },
            ns: { color: INK.faint, fontSize: 11 },
            up: { color: OUTCOME.ng, fontSize: 9 },
            dn: { color: DIVERGING.low, fontSize: 9 },
          },
        },
      }),
      series: [
        {
          type: "custom",
          encode: { x: [1, 2, 3, 4, 5, 6], y: 0 },
          data: it.map((x, i) => [i, x.pLo * 100, x.pHi * 100, x.pLoCI[0] * 100, x.pLoCI[1] * 100, x.pHiCI[0] * 100, x.pHiCI[1] * 100]),
          renderItem: (params, api) => {
            const i = api.value(0);
            const x = it[i];
            const [bx, yc] = api.coord([base, i]);
            const h = api.size([0, 1])[1] * 0.58;
            const px = (v) => api.coord([v, i])[0];
            const lx = px(api.value(1)), hx = px(api.value(2));
            const opacity = x.sig === false ? 0.35 : 1;
            const bar = (to, color) => ({ type: "rect", shape: { x: Math.min(bx, to), y: yc - h / 2, width: Math.max(1, Math.abs(to - bx)), height: h, r: 2 }, style: { fill: color, opacity } });
            const whisker = (a, b) => {
              const xa = px(a), xb = px(b), cap = h * 0.32;
              return [
                { type: "line", shape: { x1: xa, y1: yc, x2: xb, y2: yc }, style: { stroke: INK.primary, lineWidth: 1, opacity: 0.7 } },
                { type: "line", shape: { x1: xa, y1: yc - cap, x2: xa, y2: yc + cap }, style: { stroke: INK.primary, lineWidth: 1, opacity: 0.7 } },
                { type: "line", shape: { x1: xb, y1: yc - cap, x2: xb, y2: yc + cap }, style: { stroke: INK.primary, lineWidth: 1, opacity: 0.7 } },
              ];
            };
            // draw the longer side first so a same-side shorter bar stays visible
            const bars = Math.abs(lx - bx) >= Math.abs(hx - bx) ? [bar(lx, TORNADO_LOW), bar(hx, TORNADO_HIGH)] : [bar(hx, TORNADO_HIGH), bar(lx, TORNADO_LOW)];
            return { type: "group", children: [...bars, ...whisker(api.value(3), api.value(4)), ...whisker(api.value(5), api.value(6))] };
          },
          z: 3,
        },
        {
          type: "line", data: [], silent: true,
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: INK.primary, width: 1.5 },
            label: { formatter: `Baseline ${base.toFixed(2)}%`, position: "end", fontSize: 10.5, color: INK.secondary },
            data: [{ xAxis: Number(base.toFixed(4)) }],
          },
        },
      ],
    };
  }, [influence]);

  /* Operating window — where rejected parts ran relative to good parts (scaled by good-part spread) */
  const windowData = useMemo(() => ranked.slice(0, 12).map((st) => {
    const ok = st.ok.map((x) => x.v).sort((a, b) => a - b);
    const ng = st.ng.map((x) => x.v).sort((a, b) => a - b);
    const okMed = quantile(ok, 0.5), okLo = quantile(ok, 0.1), okHi = quantile(ok, 0.9);
    const scale = (okHi - okLo) / 2.563 || st.okStd || 1; // P10–P90 of a normal = ±1.28σ
    const z = (v) => Math.max(-8, Math.min(8, (v - okMed) / scale));
    const ngLo = quantile(ng, 0.25), ngMed = quantile(ng, 0.5), ngHi = quantile(ng, 0.75);
    return { st, okMed, okLo, okHi, ngLo, ngMed, ngHi, z: [z(okLo), z(okHi), z(ngLo), z(ngHi), z(ngMed)] };
  }), [ranked]);

  const windowOption = useMemo(() => {
    if (!windowData.length) return null;
    const lim = Math.max(3, Math.ceil(Math.max(...windowData.flatMap((d) => d.z.map(Math.abs))) + 0.5));
    return {
      textStyle: FONT,
      tooltip: {
        ...tip, trigger: "item",
        formatter: (p) => {
          const d = windowData[p.value[0]];
          const u = d.st.unit;
          return `<div style="font-weight:600;margin-bottom:6px">${d.st.label} <span style="color:#64748b;font-weight:400">(${u})</span></div>
            <div style="display:grid;grid-template-columns:auto auto;gap:3px 14px;font-size:12px">
              <span style="color:#15803d">Good parts (middle 80%)</span><b>${r2(d.okLo)} – ${r2(d.okHi)}</b>
              <span style="color:#15803d">Good-part median</span><b>${r2(d.okMed)}</b>
              <span style="color:#b91c1c">Rejected median</span><b>${r2(d.ngMed)}</b>
              <span style="color:#b91c1c">Rejected (middle 50%)</span><b>${r2(d.ngLo)} – ${r2(d.ngHi)}</b>
              <span style="color:#64748b">Shift</span><b>${d.z[4] > 0 ? "+" : ""}${d.z[4].toFixed(2)}σ</b>
            </div>`;
        },
      },
      grid: { left: 190, right: 24, top: 12, bottom: 44 },
      xAxis: {
        type: "value", min: -lim, max: lim,
        ...xName("Shift from good-part median (σ)"),
        axisLabel: { formatter: (v) => (v > 0 ? `+${v}` : `${v}`), color: "#64748b", fontSize: 10.5 },
        splitLine: { lineStyle: { color: C.grid } },
      },
      yAxis: {
        type: "category", inverse: true, data: windowData.map((d) => d.st.label),
        axisTick: { show: false }, axisLine: { lineStyle: { color: "#e2e8f0" } },
        axisLabel: { fontSize: 11, color: "#1e293b", width: 180, overflow: "truncate" },
      },
      series: [{
        type: "custom",
        encode: { x: [1, 2, 3, 4, 5], y: 0 },
        data: windowData.map((d, i) => [i, ...d.z]),
        renderItem: (params, api) => {
          const idx = api.value(0);
          const [x1, yc] = api.coord([api.value(1), idx]);
          const [x2] = api.coord([api.value(2), idx]);
          const [n1] = api.coord([api.value(3), idx]);
          const [n2] = api.coord([api.value(4), idx]);
          const [nm] = api.coord([api.value(5), idx]);
          const [x0] = api.coord([0, idx]);
          return {
            type: "group",
            children: [
              { type: "rect", shape: { x: x1, y: yc - 8, width: Math.max(1, x2 - x1), height: 16, r: 4 }, style: { fill: "rgba(22,163,74,0.13)", stroke: "#16a34a", lineWidth: 1 } },
              { type: "line", shape: { x1: x0, y1: yc - 8, x2: x0, y2: yc + 8 }, style: { stroke: "#15803d", lineWidth: 2 } },
              { type: "rect", shape: { x: Math.min(n1, n2), y: yc - 2.5, width: Math.max(2, Math.abs(n2 - n1)), height: 5, r: 2.5 }, style: { fill: "rgba(220,38,38,0.55)" } },
              { type: "circle", shape: { cx: nm, cy: yc, r: 5 }, style: { fill: "#dc2626", stroke: "#fff", lineWidth: 1.5 } },
            ],
          };
        },
      }],
    };
  }, [windowData]);

  /* Scrap rate by operating range — plant-calibrated NG rate in each fifth of the good-part range */
  const riskMap = useMemo(() => {
    const feats = ranked.slice(0, 10);
    if (!feats.length) return null;
    const BANDS = ["Lowest 20%", "20–40%", "40–60%", "60–80%", "Highest 20%"];
    const cells = [];
    let max = 0;
    feats.forEach((st, row) => {
      const ok = st.ok.map((x) => x.v).sort((a, b) => a - b);
      const cutsAt = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(ok, q));
      const bandOf = (v) => { let b = 0; while (b < 4 && v >= cutsAt[b]) b++; return b; };
      const agg = BANDS.map(() => ({ n: 0, ng: 0, wNg: 0, wOk: 0, lo: Infinity, hi: -Infinity }));
      const add = (v, isNg) => {
        const a = agg[bandOf(v)];
        a.n++; a.lo = Math.min(a.lo, v); a.hi = Math.max(a.hi, v);
        if (isNg) { a.ng++; a.wNg += classW.ng; } else a.wOk += classW.ok;
      };
      st.ok.forEach((x) => add(x.v, false));
      st.ng.forEach((x) => add(x.v, true));
      agg.forEach((a, col) => {
        const rate = a.wNg + a.wOk > 0 ? (a.wNg / (a.wNg + a.wOk)) * 100 : null;
        if (rate !== null && a.n >= 10) max = Math.max(max, rate);
        cells.push({ col, row, rate, ...a, st });
      });
    });
    return { feats, BANDS, cells, max: Math.max(max, (popRate || 0) * 100 * 2, 1) };
  }, [ranked, classW, popRate]);

  const riskOption = useMemo(() => {
    if (!riskMap) return null;
    const { feats, BANDS, cells, max } = riskMap;
    return {
      textStyle: FONT,
      tooltip: {
        ...tip,
        formatter: (p) => {
          const c = cells[p.dataIndex];
          if (!c || !c.n) return "No readings";
          return `<div style="font-weight:600;margin-bottom:4px">${c.st.label} · ${BANDS[c.col]}</div>
            <div style="font-size:12px;line-height:1.6">Range: <b>${r2(c.lo)} – ${r2(c.hi)} ${c.st.unit}</b><br/>
            Estimated scrap rate: <b>${c.rate === null ? "—" : c.rate.toFixed(1) + "%"}</b>${popRate ? ` <span style="color:#64748b">(plant ${(popRate * 100).toFixed(1)}%)</span>` : ""}<br/>
            Parts: ${c.n.toLocaleString()} · rejected ${c.ng.toLocaleString()}${c.n < 10 ? '<br/><span style="color:#b45309">Fewer than 10 parts — low confidence</span>' : ""}</div>`;
        },
      },
      grid: { left: 190, right: 16, top: 8, bottom: 64 },
      xAxis: { type: "category", data: BANDS, splitArea: { show: false }, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { fontSize: 10.5, color: "#475569" }, position: "bottom" },
      yAxis: { type: "category", inverse: true, data: feats.map((st) => st.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { fontSize: 11, color: "#1e293b", width: 180, overflow: "truncate" } },
      visualMap: {
        min: 0, max: Number(max.toFixed(1)), calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 140, itemWidth: 10,
        text: [`${max.toFixed(0)}%`, "0%"], textStyle: { fontSize: 10.5, color: "#64748b" },
        inRange: { color: ["#fbfaf9", ...SEQ_SCRAP.slice(1)] }, dimension: 2,
      },
      series: [{
        type: "heatmap",
        data: cells.map((c) => [c.col, c.row, c.rate === null ? "-" : Number(c.rate.toFixed(2))]),
        label: {
          show: true, fontSize: 10.5,
          formatter: (p) => { const c = cells[p.dataIndex]; return c.rate === null ? "" : `${c.rate.toFixed(1)}%${c.n < 10 ? "*" : ""}`; },
          color: "#0f172a",
        },
        itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 },
        emphasis: { itemStyle: { borderColor: "#0f172a", borderWidth: 1 } },
      }],
    };
  }, [riskMap, popRate]);

  // Density (KDE) OK vs NG for the selected parameter, with set limits when known
  const densityOption = useMemo(() => {
    if (sel.ok.length < 2 && sel.ng.length < 2) return null;
    const okV = sampleEvenly(sel.ok.map((x) => x.v), 2000), ngV = sampleEvenly(sel.ng.map((x) => x.v), 2000);
    const sorted = [...okV, ...ngV].sort((a, b) => a - b);
    if (!sorted.length) return null;
    const lo = sorted.length > 5 ? quantile(sorted, 0.01) : sorted[0] * 0.9;
    const hi = sorted.length > 5 ? quantile(sorted, 0.99) : sorted[sorted.length - 1] * 1.1;
    if (!(hi > lo)) return null;
    const grid = Array.from({ length: 90 }, (_, i) => lo + ((hi - lo) * i) / 89);
    const dOk = kde(okV.length >= 2 ? okV : [...okV, ...okV], grid);
    const dNg = kde(ngV.length >= 2 ? ngV : [...ngV, ...ngV], grid);
    const lim = limitMap[sel.def.key];
    const lines = lim ? [{ xAxis: grid.findIndex((g) => g >= lim.lsl) , name: "LSL" }, { xAxis: grid.findIndex((g) => g >= lim.usl), name: "USL" }].filter((l) => l.xAxis >= 0) : [];
    return {
      textStyle: FONT,
      tooltip: {
        ...tip,
        trigger: "axis",
        formatter: (p) => `
          <div style="font-weight:800;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:6px;">
            ${sel.def.label}: <strong>${r2(grid[p[0].dataIndex])} ${sel.def.unit}</strong>
          </div>
          ${p.map((s) => `<div>${s.marker} ${s.seriesName}: <strong>${Number(s.value).toFixed(4)}</strong></div>`).join("")}
        `
      },
      legend: { top: 0, right: 10, textStyle: { fontSize: 11, fontWeight: 700 } },
      grid: { left: 56, right: 24, top: 34, bottom: 46 },
      xAxis: { type: "category", data: grid.map((g) => r2(g)), boundaryGap: false, axisLabel: { interval: 14, fontSize: 10 }, ...xName(`${sel.def.label} (${sel.def.unit})`) },
      yAxis: { type: "value", name: "Density", axisLabel: { show: false }, splitLine: { lineStyle: { color: C.grid } } },
      series: [
        { name: `OK (n=${sel.ok.length})`, type: "line", smooth: true, showSymbol: false, data: dOk, lineStyle: { color: C.ok, width: 2.5 }, areaStyle: { color: "rgba(27,175,122,0.16)" }, markLine: lines.length ? { silent: true, symbol: "none", lineStyle: { color: "#f59e0b", type: "dashed", width: 2 }, label: { formatter: "{b}", fontWeight: 800, fontSize: 10 }, data: lines } : undefined },
        { name: `NG (n=${sel.ng.length})`, type: "line", smooth: true, showSymbol: false, data: dNg, lineStyle: { color: C.ng, width: 2.5 }, areaStyle: { color: "rgba(208,59,59,0.16)" } },
      ],
    };
  }, [sel, limitMap]);

  const stripOption = useMemo(() => {
    const ml = (val, c) => ({ silent: true, symbol: "none", lineStyle: { color: c, type: "dashed", width: 2 }, label: { formatter: `μ ${r2(val)}`, fontSize: 10.5, fontWeight: 800, color: c }, data: [{ xAxis: val }] });
    const mk = (arr, base, st) => sampleEvenly(arr, 500).map((x) => [x.v, r3(jitter(x.id, base, 0.45)), x.id, x.shot, st]);
    return {
      textStyle: FONT, toolbox,
      tooltip: {
        ...tip,
        formatter: (p) => {
          const [v, , id, shot, st] = p.data;
          const color = st === "OK" ? "#0369a1" : "#be123c";
          return `
            <div style="font-weight:800;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:6px;">
              Serial Part: ${id}
            </div>
            <div style="font-size:12px;line-height:1.5;">
              Shot #: <strong>${shot}</strong><br/>
              Classification: <strong style="color:${color}">${st}</strong><br/>
              ${sel.def.label}: <strong>${v} ${sel.def.unit}</strong>
            </div>
          `;
        }
      },
      legend: { top: 0, left: 10, textStyle: { fontSize: 11, fontWeight: 700 } },
      grid: { left: 64, right: 30, top: 34, bottom: 46 },
      xAxis: { type: "value", scale: true, ...xName(`${sel.def.label} (${sel.def.unit})`), splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: "value", min: -0.5, max: 1.5, interval: 1, axisLabel: { formatter: (v) => (v === 1 ? "Good" : v === 0 ? "NG" : ""), fontWeight: 800, color: "#0f172a" }, splitLine: { show: false } },
      series: [
        { name: `Good (n=${sel.ok.length})`, type: "scatter", symbolSize: 7, data: mk(sel.ok, 1, "OK"), itemStyle: { color: C.ok, opacity: 0.55 }, markLine: sel.ok.length ? ml(mean(sel.ok.map((x) => x.v)), OUTCOME.ok) : undefined },
        { name: `NG (n=${sel.ng.length})`, type: "scatter", symbolSize: 8, data: mk(sel.ng, 0, "NG"), itemStyle: { color: C.ng, opacity: 0.7 }, markLine: sel.ng.length ? ml(mean(sel.ng.map((x) => x.v)), OUTCOME.ng) : undefined },
      ],
    };
  }, [sel]);

  const aucWithCi = (a, se) => (Number.isFinite(se)
    ? `${r3(a)} (95% CI ${r3(Math.max(0, a - 1.96 * se))}–${r3(Math.min(1, a + 1.96 * se))})`
    : `${r3(a)}`);
  const pctAxis = (name, gap) => ({ min: 0, max: 1, ...axisName(name, gap), axisLabel: axisLabel({ formatter: (v) => `${Math.round(v * 100)}%` }) });
  const opTooltip = (o) => tooltipHtml({
    title: o.name,
    rows: [
      { label: "Decision threshold", value: o.t.toFixed(3) },
      { label: "NG caught (recall)", value: pct(o.recall) },
      { label: "Good parts flagged (FPR)", value: pct(1 - o.spec) },
      { label: "Precision · test set", value: pct(o.precision) },
      { label: "Precision · plant mix", value: pct(o.plantPrecision) },
      { label: "Confusion (TP / FP / FN / TN)", value: `${o.tp} / ${o.fp} / ${o.fn} / ${o.tn}` },
    ],
  });

  const MODEL_C = CATEGORICAL[6];
  const SINGLE_C = CATEGORICAL[1];

  const rocOption = useMemo(() => {
    const curveTip = (p) => tooltipHtml({
      title: p.seriesName.split(" · ")[0],
      rows: [{ label: "Good parts flagged (FPR)", value: pct(p.data[0]) }, { label: "NG caught (TPR)", value: pct(p.data[1]) }],
    });
    const chance = { name: "Chance (AUROC 0.5)", type: "line", showSymbol: false, data: [[0, 0], [1, 1]], lineStyle: { type: "dashed", color: INK.faint, width: 1.5 }, silent: true };
    const frame = {
      ...baseOption(), toolbox,
      legend: { ...LEGEND, top: "auto", right: "auto", bottom: 0, left: "center", type: "scroll", width: "92%" },
      grid: { left: 58, right: 22, top: 16, bottom: 74 },
      xAxis: valueAxis(pctAxis("Good parts wrongly flagged (false positive rate)", 28)),
      yAxis: valueAxis(pctAxis("NG parts caught (true positive rate)", 42)),
    };
    if (!model) {
      const f = stats[0];
      if (!f) return null;
      return {
        ...frame,
        tooltip: { ...ECHART_TOOLTIP, trigger: "item", formatter: curveTip },
        series: [
          { name: `${f.label} · AUROC ${r3(f.sep)} (all readings)`, type: "line", showSymbol: false, data: rocCurve(f.ng.map((x) => f.dir * x.v), f.ok.map((x) => f.dir * x.v)), lineStyle: { width: 2, color: SINGLE_C } },
          chance,
        ],
      };
    }
    const ops = model.opPoints;
    return {
      ...frame,
      tooltip: { ...ECHART_TOOLTIP, trigger: "item", formatter: (p) => (p.seriesName === "Operating points" ? opTooltip(ops[p.dataIndex]) : curveTip(p)) },
      series: [
        { name: `Multivariate model · AUROC ${aucWithCi(model.auc, model.aucSe)}`, type: "line", showSymbol: false, data: model.roc, lineStyle: { width: 2.5, color: MODEL_C }, itemStyle: { color: MODEL_C }, areaStyle: { color: rgba(MODEL_C, 0.06) }, z: 5 },
        ...(model.single ? [{ name: `Top single parameter: ${model.single.label} · AUROC ${aucWithCi(model.single.auc, model.single.se)}`, type: "line", showSymbol: false, data: model.single.roc, lineStyle: { width: 2, color: SINGLE_C }, itemStyle: { color: SINGLE_C } }] : []),
        chance,
        {
          name: "Operating points", type: "scatter", symbol: "diamond", symbolSize: 11, z: 10,
          itemStyle: { color: INK.primary, borderColor: "#fff", borderWidth: 1.5 },
          label: { show: true, position: "right", fontSize: 10.5, color: INK.secondary, formatter: (p) => ops[p.dataIndex].short },
          data: ops.map((o) => [r3(1 - o.spec), r3(o.recall)]),
        },
      ],
    };
  }, [stats, model]);

  const prOption = useMemo(() => {
    if (!model) return null;
    const ops = model.opPoints;
    const plantLabel = classW.calibrated ? `At plant NG rate ${pct(popRate, 1)}` : "At sample NG rate";
    const noSkill = classW.calibrated ? popRate : model.prevalence;
    return {
      ...baseOption(), toolbox,
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (p) => (p.seriesName === "Operating points" ? opTooltip(ops[p.dataIndex]) : tooltipHtml({
          title: p.seriesName.split(" · ")[0],
          rows: [{ label: "NG caught (recall)", value: pct(p.data[0]) }, { label: "Flagged parts that are NG (precision)", value: pct(p.data[1]) }],
        })),
      },
      legend: { ...LEGEND, top: "auto", right: "auto", bottom: 0, left: "center", type: "scroll", width: "92%" },
      grid: { left: 58, right: 22, top: 16, bottom: 74 },
      xAxis: valueAxis(pctAxis("NG parts caught (recall)", 28)),
      yAxis: valueAxis(pctAxis("Flagged parts that are NG (precision)", 42)),
      series: [
        {
          name: `${plantLabel} · AP ${r3(model.pr.apPlant)}`, type: "line", showSymbol: false, data: model.pr.plantPts,
          lineStyle: { width: 2.5, color: MODEL_C }, itemStyle: { color: MODEL_C }, areaStyle: { color: rgba(MODEL_C, 0.06) }, z: 5,
          markLine: {
            silent: true, symbol: "none", lineStyle: { color: INK.faint, type: "dashed" },
            label: { formatter: `No-skill ${pct(noSkill, 1)}`, position: "insideEndTop", fontSize: 10.5, color: INK.muted },
            data: [{ yAxis: r3(noSkill) }],
          },
        },
        ...(classW.calibrated ? [{
          name: `At test-set NG rate ${pct(model.prevalence, 0)} · AP ${r3(model.pr.ap)}`, type: "line", showSymbol: false, data: model.pr.pts,
          lineStyle: { width: 1.5, color: CATEGORICAL[0], type: "dashed" }, itemStyle: { color: CATEGORICAL[0] },
        }] : []),
        {
          name: "Operating points", type: "scatter", symbol: "diamond", symbolSize: 11, z: 10,
          itemStyle: { color: INK.primary, borderColor: "#fff", borderWidth: 1.5 },
          label: { show: true, position: "right", fontSize: 10.5, color: INK.secondary, formatter: (p) => ops[p.dataIndex].short },
          data: ops.map((o) => [r3(o.recall), r3(o.plantPrecision)]),
        },
      ],
    };
  }, [model, popRate, classW]);

  const sweepOption = useMemo(() => model && ({
    textStyle: FONT, toolbox,
    tooltip: { ...tip, trigger: "axis", valueFormatter: (v) => r3(v) },
    legend: { bottom: 0, textStyle: { fontSize: 10.5, fontWeight: 700 } },
    grid: { left: 52, right: 18, top: 24, bottom: 62 },
    xAxis: { type: "category", data: model.sweep.map((s) => s.t), axisLabel: { interval: 3, fontSize: 10 }, ...xName("Decision threshold") },
    yAxis: { type: "value", min: 0, max: 1, splitLine: { lineStyle: { color: C.grid } } },
    series: [
      { name: "Precision", type: "line", showSymbol: false, data: model.sweep.map((s) => r3(s.precision)), lineStyle: { color: C.model, width: 2.5 } },
      { name: "Recall", type: "line", showSymbol: false, data: model.sweep.map((s) => r3(s.recall)), lineStyle: { color: C.ng, width: 2.5 } },
      { name: "F1", type: "line", showSymbol: false, data: model.sweep.map((s) => r3(s.f1)), lineStyle: { color: C.green, width: 2.5, type: "dashed" }, markPoint: { symbol: "pin", symbolSize: 46, itemStyle: { color: C.green }, label: { fontSize: 10, fontWeight: 800 }, data: [{ coord: [model.sweep.findIndex((s) => s.t === model.best.t), r3(model.best.f1)], value: model.best.t }] } },
    ],
  }), [model]);

  const histOption = useMemo(() => model && ({
    textStyle: FONT, toolbox,
    tooltip: { ...tip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v) => `${v}% of class` },
    legend: { top: 0, right: 10, textStyle: { fontSize: 11, fontWeight: 700 } },
    grid: { left: 52, right: 18, top: 34, bottom: 46 },
    xAxis: { type: "category", data: Array.from({ length: model.hist.bins }, (_, i) => r2((i + 0.5) / model.hist.bins)), axisLabel: { interval: 1, fontSize: 10 }, ...xName("Predicted NG probability") },
    yAxis: { type: "value", axisLabel: { formatter: "{value}%" }, splitLine: { lineStyle: { color: C.grid } } },
    series: [
      { name: "Actual OK", type: "bar", data: model.hist.ok, barGap: "-100%", barCategoryGap: "10%", itemStyle: { color: "rgba(27,175,122,0.6)" } },
      { name: "Actual NG", type: "bar", data: model.hist.ng, itemStyle: { color: "rgba(208,59,59,0.6)" } },
    ],
  }), [model]);

  const gainOption = useMemo(() => model && ({
    textStyle: FONT, toolbox,
    tooltip: { ...tip, formatter: (p) => `Inspect top <strong>${pct(p.data[0], 0)}</strong> → catch <strong>${pct(p.data[1], 0)}</strong> of NG` },
    grid: { left: 52, right: 18, top: 26, bottom: 46 },
    title: { text: `Lift @ top 10% = ${model.gain.lift10.toFixed(1)}×`, left: "center", top: 0, textStyle: { fontSize: 12, fontWeight: 800, color: "#334155" } },
    xAxis: { type: "value", min: 0, max: 1, ...xName("Share of parts inspected (ranked by risk)"), axisLabel: { formatter: (v) => `${v * 100}%` }, splitLine: { lineStyle: { color: C.grid } } },
    yAxis: { type: "value", min: 0, max: 1, name: "NG captured", axisLabel: { formatter: (v) => `${v * 100}%` }, splitLine: { lineStyle: { color: C.grid } } },
    series: [
      { name: "Model", type: "line", showSymbol: false, data: model.gain.pts, lineStyle: { width: 3, color: C.model }, areaStyle: { color: "rgba(74,58,167,0.07)" } },
      { name: "Random", type: "line", showSymbol: false, data: [[0, 0], [1, 1]], lineStyle: { type: "dashed", color: "#94a3b8" }, silent: true },
    ],
  }), [model]);

  const cmOption = useMemo(() => {
    if (!model) return null;
    const { tn, fp, fn, tp } = model.m50;
    const tot = [tn + fp, fn + tp];
    return {
      textStyle: FONT,
      tooltip: { ...tip, formatter: (p) => `Actual ${p.value[1] ? "NG" : "OK"} → Pred ${p.value[0] ? "NG" : "OK"}<br/><b>${p.value[2]}</b> (${pct(tot[p.value[1]] ? p.value[2] / tot[p.value[1]] : 0)} of actual)` },
      grid: { left: 70, right: 16, top: 10, bottom: 52 },
      xAxis: { type: "category", data: ["Pred. OK", "Pred. NG"], splitArea: { show: true } },
      yAxis: { type: "category", data: ["Actual OK", "Actual NG"], inverse: true, splitArea: { show: true } },
      visualMap: { show: false, min: 0, max: Math.max(tn, fp, fn, tp, 1), inRange: { color: ["#f8fafc", "#818cf8", "#4338ca"] } },
      series: [{ type: "heatmap", data: [[0, 0, tn], [1, 0, fp], [0, 1, fn], [1, 1, tp]], label: { show: true, fontSize: 15, fontWeight: 800, formatter: (p) => `${p.value[2]}\n{s|${pct(tot[p.value[1]] ? p.value[2] / tot[p.value[1]] : 0)}}`, rich: { s: { fontSize: 10, color: "#64748b" } } }, itemStyle: { borderColor: "#fff", borderWidth: 3 } }],
    };
  }, [model]);

  const coefOption = useMemo(() => {
    if (!model) return null;
    const f = [...model.feats].sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef));
    return {
      textStyle: FONT,
      tooltip: { ...tip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p) => `<b>${f[p[0].dataIndex].label}</b><br/>Coefficient: <strong>${r3(f[p[0].dataIndex].coef)}</strong>` },
      grid: { left: 150, right: 44, top: 10, bottom: 40 },
      xAxis: { type: "value", ...xName("Standardised coefficient (log-odds per σ)"), splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: "category", inverse: true, data: f.map((x) => x.label), axisTick: { show: false }, axisLabel: { fontWeight: 700, color: "#0f172a" } },
      series: [{ type: "bar", barWidth: 14, data: f.map((x) => ({ value: r3(x.coef), itemStyle: { color: x.coef >= 0 ? DIVERGING.high : DIVERGING.low, borderRadius: x.coef >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })), label: { show: true, position: "right", fontSize: 10.5, fontWeight: 700 }, markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "#0f172a", width: 1.5 }, data: [{ xAxis: 0 }] } }],
    };
  }, [model]);

  // Partial dependence (others held at their training mean)
  const pdOption = useMemo(() => {
    if (!model || !activePd) return null;
    const j = model.feats.findIndex((f) => f.key === activePd.key);
    const pts = Array.from({ length: 40 }, (_, i) => {
      const v = activePd.p5 + ((activePd.p95 - activePd.p5) * i) / 39;
      return [r2(v), r3(sigmoid(model.b + model.feats[j].coef * ((v - activePd.mu) / activePd.sd)))];
    });
    return {
      textStyle: FONT, toolbox,
      tooltip: { ...tip, formatter: (p) => `${activePd.label}: <b>${p.data[0]} ${activePd.unit}</b><br/>Model NG risk score: <b>${p.data[1]}</b>` },
      grid: { left: 56, right: 24, top: 26, bottom: 46 },
      xAxis: { type: "value", scale: true, ...xName(`${activePd.label} (${activePd.unit})`), splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: "value", min: 0, max: 1, name: "Model NG score", splitLine: { lineStyle: { color: C.grid } } },
      series: [{
        type: "line", showSymbol: false, smooth: true, data: pts, lineStyle: { width: 3, color: C.model }, areaStyle: { color: "rgba(74,58,167,0.07)" },
        markLine: { silent: true, symbol: "none", label: { fontSize: 10, fontWeight: 800 }, data: [
          { xAxis: r2(activePd.okMean), name: "OK mean", lineStyle: { color: C.ok, type: "dashed" }, label: { formatter: "OK μ", color: C.ok } },
          { xAxis: r2(activePd.ngMean), name: "NG mean", lineStyle: { color: C.ng, type: "dashed" }, label: { formatter: "NG μ", color: C.ng } },
        ] },
      }],
    };
  }, [model, activePd]);

  const corrOption = useMemo(() => ({
    textStyle: FONT,
    tooltip: { ...tip, formatter: (p) => `${corr.feats[p.value[1]].label} × ${corr.feats[p.value[0]].label}<br/>Pearson Correlation r = <b>${p.value[2]}</b>` },
    grid: { left: 130, right: 20, top: 10, bottom: 110 },
    xAxis: { type: "category", data: corr.feats.map((f) => f.label), axisLabel: { rotate: 40, fontSize: 10, fontWeight: 700 }, splitArea: { show: true } },
    yAxis: { type: "category", inverse: true, data: corr.feats.map((f) => f.label), axisLabel: { fontSize: 10, fontWeight: 700 }, splitArea: { show: true } },
    visualMap: { min: -1, max: 1, calculable: false, orient: "horizontal", left: "center", bottom: 0, inRange: { color: [DIVERGING.low, DIVERGING.mid, DIVERGING.high] } },
    series: [{ type: "heatmap", data: corr.matrix, label: { show: true, fontSize: 10, fontWeight: 700, formatter: (p) => p.value[2].toFixed(2) }, itemStyle: { borderColor: "#fff", borderWidth: 2 } }],
  }), [corr]);

  const scatterOption = useMemo(() => {
    const dx = ALL_45_PARAMETERS.find((p) => p.key === scatterX) || ALL_45_PARAMETERS[0];
    const dy = ALL_45_PARAMETERS.find((p) => p.key === scatterY) || ALL_45_PARAMETERS[1] || ALL_45_PARAMETERS[0];
    const ok = [], ng = [];
    pool.forEach(({ r, id, ng: isNg }) => {
      const x = readParam(r, dx), y = readParam(r, dy);
      if (x === null || y === null || x <= 0 || y <= 0) return;
      (isNg ? ng : ok).push([x, y, id, isNg ? "NG" : "OK"]);
    });
    return {
      counts: { ok: ok.length, ng: ng.length },
      option: {
        textStyle: FONT,
        tooltip: { ...tip, formatter: (p) => `<b>Part Serial: ${p.data[2]}</b> • Status: <strong style="color:${p.data[3] === 'OK' ? '#0369a1' : '#be123c'}">${p.data[3]}</strong><br/>${dx.label}: <strong>${p.data[0]} ${dx.unit || ''}</strong><br/>${dy.label}: <strong>${p.data[1]} ${dy.unit || ''}</strong>` },
        legend: { top: 0, left: 10, textStyle: { fontSize: 11, fontWeight: 700 } },
        toolbox: { ...toolbox, feature: { restore: { title: "Reset zoom" }, saveAsImage: { title: "PNG" } } },
        grid: { left: 64, right: 24, top: 38, bottom: 80 },
        dataZoom: [{ type: "inside", xAxisIndex: 0 }, { type: "inside", yAxisIndex: 0 }, { type: "slider", xAxisIndex: 0, height: 16, bottom: 8 }],
        xAxis: { type: "value", scale: true, ...xName(`${dx.label} (${dx.unit})`), splitLine: { lineStyle: { color: C.grid } } },
        yAxis: { type: "value", scale: true, name: `${dy.label} (${dy.unit})`, splitLine: { lineStyle: { color: C.grid } } },
        series: [
          { name: "OK", type: "scatter", symbolSize: 6, data: sampleEvenly(ok, 3000), itemStyle: { color: C.ok, opacity: 0.45 }, large: true },
          { name: "NG", type: "scatter", symbolSize: 8, symbol: "diamond", data: sampleEvenly(ng, 3000), itemStyle: { color: C.ng, opacity: 0.85 } },
        ],
      },
    };
  }, [pool, scatterX, scatterY]);

  const cOption = useMemo(() => {
    if (!cChart) return null;
    const { pts, cBar, ucl, lcl } = cChart;
    return {
      textStyle: FONT, toolbox,
      tooltip: { ...tip, trigger: "axis", formatter: (p) => { const d = pts[p[0].dataIndex]; return `<b>${d.d}</b><br/>Rejects: <b>${d.c}</b><br/><span style="color:#64748b">Average ${cBar} · upper limit ${ucl}</span>${d.c > ucl ? '<br/><b style="color:#b91c1c">Above control limit</b>' : ""}`; } },
      legend: { top: 0, left: 10, textStyle: { fontSize: 11, color: "#475569" } },
      grid: { left: 48, right: 64, top: 36, bottom: 64 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 14, bottom: 8 }],
      xAxis: { type: "category", data: pts.map((d) => d.d.slice(5)), axisLabel: { fontSize: 10.5, color: "#64748b" } },
      yAxis: { type: "value", name: "Rejects per day", nameTextStyle: { fontSize: 11, color: "#64748b" }, axisLabel: { color: "#64748b" }, splitLine: { lineStyle: { color: C.grid } } },
      series: [{
        name: "Daily rejects", type: "line", data: pts.map((d) => ({ value: d.c, itemStyle: { color: d.c > ucl ? "#dc2626" : C.model } })), symbolSize: 7, lineStyle: { width: 2, color: C.model },
        markLine: {
          silent: true, symbol: "none", label: { fontSize: 10.5, color: "#475569", position: "end" },
          data: [
            { yAxis: cBar, lineStyle: { color: "#0f172a", width: 1.5 }, label: { formatter: `Avg ${cBar}` } },
            { yAxis: ucl, lineStyle: { color: "#dc2626", type: "dashed" }, label: { formatter: `UCL ${ucl}` } },
            ...(lcl > 0 ? [{ yAxis: lcl, lineStyle: { color: C.green, type: "dashed" }, label: { formatter: `LCL ${lcl}` } }] : []),
          ],
        },
      }],
    };
  }, [cChart]);

  const cpkOption = useMemo(() => {
    if (!cpk.length) return null;
    const clip = (v) => Math.max(-1, Math.min(4, v));
    return {
      textStyle: FONT,
      tooltip: { ...tip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p) => { const c = cpk[p[0].dataIndex]; return `<b>${c.label}</b><br/>Good parts Cpk: <b>${r2(c.ok)}</b><br/>Rejected parts Cpk: <b>${r2(c.ng)}</b>`; } },
      legend: { top: 0, right: 10, textStyle: { fontSize: 11, color: "#475569" } },
      grid: { left: 170, right: 40, top: 34, bottom: 44 },
      xAxis: { type: "value", min: -1, max: 4, ...xName("Cpk (bars clipped to −1…4; hover for exact value)"), splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: "category", inverse: true, data: cpk.map((c) => c.label), axisTick: { show: false }, axisLabel: { color: "#1e293b", fontSize: 11 } },
      series: [
        { name: "Good parts", type: "bar", barWidth: 9, data: cpk.map((c) => clip(r2(c.ok))), itemStyle: { color: C.ok, borderRadius: 3 }, markLine: { silent: true, symbol: "none", label: { fontSize: 10 }, lineStyle: { type: "dashed" }, data: [{ xAxis: 1, lineStyle: { color: C.amber }, label: { formatter: "1.00" } }, { xAxis: CPK_TARGET, lineStyle: { color: C.green }, label: { formatter: String(CPK_TARGET) } }] } },
        { name: "Rejected parts", type: "bar", barWidth: 9, data: cpk.map((c) => clip(r2(c.ng))), itemStyle: { color: C.ng, borderRadius: 3 } },
      ],
    };
  }, [cpk]);

  /* ── Golden window + outliers ─────────────────────────────────────────── */
  const features = useMemo(() => (mlInsights.features || []).filter((f) => Number(f.meanOk || 0) > 0 || Number(f.meanNg || 0) > 0), [mlInsights.features]);

  const outlierRows = useMemo(() => {
    const term = outlierSearch.toLowerCase().trim();
    let sourceList = mlInsights.topAnomalies || [];

    // Fallback: If mlInsights.topAnomalies is empty, synthesize outlier rows from allRejectionRecords or rejectedRows
    if (!sourceList.length) {
      const ngParts = [...allRejectionRecords, ...rejectedRows];
      const seen = new Set();
      sourceList = ngParts.filter((r) => {
        const id = String(r.partId || r.part_id || r.customerQrCode || r.customer_qr || r.id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, 200).map((r, idx) => {
        // Find worst deviating parameter
        let worstParam = "—";
        let worstDev = 0;
        let worstLimits = "—";
        stats.forEach((s) => {
          const val = readParam(r, s.def);
          if (val !== null && val > 0 && s.okStd > 0) {
            const dev = Math.abs((val - s.okMean) / s.okStd);
            if (dev > worstDev) {
              worstDev = dev;
              worstParam = `${s.label} (${val} ${s.unit}, shift ${dev.toFixed(1)}σ)`;
              worstLimits = limitMap[s.key] ? `LSL: ${limitMap[s.key].lsl} | USL: ${limitMap[s.key].usl}` : "No set limits";
            }
          }
        });

        return {
          rowKey: `outlier-${idx}`,
          shotNumber: r.shotNumber || r.shot_number || extractShotFromPartId(r.partId || r.part_id || r.id),
          status: "NG",
          createdAtRaw: r.createdAtRaw || r.createdAt || r.shot_datetime || r.timestamp,
          partId: r.partId || r.part_id || r.id,
          customerQrCode: r.customerQrCode || r.customer_qr || r.qr_code,
          machineName: r.machineName || r.machine_name || r.machineCode || "",
          rejectionCategory: r.rejectionCategory || r.category || r.rejection_category || "",
          rejectionReason: r.rejectionReason || r.reason || r.rejection_reason || r.ngReason || "",
          rejectionView: r.rejectionView || r.rejection_view || "",
          rejectionZone: r.rejectionZone || r.rejection_zone || "",
          rejectionSubZone: r.rejectionSubZone || r.rejection_sub_zone || "",
          worstDeviatingParam: worstParam,
          worstParamLimits: worstLimits,
          anomalyScore: worstDev > 0 ? worstDev.toFixed(2) : null,
        };
      });
    }

    const recById = new Map();
    (allRejectionRecords || []).forEach((rec) => {
      [rec.partId, rec.part_id, rec.customerQrCode, rec.customer_qr].forEach((k) => { const key = String(k || "").trim(); if (key && !recById.has(key)) recById.set(key, rec); });
    });
    const mapped = sourceList.map((part, idx) => {
      const rec = recById.get(String(part.partId || part.part_id || "").trim()) || recById.get(String(part.customerQrCode || part.customer_qr || "").trim()) || part;
      const pd = parseRowDefect(rec);
      return {
      id: part.rowKey || part.id || `o-${idx}`,
      shot_number: part.shotNumber || part.shot_number || extractShotFromPartId(part.partId) || "—",
      shot_status: part.shot_status || (part.status === "NG" ? "NG" : "OK"),
      shot_datetime: part.createdAtRaw ? formatResultTimestamp(part.createdAtRaw) : part.shot_datetime ? formatResultTimestamp(part.shot_datetime) : part.createdAt || "—",
      barcode: part.traceabilityPartId || part.partId || part.part_id || "",
      customerCode: part.customerQrCode || part.customer_qr || "",
      machine_name: part.machineName || part.machine_name || "",
      rejection_category: pd.category || "—",
      ngReason: pd.reason && pd.reason !== "Defect" ? pd.reason : "—",
      rejection_view: pd.view || (pd.sensorReject ? "Leak test (sensor)" : "—"),
      rejection_zone: (!pd.inferred && pd.zone) || "—",
      rejection_sub_zone: (!pd.inferred && pd.subZone) || "—",
      worstDeviatingParam: part.worstDeviatingParam || "—",
      recipe_limits: part.worstParamLimits || "—",
      anomalyScore: part.anomalyScore ? `${part.anomalyScore} σ` : "—",
      };
    });
    return term ? mapped.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(term))) : mapped;
  }, [mlInsights.topAnomalies, outlierSearch, allRejectionRecords, rejectedRows, stats, limitMap]);

  const outlierColumns = useMemo(() => [
    { key: "shot_number", label: "Shot #", width: 90 }, { key: "shot_status", label: "Status", width: 90 },
    { key: "shot_datetime", label: "Recorded", width: 160, renderAsText: true }, { key: "barcode", label: "Part Serial", width: 170 },
    { key: "customerCode", label: "Customer QR", width: 200 }, { key: "machine_name", label: "Machine", width: 120 },
    { key: "rejection_category", label: "Category", width: 110 }, { key: "ngReason", label: "Rejection", width: 180 },
    { key: "rejection_view", label: "View", width: 100 }, { key: "rejection_zone", label: "Zone", width: 110 },
    { key: "rejection_sub_zone", label: "Sub Zone", width: 110 }, { key: "worstDeviatingParam", label: "Primary Excursion", width: 220 },
    { key: "recipe_limits", label: "Recipe Limits", width: 200 }, { key: "anomalyScore", label: "Z-Score", width: 110 },
  ], []);

  const exportSheet = async (name, columns, data, argb, file) => {
    if (!data.length) return;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = columns;
    const hr = sheet.getRow(1);
    hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    data.forEach((d) => sheet.addRow(d));
    saveAs(new Blob([await wb.xlsx.writeBuffer()]), `${file}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const exportGolden = () => exportSheet("Golden Window", [
    { header: "Parameter", key: "label", width: 30 }, { header: "Unit", key: "unit", width: 12 },
    { header: "LSL", key: "setLowerLimit", width: 12 }, { header: "Target", key: "setPoint", width: 12 }, { header: "USL", key: "setUpperLimit", width: 12 },
    { header: "OK Mean", key: "meanOk", width: 14 }, { header: "NG Mean", key: "meanNg", width: 14 },
    { header: "Drift %", key: "driftPct", width: 12 }, { header: "Risk", key: "riskLevel", width: 12 },
  ], features, "FF312E81", "Golden_Window");
  const exportOutliers = () => exportSheet("Outliers", outlierColumns.map((c) => ({ header: c.label, key: c.key, width: Math.round(c.width / 7) })), outlierRows, "FF7C3AED", "Outliers");

  const topDriver = influence?.items[0];
  // Precision depends on how common NG is; the test split is NG-heavy, so restate it at the plant's NG rate
  const plantPrecision = model && popRate
    ? (model.m50.recall * popRate) / ((model.m50.recall * popRate) + ((1 - model.m50.spec) * (1 - popRate)) || 1)
    : null;
  const paramOptions = ALL_45_PARAMETERS.map((p) => <option key={p.key} value={p.key}>{p.label} ({p.unit})</option>);
  const paramSelect = <select className="dl-select" value={param} onChange={(e) => setParam(e.target.value)}>{paramOptions}</select>;
  const chart = (opt, h = "100%") => <EChart option={opt} style={{ height: h, width: "100%" }} />;

  const TABS = [
    { id: "causes", label: "Rejection causes", icon: Layers, color: "#2563eb" },
    { id: "drivers", label: "Process drivers", icon: Zap, color: "#d97706" },
    { id: "model", label: "Prediction model", icon: Cpu, color: "#6366f1" },
    { id: "dist", label: "Distributions", icon: Waves, color: "#0d9488" },
    { id: "process", label: "Process control", icon: Gauge, color: "#16a34a" },
    { id: "log", label: "Outlier log", icon: ShieldAlert, color: "#ef4444" },
  ];

  /* ═════════ RENDER ═════════ */
  return (
    <div className="dl-root-cause">
      <style>{`
        .dl-root-cause{display:flex;flex-direction:column;gap:18px}
        .dl-root-cause *{box-sizing:border-box}
        .dl-hero{position:relative;background:radial-gradient(ellipse at top right,rgba(59,130,246,.22),transparent 55%),radial-gradient(ellipse at bottom left,rgba(139,92,246,.18),transparent 55%),linear-gradient(135deg,#0f172a 0%,#1e1b4b 60%,#0f172a 100%);border-radius:18px;padding:24px 28px;color:#fff;box-shadow:0 20px 50px -15px rgba(15,23,42,.6),inset 0 1px 0 rgba(255,255,255,.08);border:1px solid rgba(139,92,246,.25);overflow:hidden}
        .dl-hero::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(139,92,246,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(139,92,246,.05) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;mask-image:radial-gradient(ellipse at center,black,transparent 75%)}
        .dl-hero-row{position:relative;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
        .dl-hero-title{font-size:22px;font-weight:900;letter-spacing:-.025em;margin:0;background:linear-gradient(90deg,#fff 0%,#c7d2fe 40%,#f0abfc 80%,#fff 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
        .dl-hero-sub{margin:6px 0 0;font-size:12.5px;color:#a5b4fc;font-weight:600}
        .dl-hero-chip{background:rgba(139,92,246,.25);border:1px solid rgba(139,92,246,.55);color:#d8b4fe;font-size:9.5px;font-weight:800;padding:4px 10px;border-radius:9999px;letter-spacing:.08em;text-transform:uppercase}
        .dl-hero-stats{display:flex;gap:10px;flex-wrap:wrap}
        .dl-hero-stat{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 16px;text-align:right}
        .dl-hero-stat .l{font-size:9.5px;color:#94a3b8;display:block;text-transform:uppercase;font-weight:800;letter-spacing:.06em}
        .dl-hero-stat .v{font-size:17px;font-weight:900}
        .dl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
        .dl-stat-card{display:flex;align-items:center;gap:16px;padding:18px 22px;border-radius:16px;border:1px solid;transition:all .3s ease}
        .dl-stat-card:hover{transform:translateY(-3px);box-shadow:0 14px 28px -8px rgba(0,0,0,.18)}
        .dl-stat-icon{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;flex-shrink:0}
        .dl-stat-label{font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
        .dl-stat-value{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .dl-stat-subtext{font-size:11.5px;color:#64748b;font-weight:400;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .dl-tab-group{display:inline-flex;gap:4px;padding:4px;background:#f1f5f9;border-radius:12px;flex-wrap:wrap}
        .dl-tab{padding:8px 16px;border-radius:9px;border:none;background:transparent;font-size:12.5px;font-weight:600;color:#64748b;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:all .2s}
        .dl-tab:hover{color:#334155}
        .dl-tab.active{background:#fff;color:#1d4ed8;box-shadow:0 1px 3px rgba(15,23,42,.12),inset 0 -2px 0 #2a78d6}
        .dl-card{background:linear-gradient(160deg,#fff,#f8fafc);border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 24px -8px rgba(0,0,0,.08)}
        .dl-section-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 20px;border-bottom:1px solid #f1f5f9;background:linear-gradient(180deg,color-mix(in srgb,var(--accent,#2a78d6) 7%,#fff),#fff)}
        .dl-section-icon{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#fff;flex-shrink:0}
        .dl-section-title{font-size:14.5px;font-weight:700;color:#0f172a;margin:0;letter-spacing:-.01em}
        .dl-section-subtitle{font-size:12px;color:#64748b;margin:3px 0 0;font-weight:400}
        .dl-note{padding:10px 20px 12px;font-size:11.5px;line-height:1.5;color:#64748b;font-weight:400;border-top:1px solid #f1f5f9}
        .dl-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .dl-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:0 14px 8px}
        @media(max-width:1100px){.dl-grid2,.dl-grid3{grid-template-columns:1fr}}
        .dl-empty{display:flex;align-items:center;justify-content:center;min-height:170px;padding:24px;text-align:center;color:#94a3b8;font-size:13px;font-weight:600}
        .dl-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;padding:14px 20px}
        .dl-metric{border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;background:#fff}
        .dl-metric .l{font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.5px}
        .dl-metric .v{font-size:20px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}
        .dl-sub{padding:6px 20px 0;font-size:11.5px;font-weight:800;color:#475569}
        .dl-table{width:100%;border-collapse:collapse;font-size:12px}
        .dl-table th{position:sticky;top:0;background:#f8fafc;text-align:center;font-size:10.5px;font-weight:800;color:#64748b;text-transform:uppercase;padding:10px 8px;border-bottom:2px solid #e2e8f0}
        .dl-table th:first-child,.dl-table td:first-child{text-align:left}
        .dl-table td{padding:9px 8px;border-bottom:1px solid #f1f5f9;text-align:center;color:#1e293b}
        .dl-select{padding:7px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-size:12px;font-weight:700;color:#1e293b}
        .dl-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;font-size:12px;font-weight:800;color:#334155;cursor:pointer}
        .dl-btn:hover{background:#f8fafc}.dl-btn:disabled{opacity:.5;cursor:default}
        .dl-search{display:flex;align-items:center;gap:6px;padding:7px 11px;border:1px solid #cbd5e1;border-radius:9px;background:#fff}
        .dl-search input{border:0;outline:0;font-size:12px;width:170px}
        .dl-badge{display:inline-block;padding:2px 9px;border-radius:12px;font-size:10px;font-weight:700;color:#fff}
        .dl-influence{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:24px;padding:18px 20px 8px;align-items:start}
        @media(max-width:1100px){.dl-influence{grid-template-columns:1fr}}
        .dl-influence-text{font-size:13px;line-height:1.55;color:#334155}
        .dl-influence-text p{margin:0 0 10px}
        .dl-influence-text ul{margin:0 0 14px;padding-left:18px}
        .dl-influence-text li{margin-bottom:6px}
        .dl-influence-text b,.dl-influence-text strong{color:#0f172a;font-weight:600}
        .dl-influence-kicker{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b}
        .dl-influence-big{font-size:44px;font-weight:700;line-height:1.05;color:#0f172a;letter-spacing:-.02em;margin:4px 0 8px;font-variant-numeric:tabular-nums}
        .dl-influence-big span{font-size:24px;color:#64748b;margin-left:2px}
        .dl-influence-meter{height:6px;border-radius:3px;background:#e2e8f0;overflow:hidden;margin-bottom:14px}
        .dl-influence-meter i{display:block;height:100%;background:#1e3a8a;border-radius:3px}
        .dl-influence-legend{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#475569;padding-top:10px;border-top:1px solid #f1f5f9}
        .dl-causes{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px;align-items:start}
        @media(max-width:1100px){.dl-causes{grid-template-columns:1fr}}
        .dl-causes-list{max-height:430px;overflow:auto;padding:0 8px 8px}
        .dl-causes-list td,.dl-causes-list th{text-align:left}
        .dl-causes-list .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .dl-dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px;vertical-align:0}
        .dl-muted{color:#94a3b8;font-size:11px}
        .dl-cat{display:inline-block;padding:1px 8px;border:1px solid;border-radius:999px;font-size:11px;font-weight:600}
        .dl-sharebar{display:inline-block;width:56px;height:6px;border-radius:3px;background:#f1f5f9;margin-right:8px;vertical-align:1px;overflow:hidden}
        .dl-sharebar i{display:block;height:100%;border-radius:3px}
        .dl-seg{display:inline-flex;padding:3px;background:#f1f5f9;border-radius:9px;gap:2px}
        .dl-seg button{border:0;background:transparent;padding:5px 12px;border-radius:7px;font-size:12px;font-weight:600;color:#64748b;cursor:pointer}
        .dl-seg button.on{background:#fff;color:#1d4ed8;box-shadow:0 1px 3px rgba(15,23,42,.14)}
        .dl-influence-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 14px}
        .dl-influence-chips span{font-size:11.5px;color:#475569;background:#f1f5f9;border-radius:999px;padding:3px 10px}
        .dl-influence-foot{font-size:11px;color:#94a3b8;margin-top:12px}
        .dl-keys{display:flex;gap:12px;font-size:11.5px;color:#475569;flex-wrap:wrap}
        .dl-keys i{display:inline-block;vertical-align:-1px;margin-right:6px}
        .dl-keys i.band{width:16px;height:10px;border:1px solid #16a34a;background:rgba(22,163,74,.13);border-radius:3px}
        .dl-keys i.dot{width:10px;height:10px;border-radius:50%;background:#dc2626}
        .dl-influence-legend i{display:inline-block;width:14px;height:12px;border:1.5px solid;border-radius:3px;margin-right:8px;vertical-align:-2px}
      `}</style>

      {/* Hero — every figure is computed from loaded data */}
      {/* <div className="dl-hero">
        <div className="dl-hero-row">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <BrainCircuit size={26} color="#c4b5fd" />
              <h2 className="dl-hero-title">Root Cause &amp; Machine Learning Analytics</h2>
              <span className="dl-hero-chip">Live data</span>
              <span className="dl-hero-chip">Logistic baseline</span>
            </div>
            <p className="dl-hero-sub">Parameter screening • hold-out model diagnostics • distributions • statistical process control</p>
          </div>
          <div className="dl-hero-stats">
            <div className="dl-hero-stat"><span className="l">Samples</span><span className="v" style={{ color: "#93c5fd" }}>{counts.total.toLocaleString()}</span></div>
            <div className="dl-hero-stat"><span className="l">NG rate</span><span className="v" style={{ color: "#fca5a5" }}>{pct(counts.rate, 2)}</span></div>
            <div className="dl-hero-stat"><span className="l">Top driver</span><span className="v" style={{ color: "#fcd34d" }}>{best ? best.label : "—"}</span></div>
            <div className="dl-hero-stat"><span className="l">Model AUC</span><span className="v" style={{ color: "#86efac" }}>{model ? r3(model.auc) : "—"}</span></div>
          </div>
        </div>
      </div> */}

      <div className="dl-kpis">
        <Stat icon={Layers} label="Parts analysed" value={counts.total.toLocaleString()} sub={`${counts.ng.toLocaleString()} rejected · ${counts.ok.toLocaleString()} good (recent sample)`} color={ACCENT.neutral} />
        <Stat icon={Percent} label="Plant scrap rate" value={popRate ? pct(popRate, 2) : "—"} sub={popRate ? `${Number(summary.totalNG).toLocaleString()} NG of ${(Number(summary.totalNG) + Number(summary.totalOK)).toLocaleString()} inspected` : "Summary not loaded"} color={ACCENT.ng} />
        <Stat icon={BrainCircuit} label="Explained by PLC parameters" value={influence ? pct(influence.explained, 0) : "—"} sub={influence ? `${influence.items.length} parameters in the model` : "Not enough readings"} color={ACCENT.process} />
        <Stat icon={Zap} label="Strongest parameter" value={topDriver ? topDriver.label : "—"} sub={topDriver ? `${topDriver.pct.toFixed(1)}% of scrap · higher → ${topDriver.dir > 0 ? "more" : "less"} scrap` : "Not enough data"} color={ACCENT.model} />
        <Stat icon={Activity} label="Days above control limit" value={cChart ? cChart.ooc : "—"} sub={cChart ? `of ${cChart.pts.length} days with rejects · avg ${cChart.cBar}/day` : "No dated rejects"} color={ACCENT.warning} />
      </div>

      <div className="dl-tab-group" style={{ alignSelf: "flex-start" }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`dl-tab ${active ? "active" : ""}`}
              style={active ? { color: t.color, fontWeight: 700 } : undefined}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={14} color={active ? t.color : "#64748b"} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ═════ REJECTION CAUSES ═════ */}
      {tab === "causes" && (!causes ? (
        <Card icon={Layers} color={ACCENT.ng} badge="Causes" title="Where scrap comes from"><Empty>No rejected parts in this selection.</Empty></Card>
      ) : (
        <div className="dl-causes">
          <Card icon={Layers} color={ACCENT.ng} badge="Hierarchy" title="Where scrap comes from"
            subtitle={`${causes.total.toLocaleString()} rejected parts · inner ring station · middle defect category · outer defect`}
            height={470}>
            {chart(causesOption)}
          </Card>
          <Card icon={Target} color={ACCENT.ng} badge="Vital Few 80%" title="Top rejection causes"
            subtitle={`${causes.vital} of ${causes.top.length} station–defect combinations make up 80% of rejects`}>
            <div className="dl-causes-list">
              <table className="dl-table">
                <thead><tr><th>#</th><th>Station</th><th>Category</th><th>Defect</th><th className="num">Parts</th><th className="num">Share</th><th className="num">Cumulative</th></tr></thead>
                <tbody>
                  {causes.top.slice(0, 15).map((t, i) => (
                    <tr key={`${t.st}-${t.cat}-${t.def}`}>
                      <td style={{ color: INK.faint }}>{i + 1}</td>
                      <td style={{ whiteSpace: "nowrap" }}><span className="dl-dot" style={{ background: stationColor(t.st) }} />{t.st} <span className="dl-muted">{STATION_NAME[t.st] || ""}</span></td>
                      <td><span className="dl-cat" style={{ color: DEFECT_CATEGORY[t.cat] || INK.body, borderColor: DEFECT_CATEGORY[t.cat] || INK.border }}>{t.cat}</span></td>
                      <td style={{ fontWeight: 600, color: INK.primary }}>{t.def}</td>
                      <td className="num">{t.n.toLocaleString()}</td>
                      <td className="num"><span className="dl-sharebar"><i style={{ width: `${Math.min(100, (t.n / causes.top[0].n) * 100)}%`, background: stationColor(t.st) }} /></span>{t.share.toFixed(1)}%</td>
                      <td className="num" style={{ color: t.cum - t.share < 80 ? INK.primary : INK.faint }}>{t.cum.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ))}

      {/* ═════ DRIVERS ═════ */}
      {tab === "drivers" && (
        <>
          <Card icon={BrainCircuit} color={ACCENT.process}
            title={infView === "swarm" ? "What drives scrap? — process parameter impact" : "Process parameter influence on scrap — sensitivity (tornado)"}
            subtitle={infView === "swarm"
              ? "Each dot is one part · position = how much the parameter pushed that part toward scrap · colour = the parameter's value"
              : "Predicted scrap rate with each parameter at the low vs high end of its good-part range, others at average"}
            right={<div className="dl-seg" role="tablist" aria-label="Chart style">
              <button type="button" role="tab" aria-selected={infView === "swarm"} className={infView === "swarm" ? "on" : ""} onClick={() => setInfView("swarm")}>Impact per part</button>
              <button type="button" role="tab" aria-selected={infView === "tornado"} className={infView === "tornado" ? "on" : ""} onClick={() => setInfView("tornado")}>Sensitivity</button>
            </div>}>
            {!influence ? (
              <Empty>Need at least 5 good and 5 rejected parts with PLC cycle readings.</Empty>
            ) : (
              <div className="dl-influence">
                <div className="dl-influence-text">
                  <div className="dl-influence-kicker">Explained by PLC parameters</div>
                  <div className="dl-influence-big">{(influence.explained * 100).toFixed(0)}<span>%</span></div>
                  <div className="dl-influence-meter" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, influence.explained * 100)}%` }} />
                  </div>
                  <div className="dl-influence-kicker" style={{ marginTop: 6 }}>Not explained · {(100 - influence.explained * 100).toFixed(0)}%</div>
                  <div className="dl-influence-chips">
                    <span>Raw material</span><span>Die spray coverage</span><span>Die condition</span>
                  </div>
                  {infView === "swarm" ? (
                    <div className="dl-influence-legend">
                      <span><i style={{ background: "#cfdaee", borderColor: "#9fb2d6" }} />Statistically significant (p &lt; 0.05) — {influence.nSig}</span>
                      <span><i style={{ background: "#eef1f6", borderColor: "#d5dbe6" }} />Not significant — {influence.items.length - influence.nSig}</span>
                      <span><b style={{ color: OUTCOME.ng, marginRight: 6 }}>▲</b>Higher value raises scrap ({influence.nHigher})</span>
                      <span><b style={{ color: DIVERGING.low, marginRight: 6 }}>▼</b>Higher value lowers scrap ({influence.nLower})</span>
                      <span style={{ display: "block", marginTop: 4, color: INK.muted }}>Sorted by average size of the effect. Red dots on the right = a high reading that pushed that part toward scrap.</span>
                    </div>
                  ) : (
                    <div className="dl-influence-legend">
                      <span><i style={{ background: TORNADO_LOW, borderColor: TORNADO_LOW }} />Parameter at low end (P10 of good parts)</span>
                      <span><i style={{ background: TORNADO_HIGH, borderColor: TORNADO_HIGH }} />Parameter at high end (P90 of good parts)</span>
                      <span><i style={{ background: "transparent", borderColor: INK.primary }} />Whisker = approx. 95% CI · faded = not significant</span>
                      <span><b style={{ color: OUTCOME.ng, marginRight: 6 }}>▲</b>Higher value raises scrap ({influence.nHigher})</span>
                      <span><b style={{ color: DIVERGING.low, marginRight: 6 }}>▼</b>Higher value lowers scrap ({influence.nLower})</span>
                    </div>
                  )}
                  <div className="dl-influence-foot">
                    {influence.n.toLocaleString()} parts · weighted to plant scrap rate {popRate ? pct(popRate, 1) : "—"} · {influence.holdout ? "hold-out" : "in-sample"} R² · {influence.nSig} of {influence.items.length} parameters significant (p &lt; 0.05)
                  </div>
                </div>
                <div style={{ height: (infView === "swarm" ? influence.swarm.rows.length : influence.items.length) * (infView === "swarm" ? SWARM_ROW : 26) + 80, minWidth: 0 }}>
                  {infView === "swarm" ? (swarmOption ? chart(swarmOption) : <Empty>Not enough readings.</Empty>) : chart(influenceOption)}
                </div>
              </div>
            )}
          </Card>
          <div className="dl-grid2">
            <Card icon={Sliders} color={ACCENT.ok} title="Rejected parts vs good-part operating window"
              right={<div className="dl-keys"><span><i className="band" />Good parts (middle 80%)</span><span><i className="dot" />Rejected median</span></div>}
              height={Math.max(300, 72 + windowData.length * 34)}>
              {windowOption ? chart(windowOption) : <Empty>Not enough readings.</Empty>}
            </Card>
            <Card icon={Gauge} color={ACCENT.ng} title="Scrap rate by operating range"
              right={popRate ? <span className="dl-sub" style={{ padding: 0 }}>average {pct(popRate, 1)}</span> : null}
              height={Math.max(300, 72 + windowData.length * 34)}>
              {riskOption ? chart(riskOption) : <Empty>Not enough readings.</Empty>}
            </Card>
          </div>
          <Card icon={Layers} color={ACCENT.process} title="How the top parameters move together" height={430}>
            {corr.feats.length >= 2 ? chart(corrOption) : <Empty>Not enough ranked parameters.</Empty>}
          </Card>
        </>
      )}

      {/* ═════ MODEL ═════ */}
      {tab === "model" && (
        <>
          <Card icon={Cpu} color={ACCENT.model} title="Multivariate Model — Logistic Regression (hold-out test)"
            subtitle={model ? `Top ${model.feats.length} parameters, standardised • ${model.nTrain.toLocaleString()} train / ${model.nTest.toLocaleString()} test parts (${model.nTestNg} NG) • class-weighted` : "Fits when enough parts have all top parameters recorded"}
            right={model && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="dl-badge" style={{ background: "#4f46e5", padding: "4px 12px", fontSize: 11, fontWeight: 600, borderRadius: 6 }}>{model.feats.length} Features Active</span>
              <span className="dl-badge" style={{ background: "#16a34a", padding: "4px 12px", fontSize: 11, fontWeight: 600, borderRadius: 6 }}>AUC {r3(model.auc)}</span>
            </div>}
            note="Class-weighted L2-regularized logistic baseline model. Hold-out 70/30 stratified cross-validation on serial production parts.">
            {!model ? (
              <Empty>Need ≥{MIN_MODEL_PER_CLASS} OK and NG parts with all top parameters present, enough for a 70/30 split.</Empty>
            ) : (
              <div className="dl-metrics">
                {[
                  ["AUROC (95% CI)", aucWithCi(model.auc, model.aucSe), "#16a34a", "rgba(22,163,74,0.06)"],
                  ["Avg precision (plant)", r3(model.pr.apPlant), "#2563eb", "rgba(37,99,235,0.06)"],
                  ["Recall @0.5", pct(model.m50.recall), "#0891b2", "rgba(8,145,178,0.06)"],
                  ["Precision @0.5 (plant)", plantPrecision === null ? pct(model.m50.precision) : pct(plantPrecision), "#4f46e5", "rgba(79,70,229,0.06)"],
                  ["Specificity", pct(model.m50.spec), "#059669", "rgba(5,150,105,0.06)"],
                  ["F1 Score @0.5", r3(model.m50.f1), "#7c3aed", "rgba(124,58,237,0.06)"],
                  ["Balanced Accuracy", pct(model.bacc), "#d97706", "rgba(217,119,6,0.06)"],
                  ["Optimal Threshold", `${model.best.t} (F1 ${r3(model.best.f1)})`, "#e11d48", "rgba(225,29,72,0.06)"],
                ].map(([l, v, c, bg]) => (
                  <div className="dl-metric" key={l} style={{ borderLeft: `3px solid ${c}`, background: bg }}>
                    <div className="l">{l}</div>
                    <div className="v" style={{ fontSize: String(v).length > 12 ? 15 : 20, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {model ? (
            <>
              <div className="dl-grid2">
                <Card icon={TrendingUp} color={ACCENT.model} badge="ROC / AUC" title="ROC curve — model vs top single parameter" subtitle={`Hold-out test set: ${model.nTest.toLocaleString()} parts (${model.nTestNg} NG) · ◆ operating thresholds`} height={400}>{chart(rocOption)}</Card>
                <Card icon={TrendingUp} color={ACCENT.model} badge="PR Curve" title="Precision–recall — NG detection" subtitle="NG is the rare class, so precision is restated at the plant NG rate · ◆ operating thresholds" height={400}>{chart(prOption)}</Card>
              </div>
              <div className="dl-grid2">
                <Card icon={Sliders} color={ACCENT.model} badge="Thresholds" title="Threshold Analysis" subtitle="Precision, recall and F1 vs decision threshold; pin = optimal F1" height={360}>{chart(sweepOption)}</Card>
                <Card icon={BarChart3} color={ACCENT.model} badge="Distribution" title="Risk Score Distribution" subtitle="Predicted NG probability density by actual part outcome" height={360}>{chart(histOption)}</Card>
              </div>
              <div className="dl-grid2">
                <Card icon={Target} color={ACCENT.model} badge="Gain & Lift" title="Cumulative Gain & Lift" subtitle="Scrap detected by targeting parts in order of predicted risk" height={360}>{chart(gainOption)}</Card>
                <Card icon={Layers} color={ACCENT.model} badge="Confusion Matrix" title="Confusion Matrix (threshold 0.5)" subtitle="Validation classification outcomes and error rates" height={360}>{cmOption && chart(cmOption)}</Card>
              </div>
              <div className="dl-grid2">
                <Card icon={Zap} color={ACCENT.model} badge="Log-Odds Weights" title="Model Coefficients" subtitle="Standardised log-odds per σ. Rose increases risk, cyan lowers risk" height={360}>{coefOption && chart(coefOption)}</Card>
                <Card icon={Waves} color={ACCENT.model} badge="Partial Dependence" title="Partial Dependence" subtitle="Marginal risk score variation across single parameter spectrum"
                  right={<select className="dl-select" value={activePd?.key || ""} onChange={(e) => setPdKey(e.target.value)}>{model.feats.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>}
                  height={360}>{pdOption && chart(pdOption)}</Card>
              </div>
            </>
          ) : stats.length > 0 && (
            <Card icon={TrendingUp} color={ACCENT.model} title="ROC curve — top single parameter" subtitle="Multivariate model unavailable (not enough complete parts)" height={400}>{rocOption && chart(rocOption)}</Card>
          )}
        </>
      )}

      {/* ═════ DISTRIBUTIONS ═════ */}
      {tab === "dist" && (
        <>
          <div className="dl-grid2">
            <Card icon={Waves} color={ACCENT.process} badge="KDE Curve" title="Density — OK vs NG" subtitle="Kernel density per class (area-normalised). Dashed amber = set limits when known"
              right={paramSelect} height={360}>
              {densityOption ? chart(densityOption) : <Empty>Need ≥10 OK and ≥5 NG readings for this parameter.</Empty>}
            </Card>
            <Card icon={ScatterIcon} color={ACCENT.process} badge="Raw Strip" title="Strip Plot — Good vs NG" subtitle="Each dot is a part (max 500 per group). Dashed lines = group means" height={360}
              right={<span className="dl-sub" style={{ padding: 0 }}>{sel.def.label}</span>}>
              {sel.ok.length + sel.ng.length ? chart(stripOption) : <Empty>No readings for this parameter.</Empty>}
            </Card>
          </div>
          <FacetedBoxPlot rows={rows} allRejectionRecords={allRejectionRecords} rejectedRows={rejectedRows} okRecords={okRecords} paramKeys={ranked.map((st) => st.key)} />
          <Card icon={ScatterIcon} color={ACCENT.process} badge="2D Correlation" title="Parameter Pair Scatter"
            subtitle={`${scatterOption.counts.ok.toLocaleString()} OK • ${scatterOption.counts.ng.toLocaleString()} NG • scroll or use the slider to zoom`}
            right={<div style={{ display: "flex", gap: 6 }}>
              <select className="dl-select" value={scatterX} onChange={(e) => setScatterX(e.target.value)}>{paramOptions}</select>
              <select className="dl-select" value={scatterY} onChange={(e) => setScatterY(e.target.value)}>{paramOptions}</select>
            </div>} height={480}>
            {scatterOption.counts.ok + scatterOption.counts.ng ? chart(scatterOption.option) : <Empty>No parts have both parameters recorded.</Empty>}
          </Card>
        </>
      )}

      {/* ═════ PROCESS CONTROL ═════ */}
      {tab === "process" && (
        <>
          <Card icon={Activity} color={ACCENT.warning} badge="c-Chart" title="Daily rejects — control chart"
            subtitle="Average ± 3√average (c-chart). Red points are days above the upper limit."
            height={380} note="Counts only days that had rejects and assumes similar daily output.">
            {cOption ? chart(cOption) : <Empty>Need dated rejects across at least 3 days.</Empty>}
          </Card>
          <Card icon={Gauge} color={ACCENT.quality} badge="Process Capability" title="Process capability — good vs rejected parts (Cpk)"
            subtitle={`Parameters with set limits, worst NG capability first. Green line = ${CPK_TARGET}, amber = 1.00`}
            height={Math.max(300, 100 + cpk.length * 34)} note="Cpk assumes roughly normal, stable data and uses each group's own mean and σ.">
            {cpkOption ? chart(cpkOption) : <Empty>No parameters have both set limits and enough OK/NG readings.</Empty>}
          </Card>
          <Card icon={Sliders} color={ACCENT.process} badge="Recipe Drift" title="Set limits vs good and rejected averages" subtitle="Limits from the master recipe; 9999 placeholders shown as not set"
            right={<button className="dl-btn" onClick={exportGolden} disabled={!features.length}><Download size={14} /> Export</button>}>
            {!features.length ? <Empty>No parameter statistics available.</Empty> : (
              <div style={{ maxHeight: 440, overflowY: "auto" }}>
                <table className="dl-table">
                  <thead><tr><th>Parameter</th><th>LSL</th><th>Target</th><th>USL</th><th>OK mean</th><th>NG mean</th><th>σ (OK)</th><th>Drift</th><th>Z</th><th>Risk</th></tr></thead>
                  <tbody>
                    {features.map((f) => {
                      const hasLimits = !!limitMap[f.key];
                      const z = f.stdOk > 0 ? Math.abs((f.meanNg - f.meanOk) / f.stdOk) : 0;
                      const out = hasLimits && (f.meanNg > f.setUpperLimit || f.meanNg < f.setLowerLimit);
                      const rc = f.riskLevel === "CRITICAL" ? "#dc2626" : f.riskLevel === "MODERATE" ? "#d97706" : "#16a34a";
                      return (
                        <tr key={f.key} style={{ background: out ? "rgba(239,68,68,0.06)" : undefined }}>
                          <td><strong>{f.label}</strong> <span style={{ color: "#94a3b8", fontSize: 10.5 }}>({f.unit})</span></td>
                          <td>{hasLimits ? f.setLowerLimit : "—"}</td><td>{hasLimits ? f.setPoint ?? "—" : "—"}</td><td>{hasLimits ? f.setUpperLimit : "—"}</td>
                          <td style={{ color: "#16a34a", fontWeight: 800 }}>{f.meanOk}</td><td style={{ color: "#dc2626", fontWeight: 800 }}>{f.meanNg}</td>
                          <td>{f.stdOk || "—"}</td>
                          <td style={{ fontWeight: 800 }}>{f.driftPct != null ? `${f.driftPct > 0 ? "+" : ""}${f.driftPct}%` : "—"}</td>
                          <td style={{ fontWeight: 800 }}>{z > 0 ? `${z.toFixed(1)}σ` : "—"}</td>
                          <td>{f.riskLevel ? <span className="dl-badge" style={{ background: rc, boxShadow: `0 2px 6px ${rc}40` }}>{f.riskLevel}</span> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ═════ OUTLIER LOG ═════ */}
      {tab === "log" && (
        <Card icon={ShieldAlert} color={ACCENT.ng} badge="Live Anomalies" title="Process Excursion & Outlier Log" subtitle={`${outlierRows.length} flagged records`}
          right={<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="dl-search"><Search size={14} color="#94a3b8" /><input placeholder="Search..." value={outlierSearch} onChange={(e) => setOutlierSearch(e.target.value)} /></div>
            <button className="dl-btn" onClick={exportOutliers} disabled={!outlierRows.length}><Download size={14} /> Export</button>
          </div>}>
          <div style={{ padding: "8px 18px 18px" }}>
            <RejectionTable columns={outlierColumns} rows={outlierRows} loading={loading} defaultPageSize={50} pageSizeOptions={[25, 50, 100, 250, 500]} />
          </div>
        </Card>
      )}
    </div>
  );
}