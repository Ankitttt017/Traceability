import React, { useState } from "react";
import { Sliders, Download, X, Search } from "lucide-react";
import { saveAs } from "file-saver";
import { MASTER_RECIPE_SET_PARAMETERS } from "../rejectionConstants";

export default function MasterRecipeModal({ isOpen, onClose, mlInsights = {} }) {
  const [setParamsSearch, setSetParamsSearch] = useState("");
  const [setParamsCategoryFilter, setSetParamsCategoryFilter] = useState("ALL");
  const [setParamsScope, setSetParamsScope] = useState("ALL"); // "ALL", "RECIPE_BOUND", "AI_DYNAMIC"

  if (!isOpen) return null;

  // Resolve dynamic spec for each parameter from live DB / ML features
  const resolveParam = (p) => {
    const feat = mlInsights.features?.find(f => f.key === p.key || (p.altKeys && p.altKeys.includes(f.key)));
    const hasLimits = (feat && feat.hasStaticLimits && feat.setLowerLimit !== null && feat.setUpperLimit !== null)
      ? true
      : Boolean(p.hasStaticLimits && p.defaultLower !== null && p.defaultUpper !== null);

    const lsl = (feat && feat.setLowerLimit !== null && feat.setLowerLimit !== undefined)
      ? feat.setLowerLimit
      : (hasLimits ? p.defaultLower : null);

    const usl = (feat && feat.setUpperLimit !== null && feat.setUpperLimit !== undefined)
      ? feat.setUpperLimit
      : (hasLimits ? p.defaultUpper : null);

    const nominal = (feat && feat.setPoint !== null && feat.setPoint !== undefined)
      ? feat.setPoint
      : (hasLimits ? p.setPoint : null);

    const unit = (feat && feat.unit) ? feat.unit : p.unit;
    const liveMean = feat?.meanNg && feat.meanNg > 0 ? feat.meanNg : (feat?.meanOk && feat.meanOk > 0 ? feat.meanOk : null);

    return { p, feat, hasLimits, lsl, usl, nominal, unit, liveMean };
  };

  const resolvedList = MASTER_RECIPE_SET_PARAMETERS.map(resolveParam);
  const recipeBoundParams = resolvedList.filter(item => item.hasLimits);
  const telemetryOnlyParams = resolvedList.filter(item => !item.hasLimits);
  const totalParams = resolvedList.length;

  // Compute how many recipe-bound params have live data with drift
  let driftUpCount = 0, driftDownCount = 0, optimalCount = 0;
  recipeBoundParams.forEach(item => {
    if (item.liveMean !== null && item.nominal !== null) {
      const d = item.liveMean - item.nominal;
      if (d > 0.05) driftUpCount++;
      else if (d < -0.05) driftDownCount++;
      else optimalCount++;
    }
  });

  return (
    <div
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(15, 23, 42, 0.6)",
        backdropFilter: "blur(8px)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        animation: "fadeIn 0.15s ease-out",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(226,232,240,0.6)",
          width: "100%",
          maxWidth: 1340,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── HEADER ── */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg, #3b82f6, #2563eb)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
              <Sliders size={16} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.01em" }}>
                Master Casting Recipe &amp; Parameter Intelligence
              </h3>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => {
                const csvContent = [
                  ["#", "Parameter", "DB Key", "Subsystem", "LSL", "Nominal", "USL", "Live Value", "Drift", "Mode", "Unit"],
                  ...resolvedList.map(({ p, hasLimits, lsl, nominal, usl, liveMean, unit }) => {
                    const drift = (liveMean !== null && nominal !== null) ? (liveMean - nominal).toFixed(2) : "—";
                    return [
                      p.id, p.label, p.key, p.category,
                      hasLimits ? (lsl !== null ? lsl : "—") : "—",
                      hasLimits ? (nominal !== null ? nominal : "—") : "—",
                      hasLimits ? (usl !== null ? usl : "—") : "—",
                      liveMean !== null ? liveMean : "—",
                      drift !== "—" ? `${drift > 0 ? "+" : ""}${drift}` : "—",
                      hasLimits ? "Recipe Bound" : "Telemetry Only",
                      unit,
                    ];
                  }),
                ].map((e) => e.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
                const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
                saveAs(blob, `Master_Recipe_${new Date().toISOString().slice(0,10)}.csv`);
              }}
              style={{ fontSize: 10.5, display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontWeight: 700, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, color: "#fff", cursor: "pointer", transition: "all 0.15s ease" }}
              title="Export to CSV"
            >
              <Download size={12} />
              <span>Export</span>
            </button>
            <button
              onClick={onClose}
              style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.7)", transition: "all 0.15s ease" }}
              title="Close (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── STATS STRIP ── */}
        <div style={{ padding: "8px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "Recipe Gated", value: `${recipeBoundParams.length}`, sub: "LSL/USL Enforced", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
            { label: "Telemetry Only", value: `${telemetryOnlyParams.length}`, sub: "No Set Limits", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
            { label: "Optimal", value: `${optimalCount}`, sub: "Within ±0.05", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
            { label: "Drifting ▲", value: `${driftUpCount}`, sub: "Above Target", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
            { label: "Drifting ▼", value: `${driftDownCount}`, sub: "Below Target", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
          ].map((tile) => (
            <div key={tile.label} style={{ flex: "1 1 140px", padding: "6px 10px", borderRadius: 6, background: tile.bg, border: `1px solid ${tile.border}`, minWidth: 120 }}>
              <div style={{ fontSize: 9.5, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{tile.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 1 }}>
                <span style={{ fontSize: 16, fontWeight: 900, color: tile.color }}>{tile.value}</span>
                <span style={{ fontSize: 9.5, color: tile.color, fontWeight: 600, opacity: 0.8 }}>{tile.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* ── TOOLBAR: SEARCH + SCOPE + CATEGORY ── */}
        <div style={{ padding: "8px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#fff" }}>
          {/* Search */}
          <div style={{ position: "relative", width: 240 }}>
            <Search size={13} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
            <input
              type="text" placeholder="Search parameters..."
              value={setParamsSearch} onChange={(e) => setSetParamsSearch(e.target.value)}
              style={{ width: "100%", padding: "5px 8px 5px 26px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 11, outline: "none", background: "#f8fafc" }}
            />
            {setParamsSearch && (
              <button onClick={() => setSetParamsSearch("")} style={{ position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", cursor: "pointer", color: "#94a3b8", padding: 0 }}>
                <X size={11} />
              </button>
            )}
          </div>

          {/* Scope Switcher */}
          <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden", background: "#f8fafc" }}>
            {[
              { key: "ALL", label: `All (${totalParams})`, activeColor: "#1e293b" },
              { key: "RECIPE_BOUND", label: `Recipe (${recipeBoundParams.length})`, activeColor: "#16a34a" },
              { key: "AI_DYNAMIC", label: `Telemetry (${telemetryOnlyParams.length})`, activeColor: "#7c3aed" },
            ].map((s, i) => (
              <button
                key={s.key}
                onClick={() => setSetParamsScope(s.key)}
                style={{
                  padding: "4px 10px", fontSize: 10.5, fontWeight: 700, border: "none",
                  borderLeft: i > 0 ? "1px solid #e2e8f0" : "none",
                  cursor: "pointer",
                  background: setParamsScope === s.key ? s.activeColor : "transparent",
                  color: setParamsScope === s.key ? "#fff" : "#475569",
                  transition: "all 0.12s ease",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 20, background: "#e2e8f0" }} />
        </div>

        {/* ── TABLE BODY ── */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 3 }}>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ width: 32, textAlign: "center", padding: "7px 4px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1" }}>#</th>
                <th style={{ textAlign: "left", padding: "7px 8px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1", minWidth: 160 }}>PARAMETER</th>
                <th style={{ textAlign: "left", padding: "7px 8px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1" }}>SUBSYSTEM</th>
                <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#d97706", borderBottom: "2px solid #fde68a", background: "#fffbeb", minWidth: 60 }}>LSL</th>
                <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#2563eb", borderBottom: "2px solid #93c5fd", background: "#eff6ff", minWidth: 70 }}>NOMINAL</th>
                <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#dc2626", borderBottom: "2px solid #fca5a5", background: "#fef2f2", minWidth: 60 }}>USL</th>
                <th style={{ textAlign: "center", padding: "7px 8px", fontSize: 10, fontWeight: 700, color: "#0f172a", borderBottom: "2px solid #cbd5e1", minWidth: 80 }}>LIVE VALUE</th>
                <th style={{ textAlign: "center", padding: "7px 8px", fontSize: 10, fontWeight: 700, color: "#0f172a", borderBottom: "2px solid #cbd5e1", minWidth: 80 }}>DRIFT (Δ)</th>
                <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1", minWidth: 80 }}>MODE</th>
                <th style={{ textAlign: "center", padding: "7px 6px", fontSize: 10, fontWeight: 700, color: "#64748b", borderBottom: "2px solid #cbd5e1", width: 50 }}>UNIT</th>
              </tr>
            </thead>
            <tbody>
              {resolvedList.filter((item) => {
                const { p, hasLimits } = item;
                if (setParamsScope === "RECIPE_BOUND" && !hasLimits) return false;
                if (setParamsScope === "AI_DYNAMIC" && hasLimits) return false;
                if (setParamsCategoryFilter !== "ALL" && p.category !== setParamsCategoryFilter) return false;
                if (setParamsSearch) {
                  const q = setParamsSearch.toLowerCase();
                  return p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q) || item.unit.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q));
                }
                return true;
              }).map((item, idx) => {
                const { p, hasLimits, lsl, nominal, usl, unit, liveMean } = item;

                const targetRef = hasLimits && nominal !== null ? nominal : null;
                const delta = (liveMean !== null && targetRef !== null) ? Number((liveMean - targetRef).toFixed(2)) : null;

                const isUp = delta !== null && delta > 0.05;
                const isDown = delta !== null && delta < -0.05;
                const isOptimal = delta !== null && Math.abs(delta) <= 0.05;

                const rowBg = !hasLimits
                  ? (idx % 2 === 0 ? "rgba(245, 243, 255, 0.4)" : "rgba(245, 243, 255, 0.2)")
                  : (idx % 2 === 0 ? "#ffffff" : "#fafbfc");

                return (
                  <tr key={p.id || p.key} style={{ background: rowBg, borderBottom: "1px solid #f1f5f9", transition: "background 0.1s" }}>
                    <td style={{ textAlign: "center", fontWeight: 700, color: "#94a3b8", padding: "5px 4px", fontSize: 10 }}>{p.id}</td>

                    <td style={{ padding: "5px 8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 11 }}>{p.label}</span>
                        {!hasLimits && (
                          <span style={{ fontSize: 8.5, fontWeight: 700, color: "#7c3aed", background: "#f5f3ff", border: "1px solid #ede9fe", borderRadius: 3, padding: "0px 4px", lineHeight: "16px", letterSpacing: "0.02em" }} title="No recipe limits set — telemetry monitoring only">
                            TELEMETRY
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 9.5, color: "#94a3b8", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", marginTop: 1, fontWeight: 500 }}>{p.key}</div>
                    </td>

                    <td style={{ padding: "5px 8px" }}>
                      <span style={{ background: "#f1f5f9", color: "#475569", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>{p.category}</span>
                    </td>

                    <td style={{ textAlign: "center", padding: "5px 4px", background: hasLimits ? "rgba(251, 191, 36, 0.04)" : "transparent" }}>
                      {hasLimits && lsl !== null ? (
                        <span style={{ fontWeight: 800, color: "#b45309", fontSize: 11 }}>{lsl}</span>
                      ) : (
                        <span style={{ color: "#d4d4d8", fontSize: 11 }}>—</span>
                      )}
                    </td>

                    <td style={{ textAlign: "center", padding: "5px 4px", background: hasLimits ? "rgba(37, 99, 235, 0.04)" : "transparent" }}>
                      {hasLimits && nominal !== null ? (
                        <span style={{ fontWeight: 900, color: "#1d4ed8", fontSize: 11.5, background: "#eff6ff", padding: "1px 6px", borderRadius: 3, border: "1px solid #bfdbfe" }}>{nominal}</span>
                      ) : (
                        <span style={{ color: "#d4d4d8", fontSize: 11 }}>—</span>
                      )}
                    </td>

                    <td style={{ textAlign: "center", padding: "5px 4px", background: hasLimits ? "rgba(239, 68, 68, 0.04)" : "transparent" }}>
                      {hasLimits && usl !== null ? (
                        <span style={{ fontWeight: 800, color: "#b91c1c", fontSize: 11 }}>{usl}</span>
                      ) : (
                        <span style={{ color: "#d4d4d8", fontSize: 11 }}>—</span>
                      )}
                    </td>

                    <td style={{ textAlign: "center", padding: "5px 6px" }}>
                      {liveMean !== null ? (
                        <span style={{ fontWeight: 750, color: "#0f172a", fontSize: 11 }}>
                          {typeof liveMean === 'number' ? (liveMean % 1 !== 0 ? liveMean.toFixed(2) : liveMean) : liveMean}
                          <span style={{ color: "#94a3b8", fontSize: 9, marginLeft: 2 }}>{unit}</span>
                        </span>
                      ) : (
                        <span style={{ color: "#d4d4d8", fontSize: 10, fontStyle: "italic" }}>—</span>
                      )}
                    </td>

                    <td style={{ textAlign: "center", padding: "5px 6px" }}>
                      {hasLimits && delta !== null ? (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 2,
                          fontWeight: 800, fontSize: 10,
                          padding: "1px 5px", borderRadius: 3,
                          background: isUp ? "#fef2f2" : isDown ? "#eff6ff" : "#f0fdf4",
                          color: isUp ? "#dc2626" : isDown ? "#2563eb" : "#16a34a",
                          border: `1px solid ${isUp ? "#fecaca" : isDown ? "#bfdbfe" : "#bbf7d0"}`,
                        }}>
                          {isUp && <>▲ +{Math.abs(delta).toFixed(1)}</>}
                          {isDown && <>▼ −{Math.abs(delta).toFixed(1)}</>}
                          {isOptimal && <>● OK</>}
                        </span>
                      ) : !hasLimits && liveMean !== null ? (
                        <span style={{ color: "#a78bfa", fontSize: 9.5, fontWeight: 600 }} title="No set target — drift cannot be calculated">
                          n/a
                        </span>
                      ) : (
                        <span style={{ color: "#d4d4d8", fontSize: 10 }}>—</span>
                      )}
                    </td>

                    <td style={{ textAlign: "center", padding: "5px 4px" }}>
                      {hasLimits ? (
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: "#15803d",
                          background: "#f0fdf4", border: "1px solid #bbf7d0",
                          padding: "1px 5px", borderRadius: 3,
                          display: "inline-flex", alignItems: "center", gap: 2,
                        }}>
                          Recipe
                        </span>
                      ) : (
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: "#7c3aed",
                          background: "#f5f3ff", border: "1px solid #ddd6fe",
                          padding: "1px 5px", borderRadius: 3,
                          display: "inline-flex", alignItems: "center", gap: 2,
                        }}>
                          <span style={{ fontSize: 8 }}>📡</span> Monitor
                        </span>
                      )}
                    </td>

                    <td style={{ textAlign: "center", padding: "5px 4px" }}>
                      <span style={{ fontWeight: 600, color: "#64748b", fontSize: 10 }}>{unit}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── FOOTER ── */}
        <div style={{ padding: "8px 20px", borderTop: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 10.5, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#16a34a", display: "inline-block" }} /> Recipe-Gated: LSL/USL enforced from standard recipe</span>
            <span style={{ color: "#cbd5e1" }}>|</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "#7c3aed", display: "inline-block" }} /> Telemetry: No set limits — live monitoring only, dash (—) shown</span>
            <span style={{ color: "#cbd5e1" }}>|</span>
            <span>Drift computed only for recipe-bound parameters against nominal setpoint</span>
          </div>
          <button
            onClick={onClose}
            style={{ padding: "5px 14px", fontSize: 11, fontWeight: 700, background: "#1e293b", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
