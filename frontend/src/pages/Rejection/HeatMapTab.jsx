import React, { useEffect, useMemo, useState } from "react";
import { MapPin, X, Maximize2, Minimize2, Download, Layers, Crosshair, Activity, Gauge, ListOrdered } from "lucide-react";
import { rejectionConfigApi } from "../../api/services";
import { parseRowDefect, resolveDefectLocation, boxStyle, subBoxStyle, getFullImageUrl } from "./rejectionConstants";
import CadStage from "./components/CadStage";
import { useViewFrameAspect } from "../../utils/viewImageFrame";
import {
  SEQ_SCRAP, OUTCOME, INK, ACCENT, OTHER, DEFECT_CATEGORY, DEFECT_CATEGORY_LABEL, STATUS, FONT_FAMILY, CARD_CSS,
  shiftKey, accent, withAlpha,
} from "./chartTheme";

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
const LIST_LIMIT = 12;

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
/** Rows at a location: a sub-zone, a whole zone, or a zone's remainder (placed on the zone, no sub-zone). */
const rowsAtLocation = (list, loc) => {
  if (loc.type === "subZone") return list.filter((r) => rowMatchesSub(r, loc.view, loc.zone, loc.subZone));
  if (loc.remainder) return list.filter((r) => rowMatchesZone(r, loc.view, loc.zone) && !r._sk);
  return list.filter((r) => rowMatchesZone(r, loc.view, loc.zone));
};
const zoneLabel = (z) => String(z?.name || z?.code || "").replace(/^ZONE[-\s]*/i, "Zone ");
const subLabel = (s) => String(s?.code || s?.name || "");
const bump = (obj, k, q) => { obj[k] = (obj[k] || 0) + q; };
const locationName = (loc) => (loc
  ? `${zoneLabel(loc.zone)}${loc.subZone ? ` › ${subLabel(loc.subZone)}` : loc.remainder ? " (no sub-zone)" : ""}`
  : "");

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
        list.push({ key: `${zoneKey(v, zone)}::${NO_SUB}`, view: v, zone, sub: null, remainder: inSubs > 0, count: zc - inSubs, label: `${zoneLabel(zone)}${inSubs ? " (no sub-zone)" : ""}` });
      }
    });
  });
  return list
    .map((h) => ({ ...h, fullLabel: `${h.view.name} · ${h.label}`, share: pctOf(h.count, totalMapped) }))
    .sort((a, b) => b.count - a.count);
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

