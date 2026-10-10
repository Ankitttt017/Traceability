import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Columns3, Pause, Play } from "lucide-react";
import QualityGauge from "../../../../components/mgmt/QualityGauge";
import {
  OUTCOME_COLOR, STATUS_BG, STATUS_COLOR, TARGETS, fmtInt, fmtPct, pctOf, statusLowerBetter,
} from "../../../../components/mgmt/mgmtTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   Quality-gate speedometers as an auto-scrolling carousel.
     • advances one gauge every 4 s, pauses while the mouse is over it / it has keyboard focus / the user paused it
     • arrows + dots move it by hand; prefers-reduced-motion = no auto-advance
     • items: line gate · OP100 DCM shots (shot analytics) · one gauge per station · ONE OP150 leak-test item that
       rotates LT-1 → LT-2 → LT-3 by itself (the small "all" button shows the three machines together)
   Clicking a gauge calls onPick(key) — the tab opens the pictorial view of that station.
   ═══════════════════════════════════════════════════════════════════════════ */
export const GC_CSS = `
.ra-gc{position:relative}
.ra-gc-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.ra-gc-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:#475569}
.ra-gc-legend span{display:inline-flex;align-items:center;gap:5px}
.ra-gc-legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.ra-gc-ctrl{display:flex;align-items:center;gap:6px}
.ra-gc-row{display:flex;align-items:center;gap:8px}
.ra-gc-view{flex:1;min-width:0;overflow:hidden;padding:3px 2px 6px}
.ra-gc-track{display:flex;transition:transform .55s cubic-bezier(.4,0,.2,1);will-change:transform}
@media (prefers-reduced-motion:reduce){.ra-gc-track{transition:none}}
.ra-gc-nav{flex-shrink:0;display:grid;place-items:center;width:32px;height:32px;border-radius:50%;border:1px solid #cbd5e1;background:#fff;color:#0f2a4a;cursor:pointer}
.ra-gc-nav:hover:not(:disabled){background:#f1f5f9}
.ra-gc-nav:disabled{opacity:.35;cursor:default}
.ra-gc-mini{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}
.ra-gc-mini:hover{background:#f8fafc}
.ra-gc-dots{display:flex;justify-content:center;gap:6px;margin-top:4px}
.ra-gc-dots button{width:8px;height:8px;border-radius:4px;border:none;padding:0;background:#cbd5e1;cursor:pointer;transition:width .2s}
.ra-gc-dots button.on{background:#0f2a4a;width:22px}
.ra-gc-item{flex-shrink:0;display:flex;flex-direction:column;align-items:stretch;gap:4px;min-height:258px;padding:10px 12px 10px;border:1.5px solid color-mix(in srgb,var(--gate-c) 45%,#fff);border-top:5px solid var(--gate-c);border-radius:14px;background:linear-gradient(180deg,var(--gate-bg) 0%,#fff 62%);font:inherit;text-align:left;color:inherit;transition:border-color .15s,box-shadow .15s;position:relative}
.ra-gc-item.click{cursor:pointer}
.ra-gc-item.click:hover{box-shadow:0 8px 20px -12px rgba(15,23,42,.4);border-color:#94a3b8;border-top-color:var(--gate-c)}
.ra-gc-item.on{box-shadow:0 0 0 2px #0f2a4a;border-color:#0f2a4a;border-top-color:var(--gate-c)}
.ra-gc-item:focus-visible{outline:2px solid #3b5b82;outline-offset:2px}
.ra-gc-head{display:flex;justify-content:space-between;align-items:center;gap:6px}
.ra-gc-head b{font-size:13.5px;font-weight:800;letter-spacing:.03em;color:#0f2a4a;white-space:nowrap}
.ra-gc-st{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;color:#475569;white-space:nowrap}
.ra-gc-st i{width:8px;height:8px;border-radius:50%;background:var(--gate-c)}
.ra-gc-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--gate-c);margin-right:6px;box-shadow:0 0 0 3px color-mix(in srgb,var(--gate-c) 22%,transparent);vertical-align:0}
.ra-gc-tag{font-size:10.5px;font-weight:700;color:#475569;background:#fff;border:1px solid #e2e8f0;border-radius:999px;padding:1px 7px;white-space:nowrap}
.ra-gc-okng{display:flex;justify-content:center;align-items:baseline;gap:8px;margin-top:auto;font-size:13px;font-weight:700;color:#334155;font-variant-numeric:tabular-nums}
.ra-gc-okng b{font-size:15px;font-weight:800}
.ra-gc-okng i{font-style:normal;color:#94a3b8}
.ra-gc-sub{text-align:center;font-size:11px;color:#64748b}
.ra-gc-lts{display:flex;flex-direction:column;gap:3px;margin-top:4px}
.ra-gc-lts button{display:grid;grid-template-columns:10px 34px minmax(0,1fr) auto;align-items:center;gap:6px;padding:3px 6px;border:1px solid #e2e8f0;border-radius:7px;background:#fff;font:inherit;font-size:11.5px;font-weight:700;color:#0f2a4a;cursor:pointer;text-align:left}
.ra-gc-lts button:hover,.ra-gc-lts button.on{border-color:#0f2a4a}
.ra-gc-lts i{width:8px;height:8px;border-radius:50%}
.ra-gc-lts span{font-weight:600;color:#475569;font-size:11px;font-variant-numeric:tabular-nums}
.ra-gc-lts em{font-style:normal;font-weight:800;font-variant-numeric:tabular-nums}
.ra-gc-name{font-size:11.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ra-gc-nums{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 10px;font-size:11.5px;color:#475569;font-variant-numeric:tabular-nums;margin-top:auto}
.ra-gc-nums.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.ra-gc-nums span{display:flex;align-items:center;gap:4px;white-space:nowrap;min-width:0}
.ra-gc-nums i{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.ra-gc-nums b{color:#0f172a;margin-left:auto}
.ra-gc-lt{display:flex;gap:3px;align-items:center}
.ra-gc-lt button{height:22px;padding:0 6px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;font:inherit;font-size:10.5px;font-weight:700;color:#475569;cursor:pointer}
.ra-gc-lt button.on{background:#0f2a4a;border-color:#0f2a4a;color:#fff}
.ra-gc-lt button.all{display:grid;place-items:center;width:24px;padding:0}
.ra-gc-lt button.all.on{background:#3b5b82;border-color:#3b5b82}
.ra-gc-leakall{margin-top:12px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;background:#fbfcfe}
.ra-gc-leakall-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.ra-gc-leakall-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
`;

