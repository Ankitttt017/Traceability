import React, { useCallback, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, MousePointerClick, X, ZoomIn } from "lucide-react";
import SectionCard from "../../../../components/mgmt/SectionCard";
import ComboChart from "../../../../components/mgmt/ComboChart";
import ZoomBarChart from "../../../../components/mgmt/ZoomBarChart";
import ParetoChart from "../../../../components/mgmt/ParetoChart";
import { SkeletonBlock } from "../../../../components/mgmt/Skeleton";
import EmptyState from "../../../../components/mgmt/EmptyState";
import { movingAverage, ratePct } from "../../../../components/mgmt/trendMath";
import {
  CATEGORY_COLOR, CATEGORY_NAME, NAVY, NAVY_3, OUTCOME_COLOR, SLATE, TARGETS, WARMUP_COLOR, fmtInt, fmtPct, pctOf,
} from "../../../../components/mgmt/mgmtTheme";
import { dayLabel } from "../derive";
import { longDayLabel, monthLabel, reasonCounts } from "../deriveTabs";
import { DAY_START_HOUR, dayCount, includesNow, localISODate, productionToday } from "../periods";
import BreakdownDrawer, { DRAWER_CSS } from "./BreakdownDrawer";

/* ═══════════════════════════════════════════════════════════════════════════
   Trend analytics of the Overview (combo charts: bars = counts, lines = % on the right axis, 7-day moving average,
   2 % target line, data labels, zoom):
     ProductionTrendCard   tracked parts and OK per day / month + rejection % (CR / MR / CRAM % toggles)
     StationBarsCard       OK · NG · in progress per station + NG % (drill: station → category → reasons)
     CategoryTrendCard     rejections per day / month stacked CR · MR · CRAM + NG % + moving average
   NG = station rejections by the decisive NG scan (the page's single NG source); OK / tracked from rejection-daily.
   ═══════════════════════════════════════════════════════════════════════════ */
export const TREND_CSS = `
${DRAWER_CSS}
.ra-trend-tools{display:flex;justify-content:space-between;align-items:center;gap:8px 14px;flex-wrap:wrap;margin-bottom:4px}
.ra-trend-detail{margin-top:12px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;background:#fbfcfe}
.ra-trend-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:14px;align-items:start}
@media (max-width:760px){.ra-trend-detail-grid{grid-template-columns:1fr}}
.ra-trend-kpis{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12px;color:#475569;margin:0 0 6px}
.ra-trend-kpis b{color:#0f172a;font-variant-numeric:tabular-nums}
`;

const CATS = ["CR", "MR", "CRAM"];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const catShort = (c) => (c === "OTHER" ? "Not classified" : c);
const catLong = (c) => (c === "OTHER" ? "Not classified" : `${c} · ${CATEGORY_NAME[c]}`);
const hourOf = (t) => { const d = t ? new Date(t) : null; return d && !Number.isNaN(d.getTime()) ? d.getHours() : null; };
const hh = (h) => `${String(h).padStart(2, "0")}:00`;
const ZoomHint = () => <span className="mg-hint"><ZoomIn size={13} aria-hidden="true" />Wheel = zoom · drag = move</span>;

/**
 * Buckets per production day (or per hour for a single day, or per month): tracked, OK (rejection-daily), NG and
 * NG by category (decisive NG records). → { keys, labels, buckets: [{ key, produced, ok, ng, CR, MR, CRAM, OTHER, recs }] }
 */