/** Recorded vs inferred proportion bar. */
const SplitBar = ({ count, inferred, max, color }) => {
  const w = Math.min(100, (count / Math.max(max, 1)) * 100);
  const inf = Math.min(count, inferred || 0);
  return (
    <div className="dlm-bar" aria-hidden>
      <i style={{ width: `${w}%`, background: inf ? `linear-gradient(90deg, ${color} ${pctOf(count - inf, count)}%, ${withAlpha(color, 0.35)} ${pctOf(count - inf, count)}%)` : color }} />
    </div>
  );
};

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
  const [fetched, setFetched] = useState(null); // { partName, config } from the API
  const [viewId, setViewId] = useState("all");
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reasonFilter, setReasonFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [showAll, setShowAll] = useState(false);
  const [hover, setHover] = useState(null); // { x, y, title, sub, rows }


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
  // The part's own CAD config when it has views, else the config passed in by the page.
  useEffect(() => {
    if (!partName) return undefined;
    let active = true;
    rejectionConfigApi.operatorConfig({ partName })
      .then((result) => {
        if (!active) return;
        setFetched({ partName, config: result?.views?.length ? result : null });
        setSelectedLocation(null);
      })
      .catch(() => { if (active) setFetched({ partName, config: null }); });
    return () => { active = false; };
  }, [partName]);
  const config = (partName && fetched?.partName === partName && fetched.config) || rejectionConfig || null;

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
  const scopeName = currentView ? currentView.name : "All views";

  const { viewDefectCounts, zoneCounts, subZoneCounts, totalMappedDefects, inferredMapped } = useMemo(
    () => countLocations(heatRows, views), [heatRows, views]
  );
  const inferredBy = useMemo(() => countInferred(heatRows), [heatRows]);

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

  /* Located rejects in the current scope (one view, or all) */
  const scopeLocatedRows = useMemo(
    () => (currentView ? heatRows.filter((r) => r._zk && rowMatchesView(r, currentView)) : heatRows.filter((r) => r._zk)),
    [heatRows, currentView]
  );
  const scopeLocated = useMemo(() => sumQty(scopeLocatedRows), [scopeLocatedRows]);

  /* Ranked locations of the current scope (share = of located rejects in scope) */
  const hotspots = useMemo(
    () => rankLocations(scopeViews, zoneCounts, subZoneCounts, scopeLocated),
    [scopeViews, zoneCounts, subZoneCounts, scopeLocated]
  );

  /* Breakdown — selected location, else the whole scope */
  const selectionRows = useMemo(
    () => (selectedLocation ? rowsAtLocation(heatRows, selectedLocation) : null),
    [selectedLocation, heatRows]
  );
  const breakdown = useMemo(() => summarize(selectionRows || scopeLocatedRows), [selectionRows, scopeLocatedRows]);

  const filtersActive = !!reasonFilter || categoryFilter !== "ALL";
  const clearAll = () => { setSelectedLocation(null); setReasonFilter(""); setCategoryFilter("ALL"); };
  const pickView = (id) => { setViewId(String(id)); setSelectedLocation(null); setShowAll(false); };
  const selectLoc = (loc) => setSelectedLocation((cur) => {
    const same = cur && cur.view === loc.view && cur.zone === loc.zone && (cur.subZone || null) === (loc.subZone || null) && !!cur.remainder === !!loc.remainder;
    return same ? null : loc;
  });
  const focusHotspot = (h) => {
    setViewId(String(h.view.id));
    selectLoc(h.sub
      ? { type: "subZone", view: h.view, zone: h.zone, subZone: h.sub }
      : { type: "zone", view: h.view, zone: h.zone, remainder: !!h.remainder });
  };
  const isHotSelected = (h) => !!selectedLocation && selectedLocation.zone === h.zone
    && (selectedLocation.subZone || null) === (h.sub || null) && (!!selectedLocation.remainder === !!h.remainder);
  const topLocation = hotspots[0];
  const exportRows = selectionRows || heatRows;
  const selTitle = selectedLocation ? `${selectedLocation.view?.name} · ${locationName(selectedLocation)}` : "";

  // Fullscreen box follows the image's own shape (portrait views stay portrait)
  const fsAspect = useViewFrameAspect(currentView?.imageUrl ? getFullImageUrl(currentView.imageUrl) : "");

  /* ── Hover card for the map (light, same look as the chart tooltips) ── */
  const showHover = (e, title, sub, rowsOut) => setHover({ x: e.clientX, y: e.clientY, title, sub, rows: rowsOut });
  const hoverRows = (count, inferred, scopeTotal) => [
    { label: "Rejects", value: fmt(count), color: OUTCOME.ng },
    { label: "Share of located", value: `${pctOf(count, scopeTotal).toFixed(1)}%` },
    inferred > 0 ? { label: "Inferred from defect type", value: fmt(inferred), color: INFERRED } : null,
  ].filter(Boolean);

  /* ── Overlay renderer for one view ─────────────────────────────────────── */
  const renderOverlays = (view, interactive) => {
    const mx = viewMax(view);
    const viewLocated = (view.zones || []).reduce((s, z) => s + zoneCount(view, z), 0);
    return (view.zones || []).map((zone) => {
      const zc = zoneCount(view, zone);
      const zInf = inferredBy[zoneKey(view, zone)] || 0;
      const zCol = heatColorFor(zc, mx.zone);
      const zSel = selectedLocation?.type === "zone" && selectedLocation.zone === zone;
      const hasSubs = (zone.subZones || []).length > 0;
      return (
        <React.Fragment key={zone.id || zone.code}>
          <div
            className={`cad-zone ${interactive ? "dlm-hit" : ""}`}
            onClick={interactive ? () => selectLoc({ type: "zone", view, zone }) : undefined}
            onMouseMove={interactive ? (e) => showHover(e, `${view.name} · ${zoneLabel(zone)}`, hasSubs ? "Whole zone, incl. sub-zones" : null, hoverRows(zc, zInf, viewLocated)) : undefined}
            onMouseLeave={interactive ? () => setHover(null) : undefined}
            style={{
              ...boxStyle(zone),
              ...(zCol ? { border: `1.5px solid ${zCol}`, background: withAlpha(zCol, hasSubs ? 0.06 + Math.sqrt(zc / mx.zone) * 0.12 : 0.18 + Math.sqrt(zc / mx.zone) * 0.42) } : {}),
              ...(zSel ? { border: `2px solid ${SELECT_RING}`, boxShadow: `0 0 0 3px ${withAlpha(SELECT_RING, 0.22)}` } : {}),
            }}
          >
            <span className="cad-tag">
              {zoneLabel(zone)}
              {zc > 0 && <span className="cad-count" style={{ background: zCol, color: heatInk(zc, mx.zone) }}>{fmt(zc)}</span>}
              {zInf > 0 && <b className="dlm-inf-dot" title={`${fmt(zInf)} inferred`} />}
            </span>
          </div>
          {(zone.subZones || []).map((sz) => {
            const sc = subCount(view, zone, sz);
            const sInf = inferredBy[subKey(view, zone, sz)] || 0;
            const sCol = heatColorFor(sc, mx.sub);
            const sSel = selectedLocation?.type === "subZone" && selectedLocation.subZone === sz;
            return (
              <div
                key={`s-${sz.id || sz.code}`}
                className={`cad-sub ${interactive ? "dlm-hit" : ""}`}
                onClick={interactive ? (e) => { e.stopPropagation(); selectLoc({ type: "subZone", view, zone, subZone: sz }); } : undefined}
                onMouseMove={interactive ? (e) => { e.stopPropagation(); showHover(e, `${view.name} · ${zoneLabel(zone)} › ${subLabel(sz)}`, null, hoverRows(sc, sInf, viewLocated)); } : undefined}
                onMouseLeave={interactive ? () => setHover(null) : undefined}
                style={{
                  ...subBoxStyle(zone, sz),
                  ...(sCol ? { border: `1.5px solid ${sCol}`, background: withAlpha(sCol, 0.3 + Math.sqrt(sc / mx.sub) * 0.45) } : {}),
                  ...(sSel ? { border: `2px solid ${SELECT_RING}`, boxShadow: `0 0 0 3px ${withAlpha(SELECT_RING, 0.25)}` } : {}),
                }}
              >
                {(sc > 0 || interactive) && (
                  <span className="cad-tag">
                    {subLabel(sz)}
                    {sc > 0 && <span className="cad-count" style={{ background: sCol, color: heatInk(sc, mx.sub) }}>{fmt(sc)}</span>}
                    {sInf > 0 && <b className="dlm-inf-dot" />}
                  </span>
                )}
              </div>
            );
          })}
        </React.Fragment>
      );
    });
  };

  const listItems = showAll ? hotspots : hotspots.slice(0, LIST_LIMIT);
  const hoverPos = hover ? {
    left: Math.max(8, Math.min(hover.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 250)),
    top: Math.max(8, Math.min(hover.y + 14, (typeof window !== "undefined" ? window.innerHeight : 800) - 150)),
  } : null;
  const mapMax = currentView ? Math.max(viewMax(currentView).zone, viewMax(currentView).sub) : 0;

  /* ═════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════ */
  return (
    <div className="dlm">
      <style>{CARD_CSS}{`
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
        .dlm-views{display:flex;gap:4px;flex-wrap:wrap;padding:4px;background:${INK.grid};border-radius:12px}
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
        .dlm-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:12px}
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
      `}</style>

      {/* ── HEADER + FILTERS ─────────────────────────────────────────────── */}
      <section className="ra-card">
        <div className="dlm-top">
          <div style={{ minWidth: 0 }}>
            <h2>Defect Location Map</h2>
            <p>Where visual rejects occur on the casting, by view, zone and sub-zone.</p>
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
              title={selectionRows ? "Export records at the selected location" : "Export records matching the filters"}>
              <Download size={14} /> Export
            </button>
          </div>
        </div>
        {(filtersActive || selectedLocation) && (
          <div className="dlm-chips">
            {categoryFilter !== "ALL" && <span className="ra-chip" style={accent(DEFECT_CATEGORY[categoryFilter] || ACCENT.process)}>Category: {categoryFilter}<button onClick={() => { setCategoryFilter("ALL"); setReasonFilter(""); }} aria-label="Clear category"><X size={12} /></button></span>}
            {reasonFilter && <span className="ra-chip" style={accent(OUTCOME.ng)}>Defect: {reasonFilter}<button onClick={() => setReasonFilter("")} aria-label="Clear defect"><X size={12} /></button></span>}
            {selectedLocation && <span className="ra-chip" style={accent(ACCENT.location)}>Location: {selTitle}<button onClick={() => setSelectedLocation(null)} aria-label="Clear location"><X size={12} /></button></span>}
            <button className="dlm-btn sm" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </section>

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="dlm-kpis">
        <Kpi icon={Activity} label="Visual rejects" value={fmt(totalShown)} sub={filtersActive ? `of ${fmt(sumQty(visualRows))} before filters` : "Recorded at visual inspection"} color={OUTCOME.ng} />
        <Kpi icon={Crosshair} label="Located on part" value={`${pctOf(totalMappedDefects, totalShown).toFixed(1)}%`}
          sub={`${fmt(totalMappedDefects)} placed${inferredMapped ? ` · ${fmt(inferredMapped)} inferred` : ""}`} color={ACCENT.process} />
        <Kpi icon={MapPin} label="Top location" value={topLocation ? fmt(topLocation.count) : "—"}
          sub={topLocation ? `${topLocation.fullLabel} · ${topLocation.share.toFixed(1)}%` : "No located rejects"} color={ACCENT.location} />
        <Kpi icon={Gauge} label="Leak-test rejects" value={fmt(sumQty(sensorRows))} sub="Sensor rejects, not on the map" color={ACCENT.quality} />
      </div>

      {/* ── VIEW SELECTOR ────────────────────────────────────────────────── */}
      {views.length > 0 && (
        <div className="dlm-views" role="tablist" aria-label="Inspection view">
          <button role="tab" aria-selected={viewId === "all"} className={`dlm-view ${viewId === "all" ? "active" : ""}`} onClick={() => pickView("all")}>
            All views <span className="n">{fmt(totalShown)}</span>
          </button>
          {views.map((v) => {
            const c = viewDefectCounts[v.id] || 0;
            const active = String(viewId) === String(v.id);
            return (
              <button key={v.id} role="tab" aria-selected={active} className={`dlm-view ${active ? "active" : ""}`} onClick={() => pickView(v.id)}>
                {v.name} <span className={`n ${c > 0 ? "hot" : ""}`}>{fmt(c)}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── MAP + HOT LOCATIONS + BREAKDOWN ──────────────────────────────── */}
      <div className="dlm-main">
        <Card
          icon={Layers}
          color={ACCENT.process}
          title={currentView ? currentView.name : "All inspection views"}
          sub={currentView ? "Click a zone or sub-zone to see its breakdown" : "Open a view to inspect its zones"}
          right={currentView && <button className="dlm-btn icon" onClick={() => setIsFullscreen(true)} title="Full screen" aria-label="Full screen"><Maximize2 size={14} /></button>}
        >
          {!views.length ? (
            <div className="dlm-empty">No CAD views are configured for this part (Rejection Configuration → View Setup).</div>
          ) : !currentView ? (
            <div className="dlm-gallery">
              {views.map((v) => {
                const c = viewDefectCounts[v.id] || 0;
                return (
                  <button type="button" key={v.id} className="dlm-gcard" onClick={() => pickView(v.id)} title={`Open ${v.name}`}>
                    <div className="dlm-gcard-head"><span className="dlm-ellipsis" style={{ color: INK.primary, fontSize: 12.5 }}>{v.name}</span><span>{fmt(c)} rejects</span></div>
                    <CadStage imageUrl={v.imageUrl} alt={v.name}>{renderOverlays(v, false)}</CadStage>
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className={isFullscreen ? "dlm-fs" : ""} onClick={isFullscreen ? (e) => { if (e.target === e.currentTarget) setIsFullscreen(false); } : undefined}>
                <div
                  className={isFullscreen ? "dlm-fs-inner" : ""}
                  style={isFullscreen ? { width: `min(calc(100vw - 48px), calc((100vh - 68px) * ${fsAspect}))` } : undefined}
                >
                  {isFullscreen && <button className="dlm-fs-close" onClick={() => setIsFullscreen(false)} aria-label="Close full screen"><Minimize2 size={15} /></button>}
                  <CadStage imageUrl={currentView.imageUrl} alt={`${currentView.name} defect map`}>{renderOverlays(currentView, true)}</CadStage>
                </div>
              </div>
              <div className="dlm-map-foot">
                <MapLegend max={mapMax} />
                {unlocated > 0 && <span className="dlm-map-note">{fmt(unlocated)} rejects have no zone and are not drawn.</span>}
              </div>
            </>
          )}
          {!currentView && views.length > 0 && (
            <div className="dlm-map-foot">
              <MapLegend max={0} />
              {unlocated > 0 && <span className="dlm-map-note">{fmt(unlocated)} rejects have no zone and are not drawn.</span>}
            </div>
          )}
        </Card>

        <div className="dlm-side">
          <Card
            icon={ListOrdered}
            color={ACCENT.location}
            title="Hot locations"
            sub={`${scopeName} · share of ${fmt(scopeLocated)} located rejects`}
          >
            {!hotspots.length ? (
              <div className="dlm-empty">No located rejects for the current filters.</div>
            ) : (
              <>
                <div className="dlm-list">
                  {listItems.map((h, i) => {
                    const inf = inferredBy[h.key] || 0;
                    const col = heatColorFor(h.count, hotspots[0].count) || INK.faint;
                    return (
                      <button type="button" key={h.key} className={`dlm-loc ${i < 3 ? "top" : ""} ${isHotSelected(h) ? "sel" : ""}`} onClick={() => focusHotspot(h)}
                        title={inf ? `${fmt(inf)} of ${fmt(h.count)} inferred from defect type` : undefined}>
                        <span className="rk">{i + 1}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="nm">
                            <span className="dlm-ellipsis">{h.label}</span>
                            {inf > 0 && <b className="dlm-inf-dot" />}
                            {!currentView && <span className="vw">{h.view.name}</span>}
                          </div>
                          <SplitBar count={h.count} inferred={inf} max={hotspots[0].count} color={col} />
                        </div>
                        <div className="ct"><b>{fmt(h.count)}</b><span>{h.share.toFixed(1)}%</span></div>
                      </button>
                    );
                  })}
                </div>
                {hotspots.length > LIST_LIMIT && (
                  <div className="dlm-actions" style={{ marginTop: 8 }}>
                    <button className="dlm-btn sm" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show top 12" : `Show all ${hotspots.length}`}</button>
                  </div>
                )}
              </>
            )}
          </Card>

          <Card
            icon={MapPin}
            color={selectedLocation ? SELECT_RING : ACCENT.neutral}
            title={selectedLocation ? locationName(selectedLocation) : `${scopeName} breakdown`}
            sub={selectedLocation ? selectedLocation.view?.name : "Select a location to narrow down"}
            right={selectedLocation && <button className="dlm-btn icon" onClick={() => setSelectedLocation(null)} aria-label="Clear selection" title="Clear selection"><X size={14} /></button>}
          >
            <Breakdown stats={breakdown} located={scopeLocated} />
            {selectionRows && selectionRows.length > 0 && (
              <div className="dlm-actions">
                <button className="dlm-btn sm" onClick={() => exportCsv(selectionRows, `location_${normalize(selTitle)}.csv`)}><Download size={13} /> Records CSV</button>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── RECORDS AT SELECTED LOCATION ─────────────────────────────────── */}
      {selectionRows && selectionRows.length > 0 && (
        <Card
          icon={Activity}
          color={ACCENT.neutral}
          title={`Reject records · ${selTitle}`}
          sub={`${fmt(selectionRows.length)} records${selectionRows.length > 50 ? " · first 50 shown, export for all" : ""}`}
        >
          <div className="dlm-table-wrap">
            <table className="dlm-table">
              <thead><tr><th>Part serial / QR</th><th>Category</th><th>Defect</th><th>Location</th><th>Shift</th><th>Machine</th></tr></thead>
              <tbody>
                {selectionRows.slice(0, 50).map((r, i) => (
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

      {/* ── MAP HOVER CARD ───────────────────────────────────────────────── */}
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
