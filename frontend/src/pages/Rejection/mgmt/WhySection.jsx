import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MousePointerClick, X } from "lucide-react";
import SectionCard from "../../../components/mgmt/SectionCard";
import ParetoChart from "../../../components/mgmt/ParetoChart";
import HeatMatrix from "../../../components/mgmt/HeatMatrix";
import { SkeletonBlock } from "../../../components/mgmt/Skeleton";
import EmptyState from "../../../components/mgmt/EmptyState";
import { CATEGORY_COLOR, CATEGORY_NAME, CATEGORY_ORDER, SLATE, fmtInt, fmtPct } from "../../../components/mgmt/mgmtTheme";
import { buildStationMatrix } from "./derive";
import { locateRecords, reasonCounts, zoneCounts } from "./deriveTabs";
import PartMap from "./PartMap";
import ReasonList from "./ReasonList";

const COLS = CATEGORY_ORDER.map((c) => ({ key: c, label: c, color: CATEGORY_COLOR[c], title: CATEGORY_NAME[c] }));
const MODES = [
  { id: "category", label: "Category" },
  { id: "reason", label: "Reason" },
  { id: "zone", label: "Zone" },
];
const TOP = 10;

/** Why: Pareto by category / reason / zone (click a bar → pictorial view) + where each category is caught. */
export default function WhySection({ enriched, ngShots, loading, config, configLoading, onNeedConfig }) {
  const [mode, setMode] = useState("reason");
  const [sel, setSel] = useState(null); // { mode, key }
  const views = useMemo(() => (Array.isArray(config?.views) ? config.views : []), [config]);
  useEffect(() => { if (mode === "zone" || sel) onNeedConfig?.(); }, [mode, sel, onNeedConfig]);

  const located = useMemo(() => (enriched && views.length ? locateRecords(enriched, views) : null), [enriched, views]);

  const pareto = useMemo(() => {
    if (!enriched) return null;
    if (mode === "category") {
      const c = { CR: ngShots || 0, CRAM: 0, MR: 0, OTHER: 0 };
      enriched.forEach((r) => { c[r._cat] += 1; });
      const items = [...CATEGORY_ORDER, "OTHER"].filter((k) => c[k] > 0).sort((a, b) => c[b] - c[a]).map((k) => ({
        key: k, label: k === "OTHER" ? "Not classified" : `${k} · ${CATEGORY_NAME[k]}`, value: c[k], color: CATEGORY_COLOR[k], group: k,
        note: k === "CR" && ngShots ? `Includes ${fmtInt(ngShots)} NG shots (not located on the part).` : undefined,
      }));
      return { items, total: items.reduce((a, x) => a + x.value, 0) };
    }
    if (mode === "reason") {
      const { list, total } = reasonCounts(enriched, { ngShots });
      const head = list.length > TOP + 1 ? list.slice(0, TOP) : list;
      const rest = list.slice(head.length);
      const items = head.map((x) => ({
        key: x.reason, label: x.reason, value: x.count, color: CATEGORY_COLOR[x.cat] || CATEGORY_COLOR.OTHER, group: x.cat === "OTHER" ? "Not classified" : x.cat,
        ngShot: !!x.ngShot, note: Object.keys(x.cats).length > 1 ? `Mixed categories: ${Object.entries(x.cats).map(([c, n]) => `${c} ${n}`).join(", ")}` : undefined,
      }));
      if (rest.length) {
        items.push({
          key: "__rest", label: `Other (${rest.length} reasons)`, value: rest.reduce((a, x) => a + x.count, 0), color: SLATE[400], group: "Mixed",
          reasons: rest.map((x) => x.reason), note: rest.slice(0, 6).map((x) => `${x.reason} ${x.count}`).join(" · "),
        });
      }
      return { items, total };
    }
    if (!located) return null;
    const zones = zoneCounts(located, views);
    const head = zones.slice(0, 12);
    const rest = zones.slice(12);
    const items = head.map((z) => ({ key: z.key, label: z.label, value: z.count, color: CATEGORY_COLOR[z.cat] || CATEGORY_COLOR.OTHER, group: z.cat, vi: z.vi, zi: z.zi }));
    if (rest.length) items.push({ key: "__rest", label: `Other (${rest.length} zones)`, value: rest.reduce((a, z) => a + z.count, 0), color: SLATE[400], group: "Mixed", zoneKeys: rest.map((z) => z.key) });
    const placed = zones.reduce((a, z) => a + z.count, 0);
    return { items, total: placed, notPlaced: enriched.length - placed };
  }, [enriched, ngShots, mode, located, views]);

  const selIndex = sel && sel.mode === mode && pareto ? pareto.items.findIndex((x) => x.key === sel.key) : -1;
  const selItem = selIndex >= 0 ? pareto.items[selIndex] : null;

  const onBar = useCallback((item) => {
    setSel((s) => (s && s.mode === mode && s.key === item.key ? null : { mode, key: item.key }));
    requestAnimationFrame(() => setTimeout(() => document.getElementById("ra-pareto-map")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60));
  }, [mode]);

  const selRecords = useMemo(() => {
    if (!selItem || !enriched) return null;
    if (mode === "category") return enriched.filter((r) => r._cat === selItem.key);
    if (mode === "reason") {
      if (selItem.reasons) { const set = new Set(selItem.reasons); return enriched.filter((r) => set.has(r._reason)); }
      return enriched.filter((r) => r._reason === selItem.key);
    }
    if (!located) return null;
    const keys = new Set(selItem.zoneKeys || [selItem.key]);
    return located.filter((x) => keys.has(`${x.vi}|${x.zi}`)).map((x) => x.r);
  }, [selItem, enriched, mode, located]);
  const selReasons = useMemo(() => (selRecords ? reasonCounts(selRecords, { ngShots: selItem?.ngShot || (mode === "category" && selItem?.key === "CR") ? ngShots : 0 }) : null), [selRecords, selItem, mode, ngShots]);

  const matrix = useMemo(() => (enriched ? buildStationMatrix({ enriched, ngShots }) : null), [enriched, ngShots]);

  const vitalFew = useMemo(() => {
    if (mode !== "reason" || !pareto?.items?.length) return null;
    let run = 0;
    const out = [];
    for (const it of pareto.items) {
      if (it.key === "__rest") break;
      out.push(it);
      run += it.value;
      if (run / pareto.total >= 0.8) break;
    }
    return { n: out.length, share: (run / pareto.total) * 100 };
  }, [pareto, mode]);

  const zoneLoading = mode === "zone" && !located && (configLoading || !config);

  return (
    <>
      <div className="mg-grid-3-2">
        <SectionCard
          id="ra-pareto"
          kicker="Why"
          title={`Rejection Pareto — by ${mode}`}
          subtitle={vitalFew
            ? `Fix the top ${vitalFew.n} reason${vitalFew.n > 1 ? "s" : ""} and you address ${fmtPct(vitalFew.share, 0)} of all rejections. Click a bar to see where on the part.`
            : "Biggest first; the line is the cumulative share. Click a bar to see where on the part."}
          info={{
            what: "Pareto of all rejections in the period by defect category, by reason, or by zone of the part. Category and reason include the shots the die-casting machine rejected (NG shots, CR); zone only counts station rejections with a recorded location.",
            formula: ["Cumulative % = running total ÷ all rejections"],
          }}
          actions={(
            <div className="ra-seg ra-seg-sm" role="group" aria-label="Pareto by">
              {MODES.map((m) => (
                <button key={m.id} type="button" className={mode === m.id ? "on" : ""} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
              ))}
            </div>
          )}
        >
          {(loading && !enriched) || zoneLoading ? <SkeletonBlock lines={8} height={380} />
            : !pareto?.items?.length ? <EmptyState title={mode === "zone" ? "No located rejections in this period" : "No rejections in this period"} />
              : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
                    <div className="mg-legend">
                      {CATEGORY_ORDER.map((c) => <span key={c} title={CATEGORY_NAME[c]}><i style={{ background: CATEGORY_COLOR[c] }} />{c}</span>)}
                      {mode !== "category" && <span><i style={{ background: SLATE[400] }} />Other</span>}
                      {mode === "zone" && <span style={{ color: SLATE[500] }}>colour = main category of the zone</span>}
                    </div>
                    <span className="mg-hint"><MousePointerClick size={13} aria-hidden="true" />Click a bar → pictorial view</span>
                  </div>
                  <ParetoChart items={pareto.items} total={pareto.total} onSelect={onBar} selectedIndex={selIndex >= 0 ? selIndex : null} />
                  {mode === "zone" && pareto.notPlaced > 0 && (
                    <p className="ra-map-note">{fmtInt(pareto.notPlaced)} station rejections have no location (leak test or no zone recorded); NG shots are not on the part.</p>
                  )}
                </>
              )}
        </SectionCard>

        <SectionCard
          id="ra-matrix"
          kicker="Why · where caught"
          title="Which station catches which defect"
          subtitle="Darker cell = more rejections. Casting defects (CR / CRAM) caught late cost the most machining."
          info={{
            what: "Rejections per station and defect category. The die-casting row holds the NG shots (always CR). OP150 rows are the three leak-test machines combined (per-machine counts underneath).",
            note: "Counts per part record: a part is counted at the station that rejected it.",
          }}
        >
          {loading && !matrix ? <SkeletonBlock lines={7} height={300} />
            : !matrix ? <EmptyState />
              : (
                <>
                  <HeatMatrix rows={matrix} cols={COLS} />
                  <p style={{ margin: "10px 2px 0", fontSize: 12, color: SLATE[500] }}>
                    {fmtInt(matrix.reduce((a, r) => a + (r.values.CRAM || 0), 0))} CRAM rejections were cast defects found only after machining.
                  </p>
                </>
              )}
        </SectionCard>
      </div>

      {selItem && (
        <SectionCard
          id="ra-pareto-map"
          kicker="Where on the part"
          title={`Pictorial view — ${selItem.label}`}
          subtitle={mode === "zone" ? "The selected zone is ringed; its sub-zones show the rejections inside it." : "Only the rejections of the selected bar are placed on the part."}
          actions={<button type="button" className="ra-icon-btn" onClick={() => setSel(null)} aria-label="Close pictorial view"><X size={15} /></button>}
        >
          {selItem.ngShot ? (
            <EmptyState title="NG shots are rejected by the die-casting machine" hint="They are process rejections (a parameter out of limits), so they have no location on the part. See Root Cause." minHeight={120} />
          ) : (
            <PartMap
              key={`${mode}|${selItem.key}`}
              records={selRecords}
              views={views}
              loading={configLoading && !config}
              highlight={mode === "zone" && selItem.vi != null ? { vi: selItem.vi, zi: selItem.zi } : null}
              hotTitle="Top hot spots"
              aside={selReasons && mode !== "reason" ? (
                <div style={{ marginTop: 14 }}>
                  <ReasonList title="Reasons" data={selReasons} limit={8} showCats={mode === "zone"} />
                </div>
              ) : null}
            />
          )}
        </SectionCard>
      )}
    </>
  );
}
