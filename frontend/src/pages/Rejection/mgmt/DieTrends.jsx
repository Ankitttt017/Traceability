import React, { useMemo, useState } from "react";
import { LineChart as LineChartIcon, Layers, Clock } from "lucide-react";
import ComboChart from "../../../components/mgmt/ComboChart";
import { movingAverage, ratePct } from "../../../components/mgmt/trendMath";
import { CATEGORY_COLOR, NAVY, OUTCOME_COLOR, SLATE, TARGETS, fmtInt, fmtPct, pctOf } from "../../../components/mgmt/mgmtTheme";
import { dayLabel } from "./derive";
import { localISODate, productionToday } from "./periods";

/* ═══════════════════════════════════════════════════════════════════════════
   Die Performance — trend and break-up charts (same combo style as the Overview):
     DieTrendCard      per die: parts and OK per production day (bars) + rejection % with 7-day average and target
     DieCategoryCard   die → CR / MR / CRAM (stacked, station rejections) + NG % of the die
     DieShiftCard      die × shift → CR / MR / CRAM (stacked)
   dieDaily = rejection-summary dieDaily rows { die, day, parts, ok, ng } (same NG rule as the die figures).
   ═══════════════════════════════════════════════════════════════════════════ */
const CATS = ["CR", "MR", "CRAM"];
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function Card({ icon: Icon, title, sub, actions, children, color = NAVY }) {
  return (
    <div className="ra-card" data-accent style={{ "--accent": color }}>
      <div className="ra-card-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span className="ra-icon">{React.createElement(Icon, { size: 16 })}</span>
          <div style={{ minWidth: 0 }}>
            <h3 className="ra-card-title">{title}</h3>
            {sub && <p className="ra-card-sub">{sub}</p>}
          </div>
        </div>
        {actions}
      </div>
      <div className="ra-card-body">{children}</div>
    </div>
  );
}

export function DieTrendCard({ dieDaily = [], dies = [] }) {
  const [pick, setPick] = useState(null);
  const die = dies.includes(pick) ? pick : dies[0];
  const { keys, labels, parts, ok, ng } = useMemo(() => {
    const m = new Map();
    (dieDaily || []).filter((r) => String(r.die).toUpperCase() === die).forEach((r) => {
      const b = m.get(r.day) || { parts: 0, ok: 0, ng: 0 };
      b.parts += num(r.parts); b.ok += num(r.ok); b.ng += num(r.ng);
      m.set(r.day, b);
    });
    const ks = [...m.keys()].sort();
    return { keys: ks, labels: ks.map(dayLabel), parts: ks.map((k) => m.get(k).parts), ok: ks.map((k) => m.get(k).ok), ng: ks.map((k) => m.get(k).ng) };
  }, [dieDaily, die]);
  const partial = keys.indexOf(localISODate(productionToday()));
  const rate = useMemo(() => ratePct(ng, ok), [ng, ok]);
  const ma = useMemo(() => movingAverage(rate.map((v, i) => (i === partial ? null : v)), 7).map((v, i) => (i === partial ? null : v)), [rate, partial]);
  const tot = { parts: parts.reduce((a, v) => a + v, 0), ok: ok.reduce((a, v) => a + v, 0), ng: ng.reduce((a, v) => a + v, 0) };

  return (
    <Card
      icon={LineChartIcon}
      title={`Production & rejection trend — die ${die || "—"}`}
      sub="Bars: parts cast on the die per production day and those that passed final. Line: rejection % with the 7-day average and the 2 % target (today hollow = still running)."
      actions={dies.length > 1 ? (
        <div className="ra-seg ra-seg-sm" role="group" aria-label="Die">
          {dies.map((d) => <button key={d} type="button" className={d === die ? "on" : ""} aria-pressed={d === die} onClick={() => setPick(d)}>{d}</button>)}
        </div>
      ) : null}
    >
      {!keys.length ? <div className="die-empty">No parts on this die in the period.</div> : (
        <>
          <div className="die-totals">
            <span>Parts <b>{fmtInt(tot.parts)}</b></span>
            <span><i style={{ background: OUTCOME_COLOR.ok }} />OK <b>{fmtInt(tot.ok)}</b></span>
            <span><i style={{ background: OUTCOME_COLOR.ng }} />NG <b>{fmtInt(tot.ng)}</b></span>
            <span>Rejection % <b>{fmtPct(pctOf(tot.ng, tot.ok + tot.ng), 2)}</b></span>
          </div>
          <ComboChart
            labels={labels}
            keys={keys}
            bars={[
              { key: "parts", name: "Parts cast", color: "#a3bad5", data: parts, labelColor: SLATE[600] },
              { key: "ok", name: "OK (passed final)", color: OUTCOME_COLOR.ok, data: ok, labelColor: "#15803d" },
            ]}
            lines={[
              { key: "rate", name: "Rejection %", color: OUTCOME_COLOR.ng, data: rate, label: keys.length <= 31, status: true, smooth: false },
              ...(keys.length >= 7 ? [{ key: "ma", name: "7-day average", color: NAVY, data: ma, dashed: true }] : []),
            ]}
            target={TARGETS.scrapPct}
            band={TARGETS.amberBandPp}
            leftName="Parts"
            rightName="Rejection %"
            height={360}
            barMaxWidth={22}
            partial={partial >= 0 ? partial : null}
          />
        </>
      )}
    </Card>
  );
}

