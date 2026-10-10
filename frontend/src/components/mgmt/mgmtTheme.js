/* ═══════════════════════════════════════════════════════════════════════════
   Management views — shared palette, formatting and CSS.
   Colour rules:
     • navy / slate neutrals for normal data
     • status colours (green / amber / red) ONLY for status vs target
     • outcome: OK = green, NG = red, wherever an outcome is shown
     • defect categories fixed: CR blue, CRAM orange, MR violet (CVD-validated set)
     • warm-up shots = neutral grey (planned, not scrap)
   ═══════════════════════════════════════════════════════════════════════════ */
export { TARGETS, scrapStatus, fpyStatus, statusLowerBetter, statusHigherBetter } from "./targets";

export const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

export const NAVY = "#0f2a4a";
export const NAVY_2 = "#1e3a5f";
export const NAVY_3 = "#3b5b82";
export const NAVY_SOFT = "#c9d6e6";

export const SLATE = {
  900: "#0f172a",
  800: "#1e293b",
  700: "#334155",
  600: "#475569",
  500: "#64748b",
  400: "#94a3b8",
  300: "#cbd5e1",
  200: "#e2e8f0",
  100: "#f1f5f9",
  50: "#f8fafc",
};

export const STATUS_COLOR = { good: "#16a34a", warn: "#d97706", bad: "#dc2626", none: SLATE[400] };
export const STATUS_BG = { good: "#ecfdf3", warn: "#fff7e6", bad: "#fef2f2", none: SLATE[100] };
export const STATUS_LABEL = { good: "On target", warn: "Near target", bad: "Off target", none: "No data" };

export const OUTCOME_COLOR = { ok: "#16a34a", ng: "#dc2626" };
/** Warm-up shots — planned start-up shots, not scrap: teal, distinct from OK / NG and CR / MR / CRAM. */
export const WARMUP_COLOR = "#0d9488";
/** Solid tint of a colour towards white (keeps the hue — semi-transparent blue reads as violet on white). */
export const tint = (hex, w = 0.35) => {
  const n = parseInt(String(hex).slice(1, 7), 16);
  const mix = (c) => Math.round(c + (255 - c) * w).toString(16).padStart(2, "0");
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
};

export const CATEGORY_ORDER = ["CR", "CRAM", "MR"];
export const CATEGORY_COLOR = { CR: "#2563eb", CRAM: "#ea580c", MR: "#7c3aed", OTHER: "#94a3b8" };
export const CATEGORY_NAME = {
  CR: "Casting rejection",
  CRAM: "Casting rejection after machining",
  MR: "Machining rejection",
  OTHER: "Not classified",
};
export const categoryColor = (c) => CATEGORY_COLOR[String(c || "").toUpperCase()] || CATEGORY_COLOR.OTHER;

/** Sequential heat ramp (light → dark) for counts on a map / matrix. */
export const HEAT = ["#fde7d6", "#fbc7a2", "#f59e6b", "#e8743f", "#cc4e22", "#a33417", "#7a210f"];
export const heatColor = (value, max) => {
  if (!(value > 0) || !(max > 0)) return null;
  const t = Math.sqrt(Math.min(1, value / max));
  return HEAT[Math.min(HEAT.length - 1, Math.floor(t * HEAT.length))];
};
export const heatInk = (value, max) => {
  if (!(value > 0) || !(max > 0)) return SLATE[900];
  const t = Math.sqrt(Math.min(1, value / max));
  return Math.floor(t * HEAT.length) >= 3 ? "#ffffff" : SLATE[900];
};