function useBuckets({ trendData, enriched, singleDay, level, month = null }) {
  return useMemo(() => {
    const m = new Map();
    const get = (k) => { if (!m.has(k)) m.set(k, { key: k, produced: 0, ok: 0, ngParts: 0, wip: 0, ng: 0, CR: 0, MR: 0, CRAM: 0, OTHER: 0, recs: [] }); return m.get(k); };
    const keyOfDay = (d) => (level === "month" ? String(d).slice(0, 7) : d);
    (trendData?.days || []).forEach((r) => {
      if (month && !String(r.day || "").startsWith(month)) return;
      const k = singleDay ? (r.hour == null ? null : Number(r.hour)) : r.day ? keyOfDay(r.day) : null;
      if (k == null) return;
      const b = get(k);
      b.produced += num(r.produced); b.ok += num(r.ok); b.ngParts += num(r.ng); b.wip += num(r.wip);
    });
    (enriched || []).forEach((r) => {
      if (month && !String(r._day || "").startsWith(month)) return;
      const k = singleDay ? hourOf(r.ngRecordedAt || r.createdAt) : r._day ? keyOfDay(r._day) : null;
      if (k == null) return;
      const b = get(k);
      b.ng += 1; b[r._cat] += 1; b.recs.push(r);
    });
    let keys = [...m.keys()];
    if (singleDay) keys.sort((a, b) => ((a - DAY_START_HOUR + 24) % 24) - ((b - DAY_START_HOUR + 24) % 24));
    else keys.sort();
    const labels = keys.map((k) => (singleDay ? hh(k) : level === "month" ? monthLabel(k) : dayLabel(k)));
    return { keys, labels, buckets: keys.map((k) => m.get(k)) };
  }, [trendData, enriched, singleDay, level, month]);
}

/** Index of the bucket that is still running (today / this month / the current hour), or null. */
const partialIndex = (keys, filters, singleDay, level) => {
  if (!includesNow(filters.dateTo) || !keys.length) return null;
  const today = localISODate(productionToday());
  const cur = singleDay ? new Date().getHours() : level === "month" ? today.slice(0, 7) : today;
  const i = keys.indexOf(cur);
  return i >= 0 ? i : null;
};
/** Moving average that leaves the running bucket out. */
const maExcluding = (vals, partial, n = 7) => movingAverage(vals.map((v, i) => (i === partial ? null : v)), n).map((v, i) => (i === partial ? null : v));

const levelFor = (filters, singleDay, pick) => (singleDay ? "hour" : pick || (dayCount(filters.dateFrom, filters.dateTo) > 31 ? "month" : "day"));

function LevelSwitch({ filters, singleDay, level, onChange, month, onBack }) {
  if (singleDay || dayCount(filters.dateFrom, filters.dateTo) <= 31) return null;
  if (month) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <button type="button" className="mg-back" onClick={onBack}><ArrowLeft size={14} />Months</button>
        <b style={{ fontSize: 13, color: "#0f172a" }}>{monthLabel(month)} · per day</b>
      </span>
    );
  }
  return (
    <div className="ra-seg ra-seg-sm" role="group" aria-label="Group by">
      {["month", "day"].map((l) => <button key={l} type="button" aria-pressed={level === l} className={level === l ? "on" : ""} onClick={() => onChange(l)}>{l === "day" ? "Per day" : "Per month"}</button>)}
    </div>
  );
}

