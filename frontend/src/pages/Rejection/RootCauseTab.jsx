import React, { useEffect, useMemo, useState } from "react";
import { Zap, Download, Search, Waves, Gauge, GitBranch, Layers, ShieldAlert, Loader2 } from "lucide-react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import EChart from "../../components/charts/EChart";
import RejectionTable from "./RejectionTable";
import {
  formatResultTimestamp, extractShotFromPartId, ALL_45_PARAMETERS, parseRowDefect,
} from "./rejectionConstants";
import {
  OUTCOME, CATEGORICAL, OTHER, DIVERGING, DEFECT_CATEGORY, STATUS, INK, FONT_FAMILY,
  ECHART_TOOLTIP, LEGEND, SEQ_SCRAP, ACCENT, CARD_CSS, accent, withAlpha,
  baseOption, valueAxis, categoryAxis, axisName, axisLabel, tooltipHtml,
} from "./chartTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */
const NG_STATUS = new Set(["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"]);
const OK_STATUS = new Set(["OK", "PASSED", "ENDED_OK", "COMPLETED_OK"]);
const MIN_PER_CLASS = 2;      // OK and NG readings needed to keep a parameter at all
const MIN_RANK_PER_CLASS = 5; // OK and NG readings needed to rank a parameter as a driver
const MAX_DRIVERS = 12;
// Direction of the NG shift (not an outcome, so not green / red): higher in NG = orange, lower in NG = blue
const HIGHER = CATEGORICAL[1];
const LOWER = DIVERGING.low;
const LIMIT_C = STATUS.warning;
const STATION_NAME = { OP100: "DCM + DPM", OP110: "Laser marking", OP120: "Casting PDi", OP130: "Pre-inspection", OP140: "Auto gauging", OP150: "Leak test", OP160: "Final inspection" };
// OK-green and NG-red are reserved for outcome, so stations use the remaining slots
const STATION_COLOR = { OP120: CATEGORICAL[0], OP130: CATEGORICAL[1], OP150: CATEGORICAL[6], OP160: CATEGORICAL[3], OP140: CATEGORICAL[4] };
const stationColor = (st) => STATION_COLOR[st] || OTHER;
const BANDS = ["0–20", "20–40", "40–60", "60–80", "80–100"];

/* ═══════════════════════════════════════════════════════════════════════════
   STATS HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */
const idOf = (r) => String(r?.partId || r?.part_id || r?.customerQrCode || r?.customer_qr || r?.id || "");

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
const sampleEvenly = (a, max) => (a.length <= max ? a : a.filter((_, i) => i % Math.ceil(a.length / max) === 0));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
const quantile = (sorted, q) => { if (!sorted.length) return 0; const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo); };
const r2 = (v) => Number(Number(v).toFixed(2));
const pct = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const signed = (v, d = 2) => `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}`;
const fmtP = (p) => (!Number.isFinite(p) ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));

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

// Gaussian KDE (Silverman bandwidth), density normalised per class
const kde = (vals, grid) => {
  const n = vals.length;
  const sd = std(vals);
  if (n < 3 || !(sd > 0)) return grid.map(() => 0);
  const h = 1.06 * sd * Math.pow(n, -0.2);
  const norm = 1 / (n * h * Math.sqrt(2 * Math.PI));
  return grid.map((g) => { let s = 0; for (let i = 0; i < n; i++) { const u = (g - vals[i]) / h; s += Math.exp(-0.5 * u * u); } return s * norm; });
};

// Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7)
const normCdf = (x) => {
  const u = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * u);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-u * u);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
};

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
// L2-regularised logistic regression (batch gradient descent); sw = per-sample weights (plant OK/NG mix)
const trainLogReg = (X, y, { epochs = 300, lr = 0.3, l2 = 0.02, sw }) => {
  const n = X.length, d = X[0].length;
  const w = new Array(d).fill(0);
  const wp = y.reduce((s, v, i) => s + (v ? sw[i] : 0), 0), wt = sw.reduce((s, v) => s + v, 0);
  let b = Math.log(Math.max(1e-6, wp) / Math.max(1e-6, wt - wp));
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const err = (sigmoid(z) - y[i]) * sw[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= (lr * gb) / n;
  }
  return { w, b };
};

