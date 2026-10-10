import React, { useEffect, useMemo, useState } from "react";
import SectionCard from "../../../components/mgmt/SectionCard";
import HeatMatrix from "../../../components/mgmt/HeatMatrix";
import { SkeletonBlock } from "../../../components/mgmt/Skeleton";
import EmptyState from "../../../components/mgmt/EmptyState";
import useInView from "../../../components/mgmt/useInView";
import { CATEGORY_COLOR, CATEGORY_NAME, CATEGORY_ORDER, NAVY_3, SLATE, fmtInt, fmtPct } from "../../../components/mgmt/mgmtTheme";
import { REASON_PALETTE, buildReasonZoneMatrix, locateRecords, locationReasons, topOf, zoneCounts } from "./deriveTabs";
import PartMap from "./PartMap";

const CATS = ["ALL", ...CATEGORY_ORDER];

/**
 * Where on the part: heat (or dominant reason) on the configured CAD zones / sub-zones, filtered by category and
 * reason, + which reason dominates which zone (table) and a reason × zone matrix.
 */
export default function LocationSection({ enriched, config, configLoading, rowsLoading, onVisible }) {
  const [ref, seen] = useInView();
  useEffect(() => { if (seen) onVisible?.(); }, [seen, onVisible]);

  const [cat, setCat] = useState("ALL");
  const [reason, setReason] = useState("");
  const [colorBy, setColorBy] = useState("count");

  const views = useMemo(() => (Array.isArray(config?.views) ? config.views : []), [config]);
  const byCat = useMemo(() => (enriched ? (cat === "ALL" ? enriched : enriched.filter((r) => r._cat === cat)) : null), [enriched, cat]);
  const reasonOptions = useMemo(() => {
    const c = {};
    (byCat || []).forEach((r) => { c[r._reason] = (c[r._reason] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [byCat]);
  const activeReason = reason && reasonOptions.some(([r]) => r === reason) ? reason : "";
  const records = useMemo(() => (byCat ? (activeReason ? byCat.filter((r) => r._reason === activeReason) : byCat) : null), [byCat, activeReason]);

  const located = useMemo(() => (records && views.length ? locateRecords(records, views) : null), [records, views]);
  // colours for the reasons that lead somewhere on the part (most located first); the rest grey
  const reasonColors = useMemo(() => {
    if (!located) return {};
    const c = {};
    located.forEach((x) => { if (x.vi >= 0 && x.zi >= 0) c[x.r._reason] = (c[x.r._reason] || 0) + 1; });
    const out = {};
    Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, REASON_PALETTE.length).forEach(([r], i) => { out[r] = REASON_PALETTE[i]; });
    return out;
  }, [located]);

  const zoneRows = useMemo(() => {
    if (!located) return [];
    const lr = locationReasons(located);
    return zoneCounts(located, views).slice(0, 12).map((z) => ({ ...z, top: topOf(lr.zone[z.key]) }));
  }, [located, views]);
  const matrix = useMemo(() => (located ? buildReasonZoneMatrix(located, views, { topReasons: 10, topZones: 8 }) : null), [located, views]);
  const matrixCols = useMemo(() => (matrix ? matrix.zones.map((z) => ({ key: z.key, label: z.label, color: CATEGORY_COLOR[z.cat] || NAVY_3, title: `${z.zone} · ${z.view}` })) : []), [matrix]);

  const loading = (rowsLoading && !enriched) || (configLoading && !config);

  return (
    <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionCard
        id="ra-location"
        kicker="Where on the part"
        title="Defect location map"
        subtitle="Where the visual defects sit on the casting. Filter by category or reason; colour by count or by the reason that dominates each area."
        info={{
          what: "Every station rejection with a recorded location is placed on the zone / sub-zone configured for the part (Rejection Configuration). Leak-test rejections come from a pressure sensor and have no location.",
          formula: ["Top reason of an area = the reason with the most rejections in that zone / sub-zone", "Share = top reason count ÷ all rejections of the area"],
          note: "Some older records have no zone; where the defect type implies one it is placed there and counted as 'inferred'.",
        }}
      >
        <div className="ra-loc-filters">
          <div className="ra-seg ra-seg-sm" role="group" aria-label="Category">
            {CATS.map((c) => (
              <button key={c} type="button" className={cat === c ? "on" : ""} aria-pressed={cat === c} title={CATEGORY_NAME[c] || "All categories"} onClick={() => { setCat(c); setReason(""); }}>
                {c !== "ALL" && <i className="ra-dot" style={{ background: CATEGORY_COLOR[c] }} />}{c === "ALL" ? "All" : c}
              </button>
            ))}
          </div>
          <label className="ra-select">
            <span>Reason</span>
            <select value={activeReason} onChange={(e) => setReason(e.target.value)} aria-label="Reason filter">
              <option value="">All reasons ({fmtInt(byCat?.length)})</option>
              {reasonOptions.map(([r, n]) => <option key={r} value={r}>{r} ({fmtInt(n)})</option>)}
            </select>
          </label>
          <div className="ra-seg ra-seg-sm" role="group" aria-label="Colour by">
            <button type="button" className={colorBy === "count" ? "on" : ""} aria-pressed={colorBy === "count"} onClick={() => setColorBy("count")}>Colour by count</button>
            <button type="button" className={colorBy === "reason" ? "on" : ""} aria-pressed={colorBy === "reason"} onClick={() => setColorBy("reason")}>Colour by top reason</button>
          </div>
        </div>
        {!seen || loading ? <SkeletonBlock lines={6} height={340} />
          : (
            <PartMap
              records={records}
              views={views}
              colorBy={colorBy}
              reasonColors={reasonColors}
              hotTitle="Top 5 hot spots (all views)"
            />
          )}
      </SectionCard>

      <div className="mg-grid2">
        <SectionCard
          id="ra-zone-reason"
          kicker="Which reason where"
          title="Top reason per zone"
          subtitle="The reason that dominates each zone (all views), with its count and share of the zone."
          info={{ what: "Zones ranked by located rejections for the current filters.", formula: ["Share = top reason count ÷ zone rejections"] }}
        >
          {!seen || loading ? <SkeletonBlock lines={6} height={240} />
            : !zoneRows.length ? <EmptyState title="No located rejections for these filters" />
              : (
                <div className="mg-table-wrap">
                  <table className="mg-table">
                    <thead><tr><th>Zone</th><th className="r">Rejections</th><th>Top reason</th><th className="r">Count</th><th className="r">Share</th><th>Next</th></tr></thead>
                    <tbody>
                      {zoneRows.map((z) => (
                        <tr key={z.key}>
                          <td className="strong" style={{ whiteSpace: "nowrap" }}>{z.label}</td>
                          <td className="r">{fmtInt(z.count)}</td>
                          <td>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <i className="ra-dot" style={{ background: reasonColors[z.top?.reason] || SLATE[400] }} />{z.top?.reason || "—"}
                            </span>
                          </td>
                          <td className="r strong">{fmtInt(z.top?.count)}</td>
                          <td className="r">{fmtPct(z.top?.pct, 0)}</td>
                          <td style={{ color: SLATE[500], fontSize: 12 }}>{z.top?.second ? `${z.top.second.reason} (${fmtInt(z.top.second.count)})` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </SectionCard>
        <SectionCard
          id="ra-reason-zone"
          kicker="Which reason where"
          title="Reason × zone"
          subtitle="Top 10 located reasons against the 8 busiest zones. Darker = more."
          info={{ what: "Located station rejections only, for the current filters. Column colour = main category of the zone." }}
        >
          {!seen || loading ? <SkeletonBlock lines={6} height={240} />
            : !matrix?.rows.length ? <EmptyState title="No located rejections for these filters" />
              : <HeatMatrix rows={matrix.rows} cols={matrixCols} rowHeader="Reason" />}
        </SectionCard>
      </div>
    </div>
  );
}
