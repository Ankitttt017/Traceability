import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { MapPin, Maximize2, Minimize2, Download, Layers, Crosshair, Activity, Gauge, ListOrdered, ArrowLeft, ChevronRight, AlertTriangle } from "lucide-react";
import ParetoChart from "../../components/mgmt/ParetoChart";
import { SkeletonBlock } from "../../components/mgmt/Skeleton";
import { parseRowDefect, resolveDefectLocation, boxStyle, subBoxStyle, getFullImageUrl } from "./rejectionConstants";
import CadStage from "./components/CadStage";
import { useViewFrameAspect } from "../../utils/viewImageFrame";
import {
  SEQ_SCRAP, OUTCOME, INK, ACCENT, OTHER, DEFECT_CATEGORY, DEFECT_CATEGORY_LABEL, STATUS, FONT_FAMILY, CARD_CSS,
  shiftKey, accent, withAlpha,
} from "./chartTheme";

/* Defect Location Map — hierarchical drill-down on the part views of Rejection Configuration:
   all views → one view (zone heat) → one zone (its sub-zones, % of the zone) → one sub-zone (reasons + categories),
   with a breadcrumb + Back, the Rejection Pareto of the selected zone / sub-zone and its records.
   Records = the page's NG records after the page filters; nothing is drawn (no misleading zeros) until they arrive.
   boxStyle(zone) / subBoxStyle(zone, sz) and CadStage are used unchanged (sub-zones are % of the parent zone). */
const PART_NAME = "Oil Pan K-12";

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */
// Shared sequential scrap ramp (lightest step dropped so a 1-count zone is still visible), sqrt-scaled
const HEAT_RAMP = SEQ_SCRAP.slice(1);
const heatIndex = (count, max) => {
  if (!count || count <= 0) return -1;
  return Math.min(HEAT_RAMP.length - 1, Math.floor(Math.sqrt(count / Math.max(max, 1)) * HEAT_RAMP.length));
};
const heatColorFor = (count, max) => {
  const i = heatIndex(count, max);
  return i < 0 ? null : HEAT_RAMP[i];
};
/** Text colour readable on a heat badge of that step. */
const heatInk = (count, max) => (heatIndex(count, max) >= 3 ? "#ffffff" : INK.primary);
const fmt = (n) => Number(n || 0).toLocaleString();
const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const CAT_KEYS = ["CR", "CRAM", "MR"];
const NO_SUB = "__zone"; // location key suffix for rejects placed on a zone without a sub-zone
const SELECT_RING = "#2563eb";
const INFERRED = STATUS.warning; // amber — used sparingly (small marks only)

/* ═══════════════════════════════════════════════════════════════════════════
   PURE HELPERS (no React — every number on the tab comes from these)
   ═══════════════════════════════════════════════════════════════════════════ */
const normalize = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

// Location keys are scoped by view: zone "A" on Top View and zone "A" on Bottom View are different places.
const viewKey = (v) => String(v?.id ?? v?.code ?? v?.name);
const zoneKey = (v, z) => `${viewKey(v)}::${z?.id ?? z?.code ?? z?.name}`;
const subKey = (v, z, s) => `${zoneKey(v, z)}::${s?.id ?? s?.code ?? s?.name}`;
const rowMatchesView = (row, v) => !!v && row._vk === viewKey(v);
const qtyOf = (r) => Number(r.quantity || r.scrap_quantity || 1) || 1;
const sumQty = (list) => list.reduce((s, r) => s + qtyOf(r), 0);
const zoneLabel = (z) => String(z?.name || z?.code || "").replace(/^ZONE[-\s]*/i, "Zone ");
const subLabel = (s) => String(s?.code || s?.name || "");
const bump = (obj, k, q) => { obj[k] = (obj[k] || 0) + q; };
/** Parse + place every record once (location logic lives in rejectionConstants — unchanged). */
const placeRows = (rows, views) => rows.map((r) => {
  const _parsed = parseRowDefect(r);
  const loc = resolveDefectLocation(_parsed, views);
  const v = views[loc.viewIndex];
  const z = v && loc.zoneIndex >= 0 ? v.zones[loc.zoneIndex] : null;
  const s = z && loc.subIndex >= 0 ? z.subZones[loc.subIndex] : null;
  return {
    ...r, _parsed, _inferred: loc.inferred && !!z,
    _vk: v ? viewKey(v) : null, _zk: z ? zoneKey(v, z) : null, _sk: s ? subKey(v, z, s) : null,
    _viewName: v ? v.name : "", _zoneName: z ? zoneLabel(z) : "", _subName: s ? subLabel(s) : "",
  };
});

/** View / zone / sub-zone counts — exact keys, quantity-weighted. */
const countLocations = (rows, views) => {
  const vc = {}, zc = {}, sc = {};
  let mapped = 0, inferred = 0;
  rows.forEach((r) => {
    const q = qtyOf(r);
    if (r._vk) bump(vc, r._vk, q);
    if (r._zk) { bump(zc, r._zk, q); mapped += q; if (r._inferred) inferred += q; }
    if (r._sk) bump(sc, r._sk, q);
  });
  const byId = {};
  views.forEach((v) => { byId[v.id] = vc[viewKey(v)] || 0; });
  return { viewDefectCounts: byId, zoneCounts: zc, subZoneCounts: sc, totalMappedDefects: mapped, inferredMapped: inferred };
};

/** Inferred (placed by defect type, no zone entered) quantity per zone key, sub-zone key and most-specific key. */
const countInferred = (rows) => {
  const out = {};
  rows.forEach((r) => {
    if (!r._zk || !r._inferred) return;
    const q = qtyOf(r);
    bump(out, r._zk, q);
    if (r._sk) bump(out, r._sk, q);
    else bump(out, `${r._zk}::${NO_SUB}`, q);
  });
  return out;
};

