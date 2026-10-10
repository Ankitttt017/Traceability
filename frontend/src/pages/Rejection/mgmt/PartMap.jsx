import React, { useMemo, useState } from "react";
import { SkeletonBlock } from "../../../components/mgmt/Skeleton";
import EmptyState from "../../../components/mgmt/EmptyState";
import { HEAT, NAVY, SLATE, alpha, fmtInt, fmtPct, heatColor, heatInk, pctOf } from "../../../components/mgmt/mgmtTheme";
import CadStage from "../components/CadStage";
import { boxStyle, subBoxStyle, buildViewLocations } from "../rejectionConstants";
import { OTHER_REASON_COLOR, locateRecords, locationReasons, topOf } from "./deriveTabs";

/* ═══════════════════════════════════════════════════════════════════════════
   Pictorial view: the part images (Rejection Configuration views) with the given NG records placed on their
   zones / sub-zones. Used by the station gauges, the Pareto, and the Defect Location tab.
   • colorBy "count" → heat by number of rejections; "reason" → each zone / sub-zone takes the colour of the
     reason that dominates it (reasonColors), the label names that reason
   • highlight { vi, zi } → that zone gets a ring and its view opens first
   Zone boxes use boxStyle / subBoxStyle exactly (sub-zones are % of the parent zone; CadStage keeps the frame).
   ═══════════════════════════════════════════════════════════════════════════ */


const zoneLabel = (z) => String(z?.name || z?.code || "").replace(/^ZONE[-\s]*/i, "Zone ");
const short = (t, n = 16) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));

