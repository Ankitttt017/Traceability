import React, { useEffect, useMemo, useState } from "react";
import { Flame, ImageOff, MapPin, BarChart3, ChevronDown, ChevronUp, X, AlertTriangle, Layers, Grid, Eye, TrendingUp, Sparkles, Filter, Info, ArrowLeft } from "lucide-react";
import { BarChart, Bar, Line, ComposedChart, XAxis, YAxis, Tooltip as RechartsTooltip, Cell, CartesianGrid, ReferenceLine, ResponsiveContainer, Legend, LabelList } from "recharts";
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
  let view = row.rejection_view || row.rejectionView || row.view || parseField(src, "View") || "";

  let zoneRaw = row.rejection_zone || row.rejectionZone || row.zone || parseField(src, "Zone") || "";
  let subZoneRaw = row.rejection_sub_zone || row.rejectionSubZone || row.subZone || parseField(src, "Sub Zone") || parseField(src, "SubZone") || "";

  if (zoneRaw.includes(" / ") || zoneRaw.includes(" - ")) {
    const parts = zoneRaw.split(/\s*[\/\-]\s*/);
    if (parts[0]) zoneRaw = parts[0].trim();
    if (parts[1] && !subZoneRaw) {
      subZoneRaw = parts[1].replace(/^(?:sub\s*zone|subzone)\s*:?\s*/i, "").trim();
    }
  }

  // Extract from text if explicitly logged in reason or notes (no arbitrary fallbacks to prevent fake hotspots)
  if (!zoneRaw) {
    const zMatch = src.match(/\bZone\s*([A-Za-z0-9]+)\b/i);
    if (zMatch) zoneRaw = `Zone ${zMatch[1].toUpperCase()}`;
  }
  if (!subZoneRaw) {
    const szMatch = src.match(/\b(?:Sub\s*Zone|SubZone)\s*([A-Za-z0-9]+)\b/i);
    if (szMatch) subZoneRaw = `SubZone ${szMatch[1]}`;
  }
  if (!view) {
    const vMatch = src.match(/\b(Top\s*View|Bottom\s*View|Left\s*Side|Right\s*Side|Front\s*View|Rear\s*View)\b/i);
    if (vMatch) view = vMatch[1];
  }

  return {
    category,
    reason,
    view: view || "",
    zone: zoneRaw || "",
    subZone: subZoneRaw || "",
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
  const [drillLevel, setDrillLevel] = useState("view"); // 'view' | 'zone' | 'subzone'
  const [drillZone, setDrillZone] = useState(null); // active zone for sub-zone drilldown

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

        // Also merge configured subZones if they have counts
        (zone.subZones || []).forEach((sz) => {
          const szName = sz.name || sz.code;
          const szCnt = resolveSubZoneCount(zone, sz);
          if (szCnt > 0 && !subMap[szName]) {
            subMap[szName] = szCnt;
          }
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
          rawZone: zone,
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

  const [showParetoSection, setShowParetoSection] = useState(true);

  // View-wise defect distribution
  const viewParetoData = useMemo(() => {
    return (config?.views || []).map((v) => {
      const count = viewDefectCounts[v.id] || 0;
      return {
        id: String(v.id),
        name: v.name,
        count,
      };
    }).sort((a, b) => b.count - a.count);
  }, [config?.views, viewDefectCounts]);

  // Top rejection reasons Pareto breakdown (view-specific, zone-specific, or all)
  const reasonParetoData = useMemo(() => {
    let targetRows = parsedRows;
    if (selectedLocation && drillDownDetails?.rows && drillDownDetails.rows.length > 0) {
      targetRows = drillDownDetails.rows;
    } else if (drillLevel === "subzone" && drillZone) {
      const zKeys = getZoneAliases(drillZone.rawZone || drillZone);
      targetRows = parsedRows.filter((r) => {
        const zClean = cleanZoneCode(r._parsed?.zone);
        const zNorm = normalize(r._parsed?.zone);
        return zKeys.includes(zClean) || zKeys.includes(zNorm);
      });
    } else if (viewId !== "all" && currentView) {
      targetRows = parsedRows.filter((r) => {
        const rView = normalize(r._parsed?.view);
        const rZoneClean = cleanZoneCode(r._parsed?.zone);
        const vNorm = normalize(currentView.name || currentView.code);
        if (rView && (vNorm.includes(rView) || rView.includes(vNorm))) return true;
        if (rZoneClean && (currentView.zones || []).some((z) => cleanZoneCode(z.code || z.name) === rZoneClean)) return true;
        return false;
      });
    }

    const counts = {};
    targetRows.forEach((r) => {
      const reason = r._parsed?.reason || "Unspecified Defect";
      counts[reason] = (counts[reason] || 0) + 1;
    });

    const sorted = Object.entries(counts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    const total = sorted.reduce((sum, item) => sum + item.count, 0);
    let cumulative = 0;

    return sorted.map((item, idx) => {
      cumulative += item.count;
      const cumPct = total > 0 ? Number(((cumulative / total) * 100).toFixed(1)) : 0;
      const pct = total > 0 ? Number(((item.count / total) * 100).toFixed(1)) : 0;
      return {
        ...item,
        percentage: pct,
        cumulativePct: cumPct,
        rank: idx + 1,
        isTop: idx === 0,
      };
    });
  }, [parsedRows, viewId, currentView, drillLevel, drillZone, selectedLocation, drillDownDetails]);

  const topRejectionReason = useMemo(() => {
    if (!reasonParetoData || reasonParetoData.length === 0) return null;
    return reasonParetoData[0];
  }, [reasonParetoData]);

  const currentContextTitle = useMemo(() => {
    if (selectedLocation?.subZone) {
      return `Sub-Zone ${selectedLocation.subZone.name || selectedLocation.subZone.code}`;
    }
    if (drillLevel === "subzone" && drillZone) {
      return `Zone ${drillZone.name || drillZone.code}`;
    }
    if (viewId !== "all" && currentView) {
      return currentView.name;
    }
    return "All Views";
  }, [selectedLocation, drillLevel, drillZone, viewId, currentView]);

  // ── Hierarchical Drilldown Chart Data (View -> Zone -> Sub-Zone) ────────
  const drillChartData = useMemo(() => {
    if (drillLevel === "view" || viewId === "all" || !currentView) {
      return {
        level: "view",
        title: "View-Wise Defect Distribution",
        hint: "Click any view bar to drill down into its Zones",
        items: viewParetoData.map((v) => ({
          ...v,
          displayName: v.name,
          color: String(viewId) === String(v.id) ? "#ef4444" : "#0284c7",
        })),
      };
    }

    if (drillLevel === "zone") {
      const items = zoneSummaryData.map((z, idx) => ({
        id: z.code || z.name,
        name: z.name ? `Zone ${z.name}` : `Zone ${z.code}`,
        displayName: z.name || z.code,
        count: z.count,
        zoneObj: z,
        color: idx === 0 ? "#dc2626" : idx === 1 ? "#ea580c" : idx === 2 ? "#d97706" : "#2563eb",
      }));
      return {
        level: "zone",
        title: `Zone Breakdown — ${currentView.name}`,
        hint: items.length > 0 ? "Click any zone bar to drill into Sub-Zones" : "No zones with recorded defects",
        items,
      };
    }

    if (drillLevel === "subzone" && drillZone) {
      const subZones = drillZone.subZones || [];
      const items = subZones.map((sz, idx) => ({
        id: sz.name,
        name: `Sub-Zone ${sz.name}`,
        displayName: sz.name,
        count: sz.count,
        color: SUBZONE_COLORS[idx % SUBZONE_COLORS.length] || "#8b5cf6",
      }));
      return {
        level: "subzone",
        title: `Sub-Zone Defects — Zone ${drillZone.name || drillZone.code}`,
        hint: items.length > 0 ? "Click any sub-zone bar to highlight on blueprint" : "No sub-zones recorded",
        items,
      };
    }

    return {
      level: "view",
      title: "View-Wise Defect Distribution",
      hint: "Click bar to focus view",
      items: viewParetoData.map((v) => ({ ...v, displayName: v.name })),
    };
  }, [drillLevel, viewId, currentView, viewParetoData, zoneSummaryData, drillZone]);

  const handleDrillBarClick = (raw) => {
    const entry = raw?.payload || raw?.activePayload?.[0]?.payload || raw;
    if (!entry) return;
    if (drillChartData.level === "view") {
      if (entry.id) {
        setViewId(entry.id);
        setDrillLevel("zone");
        setDrillZone(null);
        setSelectedLocation(null);
      }
    } else if (drillChartData.level === "zone") {
      const zObj = entry.zoneObj;
      const matchedZone = (currentView?.zones || []).find(
        (z) => cleanZoneCode(z.code || z.name) === cleanZoneCode(entry.id)
      ) || zObj?.rawZone;
      if (matchedZone) {
        setSelectedLocation({
          type: "zone",
          zone: matchedZone,
          zoneKey: normalize(matchedZone.code || matchedZone.name),
          count: entry.count,
        });
      }
      if (zObj?.subZones && zObj.subZones.length > 0) {
        setDrillLevel("subzone");
        setDrillZone(zObj);
      }
    } else if (drillChartData.level === "subzone") {
      const matchedZone = (currentView?.zones || []).find(
        (z) => cleanZoneCode(z.code || z.name) === cleanZoneCode(drillZone?.code || drillZone?.name)
      ) || drillZone?.rawZone;
      const matchedSub = (matchedZone?.subZones || []).find(
        (s) => cleanSubZoneCode(s.code || s.name) === cleanSubZoneCode(entry.id)
      ) || { name: entry.id, code: entry.id };
      setSelectedLocation({
        type: "subZone",
        zone: matchedZone || drillZone,
        subZone: matchedSub,
        zoneKey: normalize(matchedZone?.code || drillZone?.name),
        subKey: normalize(entry.id),
        count: entry.count,
      });
    }
  };

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
            onChange={(event) => {
              const val = event.target.value;
              setViewId(val);
              setSelectedLocation(null);
              if (val === "all") {
                setDrillLevel("view");
                setDrillZone(null);
              } else {
                setDrillLevel("zone");
                setDrillZone(null);
              }
            }}
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
            onClick={() => {
              setViewId("all");
              setSelectedLocation(null);
              setDrillLevel("view");
              setDrillZone(null);
            }}
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
                onClick={() => {
                  setViewId(String(v.id));
                  setSelectedLocation(null);
                  setDrillLevel("zone");
                  setDrillZone(null);
                }}
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

      {/* ── DEFECT HEATMAP PARETO & VIEW INTELLIGENCE ─────────────────────── */}
      <div style={{
        marginBottom: 16,
        background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "12px 16px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.03)"
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showParetoSection ? 12 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TrendingUp size={18} color="#ef4444" />
              <span style={{ fontSize: 13, fontWeight: 800, color: "#1a3263" }}>
                Defect Heatmap &amp; Pareto Intelligence
              </span>
            </div>
            {topRejectionReason && (
              <span style={{
                background: "#fee2e2",
                color: "#991b1b",
                border: "1px solid #fecaca",
                padding: "2px 10px",
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: 5
              }}>
                <Flame size={12} color="#dc2626" />
                #1 Defect Mode: <strong>{topRejectionReason.reason}</strong> ({topRejectionReason.count} pcs &bull; {topRejectionReason.percentage}%)
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowParetoSection(!showParetoSection)}
            style={{
              background: "transparent",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              color: "#64748b",
              display: "flex",
              alignItems: "center",
              gap: 4
            }}
          >
            {showParetoSection ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{showParetoSection ? "Hide Charts" : "Show Charts"}</span>
          </button>
        </div>

        {showParetoSection && (
          <div>
            {/* Top Rejection Highlight Card */}
            {topRejectionReason && (
              <div style={{
                background: "linear-gradient(90deg, #fff1f2 0%, #fff7ed 100%)",
                border: "1px solid #fecdd3",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 10
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ background: "#e11d48", color: "#fff", width: 34, height: 34, borderRadius: 8, display: "grid", placeContent: "center", fontWeight: 900, fontSize: 14 }}>
                    #1
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#be123c", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      #1 Defect Root Cause ({currentContextTitle})
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#881337" }}>
                      {topRejectionReason.reason}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>Scrapped Units</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#e11d48" }}>{topRejectionReason.count.toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>Defect Contribution</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#ea580c" }}>{topRejectionReason.percentage}%</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>Cumulative 80/20</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: topRejectionReason.cumulativePct <= 80 ? "#059669" : "#64748b" }}>
                      {topRejectionReason.cumulativePct}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2-Column Pareto Charts */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 14 }}>
              {/* Chart 1: Hierarchical Drilldown Defect Distribution */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#1e293b", display: "flex", alignItems: "center", gap: 6 }}>
                      <Eye size={14} color="#0284c7" />
                      {drillChartData.title}
                    </span>
                    
                    {/* Breadcrumbs */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, background: "#f1f5f9", padding: "2px 8px", borderRadius: 6 }}>
                      <span
                        onClick={() => {
                          setViewId("all");
                          setDrillLevel("view");
                          setDrillZone(null);
                          setSelectedLocation(null);
                        }}
                        style={{
                          cursor: "pointer",
                          color: drillLevel === "view" ? "#0f172a" : "#0284c7",
                          fontWeight: drillLevel === "view" ? 800 : 600,
                          textDecoration: drillLevel !== "view" ? "underline" : "none"
                        }}
                        title="View All Views"
                      >
                        All Views
                      </span>
                      {drillLevel !== "view" && currentView && (
                        <>
                          <span style={{ color: "#94a3b8" }}>/</span>
                          <span
                            onClick={() => {
                              setDrillLevel("zone");
                              setDrillZone(null);
                              setSelectedLocation(null);
                            }}
                            style={{
                              cursor: drillLevel === "subzone" ? "pointer" : "default",
                              color: drillLevel === "zone" ? "#0f172a" : "#0284c7",
                              fontWeight: drillLevel === "zone" ? 800 : 600,
                              textDecoration: drillLevel === "subzone" ? "underline" : "none"
                            }}
                            title="Drill to Zones"
                          >
                            {currentView.name}
                          </span>
                        </>
                      )}
                      {drillLevel === "subzone" && drillZone && (
                        <>
                          <span style={{ color: "#94a3b8" }}>/</span>
                          <span style={{ color: "#ef4444", fontWeight: 800 }}>
                            Zone {drillZone.name || drillZone.code}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {drillLevel === "subzone" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDrillLevel("zone");
                          setDrillZone(null);
                          setSelectedLocation(null);
                        }}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          background: "#f8fafc",
                          border: "1px solid #cbd5e1",
                          color: "#1e293b",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4
                        }}
                      >
                        <ArrowLeft size={11} /> Back to Zones
                      </button>
                    ) : drillLevel === "zone" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setViewId("all");
                          setDrillLevel("view");
                          setDrillZone(null);
                          setSelectedLocation(null);
                        }}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          background: "#f8fafc",
                          border: "1px solid #cbd5e1",
                          color: "#1e293b",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4
                        }}
                      >
                        <ArrowLeft size={11} /> Back to Views
                      </button>
                    ) : (
                      <span style={{ fontSize: 10, color: "#64748b" }}>{drillChartData.hint}</span>
                    )}
                  </div>
                </div>

                {drillChartData.items.length > 0 ? (
                  <SafeChart height={220}>
                    {({ width, height }) => (
                      <BarChart
                        width={width}
                        height={height}
                        data={drillChartData.items}
                        margin={{ top: 22, right: 15, left: -10, bottom: drillChartData.items.length > 5 ? 38 : 25 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis
                          dataKey="displayName"
                          tick={{ fontSize: 10, fontWeight: 700, fill: "#334155" }}
                          interval={0}
                          angle={drillChartData.items.length > 5 ? -18 : 0}
                          textAnchor={drillChartData.items.length > 5 ? "end" : "middle"}
                          height={drillChartData.items.length > 5 ? 38 : 25}
                        />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          domain={[0, (dataMax) => Math.max(5, Math.ceil(dataMax * 1.3))]}
                          allowDecimals={false}
                        />
                        <RechartsTooltip
                          formatter={(val) => [
                            `${val} Defects`,
                            drillChartData.level === "subzone" ? "Sub-Zone Defects" : drillChartData.level === "zone" ? "Zone Defects" : "View Defects"
                          ]}
                          contentStyle={{ borderRadius: 8, fontSize: 11, border: "1px solid #cbd5e1", fontWeight: 600 }}
                        />
                        <Bar
                          dataKey="count"
                          radius={[6, 6, 0, 0]}
                          onClick={handleDrillBarClick}
                          cursor="pointer"
                        >
                          <LabelList
                            dataKey="count"
                            position="top"
                            style={{ fill: "#0f172a", fontWeight: "800", fontSize: 11 }}
                          />
                          {drillChartData.items.map((entry, idx) => (
                            <Cell
                              key={idx}
                              fill={entry.color || "#0284c7"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    )}
                  </SafeChart>
                ) : (
                  <div style={{ height: 220, display: "grid", placeContent: "center", color: "#94a3b8", fontSize: 12 }}>
                    No items in this level
                  </div>
                )}
              </div>

              {/* Chart 2: Defect Reasons Pareto (80/20) */}
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", display: "flex", alignItems: "center", gap: 6 }}>
                    <BarChart3 size={14} color="#ea580c" />
                    Rejection Reasons Pareto (Sabse Jyada Defect)
                  </span>
                  <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600, background: "#f1f5f9", padding: "1px 8px", borderRadius: 4 }}>
                    {currentContextTitle}
                  </span>
                </div>
                {reasonParetoData.length > 0 ? (
                  <SafeChart height={220}>
                    {({ width, height }) => (
                      <ComposedChart
                        width={width}
                        height={height}
                        data={reasonParetoData.slice(0, 8)}
                        margin={{ top: 22, right: 25, left: -10, bottom: 35 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis
                          dataKey="reason"
                          tick={{ fontSize: 9, fontWeight: 600, fill: "#334155" }}
                          interval={0}
                          angle={-25}
                          textAnchor="end"
                          height={45}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 10 }}
                          domain={[0, (dataMax) => Math.max(5, Math.ceil(dataMax * 1.3))]}
                          allowDecimals={false}
                          label={{ value: "Units", angle: -90, position: "insideLeft", fontSize: 9, fill: "#94a3b8" }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          domain={[0, 100]}
                          tickFormatter={(v) => `${v}%`}
                          tick={{ fontSize: 10 }}
                        />
                        <RechartsTooltip
                          formatter={(val, name) => [
                            name === "cumulativePct" ? `${val}%` : `${val} pcs`,
                            name === "cumulativePct" ? "Cumulative %" : "Defect Count"
                          ]}
                          contentStyle={{ borderRadius: 8, fontSize: 11, border: "1px solid #cbd5e1", fontWeight: 600 }}
                        />
                        <ReferenceLine
                          y={80}
                          yAxisId="right"
                          stroke="#ef4444"
                          strokeDasharray="3 3"
                          label={{ value: "80% Cutoff", fill: "#ef4444", fontSize: 9, position: "top" }}
                        />
                        <Bar yAxisId="left" dataKey="count" name="Defects" radius={[6, 6, 0, 0]}>
                          <LabelList
                            dataKey="count"
                            position="top"
                            style={{ fill: "#0f172a", fontWeight: "800", fontSize: 11 }}
                          />
                          {reasonParetoData.slice(0, 8).map((entry, idx) => (
                            <Cell
                              key={idx}
                              fill={idx === 0 ? "#dc2626" : idx === 1 ? "#ea580c" : idx === 2 ? "#d97706" : "#3b82f6"}
                            />
                          ))}
                        </Bar>
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="cumulativePct"
                          name="cumulativePct"
                          stroke="#f59e0b"
                          strokeWidth={2.5}
                          dot={{ r: 3, fill: "#f59e0b" }}
                        />
                      </ComposedChart>
                    )}
                  </SafeChart>
                ) : (
                  <div style={{ height: 220, display: "grid", placeContent: "center", color: "#94a3b8", fontSize: 12 }}>
                    No defect reasons recorded
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

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
                onClick={() => {
                  setViewId(String(v.id));
                  setDrillLevel("zone");
                  setDrillZone(null);
                  setSelectedLocation(null);
                }}
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
                  <tr
                    key={z.code}
                    onClick={() => {
                      setDrillLevel("subzone");
                      setDrillZone(z);
                      setSelectedLocation({
                        type: "zone",
                        zone: z.rawZone || z,
                        zoneKey: normalize(z.code || z.name),
                        count: z.count,
                      });
                    }}
                    style={{ cursor: "pointer" }}
                    title={`Click to drill into Sub-Zones of Zone ${z.name}`}
                  >
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
                            <span
                              key={sz.name}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrillLevel("subzone");
                                setDrillZone(z);
                                setSelectedLocation({
                                  type: "subZone",
                                  zone: z.rawZone || z,
                                  subZone: { name: sz.name, code: sz.name },
                                  zoneKey: normalize(z.code || z.name),
                                  subKey: normalize(sz.name),
                                  count: sz.count,
                                });
                              }}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 3,
                                padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                                background: "rgba(139,92,246,0.1)", color: "#8b5cf6",
                                border: "1px solid rgba(139,92,246,0.2)",
                                cursor: "pointer",
                              }}
                              title={`Click to inspect Sub-Zone ${sz.name}`}
                            >
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
