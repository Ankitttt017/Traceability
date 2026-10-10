import React, { useMemo } from "react";
import { CheckCircle2, Factory, Hourglass, Layers, XCircle } from "lucide-react";
import InfoTip from "./components/InfoTip";
import Sparkline from "../../components/mgmt/Sparkline";
import Skeleton from "../../components/mgmt/Skeleton";
import { NAVY_3, OUTCOME_COLOR, SLATE, WARMUP_COLOR, fmtInt, fmtPct, pctOf } from "../../components/mgmt/mgmtTheme";
import { DEFINITIONS } from "./mgmt/derive";

/* ═══════════════════════════════════════════════════════════════════════════
   Page-level KPI strip — one compact card, frozen under the header on every tab (the page makes it sticky).
     DCM shots (OP100)        shots of the die-casting machine: OK · NG · warm-up (shot analytics, part OPK12)
     Tracked parts            parts first scanned in the period = OK + NG + In progress
     OK / NG / In progress    the same tracked parts by their result so far (rejection summary)
   Every cell has the same 24 px sparkline (per production day, or per hour for a single day); a cell without a
   trend keeps an empty band of the same height so the cells stay aligned. No progress bars.
   k = computeKpis() (mgmt/derive.js); trendData = rejection-daily (rows per day × shift, or per hour);
   shot = shot analytics (byDay).
   ═══════════════════════════════════════════════════════════════════════════ */
const STRIP_CSS = `
.ra-kstrip{display:grid;grid-template-columns:1.35fr repeat(4,minmax(0,1fr));padding:0;overflow:hidden}
.ra-kcell{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr);column-gap:10px;row-gap:1px;align-items:start;min-width:0;padding:11px 16px 8px}
.ra-kcell>*:not(.ra-kicon){grid-column:2}
.ra-kicon{grid-row:1/span 3;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;color:var(--kc);background:color-mix(in srgb,var(--kc) 13%,#fff);margin-top:2px}
.ra-kcell .ra-kspark{grid-column:1/-1}
.ra-kcell+.ra-kcell{border-left:1px solid #eef2f6}
.ra-kcell::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--kc,transparent)}
.ra-klabel{display:flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;white-space:nowrap;overflow:hidden}
.ra-kline{display:flex;align-items:baseline;gap:8px;min-width:0}
.ra-kval{font-size:25px;line-height:1.1;font-weight:750;letter-spacing:-.02em;color:#0f172a;font-variant-numeric:tabular-nums;white-space:nowrap}
.ra-kpct{font-size:11.5px;font-weight:800;color:var(--kc);background:color-mix(in srgb,var(--kc) 11%,#fff);padding:1px 7px;border-radius:999px;font-variant-numeric:tabular-nums;white-space:nowrap}
.ra-ksub{font-size:11.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.ra-ksub b{font-weight:700}
.ra-kspark{height:26px;margin-top:4px;position:relative}
.ra-kspark small{position:absolute;right:0;top:-2px;font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#94a3b8}
@media (max-width:1100px){.ra-kstrip{grid-template-columns:repeat(3,minmax(0,1fr))}.ra-kcell:nth-child(4){border-left:none}.ra-kcell:nth-child(n+4){border-top:1px solid #eef2f6}}
@media (max-width:640px){.ra-kstrip{grid-template-columns:repeat(2,minmax(0,1fr))}.ra-kcell{padding:8px 12px 6px}.ra-kval{font-size:19px}.ra-kcell:nth-child(odd){border-left:none}.ra-kcell:nth-child(4){border-left:1px solid #eef2f6}.ra-kcell:nth-child(n+3){border-top:1px solid #eef2f6}.ra-kspark{display:none}}
`;