const STATUS_WORD = { good: "on target", warn: "near limit", bad: "above limit", none: "no data" };
const st = (pct) => statusLowerBetter(pct, TARGETS.scrapPct);
const dec = (v) => (v != null && v < 1 ? 2 : 1);
const shortName = (s) => (s.name || "").replace(/^OP\d{3}\s*/, "").replace(/^Leak test\s*/i, "Leak test ") || s.name;
const CARD_MIN = 206;
const GAP = 12;
const AUTO_MS = 4000;
const LEAK_MS = 2600;
const cardStyle = (status, width) => ({ "--gate-c": STATUS_COLOR[status], "--gate-bg": STATUS_BG[status], width });

const usePrefersReducedMotion = () => {
  const [r, setR] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!m) return undefined;
    const on = () => setR(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return r;
};

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

/** "OK 801 · NG 10" — values labelled as text. */
const OkNg = ({ ok, ng }) => (
  <span className="ra-gc-okng">
    <span>OK <b style={{ color: OUTCOME_COLOR.ok }}>{fmtInt(ok)}</b></span>
    <i aria-hidden="true">·</i>
    <span>NG <b style={{ color: OUTCOME_COLOR.ng }}>{fmtInt(ng)}</b></span>
  </span>
);

/** One station gauge: coloured status border + dot (vs the 2 % target), big NG %, OK / NG as text. */
export function StationGauge({ s, on, onPick, max, width, extra, title }) {
  const status = st(s.ngPct);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`ra-gc-item click ${on ? "on" : ""}`}
      aria-pressed={on}
      onClick={() => onPick(s.key)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(s.key); } }}
      style={cardStyle(status, width)}
      title={title || `${s.name}: ${fmtInt(s.ok)} OK, ${fmtInt(s.ng)} NG — NG ${fmtPct(s.ngPct, 2)} (${STATUS_WORD[status]}, target ≤ ${TARGETS.scrapPct}%). Click for the pictorial view.`}
    >
      <span className="ra-gc-head"><b><i className="ra-gc-dot" aria-hidden="true" />{s.label}</b>{extra}</span>
      <span className="ra-gc-name">{shortName(s)}</span>
      <QualityGauge value={s.ngPct} max={max} size="lg" decimals={dec(s.ngPct)} ariaLabel={`${s.label} NG ${fmtPct(s.ngPct, 2)}`} />
      <OkNg ok={s.ok} ng={s.ng} />
    </div>
  );
}