/* ═══ Production & rejection trend ═══ */
export function ProductionTrendCard({ filters, singleDay, trendData, trendLoading, enriched, rowsLoading }) {
  const [pick, setPick] = useState(null);
  const [month, setMonth] = useState(null);
  const [show, setShow] = useState({ CR: false, MR: false, CRAM: false });
  const level = month ? "day" : levelFor(filters, singleDay, pick);
  const { keys, labels, buckets } = useBuckets({ trendData, enriched, singleDay, level, month });
  // rejection % = NG parts ÷ (OK + NG parts) — the Dashboard / Historical figures of the day
  const rate = useMemo(() => ratePct(buckets.map((b) => b.ngParts), buckets.map((b) => b.ok)), [buckets]);
  const partial = partialIndex(keys, filters, singleDay, level);
  const [sel, setSel] = useState(null);
  const onSelect = useCallback((key) => {
    if (level === "month") { setMonth(key); setSel(null); return; } // a month opens its days
    setSel((k) => (k === key ? null : key));
  }, [level]);
  const bars = useMemo(() => [
    { key: "produced", name: "Tracked parts", color: "#a3bad5", data: buckets.map((b) => b.produced), labelColor: SLATE[600] },
    { key: "ok", name: "OK (passed final)", color: OUTCOME_COLOR.ok, data: buckets.map((b) => b.ok), labelColor: "#15803d" },
  ], [buckets]);
  const lines = useMemo(() => [
    { key: "rate", name: "Rejection %", color: OUTCOME_COLOR.ng, data: rate, label: buckets.length <= 31, status: true },
    ...(level === "day" && buckets.length >= 7 ? [{ key: "ma", name: "7-day average", color: NAVY, data: maExcluding(rate, partial), dashed: true }] : []),
    ...CATS.filter((c) => show[c]).map((c) => ({ key: c, name: `${c} %`, color: CATEGORY_COLOR[c], data: buckets.map((b) => (b.ok + b.ngParts > 0 ? Number(((b[c] / (b.ok + b.ngParts)) * 100).toFixed(2)) : null)), smooth: false })),
  ], [rate, buckets, level, show, partial]);
  const tot = buckets.reduce((a, b) => ({ produced: a.produced + b.produced, ok: a.ok + b.ok, ng: a.ng + b.ngParts, wip: a.wip + b.wip }), { produced: 0, ok: 0, ng: 0, wip: 0 });
  const loading = (trendLoading && !trendData) || (rowsLoading && !enriched);
  const selB = sel != null ? buckets[keys.indexOf(sel)] : null;
  const titleOf = (k) => (singleDay ? hh(k) : level === "month" ? monthLabel(k) : longDayLabel(k));

  return (
    <SectionCard
      id="ra-prod-trend"
      title={`Production & rejection trend — per ${level}`}
      subtitle="Bars: tracked parts and parts that passed final inspection. Line: rejection % with the 7-day moving average and the 2 % target (values off the scale are drawn as ▲ with their real value). Click a day for its break-up."
      info={{
        what: "Tracked = parts first scanned in the day / month; OK = of those, passed every station. Rejections = station rejections of the day / month by the decisive NG scan (as the Historical page).",
        formula: ["Rejection % = NG ÷ (OK + NG) of the day — the Dashboard / Historical figures (OK = passed final, NG = rejected parts)", "Category % = category rejections ÷ (OK + NG)", "7-day average = mean of the last 7 finished days (the running day is left out)"],
        note: "The running day / month is drawn hollow and marked partial: most of its parts are still on the line, so its % is not final.",
      }}
      actions={<ZoomHint />}
    >
      {loading ? <SkeletonBlock lines={6} height={340} /> : !keys.length ? <EmptyState title="No production in this period" /> : (
        <>
          <div className="ra-trend-tools">
            <div className="ra-trend-kpis">
              <span>Tracked <b>{fmtInt(tot.produced)}</b></span>
              <span>OK <b style={{ color: OUTCOME_COLOR.ok }}>{fmtInt(tot.ok)}</b></span>
              <span>NG <b style={{ color: OUTCOME_COLOR.ng }}>{fmtInt(tot.ng)}</b></span>
              <span>In progress <b>{fmtInt(tot.wip)}</b></span>
              <span>Rejection % <b>{fmtPct(pctOf(tot.ng, tot.ok + tot.ng), 2)}</b></span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div className="ra-seg ra-seg-sm" role="group" aria-label="Category lines">
                {CATS.map((c) => (
                  <button key={c} type="button" aria-pressed={show[c]} className={show[c] ? "on" : ""} onClick={() => setShow((s) => ({ ...s, [c]: !s[c] }))} title={`Show the ${CATEGORY_NAME[c]} % line`}>
                    <span className="ra-dot" style={{ background: CATEGORY_COLOR[c] }} />{c} %
                  </button>
                ))}
              </div>
              <LevelSwitch filters={filters} singleDay={singleDay} level={level} onChange={(l) => { setPick(l); setSel(null); }} month={month} onBack={() => { setMonth(null); setSel(null); }} />
            </div>
          </div>
          <div className="ra-drawer-host">
            <ComboChart labels={labels} keys={keys} bars={bars} lines={lines} target={TARGETS.scrapPct} band={TARGETS.amberBandPp} leftName="Parts" rightName="Rejection %" height={380} barMaxWidth={22} partial={partial} onSelect={onSelect} selectHint={level === "month" ? "Click to open the days of this month." : "Click for the CR / MR / CRAM break-up."} />
            {selB && (
              <BreakdownDrawer
                title={titleOf(sel)}
                sub={keys.indexOf(sel) === partial ? "Still running — figures are partial" : "Production day 06:00 → 06:00"}
                stats={[
                  { label: "OK", value: fmtInt(selB.ok), color: OUTCOME_COLOR.ok },
                  { label: "NG", value: fmtInt(selB.ngParts), color: OUTCOME_COLOR.ng },
                  { label: "Rejection %", value: fmtPct(pctOf(selB.ngParts, selB.ok + selB.ngParts), 2) },
                ]}
                recs={selB.recs}
                onClose={() => setSel(null)}
              />
            )}
          </div>
        </>
      )}
    </SectionCard>
  );
}

