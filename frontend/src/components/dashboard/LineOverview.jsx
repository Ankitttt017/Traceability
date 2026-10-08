import React from "react";
import { Target, Gauge, Activity, Crosshair } from "lucide-react";
import InfoTip from "../../pages/Rejection/components/InfoTip";

/* ═══════════════════════════════════════════════════════════════════════════
   Line performance overview — OEE, OA, the three OEE pillars and output against target.
   Benchmarks are the common world-class references: OEE ≥ 85 %, Availability ≥ 90 %, Performance ≥ 95 %,
   Quality ≥ 99.9 %. Colours carry state only: green = at/above benchmark, amber = close, red = attention.
   ═══════════════════════════════════════════════════════════════════════════ */

const INK = { pri: "#0f172a", sec: "#334155", body: "#475569", muted: "#64748b", faint: "#94a3b8", border: "#e2e8f0", grid: "#f1f5f9", surf: "#ffffff", alt: "#f8fafc" };
const GOOD = "#16a34a", WARN = "#d97706", BAD = "#dc2626", NAVY = "#1e3a8a";
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct1 = (v) => `${num(v).toFixed(1)}%`;
const stateColor = (v, good, warn) => (v >= good ? GOOD : v >= warn ? WARN : BAD);
const stateText = (v, good, warn) => (v >= good ? "On benchmark" : v >= warn ? "Below benchmark" : "Needs attention");

const INFO = {
  title: "Line performance",
  what: "How well the line used its planned time. OEE combines availability (running time), performance (speed against ideal cycle) and quality (good parts). OA is the share of planned time the line was available to run. Target vs actual compares completed parts with the scheduled quantity for the period.",
  formula: ["OEE = Availability × Performance × Quality", "Availability = run time ÷ planned time", "Performance = (ideal cycle × parts) ÷ run time", "Quality = OK ÷ (OK + NG)", "Achievement = completed parts ÷ target × 100"],
  note: "World-class references: OEE ≥ 85 %, A ≥ 90 %, P ≥ 95 %, Q ≥ 99.9 %.",
};

const CSS = `
.lo-card{background:${INK.surf};border:1px solid ${INK.border};border-radius:16px;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 22px -12px rgba(15,23,42,.18);overflow:hidden}
.lo-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:16px 20px 12px;border-bottom:1px solid ${INK.grid};background:linear-gradient(180deg,#f8fafc,#fff)}
.lo-title{display:flex;align-items:center;gap:10px}
.lo-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:rgba(30,58,138,.1);color:${NAVY}}
.lo-title h2{margin:0;font-size:15.5px;font-weight:800;color:${INK.pri};display:flex;align-items:center}
.lo-title p{margin:2px 0 0;font-size:11.5px;color:${INK.muted}}
.lo-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;font-size:11.5px;font-weight:700;border:1px solid}
.lo-pill i{width:7px;height:7px;border-radius:50%}
.lo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;padding:16px 20px 20px}
.lo-tile{border:1px solid ${INK.border};border-radius:14px;padding:14px 16px;background:${INK.surf};min-width:0}
.lo-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${INK.muted};display:flex;align-items:center;gap:6px}
.lo-ringrow{display:flex;align-items:center;gap:16px;margin-top:8px}
.lo-big{font-size:26px;font-weight:800;color:${INK.pri};font-variant-numeric:tabular-nums;line-height:1.1}
.lo-sub{font-size:11.5px;color:${INK.body};margin-top:3px}
.lo-state{font-size:11px;font-weight:700;margin-top:6px}
.lo-pillar{margin-top:10px}
.lo-pillar-top{display:flex;justify-content:space-between;font-size:12px;font-weight:600;color:${INK.sec};margin-bottom:4px}
.lo-pillar-top b{font-variant-numeric:tabular-nums;color:${INK.pri}}
.lo-track{position:relative;height:8px;border-radius:4px;background:${INK.grid};overflow:visible}
.lo-fill{height:100%;border-radius:4px}
.lo-mark{position:absolute;top:-3px;width:2px;height:14px;background:${INK.pri};opacity:.55;border-radius:1px}
.lo-foot{display:flex;justify-content:space-between;font-size:11px;color:${INK.muted};margin-top:6px;font-variant-numeric:tabular-nums}
`;