export default function PartMap({
  records, views = [], loading = false, colorBy = "count", reasonColors = null, highlight = null, hotCount = 5,
  hotTitle = "Top hot spots", emptyTitle = "No located rejections", maxWidth = 760, aside = null, reasonPanel = null, reasonTitle = "Why rejected",
}) {
  // with a reason panel the right side has two tabs: Reasons (default) and Hot spots
  const [side, setSide] = useState("reasons");
  const loc = useMemo(() => (records && views.length ? buildViewLocations(records, views) : null), [records, views]);
  const located = useMemo(() => (records && views.length ? locateRecords(records, views) : []), [records, views]);
  const lr = useMemo(() => locationReasons(located), [located]);

  const [picked, setPicked] = useState(null);
  const defaultViewIdx = useMemo(() => {
    if (!loc) return -1;
    if (highlight && highlight.vi >= 0 && loc.views[highlight.vi]) return highlight.vi;
    let best = 0;
    loc.views.forEach((v, i) => { if (v.totalDefects > loc.views[best].totalDefects) best = i; });
    return best;
  }, [loc, highlight]);
  const vi = picked != null && loc?.views[picked] ? picked : defaultViewIdx;
  const view = loc?.views[vi] || null;

  const mx = useMemo(() => {
    if (!view) return { zone: 1, sub: 1 };
    return {
      zone: Math.max(1, ...view.zones.map((z) => z.count)),
      sub: Math.max(1, ...view.zones.flatMap((z) => z.subZones.map((s) => s.count))),
    };
  }, [view]);

  const hot = useMemo(() => {
    if (!loc) return [];
    const out = [];
    loc.views.forEach((v, i) => v.zones.forEach((z, zi) => {
      let inSubs = 0;
      z.subZones.forEach((s, si) => {
        inSubs += s.count;
        if (s.count > 0) out.push({ key: `${i}|${zi}|${si}`, vi: i, view: v.name, zone: zoneLabel(z), sub: s.code || s.name, count: s.count, top: topOf(lr.sub[`${i}|${zi}|${si}`]) });
      });
      if (z.count - inSubs > 0) out.push({ key: `${i}|${zi}`, vi: i, view: v.name, zone: zoneLabel(z), sub: null, count: z.count - inSubs, top: topOf(lr.zone[`${i}|${zi}`]) });
    }));
    return out.sort((a, b) => b.count - a.count).slice(0, hotCount);
  }, [loc, lr, hotCount]);

  const byReason = colorBy === "reason" && reasonColors;
  const colOfReason = (r) => (r && reasonColors?.[r]) || OTHER_REASON_COLOR;
  const legendReasons = useMemo(() => {
    if (!byReason || !view) return [];
    const seen = new Map();
    view.zones.forEach((z, zi) => {
      const t = topOf(lr.zone[`${vi}|${zi}`]);
      if (t) seen.set(t.reason, (seen.get(t.reason) || 0) + 1);
      z.subZones.forEach((s, si) => { const ts = topOf(lr.sub[`${vi}|${zi}|${si}`]); if (ts) seen.set(ts.reason, (seen.get(ts.reason) || 0) + 1); });
    });
    return [...seen.keys()];
  }, [byReason, view, lr, vi]);

  const st = loc?.stats;
  if (loading) return <SkeletonBlock lines={6} height={320} />;
  if (!views.length) return <EmptyState title="No part views configured" hint="Add views and zones in Rejection Configuration." />;
  if (!loc || !view) return <EmptyState title={emptyTitle} />;
  if (st && st.records > 0 && st.localized === 0 && st.sensor === st.records) {
    return (
      <div>
        <EmptyState title="These are leak-test rejections" hint="They are found by the pressure sensor of the leak tester, so they have no location on the part." minHeight={120} />
        {aside}
      </div>
    );
  }

  return (
    <div className="ra-loc">
      <div style={{ minWidth: 0 }}>
        <div className="ra-seg ra-seg-sm" role="tablist" aria-label="Part view" style={{ marginBottom: 10 }}>
          {loc.views.map((v, i) => (
            <button key={v.id ?? i} type="button" role="tab" aria-selected={i === vi} className={i === vi ? "on" : ""} onClick={() => setPicked(i)}>
              {v.name} <span className="ra-seg-count">{fmtInt(v.totalDefects)}</span>
            </button>
          ))}
        </div>
        <div style={{ maxWidth }}>
          <CadStage imageUrl={view.imageUrl} alt={`${view.name} defect map`}>
            {view.zones.map((zone, zi) => {
              const zc = zone.count;
              const zTop = topOf(lr.zone[`${vi}|${zi}`]);
              const zCol = zc > 0 ? (byReason ? colOfReason(zTop?.reason) : heatColor(zc, mx.zone)) : null;
              const hasSubs = zone.subZones.length > 0;
              const ring = highlight && highlight.vi === vi && highlight.zi === zi;
              const tip = `${view.name} · ${zoneLabel(zone)}: ${fmtInt(zc)} rejections${zTop ? ` — top reason ${zTop.reason} (${fmtInt(zTop.count)}, ${fmtPct(zTop.pct, 0)})` : ""}`;
              return (
                <React.Fragment key={zone.id || zone.code || zi}>
                  <div
                    className="cad-zone"
                    title={tip}
                    style={{
                      ...boxStyle(zone),
                      ...(zCol ? { border: `1.5px solid ${zCol}`, background: alpha(zCol, hasSubs ? 0.08 + Math.sqrt(zc / mx.zone) * 0.12 : 0.2 + Math.sqrt(zc / mx.zone) * 0.4) } : {}),
                      ...(ring ? { boxShadow: `0 0 0 3px ${NAVY}, 0 0 0 6px rgba(15,42,74,.25)`, zIndex: 2 } : {}),
                    }}
                  >
                    <span className="cad-tag">
                      {zoneLabel(zone)}
                      {zc > 0 && byReason && zTop && <span className="ra-cad-reason" style={{ color: zCol }}> · {short(zTop.reason)}</span>}
                      {zc > 0 && (
                        <span className="cad-count" style={{ background: zCol, color: byReason ? "#fff" : heatInk(zc, mx.zone) }}>{fmtInt(zc)}</span>
                      )}
                    </span>
                  </div>
                  {zone.subZones.map((sz, si) => {
                    const sc = sz.count;
                    const sTop = topOf(lr.sub[`${vi}|${zi}|${si}`]);
                    const sCol = sc > 0 ? (byReason ? colOfReason(sTop?.reason) : heatColor(sc, mx.sub)) : null;
                    return (
                      <div
                        key={`s-${sz.id || sz.code || si}`}
                        className="cad-sub"
                        title={`${zoneLabel(zone)} › ${sz.code || sz.name}: ${fmtInt(sc)}${sTop ? ` — top reason ${sTop.reason} (${fmtInt(sTop.count)})` : ""}`}
                        style={{ ...subBoxStyle(zone, sz), ...(sCol ? { border: `1.5px solid ${sCol}`, background: alpha(sCol, 0.3 + Math.sqrt(sc / mx.sub) * 0.45) } : {}) }}
                      >
                        {sc > 0 && (
                          <span className="cad-tag">
                            {sz.code || sz.name}
                            <span className="cad-count" style={{ background: sCol, color: byReason ? "#fff" : heatInk(sc, mx.sub) }}>{fmtInt(sc)}</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </CadStage>
        </div>
        {byReason ? (
          <div className="mg-legend" style={{ marginTop: 8 }}>
            {legendReasons.length ? legendReasons.map((r) => <span key={r}><i style={{ background: colOfReason(r) }} />{r}</span>)
              : <span style={{ color: SLATE[500] }}>No rejections located on this view.</span>}
          </div>
        ) : (
          <div className="ra-heat-scale" aria-hidden="true">
            <span>fewer</span>
            {HEAT.map((c) => <i key={c} style={{ background: c }} />)}
            <span>more rejections</span>
          </div>
        )}
        {st && (
          <p className="ra-map-note">
            {fmtInt(st.localized)} of {fmtInt(st.records)} rejections placed on the part
            {st.inferred > 0 ? ` (${fmtInt(st.inferred)} inferred from the defect type)` : ""}
            {st.sensor > 0 ? ` · ${fmtInt(st.sensor)} leak-test rejections have no location` : ""}
            {st.unlocalized > 0 ? ` · ${fmtInt(st.unlocalized)} without a recorded zone` : ""}.
          </p>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        {reasonPanel && (
          <div className="ra-seg ra-seg-sm ra-side-tabs" role="tablist" aria-label="Right panel" style={{ marginBottom: 10 }}>
            {[["reasons", reasonTitle], ["hot", hotTitle]].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={side === k} className={side === k ? "on" : ""} onClick={() => setSide(k)}>{l}</button>
            ))}
          </div>
        )}
        {reasonPanel && side === "reasons" ? reasonPanel : (<>
        {!reasonPanel && <div className="ra-mini-title">{hotTitle}</div>}
        {hot.length ? (
          <ol className="ra-hot">
            {hot.map((h, i) => (
              <li key={h.key}>
                <button type="button" onClick={() => setPicked(h.vi)} title="Show this view">
                  <span className="ra-hot-rank">{i + 1}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="ra-hot-name">{h.zone}{h.sub ? ` › ${h.sub}` : ""}</span>
                    <span className="ra-hot-view">
                      {h.view}
                      {h.top ? <> · <b style={{ color: byReason ? colOfReason(h.top.reason) : SLATE[700] }}>{h.top.reason}</b> {fmtInt(h.top.count)}</> : null}
                    </span>
                  </span>
                  <span className="ra-hot-val">
                    <b className="mg-num">{fmtInt(h.count)}</b>
                    <span>{fmtPct(pctOf(h.count, st?.localized), 0)} of placed</span>
                  </span>
                </button>
                <span className="ra-hot-bar" style={{ width: `${(h.count / hot[0].count) * 100}%`, background: byReason ? colOfReason(h.top?.reason) : heatColor(h.count, hot[0].count) || SLATE[300] }} />
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title={emptyTitle} minHeight={120} />
        )}
        </>)}
        {aside}
      </div>
    </div>
  );
}
