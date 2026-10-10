import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Image as ImageIcon, MousePointerClick, X, ZoomIn } from "lucide-react";
import SectionCard from "../../../../components/mgmt/SectionCard";
import ZoomBarChart from "../../../../components/mgmt/ZoomBarChart";
import ParetoChart from "../../../../components/mgmt/ParetoChart";
import { SkeletonBlock } from "../../../../components/mgmt/Skeleton";
import EmptyState from "../../../../components/mgmt/EmptyState";
import {
  CATEGORY_COLOR, CATEGORY_NAME, CATEGORY_ORDER, NAVY, OUTCOME_COLOR, SLATE, TARGETS, WARMUP_COLOR, fmtInt, fmtPct, pctOf,
} from "../../../../components/mgmt/mgmtTheme";
import { shiftLetter } from "../derive";
import { zoneKeyLabel, zoneKeyOf } from "../rejFilters";
import { buildStationBars, locateRecords, reasonCounts } from "../deriveTabs";
import PartMap from "../PartMap";
import ReasonList from "../ReasonList";
import { StationPictorial } from "./OverviewTab";
import GateCarousel, { GC_CSS } from "../overview/GateCarousel";
import StationReasonMatrix, { SRM_CSS } from "../overview/StationReasonMatrix";
import { GateSunburstCard, ShiftSunburstCard, SUN_CSS } from "../overview/Sunbursts";
import { CategoryTrendCard, ProductionTrendCard, StationBarsCard, TREND_CSS } from "../overview/TrendCards";

/* ═══════════════════════════════════════════════════════════════════════════
   Overview (tab 1 of Rejection Analysis), top to bottom:
     a. Quality gates — auto-scrolling speedometer carousel (line · OP100 DCM shots · stations · one OP150 item that
        rotates LT-1/2/3, "all" shows them together); click a gauge → pictorial view
     b. Shift distribution (OK vs NG by shift) | rejection category (CR · CRAM · MR) — donuts, slice → reasons panel
     c. Quality gate bars (OK · NG · in progress per station, drill NG → category → reasons) | rejections per day /
        month by category (grouped, zoom)
     d. Rejection Pareto Category → Reason → Zone (vertical bars, cumulative + 80 % line, Back)
     e. Station × reason matrix (click a cell → its records)
     f. Quality calendar (OK / NG per production day, click → CR / MR / CRAM and reasons)
   Data: shot analytics, summary, Pareto, daily trend (page) + NG part records (rows) + CAD config (pictorial).
   ═══════════════════════════════════════════════════════════════════════════ */

const CATS = [...CATEGORY_ORDER, "OTHER"];
const BAR_CATS = ["CR", "MR", "CRAM"];
const catShort = (c) => (c === "OTHER" ? "Not classified" : c);
const catLong = (c) => (c === "OTHER" ? "Not classified" : `${c} · ${CATEGORY_NAME[c]}`);
const WIP_COLOR = SLATE[400];
const ZoomHint = () => <span className="mg-hint"><ZoomIn size={13} aria-hidden="true" />Wheel = zoom · drag = move</span>;
const STEP_NAME = { OP100: "Die casting (traced)", OP150: "Leak test" };
const shortName = (s) => STEP_NAME[s.key] || (s.name || "").replace(/^OP\d{3}\s*/, "") || s.name;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const SO_CSS = `
${GC_CSS}
.ra-dp-table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
.ra-dp-table th{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b;text-align:right;padding:6px 6px;border-bottom:1px solid #e2e8f0;white-space:nowrap}
.ra-dp-table th:first-child,.ra-dp-table td:first-child{text-align:left}
.ra-dp-table td{padding:8px 6px;text-align:right;border-bottom:1px solid #f1f5f9;color:#334155;white-space:nowrap}
.ra-dp-table tbody tr{cursor:pointer}
.ra-dp-table tbody tr:hover td{background:#f8fafc}
.ra-dp-table tbody tr.on td{background:#eef3f9}
.ra-dp-table tfoot td{font-weight:700;color:#0f172a;border-bottom:none;border-top:1px solid #e2e8f0}
${SRM_CSS}
${SUN_CSS}
${TREND_CSS}
.ra-pareto-sub{font-size:12px;color:#475569;margin:2px 0 4px;display:flex;align-items:center;flex-wrap:wrap;gap:2px 4px}
.ra-pareto-sub b{color:#0f172a}
.ra-shot-panel{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.ra-shot-panel div{border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:8px 10px}
.ra-shot-panel b{display:block;font-size:18px;font-variant-numeric:tabular-nums}
.ra-shot-panel span{font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#64748b}
.ra-trend-detail{margin-top:12px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;background:#fbfcfe}
.ra-trend-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:14px;align-items:start}
@media (max-width:760px){.ra-trend-detail-grid{grid-template-columns:1fr}}
`;