export const alpha = (hex, a) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}`;

/* ── Number formatting ─────────────────────────────────────────────────── */
const isNum = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
export const fmtInt = (v) => (isNum(v) ? Math.round(Number(v)).toLocaleString("en-IN") : "—");
export const fmtPct = (v, d = 1) => (isNum(v) ? `${Number(v).toFixed(d)}%` : "—");
export const fmtPp = (v, d = 1) => (isNum(v) ? `${Number(v) > 0 ? "+" : Number(v) < 0 ? "−" : "±"}${Math.abs(Number(v)).toFixed(d)} pp` : "—");
export const pctOf = (part, whole) => (Number(whole) > 0 ? (Number(part) / Number(whole)) * 100 : null);

/* ── ECharts building blocks (light tooltip: dark text on white) ───────── */
export const TOOLTIP = {
  backgroundColor: "#ffffff",
  borderColor: SLATE[200],
  borderWidth: 1,
  padding: [10, 12],
  textStyle: { color: SLATE[900], fontSize: 12.5, fontFamily: FONT },
  appendTo: "body",
  extraCssText: "border-radius:10px;box-shadow:0 12px 30px rgba(15,23,42,.14);max-width:360px;white-space:normal;line-height:1.45;z-index:4000;",
};

/** Tooltip body: title + rows [{ label, value, color }] + optional note. */
export const tipHtml = ({ title, rows = [], note }) => {
  const head = title ? `<div style="font-weight:700;font-size:13px;color:${SLATE[900]};margin-bottom:6px">${title}</div>` : "";
  const body = rows.filter(Boolean).map((r) => {
    const dot = r.color ? `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${r.color};margin-right:7px"></span>` : "";
    return `<span style="display:flex;align-items:center;color:${SLATE[600]};font-size:12px">${dot}${r.label}</span><span style="text-align:right;color:${SLATE[900]};font-weight:${r.bold === false ? 500 : 700};font-variant-numeric:tabular-nums;white-space:nowrap">${r.value}</span>`;
  }).join("");
  const grid = body ? `<div style="display:grid;grid-template-columns:auto auto;gap:4px 18px;align-items:center">${body}</div>` : "";
  const foot = note ? `<div style="margin-top:7px;padding-top:6px;border-top:1px solid ${SLATE[200]};color:${SLATE[500]};font-size:11px">${note}</div>` : "";
  return head + grid + foot;
};

export const axisLabel = (extra = {}) => ({ color: SLATE[600], fontSize: 11.5, fontFamily: FONT, ...extra });