/** OP100 — DCM shots from the shot analytics: shots, OK, warm-up, NG and NG-shot %. */
function ShotGauge({ shot, on, onPick, max, width }) {
  const pct = shot.ngPct;
  const status = st(pct);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`ra-gc-item click ${on ? "on" : ""}`}
      aria-pressed={on}
      onClick={() => onPick("OP100")}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick("OP100"); } }}
      style={cardStyle(status, width)}
      title={`OP100 DCM shots: ${fmtInt(shot.shots)} shots · ${fmtInt(shot.ok)} OK · ${fmtInt(shot.ng)} NG · ${fmtInt(shot.warmUp)} warm-up — NG shot ${fmtPct(pct, 2)} = NG ÷ (OK + NG). Click for details.`}
    >
      <span className="ra-gc-head"><b><i className="ra-gc-dot" aria-hidden="true" />OP100</b><span className="ra-gc-tag">{fmtInt(shot.shots)} shots</span></span>
      <span className="ra-gc-name">DCM shots (die casting)</span>
      <QualityGauge value={pct} max={max} size="lg" decimals={dec(pct)} label="NG shot %" ariaLabel={`OP100 NG shot ${fmtPct(pct, 2)}`} />
      <OkNg ok={shot.ok} ng={shot.ng} />
      <span className="ra-gc-sub">Warm-up {fmtInt(shot.warmUp)} (not scrap)</span>
    </div>
  );
}

/**
 * OP150 — ONE card for the three leak-test machines. By default it rotates LT-1 → LT-2 → LT-3; the ▥ button switches
 * the SAME card to the combined view (all three added together + a compact LT-1 / LT-2 / LT-3 breakdown) and back.
 */
