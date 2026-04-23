import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Settings2 } from "lucide-react";
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
        width: 44,
        height: 24,
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        padding: 0,
        transition: "background 0.22s ease, box-shadow 0.22s ease",
        background: checked ? c.on : "rgba(148,163,184,0.18)",
        boxShadow: checked ? `0 0 0 3px ${c.glow}` : "none",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.22s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
};

/* -- Feature column config ---------------------------------- */
const FEATURE_COLS = [
  {
    key: "qr",
    label: "QR Check",
    desc: "Barcode / QR scan validation",
    color: "blue",
    type: "toggle",
  },
  {
    key: "operation",
    label: "OP Validation",
    desc: "Operation sequence check",
    color: "violet",
    type: "toggle",
  },
  {
    key: "plcConfirmation",
    label: "PLC Handshake",
    desc: "SLMP read/write cycle",
    color: "teal",
    type: "toggle",
  },
  {
    key: "rejectionBin",
    label: "Rework Bin",
    desc: "Rejection bin routing",
    color: "rose",
    type: "toggle",
  },
  {
    key: "manualResult",
    label: "Result",
    desc: "Result input required for station",
    color: "emerald",
    type: "toggle",
  },
  {
    key: "plcPartCount",
    label: "Pcs / Cycle",
    desc: "Parts per PLC trigger",
    color: "sky",
    type: "number",
  },
  {
    key: "finalPacking",
    label: "Final Exit",
    desc: "End-of-line packing gate",
    color: "emerald",
    type: "toggle",
  },
];

/* -- Color dot for column header ---------------------------- */
const DOT_COLORS = {
  blue:    "#3b82f6",
  violet:  "#8b5cf6",
  teal:    "#14b8a6",
  rose:    "#f43f5e",
  sky:     "#0ea5e9",
  emerald: "#10b981",
};

