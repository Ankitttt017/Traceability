import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin, X, AlertTriangle, Grid, Eye, Maximize2, Minimize2, Download, Gauge, Crosshair, Target, Layers, Activity,
  PieChart, TrendingUp, Clock, LayoutGrid, Sigma,
} from "lucide-react";
import { rejectionConfigApi } from "../../api/services";
import EChart from "../../components/charts/EChart";
import { parseRowDefect, resolveDefectLocation, boxStyle } from "./rejectionConstants";
import CadStage from "./components/CadStage";
import {
  SEQ_SCRAP, ECHART_TOOLTIP, OUTCOME, INK, ACCENT, CATEGORICAL, OTHER, DEFECT_CATEGORY, DEFECT_CATEGORY_LABEL, SHIFT,
  FONT_FAMILY, LEGEND, tooltipHtml, makeColorMap, DEFECT_PALETTE, shiftKey, seqColor, accent, axisLabel, axisName, valueAxis, categoryAxis,
} from "./chartTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════════════════════════ */
// Sequential warm ramp, sqrt-scaled so small counts stay visible next to a big hotspot
const HEAT_RAMP = SEQ_SCRAP.slice(1); // shared sequential scrap ramp
const heatIndex = (count, max) => {
  if (!count || count <= 0) return -1;
  return Math.min(HEAT_RAMP.length - 1, Math.floor(Math.sqrt(count / Math.max(max, 1)) * HEAT_RAMP.length));
};
const heatColorFor = (count, max) => {
  const i = heatIndex(count, max);
  return i < 0 ? null : HEAT_RAMP[i];
};
const withAlpha = (hex, a) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}`;
const FONT = { fontFamily: FONT_FAMILY };
const TIP = ECHART_TOOLTIP;
const fmt = (n) => Number(n || 0).toLocaleString();
const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : 0);
const SHIFT_KEYS = ["A", "B", "C", "Unassigned"];
const SHIFT_LABEL = { A: "Shift A", B: "Shift B", C: "Shift C", Unassigned: "Unassigned" };
const CAT_KEYS = ["CR", "CRAM", "MR"];
const NO_SUB = "__zone"; // location key suffix for rejects placed on a zone without a sub-zone
const TOP_TREND = 5;
const TOP_SHIFT = 10;

/* ═══════════════════════════════════════════════════════════════════════════
   PURE HELPERS (no React — every number on the tab comes from these)
   ═══════════════════════════════════════════════════════════════════════════ */
const normalize = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

// Location keys are scoped by view: zone "A" on Top View and zone "A" on Bottom View are different places.
const viewKey = (v) => String(v?.id ?? v?.code ?? v?.name);
const zoneKey = (v, z) => `${viewKey(v)}::${z?.id ?? z?.code ?? z?.name}`;
const subKey = (v, z, s) => `${zoneKey(v, z)}::${s?.id ?? s?.code ?? s?.name}`;
const rowMatchesView = (row, v) => !!v && row._vk === viewKey(v);
const rowMatchesZone = (row, v, z) => !!v && !!z && row._zk === zoneKey(v, z);
const rowMatchesSub = (row, v, z, s) => !!v && !!z && !!s && row._sk === subKey(v, z, s);
const qtyOf = (r) => Number(r.quantity || r.scrap_quantity || 1) || 1;
const sumQty = (list) => list.reduce((s, r) => s + qtyOf(r), 0);
const rowsAtLocation = (list, loc) => (loc.type === "subZone"
  ? list.filter((r) => rowMatchesSub(r, loc.view, loc.zone, loc.subZone))
  : list.filter((r) => rowMatchesZone(r, loc.view, loc.zone)));
const zoneLabel = (z) => String(z?.name || z?.code || "").replace(/^ZONE[-\s]*/i, "Zone ");
const subLabel = (s) => String(s?.code || s?.name || "");
const bump = (obj, k, q) => { obj[k] = (obj[k] || 0) + q; };
const topEntries = (obj, n = 3) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
/** Most specific location of a placed row: its sub-zone, else "<zone>::__zone". */
const locKeyOf = (r) => (r._zk ? r._sk || `${r._zk}::${NO_SUB}` : null);
const pad2 = (n) => String(n).padStart(2, "0");
const dayKeyOfDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** Local calendar day of the reject: NG recorded time, else record creation time. */
const dayKeyOf = (r) => {
  const raw = r.ngRecordedAt || r.ng_recorded_at || r.createdAt || r.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : dayKeyOfDate(d);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (k) => { const [, m, d] = k.split("-"); return `${d} ${MONTHS[Number(m) - 1]}`; };
const dominantCat = (cats) => {
  const top = topEntries(cats, 1)[0];
  return top ? top[0] : null;
};

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

/** Ranked locations — the most specific place recorded (sub-zone, else zone remainder). */
const rankLocations = (scopeViews, zoneCounts, subZoneCounts, totalMapped) => {
  const list = [];
  scopeViews.forEach((v) => {
    (v.zones || []).forEach((zone) => {
      const zc = zoneCounts[zoneKey(v, zone)] || 0;
      if (!zc) return;
      let inSubs = 0;
      (zone.subZones || []).forEach((sz) => {
        const c = subZoneCounts[subKey(v, zone, sz)] || 0;
        inSubs += c;
        if (c > 0) list.push({ key: subKey(v, zone, sz), view: v, zone, sub: sz, count: c, label: `${zoneLabel(zone)} › ${subLabel(sz)}` });
      });
      if (zc - inSubs > 0) {
        list.push({ key: `${zoneKey(v, zone)}::${NO_SUB}`, view: v, zone, sub: null, count: zc - inSubs, label: `${zoneLabel(zone)}${inSubs ? " (no sub-zone)" : ""}` });
      }
    });
  });
  return list
    .map((h) => ({ ...h, fullLabel: `${h.view.name} · ${h.label}`, share: pctOf(h.count, totalMapped) }))
    .sort((a, b) => b.count - a.count);
};

/** Per-location stats: count, category / defect / shift / day splits (quantity-weighted). */
const aggregateLocations = (rows) => {
  const agg = {};
  rows.forEach((r) => {
    const k = locKeyOf(r);
    if (!k) return;
    const q = qtyOf(r);
    const a = agg[k] || (agg[k] = { count: 0, cats: {}, defects: {}, shifts: {}, days: {} });
    a.count += q;
    bump(a.cats, r._parsed?.category || "CR", q);
    bump(a.defects, r._parsed?.reason || "Unspecified", q);
    bump(a.shifts, shiftKey(r.shiftCode || r.shift_code || r.shift), q);
    const dk = dayKeyOf(r);
    if (dk) bump(a.days, dk, q);
  });
  return agg;
};

/** Donut slices: rejects per view (config order) + a "No view" slice for visual rejects with no view. */
const buildViewDonut = (views, viewDefectCounts, totalShown) => {
  const colorOf = makeColorMap(views.map((v) => String(v.id)));
  const slices = views
    .map((v) => ({ id: String(v.id), name: v.name, value: viewDefectCounts[v.id] || 0, color: colorOf(String(v.id)) }))
    .filter((s) => s.value > 0);
  const inViews = slices.reduce((s, x) => s + x.value, 0);
  if (totalShown - inViews > 0) slices.push({ id: null, name: "No view recorded", value: totalShown - inViews, color: OTHER });
  return { slices: slices.map((s) => ({ ...s, pct: pctOf(s.value, totalShown) })), total: totalShown };
};

/** Daily rejects for the top-N locations of the scope, plus all located rejects in the scope. */
const buildTrend = (hotspots, agg, n = TOP_TREND) => {
  const dayTotals = {};
  hotspots.forEach((h) => Object.entries(agg[h.key]?.days || {}).forEach(([d, c]) => bump(dayTotals, d, c)));
  const keys = Object.keys(dayTotals).sort();
  if (!keys.length) return null;
  const days = [];
  const [y0, m0, d0] = keys[0].split("-").map(Number);
  const end = keys[keys.length - 1];
  for (let d = new Date(y0, m0 - 1, d0); dayKeyOfDate(d) <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push(dayKeyOfDate(d));
  }
  const lines = hotspots.slice(0, n).map((h) => ({ key: h.key, name: h.fullLabel, short: h.label, data: days.map((d) => agg[h.key]?.days?.[d] || 0) }));
  return { days, lines, total: days.map((d) => dayTotals[d] || 0) };
};

/** Top-N locations × shift: counts, row totals, row %; column totals over the whole scope. */
const buildShiftMatrix = (hotspots, agg, n = TOP_SHIFT) => {
  const scopeShift = {};
  hotspots.forEach((h) => Object.entries(agg[h.key]?.shifts || {}).forEach(([s, c]) => bump(scopeShift, s, c)));
  const rowsOut = hotspots.slice(0, n).map((h) => {
    const sh = agg[h.key]?.shifts || {};
    const total = SHIFT_KEYS.reduce((s, k) => s + (sh[k] || 0), 0);
    return { key: h.key, name: h.fullLabel, short: h.label, cells: SHIFT_KEYS.map((k) => ({ shift: k, count: sh[k] || 0, rowPct: pctOf(sh[k] || 0, total) })), total };
  });
  const colTotals = SHIFT_KEYS.map((k) => rowsOut.reduce((s, r) => s + r.cells.find((c) => c.shift === k).count, 0));
  const max = Math.max(0, ...rowsOut.flatMap((r) => r.cells.map((c) => c.count)));
  return { rows: rowsOut, colTotals, grand: colTotals.reduce((a, b) => a + b, 0), scopeShift, max };
};

const mergeStats = (list) => {
  const m = { count: 0, cats: {}, defects: {} };
  list.forEach((a) => {
    m.count += a.count;
    Object.entries(a.cats).forEach(([k, v]) => bump(m.cats, k, v));
    Object.entries(a.defects).forEach(([k, v]) => bump(m.defects, k, v));
  });
  return m;
};

/** Treemap: view → zone → sub-zone (or "zone (no sub-zone)"), sized by rejects, leaves coloured by dominant category. */
const buildTreemap = (views, agg) => {
  const node = (name, path, stats, extra = {}) => ({
    name, value: stats.count, path, cats: stats.cats, top: topEntries(stats.defects, 3), dom: dominantCat(stats.cats), ...extra,
  });
  const out = [];
  views.forEach((v, vi) => {
    const zoneNodes = [];
    const viewStats = [];
    (v.zones || []).forEach((z, zi) => {
      const leaves = [];
      const zoneStats = [];
      (z.subZones || []).forEach((s, si) => {
        const a = agg[subKey(v, z, s)];
        if (!a?.count) return;
        zoneStats.push(a);
        leaves.push(node(subLabel(s), `${v.name} · ${zoneLabel(z)} › ${subLabel(s)}`, a, { loc: [vi, zi, si] }));
      });
      const rem = agg[`${zoneKey(v, z)}::${NO_SUB}`];
      if (rem?.count) {
        zoneStats.push(rem);
        leaves.push(node(`${zoneLabel(z)} (no sub-zone)`, `${v.name} · ${zoneLabel(z)} (no sub-zone)`, rem, { loc: [vi, zi, -1] }));
      }
      if (!leaves.length) return;
      leaves.forEach((l) => { l.itemStyle = { color: DEFECT_CATEGORY[l.dom] || OTHER }; });
      const zs = mergeStats(zoneStats);
      viewStats.push(zs);
      zoneNodes.push(node(zoneLabel(z), `${v.name} · ${zoneLabel(z)}`, zs, { children: leaves.sort((a, b) => b.value - a.value) }));
    });
    if (!zoneNodes.length) return;
    out.push(node(v.name, v.name, mergeStats(viewStats), { children: zoneNodes.sort((a, b) => b.value - a.value) }));
  });
  return out.sort((a, b) => b.value - a.value);
};

/** Concentration: top-3 share, locations needed for 80 %, cumulative (Lorenz-style) curve. */
const buildConcentration = (hotspots, scopeViews) => {
  const total = hotspots.reduce((s, h) => s + h.count, 0);
  let cum = 0;
  const points = hotspots.map((h, i) => {
    cum += h.count;
    return { rank: i + 1, label: h.fullLabel, short: h.label, count: h.count, share: pctOf(h.count, total), cum: pctOf(cum, total), even: pctOf(i + 1, hotspots.length) };
  });
  const top3 = hotspots.slice(0, 3).reduce((s, h) => s + h.count, 0);
  const idx80 = points.findIndex((p) => p.cum >= 80 - 1e-9);
  const configured = scopeViews.reduce((s, v) => s + (v.zones || []).reduce((t, z) => t + Math.max(1, (z.subZones || []).length), 0), 0);
  return { total, points, top3, top3Share: pctOf(top3, total), n80: idx80 < 0 ? points.length : idx80 + 1, configured };
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
const Kpi = ({ icon: KpiIcon, label, value, sub, color = ACCENT.process }) => (
  <div className="dlm-kpi" data-accent style={accent(color)}>
    <div className="dlm-kpi-top">
      {KpiIcon && <div className="dlm-kpi-icon-wrap"><KpiIcon size={15} /></div>}
      <span>{label}</span>
    </div>
    <div className="dlm-kpi-val">{value}</div>
    {sub && <div className="dlm-kpi-sub" title={typeof sub === "string" ? sub : undefined}>{sub}</div>}
  </div>
);

const Panel = ({ icon: PanelIcon, iconColor = ACCENT.process, title, sub, right, children, className = "", badge }) => (
  <section className={`dlm-panel ${className}`} style={accent(iconColor)}>
    <header className="dlm-panel-head">
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {PanelIcon && <div className="dlm-panel-icon-wrap"><PanelIcon size={16} /></div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4>{title}</h4>
            {badge && <span className="dlm-panel-badge">{badge}</span>}
          </div>
          {sub && <p>{sub}</p>}
        </div>
      </div>
      {right}
    </header>
    {children}
  </section>
);

const HeatScale = ({ max, label = "rejects per location (colour ∝ √count)" }) => (
  <div className="dlm-scale">
    <span style={{ fontWeight: 600, color: INK.muted }}>0</span>
    <i style={{ background: `linear-gradient(90deg, ${INK.grid}, ${HEAT_RAMP.join(", ")})` }} />
    <span style={{ fontWeight: 700, color: "#b0341f" }}>{fmt(max)}</span>
    <em>{label}</em>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════════ */
export default function HeatMapTab({
  rows = [],
  allRejectionRecords = [],
  rejectedRows = [],
  recordsRows = [],
  rejectionConfig = null,
}) {
  const sourceRows = useMemo(() => {
    if (allRejectionRecords?.length > 0) return allRejectionRecords;
    if (rejectedRows?.length > 0) return rejectedRows;
    if (rows?.length > 0) return rows;
    return Array.isArray(recordsRows) ? recordsRows : [];
  }, [allRejectionRecords, rejectedRows, rows, recordsRows]);

  const [parts, setParts] = useState([]);
  const [partName, setPartName] = useState("OIL PAN K-12");
  const [config, setConfig] = useState(rejectionConfig || null);
  const [viewId, setViewId] = useState("all");
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reasonFilter, setReasonFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  useEffect(() => {
    if (rejectionConfig && !config) setConfig(rejectionConfig);
  }, [rejectionConfig, config]);

  /* Parts list */
  useEffect(() => {
    let active = true;
    rejectionConfigApi.parts()
      .then((result) => {
        if (!active) return;
        const names = (Array.isArray(result) ? result : result?.parts || [])
          .map((i) => (typeof i === "string" ? i : i.part_name || i.partName || i.name))
          .filter(Boolean);
        if (names.length) {
          setParts(names);
          setPartName((cur) => (cur && names.includes(cur) ? cur : names[0] || "OIL PAN K-12"));
        }
      })
      .catch(() => { if (active) setParts([]); });
    return () => { active = false; };
  }, []);

  /* CAD configuration for the selected part */
  useEffect(() => {
    if (!partName) {
      if (rejectionConfig) setConfig(rejectionConfig);
      return undefined;
    }
    let active = true;
    rejectionConfigApi.operatorConfig({ partName })
      .then((result) => {
        if (!active) return;
        setConfig(result?.views?.length ? result : rejectionConfig);
        setSelectedLocation(null);
      })
      .catch(() => { if (active && rejectionConfig) setConfig(rejectionConfig); });
    return () => { active = false; };
  }, [partName, rejectionConfig]);

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setIsFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  /* Scope by part */
  const scopedRows = useMemo(() => {
    if (!sourceRows.length) return [];
    if (!partName) return sourceRows;
    const sel = normalize(partName);
    return sourceRows.filter((row) => {
      const rp = row.partName || row.part_name || "";
      if (!rp || rp === "-") return true;
      const n = normalize(rp);
      if (n.includes("OILPAN") && sel.includes("OILPAN")) return true;
      return n.includes(sel) || sel.includes(n) || parts.length <= 1;
    });
  }, [sourceRows, partName, parts.length]);

  const views = useMemo(() => config?.views || [], [config]);
  const viewsRef = useRef(views);
  useEffect(() => { viewsRef.current = views; }, [views]);

  /* Parse + place every record once */
  const parsedRows = useMemo(() => placeRows(scopedRows, views), [scopedRows, views]);

  // Leak-test rejects come from the pressure-decay sensor and have no visual location.
  const sensorRows = useMemo(() => parsedRows.filter((r) => r._parsed.sensorReject), [parsedRows]);
  const visualRows = useMemo(() => parsedRows.filter((r) => !r._parsed.sensorReject), [parsedRows]);

  const categoryOptions = useMemo(() => [...new Set(visualRows.map((r) => r._parsed.category).filter(Boolean))].sort(), [visualRows]);
  const categoryRows = useMemo(
    () => (categoryFilter === "ALL" ? visualRows : visualRows.filter((r) => r._parsed.category === categoryFilter)),
    [visualRows, categoryFilter]
  );
  const heatRows = useMemo(
    () => (reasonFilter ? categoryRows.filter((r) => r._parsed.reason === reasonFilter) : categoryRows),
    [categoryRows, reasonFilter]
  );
  const reasonOptions = useMemo(() => [...new Set(categoryRows.map((r) => r._parsed.reason).filter(Boolean))].sort(), [categoryRows]);
  const totalShown = useMemo(() => sumQty(heatRows), [heatRows]);

  const currentView = useMemo(() => (viewId === "all" ? null : views.find((v) => String(v.id) === String(viewId)) || null), [views, viewId]);
  const scopeViews = useMemo(() => (currentView ? [currentView] : views), [currentView, views]);

  const { viewDefectCounts, zoneCounts, subZoneCounts, totalMappedDefects, inferredMapped } = useMemo(
    () => countLocations(heatRows, views), [heatRows, views]
  );

  const unlocated = Math.max(0, totalShown - totalMappedDefects);
  const zoneCount = (view, zone) => zoneCounts[zoneKey(view, zone)] || 0;
  const subCount = (view, zone, sub) => subZoneCounts[subKey(view, zone, sub)] || 0;
  const viewMax = (view) => {
    let mz = 1, ms = 1;
    (view?.zones || []).forEach((z) => {
      mz = Math.max(mz, zoneCount(view, z));
      (z.subZones || []).forEach((s) => { ms = Math.max(ms, subCount(view, z, s)); });
    });
    return { zone: mz, sub: ms };
  };

  /* Ranked locations of the current scope */
  const hotspots = useMemo(
    () => rankLocations(scopeViews, zoneCounts, subZoneCounts, totalMappedDefects),
    [scopeViews, zoneCounts, subZoneCounts, totalMappedDefects]
  );
  const locAgg = useMemo(() => aggregateLocations(heatRows), [heatRows]);

  // Stable location colours: slots follow the plant-wide (unfiltered, all-view) location ranking,
  // so a location keeps its colour when filters or the open view change.
  const locationColor = useMemo(() => {
    const all = countLocations(visualRows, views);
    const order = rankLocations(views, all.zoneCounts, all.subZoneCounts, all.totalMappedDefects).map((h) => h.key);
    const base = makeColorMap(order.slice(0, DEFECT_PALETTE.length));
    return (key, used = new Set()) => {
      const c = base(key);
      if (c !== OTHER && !used.has(c)) return c;
      return DEFECT_PALETTE.find((s) => !used.has(s)) || OTHER;
    };
  }, [visualRows, views]);

  const donut = useMemo(() => buildViewDonut(views, viewDefectCounts, totalShown), [views, viewDefectCounts, totalShown]);
  const trend = useMemo(() => buildTrend(hotspots, locAgg), [hotspots, locAgg]);
  const shiftMx = useMemo(() => buildShiftMatrix(hotspots, locAgg), [hotspots, locAgg]);
  const treemapData = useMemo(() => buildTreemap(views, locAgg), [views, locAgg]);
  const conc = useMemo(() => buildConcentration(hotspots, scopeViews), [hotspots, scopeViews]);

  /* Zone breakdown (current view) */
  const zoneSummary = useMemo(() => {
    if (!currentView) return [];
    return (currentView.zones || [])
      .map((zone) => ({
        zone,
        count: zoneCounts[zoneKey(currentView, zone)] || 0,
        subs: (zone.subZones || [])
          .map((sz) => ({ sub: sz, count: subZoneCounts[subKey(currentView, zone, sz)] || 0 }))
          .filter((s) => s.count > 0)
          .sort((a, b) => b.count - a.count),
      }))
      .filter((z) => z.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [currentView, zoneCounts, subZoneCounts]);

  /* Defect × zone matrix (current view; ignores the defect filter so defects stay comparable) */
  const matrix = useMemo(() => {
    if (!currentView) return null;
    const zones = currentView.zones || [];
    const cell = {}, zoneTot = {}, reasonTot = {};
    categoryRows.forEach((r) => {
      if (!r._zk) return;
      const z = zones.find((zz) => rowMatchesZone(r, currentView, zz));
      if (!z) return;
      const zk = String(z.id ?? z.code);
      const rs = r._parsed.reason || "Unspecified";
      const q = qtyOf(r);
      cell[rs] = cell[rs] || {};
      cell[rs][zk] = (cell[rs][zk] || 0) + q;
      zoneTot[zk] = (zoneTot[zk] || 0) + q;
      reasonTot[rs] = (reasonTot[rs] || 0) + q;
    });
    const cols = zones.filter((z) => zoneTot[String(z.id ?? z.code)] > 0).sort((a, b) => zoneTot[String(b.id ?? b.code)] - zoneTot[String(a.id ?? a.code)]);
    const rowsList = Object.keys(reasonTot).sort((a, b) => reasonTot[b] - reasonTot[a]).slice(0, 10);
    if (!cols.length || !rowsList.length) return null;
    let max = 0;
    rowsList.forEach((rs) => cols.forEach((z) => { max = Math.max(max, cell[rs]?.[String(z.id ?? z.code)] || 0); }));
    return { cols, rowsList, cell, reasonTot, zoneTot, max };
  }, [categoryRows, currentView]);

  /* Selected location detail */
  const selection = useMemo(() => {
    if (!selectedLocation) return null;
    const relevant = rowsAtLocation(heatRows, selectedLocation);
    const rm = {};
    relevant.forEach((r) => { const k = r._parsed.reason || "Defect"; rm[k] = (rm[k] || 0) + qtyOf(r); });
    const total = sumQty(relevant);
    return {
      rows: relevant,
      reasons: Object.entries(rm).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      total,
      share: pctOf(total, totalMappedDefects),
    };
  }, [selectedLocation, heatRows, totalMappedDefects]);

  /* Defect Pareto — scoped by selection, then view */
  const pareto = useMemo(() => {
    let target = categoryRows;
    if (selectedLocation) target = rowsAtLocation(categoryRows, selectedLocation);
    else if (currentView) target = categoryRows.filter((r) => rowMatchesView(r, currentView));
    const counts = {};
    target.forEach((r) => { const k = r._parsed?.reason || "Unspecified"; counts[k] = (counts[k] || 0) + qtyOf(r); });
    const sorted = Object.entries(counts).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, i) => s + i.count, 0);
    let cum = 0;
    return {
      total,
      items: sorted.map((it) => { cum += it.count; return { ...it, pct: pctOf(it.count, total), cum: pctOf(cum, total) }; }),
    };
  }, [categoryRows, currentView, selectedLocation]);
  const vitalFew = useMemo(() => { const i = pareto.items.findIndex((d) => d.cum >= 80); return i < 0 ? pareto.items.length : i + 1; }, [pareto]);

  const scopeName = currentView ? currentView.name : "All views";
  const scopeTitle = selectedLocation
    ? `${selectedLocation.view?.name} · ${zoneLabel(selectedLocation.zone)}${selectedLocation.subZone ? ` › ${subLabel(selectedLocation.subZone)}` : ""}`
    : scopeName;

  /* ── 1. Views donut ─────────────────────────────────────────────────────── */
  const donutOption = useMemo(() => {
    if (!donut.slices.length) return null;
    const byName = Object.fromEntries(donut.slices.map((s) => [s.name, s]));
    return {
      textStyle: FONT,
      tooltip: {
        ...TIP, trigger: "item",
        formatter: (p) => {
          const s = byName[p.name];
          return tooltipHtml({
            title: s.name,
            rows: [
              { label: "Visual rejects", value: fmt(s.value), color: s.color },
              { label: "Share of visual rejects", value: `${s.pct.toFixed(1)}%` },
            ],
            note: s.id ? "Click to open this view on the map" : "View not recorded and not inferable from the defect type",
          });
        },
      },
      title: {
        text: fmt(donut.total), subtext: "visual rejects", left: "31%", top: "middle", textAlign: "center", itemGap: 2,
        textStyle: { fontSize: 22, fontWeight: 700, color: INK.primary, fontFamily: FONT_FAMILY },
        subtextStyle: { fontSize: 11, color: INK.muted, fontFamily: FONT_FAMILY },
      },
      legend: {
        ...LEGEND, orient: "vertical", right: 8, top: "middle", itemGap: 10, icon: "circle", itemWidth: 9, itemHeight: 9,
        data: donut.slices.map((s) => s.name),
        formatter: (name) => { const s = byName[name]; return `{n|${name}}{c|${fmt(s.value)}}{p|${s.pct.toFixed(1)}%}`; },
        textStyle: {
          rich: {
            n: { width: 96, fontSize: 11.5, color: INK.secondary, fontFamily: FONT_FAMILY, overflow: "truncate" },
            c: { width: 40, align: "right", fontSize: 11.5, fontWeight: 700, color: INK.primary, fontFamily: FONT_FAMILY },
            p: { width: 46, align: "right", fontSize: 11, color: INK.muted, fontFamily: FONT_FAMILY },
          },
        },
      },
      series: [{
        name: "Views", type: "pie", radius: ["62%", "88%"], center: ["31%", "50%"], padAngle: 1.2, minAngle: 3,
        avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false },
        itemStyle: { borderColor: "#ffffff", borderWidth: 2, borderRadius: 5 },
        emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 12, shadowColor: "rgba(15,23,42,.18)" } },
        data: donut.slices.map((s) => ({
          name: s.name, value: s.value, viewId: s.id,
          itemStyle: { color: s.color, opacity: currentView && s.id !== String(currentView.id) ? 0.35 : 1 },
        })),
      }],
    };
  }, [donut, currentView]);

  /* ── 2. Location trend ──────────────────────────────────────────────────── */
  const trendOption = useMemo(() => {
    if (!trend) return null;
    const used = new Set();
    const colored = trend.lines.map((l) => { const c = locationColor(l.key, used); used.add(c); return { ...l, color: c }; });
    const label = (l) => (currentView ? l.short : l.name);
    const totalName = `All located · ${scopeName}`;
    return {
      textStyle: FONT,
      tooltip: {
        ...TIP, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: INK.axis } },
        formatter: (ps) => {
          const i = ps[0].dataIndex;
          const tot = trend.total[i];
          return tooltipHtml({
            title: dayLabel(trend.days[i]),
            subtitle: `${fmt(tot)} located rejects · ${scopeName}`,
            rows: [...colored]
              .sort((a, b) => b.data[i] - a.data[i])
              .map((l) => ({ label: label(l), value: `${fmt(l.data[i])}${tot ? ` · ${pctOf(l.data[i], tot).toFixed(0)}%` : ""}`, color: l.color })),
            note: "Day = NG recorded time (else record creation time), local calendar day.",
          });
        },
      },
      legend: { ...LEGEND, top: undefined, right: undefined, bottom: 0, left: 0, data: [...colored.map(label), totalName] },
      grid: { left: 30, right: 16, top: 16, bottom: currentView ? 34 : 58, containLabel: true },
      xAxis: categoryAxis(trend.days.map(dayLabel), { boundaryGap: false, axisLabel: axisLabel({ hideOverlap: true }) }),
      yAxis: valueAxis({ minInterval: 1, ...axisName("Rejects per day", 34) }),
      series: [
        ...colored.map((l) => ({
          name: label(l), type: "line", data: l.data, smooth: 0.2, symbol: "circle", symbolSize: 5, showSymbol: trend.days.length <= 31,
          lineStyle: { width: 2.2, color: l.color }, itemStyle: { color: l.color, borderColor: "#fff", borderWidth: 1 },
          emphasis: { focus: "series" },
        })),
        {
          name: totalName, type: "line", data: trend.total, smooth: 0.2, symbol: "none", z: 1,
          lineStyle: { width: 1.6, type: "dashed", color: OUTCOME.total }, itemStyle: { color: OUTCOME.total },
          areaStyle: { color: withAlpha(OUTCOME.total, 0.06) }, emphasis: { focus: "series" },
        },
      ],
    };
  }, [trend, locationColor, currentView, scopeName]);

  /* ── 3. Location × shift matrix ─────────────────────────────────────────── */
  const shiftOption = useMemo(() => {
    if (!shiftMx.rows.length) return null;
    const xCats = [...SHIFT_KEYS.map((k) => SHIFT_LABEL[k]), "Total"];
    const yCats = shiftMx.rows.map((r) => (currentView ? r.short : r.name));
    const data = [];
    shiftMx.rows.forEach((r, y) => {
      r.cells.forEach((c, x) => {
        const col = seqColor(c.count, shiftMx.max);
        const tone = col ? SEQ_SCRAP.indexOf(col) : -1; // ramp step, coloured through the visualMap below
        const dark = tone >= 4;
        data.push({
          value: [x, y, c.count, tone], meta: { row: r, cell: c },
          itemStyle: { borderColor: "#fff", borderWidth: 3, borderRadius: 6 },
          label: { color: dark ? "#ffffff" : c.count ? INK.primary : INK.faint },
        });
      });
      data.push({
        value: [SHIFT_KEYS.length, y, r.total, -2], meta: { row: r, total: true },
        itemStyle: { borderColor: "#fff", borderWidth: 3, borderRadius: 6 },
        label: { color: INK.primary },
      });
    });
    return {
      textStyle: FONT,
      tooltip: {
        ...TIP, trigger: "item",
        formatter: (p) => {
          const { row, cell, total } = p.data.meta;
          if (total) {
            return tooltipHtml({
              title: row.name, subtitle: "All shifts",
              rows: row.cells.map((c) => ({ label: SHIFT_LABEL[c.shift], value: `${fmt(c.count)} · ${c.rowPct.toFixed(1)}%`, color: SHIFT[c.shift] })),
            });
          }
          const shiftTot = shiftMx.scopeShift[cell.shift] || 0;
          return tooltipHtml({
            title: row.name, subtitle: SHIFT_LABEL[cell.shift],
            rows: [
              { label: "Rejects", value: fmt(cell.count), color: SHIFT[cell.shift] },
              { label: "Share of this location (row %)", value: `${cell.rowPct.toFixed(1)}%` },
              { label: `Share of ${SHIFT_LABEL[cell.shift]} located rejects`, value: `${pctOf(cell.count, shiftTot).toFixed(1)}%` },
            ],
            note: `${SHIFT_LABEL[cell.shift]} has ${fmt(shiftTot)} located rejects in ${scopeName}.`,
          });
        },
      },
      // Hidden piecewise visualMap (ECharts requires one for heatmaps): dimension 3 = SEQ_SCRAP step
      // (sqrt-scaled exactly like seqColor), -1 = zero cell, -2 = Total column.
      visualMap: {
        show: false, type: "piecewise", dimension: 3, seriesIndex: 0,
        pieces: [{ value: -2, color: INK.border }, { value: -1, color: INK.surfaceAlt }, ...SEQ_SCRAP.map((c, i) => ({ value: i, color: c }))],
      },
      grid: { left: 8, right: 10, top: 30, bottom: 8, containLabel: true },
      xAxis: {
        type: "category", data: xCats, position: "top", axisTick: { show: false }, axisLine: { show: false }, splitArea: { show: false },
        axisLabel: axisLabel({ fontWeight: 700, color: INK.secondary, fontSize: 11 }),
      },
      yAxis: {
        type: "category", data: yCats, inverse: true, axisTick: { show: false }, axisLine: { show: false },
        axisLabel: axisLabel({ color: INK.secondary, fontSize: 11, width: 190, overflow: "truncate" }),
      },
      series: [{
        type: "heatmap", data,
        label: {
          show: true, fontSize: 11, fontFamily: FONT_FAMILY, lineHeight: 13,
          formatter: (p) => {
            const m = p.data.meta;
            if (m.total) return `{b|${fmt(m.row.total)}}`;
            return m.cell.count ? `{b|${fmt(m.cell.count)}}\n{s|${m.cell.rowPct.toFixed(0)}%}` : "·";
          },
          rich: { b: { fontWeight: 700, fontSize: 11.5 }, s: { fontSize: 9.5, opacity: 0.8 } },
        },
        emphasis: { itemStyle: { borderColor: INK.primary, borderWidth: 2 } },
      }],
    };
  }, [shiftMx, currentView, scopeName]);

  /* ── 4. Defect × location treemap ───────────────────────────────────────── */
  const treemapOption = useMemo(() => {
    if (!treemapData.length) return null;
    return {
      textStyle: FONT,
      tooltip: {
        ...TIP, trigger: "item",
        formatter: (p) => {
          const d = p.data;
          if (!d || !d.path) return `${fmt(totalMappedDefects)} located rejects`;
          const catTot = Object.values(d.cats || {}).reduce((a, b) => a + b, 0);
          return tooltipHtml({
            title: d.path,
            subtitle: `${fmt(d.value)} rejects · ${pctOf(d.value, totalMappedDefects).toFixed(1)}% of located`,
            rows: [
              ...CAT_KEYS.filter((k) => d.cats?.[k]).map((k) => ({ label: k, value: `${fmt(d.cats[k])} · ${pctOf(d.cats[k], catTot).toFixed(0)}%`, color: DEFECT_CATEGORY[k] })),
              ...d.top.map(([reason, c], i) => ({ label: `${i === 0 ? "Top defects: " : ""}${reason}`, value: fmt(c), strong: false })),
            ],
            note: d.loc ? `Dominant category: ${DEFECT_CATEGORY_LABEL[d.dom] || d.dom}. Click to open on the map.` : "Click to zoom in.",
          });
        },
      },
      series: [{
        name: "All views", type: "treemap", data: treemapData, roam: false, nodeClick: "zoomToNode", leafDepth: null,
        top: 6, left: 2, right: 2, bottom: 34, sort: "desc", visibleMin: 16, squareRatio: 0.5 * (1 + Math.sqrt(5)),
        breadcrumb: {
          show: true, bottom: 4, left: "center", height: 22,
          itemStyle: { color: INK.surfaceAlt, borderColor: INK.border, borderWidth: 1, textStyle: { color: INK.secondary, fontSize: 11, fontFamily: FONT_FAMILY } },
          emphasis: { itemStyle: { color: "#e0ecfb", textStyle: { color: ACCENT.process } } },
        },
        label: {
          show: true, position: "insideTopLeft", fontFamily: FONT_FAMILY, color: "#ffffff", overflow: "truncate",
          formatter: (p) => `{n|${p.name}}\n{c|${fmt(p.value)}}`,
          rich: { n: { fontSize: 11, fontWeight: 600, color: "#ffffff" }, c: { fontSize: 13, fontWeight: 700, color: "#ffffff", padding: [3, 0, 0, 0] } },
        },
        upperLabel: { show: true, height: 22, color: "#ffffff", fontWeight: 700, fontSize: 11.5, fontFamily: FONT_FAMILY, overflow: "truncate", formatter: (p) => `${p.name}  ·  ${fmt(p.value)}` },
        levels: [
          { itemStyle: { borderWidth: 0, gapWidth: 4 }, upperLabel: { show: false } },
          { itemStyle: { color: INK.secondary, borderColor: INK.secondary, borderWidth: 3, gapWidth: 3 } },
          { itemStyle: { color: INK.muted, borderColor: INK.muted, borderWidth: 2, gapWidth: 2 }, upperLabel: { height: 18, fontSize: 10.5, color: "#ffffff" } },
          { itemStyle: { borderColor: "#ffffff", borderWidth: 1, gapWidth: 0, borderRadius: 3 } },
        ],
      }],
    };
  }, [treemapData, totalMappedDefects]);

  /* ── 5. Concentration curve ─────────────────────────────────────────────── */
  const concOption = useMemo(() => {
    if (!conc.points.length) return null;
    const pts = conc.points;
    const cutIdx = conc.n80 - 1;
    return {
      textStyle: FONT,
      tooltip: {
        ...TIP, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,23,42,.04)" } },
        formatter: (ps) => {
          const d = pts[ps[0].dataIndex];
          return tooltipHtml({
            title: `#${d.rank} · ${currentView ? d.short : d.label}`,
            rows: [
              { label: "Rejects", value: fmt(d.count), color: d.rank <= conc.n80 ? ACCENT.location : INK.faint },
              { label: "Share of located", value: `${d.share.toFixed(1)}%` },
              { label: "Cumulative share", value: `${d.cum.toFixed(1)}%`, color: ACCENT.process },
              { label: "Even-spread reference", value: `${d.even.toFixed(1)}%`, color: INK.faint },
            ],
            note: d.rank <= conc.n80 ? "Inside the locations that make up 80% of located rejects." : undefined,
          });
        },
      },
      legend: { ...LEGEND, data: ["Share of located", "Cumulative share", "Even spread"] },
      grid: { left: 30, right: 16, top: 34, bottom: 28, containLabel: true },
      xAxis: categoryAxis(pts.map((p) => String(p.rank)), {
        ...axisName("Locations ranked by rejects", 26), axisLabel: axisLabel({ hideOverlap: true }),
      }),
      yAxis: valueAxis({ min: 0, max: 100, interval: 20, axisLabel: axisLabel({ formatter: "{value}%" }), ...axisName("Share of located rejects", 40) }),
      series: [
        {
          name: "Share of located", type: "bar", barMaxWidth: 22,
          data: pts.map((p) => ({ value: Number(p.share.toFixed(2)), itemStyle: { color: p.rank <= conc.n80 ? ACCENT.location : INK.axis, borderRadius: [4, 4, 0, 0] } })),
        },
        {
          name: "Cumulative share", type: "line", data: pts.map((p) => Number(p.cum.toFixed(2))), smooth: 0.15, symbol: "circle", symbolSize: 6,
          lineStyle: { width: 2.6, color: ACCENT.process }, itemStyle: { color: ACCENT.process, borderColor: "#fff", borderWidth: 1.5 },
          areaStyle: { color: withAlpha(ACCENT.process, 0.08) },
          markLine: {
            silent: true, symbol: "none",
            data: [
              { yAxis: 80, lineStyle: { color: OUTCOME.ng, type: "dashed", width: 1.5 }, label: { formatter: "80%", position: "insideStartTop", color: OUTCOME.ng, fontWeight: 700, fontSize: 10.5 } },
              { xAxis: cutIdx, lineStyle: { color: ACCENT.location, type: "dotted", width: 1.5 }, label: { formatter: `${conc.n80} location${conc.n80 === 1 ? "" : "s"}`, position: "end", color: ACCENT.location, fontWeight: 700, fontSize: 10.5 } },
            ],
          },
        },
        {
          name: "Even spread", type: "line", data: pts.map((p) => Number(p.even.toFixed(2))), symbol: "none",
          lineStyle: { width: 1.4, type: "dashed", color: INK.faint }, itemStyle: { color: INK.faint },
        },
      ],
    };
  }, [conc, currentView]);

  // Single % axis: bar = share of rejects, line = cumulative share (no dual scale)
  const paretoOption = useMemo(() => {
    const items = pareto.items.slice(0, 12);
    if (!items.length) return null;
    return {
      textStyle: FONT,
      tooltip: {
        ...TIP, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(15,23,42,.04)" } },
        formatter: (p) => {
          const d = items[p[0].dataIndex];
          const isVital = d.cum - d.pct < 80;
          return tooltipHtml({
            title: d.reason,
            rows: [
              { label: "Rejects", value: fmt(d.count), color: isVital ? OUTCOME.ng : INK.faint },
              { label: "Share of rejects", value: `${d.pct.toFixed(1)}%` },
              { label: "Cumulative share", value: `${d.cum.toFixed(1)}%`, color: ACCENT.process },
            ],
            note: isVital ? "Vital few: part of the defects that make up the first 80%." : undefined,
          });
        },
      },
      legend: { ...LEGEND, data: ["Share of rejects", "Cumulative"] },
      grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
      xAxis: categoryAxis(items.map((d) => d.reason), { axisLabel: axisLabel({ interval: 0, rotate: 32, width: 110, overflow: "truncate" }) }),
      yAxis: valueAxis({ min: 0, max: 100, interval: 20, axisLabel: axisLabel({ formatter: "{value}%" }), splitLine: { lineStyle: { color: INK.grid, type: "dashed" } } }),
      series: [
        {
          name: "Share of rejects", type: "bar", barMaxWidth: 32,
          data: items.map((d) => {
            const isVital = d.cum - d.pct < 80;
            return {
              value: Number(d.pct.toFixed(1)),
              itemStyle: {
                color: isVital ? OUTCOME.ng : INK.faint,
                borderRadius: [6, 6, 0, 0],
                opacity: reasonFilter && d.reason !== reasonFilter ? 0.3 : 1,
              },
            };
          }),
          label: {
            show: true, position: "top", fontSize: 10, fontWeight: 700, color: INK.primary,
            formatter: (p) => `${fmt(items[p.dataIndex].count)}`,
          },
        },
        {
          name: "Cumulative", type: "line", smooth: 0.25, data: items.map((d) => Number(d.cum.toFixed(1))), symbolSize: 7,
          lineStyle: { width: 2.6, color: ACCENT.process },
          itemStyle: { color: ACCENT.process, borderWidth: 2, borderColor: "#ffffff" },
          areaStyle: { color: withAlpha(ACCENT.process, 0.08) },
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: OUTCOME.ng, type: "dashed", width: 1.5 },
            label: { formatter: "80%", position: "insideStartTop", fontSize: 10.5, fontWeight: 700, color: OUTCOME.ng },
            data: [{ yAxis: 80 }],
          },
        },
      ],
    };
  }, [pareto, reasonFilter]);

  const paretoEvents = useMemo(() => ({
    click: (p) => { if (p.seriesType === "bar" && p.name) setReasonFilter((cur) => (cur === p.name ? "" : p.name)); },
  }), []);

  const pickView = (id) => { setViewId(String(id)); setSelectedLocation(null); };
  const donutEvents = useMemo(() => ({
    click: (p) => { if (p.data?.viewId) { setViewId(String(p.data.viewId)); setSelectedLocation(null); } },
  }), []);
  const treemapEvents = useMemo(() => ({
    click: (p) => {
      const loc = p.data?.loc;
      if (!loc) return;
      const v = viewsRef.current[loc[0]];
      const z = v?.zones?.[loc[1]];
      if (!z) return;
      const s = loc[2] >= 0 ? z.subZones?.[loc[2]] : null;
      setViewId(String(v.id));
      setSelectedLocation(s ? { type: "subZone", view: v, zone: z, subZone: s } : { type: "zone", view: v, zone: z });
    },
  }), []);

  const clearAll = () => { setSelectedLocation(null); setReasonFilter(""); setCategoryFilter("ALL"); };
  const filtersActive = !!reasonFilter || categoryFilter !== "ALL";
  const focusHotspot = (h) => {
    setViewId(String(h.view.id));
    setSelectedLocation(h.sub ? { type: "subZone", view: h.view, zone: h.zone, subZone: h.sub } : { type: "zone", view: h.view, zone: h.zone });
  };
  const topLocation = hotspots[0];
  const exportRows = selection ? selection.rows : heatRows;
  const trendKeys = new Set((trend?.lines || []).map((l) => l.key));

  /* ── Overlay renderer for one view ─────────────────────────────────────── */
  const renderOverlays = (view, interactive) => {
    const mx = viewMax(view);
    return (view.zones || []).map((zone) => {
      const zc = zoneCount(view, zone);
      const zCol = heatColorFor(zc, mx.zone);
      const zSel = selectedLocation?.type === "zone" && selectedLocation.zone === zone;
      return (
        <React.Fragment key={zone.id || zone.code}>
          <div
            className={`cad-zone ${interactive ? "dlm-hit" : ""}`}
            onClick={interactive ? () => setSelectedLocation({ type: "zone", view, zone }) : undefined}
            title={`${view.name} · ${zoneLabel(zone)}: ${fmt(zc)} rejects${totalMappedDefects ? ` (${pctOf(zc, totalMappedDefects).toFixed(1)}% of located)` : ""}`}
            style={{
              ...boxStyle(zone),
              ...(zCol ? { border: `1.5px solid ${zCol}`, background: withAlpha(zCol, 0.08 + Math.sqrt(zc / mx.zone) * 0.22) } : {}),
              ...(zSel ? { border: "2px solid #2563eb", boxShadow: "0 0 0 3px rgba(37,99,235,.2)" } : {}),
            }}
          >
            <span className="cad-tag">{zoneLabel(zone)}{zc > 0 && <span className="cad-count" style={{ background: zCol }}>{fmt(zc)}</span>}</span>
          </div>
          {(zone.subZones || []).map((sz) => {
            const sc = subCount(view, zone, sz);
            const sCol = heatColorFor(sc, mx.sub);
            const sSel = selectedLocation?.type === "subZone" && selectedLocation.subZone === sz;
            return (
              <div
                key={`s-${sz.id || sz.code}`}
                className={`cad-sub ${interactive ? "dlm-hit" : ""}`}
                onClick={interactive ? (e) => { e.stopPropagation(); setSelectedLocation({ type: "subZone", view, zone, subZone: sz }); } : undefined}
                title={`${view.name} · ${zoneLabel(zone)} › ${subLabel(sz)}: ${fmt(sc)} rejects`}
                style={{
                  ...boxStyle(sz, 5, 5),
                  ...(sCol ? { border: `1.5px solid ${sCol}`, background: withAlpha(sCol, 0.3 + Math.sqrt(sc / mx.sub) * 0.45) } : {}),
                  ...(sSel ? { border: "2px solid #2563eb", boxShadow: "0 0 0 3px rgba(37,99,235,.25)" } : {}),
                }}
              >
                {(sc > 0 || interactive) && <span className="cad-tag">{subLabel(sz)}{sc > 0 && <span className="cad-count" style={{ background: sCol }}>{fmt(sc)}</span>}</span>}
              </div>
            );
          })}
        </React.Fragment>
      );
    });
  };

  /* ═════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════ */
  return (
    <div className="dlm">
      <style>{`
        .dlm{display:flex;flex-direction:column;gap:16px;font-family:${FONT_FAMILY};color:${INK.primary}}
        .dlm *{box-sizing:border-box}
        .dlm-card{background:#fff;border:1px solid ${INK.border};border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(15,23,42,.04),0 6px 18px -10px rgba(15,23,42,.12)}
        .dlm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
        .dlm-head h3{margin:0;font-size:17px;font-weight:700;letter-spacing:-.01em}
        .dlm-head p{margin:4px 0 0;font-size:12.5px;color:${INK.muted}}
        .dlm-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .dlm-select{height:34px;padding:0 10px;border:1px solid ${INK.axis};border-radius:8px;background:#fff;font-size:12.5px;color:#1e293b;min-width:150px}
        .dlm-btn{height:34px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border:1px solid ${INK.axis};border-radius:8px;background:#fff;font-size:12.5px;font-weight:600;color:${INK.secondary};cursor:pointer;transition:all .15s ease}
        .dlm-btn:hover{background:${INK.surfaceAlt};border-color:${INK.faint}}.dlm-btn:disabled{opacity:.5;cursor:default}
        .dlm-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
        .dlm-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;font-size:11.5px;font-weight:600;color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,#fff);border:1px solid color-mix(in srgb,var(--accent) 30%,#fff)}
        .dlm-chip button{border:0;background:none;color:inherit;cursor:pointer;display:grid;place-items:center;padding:0}
        .dlm-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
        @media(max-width:1300px){.dlm-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
        @media(max-width:700px){.dlm-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
        .dlm-kpi{position:relative;overflow:hidden;border-radius:14px;padding:13px 15px;min-width:0;border:1px solid ${INK.border};border-left:3px solid var(--accent);background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 8%,#fff) 0%,#fff 70%);box-shadow:0 1px 2px rgba(15,23,42,.04);transition:transform .2s ease,box-shadow .2s ease}
        .dlm-kpi:hover{transform:translateY(-2px);box-shadow:0 8px 20px -6px rgba(15,23,42,.12)}
        .dlm-kpi-top{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;color:${INK.muted};text-transform:uppercase;letter-spacing:.06em}
        .dlm-kpi-icon-wrap{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;flex-shrink:0;color:var(--accent);background:color-mix(in srgb,var(--accent) 13%,#fff)}
        .dlm-kpi-val{font-size:22px;font-weight:700;margin-top:6px;color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .dlm-kpi-sub{font-size:11.5px;color:${INK.muted};margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .dlm-note{display:flex;gap:10px;align-items:flex-start;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px 14px;font-size:12px;line-height:1.5;color:#92400e}
        .dlm-tabs{display:flex;gap:4px;flex-wrap:wrap;padding:4px;background:${INK.grid};border-radius:12px}
        .dlm-tab{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border-radius:9px;border:0;background:transparent;font-size:12.5px;font-weight:600;color:${INK.body};cursor:pointer;transition:all .15s ease}
        .dlm-tab:hover{color:${INK.primary}}
        .dlm-tab.active{background:#fff;color:${INK.primary};box-shadow:0 1px 3px rgba(15,23,42,.12)}
        .dlm-tab .n{min-width:22px;padding:0 7px;border-radius:999px;background:${INK.border};color:${INK.secondary};font-size:11px;font-variant-numeric:tabular-nums;font-weight:700}
        .dlm-tab .n.hot{background:#fee2e2;color:#b91c1c}
        .dlm-main{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(300px,1fr);gap:16px;align-items:start}
        .dlm-row2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:stretch}
        .dlm-row2w{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px;align-items:stretch}
        @media(max-width:1100px){.dlm-main,.dlm-row2,.dlm-row2w{grid-template-columns:1fr}}
        .dlm-panel{position:relative;overflow:hidden;background:#fff;border:1px solid ${INK.border};border-radius:14px;padding:16px 18px;min-width:0;box-shadow:0 1px 2px rgba(15,23,42,.04),0 6px 18px -10px rgba(15,23,42,.12)}
        .dlm-panel::before{content:"";position:absolute;left:0;top:0;right:0;height:3px;background:var(--accent,${ACCENT.process})}
        .dlm-panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin:-16px -18px 12px;padding:16px 18px 12px;border-bottom:1px solid ${INK.grid};background:linear-gradient(180deg,color-mix(in srgb,var(--accent,${ACCENT.process}) 6%,#fff),#fff)}
        .dlm-panel-head h4{margin:0;font-size:14.5px;font-weight:700;color:${INK.primary};letter-spacing:-.01em}
        .dlm-panel-head p{margin:3px 0 0;font-size:12px;color:${INK.muted}}
        .dlm-panel-icon-wrap{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;flex-shrink:0;color:var(--accent);background:color-mix(in srgb,var(--accent) 13%,#fff)}
        .dlm-panel-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,#fff);border:1px solid color-mix(in srgb,var(--accent) 30%,#fff)}
        .dlm-panel-foot{margin:10px -18px -16px;padding:8px 18px 12px;font-size:11.5px;line-height:1.5;color:${INK.muted};border-top:1px solid ${INK.grid}}
        .dlm-legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:${INK.body}}
        .dlm-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}
        .dlm-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:8px}
        .dlm-stat{border:1px solid ${INK.border};border-radius:10px;padding:8px 10px;background:${INK.surfaceAlt};min-width:0}
        .dlm-stat b{display:block;font-size:17px;font-weight:700;font-variant-numeric:tabular-nums;color:${INK.primary}}
        .dlm-stat span{font-size:10.5px;color:${INK.muted};font-weight:600;text-transform:uppercase;letter-spacing:.05em}
        .dlm-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
        .dlm-gcard{border:1px solid ${INK.border};border-radius:12px;padding:10px;cursor:pointer;transition:border-color .15s,box-shadow .15s;background:#fff}
        .dlm-gcard:hover{border-color:#93c5fd;box-shadow:0 4px 14px -6px rgba(37,99,235,.35)}
        .dlm-gcard-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12.5px;font-weight:600}
        .dlm-gcard-head span{font-size:11.5px;color:${INK.muted};font-weight:500;font-variant-numeric:tabular-nums}
        .dlm-gcard-head span.hot{color:#b91c1c;font-weight:700;background:#fee2e2;padding:1px 7px;border-radius:999px}
        .dlm-hit{cursor:pointer}
        .dlm-hit.cad-zone:hover{border-color:#2563eb!important;border-style:solid!important}
        .dlm-hit.cad-sub:hover{border-color:#2563eb!important;z-index:3}
        .dlm-stage-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:${INK.body}}
        .dlm-scale{display:flex;align-items:center;gap:8px;font-size:11px;color:${INK.muted};flex-wrap:wrap}
        .dlm-scale i{display:block;width:140px;height:8px;border-radius:4px;border:1px solid ${INK.border}}
        .dlm-scale em{font-style:normal;color:${INK.faint}}
        .dlm-fs{position:fixed;inset:0;z-index:1200;background:rgba(15,23,42,.85);display:flex;align-items:center;justify-content:center;padding:24px}
        .dlm-fs-inner{width:min(100%, calc((100vh - 48px) * 900 / 520));background:#fff;border-radius:12px;padding:10px;position:relative}
        .dlm-fs-close{position:absolute;top:-14px;right:-14px;width:32px;height:32px;border-radius:50%;border:0;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer;display:grid;place-items:center}
        .dlm-loc{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;cursor:pointer;border:1px solid transparent;transition:all .15s ease}
        .dlm-loc:hover{background:${INK.surfaceAlt};border-color:${INK.border};transform:translateX(2px)}
        .dlm-loc.sel{background:#eff6ff;border-color:#bfdbfe}
        .dlm-loc .rk{width:24px;height:24px;border-radius:7px;background:${INK.grid};color:${INK.secondary};font-size:11px;font-weight:700;display:grid;place-items:center}
        .dlm-loc:nth-child(-n+3) .rk{background:color-mix(in srgb,${ACCENT.location} 14%,#fff);color:${ACCENT.location};border:1px solid color-mix(in srgb,${ACCENT.location} 35%,#fff);font-weight:800}
        .dlm-loc .nm{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px}
        .dlm-loc .nm i{width:8px;height:8px;border-radius:50%;flex-shrink:0}
        .dlm-loc .vw{font-size:11px;color:${INK.faint}}
        .dlm-loc .bar{height:5px;border-radius:3px;background:${INK.grid};margin-top:5px;overflow:hidden}
        .dlm-loc .bar>i{display:block;height:100%;border-radius:3px}
        .dlm-loc .ct{text-align:right;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums}
        .dlm-loc .ct small{display:inline-block;font-size:10.5px;font-weight:600;color:${INK.body};background:${INK.grid};padding:1px 6px;border-radius:999px;margin-top:2px}
        .dlm-list{max-height:420px;overflow-y:auto;margin:0 -6px;padding:0 6px}
        .dlm-empty{display:flex;align-items:center;justify-content:center;min-height:140px;font-size:12.5px;color:${INK.faint};text-align:center;padding:16px}
        .dlm-sel{border-top:1px solid ${INK.grid};margin-top:12px;padding-top:12px}
        .dlm-sel h5{margin:0 0 8px;font-size:12.5px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:8px}
        .dlm-reason{display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px dashed ${INK.grid}}
        .dlm-reason b{font-weight:600;font-variant-numeric:tabular-nums;color:${INK.primary}}
        .dlm-table{width:100%;border-collapse:collapse;font-size:12px}
        .dlm-table th{text-align:left;font-size:10.5px;font-weight:600;color:${INK.muted};text-transform:uppercase;letter-spacing:.05em;padding:8px 10px;border-bottom:1px solid ${INK.border};background:${INK.surfaceAlt};position:sticky;top:0}
        .dlm-table td{padding:8px 10px;border-bottom:1px solid ${INK.grid};vertical-align:middle}
        .dlm-table tr.click{cursor:pointer;transition:background .15s}.dlm-table tr.click:hover td{background:${INK.surfaceAlt}}
        .dlm-table .num{text-align:right;font-variant-numeric:tabular-nums}
        .dlm-pill{display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:2px 8px;border-radius:999px;background:${INK.grid};font-size:11px;color:${INK.secondary};cursor:pointer;border:1px solid transparent;transition:all .15s}
        .dlm-pill:hover{border-color:#bfdbfe;background:#eff6ff;color:#1d4ed8}
        .dlm-pill b{font-weight:700;font-variant-numeric:tabular-nums}
        .dlm-track{height:6px;border-radius:3px;background:${INK.grid};overflow:hidden;min-width:80px}
        .dlm-track i{display:block;height:100%;border-radius:3px;background:${OUTCOME.ng}}
        .dlm-mx{border-collapse:separate;border-spacing:4px;font-size:11.5px;width:100%}
        .dlm-mx th{font-size:10.5px;font-weight:700;color:${INK.body};padding:6px 8px;text-align:center;white-space:nowrap;background:${INK.surfaceAlt};border-radius:6px}
        .dlm-mx th.rl,.dlm-mx td.rl{text-align:left;background:transparent}
        .dlm-mx td{padding:8px 6px;text-align:center;border-radius:6px;font-weight:600;font-variant-numeric:tabular-nums;transition:all .15s ease}
        .dlm-mx td:hover{transform:scale(1.08);box-shadow:0 4px 10px rgba(0,0,0,0.12);z-index:2}
        .dlm-mx td.rl{background:transparent;font-weight:600;color:#1e293b;white-space:nowrap;cursor:pointer}
        .dlm-mx td.rl:hover{color:#2563eb}
        .dlm-mx td.tot{background:${INK.grid};color:${INK.primary};font-weight:700;border-radius:6px}
      `}</style>

      {/* ── HEADER + FILTERS ─────────────────────────────────────────────── */}
      <div className="dlm-card">
        <div className="dlm-head">
          <div>
            <h3>Defect Location Map</h3>
            <p>Where visual rejects occur on the casting — by inspection view, zone and sub-zone.</p>
          </div>
          <div className="dlm-controls">
            <select className="dlm-select" value={partName} onChange={(e) => setPartName(e.target.value)} aria-label="Part">
              <option value="">All parts</option>
              {parts.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="dlm-select" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setReasonFilter(""); }} aria-label="Category">
              <option value="ALL">All categories</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="dlm-select" value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} aria-label="Defect">
              <option value="">All defects</option>
              {reasonOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="dlm-btn" disabled={!exportRows.length}
              onClick={() => exportCsv(exportRows, `defect_locations_${normalize(partName) || "all"}_${new Date().toISOString().slice(0, 10)}.csv`)}
              title={selection ? "Export records at the selected location" : "Export records matching the filters"}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>
        {(filtersActive || selectedLocation) && (
          <div className="dlm-chips">
            {categoryFilter !== "ALL" && <span className="dlm-chip" style={accent(DEFECT_CATEGORY[categoryFilter] || ACCENT.process)}>Category: {categoryFilter}<button onClick={() => { setCategoryFilter("ALL"); setReasonFilter(""); }} aria-label="Clear category"><X size={12} /></button></span>}
            {reasonFilter && <span className="dlm-chip" style={accent(OUTCOME.ng)}>Defect: {reasonFilter}<button onClick={() => setReasonFilter("")} aria-label="Clear defect"><X size={12} /></button></span>}
            {selectedLocation && <span className="dlm-chip" style={accent(ACCENT.location)}>Location: {scopeTitle}<button onClick={() => setSelectedLocation(null)} aria-label="Clear location"><X size={12} /></button></span>}
            <button className="dlm-btn" style={{ height: 26, fontSize: 11.5 }} onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="dlm-kpis">
        <Kpi icon={Activity} label="Visual rejects" value={fmt(totalShown)} sub={filtersActive ? `of ${fmt(sumQty(visualRows))} with current filters` : "Recorded at visual inspection"} color={OUTCOME.ng} />
        <Kpi icon={Crosshair} label="Located on CAD" value={`${pctOf(totalMappedDefects, totalShown).toFixed(1)}%`} sub={`${fmt(totalMappedDefects)} rejects placed on a zone`} color={ACCENT.process} />
        <Kpi icon={MapPin} label="Top location" value={topLocation ? `${topLocation.share.toFixed(1)}%` : "—"} sub={topLocation ? topLocation.fullLabel : "No located rejects"} color={ACCENT.location} />
        <Kpi icon={Sigma} label="Top-3 concentration" value={conc.total ? `${conc.top3Share.toFixed(1)}%` : "—"}
          sub={conc.total ? `${fmt(conc.top3)} of ${fmt(conc.total)} · ${conc.n80} of ${conc.points.length} locations = 80%` : "No located rejects"} color={ACCENT.warning} />
        <Kpi icon={Target} label="Defects causing 80%" value={pareto.items.length ? vitalFew : "—"} sub={pareto.items.length ? `of ${pareto.items.length} defect types · ${scopeTitle}` : "No defects"} color={ACCENT.model} />
        <Kpi icon={Gauge} label="Leak-test rejects" value={fmt(sumQty(sensorRows))} sub="Pressure sensor — not plotted" color={ACCENT.quality} />
      </div>

      {unlocated > 0 && (
        <div className="dlm-note">
          <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
          <div>
            {fmt(unlocated)} of {fmt(totalShown)} visual rejects have no zone that matches the CAD setup, so they are not drawn on the map
            (they still count in the defect Pareto). Location shares are out of the {fmt(totalMappedDefects)} located rejects
            {inferredMapped > 0 && <>; {fmt(inferredMapped)} of those were placed by defect type because no zone was entered at inspection</>}.
          </div>
        </div>
      )}

      {/* ── VIEW TABS ────────────────────────────────────────────────────── */}
      {views.length > 0 && (
        <div className="dlm-tabs" role="tablist">
          <button role="tab" aria-selected={viewId === "all"} className={`dlm-tab ${viewId === "all" ? "active" : ""}`} onClick={() => pickView("all")}>
            <Grid size={13} /> All views <span className="n">{fmt(totalShown)}</span>
          </button>
          {views.map((v) => {
            const c = viewDefectCounts[v.id] || 0;
            return (
              <button key={v.id} role="tab" aria-selected={String(viewId) === String(v.id)} className={`dlm-tab ${String(viewId) === String(v.id) ? "active" : ""}`} onClick={() => pickView(v.id)}>
                <Eye size={13} /> {v.name} <span className={`n ${c > 0 ? "hot" : ""}`}>{fmt(c)}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── VIEWS DONUT + CONCENTRATION ──────────────────────────────────── */}
      <div className="dlm-row2">
        <Panel icon={PieChart} iconColor={ACCENT.process} title="Rejects by inspection view" badge={`${donut.slices.filter((s) => s.id).length} views`}
          sub="Share of visual rejects per CAD view · click a slice to open that view">
          {donutOption
            ? <EChart option={donutOption} onEvents={donutEvents} style={{ height: 280, width: "100%" }} />
            : <div className="dlm-empty">No visual rejects for the current filters.</div>}
        </Panel>

        <Panel icon={Sigma} iconColor={ACCENT.warning} title="Location concentration" badge={conc.total ? `Top 3 = ${conc.top3Share.toFixed(1)}%` : null}
          sub={`${scopeName} · locations ranked by rejects, cumulative share of located rejects`}>
          {!concOption ? <div className="dlm-empty">No located rejects for the current filters.</div> : (
            <>
              <div className="dlm-stats">
                <div className="dlm-stat"><span>Top-3 share</span><b>{conc.top3Share.toFixed(1)}%</b></div>
                <div className="dlm-stat"><span>Locations for 80%</span><b>{conc.n80} <small style={{ fontSize: 11, color: INK.muted, fontWeight: 600 }}>of {conc.points.length}</small></b></div>
                <div className="dlm-stat"><span>Locations hit</span><b>{conc.points.length} <small style={{ fontSize: 11, color: INK.muted, fontWeight: 600 }}>of {conc.configured}</small></b></div>
              </div>
              <EChart option={concOption} style={{ height: 240, width: "100%" }} />
            </>
          )}
        </Panel>
      </div>

      {/* ── MAP + RANKED LOCATIONS ───────────────────────────────────────── */}
      <div className="dlm-main">
        <Panel
          icon={Crosshair}
          iconColor={ACCENT.process}
          badge={scopeName}
          title={currentView ? currentView.name : "All inspection views"}
          sub={currentView ? `${fmt(viewDefectCounts[currentView.id] || 0)} rejects on this view · click a zone or sub-zone to inspect` : "Click a view to open it"}
          right={currentView && <button className="dlm-btn" onClick={() => setIsFullscreen(true)} title="Full screen"><Maximize2 size={14} /></button>}
        >
          {!views.length ? (
            <div className="dlm-empty">No CAD views are configured for this part (Rejection Configuration → View Setup).</div>
          ) : !currentView ? (
            <div className="dlm-gallery">
              {views.map((v) => {
                const c = viewDefectCounts[v.id] || 0;
                return (
                  <div key={v.id} className="dlm-gcard" onClick={() => pickView(v.id)} title={`Open ${v.name}`}>
                    <div className="dlm-gcard-head">{v.name}<span className={c > 0 ? "hot" : ""}>{fmt(c)} rejects</span></div>
                    <CadStage imageUrl={v.imageUrl} alt={v.name}>{renderOverlays(v, false)}</CadStage>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div className={isFullscreen ? "dlm-fs" : ""} onClick={isFullscreen ? (e) => { if (e.target === e.currentTarget) setIsFullscreen(false); } : undefined}>
                <div className={isFullscreen ? "dlm-fs-inner" : ""}>
                  {isFullscreen && <button className="dlm-fs-close" onClick={() => setIsFullscreen(false)} aria-label="Close full screen"><Minimize2 size={15} /></button>}
                  <CadStage imageUrl={currentView.imageUrl} alt={`${currentView.name} defect map`}>{renderOverlays(currentView, true)}</CadStage>
                </div>
              </div>
              <div className="dlm-stage-foot">
                <HeatScale max={Math.max(viewMax(currentView).zone, viewMax(currentView).sub)} />
                <span>Located on this view: <b>{fmt(zoneSummary.reduce((s, z) => s + z.count, 0))}</b> of {fmt(viewDefectCounts[currentView.id] || 0)}</span>
              </div>
            </>
          )}
        </Panel>

        <Panel
          icon={MapPin}
          iconColor={ACCENT.location}
          badge={hotspots.length ? `${hotspots.length} locations` : null}
          title="Top reject locations"
          sub={`${scopeName} · share of all located rejects · ● = drawn in the trend`}
        >
          {!hotspots.length ? (
            <div className="dlm-empty">No located rejects for the current filters.</div>
          ) : (
            <div className="dlm-list">
              {(() => {
                const used = new Set();
                const trendColor = {};
                (trend?.lines || []).forEach((l) => { const c = locationColor(l.key, used); used.add(c); trendColor[l.key] = c; });
                return hotspots.slice(0, 15).map((h, i) => {
                  const sel = selectedLocation && selectedLocation.zone === h.zone && (selectedLocation.subZone || null) === (h.sub || null);
                  const col = heatColorFor(h.count, hotspots[0].count) || INK.faint;
                  return (
                    <div key={h.key} className={`dlm-loc ${sel ? "sel" : ""}`} onClick={() => focusHotspot(h)}>
                      <span className="rk">{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="nm">{trendKeys.has(h.key) && <i style={{ background: trendColor[h.key] }} />}{h.label}</div>
                        {!currentView && <div className="vw">{h.view.name}</div>}
                        <div className="bar"><i style={{ width: `${Math.min(100, (h.count / hotspots[0].count) * 100)}%`, background: col }} /></div>
                      </div>
                      <div className="ct">{fmt(h.count)}<small>{h.share.toFixed(1)}%</small></div>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {selection && (
            <div className="dlm-sel">
              <h5>
                <span>{scopeTitle}</span>
                <span style={{ fontWeight: 600, color: "#b91c1c" }}>{fmt(selection.total)} · {selection.share.toFixed(1)}%</span>
              </h5>
              {selection.reasons.slice(0, 8).map((r) => (
                <div key={r.reason} className="dlm-reason"><span>{r.reason}</span><b>{fmt(r.count)}</b></div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="dlm-btn" onClick={() => exportCsv(selection.rows, `location_${normalize(scopeTitle)}.csv`)}><Download size={13} /> Records</button>
                <button className="dlm-btn" onClick={() => setSelectedLocation(null)}><X size={13} /> Clear</button>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* ── LOCATION TREND + SHIFT MATRIX ────────────────────────────────── */}
      <div className="dlm-row2">
        <Panel icon={TrendingUp} iconColor={ACCENT.ng} title="Daily rejects at the top locations" badge={`Top ${Math.min(TOP_TREND, hotspots.length)}`}
          sub={`${scopeName} · rejects per day for the ${Math.min(TOP_TREND, hotspots.length)} highest locations, dashed = all located`}>
          {trendOption
            ? <EChart option={trendOption} style={{ height: 320, width: "100%" }} />
            : <div className="dlm-empty">No dated, located rejects for the current filters.</div>}
        </Panel>

        <Panel icon={Clock} iconColor={ACCENT.model} title="Location × shift" badge={`Top ${shiftMx.rows.length}`}
          sub={`${scopeName} · rejects per shift, % = share of the location's rejects (row %)`}>
          {shiftOption ? (
            <>
              <EChart option={shiftOption} style={{ height: Math.max(280, 64 + shiftMx.rows.length * 34), width: "100%" }} />
              <div className="dlm-stage-foot" style={{ marginTop: 4 }}>
                <HeatScale max={shiftMx.max} label="rejects per cell (colour ∝ √count)" />
                <span>Top {shiftMx.rows.length}: <b>{fmt(shiftMx.grand)}</b> rejects · A {fmt(shiftMx.colTotals[0])} · B {fmt(shiftMx.colTotals[1])} · C {fmt(shiftMx.colTotals[2])}{shiftMx.colTotals[3] ? ` · Unassigned ${fmt(shiftMx.colTotals[3])}` : ""}</span>
              </div>
            </>
          ) : <div className="dlm-empty">No located rejects for the current filters.</div>}
        </Panel>
      </div>

      {/* ── DEFECT × LOCATION TREEMAP ────────────────────────────────────── */}
      <Panel icon={LayoutGrid} iconColor={ACCENT.location} title="Defect × location treemap" badge={`${fmt(totalMappedDefects)} located`}
        sub="View → zone → sub-zone, area = rejects, colour = dominant defect category · click to zoom, click a sub-zone to open it on the map"
        right={<div className="dlm-legend">{CAT_KEYS.map((k) => <span key={k} title={DEFECT_CATEGORY_LABEL[k]}><i style={{ background: DEFECT_CATEGORY[k] }} />{k}</span>)}</div>}>
        {treemapOption
          ? <EChart option={treemapOption} onEvents={treemapEvents} style={{ height: 440, width: "100%" }} />
          : <div className="dlm-empty">No located rejects for the current filters.</div>}
      </Panel>

      {/* ── DEFECT PARETO + DEFECT × ZONE ────────────────────────────────── */}
      <div className="dlm-row2">
        <Panel
          icon={Target}
          iconColor={OUTCOME.ng}
          badge="80/20 vital few"
          title="Defects by type"
          sub={`${scopeTitle} · ${fmt(pareto.total)} rejects · red bars make up the first 80% · click a bar to filter`}
        >
          {paretoOption
            ? <EChart option={paretoOption} onEvents={paretoEvents} style={{ height: 320, width: "100%" }} />
            : <div className="dlm-empty">No defects for the current filters.</div>}
        </Panel>

        <Panel
          icon={Grid}
          iconColor={ACCENT.model}
          badge="Heat matrix"
          title="Defect type by zone"
          sub={currentView ? `${currentView.name} · reject count per zone` : "Open a single view to compare zones"}
        >
          {!matrix ? (
            <div className="dlm-empty">{currentView ? "No located rejects on this view." : "Select a view above."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="dlm-mx">
                <thead>
                  <tr>
                    <th className="rl">Defect</th>
                    {matrix.cols.map((z) => <th key={z.id || z.code}>{zoneLabel(z)}</th>)}
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.rowsList.map((rs) => (
                    <tr key={rs}>
                      <td className="rl" style={{ color: reasonFilter === rs ? "#b91c1c" : undefined }} onClick={() => setReasonFilter(reasonFilter === rs ? "" : rs)} title="Filter by this defect">{rs}</td>
                      {matrix.cols.map((z) => {
                        const c = matrix.cell[rs]?.[String(z.id ?? z.code)] || 0;
                        const col = heatColorFor(c, matrix.max);
                        return (
                          <td key={z.id || z.code} style={{ background: col ? withAlpha(col, 0.85) : INK.surfaceAlt, color: heatIndex(c, matrix.max) >= 3 ? "#fff" : c ? INK.primary : INK.axis }}>
                            {c ? fmt(c) : "·"}
                          </td>
                        );
                      })}
                      <td className="tot">{fmt(matrix.reasonTot[rs])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ── ZONE BREAKDOWN (single view) ─────────────────────────────────── */}
      {currentView && zoneSummary.length > 0 && (
        <Panel
          icon={Layers}
          iconColor={ACCENT.quality}
          badge={currentView.name}
          title={`Zone breakdown — ${currentView.name}`}
          sub="Click a zone or sub-zone to highlight it on the map"
        >
          <div style={{ overflowX: "auto" }}>
            <table className="dlm-table">
              <thead>
                <tr><th>#</th><th>Zone</th><th>Sub-zones with rejects</th><th className="num">Rejects</th><th className="num">Share of located</th><th style={{ width: 160 }} /></tr>
              </thead>
              <tbody>
                {zoneSummary.map((z, i) => (
                  <tr key={z.zone.id || z.zone.code} className="click" onClick={() => setSelectedLocation({ type: "zone", view: currentView, zone: z.zone })}>
                    <td style={{ color: INK.faint }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{zoneLabel(z.zone)}</td>
                    <td>
                      {z.subs.length ? z.subs.map((s) => (
                        <span key={s.sub.id || s.sub.code} className="dlm-pill"
                          onClick={(e) => { e.stopPropagation(); setSelectedLocation({ type: "subZone", view: currentView, zone: z.zone, subZone: s.sub }); }}>
                          {subLabel(s.sub)} <b>{fmt(s.count)}</b>
                        </span>
                      )) : <span style={{ color: INK.faint }}>—</span>}
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{fmt(z.count)}</td>
                    <td className="num">{pctOf(z.count, totalMappedDefects).toFixed(1)}%</td>
                    <td><div className="dlm-track"><i style={{ width: `${Math.min(100, (z.count / zoneSummary[0].count) * 100)}%` }} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ── RECORDS AT SELECTED LOCATION ─────────────────────────────────── */}
      {selection && (
        <Panel
          icon={Activity}
          iconColor={ACCENT.neutral}
          badge={`${selection.rows.length} rows`}
          title={`Reject records — ${scopeTitle}`}
          sub={`${fmt(selection.rows.length)} records${selection.rows.length > 50 ? " · showing the latest 50, export for all" : ""}`}
        >
          <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
            <table className="dlm-table">
              <thead><tr><th>Part serial / QR</th><th>Category</th><th>Defect</th><th>Zone</th><th>Sub-zone</th><th>Shift</th><th>Machine</th></tr></thead>
              <tbody>
                {selection.rows.slice(0, 50).map((r, i) => (
                  <tr key={r.id || i}>
                    <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5 }}>{r.partId && r.partId !== "-" ? r.partId : r.customerQrCode || "—"}</td>
                    <td>{r._parsed?.category || "—"}</td>
                    <td style={{ color: "#b91c1c", fontWeight: 600 }}>{r._parsed?.reason || "—"}</td>
                    <td>{r._zoneName || "—"}{r._inferred && <span title="Zone not entered at inspection — placed by defect type" style={{ color: "#d97706", marginLeft: 4 }}>*</span>}</td>
                    <td>{r._subName || "—"}</td>
                    <td>{shiftKey(r.shiftCode || r.shift_code || r.shift)}</td>
                    <td>{r.machineName || r.machine_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