/* ═══ Quality gates — OK · NG · in progress (+ NG %) → category → reasons ═══ */
export function StationBarsCard({ steps, enriched, rowsLoading, summaryLoading }) {
  const [drill, setDrill] = useState(null); // { step, cat? }
  const stepRecs = useMemo(() => (drill && enriched ? enriched.filter((r) => r._op === drill.step.op) : null), [drill, enriched]);
  const labels = useMemo(() => steps.map((s) => `${s.label}\n${s.short}`), [steps]);
  const bars = useMemo(() => [
    { key: "ok", name: "OK", color: OUTCOME_COLOR.ok, stack: "st", data: steps.map((s) => s.ok), insideMin: 0.06 },
    {
      key: "ng", name: "NG", color: OUTCOME_COLOR.ng, stack: "st", data: steps.map((s) => s.ng), minHeight: 4, insideMin: 0.06,
      topLabel: (i) => (steps[i] ? `{ng|NG ${fmtInt(steps[i].ng)}}` : ""),
    },
  ], [steps]);
  // parts that passed a station and are not yet at the next one, drawn between the two bars
  const flows = useMemo(() => ({ name: "In progress between stations", color: NAVY_3, values: steps.slice(0, -1).map((s) => s.wip), level: 0.5 }), [steps]);
  const lines = useMemo(() => [{ key: "pct", name: "NG %", color: NAVY_3, data: steps.map((s) => (s.inspected ? s.ngPct : null)), label: true, status: true, markersOnly: true }], [steps]);
  const onStation = useCallback((key, i) => { const s = steps[i]; if (s) setDrill({ step: s }); }, [steps]);
  const tipRows = useCallback((i) => (steps[i]?.machines ? [{ label: "Leak machines", value: steps[i].machines.join(" · "), bold: false }] : []), [steps]);

  const cats = useMemo(() => {
    if (!stepRecs) return null;
    const c = { CR: 0, MR: 0, CRAM: 0, OTHER: 0 };
    stepRecs.forEach((r) => { c[r._cat] += 1; });
    return { list: [...CATS, "OTHER"].filter((x) => c[x] > 0 || x !== "OTHER").map((x) => ({ key: x, value: c[x] })), total: stepRecs.length };
  }, [stepRecs]);
  const catBars = useMemo(() => (cats ? [{
    key: "cat", name: "Rejections", color: NAVY, stack: false, data: cats.list.map((x) => x.value), colors: cats.list.map((x) => CATEGORY_COLOR[x.key]),
    label: true, labelFormatter: (i) => (cats.list[i].value > 0 ? `${fmtInt(cats.list[i].value)} · ${fmtPct(pctOf(cats.list[i].value, cats.total), 1)}` : ""),
  }] : []), [cats]);
  const reasons = useMemo(() => (drill?.cat && stepRecs ? reasonCounts(stepRecs.filter((r) => r._cat === drill.cat)) : null), [drill, stepRecs]);
  const reasonItems = useMemo(() => (reasons ? (reasons.list || []).slice(0, 14).map((x) => ({ key: x.reason, label: x.reason, value: x.count, color: CATEGORY_COLOR[x.cat] || CATEGORY_COLOR.OTHER, group: catShort(x.cat) })) : []), [reasons]);

  return (
    <SectionCard
      id="ra-station-output"
      title="Quality gates — OK · NG · in progress"
      subtitle="OK + NG per station, NG % against the 2 % target, and the parts in progress waiting between stations. Click a station for its NG by CR / MR / CRAM, then a category for its reasons."
      info={{
        what: "OK by each station's own scan time in the period; NG = station rejections by the decisive NG scan; grey = parts that passed the station and are not yet at the next one.",
        formula: ["Bar = OK + NG of the station (NG count on top)", "Circle between two bars = parts that passed the left station and are not yet at the right one (in progress)", "NG % (diamond, right axis) = NG ÷ (OK + NG) of the station", "In progress after a station = station OK − next station inspected (≥ 0)"],
      }}
      actions={<span className="mg-hint"><MousePointerClick size={13} aria-hidden="true" />Click a station</span>}
    >
      {drill && (
        <nav className="mg-crumbs" aria-label="Station drill-down">
          <button type="button" className="mg-back" onClick={() => setDrill((d) => (d?.cat ? { step: d.step } : null))}><ArrowLeft size={14} />Back</button>
          <button type="button" onClick={() => setDrill(null)}>All stations</button>
          <ChevronRight size={14} aria-hidden="true" />
          {drill.cat ? <button type="button" onClick={() => setDrill({ step: drill.step })}>{drill.step.label} NG</button> : <b aria-current="page">{drill.step.label} NG</b>}
          {drill.cat && <><ChevronRight size={14} aria-hidden="true" /><b aria-current="page">{catShort(drill.cat)}</b></>}
        </nav>
      )}
      {!drill && (summaryLoading && !steps.length ? <SkeletonBlock lines={5} height={300} />
        : !steps.length ? <EmptyState title="No station data in this period" />
          : <ComboChart labels={labels} keys={steps.map((s) => s.key)} bars={bars} lines={lines} target={TARGETS.scrapPct} band={TARGETS.amberBandPp} leftName="Parts" rightName="NG %" height={380} barMaxWidth={30} zoom={false} rotate={0} flows={flows} onSelect={onStation} selectHint="Click to split this station's NG by CR / MR / CRAM." tooltipRows={tipRows} />)}
      {drill && !drill.cat && (rowsLoading && !enriched ? <SkeletonBlock lines={4} height={260} /> : !cats?.total ? (
        <EmptyState title={`No rejections at ${drill.step.label} in this period`} hint={drill.step.op === "OP100" ? "NG shots of the die-casting machine are on the OP100 gauge above." : undefined} />
      ) : (
        <>
          <p className="ra-drill-sub">{drill.step.name}: <b>{fmtInt(cats.total)}</b> rejections · click a category for its reasons</p>
          <ZoomBarChart labels={cats.list.map((x) => catShort(x.key))} keys={cats.list.map((x) => x.key)} bars={catBars} onSelect={(k) => setDrill((d) => (d ? { ...d, cat: k } : d))}
            selectHint="Click for the reasons of this category." height={300} valueAxisName="Rejections" barMaxWidth={70} zoom={false}
            tooltipRows={(i) => [{ label: "Share", value: fmtPct(pctOf(cats.list[i]?.value, cats.total), 1) }, { label: catLong(cats.list[i]?.key), value: "", bold: false }]} />
        </>
      ))}
      {drill?.cat && (!reasons?.total ? <EmptyState title="No reasons recorded" /> : (
        <>
          <p className="ra-drill-sub">{drill.step.name} · <b style={{ color: CATEGORY_COLOR[drill.cat] }}>{catLong(drill.cat)}</b>: <b>{fmtInt(reasons.total)}</b> rejections — count · share</p>
          <ParetoChart items={reasonItems} total={reasons.total} showPct valueName="Rejections" labelWidth={120} />
        </>
      ))}
    </SectionCard>
  );
}

