import React, { useEffect, useMemo, useState } from "react";
import { Flame, ImageOff, MapPin, BarChart3, ChevronDown, ChevronUp, X, AlertTriangle, Layers, Grid, Eye } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, Cell } from "recharts";
import { rejectionConfigApi } from "../../api/services";
import SafeChart from "../../components/charts/SafeChart";

const normalize = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const cleanZoneCode = (val) => {
  if (!val) return "";
  return String(val)
    .toUpperCase()
    .replace(/^ZONE\s*[-_]?/i, "")
    .replace(/[^A-Z0-9]/g, "");
};

const cleanSubZoneCode = (val) => {
  if (!val) return "";
  return String(val)
    .toUpperCase()
    .replace(/^(?:SUB\s*ZONE|SUBZONE)\s*[-_]?/i, "")
    .replace(/[^A-Z0-9]/g, "");
};

const parseField = (text, label) => {
  if (!text || typeof text !== "string") return "";
  const m = text.match(new RegExp(label + ":\\s*([^|\\n]+)", "i"));
  return m ? m[1].trim() : "";
};

const extractRowDefectDetails = (row) => {
  const src = String(row.parts_interlock_reason || row.ng_reason || row.rejection_reason || row.ngReason || row.reason || "").trim();
  const category = row.rejection_category || row.category || parseField(src, "Category") || "CR";
  const reason = row.rejection_reason || row.reason || row.ngReason || parseField(src, "Reason") || "Defect";
  const view = row.rejection_view || row.rejectionView || row.view || parseField(src, "View") || "";

  let zoneRaw = row.rejection_zone || row.rejectionZone || row.zone || parseField(src, "Zone") || "";
  let subZoneRaw = row.rejection_sub_zone || row.rejectionSubZone || row.subZone || parseField(src, "Sub Zone") || parseField(src, "SubZone") || "";

  if (zoneRaw.includes(" / ") || zoneRaw.includes(" - ")) {
    const parts = zoneRaw.split(/\s*[\/\-]\s*/);
    if (parts[0]) zoneRaw = parts[0].trim();
    if (parts[1] && !subZoneRaw) {
      subZoneRaw = parts[1].replace(/^(?:sub\s*zone|subzone)\s*:?\s*/i, "").trim();
    }
  }

  // Heuristic fallbacks matching RejectionAnalysis.jsx so all scrap parts map to views and zones
  let v = view;
  let z = zoneRaw;
  let sz = subZoneRaw;

  if (!v || !z) {
    const rLower = (reason || src).toLowerCase();
    const g = String(row.ngGate || row.ng_gate || row.operation_no || "").toUpperCase();
    if (rLower.includes("leak") || g.includes("150") || g.includes("LEAK")) {
      if (!v) v = "Top View";
      if (!z) { z = "Zone A"; sz = sz || "SubZone 1"; }
    } else if (rLower.includes("non-filling") || rLower.includes("non filling")) {
      if (!v) v = "Bottom View";
      if (!z) { z = "Zone B"; sz = sz || "SubZone 2"; }
    } else if (rLower.includes("blow hole") || rLower.includes("porosity")) {
      if (!v) v = "Top View";
      if (!z) { z = "Zone A"; sz = sz || "SubZone 3"; }
    } else if (rLower.includes("dent") || rLower.includes("handling")) {
      if (!v) v = "Left Side";
      if (!z) { z = "Zone C"; sz = sz || "SubZone 1"; }
    } else if (rLower.includes("crack") || rLower.includes("broken")) {
      if (!v) v = "Right Side";
      if (!z) { z = "Zone D"; sz = sz || "SubZone 1"; }
    } else if (rLower.includes("chip")) {
      if (!v) v = "Front";
      if (!z) { z = "Zone O"; sz = sz || "SubZone 1"; }
    } else if (rLower.includes("shrinkage") || rLower.includes("biscuit")) {
      if (!v) v = "Bottom View";
      if (!z) { z = "Zone E"; sz = sz || "SubZone 3"; }
    } else {
      if (!v) v = "Top View";
      if (!z) { z = "Zone A"; sz = sz || "SubZone 1"; }
    }
  }

  return {
    category,
    reason,
    view: v,
    zone: z,
    subZone: sz,
  };
};

const SUBZONE_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981"];

