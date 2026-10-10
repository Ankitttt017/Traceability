// ═══════════════════════════════════════════════════════════════════════════
// Rejection Analysis — shared chart design system
// One palette, one tooltip, one axis style for every chart in the module, so a colour always
// means the same thing (OK is always green, NG always red, Shift B always orange …).
//
// Same palette as the management views (components/mgmt/mgmtTheme.js):
//   navy / slate neutrals for normal data (stations, shifts, dies, parameters)
//   OK #16a34a vs NG #dc2626      → outcome only (always paired with an "OK" / "NG" label)
//   CR #2563eb · CRAM #ea580c · MR #7c3aed → the three defect categories, everywhere
//   green / amber / red            → status vs target only (scrap ≤ 2 %, FPY ≥ 97 %), never a series
// Rules: colour follows the entity, never its rank; a 9th+ series folds into "Other".
// ═══════════════════════════════════════════════════════════════════════════

export const FONT_FAMILY = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

export const INK = {
  primary: "#0f172a",
  secondary: "#334155",
  body: "#475569",
  muted: "#64748b",
  faint: "#94a3b8",
  axis: "#cbd5e1",
  grid: "#f1f5f9",
  border: "#e2e8f0",
  surface: "#ffffff",
  surfaceAlt: "#f8fafc",
};

// Part outcome
export const OUTCOME = {
  ok: "#16a34a",   // standard green (OK / pass)
  ng: "#dc2626",   // standard red (NG / reject)
  wip: "#94a3b8",   // in process — neutral on purpose
  total: "#475569",
};

// Categorical slots (fixed order — the order is what makes it colour-blind safe)
// navy ramp first, then muted hues that are not green / red / a category colour
export const CATEGORICAL = ["#0f2a4a", "#4a6d97", "#0e7490", "#a16207", "#9d4b73", "#5b6b80", "#a3bad5", "#7393b8"];
export const OTHER = "#94a3b8";

// Defect categories — one fixed colour each, used on every chart: CR blue · CRAM orange · MR violet
export const DEFECT_CATEGORY = { CR: "#2563eb", CRAM: "#ea580c", MR: "#7c3aed" };
export const DEFECT_CATEGORY_LABEL = {
  CR: "CR · Casting rejection",
  CRAM: "CRAM · Casting rejection after machining",
  MR: "MR · Machining rejection",
};
export const SHIFT = { A: "#0f2a4a", B: "#4a6d97", C: "#a3bad5", Unassigned: "#94a3b8" };

// Status (state only — always paired with a label or icon)
export const STATUS = {
  good: "#16a34a",
  warning: "#d97706",
  serious: "#c2410c",
  critical: "#dc2626",
  neutral: "#94a3b8",
};

// Diverging: lowers scrap ↔ raises scrap
export const DIVERGING = { low: "#3b5b82", mid: "#f1f5f9", high: "#dc2626" };

// Sequential magnitude ramps (light → dark)
export const SEQ_BLUE = ["#e2e8f0", "#c9d6e6", "#a3bad5", "#7393b8", "#4a6d97", "#2b4a73", "#0f2a4a"];
export const SEQ_SCRAP = ["#fde7d6", "#fbc7a2", "#f59e6b", "#e8743f", "#cc4e22", "#a33417", "#7a210f"];

/** Colour for a sequential value (0…max), sqrt-scaled so small values stay visible. */
export const seqColor = (value, max, ramp = SEQ_SCRAP) => {
  if (!(value > 0) || !(max > 0)) return null;
  const t = Math.sqrt(Math.min(1, value / max));
  return ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
};

export const withAlpha = (hex, a) =>
  `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}`;

/**
 * Stable colour map: keys are assigned slots in the order given (pass a fixed, global order such as the
 * plant-wide defect Pareto) — never re-rank per chart. Keys past the 8th slot get OTHER.
 */
// Defect reasons, categories, zones, sub-zones and views: no green — green means OK everywhere on the page
export const DEFECT_PALETTE = ["#0f2a4a", "#4a6d97", "#0e7490", "#a16207", "#9d4b73", "#5b6b80", "#7393b8", "#b45309", "#6b7fa3", "#a3bad5"];