const n = (v) => fmtInt(v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Per-day (or per-hour) series for the sparklines, in time order. */
function useSparks(trendData, shot, singleDay) {
  return useMemo(() => {
    const rows = Array.isArray(trendData?.days) ? trendData.days : [];
    const keyOf = (r) => (singleDay ? (r.hour == null ? null : Number(r.hour)) : r.day || null);
    const map = new Map();
    rows.forEach((r) => {
      const k = keyOf(r);
      if (k == null) return;
      const b = map.get(k) || { produced: 0, ok: 0, ng: 0, wip: 0 };
      b.produced += num(r.produced); b.ok += num(r.ok); b.ng += num(r.ng); b.wip += num(r.wip);
      map.set(k, b);
    });
    let keys = [...map.keys()];
    if (singleDay) {
      const start = Math.round(num(trendData?.dayRule?.dayStart ?? 21600) / 3600);
      keys.sort((a, b) => ((a - start + 24) % 24) - ((b - start + 24) % 24));
    } else keys.sort();
    const pick = (f) => (keys.length > 1 ? keys.map((k) => map.get(k)[f]) : null);
    const shotDays = (shot?.byDay || []).slice().sort((a, b) => String(a.day).localeCompare(String(b.day)));
    return {
      shots: !singleDay && shotDays.length > 1 ? shotDays.map((d) => num(d.shots)) : null,
      produced: pick("produced"), ok: pick("ok"), ng: pick("ng"), wip: pick("wip"),
    };
  }, [trendData, shot, singleDay]);
}

function Cell({ label, color, info, loading, value, valueColor, pct, sub, spark, sparkColor, icon: Icon }) {
  return (
    <div className="ra-kcell" style={{ "--kc": color }}>
      {Icon && <span className="ra-kicon" aria-hidden="true"><Icon size={17} /></span>}
      <div className="ra-klabel">
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {info && <InfoTip info={{ title: label, ...info }} label={`Definition: ${label}`} />}
      </div>
      {loading ? (
        <>
          <Skeleton height={26} width="62%" />
          <Skeleton height={11} width="80%" />
          <div className="ra-kspark" />
        </>
      ) : (
        <>
          <div className="ra-kline">
            <span className="ra-kval" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
            {pct && <span className="ra-kpct">{pct}</span>}
          </div>
          <div className="ra-ksub">{sub || " "}</div>
          <div className="ra-kspark">
            {spark ? <><Sparkline values={spark} color={sparkColor || NAVY_3} height={26} area ariaLabel={`${label} trend`} /></> : null}
          </div>
        </>
      )}
    </div>
  );
}

export default function RejectionKpiStrip({ k, trendData, shot, singleDay, loadingShot, loadingSummary }) {
  const sp = useSparks(trendData, shot, singleDay);
  const ofTracked = (v) => (k.traced ? fmtPct(pctOf(v, k.traced), 1) : null);
  const ngShotPct = k.goodShots != null ? pctOf(k.ngShots, num(k.goodShots) + num(k.ngShots)) : null;
  const eq = k.traced != null ? `${n(k.totalPass)} + ${n(k.totalNg)} + ${n(k.inProgress)} = ${n(k.tracedSum)}` : null;

  return (
    <section className="mg-card ra-kstrip" aria-label="Key figures for the selected period">
      <style>{STRIP_CSS}</style>
      <Cell
        label="DCM shots (OP100)"
        icon={Factory}
        color={NAVY_3}
        loading={loadingShot}
        value={fmtInt(k.shots)}
        pct={ngShotPct != null ? `NG ${fmtPct(ngShotPct, 2)}` : null}
        sub={k.shots == null ? "No shot data in this period" : (
          <>
            <b style={{ color: OUTCOME_COLOR.ok }}>{n(k.goodShots)}</b> OK · <b style={{ color: OUTCOME_COLOR.ng }}>{n(k.ngShots)}</b> NG · <b style={{ color: SLATE[600] }}>{n(k.warmUp)}</b> warm-up
          </>
        )}
        spark={sp.shots}
        sparkColor={NAVY_3}
        info={{
          ...DEFINITIONS.shots,
          formula: ["DCM shots = OK shots + NG shots + warm-up shots", "NG shot % = NG shots ÷ (OK shots + NG shots)", ...(k.shots != null ? [`${n(k.goodShots)} + ${n(k.ngShots)} + ${n(k.warmUp)} = ${n(k.shots)}`] : [])],
          note: "NG shot = a process parameter out of limits (counted as CR). Warm-up shots are planned and not counted as scrap.",
        }}
      />
      <Cell
        label="Tracked parts"
        icon={Layers}
        color={SLATE[500]}
        loading={loadingSummary}
        value={fmtInt(k.traced)}
        sub={k.traced != null && !k.tracedAddsUp ? `OK + NG + In progress = ${n(k.tracedSum)}` : "First scanned in the period"}
        spark={sp.produced}
        sparkColor={SLATE[500]}
        info={{
          what: DEFINITIONS.traced.what,
          formula: ["Tracked = OK + NG parts + In progress", ...(eq ? [eq] : [])],
          note: "Same figures as the Dashboard and the Historical page.",
        }}
      />
      <Cell
        label="OK"
        icon={CheckCircle2}
        color={OUTCOME_COLOR.ok}
        loading={loadingSummary}
        value={fmtInt(k.totalPass)}
        valueColor={OUTCOME_COLOR.ok}
        pct={ofTracked(k.totalPass)}
        sub="Passed final inspection (OP160)"
        spark={sp.ok}
        sparkColor={OUTCOME_COLOR.ok}
        info={DEFINITIONS.pass}
      />
      <Cell
        label="NG"
        icon={XCircle}
        color={OUTCOME_COLOR.ng}
        loading={loadingSummary}
        value={fmtInt(k.totalNg)}
        valueColor={OUTCOME_COLOR.ng}
        pct={ofTracked(k.totalNg)}
        sub={k.stationRejections != null ? `${n(k.stationRejections)} station rejections` : "Rejected parts"}
        spark={sp.ng}
        sparkColor={OUTCOME_COLOR.ng}
        info={{
          what: "Parts rejected in the period (same figure as the Dashboard and the Historical page). The station rejections underneath count every NG decision per station (decisive scan per part per station, leak test per machine) — a part can be rejected at more than one station, and the station charts use those counts.",
          formula: ["Tracked = OK + NG + In progress"],
          note: "NG shots of the die-casting machine are on the DCM shots card, not in this figure.",
        }}
      />
      <Cell
        label="In progress"
        icon={Hourglass}
        color={WARMUP_COLOR}
        loading={loadingSummary}
        value={fmtInt(k.inProgress)}
        valueColor={SLATE[600]}
        pct={ofTracked(k.inProgress)}
        sub="No final result yet"
        spark={sp.wip}
        sparkColor={SLATE[400]}
        info={DEFINITIONS.inProgress}
      />
    </section>
  );
}
