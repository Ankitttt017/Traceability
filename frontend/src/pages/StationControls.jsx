import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Save, Settings2, ChevronDown, Info } from "lucide-react";
import { machineApi, stationSettingsApi } from "../api/services";
import GlobalPopup from "../components/GlobalPopup";
import { getMachineStage } from "../utils/machineFields";
import {
  DEFAULT_STATION_FEATURES,
  getStationFeatureSettings,
  mergeStationFeatureSettings,
  normalizeStationKey,
  saveStationFeatureSettings,
} from "../utils/stationSettings";

const T = {
  blue: "#3b82f6",
  violet: "#8b5cf6",
  teal: "#14b8a6",
  rose: "#f43f5e",
  emerald: "#10b981",
  sky: "#0ea5e9",
  navy: "#0f172a",
};

/* -- Toggle component --------------------------------------- */
const Toggle = ({ checked, onChange, color = "blue" }) => {
  const colorMap = {
    blue:   { on: "#3b82f6", glow: "rgba(59,130,246,0.25)" },
    teal:   { on: "#14b8a6", glow: "rgba(20,184,166,0.25)" },
    violet: { on: "#8b5cf6", glow: "rgba(139,92,246,0.25)" },
    rose:   { on: "#f43f5e", glow: "rgba(244,63,94,0.25)"  },
    emerald:{ on: "#10b981", glow: "rgba(16,185,129,0.25)" },
    sky:    { on: "#0ea5e9", glow: "rgba(14,165,233,0.25)" },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: 36,
        height: 18,
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        padding: 0,
        transition: "background 0.22s ease, box-shadow 0.22s ease",
        background: checked ? c.on : "rgba(148,163,184,0.18)",
        boxShadow: checked ? `0 0 0 2px ${c.glow}` : "none",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: checked ? 19 : 2,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
          transition: "left 0.22s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
};

/* -- Portal Tooltip component (rendered outside table) --------------------------------------- */
const Tooltip = ({ children, content }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  let timeoutRef = null;

  const handleMouseEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({
      top: rect.top,
      left: rect.left + rect.width / 2,
    });
    if (timeoutRef) clearTimeout(timeoutRef);
    setVisible(true);
  };

  const handleMouseLeave = () => {
    if (timeoutRef) clearTimeout(timeoutRef);
    setVisible(false);
  };

  return (
    <>
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: "help", display: "inline-flex", alignItems: "center" }}
      >
        {children}
      </div>
      {visible && createPortal(
        <div
          style={{
            position: "fixed",
            top: position.top - 10,
            left: position.left,
            transform: "translateX(-50%) translateY(-100%)",
            padding: "8px 14px",
            background: "#0f172a",
            color: "#f1f5f9",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 8,
            zIndex: 9999,
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            pointerEvents: "none",
            fontFamily: "var(--font-outfit)",
            maxWidth: 350,
            whiteSpace: "normal",
            lineHeight: 1.4,
          }}
        >
          {content}
          <div
            style={{
              position: "absolute",
              bottom: -5,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid #0f172a",
            }}
          />
        </div>,
        document.body
      )}
    </>
  );
};

/* -- Feature column config ---------------------------------- */
const FEATURE_COLS = [
  { key: "qr", label: "QR", desc: "Barcode / QR scan validation", color: "blue", type: "toggle" },
  { key: "operation", label: "OP", desc: "Operation sequence check", color: "violet", type: "toggle" },
  { key: "qualityCheck", label: "QC", desc: "Enable quality validation steps", color: "teal", type: "toggle" },
  { key: "manualResult", label: "Manual", desc: "Operator manual OK/NG result", color: "emerald", type: "toggle" },
  { key: "rejectionBin", label: "Reject", desc: "Rejection bin routing", color: "rose", type: "toggle" },
  { key: "rejectionBinStatus", label: "Bin Full", desc: "Read bin-full feedback", color: "rose", type: "toggle" },
  { key: "rework", label: "Rework", desc: "Allow reworked part scanning", color: "sky", type: "toggle" },
  { key: "labelPrint", label: "Label", desc: "Trigger label printing", color: "violet", type: "toggle" },
  { key: "camera", label: "Camera", desc: "Vision system integration", color: "violet", type: "toggle" },
  { key: "torque", label: "Torque", desc: "Torque/force measurement", color: "teal", type: "toggle" },
  { key: "partPresence", label: "Presence", desc: "Part seated verification", color: "blue", type: "toggle" },
  { key: "finalPacking", label: "Final", desc: "End-of-line packing gate", color: "emerald", type: "toggle" },
  { key: "plcPartCount", label: "Pcs", desc: "Parts per PLC trigger", color: "sky", type: "number" },
];