export const makeColorMap = (orderedKeys = [], slots = DEFECT_PALETTE) => {
  const map = {};
  orderedKeys.forEach((k, i) => { map[k] = i < slots.length ? slots[i] : OTHER; });
  return (key) => map[key] || OTHER;
};

export const shiftKey = (raw) => {
  const s = String(raw || "").trim().toUpperCase().replace(/^SHIFT[_\s-]*/, "");
  return ["A", "B", "C"].includes(s) ? s : "Unassigned";
};
export const shiftColor = (raw) => SHIFT[shiftKey(raw)];
export const categoryColor = (raw) => DEFECT_CATEGORY[String(raw || "").toUpperCase()] || OTHER;

/* ── Number formatting ─────────────────────────────────────────────────── */
export const fmtInt = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString() : "—");
export const fmtPct = (v, d = 1) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(d)}%` : "—");
export const fmtNum = (v, d = 2) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)).toLocaleString() : "—");

/* ── ECharts building blocks ───────────────────────────────────────────── */
export const ECHART_TOOLTIP = {
  backgroundColor: "#ffffff",
  borderColor: "#e2e8f0",
  borderWidth: 1,
  padding: [12, 14],
  textStyle: { color: "#0f172a", fontSize: 12.5, fontFamily: FONT_FAMILY },
  // rendered on <body>: cards (overflow hidden) and horizontal scroll areas can no longer clip it
  appendTo: "body",
  extraCssText: "border-radius:10px;box-shadow:0 12px 32px rgba(15,23,42,.14),0 2px 6px rgba(15,23,42,.08);min-width:190px;max-width:380px;white-space:normal;line-height:1.45;z-index:4000;",
};

export const axisLabel = (extra = {}) => ({ color: INK.muted, fontSize: 10.5, fontFamily: FONT_FAMILY, ...extra });
export const axisName = (name, gap = 30) => ({
  name, nameLocation: "middle", nameGap: gap,
  nameTextStyle: { color: INK.body, fontSize: 11, fontWeight: 600, fontFamily: FONT_FAMILY },
});
export const valueAxis = (extra = {}) => ({
  type: "value",
  axisLabel: axisLabel(),
  axisLine: { show: false },
  axisTick: { show: false },
  splitLine: { lineStyle: { color: INK.grid } },
  ...extra,
});
export const categoryAxis = (data, extra = {}) => ({
  type: "category",
  data,
  axisLabel: axisLabel(),
  axisLine: { lineStyle: { color: INK.axis } },
  axisTick: { show: false },
  ...extra,
});
export const LEGEND = {
  top: 0, right: 0, itemWidth: 12, itemHeight: 8, itemGap: 14, icon: "roundRect",
  textStyle: { color: INK.body, fontSize: 11, fontFamily: FONT_FAMILY },
};
export const baseOption = (extra = {}) => ({
  textStyle: { fontFamily: FONT_FAMILY },
  animationDuration: 400,
  tooltip: ECHART_TOOLTIP,
  ...extra,
});

/**
 * Consistent tooltip body.
 * rows: [{ label, value, color? (marker), strong? }]; note: muted footer line.
 */
export const tooltipHtml = ({ title, subtitle, rows = [], note }) => {
  const head = title ? `<div style="font-weight:700;font-size:13px;color:#0f172a;letter-spacing:.01em">${title}</div>` : "";
  const sub = subtitle ? `<div style="color:#64748b;font-size:11.5px;margin-top:2px">${subtitle}</div>` : "";
  const top = head || sub ? `<div style="padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid #e2e8f0">${head}${sub}</div>` : "";
  const body = rows.filter(Boolean).map((r) => {
    const dot = r.color ? `<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${r.color};margin-right:8px;flex-shrink:0"></span>` : "";
    return `<span style="display:flex;align-items:center;color:#475569;font-size:12px">${dot}${r.label}</span>`
      + `<span style="text-align:right;color:${r.strong === false ? "#475569" : "#0f172a"};font-weight:${r.strong === false ? 500 : 700};font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap">${r.value}</span>`;
  }).join("");
  const grid = body ? `<div style="display:grid;grid-template-columns:minmax(0,auto) auto;align-items:center;gap:6px 22px">${body}</div>` : "";
  const foot = note ? `<div style="color:#64748b;font-size:11px;line-height:1.45;margin-top:9px;padding-top:7px;border-top:1px solid #e2e8f0;max-width:320px;white-space:normal">${note}</div>` : "";
  return top + grid + foot;
};