/** Width of an element (ResizeObserver). */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((e) => setW(e[0]?.contentRect?.width || 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Line steps in process order (the three leak machines run in parallel → one OP150 step) with the parts that passed
 * a step and have no result at the next one yet: wip = step OK − next step inspected (OK + NG), never below 0.
 */
function buildSteps(stations) {
  const steps = [];
  (stations || []).forEach((s) => {
    if (s.op === "OP150") {
      let st = steps.find((x) => x.op === "OP150");
      if (!st) { st = { key: "OP150", op: "OP150", label: "OP150", name: "OP150 Leak test", ok: 0, ng: 0, machines: [] }; steps.push(st); }
      st.ok += s.ok; st.ng += s.ng; st.machines.push(s.label);
      return;
    }
    steps.push({ key: s.key, op: s.op, label: s.label, name: s.name, ok: s.ok, ng: s.ng });
  });
  steps.forEach((s, i) => {
    const nx = steps[i + 1] || null;
    s.inspected = s.ok + s.ng;
    s.next = nx ? nx.label : null;
    s.wip = nx ? Math.max(0, s.ok - (nx.ok + nx.ng)) : 0;
    s.ngPct = pctOf(s.ng, s.inspected);
    s.short = shortName(s);
  });
  return steps;
}

const catCounts = (recs) => {
  const c = { CR: 0, CRAM: 0, MR: 0, OTHER: 0 };
  (recs || []).forEach((r) => { c[r._cat] += 1; });
  return c;
};

/** Top N items, the tail folded into one "Other" bar (not drillable). */
function foldTop(list, top = 12) {
  if (list.length <= top + 1) return list;
  const rest = list.slice(top);
  return [...list.slice(0, top), {
    key: null, label: `Other (${rest.length} more)`, value: rest.reduce((a, x) => a + x.value, 0), color: SLATE[400], group: "Mixed",
    note: `Includes: ${rest.slice(0, 6).map((x) => x.label).join(", ")}${rest.length > 6 ? " …" : ""}`,
  }];
}

/* ═══ a. Quality gates carousel → pictorial ═══ */
function ShotPanel({ shot, k, onClose }) {
  const byShift = (shot?.byShift || []).map((s) => ({ ...s, l: shiftLetter(s.shift) || s.shift }));
  return (
    <div className="ra-pict" id="ra-station-pictorial">
      <div className="ra-pict-head">
        <div>
          <div className="ra-pict-title"><ImageIcon size={15} aria-hidden="true" /> OP100 DCM shots — {shot?.totals?.machine || k.machine || "die-casting machine"}</div>
          <div className="ra-pict-sub">NG shot % = NG shots ÷ (OK + NG shots); warm-up shots are planned start-up shots and not scrap. NG shots have no location on the part (the machine rejects the shot on its process parameters).</div>
        </div>
        <button type="button" className="ra-icon-btn" onClick={onClose} aria-label="Close"><X size={15} /></button>
      </div>
      <div className="ra-shot-panel">
        <div><b>{fmtInt(k.shots)}</b><span>Shots</span></div>
        <div><b style={{ color: OUTCOME_COLOR.ok }}>{fmtInt(k.goodShots)}</b><span>OK shots</span></div>
        <div><b style={{ color: SLATE[600] }}>{fmtInt(k.warmUp)}</b><span>Warm-up</span></div>
        <div><b style={{ color: OUTCOME_COLOR.ng }}>{fmtInt(k.ngShots)}</b><span>NG shots</span></div>
        <div><b>{fmtPct(pctOf(k.ngShots, num(k.goodShots) + num(k.ngShots)), 2)}</b><span>NG shot %</span></div>
      </div>
      {byShift.length > 0 && (
        <table className="ra-dp-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Shift</th><th>Shots</th><th>OK</th><th>Warm-up</th><th>NG</th><th>NG shot %</th></tr></thead>
          <tbody>
            {byShift.map((s) => (
              <tr key={s.shift} style={{ cursor: "default" }}>
                <td><b>Shift {s.l}</b></td>
                <td>{fmtInt(s.shots)}</td>
                <td style={{ color: OUTCOME_COLOR.ok, fontWeight: 700 }}>{fmtInt(s.ok)}</td>
                <td style={{ color: SLATE[600] }}>{fmtInt(s.warmUp)}</td>
                <td style={{ color: OUTCOME_COLOR.ng, fontWeight: 700 }}>{fmtInt(s.ng)}</td>
                <td>{fmtPct(pctOf(s.ng, num(s.ok) + num(s.ng)), 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function GaugesCard({ stations, enriched, rowsLoading, config, configLoading, summaryLoading, ensure, k, shot }) {
  const [picked, setPicked] = useState(null);
  const station = picked && picked !== "OP100" ? stations.find((s) => s.key === picked) : null;
  useEffect(() => { if (station) ensure("config"); }, [station, ensure]);
  const pick = useCallback((key) => setPicked((p) => (p === key ? null : key)), []);

  const shotGate = useMemo(() => (k.shots == null ? null : {
    shots: k.shots, ok: k.goodShots, ng: k.ngShots, warmUp: k.warmUp, ngPct: pctOf(k.ngShots, num(k.goodShots) + num(k.ngShots)),
  }), [k]);
  const leaks = useMemo(() => stations.filter((s) => s.op === "OP150"), [stations]);
  const items = useMemo(() => {
    const out = [];
    if (shotGate) out.push({ type: "shot", shot: shotGate });
    let leakDone = false;
    stations.forEach((s) => {
      if (s.key === "OP100") return; // OP100 = DCM shot gauge (shot analytics), not the traced parts
      if (s.op === "OP150") {
        if (leakDone) return;
        leakDone = true;
        if (leaks.length > 1) out.push({ type: "leak", machines: leaks });
        else out.push({ type: "station", s });
        return;
      }
      out.push({ type: "station", s });
    });
    return out;
  }, [stations, shotGate, leaks]);
  // one dial scale for every gauge so they compare at a glance
  const max = Math.max(Math.ceil((TARGETS.scrapPct + TARGETS.amberBandPp) * 2), ...stations.map((s) => Math.ceil((s.ngPct || 0) * 1.15)), Math.ceil((shotGate?.ngPct || 0) * 1.15));

  return (
    <SectionCard
      id="ra-gates"
      title="Quality gates — NG % by station"
      subtitle="Speedometers in process order; they scroll by themselves (hover to pause). Click a gauge for its defect map, hot spots and reasons."
      info={{
        what: "OP100: DCM shots of the die-casting machine (shot analytics) — NG shot % = NG shots ÷ (OK + NG shots), warm-up excluded. Stations: each counted by its own scan time in the period. NG = station rejections by the decisive NG scan (as the Historical page). OP150 rotates through LT-1 / LT-2 / LT-3; the ▥ button switches the card to the three machines added together.",
        formula: [
          "Station NG % = station NG ÷ (station OK + station NG)",
          `Green ≤ ${TARGETS.scrapPct}% · amber ≤ ${TARGETS.scrapPct + TARGETS.amberBandPp}% · red above`,
        ],
      }}
    >
      {summaryLoading && !stations.length ? <SkeletonBlock lines={6} height={260} />
        : !stations.length ? <EmptyState title="No station data in this period" />
          : (
            <>
              <GateCarousel items={items} picked={picked} onPick={pick} max={max} />
              {picked === "OP100" && <ShotPanel shot={shot} k={k} onClose={() => setPicked(null)} />}
              {station && (
                <StationPictorial
                  key={station.key}
                  station={station}
                  enriched={enriched}
                  rowsLoading={rowsLoading}
                  config={config}
                  configLoading={configLoading}
                  onClose={() => setPicked(null)}
                />
              )}
            </>
          )}
    </SectionCard>
  );
}

/* ═══ d. Rejection Pareto Category → Reason → Zone (vertical bars) ═══ */
const DIMS = ["cat", "reason", "zone"];
const DIM_NAME = { cat: "Category", reason: "Reason", zone: "Zone" };
const SHOT_ZONE = "__shots";
const PARETO_TOP = 12;
const zoneBucket = (r) => zoneKeyOf(r._parsed);
const zoneBucketLabel = (k) => (k === SHOT_ZONE ? "NG shots (no location)" : zoneKeyLabel(k));

function ParetoCard({ enriched, rowsLoading, ngShots, config, configLoading, ensure }) {
  const [root, setRoot] = useState("cat");
  const [path, setPath] = useState([]); // [{ dim, key, label }]
  const [zonePick, setZonePick] = useState(null);
  const dims = DIMS.slice(DIMS.indexOf(root));
  const dim = dims[Math.min(path.length, dims.length - 1)];
  const nextDim = dims[path.length + 1] || null;
  useEffect(() => { if (zonePick) ensure("config"); }, [zonePick, ensure]);

  const recs = useMemo(() => (enriched
    ? enriched.filter((r) => path.every((p) => (p.dim === "cat" ? r._cat === p.key : p.dim === "reason" ? r._reason === p.key : zoneBucket(r) === p.key)))
    : null), [enriched, path]);
  // station rejections only (the decisive NG scans) — DCM NG shots are not station rejections
  const scopeShots = 0;

  const pareto = useMemo(() => {
    if (!recs) return null;
    let list;
    if (dim === "cat") {
      const c = catCounts(recs);
      c.CR += scopeShots;
      list = CATS.filter((k) => c[k] > 0).sort((a, b) => c[b] - c[a])
        .map((k) => ({ key: k, label: catLong(k), value: c[k], color: CATEGORY_COLOR[k], group: catShort(k), note: k === "CR" && scopeShots ? `Includes ${fmtInt(scopeShots)} NG shots.` : undefined }));
    } else if (dim === "reason") {
      const data = reasonCounts(recs, { ngShots: scopeShots });
      list = (data.list || []).map((x) => ({ key: x.reason, label: x.reason, value: x.count, color: CATEGORY_COLOR[x.cat] || CATEGORY_COLOR.OTHER, group: catShort(x.cat) }));
    } else {
      const m = new Map();
      recs.forEach((r) => {
        const k = zoneBucket(r);
        const b = m.get(k) || { key: k, value: 0, cats: {} };
        b.value += 1;
        b.cats[r._cat] = (b.cats[r._cat] || 0) + 1;
        m.set(k, b);
      });
      if (scopeShots) m.set(SHOT_ZONE, { key: SHOT_ZONE, value: scopeShots, cats: { CR: scopeShots } });
      list = [...m.values()].sort((a, b) => b.value - a.value).map((b) => {
        const top = Object.entries(b.cats).sort((x, y) => y[1] - x[1])[0]?.[0] || "OTHER";
        const located = b.key !== "" && b.key !== "LEAK" && b.key !== SHOT_ZONE;
        return {
          key: b.key, label: zoneBucketLabel(b.key), value: b.value, color: located ? CATEGORY_COLOR[top] || NAVY : SLATE[400], group: catShort(top),
          note: !located ? "No location on the part." : undefined,
        };
      });
    }
    const total = list.reduce((a, x) => a + x.value, 0);
    return { items: foldTop(list, PARETO_TOP), total, distinct: list.length };
  }, [recs, dim, scopeShots]);

  const onBar = useCallback((it) => {
    if (!it || it.key === null || it.key === undefined) return;
    if (dim === "zone") {
      if (it.key === "" || it.key === "LEAK" || it.key === SHOT_ZONE) return;
      setZonePick((z) => (z === it.key ? null : it.key));
      return;
    }
    if (!nextDim) return;
    setZonePick(null);
    setPath((p) => [...p, { dim, key: it.key, label: dim === "cat" ? catShort(it.key) : it.label }]);
  }, [dim, nextDim]);
  const back = () => { setZonePick(null); setPath((p) => p.slice(0, -1)); };
  const goTo = (n) => { setZonePick(null); setPath((p) => p.slice(0, n)); };
  const startBy = (d) => { setZonePick(null); setRoot(d); setPath([]); };

  const [wRef, w] = useWidth();
  const labelWidth = Math.max(90, Math.min(150, Math.round(w / Math.max(4, (pareto?.items.length || 4)) * 1.6)));
  const views = useMemo(() => (Array.isArray(config?.views) ? config.views : []), [config]);
  const zoneRecs = useMemo(() => (zonePick && recs ? recs.filter((r) => zoneBucket(r) === zonePick) : null), [zonePick, recs]);
  const zoneHighlight = useMemo(() => {
    if (!zoneRecs || !views.length) return null;
    const hit = locateRecords(zoneRecs, views).find((x) => x.vi >= 0 && x.zi >= 0);
    return hit ? { vi: hit.vi, zi: hit.zi } : null;
  }, [zoneRecs, views]);
  const scopeText = path.length ? path.map((p) => p.label).join(" › ") : "all rejections";
  const hint = dim === "zone" ? "Click a zone to see it on the part." : nextDim ? `Click a bar to drill into its ${DIM_NAME[nextDim].toLowerCase()}s.` : "";

  return (
    <SectionCard
      id="ra-mix"
      title="Rejection Pareto — Category → Reason → Zone"
      subtitle="Biggest first with the cumulative share and the 80 % line. Click a bar (or its name) to drill down; Back or the breadcrumb returns."
      info={{
        what: "Station rejections of the period (decisive NG scan per part per station, as the Historical page; leak test = CRAM) ranked biggest first. Drill from a category into its reasons and from a reason into the zones of the part where it was found. The top 12 bars are shown, the rest is folded into \"Other\".",
        formula: ["Share = count ÷ total of the current level", "Cumulative line = running share (dashed line at 80 %)"],
        note: "Zones come from the operator entry (\"Zone: …\"); leak-test rejections and NG shots have no location on the part.",
      }}
    >
      {rowsLoading && !enriched ? <SkeletonBlock lines={6} height={320} />
        : !pareto?.total && !path.length ? <EmptyState title="No rejections in this period" />
          : (
            <div ref={wRef} style={{ minWidth: 0 }}>
              <div className="ra-pareto-head">
                <nav className="mg-crumbs" aria-label="Pareto drill-down" style={{ margin: 0 }}>
                  {path.length > 0 && <button type="button" className="mg-back" onClick={back}><ArrowLeft size={14} />Back</button>}
                  {path.length ? <button type="button" onClick={() => goTo(0)}>All rejections</button> : <b aria-current="page">All rejections</b>}
                  {path.map((p, i) => (
                    <React.Fragment key={`${p.dim}-${p.key}`}>
                      <ChevronRight size={14} aria-hidden="true" />
                      {i < path.length - 1 ? <button type="button" onClick={() => goTo(i + 1)}>{p.label}</button> : <b aria-current="page">{p.label}</b>}
                    </React.Fragment>
                  ))}
                </nav>
                <div className="ra-seg ra-seg-sm" role="group" aria-label="Start the Pareto by">
                  {DIMS.map((d) => (
                    <button key={d} type="button" aria-pressed={root === d && !path.length} className={root === d && !path.length ? "on" : ""} onClick={() => startBy(d)}>By {DIM_NAME[d].toLowerCase()}</button>
                  ))}
                </div>
              </div>
              <div className="ra-pareto-sub">
                <b>By {DIM_NAME[dim].toLowerCase()}</b> · {scopeText} · total <b>{fmtInt(pareto?.total)}</b>
                {pareto && pareto.distinct > PARETO_TOP + 1 ? ` · top ${PARETO_TOP} of ${pareto.distinct}` : ""}
                {ngShots > 0 && <span style={{ color: SLATE[500] }}>· DCM NG shots ({fmtInt(ngShots)}) not included</span>}
                {hint && <span className="mg-hint" style={{ marginLeft: 8 }}><MousePointerClick size={13} aria-hidden="true" />{hint}</span>}
              </div>
              {!pareto?.items.length ? <EmptyState title="No rejections at this level" />
                : (
                  <ParetoChart
                    items={pareto.items}
                    total={pareto.total}
                    labelWidth={labelWidth}
                    showPct
                    valueName="Rejections"
                    height={380}
                    selectedIndex={dim === "zone" && zonePick ? pareto.items.findIndex((x) => x.key === zonePick) : null}
                    onSelect={(dim === "zone" || nextDim) ? onBar : undefined}
                    selectHint={dim === "zone" ? "Click to see this zone on the part." : nextDim ? `Click to drill into the ${DIM_NAME[nextDim].toLowerCase()}s.` : ""}
                  />
                )}
            </div>
          )}
      {zonePick && zoneRecs && (
        <div className="ra-pict" id="ra-mix-map">
          <div className="ra-pict-head">
            <div className="ra-pict-title"><ImageIcon size={15} aria-hidden="true" /> {zoneBucketLabel(zonePick)} — {fmtInt(zoneRecs.length)} rejections · {scopeText}</div>
            <button type="button" className="ra-icon-btn" onClick={() => setZonePick(null)} aria-label="Close part view"><X size={15} /></button>
          </div>
          {configLoading && !config ? <SkeletonBlock lines={5} height={240} /> : !views.length ? <EmptyState title="No part views configured" hint="Add views and zones in Rejection Configuration." /> : (
            <PartMap
              key={zonePick}
              records={zoneRecs}
              views={views}
              highlight={zoneHighlight}
              hotTitle="Top hot spots"
              aside={<div style={{ marginTop: 14 }}><ReasonList title={`Reasons in ${zoneBucketLabel(zonePick)}`} data={reasonCounts(zoneRecs)} limit={8} showCats /></div>}
            />
          )}
        </div>
      )}
    </SectionCard>
  );
}

/** Tab — Overview. */
export default function StationOverviewTab({
  filters, singleDay, gates, pareto, enriched, rowsLoading, summaryLoading, trendData, trendLoading, shot, k,
  config, configLoading, ensure,
}) {
  useEffect(() => { ensure("rows"); }, [ensure]);
  const drill = pareto?.qualityGateDrillDown || null;
  const stations = useMemo(() => buildStationBars({ gates, drill, enriched }), [gates, drill, enriched]);
  const steps = useMemo(() => buildSteps(stations), [stations]);

  return (
    <>
      <style>{SO_CSS}</style>
      <GaugesCard
        stations={stations}
        enriched={enriched}
        rowsLoading={rowsLoading}
        config={config}
        configLoading={configLoading}
        summaryLoading={summaryLoading}
        ensure={ensure}
        k={k}
        shot={shot}
      />
      <GateSunburstCard enriched={enriched} rowsLoading={rowsLoading} shot={shot} />
      <ShiftSunburstCard trendData={trendData} trendLoading={trendLoading} enriched={enriched} rowsLoading={rowsLoading} />
      <ProductionTrendCard filters={filters} singleDay={singleDay} trendData={trendData} trendLoading={trendLoading} enriched={enriched} rowsLoading={rowsLoading} />
      <StationBarsCard steps={steps} enriched={enriched} rowsLoading={rowsLoading} summaryLoading={summaryLoading} />
      <CategoryTrendCard filters={filters} singleDay={singleDay} trendData={trendData} trendLoading={trendLoading} enriched={enriched} rowsLoading={rowsLoading} shot={shot} />
      <ParetoCard
        enriched={enriched}
        rowsLoading={rowsLoading}
        ngShots={k.ngShots || 0}
        config={config}
        configLoading={configLoading}
        ensure={ensure}
      />
      <StationReasonMatrix enriched={enriched} rowsLoading={rowsLoading} />
    </>
  );
}