/* -- Color dot for column header ---------------------------- */
const DOT_COLORS = {
  blue: "#3b82f6",
  violet: "#8b5cf6",
  teal: "#14b8a6",
  rose: "#f43f5e",
  sky: "#0ea5e9",
  emerald: "#10b981",
};

/* -- Main component ----------------------------------------- */
const StationControl = () => {
  const [machines, setMachines] = useState([]);
  const [lineFilter, setLineFilter] = useState("");
  const [stationSettings, setStationSettings] = useState(() => getStationFeatureSettings());
  const [loading, setLoading] = useState(true);
  const [popup, setPopup] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const stationRows = useMemo(() => {
    const grouped = new Map();
    for (const machine of machines) {
      const stationNo = normalizeStationKey(getMachineStage(machine));
      if (!stationNo) continue;
      if (!grouped.has(stationNo)) {
        grouped.set(stationNo, {
          stationNo,
          lineNames: new Set(),
          sequenceNo: Number(machine.sequenceNo || 9999),
          machines: [],
          hasSpc: false,
          bypassedCount: 0,
        });
      }
      const row = grouped.get(stationNo);
      row.lineNames.add(String(machine.lineName || "-").trim() || "-");
      row.hasSpc = row.hasSpc || machine?.spcConfig?.enabled === true;
      row.bypassedCount += machine?.machineBypassEnabled ? 1 : 0;
      row.machines.push({
        id: machine.id,
        machineName: machine.machineName || `Machine ${machine.id}`,
        sequenceNo: Number(machine.sequenceNo || 9999),
        operationNo: getMachineStage(machine),
        machineBypassEnabled: Boolean(machine?.machineBypassEnabled),
        machineBypassReason: machine?.machineBypassReason || null,
      });
      row.sequenceNo = Math.min(row.sequenceNo, Number(machine.sequenceNo || 9999));
    }
    return Array.from(grouped.values())
      .map((row) => ({
        ...row,
        lineNames: Array.from(row.lineNames).sort((a, b) => a.localeCompare(b)),
        machines: [...row.machines].sort((a, b) => a.sequenceNo - b.sequenceNo),
      }))
      .sort((a, b) => a.sequenceNo - b.sequenceNo);
  }, [machines]);

  const availableLines = useMemo(
    () =>
      Array.from(
        new Set(
          stationRows
            .flatMap((row) => row.lineNames || [])
            .map((entry) => String(entry || "").trim())
            .filter((entry) => entry && entry !== "-")
        )
      ).sort((a, b) => a.localeCompare(b)),
    [stationRows]
  );

  const filteredStationRows = useMemo(() => {
    if (!lineFilter) return stationRows;
    return stationRows.filter((row) => (row.lineNames || []).includes(lineFilter));
  }, [lineFilter, stationRows]);

  const stationKeys = useMemo(() => stationRows.map((e) => e.stationNo), [stationRows]);
  const normalizedSettings = useMemo(
    () => mergeStationFeatureSettings(stationKeys, stationSettings),
    [stationKeys, stationSettings]
  );

  const loadData = useCallback(async ({ silent = false, refreshSettings = true } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [m, s] = await Promise.all([
        machineApi.list(),
        refreshSettings ? stationSettingsApi.list().catch(() => null) : Promise.resolve(null),
      ]);
      setMachines(m || []);
      if (refreshSettings) {
        const localSettings = getStationFeatureSettings();
        if (s && typeof s === "object") {
          const merged = Object.entries(s).reduce((acc, [stationNo, serverCfg]) => {
            acc[stationNo] = { ...(serverCfg || {}) };
            return acc;
          }, {});
          Object.entries(localSettings || {}).forEach(([stationNo, localCfg]) => {
            if (!merged[stationNo]) merged[stationNo] = { ...(localCfg || {}) };
          });
          setStationSettings(merged);
        } else {
          setStationSettings(localSettings);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const timer = setInterval(() => loadData({ silent: true, refreshSettings: false }), 10000);
    return () => clearInterval(timer);
  }, [loadData]);
  useEffect(() => { saveStationFeatureSettings(stationSettings); }, [stationSettings]);

  const updateField = (stationNo, key, value) => {
    setStationSettings((prev) => ({
      ...prev,
      [stationNo]: { ...(prev[stationNo] || {}), [key]: value },
    }));
  };

  const saveSettings = async () => {
    try {
      await stationSettingsApi.save(normalizedSettings);
      setPopup({ type: "SUCCESS", title: "Settings Saved", message: "Station protocols have been synchronized." });
    } catch (err) {
      setPopup({ type: "ERROR", title: "Save Error", message: err.response?.data?.error || "Unable to save station configuration." });
    }
  };



  return (
    <div className="space-y-6 rise-in text-slate-900" style={{ fontFamily: "var(--font-outfit)" }}>
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} />

      {/* Header */}
      <div className="db-header-card mb-6">
        <div className="db-header-gradient-bar" />
        <div className="db-header-inner">
          <div className="db-header-title-group">
            <div className="db-header-icon-box">
              <Settings2 size={22} />
            </div>
            <div>
              <h1 className="db-header-title">Station Control</h1>
              <p className="db-header-subtitle">Configure station protocols &amp; logic parameters</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => loadData({ silent: false })} className="db-action-btn">
              <RefreshCw size={14} /> Refresh
            </button>
            <button onClick={saveSettings} className="db-action-btn">
              <Save size={14} /> Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="industrial-card p-20 flex flex-col items-center justify-center text-slate-700/80">
          <RefreshCw size={48} className="animate-spin mb-4" />
          <p className="text-xs font-black uppercase tracking-widest">Loading station data...</p>
        </div>
      ) : (
        <div className="industrial-card p-0 overflow-hidden">
          <div className="px-6 py-2 border-b border-border bg-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Stations Directory</h2>
              
    
            </div>

            {/* Dropdown */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowDropdown(!showDropdown)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(15,23,42,0.12)", background: "#fff", fontSize: 11, fontWeight: 600, color: "#0f172a", cursor: "pointer" }}
              >
                {lineFilter ? `Line: ${lineFilter}` : "All Lines"}
                <ChevronDown size={12} style={{ opacity: 0.6 }} />
              </button>
              {showDropdown && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setShowDropdown(false)} />
                  <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, minWidth: 160, background: "#fff", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid rgba(15,23,42,0.08)", zIndex: 10, overflow: "hidden" }}>
                    <div onClick={() => { setLineFilter(""); setShowDropdown(false); }} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", color: "#0f172a", borderBottom: "1px solid rgba(0,0,0,0.05)", background: !lineFilter ? "rgba(59,130,246,0.08)" : "transparent" }}>
                      All Lines
                    </div>
                    {availableLines.map((line) => (
                      <div key={line} onClick={() => { setLineFilter(line); setShowDropdown(false); }} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", color: "#0f172a", background: lineFilter === line ? "rgba(59,130,246,0.08)" : "transparent" }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Slim scrollbar */}
          <style>{`
            .custom-scrollbar::-webkit-scrollbar { height: 6px; }
            .custom-scrollbar::-webkit-scrollbar-track { background: rgba(15,23,42,0.05); border-radius: 3px; }
            .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(15,23,42,0.2); border-radius: 3px; }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(15,23,42,0.3); }
          `}</style>

          <div className="custom-scrollbar overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
            <table className="w-full text-left" style={{ minWidth: 1000 }}>
              <thead>
                <tr style={{ background: "rgba(15,23,42,0.04)", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
                  <th style={{ padding: "12px 16px", width: 280 }}><span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(15,23,42,0.75)" }}>Station / Line</span></th>
                  <th style={{ padding: "12px 12px", width: 80, textAlign: "center" }}><span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(15,23,42,0.75)" }}>Status</span></th>
                  {FEATURE_COLS.map((col) => (
                    <th key={col.key} style={{ padding: "12px 10px", textAlign: "center", width: 65 }}>
                      <Tooltip content={col.desc}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "help" }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: DOT_COLORS[col.color], boxShadow: `0 0 3px ${DOT_COLORS[col.color]}`, display: "block" }} />
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: "rgba(15,23,42,0.75)", whiteSpace: "nowrap" }}>{col.label}</span>
                            <Info size={8} style={{ opacity: 0.4 }} />
                          </div>
                        </div>
                      </Tooltip>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredStationRows.map((row, idx) => {
                  const config = normalizedSettings[row.stationNo] || DEFAULT_STATION_FEATURES;
                  const isEven = idx % 2 === 1;
                  return (
                    <tr key={row.stationNo} style={{ background: isEven ? "rgba(15,23,42,0.02)" : "transparent", borderBottom: "1px solid rgba(15,23,42,0.06)", transition: "background 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.03)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = isEven ? "rgba(15,23,42,0.02)" : "transparent"; }}>
                      <td style={{ padding: "12px 16px" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ width: 3, height: 18, borderRadius: 2, background: T.blue, flexShrink: 0 }} />
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <p style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 13, color: "#0f172a", margin: 0 }}>{row.stationNo}</p>
                                <span style={{ fontSize: 9, color: "rgba(51,65,85,0.5)", fontWeight: 600, background: "rgba(0,0,0,0.03)", padding: "2px 6px", borderRadius: 4 }}>SEQ {String(row.sequenceNo).padStart(2, "0")}</span>
                              </div>
                              {row.lineNames.length > 0 && row.lineNames[0] !== "-" && (
                                <div style={{ marginTop: 4 }}>
                                  <span style={{ fontSize: 9, color: "rgba(59,130,246,0.7)", fontWeight: 600, background: "rgba(59,130,246,0.08)", padding: "2px 8px", borderRadius: 4, display: "inline-block" }}>
                                    {row.lineNames.join(", ")}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 12px", textAlign: "center" }}>
                        {row.bypassedCount > 0 ? (
                          <Tooltip content={
                            <div style={{ padding: "4px 0" }}>
                              <strong>Bypassed Machines:</strong>
                              <ul style={{ margin: "4px 0 0 0", paddingLeft: 16 }}>
                                {row.machines.filter(m => m.machineBypassEnabled).map(m => <li key={m.id} style={{ marginTop: 2 }}>{m.machineName}{m.machineBypassReason && ` (${m.machineBypassReason})`}</li>)}
                              </ul>
                            </div>
                          }>
                            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 55, height: 20, borderRadius: 5, fontSize: 8, fontWeight: 800, textTransform: "uppercase", color: "#b45309", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)", cursor: "help", padding: "0 6px" }}>
                              {row.bypassedCount === row.machines.length ? "Bypassed" : `${row.bypassedCount}/${row.machines.length}`}
                            </span>
                          </Tooltip>
                        ) : (
                          <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(34,197,94,0.8)", textTransform: "uppercase", letterSpacing: "0.05em", background: "rgba(34,197,94,0.08)", padding: "2px 8px", borderRadius: 5, display: "inline-block" }}>Active</span>
                        )}
                      </td>
                      {FEATURE_COLS.map((col) => (
                        <td key={col.key} style={{ padding: "12px 10px", textAlign: "center" }}>
                          {col.type === "toggle" ? (
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <Toggle checked={Boolean(config[col.key])} color={col.color} onChange={(val) => updateField(row.stationNo, col.key, val)} />
                            </div>
                          ) : (
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <input type="number" min={1} max={20} value={config[col.key] || 1} onChange={(e) => updateField(row.stationNo, col.key, Number(e.target.value))} style={{ width: 40, height: 22, borderRadius: 5, border: "1px solid rgba(15,23,42,0.1)", background: "rgba(15,23,42,0.03)", color: "#0f172a", fontFamily: "var(--font-outfit)", fontWeight: 800, fontSize: 11, textAlign: "center", outline: "none" }} />
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {filteredStationRows.length === 0 && (
                  <tr><td colSpan={FEATURE_COLS.length + 3} style={{ padding: "60px 24px", textAlign: "center", color: "rgba(51,65,85,0.85)", fontSize: 13, fontWeight: 600 }}>No stations configured for the selected line.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default StationControl;