export default function RejectionHeatMap({ rows = [] }) {
  const [parts, setParts] = useState([]);
  const [partName, setPartName] = useState("");
  const [config, setConfig] = useState(null);
  const [viewId, setViewId] = useState(""); // specific view ID or "all"
  const [showSummary, setShowSummary] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState(null); // { type: 'subZone' | 'zone', zone, subZone, view, count }

  // Load configured parts list
  useEffect(() => {
    let active = true;
    rejectionConfigApi.parts()
      .then((result) => {
        if (!active) return;
        const names = (Array.isArray(result) ? result : result?.parts || [])
          .map((item) => typeof item === "string" ? item : item.part_name || item.partName || item.name)
          .filter(Boolean);
        setParts(names);
        setPartName((current) => current && names.includes(current) ? current : names[0] || "OIL PAN K-12");
      })
      .catch(() => { if (active) setParts([]); });
    return () => { active = false; };
  }, []);

  // Load operator configuration for current part
  useEffect(() => {
    if (!partName) {
      setConfig(null);
      setSelectedLocation(null);
      return;
    }
    let active = true;
    rejectionConfigApi.operatorConfig({ partName })
      .then((result) => {
        if (!active) return;
        setConfig(result || null);
        if (!viewId && result?.views?.[0]?.id) {
          setViewId(String(result.views[0].id));
        }
        setSelectedLocation(null);
      })
      .catch(() => { if (active) setConfig(null); });
    return () => { active = false; };
  }, [partName]);

  // Robustly filter rows by part name
  const scopedRows = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    if (!partName) return rows;
    const normSelected = normalize(partName);
    return rows.filter((row) => {
      const rowPName = row.partName || row.part_name || "";
      if (!rowPName || rowPName === "-") return true;
      const normRow = normalize(rowPName);
      if (normRow.includes("OILPAN") && normSelected.includes("OILPAN")) return true;
      return normRow.includes(normSelected) || normSelected.includes(normRow) || parts.length <= 1;
    });
  }, [rows, partName, parts.length]);

  // Parse defect details for every scoped row
  const parsedRows = useMemo(() => {
    return scopedRows.map((r) => {
      const details = extractRowDefectDetails(r);
      return {
        ...r,
        _parsed: details,
      };
    });
  }, [scopedRows]);

  // View mapping helpers
  const currentView = useMemo(() => {
    if (viewId === "all") return null;
    return (config?.views || []).find((item) => String(item.id) === String(viewId)) || config?.views?.[0] || null;
  }, [config, viewId]);

  // Count defects per view
  const viewDefectCounts = useMemo(() => {
    const counts = {};
    (config?.views || []).forEach((v) => { counts[v.id] = 0; });
    parsedRows.forEach((r) => {
      const rView = normalize(r._parsed.view);
      const rZoneClean = cleanZoneCode(r._parsed.zone);
      (config?.views || []).forEach((v) => {
        const vNorm = normalize(v.name || v.code);
        let matches = false;
        if (rView && (vNorm.includes(rView) || rView.includes(vNorm))) {
          matches = true;
        } else if (rZoneClean) {
          const hasZone = (v.zones || []).some((z) => cleanZoneCode(z.code || z.name) === rZoneClean);
          if (hasZone) matches = true;
        }
        if (matches) {
          counts[v.id] = (counts[v.id] || 0) + 1;
        }
      });
    });
    return counts;
  }, [config, parsedRows]);

  // Zone & SubZone alias generator
  const getZoneAliases = (zone) => {
    if (!zone) return [];
    const keys = new Set();
    const c = String(zone.code || "").trim();
    const n = String(zone.name || "").trim();
    if (c) {
      keys.add(normalize(c));
      keys.add(cleanZoneCode(c));
    }
    if (n) {
      keys.add(normalize(n));
      keys.add(cleanZoneCode(n));
    }
    return [...keys].filter(Boolean);
  };

  const getSubZoneAliases = (subZone) => {
    if (!subZone) return [];
    const keys = new Set();
    const c = String(subZone.code || "").trim();
    const n = String(subZone.name || "").trim();
    if (c) {
      keys.add(normalize(c));
      keys.add(cleanSubZoneCode(c));
    }
    if (n) {
      keys.add(normalize(n));
      keys.add(cleanSubZoneCode(n));
    }
    return [...keys].filter(Boolean);
  };

  // Build zone, subzone counts and defect lists
  const { zoneCounts, zoneSubZoneCounts, subZoneCounts, defectRowsByLocation, totalMappedDefects } = useMemo(() => {
    const zc = {};
    const zsc = {};
    const sc = {};
    const rowsByLoc = {};
    let mappedCount = 0;

    parsedRows.forEach((row) => {
      const { zone, subZone } = row._parsed;
      const zoneClean = cleanZoneCode(zone);
      const zoneNorm = normalize(zone);
      const subClean = cleanSubZoneCode(subZone);
      const subNorm = normalize(subZone);

      let wasMapped = false;
      const zAliases = new Set([zoneNorm, zoneClean].filter(Boolean));
      const sAliases = new Set([subNorm, subClean].filter(Boolean));

      zAliases.forEach((zA) => {
        zc[zA] = (zc[zA] || 0) + 1;
        wasMapped = true;
        const zLoc = `zone:${zA}`;
        if (!rowsByLoc[zLoc]) rowsByLoc[zLoc] = [];
        rowsByLoc[zLoc].push(row);

        sAliases.forEach((sA) => {
          const pairKey = `${zA}__${sA}`;
          zsc[pairKey] = (zsc[pairKey] || 0) + 1;
          sc[sA] = (sc[sA] || 0) + 1;
          const sLoc = `subZone:${pairKey}`;
          if (!rowsByLoc[sLoc]) rowsByLoc[sLoc] = [];
          rowsByLoc[sLoc].push(row);
        });
      });

      if (!zAliases.size && sAliases.size) {
        sAliases.forEach((sA) => {
          sc[sA] = (sc[sA] || 0) + 1;
          wasMapped = true;
          const sLoc = `subOnly:${sA}`;
          if (!rowsByLoc[sLoc]) rowsByLoc[sLoc] = [];
          rowsByLoc[sLoc].push(row);
        });
      }

      if (wasMapped) mappedCount += 1;
    });

    return {
      zoneCounts: zc,
      zoneSubZoneCounts: zsc,
      subZoneCounts: sc,
      defectRowsByLocation: rowsByLoc,
      totalMappedDefects: mappedCount,
    };
  }, [parsedRows]);

  const maxZoneCount = Math.max(1, ...Object.values(zoneCounts).map(Number));
  const maxSubZoneCount = Math.max(1, ...Object.values(zoneSubZoneCounts).map(Number));

  // Resolvers
  const resolveZoneCount = (zone) => {
    const keys = getZoneAliases(zone);
    let maxVal = 0;
    for (const k of keys) {
      if ((zoneCounts[k] || 0) > maxVal) maxVal = zoneCounts[k];
    }
    return maxVal;
  };

  const resolveSubZoneCount = (zone, subZone) => {
    const zKeys = getZoneAliases(zone);
    const sKeys = getSubZoneAliases(subZone);
    let maxVal = 0;
    for (const zk of zKeys) {
      for (const sk of sKeys) {
        const c = zoneSubZoneCounts[`${zk}__${sk}`] || 0;
        if (c > maxVal) maxVal = c;
      }
    }
    if (maxVal === 0) {
      for (const sk of sKeys) {
        if ((subZoneCounts[sk] || 0) > maxVal) maxVal = subZoneCounts[sk];
      }
    }
    return maxVal;
  };

  // Zone summary data for table
  const zoneSummaryData = useMemo(() => {
    if (!currentView?.zones) return [];
    return currentView.zones
      .map((zone) => {
        const count = resolveZoneCount(zone);
        const zKeys = getZoneAliases(zone);
        const subMap = {};
        zKeys.forEach((zk) => {
          Object.entries(zoneSubZoneCounts).forEach(([key, cnt]) => {
            if (key.startsWith(`${zk}__`)) {
              const subName = key.split("__")[1];
              subMap[subName] = Math.max(subMap[subName] || 0, cnt);
            }
          });
        });
        const subZones = Object.entries(subMap)
          .map(([name, cnt]) => ({ name, count: cnt }))
          .sort((a, b) => b.count - a.count);

        return {
          code: zone.code || zone.name,
          name: zone.name || zone.code,
          count,
          percentage: parsedRows.length > 0 ? Number(((count / parsedRows.length) * 100).toFixed(1)) : 0,
          subZones,
        };
      })
      .filter((z) => z.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [currentView, zoneCounts, zoneSubZoneCounts, parsedRows.length]);

  // Drill-down data for selected sub-zone or zone
  const drillDownDetails = useMemo(() => {
    if (!selectedLocation) return null;
    let relevantRows = [];
    if (selectedLocation.type === "subZone") {
      const zKeys = getZoneAliases(selectedLocation.zone);
      const sKeys = getSubZoneAliases(selectedLocation.subZone);
      for (const zk of zKeys) {
        for (const sk of sKeys) {
          const list = defectRowsByLocation[`subZone:${zk}__${sk}`];
          if (list && list.length) {
            relevantRows = list;
            break;
          }
        }
        if (relevantRows.length) break;
      }
      if (!relevantRows.length) {
        relevantRows = parsedRows.filter((r) => {
          const szClean = cleanSubZoneCode(r._parsed.subZone);
          const szNorm = normalize(r._parsed.subZone);
          return sKeys.includes(szClean) || sKeys.includes(szNorm);
        });
      }
    } else {
      const zKeys = getZoneAliases(selectedLocation.zone);
      for (const zk of zKeys) {
        const list = defectRowsByLocation[`zone:${zk}`];
        if (list && list.length) {
          relevantRows = list;
          break;
        }
      }
      if (!relevantRows.length) {
        relevantRows = parsedRows.filter((r) => {
          const zClean = cleanZoneCode(r._parsed.zone);
          const zNorm = normalize(r._parsed.zone);
          return zKeys.includes(zClean) || zKeys.includes(zNorm);
        });
      }
    }

    const reasonMap = {};
    const categoryMap = {};
    relevantRows.forEach((r) => {
      const reason = r._parsed.reason || "Defect";
      const cat = r._parsed.category || "CR";
      reasonMap[reason] = (reasonMap[reason] || 0) + 1;
      categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    });

    const reasonsData = Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    return {
      rows: relevantRows,
      reasonsData,
      totalCount: relevantRows.length,
      percentage: parsedRows.length > 0 ? Number(((relevantRows.length / parsedRows.length) * 100).toFixed(1)) : 0,
    };
  }, [selectedLocation, defectRowsByLocation, parsedRows]);

  return (
    <div className="rej-card rejection-heat-map">
      <div className="rej-card-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Flame size={20} color="#ef4444" />
            <h3 className="rej-card-title" style={{ margin: 0 }}>Image Rejection Heat Map with Sub-Zones</h3>
            <span className="rej-badge rej-badge-danger" style={{ fontSize: 11, fontWeight: 800 }}>
              {parsedRows.length.toLocaleString()} Total NG Units
            </span>
          </div>
          <p className="rej-card-subtitle" style={{ margin: "4px 0 0" }}>
            Sub-zone defect heat density on actual part coordinates. Click any sub-zone to inspect defect breakdown.
          </p>
        </div>

        <div className="rejection-heat-map-controls">
          <select className="rej-select" value={partName} onChange={(event) => setPartName(event.target.value)}>
            <option value="">Select part</option>
            {parts.map((part) => <option key={part} value={part}>{part}</option>)}
          </select>

          <select
            className="rej-select"
            value={viewId}
            onChange={(event) => { setViewId(event.target.value); setSelectedLocation(null); }}
            disabled={!config?.views?.length}
          >
            <option value="all">🖼️ All Views Overview ({parsedRows.length})</option>
            {(config?.views || []).map((item) => {
              const vCnt = viewDefectCounts[item.id] || 0;
              return (
                <option key={item.id} value={item.id}>
                  {item.name} ({vCnt} Defect{vCnt === 1 ? "" : "s"})
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Quick View Navigation Tabs */}
      {config?.views?.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          <button
            onClick={() => { setViewId("all"); setSelectedLocation(null); }}
            className={`rej-view-tab-btn ${viewId === "all" ? "active" : ""}`}
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: viewId === "all" ? "2px solid #ef4444" : "1px solid #cbd5e1",
              background: viewId === "all" ? "rgba(239, 68, 68, 0.1)" : "#ffffff",
              color: viewId === "all" ? "#ef4444" : "#475569",
            }}
          >
            <Grid size={13} />
            <span>All Views Gallery</span>
            <span style={{ background: "#ef4444", color: "#fff", padding: "1px 6px", borderRadius: 999, fontSize: 10 }}>
              {parsedRows.length}
            </span>
          </button>

          {(config.views || []).map((v) => {
            const isAct = String(viewId) === String(v.id);
            const cnt = viewDefectCounts[v.id] || 0;
            return (
              <button
                key={v.id}
                onClick={() => { setViewId(String(v.id)); setSelectedLocation(null); }}
                className={`rej-view-tab-btn ${isAct ? "active" : ""}`}
                style={{
                  padding: "5px 12px",
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  border: isAct ? "2px solid #1a3263" : "1px solid #cbd5e1",
                  background: isAct ? "rgba(26, 50, 99, 0.08)" : "#ffffff",
                  color: isAct ? "#1a3263" : "#475569",
                }}
              >
                <Eye size={13} />
                <span>{v.name}</span>
                <span style={{
                  background: cnt > 0 ? (isAct ? "#1a3263" : "#64748b") : "#cbd5e1",
                  color: cnt > 0 ? "#ffffff" : "#64748b",
                  padding: "1px 6px",
                  borderRadius: 999,
                  fontSize: 10,
                }}>
                  {cnt}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── ALL VIEWS GALLERY MODE ────────────────────────────────────────── */}
      {viewId === "all" && config?.views && (
        <div className="rej-pictorial-3col-grid" style={{ marginBottom: 16 }}>
          {config.views.map((v) => {
            const vDefects = viewDefectCounts[v.id] || 0;
            return (
              <div
                key={v.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  background: "#ffffff",
                  overflow: "hidden",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  display: "flex",
                  flexDirection: "column",
                }}
                onClick={() => setViewId(String(v.id))}
                title={`Click to focus on ${v.name}`}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: "#f8fafc",
                  borderBottom: "1px solid #e2e8f0",
                }}>
                  <strong style={{ fontSize: 12, color: "#1a3263" }}>{v.name}</strong>
                  <span className={`rej-badge ${vDefects > 0 ? "rej-badge-danger" : "rej-badge-info"}`} style={{ fontSize: 10 }}>
                    {vDefects} Defect{vDefects === 1 ? "" : "s"}
                  </span>
                </div>

                <div style={{ position: "relative", width: "100%", aspectRatio: "900 / 520", background: "#0f172a" }}>
                  {v.imageUrl ? (
                    <img src={v.imageUrl} alt={v.name} style={{ width: "100%", height: "100%", objectFit: "fill" }} />
                  ) : (
                    <div style={{ display: "grid", placeContent: "center", height: "100%", color: "#94a3b8", fontSize: 11 }}>
                      No image
                    </div>
                  )}

                  {(v.zones || []).map((zone) => {
                    const zCnt = resolveZoneCount(zone);
                    const hasSub = Array.isArray(zone.subZones) && zone.subZones.length > 0;
                    return (
                      <React.Fragment key={zone.id || zone.code}>
                        <div
                          style={{
                            position: "absolute",
                            left: `${zone.xPercent || 0}%`,
                            top: `${zone.yPercent || 0}%`,
                            width: `${zone.widthPercent || 10}%`,
                            height: `${zone.heightPercent || 10}%`,
                            border: zCnt > 0 ? "2px solid rgba(239,68,68,0.9)" : "1px dashed rgba(148,163,184,0.4)",
                            borderRadius: 6,
                            background: zCnt > 0 ? "rgba(239, 68, 68, 0.25)" : "transparent",
                            pointerEvents: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {zCnt > 0 && !hasSub && (
                            <span style={{ fontSize: 9, fontWeight: 900, background: "#ef4444", color: "#fff", padding: "1px 4px", borderRadius: 4 }}>
                              {zCnt}
                            </span>
                          )}
                        </div>

                        {hasSub && zone.subZones.map((sz) => {
                          const sLeft = Number(zone.xPercent || 0) + (Number(zone.widthPercent || 10) * Number(sz.xPercent || 0) / 100);
                          const sTop = Number(zone.yPercent || 0) + (Number(zone.heightPercent || 10) * Number(sz.heightPercent || 0) / 100);
                          const sWidth = (Number(zone.widthPercent || 10) * Number(sz.widthPercent || 10)) / 100;
                          const sHeight = (Number(zone.heightPercent || 10) * Number(sz.heightPercent || 10)) / 100;
                          const szCnt = resolveSubZoneCount(zone, sz);
                          const isHot = szCnt > 0;

                          return (
                            <div
                              key={`gallery-sub-${sz.id || sz.code}`}
                              style={{
                                position: "absolute",
                                left: `${sLeft}%`,
                                top: `${sTop}%`,
                                width: `${sWidth}%`,
                                height: `${sHeight}%`,
                                border: isHot ? "2px solid #ef4444" : "1px solid rgba(148,163,184,0.3)",
                                borderRadius: 4,
                                background: isHot ? "rgba(239, 68, 68, 0.55)" : "rgba(255,255,255,0.08)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                pointerEvents: "none",
                              }}
                            >
                              {isHot && (
                                <span style={{ fontSize: 8, fontWeight: 900, background: "#dc2626", color: "#fff", padding: "0 3px", borderRadius: 3 }}>
                                  {szCnt}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Defect Location Summary Tag: Standard SCADA Layout with Uniform Heights */}
                <div style={{ padding: "8px 10px", fontSize: 11, background: "#ffffff", borderTop: "1px solid #f1f5f9", minHeight: 96, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  {vDefects > 0 ? (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 800, color: "#1e293b", marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <span style={{ color: "#ef4444", textTransform: "uppercase", letterSpacing: "0.5px" }}>Zones: </span>
                        {(v.zones || [])
                          .filter((z) => resolveZoneCount(z) > 0)
                          .map((z) => `${z.name || z.code} (${resolveZoneCount(z)})`)
                          .join(" • ") || "Active Defect Zones"}
                      </div>
                      <div className="rej-zone-chip-container">
                        {(v.zones || []).flatMap((z) =>
                          (z.subZones || []).map((sz) => {
                            const cnt = resolveSubZoneCount(z, sz);
                            if (cnt <= 0) return null;
                            return (
                              <span
                                key={`sz-chip-${z.code}-${sz.code}`}
                                title={`${z.name || z.code} › ${sz.name || sz.code}: ${cnt} defects`}
                                style={{
                                  background: "rgba(239, 68, 68, 0.08)",
                                  color: "#b91c1c",
                                  border: "1px solid rgba(239, 68, 68, 0.22)",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  fontWeight: 800,
                                  fontSize: 10,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {sz.code || sz.name}: {cnt}
                              </span>
                            );
                          }).filter(Boolean)
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ color: "#15803d", fontWeight: 700, fontSize: 11, background: "rgba(34, 197, 94, 0.1)", padding: "4px 10px", borderRadius: 6, border: "1px solid rgba(34, 197, 94, 0.25)" }}>
                        ✓ 0 Defects in this view (100% In-Spec)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SINGLE VIEW INTERACTIVE CANVAS ───────────────────────────────── */}
      {viewId !== "all" && (
        <>
          {!currentView ? (
            <div className="rejection-heat-map-empty"><ImageOff size={28} /> Select a part with a configured inspection image.</div>
          ) : (
            <div className="rejection-heat-map-canvas">
              {currentView.imageUrl ? (
                <img src={currentView.imageUrl} alt={`${currentView.name} rejection heat map`} />
              ) : (
                <div className="rejection-heat-map-empty"><ImageOff size={28} /> No image configured for this view.</div>
              )}

              {(currentView.zones || []).map((zone) => {
                const zoneKey = normalize(zone.code || zone.name);
                const zoneCount = resolveZoneCount(zone);
                const hasSubZones = Array.isArray(zone.subZones) && zone.subZones.length > 0;
                const isZoneSelected = selectedLocation?.type === "zone" && selectedLocation?.zone?.id === zone.id;

                return (
                  <React.Fragment key={zone.id || zone.code || zone.name}>
                    {/* Parent Zone Outline */}
                    <div
                      className={`rejection-heat-zone ${hasSubZones ? "has-subzones" : ""} ${isZoneSelected ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedLocation({
                          type: "zone",
                          zone,
                          zoneKey,
                          count: zoneCount,
                        });
                      }}
                      title={`Zone: ${zone.name || zone.code}\nNG Count: ${zoneCount}${hasSubZones ? ` (${zone.subZones.length} Sub-Zones)` : ""}`}
                      style={{
                        left: `${zone.xPercent || 0}%`,
                        top: `${zone.yPercent || 0}%`,
                        width: `${zone.widthPercent || 10}%`,
                        height: `${zone.heightPercent || 10}%`,
                        borderColor: isZoneSelected ? "#3b82f6" : zoneCount > 0 ? "rgba(239, 68, 68, 0.85)" : "rgba(148, 163, 184, 0.4)",
                        background: zoneCount > 0
                          ? `rgba(239, 68, 68, ${Math.min(0.65, 0.15 + (zoneCount / maxZoneCount) * 0.45)})`
                          : "transparent",
                      }}
                    >
                      <span className="zone-name">{zone.name || zone.code}</span>
                      {zoneCount > 0 && <span className="zone-count">{zoneCount}</span>}
                    </div>

                    {/* Sub-Zones Rendered Exactly on Parent Zone Coordinates */}
                    {hasSubZones && zone.subZones.map((subZone) => {
                      const subLeft = Number(zone.xPercent || 0) + (Number(zone.widthPercent || 10) * Number(subZone.xPercent || 0) / 100);
                      const subTop = Number(zone.yPercent || 0) + (Number(zone.heightPercent || 10) * Number(subZone.yPercent || 0) / 100);
                      const subWidth = (Number(zone.widthPercent || 10) * Number(subZone.widthPercent || 10)) / 100;
                      const subHeight = (Number(zone.heightPercent || 10) * Number(subZone.heightPercent || 10)) / 100;

                      const subKey = normalize(subZone.code || subZone.name);
                      const subCount = resolveSubZoneCount(zone, subZone);
                      const intensity = maxSubZoneCount > 0 ? subCount / maxSubZoneCount : 0;
                      const isSubSelected = selectedLocation?.type === "subZone" && selectedLocation?.subZone?.id === subZone.id;

                      const heatColor = intensity > 0.6 ? "#dc2626" : intensity > 0.25 ? "#ea580c" : intensity > 0 ? "#f59e0b" : "#64748b";

                      return (
                        <div
                          key={`sub-${subZone.id || subZone.code}`}
                          className={`rejection-heat-subzone ${isSubSelected ? "selected" : ""} ${subCount > 0 ? "has-defects" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLocation({
                              type: "subZone",
                              zone,
                              subZone,
                              zoneKey,
                              subKey,
                              count: subCount,
                            });
                          }}
                          title={`Zone: ${zone.name || zone.code}\nSub-Zone: ${subZone.name || subZone.code}\nNG Count: ${subCount}`}
                          style={{
                            left: `${subLeft}%`,
                            top: `${subTop}%`,
                            width: `${subWidth}%`,
                            height: `${subHeight}%`,
                            borderColor: isSubSelected ? "#2563eb" : subCount > 0 ? heatColor : "rgba(148, 163, 184, 0.45)",
                            background: subCount > 0
                              ? `${heatColor}${Math.round(85 + intensity * 160).toString(16).padStart(2, "0")}`
                              : "rgba(255, 255, 255, 0.12)",
                          }}
                        >
                          <span className="subzone-badge" style={{ borderColor: subCount > 0 ? heatColor : "transparent" }}>
                            {subZone.code || subZone.name}
                            {subCount > 0 && <strong className="subzone-count" style={{ background: heatColor, color: "#fff" }}>({subCount})</strong>}
                          </span>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {currentView && (
            <div className="rejection-heat-map-legend">
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "#dc2626" }} /> High Density
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "#ea580c" }} /> Moderate Density
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "#f59e0b" }} /> Low Density
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, border: "1px dashed rgba(148, 163, 184, 0.8)", background: "transparent" }} /> Parent Zone Boundary
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>View Defects: <strong>{viewDefectCounts[currentView.id] || 0}</strong></div>
                <div>All Views Total: <strong>{parsedRows.length}</strong></div>
                <div>Mapped to Zones: <strong>{totalMappedDefects}</strong></div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Selected Sub-Zone / Zone Drill-Down Analytics Card ──────────────── */}
      {selectedLocation && drillDownDetails && (
        <div className="rej-card rej-subzone-drilldown" style={{ marginTop: 16 }}>
          <div className="rej-card-header" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div className="rej-drilldown-tag">
                <Layers size={14} />
                <span>Zone: <strong>{selectedLocation.zone.name || selectedLocation.zone.code}</strong></span>
              </div>
              {selectedLocation.subZone && (
                <div className="rej-drilldown-tag sub">
                  <MapPin size={14} />
                  <span>Sub-Zone: <strong>{selectedLocation.subZone.name || selectedLocation.subZone.code}</strong></span>
                </div>
              )}
              <span className="rej-badge rej-badge-danger">
                {drillDownDetails.totalCount} Defects ({drillDownDetails.percentage}% of total)
              </span>
            </div>

            <button
              onClick={() => setSelectedLocation(null)}
              className="rej-close-drilldown-btn"
              title="Clear selection"
            >
              <X size={14} />
              <span>Reset Selection</span>
            </button>
          </div>

          <div className="rej-grid-2" style={{ gap: 14 }}>
            {/* Defect Reasons Frequency Chart */}
            <div style={{ background: "var(--app-bg-surface, #f8fafc)", padding: 14, borderRadius: 12, border: "1px solid var(--app-border, #e2e8f0)" }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: "#1a3263", display: "flex", alignItems: "center", gap: 6 }}>
                <BarChart3 size={15} color="#ef4444" />
                Defect Reasons Breakdown in this Area
              </h4>
              {drillDownDetails.reasonsData.length > 0 ? (
                <div style={{ height: 200 }}>
                  <SafeChart height={200}>
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={drillDownDetails.reasonsData} margin={{ top: 5, right: 20, left: 0, bottom: 40 }}>
                        <XAxis dataKey="reason" angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 9, fontWeight: 700 }} height={45} />
                        <YAxis tick={{ fontSize: 9, fontWeight: 700 }} />
                        <RechartsTooltip />
                        <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
                          {drillDownDetails.reasonsData.map((_, idx) => (
                            <Cell key={idx} fill={SUBZONE_COLORS[idx % SUBZONE_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    )}
                  </SafeChart>
                </div>
              ) : (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                  No defect reasons recorded for this location.
                </div>
              )}
            </div>

            {/* Defect Records Table */}
            <div style={{ background: "var(--app-bg-surface, #f8fafc)", padding: 14, borderRadius: 12, border: "1px solid var(--app-border, #e2e8f0)", overflowX: "auto" }}>
              <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: "#1a3263", display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={15} color="#d97706" />
                Defect Records ({drillDownDetails.rows.length})
              </h4>
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                <table className="rej-matrix-table" style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th>Part Serial / QR</th>
                      <th>Category</th>
                      <th>Reason</th>
                      <th>Machine</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillDownDetails.rows.slice(0, 50).map((r, idx) => (
                      <tr key={idx}>
                        <td>
                          <strong style={{ color: "#1a3263" }}>{r.partId && r.partId !== "-" ? r.partId : r.customerQrCode}</strong>
                        </td>
                        <td><span className="rej-badge rej-badge-warning">{r._parsed?.category || "-"}</span></td>
                        <td style={{ color: "#ef4444", fontWeight: 700 }}>{r._parsed?.reason || "-"}</td>
                        <td>{r.machineName || r.machine_name || "-"}</td>
                      </tr>
                    ))}
                    {!drillDownDetails.rows.length && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", color: "#94a3b8", padding: 16 }}>No records found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zone Summary Table */}
      {currentView && zoneSummaryData.length > 0 && viewId !== "all" && (
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => setShowSummary(!showSummary)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
              border: "1px solid var(--app-border, #cbd5e1)", background: "transparent",
              color: "var(--app-text-main, #0f172a)", cursor: "pointer",
            }}
          >
            <BarChart3 size={14} />
            {showSummary ? "Hide" : "Show"} Zone Breakdown Table ({currentView.name})
            {showSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showSummary && (
            <table className="rej-zone-summary-table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Zone</th>
                  <th>Zone Code</th>
                  <th>Sub-Zone(s)</th>
                  <th>NG Count</th>
                  <th>% of Total NG</th>
                  <th style={{ width: 160 }}>Distribution</th>
                </tr>
              </thead>
              <tbody>
                {zoneSummaryData.map((z, idx) => (
                  <tr key={z.code}>
                    <td style={{ fontWeight: 800, color: "#94a3b8" }}>{idx + 1}</td>
                    <td><strong style={{ color: "#1a3263" }}>{z.name}</strong></td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#1a3263", background: "rgba(26,50,99,0.08)", padding: "2px 7px", borderRadius: 6 }}>
                        {z.code}
                      </span>
                    </td>
                    <td>
                      {z.subZones.length > 0 ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {z.subZones.map((sz) => (
                            <span key={sz.name} style={{
                              display: "inline-flex", alignItems: "center", gap: 3,
                              padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                              background: "rgba(139,92,246,0.1)", color: "#8b5cf6",
                              border: "1px solid rgba(139,92,246,0.2)",
                            }}>
                              {sz.name} <strong>({sz.count})</strong>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td>
                      <strong style={{ color: z.count > 0 ? "#ef4444" : "#94a3b8", fontSize: 14 }}>{z.count}</strong>
                    </td>
                    <td>
                      <strong style={{ color: z.percentage > 20 ? "#ef4444" : z.percentage > 10 ? "#f59e0b" : "#22c55e" }}>
                        {z.percentage}%
                      </strong>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{
                          flex: 1, height: 6, borderRadius: 99,
                          background: "var(--app-bg-surface, #f1f5f9)", overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%", borderRadius: 99,
                            width: `${Math.min(100, z.percentage)}%`,
                            background: z.percentage > 20 ? "#ef4444" : z.percentage > 10 ? "#f59e0b" : "#22c55e",
                            transition: "width 0.4s ease",
                          }} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
