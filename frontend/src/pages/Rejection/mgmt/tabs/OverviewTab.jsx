import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Image as ImageIcon, List, MousePointerClick, X, ZoomIn,
} from "lucide-react";
import SectionCard from "../../../../components/mgmt/SectionCard";
import ZoomBarChart from "../../../../components/mgmt/ZoomBarChart";
import DonutChart from "../../../../components/mgmt/DonutChart";
import { SkeletonBlock } from "../../../../components/mgmt/Skeleton";
import EmptyState from "../../../../components/mgmt/EmptyState";
import {
  CATEGORY_COLOR, CATEGORY_NAME, CATEGORY_ORDER, OUTCOME_COLOR, SLATE, fmtInt, fmtPct,
} from "../../../../components/mgmt/mgmtTheme";
import StationSpeedometer from "../../components/StationSpeedometer";
import { dayLabel, shiftLetter } from "../derive";
import {
  SHIFT_COLOR, buildCategoryDays, buildCategoryMonths, buildShiftSplit, buildStationBars, longDayLabel, monthLabel, reasonCounts,
} from "../deriveTabs";
import { dayCount } from "../periods";
import { RecordsTable } from "../RecordsSection";
import PartMap from "../PartMap";
import ReasonList from "../ReasonList";
import DieShiftSection from "../DieShiftSection";

const CAT_SERIES = [...CATEGORY_ORDER, "OTHER"];
const catName = (c) => (c === "OTHER" ? "Not classified" : c);
const ZoomHint = () => <span className="mg-hint"><ZoomIn size={13} aria-hidden="true" />Mouse wheel = zoom · drag = move · slider below</span>;

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

const stationRecords = (enriched, s) => (enriched || []).filter((r) => (s.leak ? r._op === "OP150" && r._leak === s.leak : r._op === s.op));

/* ═══ Station gauges (carousel) ═══ */
const GAUGE_W = 178;
const GAUGE_GAP = 12;