// true below the given width (phones) — used to shrink chart label gutters
const useNarrow = (px = 640) => {
  const q = `(max-width:${px}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [q]);
  return narrow;
};

/* ═══════════════════════════════════════════════════════════════════════════
   UI PIECES
   ═══════════════════════════════════════════════════════════════════════════ */
const Card = ({ color, icon, title, sub, actions, children, className = "", bodyClass = "ra-card-body" }) => (
  <section className={`ra-card ${className}`} data-accent style={accent(color)}>
    <div className="ra-card-head">
      <div className="rc-head-l">
        <span className="ra-icon">{icon}</span>
        <div style={{ minWidth: 0 }}>
          <h3 className="ra-card-title">{title}</h3>
          {sub && <p className="ra-card-sub">{sub}</p>}
        </div>
      </div>
      {actions && <div className="rc-actions">{actions}</div>}
    </div>
    <div className={bodyClass}>{children}</div>
  </section>
);

const Kpi = ({ label, value, color }) => (
  <div className="ra-kpi" data-accent style={accent(color)}>
    <div className="ra-kpi-label">{label}</div>
    <div className="ra-kpi-value rc-kpi-value" title={typeof value === "string" ? value : undefined}>{value}</div>
  </div>
);

const Empty = ({ children }) => <div className="rc-empty">{children}</div>;
const Loading = ({ children = "Loading process data…" }) => (
  <div className="rc-empty" role="status"><Loader2 size={18} className="rc-spin" /> {children}</div>
);

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
  const [param, setParam] = useState("");
  const [outlierSearch, setOutlierSearch] = useState("");
  const narrow = useNarrow();

  const mlFeatures = useMemo(() => mlInsights?.features || [], [mlInsights]);
  // The parent loads telemetry + ML insights lazily when this tab opens
  const waiting = !mlFeatures.length && !(rows || []).length;

  /* ── 1. Labelled sample pool (one entry per part, outcome known) ─────── */
  const pool = useMemo(() => {
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
    return { total: pool.length, ng, ok: pool.length - ng };
  }, [pool]);

  // The sample holds every NG part but only a slice of OK parts, so each class is re-weighted to the
  // plant mix from the summary (NG / (OK + NG)) to keep rates plant-accurate.
  const popRate = useMemo(() => {
    const ng = Number(summary?.totalNG), ok = Number(summary?.totalOK);
    return ng > 0 && ok > 0 ? ng / (ng + ok) : null;
  }, [summary]);
  const classW = useMemo(() => {
    if (!popRate || !counts.ng || !counts.ok) return { ng: 1, ok: 1 };
    return { ng: popRate / (counts.ng / counts.total), ok: (1 - popRate) / (counts.ok / counts.total) };
  }, [popRate, counts]);

  /* ── 2. Per-parameter OK vs NG statistics (readings ≤ 0 = no reading) ── */
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
        okMean: mean(okVals), okStd, ngMean: mean(ngVals), ngStd: std(ngVals), allMean: mean([...okVals, ...ngVals]),
        shift: (mean(ngVals) - mean(okVals)) / okStd,
        auc, sep: Math.max(auc, 1 - auc),
      });
      mapsOut[p.key] = m;
    });
    list.sort((a, b) => b.sep - a.sep);
    return { stats: list, maps: mapsOut };
  }, [pool]);

  /* ── 3. Share of scrap explained by the PLC parameters ──────────────────
     One plant-weighted logistic model on every well-covered parameter.
     explained = Nagelkerke R² on a 30% hold-out (in-sample when the hold-out is too small);
     per-parameter share = log-likelihood lost when that parameter is held at its mean, scaled to the total. */
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
    const fit = (idx) => trainLogReg(idx.map((i) => X[i]), idx.map((i) => y[i]), { sw: idx.map((i) => sw[i]) });

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
    const explained = r2Holdout ?? nagelkerke(llFull, nullLogLik(all, prevOf(all)), wsum(all));
    const contrib = feats.map((_, j) => {
      const w2 = full.w.slice();
      w2[j] = 0;
      return Math.max(0, llFull - logLik(w2, full.b, all));
    });
    const totC = contrib.reduce((a, c) => a + c, 0) || 1;
    const share = Object.fromEntries(feats.map((ft, j) => [ft.key, (contrib[j] / totC) * explained * 100]));
    return { explained, holdout: r2Holdout !== null, share, nFeats: feats.length };
  }, [stats, maps, pool, counts, classW]);

  /* ── 4. Ranked drivers: NG mean shift in σ of good parts + Welch test ── */
  const drivers = useMemo(() => {
    const eligible = stats.filter((s) => s.ok.length >= MIN_RANK_PER_CLASS && s.ng.length >= MIN_RANK_PER_CLASS);
    return (eligible.length ? eligible : stats).map((s) => {
      const se = Math.sqrt(s.okStd ** 2 / s.ok.length + s.ngStd ** 2 / s.ng.length);
      const pval = se > 0 ? 2 * (1 - normCdf(Math.abs((s.ngMean - s.okMean) / se))) : NaN;
      return { ...s, pval, sig: Number.isFinite(pval) && pval < 0.05, share: influence?.share[s.key] ?? null };
    }).sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift)).slice(0, MAX_DRIVERS);
  }, [stats, influence]);

  const activeParam = param || drivers[0]?.key || ALL_45_PARAMETERS[0]?.key;

  /* ── 5. Set limits from the analysis service (9999 = not set) ────────── */
  const limitMap = useMemo(() => {
    const m = {};
    mlFeatures.forEach((f) => {
      const lsl = Number(f.setLowerLimit), usl = Number(f.setUpperLimit);
      if (f.setLowerLimit != null && f.setUpperLimit != null && Number.isFinite(lsl) && Number.isFinite(usl) && usl > lsl && usl < 9999 && lsl > -9999) m[f.key] = { lsl, usl };
    });
    return m;
  }, [mlFeatures]);

  /* ── 6. Selected parameter (OK vs NG distribution) ───────────────────── */
  const sel = useMemo(() => {
    const def = ALL_45_PARAMETERS.find((p) => p.key === activeParam) || ALL_45_PARAMETERS[0];
    const ok = [], ng = [];
    pool.forEach(({ r, ng: isNg }) => {
      const v = readParam(r, def);
      if (v === null || v <= 0) return;
      (isNg ? ng : ok).push(v);
    });
    return { def, ok, ng, okMean: mean(ok), ngMean: mean(ng), okStd: std(ok) };
  }, [pool, activeParam]);

  /* ── 7. Rejection causes: station × defect from every NG record ──────── */
  const causes = useMemo(() => {
    const recs = allRejectionRecords || [];
    if (!recs.length) return null;
    const flat = {};
    let total = 0;
    recs.forEach((rec) => {
      const q = Number(rec.quantity) || 1;
      const st = String(rec.ngGate || rec.ng_gate || "").toUpperCase().split(/[,;\s]+/).filter(Boolean)[0] || "—";
      const pd = parseRowDefect(rec);
      const cat = pd.category || "—";
      const def = pd.reason && pd.reason !== "Defect" ? pd.reason : "Unspecified";
      total += q;
      const k = `${st}|${cat}|${def}`;
      flat[k] = (flat[k] || 0) + q;
    });
    const top = [];
    let cum = 0;
    for (const [k, n] of Object.entries(flat).sort((a, b) => b[1] - a[1])) {
      const [st, cat, def] = k.split("|");
      cum += n;
      top.push({ st, cat, def, n, share: (n / total) * 100, cum: (cum / total) * 100 });
    }
    const vital = top.findIndex((t) => t.cum >= 80) + 1 || top.length;
    return { total, top, vital };
  }, [allRejectionRecords]);

  /* ── 8. Defect reason ↔ parameter: NG parts of each defect vs good parts (σ) ── */
  const defectLink = useMemo(() => {
    if (!drivers.length) return null;
    const reasonById = new Map();
    [allRejectionRecords, rejectedRows].forEach((l) => (l || []).forEach((r) => {
      const id = idOf(r);
      if (!id || reasonById.has(id)) return;
      const pd = parseRowDefect(r);
      if (pd.reason && pd.reason !== "Defect") reasonById.set(id, pd.reason);
    }));
    if (!reasonById.size) return null;
    const feats = drivers.slice(0, 8);
    const cnt = {};
    pool.forEach((p) => { if (p.ng) { const rs = reasonById.get(p.id); if (rs) cnt[rs] = (cnt[rs] || 0) + 1; } });
    const reasons = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, n }));
    if (!reasons.length) return null;
    const cells = [];
    feats.forEach((f, row) => reasons.forEach((rs, col) => {
      const vals = f.ng.filter((x) => reasonById.get(x.id) === rs.name).map((x) => x.v);
      const mu = vals.length ? mean(vals) : null;
      cells.push({ row, col, n: vals.length, mu, z: vals.length >= 3 ? (mu - f.okMean) / f.okStd : null });
    }));
    if (!cells.some((c) => c.z !== null)) return null;
    return { feats, reasons, cells };
  }, [drivers, allRejectionRecords, rejectedRows, pool]);

  /* ── 9. Plant-calibrated NG rate per fifth of the good-part range ─────── */
  const riskMap = useMemo(() => {
    const feats = drivers.slice(0, 8);
    if (!feats.length) return null;
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
    return { feats, cells, max: Math.max(max, (popRate || 0) * 100 * 2, 1) };
  }, [drivers, classW, popRate]);

  /* ═════════ CHART OPTIONS ═════════ */
  const labelW = narrow ? 92 : 180;

  const driverOption = useMemo(() => {
    if (!drivers.length) return null;
    const lim = Math.max(1, Math.ceil(Math.max(...drivers.map((d) => Math.abs(d.shift))) * 1.25 * 2) / 2);
    return {
      ...baseOption(),
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "item",
        formatter: (p) => {
          const d = drivers[p.dataIndex];
          if (!d) return "";
          const lim2 = limitMap[d.key];
          return tooltipHtml({
            title: `${d.label}${d.unit ? ` (${d.unit})` : ""}`,
            subtitle: d.shift >= 0 ? "NG parts run higher than OK parts" : "NG parts run lower than OK parts",
            rows: [
              { label: "OK mean", value: `${r2(d.okMean)} ${d.unit}`, color: OUTCOME.ok },
              { label: "NG mean", value: `${r2(d.ngMean)} ${d.unit}`, color: OUTCOME.ng },
              { label: "Shift (σ of OK)", value: `${signed(d.shift)}σ` },
              { label: "Separation (AUC)", value: d.sep.toFixed(2) },
              { label: "p-value", value: fmtP(d.pval) },
              d.share !== null ? { label: "Share of explained scrap", value: `${d.share.toFixed(1)}%` } : null,
              lim2 ? { label: "Set limits", value: `${lim2.lsl} – ${lim2.usl}` } : null,
              { label: "Readings OK / NG", value: `${d.ok.length.toLocaleString()} / ${d.ng.length.toLocaleString()}`, strong: false },
            ],
            note: "Click to open the OK vs NG distribution.",
          });
        },
      },
      grid: { left: 4, right: 52, top: 6, bottom: 34, containLabel: true },
      xAxis: valueAxis({
        min: -lim, max: lim,
        ...axisName("NG shift vs OK mean (σ)", 24),
        axisLabel: axisLabel({ formatter: (v) => (v > 0 ? `+${v}` : `${v}`) }),
      }),
      yAxis: categoryAxis(drivers.map((d) => d.label), {
        inverse: true, axisLine: { show: false },
        axisLabel: axisLabel({ fontSize: 11, color: INK.secondary, width: labelW, overflow: "truncate" }),
      }),
      series: [{
        type: "bar", barWidth: 13, cursor: "pointer",
        data: drivers.map((d) => ({
          value: r2(d.shift), key: d.key,
          itemStyle: {
            color: d.shift >= 0 ? HIGHER : LOWER, opacity: d.sig ? 1 : 0.35,
            borderRadius: d.shift >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
            borderColor: d.key === activeParam ? INK.primary : "transparent", borderWidth: d.key === activeParam ? 1.5 : 0,
          },
          label: { position: d.shift >= 0 ? "right" : "left" },
        })),
        label: { show: true, fontSize: 10.5, color: INK.body, fontFamily: FONT_FAMILY, formatter: (p) => `${signed(p.value, 1)}σ` },
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: INK.faint, width: 1 }, data: [{ xAxis: 0 }] },
      }],
    };
  }, [drivers, limitMap, activeParam, labelW]);

  const driverEvents = useMemo(() => ({ click: (p) => { if (p?.data?.key) setParam(p.data.key); } }), []);

  // Density (KDE) OK vs NG for the selected parameter, with set limits when known
  const densityOption = useMemo(() => {
    if (sel.ok.length < 3 && sel.ng.length < 3) return null;
    const okV = sampleEvenly(sel.ok, 2000), ngV = sampleEvenly(sel.ng, 2000);
    const sorted = [...okV, ...ngV].sort((a, b) => a - b);
    const lo = sorted.length > 5 ? quantile(sorted, 0.01) : sorted[0] * 0.9;
    const hi = sorted.length > 5 ? quantile(sorted, 0.99) : sorted[sorted.length - 1] * 1.1;
    if (!(hi > lo)) return null;
    const grid = Array.from({ length: 90 }, (_, i) => lo + ((hi - lo) * i) / 89);
    const dOk = kde(okV, grid), dNg = kde(ngV, grid);
    const lim = limitMap[sel.def.key];
    const unit = sel.def.unit || "";
    const limLines = lim ? [
      { xAxis: lim.lsl, label: { formatter: "LSL" } },
      { xAxis: lim.usl, label: { formatter: "USL" } },
    ].filter((l) => l.xAxis >= lo && l.xAxis <= hi) : [];
    return {
      ...baseOption(),
      tooltip: {
        ...ECHART_TOOLTIP, trigger: "axis",
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex;
          if (i === undefined) return "";
          return tooltipHtml({
            title: `${r2(grid[i])} ${unit}`,
            subtitle: sel.def.label,
            rows: [
              { label: "OK density", value: dOk[i].toPrecision(3), color: OUTCOME.ok },
              { label: "NG density", value: dNg[i].toPrecision(3), color: OUTCOME.ng },
            ],
          });
        },
      },
      legend: { ...LEGEND, data: [`OK (n=${sel.ok.length.toLocaleString()})`, `NG (n=${sel.ng.length.toLocaleString()})`] },
      grid: { left: 12, right: 18, top: 30, bottom: 36, containLabel: true },
      xAxis: valueAxis({ min: r2(lo), max: r2(hi), ...axisName(`${sel.def.label}${unit ? ` (${unit})` : ""}`, 24), splitLine: { show: false }, axisLine: { show: true, lineStyle: { color: INK.axis } } }),
      yAxis: valueAxis({ axisLabel: { show: false } }),
      series: [
        {
          name: `OK (n=${sel.ok.length.toLocaleString()})`, type: "line", smooth: true, showSymbol: false,
          data: grid.map((g, i) => [g, dOk[i]]), color: OUTCOME.ok,
          lineStyle: { color: OUTCOME.ok, width: 2 }, areaStyle: { color: withAlpha(OUTCOME.ok, 0.14) },
          markLine: limLines.length ? { silent: true, symbol: "none", lineStyle: { color: LIMIT_C, type: "dashed", width: 1.5 }, label: { color: INK.secondary, fontSize: 10, fontWeight: 600 }, data: limLines } : undefined,
        },
        {
          name: `NG (n=${sel.ng.length.toLocaleString()})`, type: "line", smooth: true, showSymbol: false,
          data: grid.map((g, i) => [g, dNg[i]]), color: OUTCOME.ng,
          lineStyle: { color: OUTCOME.ng, width: 2 }, areaStyle: { color: withAlpha(OUTCOME.ng, 0.12) },
        },
      ],
    };
  }, [sel, limitMap]);

  const riskOption = useMemo(() => {
    if (!riskMap) return null;
    const { feats, cells, max } = riskMap;
    return {
      ...baseOption(),
      tooltip: {
        ...ECHART_TOOLTIP,
        formatter: (p) => {
          const c = cells[p.dataIndex];
          if (!c || !c.n) return tooltipHtml({ title: "No readings" });
          return tooltipHtml({
            title: c.st.label,
            subtitle: `${BANDS[c.col]}% of good-part range`,
            rows: [
              { label: "Range", value: `${r2(c.lo)} – ${r2(c.hi)} ${c.st.unit}` },
              { label: "Estimated NG rate", value: c.rate === null ? "—" : `${c.rate.toFixed(1)}%`, color: OUTCOME.ng },
              popRate ? { label: "Plant average", value: pct(popRate), strong: false } : null,
              { label: "Parts / NG", value: `${c.n.toLocaleString()} / ${c.ng.toLocaleString()}`, strong: false },
            ],
            note: c.n < 10 ? "Fewer than 10 parts — low confidence." : undefined,
          });
        },
      },
      grid: { left: 4, right: 8, top: 4, bottom: 62, containLabel: true },
      xAxis: categoryAxis(BANDS, { axisLine: { show: false }, ...axisName("Percentile of good-part range", 24) }),
      yAxis: categoryAxis(feats.map((st) => st.label), { inverse: true, axisLine: { show: false }, axisLabel: axisLabel({ fontSize: 11, color: INK.secondary, width: labelW, overflow: "truncate" }) }),
      visualMap: {
        min: 0, max: Number(max.toFixed(1)), calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, itemWidth: 9,
        text: [`${max.toFixed(0)}% NG`, "0%"], textStyle: { fontSize: 10.5, color: INK.muted, fontFamily: FONT_FAMILY },
        inRange: { color: ["#fbfaf9", ...SEQ_SCRAP.slice(1)] }, dimension: 2,
      },
      series: [{
        type: "heatmap",
        data: cells.map((c) => [c.col, c.row, c.rate === null ? "-" : Number(c.rate.toFixed(2))]),
        label: {
          show: true, fontSize: 10.5, fontFamily: FONT_FAMILY,
          formatter: (p) => { const c = cells[p.dataIndex]; return c.rate === null ? "" : `${c.rate.toFixed(1)}${c.n < 10 ? "*" : ""}`; },
          color: INK.primary,
        },
        itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 },
        emphasis: { itemStyle: { borderColor: INK.primary, borderWidth: 1 } },
      }],
    };
  }, [riskMap, popRate, labelW]);

  const linkOption = useMemo(() => {
    if (!defectLink) return null;
    const { feats, reasons, cells } = defectLink;
    return {
      ...baseOption(),
      tooltip: {
        ...ECHART_TOOLTIP,
        formatter: (p) => {
          const c = cells[p.dataIndex];
          if (!c) return "";
          const f = feats[c.row];
          return tooltipHtml({
            title: reasons[c.col].name,
            subtitle: f.label,
            rows: [
              { label: "OK mean", value: `${r2(f.okMean)} ${f.unit}`, color: OUTCOME.ok },
              { label: "NG mean (this defect)", value: c.mu === null ? "—" : `${r2(c.mu)} ${f.unit}`, color: OUTCOME.ng },
              { label: "Shift (σ of OK)", value: c.z === null ? "—" : `${signed(c.z)}σ` },
              { label: "NG parts with reading", value: c.n.toLocaleString(), strong: false },
            ],
            note: c.z === null ? "Fewer than 3 readings — not shown." : undefined,
          });
        },
      },
      grid: { left: 4, right: 8, top: 4, bottom: 52, containLabel: true },
      xAxis: categoryAxis(reasons.map((r) => r.name), { axisLine: { show: false }, axisLabel: axisLabel({ interval: 0, rotate: 30, width: 96, overflow: "truncate" }) }),
      yAxis: categoryAxis(feats.map((f) => f.label), { inverse: true, axisLine: { show: false }, axisLabel: axisLabel({ fontSize: 11, color: INK.secondary, width: labelW, overflow: "truncate" }) }),
      visualMap: {
        min: -2, max: 2, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, itemWidth: 9,
        text: ["Higher in NG", "Lower"], textStyle: { fontSize: 10.5, color: INK.muted, fontFamily: FONT_FAMILY },
        inRange: { color: [LOWER, DIVERGING.mid, HIGHER] }, dimension: 2,
      },
      series: [{
        type: "heatmap",
        data: cells.map((c) => [c.col, c.row, c.z === null ? "-" : r2(Math.max(-3, Math.min(3, c.z)))]),
        label: { show: true, fontSize: 10.5, fontFamily: FONT_FAMILY, color: INK.primary, formatter: (p) => { const c = cells[p.dataIndex]; return c?.z === null ? "" : signed(c.z, 1); } },
        itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 },
        emphasis: { itemStyle: { borderColor: INK.primary, borderWidth: 1 } },
      }],
    };
  }, [defectLink, labelW]);

  /* ── Anomalies (from the analysis service, else worst-deviating NG parts) ── */
  const outlierRows = useMemo(() => {
    const term = outlierSearch.toLowerCase().trim();
    let sourceList = mlInsights?.topAnomalies || [];
    if (!sourceList.length) {
      const seen = new Set();
      sourceList = [...(allRejectionRecords || []), ...(rejectedRows || [])].filter((r) => {
        const id = idOf(r);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).slice(0, 200).map((r, idx) => {
        let worstParam = "—", worstDev = 0, worstLimits = "—";
        stats.forEach((s) => {
          const val = readParam(r, s.def);
          if (val !== null && val > 0 && s.okStd > 0) {
            const dev = Math.abs((val - s.okMean) / s.okStd);
            if (dev > worstDev) {
              worstDev = dev;
              worstParam = `${s.label} (${val} ${s.unit}, ${dev.toFixed(1)}σ)`;
              worstLimits = limitMap[s.key] ? `${limitMap[s.key].lsl} – ${limitMap[s.key].usl}` : "Not set";
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
        rejection_zone: (!pd.inferred && pd.zone) || "—",
        worstDeviatingParam: part.worstDeviatingParam || "—",
        recipe_limits: part.worstParamLimits || "—",
        anomalyScore: part.anomalyScore ? `${part.anomalyScore} σ` : "—",
      };
    });
    return term ? mapped.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(term))) : mapped;
  }, [mlInsights, outlierSearch, allRejectionRecords, rejectedRows, stats, limitMap]);

  const outlierColumns = useMemo(() => [
    { key: "shot_number", label: "Shot #", width: 90 }, { key: "shot_datetime", label: "Recorded", width: 160, renderAsText: true },
    { key: "barcode", label: "Part serial", width: 170 }, { key: "shot_status", label: "Status", width: 80 },
    { key: "machine_name", label: "Machine", width: 120 }, { key: "rejection_category", label: "Category", width: 100 },
    { key: "ngReason", label: "Defect", width: 170 }, { key: "rejection_zone", label: "Zone", width: 100 },
    { key: "worstDeviatingParam", label: "Primary excursion", width: 240 }, { key: "recipe_limits", label: "Set limits", width: 130 },
    { key: "anomalyScore", label: "Z-score", width: 90 },
  ], []);

  const exportOutliers = async () => {
    if (!outlierRows.length) return;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Anomalies", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = outlierColumns.map((c) => ({ header: c.label, key: c.key, width: Math.round(c.width / 7) }));
    const hr = sheet.getRow(1);
    hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    outlierRows.forEach((d) => sheet.addRow(d));
    saveAs(new Blob([await wb.xlsx.writeBuffer()]), `Root_cause_anomalies_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const topDriver = drivers[0];
  const nSig = drivers.filter((d) => d.sig).length;
  const selDriver = stats.find((s) => s.key === sel.def.key);
  const selLim = limitMap[sel.def.key];
  const paramChoices = useMemo(() => {
    const seen = new Set(drivers.map((d) => d.key));
    return [...drivers, ...stats.filter((s) => !seen.has(s.key))];
  }, [drivers, stats]);
  const chart = (opt, h, events) => <EChart option={opt} onEvents={events} style={{ height: h, minHeight: 0, width: "100%" }} />;
  const noParamData = waiting ? <Loading /> : <Empty>Not enough PLC readings for both OK and NG parts in this selection.</Empty>;

  /* ═════════ RENDER ═════════ */
  return (
    <div className="rc-root">
      <style>{CARD_CSS}{`
        .rc-root{display:flex;flex-direction:column;gap:16px;min-width:0;font-family:${FONT_FAMILY}}
        .rc-root *{box-sizing:border-box}
        .rc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
        .rc-kpi-value{font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rc-head-l{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 220px}
        .rc-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:100%}
        .rc-empty{display:flex;align-items:center;justify-content:center;gap:8px;min-height:180px;padding:24px;text-align:center;color:${INK.muted};font-size:13px}
        .rc-spin{animation:rc-spin 1s linear infinite;color:${ACCENT.process}}
        @keyframes rc-spin{to{transform:rotate(360deg)}}
        .rc-select{max-width:100%;min-width:0;padding:6px 10px;border:1px solid ${INK.axis};border-radius:8px;background:#fff;font-size:12px;font-weight:600;color:${INK.secondary}}
        .rc-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;border:1px solid ${INK.axis};background:#fff;font-size:12px;font-weight:600;color:${INK.secondary};cursor:pointer}
        .rc-btn:hover{background:${INK.surfaceAlt}}.rc-btn:disabled{opacity:.5;cursor:default}
        .rc-search{display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid ${INK.axis};border-radius:8px;background:#fff;min-width:0}
        .rc-search input{border:0;outline:0;font-size:12px;width:150px;min-width:0;background:transparent}
        .rc-legend{padding:0 4px 8px}
        .rc-stats{display:flex;flex-wrap:wrap;gap:6px 16px;padding:0 4px 6px;font-size:12px;color:${INK.body}}
        .rc-stats b{color:${INK.primary};font-variant-numeric:tabular-nums;font-weight:600}
        .rc-scroll{overflow-x:auto;overflow-y:hidden}
        .rc-scroll>div{min-width:440px}
        .rc-table{width:100%;border-collapse:collapse;font-size:12px}
        .rc-table th{text-align:left;font-size:10.5px;font-weight:600;color:${INK.muted};text-transform:uppercase;letter-spacing:.05em;padding:8px;border-bottom:1px solid ${INK.border};background:${INK.surfaceAlt};position:sticky;top:0}
        .rc-table td{padding:8px;border-bottom:1px solid ${INK.grid};color:${INK.secondary};vertical-align:middle}
        .rc-table .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
        .rc-table tr.tail td{color:${INK.faint}}
        .rc-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
        .rc-cat{display:inline-block;padding:0 7px;border:1px solid;border-radius:999px;font-size:10.5px;font-weight:600;margin-right:6px}
        .rc-bar{display:inline-block;width:44px;height:6px;border-radius:3px;background:${INK.grid};margin-right:8px;vertical-align:1px;overflow:hidden}
        .rc-bar i{display:block;height:100%;border-radius:3px;background:${OUTCOME.ng}}
        .rc-causes{max-height:380px;overflow:auto}
        @media(max-width:640px){
          .rc-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
          .rc-kpi-value{font-size:17px}
          .rc-hide-sm{display:none}
          .rc-search input{width:110px}
          .ra-card-body{padding:4px 8px 12px}
          .ra-card-head{padding:12px 12px 8px}
        }
      `}</style>

      {/* ── KPI strip ── */}
      <div className="rc-kpis">
        <Kpi label="Parts analysed" value={waiting || !counts.total ? "—" : counts.total.toLocaleString()} color={ACCENT.neutral} />
        <Kpi label="OK parts" value={waiting || !counts.total ? "—" : counts.ok.toLocaleString()} color={ACCENT.ok} />
        <Kpi label="NG parts" value={waiting || !counts.total ? "—" : counts.ng.toLocaleString()} color={ACCENT.ng} />
        <Kpi label="Plant NG rate" value={!waiting && popRate ? pct(popRate, 2) : "—"} color={ACCENT.ng} />
        <Kpi label="Explained by process" value={influence ? pct(influence.explained, 0) : "—"} color={ACCENT.process} />
        <Kpi label="Top driver" value={topDriver ? topDriver.label : "—"} color={ACCENT.model} />
      </div>

      {/* ── 1. Ranked process drivers ── */}
      <Card color={ACCENT.process} icon={<Zap size={16} />} title="Process parameters driving NG"
        sub={drivers.length ? `How far NG parts ran from OK parts · ${nSig} of ${drivers.length} significant (p < 0.05) · click a bar to inspect` : "NG mean vs OK mean, in σ of good parts"}>
        {!driverOption ? noParamData : (
          <>
            <div className="ra-legend rc-legend">
              <span><i style={{ background: HIGHER }} />Higher in NG</span>
              <span><i style={{ background: LOWER }} />Lower in NG</span>
              <span><i style={{ background: withAlpha(INK.muted, 0.35) }} />Faded = not significant</span>
            </div>
            {chart(driverOption, drivers.length * 30 + 56, driverEvents)}
          </>
        )}
      </Card>

      {/* ── 2. Selected parameter + NG rate by operating range ── */}
      <div className="ra-grid2">
        <Card color={ACCENT.process} icon={<Waves size={16} />} title="OK vs NG distribution"
          sub={selLim ? "Dashed lines = set limits (LSL / USL)" : "Share of parts at each reading"}
          actions={paramChoices.length > 0 && (
            <select className="rc-select" aria-label="Parameter" value={sel.def.key} onChange={(e) => setParam(e.target.value)}>
              {paramChoices.map((p) => <option key={p.key} value={p.key}>{p.label}{p.unit ? ` (${p.unit})` : ""}</option>)}
            </select>
          )}>
          {!paramChoices.length ? noParamData : !densityOption ? <Empty>Not enough readings for {sel.def.label}.</Empty> : (
            <>
              <div className="rc-stats">
                <span>OK mean <b style={{ color: OUTCOME.ok }}>{r2(sel.okMean)}</b></span>
                <span>NG mean <b style={{ color: OUTCOME.ng }}>{sel.ng.length ? r2(sel.ngMean) : "—"}</b></span>
                {selDriver && <span>Shift <b>{signed(selDriver.shift, 1)}σ</b></span>}
                {selLim && <span className="rc-hide-sm">Limits <b>{selLim.lsl} – {selLim.usl}</b></span>}
              </div>
              {chart(densityOption, 300)}
            </>
          )}
        </Card>

        <Card color={ACCENT.ng} icon={<Gauge size={16} />} title="NG rate by operating range"
          sub={popRate ? `Plant-weighted NG % per fifth of the good-part range · plant avg ${pct(popRate)}` : "NG % per fifth of the good-part range"}>
          {!riskOption ? noParamData : (
            <div className="rc-scroll"><div>{chart(riskOption, Math.max(280, riskMap.feats.length * 34 + 90))}</div></div>
          )}
        </Card>
      </div>

      {/* ── 3. Defect ↔ parameter + top causes ── */}
      <div className="ra-grid2">
        <Card color={ACCENT.location} icon={<GitBranch size={16} />} title="Defect ↔ parameter link"
          sub="Shift of each defect's NG parts from the OK mean (σ) · blank = under 3 readings">
          {!linkOption ? (waiting && !drivers.length ? <Loading /> : <Empty>No defect reasons matched to PLC readings.</Empty>) : (
            <div className="rc-scroll"><div>{chart(linkOption, Math.max(300, defectLink.feats.length * 34 + 110))}</div></div>
          )}
        </Card>

        <Card color={ACCENT.ng} icon={<Layers size={16} />} title="Top rejection causes"
          sub={causes ? `${causes.vital} of ${causes.top.length} station–defect combinations make up 80% of ${causes.total.toLocaleString()} rejects` : "Station and defect of every rejected part"}>
          {!causes ? <Empty>No rejected parts in this selection.</Empty> : (
            <div className="rc-causes">
              <table className="rc-table">
                <thead><tr><th>Station</th><th>Defect</th><th className="num">Parts</th><th className="num">Share</th></tr></thead>
                <tbody>
                  {causes.top.slice(0, 12).map((t) => (
                    <tr key={`${t.st}-${t.cat}-${t.def}`} className={t.cum - t.share >= 80 ? "tail" : undefined}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="rc-dot" style={{ background: stationColor(t.st) }} />{t.st}
                        {STATION_NAME[t.st] && <span className="rc-hide-sm" style={{ color: INK.faint, marginLeft: 6, fontSize: 11 }}>{STATION_NAME[t.st]}</span>}
                      </td>
                      <td>
                        <span className="rc-cat" style={{ color: DEFECT_CATEGORY[t.cat] || INK.body, borderColor: DEFECT_CATEGORY[t.cat] || INK.border }}>{t.cat}</span>
                        <span style={{ color: INK.primary, fontWeight: 500 }}>{t.def}</span>
                      </td>
                      <td className="num">{t.n.toLocaleString()}</td>
                      <td className="num"><span className="rc-bar rc-hide-sm"><i style={{ width: `${Math.min(100, (t.n / causes.top[0].n) * 100)}%` }} /></span>{t.share.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* ── 4. Anomalies ── */}
      <Card color={ACCENT.ng} icon={<ShieldAlert size={16} />} title="Process anomalies"
        sub={`${outlierRows.length.toLocaleString()} NG parts with their largest parameter excursion`}
        actions={<>
          <div className="rc-search"><Search size={14} color={INK.faint} /><input aria-label="Search anomalies" placeholder="Search…" value={outlierSearch} onChange={(e) => setOutlierSearch(e.target.value)} /></div>
          <button type="button" className="rc-btn" onClick={exportOutliers} disabled={!outlierRows.length}><Download size={14} /> Export</button>
        </>}>
        <RejectionTable columns={outlierColumns} rows={outlierRows} loading={loading} defaultPageSize={25} pageSizeOptions={[25, 50, 100, 250]} />
      </Card>
    </div>
  );
}
