import React, { useMemo } from "react";
import { Factory, CheckCircle2, XCircle, Hourglass, MapPin, Target, Workflow } from "lucide-react";
import { ACCENT, CARD_CSS, accent, fmtInt, fmtPct } from "./chartTheme";

/* ═══════════════════════════════════════════════════════════════════════════
   Page-level KPI strip — shown above the tabs, so the headline numbers stay in view on every tab.
   Same definitions as before (they used to live inside Station Overview):
   • Final OK = max(summary OK, OP160 OK) — two sources for the same number; a lagging summary never hides passes
   • NG = summary NG (any station NG or leak NG) · In process = produced − OK − NG
   • FPY = OK ÷ (OK + NG) · RTY = Π FPY of every station (the three leak machines = one OP150 step)
   ═══════════════════════════════════════════════════════════════════════════ */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pctOf = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);
const isLeak = (c) => { const u = String(c || "").toUpperCase(); return u === "OP150" || u.includes("LEAK"); };
const opNo = (c) => (isLeak(c) ? 150 : Number(String(c || "").match(/OP\s*(\d+)/i)?.[1]) || 999);

const CSS = `
.rkpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 14px}
.rkpi .ra-kpi{padding:10px 12px;border-radius:12px}
.rkpi .ra-kpi{display:flex;flex-direction:column;justify-content:space-between;gap:6px}
.rkpi .ra-kpi-value{font-size:22px;line-height:1.15;font-variant-numeric:tabular-nums}
.rkpi .ra-kpi-top .ra-icon{width:24px;height:24px;border-radius:7px}
`;

export default function RejectionKpiStrip({ summary = {}, qualityGates = [] }) {
  const k = useMemo(() => {
    const gates = qualityGates || [];
    const op160 = gates.find((g) => String(g.code || "").toUpperCase().includes("OP160"));
    const ok = Math.max(num(summary.totalOK), num(op160?.okCount));
    const gateNg = gates.reduce((s, g) => s + num(g.ngCount), 0);
    const ng = summary.totalNG !== undefined && summary.totalNG !== null && summary.totalNG !== "" ? num(summary.totalNG) : gateNg;
    const produced = num(summary.totalProduction);
    const done = ok + ng;
    const wip = produced > 0 ? Math.max(0, produced - ok - ng) : Number.isFinite(Number(summary.inProgress)) ? num(summary.inProgress) : null;

    // RTY over the serial flow; leak machines run in parallel → one step
    const steps = {};
    gates.forEach((g) => {
      const key = isLeak(g.code) ? "OP150" : String(g.code || "").toUpperCase();
      const s = steps[key] || (steps[key] = { ok: 0, ng: 0 });
      s.ok += Math.max(0, num(g.okCount)); s.ng += Math.max(0, num(g.ngCount));
    });
    const fpys = Object.keys(steps).sort((a, b) => opNo(a) - opNo(b)).map((c) => steps[c]).filter((s) => s.ok + s.ng > 0).map((s) => s.ok / (s.ok + s.ng));
    const rty = fpys.length ? fpys.reduce((a, b) => a * b, 1) : null;

    const top = [...gates].sort((a, b) => num(b.ngCount) - num(a.ngCount))[0];
    const hot = !top || !num(top.ngCount)
      ? { title: gates.length ? "None" : (summary.topHotspotStation || "—"), sub: gates.length ? "No rejects at any station" : "No station data" }
      : {
        title: top.shortLabel || String(top.code).replace(/^Leak-Test-0?(\d)$/i, "Leak-Test-$1").replace(/^Leak Test-0?(\d)$/i, "Leak-Test-$1"),
        sub: `${fmtInt(top.ngCount)} NG · ${fmtPct(pctOf(num(top.ngCount), num(top.okCount) + num(top.ngCount)))} of inspected · ${fmtPct(pctOf(num(top.ngCount), gateNg), 0)} of all NG`,
      };
    return { ok, ng, produced, done, wip, rty, hot };
  }, [summary, qualityGates]);

  const cards = [
    { label: "Parts produced", icon: Factory, color: ACCENT.process, value: fmtInt(k.produced), sub: "All tracked castings in the period" },
    { label: "Final OK", icon: CheckCircle2, color: ACCENT.ok, value: fmtInt(k.ok), sub: `${fmtPct(pctOf(k.ok, k.produced))} of parts produced` },
    { label: "Rejected (NG)", icon: XCircle, color: ACCENT.ng, value: fmtInt(k.ng), sub: `${fmtPct(pctOf(k.ng, k.done))} of completed (OK + NG)`, title: "NG ÷ (final OK + NG)" },
    { label: "In process", icon: Hourglass, color: ACCENT.wip, value: k.wip == null ? "—" : fmtInt(k.wip), sub: "Produced − final OK − NG" },
    { label: "First-pass yield", icon: Target, color: ACCENT.quality, value: fmtPct(pctOf(k.ok, k.done)), sub: "OK ÷ (OK + NG)", title: "Final OK ÷ (final OK + NG)" },
    { label: "Rolled throughput yield", icon: Workflow, color: ACCENT.quality, value: k.rty == null ? "—" : fmtPct(k.rty * 100, 2), sub: "Product of station FPYs", title: "RTY = FPY(OP100) × FPY(OP110) × … × FPY(OP160); FPY = OK ÷ (OK + NG) at each step" },
    { label: "Most rejects at", icon: MapPin, color: ACCENT.location, value: k.hot.title, sub: k.hot.sub },
  ];

  return (
    <>
      <style>{CARD_CSS + CSS}</style>
      <div className="rkpi" aria-label="Key figures for the selected period">
        {cards.map((c) => (
          <div key={c.label} className="ra-kpi" data-accent style={accent(c.color)}>
            <div className="ra-kpi-top">
              <span className="ra-icon" aria-hidden="true"><c.icon size={13} /></span>
              <span className="ra-kpi-label">{c.label}</span>
            </div>
            <div className="ra-kpi-value">{c.value}</div>
          </div>
        ))}
      </div>
    </>
  );
}