function Ring({ value, color, size = 92, stroke = 10 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, num(value)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${v.toFixed(1)}%`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={INK.grid} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="17" fontWeight="800" fill={INK.pri} style={{ fontVariantNumeric: "tabular-nums" }}>
        {v.toFixed(1)}%
      </text>
    </svg>
  );
}

function Pillar({ label, value, benchmark, warnFrom, color }) {
  const v = Math.max(0, Math.min(100, num(value)));
  const c = color || stateColor(v, benchmark, warnFrom);
  return (
    <div className="lo-pillar" title={`${label}: ${pct1(v)} · benchmark ${benchmark}%`}>
      <div className="lo-pillar-top"><span>{label}</span><b style={{ color: c }}>{pct1(v)}</b></div>
      <div className="lo-track">
        <div className="lo-fill" style={{ width: `${v}%`, background: c }} />
        <div className="lo-mark" style={{ left: `calc(${benchmark}% - 1px)` }} />
      </div>
    </div>
  );
}

/**
 * @param data   { oee, oa, availability, performance, quality, target, actual, status }
 * @param actual completed parts (OK + NG) for the period; falls back to data.actual
 * @param counts { ok, ng, wip } for the period (optional)
 */
export default function LineOverview({ data = {}, actual, counts = null, periodLabel = "" }) {
  const oee = num(data.oee), oa = num(data.oa);
  const done = num(actual ?? data.actual);
  const target = num(data.target);
  const achieved = target > 0 ? (done / target) * 100 : null;
  const statusColor = stateColor(oee, 85, 70);
  return (
    <div className="lo-card">
      <style>{CSS}</style>
      <div className="lo-head">
        <div className="lo-title">
          <span className="lo-icon"><Target size={19} /></span>
          <div>
            <h2>Line performance overview<InfoTip info={INFO} /></h2>
            <p>OEE = Availability × Performance × Quality{periodLabel ? ` · ${periodLabel}` : ""}</p>
          </div>
        </div>
        <span className="lo-pill" style={{ color: statusColor, borderColor: `${statusColor}55`, background: `${statusColor}12` }}>
          <i style={{ background: statusColor }} />{data.status || stateText(oee, 85, 70)}
        </span>
      </div>

      <div className="lo-grid">
        <div className="lo-tile">
          <div className="lo-label"><Gauge size={13} />Line OEE</div>
          <div className="lo-ringrow">
            <Ring value={oee} color={stateColor(oee, 85, 70)} />
            <div>
              <div className="lo-big">{pct1(oee)}</div>
              <div className="lo-sub">Benchmark ≥ 85%</div>
              <div className="lo-state" style={{ color: stateColor(oee, 85, 70) }}>{stateText(oee, 85, 70)}</div>
            </div>
          </div>
        </div>

        <div className="lo-tile">
          <div className="lo-label"><Activity size={13} />Line OA</div>
          <div className="lo-ringrow">
            <Ring value={oa} color={stateColor(oa, 90, 80)} />
            <div>
              <div className="lo-big">{pct1(oa)}</div>
              <div className="lo-sub">Operational availability</div>
              <div className="lo-state" style={{ color: stateColor(oa, 90, 80) }}>{stateText(oa, 90, 80)}</div>
            </div>
          </div>
        </div>

        <div className="lo-tile">
          <div className="lo-label">OEE pillars <span style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>| = benchmark</span></div>
          <Pillar label="Availability" value={data.availability} benchmark={90} warnFrom={80} />
          <Pillar label="Performance" value={data.performance} benchmark={95} warnFrom={85} />
          <Pillar label="Quality" value={data.quality} benchmark={99.9} warnFrom={97} />
        </div>

        <div className="lo-tile">
          <div className="lo-label"><Crosshair size={13} />Target vs actual</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 10 }}>
            <span className="lo-big">{done.toLocaleString()}</span>
            <span style={{ fontSize: 13, color: INK.muted, fontVariantNumeric: "tabular-nums" }}>/ {target > 0 ? target.toLocaleString() : "—"}</span>
            {achieved != null && <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: stateColor(achieved, 100, 90) }}>{achieved.toFixed(1)}%</span>}
          </div>
          <div className="lo-track" style={{ marginTop: 10 }}>
            <div className="lo-fill" style={{ width: `${Math.min(100, achieved ?? 0)}%`, background: achieved == null ? INK.faint : stateColor(achieved, 100, 90) }} />
          </div>
          <div className="lo-foot">
            <span>Completed (OK + NG)</span>
            <span>{target > 0 ? (done >= target ? `+${(done - target).toLocaleString()} over target` : `${(target - done).toLocaleString()} to go`) : "No target set"}</span>
          </div>
          {counts && (
            <div className="lo-foot" style={{ marginTop: 8, justifyContent: "flex-start", gap: 14 }}>
              <span><b style={{ color: GOOD }}>{num(counts.ok).toLocaleString()}</b> OK</span>
              <span><b style={{ color: BAD }}>{num(counts.ng).toLocaleString()}</b> NG</span>
              <span><b style={{ color: INK.sec }}>{num(counts.wip).toLocaleString()}</b> in process</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