function LeakGauge({ machines, picked, onPick, max, width, paused }) {
  const [i, setI] = useState(0);
  const [combined, setCombined] = useState(false);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (paused || combined || reduced || machines.length < 2) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % machines.length), LEAK_MS);
    return () => clearInterval(t);
  }, [paused, combined, reduced, machines.length]);
  const s = machines[Math.min(i, machines.length - 1)];
  if (!s) return null;
  const tot = machines.reduce((a, m) => ({ ok: a.ok + m.ok, ng: a.ng + m.ng }), { ok: 0, ng: 0 });
  const totPct = pctOf(tot.ng, tot.ok + tot.ng);
  const stop = (e) => e.stopPropagation();
  const toggle = (
    <span className="ra-gc-lt" onClick={stop} onKeyDown={stop} role="group" aria-label="Leak-test machine">
      {!combined && machines.map((m, j) => (
        <button key={m.key} type="button" className={j === i ? "on" : ""} aria-pressed={j === i} onClick={() => setI(j)} title={`Show ${m.label}`}>{m.label.replace("LT-", "")}</button>
      ))}
      <button type="button" className={`all ${combined ? "on" : ""}`} aria-pressed={combined} onClick={() => setCombined((v) => !v)}
        title={combined ? "Back to one machine at a time" : "LT-1 + LT-2 + LT-3 together"} aria-label="Show the three leak-test machines together">
        <Columns3 size={12} aria-hidden="true" />
      </button>
    </span>
  );
  if (!combined) {
    return <StationGauge s={{ ...s, label: `OP150 · ${s.label}` }} on={picked === s.key} onPick={onPick} max={max} width={width} extra={toggle} />;
  }
  const status = st(totPct);
  return (
    <div className="ra-gc-item" style={cardStyle(status, width)} title={`OP150 leak test, 3 machines together: ${fmtInt(tot.ok)} OK · ${fmtInt(tot.ng)} NG — NG ${fmtPct(totPct, 2)}`}>
      <span className="ra-gc-head"><b><i className="ra-gc-dot" aria-hidden="true" />OP150</b>{toggle}</span>
      <span className="ra-gc-name">Leak test · LT-1 + LT-2 + LT-3</span>
      <QualityGauge value={totPct} max={max} size="lg" decimals={dec(totPct)} ariaLabel={`OP150 all machines NG ${fmtPct(totPct, 2)}`} />
      <OkNg ok={tot.ok} ng={tot.ng} />
      <span className="ra-gc-lts">
        {machines.map((m) => (
          <button key={m.key} type="button" onClick={() => onPick(m.key)} className={picked === m.key ? "on" : ""} title={`${m.label}: click for its pictorial view`}>
            <i style={{ background: STATUS_COLOR[st(m.ngPct)] }} />{m.label}
            <span>{fmtInt(m.ok)} / <b style={{ color: OUTCOME_COLOR.ng }}>{fmtInt(m.ng)}</b></span>
            <em style={{ color: STATUS_COLOR[st(m.ngPct)] }}>{fmtPct(m.ngPct, 1)}</em>
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * items: [{ type: "line" } | { type: "shot", shot } | { type: "station", s } | { type: "leak", machines }]
 */
export default function GateCarousel({ items, picked, onPick, max }) {
  const [ref, w] = useWidth();
  const [idx, setIdx] = useState(0);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  const per = Math.max(1, Math.floor((w + GAP) / (CARD_MIN + GAP)));
  const itemW = w > 0 ? (w - GAP * (per - 1)) / per : CARD_MIN;
  const maxIdx = Math.max(0, items.length - per);
  const pos = Math.min(idx, maxIdx);
  const paused = hover || focus || userPaused;

  useEffect(() => {
    if (paused || reduced || maxIdx === 0) return undefined;
    const t = setInterval(() => setIdx((x) => (Math.min(x, maxIdx) >= maxIdx ? 0 : Math.min(x, maxIdx) + 1)), AUTO_MS);
    return () => clearInterval(t);
  }, [paused, reduced, maxIdx]);

  const go = useCallback((d) => setIdx((x) => {
    const cur = Math.min(x, maxIdx);
    const n = cur + d;
    return n < 0 ? maxIdx : n > maxIdx ? 0 : n;
  }), [maxIdx]);

  return (
    <div
      className="ra-gc"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocus(true)}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocus(false); }}
    >
      <div className="ra-gc-top">
        <div className="ra-gc-legend">
          <span><i style={{ background: STATUS_COLOR.good }} />≤ {TARGETS.scrapPct}% on target</span>
          <span><i style={{ background: STATUS_COLOR.warn }} />≤ {TARGETS.scrapPct + TARGETS.amberBandPp}% near limit</span>
          <span><i style={{ background: STATUS_COLOR.bad }} />above limit</span>
        </div>
        <div className="ra-gc-ctrl">
          {maxIdx > 0 && !reduced && (
            <button type="button" className="ra-gc-mini" onClick={() => setUserPaused((p) => !p)} aria-pressed={userPaused} title={userPaused ? "Resume auto-scroll" : "Pause auto-scroll"}>
              {userPaused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}{userPaused ? "Play" : paused ? "Paused" : "Auto"}
            </button>
          )}
        </div>
      </div>
      <div className="ra-gc-row">
        <button type="button" className="ra-gc-nav" onClick={() => go(-1)} disabled={maxIdx === 0} aria-label="Previous gauges"><ChevronLeft size={16} /></button>
        <div className="ra-gc-view" ref={ref} role="region" aria-roledescription="carousel" aria-label="Quality-gate gauges">
          <div className="ra-gc-track" style={{ gap: GAP, transform: `translateX(-${pos * (itemW + GAP)}px)` }}>
            {items.map((it) => {
              if (it.type === "shot") return <ShotGauge key="shot" shot={it.shot} on={picked === "OP100"} onPick={onPick} max={max} width={itemW} />;
              if (it.type === "leak") {
                return (
                  <LeakGauge key="leak" machines={it.machines} picked={picked} onPick={onPick} max={max} width={itemW} paused={hover || focus} />
                );
              }
              return <StationGauge key={it.s.key} s={it.s} on={picked === it.s.key} onPick={onPick} max={max} width={itemW} />;
            })}
          </div>
        </div>
        <button type="button" className="ra-gc-nav" onClick={() => go(1)} disabled={maxIdx === 0} aria-label="Next gauges"><ChevronRight size={16} /></button>
      </div>
      {maxIdx > 0 && (
        <div className="ra-gc-dots" role="tablist" aria-label="Carousel position">
          {Array.from({ length: maxIdx + 1 }, (_, j) => (
            <button key={j} type="button" role="tab" aria-selected={j === pos} aria-label={`Show gauges from ${j + 1}`} className={j === pos ? "on" : ""} onClick={() => setIdx(j)} />
          ))}
        </div>
      )}
    </div>
  );
}