/** byDie: { die: { CR, MR, CRAM, ok, ng } } */
export function DieCategoryCard({ byDie = {}, dies = [] }) {
  const list = dies.filter((d) => byDie[d]);
  return (
    <Card icon={Layers} title="Die → CR · MR · CRAM" sub="Station rejections of each die by category (stacked, total on top) and the die's NG % on the right axis." color={CATEGORY_COLOR.CRAM}>
      {!list.length ? <div className="die-empty">No rejections on Oil Pan K-12 dies.</div> : (
        <ComboChart
          labels={list}
          keys={list}
          bars={CATS.map((c) => ({ key: c, name: c, color: CATEGORY_COLOR[c], stack: "c", data: list.map((d) => byDie[d][c] || 0) }))}
          lines={[{ key: "pct", name: "NG %", color: NAVY, data: list.map((d) => pctOf(byDie[d].ng, byDie[d].ok + byDie[d].ng)), label: true, status: true, markersOnly: true }]}
          target={TARGETS.scrapPct}
          leftName="Rejections"
          rightName="NG %"
          height={320}
          barMaxWidth={70}
          zoom={false}
          rotate={0}
        />
      )}
    </Card>
  );
}

/** byDieShift: { "S18|A": { CR, MR, CRAM } } */
export function DieShiftCard({ byDieShift = {}, dies = [] }) {
  const keys = dies.flatMap((d) => ["A", "B", "C"].map((s) => `${d}|${s}`)).filter((k) => byDieShift[k] && CATS.some((c) => byDieShift[k][c] > 0));
  return (
    <Card icon={Clock} title="Die × shift — CR · MR · CRAM" sub="Station rejections per die and shift, split by category (stacked, total on top)." color={NAVY}>
      {!keys.length ? <div className="die-empty">No rejections on Oil Pan K-12 dies.</div> : (
        <ComboChart
          labels={keys.map((k) => { const [d, s] = k.split("|"); return `${d}\nShift ${s}`; })}
          keys={keys}
          bars={CATS.map((c) => ({ key: c, name: c, color: CATEGORY_COLOR[c], stack: "c", data: keys.map((k) => byDieShift[k][c] || 0) }))}
          leftName="Rejections"
          height={320}
          barMaxWidth={56}
          zoom={false}
          rotate={0}
        />
      )}
    </Card>
  );
}