/* ── Recharts equivalents ──────────────────────────────────────────────── */
export const RECHARTS_TOOLTIP = {
  contentStyle: {
    backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10,
    boxShadow: "0 12px 32px rgba(15,23,42,.14), 0 2px 6px rgba(15,23,42,.08)", padding: "12px 14px", fontSize: 12.5, fontFamily: FONT_FAMILY, color: "#0f172a",
  },
  itemStyle: { color: "#0f172a", padding: 0 },
  labelStyle: { color: "#0f172a", fontWeight: 600, marginBottom: 4 },
  cursor: { fill: "rgba(15,23,42,0.04)" },
};
export const RECHARTS_AXIS = { tick: { fill: INK.muted, fontSize: 10.5, fontFamily: FONT_FAMILY }, axisLine: { stroke: INK.axis }, tickLine: false };
export const RECHARTS_GRID = { stroke: INK.grid, vertical: false };

/* ── Card accents ──────────────────────────────────────────────────────────
   Every card / KPI carries one semantic accent colour (set inline: style={accent(OUTCOME.ng)} plus
   data-accent). It drives the icon chip (and a KPI's left edge) — NG = red, OK = green, everything else navy /
   slate. Cards themselves stay plain white, like the management cards. */
export const ACCENT = {
  ok: OUTCOME.ok,
  ng: OUTCOME.ng,
  wip: "#64748b",
  process: "#3b5b82",
  model: "#1e3a5f",
  location: "#0f2a4a",
  quality: "#0f2a4a",
  warning: "#d97706",
  neutral: "#475569",
};
export const accent = (color) => ({ "--accent": color });

/* ── Shared card CSS (inject once per tab via <style>{CARD_CSS}</style>) ─ */
export const CARD_CSS = `
.ra-card{background:#fff;border:1px solid ${INK.border};border-radius:14px;min-width:0;position:relative;overflow:visible;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 22px -14px rgba(15,23,42,.18)}
.ra-card>.ra-card-head:first-child{border-radius:14px 14px 0 0}
.ra-icon{width:32px;height:32px;border-radius:9px;display:inline-grid;place-items:center;flex-shrink:0;color:var(--accent,${INK.muted});background:color-mix(in srgb,var(--accent,${INK.muted}) 13%,#fff)}
.ra-kpi[data-accent]{border-left:3px solid var(--accent)}
.ra-kpi[data-accent] .ra-kpi-value{color:${INK.primary}}
.ra-kpi-top{display:flex;align-items:center;gap:8px}
.ra-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;color:var(--accent,${INK.body});background:color-mix(in srgb,var(--accent,${INK.muted}) 12%,#fff);border:1px solid color-mix(in srgb,var(--accent,${INK.muted}) 30%,#fff)}
.ra-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;padding:14px 18px 10px}
.ra-card-title{margin:0;font-size:14.5px;font-weight:700;color:${INK.primary};letter-spacing:-.01em}
.ra-card-sub{margin:3px 0 0;font-size:12px;color:${INK.muted};font-weight:400}
.ra-card-body{padding:4px 14px 14px}
.ra-note{padding:8px 18px 12px;font-size:11.5px;line-height:1.5;color:${INK.muted};border-top:1px solid ${INK.grid}}
.ra-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:${INK.body}}
.ra-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
.ra-kpi{background:#fff;border:1px solid ${INK.border};border-radius:14px;padding:12px 14px;min-width:0}
.ra-kpi-label{font-size:11px;font-weight:600;color:${INK.muted};text-transform:uppercase;letter-spacing:.06em}
.ra-kpi-value{font-size:22px;font-weight:700;color:${INK.primary};font-variant-numeric:tabular-nums;margin-top:4px}
.ra-kpi-sub{font-size:11.5px;color:${INK.muted};margin-top:2px}
.ra-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.ra-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
@media(max-width:1100px){.ra-grid2,.ra-grid3{grid-template-columns:1fr}}
`;