/* -- Main component ----------------------------------------- */
const StationControl = () => {
  const [machines, setMachines] = useState([]);
  const [stationSettings, setStationSettings] = useState(() => getStationFeatureSettings());
  const [loading, setLoading] = useState(true);
  const [popup, setPopup] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);

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
            if (!merged[stationNo]) {
              merged[stationNo] = { ...(localCfg || {}) };
            }
          });
          setStationSettings(merged);
        } else {
          setStationSettings(localSettings);
        }
      }
      setLastSyncAt(new Date());
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

  /* count active toggles across all stations */
  const activeCount = useMemo(() => {
    let n = 0;
    for (const key of stationKeys) {
      const cfg = normalizedSettings[key] || DEFAULT_STATION_FEATURES;
      for (const col of FEATURE_COLS) {
        if (col.type === "toggle" && cfg[col.key]) n++;
      }
    }
    return n;
  }, [normalizedSettings, stationKeys]);

  return (
    <div className="space-y-6 rise-in text-slate-900">
      <GlobalPopup popup={popup} onClose={() => setPopup(null)} />

      {/* -- Header -- */}
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
            {/* live summary pill */}
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px", borderRadius: 999,
              background: "rgba(59,130,246,0.08)",
              border: "1px solid rgba(59,130,246,0.18)",
              fontSize: 11, fontWeight: 700, color: "#3b82f6",
              letterSpacing: "0.04em",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6", animation: "pulse 2s infinite" }} />
              {activeCount} active
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 10px", borderRadius: 999,
              background: "rgba(15,23,42,0.04)",
              border: "1px solid rgba(15,23,42,0.12)",
              fontSize: 10, fontWeight: 700, color: "rgba(15,23,42,0.8)",
              letterSpacing: "0.04em",
            }}>
              Last Sync: {lastSyncAt ? lastSyncAt.toLocaleTimeString() : "--:--:--"}
            </div>
            <button onClick={saveSettings} className="db-action-btn">
              <Save size={14} /> Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* -- Table -- */}
      {loading ? (
        <div className="industrial-card p-20 flex flex-col items-center justify-center text-slate-700/80">
          <RefreshCw size={48} className="animate-spin mb-4" />
          <p className="text-xs font-black uppercase tracking-widest">Loading station data...</p>
        </div>
      ) : (
        <div className="industrial-card p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-white flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">
              Station Protocol Engine
            </h2>
            <p className="text-[10px] text-slate-700 font-semibold uppercase tracking-widest">
              {stationRows.length} station{stationRows.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ minWidth: 900 }}>
              <thead>
                <tr style={{ background: "rgba(15,23,42,0.04)", borderBottom: "1px solid rgba(15,23,42,0.10)" }}>
                  {/* Station col */}
                  <th style={{ padding: "12px 20px", width: 160 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(15,23,42,0.75)" }}>
                      Station
                    </span>
                  </th>
                  <th style={{ padding: "12px 10px", width: 110, textAlign: "center" }}>
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(15,23,42,0.75)" }}>
                      Quality
                    </span>
                  </th>
                  <th style={{ padding: "12px 10px", width: 130, textAlign: "center" }}>
                    <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(15,23,42,0.75)" }}>
                      Bypass
                    </span>
                  </th>

                  {/* Feature cols */}
                  {FEATURE_COLS.map((col) => (
                    <th key={col.key} style={{ padding: "12px 16px", textAlign: "center" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: DOT_COLORS[col.color],
                          boxShadow: `0 0 6px ${DOT_COLORS[col.color]}`,
                          display: "block",
                        }} />
                        <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: "rgba(15,23,42,0.75)", whiteSpace: "nowrap" }}>
                          {col.label}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {stationRows.map((row, idx) => {
                  const config = normalizedSettings[row.stationNo] || DEFAULT_STATION_FEATURES;
                  const isEven = idx % 2 === 1;

                  return (
                    <tr
                      key={row.stationNo}
                      style={{
                        background: isEven ? "rgba(15,23,42,0.03)" : "transparent",
                        borderBottom: "1px solid rgba(15,23,42,0.08)",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(59,130,246,0.04)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = isEven ? "rgba(15,23,42,0.03)" : "transparent"; }}
                    >
                      {/* Station ID cell */}
                      <td style={{ padding: "14px 20px" }}>
                        <p style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 13, color: "#0f172a", letterSpacing: "0.04em", margin: 0 }}>
                          {row.stationNo}
                        </p>
                        <p style={{ fontSize: 9, color: "rgba(51,65,85,0.8)", margin: "2px 0 0", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          SEQ {String(row.sequenceNo).padStart(2, "0")}
                          {row.lineNames[0] && row.lineNames[0] !== "-" ? `  |  ${row.lineNames[0]}` : ""}
                        </p>
                        <p
                          style={{ fontSize: 9, color: "rgba(51,65,85,0.72)", margin: "4px 0 0", fontWeight: 600 }}
                          title={row.machines.map((machine) => machine.machineName).join(", ")}
                        >
                          {row.machines.length} machine{row.machines.length !== 1 ? "s" : ""} mapped
                        </p>
                      </td>
                      <td style={{ padding: "14px 10px", textAlign: "center" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 62,
                            height: 24,
                            borderRadius: 999,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: row.hasSpc ? "#065f46" : "rgba(51,65,85,0.9)",
                            background: row.hasSpc ? "rgba(16,185,129,0.14)" : "rgba(148,163,184,0.15)",
                            border: row.hasSpc ? "1px solid rgba(16,185,129,0.34)" : "1px solid rgba(148,163,184,0.30)",
                          }}
                        >
                          {row.hasSpc ? "Enabled" : "No"}
                        </span>
                      </td>
                      <td style={{ padding: "14px 10px", textAlign: "center" }}>
                        {row.bypassedCount > 0 ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minWidth: 94,
                              height: 24,
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              color: "#b45309",
                              background: "rgba(245,158,11,0.16)",
                              border: "1px solid rgba(245,158,11,0.35)",
                            }}
                            title={row.machines
                              .filter((machine) => machine.machineBypassEnabled)
                              .map((machine) => `${machine.machineName}${machine.machineBypassReason ? ` (${machine.machineBypassReason})` : ""}`)
                              .join(", ")}
                          >
                            {row.bypassedCount === row.machines.length
                              ? "Bypassed"
                              : `${row.bypassedCount}/${row.machines.length}`}
                          </span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minWidth: 94,
                              height: 24,
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              color: "rgba(51,65,85,0.9)",
                              background: "rgba(148,163,184,0.15)",
                              border: "1px solid rgba(148,163,184,0.30)",
                            }}
                          >
                            Normal
                          </span>
                        )}
                      </td>

                      {/* Feature cells */}
                      {FEATURE_COLS.map((col) => (
                        <td key={col.key} style={{ padding: "14px 16px", textAlign: "center" }}>
                          {col.type === "toggle" ? (
                            <div style={{ display: "flex", justifyContent: "center" }}>
                              <Toggle
                                checked={Boolean(config[col.key])}
                                color={col.color}
                                onChange={(val) => updateField(row.stationNo, col.key, val)}
                              />
                            </div>
                          ) : (
                            /* number input for plcPartCount */
                            <input
                              type="number"
                              min={1}
                              max={99}
                              value={config[col.key] || 1}
                              onChange={(e) => updateField(row.stationNo, col.key, Number(e.target.value))}
                              style={{
                                width: 52,
                                height: 28,
                                borderRadius: 7,
                                border: "1px solid rgba(14,165,233,0.25)",
                                background: "rgba(14,165,233,0.06)",
                                color: "#0f172a",
                                fontFamily: "monospace",
                                fontWeight: 800,
                                fontSize: 13,
                                textAlign: "center",
                                outline: "none",
                                cursor: "text",
                              }}
                              onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(14,165,233,0.6)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(14,165,233,0.12)"; }}
                              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(14,165,233,0.25)"; e.currentTarget.style.boxShadow = "none"; }}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}

                {stationRows.length === 0 && (
                  <tr>
                    <td colSpan={FEATURE_COLS.length + 3} style={{ padding: "60px 24px", textAlign: "center", color: "rgba(51,65,85,0.85)", fontSize: 13, fontWeight: 600 }}>
                      No stations configured. Add machines with operation codes first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* -- Legend -- */}
          <div style={{
            padding: "12px 20px",
            borderTop: "1px solid rgba(15,23,42,0.10)",
            background: "rgba(15,23,42,0.03)",
            display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
          }}>
            {FEATURE_COLS.filter((c) => c.type === "toggle").map((col) => (
              <div key={col.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: DOT_COLORS[col.color], flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "rgba(51,65,85,0.9)", fontWeight: 600 }}>
                  {col.label} - {col.desc}
                </span>
              </div>
            ))}
          </div>

        </div>
      )}
    </div>
  );
};

export default StationControl;