/** Breakdown of a set of rows: total, inferred, category mix, ranked reasons (quantity-weighted). */
const summarize = (list) => {
  const cats = {}, reasons = {};
  let total = 0, inferred = 0;
  list.forEach((r) => {
    const q = qtyOf(r);
    total += q;
    if (r._inferred) inferred += q;
    bump(cats, String(r._parsed?.category || "CR").toUpperCase(), q);
    bump(reasons, r._parsed?.reason || "Unspecified", q);
  });
  return {
    total, inferred, cats,
    reasons: Object.entries(reasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
};

const exportCsv = (rows, filename) => {
  const head = ["Part ID", "Customer QR", "Category", "Defect", "View", "Zone", "Sub-Zone", "Location Source", "Machine", "Shift", "NG Recorded At"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    r.partId && r.partId !== "-" ? r.partId : "",
    r.customerQrCode || "",
    r._parsed?.category, r._parsed?.reason, r._viewName || r._parsed?.view, r._zoneName || r._parsed?.zone, r._subName || r._parsed?.subZone,
    r._zk ? (r._inferred ? "Inferred from defect type" : "Recorded at inspection") : "Not located",
    r.machineName || r.machine_name || "",
    shiftKey(r.shiftCode || r.shift_code || r.shift),
    r.ngRecordedAt || r.createdAt || "",
  ].map(esc).join(","));
  const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/* ═══════════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */
const Kpi = ({ icon: KpiIcon, label, value, sub, color }) => (
  <div className="ra-kpi dlm-kpi" data-accent style={accent(color)}>
    <div className="ra-kpi-top">
      {KpiIcon && <span className="ra-icon dlm-kpi-icon"><KpiIcon size={14} /></span>}
      <span className="ra-kpi-label">{label}</span>
    </div>
    <div className="ra-kpi-value dlm-ellipsis">{value}</div>
    {sub && <div className="ra-kpi-sub dlm-ellipsis" title={typeof sub === "string" ? sub : undefined}>{sub}</div>}
  </div>
);

const Card = ({ icon: CardIcon, color = ACCENT.process, title, sub, right, children, className = "" }) => (
  <section className={`ra-card ${className}`} data-accent style={accent(color)}>
    <header className="ra-card-head">
      <div className="dlm-head-l">
        {CardIcon && <span className="ra-icon"><CardIcon size={16} /></span>}
        <div style={{ minWidth: 0 }}>
          <h3 className="ra-card-title">{title}</h3>
          {sub && <p className="ra-card-sub">{sub}</p>}
        </div>
      </div>
      {right}
    </header>
    <div className="ra-card-body">{children}</div>
  </section>
);

/** Heat legend: ramp + inferred + selected marks. */
const MapLegend = ({ max }) => (
  <div className="dlm-legend">
    <span className="dlm-ramp">
      <span>Fewer</span>
      <i style={{ background: `linear-gradient(90deg, ${HEAT_RAMP.join(", ")})` }} />
      <span>More{max > 0 ? ` (max ${fmt(max)})` : ""}</span>
    </span>
    <span><b className="dlm-inf-dot" /> Includes inferred</span>
    <span><b className="dlm-sel-mark" /> Selected</span>
  </div>
);

/** Compact breakdown of the selected location (or of the whole scope). */
const Breakdown = ({ stats, located }) => {
  if (!stats.total) return <div className="dlm-empty">No located rejects for the current filters.</div>;
  const catTotal = CAT_KEYS.reduce((s, k) => s + (stats.cats[k] || 0), 0);
  const otherCats = stats.total - catTotal;
  const topReasons = stats.reasons.slice(0, 5);
  const maxReason = topReasons[0]?.count || 1;
  return (
    <div className="dlm-bd">
      <div className="dlm-bd-stats">
        <div><b>{fmt(stats.total)}</b><span>rejects</span></div>
        <div><b>{pctOf(stats.total, located).toFixed(1)}%</b><span>of located</span></div>
        <div><b>{fmt(stats.inferred)}</b><span>inferred</span></div>
      </div>

      <div className="dlm-bd-label">Category mix</div>
      <div className="dlm-mix" role="img" aria-label="Category mix">
        {CAT_KEYS.filter((k) => stats.cats[k]).map((k) => (
          <i key={k} style={{ width: `${pctOf(stats.cats[k], stats.total)}%`, background: DEFECT_CATEGORY[k] }} title={`${DEFECT_CATEGORY_LABEL[k]}: ${fmt(stats.cats[k])}`} />
        ))}
        {otherCats > 0 && <i style={{ width: `${pctOf(otherCats, stats.total)}%`, background: OTHER }} title={`Other: ${fmt(otherCats)}`} />}
      </div>
      <div className="dlm-mix-key">
        {CAT_KEYS.map((k) => (
          <span key={k} title={DEFECT_CATEGORY_LABEL[k]} style={{ opacity: stats.cats[k] ? 1 : 0.45 }}>
            <i style={{ background: DEFECT_CATEGORY[k] }} />{k} <b>{fmt(stats.cats[k] || 0)}</b>
            <em>{pctOf(stats.cats[k] || 0, stats.total).toFixed(0)}%</em>
          </span>
        ))}
      </div>

      <div className="dlm-bd-label">Top defects</div>
      {topReasons.map((r) => (
        <div key={r.reason} className="dlm-reason">
          <div className="dlm-reason-row">
            <span className="dlm-ellipsis" title={r.reason}>{r.reason}</span>
            <b>{fmt(r.count)} <em>{pctOf(r.count, stats.total).toFixed(0)}%</em></b>
          </div>
          <div className="dlm-bar thin"><i style={{ width: `${(r.count / maxReason) * 100}%`, background: OUTCOME.ng }} /></div>
        </div>
      ))}
    </div>
  );
};

const DLM_CSS = `
        .dlm{display:flex;flex-direction:column;gap:16px;font-family:${FONT_FAMILY};color:${INK.primary};min-width:0}
        .dlm *{box-sizing:border-box}
        .dlm-ellipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
        .dlm-head-l{display:flex;align-items:center;gap:10px;min-width:0}
        .dlm-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px}
        .dlm-top h2{margin:0;font-size:17px;font-weight:700;letter-spacing:-.01em}
        .dlm-top p{margin:3px 0 0;font-size:12.5px;color:${INK.muted}}
        .dlm-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .dlm-select{height:34px;padding:0 10px;border:1px solid ${INK.axis};border-radius:8px;background:#fff;font-size:12.5px;color:${INK.primary};min-width:140px;max-width:220px}
        .dlm-btn{height:34px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;border:1px solid ${INK.axis};border-radius:8px;background:#fff;font-size:12.5px;font-weight:600;color:${INK.secondary};cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap}
        .dlm-btn:hover{background:${INK.surfaceAlt};border-color:${INK.faint}}.dlm-btn:disabled{opacity:.5;cursor:default}
        .dlm-btn.sm{height:28px;padding:0 10px;font-size:11.5px}
        .dlm-btn.icon{width:34px;padding:0}
        .dlm-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:0 18px 14px}
        .dlm-chips .ra-chip button{border:0;background:none;color:inherit;cursor:pointer;display:grid;place-items:center;padding:0}
        .dlm-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
        @media(max-width:1000px){.dlm-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
        .dlm-kpi .ra-kpi-value{font-size:21px}
        .dlm-kpi-icon{width:26px;height:26px;border-radius:8px}
        .dlm-views{display:flex;gap:4px;flex-wrap:wrap;padding:4px;background:#fff;border:1px solid ${INK.border};border-radius:12px}
        .dlm-view.active{background:#0f2a4a!important;color:#fff!important}
        .dlm-view.active .n{background:rgba(255,255,255,.2);color:#fff}
        .dlm-view{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:9px;border:0;background:transparent;font-size:12.5px;font-weight:600;color:${INK.body};cursor:pointer;transition:background .15s,color .15s}
        .dlm-view:hover{color:${INK.primary}}
        .dlm-view.active{background:#fff;color:${INK.primary};box-shadow:0 1px 3px rgba(15,23,42,.12)}
        .dlm-view .n{min-width:22px;padding:1px 7px;border-radius:999px;background:${INK.border};color:${INK.secondary};font-size:11px;font-variant-numeric:tabular-nums;font-weight:700;text-align:center}
        .dlm-view .n.hot{background:${withAlpha(OUTCOME.ng, 0.12)};color:#b91c1c}
        .dlm-main{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);gap:16px;align-items:start}
        .dlm-side{display:flex;flex-direction:column;gap:16px;min-width:0}
        @media(max-width:1100px){.dlm-main{grid-template-columns:minmax(0,1fr)}}
        .dlm-legend{display:flex;gap:16px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:${INK.body}}
        .dlm-legend>span{display:inline-flex;align-items:center;gap:6px}
        .dlm-ramp i{display:block;width:120px;height:8px;border-radius:4px}
        .dlm-ramp span{color:${INK.muted}}
        .dlm-inf-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:${INFERRED};border:1px solid #fff;margin-left:4px;vertical-align:1px;box-shadow:0 0 0 1px ${withAlpha(INFERRED, 0.5)}}
        .dlm-legend .dlm-inf-dot{margin-left:0}
        .dlm-sel-mark{display:inline-block;width:14px;height:10px;border-radius:3px;border:2px solid ${SELECT_RING}}
        .dlm-map-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
        .dlm-map-note{font-size:11.5px;color:${INK.muted}}
        .dlm-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:12px}
        .dlm-gcard{border:1px solid ${INK.border};border-radius:12px;padding:10px;cursor:pointer;transition:border-color .15s,box-shadow .15s;background:#fff;text-align:left;font:inherit;color:inherit;min-width:0}
        .dlm-gcard:hover,.dlm-gcard:focus-visible{border-color:#93c5fd;box-shadow:0 4px 14px -6px rgba(37,99,235,.35);outline:none}
        .dlm-gcard-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;font-size:12.5px;font-weight:600}
        .dlm-gcard-head span{font-size:11.5px;color:${INK.muted};font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
        .dlm-hit{cursor:pointer}
        .dlm-hit.cad-zone:hover{border-color:${SELECT_RING}!important;border-style:solid!important}
        .dlm-hit.cad-sub:hover{border-color:${SELECT_RING}!important;z-index:3}
        .dlm-fs{position:fixed;inset:0;z-index:1200;background:rgba(15,23,42,.82);display:flex;align-items:center;justify-content:center;padding:24px}
        .dlm-fs-inner{background:#fff;border-radius:12px;padding:10px;position:relative;max-width:calc(100vw - 48px);max-height:calc(100vh - 48px)}
        .dlm-fs-inner .cad-stage{width:100%!important;max-height:none}
        .dlm-fs-close{position:absolute;top:-14px;right:-14px;width:32px;height:32px;border-radius:50%;border:0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer;display:grid;place-items:center;z-index:5}
        .dlm-list{display:flex;flex-direction:column;gap:2px}
        .dlm-loc{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 8px;border-radius:9px;cursor:pointer;border:1px solid transparent;background:none;font:inherit;color:inherit;text-align:left;width:100%;transition:background .15s,border-color .15s}
        .dlm-loc:hover{background:${INK.surfaceAlt};border-color:${INK.border}}
        .dlm-loc.sel{background:#eff6ff;border-color:#bfdbfe}
        .dlm-loc .rk{width:24px;height:24px;border-radius:7px;background:${INK.grid};color:${INK.secondary};font-size:11px;font-weight:700;display:grid;place-items:center;font-variant-numeric:tabular-nums}
        .dlm-loc.top .rk{background:${withAlpha(ACCENT.location, 0.14)};color:#c2410c}
        .dlm-loc .nm{font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:4px;min-width:0}
        .dlm-loc .vw{font-size:11px;color:${INK.faint};font-weight:500;margin-left:4px;white-space:nowrap}
        .dlm-loc .ct{text-align:right;font-variant-numeric:tabular-nums;line-height:1.2}
        .dlm-loc .ct b{display:block;font-size:13px;font-weight:700}
        .dlm-loc .ct span{font-size:11px;color:${INK.muted};font-weight:600}
        .dlm-bar{height:5px;border-radius:3px;background:${INK.grid};margin-top:5px;overflow:hidden}
        .dlm-bar>i{display:block;height:100%;border-radius:3px}
        .dlm-bar.thin{height:4px;margin-top:4px}
        .dlm-empty{display:flex;align-items:center;justify-content:center;min-height:120px;font-size:12.5px;color:${INK.faint};text-align:center;padding:16px}
        .dlm-bd-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
        .dlm-bd-stats>div{border:1px solid ${INK.border};border-radius:10px;padding:8px 10px;background:${INK.surfaceAlt};min-width:0}
        .dlm-bd-stats b{display:block;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
        .dlm-bd-stats span{font-size:10.5px;color:${INK.muted};font-weight:600;text-transform:uppercase;letter-spacing:.05em}
        .dlm-bd-label{margin:14px 0 6px;font-size:10.5px;font-weight:700;color:${INK.muted};text-transform:uppercase;letter-spacing:.06em}
        .dlm-mix{display:flex;height:10px;border-radius:5px;overflow:hidden;background:${INK.grid};gap:2px}
        .dlm-mix i{display:block;height:100%}
        .dlm-mix-key{display:flex;gap:12px;flex-wrap:wrap;margin-top:7px;font-size:11.5px;color:${INK.body}}
        .dlm-mix-key span{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}
        .dlm-mix-key i{display:inline-block;width:9px;height:9px;border-radius:2px}
        .dlm-mix-key b{color:${INK.primary}}
        .dlm-mix-key em,.dlm-reason em{font-style:normal;color:${INK.muted};font-weight:500;font-size:11px}
        .dlm-reason{padding:4px 0}
        .dlm-reason-row{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:${INK.secondary}}
        .dlm-reason-row b{font-weight:700;font-variant-numeric:tabular-nums;color:${INK.primary};white-space:nowrap}
        .dlm-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
        .dlm-table-wrap{overflow:auto;max-height:340px}
        .dlm-table{width:100%;border-collapse:collapse;font-size:12px}
        .dlm-table th{text-align:left;font-size:10.5px;font-weight:600;color:${INK.muted};text-transform:uppercase;letter-spacing:.05em;padding:8px 10px;border-bottom:1px solid ${INK.border};background:${INK.surfaceAlt};position:sticky;top:0;white-space:nowrap}
        .dlm-table td{padding:7px 10px;border-bottom:1px solid ${INK.grid};vertical-align:middle;white-space:nowrap}
        .dlm-tip{position:fixed;z-index:4000;pointer-events:none;background:#fff;border:1px solid ${INK.border};border-radius:10px;padding:10px 12px;box-shadow:0 12px 32px rgba(15,23,42,.14),0 2px 6px rgba(15,23,42,.08);font-size:12px;min-width:190px;max-width:240px;line-height:1.45}
        .dlm-tip h6{margin:0;font-size:12.5px;font-weight:700;color:${INK.primary}}
        .dlm-tip p{margin:1px 0 0;color:${INK.muted};font-size:11px}
        .dlm-tip .g{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;margin-top:7px;padding-top:7px;border-top:1px solid ${INK.border}}
        .dlm-tip .g span{display:flex;align-items:center;gap:6px;color:${INK.body}}
        .dlm-tip .g span i{width:8px;height:8px;border-radius:2px;flex-shrink:0}
        .dlm-tip .g b{text-align:right;font-variant-numeric:tabular-nums}
        @media(max-width:560px){
          .dlm-top,.ra-card-head{padding-left:14px;padding-right:14px}
          .dlm-controls{width:100%}
          .dlm-select{flex:1 1 140px;max-width:none;min-width:0}
          .dlm-ramp i{width:80px}
          .dlm-loc .vw{display:none}
        }
      
        .dlm-state{display:flex;align-items:center;gap:14px;padding:22px 20px;min-height:140px}
        .dlm-state>div{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
        .dlm-state b{font-size:14px;color:${INK.primary}}
        .dlm-state span{font-size:12.5px;color:${INK.muted}}
        .dlm-state.err{color:#991b1b;border-color:#fecaca;background:#fff7f7}
        .dlm-spin{width:22px;height:22px;border-radius:50%;border:3px solid ${INK.border};border-top-color:${ACCENT.process};animation:dlm-spin .8s linear infinite;flex-shrink:0}
        @keyframes dlm-spin{to{transform:rotate(360deg)}}
        .dlm-crumbs{margin:0;padding:6px 10px;background:#fff;border:1px solid ${INK.border};border-radius:12px}
        .dlm-tip{max-width:280px}
`;

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN — hierarchical drill-down: all views → view (zones) → zone (sub-zones) → sub-zone (reasons + categories)
   ═══════════════════════════════════════════════════════════════════════════ */
const LEVEL_HINT = [
  "Open a view, or click a zone in the ranking to drill into it.",
  "Click a zone on the part (or in the ranking) for its sub-zones.",
  "Click a sub-zone for its reasons and categories.",
  "Reasons and categories of this sub-zone.",
];

const topReasonOf = (reasonsAt, k) => {
  const e = Object.entries(reasonsAt[k] || {}).sort((a, b) => b[1] - a[1])[0];
  return e ? { reason: e[0], count: e[1] } : null;
};
const topNote = (reasonsAt, k) => { const t = topReasonOf(reasonsAt, k); return t ? `Top reason: ${t.reason} (${fmt(t.count)})` : undefined; };

export default function HeatMapTab({
  allRejectionRecords = [],
  rejectionConfig = null,
  loading = false,
  configLoading = false,
  error = null,
  onRetry,
  filterText = "",
}) {
  const sourceRows = useMemo(() => (Array.isArray(allRejectionRecords) ? allRejectionRecords : []), [allRejectionRecords]);
  const [drill, setDrill] = useState({ viewId: null, zk: null, sk: null });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hover, setHover] = useState(null); // { x, y, title, sub, rows }
  const [paneRef, paneW] = usePaneWidth();

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setIsFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const views = useMemo(() => rejectionConfig?.views || [], [rejectionConfig]);

  /* Parse + place every record once */
  const parsedRows = useMemo(() => placeRows(sourceRows, views), [sourceRows, views]);
  // Leak-test rejects come from the pressure-decay sensor and have no visual location.
  const sensorRows = useMemo(() => parsedRows.filter((r) => r._parsed.sensorReject), [parsedRows]);
  const visualRows = useMemo(() => parsedRows.filter((r) => !r._parsed.sensorReject), [parsedRows]);
  const totalVisual = useMemo(() => sumQty(visualRows), [visualRows]);

  const { viewDefectCounts, zoneCounts, subZoneCounts, totalMappedDefects, inferredMapped } = useMemo(
    () => countLocations(visualRows, views), [visualRows, views],
  );
  const inferredBy = useMemo(() => countInferred(visualRows), [visualRows]);
  // reason counts per zone key / sub-zone key (for the map tooltips)
  const reasonsAt = useMemo(() => {
    const m = {};
    visualRows.forEach((r) => {
      const reason = r._parsed?.reason || "Unspecified";
      [r._zk, r._sk].filter(Boolean).forEach((k) => { const b = m[k] || (m[k] = {}); bump(b, reason, qtyOf(r)); });
    });
    return m;
  }, [visualRows]);
  const topReasonAt = (k) => topReasonOf(reasonsAt, k);

  /* Drill scope */
  const currentView = drill.viewId != null ? views.find((v) => String(v.id) === String(drill.viewId)) || null : null;
  const currentZone = currentView && drill.zk ? (currentView.zones || []).find((z) => zoneKey(currentView, z) === drill.zk) || null : null;
  const remainderKey = currentZone ? `${zoneKey(currentView, currentZone)}::${NO_SUB}` : null;
  const currentSub = currentZone && drill.sk && drill.sk !== remainderKey ? (currentZone.subZones || []).find((s) => subKey(currentView, currentZone, s) === drill.sk) || null : null;
  const level = currentZone && drill.sk ? 3 : currentZone ? 2 : currentView ? 1 : 0;

  const zoneCount = (view, zone) => zoneCounts[zoneKey(view, zone)] || 0;
  const subCount = (view, zone, sub) => subZoneCounts[subKey(view, zone, sub)] || 0;

  const scopeRows = useMemo(() => {
    if (level === 3) return currentSub ? visualRows.filter((r) => r._sk === drill.sk) : visualRows.filter((r) => r._zk === drill.zk && !r._sk);
    if (level === 2) return visualRows.filter((r) => r._zk === drill.zk);
    if (level === 1) return visualRows.filter((r) => r._zk && rowMatchesView(r, currentView));
    return visualRows.filter((r) => r._zk);
  }, [level, visualRows, drill.sk, drill.zk, currentSub, currentView]);
  const breakdown = useMemo(() => summarize(scopeRows), [scopeRows]);
  const scopeTotal = breakdown.total;

  /* Distribution of the current level: zones (levels 0–1) → sub-zones (level 2) */
  const zoneItems = useMemo(() => {
    const list = [];
    (currentView ? [currentView] : views).forEach((v) => (v.zones || []).forEach((z) => {
      const c = zoneCounts[zoneKey(v, z)] || 0;
      if (c > 0) list.push({ key: zoneKey(v, z), view: v, zone: z, label: views.length > 1 && !currentView ? `${zoneLabel(z)} · ${v.name}` : zoneLabel(z), value: c });
    }));
    return list.sort((a, b) => b.value - a.value);
  }, [views, currentView, zoneCounts]);
  const subItems = useMemo(() => {
    if (!currentZone) return [];
    const list = (currentZone.subZones || []).map((s) => ({ key: subKey(currentView, currentZone, s), sub: s, label: `${zoneLabel(currentZone)} › ${subLabel(s)}`, value: subZoneCounts[subKey(currentView, currentZone, s)] || 0 }))
      .filter((x) => x.value > 0);
    const inSubs = list.reduce((a, x) => a + x.value, 0);
    const rest = (zoneCounts[zoneKey(currentView, currentZone)] || 0) - inSubs;
    if (rest > 0) list.push({ key: remainderKey, sub: null, label: (currentZone.subZones || []).length ? "No sub-zone recorded" : `${zoneLabel(currentZone)} (no sub-zones defined)`, value: rest });
    return list.sort((a, b) => b.value - a.value);
  }, [currentView, currentZone, subZoneCounts, zoneCounts, remainderKey]);
  const reasonItems = useMemo(() => {
    const byReason = {};
    scopeRows.forEach((r) => {
      const k = r._parsed?.reason || "Unspecified";
      const b = byReason[k] || (byReason[k] = { value: 0, cats: {} });
      b.value += qtyOf(r);
      bump(b.cats, String(r._parsed?.category || "OTHER").toUpperCase(), qtyOf(r));
    });
    const list = Object.entries(byReason).map(([label, b]) => {
      const cat = Object.entries(b.cats).sort((x, y) => y[1] - x[1])[0]?.[0] || "OTHER";
      return { key: label, label, value: b.value, color: DEFECT_CATEGORY[cat] || OTHER, group: cat };
    }).sort((a, b) => b.value - a.value);
    if (list.length <= 13) return list;
    const rest = list.slice(12);
    return [...list.slice(0, 12), { key: null, label: `Other (${rest.length} reasons)`, value: rest.reduce((a, x) => a + x.value, 0), color: OTHER, group: "Mixed" }];
  }, [scopeRows]);

  const viewPareto = useMemo(() => {
    const list = views.map((v) => ({ key: v.id, view: v, label: v.name, value: viewDefectCounts[v.id] || 0 })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const max = list[0]?.value || 1;
    return list.map((x) => ({ ...x, color: heatColorFor(x.value, max) || INK.faint, note: "Click to open this view." }));
  }, [views, viewDefectCounts]);
  const onViewBar = (it) => { if (it?.view) openView(it.view.id); };

  const zonePareto = useMemo(() => {
    const max = zoneItems[0]?.value || 1;
    const top = zoneItems.slice(0, 15).map((z) => ({ ...z, color: heatColorFor(z.value, max) || INK.faint, note: topNote(reasonsAt, z.key) }));
    const rest = zoneItems.slice(15);
    if (rest.length) top.push({ key: null, label: `Other (${rest.length} zones)`, value: rest.reduce((a, x) => a + x.value, 0), color: OTHER });
    return top;
  }, [zoneItems, reasonsAt]);
  const subPareto = useMemo(() => {
    const max = subItems.filter((x) => x.sub).reduce((m, x) => Math.max(m, x.value), 1);
    return subItems.map((x) => ({ ...x, color: x.sub ? heatColorFor(x.value, max) || INK.faint : OTHER, note: x.sub ? topNote(reasonsAt, x.key) : "Placed on the zone without a sub-zone." }));
  }, [subItems, reasonsAt]);

  /* Navigation (the page filters stay as they are) */
  const openView = (id) => { setDrill({ viewId: id, zk: null, sk: null }); setHover(null); };
  const openZone = (view, zone) => { setDrill({ viewId: view.id, zk: zoneKey(view, zone), sk: null }); setHover(null); };
  const openSub = (sk) => { setDrill((d) => ({ ...d, sk: d.sk === sk ? null : sk })); setHover(null); };
  // a sub-zone clicked on the picture selects its zone and the sub-zone in one step
  const openSubOf = (view, zone, sk) => { setDrill((d) => ({ viewId: view.id, zk: zoneKey(view, zone), sk: d.sk === sk ? null : sk })); setHover(null); };
  const back = () => setDrill((d) => (d.sk ? { ...d, sk: null } : d.zk ? { ...d, zk: null } : { viewId: null, zk: null, sk: null }));
  const onZoneBar = (it) => { if (it?.key && it.view) openZone(it.view, it.zone); };
  const onSubBar = (it) => { if (it?.key) openSub(it.key); };

  // Fullscreen box follows the image's own shape (portrait views stay portrait)
  const fsAspect = useViewFrameAspect(currentView?.imageUrl ? getFullImageUrl(currentView.imageUrl) : "");

  /* ── Hover card for the map ── */
  const showHover = (e, title, sub, rowsOut) => setHover({ x: e.clientX, y: e.clientY, title, sub, rows: rowsOut });
  const hoverRows = (count, inferred, base, baseLabel, key) => {
    const top = topReasonAt(key);
    return [
      { label: "Rejections", value: fmt(count), color: OUTCOME.ng },
      { label: baseLabel, value: `${pctOf(count, base).toFixed(1)}%` },
      top ? { label: "Top reason", value: `${top.reason} (${fmt(top.count)})` } : null,
      inferred > 0 ? { label: "Inferred from defect type", value: fmt(inferred), color: INFERRED } : null,
    ].filter(Boolean);
  };

  /* ── Overlays: zones heat (sub-zones only inside the drilled zone) ── */
  const renderOverlays = (view, mode) => {
    const zones = view.zones || [];
    const maxZone = Math.max(1, ...zones.map((z) => zoneCount(view, z)));
    const viewLocated = zones.reduce((s, z) => s + zoneCount(view, z), 0);
    const interactive = mode !== "gallery";
    return zones.map((zone) => {
      const zk = zoneKey(view, zone);
      const zc = zoneCount(view, zone);
      const zInf = inferredBy[zk] || 0;
      const isSel = currentZone === zone;
      const drilled = !!currentZone && view === currentView;
      const zCol = heatColorFor(zc, maxZone);
      const faded = drilled && !isSel;
      // every zone shows its sub-zones on the view (heat = share of the zone); faded zones keep them faded
      const subs = interactive ? zone.subZones || [] : [];
      const maxSub = Math.max(1, ...subs.map((s) => subCount(view, zone, s)));
      return (
        <React.Fragment key={zone.id || zone.code}>
          <div
            className={`cad-zone ${interactive ? "dlm-hit" : ""}`}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? `${zoneLabel(zone)}: ${fmt(zc)} rejections` : undefined}
            onClick={interactive ? () => openZone(view, zone) : undefined}
            onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openZone(view, zone); } } : undefined}
            onMouseMove={interactive ? (e) => showHover(e, `${view.name} · ${zoneLabel(zone)}`, isSel ? "Selected zone" : drilled ? "Click to switch to this zone" : "Click for its sub-zones", hoverRows(zc, zInf, viewLocated, "Share of the view", zk)) : undefined}
            onMouseLeave={interactive ? () => setHover(null) : undefined}
            style={{
              ...boxStyle(zone),
              ...(zCol && !faded ? { border: `1.5px solid ${zCol}`, background: withAlpha(zCol, isSel ? 0.08 : 0.18 + Math.sqrt(zc / maxZone) * 0.42) } : {}),
              ...(faded ? { opacity: 0.45, background: zCol ? withAlpha(zCol, 0.12) : undefined } : {}),
              ...(isSel ? { border: `2px solid ${SELECT_RING}`, boxShadow: `0 0 0 3px ${withAlpha(SELECT_RING, 0.22)}` } : {}),
            }}
          >
            <span className="cad-tag">
              {zoneLabel(zone)}
              {zc > 0 && <span className="cad-count" style={{ background: zCol, color: heatInk(zc, maxZone) }}>{fmt(zc)}</span>}
              {zInf > 0 && <b className="dlm-inf-dot" title={`${fmt(zInf)} inferred`} />}
            </span>
          </div>
          {subs.map((sz) => {
            const sk = subKey(view, zone, sz);
            const sc = subCount(view, zone, sz);
            const sInf = inferredBy[sk] || 0;
            const sCol = heatColorFor(sc, maxSub);
            const sSel = drill.sk === sk;
            return (
              <div
                key={`s-${sz.id || sz.code}`}
                className="cad-sub dlm-hit"
                role="button"
                tabIndex={0}
                aria-label={`${zoneLabel(zone)} › ${subLabel(sz)}: ${fmt(sc)} rejections`}
                onClick={(e) => { e.stopPropagation(); openSubOf(view, zone, sk); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openSubOf(view, zone, sk); } }}
                onMouseMove={(e) => { e.stopPropagation(); showHover(e, `${zoneLabel(zone)} › ${subLabel(sz)}`, "Click for its reasons and categories", hoverRows(sc, sInf, zc, "Share of the zone", sk)); }}
                onMouseLeave={() => setHover(null)}
                style={{
                  ...subBoxStyle(zone, sz),
                  ...(sCol ? { border: `1.5px solid ${sCol}`, background: withAlpha(sCol, 0.3 + Math.sqrt(sc / maxSub) * 0.45) } : {}),
                  ...(sSel ? { border: `2px solid ${SELECT_RING}`, boxShadow: `0 0 0 3px ${withAlpha(SELECT_RING, 0.25)}`, zIndex: 4 } : {}),
                  ...(faded && !sSel ? { opacity: 0.45 } : {}),
                }}
              >
                <span className="cad-tag">
                  {subLabel(sz)}
                  {sc > 0 && <span className="cad-count" style={{ background: sCol, color: heatInk(sc, maxSub) }}>{fmt(sc)}</span>}
                  {sInf > 0 && <b className="dlm-inf-dot" />}
                </span>
              </div>
            );
          })}
        </React.Fragment>
      );
    });
  };

  const hoverPos = hover ? {
    left: Math.max(8, Math.min(hover.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 270)),
    top: Math.max(8, Math.min(hover.y + 14, (typeof window !== "undefined" ? window.innerHeight : 800) - 170)),
  } : null;

  const unlocated = Math.max(0, totalVisual - totalMappedDefects);
  const topZone = zoneItems[0] || null;
  const levelName = level === 3 ? (currentSub ? `${zoneLabel(currentZone)} › ${subLabel(currentSub)}` : `${zoneLabel(currentZone)} · no sub-zone`) : level === 2 ? zoneLabel(currentZone) : level === 1 ? currentView.name : "All views";
  const exportRows = level === 0 ? visualRows : scopeRows;
  const labelW = Math.max(96, Math.min(190, Math.round((paneW || 420) * 0.36)));
  const showRecords = level >= 2 && scopeRows.length > 0;
  const waitingRows = loading && !sourceRows.length;
  const waitingViews = configLoading && !views.length;

  /* ═════ RENDER ═════ */
  return (
    <div className="dlm">
      <style>{CARD_CSS}{DLM_CSS}</style>

      {/* ── HEADER ── */}
      <section className="ra-card">
        <div className="dlm-top">
          <div style={{ minWidth: 0 }}>
            <h2>Defect Location Map</h2>
            <p>Where visual rejections occur on the casting — start with the zones, drill into sub-zones, then their reasons and categories.{filterText ? ` Filtered: ${filterText}.` : ""}</p>
          </div>
          <div className="dlm-controls">
            <button className="dlm-btn" disabled={!exportRows.length || waitingRows}
              onClick={() => exportCsv(exportRows, `defect_locations_${normalize(levelName) || "all"}_${new Date().toISOString().slice(0, 10)}.csv`)}
              title={level ? `Export the records of ${levelName}` : "Export every visual reject of the period"}>
              <Download size={14} /> Export
            </button>
          </div>
        </div>
      </section>

      {error && !sourceRows.length ? (
        <section className="ra-card dlm-state err" role="alert">
          <AlertTriangle size={20} />
          <div><b>NG records could not be loaded.</b><span>{String(error)}</span></div>
          {onRetry && <button type="button" className="dlm-btn" onClick={onRetry}>Retry</button>}
        </section>
      ) : waitingRows ? (
        <section className="ra-card dlm-state" role="status" aria-live="polite">
          <span className="dlm-spin" aria-hidden="true" />
          <div><b>Loading NG records…</b><span>The location map, counts and percentages appear once every rejection of the period has arrived.</span></div>
        </section>
      ) : (
        <>
          {/* ── KPIs (from the actual records) ── */}
          <div className="dlm-kpis">
            <Kpi icon={Activity} label="Visual rejects" value={fmt(totalVisual)} sub={filterText ? `Matching ${filterText}` : "Recorded at visual inspection"} color={OUTCOME.ng} />
            <Kpi icon={Crosshair} label="Located on part" value={waitingViews ? "…" : `${pctOf(totalMappedDefects, totalVisual).toFixed(1)}%`}
              sub={waitingViews ? "Loading part views…" : `${fmt(totalMappedDefects)} placed${inferredMapped ? ` · ${fmt(inferredMapped)} inferred` : ""}`} color={ACCENT.process} />
            <Kpi icon={MapPin} label="Top zone" value={waitingViews ? "…" : topZone ? fmt(topZone.value) : "—"}
              sub={waitingViews ? "Loading part views…" : topZone ? `${topZone.view.name} · ${zoneLabel(topZone.zone)} · ${pctOf(topZone.value, totalMappedDefects).toFixed(1)}%` : "No located rejects"} color={ACCENT.location} />
            <Kpi icon={Gauge} label="Leak-test rejects" value={fmt(sumQty(sensorRows))} sub="Sensor rejects, not on the map" color={ACCENT.quality} />
          </div>

          {/* ── VIEW TABS: all views together, or one view ── */}
          {views.length > 0 && !waitingViews && (
            <div className="dlm-views" role="tablist" aria-label="Inspection views">
              <button type="button" role="tab" aria-selected={!currentView} className={`dlm-view ${!currentView ? "active" : ""}`} onClick={() => setDrill({ viewId: null, zk: null, sk: null })}>
                <Layers size={13} aria-hidden="true" />All views <span className="n">{fmt(totalMappedDefects)}</span>
              </button>
              {views.map((v) => {
                const c = viewDefectCounts[v.id] || 0;
                const on = currentView && String(currentView.id) === String(v.id);
                return (
                  <button key={v.id} type="button" role="tab" aria-selected={!!on} className={`dlm-view ${on ? "active" : ""}`} onClick={() => openView(v.id)}>
                    {v.name} <span className={`n ${c > 0 && c === Math.max(...views.map((x) => viewDefectCounts[x.id] || 0)) ? "hot" : ""}`}>{fmt(c)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── BREADCRUMB ── */}
          <nav className="mg-crumbs dlm-crumbs" aria-label="Location drill-down">
            {level > 0 && <button type="button" className="mg-back" onClick={back}><ArrowLeft size={14} />Back</button>}
            {level > 0 ? <button type="button" onClick={() => setDrill({ viewId: null, zk: null, sk: null })}>All views</button> : <b aria-current="page">All views</b>}
            {currentView && <><ChevronRight size={14} aria-hidden="true" />{level > 1 ? <button type="button" onClick={() => openView(currentView.id)}>{currentView.name}</button> : <b aria-current="page">{currentView.name}</b>}</>}
            {currentZone && <><ChevronRight size={14} aria-hidden="true" />{level > 2 ? <button type="button" onClick={() => setDrill((d) => ({ ...d, sk: null }))}>{zoneLabel(currentZone)}</button> : <b aria-current="page">{zoneLabel(currentZone)}</b>}</>}
            {level === 3 && <><ChevronRight size={14} aria-hidden="true" /><b aria-current="page">{currentSub ? subLabel(currentSub) : "No sub-zone"}</b></>}
            <span className="mg-hint" style={{ marginLeft: "auto" }}>{LEVEL_HINT[level]}</span>
          </nav>

          {/* ── MAP + DISTRIBUTION ── */}
          <div className="dlm-main">
            <Card
              icon={Layers}
              color={ACCENT.process}
              title={currentView ? `${currentView.name}${currentZone ? ` · ${zoneLabel(currentZone)}` : ""}` : "All inspection views"}
              sub={level === 0 ? "Every view with its zone heat — click a view (or a view tab above) to open it" : level === 1 ? "Zone and sub-zone heat — darker = more rejections · click a zone or a sub-zone" : "Sub-zones of the selected zone (heat = share of the zone) · click a sub-zone for its records"}
              right={currentView && <button className="dlm-btn icon" onClick={() => setIsFullscreen(true)} title="Full screen" aria-label="Full screen"><Maximize2 size={14} /></button>}
            >
              {waitingViews ? <SkeletonBlock lines={6} height={320} />
                : !views.length ? (
                  <div className="dlm-empty">No CAD views are configured for {PART_NAME} (Rejection Configuration → View Setup).</div>
                ) : !currentView ? (
                  <div className="dlm-gallery">
                    {views.map((v) => {
                      const c = viewDefectCounts[v.id] || 0;
                      return (
                        <button type="button" key={v.id} className="dlm-gcard" onClick={() => openView(v.id)} title={`Open ${v.name}`}>
                          <div className="dlm-gcard-head"><span className="dlm-ellipsis" style={{ color: INK.primary, fontSize: 12.5 }}>{v.name}</span><span>{fmt(c)} rejects · {pctOf(c, totalMappedDefects).toFixed(0)}%</span></div>
                          <CadStage imageUrl={v.imageUrl} alt={v.name}>{renderOverlays(v, "gallery")}</CadStage>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className={isFullscreen ? "dlm-fs" : ""} onClick={isFullscreen ? (e) => { if (e.target === e.currentTarget) setIsFullscreen(false); } : undefined}>
                    <div
                      className={isFullscreen ? "dlm-fs-inner" : ""}
                      style={isFullscreen ? { width: `min(calc(100vw - 48px), calc((100vh - 68px) * ${fsAspect}))` } : undefined}
                    >
                      {isFullscreen && <button className="dlm-fs-close" onClick={() => setIsFullscreen(false)} aria-label="Close full screen"><Minimize2 size={15} /></button>}
                      <CadStage imageUrl={currentView.imageUrl} alt={`${currentView.name} defect map`}>{renderOverlays(currentView, "view")}</CadStage>
                    </div>
                  </div>
                )}
              {views.length > 0 && !waitingViews && (
                <div className="dlm-map-foot">
                  <MapLegend max={level >= 2 ? Math.max(0, ...subItems.filter((x) => x.sub).map((x) => x.value)) : currentView ? Math.max(0, ...zoneItems.map((x) => x.value)) : 0} />
                  {unlocated > 0 && <span className="dlm-map-note">{fmt(unlocated)} visual rejects have no zone on the part and are not drawn.</span>}
                </div>
              )}
            </Card>

            <div className="dlm-side" ref={paneRef}>
              {level === 0 && (
                <div id="dlm-view-pareto">
                  <Card icon={ListOrdered} color={ACCENT.location} title="Rejections by view"
                    sub={`${fmt(totalMappedDefects)} located rejects · count and share per inspection view · click a view to open it`}>
                    {waitingViews ? <SkeletonBlock lines={5} height={240} />
                      : !viewPareto.length ? <div className="dlm-empty">No located rejects for the current filters.</div>
                        : <ParetoChart items={viewPareto} total={totalMappedDefects} labelWidth={labelW} showPct valueName="Rejections" onSelect={onViewBar} selectHint="Click to open this view." height={300} />}
                  </Card>
                </div>
              )}
              <Card icon={MapPin} color={level ? SELECT_RING : ACCENT.neutral}
                title={level >= 2 ? `Categories — ${levelName}` : `${levelName} — category mix`}
                sub={level ? `${fmt(scopeTotal)} rejects · ${pctOf(scopeTotal, totalMappedDefects).toFixed(1)}% of located` : "Select a zone to narrow down"}>
                <Breakdown stats={breakdown} located={totalMappedDefects} />
              </Card>
            </div>
          </div>

          {/* ── ZONE PARETO (all views or the selected view) / SUB-ZONE PARETO ── */}
          {level <= 1 && (
            <div id="dlm-zone-pareto">
              <Card icon={ListOrdered} color={ACCENT.location} title={level === 0 ? "Zone Pareto — all views" : `Zone Pareto — ${currentView.name}`}
                sub={`${fmt(scopeTotal)} located rejects · biggest zone first · cumulative share and 80 % line · click a zone for its sub-zones`}>
                {waitingViews ? <SkeletonBlock lines={5} height={260} />
                  : !zonePareto.length ? <div className="dlm-empty">No located rejects for the current filters.</div>
                    : <ParetoChart items={zonePareto} total={scopeTotal} labelWidth={140} showPct valueName="Rejections" onSelect={onZoneBar} selectHint="Click for the sub-zones of this zone." />}
              </Card>
            </div>
          )}
          {level === 2 && (
            <div id="dlm-zone-pareto">
              <Card icon={ListOrdered} color={ACCENT.location} title={`Sub-zone Pareto — ${zoneLabel(currentZone)}`}
                sub={`${fmt(scopeTotal)} rejects in the zone · share = % of the zone · click a sub-zone`}>
                {!subPareto.length ? <div className="dlm-empty">No rejects in this zone.</div>
                  : <ParetoChart items={subPareto} total={scopeTotal} labelWidth={140} showPct valueName="Rejections" onSelect={onSubBar} selectHint="Click for the reasons and categories of this sub-zone." />}
              </Card>
            </div>
          )}

          {/* ── REJECTION PARETO OF THE SELECTED ZONE / SUB-ZONE ── */}
          {level >= 2 && (
            <Card icon={ListOrdered} color={OUTCOME.ng} title={`Rejection Pareto — ${levelName}`}
              sub={`Reasons biggest first · ${fmt(scopeTotal)} rejects · bar colour = dominant category`}>
              {!reasonItems.length ? <div className="dlm-empty">No rejects here.</div>
                : <ParetoChart items={reasonItems} total={scopeTotal} labelWidth={140} showPct valueName="Rejections" />}
            </Card>
          )}

          {/* ── RECORDS ── */}
          {showRecords && (
            <Card icon={Activity} color={ACCENT.neutral} title={`Reject records · ${levelName}`}
              sub={`${fmt(scopeRows.length)} records${scopeRows.length > 50 ? " · first 50 shown, export for all" : ""}`}
              right={<button className="dlm-btn sm" onClick={() => exportCsv(scopeRows, `location_${normalize(levelName)}.csv`)}><Download size={13} /> Records CSV</button>}>
              <div className="dlm-table-wrap">
                <table className="dlm-table">
                  <thead><tr><th>Part serial / QR</th><th>Category</th><th>Defect</th><th>Location</th><th>Shift</th><th>Machine</th></tr></thead>
                  <tbody>
                    {scopeRows.slice(0, 50).map((r, i) => (
                      <tr key={r.id || i}>
                        <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{r.partId && r.partId !== "-" ? r.partId : r.customerQrCode || "—"}</td>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <i style={{ width: 8, height: 8, borderRadius: 2, background: DEFECT_CATEGORY[String(r._parsed?.category || "").toUpperCase()] || OTHER }} />
                            {r._parsed?.category || "—"}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{r._parsed?.reason || "—"}</td>
                        <td>
                          {r._zoneName || "—"}{r._subName ? ` › ${r._subName}` : ""}
                          {r._inferred && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "#b45309" }} title="No zone entered at inspection — placed by defect type">inferred</span>}
                        </td>
                        <td>{shiftKey(r.shiftCode || r.shift_code || r.shift)}</td>
                        <td>{r.machineName || r.machine_name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── MAP HOVER CARD ── */}
      {hover && hoverPos && (
        <div className="dlm-tip" style={hoverPos} role="tooltip">
          <h6>{hover.title}</h6>
          {hover.sub && <p>{hover.sub}</p>}
          <div className="g">
            {hover.rows.map((r) => (
              <React.Fragment key={r.label}>
                <span>{r.color && <i style={{ background: r.color }} />}{r.label}</span>
                <b>{r.value}</b>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Width of an element (ResizeObserver) — sizes the Pareto label gutter of the side panel. */
function usePaneWidth() {
  const [el, setEl] = useState(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const ro = new ResizeObserver((e) => setW(e[0]?.contentRect?.width || 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}