/* ── Shared CSS for every management component (inject once with <MgmtStyles />) ── */
export const MGMT_CSS = `
.mg-root{--mg-navy:${NAVY};--mg-navy2:${NAVY_2};--mg-ink:${SLATE[900]};--mg-ink2:${SLATE[700]};--mg-muted:${SLATE[500]};--mg-line:${SLATE[200]};--mg-soft:${SLATE[50]};font-family:${FONT};color:var(--mg-ink);min-width:0}
.mg-root *{box-sizing:border-box}
.mg-card{background:#fff;border:1px solid var(--mg-line);border-radius:14px;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 22px -14px rgba(15,23,42,.18);min-width:0}
.mg-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 18px 6px}
.mg-card-title{margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em;color:var(--mg-ink);display:flex;align-items:center;gap:2px}
.mg-card-kicker{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${NAVY_3};margin-bottom:3px}
.mg-card-sub{margin:3px 0 0;font-size:12.5px;color:var(--mg-muted);line-height:1.45;max-width:880px}
.mg-card-body{padding:8px 18px 16px;min-width:0}
.mg-card-foot{padding:9px 18px 12px;border-top:1px solid ${SLATE[100]};font-size:11.5px;color:var(--mg-muted);line-height:1.5}
.mg-collapse-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--mg-line);background:#fff;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;color:var(--mg-ink2);cursor:pointer}
.mg-collapse-btn:hover{background:var(--mg-soft)}
.mg-skel{position:relative;overflow:hidden;background:${SLATE[100]};border-radius:8px}
.mg-skel::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);animation:mg-shimmer 1.3s infinite}
@keyframes mg-shimmer{100%{transform:translateX(100%)}}
@media (prefers-reduced-motion:reduce){.mg-skel::after{animation:none}}
.mg-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;color:var(--mg-muted);font-size:13px;padding:28px 12px;min-height:140px}
.mg-pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;line-height:1.6}
.mg-chip{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:6px;font-size:11.5px;font-weight:700;white-space:nowrap;line-height:1.6}
.mg-tag{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:6px;font-size:10.5px;font-weight:700;letter-spacing:.02em;white-space:nowrap;background:${SLATE[100]};color:${SLATE[600]};border:1px solid ${SLATE[200]}}
.mg-num{font-variant-numeric:tabular-nums}
.mg-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--mg-ink2)}
.mg-legend span{display:inline-flex;align-items:center;gap:6px}
.mg-legend i{display:inline-block;width:11px;height:11px;border-radius:3px}
.mg-legend i.line{height:3px;width:16px;border-radius:2px}
.mg-legend i.dash{height:0;width:16px;border-top:2px dashed currentColor;border-radius:0;background:none!important}

/* KPI tiles */
.mg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}
.mg-kpi{position:relative;background:#fff;border:1px solid var(--mg-line);border-radius:14px;padding:12px 12px 11px;display:flex;flex-direction:column;gap:6px;min-width:0;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.mg-kpi[data-status]::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:4px;border-radius:0 4px 4px 0;background:var(--mg-status)}
.mg-kpi-label{display:flex;align-items:flex-start;gap:4px;font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mg-muted);min-height:18px}
.mg-kpi-value{font-size:28px;line-height:1.05;font-weight:750;letter-spacing:-.02em;color:var(--mg-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.mg-kpi-value small{font-size:15px;font-weight:600;color:var(--mg-muted);margin-left:2px}
.mg-kpi-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--mg-ink2);min-height:20px}
.mg-kpi-sub{font-size:11.5px;color:var(--mg-muted);line-height:1.35}
.mg-kpi-spark{height:30px;margin-top:auto}
.mg-kpi-split{display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px;background:#fff;margin-top:4px}

/* Funnel */
.mg-funnel{display:flex;flex-direction:column;gap:6px}
.mg-fn-head,.mg-fn-row{display:grid;grid-template-columns:minmax(170px,230px) minmax(120px,1fr) 92px 150px 74px;align-items:center;gap:14px}
.mg-fn-head{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--mg-muted);padding:0 10px 4px}
.mg-fn-head>:nth-child(n+3){text-align:right}
.mg-fn-row{padding:9px 10px;border-radius:10px;border:1px solid transparent}
.mg-fn-row:nth-child(even){background:${SLATE[50]}}
.mg-fn-row.final{background:#f0fdf4;border-color:#bbf7d0}
.mg-fn-name{font-size:13.5px;font-weight:700;color:var(--mg-ink);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.mg-fn-desc{font-size:11.5px;color:var(--mg-muted);margin-top:1px}
.mg-fn-bar{position:relative;height:22px;display:flex;align-items:stretch;gap:2px}
.mg-fn-bar>span{display:block;height:100%;border-radius:4px;min-width:0}
.mg-fn-num{text-align:right;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.mg-fn-rej{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.mg-fn-mini{display:flex;width:100%;max-width:120px;height:6px;border-radius:3px;overflow:hidden;gap:1px}
.mg-fn-loss{text-align:right}
.mg-fn-step-lbl{display:none}
@media (max-width:900px){
  .mg-fn-head{display:none}
  .mg-fn-row{grid-template-columns:1fr 1fr 1fr;row-gap:6px}
  .mg-fn-row>.mg-fn-label{grid-column:1/-1}
  .mg-fn-row>.mg-fn-bar{grid-column:1/-1}
  .mg-fn-step-lbl{display:block;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mg-muted)}
  .mg-fn-num,.mg-fn-loss{text-align:left}
  .mg-fn-rej{align-items:flex-start}
}

/* Comparison table */
.mg-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.mg-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
.mg-table th{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--mg-muted);text-align:left;padding:8px 10px;border-bottom:1px solid var(--mg-line);white-space:nowrap;background:#fff}
.mg-table td{padding:10px;border-bottom:1px solid ${SLATE[100]};color:var(--mg-ink2);vertical-align:middle}
.mg-table tr:last-child td{border-bottom:none}
.mg-table .r{text-align:right}
.mg-table td.r{font-variant-numeric:tabular-nums}
.mg-table .strong{font-weight:700;color:var(--mg-ink)}
.mg-ratebar{position:relative;height:10px;border-radius:5px;background:${SLATE[100]};min-width:90px}
.mg-ratebar>i{position:absolute;left:0;top:0;bottom:0;border-radius:5px}
.mg-ratebar>b{position:absolute;top:-4px;bottom:-4px;width:2px;background:${SLATE[700]};border-radius:1px}

/* Matrix */
.mg-matrix td.cell{text-align:center;font-weight:700;font-variant-numeric:tabular-nums;border-radius:6px;border:2px solid #fff;min-width:64px}

/* Lift bars */
.mg-lift{display:flex;flex-direction:column;gap:12px}
.mg-lift-row{display:grid;grid-template-columns:minmax(150px,210px) 1fr minmax(120px,190px);gap:14px;align-items:center}
.mg-lift-name{font-size:13px;font-weight:700;color:var(--mg-ink)}
.mg-lift-bars{display:flex;flex-direction:column;gap:3px}
.mg-lift-track{position:relative;height:11px;border-radius:4px;background:${SLATE[100]}}
.mg-lift-track>i{position:absolute;left:0;top:0;bottom:0;border-radius:4px}
.mg-lift-txt{font-size:12px;color:var(--mg-ink2);line-height:1.35}
@media (max-width:760px){.mg-lift-row{grid-template-columns:1fr}}

.mg-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.mg-grid-3-2{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px}
.mg-kpi-meta{gap:4px 6px}
@media (min-width:1700px){.mg-kpi-value{font-size:34px}.mg-kpi-label{font-size:11.5px}}
@media (max-width:1180px){.mg-grid2,.mg-grid-3-2{grid-template-columns:1fr}}

/* Page header (period chips, shift, refresh) — Rejection Analysis and the Dashboard overview */
.ra-head{position:relative;overflow:visible;padding:16px 18px 14px}
.ra-head-top{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
.ra-title{margin:0;font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-.02em;color:${NAVY}}
.ra-sub{margin:4px 0 0;font-size:13px;color:${SLATE[500]};max-width:720px;line-height:1.45}
.ra-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ra-updated{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:${SLATE[500]};margin-right:4px;white-space:nowrap}
.ra-btn{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 14px;border-radius:9px;border:1px solid ${SLATE[300]};background:#fff;color:${SLATE[800]};font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.ra-btn:hover:not(:disabled){background:${SLATE[50]}}
.ra-btn:disabled{opacity:.6;cursor:default}
.ra-btn.primary{background:${NAVY};border-color:${NAVY};color:#fff}
.ra-btn.primary:hover:not(:disabled){background:${NAVY_2}}
.ra-filters{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid ${SLATE[100]}}
.ra-seg{display:inline-flex;flex-wrap:wrap;gap:3px;padding:3px;border-radius:10px;background:${SLATE[100]};border:1px solid ${SLATE[200]}}
.ra-seg button{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 12px;border:none;border-radius:7px;background:transparent;color:${SLATE[700]};font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.ra-seg button:hover{background:${SLATE[200]}}
.ra-seg button.on{background:${NAVY};color:#fff;box-shadow:0 1px 2px rgba(15,42,74,.3)}
.ra-seg-sm button{height:28px;padding:0 10px;font-size:12px}
.ra-seg-count{font-size:11px;font-weight:700;opacity:.75}
.ra-pop{position:absolute;top:calc(100% + 6px);left:0;z-index:50;background:#fff;border:1px solid ${SLATE[200]};border-radius:12px;box-shadow:0 18px 40px rgba(15,23,42,.18);padding:10px}
.ra-window{font-size:12.5px;color:${SLATE[600]};display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.ra-window b{color:${SLATE[900]}}
.ra-clear{display:inline-flex;align-items:center;gap:3px;margin-left:6px;border:1px solid ${SLATE[200]};background:#fff;border-radius:6px;padding:2px 7px;font-size:11.5px;color:${SLATE[600]};cursor:pointer}
.ra-progress{position:absolute;left:0;right:0;bottom:0;height:3px;border-radius:0 0 14px 14px;overflow:hidden;background:linear-gradient(90deg,transparent,${NAVY_3},transparent);background-size:40% 100%;background-repeat:no-repeat;animation:ra-prog 1.2s linear infinite}
@keyframes ra-prog{0%{background-position:-40% 0}100%{background-position:140% 0}}
.ra-spin{animation:ra-rot 1s linear infinite}
@keyframes ra-rot{to{transform:rotate(360deg)}}
.ra-banner{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 14px;border-radius:10px;background:#fff7e6;border:1px solid #fcd9a5;color:#7c2d12;font-size:12.5px}
.ra-banner button{border:none;background:transparent;cursor:pointer;color:inherit}
.ra-lede{margin:2px 0 10px;font-size:14px;line-height:1.5;color:${SLATE[700]}}
.ra-callout{margin:0 0 14px;padding:10px 14px;border-radius:10px;background:${SLATE[50]};border-left:4px solid ${NAVY};font-size:13.5px;color:${SLATE[800]};line-height:1.5}
.ra-limit-box{margin-top:18px;padding:12px 14px;border-radius:10px;border:1px dashed ${SLATE[300]};background:#fcfcfd}
.ra-limit-head{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#92400e;margin-bottom:10px}
.ra-daycount{display:flex;gap:12px;font-size:12px;font-weight:600;flex-wrap:wrap}

/* KPI change vs previous period */
.mg-kpi-change{display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;font-size:12px;line-height:1.3;font-variant-numeric:tabular-nums}
.mg-kpi-change span{color:var(--mg-muted);font-size:11.5px}

/* Text link to a detail page ("See details →") */
.mg-link{display:inline-flex;align-items:center;gap:5px;border:1px solid ${SLATE[200]};background:#fff;border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px;font-weight:700;color:${NAVY_2};cursor:pointer;white-space:nowrap;text-decoration:none}
.mg-link:hover{background:${SLATE[50]};border-color:${SLATE[300]}}
.mg-link:focus-visible,.ra-seg button:focus-visible,.ra-btn:focus-visible,.mg-tabs button:focus-visible{outline:2px solid ${NAVY_3};outline-offset:2px}

/* Page tabs (Dashboard) */
.mg-tabs{display:flex;gap:3px;padding:3px;border-radius:11px;background:#fff;border:1px solid ${SLATE[200]};width:fit-content;max-width:100%;overflow-x:auto;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.mg-tabs button{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border:none;border-radius:8px;background:transparent;color:${SLATE[600]};font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.mg-tabs button:hover{background:${SLATE[100]}}
.mg-tabs button[aria-selected="true"]{background:${NAVY};color:#fff}

/* Station status strip */
.mg-stations{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.mg-station{position:relative;border:1px solid ${SLATE[200]};border-radius:12px;padding:10px 12px;background:#fff;display:flex;flex-direction:column;gap:4px;min-width:0}
.mg-station.worst{border-color:#fecaca;background:#fffafa}
.mg-station.bypass{background:${SLATE[50]}}
.mg-station-op{font-size:11px;font-weight:800;letter-spacing:.06em;color:${NAVY_3}}
.mg-station-name{font-size:13px;font-weight:700;color:${SLATE[900]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mg-station-nums{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:${SLATE[600]};font-variant-numeric:tabular-nums}
.mg-station-nums b{font-size:15px}
.mg-station-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:${SLATE[100]};gap:1px}

/* Donut legend (DonutChart) */
.mg-donut-legend{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.mg-donut-legend li{display:grid;grid-template-columns:11px minmax(0,1fr) auto 38px;align-items:center;gap:8px;font-size:12px;color:${SLATE[700]}}
.mg-donut-legend i{width:11px;height:11px;border-radius:3px}
.mg-donut-legend .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mg-donut-legend b{color:${SLATE[900]};font-size:12.5px}
.mg-donut-legend .pc{text-align:right;color:${SLATE[500]};font-size:11.5px}

/* Drill-down breadcrumb + chart hint */
.mg-crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:13px;color:${SLATE[500]};margin:0 0 8px}
.mg-crumbs button{border:none;background:transparent;padding:3px 6px;border-radius:6px;font:inherit;font-weight:700;color:${NAVY_3};cursor:pointer}
.mg-crumbs button:hover{background:${SLATE[100]}}
.mg-crumbs b{color:${SLATE[900]};padding:3px 6px}
.mg-back{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;margin-right:6px;border:1px solid ${SLATE[300]};border-radius:8px;background:#fff;font:inherit;font-size:12.5px;font-weight:700;color:${SLATE[800]};cursor:pointer}
.mg-back:hover{background:${SLATE[50]}}
.mg-hint{font-size:11.5px;color:${SLATE[500]};display:inline-flex;align-items:center;gap:5px}
.mg-crumbs button:focus-visible,.mg-back:focus-visible{outline:2px solid ${NAVY_3};outline-offset:2px}

/* Overview signal card */
.mg-signal-big{font-size:15px;line-height:1.5;color:${SLATE[800]};margin:0 0 12px}
.mg-signal-big b{color:${SLATE[900]}}

@media (max-width:640px){
  .ra-title{font-size:20px}
  .ra-head{padding:14px}
  .ra-updated{width:100%}
  .mg-card-head{padding:14px 14px 4px}
  .mg-card-body{padding:6px 14px 14px}
  .mg-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .mg-kpi-value{font-size:24px}
}
`;