export function StationCarousel({ stations, selected, onPick }) {
  const [ref, width] = useWidth();
  const per = Math.max(1, Math.floor((width + GAUGE_GAP) / (GAUGE_W + GAUGE_GAP)));
  const pages = Math.max(1, Math.ceil(stations.length / per));
  const [page, setPage] = useState(0);
  const p = Math.min(page, pages - 1);
  const shown = stations.slice(p * per, p * per + per);

  return (
    <div className="ra-car">
      <div className="ra-car-row">
        <button type="button" className="ra-car-nav" onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0} aria-label="Previous stations"><ChevronLeft size={18} /></button>
        <div ref={ref} className="ra-car-track" style={{ gridTemplateColumns: `repeat(${per}, minmax(0, 1fr))` }}>
          {shown.map((s) => {
            const on = selected === s.key;
            return (
              <button
                key={s.key}
                type="button"
                className={`ra-gauge ${on ? "on" : ""}`}
                aria-pressed={on}
                onClick={() => onPick(s.key)}
                title={`${s.name}: ${fmtInt(s.ok)} OK, ${fmtInt(s.ng)} NG of ${fmtInt(s.inspected)} inspected — click for the pictorial view`}
              >
                <span className="ra-gauge-head">
                  <b>{s.label}</b>
                  <span className="ra-gauge-fpy">FPY {fmtPct(s.fpyPct, 1)}</span>
                </span>
                <span className="ra-gauge-name">{s.name.replace(/^OP\d{3}\s*/, "") || s.name}</span>
                <StationSpeedometer value={s.ngPct || 0} max={10} size="compact" label="NG %" />
                <span className="ra-gauge-nums">
                  <span style={{ color: OUTCOME_COLOR.ok }}><i style={{ background: OUTCOME_COLOR.ok }} />OK {fmtInt(s.ok)}</span>
                  <span style={{ color: OUTCOME_COLOR.ng }}><i style={{ background: OUTCOME_COLOR.ng }} />NG {fmtInt(s.ng)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <button type="button" className="ra-car-nav" onClick={() => setPage(Math.min(pages - 1, p + 1))} disabled={p >= pages - 1} aria-label="Next stations"><ChevronRight size={18} /></button>
      </div>
      {pages > 1 && (
        <div className="ra-car-dots" role="tablist" aria-label="Station pages">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === p} aria-label={`Stations page ${i + 1}`} className={i === p ? "on" : ""} onClick={() => setPage(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Pictorial view of one station: its NG on the part views + its reasons. */
export function StationPictorial({ station, enriched, rowsLoading, config, configLoading, onClose }) {
  const recs = useMemo(() => (enriched ? stationRecords(enriched, station) : null), [enriched, station]);
  const reasons = useMemo(() => (recs ? reasonCounts(recs) : null), [recs]);
  const views = useMemo(() => (Array.isArray(config?.views) ? config.views : []), [config]);
  const [showRecs, setShowRecs] = useState(false);
  return (
    <div className="ra-pict" id="ra-station-pictorial">
      <div className="ra-pict-head">
        <div style={{ minWidth: 0 }}>
          <div className="ra-pict-title"><ImageIcon size={15} aria-hidden="true" /> {station.name} — pictorial view</div>
          <div className="ra-pict-sub">
            {fmtInt(station.inspected)} inspected · <b style={{ color: OUTCOME_COLOR.ok }}>{fmtInt(station.ok)} OK</b> · <b style={{ color: OUTCOME_COLOR.ng }}>{fmtInt(station.ng)} NG</b> · NG {fmtPct(station.ngPct, 2)} · FPY {fmtPct(station.fpyPct, 1)}
          </div>
        </div>
        <span style={{ display: "inline-flex", gap: 6 }}>
          {station.ng > 0 && (
            <button type="button" className="mg-link" onClick={() => setShowRecs((v) => !v)} aria-expanded={showRecs}>
              <List size={14} /> {showRecs ? "Hide records" : "NG records"}
            </button>
          )}
          <button type="button" className="ra-icon-btn" onClick={onClose} aria-label="Close pictorial view"><X size={15} /></button>
        </span>
      </div>
      {station.ng === 0 ? <EmptyState title={`No rejections at ${station.label} in this period`} minHeight={110} /> : (
        <PartMap
          key={station.key}
          records={recs}
          views={views}
          loading={(rowsLoading && !recs) || (configLoading && !config)}
          hotTitle="Hot spots"
          reasonTitle="Reasons"
          emptyTitle="No located rejections at this station"
          reasonPanel={reasons && <ReasonList title={`Why rejected at ${station.label}`} sub="Biggest first · count, share and category" data={reasons} limit={12} showCats />}
        />
      )}
      {showRecs && recs && (
        <div style={{ marginTop: 14 }}>
          <div className="ra-mini-title">NG records at {station.label} ({fmtInt(recs.length)})</div>
          <RecordsTable enriched={recs} pageSize={10} hideStation />
        </div>
      )}
    </div>
  );
}

/* ═══ Station table with expandable rows ═══ */
function StationTable({ stations, enriched, rowsLoading, onPictorial }) {
  const [open, setOpen] = useState(() => new Set());
  const [recsOpen, setRecsOpen] = useState(null);
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <div className="mg-table-wrap">
      <table className="mg-table ra-st-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}><span className="sr-only">Expand</span></th>
            <th>Station</th><th className="r">Inspected</th><th className="r">OK</th><th className="r">NG</th><th className="r">NG %</th>
            <th style={{ width: "24%" }}>NG by category</th>
          </tr>
        </thead>
        <tbody>
          {stations.map((s) => {
            const isOpen = open.has(s.key);
            return (
              <React.Fragment key={s.key}>
                <tr className={`ra-st-row ${isOpen ? "open" : ""}`} onClick={() => toggle(s.key)}>
                  <td>
                    <button
                      type="button"
                      className="ra-exp"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${s.name}`}
                      onClick={(e) => { e.stopPropagation(); toggle(s.key); }}
                    >
                      <ChevronDown size={15} />
                    </button>
                  </td>
                  <td><span className="ra-st-name">{s.name}</span></td>
                  <td className="r">{fmtInt(s.inspected)}</td>
                  <td className="r" style={{ color: OUTCOME_COLOR.ok, fontWeight: 600 }}>{fmtInt(s.ok)}</td>
                  <td className="r" style={{ color: s.ng ? OUTCOME_COLOR.ng : SLATE[400], fontWeight: 700 }}>{fmtInt(s.ng)}</td>
                  <td className="r strong">{fmtPct(s.ngPct, 2)}</td>
                  <td>
                    {s.ng > 0 ? (
                      <div className="mg-fn-mini" style={{ maxWidth: "none", height: 8 }} title={CAT_SERIES.filter((c) => s.cats[c]).map((c) => `${catName(c)} ${s.cats[c]}`).join(" · ")}>
                        {CAT_SERIES.map((c) => (s.cats[c] ? <span key={c} style={{ flex: s.cats[c], background: CATEGORY_COLOR[c] }} /> : null))}
                      </div>
                    ) : <span style={{ color: SLATE[400] }}>—</span>}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="ra-st-detail">
                    <td colSpan={7}>
                      <StationDetail
                        station={s}
                        enriched={enriched}
                        rowsLoading={rowsLoading}
                        onPictorial={() => onPictorial(s.key)}
                        recsOpen={recsOpen === s.key}
                        onRecs={() => setRecsOpen((k) => (k === s.key ? null : s.key))}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StationDetail({ station, enriched, rowsLoading, onPictorial, recsOpen, onRecs }) {
  const recs = useMemo(() => (enriched ? stationRecords(enriched, station) : null), [enriched, station]);
  const reasons = useMemo(() => (recs ? reasonCounts(recs) : null), [recs]);
  if (station.ng === 0) return <div className="ra-st-none">No rejections at {station.label} in this period.</div>;
  if (rowsLoading && !recs) return <SkeletonBlock lines={4} height={140} />;
  const catTotal = CAT_SERIES.reduce((a, c) => a + (station.cats[c] || 0), 0) || 1;
  return (
    <div className="ra-st-exp">
      <ReasonList title={`Reasons at ${station.label}`} data={reasons} showCats={false} limit={10} />
      <div>
        <div className="ra-mini-title">Category split</div>
        <ul className="ra-catsplit">
          {CAT_SERIES.filter((c) => station.cats[c] > 0).map((c) => (
            <li key={c} title={CATEGORY_NAME[c]}>
              <span><i style={{ background: CATEGORY_COLOR[c] }} />{catName(c)}</span>
              <span className="ra-catsplit-bar"><i style={{ width: `${(station.cats[c] / catTotal) * 100}%`, background: CATEGORY_COLOR[c] }} /></span>
              <b className="mg-num">{fmtInt(station.cats[c])}</b>
              <span className="mg-num" style={{ color: SLATE[500] }}>{fmtPct((station.cats[c] / catTotal) * 100, 0)}</span>
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button type="button" className="mg-link" onClick={onPictorial}><ImageIcon size={14} /> Pictorial view</button>
          <button type="button" className="mg-link" onClick={onRecs} aria-expanded={recsOpen}><List size={14} /> {recsOpen ? "Hide records" : `NG records (${fmtInt(recs?.length)})`}</button>
        </div>
      </div>
      {recsOpen && recs && (
        <div style={{ gridColumn: "1 / -1" }}>
          <RecordsTable enriched={recs} pageSize={10} hideStation />
        </div>
      )}
    </div>
  );
}

/* ═══ Rejections per day: CR · MR · CRAM (month → day; click a day → its reasons) ═══ */
const BAR_CATS = ["CR", "MR", "CRAM"];

function CategoryTrend({ filters, singleDay, enriched, rowsLoading, trendData, trendLoading, shot }) {
  const days = dayCount(filters.dateFrom, filters.dateTo);
  const startMonth = days > 31;
  const [month, setMonth] = useState(null);
  const [day, setDay] = useState(singleDay ? filters.dateFrom : null);
  const level = startMonth && !month ? "month" : "day";

  const cd = useMemo(
    () => (enriched ? buildCategoryDays({ enriched, ngParts: trendData?.ngParts, shot, from: filters.dateFrom, to: filters.dateTo }) : null),
    [enriched, trendData, shot, filters.dateFrom, filters.dateTo],
  );
  const view = useMemo(() => {
    if (!cd) return null;
    if (level === "month") { const m = buildCategoryMonths(cd); return { ...m, labels: m.keys.map(monthLabel) }; }
    const idx = cd.keys.map((k, i) => (!month || String(k).startsWith(month) ? i : -1)).filter((i) => i >= 0);
    return { keys: idx.map((i) => cd.keys[i]), buckets: idx.map((i) => cd.buckets[i]), labels: idx.map((i) => dayLabel(cd.keys[i])) };
  }, [cd, level, month]);

  const hasOther = !!view?.buckets.some((b) => b.OTHER > 0);
  const bars = useMemo(() => {
    if (!view) return [];
    const cats = hasOther ? [...BAR_CATS, "OTHER"] : BAR_CATS;
    return cats.map((c) => ({
      name: c === "OTHER" ? "Not classified" : `${c} · ${CATEGORY_NAME[c]}`, color: CATEGORY_COLOR[c], stack: false,
      data: view.buckets.map((b) => b[c]), label: view.buckets.length <= 16, labelColor: CATEGORY_COLOR[c],
    }));
  }, [view, hasOther]);
  const tooltipRows = useCallback((i) => {
    const b = view?.buckets?.[i];
    if (!b) return [];
    const rows = [{ label: "Total rejections", value: fmtInt(b.total) }];
    if (b.ngShots) rows.push({ label: "of which NG shots (in CR)", value: fmtInt(b.ngShots), bold: false });
    if (level === "month") rows.push({ label: "Days with rejections", value: fmtInt(b.days), bold: false });
    return rows;
  }, [view, level]);

  const onSelect = useCallback((key) => {
    if (level === "month") { setMonth(key); setDay(null); return; }
    setDay((d) => (d === key ? null : key));
  }, [level]);

  const dayList = useMemo(() => {
    if (!day || !cd || !enriched) return null;
    const recs = enriched.filter((_, i) => cd.dayOf[i] === day);
    const ngs = (shot?.byDay || []).filter((x) => x.day === day).reduce((a, x) => a + (Number(x.ng) || 0), 0);
    return reasonCounts(recs, { ngShots: ngs });
  }, [day, cd, enriched, shot]);

  const listRef = useRef(null);
  useEffect(() => {
    if (day && listRef.current && window.innerWidth < 1100) listRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [day]);

  const loading = (rowsLoading && !enriched) || (trendLoading && !trendData);
  return (
    <SectionCard
      id="ra-trend"
      kicker="When"
      title={level === "month" ? "Rejections by month — CR · MR · CRAM" : month ? `Rejections by day — ${monthLabel(month)}` : "Rejections by day — CR · MR · CRAM"}
      subtitle={level === "month"
        ? "Three bars per month, one per defect category. Click a month to open its days."
        : "Three bars per day, one per defect category. Click a day to list all its reasons with count and share."}
      info={{
        what: "Rejections per production day (06:00 → 06:00) split by defect category: station rejections by the day the daily trend gives the part, plus the NG shots of the die-casting machine, which count as CR.",
        formula: ["Day total = CR + MR + CRAM (+ not classified)", "Reason % = reason count ÷ day total"],
      }}
      actions={<ZoomHint />}
    >
      {level === "day" && startMonth && (
        <nav className="mg-crumbs" aria-label="Month drill-down">
          <button type="button" className="mg-back" onClick={() => { setMonth(null); setDay(null); }}><ArrowLeft size={14} />Back</button>
          <button type="button" onClick={() => { setMonth(null); setDay(null); }}>All months</button>
          <ChevronRight size={14} aria-hidden="true" />
          <b aria-current="page">{monthLabel(month)}</b>
        </nav>
      )}
      {loading ? <SkeletonBlock lines={6} height={340} />
        : !view?.keys.length ? <EmptyState title="No rejections in this period" />
          : (
            <div className={`ra-trend-wrap ${dayList ? "with-list" : ""}`}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
                  <div className="mg-legend">
                    {bars.map((b) => <span key={b.name}><i style={{ background: b.color }} />{b.name.split(" · ")[0]}</span>)}
                    <span style={{ color: SLATE[500] }}>CR includes NG shots</span>
                  </div>
                  <span className="mg-hint"><MousePointerClick size={13} aria-hidden="true" />{level === "month" ? "Click a month" : "Click a day"}</span>
                </div>
                <ZoomBarChart
                  labels={view.labels}
                  keys={view.keys}
                  bars={bars}
                  onSelect={onSelect}
                  selectHint={level === "month" ? "Click to open the days of this month." : "Click to list this day's reasons."}
                  tooltipRows={tooltipRows}
                  height={360}
                  valueAxisName="Rejections"
                  barMaxWidth={16}
                  sliderFrom={10}
                />
              </div>
              {dayList && (
                <div ref={listRef} style={{ minWidth: 0 }}>
                  <ReasonList
                    title={longDayLabel(day)}
                    sub="All reasons of the day, biggest first"
                    data={dayList}
                    onClose={singleDay ? undefined : () => setDay(null)}
                  />
                </div>
              )}
            </div>
          )}
    </SectionCard>
  );
}

/* ═══ Shift and category pies with side lists ═══ */
function PieWithList({ title, items, centerLabel, selected, onSelect, list, listTitle, allTitle, allList }) {
  return (
    <div className="ra-pie">
      <div style={{ minWidth: 0 }}>
        <div className="ra-mini-title">{title}</div>
        <DonutChart items={items} centerLabel={centerLabel} height={200} onSelect={onSelect} selected={selected} />
      </div>
      <div style={{ minWidth: 0 }}>
        {selected != null && list
          ? <ReasonList title={listTitle} sub="Reasons, biggest first" data={list} limit={10} onClose={() => onSelect(null)} />
          : <ReasonList title={allTitle} sub="Click a slice for its own reasons" data={allList} limit={8} showCats={false} />}
      </div>
    </div>
  );
}

function MixSection({ enriched, rowsLoading, shot, ngShots }) {
  const [shiftSel, setShiftSel] = useState(null);
  const [catSel, setCatSel] = useState(null);

  const shiftItems = useMemo(() => {
    if (!enriched) return null;
    const sh = buildShiftSplit({ enriched, shot });
    return ["A", "B", "C", "—"].map((l) => ({ key: l, label: l === "—" ? "Shift not recorded" : `Shift ${l}`, value: sh[l], color: SHIFT_COLOR[l] }));
  }, [enriched, shot]);
  const catItems = useMemo(() => {
    if (!enriched) return null;
    const c = { CR: ngShots || 0, CRAM: 0, MR: 0, OTHER: 0 };
    enriched.forEach((r) => { c[r._cat] += 1; });
    return CAT_SERIES.map((k) => ({
      key: k, label: k === "OTHER" ? "Not classified" : `${k} · ${CATEGORY_NAME[k]}`, value: c[k], color: CATEGORY_COLOR[k],
      note: k === "CR" && ngShots ? `Includes ${fmtInt(ngShots)} NG shots.` : undefined,
    }));
  }, [enriched, ngShots]);
  const allList = useMemo(() => (enriched ? reasonCounts(enriched, { ngShots }) : null), [enriched, ngShots]);

  const shiftList = useMemo(() => {
    if (!enriched || shiftSel == null) return null;
    const recs = enriched.filter((r) => (shiftLetter(r.shiftCode || r.shift_code) || "—") === shiftSel);
    const ngs = (shot?.byShift || []).filter((s) => shiftLetter(s.shift) === shiftSel).reduce((a, s) => a + (Number(s.ng) || 0), 0);
    return reasonCounts(recs, { ngShots: ngs });
  }, [enriched, shot, shiftSel]);
  const catList = useMemo(() => {
    if (!enriched || catSel == null) return null;
    return reasonCounts(enriched.filter((r) => r._cat === catSel), { ngShots: catSel === "CR" ? ngShots : 0 });
  }, [enriched, catSel, ngShots]);

  const pickShift = useCallback((it) => setShiftSel((s) => (it == null || s === it.key ? null : it.key)), []);
  const pickCat = useCallback((it) => setCatSel((s) => (it == null || s === it.key ? null : it.key)), []);

  return (
    <SectionCard
      id="ra-mix"
      kicker="Which shift · which category"
      title="Rejections by shift and by category"
      subtitle="Click a slice to list its reasons with count and share. NG shots of the die-casting machine count as CR and are in their shift."
      info={{
        what: "Both pies split the same total — all rejections of the period (station NG records + NG shots). Station rejections are placed in the shift recorded on the part; NG shots in the shift of the shot.",
        formula: ["Reason % = reason count ÷ total of the selected slice"],
      }}
    >
      {rowsLoading && !enriched ? <SkeletonBlock lines={6} height={260} />
        : !enriched ? <EmptyState />
          : (
            <div className="ra-pies">
              <PieWithList
                title="By shift"
                items={shiftItems}
                centerLabel="rejections"
                selected={shiftSel}
                onSelect={pickShift}
                list={shiftList}
                listTitle={shiftSel === "—" ? "Shift not recorded" : `Shift ${shiftSel}`}
                allTitle="All shifts — top reasons"
                allList={allList}
              />
              <PieWithList
                title="By category"
                items={catItems}
                centerLabel="rejections"
                selected={catSel}
                onSelect={pickCat}
                list={catList}
                listTitle={catSel ? `${catName(catSel)}${catSel !== "OTHER" ? ` · ${CATEGORY_NAME[catSel]}` : ""}` : ""}
                allTitle="All categories — top reasons"
                allList={allList}
              />
            </div>
          )}
    </SectionCard>
  );
}

/** Tab 1 — Overview. */
export default function OverviewTab({
  filters, singleDay, gates, pareto, enriched, rowsLoading, summaryLoading, trendData, trendLoading, shot, k,
  config, configLoading, dieStats, shiftScrap, shiftLoading, shotLoading, ensure,
}) {
  useEffect(() => { ensure("rows"); }, [ensure]);
  const drill = pareto?.qualityGateDrillDown || null;
  const stations = useMemo(() => buildStationBars({ gates, drill, enriched }), [gates, drill, enriched]);
  const [picked, setPicked] = useState(null);
  const station = picked ? stations.find((s) => s.key === picked) : null;
  useEffect(() => { if (picked) ensure("config"); }, [picked, ensure]);

  const pickGauge = useCallback((key) => setPicked((p) => (p === key ? null : key)), []);
  const openPictorial = useCallback((key) => {
    setPicked(key);
    requestAnimationFrame(() => document.getElementById("ra-gates")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  const ensureShift = useCallback(() => ensure("shift"), [ensure]);
  const worst = useMemo(() => stations.filter((s) => s.ng > 0).sort((a, b) => b.ng - a.ng)[0], [stations]);

  return (
    <>
      <SectionCard
        id="ra-gates"
        kicker="Where · stations"
        title="Stations — NG % and FPY"
        subtitle={worst
          ? `One gauge per station in process order (leak-test machines separately). Most rejections: ${worst.name} (${fmtInt(worst.ng)} NG, ${fmtPct(worst.ngPct, 2)}). Click a gauge for its pictorial view.`
          : "One gauge per station in process order (leak-test machines separately). Click a gauge for its pictorial view."}
        info={{
          what: "Each station counted by its own scan time in the period. The leak test (OP150) runs on three machines, shown separately (LT-1, LT-2, LT-3). Expand a row of the table for that station's reasons.",
          formula: ["NG % = station NG ÷ (station OK + station NG)", "Station FPY = station OK ÷ (station OK + station NG)"],
        }}
      >
        {summaryLoading && !stations.length ? <SkeletonBlock lines={7} height={300} />
          : !stations.length ? <EmptyState title="No station data in this period" />
            : (
              <>
                <StationCarousel stations={stations} selected={picked} onPick={pickGauge} />
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
                <div className="ra-mini-title" style={{ marginTop: 18 }}>All stations · expand a row for its reasons</div>
                <StationTable stations={stations} enriched={enriched} rowsLoading={rowsLoading} onPictorial={openPictorial} />
              </>
            )}
      </SectionCard>

      <CategoryTrend
        key={`${filters.dateFrom}|${filters.dateTo}|${filters.shiftCode}`}
        filters={filters}
        singleDay={singleDay}
        enriched={enriched}
        rowsLoading={rowsLoading}
        trendData={trendData}
        trendLoading={trendLoading}
        shot={shot}
      />

      <MixSection enriched={enriched} rowsLoading={rowsLoading} shot={shot} ngShots={k.ngShots || 0} />

      <DieShiftSection
        shot={shot}
        dieStats={dieStats}
        shiftScrap={shiftScrap}
        shiftLoading={shiftLoading}
        summaryLoading={summaryLoading || shotLoading}
        onVisible={ensureShift}
      />
    </>
  );
}