/* ═══ Rejections per day / month — CR · MR · CRAM + NG % + moving average ═══ */
export function CategoryTrendCard({ filters, singleDay, trendData, trendLoading, enriched, rowsLoading, shot }) {
  const [pick, setPick] = useState(null);
  const [month, setMonth] = useState(null);
  const [sel, setSel] = useState(null); // { key, cat }
  const level = month ? "day" : levelFor(filters, singleDay, pick);
  const { keys, labels, buckets } = useBuckets({ trendData, enriched, singleDay, level, month });
  const hasOther = buckets.some((b) => b.OTHER > 0);
  const bars = useMemo(() => [...CATS, ...(hasOther ? ["OTHER"] : [])].map((c) => ({
    key: c, name: catShort(c), color: CATEGORY_COLOR[c], stack: "rej", data: buckets.map((b) => b[c]),
  })), [buckets, hasOther]);
  const rate = useMemo(() => ratePct(buckets.map((b) => b.ngParts), buckets.map((b) => b.ok)), [buckets]);
  const partial = partialIndex(keys, filters, singleDay, level);
  const lines = useMemo(() => [
    { key: "rate", name: "NG %", color: OUTCOME_COLOR.ng, data: rate, label: buckets.length <= 31, status: true, smooth: false },
    ...(level === "day" && buckets.length >= 7 ? [{ key: "ma", name: "7-day average", color: NAVY, data: maExcluding(rate, partial), dashed: true }] : []),
  ], [rate, level, buckets.length, partial]);
  const onSelect = useCallback((key, i, barKey) => {
    if (level === "month") { setMonth(key); setSel(null); return; } // a month opens its days
    setSel((s) => (s && s.key === key && s.cat === (barKey || null) ? null : { key, cat: barKey || null }));
  }, [level]);
  const selB = sel ? buckets[keys.indexOf(sel.key)] : null;
  const shotOf = (k) => (level === "day" ? (shot?.byDay || []).filter((x) => x.day === k) : []);
  const loading = (rowsLoading && !enriched) || (trendLoading && !trendData);
  const titleOf = (k) => (singleDay ? hh(k) : level === "month" ? monthLabel(k) : longDayLabel(k));

  return (
    <SectionCard
      id="ra-trend"
      title={`Rejections per ${level} — CR · MR · CRAM`}
      subtitle={`Stacked by category with the total on top; NG % line on the right axis${level === "day" ? " with the 7-day average" : ""} and the 2 % target. Click a bar for its reasons.`}
      info={{
        what: "Station rejections (decisive NG scan per part per station, as the Historical page) on the production day / hour / month of the NG scan, by category. DCM NG shots are shown in the details, not in the bars.",
        formula: ["Bars = station rejections (decisive scan) by category", "NG % = NG parts ÷ (OK + NG parts) — the Dashboard / Historical figures", "7-day average = mean of the last 7 finished days"],
      }}
      actions={<ZoomHint />}
    >
      {loading ? <SkeletonBlock lines={6} height={340} /> : !keys.length ? <EmptyState title="No rejections in this period" /> : (
        <>
          <div className="ra-trend-tools">
            <span className="mg-hint"><MousePointerClick size={13} aria-hidden="true" />Click a bar for the reasons</span>
            <LevelSwitch filters={filters} singleDay={singleDay} level={level} onChange={(l) => { setPick(l); setSel(null); }} month={month} onBack={() => { setMonth(null); setSel(null); }} />
          </div>
          <div className="ra-drawer-host">
          <ComboChart labels={labels} keys={keys} bars={bars} lines={lines} target={TARGETS.scrapPct} band={TARGETS.amberBandPp} leftName="Rejections" rightName="NG %" height={380} barMaxWidth={22} onSelect={onSelect} selectHint={level === "month" ? "Click to open the days of this month." : "Click for the reasons."} partial={partial} />
          {selB && (
            <BreakdownDrawer
              title={`${titleOf(sel.key)}${sel.cat ? ` · ${catShort(sel.cat)}` : ""}`}
              sub={keys.indexOf(sel.key) === partial ? "Still running — figures are partial" : `${fmtInt(selB.ng)} station rejections`}
              stats={[
                { label: "OK", value: fmtInt(selB.ok), color: OUTCOME_COLOR.ok },
                { label: "NG parts", value: fmtInt(selB.ngParts), color: OUTCOME_COLOR.ng },
                { label: "NG %", value: fmtPct(pctOf(selB.ngParts, selB.ok + selB.ngParts), 2) },
              ]}
              recs={sel.cat ? selB.recs.filter((r) => r._cat === sel.cat) : selB.recs}
              onClose={() => setSel(null)}
              extra={shotOf(sel.key).length ? (
                <div style={{ fontSize: 12, color: SLATE[500] }}>
                  <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: WARMUP_COLOR, marginRight: 6 }} />
                  DCM shots: NG {fmtInt(shotOf(sel.key).reduce((x, y) => x + num(y.ng), 0))} · warm-up {fmtInt(shotOf(sel.key).reduce((x, y) => x + num(y.warmUp), 0))} (not in the station rejections)
                </div>
              ) : null}
            />
          )}
          </div>
        </>
      )}
    </SectionCard>
  );
}
